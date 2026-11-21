#!/usr/bin/env node
// Local end to end check for the stdio connector.
//   node scripts/e2e.mjs --key-file path --spec path [--skip-pack]
// The API key is read from a file into the child's environment and never printed.
// You can also set SPATIAL_API_KEY_FILE and SPATIAL_E2E_SPEC.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'src', 'index.js');
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const keyFile = opt('--key-file', process.env.SPATIAL_API_KEY_FILE || '');
const specFile = opt('--spec', process.env.SPATIAL_E2E_SPEC || '');
const skipPack = argv.includes('--skip-pack');
const EXPECTED_TOOLS = ['discover', 'add_input', 'estimate', 'submit', 'get_job', 'cancel_job'];

let failures = 0;
const results = {};
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
}

const cleanEnv = () => {
  const env = { ...process.env };
  delete env.SPATIAL_API_KEY;
  delete env.SPATIAL_COMPILER_API_KEY;
  return env;
};

// 1. --help and -h
for (const flag of ['--help', '-h']) {
  const r = spawnSync(process.execPath, [entry, flag], { env: cleanEnv(), encoding: 'utf8', timeout: 10000 });
  const out = r.stdout + r.stderr;
  check(`${flag} exits 0`, r.status === 0, `status=${r.status}`);
  check(`${flag} mentions SPATIAL_API_KEY`, out.includes('SPATIAL_API_KEY'));
}

// 2. Live stdio session against the hosted MCP
class StdioClient {
  constructor(cmd, args, env) {
    this.child = spawn(cmd, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.pending = new Map();
    this.nextId = 1;
    this.stderr = '';
    this.nonJson = [];
    let buf = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          this.nonJson.push(line.slice(0, 200));
          continue;
        }
        if ('id' in msg && this.pending.has(msg.id)) {
          this.pending.get(msg.id)(msg);
          this.pending.delete(msg.id);
        }
      }
    });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (d) => (this.stderr += d));
  }
  request(method, params, timeoutMs = 60000) {
    const id = this.nextId++;
    const p = new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`timeout waiting for ${method}`)), timeoutMs);
      this.pending.set(id, (m) => {
        clearTimeout(t);
        res(m);
      });
    });
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return p;
  }
  notify(method, params) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }) + '\n');
  }
  async close() {
    const exited = new Promise((res) => this.child.once('exit', (code) => res(code)));
    this.child.stdin.end();
    const t = setTimeout(() => this.child.kill('SIGKILL'), 8000);
    const code = await exited;
    clearTimeout(t);
    return code;
  }
}

function toolPayload(result) {
  if (result?.structuredContent) return result.structuredContent;
  const text = (result?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function findField(obj, pattern, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return undefined;
  for (const [k, v] of Object.entries(obj)) {
    if (pattern.test(k)) return { key: k, value: v };
  }
  for (const v of Object.values(obj)) {
    const hit = findField(v, pattern, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}

if (!keyFile) {
  console.error('Pass --key-file or set SPATIAL_API_KEY_FILE to a file that contains the API key.');
  process.exit(2);
}
if (!specFile) {
  console.error('Pass --spec or set SPATIAL_E2E_SPEC to a pyro.toml file for the estimate check.');
  process.exit(2);
}
const key = readFileSync(keyFile, 'utf8').trim();
console.log(`key: ${key.slice(0, key.indexOf('_', 5) + 1)}… (length ${key.length})`);
const spec = readFileSync(specFile, 'utf8');

const env = { ...cleanEnv(), SPATIAL_API_KEY: key };
const client = new StdioClient(process.execPath, [entry], env);
try {
  const init = await client.request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'spatial-compiler-mcp-e2e', version: '0.0.0' },
  });
  check('initialize', !!init.result?.serverInfo, init.error ? JSON.stringify(init.error) : `server=${init.result.serverInfo.name} protocol=${init.result.protocolVersion}`);
  results.serverInfo = init.result?.serverInfo;
  results.protocolVersion = init.result?.protocolVersion;
  client.notify('notifications/initialized');

  const list = await client.request('tools/list', {});
  const tools = (list.result?.tools || []).map((t) => t.name);
  results.tools = tools;
  check('tools/list', tools.length > 0, list.error ? JSON.stringify(list.error) : tools.join(', '));
  const missing = EXPECTED_TOOLS.filter((t) => !tools.includes(t));
  check('tools/list has expected tools', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : '');

  const estimateTool = list.result?.tools?.find((t) => t.name === 'estimate');
  const props = Object.keys(estimateTool?.inputSchema?.properties || {});
  console.log(`estimate input properties: ${props.join(', ')}`);
  const specKey = ['spec', 'spec_toml', 'toml', 'input'].find((k) => props.includes(k)) || 'spec';

  const call = await client.request(
    'tools/call',
    { name: 'estimate', arguments: { module: 'pyro', operation: 'bake', quality: 'draft', [specKey]: spec } },
    120000,
  );
  const payload = toolPayload(call.result);
  const ok = !call.error && call.result && !call.result.isError && payload?.ok !== false;
  const price = findField(payload, /price|cost|amount|usd|cents/i);
  const cache = findField(payload, /cache/i);
  const pick = (k) => (payload && k in payload ? payload[k] : undefined);
  results.estimate = {
    ok,
    price_usd: pick('price_usd'),
    price_cents: pick('price_cents'),
    you_pay_usd: pick('you_pay_usd'),
    cache: pick('cache'),
    cache_hit: pick('cache_hit'),
    price_list_version: pick('price_list_version'),
    ...(price && !('price_usd' in (payload || {})) ? { price } : {}),
    ...(cache && !('cache' in (payload || {})) ? { cache } : {}),
  };
  check(
    'tools/call estimate (pyro bake draft)',
    ok,
    call.error ? JSON.stringify(call.error) : `ok=${payload?.ok} ${price ? `${price.key}=${JSON.stringify(price.value)}` : ''} ${cache ? `${cache.key}=${JSON.stringify(cache.value)}` : ''}`,
  );
  if (!ok) console.log(JSON.stringify(payload).slice(0, 1500));
} catch (err) {
  check('live session', false, err.message);
} finally {
  const code = await client.close();
  check('stdout carried only JSON-RPC', client.nonJson.length === 0, client.nonJson.join(' | '));
  check('server exits cleanly on stdin close', code === 0, `exit=${code}`);
  if (client.stderr.trim()) console.log(`server stderr:\n${client.stderr.replaceAll(key, '<redacted>').trim()}`);
}

// 3. npm pack, then run --help from a clean temp dir through npx
if (!skipPack) {
  const packDir = mkdtempSync(join(tmpdir(), 'scmcp-pack-'));
  const runDir = mkdtempSync(join(tmpdir(), 'scmcp-run-'));
  try {
    const pack = spawnSync('npm', ['pack', '--json', '--pack-destination', packDir], { cwd: root, encoding: 'utf8' });
    const info = JSON.parse(pack.stdout)[0];
    const files = info.files.map((f) => f.path);
    results.pack = { filename: info.filename, size: info.size, files };
    check('npm pack', pack.status === 0, `${info.filename} ${info.size} bytes, files: ${files.join(', ')}`);
    const allowed = (p) => p === 'package.json' || p === 'LICENSE' || p === 'README.md' || p.startsWith('src/');
    check('tarball has only the published surface', files.every(allowed));
    const tarball = join(packDir, info.filename);
    const r = spawnSync('npx', ['--yes', `file:${tarball}`, '--help'], {
      cwd: runDir,
      env: { ...cleanEnv(), npm_config_cache: join(runDir, '.npm-cache') },
      encoding: 'utf8',
      timeout: 180000,
    });
    check('npx --yes file:<tarball> --help', r.status === 0 && (r.stdout + r.stderr).includes('SPATIAL_API_KEY'), `status=${r.status}`);
    if (r.status !== 0) console.log(r.stderr.slice(-2000));
  } finally {
    rmSync(packDir, { recursive: true, force: true });
    rmSync(runDir, { recursive: true, force: true });
  }
}

console.log(`\nRESULTS ${JSON.stringify(results)}`);
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);

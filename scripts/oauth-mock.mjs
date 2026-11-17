#!/usr/bin/env node
// Offline check of the OAuth path: a local mock MCP host plus authorization
// server. A fake "browser" follows the authorize redirect, the connector
// exchanges the code, saves tokens, and later refreshes after a 401.
//   node scripts/oauth-mock.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'src', 'index.js');
const work = mkdtempSync(join(tmpdir(), 'scmcp-oauth-'));
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
};

const state = { codes: new Map(), access: new Set(), refresh: new Set(), n: 0, refreshes: 0, registrations: 0 };
let base;
const json = (res, status, body, headers = {}) =>
  res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(body));
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => r(b)); });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, base);
  const body = await readBody(req);
  if (url.pathname === '/.well-known/oauth-protected-resource') {
    return json(res, 200, { resource: base, authorization_servers: [base], scopes_supported: ['compile', 'read'] });
  }
  if (url.pathname === '/.well-known/oauth-authorization-server') {
    return json(res, 200, {
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  }
  if (url.pathname === '/oauth/register') {
    state.registrations++;
    return json(res, 201, { ...JSON.parse(body), client_id: `client_${state.registrations}` });
  }
  if (url.pathname === '/authorize') {
    const q = url.searchParams;
    const ok = q.get('code_challenge_method') === 'S256' && q.get('resource') === base && q.get('scope') === 'compile read';
    const code = `code_${++state.n}`;
    state.codes.set(code, q.get('redirect_uri'));
    const to = new URL(q.get('redirect_uri'));
    if (ok) to.searchParams.set('code', code);
    else to.searchParams.set('error', 'invalid_request');
    to.searchParams.set('state', q.get('state'));
    return res.writeHead(302, { location: to.toString() }).end();
  }
  if (url.pathname === '/oauth/token') {
    const p = new URLSearchParams(body);
    const issue = () => {
      const t = { access_token: `at_${++state.n}`, refresh_token: `rt_${state.n}`, token_type: 'Bearer', expires_in: 3600 };
      state.access.add(t.access_token);
      state.refresh.add(t.refresh_token);
      return t;
    };
    if (p.get('grant_type') === 'authorization_code' && state.codes.get(p.get('code')) === p.get('redirect_uri') && p.get('code_verifier')) {
      state.codes.delete(p.get('code'));
      return json(res, 200, issue());
    }
    if (p.get('grant_type') === 'refresh_token' && state.refresh.delete(p.get('refresh_token'))) {
      state.refreshes++;
      return json(res, 200, issue());
    }
    return json(res, 400, { error: 'invalid_grant' });
  }
  if (url.pathname === '/') {
    if (req.method === 'GET') return res.writeHead(405).end();
    if (req.method === 'DELETE') return res.writeHead(200).end();
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!state.access.has(token)) {
      return json(res, 401, { error: { code: 'UNAUTHORIZED' } }, {
        'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
      });
    }
    const msg = JSON.parse(body);
    if (!('id' in msg)) return res.writeHead(202).end();
    if (msg.method === 'initialize') {
      return json(res, 200, { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'mock', version: '0' } } }, { 'mcp-session-id': 'sess_1' });
    }
    if (msg.method === 'tools/list') {
      const sid = req.headers['mcp-session-id'];
      return json(res, 200, { jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'estimate', inputSchema: { type: 'object' } }], sid } });
    }
    return json(res, 200, { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'nope' } });
  }
  res.writeHead(404).end();
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
base = `http://127.0.0.1:${server.address().port}`;

const browser = join(work, 'browser.mjs');
writeFileSync(browser, `#!/usr/bin/env node\nfetch(process.argv[2]).then(r => r.text()).catch(() => {});\n`);
chmodSync(browser, 0o755);

const env = { ...process.env, SPATIAL_COMPILER_MCP_URL: base, XDG_CONFIG_HOME: work, BROWSER: browser };
delete env.SPATIAL_API_KEY;
delete env.SPATIAL_COMPILER_API_KEY;

const child = spawn(process.execPath, [entry], { env, stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', (d) => (stderr += d));
const waiting = new Map();
let buf = '';
child.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const m = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    waiting.get(m.id)?.(m);
  }
});
let id = 0;
const rpc = (method, params = {}) =>
  new Promise((res, rej) => {
    const n = ++id;
    const t = setTimeout(() => rej(new Error(`timeout: ${method}`)), 15000);
    waiting.set(n, (m) => { clearTimeout(t); res(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
  });

try {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  check('first run signs in and initializes', init.result?.serverInfo?.name === 'mock', JSON.stringify(init.error || ''));
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const file = join(work, 'spatial-compiler', 'mcp-oauth.json');
  const mode = statSync(file).mode & 0o777;
  check('token file mode 0600', mode === 0o600, mode.toString(8));
  const saved = JSON.parse(readFileSync(file, 'utf8')).servers[base];
  check('refresh token saved', Boolean(saved?.tokens?.refresh_token));

  state.access.clear(); // expire the access token server side
  const list = await rpc('tools/list');
  check('401 triggers refresh and retry', list.result?.tools?.[0]?.name === 'estimate' && state.refreshes === 1, `refreshes=${state.refreshes}`);
  check('session id kept across refresh', list.result?.sid === 'sess_1', String(list.result?.sid));
  check('one client registration', state.registrations === 1, String(state.registrations));

  state.access.clear(); // revoke everything: refresh fails, so the browser sign in runs again
  state.refresh.clear();
  const again = await rpc('tools/list');
  check('revoked refresh falls back to browser sign in', again.result?.tools?.[0]?.name === 'estimate', JSON.stringify(again.error || ''));
  check('redirect port and client reused', state.registrations === 1, `registrations=${state.registrations}`);
} catch (err) {
  check('oauth mock session', false, err.message);
  console.log(stderr);
} finally {
  child.stdin.end();
  await new Promise((r) => child.once('exit', r));
  server.close();
  rmSync(work, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);

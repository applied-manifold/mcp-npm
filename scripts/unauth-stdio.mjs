#!/usr/bin/env node
// Unauthenticated stdio: initialize and tools/list must succeed with no key and no TTY.
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'src', 'index.js');
const EXPECTED = ['discover', 'add_input', 'estimate', 'submit', 'get_job', 'cancel_job'];

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
}

function rpc(child, id, method, params) {
  return new Promise((resolveReq, reject) => {
    const onData = (chunk) => {
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
          continue;
        }
        if (msg.id === id) {
          child.stdout.off('data', onData);
          resolveReq(msg);
          return;
        }
      }
    };
    let buf = '';
    child.stdout.on('data', onData);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => {
      child.stdout.off('data', onData);
      reject(new Error(`timeout waiting for ${method}`));
    }, 8000);
  });
}

const env = { ...process.env };
delete env.SPATIAL_API_KEY;
delete env.SPATIAL_COMPILER_API_KEY;
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
delete env.BROWSER;

const child = spawn(process.execPath, [entry], {
  env,
  stdio: ['pipe', 'pipe', 'pipe'],
});
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
let stderr = '';
child.stderr.on('data', (d) => (stderr += d));
const exitPromise = new Promise((res) => child.once('exit', (code) => res(code)));

try {
  const init = await rpc(child, 1, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'unauth-stdio-test', version: '0.0.0' },
  });
  check('initialize succeeds', !init.error, init.error ? JSON.stringify(init.error) : '');
  const info = init.result || {};
  check('initialize returns serverInfo.version 0.1.9', info.serverInfo?.version === '0.1.9', info.serverInfo?.version || '');
  check('initialize returns instructions', typeof info.instructions === 'string' && info.instructions.includes('console.appliedmanifold.com'));
  check('instructions do not use the deep sign-in URL', !String(info.instructions || '').includes('sign-in?next='));

  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const listed = await rpc(child, 2, 'tools/list', {});
  const tools = listed.result?.tools || [];
  const names = tools.map((t) => t.name);
  check('tools/list returns the six core tools', JSON.stringify(names) === JSON.stringify(EXPECTED), names.join(','));
  for (const t of tools) {
    check(`${t.name} has title and annotations.title`, t.title && t.annotations?.title === t.title, t.title || 'missing');
    const desc = String(t.description || '').toLowerCase();
    for (const banned of ['show the user', 'ask before', 'never accept', 'recover it with']) {
      check(`${t.name} description has no "${banned}"`, !desc.includes(banned));
    }
  }

  const call = await rpc(child, 3, 'tools/call', { name: 'discover', arguments: {} });
  const isErr = call.result?.isError === true || Boolean(call.error);
  const text = JSON.stringify(call.result || call.error || '');
  check('tools/call without a key is an error', isErr);
  check('tools/call points at the console', text.includes('console.appliedmanifold.com'));
  check('tools/call does not use the deep sign-in URL', !text.includes('sign-in?next='));

  child.stdin.end();
  const code = await Promise.race([
    exitPromise,
    new Promise((res) => setTimeout(() => res('timeout'), 5000)),
  ]);
  check('server stays up until stdin closes', code === 0, `exit=${code}`);
} catch (err) {
  check(err.message, false);
  child.kill('SIGTERM');
}

check('stderr has no sign-in?next deep link', !stderr.includes('sign-in?next='));
check('process did not exit 1 before initialize', !stderr.includes('this process cannot open a browser') || failures === 0);

if (failures) {
  process.stderr.write(`\nstderr:\n${stderr}\n`);
}
process.exit(failures ? 1 : 0);

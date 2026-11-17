import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { HOMEPAGE, KEY_URL, SCOPES, VERSION, log } from './config.js';

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

export function configDir() {
  if (process.env.XDG_CONFIG_HOME) return join(process.env.XDG_CONFIG_HOME, 'spatial-compiler');
  if (process.platform === 'win32' && process.env.APPDATA) return join(process.env.APPDATA, 'spatial-compiler');
  return join(homedir(), '.config', 'spatial-compiler');
}

export function storePath() {
  return join(configDir(), 'mcp-oauth.json');
}

function readStore() {
  try {
    const data = JSON.parse(readFileSync(storePath(), 'utf8'));
    if (data && typeof data === 'object' && data.servers) return data;
  } catch {
    // Missing or unreadable file: start fresh.
  }
  return { version: 1, servers: {} };
}

function writeStore(data) {
  const dir = configDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = storePath();
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

/** Saved OAuth state for one MCP server URL, persisted under the XDG config dir. */
class Entry {
  constructor(serverUrl) {
    this.serverUrl = serverUrl;
  }
  get() {
    return readStore().servers[this.serverUrl] || {};
  }
  update(patch) {
    const data = readStore();
    const next = { ...(data.servers[this.serverUrl] || {}), ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    data.servers[this.serverUrl] = next;
    writeStore(data);
  }
  remove() {
    const data = readStore();
    if (!data.servers[this.serverUrl]) return false;
    delete data.servers[this.serverUrl];
    writeStore(data);
    return true;
  }
}

export function hasSavedTokens(serverUrl) {
  return Boolean(new Entry(serverUrl).get().tokens?.access_token);
}

export function forget(serverUrl) {
  return new Entry(serverUrl).remove();
}

/**
 * OAuthClientProvider for the SDK. Tokens and the dynamic client registration
 * are stored on disk. Interactive sign in only happens inside `signIn()`, which
 * owns the loopback callback server; a redirect requested anywhere else just
 * makes the SDK throw UnauthorizedError so the caller can run `signIn()`.
 */
export class FileOAuthProvider {
  constructor(serverUrl) {
    this.entry = new Entry(serverUrl);
    this._redirectUrl = this.entry.get().redirectUri;
    this._state = undefined;
    this._onRedirect = undefined;
  }

  get redirectUrl() {
    return this._redirectUrl || 'http://127.0.0.1/callback';
  }

  get clientMetadata() {
    return {
      client_name: 'Spatial Compiler MCP (local connector)',
      client_uri: HOMEPAGE,
      software_id: '@spatial-compiler/mcp',
      software_version: VERSION,
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: SCOPES,
    };
  }

  state() {
    this._state = randomBytes(16).toString('base64url');
    return this._state;
  }

  clientInformation() {
    return this.entry.get().client;
  }

  saveClientInformation(client) {
    this.entry.update({ client, redirectUri: this._redirectUrl });
  }

  tokens() {
    return this.entry.get().tokens;
  }

  saveTokens(tokens) {
    this.entry.update({ tokens, savedAt: new Date().toISOString() });
  }

  saveCodeVerifier(codeVerifier) {
    this.entry.update({ codeVerifier });
  }

  codeVerifier() {
    const value = this.entry.get().codeVerifier;
    if (!value) throw new Error('No PKCE code verifier saved');
    return value;
  }

  discoveryState() {
    return this.entry.get().discovery;
  }

  saveDiscoveryState(discovery) {
    this.entry.update({ discovery });
  }

  invalidateCredentials(scope) {
    const clear = {
      all: { client: undefined, tokens: undefined, codeVerifier: undefined, discovery: undefined, redirectUri: undefined },
      client: { client: undefined, redirectUri: undefined },
      tokens: { tokens: undefined },
      verifier: { codeVerifier: undefined },
      discovery: { discovery: undefined },
    }[scope];
    if (clear) this.entry.update(clear);
  }

  async redirectToAuthorization(url) {
    if (this._onRedirect) await this._onRedirect(url);
  }
}

/** True when a browser can plausibly be opened on this machine. */
export function canOpenBrowser() {
  if (process.env.CI) return false;
  if (process.env.BROWSER) return true;
  if (process.platform === 'darwin' || process.platform === 'win32') {
    return !(process.env.SSH_CONNECTION || process.env.SSH_TTY);
  }
  if (process.env.WSL_DISTRO_NAME) return true;
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

/** True when nobody could complete a browser sign in: no browser and no terminal to show a URL. */
export function clearlyNonInteractive() {
  return !canOpenBrowser() && !process.stderr.isTTY;
}

export function nonInteractiveMessage() {
  return (
    'No API key set and no saved sign in, and this process cannot open a browser.\n' +
    `Set SPATIAL_API_KEY (get a key at ${KEY_URL})\n` +
    'or run `npx -y @spatial-compiler/mcp login` once in a terminal to sign in.'
  );
}

function openBrowser(url) {
  let cmd;
  let args;
  if (process.env.BROWSER) {
    cmd = process.env.BROWSER;
    args = [url];
  } else if (process.platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    cmd = 'rundll32';
    args = ['url.dll,FileProtocolHandler', url];
  } else if (process.env.WSL_DISTRO_NAME) {
    cmd = 'cmd.exe';
    args = ['/c', 'start', '""', url.replace(/&/g, '^&')];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => log('Could not open a browser. Open the URL above to continue.'));
    child.unref();
  } catch {
    log('Could not open a browser. Open the URL above to continue.');
  }
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server.address().port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

const page = (title, body) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">` +
  `<h1 style="font-size:1.25rem">${title}</h1><p>${body}</p></body>`;

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Run the OAuth 2.1 authorization code + PKCE flow against the hosted
 * authorization server, with a loopback callback on 127.0.0.1.
 * Resolves once tokens are saved.
 */
export async function signIn(serverUrl, provider = new FileOAuthProvider(serverUrl)) {
  let settle;
  const callback = new Promise((resolve, reject) => (settle = { resolve, reject }));

  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname !== '/callback') {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (error) {
      const detail = url.searchParams.get('error_description') || error;
      res.writeHead(400, { 'content-type': 'text/html' }).end(page('Sign in failed', escapeHtml(detail)));
      settle.reject(new Error(`Authorization failed: ${detail}`));
      return;
    }
    if (!code || !state || state !== provider._state) {
      res.writeHead(400, { 'content-type': 'text/html' }).end(page('Sign in failed', 'Invalid or stale callback. Try again.'));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end(
      page('Signed in to Spatial Compiler', 'You can close this tab and go back to your editor.'),
    );
    settle.resolve(code);
  });
  server.keepAliveTimeout = 1000;

  const saved = provider.entry.get();
  const savedPort = saved.redirectUri ? Number(new URL(saved.redirectUri).port) : 0;
  let port;
  try {
    port = await listen(server, savedPort || 0);
  } catch {
    port = await listen(server, 0);
  }
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  if (saved.client && saved.redirectUri !== redirectUri) {
    // The registered redirect URI no longer matches; register a fresh client.
    provider.invalidateCredentials('client');
  }
  provider._redirectUrl = redirectUri;

  provider._onRedirect = (authorizationUrl) => {
    log('Sign in required. Opening your browser to sign in to Spatial Compiler:');
    log(authorizationUrl.toString());
    if (canOpenBrowser()) openBrowser(authorizationUrl.toString());
    else log('Open that URL in a browser on this machine to continue.');
  };

  const timer = setTimeout(() => settle.reject(new Error('Timed out waiting for browser sign in')), LOGIN_TIMEOUT_MS);
  timer.unref();
  try {
    const first = await auth(provider, { serverUrl, scope: SCOPES });
    if (first === 'AUTHORIZED') return;
    const code = await callback;
    const result = await auth(provider, { serverUrl, authorizationCode: code, scope: SCOPES });
    if (result !== 'AUTHORIZED') throw new Error('Authorization did not complete');
    provider.entry.update({ codeVerifier: undefined });
    log(`Signed in. Session saved to ${storePath()}`);
  } finally {
    clearTimeout(timer);
    provider._onRedirect = undefined;
    server.closeAllConnections?.();
    server.close();
  }
}

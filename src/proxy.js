import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { KEY_URL, USER_AGENT, log } from './config.js';
import { FileOAuthProvider, signIn } from './oauth.js';

const isRequest = (m) => m && typeof m === 'object' && 'method' in m && 'id' in m;

const POST_PREFIX = 'Error POSTing to endpoint: ';

/** Turn a transport error into one readable line, using the hosted error body when present. */
function describe(err, usingKey) {
  const raw = err?.message || String(err);
  const at = raw.indexOf(POST_PREFIX);
  if (!(err instanceof StreamableHTTPError) || at < 0) return raw;
  let text = raw.slice(at + POST_PREFIX.length);
  try {
    const body = JSON.parse(text).error || {};
    text = [`HTTP ${body.http_status || err.code}`, body.code, body.message, body.fix_hint && `Fix: ${body.fix_hint}`]
      .filter(Boolean)
      .join(' ');
  } catch {
    text = `HTTP ${err.code} ${text}`.trim();
  }
  if (err.code === 401 && usingKey) text += ` Check SPATIAL_API_KEY (get a key at ${KEY_URL}).`;
  return text;
}

const isPostError = (err) => err instanceof StreamableHTTPError && String(err.message).includes(POST_PREFIX);

function isAuthError(err) {
  return err instanceof UnauthorizedError || (err instanceof StreamableHTTPError && err.code === 401);
}

/**
 * Bridge a local stdio MCP stream to the hosted Streamable HTTP MCP server.
 * Every JSON-RPC message is forwarded unchanged in both directions.
 *
 * auth: { type: 'key', key } or { type: 'oauth' }
 */
export async function runProxy({ url, auth, signInFirst = false }) {
  const serverUrl = new URL(url);
  const local = new StdioServerTransport();
  const provider = auth.type === 'oauth' ? new FileOAuthProvider(url) : undefined;

  let remote;
  let protocolVersion;
  const initIds = new Set();
  let closing = false;

  const makeRemote = (sessionId) => {
    const headers = { 'User-Agent': USER_AGENT };
    if (auth.type === 'key') headers.Authorization = `Bearer ${auth.key}`;
    const transport = new StreamableHTTPClientTransport(serverUrl, {
      requestInit: { headers },
      authProvider: provider,
      sessionId,
    });
    if (protocolVersion) transport.setProtocolVersion(protocolVersion);
    transport.onmessage = (message) => {
      if ('id' in message && initIds.has(message.id) && !('method' in message)) {
        initIds.delete(message.id);
        if (message.result?.protocolVersion) {
          protocolVersion = message.result.protocolVersion;
          transport.setProtocolVersion(protocolVersion);
        }
      }
      local.send(message).catch((err) => log(`stdout write failed: ${err.message}`));
    };
    transport.onerror = (err) => {
      // POST failures are reported once by the request handler below.
      if (!closing && !isPostError(err) && !(err instanceof UnauthorizedError)) log(`remote stream: ${err.message}`);
    };
    return transport;
  };

  // Only one interactive sign in at a time; concurrent 401s wait on the same one.
  let signingIn;
  const reauthorize = () => {
    if (!signingIn) {
      signingIn = signIn(url, provider).finally(() => {
        signingIn = undefined;
      });
    }
    return signingIn;
  };

  // Messages after `initialize` wait for it so they carry the session id.
  let gate = Promise.resolve();

  const forward = async (message) => {
    try {
      await remote.send(message);
    } catch (err) {
      if (!provider || !isAuthError(err)) throw err;
      log('Session needs a new sign in.');
      await reauthorize();
      const sessionId = remote.sessionId;
      remote.onerror = undefined;
      await remote.close().catch(() => {});
      remote = makeRemote(sessionId);
      await remote.start();
      await remote.send(message);
    }
  };

  const handle = async (message) => {
    if (signingIn) await signingIn.catch(() => {});
    if (isRequest(message) && message.method === 'initialize') {
      initIds.add(message.id);
      const run = gate.then(() => forward(message));
      gate = run.catch(() => {});
      return run;
    }
    await gate;
    return forward(message);
  };

  local.onmessage = (message) => {
    handle(message).catch((err) => {
      const text = describe(err, auth.type === 'key');
      log(`request failed: ${text}`);
      if (isRequest(message)) {
        local
          .send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: `Spatial Compiler MCP: ${text}` } })
          .catch(() => {});
      }
    });
  };
  local.onerror = (err) => log(`stdin: ${err.message}`);

  const shutdown = async (code = 0) => {
    if (closing) return;
    closing = true;
    const timer = setTimeout(() => process.exit(code), 3000);
    timer.unref();
    try {
      if (remote?.sessionId) await remote.terminateSession();
    } catch {
      // Best effort.
    }
    await remote?.close().catch(() => {});
    process.exit(code);
  };

  process.stdin.on('end', () => shutdown(0));
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  remote = makeRemote();
  await remote.start();
  if (signInFirst) {
    // Accept stdio right away so the client sees a live process; messages wait for the sign in.
    reauthorize().catch((err) => {
      log(`Sign in failed: ${err.message}`);
      process.exit(1);
    });
  }
  await local.start();
}

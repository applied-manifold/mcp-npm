#!/usr/bin/env node
import { DEFAULT_MCP_URL, HOMEPAGE, KEY_URL, VERSION, apiKey, log, mcpUrl } from './config.js';

const USAGE = `spatial-compiler-mcp ${VERSION}

Local stdio MCP server for Applied Manifold's hosted Spatial Compiler MCP.
Every MCP message is forwarded to the hosted server. Nothing compiles on
your machine; jobs are billed the same as the hosted server.

Usage:
  npx -y @spatial-compiler/mcp            Start the stdio MCP server
  npx -y @spatial-compiler/mcp login      Sign in with your browser and save the session
  npx -y @spatial-compiler/mcp logout     Forget the saved sign in
  npx -y @spatial-compiler/mcp --help     Show this help
  npx -y @spatial-compiler/mcp --version  Print the version

Environment:
  SPATIAL_API_KEY            API key (spck_live_... or spck_test_...). Preferred.
  SPATIAL_COMPILER_API_KEY   Same, used when SPATIAL_API_KEY is not set.
  SPATIAL_COMPILER_MCP_URL   Hosted MCP URL, no trailing slash.
                             Default: ${DEFAULT_MCP_URL}

Auth:
  With an API key the server sends it as a Bearer token. Without a key it
  uses OAuth: on first run it opens a browser sign in against the hosted
  service and saves the session (refresh token included) under
  ~/.config/spatial-compiler/mcp-oauth.json (mode 0600).

Get an API key: ${KEY_URL}
More: ${HOMEPAGE}
`;

async function main(argv) {
  const args = argv.filter((a) => a !== '--');
  if (args.includes('--help') || args.includes('-h') || args[0] === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }
  if (args.includes('--version') || args.includes('-v')) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const url = mcpUrl();
  const command = args[0];

  if (command === 'login') {
    const { signIn, storePath } = await import('./oauth.js');
    await signIn(url);
    log(`You can now start the server without an API key. Session file: ${storePath()}`);
    return 0;
  }
  if (command === 'logout') {
    const { forget } = await import('./oauth.js');
    log(forget(url) ? 'Signed out.' : 'No saved sign in.');
    return 0;
  }
  if (command !== undefined) {
    process.stderr.write(`Unknown argument: ${command}\n\n${USAGE}`);
    return 2;
  }

  const { runProxy } = await import('./proxy.js');
  const key = apiKey();
  if (key) {
    await runProxy({ url, auth: { type: 'key', key: key.value } });
    return undefined;
  }

  const oauth = await import('./oauth.js');
  const signInFirst = !oauth.hasSavedTokens(url);
  if (signInFirst) {
    if (oauth.clearlyNonInteractive()) {
      process.stderr.write(`${oauth.nonInteractiveMessage()}\n`);
      return 1;
    }
    log('No API key set. Starting browser sign in.');
  }
  await runProxy({ url, auth: { type: 'oauth' }, signInFirst });
  return undefined;
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code !== undefined) process.exitCode = code;
  },
  (err) => {
    log(err?.message || String(err));
    process.exit(1);
  },
);

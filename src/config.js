import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const VERSION = pkg.version;
export const DEFAULT_MCP_URL = 'https://mcp.spatialcompiler.dev';
export const SCOPES = 'compile read';
export const KEY_URL = 'https://console.appliedmanifold.com/sign-in?next=/api-keys';
export const HOMEPAGE = 'https://appliedmanifold.com';
export const USER_AGENT = `spatial-compiler-mcp/${VERSION} node/${process.versions.node}`;

export function mcpUrl() {
  const raw = (process.env.SPATIAL_COMPILER_MCP_URL || '').trim();
  return (raw || DEFAULT_MCP_URL).replace(/\/+$/, '');
}

/** First non-empty key wins: SPATIAL_API_KEY, then SPATIAL_COMPILER_API_KEY. */
export function apiKey() {
  for (const name of ['SPATIAL_API_KEY', 'SPATIAL_COMPILER_API_KEY']) {
    const value = (process.env[name] || '').trim();
    if (value) return { name, value };
  }
  return undefined;
}

export function log(message) {
  process.stderr.write(`[spatial-compiler] ${message}\n`);
}

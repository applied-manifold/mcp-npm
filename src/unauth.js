import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { INSTRUCTIONS, TOOLS } from './catalog.js';
import { VERSION, log } from './config.js';

const CONSOLE = 'https://console.appliedmanifold.com';

export async function runUnauthCatalog() {
  log(`No API key set. Listing tools only. Get a free key at ${CONSOLE} and set SPATIAL_API_KEY to compile, estimate, or inspect jobs.`);
  const server = new Server({ name: 'spatial-compiler', title: 'Spatial Compiler', version: VERSION }, {
    capabilities: { tools: {} },
    instructions: INSTRUCTIONS,
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => ({
    isError: true,
    content: [
      {
        type: 'text',
        text:
          `${request.params.name} needs an API key. Get a free key at ${CONSOLE}, ` +
          'set SPATIAL_API_KEY, and restart this server. Or run `npx -y @applied-manifold/spatial-compiler login` in a terminal once.',
      },
    ],
  }));
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

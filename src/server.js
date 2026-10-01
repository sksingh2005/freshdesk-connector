// MCP server over stdio. Registers tools from tools.js. All logging goes to stderr
// so stdout stays clean for MCP framing. Never print() here.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TOOLS } from './tools.js';

const server = new McpServer({ name: 'freshdesk-connector', version: '0.1.0' });

for (const tool of TOOLS) {
  server.registerTool(tool.name, { description: tool.description, inputSchema: tool.schema }, async (args) => tool.handler(args ?? {}));
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[freshdesk-connector] MCP server running on stdio with tools: list_tickets, get_ticket, search_tickets');
}

main().catch((err) => {
  console.error(`[freshdesk-connector] fatal: ${err?.message ?? err}`);
  process.exit(1);
});

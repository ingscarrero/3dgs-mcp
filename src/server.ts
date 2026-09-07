/**
 * MCP server factory. Kept separate from the stdio bootstrap in `index.ts`
 * so it can be exercised end-to-end in tests over an in-memory transport.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Config } from './config.js';
import { TOOLS, defaultBrowserOpener, handleToolCall, type ToolDeps } from './tools.js';

export const SERVER_NAME = '3dgs-studio';
export const SERVER_VERSION = '0.2.0';

export function createServer(
  config: Config,
  deps: ToolDeps = { openBrowser: defaultBrowserOpener },
): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    handleToolCall(request.params.name, request.params.arguments, config, deps),
  );

  return server;
}

#!/usr/bin/env node
/**
 * 3DGS Studio MCP Server — stdio entry point.
 *
 * Exposes the 3DGS pipeline as tools Claude can call natively:
 *   list_projects, get_project, create_project, start_training,
 *   stop_training, get_training_status, list_splats, open_studio.
 *
 * All logging goes to stderr; stdout is reserved for the MCP protocol.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createServer, SERVER_NAME, SERVER_VERSION } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const server = createServer(config);
  await server.connect(new StdioServerTransport());
  console.error(
    `[3dgs-mcp] ${SERVER_NAME} v${SERVER_VERSION} started on stdio ` +
      `(studio=${config.studioUrl}, projects=${config.projectsRoot}, ` +
      `serviceKey=${config.serviceKey ? 'set' : 'unset'}, container=${config.containerMode})`,
  );
}

main().catch((err: unknown) => {
  console.error('[3dgs-mcp] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});

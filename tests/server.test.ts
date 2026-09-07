import { readFileSync } from 'fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.js';
import { SERVER_NAME, SERVER_VERSION, createServer } from '../src/server.js';
import { TOOLS } from '../src/tools.js';

const config: Config = {
  projectsRoot: '/data/projects',
  studioUrl: 'http://studio.test/3dgs-studio',
  serviceKey: '',
  containerMode: true,
  requestTimeoutMs: 1000,
};

describe('server identity', () => {
  it('reports the same version as package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(SERVER_VERSION).toBe(pkg.version);
  });
});

describe('createServer (in-memory MCP round trip)', () => {
  let client: Client;
  const openBrowser = vi.fn<(url: string) => void>();

  beforeEach(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer(config, { openBrowser });
    await server.connect(serverTransport);
    client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
  });

  it('advertises the server identity and the tool catalogue', async () => {
    expect(client.getServerVersion()).toEqual({ name: SERVER_NAME, version: SERVER_VERSION });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
  });

  it('routes tools/call through the dispatcher', async () => {
    const result = await client.callTool({ name: 'open_studio', arguments: { path: '/?tab=chat' } });
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([
      { type: 'text', text: 'Studio is available at: http://studio.test/3dgs-studio/?tab=chat' },
    ]);
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('returns validation failures as isError results, not protocol errors', async () => {
    const result = await client.callTool({ name: 'open_studio', arguments: { path: '/$(id)' } });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toMatch(/Invalid arguments/);
  });
});

import { spawn } from 'child_process';
import fs from 'fs';
import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.js';
import { TOOLS, defaultBrowserOpener, handleToolCall, type ToolResult } from '../src/tools.js';
import { installFakeFs, projectTree } from './helpers/fakeFs.js';

vi.mock('fs');
vi.mock('child_process');

const ROOT = '/data/projects';
const PROJECT_ID = '3f2a9c1e-6b7d-4e8f-9a0b-1c2d3e4f5a6b';

const baseConfig: Config = {
  projectsRoot: ROOT,
  studioUrl: 'http://studio.test/3dgs-studio',
  serviceKey: 'secret',
  containerMode: false,
  requestTimeoutMs: 1000,
};

const fetchMock = vi.fn<typeof fetch>();
const openBrowser = vi.fn<(url: string) => void>();

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function parse(result: ToolResult): unknown {
  return JSON.parse(result.content[0].text);
}

function call(name: string, args?: unknown, config: Config = baseConfig): Promise<ToolResult> {
  return handleToolCall(name, args, config, { openBrowser });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('TOOLS', () => {
  it('exposes exactly the eight documented tools with object schemas', () => {
    expect(TOOLS.map((t) => t.name)).toEqual([
      'list_projects',
      'get_project',
      'create_project',
      'start_training',
      'stop_training',
      'get_training_status',
      'list_splats',
      'open_studio',
    ]);
    for (const tool of TOOLS) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.description).toBeTruthy();
    }
  });
});

describe('dispatcher', () => {
  it('returns an error result for unknown tools', async () => {
    const result = await call('nope');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Unknown tool: nope/);
  });

  it('returns an error result when arguments are not an object', async () => {
    const result = await call('get_project', 'bad');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/must be an object/);
  });

  it('converts unexpected exceptions into error results and logs them', async () => {
    installFakeFs({});
    vi.mocked(fs.readdirSync).mockImplementation(() => {
      throw new Error('EACCES');
    });
    const result = await call('list_projects');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/EACCES/);
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/list_projects failed/));
  });

  it('converts non-Error throwables', async () => {
    installFakeFs({});
    vi.mocked(fs.readdirSync).mockImplementation(() => {
      throw 'weird';
    });
    const result = await call('list_projects');
    expect(result.content[0].text).toMatch(/weird/);
  });
});

describe('list_projects', () => {
  it('returns a summary of every readable project', async () => {
    installFakeFs(
      projectTree(ROOT, [
        {
          id: 'b',
          meta: { id: 'b', name: 'B', status: 'idle', imageCount: 3, secretField: 'hidden' },
        },
        { id: 'a', meta: { id: 'a', name: 'A', status: 'completed', imageCount: 10 } },
        { id: 'broken', meta: '{' },
        { id: 'empty' },
      ]),
    );
    const result = await call('list_projects');
    expect(result.isError).toBeUndefined();
    expect(parse(result)).toEqual({
      count: 2,
      projects: [
        { id: 'a', name: 'A', status: 'completed', imageCount: 10 },
        { id: 'b', name: 'B', status: 'idle', imageCount: 3 },
      ],
    });
  });

  it('returns an empty list for an empty root', async () => {
    installFakeFs({});
    expect(parse(await call('list_projects'))).toEqual({ projects: [], count: 0 });
  });
});

describe('get_project', () => {
  it('returns meta and latest run', async () => {
    installFakeFs(
      projectTree(ROOT, [{ id: PROJECT_ID, meta: { id: PROJECT_ID, name: 'Room' }, run: { id: 'r1' } }]),
    );
    expect(parse(await call('get_project', { projectId: PROJECT_ID }))).toEqual({
      project: { id: PROJECT_ID, name: 'Room' },
      latestRun: { id: 'r1' },
    });
  });

  it('returns null run when none exists', async () => {
    installFakeFs(projectTree(ROOT, [{ id: PROJECT_ID, meta: { id: PROJECT_ID } }]));
    expect(parse(await call('get_project', { projectId: PROJECT_ID }))).toEqual({
      project: { id: PROJECT_ID },
      latestRun: null,
    });
  });

  it('reports a missing project as an error', async () => {
    installFakeFs(projectTree(ROOT, []));
    const result = await call('get_project', { projectId: 'nope' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not found/);
  });

  it('rejects path traversal before touching the filesystem', async () => {
    const files = installFakeFs(projectTree(ROOT, []));
    files.set('/etc/passwd', 'root:x');
    const result = await call('get_project', { projectId: '../../etc/passwd' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Invalid arguments for get_project/);
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it('requires projectId', async () => {
    const result = await call('get_project', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/projectId must be a string/);
  });
});

describe('create_project', () => {
  it('posts a validated body with trainingConfig and returns the studio reply', async () => {
    fetchMock.mockResolvedValue(mockResponse(201, { project: { id: 'new' } }));
    const result = await call('create_project', {
      name: '  Kitchen ',
      description: 'A room',
      method: 'opensplat',
      maxSteps: 500,
      tags: ['a', ' b '],
    });
    expect(result.isError).toBeUndefined();
    expect(parse(result)).toEqual({ project: { id: 'new' } });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://studio.test/3dgs-studio/api/projects');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      name: 'Kitchen',
      description: 'A room',
      tags: ['a', 'b'],
      trainingConfig: { method: 'opensplat', maxSteps: 500 },
    });
    expect((init?.headers as Record<string, string>)['x-service-key']).toBe('secret');
  });

  it('applies defaults', async () => {
    fetchMock.mockResolvedValue(mockResponse(201, { project: {} }));
    await call('create_project', { name: 'X' });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      name: 'X',
      tags: [],
      trainingConfig: { method: 'splatfacto', maxSteps: 30000 },
    });
  });

  it.each([
    [{}, /name must be a string/],
    [{ name: '' }, /name is required/],
    [{ name: 'X', method: 'evil' }, /method must be one of/],
    [{ name: 'X', maxSteps: -5 }, /maxSteps/],
    [{ name: 'X', tags: 'a' }, /tags must be an array/],
    [{ name: 'X', description: 42 }, /description must be a string/],
  ])('rejects %j without calling the studio', async (args, pattern) => {
    const result = await call('create_project', args);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(pattern);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces studio errors as error results', async () => {
    fetchMock.mockResolvedValue(mockResponse(400, { error: 'name is required' }));
    const result = await call('create_project', { name: 'X' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/failed \(400\): name is required/);
  });

  it('surfaces an unreachable studio', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await call('create_project', { name: 'X' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/unreachable/);
  });
});

describe('start_training', () => {
  it('posts validated arguments and returns runId', async () => {
    fetchMock.mockResolvedValue(mockResponse(202, { runId: 'r1', run: { status: 'running' } }));
    const result = await call('start_training', {
      projectId: PROJECT_ID,
      method: 'nerfacto',
      maxSteps: 100,
      skipProcessing: true,
    });
    expect(parse(result)).toEqual({ runId: 'r1', run: { status: 'running' } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://studio.test/3dgs-studio/api/training/start');
    expect(JSON.parse(String(init?.body))).toEqual({
      projectId: PROJECT_ID,
      method: 'nerfacto',
      maxSteps: 100,
      skipProcessing: true,
    });
  });

  it('applies defaults', async () => {
    fetchMock.mockResolvedValue(mockResponse(202, {}));
    await call('start_training', { projectId: PROJECT_ID });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      projectId: PROJECT_ID,
      method: 'splatfacto',
      maxSteps: 30000,
      skipProcessing: false,
    });
  });

  it.each([
    [{}, /projectId must be a string/],
    [{ projectId: 'a/b' }, /projectId "a\/b" is invalid/],
    [{ projectId: PROJECT_ID, skipProcessing: 'yes' }, /skipProcessing must be a boolean/],
    [{ projectId: PROJECT_ID, method: 'x' }, /method must be one of/],
  ])('rejects %j', async (args, pattern) => {
    const result = await call('start_training', args);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(pattern);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a 409 conflict clearly', async () => {
    fetchMock.mockResolvedValue(mockResponse(409, { error: 'training already running' }));
    const result = await call('start_training', { projectId: PROJECT_ID });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/409.*training already running.*conflicting run/);
  });
});

describe('stop_training', () => {
  it('sends DELETE with the runId', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, { ok: true }));
    expect(parse(await call('stop_training', { runId: 'run-1' }))).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://studio.test/3dgs-studio/api/training/start');
    expect(init?.method).toBe('DELETE');
    expect(JSON.parse(String(init?.body))).toEqual({ runId: 'run-1' });
  });

  it('rejects malformed run ids', async () => {
    const result = await call('stop_training', { runId: 'r1; shutdown' });
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports 404 from the studio', async () => {
    fetchMock.mockResolvedValue(mockResponse(404, { error: 'not found' }));
    const result = await call('stop_training', { runId: 'r1' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/404/);
  });
});

describe('get_training_status', () => {
  it('trims logs and metrics to the recent window', async () => {
    const logs = Array.from({ length: 30 }, (_, i) => ({ message: `line ${i}` }));
    const metrics = Array.from({ length: 15 }, (_, i) => ({ step: i, psnr: 20 + i }));
    installFakeFs(
      projectTree(ROOT, [
        {
          id: PROJECT_ID,
          meta: {},
          run: {
            id: 'r1',
            status: 'running',
            startedAt: 't0',
            targetSteps: 100,
            logs,
            metrics,
          },
        },
      ]),
    );
    const body = parse(await call('get_training_status', { projectId: PROJECT_ID })) as {
      runId: string;
      status: string;
      recentLogs: string[];
      recentMetrics: Array<{ step: number }>;
      targetSteps: number;
    };
    expect(body.runId).toBe('r1');
    expect(body.status).toBe('running');
    expect(body.targetSteps).toBe(100);
    expect(body.recentLogs).toHaveLength(20);
    expect(body.recentLogs[0]).toBe('line 10');
    expect(body.recentLogs.at(-1)).toBe('line 29');
    expect(body.recentMetrics).toHaveLength(10);
    expect(body.recentMetrics[0].step).toBe(5);
  });

  it('tolerates run files without logs/metrics arrays or with odd entries', async () => {
    installFakeFs(
      projectTree(ROOT, [
        { id: PROJECT_ID, meta: {}, run: { status: 'failed', error: 'boom', logs: ['raw', { x: 1 }] } },
      ]),
    );
    expect(parse(await call('get_training_status', { projectId: PROJECT_ID }))).toMatchObject({
      status: 'failed',
      error: 'boom',
      recentLogs: ['raw', '[object Object]'],
      recentMetrics: [],
    });
  });

  it('reports a missing run', async () => {
    installFakeFs(projectTree(ROOT, [{ id: PROJECT_ID, meta: {} }]));
    const result = await call('get_training_status', { projectId: PROJECT_ID });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/No training run found/);
  });

  it('validates projectId', async () => {
    const result = await call('get_training_status', { projectId: '../x' });
    expect(result.isError).toBe(true);
  });
});

describe('list_splats', () => {
  it('lists projects that have .splat outputs', async () => {
    installFakeFs(
      projectTree(ROOT, [
        { id: 'a', meta: { name: 'A' }, outputs: ['msplat/scene.splat'] },
        { id: 'b', meta: { name: 'B' }, outputs: ['scene.ply'] },
        { id: 'c', meta: { name: 'C' } },
        { id: 'd', outputs: ['x.splat'] },
      ]),
    );
    expect(parse(await call('list_splats'))).toEqual({
      count: 1,
      splats: [{ projectId: 'a', name: 'A', splats: [`${ROOT}/a/output/msplat/scene.splat`] }],
    });
  });
});

describe('open_studio', () => {
  it('opens the default route via the injected opener', async () => {
    const result = await call('open_studio', {});
    expect(result.isError).toBeUndefined();
    expect(openBrowser).toHaveBeenCalledWith('http://studio.test/3dgs-studio/');
    expect(result.content[0].text).toBe('Opened http://studio.test/3dgs-studio/ in browser.');
  });

  it('opens a validated relative route', async () => {
    await call('open_studio', { path: '/?tab=chat' });
    expect(openBrowser).toHaveBeenCalledWith('http://studio.test/3dgs-studio/?tab=chat');
  });

  it('returns the URL instead of launching in container mode', async () => {
    const result = await call('open_studio', { path: '/x' }, { ...baseConfig, containerMode: true });
    expect(openBrowser).not.toHaveBeenCalled();
    expect(result.content[0].text).toBe('Studio is available at: http://studio.test/3dgs-studio/x');
  });

  it.each([
    '/" ; touch /tmp/pwned ; "',
    '/$(reboot)',
    '/`id`',
    'http://evil.example',
    '//evil.example',
    '/../admin',
    '/a b',
  ])('rejects injection attempt %j without launching anything', async (p) => {
    const result = await call('open_studio', { path: p });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Invalid arguments for open_studio/);
    expect(openBrowser).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('fails cleanly when STUDIO_URL is not a URL', async () => {
    const result = await call('open_studio', {}, { ...baseConfig, studioUrl: 'nonsense' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/STUDIO_URL/);
  });
});

describe('defaultBrowserOpener', () => {
  function fakeChild(): ChildProcess & EventEmitter {
    const child = new EventEmitter() as ChildProcess & EventEmitter;
    child.unref = vi.fn() as unknown as ChildProcess['unref'];
    return child;
  }

  it('spawns the platform opener without a shell and detaches', () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child);
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');

    defaultBrowserOpener('http://studio.test/3dgs-studio/?tab=chat');

    expect(spawn).toHaveBeenCalledWith('open', ['http://studio.test/3dgs-studio/?tab=chat'], {
      detached: true,
      stdio: 'ignore',
    });
    const options = vi.mocked(spawn).mock.calls[0][2] as Record<string, unknown>;
    expect(options.shell).toBeUndefined();
    expect(child.unref).toHaveBeenCalled();
    platform.mockRestore();
  });

  it.each([
    ['linux', 'xdg-open', ['http://x/']],
    ['win32', 'rundll32', ['url.dll,FileProtocolHandler', 'http://x/']],
  ])('uses the right launcher on %s', (platform, cmd, args) => {
    vi.mocked(spawn).mockReturnValue(fakeChild());
    const spy = vi.spyOn(process, 'platform', 'get').mockReturnValue(platform as NodeJS.Platform);
    defaultBrowserOpener('http://x/');
    expect(spawn).toHaveBeenCalledWith(cmd, args, expect.anything());
    spy.mockRestore();
  });

  it('logs launcher errors instead of crashing', () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child);
    defaultBrowserOpener('http://x/');
    child.emit('error', new Error('ENOENT'));
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/could not launch browser.*ENOENT/));
  });
});


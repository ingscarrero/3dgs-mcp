import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioError, serviceHeaders, studioDelete, studioPost, studioRequest } from '../src/studio.js';

const config = { studioUrl: 'http://studio.test/3dgs-studio', serviceKey: 'secret', requestTimeoutMs: 1000 };

function mockResponse(status: number, body: string, ok = status >= 200 && status < 300): Response {
  return { ok, status, text: async () => body } as unknown as Response;
}

describe('serviceHeaders', () => {
  it('adds x-service-key only when a key is configured', () => {
    expect(serviceHeaders({ serviceKey: 'abc' })).toEqual({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-service-key': 'abc',
    });
    expect(serviceHeaders({ serviceKey: '' })).not.toHaveProperty('x-service-key');
  });
});

describe('studioRequest', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('sends JSON with the service key and returns the parsed body', async () => {
    fetchMock.mockResolvedValue(mockResponse(201, '{"project":{"id":"p1"}}'));
    const result = await studioPost(config, '/api/projects', { name: 'x' });
    expect(result).toEqual({ project: { id: 'p1' } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://studio.test/3dgs-studio/api/projects');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"name":"x"}');
    expect((init?.headers as Record<string, string>)['x-service-key']).toBe('secret');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('supports DELETE with a body', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, '{"ok":true}'));
    await expect(studioDelete(config, '/api/training/start', { runId: 'r1' })).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE');
  });

  it('omits the body for GET', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, '{"projects":[]}'));
    await studioRequest(config, 'GET', '/api/projects');
    expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined();
  });

  it('returns null for an empty 2xx body', async () => {
    fetchMock.mockResolvedValue(mockResponse(204, ''));
    await expect(studioRequest(config, 'GET', '/x')).resolves.toBeNull();
  });

  it('wraps network failures as StudioError with a helpful hint', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const err = await studioPost(config, '/api/projects', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StudioError);
    expect((err as StudioError).message).toMatch(/unreachable/);
    expect((err as StudioError).message).toMatch(/ECONNREFUSED/);
    expect((err as StudioError).status).toBeUndefined();
  });

  it('wraps non-Error rejections', async () => {
    fetchMock.mockRejectedValue('boom');
    await expect(studioPost(config, '/x', {})).rejects.toThrow(/boom/);
  });

  it.each([
    [400, '{"error":"projectId required"}', /projectId required/],
    [401, '{"error":"Unauthorized"}', /STUDIO_SERVICE_KEY/],
    [403, '{"error":"nope"}', /not allowed/],
    [404, '{"error":"not found"}', /does not exist/],
    [409, '{"error":"training already running","run":{}}', /conflicting run/],
    [503, '{"error":"Trainer daemon unreachable: x"}', /trainer daemon/],
    [500, 'null', /HTTP 500/],
  ])('surfaces HTTP %i as StudioError', async (status, body, pattern) => {
    fetchMock.mockResolvedValue(mockResponse(status, body));
    const err = await studioPost(config, '/api/training/start', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StudioError);
    expect((err as StudioError).status).toBe(status);
    expect((err as StudioError).message).toMatch(pattern);
    expect((err as StudioError).message).toMatch(new RegExp(`\\(${status}\\)`));
  });

  it('rejects non-JSON bodies even on 2xx', async () => {
    fetchMock.mockResolvedValue(mockResponse(200, '<html>login</html>'));
    const err = await studioPost(config, '/api/projects', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StudioError);
    expect((err as StudioError).message).toMatch(/non-JSON/);
    expect((err as StudioError).body).toBe('<html>login</html>');
  });

  it('rejects non-JSON error bodies with the status attached', async () => {
    fetchMock.mockResolvedValue(mockResponse(502, 'Bad Gateway'));
    const err = await studioPost(config, '/api/projects', {}).catch((e: unknown) => e);
    expect((err as StudioError).status).toBe(502);
    expect((err as StudioError).message).toMatch(/HTTP 502/);
  });
});

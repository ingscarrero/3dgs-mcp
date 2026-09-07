/**
 * Minimal HTTP client for the studio API (see docs/STUDIO_API.md).
 *
 * Every response is checked for `res.ok` and for a JSON body; failures are
 * surfaced as `StudioError` carrying the HTTP status and the studio's own
 * `error` message when it provided one.
 */
import type { Config } from './config.js';

export class StudioError extends Error {
  readonly status?: number;
  readonly body?: unknown;

  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = 'StudioError';
    this.status = status;
    this.body = body;
  }
}

export type StudioMethod = 'GET' | 'POST' | 'DELETE' | 'PATCH';
export type StudioConfig = Pick<Config, 'studioUrl' | 'serviceKey' | 'requestTimeoutMs'>;

export function serviceHeaders(config: Pick<Config, 'serviceKey'>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (config.serviceKey) headers['x-service-key'] = config.serviceKey;
  return headers;
}

function extractErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
    return (body as { error: string }).error;
  }
  return `HTTP ${status}`;
}

const STATUS_HINTS: Record<number, string> = {
  401: ' Check STUDIO_SERVICE_KEY.',
  403: ' The service key is not allowed to perform this action.',
  404: ' The resource does not exist.',
  409: ' A conflicting run already exists.',
  503: ' The studio could not reach its trainer daemon.',
};

/**
 * Send a JSON request to the studio and return the parsed JSON body.
 *
 * @throws StudioError when the studio is unreachable, times out, answers
 *         with a non-2xx status, or returns a body that is not JSON.
 */
export async function studioRequest(
  config: StudioConfig,
  method: StudioMethod,
  route: string,
  body?: unknown,
): Promise<unknown> {
  const url = `${config.studioUrl}${route}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: serviceHeaders(config),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new StudioError(
      `Studio unreachable at ${config.studioUrl} (${reason}). Is 3DGS Studio running?`,
    );
  }

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text.length === 0 ? null : JSON.parse(text);
  } catch {
    throw new StudioError(
      `Studio returned a non-JSON response (HTTP ${res.status}) for ${method} ${route}.`,
      res.status,
      text.slice(0, 200),
    );
  }

  if (!res.ok) {
    const message = extractErrorMessage(parsed, res.status);
    const hint = STATUS_HINTS[res.status] ?? '';
    throw new StudioError(
      `Studio ${method} ${route} failed (${res.status}): ${message}.${hint}`,
      res.status,
      parsed,
    );
  }

  return parsed;
}

export function studioPost(config: StudioConfig, route: string, body: unknown): Promise<unknown> {
  return studioRequest(config, 'POST', route, body);
}

export function studioDelete(config: StudioConfig, route: string, body: unknown): Promise<unknown> {
  return studioRequest(config, 'DELETE', route, body);
}

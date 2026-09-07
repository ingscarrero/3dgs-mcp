/**
 * Runtime configuration, resolved from environment variables.
 *
 * Every value is overridable; the defaults match the wrapper script
 * (`run-container.sh`) so the server works out of the box on the host
 * and inside a container.
 */
import os from 'os';
import path from 'path';

export interface Config {
  /** Directory that contains one sub-directory per project. */
  projectsRoot: string;
  /** Base URL of the studio, including any basePath (e.g. `/3dgs-studio`). */
  studioUrl: string;
  /** Shared secret sent as `x-service-key`; empty string disables the header. */
  serviceKey: string;
  /** When true, `open_studio` returns the URL instead of launching a browser. */
  containerMode: boolean;
  /** Per-request timeout for studio HTTP calls, in milliseconds. */
  requestTimeoutMs: number;
}

/** Default projects directory when `PROJECTS_ROOT` is not set. */
export const DEFAULT_PROJECTS_ROOT = path.join(
  os.homedir(),
  'Documents',
  'Claude',
  'Projects',
  '3DGS',
  'projects',
);

/** Default studio URL when `STUDIO_URL` is not set. */
export const DEFAULT_STUDIO_URL = 'http://localhost:3000';

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const timeout = Number(env.STUDIO_TIMEOUT_MS);
  return {
    projectsRoot: env.PROJECTS_ROOT?.trim() || DEFAULT_PROJECTS_ROOT,
    studioUrl: (env.STUDIO_URL?.trim() || DEFAULT_STUDIO_URL).replace(/\/+$/, ''),
    serviceKey: env.STUDIO_SERVICE_KEY ?? '',
    containerMode: env.CONTAINER_MODE === '1',
    requestTimeoutMs:
      Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_REQUEST_TIMEOUT_MS,
  };
}

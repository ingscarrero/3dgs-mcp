import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROJECTS_ROOT,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_STUDIO_URL,
  loadConfig,
} from '../src/config.js';

describe('loadConfig', () => {
  it('uses documented defaults when the environment is empty', () => {
    const config = loadConfig({});
    expect(config).toEqual({
      projectsRoot: DEFAULT_PROJECTS_ROOT,
      studioUrl: DEFAULT_STUDIO_URL,
      serviceKey: '',
      containerMode: false,
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    });
    expect(DEFAULT_PROJECTS_ROOT).toMatch(/Documents/);
  });

  it('honours overrides and strips trailing slashes from STUDIO_URL', () => {
    const config = loadConfig({
      PROJECTS_ROOT: ' /data/projects ',
      STUDIO_URL: 'http://host.containers.internal:3000/3dgs-studio///',
      STUDIO_SERVICE_KEY: 'k',
      CONTAINER_MODE: '1',
      STUDIO_TIMEOUT_MS: '5000',
    });
    expect(config).toEqual({
      projectsRoot: '/data/projects',
      studioUrl: 'http://host.containers.internal:3000/3dgs-studio',
      serviceKey: 'k',
      containerMode: true,
      requestTimeoutMs: 5000,
    });
  });

  it('treats blank values as unset and ignores bad timeouts', () => {
    const config = loadConfig({
      PROJECTS_ROOT: '   ',
      STUDIO_URL: '',
      CONTAINER_MODE: 'yes',
      STUDIO_TIMEOUT_MS: '-3',
    });
    expect(config.projectsRoot).toBe(DEFAULT_PROJECTS_ROOT);
    expect(config.studioUrl).toBe(DEFAULT_STUDIO_URL);
    expect(config.containerMode).toBe(false);
    expect(config.requestTimeoutMs).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
  });
});

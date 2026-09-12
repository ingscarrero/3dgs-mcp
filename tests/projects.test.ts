import fs from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureRoot, listProjectIds, listSplatFiles, readMeta, readRun } from '../src/projects.js';
import { installFakeFs, projectTree } from './helpers/fakeFs.js';

vi.mock('fs');

const ROOT = '/data/projects';

describe('projects (filesystem readers)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('ensureRoot creates the projects directory recursively', () => {
    installFakeFs({});
    ensureRoot(ROOT);
    expect(fs.mkdirSync).toHaveBeenCalledWith(ROOT, { recursive: true });
  });

  it('readMeta returns the parsed meta.json', () => {
    installFakeFs(projectTree(ROOT, [{ id: 'p1', meta: { id: 'p1', name: 'Room' } }]));
    expect(readMeta(ROOT, 'p1')).toEqual({ id: 'p1', name: 'Room' });
    expect(fs.readFileSync).toHaveBeenCalledWith(`${ROOT}/p1/meta.json`, 'utf8');
  });

  it('readMeta returns null for a missing project', () => {
    installFakeFs(projectTree(ROOT, []));
    expect(readMeta(ROOT, 'missing')).toBeNull();
  });

  it('readMeta returns null for malformed or non-object JSON', () => {
    installFakeFs(
      projectTree(ROOT, [
        { id: 'broken', meta: '{not json' },
        { id: 'array', meta: '[1,2]' },
        { id: 'scalar', meta: '"str"' },
      ]),
    );
    expect(readMeta(ROOT, 'broken')).toBeNull();
    expect(readMeta(ROOT, 'array')).toBeNull();
    expect(readMeta(ROOT, 'scalar')).toBeNull();
  });

  it('readRun reads run.json and returns null when absent', () => {
    installFakeFs(
      projectTree(ROOT, [
        { id: 'p1', meta: {}, run: { id: 'r1', status: 'running' } },
        { id: 'p2', meta: {} },
      ]),
    );
    expect(readRun(ROOT, 'p1')).toEqual({ id: 'r1', status: 'running' });
    expect(readRun(ROOT, 'p2')).toBeNull();
  });

  it('listProjectIds returns sorted directories only, creating the root first', () => {
    const files = installFakeFs(projectTree(ROOT, [{ id: 'zeta' }, { id: 'alpha' }]));
    files.set(`${ROOT}/stray.txt`, 'not a dir');
    expect(listProjectIds(ROOT)).toEqual(['alpha', 'zeta']);
    expect(fs.mkdirSync).toHaveBeenCalledWith(ROOT, { recursive: true });
  });

  it('listProjectIds skips entries that vanish between readdir and stat', () => {
    installFakeFs(projectTree(ROOT, [{ id: 'p1' }]));
    vi.mocked(fs.statSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(listProjectIds(ROOT)).toEqual([]);
  });

  it('listSplatFiles finds nested .splat files and ignores other outputs', () => {
    installFakeFs(
      projectTree(ROOT, [
        { id: 'p1', meta: {}, outputs: ['msplat/scene.splat', 'msplat/scene.ply', 'b.splat'] },
      ]),
    );
    expect(listSplatFiles(ROOT, 'p1')).toEqual(['p1/output/b.splat', 'p1/output/msplat/scene.splat']);
    expect(fs.readdirSync).toHaveBeenCalledWith(`${ROOT}/p1/output`, { recursive: true });
  });

  it('listSplatFiles returns [] when there is no output directory', () => {
    installFakeFs(projectTree(ROOT, [{ id: 'p1', meta: {} }]));
    expect(listSplatFiles(ROOT, 'p1')).toEqual([]);
  });
});

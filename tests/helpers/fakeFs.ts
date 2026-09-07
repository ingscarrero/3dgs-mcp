/**
 * In-memory implementation of the `fs` functions the server uses.
 *
 * Test files must call `vi.mock('fs')` themselves (vi.mock is hoisted per
 * file); this helper then installs behaviour on the automocked functions.
 *
 * Tree entries: absolute path → file contents (string) or `null` for a directory.
 */
import fs from 'fs';
import path from 'path';
import { vi } from 'vitest';

export type FakeTree = Record<string, string | null>;

function enoent(p: string): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(`ENOENT: no such file or directory, '${p}'`);
  err.code = 'ENOENT';
  return err;
}

export function installFakeFs(tree: FakeTree): Map<string, string | null> {
  const files = new Map<string, string | null>(Object.entries(tree));
  const norm = (p: fs.PathLike | number): string => {
    const normalized = path.normalize(String(p)).replace(/\/+$/, '');
    return normalized.length === 0 ? '/' : normalized;
  };

  vi.mocked(fs.mkdirSync).mockImplementation(((p: fs.PathLike) => {
    files.set(norm(p), null);
    return undefined;
  }) as typeof fs.mkdirSync);

  vi.mocked(fs.readFileSync).mockImplementation(((p: fs.PathLike | number) => {
    const value = files.get(norm(p));
    if (typeof value !== 'string') throw enoent(String(p));
    return value;
  }) as typeof fs.readFileSync);

  vi.mocked(fs.existsSync).mockImplementation(((p: fs.PathLike) =>
    files.has(norm(p))) as typeof fs.existsSync);

  vi.mocked(fs.statSync).mockImplementation(((p: fs.PathLike) => {
    const key = norm(p);
    if (!files.has(key)) throw enoent(String(p));
    return { isDirectory: () => files.get(key) === null } as fs.Stats;
  }) as typeof fs.statSync);

  vi.mocked(fs.readdirSync).mockImplementation(((
    p: fs.PathLike,
    options?: { recursive?: boolean } | string | null,
  ) => {
    const dir = norm(p);
    if (!files.has(dir)) throw enoent(String(p));
    const recursive = typeof options === 'object' && options !== null && options.recursive === true;
    const entries: string[] = [];
    for (const key of files.keys()) {
      if (key === dir || !key.startsWith(`${dir}/`)) continue;
      const rel = key.slice(dir.length + 1);
      if (recursive || !rel.includes('/')) entries.push(rel);
    }
    return entries.sort();
  }) as typeof fs.readdirSync);

  return files;
}

/** Build a tree with `<root>/<id>/meta.json` (+ optional run.json and output files). */
export function projectTree(
  root: string,
  projects: Array<{
    id: string;
    meta?: Record<string, unknown> | string;
    run?: Record<string, unknown> | string;
    outputs?: string[];
  }>,
): FakeTree {
  const tree: FakeTree = { [root]: null };
  for (const project of projects) {
    const dir = `${root}/${project.id}`;
    tree[dir] = null;
    if (project.meta !== undefined) {
      tree[`${dir}/meta.json`] =
        typeof project.meta === 'string' ? project.meta : JSON.stringify(project.meta);
    }
    if (project.run !== undefined) {
      tree[`${dir}/run.json`] =
        typeof project.run === 'string' ? project.run : JSON.stringify(project.run);
    }
    if (project.outputs) {
      tree[`${dir}/output`] = null;
      for (const rel of project.outputs) {
        const parts = rel.split('/');
        for (let i = 1; i < parts.length; i += 1) {
          tree[`${dir}/output/${parts.slice(0, i).join('/')}`] = null;
        }
        tree[`${dir}/output/${rel}`] = 'binary';
      }
    }
  }
  return tree;
}

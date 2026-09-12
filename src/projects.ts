/**
 * Read-only access to the on-disk project layout shared with the studio
 * (see docs/STUDIO_API.md, "On-disk metadata").
 *
 *   <PROJECTS_ROOT>/<projectId>/meta.json   — project record
 *   <PROJECTS_ROOT>/<projectId>/run.json    — latest training run
 *   <PROJECTS_ROOT>/<projectId>/output/**   — training outputs (.splat, .ply)
 */
import fs from 'fs';
import path from 'path';

export type ProjectMeta = Record<string, unknown>;
export type TrainingRun = Record<string, unknown>;

export function ensureRoot(projectsRoot: string): void {
  fs.mkdirSync(projectsRoot, { recursive: true });
}

function readJsonObject(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Read `<root>/<id>/meta.json`; `null` when missing or malformed. */
export function readMeta(projectsRoot: string, id: string): ProjectMeta | null {
  return readJsonObject(path.join(projectsRoot, id, 'meta.json'));
}

/** Read `<root>/<id>/run.json`; `null` when missing or malformed. */
export function readRun(projectsRoot: string, id: string): TrainingRun | null {
  return readJsonObject(path.join(projectsRoot, id, 'run.json'));
}

/** Sorted sub-directory names of the projects root (creating it if absent). */
export function listProjectIds(projectsRoot: string): string[] {
  ensureRoot(projectsRoot);
  return fs
    .readdirSync(projectsRoot)
    .filter((entry) => {
      try {
        return fs.statSync(path.join(projectsRoot, entry)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

/**
 * Every `.splat` file under `<root>/<id>/output`, sorted, as POSIX paths
 * relative to `PROJECTS_ROOT` (`<id>/output/...`). Absolute host paths are
 * deliberately not returned so the model never learns where the operator
 * keeps the projects directory.
 */
export function listSplatFiles(projectsRoot: string, id: string): string[] {
  const outputDir = path.join(projectsRoot, id, 'output');
  if (!fs.existsSync(outputDir)) return [];
  return fs
    .readdirSync(outputDir, { recursive: true })
    .map((entry) => String(entry))
    .filter((entry) => entry.endsWith('.splat'))
    .map((entry) => path.posix.join(id, 'output', ...entry.split(path.sep)))
    .sort();
}

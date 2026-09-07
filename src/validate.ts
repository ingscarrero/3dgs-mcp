/**
 * Input validation for tool arguments.
 *
 * Every argument that reaches the filesystem, the studio API, or a child
 * process passes through one of these functions first. They throw
 * `ValidationError`, which the tool dispatcher converts into an MCP error
 * result instead of crashing the server.
 */

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Identifiers are single path segments: letters, digits, `.`, `_`, `-`. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Control characters (C0 + DEL) are never allowed in single-line text fields. */
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

/** Multi-line text may contain tab, LF and CR but no other control characters. */
const CONTROL_CHARS_EXCEPT_WHITESPACE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

export const TRAINING_METHODS = [
  'splatfacto',
  'nerfacto',
  'instant-ngp',
  'opensplat',
  'msplat',
  'gaussian-splatting',
] as const;
export type TrainingMethod = (typeof TRAINING_METHODS)[number];

export const MAX_NAME_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 2_000;
export const MAX_TAGS = 50;
export const MAX_TAG_LENGTH = 64;
export const MAX_STEPS = 10_000_000;
export const MAX_PATH_LENGTH = 512;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function assertArgsObject(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!isPlainObject(value)) throw new ValidationError('Tool arguments must be an object.');
  return value;
}

/**
 * Validate a project or run identifier. Rejects anything that is not a
 * single safe path segment, so it can never escape `PROJECTS_ROOT`
 * or smuggle characters into a URL.
 */
export function validateId(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new ValidationError(`${label} must be a string.`);
  const id = value.trim();
  if (id.length === 0) throw new ValidationError(`${label} is required.`);
  if (!ID_PATTERN.test(id) || id.includes('..')) {
    throw new ValidationError(
      `${label} "${id}" is invalid: use letters, digits, ".", "_" or "-" only (max 128 chars).`,
    );
  }
  return id;
}

export function validateName(value: unknown): string {
  if (typeof value !== 'string') throw new ValidationError('name must be a string.');
  const name = value.trim();
  if (name.length === 0) throw new ValidationError('name is required.');
  if (name.length > MAX_NAME_LENGTH) {
    throw new ValidationError(`name must be at most ${MAX_NAME_LENGTH} characters.`);
  }
  if (CONTROL_CHARS.test(name)) {
    throw new ValidationError('name must not contain control characters.');
  }
  return name;
}

export function validateDescription(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new ValidationError('description must be a string.');
  if (value.length > MAX_DESCRIPTION_LENGTH) {
    throw new ValidationError(`description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`);
  }
  if (CONTROL_CHARS_EXCEPT_WHITESPACE.test(value)) {
    throw new ValidationError(
      'description must not contain control characters (tabs and newlines are allowed).',
    );
  }
  return value;
}

export function validateMethod(
  value: unknown,
  fallback: TrainingMethod = 'splatfacto',
): TrainingMethod {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || !(TRAINING_METHODS as readonly string[]).includes(value)) {
    throw new ValidationError(`method must be one of: ${TRAINING_METHODS.join(', ')}.`);
  }
  return value as TrainingMethod;
}

export function validateMaxSteps(value: unknown, fallback = 30_000): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_STEPS) {
    throw new ValidationError(`maxSteps must be an integer between 1 and ${MAX_STEPS}.`);
  }
  return value;
}

export function validateBoolean(value: unknown, label: string, fallback = false): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new ValidationError(`${label} must be a boolean.`);
  return value;
}

export function validateTags(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError('tags must be an array of strings.');
  if (value.length > MAX_TAGS) {
    throw new ValidationError(`tags must have at most ${MAX_TAGS} entries.`);
  }
  return value.map((tag) => {
    if (
      typeof tag !== 'string' ||
      tag.trim().length === 0 ||
      tag.length > MAX_TAG_LENGTH ||
      CONTROL_CHARS.test(tag)
    ) {
      throw new ValidationError(
        `each tag must be a non-empty string of at most ${MAX_TAG_LENGTH} characters.`,
      );
    }
    return tag.trim();
  });
}

/**
 * Validate the optional `path` argument of `open_studio`.
 *
 * Accepts only a relative route (`/`, `/?tab=chat`, `/projects/abc#x`):
 *  - must start with a single `/` (so `//evil.com` and `http://...` are rejected)
 *  - no `.`/`..` segments, backslashes, whitespace, quotes, or shell metacharacters
 *  - printable ASCII only (no control characters)
 */
export function validateStudioPath(value: unknown): string {
  if (value === undefined || value === null) return '/';
  if (typeof value !== 'string') throw new ValidationError('path must be a string.');
  const p = value.trim();
  if (p.length === 0) return '/';
  if (p.length > MAX_PATH_LENGTH) {
    throw new ValidationError(`path must be at most ${MAX_PATH_LENGTH} characters.`);
  }
  if (!p.startsWith('/') || p.startsWith('//')) {
    throw new ValidationError('path must be a relative route starting with a single "/".');
  }
  if (/[\s\\"'`<>|;$]/.test(p) || !/^[!-~]+$/.test(p)) {
    throw new ValidationError('path contains characters that are not allowed.');
  }
  const routePart = p.split(/[?#]/, 1)[0];
  if (routePart.split('/').some((segment) => segment === '..' || segment === '.')) {
    throw new ValidationError('path must not contain "." or ".." segments.');
  }
  return p;
}

/**
 * Join a validated route onto the studio base URL using the WHATWG URL
 * parser, and verify the result stays on the studio origin.
 */
export function buildStudioUrl(studioUrl: string, route: string): string {
  let base: URL;
  try {
    base = new URL(studioUrl);
  } catch {
    throw new ValidationError(`STUDIO_URL "${studioUrl}" is not a valid absolute URL.`);
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new ValidationError('STUDIO_URL must use http or https.');
  }
  const basePath = base.pathname.replace(/\/+$/, '');
  const target = new URL(basePath + route, base.origin);
  if (target.origin !== base.origin) {
    throw new ValidationError('path resolved outside the studio origin.');
  }
  return target.toString();
}

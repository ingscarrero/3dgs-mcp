import { describe, expect, it } from 'vitest';
import {
  MAX_STEPS,
  ValidationError,
  assertArgsObject,
  buildStudioUrl,
  validateBoolean,
  validateDescription,
  validateId,
  validateMaxSteps,
  validateMethod,
  validateName,
  validateStudioPath,
  validateTags,
} from '../src/validate.js';

describe('assertArgsObject', () => {
  it('defaults undefined to an empty object', () => {
    expect(assertArgsObject(undefined)).toEqual({});
  });

  it('passes plain objects through', () => {
    const args = { a: 1 };
    expect(assertArgsObject(args)).toBe(args);
  });

  it.each([null, 'str', 42, [1, 2]])('rejects %j', (value) => {
    expect(() => assertArgsObject(value)).toThrow(ValidationError);
  });
});

describe('validateId', () => {
  it('accepts UUIDs and simple slugs', () => {
    expect(validateId('3f2a9c1e-6b7d-4e8f-9a0b-1c2d3e4f5a6b', 'projectId')).toBe(
      '3f2a9c1e-6b7d-4e8f-9a0b-1c2d3e4f5a6b',
    );
    expect(validateId('  my_project.v2  ', 'projectId')).toBe('my_project.v2');
  });

  it.each([
    ['../etc/passwd', 'parent traversal'],
    ['..', 'bare dotdot'],
    ['a..b', 'embedded dotdot'],
    ['foo/bar', 'slash'],
    ['foo\\bar', 'backslash'],
    ['.hidden', 'leading dot'],
    ['-flag', 'leading dash'],
    ['id; rm -rf /', 'shell metacharacters'],
    ['id?x=1', 'query string'],
    ['a'.repeat(129), 'too long'],
    ['', 'empty'],
    ['   ', 'whitespace only'],
  ])('rejects %j (%s)', (value) => {
    expect(() => validateId(value, 'projectId')).toThrow(ValidationError);
  });

  it.each([undefined, null, 42, {}, []])('rejects non-string %j', (value) => {
    expect(() => validateId(value, 'runId')).toThrow(/runId/);
  });
});

describe('validateName', () => {
  it('trims and accepts', () => {
    expect(validateName('  Living room  ')).toBe('Living room');
  });

  it('rejects empty, non-string, oversized and control characters', () => {
    expect(() => validateName('')).toThrow(/required/);
    expect(() => validateName(12)).toThrow(/string/);
    expect(() => validateName('x'.repeat(201))).toThrow(/at most/);
    expect(() => validateName('bad\u0000name')).toThrow(/control/);
  });
});

describe('validateDescription', () => {
  it('allows omission', () => {
    expect(validateDescription(undefined)).toBeUndefined();
    expect(validateDescription(null)).toBeUndefined();
  });

  it('validates type and length', () => {
    expect(validateDescription('ok')).toBe('ok');
    expect(() => validateDescription(1)).toThrow(ValidationError);
    expect(() => validateDescription('x'.repeat(2001))).toThrow(ValidationError);
  });

  it('allows multi-line text but rejects other control characters', () => {
    expect(validateDescription('line one\nline two\r\n\tindented')).toBe(
      'line one\nline two\r\n\tindented',
    );
    for (const bad of ['a\u0000b', 'a\u0001b', 'a\u0008b', 'a\u000bb', 'a\u001fb', 'a\u007fb']) {
      expect(() => validateDescription(bad)).toThrow(/control characters/);
    }
  });
});

describe('validateMethod', () => {
  it('defaults and accepts known methods', () => {
    expect(validateMethod(undefined)).toBe('splatfacto');
    expect(validateMethod(undefined, 'opensplat')).toBe('opensplat');
    expect(validateMethod('nerfacto')).toBe('nerfacto');
  });

  it('rejects unknown methods', () => {
    expect(() => validateMethod('rm -rf')).toThrow(/one of/);
    expect(() => validateMethod(3)).toThrow(ValidationError);
  });
});

describe('validateMaxSteps', () => {
  it('defaults and accepts integers in range', () => {
    expect(validateMaxSteps(undefined)).toBe(30_000);
    expect(validateMaxSteps(null, 5)).toBe(5);
    expect(validateMaxSteps(1)).toBe(1);
    expect(validateMaxSteps(MAX_STEPS)).toBe(MAX_STEPS);
  });

  it.each([0, -1, 1.5, MAX_STEPS + 1, '100', NaN, Infinity])('rejects %j', (value) => {
    expect(() => validateMaxSteps(value)).toThrow(ValidationError);
  });
});

describe('validateBoolean', () => {
  it('defaults and validates', () => {
    expect(validateBoolean(undefined, 'flag')).toBe(false);
    expect(validateBoolean(undefined, 'flag', true)).toBe(true);
    expect(validateBoolean(true, 'flag')).toBe(true);
    expect(() => validateBoolean('true', 'flag')).toThrow(/flag must be a boolean/);
  });
});

describe('validateTags', () => {
  it('defaults to empty and trims entries', () => {
    expect(validateTags(undefined)).toEqual([]);
    expect(validateTags([' a ', 'b'])).toEqual(['a', 'b']);
  });

  it('rejects malformed tags', () => {
    expect(() => validateTags('a')).toThrow(/array/);
    expect(() => validateTags([1])).toThrow(ValidationError);
    expect(() => validateTags([''])).toThrow(ValidationError);
    expect(() => validateTags(['x'.repeat(65)])).toThrow(ValidationError);
    expect(() => validateTags(['a\u0007'])).toThrow(ValidationError);
    expect(() => validateTags(new Array(51).fill('t'))).toThrow(/at most 50/);
  });
});

describe('validateStudioPath', () => {
  it('defaults to "/"', () => {
    expect(validateStudioPath(undefined)).toBe('/');
    expect(validateStudioPath(null)).toBe('/');
    expect(validateStudioPath('   ')).toBe('/');
  });

  it('accepts relative routes with query strings and fragments', () => {
    expect(validateStudioPath('/?tab=chat')).toBe('/?tab=chat');
    expect(validateStudioPath('/projects/abc-123?x=1&y=2#top')).toBe('/projects/abc-123?x=1&y=2#top');
  });

  it.each([
    ['http://evil.example', 'absolute URL'],
    ['//evil.example/x', 'protocol-relative URL'],
    ['javascript:alert(1)', 'javascript scheme'],
    ['relative', 'missing leading slash'],
    ['/../secret', 'parent traversal'],
    ['/a/../b', 'embedded traversal'],
    ['/a/./b', 'dot segment'],
    ['/..', 'bare parent segment'],
    ['/a/..', 'trailing parent segment'],
    ['/a/..?x=1', 'parent segment before query'],
    ['/a/..#top', 'parent segment before fragment'],
    ['/%2e%2e/admin', 'percent-encoded parent traversal (lowercase)'],
    ['/%2E%2E/admin', 'percent-encoded parent traversal (uppercase)'],
    ['/%2e%2e/%2e%2e/admin', 'repeated percent-encoded traversal'],
    ['/.%2e/admin', 'mixed literal/encoded parent segment'],
    ['/%2e./admin', 'mixed encoded/literal parent segment'],
    ['/%2e/admin', 'percent-encoded dot segment'],
    ['/a%2fb', 'percent-encoded slash'],
    ['/?q=a%20b', 'percent-encoding in the query string'],
    ['/x" && rm -rf / && "', 'double-quote breakout'],
    ["/x' ; id ; '", 'single-quote breakout'],
    ['/x`id`', 'backticks'],
    ['/x$(id)', 'command substitution'],
    ['/x|cat', 'pipe'],
    ['/x;id', 'semicolon'],
    ['/x <y', 'whitespace and redirect'],
    ['/x\\y', 'backslash'],
    ['/x\u0000y', 'null byte'],
    ['/x\ny', 'newline'],
    ['/é', 'non-ASCII'],
    [`/${'a'.repeat(600)}`, 'too long'],
  ])('rejects %j (%s)', (value) => {
    expect(() => validateStudioPath(value)).toThrow(ValidationError);
  });

  it('rejects non-strings', () => {
    expect(() => validateStudioPath(5)).toThrow(/string/);
  });
});

describe('buildStudioUrl', () => {
  it('joins the route under the base path', () => {
    expect(buildStudioUrl('http://localhost:3000/3dgs-studio', '/?tab=chat')).toBe(
      'http://localhost:3000/3dgs-studio/?tab=chat',
    );
    expect(buildStudioUrl('http://localhost:3000/3dgs-studio/', '/p/1')).toBe(
      'http://localhost:3000/3dgs-studio/p/1',
    );
    expect(buildStudioUrl('https://studio.example', '/')).toBe('https://studio.example/');
  });

  it('rejects invalid or non-http base URLs', () => {
    expect(() => buildStudioUrl('not a url', '/')).toThrow(/STUDIO_URL/);
    expect(() => buildStudioUrl('file:///etc', '/')).toThrow(/http or https/);
  });

  it('never leaves the studio origin, even for a hostile route', () => {
    // validateStudioPath already blocks these; buildStudioUrl is the second line.
    expect(buildStudioUrl('http://localhost:3000', '/x')).toMatch(/^http:\/\/localhost:3000\//);
  });

  it.each([
    '/../admin',
    '/../../admin',
    '/%2e%2e/admin',
    '/%2E%2E/admin',
    '/%2e%2e/%2e%2e/admin',
    '/.%2e/admin',
    '/%2e./admin',
    '/a/../../admin',
    '/..',
  ])('refuses %j when it would escape the studio base path', (route) => {
    expect(() => buildStudioUrl('http://localhost:3000/3dgs-studio', route)).toThrow(
      /outside the studio base path|"\." or "\.\." segments/,
    );
  });

  it('keeps routes that resolve inside the base path', () => {
    expect(buildStudioUrl('http://localhost:3000/3dgs-studio', '/a/../b')).toBe(
      'http://localhost:3000/3dgs-studio/b',
    );
    // With no base path there is nothing to escape; the origin check still holds.
    expect(buildStudioUrl('http://localhost:3000', '/..')).toBe('http://localhost:3000/');
  });
});

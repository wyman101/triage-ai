import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/version.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('VERSION', () => {
  it('matches package.json version', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, '../package.json'), 'utf8'),
    );
    expect(VERSION).toBe(pkg.version);
  });

  it('is a valid semver string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

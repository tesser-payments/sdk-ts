import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SDK_VERSION } from '../../src/internal/version.js';

describe('SDK_VERSION', () => {
  it('matches the package.json version', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'),
    );
    expect(SDK_VERSION).toBe(packageJson.version);
  });
});

import { describe, expect, it } from 'vitest';
import * as sdk from '../src/index.js';

// Catches accidental drops or additions to the public barrel. When the
// public surface intentionally changes, update both halves of this test
// in the same commit so the change is reviewable.
const EXPECTED_PUBLIC_NAMES = [
  // value exports
  'LocalSigner',
  'StampError',
  'TesserConfigError',
  'TesserError',
  'TesserSigningError',
] as const;

describe('public barrel', () => {
  it('exports exactly the documented public values', () => {
    const actual = Object.keys(sdk).sort();
    const expected = [...EXPECTED_PUBLIC_NAMES].sort();
    expect(actual).toEqual(expected);
  });

  it('does not export removed-in-v0.0.1 names', () => {
    // Names that lived in the v0.0.0 surface and must NOT leak into v0.0.1.
    const removed = [
      'TesserClient',
      'TesserAPIError',
      'TesserConnectionError',
      'TesserTimeoutError',
    ];
    for (const name of removed) {
      expect(sdk).not.toHaveProperty(name);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { TesserConfigError } from '../../src/internal/errors.js';
import { networkToTurnkeyType } from '../../src/signing/network-type.js';

describe('networkToTurnkeyType', () => {
  it.each([
    ['BASE', 'TRANSACTION_TYPE_ETHEREUM'],
    ['BASE_SEPOLIA', 'TRANSACTION_TYPE_ETHEREUM'],
    ['ETHEREUM', 'TRANSACTION_TYPE_ETHEREUM'],
    ['POLYGON', 'TRANSACTION_TYPE_ETHEREUM'],
    ['POLYGON_AMOY', 'TRANSACTION_TYPE_ETHEREUM'],
    ['SOLANA', 'TRANSACTION_TYPE_SOLANA'],
  ])('maps %s -> %s', (network, expected) => {
    expect(networkToTurnkeyType(network)).toBe(expected);
  });

  it('throws TesserConfigError for unknown network', () => {
    expect(() => networkToTurnkeyType('NOT_A_NETWORK')).toThrow(TesserConfigError);
  });

  it('error message lists supported networks sorted alphabetically', () => {
    try {
      networkToTurnkeyType('NOT_A_NETWORK');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain("'NOT_A_NETWORK'");
      expect((e as Error).message).toContain(
        'BASE, BASE_SEPOLIA, ETHEREUM, POLYGON, POLYGON_AMOY, SOLANA',
      );
    }
  });
});

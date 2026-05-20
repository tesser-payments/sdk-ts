// test/signing/stamp.test.ts
import { describe, expect, it, vi } from 'vitest';
import { StampError } from '../../src/internal/errors.js';
import { stamp } from '../../src/signing/stamp.js';

// secp256k1 generator-point (G), compressed form. Used as a realistic
// public-key fixture; ApiKeyStamper is mocked, so the actual curve math
// is irrelevant — we only need a string-valid public key.
const G_COMPRESSED = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

vi.mock('@turnkey/api-key-stamper', () => {
  return {
    ApiKeyStamper: vi.fn().mockImplementation(({ apiPublicKey }) => ({
      stamp: vi.fn().mockImplementation(async (body: string) => ({
        stampHeaderName: 'X-Stamp',
        stampHeaderValue: `stamp-of-${body}::${apiPublicKey}`,
      })),
    })),
  };
});

const validKeys = {
  publicKey: G_COMPRESSED,
  privateKey: 'sk',
  enclaveId: 'org',
};

describe('stamp', () => {
  it('returns the stamp header from the underlying stamper', async () => {
    const result = await stamp(validKeys, JSON.stringify({ hello: 'world' }));
    expect(result.stampHeaderName).toBe('X-Stamp');
    expect(result.stampHeaderValue).toBe(
      `stamp-of-${JSON.stringify({ hello: 'world' })}::${G_COMPRESSED}`,
    );
  });

  it('passes the publicKey through to ApiKeyStamper unchanged', async () => {
    const { ApiKeyStamper } = await import('@turnkey/api-key-stamper');
    const ctorMock = vi.mocked(ApiKeyStamper);
    ctorMock.mockClear();

    await stamp(validKeys, '{}');

    expect(ctorMock).toHaveBeenCalledWith({
      apiPublicKey: G_COMPRESSED,
      apiPrivateKey: 'sk',
    });
  });

  it('wraps stamper failures as StampError with .cause set', async () => {
    const { ApiKeyStamper } = await import('@turnkey/api-key-stamper');
    const stamperMock = vi.mocked(ApiKeyStamper);
    stamperMock.mockImplementationOnce(
      () =>
        ({
          stamp: async () => {
            throw new Error('boom');
          },
        }) as never,
    );

    await expect(stamp(validKeys, '{}')).rejects.toBeInstanceOf(StampError);

    stamperMock.mockImplementationOnce(
      () =>
        ({
          stamp: async () => {
            throw new Error('boom');
          },
        }) as never,
    );
    try {
      await stamp(validKeys, '{}');
    } catch (e) {
      expect(StampError.is(e)).toBe(true);
      expect((e as StampError).cause).toBeInstanceOf(Error);
    }
  });
});

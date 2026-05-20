// src/signing/stamp.ts
import { ApiKeyStamper } from '@turnkey/api-key-stamper';
import { StampError } from '../internal/errors.js';
import type { SigningConfig } from '../internal/types.js';

export interface StampResult {
  stampHeaderName: string;
  stampHeaderValue: string;
}

/**
 * The SDK requires `publicKey` to be in 33-byte compressed secp256k1 form
 * (66 hex chars starting with `02` or `03`). Turnkey stores and matches API
 * keys by exact string of this form.
 */
export async function stamp(
  keys: Pick<SigningConfig, 'publicKey' | 'privateKey'>,
  body: string,
): Promise<StampResult> {
  const stamper = new ApiKeyStamper({
    apiPublicKey: keys.publicKey,
    apiPrivateKey: keys.privateKey,
  });

  try {
    const result = await stamper.stamp(body);
    return {
      stampHeaderName: result.stampHeaderName,
      stampHeaderValue: result.stampHeaderValue,
    };
  } catch (cause) {
    throw new StampError('Turnkey ApiKeyStamper.stamp failed', { cause });
  }
}

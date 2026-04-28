// src/signer.ts
import type { TesserClient } from './client.js';
import { TesserConfigError } from './internal/errors.js';
import type { SignedResult, SigningConfig, WalletType } from './internal/types.js';
import { signCreateWallet as doSignCreateWallet } from './signing/create-wallet.js';

export class LocalSigner {
  readonly client: TesserClient;
  readonly #signing: Readonly<SigningConfig>;

  constructor(client: TesserClient, override?: SigningConfig) {
    this.client = client;
    if (override) {
      if (!override.publicKey || !override.privateKey || !override.enclaveId) {
        throw new TesserConfigError(
          'LocalSigner override: publicKey, privateKey, and enclaveId are all required (no partial merge)',
        );
      }
      this.#signing = Object.freeze({ ...override });
    } else {
      this.#signing = client.signing;
    }
  }

  signCreateWallet(params: {
    name: string;
    type: WalletType;
  }): Promise<SignedResult> {
    return doSignCreateWallet(this.#signing, params);
  }
}

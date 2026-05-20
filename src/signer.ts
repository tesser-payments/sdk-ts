// src/signer.ts
import { TesserConfigError } from './internal/errors.js';
import type {
  CreateWalletParams,
  LocalSignerOptions,
  SignedResult,
  SignedStepResult,
  StepForSigning,
} from './internal/types.js';
import { signCreateWallet } from './signing/create-wallet.js';
import { signStep } from './signing/sign-step.js';

/**
 * The portion of `SigningConfig` that `LocalSigner` exposes on its instance.
 * The private key is held in an ECMA private field and is not reachable via
 * property access, `console.log`, or `JSON.stringify`.
 */
export interface PublicSigningInfo {
  readonly publicKey: string;
  readonly enclaveId: string;
}

/**
 * Produces locally-signed activity payloads for Tesser API operations.
 *
 * v0.0.1 supports `signCreateWallet` and `signStep`. A future version will
 * add an optional `client` field to `LocalSignerOptions` for HTTP integration;
 * the addition is purely additive and does not break existing call sites.
 *
 * Key handling: the private key is stored in an ECMA private field (`#privateKey`)
 * and is not reachable via `signer.signing.privateKey` or any other public
 * surface. `signer.signing` exposes only `{ publicKey, enclaveId }`, so logging
 * `signer` or its `signing` property will not leak the private key.
 *
 * Thread-safety: stateless and reentrant. A single LocalSigner instance may
 * be shared across concurrent calls; the SDK never mutates internal state.
 */
export class LocalSigner {
  readonly signing: PublicSigningInfo;
  readonly #privateKey: string;

  constructor(options: LocalSignerOptions) {
    const s = options.signing;
    if (!s || !s.publicKey || !s.privateKey || !s.enclaveId) {
      throw new TesserConfigError(
        'LocalSigner: signing.publicKey, signing.privateKey, and signing.enclaveId are required',
      );
    }
    this.signing = { publicKey: s.publicKey, enclaveId: s.enclaveId };
    this.#privateKey = s.privateKey;
  }

  /** Stamps an `ACTIVITY_TYPE_CREATE_WALLET` Turnkey activity. */
  signCreateWallet(params: CreateWalletParams): Promise<SignedResult> {
    return signCreateWallet(
      {
        publicKey: this.signing.publicKey,
        privateKey: this.#privateKey,
        enclaveId: this.signing.enclaveId,
      },
      params,
    );
  }

  /** Stamps an `ACTIVITY_TYPE_SIGN_TRANSACTION_V2` Turnkey activity. */
  signStep(step: StepForSigning): Promise<SignedStepResult> {
    return signStep(
      {
        publicKey: this.signing.publicKey,
        privateKey: this.#privateKey,
        enclaveId: this.signing.enclaveId,
      },
      step,
    );
  }
}

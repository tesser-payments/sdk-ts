// src/signer.ts
import { TesserConfigError } from './internal/errors.js';
import type {
  CreateWalletParams,
  LocalSignerOptions,
  SignedResult,
  SignedStepResult,
  SignStepOptions,
  SigningConfig,
  StepForSigning,
} from './internal/types.js';
import { signCreateWallet } from './signing/create-wallet.js';
import { signStep } from './signing/sign-step.js';

/**
 * Produces locally-signed activity payloads for Tesser API operations.
 *
 * v0.0.1 supports `signCreateWallet` and `signStep`. A future version will
 * add an optional `client` field to `LocalSignerOptions` for HTTP integration;
 * the addition is purely additive and does not break existing call sites.
 *
 * Thread-safety: stateless and reentrant. A single LocalSigner instance may
 * be shared across concurrent calls; the SDK never mutates internal state.
 */
export class LocalSigner {
  readonly signing: Readonly<SigningConfig>;

  constructor(options: LocalSignerOptions) {
    const s = options.signing;
    if (!s || !s.publicKey || !s.privateKey || !s.enclaveId) {
      throw new TesserConfigError(
        'LocalSigner: signing.publicKey, signing.privateKey, and signing.enclaveId are required',
      );
    }
    this.signing = Object.freeze({ ...s });
  }

  /** Stamps an `ACTIVITY_TYPE_CREATE_WALLET` Turnkey activity. */
  signCreateWallet(params: CreateWalletParams): Promise<SignedResult> {
    return signCreateWallet(this.signing, params);
  }

  /** Stamps an `ACTIVITY_TYPE_SIGN_TRANSACTION_V2` Turnkey activity. */
  signStep(step: StepForSigning, opts: SignStepOptions = {}): Promise<SignedStepResult> {
    return signStep(this.signing, step, opts);
  }
}

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
import { type TesserApiConnection, createTesserApiConnection } from './signing/unsigned-payload.js';

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
 * Supports `signCreateWallet` and `signStep`. Construction validates that the
 * signing keys are non-blank and that `apiBaseUrl`, if set, is an https URL.
 *
 * Key handling: the private key is stored in an ECMA private field (`#privateKey`)
 * and is not reachable via `signer.signing.privateKey` or any other public
 * surface. `signer.signing` exposes only `{ publicKey, enclaveId }`, so logging
 * `signer` or its `signing` property will not leak the private key.
 *
 * Thread-safety: the only state is the environment remembered after the first
 * Ethereum wallet request; a single LocalSigner may be shared across concurrent calls.
 */
export class LocalSigner {
  readonly signing: PublicSigningInfo;
  readonly #privateKey: string;
  readonly #api: TesserApiConnection;

  constructor(options: LocalSignerOptions) {
    const s = options.signing;
    if (!s || !s.publicKey || !s.privateKey || !s.enclaveId) {
      throw new TesserConfigError(
        'LocalSigner: signing.publicKey, signing.privateKey, and signing.enclaveId are required',
      );
    }
    this.#api = createTesserApiConnection({ apiBaseUrl: options.apiBaseUrl, fetch: options.fetch });
    this.signing = { publicKey: s.publicKey, enclaveId: s.enclaveId };
    this.#privateKey = s.privateKey;
  }

  /**
   * Signs a wallet-creation request.
   *
   * For `stablecoin_ethereum` the SDK first fetches the request to sign from the
   * Tesser API and checks that it matches your parameters. Other wallet types are
   * signed locally without a request to Tesser. The private key never leaves the
   * process.
   *
   * @throws {TesserConfigError} if the wallet type is not valid.
   * @throws {TesserSigningError} if signing fails or the request fetched from
   *   Tesser does not match your parameters.
   * @throws {TesserAPIError} if Tesser answers with an error status or an
   *   invalid response. Safe to retry for status 429 or 5xx; other 4xx statuses
   *   fail the same way on retry. Without `apiBaseUrl`, if neither production nor
   *   sandbox accepts your signing key, the error from production is thrown.
   * @throws {TesserConnectionError} if the request to Tesser fails at the
   *   network level. Safe to retry.
   * @throws {TesserTimeoutError} if the request to Tesser times out. Safe to retry.
   */
  signCreateWallet(params: CreateWalletParams): Promise<SignedResult> {
    return signCreateWallet(
      {
        publicKey: this.signing.publicKey,
        privateKey: this.#privateKey,
        enclaveId: this.signing.enclaveId,
      },
      params,
      this.#api,
    );
  }

  /** Signs a single transfer step. The private key never leaves the process. */
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

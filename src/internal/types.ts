// src/internal/types.ts

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'off';

export interface Logger {
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

export interface SigningConfig {
  publicKey: string;
  privateKey: string;
  enclaveId: string;
}

export type WalletType = 'stablecoin_ethereum' | 'stablecoin_solana' | 'stablecoin_stellar';

export interface SignedResultMetadata {
  stampHeaderName: string;
  stampHeaderValue: string;
  body: string;
}

export interface SignedResult {
  signature: string;
  metadata: SignedResultMetadata;
}

export interface CreateWalletParams {
  name: string;
  type: WalletType;
}

export interface StepForSigning {
  /** Step UUID */
  id: string;
  /**
   * Parent rebalance UUID. Webhook step DTOs expose this as `rebalance_id`;
   * GET-rebalance responses expose it as `transfer_id`. Same value; example
   * code maps from whichever field is present in its source.
   */
  transferId: string;
  /** Hex-encoded raw tx bytes, e.g. "0x02..." */
  unsignedTransaction: string;
  /** On-chain address from GET /v1/accounts/{id} → crypto_wallet_address */
  signWith: string;
  /** Network identifier: BASE | BASE_SEPOLIA | ETHEREUM | POLYGON | POLYGON_AMOY | SOLANA */
  network: string;
}

export interface SignedStepResultMetadata {
  stampHeaderName: string;
  stampHeaderValue: string;
  body: string;
}

export interface SignedStepResult {
  /** base64(JSON.stringify({body, stamp})) — pass to Tesser API */
  signature: string;
  /** Echo of input — useful for caller logging */
  unsignedTransaction: string;
  metadata: SignedStepResultMetadata;
}

/**
 * Per-call options for `signStep`. Empty in v0.0.1; reserved for future
 * options such as `signal?: AbortSignal`, `timeout?: number`,
 * `maxRetries?: number`. Defined as a `Record<string, never>` so the
 * empty-object type doesn't trip Biome's `noBannedTypes` rule.
 */
export type SignStepOptions = Record<string, never>;

export interface LocalSignerOptions {
  signing: SigningConfig;
  // Reserved for v_next: client?: TesserClient
}

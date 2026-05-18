// src/internal/types.ts

import type { SupportedNetwork } from '../signing/network-type.js';

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

export type WalletType =
  | 'stablecoin_ethereum'
  /** @experimental Solana wallet creation is not yet verified end-to-end against Tesser staging. */
  | 'stablecoin_solana'
  /** @experimental Stellar is supported by Tesser only as a receive (unmanaged) wallet; `signCreateWallet` is unverified. */
  | 'stablecoin_stellar';

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
  /** Hex-encoded raw tx bytes, e.g. "0x02..." */
  unsignedTransaction: string;
  /** On-chain address from GET /v1/accounts/{id} → crypto_wallet_address */
  signWith: string;
  /** Network identifier; one of the supported chains in `NETWORK_TO_TURNKEY_TYPE`. */
  network: SupportedNetwork;
}

export interface SignedStepResultMetadata {
  stampHeaderName: string;
  stampHeaderValue: string;
  body: string;
}

export interface SignedStepResult {
  /** base64(JSON.stringify({body, stamp})) — pass to Tesser API */
  signature: string;
  metadata: SignedStepResultMetadata;
}

export interface LocalSignerOptions {
  signing: SigningConfig;
  // Reserved for v_next: client?: TesserClient
}

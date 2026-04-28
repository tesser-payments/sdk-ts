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

export interface SignedResult {
  signature: string;
  metadata: {
    stampHeaderName: string;
    stampHeaderValue: string;
    body: string;
  };
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeout?: number;
  maxRetries?: number;
}

// `NetworkKey` is imported from `@tesser-payments/types`, but is referenced here
// for the `RpcUrls` alias. Importing from the types lib is intentional —
// the SDK does not redefine shared domain types.
// Note: plan referenced `Network`; the actual exported name is `NetworkKey`.
import type { NetworkKey } from '@tesser-payments/types';

export type RpcUrls = Partial<Record<NetworkKey, string>>;

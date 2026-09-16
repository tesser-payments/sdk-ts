// src/signing/network-type.ts
//
// Maps Tesser network identifiers to Turnkey's TRANSACTION_TYPE_* enum.

import { TesserConfigError } from '../internal/errors.js';

const NETWORK_TO_TURNKEY_TYPE = {
  BASE: 'TRANSACTION_TYPE_ETHEREUM',
  BASE_SEPOLIA: 'TRANSACTION_TYPE_ETHEREUM',
  ETHEREUM: 'TRANSACTION_TYPE_ETHEREUM',
  ETHEREUM_SEPOLIA: 'TRANSACTION_TYPE_ETHEREUM',
  POLYGON: 'TRANSACTION_TYPE_ETHEREUM',
  POLYGON_AMOY: 'TRANSACTION_TYPE_ETHEREUM',
  SOLANA: 'TRANSACTION_TYPE_SOLANA',
  TEMPO: 'TRANSACTION_TYPE_TEMPO',
  TEMPO_MODERATO: 'TRANSACTION_TYPE_TEMPO',
} as const;

export type SupportedNetwork = keyof typeof NETWORK_TO_TURNKEY_TYPE;

export function networkToTurnkeyType(network: string): string {
  const turnkeyType = (NETWORK_TO_TURNKEY_TYPE as Readonly<Record<string, string>>)[network];
  if (turnkeyType === undefined) {
    const supported = Object.keys(NETWORK_TO_TURNKEY_TYPE).sort().join(', ');
    throw new TesserConfigError(`Unsupported network: '${network}'. Supported: ${supported}`);
  }
  return turnkeyType;
}

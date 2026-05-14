// src/signing/network-type.ts
//
// Maps Tesser network identifiers to Turnkey's TRANSACTION_TYPE_* enum.
// EVM-family networks all map to TRANSACTION_TYPE_ETHEREUM because Turnkey
// keys on signing scheme, not chain ID.

import { TesserConfigError } from '../internal/errors.js';

const NETWORK_TO_TURNKEY_TYPE: Readonly<Record<string, string>> = Object.freeze({
  BASE: 'TRANSACTION_TYPE_ETHEREUM',
  BASE_SEPOLIA: 'TRANSACTION_TYPE_ETHEREUM',
  ETHEREUM: 'TRANSACTION_TYPE_ETHEREUM',
  POLYGON: 'TRANSACTION_TYPE_ETHEREUM',
  POLYGON_AMOY: 'TRANSACTION_TYPE_ETHEREUM',
  SOLANA: 'TRANSACTION_TYPE_SOLANA',
});

export function networkToTurnkeyType(network: string): string {
  const turnkeyType = NETWORK_TO_TURNKEY_TYPE[network];
  if (turnkeyType === undefined) {
    const supported = Object.keys(NETWORK_TO_TURNKEY_TYPE).sort().join(', ');
    throw new TesserConfigError(`Unsupported network: '${network}'. Supported: ${supported}`);
  }
  return turnkeyType;
}

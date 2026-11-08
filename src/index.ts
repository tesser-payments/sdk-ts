// src/index.ts — public API surface for @tesser-payments/sdk-ts
export { LocalSigner } from './signer.js';
export type { PublicSigningInfo } from './signer.js';

export type {
  CreateWalletParams,
  LocalSignerOptions,
  SignedResult,
  SignedResultMetadata,
  SignedStepResult,
  SignedStepResultMetadata,
  SigningConfig,
  StepForSigning,
  WalletType,
} from './internal/types.js';

export type { SupportedNetwork } from './signing/network-type.js';

export {
  StampError,
  TesserAPIError,
  TesserConfigError,
  TesserConnectionError,
  TesserError,
  TesserSigningError,
  TesserTimeoutError,
} from './internal/errors.js';

export type { TesserErrorDetail } from './internal/errors.js';

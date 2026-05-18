// src/index.ts — public API surface for @tesser-payments/sdk
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
  TesserConfigError,
  TesserError,
  TesserSigningError,
} from './internal/errors.js';

export type { TesserErrorDetail } from './internal/errors.js';

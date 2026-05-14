// src/index.ts — public API surface for @tesser-payments/sdk
export { LocalSigner } from './signer.js';

export type {
  CreateWalletParams,
  LocalSignerOptions,
  SignedResult,
  SignedResultMetadata,
  SignedStepResult,
  SignedStepResultMetadata,
  SignStepOptions,
  SigningConfig,
  StepForSigning,
  WalletType,
} from './internal/types.js';

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

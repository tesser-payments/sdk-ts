// src/index.ts

// Classes
export { TesserClient, type TesserClientConfig } from './client.js';
export { LocalSigner } from './signer.js';

// Errors
export {
  StampError,
  TesserAPIError,
  TesserConfigError,
  TesserConnectionError,
  TesserError,
  type TesserErrorDetail,
  TesserSigningError,
  TesserTimeoutError,
} from './internal/errors.js';

// Types
export type {
  Logger,
  LogLevel,
  RequestOptions,
  RpcUrls,
  SignedResult,
  SigningConfig,
  WalletType,
} from './internal/types.js';

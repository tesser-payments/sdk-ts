# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.1] — 2026-05-14

### Added

- `LocalSigner({ signing })` — signer-only public API mirroring the kotlin SDK at v0.0.3.
- `LocalSigner.signCreateWallet(params)` — produces Turnkey `ACTIVITY_TYPE_CREATE_WALLET` stamps for `stablecoin_ethereum`, `stablecoin_solana`, `stablecoin_stellar`.
- `LocalSigner.signStep(step, opts?)` — produces Turnkey `ACTIVITY_TYPE_SIGN_TRANSACTION_V2` stamps for `BASE`, `BASE_SEPOLIA`, `ETHEREUM`, `POLYGON`, `POLYGON_AMOY`, `SOLANA`.
- `StepForSigning`, `SignedStepResult`, `SignedStepResultMetadata`, `SignStepOptions`, `LocalSignerOptions` types.
- Full error hierarchy exported (`TesserError`, `TesserConfigError`, `TesserAPIError`, `TesserConnectionError`, `TesserTimeoutError`, `TesserSigningError`, `StampError`, `TesserErrorDetail`).
- Apache 2.0 LICENSE and NOTICE.
- Examples: `create-wallet.ts`, `sign-step-polling.ts`, `sign-step-webhooks.ts` (signature verification deferred).

### Removed

- `TesserClient`, `TesserClientConfig`, `RequestOptions`, `RpcUrls` — re-addition planned, additively via `LocalSignerOptions.client`.
- `fetchWithRetry` HTTP layer.
- `viem` peer dependency.
- `p-retry` dependency.

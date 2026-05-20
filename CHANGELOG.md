# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.1] — 2026-05-18

### Added

- `LocalSigner({ signing })` — signer-only public API mirroring the kotlin SDK at v0.0.3. Private key is held in an ECMA private field (`#privateKey`) and is not reachable via `signer.signing.privateKey`, `console.log`, or `JSON.stringify`.
- `LocalSigner.signCreateWallet(params)` — produces Turnkey `ACTIVITY_TYPE_CREATE_WALLET` stamps for `stablecoin_ethereum`. `stablecoin_solana` and `stablecoin_stellar` are exported as `@experimental` types and are unverified end-to-end against Tesser staging.
- `LocalSigner.signStep(step)` — produces Turnkey `ACTIVITY_TYPE_SIGN_TRANSACTION_V2` stamps for `BASE`, `BASE_SEPOLIA`, `ETHEREUM`, `POLYGON`, `POLYGON_AMOY`, `SOLANA`.
- `StepForSigning`, `SignedStepResult`, `SignedStepResultMetadata`, `LocalSignerOptions`, `PublicSigningInfo`, `SupportedNetwork` types.
- Error hierarchy exported: `TesserError`, `TesserConfigError`, `TesserSigningError`, `StampError`, `TesserErrorDetail`.
- Apache 2.0 LICENSE and NOTICE.
- Examples: `create-wallet.ts` (managed Ethereum only), `sign-step-polling.ts`, `sign-step-webhooks.ts` (signature verification deferred).

### Removed

- `TesserClient`, `TesserClientConfig`, `RequestOptions`, `RpcUrls` — re-addition planned, additively via `LocalSignerOptions.client`.
- `fetchWithRetry` HTTP layer.
- `viem` peer dependency.
- `p-retry` dependency.

### Changed

- Engine floor bumped: Node ≥ 20, Bun ≥ 1.3.

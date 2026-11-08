# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `signStep` supports `TEMPO` and `TEMPO_MODERATO`. The SDK authorizes the Tempo transaction Tesser provides with your API key, without changing it; Tesser completes the transfer and pays the network fee.
- `LocalSignerOptions.fetch` accepts an optional `fetch` implementation for requests to Tesser, for example to configure a proxy.
- `TesserAPIError`, `TesserConnectionError`, and `TesserTimeoutError` are exported.

### Changed

- **Breaking:** `LocalSigner` requires an `apiBaseUrl` (`new LocalSigner({ signing, apiBaseUrl })`): `https://api.tesser.xyz` in production, `https://api-sandbox.tesser.xyz` in sandbox. A trailing `/` or `/v1` is removed. A URL that is not https throws `TesserConfigError`.
- `signCreateWallet` for `stablecoin_ethereum` fetches the request to sign from the Tesser API and checks that it matches your parameters. The method signature and the `base64({ body, stamp })` result are unchanged. Tesser currently supports managed wallets for `stablecoin_ethereum` only.
- `signCreateWallet` can throw `TesserAPIError`, `TesserConnectionError`, and `TesserTimeoutError` while fetching the request. `TesserConnectionError`, `TesserTimeoutError`, and a `TesserAPIError` with status 429 or 5xx are safe to retry; a `TesserAPIError` with any other 4xx status fails the same way on retry. A fetched request that does not match your parameters throws `TesserSigningError` and nothing is signed.

## [0.0.4] — 2026-07-07

### Fixed

- `signStep` now accepts `ETHEREUM_SEPOLIA`. The network-to-Turnkey-type map carried the Base and Polygon testnets but not Ethereum's, so staging steps planned on Ethereum Sepolia were rejected client-side with `TesserConfigError`.

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

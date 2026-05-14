---
'@tesser-payments/sdk': minor
---

Initial signer-only public API. `LocalSigner({ signing })` exposes `signCreateWallet` and `signStep`. No HTTP layer; consumers bring their own. Drops `viem` and `p-retry` deps. Apache 2.0.

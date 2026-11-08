# @tesser-payments/sdk-ts

TypeScript SDK for the Tesser API: sign `signCreateWallet` and `signStep`
requests locally with your signing key. The SDK does not handle OAuth or submit
requests for you; bring your own client.

## Install

```sh
bun add @tesser-payments/sdk-ts @tesser-payments/types
```

`@tesser-payments/types` is a peer dependency — install it alongside the SDK.
Apache 2.0 licensed.

## Quick start

```typescript
import { LocalSigner } from '@tesser-payments/sdk-ts';

const signer = new LocalSigner({
  signing: {
    publicKey: process.env.SIGNING_PUBLIC_KEY!,   // 33-byte compressed P-256
    privateKey: process.env.SIGNING_PRIVATE_KEY!,
    enclaveId: process.env.SIGNING_ENCLAVE_ID!,
  },
  apiBaseUrl: 'https://api.tesser.xyz', // sandbox: https://api-sandbox.tesser.xyz
});

const { signature } = await signer.signCreateWallet({
  name: 'My new wallet',
  type: 'stablecoin_ethereum',
});

const res = await fetch(`${API_BASE_URL}/v1/accounts/wallets`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    signature,
    name: 'My new wallet',
    type: 'stablecoin_ethereum',
    is_managed: true,
  }),
});
```

`signature` is `base64(JSON.stringify({ body, stamp }))` — drop it into the
Tesser API request body as the documented `signature` field.

`LocalSigner` requires the Tesser API base URL (`https://api.tesser.xyz` or
`https://api-sandbox.tesser.xyz`); a trailing `/` or `/v1` is removed. Pass an
optional `fetch` implementation to configure a proxy.

`signCreateWallet` signs a wallet-creation request. For `stablecoin_ethereum`,
it first fetches the request to sign from the Tesser API and checks that it
matches your parameters. The private key never leaves your process. Tesser
currently supports managed wallets for `stablecoin_ethereum` only.

**Private-key handling.** `signer.signing` exposes only `{ publicKey, enclaveId }`.
The private key lives on the instance as an ECMA private field and is not
reachable via property access, `console.log`, or `JSON.stringify`. The SDK still
uses it internally to stamp activities — you just can't pull it back out.

## `signStep`

`signStep` signs a single rebalance step. Pass the unsigned transaction Tesser returned, the
on-chain `signWith` address, and the network — that's all the SDK needs to
produce a signature:

```typescript
import { LocalSigner, type StepForSigning } from '@tesser-payments/sdk-ts';

const step: StepForSigning = {
  unsignedTransaction: '0x02...',      // hex-encoded raw tx Tesser returned
  signWith: '0xabc...',                // account.crypto_wallet_address from
                                       //   GET /v1/accounts/{from_account_id}
  network: 'BASE_SEPOLIA',
};

const signed = await signer.signStep(step);

// POST /v1/treasury/rebalances/{rebalanceId}/steps/{stepId}/sign
// The IDs are yours to track — you got them from the API response or webhook;
// the SDK has no use for them, so they're not in `StepForSigning`.
await fetch(
  `${API_BASE_URL}/v1/treasury/rebalances/${rebalanceId}/steps/${stepId}/sign`,
  {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ signature: signed.signature }),
  },
);
```

`signStep` returns `{ signature, metadata }`. The `signature` field is what
the Tesser API needs; `metadata` carries the signed body and stamp header value
for debugging.

The `network` field is typed as `SupportedNetwork`, derived from the SDK's
supported-network table — so a typo like `'BASE-SEPOLIA'` (hyphen) is a
compile-time error. If you're pulling the value out of a webhook payload or
env var, cast it at that boundary.

Supported networks are `BASE`, `BASE_SEPOLIA`, `ETHEREUM`, `ETHEREUM_SEPOLIA`,
`POLYGON`, `POLYGON_AMOY`, `SOLANA`, `TEMPO`, and `TEMPO_MODERATO`.

### Tempo transfers

1. Pass the Tempo transaction Tesser provides (`0x76...`), your wallet
   address, and `TEMPO` or `TEMPO_MODERATO` to `signStep`.
2. The SDK authorizes the transaction with your API key, without changing
   it. Submit the returned `signature` to the Tesser signing endpoint.
3. Tesser completes the transfer, broadcasts it, and pays the network fee.

Unknown networks raise `TesserConfigError` before anything is signed.

## Error handling

The SDK mirrors Tesser's documented error envelope
(<https://docs.tesser.xyz/overviews/errors>) rather than inventing a custom
HTTP-status taxonomy:

```
TesserError                       (base; .cause set on all)
├── TesserConfigError             bad input at construction or call site
├── TesserAPIError                Tesser answered with an error status or
│                                 an invalid response
├── TesserConnectionError         the request to Tesser failed at the network level
├── TesserTimeoutError            the request to Tesser timed out
└── TesserSigningError            signing failure, or a fetched request that
    │                             does not match your parameters
    └── StampError                the signing key could not sign
```

`TesserAPIError`, `TesserConnectionError`, and `TesserTimeoutError` come from
the request `signCreateWallet` makes to Tesser for `stablecoin_ethereum`.
`TesserAPIError` carries `status`, `headers`, `requestId`, and the parsed
`errors[]` (with `errorCode` for the first one). `TesserConnectionError`,
`TesserTimeoutError`, and a `TesserAPIError` with status 429 or 5xx are safe to
retry; a `TesserAPIError` with any other 4xx status fails the same way on
retry.

Each error carries the original failure as `.cause` and can be discriminated via
`instanceof` or the static `.is()` guard:

```typescript
import { TesserError, StampError } from '@tesser-payments/sdk-ts';

try {
  await signer.signStep(step);
} catch (err) {
  if (StampError.is(err)) {
    // The key could not sign — usually a key-format problem.
  }
  if (TesserError.is(err)) {
    console.error('Signing failed', { name: err.name, cause: err.cause });
  }
  throw err;
}
```

## Setup notes

`signing.publicKey` must be the **33-byte compressed** form Tesser uses for
API-key auth lookups (66 hex chars, prefix `02` or `03`). Dashboards that
display the 65-byte uncompressed form need to be compressed before use:

```sh
node -e 'const u = process.argv[1].replace(/^0x/i, ""); console.log(require("node:crypto").ECDH.convertKey(u, "prime256v1", "hex", "hex", "compressed"))' \
  04...your-uncompressed-key...
```

If a key is registered in uncompressed form, signing is rejected even when the
keypair is logically correct — re-register the key in compressed form to fix.

## Examples

| Path | What it demonstrates |
|---|---|
| [`examples/create-wallet.ts`](./examples/create-wallet.ts) | OAuth → `signCreateWallet({ type: 'stablecoin_ethereum' })` → `POST /v1/accounts/wallets` with `is_managed: true`. Solana and Stellar paths are not exercised in v0.0.1. |
| [`examples/sign-step-polling.ts`](./examples/sign-step-polling.ts) | End-to-end rebalance signing driven by `GET /v1/treasury/rebalances/{id}` polling. |
| [`examples/sign-step-webhooks.ts`](./examples/sign-step-webhooks.ts) | End-to-end rebalance signing driven by Tesser `step.*` webhooks. Best-effort: webhook signature verification is **not** wired up (the algorithm isn't currently documented), so do not run this against production. |
| [`examples/lib/oauth.ts`](./examples/lib/oauth.ts) | Shared `client_credentials` token helper for the three scripts above. |
| [`examples/lib/require-env.ts`](./examples/lib/require-env.ts) | Typed env-validation helper. |

Run with `bun run examples/<name>.ts`. Bun loads `.env.local` automatically;
copy [`.env.example`](./.env.example) and fill in the values first.

## Out of scope

- **`TesserClient`** — the previous bundled HTTP client (`getAccountAddress`,
  retry/timeout/logger plumbing) is intentionally not included.
- **Webhook signature verification** — the header name and HMAC algorithm
  aren't currently documented in public Tesser docs.
- **Solana / Stellar `signCreateWallet`** — exported as `@experimental` types;
  not verified end-to-end. Stellar is supported by Tesser only as a receive
  (unmanaged) wallet.
- **Browser, edge, and React Native runtimes** — Node ≥ 20 / Bun ≥ 1.3 only.

## Development

```sh
bun install
bun run typecheck     # tsc --noEmit
bun run lint          # biome check .
bun run lint:fix      # biome check . --write
bun run test          # vitest run
bun run test:watch
bun run build         # bun build (JS) + tsc --emitDeclarationOnly (.d.ts)
```

Conventional commits. Versions are bumped manually in `package.json`;
`CHANGELOG.md` is hand-authored per release. Cutting a release: bump
the version, merge to `main`, then trigger the `Release` workflow from
the Actions tab (see `.github/workflows/release.yml`).

CI runs typecheck, lint, test, build on every PR (see
`.github/workflows/ci.yml`).

## License

[Apache License 2.0](./LICENSE). See [`NOTICE`](./NOTICE).

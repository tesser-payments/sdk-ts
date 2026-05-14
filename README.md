# @tesser-payments/sdk

Signer-only TypeScript SDK for Tesser API: locally stamp `signCreateWallet` and
`signStep` activities using Turnkey API keys. The SDK does not own HTTP or
OAuth — Tesser API supplies the unsigned transaction; this library only stamps
it. Bring your own client.

## Install

```sh
bun add @tesser-payments/sdk @turnkey/api-key-stamper @tesser-payments/types
```

Both `@turnkey/api-key-stamper` and `@tesser-payments/types` are peer
dependencies (no runtime dependencies of our own). Apache 2.0 licensed.

## Quick start

```typescript
import { LocalSigner } from '@tesser-payments/sdk';

const signer = new LocalSigner({
  signing: {
    publicKey: process.env.SIGNING_PUBLIC_KEY!,   // 33-byte compressed P-256
    privateKey: process.env.SIGNING_PRIVATE_KEY!,
    enclaveId: process.env.SIGNING_ENCLAVE_ID!,   // Turnkey suborg ID
  },
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

## `signStep`

`signStep` stamps a Turnkey `ACTIVITY_TYPE_SIGN_TRANSACTION_V2` body for a
single rebalance step. Pass the step UUID, the unsigned transaction Tesser
returned, the on-chain `signWith` address, and the network:

```typescript
import { LocalSigner, type StepForSigning } from '@tesser-payments/sdk';

const step: StepForSigning = {
  id: 'step_abc',                      // step UUID
  transferId: 'rebalance_xyz',         // parent rebalance UUID
                                       //   (webhook payloads: data.object.rebalance_id;
                                       //    GET-rebalance:    step.transfer_id)
  unsignedTransaction: '0x02...',      // hex-encoded raw tx Tesser returned
  signWith: '0xabc...',                // account.crypto_wallet_address from
                                       //   GET /v1/accounts/{from_account_id}
  network: 'BASE_SEPOLIA',             // BASE | BASE_SEPOLIA | ETHEREUM |
                                       //   POLYGON | POLYGON_AMOY | SOLANA
};

const signed = await signer.signStep(step);

// POST /v1/treasury/rebalances/{transferId}/steps/{id}/sign
await fetch(
  `${API_BASE_URL}/v1/treasury/rebalances/${step.transferId}/steps/${step.id}/sign`,
  {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ signature: signed.signature }),
  },
);
```

`signStep` returns `{ signature, unsignedTransaction, metadata }`. The
`unsignedTransaction` is an echo of the input — handy for caller-side
logging.

## Error handling

The SDK mirrors Tesser's documented error envelope
(<https://docs.tesser.xyz/overviews/errors>) rather than inventing a custom
HTTP-status taxonomy. The full hierarchy is exported so consumers can branch
on `instanceof`:

```
TesserError                       (base; .cause set on all)
├── TesserConfigError             bad input at construction or call site
├── TesserAPIError                non-2xx HTTP from Tesser
│                                 .status, .headers, .requestId,
│                                 .errors[]: TesserErrorDetail
├── TesserConnectionError         network / transport failure
├── TesserTimeoutError            request exceeded timeout
└── TesserSigningError            local signing failure
    └── StampError                Turnkey ApiKeyStamper failed
```

v0.0.1 only throws `TesserConfigError`, `TesserSigningError`, and
`StampError` directly — the rest are exported now so consumer code that
catches `TesserAPIError` (from its own HTTP layer) stays compatible when a
future version adds an optional bundled client.

```typescript
import { TesserAPIError } from '@tesser-payments/sdk';

try {
  // ... your fetch call ...
} catch (err) {
  if (TesserAPIError.is(err)) {
    if (err.hasCode('accounts-3005')) {
      // Turnkey stamp rejected — re-register the API key.
    }
    console.error('Tesser API failure', {
      status: err.status,
      requestId: err.requestId,
      errors: err.errors,
    });
  }
  throw err;
}
```

`err.errorCode` is a convenience for `err.errors[0]?.errorCode`.

## Setup notes

`signing.publicKey` must be the **33-byte compressed** form Turnkey uses for
API-key auth lookups (66 hex chars, prefix `02` or `03`). Dashboards that
display the 65-byte uncompressed form need to be compressed before use:

```sh
bunx -p @turnkey/crypto node -e \
  'const c = require("@turnkey/crypto"); \
   const u = process.argv[1].replace(/^0x/i,""); \
   const b = Buffer.from(u, "hex"); \
   console.log(Buffer.from(c.compressRawPublicKey(b)).toString("hex"))' \
  04...your-uncompressed-key...
```

If a key is registered on Turnkey in uncompressed form, Turnkey rejects
auth with `PUBLIC_KEY_NOT_FOUND` even when the keypair is logically
correct — re-register the key in compressed form to fix.

## Examples

| Path | What it demonstrates |
|---|---|
| [`examples/create-wallet.ts`](./examples/create-wallet.ts) | OAuth → `signCreateWallet` → `POST /v1/accounts/wallets`. Doubles as the manual verification harness. |
| [`examples/sign-step-polling.ts`](./examples/sign-step-polling.ts) | End-to-end rebalance signing driven by `GET /v1/treasury/rebalances/{id}` polling. |
| [`examples/sign-step-webhooks.ts`](./examples/sign-step-webhooks.ts) | End-to-end rebalance signing driven by Tesser `step.*` webhooks. Best-effort: webhook signature verification is **not** wired up (the algorithm isn't currently documented), so do not run this against production. |
| [`examples/lib/oauth.ts`](./examples/lib/oauth.ts) | Shared `client_credentials` token helper for the three scripts above. |
| [`examples/lib/require-env.ts`](./examples/lib/require-env.ts) | Typed env-validation helper. |

Run with `bun run examples/<name>.ts`. Bun loads `.env.local` automatically;
copy [`.env.example`](./.env.example) and fill in the values first.

## Out of scope

- **`TesserClient`** — the previous bundled HTTP client (`getAccountAddress`,
  retry/timeout/logger plumbing) is intentionally not in v0.0.1. We expect to
  re-add it later as an opt-in `LocalSignerOptions.client` field; that change
  is purely additive and will not break v0.0.1 call sites.
- **Webhook signature verification** — the header name and HMAC algorithm
  aren't currently documented in public Tesser docs.
- **Browser, edge, and React Native runtimes** — Node ≥ 18 / Bun ≥ 1.1 only.

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

Conventional commits. Changesets manage versions and the changelog
(`.changeset/`); see [`CHANGELOG.md`](./CHANGELOG.md). Release via
`bun run release`.

CI runs typecheck, lint, test, build on every PR (see
`.github/workflows/ci.yml`).

## License

[Apache License 2.0](./LICENSE). See [`NOTICE`](./NOTICE).

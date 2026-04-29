# @tesser-payments/sdk

A barebones TypeScript SDK for signing Tesser API operations with locally-held
Turnkey API keys.

## Status

Early checkpoint for foundational review. The SDK can:

- Construct a `TesserClient` from a bearer token plus signing config.
- Resolve account-id → on-chain address via `TesserClient.getAccountAddress`.
- Produce stamped wallet-creation signatures via
  `LocalSigner.signCreateWallet({ name, type })`. End-to-end verified
  against Tesser staging when the registered API key matches the format
  Turnkey expects (see [Setup notes](#setup-notes)).

Not yet implemented (planned next):

- `LocalSigner.signStep` for ERC-20 payouts (viem-driven tx construction,
  drpc-fallback RPC resolution, per-network token-address tables).

Out of scope for v0.0.1:

- OAuth `client_credentials` flow — the example script in `examples/`
  demonstrates the handshake; consumers handle token lifecycle and pass
  a fresh bearer to `TesserClient`.
- Webhook signature verification.
- Browser, edge, or React Native runtimes.

## Install

```sh
bun add @tesser-payments/sdk @tesser-payments/types @turnkey/api-key-stamper viem
```

The three peer dependencies are platform libraries you most likely already
have. `p-retry` is the only direct dependency.

## Quick start

```typescript
import { LocalSigner, TesserClient } from '@tesser-payments/sdk';

const tesser = new TesserClient({
  token: await getAccessToken(), // your OAuth flow; SDK does not own this
  signing: {
    publicKey: process.env.SIGNING_PUBLIC_KEY!,   // 33-byte compressed P-256
    privateKey: process.env.SIGNING_PRIVATE_KEY!,
    enclaveId: process.env.SIGNING_ENCLAVE_ID!,   // Turnkey suborg ID
  },
});

// Refresh anytime your OAuth helper hands you a new bearer:
tesser.setToken(await getAccessToken());

const signer = new LocalSigner(tesser);

const signed = await signer.signCreateWallet({
  name: 'My new wallet',
  type: 'stablecoin_ethereum',
});

// signed.signature is base64(JSON.stringify({ body, stamp })) — pass
// straight to Tesser's POST /v1/accounts/wallets request body.
```

A complete reference implementation including the OAuth handshake lives at
[`examples/create-wallet.ts`](./examples/create-wallet.ts).

## Configuration

`new TesserClient(config)` accepts:

| Option | Default | Notes |
|---|---|---|
| `token` | — (required) | Bearer token. Refresh via `setToken`. |
| `signing` | — (required) | `{ publicKey, privateKey, enclaveId }`. `publicKey` must be 33-byte compressed P-256 (66 hex chars, prefix `02` or `03`). |
| `baseUrl` | `https://api.tesser.xyz` | Override for staging. Trailing slashes and surrounding whitespace are stripped. |
| `rpcUrls` | `{}` | Per-network RPC URL map. Reserved for `signStep`; unused at the current checkpoint. |
| `timeout` | `30_000` ms | Per-request HTTP timeout. Override per call via `RequestOptions.timeout`. |
| `maxRetries` | `2` | Retries on `408`/`409`/`429`/`5xx` and connection errors. |
| `fetch` | `globalThis.fetch` | Inject a custom fetch (testing, proxies). |
| `logger` | console-based | Any object with `debug`/`info`/`warn`/`error` methods works (pino, winston, bunyan, console). |
| `logLevel` | `'warn'` | `'debug' \| 'info' \| 'warn' \| 'error' \| 'off'`. Overrides `TESSER_LOG` env var when set. |

`signing` is frozen after construction. To change RPC URLs, signing
config, or transport settings, build a new client.

## Errors

The SDK mirrors Tesser's documented error envelope
(see <https://docs.tesser.xyz/overviews/errors>) rather than inventing its
own taxonomy of HTTP statuses.

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

`TesserAPIError` carries the parsed `errors[]` array from Tesser's
response body. Branch on `errorCode` (Tesser's documented
`{domain}-{YZZZ}` codes) for fine-grained handling, on `status` for
broad category:

```typescript
import { TesserAPIError } from '@tesser-payments/sdk';

try {
  await signer.signCreateWallet({ name, type });
} catch (err) {
  if (TesserAPIError.is(err)) {
    if (err.hasCode('accounts-3005')) {
      // Turnkey stamp rejected — re-issue the API key registration.
    }
    if (err.status === 429) {
      // Retry budget exhausted — back off and re-attempt.
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
Non-Tesser-shaped responses (Cloudflare 502 pages, plain-text 503s) yield
`errors: []`; the original body lands in `err.message`.

## Examples

| Path | What it demonstrates |
|---|---|
| `examples/create-wallet.ts` | End-to-end: OAuth handshake, `TesserClient` + `LocalSigner` construction, `signCreateWallet`, and the wallet-creation POST to Tesser. Doubles as the manual verification harness. |
| `examples/lib/access-token.ts` | OAuth `client_credentials` helper. Reusable across future scripts; reads `AUTH_TOKEN_URL` env var or accepts an explicit override. |
| `examples/lib/require-env.ts` | Generic typed env-validation helper. |

Run with: `bun run examples/create-wallet.ts`. Bun loads `.env.local`
automatically. Copy [`.env.example`](./.env.example) and fill in the
values before running.

## Setup notes

The SDK requires `signing.publicKey` to be the **33-byte compressed**
form Turnkey uses for API-key auth lookups (66 hex chars, prefix `02`
or `03`). If you copy the public key from a dashboard that displays the
65-byte uncompressed form, compress it first:

```sh
# Using @turnkey/crypto, which also installs transitively:
bunx -p @turnkey/crypto node -e \
  'const c = require("@turnkey/crypto"); \
   const u = process.argv[1].replace(/^0x/i,""); \
   const b = Buffer.from(u, "hex"); \
   console.log(Buffer.from(c.compressRawPublicKey(b)).toString("hex"))' \
  04...your-uncompressed-key...
```

If a key registered through a dashboard "Generate Key" flow is stored
in uncompressed form on Turnkey's side, Turnkey will reject auth with
`PUBLIC_KEY_NOT_FOUND` even though the keypair is logically correct —
register the key in compressed form to fix.

## Development

```sh
bun install
bun run typecheck     # tsc --noEmit
bun run lint          # biome check .
bun run lint:fix      # biome check . --write
bun run test          # vitest
bun run test:watch
bun run build         # bun build (JS) + tsc --emitDeclarationOnly (.d.ts)
```

The build emits `dist/index.js` (ESM) and `dist/index.d.ts`. `@internal`-
tagged accessors are stripped from the published declarations via
`stripInternal: true` in `tsconfig.build.json`.

CI runs typecheck, lint, test, build on every PR (see
`.github/workflows/ci.yml`). Concurrency-cancel is enabled for
pull-request events.

## Repository layout

```
src/
├── index.ts          public barrel
├── client.ts         TesserClient — config, setToken, getAccountAddress
├── signer.ts         LocalSigner — signCreateWallet (signStep planned)
├── signing/
│   ├── stamp.ts      thin @turnkey/api-key-stamper wrapper
│   └── create-wallet.ts
└── internal/
    ├── errors.ts     full hierarchy with Tesser errors[] envelope
    ├── http.ts       fetchWithRetry: timeout, retry, error mapping
    ├── logger.ts     duck-typed Logger + recursive redactor
    └── types.ts      SDK-local types
examples/
├── create-wallet.ts  E2E reference + verification harness
└── lib/
    ├── access-token.ts
    └── require-env.ts
test/                 vitest specs mirroring src/
```

// examples/create-wallet.ts
//
// Run: bun run examples/create-wallet.ts
// Loads .env.local. Required env vars listed in .env.example.
//
// This example creates a managed Ethereum wallet. Solana and Stellar create-wallet
// paths are not exercised here — Stellar is supported by Tesser only as a receive
// (unmanaged) wallet, and the Solana managed path is unverified end-to-end.
//
// Sequence:
//   1. Load env + OAuth client_credentials token
//   2. LocalSigner({ signing }).signCreateWallet({ name, type: 'stablecoin_ethereum' })
//   3. POST /v1/accounts/wallets with the signature (is_managed: true)
//   4. Log response or fail loudly
import { LocalSigner } from '../src/index.js';
import { getAccessToken } from './lib/oauth.js';
import { requireEnv } from './lib/require-env.js';

const env = requireEnv([
  'API_BASE_URL',
  'AUTH_TOKEN_URL',
  'API_CLIENT_ID',
  'API_CLIENT_SECRET',
  'SIGNING_PUBLIC_KEY',
  'SIGNING_PRIVATE_KEY',
  'SIGNING_ENCLAVE_ID',
] as const);

const walletName = `example-${Date.now()}`;

const token = await getAccessToken(env.API_BASE_URL, env.API_CLIENT_ID, env.API_CLIENT_SECRET);

const signer = new LocalSigner({
  signing: {
    publicKey: env.SIGNING_PUBLIC_KEY,
    privateKey: env.SIGNING_PRIVATE_KEY,
    enclaveId: env.SIGNING_ENCLAVE_ID,
  },
});

const { signature } = await signer.signCreateWallet({
  name: walletName,
  type: 'stablecoin_ethereum',
});

const response = await fetch(`${env.API_BASE_URL}/v1/accounts/wallets`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  body: JSON.stringify({
    signature,
    name: walletName,
    type: 'stablecoin_ethereum',
    is_managed: true,
  }),
});

const responseText = await response.text();
if (!response.ok) {
  console.error(`POST /v1/accounts/wallets failed (${response.status}): ${responseText}`);
  process.exit(1);
}

console.log('Wallet created successfully:', responseText);

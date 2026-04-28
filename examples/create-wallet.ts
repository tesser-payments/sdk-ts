// examples/create-wallet.ts
//
// End-to-end verification + reference implementation for `signCreateWallet`.
// Run with: `bun run examples/create-wallet.ts`
//
// Bun loads `.env.local` automatically. Copy `.env.example` to `.env.local`
// and fill in the values before running.

import { LocalSigner, TesserClient, type WalletType } from '../src/index.js';
import { getAccessToken } from './lib/access-token.js';
import { requireEnv } from './lib/require-env.js';

const REQUIRED_ENV = [
  'API_BASE_URL',
  'API_CLIENT_ID',
  'API_CLIENT_SECRET',
  'CREATE_WALLET_TYPE',
  'SIGNING_PUBLIC_KEY',
  'SIGNING_PRIVATE_KEY',
  'SIGNING_ENCLAVE_ID',
] as const;

async function main() {
  const env = requireEnv(REQUIRED_ENV);
  console.log('[1/4] Fetching access token...');
  // The token's `audience` is the API host the token will be presented to.
  const token = await getAccessToken(env.API_BASE_URL, env.API_CLIENT_ID, env.API_CLIENT_SECRET);

  console.log('[2/4] Constructing TesserClient + LocalSigner...');
  const tesser = new TesserClient({
    token,
    baseUrl: env.API_BASE_URL,
    signing: {
      publicKey: env.SIGNING_PUBLIC_KEY,
      privateKey: env.SIGNING_PRIVATE_KEY,
      enclaveId: env.SIGNING_ENCLAVE_ID,
    },
  });
  const signer = new LocalSigner(tesser);

  const name = `SDK verification wallet ${new Date().toISOString()}`;
  const type = env.CREATE_WALLET_TYPE as WalletType;

  console.log(`[3/4] Signing wallet creation: name="${name}" type="${type}"`);
  const signed = await signer.signCreateWallet({ name, type });

  console.log('[4/4] POST /v1/accounts/wallets...');
  const createRes = await fetch(`${env.API_BASE_URL}/v1/accounts/wallets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      signature: signed.signature,
      name,
      type,
      is_managed: true,
    }),
  });

  const responseBody = await createRes.text();
  if (!createRes.ok) {
    console.error(`Wallet creation failed: ${createRes.status} ${createRes.statusText}`);
    console.error(responseBody);
    process.exit(1);
  }

  console.log('Wallet created successfully:');
  console.log(responseBody);
}

main().catch((err) => {
  console.error('Verification script failed:', err);
  process.exit(1);
});

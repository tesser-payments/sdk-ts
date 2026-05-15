// examples/create-wallet.ts
//
// Run: bun run examples/create-wallet.ts
// Loads .env.local. Required env vars listed in .env.example.
//
// Sequence:
//   1. Load env + OAuth client_credentials token
//   2. LocalSigner({ signing }).signCreateWallet({ name, type })
//   3. POST /v1/accounts/wallets with the signature
//   4. Log response or fail loudly
import { LocalSigner, type WalletType } from '../src/index.js';
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
  'CREATE_WALLET_TYPE',
] as const);

const walletType = env.CREATE_WALLET_TYPE as WalletType;
const walletName = `example-${Date.now()}`;

const token = await getAccessToken(env.API_BASE_URL, env.API_CLIENT_ID, env.API_CLIENT_SECRET);

const signer = new LocalSigner({
  signing: {
    publicKey: env.SIGNING_PUBLIC_KEY,
    privateKey: env.SIGNING_PRIVATE_KEY,
    enclaveId: env.SIGNING_ENCLAVE_ID,
  },
});

const { signature } = await signer.signCreateWallet({ name: walletName, type: walletType });

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
    type: walletType,
    is_managed: true,
  }),
});

const responseText = await response.text();
if (!response.ok) {
  console.error(`POST /v1/accounts/wallets failed (${response.status}): ${responseText}`);
  process.exit(1);
}

console.log('Wallet created successfully:', responseText);

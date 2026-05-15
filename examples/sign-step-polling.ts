// examples/sign-step-polling.ts
//
// Full rebalance signing flow driven by polling (no webhooks).
// Run: bun run examples/sign-step-polling.ts
//
// Sequence:
//   1. Load env + OAuth client_credentials token
//   2. POST /v1/treasury/rebalances
//   3. Poll GET /v1/treasury/rebalances/{id} every 2s until first step has
//      status=signature_requested and unsigned_transaction is populated.
//   4. Fetch crypto_wallet_address via GET /v1/accounts/{fromAccountId}
//   5. LocalSigner.signStep(...)
//   6. POST /v1/treasury/rebalances/{id}/steps/{stepId}/sign
//   7. Poll until step.status == 'completed' (or fail if any failed_at)
//   8. Print final summary
import { LocalSigner, type StepForSigning } from '../src/index.js';
import { getAccessToken } from './lib/oauth.js';
import { optionalEnv, requireEnv } from './lib/require-env.js';

const env = requireEnv([
  'API_BASE_URL',
  'AUTH_TOKEN_URL',
  'API_CLIENT_ID',
  'API_CLIENT_SECRET',
  'SIGNING_PUBLIC_KEY',
  'SIGNING_PRIVATE_KEY',
  'SIGNING_ENCLAVE_ID',
  'FROM_ACCOUNT_ID',
  'TO_ACCOUNT_ID',
] as const);

const FROM_AMOUNT = optionalEnv('FROM_AMOUNT', '0.000001');
const FROM_CURRENCY = optionalEnv('FROM_CURRENCY', 'USDC');
const FROM_NETWORK = optionalEnv('FROM_NETWORK', 'BASE_SEPOLIA');
const TO_CURRENCY = optionalEnv('TO_CURRENCY', 'USDC');
const TO_NETWORK = optionalEnv('TO_NETWORK', 'BASE_SEPOLIA');

const SIGNATURE_REQUESTED_TIMEOUT_MS = 2 * 60 * 1000;
const COMPLETED_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 2_000;

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

type AuthedInit = RequestInit & { token: string };

async function authedFetch(url: string, init: AuthedInit): Promise<Response> {
  const { token, headers: extraHeaders, ...rest } = init;
  return fetch(url, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(extraHeaders ?? {}),
    },
  });
}

// biome-ignore lint/suspicious/noExplicitAny: API response shape varies per endpoint
async function jsonOrThrow(res: Response, ctx: string): Promise<any> {
  const text = await res.text();
  if (!res.ok) throw new Error(`${ctx} failed (${res.status}): ${text}`);
  return JSON.parse(text);
}

const token = await getAccessToken(env.API_BASE_URL, env.API_CLIENT_ID, env.API_CLIENT_SECRET);

console.log('Creating rebalance...');
const rebalanceRes = await authedFetch(`${env.API_BASE_URL}/v1/treasury/rebalances`, {
  method: 'POST',
  body: JSON.stringify({
    desired: {
      from: {
        account_id: env.FROM_ACCOUNT_ID,
        amount: FROM_AMOUNT,
        currency: FROM_CURRENCY,
        network: FROM_NETWORK,
      },
      to: {
        account_id: env.TO_ACCOUNT_ID,
        currency: TO_CURRENCY,
        network: TO_NETWORK,
      },
    },
  }),
  token,
});
const rebalance = await jsonOrThrow(rebalanceRes, 'POST /v1/treasury/rebalances');
const rebalanceId: string = rebalance.data?.id ?? rebalance.id;
if (!rebalanceId) throw new Error(`Rebalance response missing id: ${JSON.stringify(rebalance)}`);
console.log(`Rebalance ${rebalanceId} created`);

console.log('Polling until status=signature_requested ...');
const sigDeadline = Date.now() + SIGNATURE_REQUESTED_TIMEOUT_MS;
// biome-ignore lint/suspicious/noExplicitAny: step DTO shape mirrors API
let pendingStep: any | null = null;
while (Date.now() < sigDeadline) {
  const r = await authedFetch(`${env.API_BASE_URL}/v1/treasury/rebalances/${rebalanceId}`, {
    token,
  });
  const rb = (await jsonOrThrow(r, `GET rebalance ${rebalanceId}`)).data ?? {};
  // biome-ignore lint/suspicious/noExplicitAny: see above
  const steps: any[] = rb.steps ?? [];
  pendingStep = steps.find(
    (s) =>
      s.status === 'signature_requested' &&
      typeof s.unsigned_transaction === 'string' &&
      s.unsigned_transaction.length > 0,
  );
  if (pendingStep) break;
  await sleep(POLL_INTERVAL_MS);
}
if (!pendingStep) {
  throw new Error(`No signature_requested step within ${SIGNATURE_REQUESTED_TIMEOUT_MS}ms`);
}
console.log(`Step ${pendingStep.id} ready for signing`);

console.log('Fetching signWith address ...');
const acctRes = await authedFetch(
  `${env.API_BASE_URL}/v1/accounts/${encodeURIComponent(env.FROM_ACCOUNT_ID)}`,
  { token },
);
const acct = await jsonOrThrow(acctRes, `GET /v1/accounts/${env.FROM_ACCOUNT_ID}`);
const signWith: string = acct.data?.crypto_wallet_address ?? acct.crypto_wallet_address;
if (!signWith) throw new Error('account.crypto_wallet_address missing');

const signer = new LocalSigner({
  signing: {
    publicKey: env.SIGNING_PUBLIC_KEY,
    privateKey: env.SIGNING_PRIVATE_KEY,
    enclaveId: env.SIGNING_ENCLAVE_ID,
  },
});

const stepForSigning: StepForSigning = {
  id: pendingStep.id,
  transferId: rebalanceId,
  unsignedTransaction: pendingStep.unsigned_transaction,
  signWith,
  network: FROM_NETWORK,
};

console.log('Signing step locally ...');
const signed = await signer.signStep(stepForSigning);

console.log('Submitting signature ...');
const submitRes = await authedFetch(
  `${env.API_BASE_URL}/v1/treasury/rebalances/${rebalanceId}/steps/${pendingStep.id}/sign`,
  { method: 'POST', body: JSON.stringify({ signature: signed.signature }), token },
);
await jsonOrThrow(submitRes, 'POST step sign');

console.log("Polling until step's status is `completed` ...");
const completedDeadline = Date.now() + COMPLETED_TIMEOUT_MS;
let lastStatus: string | undefined;
// biome-ignore lint/suspicious/noExplicitAny: step DTO shape mirrors API
let finalStep: any | null = null;
while (Date.now() < completedDeadline) {
  const r = await authedFetch(`${env.API_BASE_URL}/v1/treasury/rebalances/${rebalanceId}`, {
    token,
  });
  const rb = (await jsonOrThrow(r, `GET rebalance ${rebalanceId}`)).data ?? {};
  // biome-ignore lint/suspicious/noExplicitAny: see above
  const step = (rb.steps ?? []).find((s: any) => s.id === pendingStep.id);
  if (!step) throw new Error(`Step ${pendingStep.id} disappeared from rebalance`);
  if (step.status !== lastStatus) {
    console.log(
      `  step status=${step.status} completed_at=${step.completed_at} failed_at=${step.failed_at}`,
    );
    lastStatus = step.status;
  }
  if (step.failed_at) {
    throw new Error(
      `Step failed_at=${step.failed_at} status_reasons=${JSON.stringify(step.status_reasons ?? [])}`,
    );
  }
  if (step.status === 'completed') {
    finalStep = step;
    break;
  }
  await sleep(POLL_INTERVAL_MS);
}
if (!finalStep) throw new Error(`Step did not complete within ${COMPLETED_TIMEOUT_MS}ms`);

console.log(
  `Rebalance complete. step.id=${finalStep.id} status=${finalStep.status} completed_at=${finalStep.completed_at}`,
);

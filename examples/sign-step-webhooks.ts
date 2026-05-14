// examples/sign-step-webhooks.ts
//
// Full rebalance signing flow driven by webhooks (not polling).
// Run: bun run examples/sign-step-webhooks.ts
//
// You must expose this listener publicly (cloudflared, ngrok, localhost.run, etc.)
// and register the tunnel's URL in the Tesser dashboard subscribed to all
// `step.*` events. The example filters by data.object.status + data.object.id
// so concurrent rebalances don't cross-trigger.
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import { LocalSigner, type StepForSigning } from '../src/index.js';
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
  'FROM_ACCOUNT_ID',
  'FROM_AMOUNT',
  'FROM_CURRENCY',
  'FROM_NETWORK',
  'TO_ACCOUNT_ID',
  'TO_CURRENCY',
  'TO_NETWORK',
  'WEBHOOK_PORT',
] as const);

// biome-ignore lint/suspicious/noExplicitAny: webhook envelope shape varies per event
type WebhookEnvelope = Record<string, any>;

class WebhookListener {
  private readonly events: WebhookEnvelope[] = [];
  private resolvers: Array<(env: WebhookEnvelope) => void> = [];

  push(env: WebhookEnvelope) {
    const r = this.resolvers.shift();
    if (r) r(env);
    else this.events.push(env);
  }

  receive(): Promise<WebhookEnvelope> {
    const next = this.events.shift();
    if (next !== undefined) return Promise.resolve(next);
    return new Promise<WebhookEnvelope>((r) => this.resolvers.push(r));
  }

  async awaitEventWhere(
    predicate: (env: WebhookEnvelope) => boolean,
    timeoutMs: number,
    label: string,
  ): Promise<WebhookEnvelope> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const next = await Promise.race([
        this.receive(),
        new Promise<null>((r) => setTimeout(() => r(null), remaining)),
      ]);
      if (next === null) break;
      if (predicate(next)) return next;
      console.log(
        `  (skipping webhook event — ${label} not satisfied; type=${next.type} id=${next.id})`,
      );
    }
    throw new Error(`Timed out waiting for: ${label}`);
  }
}

const listener = new WebhookListener();
const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end();
    return;
  }
  // TODO: verify the webhook signature header before trusting the payload.
  //   The exact header name and algorithm aren't currently documented in
  //   the public Tesser docs; until verification lands, this handler accepts
  //   every incoming POST. Do NOT run against production.
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
      listener.push(body);
      res.statusCode = 204;
      res.end();
    } catch (e) {
      console.error('Failed to parse webhook body:', e);
      res.statusCode = 400;
      res.end();
    }
  });
});

const port = Number.parseInt(env.WEBHOOK_PORT, 10);
server.listen(port, () => console.log(`Webhook listener on :${port}`));

try {
  const token = await getAccessToken(env.AUTH_TOKEN_URL, env.API_CLIENT_ID, env.API_CLIENT_SECRET);

  console.log('Creating rebalance ...');
  const rebRes = await fetch(`${env.API_BASE_URL}/v1/treasury/rebalances`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      from: {
        account_id: env.FROM_ACCOUNT_ID,
        amount: env.FROM_AMOUNT,
        currency: env.FROM_CURRENCY,
        network: env.FROM_NETWORK,
      },
      to: {
        account_id: env.TO_ACCOUNT_ID,
        currency: env.TO_CURRENCY,
        network: env.TO_NETWORK,
      },
    }),
  });
  if (!rebRes.ok) {
    throw new Error(`POST rebalance failed: ${rebRes.status} ${await rebRes.text()}`);
  }
  // biome-ignore lint/suspicious/noExplicitAny: API response shape mirrors Tesser docs
  const rebalance: any = await rebRes.json();
  const rebalanceId: string = rebalance.id;
  console.log(`Rebalance ${rebalanceId} created; awaiting step.signature_requested ...`);

  const sigEnvelope = await listener.awaitEventWhere(
    (e) => e?.data?.object?.status === 'signature_requested',
    60_000,
    'signature_requested',
  );
  const stepObj = sigEnvelope.data.object;
  const stepId: string = stepObj.id;

  console.log(`Fetching signWith for step ${stepId} ...`);
  const acctRes = await fetch(
    `${env.API_BASE_URL}/v1/accounts/${encodeURIComponent(env.FROM_ACCOUNT_ID)}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
  );
  if (!acctRes.ok) {
    throw new Error(`GET account failed: ${acctRes.status} ${await acctRes.text()}`);
  }
  // biome-ignore lint/suspicious/noExplicitAny: see above
  const acct: any = await acctRes.json();
  const signWith: string = acct.crypto_wallet_address;
  if (!signWith) throw new Error('account.crypto_wallet_address missing');

  const signer = new LocalSigner({
    signing: {
      publicKey: env.SIGNING_PUBLIC_KEY,
      privateKey: env.SIGNING_PRIVATE_KEY,
      enclaveId: env.SIGNING_ENCLAVE_ID,
    },
  });

  // Webhook step DTO uses `rebalance_id` for the parent UUID;
  // GET-rebalance uses `transfer_id`. Both name the same value.
  const transferId: string = stepObj.rebalance_id ?? stepObj.transfer_id ?? rebalanceId;

  const stepForSigning: StepForSigning = {
    id: stepId,
    transferId,
    unsignedTransaction: stepObj.unsigned_transaction,
    signWith,
    network: env.FROM_NETWORK,
  };

  console.log('Signing locally ...');
  const signed = await signer.signStep(stepForSigning);

  console.log('Submitting signature ...');
  const submitRes = await fetch(
    `${env.API_BASE_URL}/v1/treasury/rebalances/${rebalanceId}/steps/${stepId}/sign`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ signature: signed.signature }),
    },
  );
  if (!submitRes.ok) {
    throw new Error(`POST sign failed: ${submitRes.status} ${await submitRes.text()}`);
  }

  console.log(`Awaiting step ${stepId} status=completed ...`);
  const completedEnvelope = await listener.awaitEventWhere(
    (e) => e?.data?.object?.id === stepId && e?.data?.object?.status === 'completed',
    5 * 60 * 1000,
    `step ${stepId} status=completed`,
  );
  const completedStep = completedEnvelope.data.object;
  console.log(
    `Rebalance complete. step.id=${completedStep.id} status=${completedStep.status} completed_at=${completedStep.completed_at}`,
  );
} finally {
  server.close();
}

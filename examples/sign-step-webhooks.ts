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
import { LocalSigner, type StepForSigning, type SupportedNetwork } from '../src/index.js';
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
// Cast at the env boundary — callers control which network they target via env config.
const FROM_NETWORK = optionalEnv('FROM_NETWORK', 'BASE_SEPOLIA') as SupportedNetwork;
const TO_CURRENCY = optionalEnv('TO_CURRENCY', 'USDC');
const TO_NETWORK = optionalEnv('TO_NETWORK', 'BASE_SEPOLIA');
const WEBHOOK_PORT = optionalEnv('WEBHOOK_PORT', '8787');

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
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<null>((r) => {
        timer = setTimeout(() => r(null), remaining);
      });
      const next = await Promise.race([this.receive(), timeout]);
      clearTimeout(timer);
      if (next === null) break;
      if (predicate(next)) return next;
      console.log(
        `  (skipping webhook event — ${label} not satisfied; type=${next.type} id=${next.id})`,
      );
    }
    throw new Error(`Timed out waiting for: ${label}`);
  }
}

// Generous bound — Tesser step webhooks are kilobytes at most. Caps memory
// use if a misbehaving sender (bug or attacker) tries to push a giant body.
const MAX_BODY_BYTES = 1_048_576; // 1 MB

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
  let received = 0;
  let rejected = false;
  req.on('data', (c: Buffer) => {
    if (rejected) return;
    received += c.length;
    if (received > MAX_BODY_BYTES) {
      rejected = true;
      res.statusCode = 413;
      res.end();
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    if (rejected) return;
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

const port = Number.parseInt(WEBHOOK_PORT, 10);
server.listen(port, () => console.log(`Webhook listener on :${port}`));

try {
  const token = await getAccessToken(env.API_BASE_URL, env.API_CLIENT_ID, env.API_CLIENT_SECRET);

  console.log('Creating rebalance ...');
  const rebRes = await fetch(`${env.API_BASE_URL}/v1/treasury/rebalances`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
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
  });
  if (!rebRes.ok) {
    throw new Error(`POST rebalance failed: ${rebRes.status} ${await rebRes.text()}`);
  }
  // biome-ignore lint/suspicious/noExplicitAny: API response shape mirrors Tesser docs
  const rebalance: any = await rebRes.json();
  const rebalanceId: string = rebalance.data?.id ?? rebalance.id;
  if (!rebalanceId) throw new Error(`Rebalance response missing id: ${JSON.stringify(rebalance)}`);
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
    unsignedTransaction: stepObj.unsigned_transaction,
    signWith,
    network: FROM_NETWORK,
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
  server.closeAllConnections();
  server.close();
}

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TesserAPIError,
  TesserConfigError,
  TesserConnectionError,
  TesserSigningError,
  TesserTimeoutError,
} from '../../src/internal/errors.js';
import type { SigningConfig } from '../../src/internal/types.js';
import { signCreateWallet } from '../../src/signing/create-wallet.js';
import * as stampModule from '../../src/signing/stamp.js';
import {
  type TesserApiConnection,
  createTesserApiConnection,
  normalizeApiBaseUrl,
} from '../../src/signing/unsigned-payload.js';

const ETHEREUM_RESPONSE = readFileSync(
  new URL('../fixtures/unsigned-payload/create-wallet-accounts-ethereum.json', import.meta.url),
  'utf-8',
);
const ETHEREUM_BODY: string = JSON.parse(ETHEREUM_RESPONSE).data.body;
const ORGANIZATION_ID = '846abdbb-d019-4d97-9404-0f7cfc113b2c';
const PRODUCTION_URL = 'https://api.tesser.xyz';
const SANDBOX_URL = 'https://api-sandbox.tesser.xyz';
const PRODUCTION_HOST = 'api.tesser.xyz';
const SANDBOX_HOST = 'api-sandbox.tesser.xyz';
const WALLET_NAME = 'sdk-ts-stg-1794141558';
const NOW_MS = 1_700_000_000_000;
const PACKAGE_VERSION: string = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'),
).version;

const signing: SigningConfig = {
  publicKey: '02'.padEnd(66, 'a'),
  privateKey: 'b'.repeat(64),
  enclaveId: ORGANIZATION_ID,
};

const ethereumParams = { name: WALLET_NAME, type: 'stablecoin_ethereum' } as const;

interface RecordedRequest {
  url: string;
  init: RequestInit;
}

function stubFetch(respond: () => Promise<Response>): {
  fetch: typeof fetch;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const fetchStub = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init: init ?? {} });
    return respond();
  }) as typeof fetch;
  return { fetch: fetchStub, requests };
}

function respondingWith(status: number, body: string, headers: Record<string, string> = {}) {
  return stubFetch(async () => new Response(body, { status, headers }));
}

function failingWith(error: unknown) {
  return stubFetch(async () => {
    throw error;
  });
}

function connectionTo(fetchImplementation: typeof fetch): TesserApiConnection {
  return createTesserApiConnection({ apiBaseUrl: PRODUCTION_URL, fetch: fetchImplementation });
}

function detectingConnection(fetchImplementation: typeof fetch): TesserApiConnection {
  return createTesserApiConnection({ apiBaseUrl: undefined, fetch: fetchImplementation });
}

type Responder = () => Promise<Response>;

function routingByHost(routes: Record<string, Responder[]>): {
  fetch: typeof fetch;
  requests: RecordedRequest[];
  hosts: () => string[];
} {
  const requests: RecordedRequest[] = [];
  const fetchStub = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init: init ?? {} });
    const respond = routes[new URL(url).host]?.shift();
    if (respond === undefined) {
      throw new Error(`unexpected request to ${url}`);
    }
    return respond();
  }) as typeof fetch;
  const hosts = () => requests.map((request) => new URL(request.url).host);
  return { fetch: fetchStub, requests, hosts };
}

function answer(status: number, body: string, headers: Record<string, string> = {}): Responder {
  return async () => new Response(body, { status, headers });
}

function answerOk(body = ETHEREUM_BODY): Responder {
  return answer(200, responseWithBody(body));
}

function answerWithErrorCode(status: number, errorCode: string, requestId: string): Responder {
  const envelope = JSON.stringify({
    errors: [{ error_code: errorCode, error_message: 'Request rejected.' }],
  });
  return answer(status, envelope, { 'zp-rid': requestId });
}

function answerStampRejected(requestId: string): Responder {
  return answerWithErrorCode(401, 'signing-4010', requestId);
}

function answerFailingWith(error: unknown): Responder {
  return async () => {
    throw error;
  };
}

function stampHeaderOf(request: RecordedRequest | undefined): unknown {
  return (request?.init.headers as Record<string, string> | undefined)?.['X-Stamp'];
}

async function signEthereumWallet(api: TesserApiConnection) {
  return signCreateWallet(signing, ethereumParams, api);
}

async function signEthereumWalletError(api: TesserApiConnection): Promise<unknown> {
  return signEthereumWallet(api).catch((caught: unknown) => caught);
}

function responseWithBody(body: string): string {
  return JSON.stringify({ data: { organization_id: ORGANIZATION_ID, body } });
}

interface EditableAccount {
  name: string;
  addressFormat: string;
}

interface EditablePayload {
  type: string;
  timestampMs: string;
  organizationId: string;
  parameters: { accounts: EditableAccount[] } | undefined;
}

function ethereumBodyWith(change: (payload: EditablePayload) => void): string {
  const payload: EditablePayload = JSON.parse(ETHEREUM_BODY);
  change(payload);
  return JSON.stringify(payload);
}

function onlyAccount(payload: EditablePayload): EditableAccount {
  const account = payload.parameters?.accounts[0];
  if (account === undefined) {
    throw new Error('fixture has no account');
  }
  return account;
}

function decodeSignature(signature: string): { body: string; stamp: string } {
  return JSON.parse(Buffer.from(signature, 'base64').toString('utf-8'));
}

let stampSpy = vi.spyOn(stampModule, 'stamp');

beforeEach(() => {
  stampSpy = vi.spyOn(stampModule, 'stamp').mockImplementation(async (_keys, body) => ({
    stampHeaderName: 'X-Stamp',
    stampHeaderValue: `stamp-of:${body}`,
  }));
  vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('signCreateWallet for stablecoin_ethereum', () => {
  it('stamps the fetched body unchanged and returns the base64 {body, stamp} envelope', async () => {
    const stub = respondingWith(200, ETHEREUM_RESPONSE);

    const result = await signCreateWallet(signing, ethereumParams, connectionTo(stub.fetch));

    expect(result.metadata.body).toBe(ETHEREUM_BODY);
    expect(result.metadata.stampHeaderValue).toBe(`stamp-of:${ETHEREUM_BODY}`);
    expect(decodeSignature(result.signature)).toEqual({
      body: ETHEREUM_BODY,
      stamp: `stamp-of:${ETHEREUM_BODY}`,
    });
    expect(stampSpy).toHaveBeenLastCalledWith(
      { publicKey: signing.publicKey, privateKey: signing.privateKey },
      ETHEREUM_BODY,
    );
  });

  it('stamps the canonical query message and sends one GET with the stamp', async () => {
    const stub = respondingWith(200, ETHEREUM_RESPONSE);
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');

    await signCreateWallet(signing, ethereumParams, connectionTo(stub.fetch));

    const canonicalMessage = `{"organizationId":"${ORGANIZATION_ID}","name":"${WALLET_NAME}","type":"stablecoin_ethereum","timestampMs":"${NOW_MS}"}`;
    expect(stampSpy).toHaveBeenNthCalledWith(
      1,
      { publicKey: signing.publicKey, privateKey: signing.privateKey },
      canonicalMessage,
    );
    expect(stub.requests).toHaveLength(1);
    const request = stub.requests[0];
    expect(request?.url).toBe(
      `https://api.tesser.xyz/v1/accounts/wallets/unsigned-payload?organizationId=${ORGANIZATION_ID}&name=${WALLET_NAME}&type=stablecoin_ethereum&timestampMs=${NOW_MS}`,
    );
    expect(request?.init.method).toBe('GET');
    expect(request?.init.headers).toEqual({
      Accept: 'application/json',
      'X-Stamp': `stamp-of:${canonicalMessage}`,
      'User-Agent': `tesser-sdk-ts/${PACKAGE_VERSION}`,
    });
    expect(request?.init.signal).toBeInstanceOf(AbortSignal);
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
  });

  it('percent-encodes query values', async () => {
    const name = 'My wallet & co';
    const body = ethereumBodyWith((payload) => {
      onlyAccount(payload).name = name;
    });
    const stub = respondingWith(200, responseWithBody(body));

    await signCreateWallet(
      signing,
      { name, type: 'stablecoin_ethereum' },
      connectionTo(stub.fetch),
    );

    expect(stub.requests[0]?.url).toContain('name=My%20wallet%20%26%20co&');
  });

  it.each([
    [
      'the activity type differs',
      ethereumBodyWith((payload) => {
        payload.type = 'ACTIVITY_TYPE_CREATE_WALLET';
      }),
    ],
    [
      'the organizationId differs from the enclaveId',
      ethereumBodyWith((payload) => {
        payload.organizationId = 'another-organization';
      }),
    ],
    [
      'there are no accounts',
      ethereumBodyWith((payload) => {
        payload.parameters = { accounts: [] };
      }),
    ],
    [
      'there are two accounts',
      ethereumBodyWith((payload) => {
        payload.parameters = { accounts: [onlyAccount(payload), onlyAccount(payload)] };
      }),
    ],
    [
      'the account name differs',
      ethereumBodyWith((payload) => {
        onlyAccount(payload).name = 'another-wallet';
      }),
    ],
    [
      'the address format is not Ethereum',
      ethereumBodyWith((payload) => {
        onlyAccount(payload).addressFormat = 'ADDRESS_FORMAT_SOLANA';
      }),
    ],
    [
      'the parameters are missing',
      ethereumBodyWith((payload) => {
        payload.parameters = undefined;
      }),
    ],
    ['the body is not JSON', 'not-json'],
  ])('throws TesserSigningError and stamps nothing when %s', async (_label, body) => {
    const stub = respondingWith(200, responseWithBody(body));

    await expect(
      signCreateWallet(signing, ethereumParams, connectionTo(stub.fetch)),
    ).rejects.toBeInstanceOf(TesserSigningError);
    expect(stampSpy).toHaveBeenCalledOnce();
    expect(stampSpy).not.toHaveBeenCalledWith(expect.anything(), body);
  });

  it('throws TesserAPIError when a 2xx response has no data.body', async () => {
    const stub = respondingWith(200, '{"data":{}}', { 'zp-rid': 'rid-1' });

    const error = await signCreateWallet(signing, ethereumParams, connectionTo(stub.fetch)).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(TesserAPIError);
    expect((error as TesserAPIError).status).toBe(200);
    expect((error as TesserAPIError).requestId).toBe('rid-1');
  });
});

describe('signCreateWallet request failures', () => {
  it('maps a non-2xx response to TesserAPIError, preferring zp-rid', async () => {
    const stub = respondingWith(
      401,
      JSON.stringify({
        errors: [
          {
            error_code: 'signing-4010',
            error_message: 'Signature is not valid.',
            ui_message: 'Check your signing key.',
          },
        ],
      }),
      { 'zp-rid': 'zp-request', 'x-request-id': 'fallback-request' },
    );

    const error = (await signCreateWallet(signing, ethereumParams, connectionTo(stub.fetch)).catch(
      (caught: unknown) => caught,
    )) as TesserAPIError;

    expect(error).toBeInstanceOf(TesserAPIError);
    expect(error.status).toBe(401);
    expect(error.requestId).toBe('zp-request');
    expect(error.headers?.get('x-request-id')).toBe('fallback-request');
    expect(error.errorCode).toBe('signing-4010');
    expect(error.errors).toEqual([
      {
        errorCode: 'signing-4010',
        errorMessage: 'Signature is not valid.',
        uiMessage: 'Check your signing key.',
      },
    ]);
    expect(stampSpy).toHaveBeenCalledOnce();
  });

  it('falls back to x-request-id and returns no errors for a non-Tesser body', async () => {
    const stub = respondingWith(503, '<html>Service Unavailable</html>', {
      'x-request-id': 'fallback-request',
    });

    const error = (await signCreateWallet(signing, ethereumParams, connectionTo(stub.fetch)).catch(
      (caught: unknown) => caught,
    )) as TesserAPIError;

    expect(error).toBeInstanceOf(TesserAPIError);
    expect(error.status).toBe(503);
    expect(error.requestId).toBe('fallback-request');
    expect(error.errors).toEqual([]);
    expect(error.errorCode).toBeUndefined();
  });

  it('leaves requestId unset when no request id header is present', async () => {
    const stub = respondingWith(404, '{"errors":[]}');

    const error = (await signCreateWallet(signing, ethereumParams, connectionTo(stub.fetch)).catch(
      (caught: unknown) => caught,
    )) as TesserAPIError;

    expect(error.status).toBe(404);
    expect(error.requestId).toBeUndefined();
  });

  it('maps a network failure to TesserConnectionError naming the underlying failure', async () => {
    const underlying = new Error('getaddrinfo ENOTFOUND api.example.invalid');
    const failure = new TypeError('fetch failed', { cause: underlying });
    const stub = failingWith(failure);

    const error = (await signCreateWallet(signing, ethereumParams, connectionTo(stub.fetch)).catch(
      (caught: unknown) => caught,
    )) as TesserConnectionError;

    expect(error).toBeInstanceOf(TesserConnectionError);
    expect(error.message).toContain('fetch failed');
    expect(error.message).toContain('getaddrinfo ENOTFOUND api.example.invalid');
    expect(error.cause).toBe(failure);
  });

  it('names the failure type when no error in the chain has a message', async () => {
    class SocketClosedError extends Error {
      override name = 'SocketClosedError';
    }
    const stub = failingWith(new TypeError('', { cause: new SocketClosedError() }));

    const error = (await signCreateWallet(signing, ethereumParams, connectionTo(stub.fetch)).catch(
      (caught: unknown) => caught,
    )) as TesserConnectionError;

    expect(error).toBeInstanceOf(TesserConnectionError);
    expect(error.message).toContain('SocketClosedError');
    expect(error.message).not.toMatch(/undefined|null/);
  });

  it('maps a timeout to TesserTimeoutError', async () => {
    const stub = failingWith(new DOMException('The operation timed out.', 'TimeoutError'));

    await expect(
      signCreateWallet(signing, ethereumParams, connectionTo(stub.fetch)),
    ).rejects.toBeInstanceOf(TesserTimeoutError);
  });

  it('aborts a request that does not answer with TesserTimeoutError', async () => {
    const timeoutController = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal);
    const hangingFetch = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );

    const pending = signCreateWallet(signing, ethereumParams, connectionTo(hangingFetch));
    await vi.waitFor(() => expect(hangingFetch).toHaveBeenCalledOnce());
    timeoutController.abort(new DOMException('The operation timed out.', 'TimeoutError'));

    await expect(pending).rejects.toBeInstanceOf(TesserTimeoutError);
  });
});

describe('signCreateWallet without apiBaseUrl', () => {
  it('uses production when production accepts the signing key and remembers it', async () => {
    const stub = routingByHost({ [PRODUCTION_HOST]: [answerOk(), answerOk()] });
    const api = detectingConnection(stub.fetch);

    const result = await signEthereumWallet(api);
    await signEthereumWallet(api);

    expect(result.metadata.body).toBe(ETHEREUM_BODY);
    expect(stub.hosts()).toEqual([PRODUCTION_HOST, PRODUCTION_HOST]);
    expect(api.resolvedBaseUrl).toBe(PRODUCTION_URL);
  });

  it('falls back to sandbox with a fresh query and stamp when production rejects the stamp', async () => {
    const sandboxBody = ethereumBodyWith((payload) => {
      payload.timestampMs = 'sandbox';
    });
    const stub = routingByHost({
      [PRODUCTION_HOST]: [answerStampRejected('production-request')],
      [SANDBOX_HOST]: [answerOk(sandboxBody)],
    });
    vi.mocked(Date.now)
      .mockReturnValueOnce(NOW_MS)
      .mockReturnValueOnce(NOW_MS + 1);
    const api = detectingConnection(stub.fetch);

    const result = await signEthereumWallet(api);

    expect(stub.hosts()).toEqual([PRODUCTION_HOST, SANDBOX_HOST]);
    expect(stub.requests[0]?.url).toContain(`timestampMs=${NOW_MS}`);
    expect(stub.requests[1]?.url).toContain(`timestampMs=${NOW_MS + 1}`);
    expect(stampHeaderOf(stub.requests[1])).toBe(
      `stamp-of:{"organizationId":"${ORGANIZATION_ID}","name":"${WALLET_NAME}","type":"stablecoin_ethereum","timestampMs":"${NOW_MS + 1}"}`,
    );
    expect(stampHeaderOf(stub.requests[0])).not.toBe(stampHeaderOf(stub.requests[1]));
    expect(result.metadata.body).toBe(sandboxBody);
    expect(decodeSignature(result.signature).body).toBe(sandboxBody);
    expect(api.resolvedBaseUrl).toBe(SANDBOX_URL);
  });

  it('sends later requests only to the remembered environment', async () => {
    const stub = routingByHost({
      [PRODUCTION_HOST]: [answerStampRejected('production-request')],
      [SANDBOX_HOST]: [answerOk(), answerOk()],
    });
    const api = detectingConnection(stub.fetch);

    await signEthereumWallet(api);
    await signEthereumWallet(api);

    expect(stub.hosts()).toEqual([PRODUCTION_HOST, SANDBOX_HOST, SANDBOX_HOST]);
  });

  it.each([
    ['another error code', answerWithErrorCode(401, 'auth-4010', 'production-request')],
    ['no error envelope', answer(401, 'Unauthorized')],
    ['the stamp error code on status 403', answerWithErrorCode(403, 'signing-4010', 'request')],
    ['the stamp error code on status 400', answerWithErrorCode(400, 'signing-4010', 'request')],
    ['status 429', answer(429, '{"errors":[]}')],
    ['status 500', answer(500, '{"errors":[]}')],
    ['status 502', answer(502, '<html>Bad Gateway</html>')],
  ])('does not fall back when production answers with %s', async (_label, production) => {
    const stub = routingByHost({ [PRODUCTION_HOST]: [production] });
    const api = detectingConnection(stub.fetch);

    const error = await signEthereumWalletError(api);

    expect(error).toBeInstanceOf(TesserAPIError);
    expect(stub.hosts()).toEqual([PRODUCTION_HOST]);
    expect(api.resolvedBaseUrl).toBeUndefined();
  });

  it.each([
    ['a timeout', new DOMException('The operation timed out.', 'TimeoutError'), TesserTimeoutError],
    [
      'a connection failure',
      new TypeError('fetch failed', { cause: new Error('ECONNRESET') }),
      TesserConnectionError,
    ],
  ])('does not fall back on %s', async (_label, failure, expectedError) => {
    const stub = routingByHost({ [PRODUCTION_HOST]: [answerFailingWith(failure)] });
    const api = detectingConnection(stub.fetch);

    const error = await signEthereumWalletError(api);

    expect(error).toBeInstanceOf(expectedError);
    expect(stub.hosts()).toEqual([PRODUCTION_HOST]);
  });

  it('does not fall back or remember production when its body fails the checks', async () => {
    const mismatchedBody = ethereumBodyWith((payload) => {
      onlyAccount(payload).name = 'another-wallet';
    });
    const stub = routingByHost({ [PRODUCTION_HOST]: [answerOk(mismatchedBody), answerOk()] });
    const api = detectingConnection(stub.fetch);

    const error = await signEthereumWalletError(api);

    expect(error).toBeInstanceOf(TesserSigningError);
    expect(stub.hosts()).toEqual([PRODUCTION_HOST]);
    expect(api.resolvedBaseUrl).toBeUndefined();
  });

  it('throws the production error when neither environment accepts the signing key', async () => {
    const stub = routingByHost({
      [PRODUCTION_HOST]: [answerStampRejected('production-request')],
      [SANDBOX_HOST]: [answerStampRejected('sandbox-request')],
    });
    const api = detectingConnection(stub.fetch);

    const error = (await signEthereumWalletError(api)) as TesserAPIError;

    expect(error).toBeInstanceOf(TesserAPIError);
    expect(error.status).toBe(401);
    expect(error.requestId).toBe('production-request');
    expect(error.headers?.get('zp-rid')).toBe('production-request');
    expect(stub.hosts()).toEqual([PRODUCTION_HOST, SANDBOX_HOST]);
    expect(api.resolvedBaseUrl).toBeUndefined();
  });

  it('throws the sandbox error when sandbox fails for another reason', async () => {
    const stub = routingByHost({
      [PRODUCTION_HOST]: [answerStampRejected('production-request')],
      [SANDBOX_HOST]: [answer(503, 'unavailable', { 'zp-rid': 'sandbox-request' })],
    });
    const api = detectingConnection(stub.fetch);

    const error = (await signEthereumWalletError(api)) as TesserAPIError;

    expect(error).toBeInstanceOf(TesserAPIError);
    expect(error.status).toBe(503);
    expect(error.requestId).toBe('sandbox-request');
    expect(api.resolvedBaseUrl).toBeUndefined();
  });

  it('does not fall back from a remembered environment', async () => {
    const stub = routingByHost({
      [PRODUCTION_HOST]: [answerStampRejected('production-request')],
      [SANDBOX_HOST]: [answerOk(), answerStampRejected('sandbox-request')],
    });
    const api = detectingConnection(stub.fetch);

    await signEthereumWallet(api);
    const error = (await signEthereumWalletError(api)) as TesserAPIError;

    expect(error.requestId).toBe('sandbox-request');
    expect(stub.hosts()).toEqual([PRODUCTION_HOST, SANDBOX_HOST, SANDBOX_HOST]);
    expect(api.resolvedBaseUrl).toBe(SANDBOX_URL);
  });

  it('lets concurrent first calls both detect sandbox', async () => {
    const stub = routingByHost({
      [PRODUCTION_HOST]: [
        answerStampRejected('production-request'),
        answerStampRejected('production-request'),
      ],
      [SANDBOX_HOST]: [answerOk(), answerOk()],
    });
    const api = detectingConnection(stub.fetch);

    const results = await Promise.all([signEthereumWallet(api), signEthereumWallet(api)]);

    expect(results.map((result) => result.metadata.body)).toEqual([ETHEREUM_BODY, ETHEREUM_BODY]);
    expect(api.resolvedBaseUrl).toBe(SANDBOX_URL);
  });
});

describe('signCreateWallet with apiBaseUrl', () => {
  it.each([PRODUCTION_URL, SANDBOX_URL])(
    'sends one request to %s and does not fall back',
    async (apiBaseUrl) => {
      const stub = routingByHost({
        [PRODUCTION_HOST]: [answerStampRejected('production-request')],
        [SANDBOX_HOST]: [answerStampRejected('sandbox-request')],
      });
      const api = createTesserApiConnection({ apiBaseUrl, fetch: stub.fetch });

      const error = await signEthereumWalletError(api);

      expect(error).toBeInstanceOf(TesserAPIError);
      expect(stub.hosts()).toEqual([new URL(apiBaseUrl).host]);
    },
  );
});

describe('normalizeApiBaseUrl', () => {
  it.each([
    ['https://api.tesser.xyz', 'https://api.tesser.xyz'],
    ['https://api.tesser.xyz/', 'https://api.tesser.xyz'],
    ['https://api.tesser.xyz/v1', 'https://api.tesser.xyz'],
    ['https://api.tesser.xyz/v1/', 'https://api.tesser.xyz'],
    ['  https://api-sandbox.tesser.xyz/v1/  ', 'https://api-sandbox.tesser.xyz'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['http://127.0.0.1:3000/v1', 'http://127.0.0.1:3000'],
    ['http://[::1]:3000', 'http://[::1]:3000'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeApiBaseUrl(input)).toBe(expected);
  });

  it.each(['http://api.tesser.xyz', 'ftp://api.tesser.xyz', 'api.tesser.xyz', '', undefined])(
    'rejects %s with TesserConfigError',
    (input) => {
      expect(() => normalizeApiBaseUrl(input)).toThrow(TesserConfigError);
    },
  );
});

// test/client-get-account-address.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TesserClient } from '../src/client.js';
import { TesserAPIError } from '../src/internal/errors.js';

const fetchMock = vi.fn();

const baseConfig = {
  token: 'tok',
  fetch: fetchMock as unknown as typeof fetch,
  signing: { publicKey: 'pk', privateKey: 'sk', enclaveId: 'org' },
};

beforeEach(() => fetchMock.mockReset());

describe('TesserClient.getAccountAddress', () => {
  it('returns the address from a 200 JSON body', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ address: '0xabc123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const c = new TesserClient(baseConfig);
    const addr = await c.getAccountAddress('acc_1');
    expect(addr).toBe('0xabc123');
  });

  it('throws TesserAPIError with status 404 + parsed errors[] on a Tesser 404', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          errors: [{ error_code: 'accounts-1001', error_message: 'Account not found.' }],
        }),
        { status: 404 },
      ),
    );
    const c = new TesserClient(baseConfig);
    let caught: TesserAPIError | undefined;
    try {
      await c.getAccountAddress('acc_missing');
    } catch (e) {
      caught = e as TesserAPIError;
    }
    expect(caught).toBeInstanceOf(TesserAPIError);
    expect(caught?.status).toBe(404);
    expect(caught?.errorCode).toBe('accounts-1001');
    expect(caught?.hasCode('accounts-1001')).toBe(true);
  });

  it('uses the configured baseUrl', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ address: '0xab' }), { status: 200 }));
    const c = new TesserClient({ ...baseConfig, baseUrl: 'https://staging.tesser.xyz' });
    await c.getAccountAddress('acc_1');
    const url = fetchMock.mock.calls[0]?.[0];
    expect(url).toBe('https://staging.tesser.xyz/v1/accounts/acc_1');
  });

  it('uses the current bearer (post-setToken)', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ address: '0xab' }), { status: 200 }));
    const c = new TesserClient(baseConfig);
    c.setToken('rotated');
    await c.getAccountAddress('acc_1');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer rotated');
  });

  it('URL-encodes the accountId path segment', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ address: '0xab' }), { status: 200 }));
    const c = new TesserClient(baseConfig);
    await c.getAccountAddress('acc with spaces');
    const url = fetchMock.mock.calls[0]?.[0];
    expect(url).toBe('https://api.tesser.xyz/v1/accounts/acc%20with%20spaces');
  });
});

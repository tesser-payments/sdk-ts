// test/internal/http.test.ts
import { describe, expect, it, vi } from 'vitest';
import {
  TesserAPIError,
  TesserConnectionError,
  TesserTimeoutError,
} from '../../src/internal/errors.js';
import { fetchWithRetry } from '../../src/internal/http.js';
import { createDefaultLogger } from '../../src/internal/logger.js';

const baseCtx = () => ({
  fetch: vi.fn() as unknown as typeof fetch,
  logger: createDefaultLogger('off'),
  timeout: 30_000,
  maxRetries: 2,
  bearer: 'test-token',
});

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('fetchWithRetry', () => {
  it('returns parsed JSON + requestId on 200', async () => {
    const ctx = baseCtx();
    (ctx.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(200, { address: '0xabc' }, { 'request-id': 'req_1' }),
    );
    const res = await fetchWithRetry<{ address: string }>(ctx, 'https://api/foo');
    expect(res.data.address).toBe('0xabc');
    expect(res.requestId).toBe('req_1');
    expect(res.status).toBe(200);
  });

  it('throws TesserAPIError with status 400 (non-retryable, single attempt)', async () => {
    const ctx = baseCtx();
    const fetchMock = ctx.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse(400, { errors: [] }));
    let caught: unknown;
    try {
      await fetchWithRetry(ctx, 'https://api/foo');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TesserAPIError);
    expect((caught as TesserAPIError).status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('parses Tesser error envelope into errors[]', async () => {
    const ctx = baseCtx();
    (ctx.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(400, {
        errors: [
          {
            error_code: 'accounts-3005',
            error_message: 'Invalid signature format.',
            ui_message: 'Failed to create the wallet.',
          },
        ],
      }),
    );
    let caught: TesserAPIError | undefined;
    try {
      await fetchWithRetry(ctx, 'https://api/foo');
    } catch (e) {
      caught = e as TesserAPIError;
    }
    expect(caught).toBeInstanceOf(TesserAPIError);
    expect(caught?.errors).toHaveLength(1);
    expect(caught?.errorCode).toBe('accounts-3005');
    expect(caught?.errors[0]?.errorMessage).toBe('Invalid signature format.');
    expect(caught?.errors[0]?.uiMessage).toBe('Failed to create the wallet.');
    expect(caught?.hasCode('accounts-3005')).toBe(true);
  });

  it('handles non-Tesser-shaped error bodies (errors[] is empty)', async () => {
    const ctx = baseCtx();
    (ctx.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('Bad Gateway', { status: 502 }),
    );
    let caught: TesserAPIError | undefined;
    try {
      await fetchWithRetry({ ...ctx, maxRetries: 0 }, 'https://api/foo');
    } catch (e) {
      caught = e as TesserAPIError;
    }
    expect(caught).toBeInstanceOf(TesserAPIError);
    expect(caught?.status).toBe(502);
    expect(caught?.errors).toEqual([]);
    expect(caught?.errorCode).toBeUndefined();
    expect(caught?.message).toContain('Bad Gateway');
  });

  it('retries on 500 up to maxRetries times', async () => {
    const ctx = { ...baseCtx(), maxRetries: 2 };
    const fetchMock = ctx.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse(500, { errors: [] }))
      .mockResolvedValueOnce(jsonResponse(500, { errors: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const res = await fetchWithRetry<{ ok: boolean }>(ctx, 'https://api/foo');
    expect(res.data.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('throws TesserAPIError (status 500) after exhausting retries', async () => {
    const ctx = { ...baseCtx(), maxRetries: 1 };
    const fetchMock = ctx.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(500, { errors: [] })));
    let caught: TesserAPIError | undefined;
    try {
      await fetchWithRetry(ctx, 'https://api/foo');
    } catch (e) {
      caught = e as TesserAPIError;
    }
    expect(caught).toBeInstanceOf(TesserAPIError);
    expect(caught?.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('429 with Retry-After honors the wait then retries', async () => {
    const ctx = { ...baseCtx(), maxRetries: 1 };
    const fetchMock = ctx.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, { errors: [] }, { 'retry-after': '0' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const res = await fetchWithRetry<{ ok: boolean }>(ctx, 'https://api/foo');
    expect(res.data.ok).toBe(true);
  });

  it('eventually surfaces TesserAPIError with status 429 after retries', async () => {
    const ctx = { ...baseCtx(), maxRetries: 0 };
    const fetchMock = ctx.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse(429, { errors: [] }, { 'retry-after': '0' }));
    let caught: TesserAPIError | undefined;
    try {
      await fetchWithRetry(ctx, 'https://api/foo');
    } catch (e) {
      caught = e as TesserAPIError;
    }
    expect(caught).toBeInstanceOf(TesserAPIError);
    expect(caught?.status).toBe(429);
  });

  it('connection failure surfaces TesserConnectionError after retries', async () => {
    const ctx = { ...baseCtx(), maxRetries: 0 };
    const fetchMock = ctx.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(fetchWithRetry(ctx, 'https://api/foo')).rejects.toBeInstanceOf(
      TesserConnectionError,
    );
  });

  it('AbortSignal-driven timeout surfaces as TesserTimeoutError', async () => {
    const ctx = { ...baseCtx(), timeout: 50, maxRetries: 0 };
    const fetchMock = ctx.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    await expect(fetchWithRetry(ctx, 'https://api/foo')).rejects.toBeInstanceOf(TesserTimeoutError);
  });

  it('sets Authorization: Bearer header from context', async () => {
    const ctx = baseCtx();
    const fetchMock = ctx.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    await fetchWithRetry(ctx, 'https://api/foo');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer test-token');
    expect(headers.get('accept')).toBe('application/json');
  });
});

// src/internal/http.ts
//
// HTTP transport layer used by TesserClient methods. Wraps the resolved
// `fetch` with: timeout via AbortController, retry via p-retry on
// transient failures, Retry-After honoring on 429, and status→error
// mapping. Centralizes the request lifecycle so every SDK HTTP method
// inherits the same retry/timeout/logging behavior.

import pRetry, { AbortError } from 'p-retry';
import {
  TesserAPIError,
  TesserConnectionError,
  type TesserErrorDetail,
  TesserTimeoutError,
} from './errors.js';
import type { Logger } from './types.js';

export interface HttpContext {
  fetch: typeof fetch;
  logger: Logger;
  timeout: number;
  maxRetries: number;
  bearer: string;
}

export interface HttpResponse<T> {
  data: T;
  status: number;
  headers: Headers;
  requestId?: string;
}

export interface FetchWithRetryOptions {
  signal?: AbortSignal;
  timeout?: number;
  maxRetries?: number;
  method?: string;
  body?: BodyInit;
  headers?: Record<string, string>;
}

const RETRYABLE_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);

/**
 * Parses Tesser's `{ "errors": [{ error_code, error_message, ui_message? }] }`
 * envelope from a response body. Returns an empty array for non-JSON, non-
 * Tesser-shaped, or unparseable bodies.
 */
function parseTesserErrorBody(text: string): TesserErrorDetail[] {
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || !('errors' in parsed)) return [];
  const arr = (parsed as { errors: unknown }).errors;
  if (!Array.isArray(arr)) return [];
  const out: TesserErrorDetail[] = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as { error_code?: unknown; error_message?: unknown; ui_message?: unknown };
    const detail: TesserErrorDetail = {
      errorCode: typeof e.error_code === 'string' ? e.error_code : '',
      errorMessage: typeof e.error_message === 'string' ? e.error_message : '',
    };
    if (typeof e.ui_message === 'string') detail.uiMessage = e.ui_message;
    out.push(detail);
  }
  return out;
}

function buildAPIError(
  status: number,
  statusText: string,
  responseText: string,
  headers: Headers,
  requestId: string | undefined,
): TesserAPIError {
  const errors = parseTesserErrorBody(responseText);
  const summary =
    errors.length > 0
      ? errors.map((e) => `${e.errorCode}: ${e.errorMessage}`).join('; ')
      : responseText;
  const message = `Tesser API ${status} ${statusText}: ${summary}`;
  const opts: {
    status: number;
    headers: Headers;
    requestId?: string;
    errors: readonly TesserErrorDetail[];
  } = { status, headers, errors };
  if (requestId !== undefined) opts.requestId = requestId;
  return new TesserAPIError(message, opts);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('Aborted'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason ?? new Error('Aborted'));
    });
  });
}

function combineSignals(...signals: (AbortSignal | undefined)[]): {
  signal: AbortSignal;
  cancel: () => void;
} {
  const controller = new AbortController();
  const cleanups: (() => void)[] = [];
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    const onAbort = () => controller.abort(s.reason);
    s.addEventListener('abort', onAbort);
    cleanups.push(() => s.removeEventListener('abort', onAbort));
  }
  return {
    signal: controller.signal,
    cancel: () => {
      for (const c of cleanups) c();
    },
  };
}

export async function fetchWithRetry<T>(
  ctx: HttpContext,
  url: string,
  options: FetchWithRetryOptions = {},
): Promise<HttpResponse<T>> {
  const timeout = options.timeout ?? ctx.timeout;
  const maxRetries = options.maxRetries ?? ctx.maxRetries;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${ctx.bearer}`,
    Accept: 'application/json',
    ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...options.headers,
  };

  return pRetry(
    async () => {
      const timeoutController = new AbortController();
      const timer = setTimeout(() => timeoutController.abort(new Error('timeout')), timeout);
      const combined = combineSignals(options.signal, timeoutController.signal);
      try {
        ctx.logger.debug({
          msg: 'tesser http request',
          method: options.method ?? 'GET',
          url,
        });
        const init: RequestInit = {
          method: options.method ?? 'GET',
          headers,
          signal: combined.signal,
        };
        if (options.body !== undefined) init.body = options.body;
        const res = await ctx.fetch(url, init);
        const requestId = res.headers.get('request-id') ?? undefined;
        ctx.logger.debug({
          msg: 'tesser http response',
          url,
          status: res.status,
          requestId,
        });

        if (res.ok) {
          const data = (await res.json()) as T;
          const out: HttpResponse<T> = { data, status: res.status, headers: res.headers };
          if (requestId !== undefined) out.requestId = requestId;
          return out;
        }

        const text = await res.text();
        const err = buildAPIError(res.status, res.statusText, text, res.headers, requestId);

        if (RETRYABLE_STATUSES.has(res.status)) {
          if (res.status === 429) {
            const retryAfter = Number(res.headers.get('retry-after') ?? '0');
            if (retryAfter > 0) await sleep(retryAfter * 1_000, options.signal);
          }
          throw err;
        }
        throw new AbortError(err);
      } catch (e) {
        if (e instanceof AbortError) throw e;
        if (e instanceof TesserAPIError) throw e;
        if (
          e &&
          typeof e === 'object' &&
          'name' in e &&
          (e as { name: string }).name === 'AbortError'
        ) {
          if (timeoutController.signal.aborted) {
            throw new AbortError(
              new TesserTimeoutError(`Request timed out after ${timeout}ms`, { cause: e }),
            );
          }
          throw new AbortError(e as Error);
        }
        throw new TesserConnectionError(`fetch to ${url} failed`, { cause: e });
      } finally {
        clearTimeout(timer);
        combined.cancel();
      }
    },
    {
      retries: maxRetries,
      factor: 2,
      minTimeout: 500,
      maxTimeout: 8_000,
      randomize: true,
      onFailedAttempt: (err) =>
        ctx.logger.warn(
          `tesser: retry ${err.attemptNumber}/${maxRetries + 1} after ${err.message}`,
        ),
    },
  );
}

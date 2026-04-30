// src/client.ts
import { TesserConfigError } from './internal/errors.js';
import { type FetchWithRetryOptions, fetchWithRetry } from './internal/http.js';
import { createDefaultLogger } from './internal/logger.js';
import type { LogLevel, Logger, RequestOptions, RpcUrls, SigningConfig } from './internal/types.js';

export interface TesserClientConfig {
  token: string;
  baseUrl?: string;
  rpcUrls?: RpcUrls;
  signing: SigningConfig;
  timeout?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
  logger?: Logger;
  logLevel?: LogLevel;
}

const VALID_LEVELS: ReadonlySet<LogLevel> = new Set(['debug', 'info', 'warn', 'error', 'off']);

function resolveLogLevel(option: LogLevel | undefined): LogLevel {
  if (option) return option;
  const env = process.env.TESSER_LOG;
  if (env && VALID_LEVELS.has(env as LogLevel)) return env as LogLevel;
  return 'warn';
}

function normalizeNetworkKey(key: string): string {
  return key.trim().toLowerCase().replace(/-/g, '_');
}

/**
 * Trims surrounding whitespace from a bearer token. Tokens read from env vars
 * (e.g. `$(cat token.txt)`) often carry a trailing `\n`, which would corrupt
 * the Authorization header. Any leading "Bearer " prefix is preserved — the
 * HTTP layer detects and avoids double-prefixing.
 */
function normalizeToken(token: string): string {
  return token.trim();
}

export class TesserClient {
  #token: string;
  readonly baseUrl: string;
  readonly rpcUrls: ReadonlyMap<string, string>;
  readonly signing: Readonly<SigningConfig>;
  readonly timeout: number;
  readonly maxRetries: number;
  readonly fetch: typeof fetch;
  readonly logger: Logger;
  readonly logLevel: LogLevel;

  constructor(config: TesserClientConfig) {
    const token = config.token ? normalizeToken(config.token) : '';
    if (!token) throw new TesserConfigError('TesserClient: token is required');
    const s = config.signing;
    if (!s || !s.publicKey || !s.privateKey || !s.enclaveId) {
      throw new TesserConfigError(
        'TesserClient: signing.publicKey, signing.privateKey, and signing.enclaveId are required',
      );
    }

    this.#token = token;

    const baseUrlCandidate = (config.baseUrl ?? 'https://api.tesser.xyz')
      .trim()
      .replace(/\/+$/, '');
    if (config.baseUrl !== undefined && baseUrlCandidate === '') {
      throw new TesserConfigError(
        'TesserClient: baseUrl must not be blank when provided (got an empty string, whitespace, or only slashes)',
      );
    }
    this.baseUrl = baseUrlCandidate;
    this.signing = Object.freeze({ ...s });
    this.timeout = config.timeout ?? 30_000;
    this.maxRetries = config.maxRetries ?? 2;
    this.fetch = config.fetch ?? globalThis.fetch.bind(globalThis);

    const entries = Object.entries(config.rpcUrls ?? {})
      .filter(([, v]) => typeof v === 'string' && v.length > 0)
      .map(([k, v]) => [normalizeNetworkKey(k), v as string] as const);
    this.rpcUrls = new Map(entries);

    this.logLevel = resolveLogLevel(config.logLevel);
    this.logger = config.logger ?? createDefaultLogger(this.logLevel);
  }

  setToken(token: string): void {
    const normalized = token ? normalizeToken(token) : '';
    if (!normalized) throw new TesserConfigError('TesserClient.setToken: token is required');
    this.#token = normalized;
  }

  /**
   * Fetches the on-chain address bound to a Tesser account ID. Used by
   * `signStep` to resolve `from_account_id` / `to_account_id` to addresses
   * before building the unsigned transaction; also useful as a standalone
   * lookup for callers that need the address directly.
   */
  async getAccountAddress(accountId: string, opts: RequestOptions = {}): Promise<string> {
    const reqOpts: FetchWithRetryOptions = {};
    if (opts.signal !== undefined) reqOpts.signal = opts.signal;
    if (opts.timeout !== undefined) reqOpts.timeout = opts.timeout;
    if (opts.maxRetries !== undefined) reqOpts.maxRetries = opts.maxRetries;

    const { data } = await fetchWithRetry<{ address: string }>(
      {
        fetch: this.fetch,
        logger: this.logger,
        timeout: this.timeout,
        maxRetries: this.maxRetries,
        bearer: this.#token,
      },
      `${this.baseUrl}/v1/accounts/${encodeURIComponent(accountId)}`,
      reqOpts,
    );
    return data.address;
  }
}

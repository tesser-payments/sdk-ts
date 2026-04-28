// src/internal/errors.ts

export class TesserError extends Error {
  override readonly name: string = 'TesserError';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }

  static is(err: unknown): err is TesserError {
    return err instanceof TesserError;
  }
}

export class TesserConfigError extends TesserError {
  override readonly name = 'TesserConfigError';
  static override is(err: unknown): err is TesserConfigError {
    return err instanceof TesserConfigError;
  }
}

/**
 * One entry from Tesser's documented `{ "errors": [...] }` response envelope.
 * See https://docs.tesser.xyz/overviews/errors. Field names are camelCased
 * for JS idiom; the wire format uses `error_code` / `error_message` /
 * `ui_message` and is converted at the HTTP boundary.
 */
export interface TesserErrorDetail {
  errorCode: string;
  errorMessage: string;
  uiMessage?: string;
}

export interface TesserAPIErrorOptions {
  cause?: unknown;
  status: number;
  headers?: Headers;
  requestId?: string;
  errors?: readonly TesserErrorDetail[];
}

/**
 * Thrown for any non-2xx HTTP response from Tesser. Carries the parsed
 * `errors[]` envelope so consumers can branch on Tesser's documented error
 * codes (e.g. `accounts-3005`, `idempotency-1001`) rather than HTTP status
 * alone. For responses that are not Tesser-shaped (e.g., a Cloudflare 502
 * page), `errors` is the empty array.
 */
export class TesserAPIError extends TesserError {
  override readonly name: string = 'TesserAPIError';
  readonly status: number;
  readonly headers?: Headers;
  readonly requestId?: string;
  readonly errors: readonly TesserErrorDetail[];

  constructor(message: string, options: TesserAPIErrorOptions) {
    super(message, { cause: options.cause });
    this.status = options.status;
    if (options.headers !== undefined) this.headers = options.headers;
    if (options.requestId !== undefined) this.requestId = options.requestId;
    this.errors = options.errors ?? [];
  }

  /** First reported error code, or `undefined` if the body wasn't a Tesser error envelope. */
  get errorCode(): string | undefined {
    return this.errors[0]?.errorCode;
  }

  /** True if any reported error matches one of the given documented codes. */
  hasCode(...codes: string[]): boolean {
    return this.errors.some((e) => codes.includes(e.errorCode));
  }

  static override is(err: unknown): err is TesserAPIError {
    return err instanceof TesserAPIError;
  }
}

export class TesserConnectionError extends TesserError {
  override readonly name = 'TesserConnectionError';
  static override is(err: unknown): err is TesserConnectionError {
    return err instanceof TesserConnectionError;
  }
}

export class TesserTimeoutError extends TesserError {
  override readonly name = 'TesserTimeoutError';
  static override is(err: unknown): err is TesserTimeoutError {
    return err instanceof TesserTimeoutError;
  }
}

export class TesserSigningError extends TesserError {
  override readonly name: string = 'TesserSigningError';
  static override is(err: unknown): err is TesserSigningError {
    return err instanceof TesserSigningError;
  }
}

export class StampError extends TesserSigningError {
  override readonly name = 'StampError';
  static override is(err: unknown): err is StampError {
    return err instanceof StampError;
  }
}

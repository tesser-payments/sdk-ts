import {
  TesserAPIError,
  type TesserAPIErrorOptions,
  TesserConfigError,
  TesserConnectionError,
  type TesserErrorDetail,
  TesserSigningError,
  TesserTimeoutError,
} from '../internal/errors.js';
import type { CreateWalletParams, SigningConfig } from '../internal/types.js';
import { SDK_VERSION } from '../internal/version.js';
import { type StampResult, stamp } from './stamp.js';

const UNSIGNED_PAYLOAD_PATH = '/v1/accounts/wallets/unsigned-payload';
const CREATE_WALLET_ACCOUNTS_ACTIVITY_TYPE = 'ACTIVITY_TYPE_CREATE_WALLET_ACCOUNTS';
const ETHEREUM_ADDRESS_FORMAT = 'ADDRESS_FORMAT_ETHEREUM';
const UNSIGNED_PAYLOAD_TIMEOUT_MS = 10_000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MAX_FAILURE_CHAIN_DEPTH = 10;
const PRODUCTION_API_BASE_URL = 'https://api.tesser.xyz';
const SANDBOX_API_BASE_URL = 'https://api-sandbox.tesser.xyz';
const DEFAULT_API_BASE_URLS: readonly string[] = [PRODUCTION_API_BASE_URL, SANDBOX_API_BASE_URL];
const STAMP_REJECTED_ERROR_CODE = 'signing-4010';

export interface TesserApiConnection {
  fetch: typeof fetch;
  defaultBaseUrls: readonly string[];
  resolvedBaseUrl: string | undefined;
}

interface UnsignedPayloadQuery {
  organizationId: string;
  name: string;
  type: string;
  timestampMs: string;
}

interface UnsignedPayloadResponse {
  status: number;
  headers: Headers;
  text: string;
}

type JsonObject = Record<string, unknown>;

export function createTesserApiConnection({
  apiBaseUrl,
  fetch: injectedFetch,
  defaultBaseUrls = DEFAULT_API_BASE_URLS,
}: {
  apiBaseUrl: unknown;
  fetch: typeof fetch | undefined;
  defaultBaseUrls?: readonly string[];
}): TesserApiConnection {
  return {
    fetch: resolveFetchImplementation(injectedFetch),
    defaultBaseUrls,
    resolvedBaseUrl: resolveExplicitApiBaseUrl(apiBaseUrl),
  };
}

function resolveExplicitApiBaseUrl(apiBaseUrl: unknown): string | undefined {
  if (apiBaseUrl === undefined) {
    return undefined;
  }
  return normalizeApiBaseUrl(apiBaseUrl);
}

function resolveFetchImplementation(injectedFetch: typeof fetch | undefined): typeof fetch {
  if (injectedFetch !== undefined) {
    return injectedFetch;
  }
  return globalThis.fetch;
}

export function normalizeApiBaseUrl(apiBaseUrl: unknown): string {
  if (typeof apiBaseUrl !== 'string') {
    throw invalidApiBaseUrlError();
  }
  const withoutTrailingSlash = removeSuffix(apiBaseUrl.trim(), '/');
  const normalized = removeSuffix(removeSuffix(withoutTrailingSlash, '/v1'), '/');
  if (!isHttpsOrLoopbackHttpUrl(normalized)) {
    throw invalidApiBaseUrlError();
  }
  return normalized;
}

function invalidApiBaseUrlError(): TesserConfigError {
  return new TesserConfigError(
    'LocalSigner: apiBaseUrl must be an https URL, for example https://api.tesser.xyz',
  );
}

function removeSuffix(value: string, suffix: string): string {
  if (value.endsWith(suffix)) {
    return value.slice(0, value.length - suffix.length);
  }
  return value;
}

function isHttpsOrLoopbackHttpUrl(value: string): boolean {
  const url = parseUrl(value);
  if (url === undefined || url.hostname === '') {
    return false;
  }
  if (url.protocol === 'https:') {
    return true;
  }
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

export async function fetchCheckedCreateWalletAccountsBody(options: {
  api: TesserApiConnection;
  signing: SigningConfig;
  params: CreateWalletParams;
}): Promise<string> {
  const { api, signing, params } = options;
  if (api.resolvedBaseUrl !== undefined) {
    return fetchCheckedBodyFrom(api.resolvedBaseUrl, api.fetch, signing, params);
  }
  return detectEnvironmentAndFetchCheckedBody({ api, signing, params });
}

async function detectEnvironmentAndFetchCheckedBody(options: {
  api: TesserApiConnection;
  signing: SigningConfig;
  params: CreateWalletParams;
}): Promise<string> {
  const { api, signing, params } = options;
  let firstStampRejection: TesserAPIError | undefined;
  for (const baseUrl of api.defaultBaseUrls) {
    try {
      const body = await fetchCheckedBodyFrom(baseUrl, api.fetch, signing, params);
      api.resolvedBaseUrl = baseUrl;
      return body;
    } catch (error) {
      if (!isStampRejected(error)) {
        throw error;
      }
      firstStampRejection ??= error;
    }
  }
  throw firstStampRejection;
}

function isStampRejected(error: unknown): error is TesserAPIError {
  return (
    error instanceof TesserAPIError &&
    error.status === 401 &&
    error.errorCode === STAMP_REJECTED_ERROR_CODE
  );
}

async function fetchCheckedBodyFrom(
  baseUrl: string,
  fetchImplementation: typeof fetch,
  signing: SigningConfig,
  params: CreateWalletParams,
): Promise<string> {
  const query = buildUnsignedPayloadQuery(signing, params);
  const stamped = await stamp(
    { publicKey: signing.publicKey, privateKey: signing.privateKey },
    buildCanonicalUnsignedPayloadMessage(query),
  );
  const response = await sendUnsignedPayloadRequest(
    fetchImplementation,
    buildUnsignedPayloadUrl(baseUrl, query),
    stamped,
  );
  const body = parseUnsignedPayloadBody(response);
  assertUnsignedPayloadMatchesRequest(body, signing, params);
  return body;
}

function buildUnsignedPayloadQuery(
  signing: SigningConfig,
  params: CreateWalletParams,
): UnsignedPayloadQuery {
  return {
    organizationId: signing.enclaveId,
    name: params.name,
    type: params.type,
    timestampMs: String(Date.now()),
  };
}

function buildCanonicalUnsignedPayloadMessage(query: UnsignedPayloadQuery): string {
  return JSON.stringify({
    organizationId: query.organizationId,
    name: query.name,
    type: query.type,
    timestampMs: query.timestampMs,
  });
}

function buildUnsignedPayloadUrl(baseUrl: string, query: UnsignedPayloadQuery): string {
  const queryEntries: [string, string][] = [
    ['organizationId', query.organizationId],
    ['name', query.name],
    ['type', query.type],
    ['timestampMs', query.timestampMs],
  ];
  const queryString = queryEntries
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return `${baseUrl}${UNSIGNED_PAYLOAD_PATH}?${queryString}`;
}

async function sendUnsignedPayloadRequest(
  fetchImplementation: typeof fetch,
  url: string,
  stamped: StampResult,
): Promise<UnsignedPayloadResponse> {
  try {
    const response = await fetchImplementation(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        [stamped.stampHeaderName]: stamped.stampHeaderValue,
        'User-Agent': `tesser-sdk-ts/${SDK_VERSION}`,
      },
      signal: AbortSignal.timeout(UNSIGNED_PAYLOAD_TIMEOUT_MS),
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, text };
  } catch (cause) {
    throw toTransportError(cause);
  }
}

function toTransportError(cause: unknown): TesserTimeoutError | TesserConnectionError {
  if (isTimeoutFailure(cause)) {
    return new TesserTimeoutError(
      `Unsigned payload request timed out after ${UNSIGNED_PAYLOAD_TIMEOUT_MS} ms`,
      { cause },
    );
  }
  return new TesserConnectionError(
    `Unsigned payload request failed: ${describeTransportFailure(cause)}`,
    { cause },
  );
}

function isTimeoutFailure(cause: unknown): boolean {
  return readErrorName(cause) === 'TimeoutError';
}

function describeTransportFailure(cause: unknown): string {
  const failureChain = collectFailureChain(cause);
  const messages = failureChain.map(readErrorMessage).filter(isNonBlank);
  if (messages.length > 0) {
    return [...new Set(messages)].join(': ');
  }
  const names = failureChain.map(readErrorName).filter(isNonBlank);
  return names[names.length - 1] ?? 'Unknown transport failure';
}

function collectFailureChain(cause: unknown): unknown[] {
  const failureChain: unknown[] = [];
  let current = cause;
  while (isObject(current) && failureChain.length < MAX_FAILURE_CHAIN_DEPTH) {
    if (failureChain.includes(current)) {
      break;
    }
    failureChain.push(current);
    current = current.cause;
  }
  return failureChain;
}

function readErrorMessage(failure: unknown): string | undefined {
  return readStringField(failure, 'message');
}

function readErrorName(failure: unknown): string | undefined {
  return readStringField(failure, 'name');
}

function readStringField(source: unknown, key: string): string | undefined {
  if (!isObject(source)) {
    return undefined;
  }
  const value = source[key];
  if (typeof value !== 'string') {
    return undefined;
  }
  return value;
}

function isNonBlank(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null;
}

function readGatewayRequestId(headers: Headers): string | undefined {
  return headers.get('zp-rid') ?? headers.get('x-request-id') ?? undefined;
}

function parseUnsignedPayloadBody(response: UnsignedPayloadResponse): string {
  if (response.status < 200 || response.status > 299) {
    throw buildUnsignedPayloadApiError(response);
  }
  const body = readResponseDataBody(response.text);
  if (body === undefined) {
    throw new TesserAPIError(
      'Unsigned payload response is not valid: data.body is missing',
      buildApiErrorOptions(response, []),
    );
  }
  return body;
}

function readResponseDataBody(text: string): string | undefined {
  const envelope = parseJsonObject(text);
  if (envelope === undefined || !isObject(envelope.data)) {
    return undefined;
  }
  return readStringField(envelope.data, 'body');
}

function buildUnsignedPayloadApiError(response: UnsignedPayloadResponse): TesserAPIError {
  return new TesserAPIError(
    `Unsigned payload request returned HTTP ${response.status}: ${response.text}`,
    buildApiErrorOptions(response, parseErrorDetails(response.text)),
  );
}

function buildApiErrorOptions(
  response: UnsignedPayloadResponse,
  errors: TesserErrorDetail[],
): TesserAPIErrorOptions {
  const requestId = readGatewayRequestId(response.headers);
  if (requestId === undefined) {
    return { status: response.status, headers: response.headers, errors };
  }
  return { status: response.status, headers: response.headers, requestId, errors };
}

function parseErrorDetails(text: string): TesserErrorDetail[] {
  const envelope = parseJsonObject(text);
  if (envelope === undefined || !Array.isArray(envelope.errors)) {
    return [];
  }
  return envelope.errors.flatMap(toErrorDetail);
}

function toErrorDetail(entry: unknown): TesserErrorDetail[] {
  const errorCode = readStringField(entry, 'error_code');
  const errorMessage = readStringField(entry, 'error_message');
  if (errorCode === undefined || errorMessage === undefined) {
    return [];
  }
  const uiMessage = readStringField(entry, 'ui_message');
  if (uiMessage === undefined) {
    return [{ errorCode, errorMessage }];
  }
  return [{ errorCode, errorMessage, uiMessage }];
}

function parseJsonObject(text: string): JsonObject | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (isObject(parsed) && !Array.isArray(parsed)) {
      return parsed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function assertUnsignedPayloadMatchesRequest(
  body: string,
  signing: SigningConfig,
  params: CreateWalletParams,
): void {
  const payload = parseJsonObject(body);
  if (payload === undefined) {
    throw rejectUnsignedPayload('body is not a JSON object');
  }
  if (readStringField(payload, 'type') !== CREATE_WALLET_ACCOUNTS_ACTIVITY_TYPE) {
    throw rejectUnsignedPayload(`type is not ${CREATE_WALLET_ACCOUNTS_ACTIVITY_TYPE}`);
  }
  if (readStringField(payload, 'organizationId') !== signing.enclaveId) {
    throw rejectUnsignedPayload('organizationId does not match the signing enclaveId');
  }
  const account = readSingleAccount(payload);
  if (readStringField(account, 'name') !== params.name) {
    throw rejectUnsignedPayload('account name does not match the requested wallet name');
  }
  if (readStringField(account, 'addressFormat') !== ETHEREUM_ADDRESS_FORMAT) {
    throw rejectUnsignedPayload(`account addressFormat is not ${ETHEREUM_ADDRESS_FORMAT}`);
  }
}

function readSingleAccount(payload: JsonObject): JsonObject {
  const parameters = payload.parameters;
  if (!isObject(parameters)) {
    throw rejectUnsignedPayload('parameters is missing');
  }
  const accounts = parameters.accounts;
  if (!Array.isArray(accounts)) {
    throw rejectUnsignedPayload('parameters.accounts is missing');
  }
  if (accounts.length !== 1) {
    throw rejectUnsignedPayload(`expected exactly one account, got ${accounts.length}`);
  }
  const account: unknown = accounts[0];
  if (!isObject(account) || Array.isArray(account)) {
    throw rejectUnsignedPayload('account is not a JSON object');
  }
  return account;
}

function rejectUnsignedPayload(reason: string): TesserSigningError {
  return new TesserSigningError(`Unsigned payload rejected: ${reason}`);
}

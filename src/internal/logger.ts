// src/internal/logger.ts
import type { LogLevel, Logger } from './types.js';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  off: 100,
};

const SENSITIVE_KEYS = new Set<string>([
  'authorization',
  'token',
  'bearer',
  'publickey',
  'privatekey',
  'enclaveid',
  'stampheadervalue',
  'walletaddress',
  'recipientaddress',
  'from_amount',
  'to_amount',
  'from_currency',
  'to_currency',
  'unsignedtransaction',
]);

const REDACTED = '[REDACTED]';
const CIRCULAR = '[Circular]';

function redactInternal(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;

  // Pass-through types that printers handle natively or that preserve diagnostic value.
  if (value instanceof Date) return value;
  if (value instanceof Error) return value;

  if (seen.has(value)) return CIRCULAR;
  seen.add(value);

  if (value instanceof Headers) {
    const out: Record<string, string> = {};
    value.forEach((v, k) => {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? REDACTED : v;
    });
    return out;
  }
  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of value) {
      const key = String(k);
      out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : redactInternal(v, seen);
    }
    return out;
  }
  if (value instanceof Set) return [...value].map((v) => redactInternal(v, seen));
  if (Array.isArray(value)) return value.map((v) => redactInternal(v, seen));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = REDACTED;
    } else {
      out[k] = redactInternal(v, seen);
    }
  }
  return out;
}

export function redact(value: unknown): unknown {
  return redactInternal(value, new WeakSet());
}

export function createDefaultLogger(level: LogLevel): Logger {
  const threshold = LEVEL_ORDER[level];
  const enabled = (lvl: LogLevel) => LEVEL_ORDER[lvl] >= threshold;

  return {
    debug: (...args) => {
      if (enabled('debug')) console.debug(...args.map(redact));
    },
    info: (...args) => {
      if (enabled('info')) console.info(...args.map(redact));
    },
    warn: (...args) => {
      if (enabled('warn')) console.warn(...args.map(redact));
    },
    error: (...args) => {
      if (enabled('error')) console.error(...args.map(redact));
    },
  };
}

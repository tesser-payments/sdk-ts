// test/internal/logger.test.ts
import { describe, expect, it, vi } from 'vitest';
import { createDefaultLogger, redact } from '../../src/internal/logger.js';

describe('redact', () => {
  it('scrubs Authorization header values', () => {
    const input = { headers: { Authorization: 'Bearer abc123', 'X-Foo': 'ok' } };
    expect(redact(input)).toEqual({ headers: { Authorization: '[REDACTED]', 'X-Foo': 'ok' } });
  });

  it('scrubs signing config keys regardless of nesting', () => {
    const input = {
      config: {
        signing: { publicKey: 'PK', privateKey: 'SK', enclaveId: 'ORG' },
      },
    };
    expect(redact(input)).toEqual({
      config: {
        signing: { publicKey: '[REDACTED]', privateKey: '[REDACTED]', enclaveId: '[REDACTED]' },
      },
    });
  });

  it('scrubs bearer token, stamp values, addresses, amounts, raw tx', () => {
    const input = {
      token: 't',
      stampHeaderValue: 's',
      walletAddress: '0xabc',
      recipientAddress: '0xdef',
      from_amount: '100',
      to_amount: '99',
      from_currency: 'USDC',
      unsignedTransaction: '0xfeed',
    };
    const out = redact(input) as Record<string, string>;
    for (const k of Object.keys(input)) {
      expect(out[k]).toBe('[REDACTED]');
    }
  });

  it('passes through non-sensitive primitives and unknown keys', () => {
    expect(redact({ status: 200, foo: 'bar' })).toEqual({ status: 200, foo: 'bar' });
    expect(redact('plain string')).toBe('plain string');
    expect(redact(42)).toBe(42);
  });

  it('does not mutate the input', () => {
    const input = { token: 'secret', other: 'ok' };
    const out = redact(input);
    expect(input.token).toBe('secret');
    expect(out).not.toBe(input);
  });

  it('redacts sensitive keys inside a Headers instance', () => {
    const h = new Headers({ Authorization: 'Bearer s3cret', 'X-Request-Id': 'req_1' });
    const out = redact(h) as Record<string, string>;
    expect(out.authorization).toBe('[REDACTED]');
    expect(out['x-request-id']).toBe('req_1');
  });

  it('passes Date and Error instances through unchanged', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    expect(redact(d)).toBe(d);
    const e = new Error('boom');
    expect(redact(e)).toBe(e);
  });

  it('redacts sensitive keys inside a Map and recurses values', () => {
    const m = new Map<string, unknown>([
      ['token', 'tok'],
      ['nested', { privateKey: 'sk', other: 'ok' }],
    ]);
    expect(redact(m)).toEqual({
      token: '[REDACTED]',
      nested: { privateKey: '[REDACTED]', other: 'ok' },
    });
  });

  it('recursively redacts values inside a Set', () => {
    const s = new Set([{ token: 't1' }, { token: 't2' }]);
    expect(redact(s)).toEqual([{ token: '[REDACTED]' }, { token: '[REDACTED]' }]);
  });

  it('handles cyclic references without infinite recursion', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    expect(() => redact(a)).not.toThrow();
    const out = redact(a) as Record<string, unknown>;
    expect(out.name).toBe('a');
    expect(out.self).toBe('[Circular]');
  });
});

describe('createDefaultLogger', () => {
  it('filters below configured level', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const logger = createDefaultLogger('warn');
    logger.debug('should not appear');
    logger.info('also no');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('emits at and above configured level via console.{level}', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createDefaultLogger('warn');
    logger.warn('w');
    logger.error('e');
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("level 'off' silences everything", () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = createDefaultLogger('off');
    logger.error('nope');
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

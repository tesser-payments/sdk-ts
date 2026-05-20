// test/internal/errors.test.ts
import { describe, expect, it } from 'vitest';
import {
  StampError,
  TesserAPIError,
  TesserConfigError,
  TesserConnectionError,
  TesserError,
  TesserSigningError,
  TesserTimeoutError,
} from '../../src/internal/errors.js';

describe('error hierarchy', () => {
  it('all errors extend TesserError', () => {
    expect(new TesserConfigError('x')).toBeInstanceOf(TesserError);
    expect(new TesserAPIError('x', { status: 400 })).toBeInstanceOf(TesserError);
    expect(new TesserConnectionError('x')).toBeInstanceOf(TesserError);
    expect(new TesserTimeoutError('x')).toBeInstanceOf(TesserError);
    expect(new TesserSigningError('x')).toBeInstanceOf(TesserError);
    expect(new StampError('x')).toBeInstanceOf(TesserSigningError);
  });

  it('captures cause when wrapping', () => {
    const inner = new Error('boom');
    const wrapped = new StampError('stamp failed', { cause: inner });
    expect(wrapped.cause).toBe(inner);
  });

  it('static .is() returns true for instances and false for unrelated errors', () => {
    expect(TesserError.is(new TesserConfigError('x'))).toBe(true);
    expect(TesserError.is(new Error('x'))).toBe(false);
    expect(StampError.is(new StampError('x'))).toBe(true);
    expect(StampError.is(new TesserConfigError('x'))).toBe(false);
  });
});

describe('TesserAPIError', () => {
  it('captures status, headers, requestId, and errors[]', () => {
    const headers = new Headers({ 'request-id': 'req_123' });
    const err = new TesserAPIError('bad', {
      status: 400,
      headers,
      requestId: 'req_123',
      errors: [{ errorCode: 'accounts-3005', errorMessage: 'Invalid signature format.' }],
    });
    expect(err.status).toBe(400);
    expect(err.requestId).toBe('req_123');
    expect(err.headers?.get('request-id')).toBe('req_123');
    expect(err.errors).toHaveLength(1);
    expect(err.errors[0]?.errorCode).toBe('accounts-3005');
  });

  it('errors defaults to an empty array when not provided', () => {
    const err = new TesserAPIError('bad', { status: 502 });
    expect(err.errors).toEqual([]);
    expect(err.errorCode).toBeUndefined();
  });

  it('errorCode getter returns the first error code', () => {
    const err = new TesserAPIError('bad', {
      status: 400,
      errors: [
        { errorCode: 'accounts-3005', errorMessage: 'first' },
        { errorCode: 'accounts-3006', errorMessage: 'second' },
      ],
    });
    expect(err.errorCode).toBe('accounts-3005');
  });

  it('hasCode matches any of the supplied codes', () => {
    const err = new TesserAPIError('bad', {
      status: 400,
      errors: [{ errorCode: 'idempotency-1001', errorMessage: 'duplicate' }],
    });
    expect(err.hasCode('idempotency-1001')).toBe(true);
    expect(err.hasCode('idempotency-1001', 'idempotency-1002')).toBe(true);
    expect(err.hasCode('accounts-3005')).toBe(false);
  });

  it('uiMessage is preserved when present', () => {
    const err = new TesserAPIError('bad', {
      status: 400,
      errors: [
        {
          errorCode: 'accounts-5000',
          errorMessage: 'Internal — full diagnostic',
          uiMessage: 'Failed to create the wallet. Please try again.',
        },
      ],
    });
    expect(err.errors[0]?.uiMessage).toBe('Failed to create the wallet. Please try again.');
  });
});

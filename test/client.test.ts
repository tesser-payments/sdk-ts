// test/client.test.ts
import { describe, expect, it, vi } from 'vitest';
import { TesserClient } from '../src/client.js';
import { TesserConfigError } from '../src/internal/errors.js';

const baseConfig = {
  token: 'tok',
  signing: { publicKey: 'pk', privateKey: 'sk', enclaveId: 'org' },
};

describe('TesserClient', () => {
  it('constructs with minimum valid config', () => {
    const c = new TesserClient(baseConfig);
    expect(c.baseUrl).toBe('https://api.tesser.xyz');
    expect(c.timeout).toBe(30_000);
    expect(c.maxRetries).toBe(2);
    expect(c.signing.enclaveId).toBe('org');
  });

  it('throws TesserConfigError on missing token', () => {
    expect(() => new TesserClient({ ...baseConfig, token: '' })).toThrow(TesserConfigError);
  });

  it('throws TesserConfigError on incomplete signing config', () => {
    expect(
      () =>
        new TesserClient({
          ...baseConfig,
          signing: { publicKey: 'pk', privateKey: '', enclaveId: 'org' },
        }),
    ).toThrow(TesserConfigError);
  });

  it('normalizes mixed-case rpcUrls keys to lowercase + underscores', () => {
    const c = new TesserClient({
      ...baseConfig,
      rpcUrls: {
        // biome-ignore lint/suspicious/noExplicitAny: testing runtime normalization
        ['BASE-SEPOLIA' as any]: 'https://test',
      } as Record<string, string>,
    });
    expect(c.rpcUrls.get('base_sepolia')).toBe('https://test');
  });

  it('signing is frozen — direct mutation does not change client state', () => {
    const c = new TesserClient(baseConfig);
    expect(() => {
      // biome-ignore lint/suspicious/noExplicitAny: testing runtime freeze
      (c.signing as any).publicKey = 'mutated';
    }).toThrow();
  });

  it('setToken updates the bearer without affecting other fields', () => {
    const c = new TesserClient(baseConfig);
    expect(() => c.setToken('new-tok')).not.toThrow();
    expect(c.baseUrl).toBe('https://api.tesser.xyz');
  });

  it('setToken rejects empty token', () => {
    const c = new TesserClient(baseConfig);
    expect(() => c.setToken('')).toThrow(TesserConfigError);
  });

  it('logLevel: constructor option overrides TESSER_LOG env var', () => {
    const prev = process.env.TESSER_LOG;
    process.env.TESSER_LOG = 'debug';
    try {
      const c = new TesserClient({ ...baseConfig, logLevel: 'error' });
      expect(c.logLevel).toBe('error');
    } finally {
      // biome-ignore lint/performance/noDelete: restore env var to absent state
      if (prev === undefined) delete process.env.TESSER_LOG;
      else process.env.TESSER_LOG = prev;
    }
  });

  it('logLevel: TESSER_LOG env var used when constructor option absent', () => {
    const prev = process.env.TESSER_LOG;
    process.env.TESSER_LOG = 'debug';
    try {
      const c = new TesserClient(baseConfig);
      expect(c.logLevel).toBe('debug');
    } finally {
      // biome-ignore lint/performance/noDelete: restore env var to absent state
      if (prev === undefined) delete process.env.TESSER_LOG;
      else process.env.TESSER_LOG = prev;
    }
  });
});

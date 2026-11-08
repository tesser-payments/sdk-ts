import { afterEach, describe, expect, it, vi } from 'vitest';
import { TesserConfigError } from '../src/internal/errors.js';
import type { SigningConfig, StepForSigning } from '../src/internal/types.js';
import { LocalSigner } from '../src/signer.js';
import * as createWalletModule from '../src/signing/create-wallet.js';
import * as signStepModule from '../src/signing/sign-step.js';

const apiBaseUrl = 'https://api.tesser.xyz';

const signing: SigningConfig = {
  publicKey: '02'.padEnd(66, 'a'),
  privateKey: 'b'.repeat(64),
  enclaveId: 'org_test',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LocalSigner', () => {
  it('constructs with valid options and exposes only publicKey + enclaveId', () => {
    const s = new LocalSigner({ signing, apiBaseUrl });
    expect(s.signing.publicKey).toBe(signing.publicKey);
    expect(s.signing.enclaveId).toBe(signing.enclaveId);
    // privateKey must not be reachable via the public surface.
    // biome-ignore lint/suspicious/noExplicitAny: testing that the field is absent at runtime
    expect((s.signing as any).privateKey).toBeUndefined();
  });

  it('does not leak privateKey via JSON.stringify or util.inspect', () => {
    const s = new LocalSigner({ signing, apiBaseUrl });
    const serialized = JSON.stringify(s);
    expect(serialized).not.toContain(signing.privateKey);
    const inspected = String(s);
    expect(inspected).not.toContain(signing.privateKey);
  });

  it.each([
    ['blank publicKey', { ...signing, publicKey: '' }],
    ['blank privateKey', { ...signing, privateKey: '' }],
    ['blank enclaveId', { ...signing, enclaveId: '' }],
  ])('throws TesserConfigError on %s', (_label, bad) => {
    expect(() => new LocalSigner({ signing: bad, apiBaseUrl })).toThrow(TesserConfigError);
  });

  it.each([
    ['missing', undefined],
    ['plain http on a public host', 'http://api.tesser.xyz'],
    ['not a URL', 'api.tesser.xyz'],
  ])('throws TesserConfigError when apiBaseUrl is %s', (_label, badApiBaseUrl) => {
    expect(
      () => new LocalSigner({ signing, apiBaseUrl: badApiBaseUrl as unknown as string }),
    ).toThrow(TesserConfigError);
  });

  it('passes the normalized apiBaseUrl and the injected fetch to signCreateWallet', async () => {
    const spy = vi.spyOn(createWalletModule, 'signCreateWallet').mockResolvedValue({
      signature: 'sig',
      metadata: { stampHeaderName: 'X-Stamp', stampHeaderValue: 'v', body: '{}' },
    });
    const injectedFetch = vi.fn<typeof fetch>();
    const s = new LocalSigner({
      signing,
      apiBaseUrl: 'https://api-sandbox.tesser.xyz/v1/',
      fetch: injectedFetch,
    });
    await s.signCreateWallet({ name: 'w', type: 'stablecoin_ethereum' });
    expect(spy).toHaveBeenCalledWith(
      signing,
      { name: 'w', type: 'stablecoin_ethereum' },
      { baseUrl: 'https://api-sandbox.tesser.xyz', fetch: injectedFetch },
    );
  });

  it('signCreateWallet delegates to signing/create-wallet with full SigningConfig', async () => {
    const spy = vi.spyOn(createWalletModule, 'signCreateWallet').mockResolvedValue({
      signature: 'sig',
      metadata: { stampHeaderName: 'X-Stamp', stampHeaderValue: 'v', body: '{}' },
    });
    const s = new LocalSigner({ signing, apiBaseUrl });
    await s.signCreateWallet({ name: 'w', type: 'stablecoin_ethereum' });
    expect(spy).toHaveBeenCalledWith(
      signing,
      { name: 'w', type: 'stablecoin_ethereum' },
      { baseUrl: 'https://api.tesser.xyz', fetch: globalThis.fetch },
    );
  });

  it('signStep delegates to signing/sign-step with full SigningConfig', async () => {
    const step: StepForSigning = {
      unsignedTransaction: '0x',
      signWith: '0xa',
      network: 'BASE',
    };
    const spy = vi.spyOn(signStepModule, 'signStep').mockResolvedValue({
      signature: 'sig',
      metadata: { stampHeaderName: 'X-Stamp', stampHeaderValue: 'v', body: '{}' },
    });
    const s = new LocalSigner({ signing, apiBaseUrl });
    await s.signStep(step);
    expect(spy).toHaveBeenCalledWith(signing, step);
  });
});

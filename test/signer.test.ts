import { afterEach, describe, expect, it, vi } from 'vitest';
import { TesserConfigError } from '../src/internal/errors.js';
import type { SigningConfig, StepForSigning } from '../src/internal/types.js';
import { LocalSigner } from '../src/signer.js';
import * as createWalletModule from '../src/signing/create-wallet.js';
import * as signStepModule from '../src/signing/sign-step.js';

const signing: SigningConfig = {
  publicKey: '02'.padEnd(66, 'a'),
  privateKey: 'b'.repeat(64),
  enclaveId: 'org_test',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LocalSigner', () => {
  it('constructs with valid options', () => {
    const s = new LocalSigner({ signing });
    expect(s.signing.publicKey).toBe(signing.publicKey);
    expect(s.signing.enclaveId).toBe(signing.enclaveId);
  });

  it('freezes signing config', () => {
    const s = new LocalSigner({ signing });
    expect(() => {
      // biome-ignore lint/suspicious/noExplicitAny: testing runtime freeze
      (s.signing as any).publicKey = 'mutated';
    }).toThrow();
  });

  it.each([
    ['blank publicKey', { ...signing, publicKey: '' }],
    ['blank privateKey', { ...signing, privateKey: '' }],
    ['blank enclaveId', { ...signing, enclaveId: '' }],
  ])('throws TesserConfigError on %s', (_label, bad) => {
    expect(() => new LocalSigner({ signing: bad })).toThrow(TesserConfigError);
  });

  it('signCreateWallet delegates to signing/create-wallet', async () => {
    const spy = vi.spyOn(createWalletModule, 'signCreateWallet').mockResolvedValue({
      signature: 'sig',
      metadata: { stampHeaderName: 'X-Stamp', stampHeaderValue: 'v', body: '{}' },
    });
    const s = new LocalSigner({ signing });
    await s.signCreateWallet({ name: 'w', type: 'stablecoin_ethereum' });
    expect(spy).toHaveBeenCalledWith(signing, { name: 'w', type: 'stablecoin_ethereum' });
  });

  it('signStep delegates to signing/sign-step', async () => {
    const step: StepForSigning = {
      id: 's',
      transferId: 't',
      unsignedTransaction: '0x',
      signWith: '0xa',
      network: 'BASE',
    };
    const spy = vi.spyOn(signStepModule, 'signStep').mockResolvedValue({
      signature: 'sig',
      unsignedTransaction: '0x',
      metadata: { stampHeaderName: 'X-Stamp', stampHeaderValue: 'v', body: '{}' },
    });
    const s = new LocalSigner({ signing });
    await s.signStep(step);
    expect(spy).toHaveBeenCalledWith(signing, step, {});
  });

  it('signStep passes through opts when provided', async () => {
    const step: StepForSigning = {
      id: 's',
      transferId: 't',
      unsignedTransaction: '0x',
      signWith: '0xa',
      network: 'BASE',
    };
    const spy = vi.spyOn(signStepModule, 'signStep').mockResolvedValue({
      signature: 'sig',
      unsignedTransaction: '0x',
      metadata: { stampHeaderName: 'X-Stamp', stampHeaderValue: 'v', body: '{}' },
    });
    const s = new LocalSigner({ signing });
    const opts = {};
    await s.signStep(step, opts);
    expect(spy).toHaveBeenCalledWith(signing, step, opts);
  });
});

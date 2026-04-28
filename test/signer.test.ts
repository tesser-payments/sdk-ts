// test/signer.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TesserClient } from '../src/client.js';
import { TesserConfigError } from '../src/internal/errors.js';
import { LocalSigner } from '../src/signer.js';

const signCreateWalletMock = vi.hoisted(() => vi.fn());
vi.mock('../src/signing/create-wallet.js', () => ({ signCreateWallet: signCreateWalletMock }));

const clientCfg = {
  token: 'tok',
  signing: { publicKey: 'pk', privateKey: 'sk', enclaveId: 'org' },
};

describe('LocalSigner', () => {
  beforeEach(() => {
    signCreateWalletMock.mockReset();
    signCreateWalletMock.mockResolvedValue({
      signature: 'sig',
      metadata: { stampHeaderName: 'X', stampHeaderValue: 'sig', body: '{}' },
    });
  });

  it('reads signing config from the client by default', async () => {
    const client = new TesserClient(clientCfg);
    const signer = new LocalSigner(client);
    await signer.signCreateWallet({ name: 'A', type: 'stablecoin_ethereum' });
    expect(signCreateWalletMock).toHaveBeenCalledWith(
      { publicKey: 'pk', privateKey: 'sk', enclaveId: 'org' },
      { name: 'A', type: 'stablecoin_ethereum' },
    );
  });

  it('uses override signing config when provided', async () => {
    const client = new TesserClient(clientCfg);
    const override = { publicKey: 'PK2', privateKey: 'SK2', enclaveId: 'ORG2' };
    const signer = new LocalSigner(client, override);
    await signer.signCreateWallet({ name: 'A', type: 'stablecoin_ethereum' });
    expect(signCreateWalletMock).toHaveBeenCalledWith(override, expect.any(Object));
  });

  it('rejects partial signing override (must be complete)', () => {
    const client = new TesserClient(clientCfg);
    expect(
      () =>
        new LocalSigner(client, {
          publicKey: 'PK',
          privateKey: '',
          enclaveId: 'ORG',
        }),
    ).toThrow(TesserConfigError);
  });

  it('signCreateWallet returns the SignedResult from the underlying call', async () => {
    const client = new TesserClient(clientCfg);
    const signer = new LocalSigner(client);
    const r = await signer.signCreateWallet({ name: 'A', type: 'stablecoin_solana' });
    expect(r.signature).toBe('sig');
    expect(r.metadata.body).toBe('{}');
  });
});

// test/signing/create-wallet.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TesserConfigError } from '../../src/internal/errors.js';
import type { SigningConfig, WalletType } from '../../src/internal/types.js';
import { signCreateWallet } from '../../src/signing/create-wallet.js';

const stampMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/signing/stamp.js', () => ({ stamp: stampMock }));

const signing: SigningConfig = { publicKey: 'pk', privateKey: 'sk', enclaveId: 'org-1' };

describe('signCreateWallet', () => {
  beforeEach(() => {
    stampMock.mockReset();
    stampMock.mockResolvedValue({
      stampHeaderName: 'X-Stamp',
      stampHeaderValue: 'stamp-value',
    });
  });

  it('builds an ACTIVITY_TYPE_CREATE_WALLET payload with the Ethereum account spec', async () => {
    await signCreateWallet(signing, { name: 'Foo', type: 'stablecoin_ethereum' });
    expect(stampMock).toHaveBeenCalledTimes(1);

    const [keysArg, bodyArg] = stampMock.mock.calls[0] as [unknown, string];
    expect(keysArg).toEqual({ publicKey: 'pk', privateKey: 'sk' });

    const parsed = JSON.parse(bodyArg);
    expect(parsed.type).toBe('ACTIVITY_TYPE_CREATE_WALLET');
    expect(parsed.organizationId).toBe('org-1');
    expect(typeof parsed.timestampMs).toBe('string');
    expect(parsed.parameters.walletName).toBe('Foo');
    expect(parsed.parameters).not.toHaveProperty('walletType');
    expect(parsed.parameters.accounts).toEqual([
      {
        curve: 'CURVE_SECP256K1',
        pathFormat: 'PATH_FORMAT_BIP32',
        path: "m/44'/60'/0'/0/0",
        addressFormat: 'ADDRESS_FORMAT_ETHEREUM',
      },
    ]);
  });

  it('uses ED25519 + Solana address format for stablecoin_solana', async () => {
    await signCreateWallet(signing, { name: 'S', type: 'stablecoin_solana' });
    const parsed = JSON.parse((stampMock.mock.calls[0] as [unknown, string])[1]);
    expect(parsed.parameters.accounts[0].curve).toBe('CURVE_ED25519');
    expect(parsed.parameters.accounts[0].addressFormat).toBe('ADDRESS_FORMAT_SOLANA');
    expect(parsed.parameters.accounts[0].path).toBe("m/44'/501'/0'/0'");
  });

  it('uses ED25519 + Stellar address format for stablecoin_stellar', async () => {
    await signCreateWallet(signing, { name: 'St', type: 'stablecoin_stellar' });
    const parsed = JSON.parse((stampMock.mock.calls[0] as [unknown, string])[1]);
    expect(parsed.parameters.accounts[0].curve).toBe('CURVE_ED25519');
    expect(parsed.parameters.accounts[0].addressFormat).toBe('ADDRESS_FORMAT_XLM');
    expect(parsed.parameters.accounts[0].path).toBe("m/44'/148'/0'");
  });

  it('throws TesserConfigError on an invalid WalletType (defends against bad string casts)', async () => {
    await expect(
      signCreateWallet(signing, { name: 'X', type: 'stablecoin_ethereuum' as WalletType }),
    ).rejects.toBeInstanceOf(TesserConfigError);
    expect(stampMock).not.toHaveBeenCalled();
  });

  it('returns SignedResult with base64-encoded {body, stamp} signature and raw metadata', async () => {
    const result = await signCreateWallet(signing, { name: 'Bar', type: 'stablecoin_solana' });

    // signature is base64(JSON.stringify({ body, stamp }))
    const decoded = JSON.parse(Buffer.from(result.signature, 'base64').toString('utf8'));
    expect(decoded.stamp).toBe('stamp-value');
    expect(JSON.parse(decoded.body).parameters.walletName).toBe('Bar');
    expect(decoded.body).toBe(result.metadata.body);

    // metadata still carries the raw stamp values for debuggability
    expect(result.metadata.stampHeaderName).toBe('X-Stamp');
    expect(result.metadata.stampHeaderValue).toBe('stamp-value');
    expect(JSON.parse(result.metadata.body).parameters.walletName).toBe('Bar');
  });
});

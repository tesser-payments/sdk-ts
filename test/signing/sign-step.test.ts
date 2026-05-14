import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TesserConfigError } from '../../src/internal/errors.js';
import type { SigningConfig, StepForSigning } from '../../src/internal/types.js';
import { signStep } from '../../src/signing/sign-step.js';
import * as stampModule from '../../src/signing/stamp.js';

const signing: SigningConfig = {
  publicKey: '02'.padEnd(66, 'a'),
  privateKey: 'b'.repeat(64),
  enclaveId: 'org_test',
};

const baseStep: StepForSigning = {
  id: 'step_1',
  transferId: 'rb_1',
  unsignedTransaction: '0x02deadbeef',
  signWith: '0xabc',
  network: 'BASE_SEPOLIA',
};

beforeEach(() => {
  vi.spyOn(stampModule, 'stamp').mockResolvedValue({
    stampHeaderName: 'X-Stamp',
    stampHeaderValue: 'fake-stamp-value',
  });
  vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('signStep', () => {
  it('builds ACTIVITY_TYPE_SIGN_TRANSACTION_V2 body with correct fields', async () => {
    const result = await signStep(signing, baseStep, {});

    const parsedBody = JSON.parse(result.metadata.body);
    expect(parsedBody).toEqual({
      type: 'ACTIVITY_TYPE_SIGN_TRANSACTION_V2',
      timestampMs: '1700000000000',
      organizationId: 'org_test',
      parameters: {
        signWith: '0xabc',
        unsignedTransaction: '0x02deadbeef',
        type: 'TRANSACTION_TYPE_ETHEREUM',
      },
    });
  });

  it('maps SOLANA network correctly', async () => {
    const result = await signStep(signing, { ...baseStep, network: 'SOLANA' }, {});
    const parsedBody = JSON.parse(result.metadata.body);
    expect(parsedBody.parameters.type).toBe('TRANSACTION_TYPE_SOLANA');
  });

  it('returns signature as base64(JSON({body, stamp}))', async () => {
    const result = await signStep(signing, baseStep, {});
    const decoded = Buffer.from(result.signature, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    expect(parsed.body).toBe(result.metadata.body);
    expect(parsed.stamp).toBe('fake-stamp-value');
  });

  it('echoes unsignedTransaction in the result', async () => {
    const result = await signStep(signing, baseStep, {});
    expect(result.unsignedTransaction).toBe('0x02deadbeef');
  });

  it('passes correct keys to stamp()', async () => {
    await signStep(signing, baseStep, {});
    expect(stampModule.stamp).toHaveBeenCalledWith(
      { publicKey: signing.publicKey, privateKey: signing.privateKey },
      expect.any(String),
    );
  });

  it('returns metadata with X-Stamp header info', async () => {
    const result = await signStep(signing, baseStep, {});
    expect(result.metadata.stampHeaderName).toBe('X-Stamp');
    expect(result.metadata.stampHeaderValue).toBe('fake-stamp-value');
  });

  it('throws TesserConfigError for unsupported network', async () => {
    await expect(signStep(signing, { ...baseStep, network: 'NOPE' }, {})).rejects.toBeInstanceOf(
      TesserConfigError,
    );
  });
});

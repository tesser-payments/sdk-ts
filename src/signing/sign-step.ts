// src/signing/sign-step.ts
//
// Builds Turnkey ACTIVITY_TYPE_SIGN_TRANSACTION_V2 payload and stamps it.

import type {
  SignedStepResult,
  SignStepOptions,
  SigningConfig,
  StepForSigning,
} from '../internal/types.js';
import { networkToTurnkeyType } from './network-type.js';
import { stamp } from './stamp.js';

export async function signStep(
  signing: SigningConfig,
  step: StepForSigning,
  _opts: SignStepOptions = {},
): Promise<SignedStepResult> {
  const turnkeyType = networkToTurnkeyType(step.network);

  const body = JSON.stringify({
    type: 'ACTIVITY_TYPE_SIGN_TRANSACTION_V2',
    timestampMs: String(Date.now()),
    organizationId: signing.enclaveId,
    parameters: {
      signWith: step.signWith,
      unsignedTransaction: step.unsignedTransaction,
      type: turnkeyType,
    },
  });

  const stamped = await stamp(
    { publicKey: signing.publicKey, privateKey: signing.privateKey },
    body,
  );

  const composite = JSON.stringify({ body, stamp: stamped.stampHeaderValue });
  const signature = Buffer.from(composite, 'utf-8').toString('base64');

  return {
    signature,
    unsignedTransaction: step.unsignedTransaction,
    metadata: {
      stampHeaderName: stamped.stampHeaderName,
      stampHeaderValue: stamped.stampHeaderValue,
      body,
    },
  };
}

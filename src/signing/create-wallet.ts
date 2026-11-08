// src/signing/create-wallet.ts
import { TesserConfigError } from '../internal/errors.js';
import type {
  CreateWalletParams,
  SignedResult,
  SigningConfig,
  WalletType,
} from '../internal/types.js';
import { stamp } from './stamp.js';
import {
  type TesserApiConnection,
  fetchCheckedCreateWalletAccountsBody,
} from './unsigned-payload.js';

type Curve = 'CURVE_ED25519';
type PathFormat = 'PATH_FORMAT_BIP32';
type AddressFormat = 'ADDRESS_FORMAT_SOLANA' | 'ADDRESS_FORMAT_XLM';
type LocallyBuiltWalletType = Exclude<WalletType, 'stablecoin_ethereum'>;

interface AccountSpec {
  curve: Curve;
  pathFormat: PathFormat;
  path: string;
  addressFormat: AddressFormat;
}

// Per-wallet-type Turnkey account specs. The Solana and Stellar mappings are
// best-guesses pending Phase A staging verification (see spec Open Item #2).
const WALLET_TYPE_ACCOUNTS: Record<LocallyBuiltWalletType, AccountSpec[]> = {
  stablecoin_solana: [
    {
      curve: 'CURVE_ED25519',
      pathFormat: 'PATH_FORMAT_BIP32',
      path: "m/44'/501'/0'/0'",
      addressFormat: 'ADDRESS_FORMAT_SOLANA',
    },
  ],
  stablecoin_stellar: [
    {
      curve: 'CURVE_ED25519',
      pathFormat: 'PATH_FORMAT_BIP32',
      path: "m/44'/148'/0'",
      addressFormat: 'ADDRESS_FORMAT_XLM',
    },
  ],
};

const VALID_WALLET_TYPES: WalletType[] = [
  'stablecoin_ethereum',
  'stablecoin_solana',
  'stablecoin_stellar',
];

export async function signCreateWallet(
  signing: SigningConfig,
  params: CreateWalletParams,
  api: TesserApiConnection,
): Promise<SignedResult> {
  // Runtime validation — TS's `Record<WalletType, ...>` lookup does not surface
  // `undefined` even with `noUncheckedIndexedAccess`, so a bad string cast (e.g.
  // from an env var) would otherwise stamp `accounts: undefined` silently.
  if (!VALID_WALLET_TYPES.includes(params.type)) {
    throw new TesserConfigError(
      `signCreateWallet: type '${String(params.type)}' is not a valid WalletType. ` +
        `Valid values: ${VALID_WALLET_TYPES.join(', ')}.`,
    );
  }

  const body = await resolveCreateWalletBody({ signing, params, api });

  const result = await stamp(
    { publicKey: signing.publicKey, privateKey: signing.privateKey },
    body,
  );

  // Tesser's signature field is base64(JSON.stringify({ body, stamp })).
  // (Verified at the Phase A staging gate; matches Tesser's standalone reference signer.)
  const signature = Buffer.from(JSON.stringify({ body, stamp: result.stampHeaderValue })).toString(
    'base64',
  );

  return {
    signature,
    metadata: {
      stampHeaderName: result.stampHeaderName,
      stampHeaderValue: result.stampHeaderValue,
      body,
    },
  };
}

async function resolveCreateWalletBody(options: {
  signing: SigningConfig;
  params: CreateWalletParams;
  api: TesserApiConnection;
}): Promise<string> {
  const { signing, params, api } = options;
  if (params.type === 'stablecoin_ethereum') {
    return fetchCheckedCreateWalletAccountsBody({ api, signing, params });
  }
  return buildCreateWalletBody({
    enclaveId: signing.enclaveId,
    name: params.name,
    type: params.type,
  });
}

function buildCreateWalletBody(options: {
  enclaveId: string;
  name: string;
  type: LocallyBuiltWalletType;
}): string {
  return JSON.stringify({
    type: 'ACTIVITY_TYPE_CREATE_WALLET',
    timestampMs: String(Date.now()),
    organizationId: options.enclaveId,
    parameters: {
      walletName: options.name,
      accounts: WALLET_TYPE_ACCOUNTS[options.type],
    },
  });
}

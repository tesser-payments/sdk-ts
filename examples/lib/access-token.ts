// examples/lib/access-token.ts
//
// Shared OAuth `client_credentials` token helper for examples/.
// The SDK itself does not implement OAuth — example scripts (and downstream
// consumers) handle token lifecycle and pass a fresh bearer to TesserClient.
//
// Default token URL: https://auth.tesser.xyz/oauth/token (per
// https://docs.tesser.xyz/overviews/authentication). Override with
// `process.env.AUTH_TOKEN_URL` or by passing `options.tokenUrl`.

const DEFAULT_TOKEN_URL = 'https://auth.tesser.xyz/oauth/token';

export interface GetAccessTokenOptions {
  tokenUrl?: string;
}

export async function getAccessToken(
  audience: string,
  clientId: string,
  clientSecret: string,
  options: GetAccessTokenOptions = {},
): Promise<string> {
  const tokenUrl = options.tokenUrl ?? process.env.AUTH_TOKEN_URL ?? DEFAULT_TOKEN_URL;

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      audience,
    }),
  });
  if (!res.ok) {
    throw new Error(`OAuth failed: ${res.status} ${res.statusText} — ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('OAuth response missing access_token');
  return json.access_token;
}

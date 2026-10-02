import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'https://esm.sh/jose@5.9.6';

const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

// A fresh authorization code avoids storing Apple refresh tokens. Verify its
// subject against the authenticated account before revoking or deleting data.
export async function revokeAppleAccount(code: string, subject: string) {
  const clientId = Deno.env.get('APPLE_CLIENT_ID');
  const teamId = Deno.env.get('APPLE_TEAM_ID');
  const keyId = Deno.env.get('APPLE_KEY_ID');
  const pem = Deno.env.get('APPLE_PRIVATE_KEY')?.replace(/\\n/g, '\n');
  if (!clientId || !teamId || !keyId || !pem) throw new Error('Apple revocation is not configured.');
  const key = await importPKCS8(pem, 'ES256');
  const secret = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuer(teamId).setSubject(clientId).setAudience('https://appleid.apple.com')
    .setIssuedAt().setExpirationTime('5m').sign(key);
  const tokenResponse = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, code, grant_type: 'authorization_code' }),
    signal: AbortSignal.timeout(15000),
  });
  if (!tokenResponse.ok) throw new Error('Apple authorization failed.');
  const tokens = await tokenResponse.json();
  const { payload } = await jwtVerify(tokens.id_token, appleKeys, {
    issuer: 'https://appleid.apple.com', audience: clientId, algorithms: ['RS256'],
  });
  if (payload.sub !== subject) throw new Error('Apple account does not match.');
  if (typeof tokens.refresh_token !== 'string' || !tokens.refresh_token) throw new Error('Apple did not return a revocation token.');
  const revoked = await fetch('https://appleid.apple.com/auth/revoke', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, token: tokens.refresh_token, token_type_hint: 'refresh_token' }),
    signal: AbortSignal.timeout(15000),
  });
  if (!revoked.ok) throw new Error('Apple revocation failed.');
}

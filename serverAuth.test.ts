import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  FIREBASE_AUTH_ISSUER,
  FIREBASE_PROJECT_ID,
  fetchVerifiedBonusTokens,
  PRIMARY_ADMIN_UID,
  verifyFirebaseIdToken,
} from './serverAuth.mjs';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const TEST_KID = 'test-kid-1';

function signJwt(payload: Record<string, unknown>, kid = TEST_KID, privKey = privateKey): string {
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${headerB64}.${payloadB64}`);
  signer.end();
  const sigB64 = signer.sign(privKey).toString('base64url');
  return `${headerB64}.${payloadB64}.${sigB64}`;
}

test('verifyFirebaseIdToken enforces Bearer header, RSA signature, expiration, aud/iss, and Admin identity', async () => {
  const certs = { [TEST_KID]: publicKey };
  const nowSec = 1_700_000_000;

  // Missing header -> 401
  const missing = await verifyFirebaseIdToken(undefined, { certs, nowSec });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.status, 401);

  // Invalid signature -> 401
  const validToken = signJwt({
    aud: FIREBASE_PROJECT_ID,
    iss: FIREBASE_AUTH_ISSUER,
    sub: 'user_warehouse_abc',
    email: 'kho1@gmail.com',
    email_verified: true,
    iat: nowSec - 60,
    exp: nowSec + 3600,
  });
  const tamperedToken = `${validToken.slice(0, -4)}AAAA`;
  const invalidSig = await verifyFirebaseIdToken(`Bearer ${tamperedToken}`, { certs, nowSec });
  assert.equal(invalidSig.ok, false);

  // Expired token -> 401
  const expiredToken = signJwt({
    aud: FIREBASE_PROJECT_ID,
    iss: FIREBASE_AUTH_ISSUER,
    sub: 'user_warehouse_abc',
    iat: nowSec - 7200,
    exp: nowSec - 60,
  });
  const expired = await verifyFirebaseIdToken(`Bearer ${expiredToken}`, { certs, nowSec });
  assert.equal(expired.ok, false);

  // Wrong aud / iss -> 401
  const wrongAudToken = signJwt({
    aud: 'other-project',
    iss: FIREBASE_AUTH_ISSUER,
    sub: 'user_warehouse_abc',
    iat: nowSec - 60,
    exp: nowSec + 3600,
  });
  assert.equal((await verifyFirebaseIdToken(`Bearer ${wrongAudToken}`, { certs, nowSec })).ok, false);

  const wrongIssToken = signJwt({
    aud: FIREBASE_PROJECT_ID,
    iss: 'https://evil.example.com',
    sub: 'user_warehouse_abc',
    iat: nowSec - 60,
    exp: nowSec + 3600,
  });
  assert.equal((await verifyFirebaseIdToken(`Bearer ${wrongIssToken}`, { certs, nowSec })).ok, false);

  // Valid regular warehouse token
  const valid = await verifyFirebaseIdToken(`Bearer ${validToken}`, { certs, nowSec });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.uid, 'user_warehouse_abc');
    assert.equal(valid.effectiveAccountId, 'user_warehouse_abc');
    assert.equal(valid.isPrimaryAdmin, false);
  }

  // Verified Admin email resolves to PRIMARY_ADMIN_UID
  const adminToken = signJwt({
    aud: FIREBASE_PROJECT_ID,
    iss: FIREBASE_AUTH_ISSUER,
    sub: PRIMARY_ADMIN_UID,
    email: 'trannhat1205@gmail.com',
    email_verified: true,
    iat: nowSec - 60,
    exp: nowSec + 3600,
  });
  const validAdmin = await verifyFirebaseIdToken(`Bearer ${adminToken}`, { certs, nowSec });
  assert.equal(validAdmin.ok, true);
  if (validAdmin.ok) {
    assert.equal(validAdmin.isPrimaryAdmin, true);
    assert.equal(validAdmin.effectiveAccountId, PRIMARY_ADMIN_UID);
  }
});

test('fetchVerifiedBonusTokens reads same-day grant from Firestore REST response and rejects stale dates', async () => {
  const bonusToday = await fetchVerifiedBonusTokens('user_1', 'tok_1', '2026-11-26', {
    bypassCache: true,
    fetchImpl: (async () =>
      ({
        ok: true,
        json: async () => ({
          fields: {
            date: { stringValue: '2026-11-26' },
            bonusTokens: { integerValue: '25000' },
          },
        }),
      }) as Response) as typeof fetch,
  });
  assert.equal(bonusToday, 25000);

  const staleBonus = await fetchVerifiedBonusTokens('user_1', 'tok_1', '2026-11-26', {
    bypassCache: true,
    fetchImpl: (async () =>
      ({
        ok: true,
        json: async () => ({
          fields: {
            date: { stringValue: '2026-11-25' },
            bonusTokens: { integerValue: '25000' },
          },
        }),
      }) as Response) as typeof fetch,
  });
  assert.equal(staleBonus, 0);
});

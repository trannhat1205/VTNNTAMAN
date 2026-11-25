import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const FIREBASE_PROJECT_ID = 'gapgold-e6b62';
export const FIREBASE_AUTH_ISSUER = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
export const FIRESTORE_DATABASE_ID = 'ai-studio-f4ba431b-caee-4e51-963d-b72f14574529';
export const PRIMARY_ADMIN_UID = 'Gu6OYdsdiWbRvbEINqaWZXj3LV83';
export const ADMIN_BACKUP_EMAIL = 'trannhat1205@gmail.com';
const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

export const ALLOWED_GEMINI_ORIGINS = new Set([
  'https://vtnntaman.com',
  'https://www.vtnntaman.com',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
]);

let cachedCerts = null;
let cachedCertsExpiresAt = 0;

const BONUS_TOKEN_CACHE = new Map();
const BONUS_TOKEN_TTL_MS = 30_000;

export function applyGeminiCors(req, res) {
  const origin = typeof req?.headers?.origin === 'string' ? req.headers.origin.trim() : '';
  if (ALLOWED_GEMINI_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export function loadDotEnvIntoProcess(baseDir) {
  for (const fileName of ['.env.local', '.env']) {
    const filePath = path.join(baseDir, fileName);
    if (!fs.existsSync(filePath)) continue;
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eqIdx = line.indexOf('=');
        if (eqIdx <= 0) continue;
        const key = line.slice(0, eqIdx).trim();
        let val = line.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (key && !(key in process.env)) {
          process.env[key] = val;
        }
      }
    } catch {
      // ignore dotenv read error
    }
  }
}

async function getGooglePublicCerts(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedCerts && now < cachedCertsExpiresAt) {
    return cachedCerts;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(GOOGLE_CERTS_URL, { signal: controller.signal });
    if (!res.ok) {
      if (cachedCerts) return cachedCerts;
      throw new Error(`HTTP ${res.status}`);
    }
    const certs = await res.json();
    const cc = res.headers.get('cache-control') || '';
    const maxAgeMatch = cc.match(/max-age=(\d+)/i);
    const maxAgeSec = maxAgeMatch ? Math.min(3000, Math.max(60, Number(maxAgeMatch[1]))) : 3000;
    cachedCerts = certs;
    cachedCertsExpiresAt = now + maxAgeSec * 1000;
    return certs;
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyFirebaseIdToken(authHeader, options = {}) {
  const raw = typeof authHeader === 'string' ? authHeader.trim() : '';
  const bearerMatch = raw.match(/^Bearer\s+(.+)$/i);
  if (!bearerMatch || !bearerMatch[1]?.trim()) {
    return {
      ok: false,
      status: 401,
      error: 'Vui lòng đăng nhập tài khoản để sử dụng Trợ lý A.I.',
    };
  }

  const token = bearerMatch[1].trim();
  const parts = token.split('.');
  if (parts.length !== 3) {
    return {
      ok: false,
      status: 401,
      error: 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.',
    };
  }

  const [headerB64, payloadB64, sigB64] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return {
      ok: false,
      status: 401,
      error: 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.',
    };
  }

  if (
    !header ||
    header.alg !== 'RS256' ||
    typeof header.kid !== 'string' ||
    !header.kid
  ) {
    return {
      ok: false,
      status: 401,
      error: 'Mã xác thực phiên đăng nhập không hợp lệ.',
    };
  }

  const nowSec = Number.isFinite(options.nowSec) ? options.nowSec : Math.floor(Date.now() / 1000);
  if (
    !payload ||
    payload.aud !== FIREBASE_PROJECT_ID ||
    payload.iss !== FIREBASE_AUTH_ISSUER ||
    typeof payload.sub !== 'string' ||
    payload.sub.length < 1 ||
    payload.sub.length > 128 ||
    typeof payload.exp !== 'number' ||
    payload.exp <= nowSec - 30 ||
    typeof payload.iat !== 'number' ||
    payload.iat > nowSec + 300
  ) {
    return {
      ok: false,
      status: 401,
      error: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.',
    };
  }

  let certPem;
  if (options.certs) {
    certPem = options.certs[header.kid];
  } else {
    try {
      let certs = await getGooglePublicCerts(false);
      certPem = certs?.[header.kid];
      if (!certPem) {
        certs = await getGooglePublicCerts(true);
        certPem = certs?.[header.kid];
      }
    } catch {
      return {
        ok: false,
        status: 401,
        error: 'Không thể xác minh chứng chỉ đăng nhập Google lúc này.',
      };
    }
  }

  if (!certPem) {
    return {
      ok: false,
      status: 401,
      error: 'Chữ ký phiên đăng nhập không khớp. Vui lòng đăng nhập lại.',
    };
  }

  let signatureValid = false;
  try {
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${headerB64}.${payloadB64}`);
    verifier.end();
    signatureValid = verifier.verify(certPem, Buffer.from(sigB64, 'base64url'));
  } catch {
    signatureValid = false;
  }

  if (!signatureValid) {
    return {
      ok: false,
      status: 401,
      error: 'Phiên đăng nhập không hợp lệ (sai chữ ký). Vui lòng đăng nhập lại.',
    };
  }

  const email = typeof payload.email === 'string' ? payload.email.trim() : '';
  const emailVerified = payload.email_verified === true;
  const isPrimaryAdmin =
    payload.sub === PRIMARY_ADMIN_UID ||
    (emailVerified && email.toLowerCase() === ADMIN_BACKUP_EMAIL);
  const effectiveAccountId = isPrimaryAdmin ? PRIMARY_ADMIN_UID : payload.sub;

  return {
    ok: true,
    uid: payload.sub,
    email,
    emailVerified,
    isPrimaryAdmin,
    effectiveAccountId,
    idToken: token,
  };
}

export async function fetchVerifiedBonusTokens(effectiveAccountId, idToken, todayVn, options = {}) {
  const safeUid = String(effectiveAccountId || '').trim();
  if (!safeUid || !idToken || !todayVn) return 0;

  const cacheKey = `${safeUid}:${todayVn}`;
  const cached = BONUS_TOKEN_CACHE.get(cacheKey);
  if (!options.bypassCache && cached && Date.now() < cached.expiresAt) {
    return cached.bonusTokens;
  }

  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIRESTORE_DATABASE_ID}/documents/ai_token_grants/${encodeURIComponent(
    safeUid
  )}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const fetchFn = options.fetchImpl || fetch;
    const res = await fetchFn(url, {
      headers: { Authorization: `Bearer ${idToken}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      return 0;
    }
    const doc = await res.json();
    const fields = doc?.fields || {};
    const grantDate = fields.date?.stringValue || '';
    const rawBonus =
      fields.bonusTokens?.integerValue ?? fields.bonusTokens?.doubleValue ?? 0;
    const bonusTokens =
      grantDate === todayVn ? Math.max(0, Math.min(5_000_000, Math.round(Number(rawBonus) || 0))) : 0;
    BONUS_TOKEN_CACHE.set(cacheKey, {
      bonusTokens,
      expiresAt: Date.now() + BONUS_TOKEN_TTL_MS,
    });
    return bonusTokens;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  applyGeminiCors,
  fetchVerifiedBonusTokens,
  loadDotEnvIntoProcess,
  verifyFirebaseIdToken,
} from './serverAuth.mjs';

const BASE_DIR = import.meta.dirname;
loadDotEnvIntoProcess(BASE_DIR);
const DIST_SUBDIR = path.join(BASE_DIR, 'dist');
const STATIC_ROOT = fs.existsSync(path.join(DIST_SUBDIR, 'index.html'))
  ? DIST_SUBDIR
  : BASE_DIR;

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

const DAILY_AI_QUESTION_LIMIT = 30;
const DAILY_AI_TOKEN_LIMIT = 10000;
const RESPONSE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const ACCOUNT_QUOTAS = new Map();
const SERVER_RESPONSE_CACHE = new Map();

function getTodayVietnamDateStr() {
  const vnTime = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return vnTime.toISOString().slice(0, 10);
}

function getOrResetQuota(accountId) {
  const safeId = String(accountId || 'guest').trim() || 'guest';
  const todayVn = getTodayVietnamDateStr();
  const existing = ACCOUNT_QUOTAS.get(safeId);
  if (!existing || existing.date !== todayVn) {
    const fresh = {
      accountId: safeId,
      date: todayVn,
      questionsUsed: 0,
      questionLimit: DAILY_AI_QUESTION_LIMIT,
      tokensUsed: 0,
      tokenLimit: DAILY_AI_TOKEN_LIMIT,
      freeModelQuestions: 0,
      deepModelQuestions: 0,
      updatedAt: new Date().toISOString(),
    };
    ACCOUNT_QUOTAS.set(safeId, fresh);
    return fresh;
  }
  return existing;
}

function isExternalQuerySimple(rawQuery) {
  const ascii = String(rawQuery || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase();
  const internalHints = [
    'kho', 'ton kho', 'het hang', 'sap het', 'doanh thu', 'loi nhuan',
    'cong no', 'khach hang', 'phieu thu', 'phieu chi', 'dong tien', 'nha cung cap',
  ];
  const externalHints = [
    'gia phan', 'gia lua', 'gia gao', 'om18', 'st25', 'sau rieng',
    'thi truong', 'thoi tiet', 'ky thuat', 'san pham gi', 'thuoc gi',
    'cong ty', 'bvtv', 'bao ve thuc vat', 'hoat chat',
  ];
  if (externalHints.some((k) => ascii.includes(k))) return true;
  if (internalHints.some((k) => ascii.includes(k))) return false;
  return true;
}

function getCandidateApiKeys() {
  const keys = [];
  for (const candidate of [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.VITE_GEMINI_API_KEY,
    process.env.API_KEY,
  ]) {
    const trimmed = typeof candidate === 'string' ? candidate.trim() : '';
    if (trimmed && !keys.includes(trimmed)) {
      keys.push(trimmed);
    }
  }
  return keys;
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Gemini call timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const COMPRESSIBLE_EXTS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.txt']);

function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
}

function sendFile(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const baseName = path.basename(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const isNoCache =
    ext === '.html' || baseName === 'sw.js' || ext === '.webmanifest';
  const isHashedAsset =
    filePath.includes(`${path.sep}assets${path.sep}`) &&
    !isNoCache &&
    /-[a-z0-9_-]{6,}\.(js|css|woff2?)$/i.test(baseName);

  applySecurityHeaders(res);
  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Cache-Control',
    isNoCache
      ? 'no-cache, no-store, must-revalidate'
      : isHashedAsset
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=3600, must-revalidate'
  );

  if (req.method === 'HEAD') {
    res.writeHead(200);
    res.end();
    return;
  }

  const acceptEncoding = String(req.headers['accept-encoding'] || '');
  const shouldGzip = COMPRESSIBLE_EXTS.has(ext) && acceptEncoding.includes('gzip');

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal Server Error');
      return;
    }
    if (shouldGzip) {
      zlib.gzip(data, (zipErr, compressed) => {
        if (zipErr) {
          res.writeHead(200);
          res.end(data);
          return;
        }
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        res.writeHead(200);
        res.end(compressed);
      });
    } else {
      res.writeHead(200);
      res.end(data);
    }
  });
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  let pathname = '/';
  try {
    const parsedUrl = new URL(req.url, 'http://localhost');
    pathname = decodeURIComponent(parsedUrl.pathname);
  } catch {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  if (pathname.startsWith('/api/gemini/')) {
    applyGeminiCors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (pathname === '/api/gemini/status' && req.method === 'GET') {
      const authCheck = await verifyFirebaseIdToken(req.headers.authorization);
      if (!authCheck.ok) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: authCheck.error, authRequired: true }));
        return;
      }
      const candidateKeys = getCandidateApiKeys();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          configured: candidateKeys.length > 0,
          keyState: candidateKeys.length > 0 ? 'connected' : 'not_configured',
        })
      );
      return;
    }
    if (pathname === '/api/gemini/chat' && req.method === 'POST') {
      const authCheck = await verifyFirebaseIdToken(req.headers.authorization);
      if (!authCheck.ok) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: authCheck.error, authRequired: true }));
        return;
      }

      let rawBody = '';
      req.on('data', (chunk) => {
        rawBody += chunk;
      });
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(rawBody || '{}');
          const message = String(parsed.message || '').normalize('NFC').trim();
          if (!message) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Vui lòng nhập nội dung câu hỏi.' }));
            return;
          }

          const accountId = authCheck.effectiveAccountId;
          const quota = getOrResetQuota(accountId);
          const bonusTokens = await fetchVerifiedBonusTokens(
            accountId,
            authCheck.idToken,
            quota.date
          );
          const effectiveTokenLimit = DAILY_AI_TOKEN_LIMIT + bonusTokens;
          quota.bonusTokens = bonusTokens;
          quota.tokenLimit = effectiveTokenLimit;
          if (quota.questionsUsed >= DAILY_AI_QUESTION_LIMIT || quota.tokensUsed >= effectiveTokenLimit) {
            res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(
              JSON.stringify({
                error:
                  quota.questionsUsed >= DAILY_AI_QUESTION_LIMIT
                    ? `Tài khoản đã đạt giới hạn ${DAILY_AI_QUESTION_LIMIT} câu hỏi Trợ lý A.I trong ngày ${quota.date}. Vui lòng chờ làm mới vào 00:00 ngày mai.`
                    : `Tài khoản đã sử dụng hết hạn mức ${effectiveTokenLimit.toLocaleString('vi-VN')} token Trợ lý A.I trong ngày ${quota.date}. Hãy nhắn tin cho Admin quản trị chính trong mục Chat nội bộ để xin cấp thêm token, hoặc chờ tự động làm mới vào 00:00 ngày mai.`,
                quotaExceeded: true,
                quota,
              })
            );
            return;
          }

          const requested = String(parsed.model || 'auto');
          const isExternal =
            parsed.queryScope === 'external' ||
            (parsed.queryScope !== 'internal' && isExternalQuerySimple(message));
          const activeSys = isExternal
            ? String(parsed.externalSystemInstruction || parsed.systemInstruction || '')
            : String(parsed.internalSystemInstruction || parsed.systemInstruction || '');
          const sysHash = `${isExternal ? 'external' : 'internal'}:${activeSys.slice(0, 160)}:${activeSys.length}`;
          const cacheKey = `${requested}::${sysHash}::${message.toLowerCase()}`;
          const cached = SERVER_RESPONSE_CACHE.get(cacheKey);
          if (cached && Date.now() - cached.cachedAt < RESPONSE_CACHE_TTL_MS) {
            quota.questionsUsed += 1;
            quota.updatedAt = new Date().toISOString();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(
              JSON.stringify({
                text: cached.text,
                modelUsed: cached.modelUsed,
                queryScope: isExternal ? 'external' : 'internal',
                apiConnected: true,
                cached: true,
                verifiedWebSearch: cached.sources.length > 0,
                keyState: 'connected',
                sources: cached.sources,
                usage: { totalTokens: 0 },
                quota,
              })
            );
            return;
          }

          const candidateKeys = getCandidateApiKeys();
          if (candidateKeys.length > 0 && message) {
            const fallbackModels =
              requested === 'auto'
                ? isExternal
                  ? ['gemini-3.1-flash-lite', 'gemini-4-hydrogen']
                  : ['gemma-4-26b-a4b-it', 'gemini-3.1-flash-lite', 'gemini-4-hydrogen']
                : requested === 'gemma-4-26b-a4b-it'
                ? isExternal
                  ? ['gemini-3.1-flash-lite', 'gemini-4-hydrogen']
                  : ['gemma-4-26b-a4b-it', 'gemini-3.1-flash-lite', 'gemini-4-hydrogen']
                : requested === 'gemini-3.1-flash-lite'
                ? isExternal
                  ? ['gemini-3.1-flash-lite', 'gemini-4-hydrogen']
                  : ['gemini-3.1-flash-lite', 'gemma-4-26b-a4b-it', 'gemini-4-hydrogen']
                : ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];

            const historyContents = Array.isArray(parsed.history)
              ? parsed.history
                  .filter((h) => h && (h.role === 'user' || h.role === 'model') && typeof h.text === 'string' && h.text.trim())
                  .slice(-8)
                  .map((h) => ({ role: h.role, parts: [{ text: h.text.normalize('NFC') }] }))
              : [];

            for (let keyIdx = 0; keyIdx < candidateKeys.length; keyIdx++) {
              const apiKey = candidateKeys[keyIdx];
              const ai = new GoogleGenAI({
                apiKey,
                httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
              });

              for (const candidateModel of fallbackModels) {
                const useSearch = isExternal && candidateModel !== 'gemma-4-26b-a4b-it';
                try {
                  const thinkingLevel =
                    candidateModel === 'gemini-4-hydrogen' ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL;
                  const maxOutputTokens = candidateModel === 'gemini-4-hydrogen' ? 2048 : 1400;

                  const response = await withTimeout(
                    ai.models.generateContent({
                      model: candidateModel,
                      contents: [...historyContents, { role: 'user', parts: [{ text: message }] }],
                      config: {
                        ...(activeSys ? { systemInstruction: activeSys } : {}),
                        thinkingConfig: { thinkingLevel },
                        maxOutputTokens,
                        ...(useSearch ? { tools: [{ googleSearch: {} }] } : {}),
                      },
                    }),
                    22000
                  );

                  const parts = response?.candidates?.[0]?.content?.parts || [];
                  const visiblePartsText = parts
                    .filter((p) => p && p.thought !== true && typeof p.text === 'string')
                    .map((p) => p.text)
                    .join('')
                    .trim();
                  const text = visiblePartsText || (response?.text ? String(response.text).trim() : '');

                  if (text && !text.startsWith('google:search{') && !text.startsWith('call:google:search')) {
                    const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
                    if (useSearch && chunks.length === 0) continue;
                    const sources = chunks
                      .map((c) => c?.web)
                      .filter((w) => w && w.uri)
                      .slice(0, 6)
                      .map((w) => ({ title: w.title || w.uri, uri: w.uri, sourceName: w.title }));
                    const totalTokens =
                      Number(response?.usageMetadata?.totalTokenCount) ||
                      Math.ceil((message.length + text.length) / 3);
                    quota.questionsUsed += 1;
                    quota.tokensUsed += totalTokens;
                    if (candidateModel === 'gemini-4-hydrogen') quota.deepModelQuestions += 1;
                    else quota.freeModelQuestions += 1;
                    quota.updatedAt = new Date().toISOString();

                    if (SERVER_RESPONSE_CACHE.size > 150) {
                      const oldestKey = SERVER_RESPONSE_CACHE.keys().next().value;
                      if (oldestKey) SERVER_RESPONSE_CACHE.delete(oldestKey);
                    }
                    SERVER_RESPONSE_CACHE.set(cacheKey, {
                      text,
                      modelUsed: candidateModel,
                      sources,
                      cachedAt: Date.now(),
                    });

                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(
                      JSON.stringify({
                        text,
                        modelUsed: candidateModel,
                        queryScope: isExternal ? 'external' : 'internal',
                        apiConnected: true,
                        verifiedWebSearch: sources.length > 0,
                        keyState: 'connected',
                        sources,
                        usage: { totalTokens },
                        quota,
                      })
                    );
                    return;
                  }
                } catch (err) {
                  const errMsg = err instanceof Error ? err.message : String(err);
                  console.warn(`[gemini/chat] key#${keyIdx} model=${candidateModel} failed: ${errMsg.slice(0, 140)}`);
                }
              }
            }
            if (isExternal) {
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(
                JSON.stringify({
                  text: `### Chưa thể xác thực thông tin qua Google Search lúc này\n\nHệ thống chưa nhận được nguồn đối chiếu trực tiếp từ Google Search cho câu hỏi: **"${message}"**. Vui lòng bấm **"Kiểm chứng"** bên dưới hoặc thử lại sau vài giây.`,
                  modelUsed: fallbackModels[0],
                  queryScope: 'external',
                  apiConnected: false,
                  verifiedWebSearch: false,
                  keyState: 'quota_depleted',
                  sources: [],
                  usage: { totalTokens: 0 },
                  quota,
                })
              );
              return;
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(
            JSON.stringify({
              text: '',
              fallbackRequired: true,
              apiConnected: false,
              keyState: candidateKeys.length > 0 ? 'quota_depleted' : 'not_configured',
            })
          );
          return;
        } catch {
          // Fall through to structured fallback response
        }
        const fallbackKeys = getCandidateApiKeys();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            text: '',
            fallbackRequired: true,
            apiConnected: false,
            keyState: fallbackKeys.length > 0 ? 'quota_depleted' : 'not_configured',
          })
        );
      });
      return;
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }

  // Normalize and prevent directory traversal
  const safeRelative = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
  let targetPath = path.join(STATIC_ROOT, safeRelative === '/' ? 'index.html' : safeRelative);

  if (!targetPath.startsWith(STATIC_ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(targetPath, (statErr, stats) => {
    if (!statErr && stats.isFile()) {
      sendFile(req, res, targetPath);
      return;
    }

    if (!statErr && stats.isDirectory()) {
      const dirIndex = path.join(targetPath, 'index.html');
      if (fs.existsSync(dirIndex)) {
        sendFile(req, res, dirIndex);
        return;
      }
    }

    // Do not serve HTML fallback for missing static asset files
    if (pathname.startsWith('/assets/') || path.extname(pathname)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    // SPA fallback for client routes
    const fallbackIndex = path.join(STATIC_ROOT, 'index.html');
    if (fs.existsSync(fallbackIndex)) {
      sendFile(req, res, fallbackIndex);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('index.html not found');
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`VTNN Tam An server listening on http://${HOST}:${PORT} (root: ${STATIC_ROOT})`);
});

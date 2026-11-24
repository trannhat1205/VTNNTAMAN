import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';

const BASE_DIR = import.meta.dirname;
const DIST_SUBDIR = path.join(BASE_DIR, 'dist');
const STATIC_ROOT = fs.existsSync(path.join(BASE_DIR, 'index.html'))
  ? BASE_DIR
  : fs.existsSync(path.join(DIST_SUBDIR, 'index.html'))
  ? DIST_SUBDIR
  : BASE_DIR;

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

const DAILY_AI_QUESTION_LIMIT = 30;
const DAILY_AI_TOKEN_LIMIT = 90000;
const ACCOUNT_QUOTAS = new Map();

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

function resolveApiKey() {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.VITE_GEMINI_API_KEY ||
    process.env.API_KEY ||
    ''
  ).trim();
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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

const COMPRESSIBLE_EXTS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt']);

function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
}

function sendFile(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const isHtml = ext === '.html';
  const isImmutableAsset = filePath.includes(`${path.sep}assets${path.sep}`) && !isHtml;

  applySecurityHeaders(res);
  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Cache-Control',
    isHtml
      ? 'no-cache, no-store, must-revalidate'
      : isImmutableAsset
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=86400'
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
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (pathname === '/api/gemini/status' && req.method === 'GET') {
      const apiKey = resolveApiKey();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          configured: Boolean(apiKey),
          keyState: apiKey ? 'connected' : 'not_configured',
        })
      );
      return;
    }
    if (pathname === '/api/gemini/chat' && req.method === 'POST') {
      let rawBody = '';
      req.on('data', (chunk) => {
        rawBody += chunk;
      });
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(rawBody || '{}');
          const message = String(parsed.message || '').normalize('NFC').trim();
          const accountId = String(parsed.accountId || 'guest').trim() || 'guest';
          const quota = getOrResetQuota(accountId);
          if (quota.questionsUsed >= quota.questionLimit || quota.tokensUsed >= quota.tokenLimit) {
            res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(
              JSON.stringify({
                error: `Tài khoản đã sử dụng hết hạn mức ${quota.questionLimit}/${quota.questionLimit} câu hỏi Trợ lý A.I trong ngày ${quota.date}. Hạn mức sẽ tự động làm mới vào 00:00 ngày mai (giờ Việt Nam).`,
                quotaExceeded: true,
                quota,
              })
            );
            return;
          }

          const apiKey = resolveApiKey();
          if (apiKey && message) {
            const requested = String(parsed.model || 'auto');
            const isExternal =
              parsed.queryScope === 'external' ||
              (parsed.queryScope !== 'internal' && isExternalQuerySimple(message));
            const fallbackModels =
              requested === 'auto'
                ? isExternal
                  ? ['gemini-4-hydrogen', 'gemini-3.1-flash-lite']
                  : ['gemma-4-26b-a4b-it', 'gemini-3.1-flash-lite', 'gemini-4-hydrogen']
                : requested === 'gemma-4-26b-a4b-it'
                ? ['gemma-4-26b-a4b-it', 'gemini-3.1-flash-lite', 'gemini-4-hydrogen']
                : requested === 'gemini-3.1-flash-lite'
                ? ['gemini-3.1-flash-lite', 'gemma-4-26b-a4b-it', 'gemini-4-hydrogen']
                : ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];

            const historyContents = Array.isArray(parsed.history)
              ? parsed.history
                  .filter((h) => h && (h.role === 'user' || h.role === 'model') && typeof h.text === 'string' && h.text.trim())
                  .slice(-8)
                  .map((h) => ({ role: h.role, parts: [{ text: h.text.normalize('NFC') }] }))
              : [];

            for (const candidateModel of fallbackModels) {
              const useSearch = isExternal && candidateModel !== 'gemma-4-26b-a4b-it';
              const body = {
                ...(parsed.systemInstruction
                  ? { systemInstruction: { parts: [{ text: String(parsed.systemInstruction) }] } }
                  : {}),
                contents: [...historyContents, { role: 'user', parts: [{ text: message }] }],
                generationConfig: {
                  maxOutputTokens: candidateModel === 'gemini-4-hydrogen' ? 2048 : 1200,
                  thinkingConfig: {
                    thinkingLevel: candidateModel === 'gemini-4-hydrogen' ? 'LOW' : 'MINIMAL',
                  },
                },
                ...(useSearch ? { tools: [{ google_search: {} }] } : {}),
              };
              const apiRes = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${candidateModel}:generateContent?key=${encodeURIComponent(apiKey)}`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(body),
                }
              );
              if (!apiRes.ok) continue;
              const json = await apiRes.json();
              const parts = json?.candidates?.[0]?.content?.parts || [];
              const text = parts
                .filter((p) => p && p.thought !== true && typeof p.text === 'string')
                .map((p) => p.text)
                .join('')
                .trim();
              if (text) {
                const chunks = json?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
                const sources = chunks
                  .map((c) => c?.web)
                  .filter((w) => w && w.uri)
                  .slice(0, 6)
                  .map((w) => ({ title: w.title || w.uri, uri: w.uri, sourceName: w.title }));
                const totalTokens = Number(json?.usageMetadata?.totalTokenCount) || Math.ceil((message.length + text.length) / 3);
                quota.questionsUsed += 1;
                quota.tokensUsed += totalTokens;
                if (candidateModel === 'gemini-4-hydrogen') quota.deepModelQuestions += 1;
                else quota.freeModelQuestions += 1;
                quota.updatedAt = new Date().toISOString();

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(
                  JSON.stringify({
                    text,
                    modelUsed: candidateModel,
                    queryScope: isExternal ? 'external' : 'internal',
                    apiConnected: true,
                    keyState: 'connected',
                    sources,
                    usage: { totalTokens },
                    quota,
                  })
                );
                return;
              }
            }
          }
        } catch {
          // Fall through to client fallback JSON response
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            text: '',
            fallbackRequired: true,
            apiConnected: false,
            keyState: 'not_configured',
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

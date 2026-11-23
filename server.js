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

const server = http.createServer((req, res) => {
  if (!req.url) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
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

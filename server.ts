import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  AGRICULTURAL_MARKET_BENCHMARK_CONTEXT,
  isPureInternalWarehouseQuery,
} from './src/utils/geminiReportAssistant';

const PORT = 3000;
const HOST = '0.0.0.0';
const BASE_DIR = import.meta.dirname;

dotenv.config({ path: path.join(BASE_DIR, '.env.local') });
dotenv.config({ path: path.join(BASE_DIR, '.env') });

const ALLOWED_MODELS = new Set([
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
  'gemini-4-neon',
  'gemini-4-carbon',
]);

interface ChatHistoryTurn {
  role: 'user' | 'model';
  text: string;
}

export interface GroundingSourceLink {
  title: string;
  uri: string;
  publishedAt?: string;
  sourceName?: string;
  snippet?: string;
}

export type GeminiKeyStatusState = 'connected' | 'quota_depleted' | 'not_configured';

function getCandidateApiKeys(): string[] {
  const keys: string[] = [];
  try {
    const envLocalPath = path.join(BASE_DIR, '.env.local');
    if (fs.existsSync(envLocalPath)) {
      const parsed = dotenv.parse(fs.readFileSync(envLocalPath, 'utf8'));
      if (parsed.GEMINI_API_KEY && parsed.GEMINI_API_KEY.trim()) {
        keys.push(parsed.GEMINI_API_KEY.trim());
      }
    }
  } catch {
    // ignore read errors
  }

  for (const envVal of [process.env.GEMINI_API_KEY, process.env.API_KEY]) {
    if (envVal && envVal.trim() && !keys.includes(envVal.trim())) {
      keys.push(envVal.trim());
    }
  }
  return keys;
}

function maskApiKey(key?: string): string {
  if (!key || key.trim().length < 12) return 'Chưa cấu hình';
  const trimmed = key.trim();
  return `${trimmed.slice(0, 10)}...${trimmed.slice(-6)}`;
}

async function fetchLiveGoogleNewsVietnam(
  query: string
): Promise<GroundingSourceLink[]> {
  try {
    const cleanQuery = query.normalize('NFC').trim().slice(0, 120);
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
      cleanQuery
    )}&hl=vi&gl=VN&ceid=VN:vi`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) return [];
    const xml = await response.text();

    const itemRegex =
      /<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<link>(.*?)<\/link>[\s\S]*?<pubDate>(.*?)<\/pubDate>(?:[\s\S]*?<source[^>]*>(.*?)<\/source>)?[\s\S]*?<\/item>/g;

    const results: GroundingSourceLink[] = [];
    let match: RegExpExecArray | null;
    while ((match = itemRegex.exec(xml)) !== null && results.length < 5) {
      const rawTitle = match[1]
        .replace(/<!\[CDATA\[|\]\]>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
      const link = match[2].trim();
      const pubDate = match[3].trim();
      const sourceName = (match[4] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();

      if (rawTitle && link) {
        results.push({
          title: rawTitle,
          uri: link,
          publishedAt: pubDate,
          sourceName,
        });
      }
    }
    return results;
  } catch {
    return [];
  }
}

async function fetchVietnameseWikipediaSearch(
  query: string
): Promise<GroundingSourceLink[]> {
  try {
    const cleanQuery = query.normalize('NFC').trim().slice(0, 100);
    const url = `https://vi.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      cleanQuery
    )}&utf8=&format=json`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'VTNN-TamAn-Assistant/1.0' },
    });
    clearTimeout(timer);

    if (!response.ok) return [];
    const data = (await response.json()) as {
      query?: {
        search?: Array<{ title: string; snippet: string; pageid: number }>;
      };
    };

    const list = data.query?.search || [];
    return list.slice(0, 3).map((item) => ({
      title: `${item.title} — Wikipedia Tiếng Việt`,
      uri: `https://vi.wikipedia.org/wiki/${encodeURIComponent(
        item.title.replace(/\s+/g, '_')
      )}`,
      sourceName: 'Wikipedia',
      snippet: item.snippet
        .replace(/<[^>]+>/g, '')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .trim(),
    }));
  } catch {
    return [];
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Enable CORS on /api/gemini/* so deployed frontends (e.g. https://vtnntaman.com on Hostinger)
  // can securely reach the live Gemini backend endpoint.
  app.use('/api/gemini', (req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/api/gemini/status', async (_req: express.Request, res: express.Response) => {
    const candidateKeys = getCandidateApiKeys();
    if (candidateKeys.length === 0) {
      res.json({
        configured: false,
        keyState: 'not_configured' as GeminiKeyStatusState,
        maskedKey: 'Chưa cấu hình',
      });
      return;
    }

    for (const candidateKey of candidateKeys) {
      try {
        const ai = new GoogleGenAI({
          apiKey: candidateKey,
          httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
        });
        await withTimeout(
          ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: 'ping',
          }),
          6000
        );
        res.json({
          configured: true,
          keyState: 'connected' as GeminiKeyStatusState,
          maskedKey: maskApiKey(candidateKey),
        });
        return;
      } catch {
        // try next key
      }
    }

    res.json({
      configured: true,
      keyState: 'quota_depleted' as GeminiKeyStatusState,
      maskedKey: maskApiKey(candidateKeys[0]),
    });
  });

  app.post('/api/gemini/chat', async (req: express.Request, res: express.Response) => {
    try {
      const { message, history, model, systemInstruction } = req.body as {
        message?: string;
        history?: ChatHistoryTurn[];
        model?: string;
        systemInstruction?: string;
      };

      const normalizedMessage = typeof message === 'string' ? message.normalize('NFC').trim() : '';
      if (!normalizedMessage) {
        res.status(400).json({ error: 'Vui lòng nhập nội dung câu hỏi.' });
        return;
      }

      const candidateKeys = getCandidateApiKeys();
      if (candidateKeys.length === 0) {
        const [newsSources, wikiSources] = await Promise.all([
          fetchLiveGoogleNewsVietnam(normalizedMessage),
          fetchVietnameseWikipediaSearch(normalizedMessage),
        ]);
        res.status(200).json({
          text: '',
          fallbackRequired: true,
          apiConnected: false,
          keyState: 'not_configured' as GeminiKeyStatusState,
          sources: [...newsSources, ...wikiSources].slice(0, 6),
        });
        return;
      }

      const requestedModel =
        model && ALLOWED_MODELS.has(model) ? model : 'gemini-4-hydrogen';

      const formattedHistory = Array.isArray(history)
        ? history
            .filter(
              (item) =>
                item &&
                (item.role === 'user' || item.role === 'model') &&
                typeof item.text === 'string' &&
                item.text.trim().length > 0
            )
            .slice(-16)
            .map((item) => ({
              role: item.role,
              parts: [{ text: item.text.normalize('NFC') }],
            }))
        : [];

      const candidateModels = Array.from(
        new Set([requestedModel, 'gemini-4-hydrogen', 'gemini-3.1-flash-lite'])
      );

      const isInternalOnly = isPureInternalWarehouseQuery(normalizedMessage);

      // Fetch live Google News Vietnam & Vietnamese Wikipedia in parallel (~1s) for external queries
      const [newsSources, wikiSources] = isInternalOnly
        ? [[], []]
        : await Promise.all([
            fetchLiveGoogleNewsVietnam(normalizedMessage),
            fetchVietnameseWikipediaSearch(normalizedMessage),
          ]);
      const preFetchedSources = [...newsSources, ...wikiSources].slice(0, 5);

      const liveContextBlock =
        preFetchedSources.length > 0
          ? `\n\n=== TIN TỨC & DỮ LIỆU TRA CỨU TRỰC TUYẾN MỚI NHẤT CHO "${normalizedMessage}" ===\n` +
            preFetchedSources
              .map(
                (s, i) =>
                  `${i + 1}. ${s.title}${s.sourceName ? ` (${s.sourceName})` : ''}${
                    s.snippet ? ` — ${s.snippet}` : ''
                  }`
              )
              .join('\n')
          : '';

      const baseSys =
        systemInstruction && systemInstruction.trim()
          ? systemInstruction.trim()
          : `Bạn là Trợ lý A.I — VTNN Tâm An, chuyên gia phân tích thị trường vật tư nông nghiệp, giá phân bón, giá lúa gạo, kỹ thuật cây trồng và quản lý kho.`;

      const effectiveSystemInstruction = [
        baseSys,
        baseSys.includes('DỮ LIỆU THAM CHIẾU THỊ TRƯỜNG NÔNG NGHIỆP')
          ? ''
          : AGRICULTURAL_MARKET_BENCHMARK_CONTEXT,
        liveContextBlock,
      ]
        .filter(Boolean)
        .join('\n\n');

      for (const apiKey of candidateKeys) {
        const ai = new GoogleGenAI({
          apiKey,
          httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
        });

        for (const candidateModel of candidateModels) {
          try {
            const thinkingLevel =
              candidateModel === 'gemini-4-neon' || candidateModel === 'gemini-4-carbon'
                ? ThinkingLevel.MEDIUM
                : ThinkingLevel.LOW;

            const chat = ai.chats.create({
              model: candidateModel,
              history: formattedHistory,
              config: {
                systemInstruction: effectiveSystemInstruction,
                thinkingConfig: { thinkingLevel },
              },
            });

            const response = await withTimeout(
              chat.sendMessage({
                message: normalizedMessage,
              }),
              14000
            );

            const responseText = response.text?.trim();
            if (responseText) {
              res.json({
                text: responseText,
                modelUsed: candidateModel,
                apiConnected: true,
                keyState: 'connected' as GeminiKeyStatusState,
                maskedKey: maskApiKey(apiKey),
                sources: preFetchedSources,
              });
              return;
            }
          } catch {
            // try next model or candidate key
          }
        }
      }

      res.status(200).json({
        text: '',
        fallbackRequired: true,
        apiConnected: false,
        keyState: 'quota_depleted' as GeminiKeyStatusState,
        sources: preFetchedSources,
      });
    } catch {
      res.status(200).json({
        text: '',
        fallbackRequired: true,
        apiConnected: false,
        keyState: 'quota_depleted' as GeminiKeyStatusState,
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = fs.existsSync(path.join(BASE_DIR, 'dist', 'index.html'))
      ? path.join(BASE_DIR, 'dist')
      : BASE_DIR;

    app.use(express.static(distPath));
    app.get('*all', (_req: express.Request, res: express.Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`VTNN Tam An server listening on http://${HOST}:${PORT}`);
  });
}

startServer();

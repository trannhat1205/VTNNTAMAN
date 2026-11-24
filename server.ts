import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { GoogleGenAI } from '@google/genai';

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
    const cleanQuery = query.trim().slice(0, 120);
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
    const cleanQuery = query.trim().slice(0, 100);
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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

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
        await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: 'ping',
        });
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

      if (!message || typeof message !== 'string' || !message.trim()) {
        res.status(400).json({ error: 'Vui lòng nhập nội dung câu hỏi.' });
        return;
      }

      const candidateKeys = getCandidateApiKeys();
      if (candidateKeys.length === 0) {
        const [newsSources, wikiSources] = await Promise.all([
          fetchLiveGoogleNewsVietnam(message),
          fetchVietnameseWikipediaSearch(message),
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
            .slice(-20)
            .map((item) => ({
              role: item.role,
              parts: [{ text: item.text }],
            }))
        : [];

      const candidateModels = Array.from(
        new Set([requestedModel, 'gemini-4-hydrogen', 'gemini-3.1-flash-lite'])
      );

      for (const apiKey of candidateKeys) {
        const ai = new GoogleGenAI({
          apiKey,
          httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
        });

        for (const candidateModel of candidateModels) {
          for (const useSearchGrounding of [true, false]) {
            try {
              const chat = ai.chats.create({
                model: candidateModel,
                history: formattedHistory,
                config: {
                  ...(systemInstruction ? { systemInstruction } : {}),
                  ...(useSearchGrounding ? { tools: [{ googleSearch: {} }] } : {}),
                },
              });

              const response = await chat.sendMessage({
                message: message.trim(),
              });

              const responseText = response.text?.trim();
              if (responseText) {
                const sources: GroundingSourceLink[] = [];
                const chunks =
                  response.candidates?.[0]?.groundingMetadata?.groundingChunks;
                if (Array.isArray(chunks)) {
                  for (const chunk of chunks) {
                    const uri = chunk?.web?.uri;
                    const title = chunk?.web?.title;
                    if (uri && typeof uri === 'string') {
                      if (!sources.some((s) => s.uri === uri)) {
                        sources.push({
                          title:
                            typeof title === 'string' && title.trim()
                              ? title.trim()
                              : uri,
                          uri,
                        });
                      }
                    }
                  }
                }

                res.json({
                  text: responseText,
                  modelUsed: candidateModel,
                  apiConnected: true,
                  keyState: 'connected' as GeminiKeyStatusState,
                  maskedKey: maskApiKey(apiKey),
                  sources: sources.slice(0, 5),
                });
                return;
              }
            } catch {
              // try next model or candidate key
            }
          }
        }
      }

      const [newsSources, wikiSources] = await Promise.all([
        fetchLiveGoogleNewsVietnam(message),
        fetchVietnameseWikipediaSearch(message),
      ]);

      res.status(200).json({
        text: '',
        fallbackRequired: true,
        apiConnected: false,
        keyState: 'quota_depleted' as GeminiKeyStatusState,
        sources: [...newsSources, ...wikiSources].slice(0, 6),
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

import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  AccountDailyAiQuota,
  AGRICULTURAL_MARKET_BENCHMARK_CONTEXT,
  checkAccountDailyAiQuota,
  classifyQueryRoutingAndCostConfig,
  DEFAULT_GEMINI_MODEL,
  estimateVietnameseTokens,
  extractGroundingSourcesFromMetadata,
  extractVisibleTextFromGeminiParts,
  GEMINI_QUERY_CACHE_TTL_MS,
  GeminiConcreteModelId,
  GeminiModelOptionId,
  normalizeAccountDailyAiQuotaForToday,
  recordAccountDailyAiUsage,
  shouldEnableExternalWebSearch,
} from './src/utils/geminiReportAssistant';

const PORT = 3000;
const HOST = '0.0.0.0';
const BASE_DIR = import.meta.dirname;

dotenv.config({ path: path.join(BASE_DIR, '.env.local') });
dotenv.config({ path: path.join(BASE_DIR, '.env') });

const ALLOWED_MODELS = new Set<GeminiModelOptionId>([
  'auto',
  'gemma-4-26b-a4b-it',
  'gemini-3.1-flash-lite',
  'gemini-4-hydrogen',
]);

// Rule 3: 6-hour in-memory caches for external web search results and popular chat responses
const SERVER_SEARCH_CACHE = new Map<
  string,
  { sources: GroundingSourceLink[]; cachedAt: number }
>();

const SERVER_RESPONSE_CACHE = new Map<
  string,
  {
    text: string;
    modelUsed: GeminiConcreteModelId;
    queryScope: 'internal' | 'external';
    routingReason: string;
    sources: GroundingSourceLink[];
    cachedAt: number;
  }
>();

const SERVER_ACCOUNT_QUOTAS = new Map<string, AccountDailyAiQuota>();

function getOrResetServerAccountQuota(accountId: string): AccountDailyAiQuota {
  const safeId = (accountId || 'guest').trim() || 'guest';
  const normalized = normalizeAccountDailyAiQuotaForToday(
    SERVER_ACCOUNT_QUOTAS.get(safeId),
    safeId
  );
  SERVER_ACCOUNT_QUOTAS.set(safeId, normalized);
  return normalized;
}

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
  const pushKey = (val?: string) => {
    const trimmed = typeof val === 'string' ? val.trim() : '';
    if (trimmed && !keys.includes(trimmed)) {
      keys.push(trimmed);
    }
  };

  try {
    const envLocalPath = path.join(BASE_DIR, '.env.local');
    if (fs.existsSync(envLocalPath)) {
      const parsed = dotenv.parse(fs.readFileSync(envLocalPath, 'utf8'));
      pushKey(parsed.GEMINI_API_KEY);
      pushKey(parsed.VITE_GEMINI_API_KEY);
    }
  } catch {
    // ignore read errors
  }

  pushKey(process.env.GEMINI_API_KEY);
  pushKey(process.env.VITE_GEMINI_API_KEY);
  pushKey(process.env.API_KEY);
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

async function getCachedExternalSources(query: string): Promise<GroundingSourceLink[]> {
  if (!shouldEnableExternalWebSearch(query)) {
    return [];
  }
  const normalizedKey = query.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  const cached = SERVER_SEARCH_CACHE.get(normalizedKey);
  if (cached && Date.now() - cached.cachedAt < GEMINI_QUERY_CACHE_TTL_MS) {
    return cached.sources;
  }
  const [newsSources, wikiSources] = await Promise.all([
    fetchLiveGoogleNewsVietnam(query),
    fetchVietnameseWikipediaSearch(query),
  ]);
  const combined = [...newsSources, ...wikiSources].slice(0, 5);
  if (SERVER_SEARCH_CACHE.size > 100) {
    const oldestKey = SERVER_SEARCH_CACHE.keys().next().value;
    if (oldestKey) SERVER_SEARCH_CACHE.delete(oldestKey);
  }
  SERVER_SEARCH_CACHE.set(normalizedKey, { sources: combined, cachedAt: Date.now() });
  return combined;
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
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
              maxOutputTokens: 16,
            },
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
      const {
        message,
        history,
        model,
        systemInstruction,
        internalSystemInstruction,
        externalSystemInstruction,
        accountId,
      } = req.body as {
        message?: string;
        history?: ChatHistoryTurn[];
        model?: string;
        systemInstruction?: string;
        internalSystemInstruction?: string;
        externalSystemInstruction?: string;
        accountId?: string;
      };

      const normalizedMessage = typeof message === 'string' ? message.normalize('NFC').trim() : '';
      if (!normalizedMessage) {
        res.status(400).json({ error: 'Vui lòng nhập nội dung câu hỏi.' });
        return;
      }

      const effectiveAccountId =
        typeof accountId === 'string' && accountId.trim() ? accountId.trim() : 'guest';
      const currentQuota = getOrResetServerAccountQuota(effectiveAccountId);
      const quotaCheck = checkAccountDailyAiQuota(currentQuota);
      if (!quotaCheck.allowed) {
        res.status(429).json({
          error: quotaCheck.message,
          quotaExceeded: true,
          reason: quotaCheck.reason,
          quota: quotaCheck.normalizedQuota,
        });
        return;
      }

      // Rule 1 & Rule 2: Auto-routing (Free-first internal vs Deep external reasoning)
      const validRequestedModel: GeminiModelOptionId =
        model && ALLOWED_MODELS.has(model as GeminiModelOptionId)
          ? (model as GeminiModelOptionId)
          : DEFAULT_GEMINI_MODEL;

      const routing = classifyQueryRoutingAndCostConfig(
        normalizedMessage,
        validRequestedModel
      );

      const baseSys =
        routing.queryScope === 'internal' && internalSystemInstruction?.trim()
          ? internalSystemInstruction.trim()
          : routing.queryScope === 'external' && externalSystemInstruction?.trim()
          ? externalSystemInstruction.trim()
          : systemInstruction && systemInstruction.trim()
          ? systemInstruction.trim()
          : `Bạn là Trợ lý A.I — VTNN Tâm An, chuyên gia phân tích thị trường vật tư nông nghiệp, giá phân bón, giá lúa gạo, kỹ thuật cây trồng và quản lý kho.`;

      const sysHash = `${routing.queryScope}:${baseSys.slice(0, 160)}:${baseSys.length}`;
      const serverCacheKey = `${routing.targetModel}::${sysHash}::${normalizedMessage.toLowerCase()}`;
      const cachedResponse = SERVER_RESPONSE_CACHE.get(serverCacheKey);
      const candidateKeys = getCandidateApiKeys();

      if (
        cachedResponse &&
        Date.now() - cachedResponse.cachedAt < GEMINI_QUERY_CACHE_TTL_MS
      ) {
        const updatedQuota = recordAccountDailyAiUsage(quotaCheck.normalizedQuota, {
          tokensUsed: 0,
          modelUsed: cachedResponse.modelUsed,
          cached: true,
        });
        SERVER_ACCOUNT_QUOTAS.set(effectiveAccountId, updatedQuota);

        res.json({
          text: cachedResponse.text,
          modelUsed: cachedResponse.modelUsed,
          queryScope: cachedResponse.queryScope,
          routingReason: cachedResponse.routingReason,
          apiConnected: true,
          cached: true,
          keyState: 'connected' as GeminiKeyStatusState,
          maskedKey: maskApiKey(candidateKeys[0]),
          sources: cachedResponse.sources,
          usage: { totalTokens: 0 },
          quota: updatedQuota,
        });
        return;
      }

      if (candidateKeys.length === 0) {
        res.status(200).json({
          text: '',
          fallbackRequired: true,
          apiConnected: false,
          keyState: 'not_configured' as GeminiKeyStatusState,
          sources: [],
        });
        return;
      }

      const formattedHistory = Array.isArray(history)
        ? history
            .filter(
              (item) =>
                item &&
                (item.role === 'user' || item.role === 'model') &&
                typeof item.text === 'string' &&
                item.text.trim().length > 0
            )
            .slice(-8)
            .map((item) => ({
              role: item.role,
              parts: [{ text: item.text.normalize('NFC') }],
            }))
        : [];

      const effectiveSystemInstruction = [
        baseSys,
        routing.queryScope === 'internal' ||
        baseSys.includes('DỮ LIỆU THAM CHIẾU THỊ TRƯỜNG NÔNG NGHIỆP')
          ? ''
          : AGRICULTURAL_MARKET_BENCHMARK_CONTEXT,
      ]
        .filter(Boolean)
        .join('\n\n');

      for (const apiKey of candidateKeys) {
        const ai = new GoogleGenAI({
          apiKey,
          httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
        });

        for (const candidateModel of routing.fallbackModels) {
          const allowNativeSearch =
            routing.enableExternalSearch && candidateModel !== 'gemma-4-26b-a4b-it';
          const searchAttempts = allowNativeSearch ? [true, false] : [false];

          for (const useGoogleSearch of searchAttempts) {
            try {
              const thinkingLevel =
                candidateModel === 'gemini-4-hydrogen'
                  ? routing.thinkingLevel === 'MEDIUM'
                    ? ThinkingLevel.MEDIUM
                    : ThinkingLevel.LOW
                  : ThinkingLevel.MINIMAL;

              const maxOutputTokens =
                candidateModel === 'gemini-4-hydrogen'
                  ? Math.max(2048, routing.maxOutputTokens)
                  : Math.max(1200, routing.maxOutputTokens);

              const response = await withTimeout(
                ai.models.generateContent({
                  model: candidateModel,
                  contents: [
                    ...formattedHistory,
                    {
                      role: 'user',
                      parts: [{ text: normalizedMessage }],
                    },
                  ],
                  config: {
                    systemInstruction: effectiveSystemInstruction,
                    thinkingConfig: { thinkingLevel },
                    maxOutputTokens,
                    ...(useGoogleSearch ? { tools: [{ googleSearch: {} }] } : {}),
                  },
                }),
                useGoogleSearch ? 22000 : 15000
              );

              const visiblePartsText = extractVisibleTextFromGeminiParts(
                response.candidates?.[0]?.content?.parts as
                  | Array<{ text?: string; thought?: boolean }>
                  | undefined
              );
              const responseText = visiblePartsText || response.text?.trim() || '';

              if (
                responseText &&
                !responseText.startsWith('google:search{') &&
                !responseText.startsWith('call:google:search')
              ) {
                const groundingSources = extractGroundingSourcesFromMetadata(
                  response.candidates?.[0]?.groundingMetadata
                );
                const combinedSources: GroundingSourceLink[] =
                  groundingSources.length > 0
                    ? groundingSources
                    : routing.enableExternalSearch && !useGoogleSearch
                    ? await getCachedExternalSources(normalizedMessage)
                    : [];

                const totalTokens =
                  Number(response.usageMetadata?.totalTokenCount) ||
                  estimateVietnameseTokens(normalizedMessage + responseText);

                const updatedQuota = recordAccountDailyAiUsage(
                  quotaCheck.normalizedQuota,
                  {
                    tokensUsed: totalTokens,
                    modelUsed: candidateModel,
                    cached: false,
                  }
                );
                SERVER_ACCOUNT_QUOTAS.set(effectiveAccountId, updatedQuota);

                if (SERVER_RESPONSE_CACHE.size > 150) {
                  const oldestKey = SERVER_RESPONSE_CACHE.keys().next().value;
                  if (oldestKey) SERVER_RESPONSE_CACHE.delete(oldestKey);
                }
                SERVER_RESPONSE_CACHE.set(serverCacheKey, {
                  text: responseText,
                  modelUsed: candidateModel,
                  queryScope: routing.queryScope,
                  routingReason: routing.routingReason,
                  sources: combinedSources,
                  cachedAt: Date.now(),
                });

                res.json({
                  text: responseText,
                  modelUsed: candidateModel,
                  queryScope: routing.queryScope,
                  routingReason: routing.routingReason,
                  apiConnected: true,
                  keyState: 'connected' as GeminiKeyStatusState,
                  maskedKey: maskApiKey(apiKey),
                  sources: combinedSources,
                  usage: { totalTokens },
                  quota: updatedQuota,
                });
                return;
              }
            } catch {
              // try without search or next model/key
            }
          }
        }
      }

      const fallbackSources = routing.enableExternalSearch
        ? await getCachedExternalSources(normalizedMessage)
        : [];

      res.status(200).json({
        text: '',
        fallbackRequired: true,
        apiConnected: false,
        keyState: 'quota_depleted' as GeminiKeyStatusState,
        sources: fallbackSources,
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

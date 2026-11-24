import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Check,
  ChevronDown,
  Copy,
  Database,
  ExternalLink,
  History,
  MessageSquarePlus,
  Send,
  Sparkles,
  Tag,
  Trash2,
  Globe,
  RotateCcw,
  X,
} from 'lucide-react';
import {
  CashPaymentVoucher,
  CashReceiptVoucher,
  CustomerProfile,
  ImportTransaction,
  ProductItem,
  SaleTransaction,
  StaffMember,
  SupplierProfile,
} from '../types';
import {
  AccountDailyAiQuota,
  buildGeminiQueryCacheKey,
  buildGeminiSystemInstruction,
  buildGoogleAiModeUrl,
  buildSharedAiCacheFileName,
  buildUnverifiedExternalLookupNotice,
  buildWarehouseReportSnapshot,
  checkAccountDailyAiQuota,
  classifyQueryRoutingAndCostConfig,
  CommunityMarketPriceBoard,
  CommunityMarketPriceEntry,
  DEFAULT_GEMINI_MODEL,
  estimateVietnameseTokens,
  extractGroundingSourcesFromMetadata,
  extractVisibleTextFromGeminiParts,
  formatCommunityMarketPriceAnswer,
  GEMINI_MODEL_OPTIONS,
  GEMINI_QUERY_CACHE_TTL_MS,
  GeminiConcreteModelId,
  GeminiModelOptionId,
  generateSmartReportAnswer,
  getGeminiModelOptionMeta,
  matchCommunityMarketPricesForQuery,
  normalizeAccountDailyAiQuotaForToday,
  normalizeMarketItemKey,
  parseCommunityMarketPriceContribution,
  recordAccountDailyAiUsage,
  SHARED_VOLATILE_CACHE_TTL_MS,
  shouldEnableExternalWebSearch,
} from '../utils/geminiReportAssistant';
import {
  contributeCommunityMarketPriceToFirebaseStorage,
  readCommunityMarketPricesFromFirebaseStorage,
  readSharedAiCacheFromFirebaseStorage,
  writeSharedAiCacheToFirebaseStorage,
} from '../services/firebaseService';
import { formatVND } from '../utils/businessLogic';

export interface GeminiGroundingSource {
  title: string;
  uri: string;
  publishedAt?: string;
  sourceName?: string;
  snippet?: string;
}

export type GeminiMessageCacheOrigin =
  | 'shared_evergreen'
  | 'shared_7d'
  | 'community_price'
  | 'local_cache'
  | 'live_ai';

export interface GeminiChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string;
  modelId?: GeminiModelOptionId;
  sources?: GeminiGroundingSource[];
  apiConnected?: boolean;
  usedWebSearch?: boolean;
  tokensUsed?: number;
  sourceQuery?: string;
  queryScope?: 'internal' | 'external';
  cacheOrigin?: GeminiMessageCacheOrigin;
}

export interface GeminiChatSession {
  id: string;
  title: string;
  updatedAt: string;
  messages: GeminiChatMessage[];
}

interface GeminiChatbotViewProps {
  currentStaff: StaffMember | null;
  activeWarehouseLabel: string;
  products: ProductItem[];
  customers: CustomerProfile[];
  suppliers: SupplierProfile[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  receiptVouchers: CashReceiptVoucher[];
  paymentVouchers: CashPaymentVoucher[];
}

const CLIENT_AI_CACHE_STORAGE_KEY = 'vtnn_taman_ai_response_cache_v4';

function loadAccountDailyQuotaFromStorage(
  quotaStorageKey: string,
  accountId: string
): AccountDailyAiQuota {
  try {
    const raw = localStorage.getItem(quotaStorageKey);
    const parsed = raw ? (JSON.parse(raw) as Partial<AccountDailyAiQuota>) : null;
    return normalizeAccountDailyAiQuotaForToday(parsed, accountId);
  } catch {
    return normalizeAccountDailyAiQuotaForToday(null, accountId);
  }
}

async function fetchBrowserWikipediaFallback(query: string): Promise<GeminiGroundingSource[]> {
  try {
    const cleanQuery = query.normalize('NFC').trim().slice(0, 100);
    if (!cleanQuery) return [];
    const url = `https://vi.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      cleanQuery
    )}&utf8=&format=json&origin=*`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      query?: { search?: Array<{ title: string; snippet: string }> };
    };
    const items = data.query?.search || [];
    return items.slice(0, 3).map((item) => ({
      title: `${item.title} — Wikipedia Tiếng Việt`,
      uri: `https://vi.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/\s+/g, '_'))}`,
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

function renderFormattedMessage(text: string) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    // Detect Markdown Table block
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 2) {
      const tableLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim().startsWith('|') &&
        lines[i].trim().endsWith('|')
      ) {
        tableLines.push(lines[i].trim());
        i++;
      }

      const parsedRows = tableLines
        .filter((row) => !/^\|[\s:|-]+\|$/.test(row))
        .map((row) =>
          row
            .slice(1, -1)
            .split('|')
            .map((cell) => cell.trim())
        );

      if (parsedRows.length > 0) {
        const headerRow = parsedRows[0];
        const bodyRows = parsedRows.slice(1);
        elements.push(
          <div
            key={`table_${i}`}
            className="my-2.5 overflow-x-auto rounded-xl border border-slate-200 bg-white"
          >
            <table className="min-w-full text-xs text-left border-collapse">
              <thead className="bg-emerald-50/80 text-emerald-950 border-b border-slate-200">
                <tr>
                  {headerRow.map((cell, cIdx) => (
                    <th key={cIdx} className="px-3 py-2 font-bold whitespace-nowrap">
                      {formatInlineBold(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bodyRows.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-slate-50/80">
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="px-3 py-2 text-slate-700 align-top">
                        {formatInlineBold(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }
    }

    if (!trimmed) {
      elements.push(<div key={i} className="h-1.5" />);
      i++;
      continue;
    }

    if (line.startsWith('### ')) {
      elements.push(
        <h3
          key={i}
          className="text-base font-bold text-slate-900 pt-2 pb-0.5 border-b border-slate-100"
        >
          {formatInlineBold(line.replace(/^###\s+/, ''))}
        </h3>
      );
      i++;
      continue;
    }

    if (line.startsWith('#### ')) {
      elements.push(
        <h4 key={i} className="text-sm font-bold text-emerald-800 pt-1.5">
          {formatInlineBold(line.replace(/^####\s+/, ''))}
        </h4>
      );
      i++;
      continue;
    }

    if (line.startsWith('---')) {
      elements.push(<hr key={i} className="border-slate-200 my-2" />);
      i++;
      continue;
    }

    if (line.startsWith('> ')) {
      elements.push(
        <blockquote
          key={i}
          className="border-l-4 border-emerald-500 bg-emerald-50/70 px-3.5 py-2.5 rounded-r-xl text-slate-700 italic"
        >
          {formatInlineBold(line.replace(/^>\s+/, ''))}
        </blockquote>
      );
      i++;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      elements.push(
        <div key={i} className="flex items-start gap-2 pl-1">
          <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-emerald-600 shrink-0" />
          <div className="flex-1">{formatInlineBold(trimmed.replace(/^[-*]\s+/, ''))}</div>
        </div>
      );
      i++;
      continue;
    }

    const numberedMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (numberedMatch) {
      elements.push(
        <div key={i} className="flex items-start gap-2 pl-1">
          <span className="font-bold text-emerald-700 shrink-0 min-w-[1.25rem]">
            {numberedMatch[1]}.
          </span>
          <div className="flex-1">{formatInlineBold(numberedMatch[2])}</div>
        </div>
      );
      i++;
      continue;
    }

    elements.push(<p key={i}>{formatInlineBold(line)}</p>);
    i++;
  }

  return <div className="space-y-2 text-sm leading-relaxed text-slate-800">{elements}</div>;
}

function formatInlineBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-bold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export const GeminiChatbotView: React.FC<GeminiChatbotViewProps> = ({
  currentStaff,
  activeWarehouseLabel,
  products,
  customers,
  suppliers,
  sales,
  imports,
  receiptVouchers,
  paymentVouchers,
}) => {
  const accountQuotaKey = useMemo(() => {
    return (currentStaff?.uid || currentStaff?.email || 'guest').trim() || 'guest';
  }, [currentStaff?.uid, currentStaff?.email]);

  const storageKey = useMemo(() => {
    const uid = currentStaff?.uid || 'guest';
    return `vtnn_taman_gemini_sessions_v1_${uid}`;
  }, [currentStaff?.uid]);

  const quotaStorageKey = useMemo(() => {
    return `vtnn_taman_ai_daily_quota_v1_${accountQuotaKey}`;
  }, [accountQuotaKey]);

  const [sessions, setSessions] = useState<GeminiChatSession[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as GeminiChatSession[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // ignore storage errors
    }
    const initialId = `chat_${Date.now()}`;
    return [
      {
        id: initialId,
        title: 'Cuộc trò chuyện mới',
        updatedAt: new Date().toISOString(),
        messages: [],
      },
    ];
  });

  const [dailyQuota, setDailyQuota] = useState<AccountDailyAiQuota>(() =>
    loadAccountDailyQuotaFromStorage(quotaStorageKey, accountQuotaKey)
  );
  const [activeSessionId, setActiveSessionId] = useState<string>(() => sessions[0]?.id || '');
  const [selectedModel, setSelectedModel] = useState<GeminiModelOptionId>(DEFAULT_GEMINI_MODEL);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const [inputPrompt, setInputPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [showMarketPriceModal, setShowMarketPriceModal] = useState(false);
  const [marketTopic, setMarketTopic] =
    useState<CommunityMarketPriceEntry['topic']>('rice');
  const [marketItemName, setMarketItemName] = useState('');
  const [marketPriceText, setMarketPriceText] = useState('');
  const [marketRegion, setMarketRegion] = useState('');
  const [isSavingMarketPrice, setIsSavingMarketPrice] = useState(false);

  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const communityBoardCacheRef = useRef<{
    board: CommunityMarketPriceBoard | null;
    fetchedAt: number;
  }>({ board: null, fetchedAt: 0 });

  // Reload sessions & quota when user account switches
  useEffect(() => {
    setDailyQuota(loadAccountDailyQuotaFromStorage(quotaStorageKey, accountQuotaKey));
  }, [quotaStorageKey, accountQuotaKey]);

  // Automatically refresh quota when a new Vietnam day begins (00:00 UTC+7)
  useEffect(() => {
    const interval = setInterval(() => {
      setDailyQuota((prev) =>
        normalizeAccountDailyAiQuotaForToday(prev, accountQuotaKey)
      );
    }, 60000);
    return () => clearInterval(interval);
  }, [accountQuotaKey]);

  // Persist daily quota to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(quotaStorageKey, JSON.stringify(dailyQuota));
    } catch {
      // ignore storage quota errors
    }
  }, [dailyQuota, quotaStorageKey]);

  // Reload sessions when user account switches
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as GeminiChatSession[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSessions(parsed);
          setActiveSessionId(parsed[0].id);
          return;
        }
      }
    } catch {
      // ignore
    }
    const freshId = `chat_${Date.now()}`;
    const freshSession: GeminiChatSession = {
      id: freshId,
      title: 'Cuộc trò chuyện mới',
      updatedAt: new Date().toISOString(),
      messages: [],
    };
    setSessions([freshSession]);
    setActiveSessionId(freshId);
  }, [storageKey]);

  // Persist sessions to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(sessions));
    } catch {
      // ignore storage quota errors
    }
  }, [sessions, storageKey]);

  const reportSnapshot = useMemo(
    () =>
      buildWarehouseReportSnapshot({
        warehouseLabel: activeWarehouseLabel,
        currentStaff,
        products,
        customers,
        suppliers,
        sales,
        imports,
        receiptVouchers,
        paymentVouchers,
      }),
    [
      activeWarehouseLabel,
      currentStaff,
      products,
      customers,
      suppliers,
      sales,
      imports,
      receiptVouchers,
      paymentVouchers,
    ]
  );

  const internalSystemInstruction = useMemo(
    () => buildGeminiSystemInstruction(reportSnapshot, 'internal'),
    [reportSnapshot]
  );

  const externalSystemInstruction = useMemo(
    () => buildGeminiSystemInstruction(reportSnapshot, 'external'),
    [reportSnapshot]
  );

  const quotaCheck = useMemo(
    () => checkAccountDailyAiQuota(dailyQuota),
    [dailyQuota]
  );

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) || sessions[0],
    [sessions, activeSessionId]
  );

  const activeModelMeta = useMemo(
    () =>
      GEMINI_MODEL_OPTIONS.find((m) => m.id === selectedModel) || GEMINI_MODEL_OPTIONS[0],
    [selectedModel]
  );

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.messages.length, isGenerating]);

  const handleCreateNewChat = () => {
    const newId = `chat_${Date.now()}`;
    const newSession: GeminiChatSession = {
      id: newId,
      title: 'Cuộc trò chuyện mới',
      updatedAt: new Date().toISOString(),
      messages: [],
    };
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newId);
    setInputPrompt('');
    setShowHistoryDrawer(false);
  };

  const handleDeleteSession = (sessionId: string) => {
    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== sessionId);
      if (remaining.length === 0) {
        const fallbackId = `chat_${Date.now()}`;
        const fresh: GeminiChatSession = {
          id: fallbackId,
          title: 'Cuộc trò chuyện mới',
          updatedAt: new Date().toISOString(),
          messages: [],
        };
        setActiveSessionId(fallbackId);
        return [fresh];
      }
      if (activeSessionId === sessionId) {
        setActiveSessionId(remaining[0].id);
      }
      return remaining;
    });
  };

  const handleCopyMessage = async (msg: GeminiChatMessage) => {
    try {
      await navigator.clipboard.writeText(msg.text);
      setCopiedMessageId(msg.id);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleSubmitMarketPriceModal = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanItem = marketItemName.normalize('NFC').trim();
    const cleanPrice = marketPriceText.normalize('NFC').trim();
    const cleanRegion = marketRegion.normalize('NFC').trim();
    const normalizedItem = normalizeMarketItemKey(cleanItem);
    if (!cleanItem || !cleanPrice || !normalizedItem || isSavingMarketPrice || !activeSession) {
      return;
    }

    setIsSavingMarketPrice(true);
    const rawNote = `Cập nhật giá ${cleanItem} ${cleanPrice}${
      cleanRegion ? ` tại ${cleanRegion}` : ''
    }`;
    const res = await contributeCommunityMarketPriceToFirebaseStorage({
      topic: marketTopic,
      itemName: cleanItem,
      normalizedItem,
      priceText: cleanPrice,
      region: cleanRegion || undefined,
      rawNote,
      contributorName: currentStaff?.displayName || 'Thành viên VTNN Tâm An',
      contributorUid: accountQuotaKey,
    });
    communityBoardCacheRef.current = {
      board: res.board,
      fetchedAt: Date.now(),
    };

    const userMessage: GeminiChatMessage = {
      id: `msg_u_${Date.now()}`,
      role: 'user',
      text: rawNote,
      timestamp: new Date().toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    };

    const confirmMessage: GeminiChatMessage = {
      id: `msg_m_${Date.now() + 1}`,
      role: 'model',
      text: `### Đã lưu Giá Thị Trường Dùng Chung (Hiệu lực 7 ngày)\n\n- **Mặt hàng:** **${res.savedEntry.itemName}**\n- **Mức giá:** **${res.savedEntry.priceText}**${
        res.savedEntry.region ? `\n- **Khu vực:** **${res.savedEntry.region}**` : ''
      }\n- **Đồng bộ đám mây (Firebase Storage):** ${
        res.syncedToCloud
          ? '**Đã đồng bộ** — tất cả tài khoản khác hỏi lại sẽ nhận giá này ngay với **0 token**.'
          : '**Đã lưu trên máy này** (cần đăng nhập Google Cloud để đồng bộ cho các tài khoản khác).'
      }`,
      timestamp: new Date().toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      modelId: 'gemma-4-26b-a4b-it',
      tokensUsed: 0,
      queryScope: 'external',
      cacheOrigin: 'community_price',
    };

    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession.id
          ? {
              ...s,
              title:
                s.messages.length === 0
                  ? `Cập nhật giá ${cleanItem}`.slice(0, 44)
                  : s.title,
              updatedAt: new Date().toISOString(),
              messages: [...s.messages, userMessage, confirmMessage],
            }
          : s
      )
    );

    setMarketItemName('');
    setMarketPriceText('');
    setMarketRegion('');
    setIsSavingMarketPrice(false);
    setShowMarketPriceModal(false);
  };

  const handleSendMessage = async (customText?: string) => {
    const promptText = (customText ?? inputPrompt).normalize('NFC').trim();
    if (!promptText || isGenerating || !activeSession) return;

    const latestQuotaCheck = checkAccountDailyAiQuota(dailyQuota);

    const userMessage: GeminiChatMessage = {
      id: `msg_u_${Date.now()}`,
      role: 'user',
      text: promptText,
      timestamp: new Date().toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    };

    const previousHistory = activeSession.messages
      .slice(-8)
      .map((m) => ({
        role: m.role,
        text: m.text.normalize('NFC'),
      }));

    const updatedTitle =
      activeSession.messages.length === 0
        ? promptText.length > 44
          ? `${promptText.slice(0, 44)}...`
          : promptText
        : activeSession.title;

    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession.id
          ? {
              ...s,
              title: updatedTitle,
              updatedAt: new Date().toISOString(),
              messages: [...s.messages, userMessage],
            }
          : s
      )
    );

    if (!customText) {
      setInputPrompt('');
    }
    setIsGenerating(true);

    const routing = classifyQueryRoutingAndCostConfig(
      promptText,
      selectedModel,
      reportSnapshot
    );
    const sharedDescriptor = buildSharedAiCacheFileName(promptText);
    const activeSystemInstruction =
      routing.queryScope === 'internal'
        ? internalSystemInstruction
        : externalSystemInstruction;
    const localCacheKey = sharedDescriptor
      ? `shared_${sharedDescriptor.fileName}`
      : buildGeminiQueryCacheKey(promptText, reportSnapshot, routing.targetModel);

    let replyText = '';
    let usedModelId: GeminiConcreteModelId = routing.targetModel;
    let replySources: GeminiGroundingSource[] = [];
    let apiConnectedFlag = false;
    let usedWebSearchFlag = false;
    let tokensUsedCount = 0;
    let isCachedHit = false;
    let isFreeSharedHit = false;
    let cacheOrigin: GeminiMessageCacheOrigin = 'live_ai';
    let quotaBlockedByServer = false;
    let unverifiedExternalBlocked = false;
    let serverReturnedQuota: AccountDailyAiQuota | null = null;

    // Step 0: Check if user is directly contributing a live community market price in chat (0 token)
    const contributedPrice = parseCommunityMarketPriceContribution(promptText);
    if (contributedPrice) {
      const saved = await contributeCommunityMarketPriceToFirebaseStorage({
        ...contributedPrice,
        contributorName: currentStaff?.displayName || 'Thành viên VTNN Tâm An',
        contributorUid: accountQuotaKey,
      });
      communityBoardCacheRef.current = {
        board: saved.board,
        fetchedAt: Date.now(),
      };
      replyText = `### Đã ghi nhận Giá Thị Trường Dùng Chung (7 ngày)\n\n- **Mặt hàng:** **${saved.savedEntry.itemName}**\n- **Mức giá:** **${saved.savedEntry.priceText}**${
        saved.savedEntry.region ? `\n- **Khu vực:** **${saved.savedEntry.region}**` : ''
      }\n- **Trạng thái:** ${
        saved.syncedToCloud
          ? '**Đã lưu lên Firebase Storage dùng chung** — tất cả tài khoản khác khi hỏi giá này sẽ nhận kết quả ngay với **0 token**.'
          : '**Đã lưu cục bộ trên máy này** (hiệu lực 7 ngày).'
      }`;
      usedModelId = 'gemma-4-26b-a4b-it';
      isFreeSharedHit = true;
      cacheOrigin = 'community_price';
      tokensUsedCount = 0;
    }

    // Step 1: For volatile 7-day market queries, check Community Market Price Board first (0 token)
    if (!replyText && sharedDescriptor?.category === 'volatile_7d') {
      const now = Date.now();
      let board = communityBoardCacheRef.current.board;
      if (!board || now - communityBoardCacheRef.current.fetchedAt > 120000) {
        board = await readCommunityMarketPricesFromFirebaseStorage();
        communityBoardCacheRef.current = { board, fetchedAt: now };
      }
      const matches = matchCommunityMarketPricesForQuery(promptText, board, now);
      if (matches.length > 0) {
        replyText = formatCommunityMarketPriceAnswer(promptText, matches);
        usedModelId = 'gemma-4-26b-a4b-it';
        isFreeSharedHit = true;
        cacheOrigin = 'community_price';
        tokensUsedCount = 0;
      }
    }

    // Step 2a: Check local client response cache (respecting evergreen / 7d / 6h TTL)
    if (!replyText) {
      try {
        const rawCache = localStorage.getItem(CLIENT_AI_CACHE_STORAGE_KEY);
        if (rawCache) {
          const parsedCache = JSON.parse(rawCache) as Record<
            string,
            {
              text: string;
              modelUsed: GeminiConcreteModelId;
              sources?: GeminiGroundingSource[];
              apiConnected?: boolean;
              usedWebSearch?: boolean;
              cachedAt: number;
              expiresAt?: number | null;
              cacheOrigin?: GeminiMessageCacheOrigin;
            }
          >;
          const cachedEntry = parsedCache[localCacheKey];
          const now = Date.now();
          const isNotExpired = cachedEntry
            ? cachedEntry.expiresAt === null
              ? true
              : typeof cachedEntry.expiresAt === 'number'
              ? now < cachedEntry.expiresAt
              : now - cachedEntry.cachedAt < GEMINI_QUERY_CACHE_TTL_MS
            : false;
          if (cachedEntry && cachedEntry.text && isNotExpired) {
            replyText = cachedEntry.text;
            usedModelId = cachedEntry.modelUsed || routing.targetModel;
            replySources = Array.isArray(cachedEntry.sources) ? cachedEntry.sources : [];
            apiConnectedFlag = Boolean(cachedEntry.apiConnected);
            usedWebSearchFlag = Boolean(cachedEntry.usedWebSearch || replySources.length > 0);
            isCachedHit = true;
            isFreeSharedHit = Boolean(sharedDescriptor);
            cacheOrigin =
              cachedEntry.cacheOrigin ||
              (sharedDescriptor?.category === 'evergreen'
                ? 'shared_evergreen'
                : sharedDescriptor?.category === 'volatile_7d'
                ? 'shared_7d'
                : 'local_cache');
          }
        }
      } catch {
        // ignore localStorage read errors
      }
    }

    // Step 2b: Check Firebase Storage Shared Knowledge Cache (/documents/ai_cache/, 0 token)
    if (!replyText && sharedDescriptor) {
      const sharedHit = await readSharedAiCacheFromFirebaseStorage(
        sharedDescriptor.fileName
      );
      if (sharedHit) {
        replyText = sharedHit.text;
        usedModelId = sharedHit.modelUsed || routing.targetModel;
        replySources = Array.isArray(sharedHit.sources) ? sharedHit.sources : [];
        apiConnectedFlag = true;
        usedWebSearchFlag = replySources.length > 0;
        isCachedHit = true;
        isFreeSharedHit = true;
        cacheOrigin =
          sharedHit.category === 'evergreen' ? 'shared_evergreen' : 'shared_7d';
        tokensUsedCount = 0;

        // Warm localStorage cache for instant repeat access
        try {
          const rawCache = localStorage.getItem(CLIENT_AI_CACHE_STORAGE_KEY);
          const parsedCache = rawCache ? JSON.parse(rawCache) : {};
          parsedCache[localCacheKey] = {
            text: replyText,
            modelUsed: usedModelId,
            sources: replySources,
            apiConnected: true,
            usedWebSearch: usedWebSearchFlag,
            cachedAt: Date.now(),
            expiresAt: sharedHit.expiresAt,
            cacheOrigin,
          };
          localStorage.setItem(
            CLIENT_AI_CACHE_STORAGE_KEY,
            JSON.stringify(parsedCache)
          );
        } catch {
          // ignore storage quota errors
        }
      }
    }

    // Step 3: Live Gemini API call (only when not served from Community or Shared Knowledge Cache)
    if (!replyText && !latestQuotaCheck.allowed) {
      quotaBlockedByServer = true;
      setDailyQuota(latestQuotaCheck.normalizedQuota);
      replyText =
        latestQuotaCheck.message ||
        'Tài khoản đã hết hạn mức câu hỏi Trợ lý A.I trong ngày hôm nay. Hạn mức sẽ tự động làm mới vào 00:00 ngày mai.';
    }

    if (!replyText) {
      // Step 3A: Try same-origin backend (/api/gemini/chat)
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 24000);
        const response = await fetch('/api/gemini/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: promptText,
            history: previousHistory,
            model: selectedModel,
            accountId: accountQuotaKey,
            queryScope: routing.queryScope,
            systemInstruction: activeSystemInstruction,
            internalSystemInstruction,
            externalSystemInstruction,
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);

        const contentType = response.headers.get('content-type') || '';
        if (response.status === 429 && contentType.includes('application/json')) {
          const errData = (await response.json()) as {
            error?: string;
            quotaExceeded?: boolean;
            quota?: AccountDailyAiQuota;
          };
          if (errData.quotaExceeded) {
            quotaBlockedByServer = true;
            if (errData.quota) {
              serverReturnedQuota = normalizeAccountDailyAiQuotaForToday(
                errData.quota,
                accountQuotaKey
              );
            }
            replyText =
              errData.error ||
              'Tài khoản đã hết hạn mức câu hỏi Trợ lý A.I trong ngày hôm nay. Hạn mức sẽ tự động làm mới vào 00:00 ngày mai.';
          }
        } else if (response.ok && contentType.includes('application/json')) {
          const data = (await response.json()) as {
            text?: string;
            modelUsed?: GeminiConcreteModelId;
            sources?: GeminiGroundingSource[];
            apiConnected?: boolean;
            verifiedWebSearch?: boolean;
            usage?: { totalTokens?: number };
            quota?: AccountDailyAiQuota;
          };
          if (typeof data.apiConnected === 'boolean') {
            apiConnectedFlag = data.apiConnected;
          }
          if (Array.isArray(data.sources) && data.sources.length > 0) {
            replySources = data.sources;
            usedWebSearchFlag = true;
          }
          if (data.quota) {
            serverReturnedQuota = normalizeAccountDailyAiQuotaForToday(
              data.quota,
              accountQuotaKey
            );
          }
          if (data.text && data.text.trim()) {
            replyText = data.text.trim();
            if (data.modelUsed) {
              usedModelId = data.modelUsed;
            }
            if (data.verifiedWebSearch === false && routing.requireVerifiedSearch) {
              unverifiedExternalBlocked = true;
              tokensUsedCount = 0;
            } else {
              tokensUsedCount =
                Number(data.usage?.totalTokens) ||
                estimateVietnameseTokens(promptText + replyText);
            }
          }
        }
      } catch {
        // Same-origin backend unavailable (e.g. static Hostinger hosting) -> try direct Gemini REST API
      }

      // Step 3B: Direct Gemini REST API fallback (for static Hostinger build)
      if (!replyText && !quotaBlockedByServer) {
        const viteEnv = (import.meta as { env?: Record<string, string | undefined> }).env;
        const clientApiKey = (viteEnv?.VITE_GEMINI_API_KEY || '').trim();

        if (clientApiKey) {
          const formattedContents = [
            ...previousHistory.map((item) => ({
              role: item.role,
              parts: [{ text: item.text }],
            })),
            {
              role: 'user',
              parts: [{ text: promptText }],
            },
          ];

          for (const candidateModel of routing.fallbackModels) {
            const allowNativeSearch =
              routing.enableExternalSearch && candidateModel !== 'gemma-4-26b-a4b-it';
            const searchAttempts = routing.requireVerifiedSearch
              ? allowNativeSearch
                ? [true]
                : []
              : allowNativeSearch
              ? [true, false]
              : [false];

            for (const useGoogleSearch of searchAttempts) {
              try {
                const controller = new AbortController();
                const timer = setTimeout(
                  () => controller.abort(),
                  useGoogleSearch ? 25000 : 16000
                );

                const thinkingLevel =
                  candidateModel === 'gemini-4-hydrogen'
                    ? routing.thinkingLevel === 'MEDIUM'
                      ? 'MEDIUM'
                      : 'LOW'
                    : 'MINIMAL';
                const maxOutputTokens =
                  candidateModel === 'gemini-4-hydrogen'
                    ? Math.max(2048, routing.maxOutputTokens)
                    : Math.max(1400, routing.maxOutputTokens);

                const directResponse = await fetch(
                  `https://generativelanguage.googleapis.com/v1beta/models/${candidateModel}:generateContent?key=${encodeURIComponent(
                    clientApiKey
                  )}`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      systemInstruction: {
                        parts: [{ text: activeSystemInstruction }],
                      },
                      contents: formattedContents,
                      generationConfig: {
                        maxOutputTokens,
                        thinkingConfig: { thinkingLevel },
                      },
                      ...(useGoogleSearch ? { tools: [{ google_search: {} }] } : {}),
                    }),
                    signal: controller.signal,
                  }
                );
                clearTimeout(timer);

                if (!directResponse.ok) {
                  continue;
                }

                const json = (await directResponse.json()) as {
                  candidates?: Array<{
                    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
                    groundingMetadata?: unknown;
                  }>;
                  usageMetadata?: { totalTokenCount?: number };
                };

                const visibleText = extractVisibleTextFromGeminiParts(
                  json.candidates?.[0]?.content?.parts
                );

                if (
                  visibleText &&
                  !visibleText.startsWith('google:search{') &&
                  !visibleText.startsWith('call:google:search')
                ) {
                  const groundingLinks = extractGroundingSourcesFromMetadata(
                    json.candidates?.[0]?.groundingMetadata
                  );

                  // Reject ungrounded guesses when verified search is required; escalate to next model
                  if (routing.requireVerifiedSearch && groundingLinks.length === 0) {
                    continue;
                  }

                  replyText = visibleText;
                  usedModelId = candidateModel;
                  apiConnectedFlag = true;
                  if (groundingLinks.length > 0) {
                    replySources = groundingLinks;
                    usedWebSearchFlag = true;
                  }
                  tokensUsedCount =
                    Number(json.usageMetadata?.totalTokenCount) ||
                    estimateVietnameseTokens(promptText + visibleText);
                  break;
                }
              } catch {
                // try next attempt / model
              }
            }
            if (replyText) break;
          }
        }
      }

      // Step 3C: Safe unverified lookup notice OR emergency offline report fallback
      if (!replyText && !quotaBlockedByServer) {
        if (routing.requireVerifiedSearch) {
          replyText = buildUnverifiedExternalLookupNotice(promptText);
          unverifiedExternalBlocked = true;
          tokensUsedCount = 0;
        } else {
          if (replySources.length === 0 && shouldEnableExternalWebSearch(promptText)) {
            replySources = await fetchBrowserWikipediaFallback(promptText);
          }
          replyText = generateSmartReportAnswer(promptText, reportSnapshot, replySources);
          tokensUsedCount = 0;
        }
      }

      // Save verified non-blocked result to localStorage AND Firebase Storage Shared Cache
      const canCacheReply =
        Boolean(replyText) &&
        !quotaBlockedByServer &&
        !unverifiedExternalBlocked &&
        (!routing.requireVerifiedSearch || replySources.length > 0);

      if (canCacheReply) {
        const now = Date.now();
        const expiresAt =
          sharedDescriptor?.category === 'evergreen'
            ? null
            : sharedDescriptor?.category === 'volatile_7d'
            ? now + SHARED_VOLATILE_CACHE_TTL_MS
            : now + GEMINI_QUERY_CACHE_TTL_MS;

        try {
          const rawCache = localStorage.getItem(CLIENT_AI_CACHE_STORAGE_KEY);
          const parsedCache = rawCache ? JSON.parse(rawCache) : {};
          const freshEntries = Object.entries(parsedCache).filter(([, val]) => {
            const entry = val as { cachedAt?: number; expiresAt?: number | null };
            if (!entry) return false;
            if (entry.expiresAt === null) return true;
            if (typeof entry.expiresAt === 'number') return now < entry.expiresAt;
            return typeof entry.cachedAt === 'number' && now - entry.cachedAt < GEMINI_QUERY_CACHE_TTL_MS;
          });
          const pruned = Object.fromEntries(freshEntries.slice(-80));
          pruned[localCacheKey] = {
            text: replyText,
            modelUsed: usedModelId,
            sources: replySources,
            apiConnected: apiConnectedFlag,
            usedWebSearch: usedWebSearchFlag,
            cachedAt: now,
            expiresAt,
            cacheOrigin: sharedDescriptor
              ? sharedDescriptor.category === 'evergreen'
                ? 'shared_evergreen'
                : 'shared_7d'
              : 'local_cache',
          };
          localStorage.setItem(CLIENT_AI_CACHE_STORAGE_KEY, JSON.stringify(pruned));
        } catch {
          // ignore storage quota errors
        }

        // Persist to Firebase Storage (/documents/ai_cache/) for all accounts to reuse at 0 token
        if (sharedDescriptor && apiConnectedFlag) {
          const nowIso = new Date(now).toISOString();
          void writeSharedAiCacheToFirebaseStorage({
            version: 1,
            cacheFileName: sharedDescriptor.fileName,
            canonicalKey: sharedDescriptor.canonicalKey,
            originalQuery: promptText,
            category: sharedDescriptor.category,
            text: replyText,
            modelUsed: usedModelId,
            sources: replySources.map((s) => ({
              title: s.title,
              uri: s.uri,
              sourceName: s.sourceName,
            })),
            createdAt: nowIso,
            updatedAt: nowIso,
            expiresAt,
            contributorName: currentStaff?.displayName || 'Tài khoản VTNN Tâm An',
          });
        }
      }
    }

    if (quotaBlockedByServer && serverReturnedQuota) {
      setDailyQuota(serverReturnedQuota);
    } else if (!quotaBlockedByServer && !unverifiedExternalBlocked) {
      const localRecorded = recordAccountDailyAiUsage(
        latestQuotaCheck.normalizedQuota,
        {
          tokensUsed: tokensUsedCount,
          modelUsed: usedModelId,
          cached: isCachedHit,
          freeSharedCache: isFreeSharedHit,
        }
      );
      if (
        serverReturnedQuota &&
        !isFreeSharedHit &&
        serverReturnedQuota.questionsUsed >= localRecorded.questionsUsed
      ) {
        setDailyQuota(serverReturnedQuota);
      } else {
        setDailyQuota(localRecorded);
      }
    }

    const modelMessage: GeminiChatMessage = {
      id: `msg_m_${Date.now()}`,
      role: 'model',
      text: replyText,
      timestamp: new Date().toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      modelId: usedModelId,
      sources: replySources.length > 0 ? replySources : undefined,
      apiConnected: apiConnectedFlag,
      usedWebSearch: usedWebSearchFlag,
      tokensUsed: tokensUsedCount,
      sourceQuery: promptText,
      queryScope: routing.queryScope,
      cacheOrigin,
    };

    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession.id
          ? {
              ...s,
              updatedAt: new Date().toISOString(),
              messages: [...s.messages, modelMessage],
            }
          : s
      )
    );
    setIsGenerating(false);
  };

  const userDisplayName = currentStaff?.displayName || 'Bạn';

  return (
    <div className="flex h-[calc(100vh-8.5rem)] min-h-[580px] bg-white rounded-3xl border border-slate-200/90 shadow-sm overflow-hidden relative">
      {/* Left Conversation History Drawer (Desktop persistent + Mobile overlay) */}
      <aside
        className={`${
          showHistoryDrawer ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } fixed lg:static inset-y-0 left-0 z-30 w-68 bg-slate-50/95 backdrop-blur-md border-r border-slate-200/80 flex flex-col transition-transform duration-200`}
      >
        <div className="p-3.5 border-b border-slate-200/70 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleCreateNewChat}
            className="flex-1 inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-2xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-sm transition cursor-pointer"
          >
            <MessageSquarePlus className="w-4 h-4" />
            Cuộc trò chuyện mới
          </button>
          <button
            type="button"
            onClick={() => setShowHistoryDrawer(false)}
            className="lg:hidden px-2.5 py-2 rounded-xl text-xs font-semibold text-slate-500 hover:bg-slate-200/60"
          >
            Đóng
          </button>
        </div>

        {/* Connected Warehouse Data Summary Card */}
        <div className="mx-3 mt-3 p-3 rounded-2xl bg-gradient-to-br from-emerald-50 via-teal-50/70 to-blue-50/50 border border-emerald-200/70">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-800">
            <Sparkles className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span className="truncate">Kho: {activeWarehouseLabel}</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
            <div className="bg-white/80 rounded-xl px-2.5 py-1.5 border border-emerald-100">
              <span className="text-slate-500 block">Doanh thu</span>
              <span className="font-bold text-slate-800 truncate block">
                {formatVND(reportSnapshot.totalSalesRevenue)}
              </span>
            </div>
            <div className="bg-white/80 rounded-xl px-2.5 py-1.5 border border-emerald-100">
              <span className="text-slate-500 block">Nợ phải thu KH</span>
              <span className="font-bold text-amber-700 truncate block">
                {formatVND(reportSnapshot.totalCustomerDebt)}
              </span>
            </div>
          </div>
        </div>

        {/* Daily Account AI Quota Card */}
        <div className="mx-3 mt-2.5 p-3 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
          <div className="flex items-center justify-between text-[11px] font-bold text-slate-700">
            <span>Hạn mức A.I hôm nay</span>
            <span
              className={
                quotaCheck.allowed ? 'text-emerald-700' : 'text-rose-600'
              }
            >
              {quotaCheck.normalizedQuota.questionsUsed}/
              {quotaCheck.normalizedQuota.questionLimit} câu
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                !quotaCheck.allowed
                  ? 'bg-rose-500'
                  : quotaCheck.normalizedQuota.questionsUsed >=
                    quotaCheck.normalizedQuota.questionLimit * 0.8
                  ? 'bg-amber-500'
                  : 'bg-emerald-500'
              }`}
              style={{
                width: `${Math.min(
                  100,
                  Math.round(
                    (quotaCheck.normalizedQuota.questionsUsed /
                      quotaCheck.normalizedQuota.questionLimit) *
                      100
                  )
                )}%`,
              }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-500">
            <span>
              Token:{' '}
              {quotaCheck.normalizedQuota.tokensUsed.toLocaleString('vi-VN')} /{' '}
              {quotaCheck.normalizedQuota.tokenLimit.toLocaleString('vi-VN')}
            </span>
            <span>Làm mới 00:00</span>
          </div>
        </div>

        {/* History List */}
        <div className="px-3 pt-3 pb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Lịch sử hỏi đáp ({sessions.length})
          </span>
        </div>
        <div className="flex-1 overflow-y-auto px-2.5 pb-3 space-y-1">
          {sessions.map((session) => {
            const isSelected = session.id === activeSession?.id;
            return (
              <div
                key={session.id}
                className={`group flex items-center justify-between gap-2 px-3 py-2.5 rounded-2xl text-xs transition ${
                  isSelected
                    ? 'bg-emerald-100/80 text-emerald-950 font-bold border border-emerald-200/80'
                    : 'text-slate-600 hover:bg-slate-200/60 font-medium'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setActiveSessionId(session.id);
                    setShowHistoryDrawer(false);
                  }}
                  className="flex-1 text-left truncate cursor-pointer"
                >
                  <div className="truncate">{session.title}</div>
                  <div className="text-[10px] text-slate-400 font-normal mt-0.5">
                    {session.messages.length} tin nhắn
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteSession(session.id)}
                  aria-label={`Xóa cuộc trò chuyện ${session.title}`}
                  className="opacity-70 hover:opacity-100 p-1 rounded-lg hover:bg-rose-100 hover:text-rose-600 text-slate-400 transition cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Main Clean AI Chat Workspace */}
      <div className="flex-1 flex flex-col min-w-0 bg-gradient-to-b from-slate-50/30 via-white to-white">
        {/* Clean Minimal Top Bar */}
        <header className="px-4 sm:px-6 py-3 border-b border-slate-100 bg-white/90 backdrop-blur-sm flex items-center justify-between gap-2 z-20">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowHistoryDrawer((prev) => !prev)}
              className="lg:hidden inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              <History className="w-3.5 h-3.5" />
              Lịch sử
            </button>

            {/* Model Selector Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowModelDropdown((prev) => !prev)}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-slate-100/90 hover:bg-slate-200/70 border border-slate-200/80 text-slate-800 text-xs sm:text-sm font-bold transition cursor-pointer"
              >
                <span className="w-6 h-6 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-500 to-emerald-500 text-white flex items-center justify-center shadow-xs">
                  <Sparkles className="w-3.5 h-3.5" />
                </span>
                <span>{activeModelMeta.label}</span>
                <span className="hidden sm:inline-block px-2 py-0.5 text-[10px] font-bold rounded-lg bg-white text-emerald-700 border border-emerald-200">
                  {activeModelMeta.badge}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
              </button>

              {showModelDropdown && (
                <div className="absolute left-0 mt-2 w-80 rounded-2xl bg-white border border-slate-200 shadow-xl p-2 z-40">
                  <div className="px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Chọn mô hình Trợ lý A.I
                  </div>
                  <div className="space-y-1">
                    {GEMINI_MODEL_OPTIONS.map((opt) => {
                      const active = opt.id === selectedModel;
                      return (
                        <React.Fragment key={opt.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedModel(opt.id);
                              setShowModelDropdown(false);
                            }}
                            className={`w-full text-left p-2.5 rounded-xl transition flex items-start justify-between gap-2 cursor-pointer ${
                              active
                                ? 'bg-emerald-50 border border-emerald-200 text-emerald-950'
                                : 'hover:bg-slate-100 text-slate-700'
                            }`}
                          >
                            <div>
                              <div className="text-xs font-bold flex items-center gap-1.5">
                                <span>{opt.label}</span>
                                <span
                                  className={`px-1.5 py-0.5 text-[10px] rounded-md font-semibold ${
                                    opt.tier === 'auto'
                                      ? 'bg-indigo-100 text-indigo-700'
                                      : opt.tier === 'free'
                                      ? 'bg-emerald-100 text-emerald-700'
                                      : 'bg-slate-100 text-slate-600'
                                  }`}
                                >
                                  {opt.badge}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-500 mt-0.5">
                                {opt.description}
                              </p>
                            </div>
                            {active && (
                              <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                            )}
                          </button>
                          {opt.id === 'auto' && (
                            <div className="my-1 border-t border-slate-100" />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`hidden sm:inline-flex items-center px-2.5 py-1 rounded-xl text-[11px] font-bold border ${
                quotaCheck.allowed
                  ? 'bg-emerald-50/80 text-emerald-800 border-emerald-200'
                  : 'bg-rose-50 text-rose-700 border-rose-200'
              }`}
              title={`Đã dùng ${quotaCheck.normalizedQuota.tokensUsed.toLocaleString('vi-VN')} / ${quotaCheck.normalizedQuota.tokenLimit.toLocaleString('vi-VN')} token hôm nay`}
            >
              Còn {quotaCheck.remainingQuestions}/
              {quotaCheck.normalizedQuota.questionLimit} câu hôm nay
            </span>

            <button
              type="button"
              onClick={handleCreateNewChat}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 transition cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Làm mới</span>
            </button>
          </div>
        </header>

        {/* Scrollable Message Thread or Clean Centered Gemini Greeting */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 flex flex-col">
          {!activeSession || activeSession.messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center max-w-2xl mx-auto text-center py-8">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-gradient-to-r from-blue-50 via-indigo-50 to-emerald-50 border border-indigo-200/60 text-xs font-bold text-indigo-800 mb-5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                Trợ lý A.I · Kết nối trực tiếp kho {activeWarehouseLabel}
              </div>
              <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-600 bg-clip-text text-transparent leading-tight">
                Xin chào, {userDisplayName}
              </h2>
            </div>
          ) : (
            <div className="max-w-3xl w-full mx-auto space-y-6">
              {activeSession.messages.map((msg) => {
                const isUser = msg.role === 'user';
                return (
                  <div
                    key={msg.id}
                    className={`flex items-start gap-3 sm:gap-4 ${
                      isUser ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    {!isUser && (
                      <div className="w-8 h-8 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-500 to-emerald-500 text-white flex items-center justify-center shrink-0 shadow-xs mt-0.5">
                        <Sparkles className="w-4 h-4" />
                      </div>
                    )}

                    <div
                      className={`max-w-[88%] sm:max-w-[82%] rounded-3xl px-4 sm:px-5 py-3.5 ${
                        isUser
                          ? 'bg-slate-100 text-slate-900 rounded-tr-lg border border-slate-200/80'
                          : 'bg-white text-slate-800 border border-slate-200/90 shadow-xs rounded-tl-lg'
                      }`}
                    >
                      {isUser ? (
                        <p className="text-sm font-medium whitespace-pre-wrap">{msg.text}</p>
                      ) : (
                        <div>
                          {renderFormattedMessage(msg.text)}
                          {msg.sources && msg.sources.length > 0 && (
                            <div className="mt-3 pt-2.5 border-t border-slate-100">
                              <div className="text-[11px] font-bold text-slate-500 mb-1.5">
                                Nguồn tra cứu:
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {msg.sources.map((src, idx) => (
                                  <a
                                    key={idx}
                                    href={src.uri}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 text-[11px] font-semibold text-indigo-700 transition max-w-xs truncate"
                                  >
                                    <Globe className="w-3 h-3 shrink-0" />
                                    <span className="truncate">{src.title}</span>
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}
                          {(msg.queryScope === 'external' ||
                            msg.usedWebSearch ||
                            (msg.sources && msg.sources.length > 0)) &&
                            msg.sourceQuery && (
                              <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                                <a
                                  href={buildGoogleAiModeUrl(msg.sourceQuery)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 hover:from-blue-100 hover:to-indigo-100 border border-indigo-200/80 text-[11px] font-bold text-indigo-800 transition"
                                >
                                  <ExternalLink className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                                  <span>Kiểm chứng trên Google Chế độ AI (0 token)</span>
                                </a>
                                {typeof msg.tokensUsed === 'number' && msg.tokensUsed > 0 && (
                                  <span className="text-[10px] text-slate-400 font-medium">
                                    Tiêu thụ: {msg.tokensUsed.toLocaleString('vi-VN')} token
                                  </span>
                                )}
                              </div>
                            )}
                          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <Bot className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                              <span>
                                Trợ lý A.I ·{' '}
                                {getGeminiModelOptionMeta(msg.modelId).label} (
                                {getGeminiModelOptionMeta(msg.modelId).badge}) ·{' '}
                                {msg.timestamp}
                              </span>
                              {(msg.usedWebSearch ||
                                (msg.sources && msg.sources.length > 0)) && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-semibold text-[10px]">
                                  <Globe className="w-2.5 h-2.5" />
                                  Tìm kiếm web
                                </span>
                              )}
                              {msg.cacheOrigin === 'shared_evergreen' && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold text-[10px]">
                                  <Database className="w-2.5 h-2.5" />
                                  Kho tri thức dùng chung · Vĩnh viễn · 0 token
                                </span>
                              )}
                              {msg.cacheOrigin === 'shared_7d' && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-teal-50 text-teal-700 border border-teal-200 font-semibold text-[10px]">
                                  <Database className="w-2.5 h-2.5" />
                                  Kho tri thức dùng chung · 7 ngày · 0 token
                                </span>
                              )}
                              {msg.cacheOrigin === 'community_price' && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 font-semibold text-[10px]">
                                  <Tag className="w-2.5 h-2.5" />
                                  Giá thị trường cộng đồng · 7 ngày · 0 token
                                </span>
                              )}
                              {msg.cacheOrigin === 'local_cache' && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 font-semibold text-[10px]">
                                  Bộ nhớ đệm nhanh · 0 token
                                </span>
                              )}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopyMessage(msg)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-100 text-slate-600 font-semibold transition cursor-pointer"
                            >
                              {copiedMessageId === msg.id ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                                  <span className="text-emerald-700">Đã sao chép</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  <span>Sao chép</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {isGenerating && (
                <div className="flex items-start gap-3 sm:gap-4">
                  <div className="w-8 h-8 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-500 to-emerald-500 text-white flex items-center justify-center shrink-0 shadow-xs animate-pulse">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div className="rounded-3xl rounded-tl-lg px-5 py-4 bg-white border border-slate-200/90 shadow-xs">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                      <span className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" />
                      <span className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce [animation-delay:150ms]" />
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-bounce [animation-delay:300ms]" />
                      <span className="ml-1">Đang phân tích và trả lời...</span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={threadEndRef} />
            </div>
          )}
        </div>

        {/* Bottom Clean Gemini Prompt Composer Bar */}
        <div className="px-4 sm:px-8 pb-5 pt-2 bg-white">
          <div className="max-w-3xl mx-auto">
            {!quotaCheck.allowed && (
              <div className="mb-2.5 px-3.5 py-2.5 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800 font-medium">
                {quotaCheck.message}
              </div>
            )}

            {/* Quick Suggestion Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-2.5 no-scrollbar">
              <button
                type="button"
                disabled={!quotaCheck.allowed || isGenerating}
                onClick={() =>
                  handleSendMessage(
                    'Báo cáo tổng hợp doanh thu, lợi nhuận và dòng tiền của kho hiện tại'
                  )
                }
                className="shrink-0 px-3 py-1.5 rounded-full bg-slate-100 hover:bg-emerald-50 hover:text-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed text-slate-600 text-xs font-semibold border border-slate-200/80 transition cursor-pointer"
              >
                📊 Báo cáo doanh thu & lợi nhuận
              </button>
              <button
                type="button"
                disabled={!quotaCheck.allowed || isGenerating}
                onClick={() =>
                  handleSendMessage('Danh sách khách hàng đang nợ và nợ quá hạn cần thu hồi')
                }
                className="shrink-0 px-3 py-1.5 rounded-full bg-slate-100 hover:bg-emerald-50 hover:text-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed text-slate-600 text-xs font-semibold border border-slate-200/80 transition cursor-pointer"
              >
                💳 Khách hàng đang nợ
              </button>
              <button
                type="button"
                disabled={!quotaCheck.allowed || isGenerating}
                onClick={() =>
                  handleSendMessage('Kiểm tra các mặt hàng vật tư tồn kho thấp hoặc đã hết hàng')
                }
                className="shrink-0 px-3 py-1.5 rounded-full bg-slate-100 hover:bg-emerald-50 hover:text-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed text-slate-600 text-xs font-semibold border border-slate-200/80 transition cursor-pointer"
              >
                📦 Vật tư sắp hết hàng
              </button>
              <button
                type="button"
                disabled={!quotaCheck.allowed || isGenerating}
                onClick={() =>
                  handleSendMessage(
                    'Tư vấn kỹ thuật bón phân và phòng trị bệnh cho lúa và sầu riêng'
                  )
                }
                className="shrink-0 px-3 py-1.5 rounded-full bg-slate-100 hover:bg-emerald-50 hover:text-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed text-slate-600 text-xs font-semibold border border-slate-200/80 transition cursor-pointer"
              >
                🌱 Kỹ thuật nông nghiệp
              </button>
              <button
                type="button"
                disabled={isGenerating}
                onClick={() => setShowMarketPriceModal(true)}
                className="shrink-0 px-3 py-1.5 rounded-full bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-bold border border-amber-200 transition cursor-pointer"
              >
                📝 Cập nhật giá thị trường
              </button>
            </div>

            {/* Rounded Gemini Input Box */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="relative flex items-end gap-2 rounded-3xl bg-slate-100/90 focus-within:bg-white border border-slate-200 focus-within:border-indigo-400 focus-within:shadow-md px-4 py-3 transition-all"
            >
              <textarea
                rows={2}
                value={inputPrompt}
                onChange={(e) => setInputPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder={
                  quotaCheck.allowed
                    ? `Hỏi Trợ lý A.I (VD: Báo cáo doanh thu kho ${activeWarehouseLabel}, giá lúa OM18, hoặc nhập "Cập nhật giá lúa OM18 7.500 đ/kg" để chia sẻ...)`
                    : 'Đã hết 30 lượt A.I mới hôm nay (vẫn tra cứu được Kho tri thức dùng chung 0 token)'
                }
                className="w-full resize-none bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none leading-relaxed"
              />
              <button
                type="submit"
                disabled={!inputPrompt.trim() || isGenerating}
                aria-label="Gửi câu hỏi"
                className={`p-2.5 rounded-2xl shrink-0 transition cursor-pointer ${
                  inputPrompt.trim() && !isGenerating
                    ? 'bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-600 text-white shadow-sm hover:opacity-95'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Modal: Contribute Community Market Price (Shared for 7 Days at 0 Token) */}
      {showMarketPriceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-3xl bg-white border border-slate-200 shadow-2xl p-5">
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
                  <Tag className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Cập nhật Giá Thị Trường Dùng Chung
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Lưu 7 ngày trên Cloud để mọi tài khoản tra cứu nhanh (0 token)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowMarketPriceModal(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                aria-label="Đóng"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitMarketPriceModal} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Nhóm mặt hàng
                </label>
                <select
                  value={marketTopic}
                  onChange={(e) =>
                    setMarketTopic(e.target.value as CommunityMarketPriceEntry['topic'])
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="rice">Giá lúa gạo</option>
                  <option value="fertilizer">Giá phân bón</option>
                  <option value="pesticide">Giá thuốc BVTV</option>
                  <option value="produce">Giá nông sản / trái cây</option>
                  <option value="other">Thị trường khác</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Tên mặt hàng / giống lúa *
                </label>
                <input
                  type="text"
                  required
                  value={marketItemName}
                  onChange={(e) => setMarketItemName(e.target.value)}
                  placeholder="VD: Lúa OM18 tươi hoặc Urê Phú Mỹ"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Mức giá thực tế *
                </label>
                <input
                  type="text"
                  required
                  value={marketPriceText}
                  onChange={(e) => setMarketPriceText(e.target.value)}
                  placeholder="VD: 7.500 đ/kg hoặc 595.000 đ/bao 50kg"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Khu vực (tùy chọn)
                </label>
                <input
                  type="text"
                  value={marketRegion}
                  onChange={(e) => setMarketRegion(e.target.value)}
                  placeholder="VD: Đồng Tháp / Cao Lãnh"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowMarketPriceModal(false)}
                  className="px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={
                    !marketItemName.trim() || !marketPriceText.trim() || isSavingMarketPrice
                  }
                  className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-bold shadow-xs cursor-pointer"
                >
                  {isSavingMarketPrice ? 'Đang lưu...' : 'Lưu dùng chung (7 ngày)'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

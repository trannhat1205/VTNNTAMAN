import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Check,
  ChevronDown,
  Copy,
  History,
  MessageSquarePlus,
  Send,
  Sparkles,
  Trash2,
  Globe,
  RotateCcw,
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
  buildGeminiSystemInstruction,
  buildWarehouseReportSnapshot,
  GEMINI_MODEL_OPTIONS,
  GeminiModelOptionId,
  generateSmartReportAnswer,
  isPureInternalWarehouseQuery,
} from '../utils/geminiReportAssistant';
import { formatVND } from '../utils/businessLogic';

export interface GeminiGroundingSource {
  title: string;
  uri: string;
  publishedAt?: string;
  sourceName?: string;
  snippet?: string;
}

export interface GeminiChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string;
  modelId?: GeminiModelOptionId;
  sources?: GeminiGroundingSource[];
  apiConnected?: boolean;
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

const REMOTE_GEMINI_API_FALLBACKS = [
  'https://ais-pre-d6gejt24bdkwlhvgmjms2b-804647049989.asia-southeast1.run.app/api/gemini/chat',
  'https://ais-dev-d6gejt24bdkwlhvgmjms2b-804647049989.asia-southeast1.run.app/api/gemini/chat',
];

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
  const storageKey = useMemo(() => {
    const uid = currentStaff?.uid || 'guest';
    return `vtnn_taman_gemini_sessions_v1_${uid}`;
  }, [currentStaff?.uid]);

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

  const [activeSessionId, setActiveSessionId] = useState<string>(() => sessions[0]?.id || '');
  const [selectedModel, setSelectedModel] = useState<GeminiModelOptionId>('gemini-4-hydrogen');
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const [inputPrompt, setInputPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  const threadEndRef = useRef<HTMLDivElement | null>(null);

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

  const systemInstruction = useMemo(
    () => buildGeminiSystemInstruction(reportSnapshot),
    [reportSnapshot]
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

  const handleSendMessage = async (customText?: string) => {
    const promptText = (customText ?? inputPrompt).normalize('NFC').trim();
    if (!promptText || isGenerating || !activeSession) return;

    const userMessage: GeminiChatMessage = {
      id: `msg_u_${Date.now()}`,
      role: 'user',
      text: promptText,
      timestamp: new Date().toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    };

    const previousHistory = activeSession.messages.map((m) => ({
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

    let replyText = '';
    let usedModelId: GeminiModelOptionId = selectedModel;
    let replySources: GeminiGroundingSource[] = [];
    let apiConnectedFlag = false;

    const payloadBody = JSON.stringify({
      message: promptText,
      history: previousHistory,
      model: selectedModel,
      systemInstruction,
    });

    const isLocalOrCloudRun =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname.endsWith('.run.app'));

    const candidateEndpoints = isLocalOrCloudRun
      ? ['/api/gemini/chat']
      : ['/api/gemini/chat', ...REMOTE_GEMINI_API_FALLBACKS];

    for (const endpoint of candidateEndpoints) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 22000);
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payloadBody,
          signal: controller.signal,
        });
        clearTimeout(timer);

        const contentType = response.headers.get('content-type') || '';
        if (response.ok && contentType.includes('application/json')) {
          const data = (await response.json()) as {
            text?: string;
            modelUsed?: GeminiModelOptionId;
            sources?: GeminiGroundingSource[];
            apiConnected?: boolean;
          };
          if (typeof data.apiConnected === 'boolean') {
            apiConnectedFlag = data.apiConnected;
          }
          if (Array.isArray(data.sources) && data.sources.length > 0) {
            replySources = data.sources;
          }
          if (data.text && data.text.trim()) {
            replyText = data.text.trim();
            if (data.modelUsed) {
              usedModelId = data.modelUsed;
            }
            break;
          }
        }
      } catch {
        // Try next candidate endpoint or client-side fallback
      }
    }

    if (!replyText) {
      if (replySources.length === 0 && !isPureInternalWarehouseQuery(promptText)) {
        replySources = await fetchBrowserWikipediaFallback(promptText);
      }
      replyText = generateSmartReportAnswer(promptText, reportSnapshot, replySources);
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
                        <button
                          key={opt.id}
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
                              <span className="px-1.5 py-0.5 text-[10px] rounded-md bg-slate-100 text-slate-600 font-semibold">
                                {opt.badge}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 mt-0.5">{opt.description}</p>
                          </div>
                          {active && <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={handleCreateNewChat}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 transition cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Làm mới</span>
          </button>
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
                          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                            <span className="flex items-center gap-1.5">
                              <Bot className="w-3.5 h-3.5 text-indigo-500" />
                              <span>Trợ lý A.I · {msg.timestamp}</span>
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
            {/* Quick Suggestion Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-2.5 no-scrollbar">
              <button
                type="button"
                onClick={() =>
                  handleSendMessage(
                    'Báo cáo tổng hợp doanh thu, lợi nhuận và dòng tiền của kho hiện tại'
                  )
                }
                className="shrink-0 px-3 py-1.5 rounded-full bg-slate-100 hover:bg-emerald-50 hover:text-emerald-800 text-slate-600 text-xs font-semibold border border-slate-200/80 transition cursor-pointer"
              >
                📊 Báo cáo doanh thu & lợi nhuận
              </button>
              <button
                type="button"
                onClick={() =>
                  handleSendMessage('Danh sách khách hàng đang nợ và nợ quá hạn cần thu hồi')
                }
                className="shrink-0 px-3 py-1.5 rounded-full bg-slate-100 hover:bg-emerald-50 hover:text-emerald-800 text-slate-600 text-xs font-semibold border border-slate-200/80 transition cursor-pointer"
              >
                💳 Khách hàng đang nợ
              </button>
              <button
                type="button"
                onClick={() =>
                  handleSendMessage('Kiểm tra các mặt hàng vật tư tồn kho thấp hoặc đã hết hàng')
                }
                className="shrink-0 px-3 py-1.5 rounded-full bg-slate-100 hover:bg-emerald-50 hover:text-emerald-800 text-slate-600 text-xs font-semibold border border-slate-200/80 transition cursor-pointer"
              >
                📦 Vật tư sắp hết hàng
              </button>
              <button
                type="button"
                onClick={() =>
                  handleSendMessage(
                    'Tư vấn kỹ thuật bón phân và phòng trị bệnh cho lúa và sầu riêng'
                  )
                }
                className="shrink-0 px-3 py-1.5 rounded-full bg-slate-100 hover:bg-emerald-50 hover:text-emerald-800 text-slate-600 text-xs font-semibold border border-slate-200/80 transition cursor-pointer"
              >
                🌱 Kỹ thuật nông nghiệp
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
                placeholder={`Hỏi Trợ lý A.I (VD: Báo cáo doanh thu kho ${activeWarehouseLabel}, khách hàng đang nợ, giá lúa OM18...)`}
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
    </div>
  );
};

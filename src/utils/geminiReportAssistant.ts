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
import { formatVND, getTodayVietnamDateStr } from './businessLogic';

export const DAILY_AI_QUESTION_LIMIT = 30;
export const DAILY_AI_TOKEN_LIMIT = 10000;
export const SHARED_VOLATILE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const SHARED_AI_CACHE_FOLDER = 'documents/ai_cache';
export const COMMUNITY_MARKET_PRICES_FILE = 'community_market_prices.json';

export type GeminiConcreteModelId =
  | 'gemma-4-26b-a4b-it'
  | 'gemini-3.1-flash-lite'
  | 'gemini-4-hydrogen';

export type GeminiModelOptionId = 'auto' | GeminiConcreteModelId;

export const DEFAULT_GEMINI_MODEL: GeminiModelOptionId = 'auto';

export interface GeminiModelOption {
  id: GeminiModelOptionId;
  label: string;
  badge: string;
  tier: 'auto' | 'free' | 'lite' | 'deep';
  description: string;
}

export const GEMINI_MODEL_OPTIONS: GeminiModelOption[] = [
  {
    id: 'auto',
    label: 'Tự động',
    badge: 'Mặc định',
    tier: 'auto',
    description:
      'Thích ứng thông minh · Miễn phí cho kho riêng, Flash-Lite + Google Search tiết kiệm cho tra cứu bên ngoài, Hydrogen cho phân tích sâu',
  },
  {
    id: 'gemma-4-26b-a4b-it',
    label: 'Gemma 4 26B',
    badge: 'Miễn phí',
    tier: 'free',
    description:
      'Mô hình miễn phí ưu tiên trả lời nhanh các câu hỏi nội bộ trong kho riêng của từng tài khoản',
  },
  {
    id: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash-Lite',
    badge: 'Cơ bản',
    tier: 'lite',
    description:
      'Tra cứu dữ liệu kho, tồn kho, công nợ, giá bán cơ bản & tốc độ cao (miễn phí có giới hạn)',
  },
  {
    id: 'gemini-4-hydrogen',
    label: 'Gemini 4 Hydrogen',
    badge: 'Chuyên sâu',
    tier: 'deep',
    description:
      'Tư duy chuyên sâu & tra cứu thông tin sản phẩm, thị trường, kỹ thuật nông nghiệp bên ngoài trang',
  },
];

export function getGeminiModelOptionMeta(modelId?: string): GeminiModelOption {
  return (
    GEMINI_MODEL_OPTIONS.find((opt) => opt.id === modelId) ||
    GEMINI_MODEL_OPTIONS[0]
  );
}

export interface WarehouseReportSnapshot {
  warehouseLabel: string;
  staffDisplayName: string;
  generatedAt: string;
  // Sales
  salesCount: number;
  totalSalesRevenue: number;
  totalSalesCollected: number;
  totalSalesNewDebt: number;
  estimatedCogs: number;
  estimatedGrossProfit: number;
  // Imports
  importsCount: number;
  totalImportCost: number;
  totalImportPaid: number;
  totalImportNewDebt: number;
  // Customer Debt
  customersCount: number;
  totalCustomerDebt: number;
  debtorCustomers: Array<{
    name: string;
    code: string;
    phone: string;
    group: string;
    debt: number;
    overdueAmount: number;
  }>;
  // Supplier Debt
  suppliersCount: number;
  totalSupplierDebt: number;
  creditorSuppliers: Array<{
    name: string;
    phone: string;
    debt: number;
    overdueAmount: number;
  }>;
  // Inventory
  productsCount: number;
  totalInventoryCostValue: number;
  totalInventoryRetailValue: number;
  catalogProducts: Array<{
    code: string;
    name: string;
    category: string;
    unit: string;
    stock: number;
    minStock: number;
    importPrice: number;
    sellPrice: number;
    supplierName: string;
  }>;
  outOfStockProducts: Array<{
    code: string;
    name: string;
    unit: string;
    stock: number;
    minStock: number;
    importPrice: number;
    sellPrice: number;
  }>;
  lowStockProducts: Array<{
    code: string;
    name: string;
    unit: string;
    stock: number;
    minStock: number;
    importPrice: number;
    sellPrice: number;
  }>;
  topSellingProducts: Array<{
    name: string;
    unit: string;
    quantitySold: number;
    revenue: number;
  }>;
  // Cash flow
  receiptVouchersCount: number;
  totalReceiptVouchersAmount: number;
  paymentVouchersCount: number;
  totalPaymentVouchersAmount: number;
  totalCashIn: number;
  totalCashOut: number;
  netCashFlow: number;
}

/**
 * Normalizes Vietnamese input across both precomposed (NFC), decomposed (NFD combining accents),
 * and accent-stripped ASCII so keyword matching never fails regardless of the user's IME/keyboard.
 */
export function normalizeVietnameseQuery(raw: string): { nfc: string; ascii: string } {
  const cleaned = (raw || '').trim();
  const nfc = cleaned
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ');
  const ascii = cleaned
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { nfc, ascii };
}

function hasAnyKeyword(
  query: { nfc: string; ascii: string },
  keywords: string[]
): boolean {
  for (const kw of keywords) {
    const normKw = normalizeVietnameseQuery(kw);
    if (normKw.nfc && query.nfc.includes(normKw.nfc)) {
      return true;
    }
    if (normKw.ascii && query.ascii.includes(normKw.ascii)) {
      return true;
    }
  }
  return false;
}

export type GeminiQueryScope = 'internal' | 'external';

const EXTERNAL_INDICATOR_KEYWORDS = [
  'giá phân',
  'phân bón hiện nay',
  'phân bón hôm nay',
  'thị trường phân bón',
  'giá lúa',
  'giá gạo',
  'lúa hôm nay',
  'lúa hiện nay',
  'om18',
  'om 18',
  'om5451',
  'đài thơm',
  'ir504',
  'st24',
  'st25',
  'nàng hoa',
  'giá thuốc',
  'giá sầu riêng',
  'sầu riêng hôm nay',
  'giá mít',
  'giá xoài',
  'giá cà phê',
  'giá tiêu',
  'giá ớt',
  'giá nông sản',
  'thị trường',
  'thời tiết',
  'tin tức',
  'quy định mới',
  'nghị định mới',
  'kỹ thuật',
  'cách trồng',
  'cách bón',
  'phòng trừ',
  'đạo ôn',
  'rầy nâu',
  'cháy bìa lá',
  'vàng lá',
  'thối rễ',
  'xì mủ',
  'thán thư',
  'nhện đỏ',
  'bọ trĩ',
  'làm bông',
  'đậu trái',
  'là sản phẩm gì',
  'là thuốc gì',
  'là phân gì',
  'là gì',
  'của công ty',
  'công ty thuốc',
  'công ty bvtv',
  'bảo vệ thực vật',
  'hoạt chất',
  'liều lượng',
  'liều phun',
  'cách pha',
  'công dụng',
  'hãng nào',
  'nhà sản xuất',
  'thuế hộ kinh doanh',
  'hóa đơn điện tử',
  'pháp lý',
];

const INTERNAL_GREETING_OR_HELP_KEYWORDS = [
  'xin chào',
  'chào bạn',
  'hello',
  'hi',
  'bạn là ai',
  'bạn làm được gì',
  'hướng dẫn sử dụng',
];

const INTERNAL_WAREHOUSE_KEYWORDS = [
  'kho',
  'tồn kho',
  'hết hàng',
  'sắp hết',
  'vật tư sắp hết',
  'doanh thu',
  'lợi nhuận',
  'lãi gộp',
  'giá vốn',
  'báo cáo',
  'tổng hợp',
  'công nợ',
  'khách hàng',
  'khách nợ',
  'nợ quá hạn',
  'nhắc nợ',
  'phải thu',
  'phải trả',
  'nhà cung cấp',
  'ncc',
  'phiếu thu',
  'phiếu chi',
  'dòng tiền',
  'sổ quỹ',
  'quỹ tiền',
  'hóa đơn',
  'đơn bán',
  'nhập kho',
  'nhập hàng',
  'bán chạy',
  'top mặt hàng',
  'giá nhập',
  'danh mục vật tư',
  'thống kê kho',
  'tình hình kho',
  'tâm an',
];

export function classifyWarehouseQueryScope(
  rawQuery: string,
  snapshot?: WarehouseReportSnapshot
): GeminiQueryScope {
  const q = normalizeVietnameseQuery(rawQuery);
  if (!q.ascii) {
    return 'internal';
  }

  // Short greetings or help requests run on free internal tier
  if (
    rawQuery.trim().length <= 45 &&
    hasAnyKeyword(q, INTERNAL_GREETING_OR_HELP_KEYWORDS) &&
    !hasAnyKeyword(q, EXTERNAL_INDICATOR_KEYWORDS)
  ) {
    return 'internal';
  }

  const hasExternalSignal = hasAnyKeyword(q, EXTERNAL_INDICATOR_KEYWORDS);
  const hasInternalSignal = hasAnyKeyword(q, INTERNAL_WAREHOUSE_KEYWORDS);

  // Check if the query specifically asks about a product/customer stored in this account's warehouse
  let matchesSnapshotEntity = false;
  if (snapshot) {
    const mentionsCatalogProduct = snapshot.catalogProducts.some((p) => {
      const pName = normalizeVietnameseQuery(p.name);
      const pCode = normalizeVietnameseQuery(p.code);
      return (
        (pCode.ascii.length >= 3 && q.ascii.includes(pCode.ascii)) ||
        (pName.ascii.length >= 4 && q.ascii.includes(pName.ascii))
      );
    });
    const mentionsCustomer = snapshot.debtorCustomers.some((c) => {
      const cName = normalizeVietnameseQuery(c.name);
      return cName.ascii.length >= 4 && q.ascii.includes(cName.ascii);
    });
    matchesSnapshotEntity =
      (mentionsCatalogProduct || mentionsCustomer) &&
      hasAnyKeyword(q, ['tồn', 'còn', 'giá bán', 'giá nhập', 'nợ', 'kho', 'bao nhiêu']);
  }

  if (matchesSnapshotEntity && !hasExternalSignal) {
    return 'internal';
  }

  if (hasExternalSignal) {
    // Only keep internal if user is explicitly asking about internal warehouse report (e.g. "báo cáo tổng hợp doanh thu của kho")
    if (
      hasAnyKeyword(q, [
        'báo cáo tổng hợp',
        'doanh thu của kho',
        'dòng tiền của kho',
        'khách hàng đang nợ',
        'tồn kho thấp',
        'vật tư sắp hết',
      ])
    ) {
      return 'internal';
    }
    return 'external';
  }

  if (hasInternalSignal) {
    return 'internal';
  }

  // Open questions outside known warehouse keywords (e.g. "sản phẩm Sen Bay của công ty BVTV GAP là sản phẩm gì?")
  // require external knowledge + deep reasoning
  return 'external';
}

export function isPureInternalWarehouseQuery(rawQuery: string): boolean {
  return classifyWarehouseQueryScope(rawQuery) === 'internal';
}

/**
 * Rule 3 (Selective External Web Search):
 * Enable external web search when the query is external AND requires up-to-date market info,
 * news, weather, regulations, or specific product/company lookup (e.g. "Sen Bay của công ty BVTV GAP").
 * Purely general agronomy tips without specific product/company or live price indicators skip web search
 * while still using Gemini 4 Hydrogen deep reasoning to save search grounding quota.
 */
export function shouldEnableExternalWebSearch(rawQuery: string): boolean {
  const scope = classifyWarehouseQueryScope(rawQuery);
  if (scope === 'internal') {
    return false;
  }

  const q = normalizeVietnameseQuery(rawQuery);
  const freshOrLookupKeywords = [
    'giá phân',
    'phân bón hiện nay',
    'phân bón hôm nay',
    'giá đạm',
    'giá urê',
    'giá ure',
    'giá dap',
    'giá kali',
    'giá npk',
    'giá lúa',
    'giá gạo',
    'lúa hôm nay',
    'lúa hiện nay',
    'om18',
    'om 18',
    'đài thơm',
    'ir504',
    'om5451',
    'st24',
    'st25',
    'nàng hoa',
    'giá thuốc',
    'giá sầu riêng',
    'sầu riêng hôm nay',
    'giá mít',
    'giá xoài',
    'giá cà phê',
    'giá tiêu',
    'giá ớt',
    'giá nông sản',
    'thị trường hôm nay',
    'thị trường hiện nay',
    'thời tiết',
    'tin tức',
    'quy định mới',
    'nghị định mới',
    'mới nhất',
    'là sản phẩm gì',
    'là thuốc gì',
    'là phân gì',
    'là gì',
    'của công ty',
    'công ty thuốc',
    'công ty bvtv',
    'bảo vệ thực vật',
    'hoạt chất',
    'thành phần',
    'công dụng',
    'cách dùng',
    'liều lượng',
    'hãng nào',
    'nhà sản xuất',
  ];

  if (hasAnyKeyword(q, freshOrLookupKeywords)) {
    return true;
  }

  // General agronomy/tax advice without specific brand/price lookup doesn't need web search
  const generalAgronomyWithoutPrice = hasAnyKeyword(q, [
    'kỹ thuật',
    'cách trồng',
    'cách bón',
    'bón phân',
    'chăm sóc',
    'phòng trừ',
    'phòng trị',
    'đạo ôn',
    'rầy nâu',
    'cháy bìa lá',
    'vàng lá',
    'thối rễ',
    'xì mủ',
    'thán thư',
    'nhện đỏ',
    'bọ trĩ',
    'làm bông',
    'đậu trái',
  ]);
  if (generalAgronomyWithoutPrice) {
    return false;
  }

  // Any other open external question gets live search grounding
  return true;
}

/**
 * Rule 1 & Rule 2 (3-Tier Cost-Optimized Auto-Routing & Verified Grounding):
 * - Tier 1 (Internal warehouse queries) -> 'gemma-4-26b-a4b-it' (Free) with MINIMAL thinking.
 * - Tier 2 (External product/company/market lookup) -> 'gemini-3.1-flash-lite' + Google Search
 *   (~70-80% fewer tokens than Hydrogen, with automatic fallback to 'gemini-4-hydrogen' + Search).
 *   Sets requireVerifiedSearch: true so unverified guesses without Search grounding are rejected.
 * - Tier 3 (Complex forecasting/reconciliation or deep agronomy) -> 'gemini-4-hydrogen'.
 */
export interface GeminiCostRoutingDecision {
  selectedOption: GeminiModelOptionId;
  targetModel: GeminiConcreteModelId;
  fallbackModels: GeminiConcreteModelId[];
  queryScope: GeminiQueryScope;
  isComplexQuery: boolean;
  thinkingLevel: 'MINIMAL' | 'LOW' | 'MEDIUM';
  maxOutputTokens: number;
  enableExternalSearch: boolean;
  requireVerifiedSearch: boolean;
  routingReason: string;
}

export function classifyQueryRoutingAndCostConfig(
  rawQuery: string,
  userSelectedModel: GeminiModelOptionId = DEFAULT_GEMINI_MODEL,
  snapshot?: WarehouseReportSnapshot
): GeminiCostRoutingDecision {
  const q = normalizeVietnameseQuery(rawQuery);
  const queryScope = classifyWarehouseQueryScope(rawQuery, snapshot);

  const complexKeywords = [
    'đối soát phức tạp',
    'phân tích chuyên sâu',
    'phân tích sâu',
    'dự báo',
    'chiến lược kinh doanh',
    'hoạch định',
    'quyết toán thuế',
    'báo cáo tài chính năm',
    'so sánh đa kỳ',
    'tối ưu dòng tiền dài hạn',
  ];
  const isComplexQuery =
    hasAnyKeyword(q, complexKeywords) || rawQuery.trim().length > 280;

  const enableExternalSearch = shouldEnableExternalWebSearch(rawQuery);
  const selectedOption: GeminiModelOptionId = userSelectedModel || DEFAULT_GEMINI_MODEL;

  if (selectedOption === 'auto') {
    if (queryScope === 'internal' && !isComplexQuery) {
      return {
        selectedOption,
        targetModel: 'gemma-4-26b-a4b-it',
        fallbackModels: [
          'gemma-4-26b-a4b-it',
          'gemini-3.1-flash-lite',
          'gemini-4-hydrogen',
        ],
        queryScope,
        isComplexQuery,
        thinkingLevel: 'MINIMAL',
        maxOutputTokens: 1200,
        enableExternalSearch: false,
        requireVerifiedSearch: false,
        routingReason: 'Ưu tiên mô hình miễn phí cho câu hỏi nội bộ kho riêng',
      };
    }

    if (queryScope === 'external' && enableExternalSearch && !isComplexQuery) {
      return {
        selectedOption,
        targetModel: 'gemini-3.1-flash-lite',
        fallbackModels: ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'],
        queryScope,
        isComplexQuery,
        thinkingLevel: 'MINIMAL',
        maxOutputTokens: 1400,
        enableExternalSearch: true,
        requireVerifiedSearch: true,
        routingReason:
          'Tra cứu bên ngoài bằng Flash-Lite + Google Search (tiết kiệm token, xác thực nguồn)',
      };
    }

    if (queryScope === 'internal' && isComplexQuery) {
      return {
        selectedOption,
        targetModel: 'gemini-4-hydrogen',
        fallbackModels: [
          'gemini-4-hydrogen',
          'gemini-3.1-flash-lite',
          'gemma-4-26b-a4b-it',
        ],
        queryScope,
        isComplexQuery,
        thinkingLevel: 'LOW',
        maxOutputTokens: 2048,
        enableExternalSearch: false,
        requireVerifiedSearch: false,
        routingReason: 'Phân tích/dự báo chuyên sâu dữ liệu kho',
      };
    }

    return {
      selectedOption,
      targetModel: 'gemini-4-hydrogen',
      fallbackModels: ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'],
      queryScope,
      isComplexQuery,
      thinkingLevel: isComplexQuery ? 'MEDIUM' : 'LOW',
      maxOutputTokens: isComplexQuery ? 2800 : 2048,
      enableExternalSearch,
      requireVerifiedSearch: enableExternalSearch,
      routingReason:
        'Câu hỏi chuyên sâu bên ngoài — bật Gemini 4 Hydrogen tư duy sâu',
    };
  }

  if (selectedOption === 'gemma-4-26b-a4b-it') {
    if (enableExternalSearch) {
      // Safety guard: Gemma 4 does not support Google Search Grounding; escalate safely
      // to Flash-Lite + Google Search so pesticide/product facts are never guessed.
      return {
        selectedOption,
        targetModel: 'gemini-3.1-flash-lite',
        fallbackModels: ['gemini-3.1-flash-lite', 'gemini-4-hydrogen'],
        queryScope,
        isComplexQuery,
        thinkingLevel: 'MINIMAL',
        maxOutputTokens: 1400,
        enableExternalSearch: true,
        requireVerifiedSearch: true,
        routingReason:
          'Tự động chuyển sang Flash-Lite + Google Search để xác thực sản phẩm bên ngoài',
      };
    }

    return {
      selectedOption,
      targetModel: 'gemma-4-26b-a4b-it',
      fallbackModels: [
        'gemma-4-26b-a4b-it',
        'gemini-3.1-flash-lite',
        'gemini-4-hydrogen',
      ],
      queryScope,
      isComplexQuery,
      thinkingLevel: 'MINIMAL',
      maxOutputTokens: 1200,
      enableExternalSearch: false,
      requireVerifiedSearch: false,
      routingReason: 'Mô hình miễn phí (thủ công)',
    };
  }

  if (selectedOption === 'gemini-3.1-flash-lite') {
    return {
      selectedOption,
      targetModel: 'gemini-3.1-flash-lite',
      fallbackModels: enableExternalSearch
        ? ['gemini-3.1-flash-lite', 'gemini-4-hydrogen']
        : ['gemini-3.1-flash-lite', 'gemma-4-26b-a4b-it', 'gemini-4-hydrogen'],
      queryScope,
      isComplexQuery,
      thinkingLevel: 'MINIMAL',
      maxOutputTokens: 1400,
      enableExternalSearch,
      requireVerifiedSearch: enableExternalSearch,
      routingReason: 'Gemini 3.1 Flash-Lite cơ bản (thủ công)',
    };
  }

  return {
    selectedOption,
    targetModel: 'gemini-4-hydrogen',
    fallbackModels: ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'],
    queryScope,
    isComplexQuery,
    thinkingLevel: isComplexQuery ? 'MEDIUM' : 'LOW',
    maxOutputTokens: isComplexQuery ? 2800 : 2048,
    enableExternalSearch,
    requireVerifiedSearch: enableExternalSearch,
    routingReason: 'Gemini 4 Hydrogen chuyên sâu (thủ công)',
  };
}

/**
 * Rule 3 (Result Caching for Popular External & Internal Queries):
 * 6-hour cache TTL so repeated questions about market prices or unchanged warehouse reports
 * are served immediately from cache without burning extra API or search grounding calls.
 */
export const GEMINI_QUERY_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export function buildGeminiQueryCacheKey(
  rawQuery: string,
  snapshot: WarehouseReportSnapshot,
  modelId: GeminiModelOptionId = DEFAULT_GEMINI_MODEL
): string {
  const norm = normalizeVietnameseQuery(rawQuery).nfc;
  const isInternal = isPureInternalWarehouseQuery(rawQuery);
  if (isInternal) {
    const whSig = `${snapshot.warehouseLabel}_${snapshot.salesCount}_${snapshot.totalSalesRevenue}_${snapshot.totalCustomerDebt}_${snapshot.totalSupplierDebt}_${snapshot.productsCount}_${snapshot.totalCashIn}_${snapshot.totalCashOut}`;
    return `vtnn_ai_cache_int_${modelId}_${whSig}_${norm}`;
  }
  // External market/agronomy queries share a date-bucketed cache key (valid for 6 hours)
  const dayBucket = snapshot.generatedAt || new Date().toISOString().slice(0, 10);
  return `vtnn_ai_cache_ext_${modelId}_${dayBucket}_${norm}`;
}

export function buildWarehouseReportSnapshot(params: {
  warehouseLabel: string;
  currentStaff?: StaffMember | null;
  products: ProductItem[];
  customers: CustomerProfile[];
  suppliers: SupplierProfile[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  receiptVouchers: CashReceiptVoucher[];
  paymentVouchers: CashPaymentVoucher[];
}): WarehouseReportSnapshot {
  const {
    warehouseLabel,
    currentStaff,
    products,
    customers,
    suppliers,
    sales,
    imports,
    receiptVouchers,
    paymentVouchers,
  } = params;

  const todayIso = new Date().toISOString().slice(0, 10);

  const productById = new Map<string, ProductItem>();
  for (const p of products) {
    productById.set(p.id, p);
  }

  let totalSalesRevenue = 0;
  let totalSalesCollected = 0;
  let totalSalesNewDebt = 0;
  let estimatedCogs = 0;

  const productSalesMap = new Map<
    string,
    { name: string; unit: string; quantitySold: number; revenue: number }
  >();

  for (const s of sales) {
    const rev = Number(s.totalAmount) || 0;
    const paid = Number(s.paidAmount) || 0;
    const debt = Number(s.debtAmount) || 0;
    totalSalesRevenue += rev;
    totalSalesCollected += paid;
    totalSalesNewDebt += debt;

    const prod = productById.get(s.productId);
    const unitImportCost = prod ? Number(prod.importPrice) || 0 : (Number(s.unitPrice) || 0) * 0.8;
    const giftCost = (Number(s.giftQuantity) || 0) * (Number(s.giftUnitCost) || 0);
    estimatedCogs += (Number(s.quantity) || 0) * unitImportCost + giftCost;

    const existing = productSalesMap.get(s.productName) || {
      name: s.productName,
      unit: s.unit || 'Đơn vị',
      quantitySold: 0,
      revenue: 0,
    };
    existing.quantitySold += Number(s.quantity) || 0;
    existing.revenue += rev;
    productSalesMap.set(s.productName, existing);
  }

  const estimatedGrossProfit = totalSalesRevenue - estimatedCogs;

  let totalImportCost = 0;
  let totalImportPaid = 0;
  let totalImportNewDebt = 0;

  const supplierDebtMap = new Map<
    string,
    { name: string; phone: string; debt: number; overdueAmount: number }
  >();

  for (const imp of imports) {
    const cost = Number(imp.totalCost) || 0;
    const paid = Number(imp.paidAmount) || 0;
    const debt = Number(imp.debtAmount) || 0;
    totalImportCost += cost;
    totalImportPaid += paid;
    totalImportNewDebt += debt;

    if (debt > 0) {
      const key = imp.supplierName.trim();
      const current = supplierDebtMap.get(key) || {
        name: imp.supplierName,
        phone: imp.supplierPhone || '',
        debt: 0,
        overdueAmount: 0,
      };
      current.debt += debt;
      if (imp.dueDate && imp.dueDate < todayIso) {
        current.overdueAmount += debt;
      }
      supplierDebtMap.set(key, current);
    }
  }

  // Overdue customer debt calculation from unpaid sales
  const customerOverdueMap = new Map<string, number>();
  for (const s of sales) {
    const debt = Number(s.debtAmount) || 0;
    if (debt > 0 && s.dueDate && s.dueDate < todayIso) {
      const prev = customerOverdueMap.get(s.customerId) || 0;
      customerOverdueMap.set(s.customerId, prev + debt);
    }
  }

  let totalCustomerDebt = 0;
  const debtorCustomers: WarehouseReportSnapshot['debtorCustomers'] = [];
  for (const c of customers) {
    const debt = Number(c.totalDebt) || 0;
    if (debt > 0) {
      totalCustomerDebt += debt;
      debtorCustomers.push({
        name: c.name,
        code: c.code,
        phone: c.phone || '---',
        group: c.group || 'Nhà nông',
        debt,
        overdueAmount: Math.min(debt, customerOverdueMap.get(c.id) || 0),
      });
    }
  }
  debtorCustomers.sort((a, b) => b.debt - a.debt);

  const creditorSuppliers = Array.from(supplierDebtMap.values()).sort(
    (a, b) => b.debt - a.debt
  );
  const totalSupplierDebt = creditorSuppliers.reduce((sum, s) => sum + s.debt, 0);

  let totalInventoryCostValue = 0;
  let totalInventoryRetailValue = 0;
  const catalogProducts: WarehouseReportSnapshot['catalogProducts'] = [];
  const outOfStockProducts: WarehouseReportSnapshot['outOfStockProducts'] = [];
  const lowStockProducts: WarehouseReportSnapshot['lowStockProducts'] = [];

  for (const p of products) {
    const stock = Number(p.stock) || 0;
    const minStock = Number(p.minStock) || 0;
    const importPrice = Number(p.importPrice) || 0;
    const sellPrice = Number(p.sellPrice) || 0;

    catalogProducts.push({
      code: p.code,
      name: p.name,
      category: p.category || 'Vật tư',
      unit: p.unit || 'Bao',
      stock,
      minStock,
      importPrice,
      sellPrice,
      supplierName: p.supplierName || '',
    });

    if (stock > 0) {
      totalInventoryCostValue += stock * importPrice;
      totalInventoryRetailValue += stock * sellPrice;
    }

    if (stock <= 0) {
      outOfStockProducts.push({
        code: p.code,
        name: p.name,
        unit: p.unit,
        stock,
        minStock,
        importPrice,
        sellPrice,
      });
    } else if (stock <= minStock) {
      lowStockProducts.push({
        code: p.code,
        name: p.name,
        unit: p.unit,
        stock,
        minStock,
        importPrice,
        sellPrice,
      });
    }
  }

  const topSellingProducts = Array.from(productSalesMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  const totalReceiptVouchersAmount = receiptVouchers.reduce(
    (sum, r) => sum + (Number(r.amount) || 0),
    0
  );
  const totalPaymentVouchersAmount = paymentVouchers.reduce(
    (sum, p) => sum + (Number(p.amount) || 0),
    0
  );

  // Total cash in = direct cash collected on sales + standalone receipt vouchers
  const totalCashIn = totalSalesCollected + totalReceiptVouchersAmount;
  const totalCashOut = totalImportPaid + totalPaymentVouchersAmount;
  const netCashFlow = totalCashIn - totalCashOut;

  return {
    warehouseLabel: warehouseLabel || 'Kho VTNN Tâm An',
    staffDisplayName: currentStaff?.displayName || 'Người dùng',
    generatedAt: todayIso,
    salesCount: sales.length,
    totalSalesRevenue,
    totalSalesCollected,
    totalSalesNewDebt,
    estimatedCogs,
    estimatedGrossProfit,
    importsCount: imports.length,
    totalImportCost,
    totalImportPaid,
    totalImportNewDebt,
    customersCount: customers.length,
    totalCustomerDebt,
    debtorCustomers,
    suppliersCount: suppliers.length,
    totalSupplierDebt,
    creditorSuppliers,
    productsCount: products.length,
    totalInventoryCostValue,
    totalInventoryRetailValue,
    catalogProducts,
    outOfStockProducts,
    lowStockProducts,
    topSellingProducts,
    receiptVouchersCount: receiptVouchers.length,
    totalReceiptVouchersAmount,
    paymentVouchersCount: paymentVouchers.length,
    totalPaymentVouchersAmount,
    totalCashIn,
    totalCashOut,
    netCashFlow,
  };
}

export const AGRICULTURAL_MARKET_BENCHMARK_CONTEXT = `=== DỮ LIỆU THAM CHIẾU THỊ TRƯỜNG NÔNG NGHIỆP & VẬT TƯ ĐBSCL (CẬP NHẬT 2026) ===
1. GIÁ PHÂN BÓN BÁN LẺ THAM KHẢO (BAO 50KG TẠI ĐBSCL & VIỆT NAM):
   - Đạm Urê Phú Mỹ: 570.000 – 620.000 đ/bao 50kg
   - Đạm Urê Cà Mau (hạt đục): 585.000 – 640.000 đ/bao 50kg
   - Đạm Urê Ninh Bình / Hà Bắc: 545.000 – 590.000 đ/bao 50kg
   - DAP Đình Vũ (nội địa): 830.000 – 890.000 đ/bao 50kg
   - DAP Hồng Hà / Lào Cai: 980.000 – 1.120.000 đ/bao 50kg
   - DAP Xanh 64% nhập khẩu: 1.150.000 – 1.260.000 đ/bao 50kg
   - Kali Miểng (Phú Mỹ / Israel / Canada): 600.000 – 670.000 đ/bao 50kg
   - Kali Bột (Phú Mỹ / Belarus / Nga): 550.000 – 615.000 đ/bao 50kg
   - NPK 20-20-15+TE Đầu Trâu Bình Điền: 780.000 – 870.000 đ/bao 50kg
   - NPK 20-20-15 Phú Mỹ / Cà Mau: 730.000 – 815.000 đ/bao 50kg
   - NPK 16-16-8+TE (Việt Nhật / Phú Mỹ / Bình Điền): 650.000 – 735.000 đ/bao 50kg
   - Super Lân Lâm Thao / Long Thành: 235.000 – 280.000 đ/bao 50kg
   - Phân hữu cơ vi sinh / Gà nở nhập khẩu: 185.000 – 320.000 đ/bao (25–50kg)
   - Xu hướng: Nhóm Urê, Kali và NPK nguồn cung dồi dào, giá ổn định; nhóm DAP nhập khẩu neo cao.

2. GIÁ LÚA GẠO THU MUA TẠI ĐBSCL (LÚA TƯƠI TẠI RUỘNG / LÚA KHÔ TẠI KHO):
   - Lúa OM 18: Tươi 6.600 – 7.200 đ/kg | Khô 7.900 – 8.500 đ/kg
   - Lúa Đài Thơm 8: Tươi 6.600 – 7.200 đ/kg | Khô 7.900 – 8.500 đ/kg
   - Lúa OM 5451: Tươi 6.000 – 6.400 đ/kg | Khô 7.300 – 7.700 đ/kg
   - Lúa IR 50404: Tươi 5.600 – 6.000 đ/kg | Khô 6.900 – 7.300 đ/kg
   - Lúa OM 380: Tươi 5.600 – 5.900 đ/kg
   - Lúa Nàng Hoa 9: Tươi 6.600 – 7.000 đ/kg
   - Lúa ST24 / ST25: Tươi 8.400 – 9.600 đ/kg | Khô đặc sản 10.500 – 12.000 đ/kg

3. GIÁ THUỐC BẢO VỆ THỰC VẬT (BVTV) PHỔ BIẾN:
   - Amistar Top 325SC (250ml): 245.000 – 275.000 đ/chai
   - Filia 525SE (250ml): 165.000 – 190.000 đ/chai
   - Nativo 750WG (60g): 145.000 – 168.000 đ/gói
   - Antracol 70WP (500g): 140.000 – 165.000 đ/gói
   - Ridomil Gold 68WG (100g): 62.000 – 75.000 đ/gói
   - Prevathon 5SC (250ml): 195.000 – 230.000 đ/chai
   - Virtako 40WG (15g): 75.000 – 88.000 đ/gói
   - Chess 50WG (15g): 28.000 – 35.000 đ/gói
   - Thuốc cỏ Glufosinate 200SL (900ml–1L): 105.000 – 145.000 đ/chai

4. GIÁ NÔNG SẢN & TRÁI CÂY CHỦ LỰC:
   - Sầu riêng Thái Monthong: Loại A 95.000 – 125.000 đ/kg (vụ nghịch 140.000 – 175.000 đ/kg), Loại B 75.000 – 95.000 đ/kg
   - Sầu riêng Ri6: Loại A 65.000 – 88.000 đ/kg (vụ nghịch 105.000 – 130.000 đ/kg), Loại B 50.000 – 68.000 đ/kg
   - Xoài Cát Hòa Lộc: 45.000 – 65.000 đ/kg | Xoài Cát Chu: 18.000 – 28.000 đ/kg | Xoài Đài Loan: 15.000 – 26.000 đ/kg
   - Mít Thái: 18.000 – 32.000 đ/kg | Cà phê nhân xô: 110.000 – 125.000 đ/kg | Hồ tiêu đen: 140.000 – 158.000 đ/kg
==============================================================================`;

export type GeminiSystemInstructionMode = 'internal' | 'external' | 'both';

export function buildGeminiSystemInstruction(
  snapshot: WarehouseReportSnapshot,
  mode: GeminiSystemInstructionMode = 'both'
): string {
  const debtorsSummary =
    snapshot.debtorCustomers.length === 0
      ? 'Không có khách hàng nào đang nợ.'
      : snapshot.debtorCustomers
          .slice(0, 15)
          .map(
            (c, idx) =>
              `${idx + 1}. ${c.name} (${c.code} - SĐT: ${c.phone} - Nhóm: ${c.group}): Đang nợ ${formatVND(
                c.debt
              )}${c.overdueAmount > 0 ? ` (Quá hạn: ${formatVND(c.overdueAmount)})` : ''}`
          )
          .join('\n');

  const creditorsSummary =
    snapshot.creditorSuppliers.length === 0
      ? 'Không có khoản nợ nhà cung cấp nào.'
      : snapshot.creditorSuppliers
          .slice(0, 15)
          .map(
            (s, idx) =>
              `${idx + 1}. ${s.name} (SĐT: ${s.phone || '---'}): Phải trả ${formatVND(s.debt)}${
                s.overdueAmount > 0 ? ` (Quá hạn: ${formatVND(s.overdueAmount)})` : ''
              }`
          )
          .join('\n');

  const stockAlertsSummary =
    snapshot.outOfStockProducts.length === 0 && snapshot.lowStockProducts.length === 0
      ? 'Tất cả mặt hàng vật tư đều đảm bảo định mức tồn kho an toàn.'
      : [
          ...snapshot.outOfStockProducts.map(
            (p) =>
              `- [HẾT HÀNG] ${p.name} (${p.code}): Tồn ${p.stock} ${p.unit} (Định mức tối thiểu: ${p.minStock} ${p.unit}, Giá nhập: ${formatVND(
                p.importPrice
              )}, Giá bán: ${formatVND(p.sellPrice)})`
          ),
          ...snapshot.lowStockProducts.map(
            (p) =>
              `- [SẮP HẾT] ${p.name} (${p.code}): Tồn ${p.stock} ${p.unit} (Định mức tối thiểu: ${p.minStock} ${p.unit}, Giá nhập: ${formatVND(
                p.importPrice
              )}, Giá bán: ${formatVND(p.sellPrice)})`
          ),
        ]
          .slice(0, 20)
          .join('\n');

  const catalogSummary =
    snapshot.catalogProducts.length === 0
      ? 'Kho chưa có mặt hàng nào trong danh mục.'
      : snapshot.catalogProducts
          .slice(0, 35)
          .map(
            (p, idx) =>
              `${idx + 1}. ${p.name} (${p.code} · ${p.category}): Tồn ${p.stock} ${p.unit} · Giá nhập ${formatVND(
                p.importPrice
              )} · Giá bán lẻ ${formatVND(p.sellPrice)}`
          )
          .join('\n');

  const topProductsSummary =
    snapshot.topSellingProducts.length === 0
      ? 'Chưa phát sinh đơn bán hàng.'
      : snapshot.topSellingProducts
          .map(
            (p, idx) =>
              `${idx + 1}. ${p.name}: Đã bán ${p.quantitySold} ${p.unit} — Doanh thu ${formatVND(
                p.revenue
              )}`
          )
          .join('\n');

  const internalWarehouseBlock = `=== SỐ LIỆU BÁO CÁO THỜI GIAN THỰC CỦA KHO: ${snapshot.warehouseLabel} ===
1. TỔNG QUAN DOANH THU & LỢI NHUẬN:
   - Tổng số hóa đơn bán hàng: ${snapshot.salesCount} hóa đơn
   - Tổng doanh thu bán hàng: ${formatVND(snapshot.totalSalesRevenue)}
   - Đã thu trực tiếp khi bán: ${formatVND(snapshot.totalSalesCollected)}
   - Giá vốn hàng bán ước tính (COGS): ${formatVND(snapshot.estimatedCogs)}
   - Lợi nhuận gộp ước tính: ${formatVND(snapshot.estimatedGrossProfit)}

2. TỔNG QUAN NHẬP KHO VẬT TƯ:
   - Tổng số phiếu nhập kho: ${snapshot.importsCount} phiếu
   - Tổng giá trị nhập kho: ${formatVND(snapshot.totalImportCost)}
   - Đã thanh toán khi nhập: ${formatVND(snapshot.totalImportPaid)}

3. CÔNG NỢ PHẢI THU KHÁCH HÀNG (Tổng hồ sơ: ${snapshot.customersCount} khách hàng):
   - Tổng dư nợ khách hàng hiện tại: ${formatVND(snapshot.totalCustomerDebt)} (${snapshot.debtorCustomers.length} khách hàng đang nợ)
   - Chi tiết khách hàng đang nợ:
${debtorsSummary}

4. CÔNG NỢ PHẢI TRẢ NHÀ CUNG CẤP (Tổng danh bạ: ${snapshot.suppliersCount} NCC):
   - Tổng nợ phải trả nhà cung cấp: ${formatVND(snapshot.totalSupplierDebt)} (${snapshot.creditorSuppliers.length} NCC đang nợ)
   - Chi tiết nhà cung cấp đang nợ:
${creditorsSummary}

5. TỒN KHO VẬT TƯ NÔNG NGHIỆP (Tổng danh mục: ${snapshot.productsCount} mặt hàng):
   - Tổng giá trị tồn kho theo giá vốn: ${formatVND(snapshot.totalInventoryCostValue)}
   - Tổng giá trị tồn kho theo giá bán lẻ: ${formatVND(snapshot.totalInventoryRetailValue)}
   - Số mặt hàng hết hàng (tồn <= 0): ${snapshot.outOfStockProducts.length} mặt hàng
   - Số mặt hàng tồn kho thấp (tồn <= định mức): ${snapshot.lowStockProducts.length} mặt hàng
   - Chi tiết cảnh báo tồn kho:
${stockAlertsSummary}
   - Bảng giá & tồn kho danh mục vật tư hiện có tại kho:
${catalogSummary}

6. TOP MẶT HÀNG BÁN CHẠY:
${topProductsSummary}

7. DÒNG TIỀN & QUỸ THU - CHI:
   - Phiếu thu tiền mặt/chuyển khoản (${snapshot.receiptVouchersCount} phiếu): ${formatVND(snapshot.totalReceiptVouchersAmount)}
   - Phiếu chi tiền mặt/chuyển khoản (${snapshot.paymentVouchersCount} phiếu): ${formatVND(snapshot.totalPaymentVouchersAmount)}
   - Tổng dòng tiền thu vào (Bán thu ngay + Phiếu thu): ${formatVND(snapshot.totalCashIn)}
   - Tổng dòng tiền chi ra (Nhập trả ngay + Phiếu chi): ${formatVND(snapshot.totalCashOut)}
   - Cân đối dòng tiền thuần (Thu - Chi): ${formatVND(snapshot.netCashFlow)}
===================================================================`;

  if (mode === 'internal') {
    return `Bạn là **Trợ lý A.I — VTNN Tâm An**, trợ lý nội bộ kết nối trực tiếp với kho riêng **${snapshot.warehouseLabel}** (Tài khoản: **${snapshot.staffDisplayName}**, Ngày dữ liệu: **${snapshot.generatedAt}**).

NHIỆM VỤ CỦA BẠN:
- Chỉ trả lời chính xác tuyệt đối theo số liệu thực tế của kho **${snapshot.warehouseLabel}** bên dưới (tồn kho, doanh thu, lợi nhuận, công nợ khách hàng, nợ nhà cung cấp, dòng tiền thu-chi).
- Không tự suy diễn số liệu ngoài kho khi đang trả lời báo cáo nội bộ; nếu mục nào bằng 0 thì ghi nhận đúng là 0 đ.
- Trả lời thẳng vào câu hỏi bằng tiếng Việt rõ ràng, súc tích, dùng Markdown (in đậm số tiền và danh sách gạch đầu dòng).

${internalWarehouseBlock}

QUY TẮC BẢO MẬT:
- Tuyệt đối chỉ sử dụng dữ liệu của kho riêng **${snapshot.warehouseLabel}**, đảm bảo tính độc lập dữ liệu của từng tài khoản.`;
  }

  if (mode === 'external') {
    return `Bạn là **Trợ lý A.I — VTNN Tâm An** (Ngày: **${snapshot.generatedAt}**).

QUY TẮC BẮT BUỘC KHI TRA CỨU SẢN PHẨM BVTV / PHÂN BÓN / KỸ THUẬT / THÔNG TIN BÊN NGOÀI:
- BẮT BUỘC dùng công cụ Google Search để kiểm chứng tên sản phẩm, công ty, phân loại chính xác (thuốc trừ bệnh hay trừ sâu/trừ cỏ), hoạt chất và hướng dẫn sử dụng thực tế trước khi trả lời.
- TUYỆT ĐỐI KHÔNG tự đoán hoặc bịa nhóm hoạt chất (như Neonicotinoid, Pyrethroid, Avermectin...) nếu kết quả tìm kiếm không xác nhận. Nếu tìm kiếm không có thông tin chắc chắn, phải nói rõ là chưa tìm thấy nguồn chính thức và đề nghị xem nhãn chai hoặc bấm nút "Kiểm chứng trên Google Chế độ AI".
- Không đổ ra số liệu nội bộ riêng của từng cửa hàng/kho và không từ chối trả lời khi sản phẩm chưa có trong kho.
- Trả lời ngắn gọn, súc tích, chính xác bằng tiếng Việt (Markdown).`;
  }

  return `Bạn là **Trợ lý A.I — VTNN Tâm An**, trợ lý trí tuệ nhân tạo tích hợp trực tiếp trong hệ thống Quản lý Bán hàng, Kho & Công nợ Vật tư Nông nghiệp Tâm An.

NHIỆM VỤ KÉP CỦA BẠN (PHÂN BIỆT RÕ CÂU HỎI NỘI BỘ KHO VÀ CÂU HỎI THỊ TRƯỜNG / NÔNG NGHIỆP BÊN NGOÀI):
1. **Khi người dùng hỏi thông tin thị trường, giá cả nông nghiệp bên ngoài hoặc kỹ thuật canh tác** (Ví dụ: "giá phân bón hiện nay thế nào", "giá lúa OM18 hôm nay", "sản phẩm Sen Bay của công ty BVTV GAP là gì?", "kỹ thuật bón phân, trị bệnh đạo ôn, rầy nâu, vàng lá thối rễ", thời tiết, thuế hộ kinh doanh):
   - Trả lời **TRỰC TIẾP, CHÍNH XÁC VÀ CHI TIẾT** vào đúng chủ đề người dùng hỏi.
   - **TUYỆT ĐỐI KHÔNG** nói rằng bạn không có số liệu hoặc trả lời bằng Báo cáo Tổng hợp Doanh thu 0đ của kho khi người dùng đang hỏi sản phẩm/thị trường bên ngoài!
2. **Khi người dùng hỏi về Báo cáo & Số liệu Nội bộ của Kho (Trong ứng dụng)** (Ví dụ: hỏi doanh thu kho, lợi nhuận kho, danh sách khách hàng đang nợ, nợ nhà cung cấp, kiểm tra tồn kho nội bộ, dòng tiền thu-chi):
   - Bạn được kết nối trực tiếp với số liệu thời gian thực của kho **${snapshot.warehouseLabel}** (Người dùng: **${snapshot.staffDisplayName}**, Ngày dữ liệu: **${snapshot.generatedAt}**).
   - Hãy trả lời chính xác tuyệt đối theo số liệu thực tế của kho bên dưới.

${AGRICULTURAL_MARKET_BENCHMARK_CONTEXT}

${internalWarehouseBlock}

QUY TẮC TRÌNH BÀY:
- Trả lời bằng tiếng Việt rõ ràng, chuyên nghiệp, sử dụng định dạng Markdown (in đậm số tiền quan trọng, dùng danh sách gạch đầu dòng để dễ đọc).
- Tuyệt đối chỉ sử dụng dữ liệu của kho **${snapshot.warehouseLabel}** khi báo cáo nội bộ, đảm bảo tính bảo mật và độc lập dữ liệu của kho.`;
}

export function buildGoogleAiModeUrl(query: string): string {
  const cleanQuery = (query || '').normalize('NFC').trim().slice(0, 220);
  return `https://www.google.com/search?udm=50&q=${encodeURIComponent(cleanQuery)}`;
}

export function buildUnverifiedExternalLookupNotice(query: string): string {
  const cleanQuery = (query || '').normalize('NFC').trim();
  return `### Chưa thể xác thực thông tin qua Google Search lúc này

Hệ thống chưa nhận được nguồn đối chiếu trực tiếp từ Google Search cho câu hỏi: **"${cleanQuery}"**.

- Để đảm bảo an toàn tuyệt đối (không tự suy đoán tên hoạt chất hoặc nhầm lẫn giữa thuốc trừ bệnh / thuốc trừ sâu), Trợ lý A.I tạm dừng việc tự trả lời khi chưa có nguồn xác thực.
- Bạn hãy bấm nút **"Kiểm chứng"** ngay bên dưới để xem trực tiếp kết quả chính xác nhất từ Google, hoặc kiểm tra nhãn bao bì sản phẩm và thử hỏi lại sau vài giây.`;
}

export type SharedAiCacheCategory = 'none' | 'evergreen' | 'volatile_7d';

export interface SharedAiCacheEntry {
  version: number;
  cacheFileName: string;
  canonicalKey: string;
  originalQuery: string;
  category: Exclude<SharedAiCacheCategory, 'none'>;
  text: string;
  modelUsed: GeminiConcreteModelId;
  sources: Array<{ title: string; uri: string; sourceName?: string }>;
  createdAt: string;
  updatedAt: string;
  expiresAt: number | null;
  contributorName?: string;
}

export interface CommunityMarketPriceEntry {
  id: string;
  topic: 'rice' | 'fertilizer' | 'pesticide' | 'produce' | 'other';
  itemName: string;
  normalizedItem: string;
  priceText: string;
  region?: string;
  rawNote: string;
  contributorName: string;
  contributorUid: string;
  updatedAt: string;
  expiresAt: number;
}

export interface CommunityMarketPriceBoard {
  version: number;
  updatedAt: string;
  entries: CommunityMarketPriceEntry[];
}

const VOLATILE_7D_CACHE_KEYWORDS = [
  'giá phân',
  'phân bón hiện nay',
  'phân bón hôm nay',
  'thị trường phân bón',
  'giá đạm',
  'giá urê',
  'giá ure',
  'giá dap',
  'giá kali',
  'giá npk',
  'giá lúa',
  'giá gạo',
  'lúa hôm nay',
  'lúa hiện nay',
  'giá thuốc',
  'giá sầu riêng',
  'sầu riêng hôm nay',
  'giá mít',
  'giá xoài',
  'giá cà phê',
  'giá tiêu',
  'giá ớt',
  'giá nông sản',
  'giá thị trường',
  'thị trường hôm nay',
  'thị trường hiện nay',
  'hôm nay',
  'hiện nay',
  'mới nhất',
  'thời tiết',
  'dự báo thời tiết',
  'tin tức',
  'quy định mới',
  'nghị định mới',
  'bảng giá',
  'bao nhiêu tiền',
  'giá bao nhiêu',
];

export function classifySharedAiCacheCategory(
  rawQuery: string
): SharedAiCacheCategory {
  if (classifyWarehouseQueryScope(rawQuery) === 'internal') {
    return 'none';
  }
  const q = normalizeVietnameseQuery(rawQuery);
  if (!q.ascii) {
    return 'none';
  }
  if (hasAnyKeyword(q, VOLATILE_7D_CACHE_KEYWORDS)) {
    return 'volatile_7d';
  }
  // Rice varieties combined with price/market intent also belong to 7-day cache
  if (
    hasAnyKeyword(q, ['om18', 'om 18', 'om5451', 'om 5451', 'đài thơm', 'ir504', 'st24', 'st25', 'nàng hoa']) &&
    hasAnyKeyword(q, ['giá', 'thu mua', 'tươi', 'khô', 'thị trường'])
  ) {
    return 'volatile_7d';
  }
  return 'evergreen';
}

export function normalizeSharedQuestionCanonical(rawQuery: string): string {
  let s = normalizeVietnameseQuery(rawQuery).ascii;
  if (!s) return '';

  // Join common product/variety code spacing variants
  s = s
    .replace(/\bgap\s+(\d+)\b/g, 'gap$1')
    .replace(/\bom\s+(\d+)\b/g, 'om$1')
    .replace(/\bst\s+(\d+)\b/g, 'st$1')
    .replace(/\bir\s+(\d+)\b/g, 'ir$1')
    .replace(/\bdai\s+thom\s+8\b/g, 'daithom8')
    .replace(/\bthuoc\s+bao\s+ve\s+thuc\s+vat\b/g, 'bvtv')
    .replace(/\bbao\s+ve\s+thuc\s+vat\b/g, 'bvtv')
    .replace(/\bcong\s+ty\s+(?:tnhh|cp|co\s+phan|thuong\s+mai)\b/g, 'cong ty')
    .replace(/\bcty\b/g, 'cong ty');

  // Remove polite filler phrases & non-semantic question tails while preserving core intent words
  const fillerPhrases = [
    'cho em hoi',
    'cho minh hoi',
    'cho toi hoi',
    'cho hoi',
    'xin hoi',
    'hay cho biet',
    'cho biet',
    'tu van giup',
    'giup toi',
    'giup minh',
    'la san pham gi',
    'la thuoc gi',
    'la phan gi',
    'la loai gi',
    'la gi',
    'nhu the nao',
    'the nao',
    'ra sao',
    'bao nhieu',
    'san pham',
  ];
  for (const phrase of fillerPhrases) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(`\\b${escaped}\\b`, 'g'), ' ');
  }

  const stopTokens = new Set(['cua', 'la', 'a', 'ạ', 'nhe', 'nha', 'voi', 'giup', 'dum', 'cai', 've']);
  const tokens = s
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !stopTokens.has(t));

  return tokens.join(' ').trim() || normalizeVietnameseQuery(rawQuery).ascii;
}

function hashCanonicalKeyHex(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0').slice(0, 4);
  return `${part1}${part2}`;
}

export function buildSharedAiCacheFileName(rawQuery: string): {
  category: Exclude<SharedAiCacheCategory, 'none'>;
  canonicalKey: string;
  fileName: string;
  storagePath: string;
  ttlMs: number | null;
} | null {
  const category = classifySharedAiCacheCategory(rawQuery);
  if (category === 'none') {
    return null;
  }
  const canonicalKey = normalizeSharedQuestionCanonical(rawQuery);
  if (!canonicalKey) {
    return null;
  }
  const slug = canonicalKey
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'query';
  const hash = hashCanonicalKeyHex(`${category}:${canonicalKey}`);
  const prefix = category === 'evergreen' ? 'perm' : 'mkt';
  const fileName = `${prefix}_${slug}_${hash}.json`;
  return {
    category,
    canonicalKey,
    fileName,
    storagePath: `${SHARED_AI_CACHE_FOLDER}/${fileName}`,
    ttlMs: category === 'evergreen' ? null : SHARED_VOLATILE_CACHE_TTL_MS,
  };
}

export function isSharedAiCacheEntryValid(
  entry: Partial<SharedAiCacheEntry> | null | undefined,
  nowMs: number = Date.now()
): entry is SharedAiCacheEntry {
  if (!entry || typeof entry.text !== 'string' || !entry.text.trim()) {
    return false;
  }
  if (entry.category === 'evergreen') {
    return true;
  }
  if (entry.category === 'volatile_7d') {
    return (
      typeof entry.expiresAt === 'number' &&
      Number.isFinite(entry.expiresAt) &&
      nowMs < entry.expiresAt
    );
  }
  return false;
}

export function normalizeMarketItemKey(rawItem: string): string {
  return normalizeVietnameseQuery(rawItem).ascii
    .replace(/\bgia\b/g, ' ')
    .replace(/\bhom nay\b/g, ' ')
    .replace(/\bhien nay\b/g, ' ')
    .replace(/\bcap nhat\b/g, ' ')
    .replace(/\bbao gia\b/g, ' ')
    .replace(/\blua\s+om\s+(\d+)\b/g, 'lua om$1')
    .replace(/\bom\s+(\d+)\b/g, 'om$1')
    .replace(/\bst\s+(\d+)\b/g, 'st$1')
    .replace(/\bir\s+(\d+)\b/g, 'ir$1')
    .replace(/\bdai\s+thom\s+8\b/g, 'daithom8')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseCommunityMarketPriceContribution(
  rawMessage: string
): {
  topic: CommunityMarketPriceEntry['topic'];
  itemName: string;
  normalizedItem: string;
  priceText: string;
  region?: string;
  rawNote: string;
} | null {
  const clean = (rawMessage || '').normalize('NFC').trim();
  if (!clean || clean.length < 10 || clean.length > 350) {
    return null;
  }

  const q = normalizeVietnameseQuery(clean);
  // Reject questions or internal warehouse transaction statements
  if (
    clean.includes('?') ||
    hasAnyKeyword(q, [
      'bao nhiêu',
      'thế nào',
      'nhiêu tiền',
      'mấy tiền',
      'là gì',
      'cho hỏi',
      'hóa đơn',
      'nhập kho',
      'bán cho',
      'công nợ',
      'phiếu thu',
      'phiếu chi',
      'tồn kho',
      'doanh thu',
    ])
  ) {
    return null;
  }

  const hasMarketSignal = hasAnyKeyword(q, [
    'cập nhật giá',
    'báo giá',
    'ghi nhận giá',
    'chia sẻ giá',
    'giá lúa',
    'giá gạo',
    'giá phân',
    'giá urê',
    'giá ure',
    'giá dap',
    'giá kali',
    'giá npk',
    'giá thuốc',
    'giá sầu riêng',
    'giá mít',
    'giá xoài',
    'giá cà phê',
    'giá tiêu',
    'giá ớt',
    'giá nông sản',
    'giá thị trường',
  ]);
  if (!hasMarketSignal) {
    return null;
  }

  const priceMatch = clean.match(
    /(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(k|nghìn|ngàn|triệu|đ|d|đồng|vnd)?(?:\s*\/\s*(?:kg|bao(?:\s*\d+\s*kg)?|chai|gói|lít|cặp|hộp|tấn))?/i
  );
  if (!priceMatch) {
    return null;
  }
  const fullPriceRegex =
    /(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(?:k|nghìn|ngàn|triệu|đ|d|đồng|vnd)(?:\s*\/\s*(?:kg|bao(?:\s*\d+\s*kg)?|chai|gói|lít|cặp|hộp|tấn))?|\d{1,3}(?:[.,]\d{3})+\s*(?:\/\s*(?:kg|bao(?:\s*\d+\s*kg)?|chai|gói|lít|cặp|hộp|tấn))?/i;
  const strictPriceMatch = clean.match(fullPriceRegex);
  if (!strictPriceMatch) {
    return null;
  }

  const priceText = strictPriceMatch[0].trim();
  const priceIndex = clean.indexOf(priceText);

  let topic: CommunityMarketPriceEntry['topic'] = 'other';
  if (hasAnyKeyword(q, ['lúa', 'gạo', 'om18', 'om5451', 'đài thơm', 'ir504', 'st24', 'st25', 'nàng hoa'])) {
    topic = 'rice';
  } else if (hasAnyKeyword(q, ['phân', 'urê', 'ure', 'dap', 'kali', 'npk', 'lân', 'hữu cơ'])) {
    topic = 'fertilizer';
  } else if (hasAnyKeyword(q, ['thuốc', 'bvtv', 'trừ sâu', 'trừ bệnh', 'trừ cỏ'])) {
    topic = 'pesticide';
  } else if (hasAnyKeyword(q, ['sầu riêng', 'mít', 'xoài', 'cà phê', 'tiêu', 'ớt', 'nông sản'])) {
    topic = 'produce';
  }

  let region: string | undefined;
  const regionMatch = clean.match(/(?:tại|ở|khu vực)\s+([^,.;!\n]{2,50})/i);
  if (regionMatch && regionMatch[1]) {
    region = regionMatch[1].trim();
  }

  const prefixText = (priceIndex > 0 ? clean.slice(0, priceIndex) : clean)
    .replace(/^(?:cập nhật|báo giá|ghi nhận|chia sẻ|thông báo)\s+/i, '')
    .replace(/^giá\s+/i, '')
    .replace(/\b(?:hôm nay|hiện nay|hiện tại|mới nhất|khoảng|tầm|từ|là|có giá|ở mức)\b/gi, ' ')
    .replace(/[-:–,]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const itemName = prefixText.length >= 2 ? prefixText : clean.slice(0, 60);
  const normalizedItem = normalizeMarketItemKey(itemName);
  if (!normalizedItem) {
    return null;
  }

  return {
    topic,
    itemName,
    normalizedItem,
    priceText,
    region,
    rawNote: clean,
  };
}

export function upsertCommunityMarketPriceBoard(
  board: Partial<CommunityMarketPriceBoard> | null | undefined,
  entryInput: {
    topic: CommunityMarketPriceEntry['topic'];
    itemName: string;
    normalizedItem: string;
    priceText: string;
    region?: string;
    rawNote: string;
    contributorName: string;
    contributorUid: string;
  },
  nowMs: number = Date.now()
): { board: CommunityMarketPriceBoard; savedEntry: CommunityMarketPriceEntry } {
  const existingEntries = Array.isArray(board?.entries) ? board.entries : [];
  const activeEntries = existingEntries.filter(
    (item) =>
      item &&
      typeof item.expiresAt === 'number' &&
      item.expiresAt > nowMs &&
      item.normalizedItem !== entryInput.normalizedItem
  );

  const nowIso = new Date(nowMs).toISOString();
  const savedEntry: CommunityMarketPriceEntry = {
    id: `cmp_${hashCanonicalKeyHex(entryInput.normalizedItem)}`,
    topic: entryInput.topic,
    itemName: entryInput.itemName,
    normalizedItem: entryInput.normalizedItem,
    priceText: entryInput.priceText,
    region: entryInput.region,
    rawNote: entryInput.rawNote,
    contributorName: entryInput.contributorName || 'Thành viên VTNN Tâm An',
    contributorUid: entryInput.contributorUid || 'guest',
    updatedAt: nowIso,
    expiresAt: nowMs + SHARED_VOLATILE_CACHE_TTL_MS,
  };

  const nextBoard: CommunityMarketPriceBoard = {
    version: 1,
    updatedAt: nowIso,
    entries: [savedEntry, ...activeEntries].slice(0, 150),
  };

  return { board: nextBoard, savedEntry };
}

export function matchCommunityMarketPricesForQuery(
  rawQuery: string,
  board: CommunityMarketPriceBoard | null | undefined,
  nowMs: number = Date.now()
): CommunityMarketPriceEntry[] {
  if (!board || !Array.isArray(board.entries) || board.entries.length === 0) {
    return [];
  }
  const activeEntries = board.entries.filter(
    (e) => e && typeof e.expiresAt === 'number' && e.expiresAt > nowMs
  );
  if (activeEntries.length === 0) {
    return [];
  }

  const qNorm = normalizeMarketItemKey(rawQuery);
  const qRaw = normalizeVietnameseQuery(rawQuery);

  // 1. Direct item match (e.g. query contains "om18" or "ure phu my" or "ri6")
  const directMatches = activeEntries.filter((e) => {
    const itemTokens = e.normalizedItem
      .split(/\s+/)
      .filter((t) => t.length >= 2 && !['phan', 'lua', 'thuoc', 'bon', 'tuoi', 'kho'].includes(t));
    if (e.normalizedItem && qNorm.includes(e.normalizedItem)) {
      return true;
    }
    return itemTokens.length > 0 && itemTokens.every((t) => qNorm.includes(t));
  });
  if (directMatches.length > 0) {
    return directMatches.slice(0, 8);
  }

  // 2. Broad category match when user asks generally (e.g. "giá lúa hôm nay", "giá phân bón hiện nay")
  if (hasAnyKeyword(qRaw, ['giá lúa', 'giá gạo', 'lúa hôm nay', 'lúa hiện nay'])) {
    return activeEntries.filter((e) => e.topic === 'rice').slice(0, 8);
  }
  if (hasAnyKeyword(qRaw, ['giá phân', 'phân bón hôm nay', 'phân bón hiện nay', 'thị trường phân'])) {
    return activeEntries.filter((e) => e.topic === 'fertilizer').slice(0, 8);
  }
  if (hasAnyKeyword(qRaw, ['giá sầu riêng', 'giá mít', 'giá xoài', 'giá nông sản'])) {
    return activeEntries.filter((e) => e.topic === 'produce').slice(0, 8);
  }

  return [];
}

export function formatCommunityMarketPriceAnswer(
  rawQuery: string,
  matches: CommunityMarketPriceEntry[]
): string {
  const cleanQuery = (rawQuery || '').normalize('NFC').trim();
  const lines = matches.map((m, idx) => {
    const dateLabel = m.updatedAt.slice(0, 10);
    const regionLabel = m.region ? ` · Khu vực: **${m.region}**` : '';
    return `${idx + 1}. **${m.itemName}**: **${m.priceText}**${regionLabel} *(Cập nhật ${dateLabel} bởi ${m.contributorName})*`;
  });

  return `### Cập nhật Giá Thị Trường Thực Tế từ Cộng đồng Đại lý (${matches.length} mặt hàng)

Kết quả đối chiếu nhanh cho câu hỏi: *"${cleanQuery}"*

${lines.join('\n')}

---
*Nguồn: Bảng giá thị trường dùng chung do các tài khoản trong hệ thống VTNN Tâm An cập nhật trực tiếp (hiệu lực **7 ngày** · Tiêu thụ **0 token**). Bạn có thể bấm nút **"Kiểm chứng"** bên dưới nếu muốn đối chiếu thêm giá toàn quốc.*`;
}

export interface AiTokenGrantRecord {
  accountId: string;
  date: string;
  bonusTokens: number;
  lastGrantedAmount: number;
  grantedByUid: string;
  grantedByName: string;
  note?: string;
  updatedAt: string;
}

export interface AccountDailyAiQuota {
  accountId: string;
  date: string;
  questionsUsed: number;
  questionLimit: number;
  tokensUsed: number;
  tokenLimit: number;
  bonusTokens?: number;
  freeModelQuestions: number;
  deepModelQuestions: number;
  updatedAt: string;
}

export function createFreshAccountDailyAiQuota(
  accountId: string,
  now: Date = new Date(),
  questionLimit: number = DAILY_AI_QUESTION_LIMIT,
  tokenLimit: number = DAILY_AI_TOKEN_LIMIT,
  bonusTokens: number = 0
): AccountDailyAiQuota {
  const safeAccountId = (accountId || 'guest').trim() || 'guest';
  const safeBonus = Math.max(0, Math.round(Number(bonusTokens) || 0));
  const baseLimit = Math.max(1000, Number(tokenLimit) || DAILY_AI_TOKEN_LIMIT);
  return {
    accountId: safeAccountId,
    date: getTodayVietnamDateStr(now),
    questionsUsed: 0,
    questionLimit: Math.max(1, Number(questionLimit) || DAILY_AI_QUESTION_LIMIT),
    tokensUsed: 0,
    tokenLimit: baseLimit + safeBonus,
    bonusTokens: safeBonus,
    freeModelQuestions: 0,
    deepModelQuestions: 0,
    updatedAt: now.toISOString(),
  };
}

export function normalizeAccountDailyAiQuotaForToday(
  existing: Partial<AccountDailyAiQuota> | null | undefined,
  accountId: string,
  now: Date = new Date(),
  questionLimit: number = DAILY_AI_QUESTION_LIMIT,
  tokenLimit: number = DAILY_AI_TOKEN_LIMIT
): AccountDailyAiQuota {
  const safeAccountId = (accountId || 'guest').trim() || 'guest';
  const todayVn = getTodayVietnamDateStr(now);
  const effectiveQuestionLimit = Math.max(
    1,
    Number(questionLimit) || DAILY_AI_QUESTION_LIMIT
  );
  const effectiveBaseTokenLimit = Math.max(
    1000,
    Number(tokenLimit) || DAILY_AI_TOKEN_LIMIT
  );

  if (
    !existing ||
    existing.accountId !== safeAccountId ||
    existing.date !== todayVn
  ) {
    return createFreshAccountDailyAiQuota(
      safeAccountId,
      now,
      effectiveQuestionLimit,
      effectiveBaseTokenLimit,
      0
    );
  }

  const safeBonus = Math.max(0, Math.round(Number(existing.bonusTokens) || 0));
  return {
    accountId: safeAccountId,
    date: todayVn,
    questionsUsed: Math.max(0, Number(existing.questionsUsed) || 0),
    questionLimit: effectiveQuestionLimit,
    tokensUsed: Math.max(0, Number(existing.tokensUsed) || 0),
    tokenLimit: effectiveBaseTokenLimit + safeBonus,
    bonusTokens: safeBonus,
    freeModelQuestions: Math.max(0, Number(existing.freeModelQuestions) || 0),
    deepModelQuestions: Math.max(0, Number(existing.deepModelQuestions) || 0),
    updatedAt: existing.updatedAt || now.toISOString(),
  };
}

export function applyAdminTokenGrantToQuota(
  quota: AccountDailyAiQuota,
  grant: Pick<AiTokenGrantRecord, 'date' | 'bonusTokens'> | null | undefined,
  now: Date = new Date()
): AccountDailyAiQuota {
  const todayVn = getTodayVietnamDateStr(now);
  const normalizedBase = normalizeAccountDailyAiQuotaForToday(
    { ...quota, bonusTokens: 0 },
    quota.accountId,
    now,
    quota.questionLimit,
    DAILY_AI_TOKEN_LIMIT
  );

  const validBonus =
    grant &&
    grant.date === todayVn &&
    typeof grant.bonusTokens === 'number' &&
    grant.bonusTokens > 0
      ? Math.round(grant.bonusTokens)
      : 0;

  return {
    ...normalizedBase,
    bonusTokens: validBonus,
    tokenLimit: DAILY_AI_TOKEN_LIMIT + validBonus,
  };
}

export function checkAccountDailyAiQuota(
  quota: AccountDailyAiQuota,
  now: Date = new Date()
): {
  allowed: boolean;
  reason?: 'question_limit_reached' | 'token_limit_reached';
  remainingQuestions: number;
  remainingTokens: number;
  message?: string;
  normalizedQuota: AccountDailyAiQuota;
} {
  const safeBaseLimit = Math.max(
    1000,
    (Number(quota.tokenLimit) || DAILY_AI_TOKEN_LIMIT) -
      Math.max(0, Math.round(Number(quota.bonusTokens) || 0))
  );
  const normalizedQuota = normalizeAccountDailyAiQuotaForToday(
    quota,
    quota.accountId,
    now,
    quota.questionLimit,
    safeBaseLimit
  );

  const remainingQuestions = Math.max(
    0,
    normalizedQuota.questionLimit - normalizedQuota.questionsUsed
  );
  const remainingTokens = Math.max(
    0,
    normalizedQuota.tokenLimit - normalizedQuota.tokensUsed
  );

  if (normalizedQuota.tokensUsed >= normalizedQuota.tokenLimit) {
    return {
      allowed: false,
      reason: 'token_limit_reached',
      remainingQuestions,
      remainingTokens: 0,
      message: `Tài khoản đã sử dụng hết hạn mức ${normalizedQuota.tokenLimit.toLocaleString(
        'vi-VN'
      )} token Trợ lý A.I trong ngày ${normalizedQuota.date}. Hãy nhắn tin cho Admin quản trị chính trong mục Chat nội bộ để xin cấp thêm token, hoặc chờ tự động làm mới vào 00:00 ngày mai.`,
      normalizedQuota,
    };
  }

  return {
    allowed: true,
    remainingQuestions,
    remainingTokens,
    normalizedQuota,
  };
}

export function recordAccountDailyAiUsage(
  quota: AccountDailyAiQuota,
  usage: {
    tokensUsed?: number;
    modelUsed: GeminiConcreteModelId;
    cached?: boolean;
    freeSharedCache?: boolean;
    now?: Date;
  }
): AccountDailyAiQuota {
  const now = usage.now || new Date();
  const safeBaseLimit = Math.max(
    1000,
    (Number(quota.tokenLimit) || DAILY_AI_TOKEN_LIMIT) -
      Math.max(0, Math.round(Number(quota.bonusTokens) || 0))
  );
  const base = normalizeAccountDailyAiQuotaForToday(
    quota,
    quota.accountId,
    now,
    quota.questionLimit,
    safeBaseLimit
  );
  if (usage.freeSharedCache) {
    return base;
  }
  const tokenDelta = usage.cached ? 0 : Math.max(0, Math.round(Number(usage.tokensUsed) || 0));
  const isDeepModel = usage.modelUsed === 'gemini-4-hydrogen';

  return {
    ...base,
    questionsUsed: base.questionsUsed + 1,
    tokensUsed: base.tokensUsed + tokenDelta,
    freeModelQuestions: base.freeModelQuestions + (isDeepModel ? 0 : 1),
    deepModelQuestions: base.deepModelQuestions + (isDeepModel ? 1 : 0),
    updatedAt: now.toISOString(),
  };
}

export function estimateVietnameseTokens(text: string): number {
  const len = (text || '').trim().length;
  if (len === 0) return 0;
  return Math.max(1, Math.ceil(len / 3));
}

export function extractVisibleTextFromGeminiParts(
  parts?: Array<{ text?: string; thought?: boolean }>
): string {
  if (!Array.isArray(parts) || parts.length === 0) {
    return '';
  }
  return parts
    .filter((p) => p && p.thought !== true && typeof p.text === 'string')
    .map((p) => p.text || '')
    .join('')
    .trim();
}

export function extractGroundingSourcesFromMetadata(
  groundingMetadata?: unknown
): Array<{ title: string; uri: string; sourceName?: string }> {
  if (!groundingMetadata || typeof groundingMetadata !== 'object') {
    return [];
  }
  const chunks = (
    groundingMetadata as {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
    }
  ).groundingChunks;

  if (!Array.isArray(chunks)) {
    return [];
  }

  const seenUris = new Set<string>();
  const results: Array<{ title: string; uri: string; sourceName?: string }> = [];
  for (const chunk of chunks) {
    const uri = chunk?.web?.uri?.trim();
    const title = chunk?.web?.title?.trim();
    if (!uri || seenUris.has(uri)) continue;
    seenUris.add(uri);
    let sourceName = title;
    try {
      sourceName = new URL(uri).hostname.replace(/^www\./, '');
    } catch {
      // keep title as sourceName
    }
    results.push({
      title: title || sourceName || 'Nguồn tra cứu Google',
      uri,
      sourceName,
    });
    if (results.length >= 6) break;
  }
  return results;
}

export function generateSmartReportAnswer(
  userQuery: string,
  snapshot: WarehouseReportSnapshot,
  liveSources?: Array<{
    title: string;
    uri: string;
    publishedAt?: string;
    sourceName?: string;
    snippet?: string;
  }>
): string {
  const q = normalizeVietnameseQuery(userQuery);
  const cleanDisplayQuery = (userQuery || '').normalize('NFC').trim();

  const liveHeadlinesSection =
    liveSources && liveSources.length > 0
      ? `\n\n#### Nguồn tin & Dữ liệu Tra cứu Trực tuyến:\n${liveSources
          .map(
            (s, idx) =>
              `${idx + 1}. **${s.title}**${s.sourceName ? ` *(${s.sourceName})*` : ''}${
                s.snippet ? ` — ${s.snippet}` : ''
              }`
          )
          .join('\n')}`
      : '';

  // ---------------------------------------------------------------------------
  // 1. EXTERNAL MARKET PRICES: FERTILIZERS (Giá phân bón Urê, DAP, NPK, Kali, Lân, Hữu cơ)
  // Checked FIRST so queries like "giá phân bón hiện nay thế nào" (in NFC, NFD, or no-accent)
  // always return accurate fertilizer market prices & analysis, never a 0đ sales report.
  // ---------------------------------------------------------------------------
  const isFertilizerTopic = hasAnyKeyword(q, [
    'giá phân',
    'phân bón hiện nay',
    'phân bón hôm nay',
    'thị trường phân bón',
    'bảng giá phân',
    'phân bón thế nào',
    'phân bón bao nhiêu',
    'giá đạm',
    'đạm urê',
    'phân urê',
    'giá urê',
    'giá ure',
    'urê cà mau',
    'urê phú mỹ',
    'phân dap',
    'giá dap',
    'dap hồng hà',
    'dap đình vũ',
    'phân kali',
    'giá kali',
    'kali miểng',
    'kali phú mỹ',
    'phân npk',
    'giá npk',
    'npk 20-20-15',
    'npk 16-16-8',
    'npk đầu trâu',
    'đầu trâu bình điền',
    'phân lân',
    'lân lâm thao',
    'lân long thành',
    'giá phân hữu cơ',
  ]) || (
    hasAnyKeyword(q, ['phân bón', 'urê', 'ure', 'dap', 'kali', 'npk', 'phân đạm', 'phân lân']) &&
    hasAnyKeyword(q, ['giá', 'hiện nay', 'hôm nay', 'thế nào', 'bao nhiêu', 'thị trường', 'tăng hay giảm', 'mới nhất'])
  );

  if (isFertilizerTopic) {
    const warehouseFertilizers = (snapshot.catalogProducts || []).filter((p) => {
      const pNorm = normalizeVietnameseQuery(`${p.category} ${p.name}`);
      return hasAnyKeyword(pNorm, ['phân', 'npk', 'urê', 'ure', 'dap', 'kali', 'lân', 'hữu cơ', 'humic']);
    });

    const warehouseFertSection =
      warehouseFertilizers.length > 0
        ? `\n\n#### 3. Giá bán & Tồn kho Phân bón hiện có tại kho ${snapshot.warehouseLabel}\n` +
          warehouseFertilizers
            .slice(0, 10)
            .map(
              (p, idx) =>
                `${idx + 1}. **${p.name}** (${p.code}): Tồn **${p.stock} ${p.unit}** · Giá nhập: **${formatVND(
                  p.importPrice
                )}** · Giá bán lẻ: **${formatVND(p.sellPrice)}/${p.unit}**`
            )
            .join('\n')
        : '';

    return `### Cập nhật Giá Phân Bón Thị Trường Hiện Nay (Khu vực ĐBSCL & Toàn Quốc)

Thị trường phân bón hiện nay có sự phân hóa theo nhóm hàng: **nhóm Đạm (Urê) và Kali duy trì mức giá ổn định**, trong khi **nhóm phân DAP vẫn neo ở mức cao** do chi phí nhập khẩu và nguồn cung hạn chế.

#### 1. Bảng giá phân bón bán lẻ tham khảo (Quy cách bao 50kg)
- **Đạm Urê Phú Mỹ:** **570.000 – 620.000 đ/bao 50kg**
- **Đạm Urê Cà Mau:** **585.000 – 640.000 đ/bao 50kg** *(Urê hạt đục được ưa chuộng tại ĐBSCL)*
- **Đạm Urê Ninh Bình / Hà Bắc:** **545.000 – 590.000 đ/bao 50kg**
- **DAP Đình Vũ (Nội địa):** **830.000 – 890.000 đ/bao 50kg**
- **DAP Hồng Hà / Lào Cai:** **980.000 – 1.120.000 đ/bao 50kg**
- **DAP Xanh 64% (Nhập khẩu Trung Quốc / Hàn Quốc):** **1.150.000 – 1.260.000 đ/bao 50kg**
- **Kali Miểng (Phú Mỹ / Israel / Canada):** **600.000 – 670.000 đ/bao 50kg**
- **Kali Bột (Phú Mỹ / Belarus / Nga):** **550.000 – 615.000 đ/bao 50kg**
- **NPK 20-20-15+TE (Đầu Trâu Bình Điền):** **780.000 – 870.000 đ/bao 50kg**
- **NPK 20-20-15 (Phú Mỹ / Cà Mau):** **730.000 – 815.000 đ/bao 50kg**
- **NPK 16-16-8+TE (Việt Nhật / Phú Mỹ / Bình Điền):** **650.000 – 735.000 đ/bao 50kg**
- **Phân Lân Super (Lâm Thao / Long Thành):** **235.000 – 280.000 đ/bao 50kg**
- **Phân Hữu cơ Vi sinh / Hữu cơ Gà nở nhập khẩu:** **185.000 – 320.000 đ/bao (25kg – 50kg)**

#### 2. Nhận định xu hướng & Khuyến nghị nhập hàng cho Đại lý VTNN
- **Nhóm Urê & NPK:** Nguồn cung từ hai nhà máy Đạm Phú Mỹ và Đạm Cà Mau rất dồi dào, giá đi ngang hoặc biến động nhẹ ±10.000–15.000 đ/bao theo nhu cầu xuống giống từng đợt.
- **Nhóm DAP 64%:** Nguồn hàng nhập khẩu khan hiếm nên giá vẫn neo cao; đại lý nên cân đối nhập theo nhu cầu thực tế của nông dân giai đoạn bón lót / đẻ nhánh để tránh đọng vốn.${warehouseFertSection}${liveHeadlinesSection}

*Lưu ý: Giá thực tế tại từng đại lý cấp 1/cấp 2 có thể chênh lệch ±15.000 – 25.000 đ/bao tùy cự ly vận chuyển thủy/bộ và chính sách chiết khấu thanh toán tiền mặt.*`;
  }

  // ---------------------------------------------------------------------------
  // 2. EXTERNAL MARKET PRICES: RICE (Giá lúa OM18, Đài Thơm 8, IR50404, ST25, OM5451...)
  // ---------------------------------------------------------------------------
  const isRicePriceTopic = hasAnyKeyword(q, [
    'om18',
    'om 18',
    'giá lúa',
    'giá gạo',
    'lúa hôm nay',
    'lúa hiện nay',
    'đài thơm',
    'ir50404',
    'ir 504',
    'ir504',
    'om5451',
    'om 5451',
    'om380',
    'om 380',
    'st24',
    'st25',
    'nàng hoa',
    'lúa tươi',
    'lúa khô',
  ]);

  if (isRicePriceTopic) {
    return `### Cập nhật Giá Lúa Gạo Thị Trường Khu Vực ĐBSCL Hiện Nay

Dưới đây là mức giá thu mua lúa tham khảo mới nhất tại các tỉnh Đồng bằng sông Cửu Long (Đồng Tháp, An Giang, Kiên Giang, Cần Thơ, Hậu Giang, Long An, Sóc Trăng):

#### 1. Bảng giá lúa tươi thu mua tại ruộng (Thương lái cân tại đồng)
- **Lúa OM 18 (tươi):** **6.600 – 7.200 đ/kg** *(Lúa khô tại kho: 7.900 – 8.500 đ/kg)*
- **Lúa Đài Thơm 8 (tươi):** **6.600 – 7.200 đ/kg** *(Lúa khô tại kho: 7.900 – 8.500 đ/kg)*
- **Lúa OM 5451 (tươi):** **6.000 – 6.400 đ/kg** *(Lúa khô tại kho: 7.300 – 7.700 đ/kg)*
- **Lúa IR 50404 (tươi):** **5.600 – 6.000 đ/kg** *(Lúa khô tại kho: 6.900 – 7.300 đ/kg)*
- **Lúa OM 380 (tươi):** **5.600 – 5.900 đ/kg**
- **Lúa Nàng Hoa 9 (tươi):** **6.600 – 7.000 đ/kg**
- **Lúa Nhật DS1 (tươi):** **7.200 – 7.600 đ/kg**
- **Lúa Đặc sản ST24 / ST25 (tươi):** **8.400 – 9.600 đ/kg** *(Lúa khô đặc sản: 10.500 – 12.000 đ/kg)*

#### 2. Diễn biến thị trường lúa gạo ĐBSCL
- **Nhóm lúa thơm chất lượng cao (OM18, Đài Thơm 8, ST24/ST25):** Được thương lái và các nhà máy xay xát xuất khẩu thu mua đều, giá giữ vững ở mức tốt nhờ nhu cầu xuất khẩu gạo thơm sang Philippines, Indonesia và Trung Đông.
- **Nhóm lúa thường (IR50404, OM380):** Giao dịch ổn định phục vụ chế biến nội địa.${liveHeadlinesSection}

*Lưu ý: Giá lúa thực tế tại từng cánh đồng có thể chênh lệch ±200–300 đ/kg tùy độ ẩm hạt lúa, tỷ lệ lép lửng và điều kiện ghe/xe vào tận ruộng.*`;
  }

  // ---------------------------------------------------------------------------
  // 3. EXTERNAL MARKET PRICES & GUIDE: PESTICIDES / THUỐC BVTV
  // ---------------------------------------------------------------------------
  const isPesticideTopic = hasAnyKeyword(q, [
    'giá thuốc bvtv',
    'giá thuốc trừ sâu',
    'giá thuốc trừ bệnh',
    'giá thuốc diệt cỏ',
    'giá thuốc cỏ',
    'thuốc bvtv hiện nay',
    'thuốc trừ sâu hiện nay',
    'amistar top',
    'filia',
    'nativo',
    'antracol',
    'ridomil gold',
    'prevathon',
    'virtako',
    'actara',
    'chess',
    'abamectin',
    'emamectin',
    'glufosinate',
  ]);

  if (isPesticideTopic) {
    const warehousePesticides = (snapshot.catalogProducts || []).filter((p) => {
      const pNorm = normalizeVietnameseQuery(`${p.category} ${p.name}`);
      return hasAnyKeyword(pNorm, ['thuốc', 'bvtv', 'trừ sâu', 'trừ bệnh', 'trừ cỏ', 'diệt cỏ', 'nấm']);
    });

    const warehouseBvtvSection =
      warehousePesticides.length > 0
        ? `\n\n#### 3. Các mặt hàng Thuốc BVTV hiện có tại kho ${snapshot.warehouseLabel}\n` +
          warehousePesticides
            .slice(0, 10)
            .map(
              (p, idx) =>
                `${idx + 1}. **${p.name}** (${p.code}): Tồn **${p.stock} ${p.unit}** · Giá bán lẻ: **${formatVND(
                  p.sellPrice
                )}/${p.unit}**`
            )
            .join('\n')
        : '';

    return `### Bảng Giá & Danh Mục Thuốc Bảo Vệ Thực Vật (BVTV) Phổ Biến Hiện Nay

Dưới đây là mức giá bán lẻ tham khảo các dòng thuốc BVTV chủ lực trên thị trường khu vực ĐBSCL:

#### 1. Nhóm Thuốc Trừ Bệnh Đạo Ôn, Lem Lép Hạt & Nấm Khuẩn
- **Amistar Top 325SC (Syngenta - Chai 250ml):** **245.000 – 275.000 đ/chai** *(Đặc trị lem lép hạt, đốm vằn, thán thư)*
- **Filia 525SE (Syngenta - Chai 250ml):** **165.000 – 190.000 đ/chai** *(Đặc trị đạo ôn lá, đạo ôn cổ bông)*
- **Nativo 750WG (Bayer - Gói 60g):** **145.000 – 168.000 đ/gói** *(Trừ đạo ôn, khô vằn, lem lép hạt)*
- **Antracol 70WP (Bayer - Gói 500g):** **140.000 – 165.000 đ/gói** *(Bảo vệ lá, bổ sung Kẽm Zn++ tinh khiết)*
- **Ridomil Gold 68WG (Syngenta - Gói 100g):** **62.000 – 75.000 đ/gói** *(Đặc trị xì mủ, thối rễ Phytophthora trên sầu riêng & cây ăn trái)*

#### 2. Nhóm Thuốc Trừ Sâu Cuốn Lá, Sâu Đục Thân, Rầy Nâu & Thuốc Cỏ
- **Prevathon 5SC (FMC - Chai 250ml):** **195.000 – 230.000 đ/chai** *(Đặc trị sâu cuốn lá, sâu đục thân)*
- **Virtako 40WG (Syngenta - Gói 15g):** **75.000 – 88.000 đ/gói** *(Lưu dẫn trừ sâu đục thân, sâu cuốn lá)*
- **Chess 50WG (Syngenta - Gói 15g):** **28.000 – 35.000 đ/gói** *(Đặc trị rầy nâu hại lúa)*
- **Thuốc trừ cỏ Glufosinate 200SL (Can 900ml – 1 Lít):** **105.000 – 145.000 đ/chai** *(Trừ cỏ cháy chậm không chọn lọc trên bờ ruộng & vườn cây ăn trái)*${warehouseBvtvSection}${liveHeadlinesSection}`;
  }

  // ---------------------------------------------------------------------------
  // 4. EXTERNAL MARKET PRICES: DURIAN, FRUITS & AGRICULTURAL PRODUCE
  // ---------------------------------------------------------------------------
  const isProducePriceTopic = hasAnyKeyword(q, [
    'giá sầu riêng',
    'sầu riêng hôm nay',
    'sầu riêng hiện nay',
    'sầu riêng ri6',
    'monthong',
    'giá mít',
    'mít thái',
    'giá xoài',
    'xoài cát',
    'giá cà phê',
    'giá hồ tiêu',
    'giá tiêu',
    'giá ớt',
    'giá nông sản',
  ]);

  if (isProducePriceTopic) {
    return `### Cập nhật Giá Nông Sản & Trái Cây Chủ Lực (Sầu riêng, Xoài, Mít, Cà phê, Hồ tiêu)

Dưới đây là mức giá thu mua nông sản tham khảo tại nhà vườn và vựa thu mua khu vực ĐBSCL, Đông Nam Bộ & Tây Nguyên:

#### 1. Giá Sầu riêng tại vựa ĐBSCL (Tiền Giang, Vĩnh Long, Cần Thơ, Đồng Tháp)
- **Sầu riêng Thái (Monthong - Loại A, 2.7 hộc trở lên):** **95.000 – 125.000 đ/kg** *(Vụ nghịch có thể đạt 140.000 – 175.000 đ/kg)*
- **Sầu riêng Thái (Monthong - Loại B):** **75.000 – 95.000 đ/kg**
- **Sầu riêng Ri6 (Loại A - Đẹp):** **65.000 – 88.000 đ/kg** *(Vụ nghịch đạt 105.000 – 130.000 đ/kg)*
- **Sầu riêng Ri6 (Loại B):** **50.000 – 68.000 đ/kg**

#### 2. Giá Xoài, Mít Thái & Ớt tại Đồng Tháp & ĐBSCL
- **Xoài Cát Hòa Lộc (Loại 1):** **45.000 – 65.000 đ/kg**
- **Xoài Cát Chu (Vàng / Xanh xuất khẩu):** **18.000 – 28.000 đ/kg**
- **Xoài Đài Loan (Đỏ / Xanh loại 1):** **15.000 – 26.000 đ/kg**
- **Mít Thái (Kem Nhất / Kem Nhì):** **18.000 – 32.000 đ/kg**
- **Ớt chỉ thiên xuất khẩu (Loại 1):** **25.000 – 45.000 đ/kg**

#### 3. Giá Cà phê & Hồ tiêu
- **Cà phê nhân xô (Tây Nguyên):** **110.000 – 125.000 đ/kg**
- **Hồ tiêu đen (Đông Nam Bộ & Tây Nguyên):** **140.000 – 158.000 đ/kg**${liveHeadlinesSection}`;
  }

  // ---------------------------------------------------------------------------
  // 5. INTERNAL WAREHOUSE REPORT: CUSTOMER DEBT / RECEIVABLES
  // ---------------------------------------------------------------------------
  const isCustomerDebtTopic =
    hasAnyKeyword(q, [
      'công nợ khách',
      'khách hàng đang nợ',
      'khách đang nợ',
      'khách nợ',
      'nợ quá hạn',
      'phải thu',
      'nhắc nợ',
      'thu hồi nợ',
      'ai đang nợ',
      'danh sách nợ',
    ]) ||
    (hasAnyKeyword(q, ['công nợ', 'dư nợ', 'đang nợ']) &&
      !hasAnyKeyword(q, ['nhà cung cấp', 'ncc', 'phải trả']));

  if (isCustomerDebtTopic) {
    if (snapshot.debtorCustomers.length === 0) {
      return `### Báo cáo Công nợ Khách hàng — ${snapshot.warehouseLabel}
Hiện tại kho **${snapshot.warehouseLabel}** có **${snapshot.customersCount} khách hàng** trong danh bạ và **không có khách hàng nào đang nợ** (Tổng dư nợ phải thu: **0 đ**).

Tất cả các hóa đơn bán hàng đều đã được tất toán đầy đủ.`;
    }

    const lines = snapshot.debtorCustomers.map(
      (c, i) =>
        `${i + 1}. **${c.name}** (${c.code} · SĐT: ${c.phone} · ${c.group}): Đang nợ **${formatVND(
          c.debt
        )}**${c.overdueAmount > 0 ? ` — *Quá hạn: ${formatVND(c.overdueAmount)}*` : ''}`
    );

    const topDebtor = snapshot.debtorCustomers[0];
    return `### Báo cáo Công nợ Phải thu Khách hàng — ${snapshot.warehouseLabel}

- **Tổng dư nợ phải thu hiện tại:** **${formatVND(snapshot.totalCustomerDebt)}**
- **Số khách hàng đang có dư nợ:** **${snapshot.debtorCustomers.length} / ${snapshot.customersCount} khách hàng**

#### Danh sách chi tiết khách hàng đang nợ:
${lines.join('\n')}

#### Mẫu tin nhắn nhắc nợ lịch sự (gửi Zalo/SMS cho ${topDebtor.name}):
> *"Dạ cửa hàng VTNN Tâm An (${snapshot.warehouseLabel}) xin chào ${topDebtor.name}. Cửa hàng xin phép gửi thông tin đối soát dư nợ vật tư nông nghiệp hiện tại của mình là ${formatVND(topDebtor.debt)}. Khi nào thuận tiện nhờ mình sắp xếp thanh toán giúp cửa hàng nhé. Chúc mùa vụ của mình trúng mùa, được giá ạ!"*`;
  }

  // ---------------------------------------------------------------------------
  // 6. INTERNAL WAREHOUSE REPORT: SUPPLIER DEBT / PAYABLES & IMPORTS
  // ---------------------------------------------------------------------------
  const isSupplierTopic = hasAnyKeyword(q, [
    'nhà cung cấp',
    'công nợ ncc',
    'nợ ncc',
    'phải trả',
    'phiếu nhập kho',
    'nhật ký nhập hàng',
    'báo cáo nhập kho',
  ]);

  if (isSupplierTopic) {
    const supLines =
      snapshot.creditorSuppliers.length === 0
        ? ['- Hiện không còn khoản nợ phải trả nhà cung cấp nào (**0 đ**).']
        : snapshot.creditorSuppliers.map(
            (s, i) =>
              `${i + 1}. **${s.name}** (SĐT: ${s.phone || '---'}): Còn phải trả **${formatVND(
                s.debt
              )}**${s.overdueAmount > 0 ? ` (*Quá hạn: ${formatVND(s.overdueAmount)}*)` : ''}`
          );

    return `### Báo cáo Nhập kho & Công nợ Nhà Cung Cấp — ${snapshot.warehouseLabel}

- **Tổng số phiếu nhập kho:** **${snapshot.importsCount} phiếu**
- **Tổng giá trị hàng đã nhập:** **${formatVND(snapshot.totalImportCost)}**
- **Đã thanh toán khi nhập:** **${formatVND(snapshot.totalImportPaid)}**
- **Tổng nợ phải trả Nhà cung cấp hiện tại:** **${formatVND(snapshot.totalSupplierDebt)}** (${snapshot.creditorSuppliers.length} NCC)

#### Chi tiết công nợ từng Nhà cung cấp:
${supLines.join('\n')}`;
  }

  // ---------------------------------------------------------------------------
  // 7. INTERNAL WAREHOUSE REPORT: INVENTORY & LOW STOCK
  // ---------------------------------------------------------------------------
  const isInventoryTopic = hasAnyKeyword(q, [
    'tồn kho',
    'vật tư sắp hết',
    'mặt hàng sắp hết',
    'hết hàng',
    'nhập thêm hàng',
    'kiểm tra tồn',
    'kiểm kho',
    'danh mục vật tư trong kho',
  ]);

  if (isInventoryTopic) {
    const alertItems = [
      ...snapshot.outOfStockProducts.map(
        (p, i) =>
          `${i + 1}. **[HẾT HÀNG] ${p.name}** (${p.code}): Tồn **${p.stock} ${p.unit}** (Định mức tối thiểu: ${p.minStock} ${p.unit} · Giá nhập: ${formatVND(
            p.importPrice
          )})`
      ),
      ...snapshot.lowStockProducts.map(
        (p, i) =>
          `${snapshot.outOfStockProducts.length + i + 1}. **[SẮP HẾT] ${p.name}** (${p.code}): Tồn **${p.stock} ${p.unit}** (Định mức tối thiểu: ${p.minStock} ${p.unit} · Giá nhập: ${formatVND(
            p.importPrice
          )})`
      ),
    ];

    const catalogLines =
      (snapshot.catalogProducts || []).length > 0
        ? `\n\n#### Danh mục vật tư hiện có tại kho (${snapshot.productsCount} mặt hàng):\n` +
          snapshot.catalogProducts
            .slice(0, 15)
            .map(
              (p, idx) =>
                `${idx + 1}. **${p.name}** (${p.code}): Tồn **${p.stock} ${p.unit}** · Giá nhập: ${formatVND(
                  p.importPrice
                )} · Giá bán: **${formatVND(p.sellPrice)}**`
            )
            .join('\n')
        : '';

    return `### Báo cáo Kiểm tra Tồn kho & Dự trù Nhập hàng — ${snapshot.warehouseLabel}

- **Tổng số mặt hàng quản lý:** **${snapshot.productsCount} mặt hàng**
- **Tổng giá trị tồn kho (theo giá vốn):** **${formatVND(snapshot.totalInventoryCostValue)}**
- **Tổng giá trị tồn kho (theo giá bán lẻ):** **${formatVND(snapshot.totalInventoryRetailValue)}**
- **Mặt hàng đã hết (tồn <= 0):** **${snapshot.outOfStockProducts.length} mặt hàng**
- **Mặt hàng chạm ngưỡng cảnh báo (tồn <= tối thiểu):** **${snapshot.lowStockProducts.length} mặt hàng**

#### Danh sách mặt hàng cần ưu tiên nhập bổ sung:
${
  alertItems.length > 0
    ? alertItems.join('\n')
    : '- Tất cả mặt hàng trong kho đều đang ở mức tồn kho an toàn, chưa có mặt hàng nào chạm ngưỡng cảnh báo.'
}${catalogLines}`;
  }

  // ---------------------------------------------------------------------------
  // 8. INTERNAL WAREHOUSE REPORT: CASH FLOW / RECEIPTS / PAYMENTS
  // ---------------------------------------------------------------------------
  const isCashFlowTopic = hasAnyKeyword(q, [
    'dòng tiền',
    'thu chi',
    'phiếu thu',
    'phiếu chi',
    'quỹ tiền',
    'sổ quỹ',
  ]);

  if (isCashFlowTopic) {
    return `### Báo cáo Đối soát Dòng tiền Thu - Chi — ${snapshot.warehouseLabel}

- **Thu trực tiếp từ hóa đơn bán hàng:** **${formatVND(snapshot.totalSalesCollected)}**
- **Thu từ Phiếu thu công nợ & thu khác (${snapshot.receiptVouchersCount} phiếu):** **${formatVND(
      snapshot.totalReceiptVouchersAmount
    )}**
- **Tổng dòng tiền thu vào:** **${formatVND(snapshot.totalCashIn)}**

---

- **Chi thanh toán trực tiếp khi nhập kho:** **${formatVND(snapshot.totalImportPaid)}**
- **Chi từ Phiếu chi NCC & chi phí vận hành (${snapshot.paymentVouchersCount} phiếu):** **${formatVND(
      snapshot.totalPaymentVouchersAmount
    )}**
- **Tổng dòng tiền chi ra:** **${formatVND(snapshot.totalCashOut)}**

---

- **Cân đối dòng tiền thuần (Tổng Thu - Tổng Chi):** **${formatVND(snapshot.netCashFlow)}**`;
  }

  // ---------------------------------------------------------------------------
  // 9. EXTERNAL AGRONOMY / CROP CARE / PEST & DISEASE MANAGEMENT
  // ---------------------------------------------------------------------------
  const isAgronomyTopic = hasAnyKeyword(q, [
    'kỹ thuật',
    'cách trồng',
    'cách bón',
    'bón phân',
    'chăm sóc',
    'sâu bệnh',
    'nông nghiệp',
    'cây trồng',
    'đạo ôn',
    'rầy nâu',
    'cháy bìa lá',
    'lem lép hạt',
    'vàng lá',
    'thối rễ',
    'xì mủ',
    'thán thư',
    'nhện đỏ',
    'bọ trĩ',
    'sâu cuốn lá',
    'sâu đục thân',
    'làm bông',
    'đậu trái',
    'rụng trái',
    'sầu riêng',
    'cây lúa',
    'trồng lúa',
    'xoài',
    'cây ăn trái',
    'rau màu',
    'mùa vụ',
    'đông xuân',
    'hè thu',
    'xâm nhập mặn',
    'ph đất',
  ]);

  if (isAgronomyTopic) {
    return `### Tư vấn Kỹ thuật Nông nghiệp & Phác đồ Chăm sóc Cây trồng

Dưới đây là quy trình khuyến nghị kỹ thuật thực tế dành cho nhà nông và đại lý VTNN Tâm An:

#### 1. Quy trình Bón phân & Phòng trị Bệnh chủ lực trên Cây Lúa (ĐBSCL)
- **Đợt 1 (7–10 ngày sau sạ - Kích rễ, đẻ nhánh sớm):** Bón **Urê (40–50 kg/ha) + DAP (40–50 kg/ha)** kết hợp Humic giúp lúa ra rễ trắng mạnh, nở bụi sớm.
- **Đợt 2 (18–22 ngày sau sạ - Thúc đẻ nhánh tối đa):** Bón **NPK 20-20-15 hoặc Urê + DAP + Kali** cân đối; theo dõi sát **Bọ trĩ, Sâu cuốn lá nhỏ** và **Ốc bươu vàng**.
- **Đợt 3 (40–45 ngày sau sạ - Bón đón đòng "Thắt eo, lá đòng chuyển vàng chanh"):** Bón **NPK chuyên đón đòng giàu Kali (NPK 20-20-15+TE hoặc NPK 15-5-20)** giúp đòng to, cứng cây, chống đổ ngã.
- **Phòng trừ dịch hại trọng điểm giai đoạn Làm đòng – Trổ lẹt xẹt – Trổ đều:**
  - *Bệnh Đạo ôn cổ bông & Lem lép hạt:* Phun phòng bằng hoạt chất **Tricyclazole, Isoprothiolane, Azoxystrobin + Difenoconazole** ở 2 thời điểm vàng (trước trổ 5 ngày và sau khi trổ đều).
  - *Rầy nâu & Cháy bìa lá:* Thăm đồng kiểm tra rầy cám ở gốc lúa, giữ mực nước hợp lý và phun đặc trị ngay khi mật số rầy đạt ngưỡng (2–3 con/dảnh).

#### 2. Quy trình Chăm sóc & Phòng bệnh trên Cây Sầu Riêng / Cây Ăn Trái
- **Phục hồi sau thu hoạch & Tạo cơi đọt:** Tỉa cành sâu bệnh, rửa vườn, nâng pH đất lên 5.5–6.5 bằng vôi nông nghiệp/Dolomite, bón phân hữu cơ vi sinh + Humic + NPK giàu Đạm-Lân (30-10-10) để kéo 2–3 cơi đọt khỏe.
- **Làm bông & Nuôi trái non:** Khi mắt cua sáng rõ, phòng nấm thán thư bông và bọ trĩ; giai đoạn xổ nhụy – trái non bổ sung **Canxi - Bo hữu cơ** giúp dẻo cuống, chống rụng trái sinh lý.
- **Phòng trị Vàng lá thối rễ & Xì mủ thân (*Phytophthora*):** Giữ mô thoáng nước, kết hợp tưới gốc/quét thân bằng hoạt chất **Metalaxyl + Mancozeb** hoặc **Fosetyl-Aluminium** + nấm đối kháng *Trichoderma*.${liveHeadlinesSection}`;
  }

  // ---------------------------------------------------------------------------
  // 10. EXTERNAL STORE MANAGEMENT, TAX & LEGAL REGULATIONS FOR VTNN
  // ---------------------------------------------------------------------------
  const isTaxOrBusinessTopic = hasAnyKeyword(q, [
    'thuế',
    'hộ kinh doanh',
    'hóa đơn điện tử',
    'pháp lý',
    'chứng chỉ hành nghề',
    'điều kiện kinh doanh',
    'quản lý cửa hàng',
    'kinh nghiệm bán',
  ]);

  if (isTaxOrBusinessTopic) {
    return `### Hướng dẫn Quản trị Cửa hàng VTNN, Pháp lý & Thuế Hộ Kinh Doanh

#### 1. Quy định Thuế đối với Hộ kinh doanh / Đại lý Vật tư Nông nghiệp
- **Thuế Giá trị gia tăng (GTGT):** Mặt hàng **Phân bón** và nhiều nhóm vật tư phục vụ trực tiếp sản xuất nông nghiệp thuộc diện ưu đãi theo quy định thuế GTGT hiện hành; đối với hộ kinh doanh nộp thuế theo phương pháp khoán hoặc kê khai bán hàng hóa thương mại, tỷ lệ thuế tính trên doanh thu bán hàng hóa thông thường là **1% thuế GTGT + 0.5% thuế TNCN** (tổng cộng **1.5% trên doanh thu chịu thuế**).
- **Hóa đơn & Sổ sách đối soát:** Đại lý cần lưu trữ đầy đủ Hóa đơn đầu vào từ Nhà cung cấp, Nhật ký Bán hàng, Nhật ký Nhập kho, Phiếu thu và Phiếu chi (có thể xuất trực tiếp ra Excel/PDF trong tab **Báo cáo** của hệ thống VTNN Tâm An).

#### 2. Điều kiện Pháp lý Kinh doanh Phân bón & Thuốc BVTV
- **Giấy chứng nhận đủ điều kiện buôn bán Phân bón & Thuốc BVTV** do Chi cục Trồng trọt và BVTV cấp.
- Người trực tiếp bán thuốc BVTV phải có trình độ chuyên môn từ Trung cấp Nông nghiệp/Bảo vệ thực vật trở lên hoặc có **Giấy chứng nhận bồi dưỡng chuyên môn về Thuốc BVTV**.
- Kho chứa phải khô ráo, có kệ kê cao cách mặt đất tối thiểu 10cm, cách tường 20cm, có bảng nội quy và bình chữa cháy đúng quy chuẩn.${liveHeadlinesSection}`;
  }

  // ---------------------------------------------------------------------------
  // 11. INTERNAL COMPREHENSIVE BUSINESS REPORT (Only when explicitly asking for warehouse report/revenue/profit!)
  // ---------------------------------------------------------------------------
  const isExplicitInternalReport = hasAnyKeyword(q, [
    'báo cáo',
    'doanh thu',
    'lợi nhuận',
    'lãi gộp',
    'tổng hợp kho',
    'tình hình kho',
    'kết quả kinh doanh',
    'hóa đơn bán',
    'đơn bán hàng',
    'bán hàng của kho',
    'thống kê kho',
  ]);

  if (isExplicitInternalReport) {
    const topProdText =
      snapshot.topSellingProducts.length > 0
        ? snapshot.topSellingProducts
            .slice(0, 5)
            .map(
              (p, i) =>
                `${i + 1}. **${p.name}**: ${p.quantitySold} ${p.unit} (**${formatVND(p.revenue)}**)`
            )
            .join('\n')
        : '- Chưa có dữ liệu bán hàng.';

    return `### Báo cáo Tổng hợp Hoạt động Kinh doanh — ${snapshot.warehouseLabel}
*(Cập nhật thời gian thực ngày ${snapshot.generatedAt} cho tài khoản **${snapshot.staffDisplayName}**)*

#### 1. Doanh thu & Lợi nhuận
- **Tổng doanh thu bán hàng (${snapshot.salesCount} đơn):** **${formatVND(snapshot.totalSalesRevenue)}**
- **Đã thu tiền khi bán:** **${formatVND(snapshot.totalSalesCollected)}**
- **Giá vốn hàng bán ước tính:** **${formatVND(snapshot.estimatedCogs)}**
- **Lợi nhuận gộp ước tính:** **${formatVND(snapshot.estimatedGrossProfit)}**

#### 2. Công nợ & Dòng tiền
- **Công nợ phải thu Khách hàng (${snapshot.debtorCustomers.length} KH đang nợ):** **${formatVND(
      snapshot.totalCustomerDebt
    )}**
- **Công nợ phải trả Nhà cung cấp (${snapshot.creditorSuppliers.length} NCC):** **${formatVND(
      snapshot.totalSupplierDebt
    )}**
- **Tổng dòng tiền Thu vào (Bán hàng + ${snapshot.receiptVouchersCount} phiếu thu):** **${formatVND(
      snapshot.totalCashIn
    )}**
- **Tổng dòng tiền Chi ra (Nhập hàng + ${snapshot.paymentVouchersCount} phiếu chi):** **${formatVND(
      snapshot.totalCashOut
    )}**
- **Dòng tiền thuần hiện tại:** **${formatVND(snapshot.netCashFlow)}**

#### 3. Tồn kho Vật tư (${snapshot.productsCount} mặt hàng)
- **Giá trị tồn kho theo giá vốn:** **${formatVND(snapshot.totalInventoryCostValue)}**
- **Cảnh báo tồn kho:** **${snapshot.outOfStockProducts.length} mặt hàng hết hàng**, **${
      snapshot.lowStockProducts.length
    } mặt hàng sắp hết**

#### 4. Top mặt hàng doanh thu cao nhất
${topProdText}`;
  }

  // ---------------------------------------------------------------------------
  // 12. GENERAL / OPEN EXTERNAL QUERY OR GREETING (Never dump 0đ report for non-report questions!)
  // ---------------------------------------------------------------------------
  if (liveSources && liveSources.length > 0) {
    return `### Kết quả Phân tích & Tra cứu Trực tuyến cho: "${cleanDisplayQuery}"
${liveHeadlinesSection}

---
*Bạn có thể nhấn vào từng đường dẫn nguồn tin phía dưới để xem bài viết chi tiết, hoặc đặt câu hỏi cụ thể hơn về giá phân bón, giá lúa, kỹ thuật cây trồng và số liệu báo cáo kho **${snapshot.warehouseLabel}**.*`;
  }

  const isGreeting =
    cleanDisplayQuery.length <= 40 &&
    hasAnyKeyword(q, ['xin chào', 'chào bạn', 'hello', 'hi', 'hướng dẫn']);

  if (!isGreeting && classifyWarehouseQueryScope(userQuery, snapshot) === 'external') {
    return `### Hiện chưa kết nối được máy chủ Gemini A.I trực tuyến

Tôi đã nhận câu hỏi: **"${cleanDisplayQuery}"**.

Đây là câu hỏi tra cứu thông tin sản phẩm / thị trường bên ngoài ứng dụng nên cần kết nối **Gemini 4 Hydrogen + Tìm kiếm Google** trực tuyến để trả lời chính xác thay vì suy đoán mẫu cứng.

- Vui lòng kiểm tra kết nối mạng hoặc bấm gửi lại sau vài giây.
- Trong lúc chờ kết nối, bạn vẫn có thể hỏi trực tiếp các báo cáo nội bộ của kho **${snapshot.warehouseLabel}** (doanh thu, tồn kho, công nợ khách hàng, nợ nhà cung cấp, dòng tiền) hoặc giá phân bón, giá lúa OM18/ST25, kỹ thuật canh tác.`;
  }

  return `### Trợ lý A.I — Giải đáp cho yêu cầu: "${cleanDisplayQuery}"

Tôi có thể hỗ trợ bạn tra cứu chính xác cả **thông tin thị trường & kỹ thuật nông nghiệp bên ngoài** lẫn **số liệu báo cáo trực tiếp của kho ${snapshot.warehouseLabel}**:

#### 1. Tra cứu Giá cả Thị trường & Kỹ thuật Nông nghiệp (Ngoài ứng dụng)
- **Giá phân bón hiện nay:** Urê Phú Mỹ/Cà Mau (**570.000 – 640.000 đ/bao**), DAP (**830.000 – 1.260.000 đ/bao**), Kali (**550.000 – 670.000 đ/bao**), NPK 20-20-15 (**730.000 – 870.000 đ/bao**).
- **Giá lúa tươi tại ruộng ĐBSCL:** OM18 & Đài Thơm 8 (**6.600 – 7.200 đ/kg**), OM5451 (**6.000 – 6.400 đ/kg**), IR50404 (**5.600 – 6.000 đ/kg**), ST24/ST25 (**8.400 – 9.600 đ/kg**).
- **Phác đồ kỹ thuật:** Tư vấn bón phân đón đòng, trị đạo ôn, rầy nâu, cháy bìa lá trên lúa; làm bông, chống rụng trái non và trị xì mủ trên sầu riêng.

#### 2. Số liệu Nhanh hiện tại của Kho ${snapshot.warehouseLabel} (Trong ứng dụng)
- **Doanh thu bán hàng (${snapshot.salesCount} đơn):** **${formatVND(snapshot.totalSalesRevenue)}** · **Lợi nhuận gộp:** **${formatVND(snapshot.estimatedGrossProfit)}**
- **Nợ phải thu Khách hàng (${snapshot.debtorCustomers.length} KH):** **${formatVND(snapshot.totalCustomerDebt)}** · **Nợ phải trả NCC:** **${formatVND(snapshot.totalSupplierDebt)}**
- **Danh mục tồn kho:** **${snapshot.productsCount} mặt hàng** (Giá trị tồn: **${formatVND(snapshot.totalInventoryCostValue)}**)

*Hãy nhập câu hỏi cụ thể (ví dụ: "Giá phân bón hiện nay thế nào?", "Giá lúa OM18 hôm nay", "Khách hàng nào đang nợ?", "Tư vấn trị đạo ôn lúa") để tôi phân tích chi tiết ngay cho bạn!*`;
}

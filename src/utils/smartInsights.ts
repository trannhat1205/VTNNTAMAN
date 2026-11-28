import type { CustomerProfile, ProductItem, SaleTransaction } from '../types';
import type { PosCartDraftItem } from './smartPosFeatures';

const DAY_MS = 24 * 60 * 60 * 1000;

function toMs(iso: string | undefined | null): number {
  if (!iso) return NaN;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : NaN;
}

/* ---------------------------------------------------------------- D1: margin */

export interface MarginInfo {
  profitPerUnit: number;
  /** Gross margin on selling price, one decimal (e.g. 23.5). */
  marginPct: number;
  /** Markup on cost, one decimal. */
  markupPct: number;
}

export function computeMarginInfo(sellPrice: number, importPrice: number): MarginInfo {
  const sell = Math.max(0, Number(sellPrice) || 0);
  const cost = Math.max(0, Number(importPrice) || 0);
  const profit = sell - cost;
  return {
    profitPerUnit: profit,
    marginPct: sell > 0 ? Math.round((profit / sell) * 1000) / 10 : 0,
    markupPct: cost > 0 ? Math.round((profit / cost) * 1000) / 10 : 0,
  };
}

/** Suggested selling price = cost + markup%, rounded to the nearest 1.000 đ. */
export function priceFromMarkup(importPrice: number, markupPct: number): number {
  const cost = Math.max(0, Number(importPrice) || 0);
  const m = Math.max(0, Number(markupPct) || 0);
  if (cost <= 0) return 0;
  return Math.round((cost * (1 + m / 100)) / 1000) * 1000;
}

/* ----------------------------------------------------- D2: smart min-stock */

function saleMatchesProduct(s: SaleTransaction, p: Pick<ProductItem, 'id'>): boolean {
  return s.productId === p.id;
}

export function suggestMinStockFromVelocity(
  product: Pick<ProductItem, 'id'>,
  sales: SaleTransaction[],
  options: { windowDays?: number; leadDays?: number; safety?: number; nowMs?: number } = {}
): number | null {
  const windowDays = Math.max(1, options.windowDays ?? 30);
  const leadDays = Math.max(1, options.leadDays ?? 7);
  const safety = Math.max(1, options.safety ?? 1.5);
  const nowMs = options.nowMs ?? Date.now();
  const since = nowMs - windowDays * DAY_MS;
  let qty = 0;
  for (const s of sales) {
    if (!saleMatchesProduct(s, product)) continue;
    const ms = toMs(s.createdAt);
    if (!Number.isFinite(ms) || ms < since || ms > nowMs + DAY_MS) continue;
    qty += Math.max(0, Number(s.quantity) || 0) + (s.giftProductId === product.id ? Math.max(0, Number(s.giftQuantity) || 0) : 0);
  }
  if (qty <= 0) return null;
  const daily = qty / windowDays;
  return Math.max(1, Math.ceil(daily * leadDays * safety));
}

/* ------------------------------------------------------------ D3: credit */

export type CreditGrade = 'A' | 'B' | 'C' | 'D';

export interface CustomerCreditGradeResult {
  grade: CreditGrade;
  totalDebt: number;
  overdueAmount: number;
  maxOverdueDays: number;
}

/**
 * Pure credit grade from a customer's own sales (no interest, no season-based debt):
 * A = no overdue · B = overdue ≤ 30 days · C = 31–60 days · D = > 60 days or overdue > 50% of debt.
 */
export function computeCustomerCreditGrade(
  customerSales: SaleTransaction[],
  nowMs: number = Date.now()
): CustomerCreditGradeResult {
  let totalDebt = 0;
  let overdueAmount = 0;
  let maxOverdueDays = 0;
  for (const s of customerSales) {
    const debt = Math.max(0, Number(s.debtAmount) || 0);
    if (debt <= 0) continue;
    totalDebt += debt;
    const dueMs = toMs(s.dueDate);
    if (!Number.isFinite(dueMs)) continue;
    // A debt is overdue once the whole due day has passed
    const days = Math.floor((nowMs - (dueMs + DAY_MS)) / DAY_MS) + 1;
    if (nowMs >= dueMs + DAY_MS && days > 0) {
      overdueAmount += debt;
      maxOverdueDays = Math.max(maxOverdueDays, days);
    }
  }
  let grade: CreditGrade = 'A';
  if (overdueAmount > 0) {
    if (maxOverdueDays > 60 || overdueAmount > totalDebt * 0.5) grade = 'D';
    else if (maxOverdueDays > 30) grade = 'C';
    else grade = 'B';
  }
  return { grade, totalDebt, overdueAmount, maxOverdueDays };
}

export function isOverCreditLimit(totalDebt: number, creditLimit: number | undefined | null): boolean {
  const limit = Math.max(0, Number(creditLimit) || 0);
  return limit > 0 && (Number(totalDebt) || 0) > limit;
}

export function matchCustomerSales(customer: Pick<CustomerProfile, 'id'>, sales: SaleTransaction[]): SaleTransaction[] {
  return sales.filter((s) => s.customerId === customer.id);
}

/* ------------------------------------------------- D4: bought together */

export interface FrequentlyBoughtItem {
  productId: string;
  productName: string;
  unit: string;
  count: number;
}

function invoiceKey(s: SaleTransaction): string {
  if (s.invoiceGroupId) return `g:${s.invoiceGroupId}`;
  return `i:${s.invoiceCode}|${s.customerId}|${(s.createdAt || '').slice(0, 10)}`;
}

export function computeFrequentlyBoughtTogether(
  sales: SaleTransaction[],
  productId: string,
  topN = 3
): FrequentlyBoughtItem[] {
  const groups = new Map<string, SaleTransaction[]>();
  for (const s of sales) {
    const k = invoiceKey(s);
    const arr = groups.get(k);
    if (arr) arr.push(s);
    else groups.set(k, [s]);
  }
  const counts = new Map<string, FrequentlyBoughtItem>();
  for (const rows of groups.values()) {
    if (!rows.some((r) => r.productId === productId)) continue;
    const seen = new Set<string>();
    for (const r of rows) {
      if (r.productId === productId || seen.has(r.productId)) continue;
      seen.add(r.productId);
      const cur = counts.get(r.productId);
      if (cur) cur.count += 1;
      else counts.set(r.productId, { productId: r.productId, productName: r.productName, unit: r.unit, count: 1 });
    }
  }
  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count || a.productName.localeCompare(b.productName, 'vi'))
    .slice(0, Math.max(0, topN));
}

/* --------------------------------------------------------- D5: slow moving */

export function isSlowMovingProduct(
  product: Pick<ProductItem, 'id' | 'stock'>,
  sales: SaleTransaction[],
  nowMs: number = Date.now(),
  days = 60
): boolean {
  if ((Number(product.stock) || 0) <= 0) return false;
  const since = nowMs - days * DAY_MS;
  return !sales.some((s) => {
    if (s.productId !== product.id) return false;
    const ms = toMs(s.createdAt);
    return Number.isFinite(ms) && ms >= since;
  });
}

/* --------------------------------------------------- E3: customer-group price */

export function resolveCustomerGroupPrice(
  product: Pick<ProductItem, 'sellPrice'> & { groupPrices?: Record<string, number> },
  group: string | undefined | null
): { price: number; isGroupPrice: boolean } {
  const base = Math.max(0, Number(product.sellPrice) || 0);
  const special = group ? Number(product.groupPrices?.[group]) : NaN;
  if (Number.isFinite(special) && special > 0) {
    return { price: Math.round(special), isGroupPrice: Math.round(special) !== base };
  }
  return { price: base, isGroupPrice: false };
}

/* ------------------------------------------------------ E2: parked orders */

export const PARKED_ORDERS_STORAGE_KEY = 'vtnn_taman_parked_orders_v1';
export const MAX_PARKED_ORDERS = 20;

export interface ParkedOrder {
  id: string;
  label: string;
  customerId: string;
  customerName: string;
  warehouse: string;
  items: PosCartDraftItem[];
  createdAt: string;
}

export function loadParkedOrders(storage?: Pick<Storage, 'getItem'>): ParkedOrder[] {
  try {
    const s = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    if (!s) return [];
    const raw = s.getItem(PARKED_ORDERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (o): o is ParkedOrder =>
          o && typeof o.id === 'string' && Array.isArray(o.items) && o.items.length > 0
      )
      .slice(0, MAX_PARKED_ORDERS);
  } catch {
    return [];
  }
}

export function saveParkedOrders(
  orders: ParkedOrder[],
  storage?: Pick<Storage, 'setItem'>
): boolean {
  try {
    const s = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    if (!s) return false;
    s.setItem(PARKED_ORDERS_STORAGE_KEY, JSON.stringify(orders.slice(0, MAX_PARKED_ORDERS)));
    return true;
  } catch {
    return false;
  }
}

/** Adds a new parked order at the top, dropping the oldest beyond the limit. */
export function addParkedOrder(orders: ParkedOrder[], order: ParkedOrder): ParkedOrder[] {
  return [order, ...orders.filter((o) => o.id !== order.id)].slice(0, MAX_PARKED_ORDERS);
}

/* ------------------------------------------------------ E1: shift close */

export interface ShiftCloseInput {
  salesInitialPaidInflow: number;
  importsInitialPaidOutflow: number;
  receipts: Array<{ amount: number; paymentMethod: string }>;
  payments: Array<{ amount: number; paymentMethod: string }>;
  openingCash: number;
  countedCash: number | null;
}

export interface ShiftCloseSummary {
  cashIn: number;
  cashOut: number;
  nonCashIn: number;
  nonCashOut: number;
  expectedCash: number;
  difference: number | null;
  byMethodIn: Record<string, number>;
  byMethodOut: Record<string, number>;
}

export function isCashPaymentMethod(method: string | undefined | null): boolean {
  const m = (method || '').toLowerCase();
  return !m.trim() || /ti[eề]n\s*m[aặ]t|cash/.test(m) || m.normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes('tien mat');
}

/**
 * End-of-day cash drawer: counter sales / counter purchases are treated as cash; PT/PC vouchers are split by payment method.
 * expectedCash = opening + cash sales + cash PT − cash purchases − cash PC.
 */
export function computeShiftCloseSummary(input: ShiftCloseInput): ShiftCloseSummary {
  const byMethodIn: Record<string, number> = {};
  const byMethodOut: Record<string, number> = {};
  let cashPt = 0;
  let nonCashIn = 0;
  const isContraMethod = (m: string | undefined | null): boolean =>
    (m || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().trim() ===
    'can tru cong no';
  for (const r of input.receipts) {
    if (isContraMethod(r.paymentMethod)) continue;
    const amt = Math.max(0, Number(r.amount) || 0);
    const key = (r.paymentMethod || 'Tiền mặt').trim() || 'Tiền mặt';
    byMethodIn[key] = (byMethodIn[key] || 0) + amt;
    if (isCashPaymentMethod(r.paymentMethod)) cashPt += amt;
    else nonCashIn += amt;
  }
  let cashPc = 0;
  let nonCashOut = 0;
  for (const p of input.payments) {
    if (isContraMethod(p.paymentMethod)) continue;
    const amt = Math.max(0, Number(p.amount) || 0);
    const key = (p.paymentMethod || 'Tiền mặt').trim() || 'Tiền mặt';
    byMethodOut[key] = (byMethodOut[key] || 0) + amt;
    if (isCashPaymentMethod(p.paymentMethod)) cashPc += amt;
    else nonCashOut += amt;
  }
  const cashIn = Math.max(0, Number(input.salesInitialPaidInflow) || 0) + cashPt;
  const cashOut = Math.max(0, Number(input.importsInitialPaidOutflow) || 0) + cashPc;
  const expectedCash = Math.round((Number(input.openingCash) || 0) + cashIn - cashOut);
  const difference =
    input.countedCash === null || !Number.isFinite(Number(input.countedCash))
      ? null
      : Math.round(Number(input.countedCash) - expectedCash);
  return { cashIn, cashOut, nonCashIn, nonCashOut, expectedCash, difference, byMethodIn, byMethodOut };
}

/* -------------------------------------------- Phase 2B: import markup helper */

export const VTNN_MARKUP_PRESETS = [10, 15, 20, 25, 30] as const;

export interface ImportSellPricePreset {
  markupPct: number;
  sellPrice: number;
  profitPerUnit: number;
  marginPct: number;
}

export interface ImportSellPriceSuggestion {
  previousStock: number;
  previousImportPrice: number;
  incomingQty: number;
  incomingUnitCost: number;
  newWeightedImportPrice: number;
  costDeltaVsPrevAvg: number;
  costDeltaPctVsPrevAvg: number;
  currentSellPrice: number;
  currentMarginAfterImport: MarginInfo;
  isCurrentSellBelowOrEqualNewCost: boolean;
  presets: ImportSellPricePreset[];
}

/**
 * Computes the projected weighted-average cost after an import and suggests retail prices at
 * +10% / +15% / +20% / +25% / +30% markup (rounded cleanly to 1.000 đ, or 100 đ for low-cost items).
 */
export function computeImportSellPriceSuggestion(params: {
  previousStock: number;
  previousImportPrice: number;
  currentSellPrice: number;
  incomingQty: number;
  incomingUnitCost: number;
}): ImportSellPriceSuggestion {
  const prevStock = Math.max(0, Number(params.previousStock) || 0);
  const prevCost = Math.max(0, Math.round(Number(params.previousImportPrice) || 0));
  const curSell = Math.max(0, Math.round(Number(params.currentSellPrice) || 0));
  const inQty = Math.max(0, Number(params.incomingQty) || 0);
  const inCost = Math.max(0, Math.round(Number(params.incomingUnitCost) || 0));

  const newWeightedImportPrice =
    prevStock > 0 && prevCost > 0 && inQty > 0
      ? Math.round((prevStock * prevCost + inQty * inCost) / (prevStock + inQty))
      : inCost > 0
      ? inCost
      : prevCost;

  const costDeltaVsPrevAvg = prevCost > 0 ? newWeightedImportPrice - prevCost : 0;
  const costDeltaPctVsPrevAvg =
    prevCost > 0 ? Math.round((costDeltaVsPrevAvg / prevCost) * 1000) / 10 : 0;

  const currentMarginAfterImport = computeMarginInfo(curSell, newWeightedImportPrice);
  const isCurrentSellBelowOrEqualNewCost =
    newWeightedImportPrice > 0 && curSell <= newWeightedImportPrice;

  const presets: ImportSellPricePreset[] = VTNN_MARKUP_PRESETS.map((pct) => {
    const roundedThousand = priceFromMarkup(newWeightedImportPrice, pct);
    const exactTarget = newWeightedImportPrice * (1 + pct / 100);
    const sellPrice =
      newWeightedImportPrice <= 0
        ? 0
        : roundedThousand > newWeightedImportPrice
        ? roundedThousand
        : Math.ceil(exactTarget / 100) * 100;
    const m = computeMarginInfo(sellPrice, newWeightedImportPrice);
    return {
      markupPct: pct,
      sellPrice,
      profitPerUnit: m.profitPerUnit,
      marginPct: m.marginPct,
    };
  });

  return {
    previousStock: prevStock,
    previousImportPrice: prevCost,
    incomingQty: inQty,
    incomingUnitCost: inCost,
    newWeightedImportPrice,
    costDeltaVsPrevAvg,
    costDeltaPctVsPrevAvg,
    currentSellPrice: curSell,
    currentMarginAfterImport,
    isCurrentSellBelowOrEqualNewCost,
    presets,
  };
}

/* ------------------------------------------- Phase 2C: sale loss guard */

export interface SaleLineProfitInput {
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  discountAmount?: number;
  giftProductName?: string;
  giftQuantity?: number;
  giftUnitCost?: number;
}

export interface SaleOrderProfitabilityEvaluation {
  hasItems: boolean;
  grossRevenue: number;
  totalDiscount: number;
  netRevenue: number;
  productCogs: number;
  giftPromoCost: number;
  totalCost: number;
  estimatedGrossProfit: number;
  grossMarginPct: number;
  markupOnCostPct: number;
  maxBreakEvenDiscount: number;
  lossAmount: number;
  level: 'healthy' | 'break_even_supplier' | 'thin_margin' | 'loss';
  losingLines: Array<{
    productName: string;
    lineNet: number;
    lineCost: number;
    lineLoss: number;
  }>;
  reasons: string[];
}

/**
 * Evaluates real-time order profitability across main items, discounts, and promotional gifts so
 * cashiers immediately see if a discount, low selling price, or gift pushes the order into a loss.
 */
export function evaluateSaleOrderProfitability(
  lines: SaleLineProfitInput[],
  options?: { isSupplierSale?: boolean }
): SaleOrderProfitabilityEvaluation {
  const validLines = (lines || []).filter((l) => (Number(l.quantity) || 0) > 0);
  if (validLines.length === 0) {
    return {
      hasItems: false,
      grossRevenue: 0,
      totalDiscount: 0,
      netRevenue: 0,
      productCogs: 0,
      giftPromoCost: 0,
      totalCost: 0,
      estimatedGrossProfit: 0,
      grossMarginPct: 0,
      markupOnCostPct: 0,
      maxBreakEvenDiscount: 0,
      lossAmount: 0,
      level: 'healthy',
      losingLines: [],
      reasons: [],
    };
  }

  let grossRevenue = 0;
  let totalDiscount = 0;
  let productCogs = 0;
  let giftPromoCost = 0;
  let hasUnderCostUnitPrice = false;
  const losingLines: Array<{
    productName: string;
    lineNet: number;
    lineCost: number;
    lineLoss: number;
  }> = [];

  for (const l of validLines) {
    const qty = Math.max(0, Number(l.quantity) || 0);
    const price = Math.max(0, Math.round(Number(l.unitPrice) || 0));
    const cost = Math.max(0, Math.round(Number(l.unitCost) || 0));
    const lineGross = Math.round(qty * price);
    const lineDisc = Math.min(lineGross, Math.max(0, Math.round(Number(l.discountAmount) || 0)));
    const lineNet = Math.max(0, lineGross - lineDisc);
    const lineProdCost = Math.round(qty * cost);
    const gQty = Math.max(0, Number(l.giftQuantity) || 0);
    const gCost = Math.max(0, Math.round(Number(l.giftUnitCost) || 0));
    const lineGiftCost = Math.round(gQty * gCost);
    const lineCost = lineProdCost + lineGiftCost;

    if (price < cost) {
      hasUnderCostUnitPrice = true;
    }
    if (lineNet < lineCost) {
      losingLines.push({
        productName: l.productName,
        lineNet,
        lineCost,
        lineLoss: lineCost - lineNet,
      });
    }

    grossRevenue += lineGross;
    totalDiscount += lineDisc;
    productCogs += lineProdCost;
    giftPromoCost += lineGiftCost;
  }

  const netRevenue = Math.max(0, grossRevenue - totalDiscount);
  const totalCost = productCogs + giftPromoCost;
  const estimatedGrossProfit = netRevenue - totalCost;
  const maxBreakEvenDiscount = Math.max(0, grossRevenue - totalCost);
  const lossAmount = Math.max(0, -estimatedGrossProfit);
  const grossMarginPct =
    netRevenue > 0 ? Math.round((estimatedGrossProfit / netRevenue) * 1000) / 10 : 0;
  const markupOnCostPct =
    totalCost > 0 ? Math.round((estimatedGrossProfit / totalCost) * 1000) / 10 : 0;

  const reasons: string[] = [];
  if (estimatedGrossProfit < 0) {
    if (hasUnderCostUnitPrice) {
      reasons.push('Đơn giá bán đang thấp hơn giá vốn nhập kho.');
    }
    if (totalDiscount > 0 && grossRevenue - productCogs - giftPromoCost >= 0) {
      reasons.push('Số tiền giảm giá / chiết khấu vượt quá lợi nhuận gộp của đơn.');
    } else if (totalDiscount > 0 && !hasUnderCostUnitPrice) {
      reasons.push('Chiết khấu kết hợp quà tặng vượt quá biên lợi nhuận.');
    }
    if (giftPromoCost > 0 && netRevenue >= productCogs && netRevenue < totalCost) {
      reasons.push('Giá vốn hàng quà tặng khuyến mãi vượt quá lãi gộp còn lại.');
    }
    if (reasons.length === 0) {
      reasons.push('Tổng doanh thu thuần thấp hơn tổng giá vốn xuất kho.');
    }
  }

  let level: SaleOrderProfitabilityEvaluation['level'] = 'healthy';
  if (estimatedGrossProfit < 0) {
    level = 'loss';
  } else if (options?.isSupplierSale && estimatedGrossProfit === 0) {
    level = 'break_even_supplier';
  } else if (totalCost > 0 && (estimatedGrossProfit === 0 || grossMarginPct < 5)) {
    level = 'thin_margin';
  }

  return {
    hasItems: true,
    grossRevenue,
    totalDiscount,
    netRevenue,
    productCogs,
    giftPromoCost,
    totalCost,
    estimatedGrossProfit,
    grossMarginPct,
    markupOnCostPct,
    maxBreakEvenDiscount,
    lossAmount,
    level,
    losingLines,
    reasons,
  };
}


/* ------------------------------ Phase 3: Mobile UX, Sync Badge & Density */

export const COMMON_VTNN_UNITS = ['Chai', 'Gói', 'Cặp', 'Bao 50kg', 'Can 5L', 'Kg'] as const;

export type TableDensityMode = 'comfortable' | 'compact';

export const TABLE_DENSITY_STORAGE_KEY = 'vtnn_taman_table_density_v1';

export function loadTableDensity(
  storage?: Pick<Storage, 'getItem'> | null
): TableDensityMode {
  try {
    const target =
      storage !== undefined
        ? storage
        : typeof window !== 'undefined'
        ? window.localStorage
        : null;
    const raw = target?.getItem(TABLE_DENSITY_STORAGE_KEY);
    return raw === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

export function saveTableDensity(
  mode: TableDensityMode,
  storage?: Pick<Storage, 'setItem'> | null
): void {
  try {
    const target =
      storage !== undefined
        ? storage
        : typeof window !== 'undefined'
        ? window.localStorage
        : null;
    target?.setItem(TABLE_DENSITY_STORAGE_KEY, mode);
  } catch {
    // Ignore storage quota / private browsing errors
  }
}

export type RecordCloudSyncStatus = 'synced' | 'syncing' | 'offline_pending' | 'local_only';

export interface CloudSyncMeta {
  isOnline: boolean;
  isCloudAuthenticated: boolean;
  rtdbSyncState: 'connecting' | 'live' | 'offline';
  pendingSyncIds?: ReadonlySet<string>;
}

/**
 * Resolves the live cloud persistence badge state for a single voucher ID (or a grouped invoice's IDs).
 */
export function resolveRecordCloudSyncStatus(
  recordId: string | readonly string[],
  meta?: CloudSyncMeta
): RecordCloudSyncStatus | null {
  if (!meta) return null;
  const ids = Array.isArray(recordId) ? recordId : [recordId];
  const validIds = ids.filter((id) => Boolean(id));
  if (validIds.length === 0) return null;

  if (!meta.isCloudAuthenticated) {
    return 'local_only';
  }
  if (!meta.isOnline || meta.rtdbSyncState === 'offline') {
    return 'offline_pending';
  }
  const hasPending = Boolean(
    meta.pendingSyncIds && validIds.some((id) => meta.pendingSyncIds!.has(id))
  );
  if (hasPending || meta.rtdbSyncState === 'connecting') {
    return 'syncing';
  }
  return 'synced';
}


/* ---------------- Phase 4A: Excel Import Preview & Row-by-Row Validation */

import type { ImportTransaction, VietQrBankConfig } from '../types';
import {
  areWarehouseNamesEquivalent,
  buildZaloDebtReminderMessage,
  evaluateDebtUrgency,
  formatVND,
  getTodayVietnamDateStr,
  normalizeVietnameseSearch,
  readExcelNumber,
  type ZaloDebtVietQrSummary,
} from './businessLogic.ts';
import {
  buildVietQrImageUrl,
  isValidVietQrConfig,
  resolveVietnamBankLabel,
  sanitizeVietQrText,
} from './smartPosFeatures.ts';

export type ExcelPreviewModuleType = 'sales' | 'imports' | 'inventory' | 'customers' | 'debts';

export interface ExcelPreviewRowEntry {
  /** 1-based Excel spreadsheet row index (header is row 1, first data row is 2). */
  excelRowNumber: number;
  status: 'valid' | 'error';
  errors: string[];
  warnings: string[];
  cells: string[];
  normalizedRow: Record<string, unknown>;
}

export interface ExcelImportPreviewResult {
  moduleType: ExcelPreviewModuleType;
  columns: string[];
  rows: ExcelPreviewRowEntry[];
  totalNonEmptyRows: number;
  emptySkippedCount: number;
  validCount: number;
  errorCount: number;
  warningCount: number;
  validNormalizedRows: Record<string, unknown>[];
}

function readExcelText(row: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const val = row?.[key];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      return String(val).trim();
    }
  }
  return fallback;
}

function isCompletelyEmptyExcelRow(row: Record<string, unknown>): boolean {
  if (!row || typeof row !== 'object') return true;
  return Object.values(row).every(
    (v) => v === undefined || v === null || String(v).trim() === ''
  );
}

function hasAnyHeaderPresent(row: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((k) => {
    const v = row?.[k];
    return v !== undefined && v !== null && String(v).trim() !== '';
  });
}

/**
 * Validates and previews uploaded Excel rows line-by-line before mutating state.
 * Normalizes flexible Vietnamese header aliases into canonical keys expected by `App.tsx` handlers.
 */
export function validateAndPreviewExcelImportRows(params: {
  moduleType: ExcelPreviewModuleType;
  rows: Record<string, unknown>[];
  existingProducts?: ProductItem[];
  existingSales?: SaleTransaction[];
  existingImports?: ImportTransaction[];
  lockedWarehouse?: string | null;
  defaultWarehouse?: string;
}): ExcelImportPreviewResult {
  const {
    moduleType,
    rows = [],
    existingProducts = [],
    existingSales = [],
    existingImports = [],
    lockedWarehouse = null,
    defaultWarehouse = 'Tâm An Mỹ Ngãi',
  } = params;

  const columnsByModule: Record<ExcelPreviewModuleType, string[]> = {
    inventory: ['Kho', 'Mã VT', 'Tên vật tư', 'ĐVT', 'Giá nhập', 'Giá bán', 'Tồn đầu'],
    customers: ['Mã KH', 'Họ tên KH', 'SĐT', 'Nhóm KH', 'Địa chỉ', 'Dư nợ cũ'],
    sales: ['Kho xuất', 'Khách hàng', 'Vật tư xuất', 'SL', 'Đơn giá bán', 'Đã thu'],
    imports: ['Kho nhập', 'Nhà cung cấp', 'Vật tư nhập', 'SL', 'Đơn giá nhập', 'Đã trả NCC'],
    debts: ['Loại', 'Mã HĐ / PN', 'Đối tác', 'Số tiền thanh toán', 'Dư nợ hiện tại'],
  };

  const previewRows: ExcelPreviewRowEntry[] = [];
  let emptySkippedCount = 0;

  // Track cumulative stock deductions across multiple rows of the same Excel upload in `sales`
  const cumulativeSaleOutByProdId = new Map<string, number>();
  // Track remaining debt across multiple rows of the same voucher in `debts`
  const remainingSaleDebtByCode = new Map<string, number>();
  for (const s of existingSales) {
    if (s.debtAmount > 0) {
      remainingSaleDebtByCode.set(
        s.invoiceCode,
        (remainingSaleDebtByCode.get(s.invoiceCode) || 0) + s.debtAmount
      );
    }
  }
  const remainingImportDebtByCode = new Map<string, number>();
  for (const imp of existingImports) {
    if (imp.debtAmount > 0) {
      remainingImportDebtByCode.set(
        imp.receiptCode,
        (remainingImportDebtByCode.get(imp.receiptCode) || 0) + imp.debtAmount
      );
    }
  }

  rows.forEach((rawRow, idx) => {
    if (isCompletelyEmptyExcelRow(rawRow)) {
      emptySkippedCount += 1;
      return;
    }
    const excelRowNumber = idx + 2;
    const errors: string[] = [];
    const warnings: string[] = [];

    if (moduleType === 'inventory') {
      const name = readExcelText(rawRow, [
        'Tên Vật Tư Nông Nghiệp',
        'Tên Vật Tư',
        'Tên SP',
        'Tên Hàng',
        'Sản Phẩm',
        'name',
      ]);
      const code = readExcelText(rawRow, ['Mã VT', 'Mã Vật Tư', 'Mã Hàng', 'Mã SP', 'SKU', 'code']);
      const unit = readExcelText(rawRow, ['Đơn Vị Tính', 'Đơn Vị', 'ĐVT', 'unit'], 'Bao');
      const category = readExcelText(
        rawRow,
        ['Nhóm Vật Tư', 'Nhóm Hàng', 'Danh Mục'],
        'Phân bón'
      );
      const supplier = readExcelText(
        rawRow,
        ['Nhà Cung Cấp Chính', 'Nhà Cung Cấp', 'NCC'],
        'Nhà cung cấp VTNN'
      );
      const wh =
        lockedWarehouse ||
        readExcelText(rawRow, ['Kho Lưu Trữ', 'Kho', 'Kho Hàng'], defaultWarehouse);
      const importPrice = readExcelNumber(
        rawRow,
        ['Giá Nhập (VNĐ)', 'Giá Nhập (đ)', 'Giá Nhập', 'Giá Vốn'],
        0
      );
      const sellPrice = readExcelNumber(
        rawRow,
        ['Giá Bán Lẻ (VNĐ)', 'Giá Bán (đ)', 'Giá Bán Lẻ', 'Giá Bán'],
        0
      );
      const stock = readExcelNumber(
        rawRow,
        ['Tồn Kho Ban Đầu', 'Tồn Kho Hiện Tại', 'Tồn Kho', 'Số Lượng Tồn'],
        10
      );
      const minStock = readExcelNumber(
        rawRow,
        ['Mức Cảnh Báo Tối Thiểu', 'Mức Tối Thiểu', 'Định Mức Tối Thiểu'],
        5
      );

      if (!name) errors.push('Thiếu Tên vật tư nông nghiệp.');
      if (!Number.isFinite(importPrice) || importPrice < 0) {
        errors.push('Giá nhập không hợp lệ hoặc bị âm.');
      }
      if (!Number.isFinite(sellPrice) || sellPrice < 0) {
        errors.push('Giá bán lẻ không hợp lệ hoặc bị âm.');
      }
      if (!Number.isFinite(stock) || stock < 0) {
        errors.push('Tồn kho ban đầu không hợp lệ hoặc bị âm.');
      }
      if (!Number.isFinite(minStock) || minStock < 0) {
        errors.push('Mức cảnh báo tối thiểu không hợp lệ hoặc bị âm.');
      }
      if (errors.length === 0) {
        if (importPrice === 0 && sellPrice === 0) {
          warnings.push('Giá nhập & Giá bán đang là 0 đ — nên cập nhật giá thực tế.');
        } else if (sellPrice > 0 && sellPrice < importPrice) {
          warnings.push(`Giá bán (${formatVND(sellPrice)}) thấp hơn giá nhập (${formatVND(importPrice)}).`);
        }
        if (
          code &&
          existingProducts.some(
            (p) =>
              p.code.trim().toUpperCase() === code.toUpperCase() &&
              areWarehouseNamesEquivalent(p.warehouseName || defaultWarehouse, wh)
          )
        ) {
          warnings.push(`Mã VT "${code}" đã tồn tại trong kho ${wh}.`);
        }
      }

      previewRows.push({
        excelRowNumber,
        status: errors.length > 0 ? 'error' : 'valid',
        errors,
        warnings,
        cells: [
          wh,
          code || '(Tự sinh)',
          name || '—',
          unit,
          Number.isFinite(importPrice) ? formatVND(importPrice) : 'Lỗi số',
          Number.isFinite(sellPrice) ? formatVND(sellPrice) : 'Lỗi số',
          Number.isFinite(stock) ? String(Math.round(stock)) : 'Lỗi số',
        ],
        normalizedRow: {
          ...rawRow,
          'Kho Lưu Trữ': wh,
          'Mã VT': code,
          'Tên Vật Tư Nông Nghiệp': name,
          'Nhóm Vật Tư': category,
          'Đơn Vị Tính': unit,
          'Giá Nhập (VNĐ)': Number.isFinite(importPrice) ? Math.round(importPrice) : 0,
          'Giá Bán Lẻ (VNĐ)': Number.isFinite(sellPrice) ? Math.round(sellPrice) : 0,
          'Tồn Kho Ban Đầu': Number.isFinite(stock) ? Math.round(stock) : 0,
          'Mức Cảnh Báo Tối Thiểu': Number.isFinite(minStock) ? Math.round(minStock) : 5,
          'Nhà Cung Cấp Chính': supplier,
        },
      });
      return;
    }

    if (moduleType === 'customers') {
      const code = readExcelText(rawRow, ['Mã KH', 'Mã Khách Hàng', 'code']);
      const name = readExcelText(rawRow, [
        'Họ Tên Khách Hàng',
        'Tên Khách Hàng',
        'Họ Và Tên',
        'Khách Hàng',
        'name',
      ]);
      const phone = readExcelText(rawRow, [
        'Số Điện Thoại',
        'Số Điện Thoại KH',
        'SĐT',
        'Điện Thoại',
        'phone',
      ]);
      const group = readExcelText(
        rawRow,
        ['Nhóm Khách Hàng', 'Nhóm KH', 'Phân Nhóm'],
        'Nhà nông'
      );
      const address = readExcelText(rawRow, ['Địa Chỉ', 'Địa Chỉ KH', 'address']);
      const email = readExcelText(rawRow, ['Email', 'email']);
      const note = readExcelText(rawRow, ['Ghi Chú', 'note'], 'Nhập từ biểu mẫu Excel');
      const totalPurchased = readExcelNumber(rawRow, ['Tổng Mua (VNĐ)', 'Tổng Mua'], 0);
      const totalDebt = readExcelNumber(
        rawRow,
        ['Dư Nợ Hiện Tại (VNĐ)', 'Dư Nợ Hiện Tại', 'Công Nợ'],
        0
      );

      if (!name) errors.push('Thiếu Họ tên khách hàng.');
      if (!Number.isFinite(totalPurchased) || totalPurchased < 0) {
        errors.push('Tổng mua không hợp lệ hoặc bị âm.');
      }
      if (!Number.isFinite(totalDebt) || totalDebt < 0) {
        errors.push('Dư nợ hiện tại không hợp lệ hoặc bị âm.');
      }
      if (errors.length === 0 && !phone) {
        warnings.push('Chưa có Số điện thoại (có thể bổ sung sau).');
      }

      previewRows.push({
        excelRowNumber,
        status: errors.length > 0 ? 'error' : 'valid',
        errors,
        warnings,
        cells: [
          code || '(Tự sinh)',
          name || '—',
          phone || '—',
          group,
          address || '—',
          Number.isFinite(totalDebt) ? formatVND(totalDebt) : 'Lỗi số',
        ],
        normalizedRow: {
          ...rawRow,
          'Mã KH': code,
          'Họ Tên Khách Hàng': name,
          'Số Điện Thoại': phone,
          Email: email,
          'Địa Chỉ': address,
          'Nhóm Khách Hàng': group,
          'Ghi Chú': note,
          'Tổng Mua (VNĐ)': Number.isFinite(totalPurchased) ? Math.round(totalPurchased) : 0,
          'Dư Nợ Hiện Tại (VNĐ)': Number.isFinite(totalDebt) ? Math.round(totalDebt) : 0,
        },
      });
      return;
    }

    if (moduleType === 'sales') {
      const wh =
        lockedWarehouse ||
        readExcelText(rawRow, ['Kho Xuất Bán', 'Kho Xuất', 'Kho'], defaultWarehouse);
      const custName = readExcelText(rawRow, [
        'Tên Khách Hàng',
        'Khách Hàng',
        'Họ Tên Khách Hàng',
      ]);
      const custPhone = readExcelText(rawRow, ['Số Điện Thoại KH', 'Số Điện Thoại', 'SĐT']);
      const prodName = readExcelText(rawRow, [
        'Tên Vật Tư Nông Nghiệp',
        'Sản Phẩm',
        'Tên Vật Tư',
        'Mặt Hàng',
      ]);
      const unit = readExcelText(rawRow, ['Đơn Vị', 'Đơn Vị Tính', 'ĐVT'], 'Bao');
      const qty = readExcelNumber(rawRow, ['Số Lượng Bán', 'Số Lượng', 'SL'], 1);
      const price = readExcelNumber(
        rawRow,
        ['Đơn Giá Bán (VNĐ)', 'Đơn Giá (đ)', 'Đơn Giá Bán', 'Đơn Giá'],
        0
      );
      const fallbackPaid = Number.isFinite(qty) && Number.isFinite(price) ? qty * price : 0;
      const paid = readExcelNumber(
        rawRow,
        ['Khách Đã Trả (VNĐ)', 'Đã Thu (đ)', 'Khách Đã Trả', 'Đã Thanh Toán'],
        fallbackPaid
      );

      if (!custName) errors.push('Thiếu Tên khách hàng.');
      if (!prodName) errors.push('Thiếu Tên vật tư xuất bán.');
      if (!Number.isFinite(qty) || qty <= 0) errors.push('Số lượng bán phải lớn hơn 0.');
      if (!Number.isFinite(price) || price < 0) errors.push('Đơn giá bán không hợp lệ hoặc bị âm.');
      if (!Number.isFinite(paid) || paid < 0) errors.push('Số tiền đã thu không hợp lệ hoặc bị âm.');

      const matchedProd = prodName
        ? existingProducts.find(
            (p) =>
              (!p.warehouseName || !wh || areWarehouseNamesEquivalent(p.warehouseName, wh)) &&
              normalizeVietnameseSearch(p.name) === normalizeVietnameseSearch(prodName)
          )
        : undefined;

      if (errors.length === 0) {
        if (matchedProd) {
          const prevUsed = cumulativeSaleOutByProdId.get(matchedProd.id) || 0;
          if (matchedProd.stock < prevUsed + qty) {
            errors.push(
              `Vượt tồn kho "${matchedProd.name}" tại ${wh} (cần xuất ${prevUsed + qty}, tồn ${matchedProd.stock}).`
            );
          } else {
            cumulativeSaleOutByProdId.set(matchedProd.id, prevUsed + qty);
          }
        } else {
          warnings.push('Vật tư chưa có trong danh mục kho — sẽ ghi nhận theo tên trên Excel.');
        }
        if (price === 0) {
          warnings.push('Đơn giá bán đang bằng 0 đ.');
        }
      }

      previewRows.push({
        excelRowNumber,
        status: errors.length > 0 ? 'error' : 'valid',
        errors,
        warnings,
        cells: [
          wh,
          custName || '—',
          prodName || '—',
          Number.isFinite(qty) ? `${qty} ${matchedProd?.unit || unit}` : 'Lỗi số',
          Number.isFinite(price) ? formatVND(price) : 'Lỗi số',
          Number.isFinite(paid) ? formatVND(paid) : 'Lỗi số',
        ],
        normalizedRow: {
          ...rawRow,
          'Kho Xuất Bán': wh,
          'Tên Khách Hàng': custName,
          'Số Điện Thoại KH': custPhone,
          'Tên Vật Tư Nông Nghiệp': prodName,
          'Đơn Vị': matchedProd?.unit || unit,
          'Số Lượng Bán': Number.isFinite(qty) ? qty : 0,
          'Đơn Giá Bán (VNĐ)': Number.isFinite(price) ? Math.round(price) : 0,
          'Khách Đã Trả (VNĐ)': Number.isFinite(paid) ? Math.round(paid) : 0,
        },
      });
      return;
    }

    if (moduleType === 'imports') {
      const wh =
        lockedWarehouse ||
        readExcelText(rawRow, ['Kho Nhập Hàng', 'Kho Nhập', 'Kho'], defaultWarehouse);
      const prodName = readExcelText(rawRow, [
        'Tên Vật Tư Nhập Kho',
        'Sản Phẩm',
        'Tên Vật Tư',
        'Tên Vật Tư Nông Nghiệp',
      ]);
      const supName = readExcelText(rawRow, ['Nhà Cung Cấp', 'Tên Nhà Cung Cấp', 'NCC']);
      const supPhone = readExcelText(rawRow, ['SĐT Nhà Cung Cấp', 'SĐT NCC', 'Số Điện Thoại']);
      const unit = readExcelText(rawRow, ['Đơn Vị Tính', 'Đơn Vị', 'ĐVT'], 'Bao');
      const qty = readExcelNumber(rawRow, ['Số Lượng Nhập', 'Số Lượng', 'SL'], 1);
      const costHeaders = ['Đơn Giá Nhập (VNĐ)', 'Giá Nhập (đ)', 'Đơn Giá Nhập', 'Giá Nhập'];
      const cost = readExcelNumber(rawRow, costHeaders, 0);
      const fallbackPaid = Number.isFinite(qty) && Number.isFinite(cost) ? qty * cost : 0;
      const paid = readExcelNumber(
        rawRow,
        ['Đã Thanh Toán NCC (VNĐ)', 'Đã Trả NCC (đ)', 'Đã Thanh Toán NCC', 'Đã Trả'],
        fallbackPaid
      );

      if (!prodName) errors.push('Thiếu Tên vật tư nhập kho.');
      if (!supName) errors.push('Thiếu Tên nhà cung cấp.');
      if (!Number.isFinite(qty) || qty <= 0) errors.push('Số lượng nhập phải lớn hơn 0.');
      if (!Number.isFinite(cost) || cost < 0) errors.push('Đơn giá nhập không hợp lệ hoặc bị âm.');
      if (!Number.isFinite(paid) || paid < 0) errors.push('Số tiền đã trả NCC không hợp lệ hoặc bị âm.');

      if (errors.length === 0) {
        if (!hasAnyHeaderPresent(rawRow, costHeaders) || cost === 0) {
          warnings.push('Đơn giá nhập = 0 đ (hàng mẫu / khuyến mãi không tính tiền).');
        }
        const matchedProd = existingProducts.find(
          (p) =>
            (!p.warehouseName || !wh || areWarehouseNamesEquivalent(p.warehouseName, wh)) &&
            normalizeVietnameseSearch(p.name) === normalizeVietnameseSearch(prodName)
        );
        if (!matchedProd) {
          warnings.push('Vật tư chưa có sẵn trong danh mục kho — nên kiểm tra tên hoặc thêm vào Tồn kho.');
        }
      }

      previewRows.push({
        excelRowNumber,
        status: errors.length > 0 ? 'error' : 'valid',
        errors,
        warnings,
        cells: [
          wh,
          supName || '—',
          prodName || '—',
          Number.isFinite(qty) ? `${qty} ${unit}` : 'Lỗi số',
          Number.isFinite(cost) ? formatVND(cost) : 'Lỗi số',
          Number.isFinite(paid) ? formatVND(paid) : 'Lỗi số',
        ],
        normalizedRow: {
          ...rawRow,
          'Kho Nhập Hàng': wh,
          'Tên Vật Tư Nhập Kho': prodName,
          'Nhà Cung Cấp': supName,
          'SĐT Nhà Cung Cấp': supPhone,
          'Đơn Vị Tính': unit,
          'Số Lượng Nhập': Number.isFinite(qty) ? qty : 0,
          'Đơn Giá Nhập (VNĐ)': Number.isFinite(cost) ? Math.round(cost) : 0,
          'Đã Thanh Toán NCC (VNĐ)': Number.isFinite(paid) ? Math.round(paid) : 0,
        },
      });
      return;
    }

    // moduleType === 'debts'
    const debtType = readExcelText(rawRow, ['Loại Công Nợ (KH / NCC)', 'Loại Công Nợ', 'Loại'], '');
    const code = readExcelText(rawRow, [
      'Mã Hóa Đơn / Mã Phiếu Nhập',
      'Mã Chứng Từ',
      'Mã Hóa Đơn',
      'Mã Phiếu Nhập',
    ]);
    const partner = readExcelText(rawRow, ['Tên Đối Tác', 'Khách Hàng', 'Nhà Cung Cấp']);
    const amount = readExcelNumber(
      rawRow,
      ['Số Tiền Thanh Toán Đợt Này (VNĐ)', 'Số Tiền Thanh Toán', 'Số Tiền Thu/Trả'],
      0
    );
    const note = readExcelText(rawRow, ['Ghi Chú Thanh Toán', 'Ghi Chú'], 'Cập nhật từ Excel');

    if (!code) {
      errors.push('Thiếu Mã Hóa Đơn (HD-...) hoặc Mã Phiếu Nhập (PN-...).');
    } else if (!code.startsWith('HD-') && !code.startsWith('PN-')) {
      errors.push(`Mã chứng từ "${code}" phải bắt đầu bằng HD- hoặc PN-.`);
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push('Số tiền thanh toán đợt này phải lớn hơn 0 đ.');
    }

    let currentDebtDisplay = '—';
    if (errors.length === 0) {
      if (code.startsWith('HD-')) {
        const rem = remainingSaleDebtByCode.get(code) || 0;
        currentDebtDisplay = formatVND(rem);
        if (rem <= 0) {
          errors.push(`Hóa đơn "${code}" không tồn tại hoặc đã tất toán hết nợ.`);
        } else {
          if (amount > rem) {
            warnings.push(
              `Số tiền nhập (${formatVND(amount)}) lớn hơn dư nợ còn lại (${formatVND(rem)}) — chỉ thu tối đa ${formatVND(rem)}.`
            );
          }
          remainingSaleDebtByCode.set(code, Math.max(0, rem - amount));
        }
      } else if (code.startsWith('PN-')) {
        const rem = remainingImportDebtByCode.get(code) || 0;
        currentDebtDisplay = formatVND(rem);
        if (rem <= 0) {
          errors.push(`Phiếu nhập "${code}" không tồn tại hoặc đã trả đủ nợ NCC.`);
        } else {
          if (amount > rem) {
            warnings.push(
              `Số tiền nhập (${formatVND(amount)}) lớn hơn nợ NCC còn lại (${formatVND(rem)}) — chỉ chi tối đa ${formatVND(rem)}.`
            );
          }
          remainingImportDebtByCode.set(code, Math.max(0, rem - amount));
        }
      }
    }

    previewRows.push({
      excelRowNumber,
      status: errors.length > 0 ? 'error' : 'valid',
      errors,
      warnings,
      cells: [
        debtType || (code.startsWith('PN-') ? 'NCC' : 'KH'),
        code || '—',
        partner || '—',
        Number.isFinite(amount) ? formatVND(amount) : 'Lỗi số',
        currentDebtDisplay,
      ],
      normalizedRow: {
        ...rawRow,
        'Loại Công Nợ (KH / NCC)': debtType || (code.startsWith('PN-') ? 'NCC' : 'KH'),
        'Mã Hóa Đơn / Mã Phiếu Nhập': code,
        'Tên Đối Tác': partner,
        'Số Tiền Thanh Toán Đợt Này (VNĐ)': Number.isFinite(amount) ? Math.round(amount) : 0,
        'Ghi Chú Thanh Toán': note,
      },
    });
  });

  const validRows = previewRows.filter((r) => r.status === 'valid');
  const errorCount = previewRows.filter((r) => r.status === 'error').length;
  const warningCount = previewRows.filter((r) => r.warnings.length > 0).length;

  return {
    moduleType,
    columns: columnsByModule[moduleType],
    rows: previewRows,
    totalNonEmptyRows: previewRows.length,
    emptySkippedCount,
    validCount: validRows.length,
    errorCount,
    warningCount,
    validNormalizedRows: validRows.map((r) => r.normalizedRow),
  };
}

/* ---------------- Phase 4C: Due Debt Zalo + VietQR Reminder Queue */

export function formatVietQrSummaryForDebt(
  bankConfig: VietQrBankConfig | null | undefined,
  amount: number,
  addInfoRaw: string
): ZaloDebtVietQrSummary | null {
  if (!isValidVietQrConfig(bankConfig) || !bankConfig) return null;
  const safeAmount = Math.max(0, Math.round(Number(amount) || 0));
  const transferContent = sanitizeVietQrText(addInfoRaw, 48);
  const qrImageUrl = buildVietQrImageUrl(bankConfig, {
    amount: safeAmount,
    addInfo: transferContent,
  });
  return {
    bankLabel: resolveVietnamBankLabel(bankConfig.bankCode),
    accountNumber: bankConfig.accountNumber.trim(),
    accountName: bankConfig.accountName?.trim() || undefined,
    transferContent,
    qrImageUrl: qrImageUrl || undefined,
  };
}

export interface CustomerZaloReminderItem {
  customerKey: string;
  customerId?: string;
  customerName: string;
  customerPhone: string;
  invoiceCount: number;
  overdueInvoiceCount: number;
  dueSoonInvoiceCount: number;
  totalDebt: number;
  nearestDueDate: string;
  urgency: 'overdue' | 'due_soon' | 'normal';
  daysDelta: number;
  transferAddInfo: string;
  vietQrUrl: string | null;
  zaloUrl: string | null;
  message: string;
  unpaidSales: SaleTransaction[];
}

export function buildCustomerZaloDebtReminderQueue(params: {
  sales: SaleTransaction[];
  customers?: CustomerProfile[];
  storeName?: string;
  bankQrConfig?: VietQrBankConfig | null;
  todayStr?: string;
  leadDays?: number;
}): CustomerZaloReminderItem[] {
  const {
    sales = [],
    customers = [],
    storeName = 'VTNN Tâm An',
    bankQrConfig = null,
    todayStr = getTodayVietnamDateStr(),
    leadDays = 5,
  } = params;

  const groups = new Map<
    string,
    {
      customerId?: string;
      customerName: string;
      customerPhone: string;
      unpaidSales: SaleTransaction[];
    }
  >();

  for (const s of sales) {
    if (!s || (Number(s.debtAmount) || 0) <= 0 || s.isSupplierSale) continue;
    const matchedProfile = customers.find(
      (c) =>
        (s.customerId && c.id === s.customerId) ||
        (s.customerPhone && c.phone && c.phone.trim() === s.customerPhone.trim()) ||
        normalizeVietnameseSearch(c.name) === normalizeVietnameseSearch(s.customerName)
    );
    const resolvedPhone = (s.customerPhone || matchedProfile?.phone || '').trim();
    const resolvedId = matchedProfile?.id || s.customerId || undefined;
    const key = resolvedId
      ? `id:${resolvedId}`
      : resolvedPhone
      ? `ph:${resolvedPhone.replace(/\D/g, '')}`
      : `nm:${normalizeVietnameseSearch(s.customerName)}`;

    let bucket = groups.get(key);
    if (!bucket) {
      bucket = {
        customerId: resolvedId,
        customerName: matchedProfile?.name || s.customerName,
        customerPhone: resolvedPhone,
        unpaidSales: [],
      };
      groups.set(key, bucket);
    } else if (!bucket.customerPhone && resolvedPhone) {
      bucket.customerPhone = resolvedPhone;
    }
    bucket.unpaidSales.push(s);
  }

  const items: CustomerZaloReminderItem[] = [];
  groups.forEach((bucket, key) => {
    const sortedSales = [...bucket.unpaidSales].sort((a, b) =>
      (a.dueDate || a.createdAt || '').localeCompare(b.dueDate || b.createdAt || '')
    );
    const totalDebt = sortedSales.reduce((sum, s) => sum + Math.max(0, Number(s.debtAmount) || 0), 0);
    let overdueInvoiceCount = 0;
    let dueSoonInvoiceCount = 0;
    let minDaysRemaining = Number.POSITIVE_INFINITY;
    let nearestDueDate = sortedSales[0]?.dueDate || '';

    for (const s of sortedSales) {
      const ev = evaluateDebtUrgency(s.dueDate, s.debtAmount, todayStr, leadDays);
      if (ev.urgency === 'overdue') overdueInvoiceCount += 1;
      else if (ev.urgency === 'due_soon') dueSoonInvoiceCount += 1;
      if (ev.daysRemaining < minDaysRemaining) {
        minDaysRemaining = ev.daysRemaining;
        nearestDueDate = s.dueDate;
      }
    }

    const urgency: 'overdue' | 'due_soon' | 'normal' =
      overdueInvoiceCount > 0 ? 'overdue' : dueSoonInvoiceCount > 0 ? 'due_soon' : 'normal';
    const firstCode = sortedSales[0]?.invoiceCode || 'CONGNO';
    const rawAddInfo =
      sortedSales.length === 1
        ? `THU NO ${firstCode} ${bucket.customerName}`
        : `THU NO ${bucket.customerName}`;
    const qrSummary = formatVietQrSummaryForDebt(bankQrConfig, totalDebt, rawAddInfo);

    const built = buildZaloDebtReminderMessage({
      storeName,
      customerName: bucket.customerName,
      customerPhone: bucket.customerPhone,
      totalDebt,
      unpaidInvoices: sortedSales.map((s) => ({
        invoiceCode: s.invoiceCode,
        date: (s.createdAt || '').slice(0, 10),
        productName: s.productName,
        debtAmount: s.debtAmount,
        dueDate: s.dueDate,
      })),
      todayStr,
      vietQrSummary: qrSummary,
    });

    items.push({
      customerKey: key,
      customerId: bucket.customerId,
      customerName: bucket.customerName,
      customerPhone: bucket.customerPhone,
      invoiceCount: sortedSales.length,
      overdueInvoiceCount,
      dueSoonInvoiceCount,
      totalDebt,
      nearestDueDate,
      urgency,
      daysDelta: Number.isFinite(minDaysRemaining) ? minDaysRemaining : 0,
      transferAddInfo: qrSummary?.transferContent || sanitizeVietQrText(rawAddInfo, 48),
      vietQrUrl: qrSummary?.qrImageUrl || null,
      zaloUrl: built.zaloUrl,
      message: built.message,
      unpaidSales: sortedSales,
    });
  });

  const urgencyRank = { overdue: 0, due_soon: 1, normal: 2 };
  return items.sort(
    (a, b) =>
      urgencyRank[a.urgency] - urgencyRank[b.urgency] ||
      a.daysDelta - b.daysDelta ||
      b.totalDebt - a.totalDebt
  );
}

export const ZALO_REMINDED_TODAY_STORAGE_KEY = 'vtnn_taman_zalo_reminded_v1';

export function loadZaloRemindedTodaySet(
  todayStr = getTodayVietnamDateStr(),
  storage?: Pick<Storage, 'getItem'> | null
): Set<string> {
  try {
    const target =
      storage !== undefined
        ? storage
        : typeof window !== 'undefined'
        ? window.localStorage
        : null;
    const raw = target?.getItem(ZALO_REMINDED_TODAY_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as { date?: string; keys?: string[] };
    if (parsed?.date !== todayStr || !Array.isArray(parsed.keys)) return new Set();
    return new Set(parsed.keys.filter((k) => typeof k === 'string'));
  } catch {
    return new Set();
  }
}

export function markCustomerZaloRemindedToday(
  customerKey: string,
  todayStr = getTodayVietnamDateStr(),
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
): Set<string> {
  const next = loadZaloRemindedTodaySet(todayStr, storage);
  if (customerKey) next.add(customerKey);
  try {
    const target =
      storage !== undefined
        ? storage
        : typeof window !== 'undefined'
        ? window.localStorage
        : null;
    target?.setItem(
      ZALO_REMINDED_TODAY_STORAGE_KEY,
      JSON.stringify({ date: todayStr, keys: Array.from(next) })
    );
  } catch {
    // Ignore storage quota errors
  }
  return next;
}

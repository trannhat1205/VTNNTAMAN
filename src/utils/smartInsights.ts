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

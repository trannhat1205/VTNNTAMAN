import type { CustomerProfile, ProductItem, SaleTransaction } from '../types';

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

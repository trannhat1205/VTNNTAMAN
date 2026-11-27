import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCustomerCreditGrade,
  computeFrequentlyBoughtTogether,
  computeMarginInfo,
  isOverCreditLimit,
  isSlowMovingProduct,
  priceFromMarkup,
  resolveCustomerGroupPrice,
  suggestMinStockFromVelocity,
} from './smartInsights';
import type { SaleTransaction } from '../types';

const NOW = Date.parse('2026-11-27T05:00:00.000Z');
const day = (offset: number) => new Date(NOW + offset * 86400000).toISOString();

function sale(p: Partial<SaleTransaction> & { id: string; productId: string }): SaleTransaction {
  return {
    invoiceCode: 'HD-1',
    customerId: 'c1',
    customerName: 'K',
    customerPhone: '',
    productName: p.productId,
    unit: 'chai',
    quantity: 1,
    unitPrice: 100,
    totalAmount: 100,
    paidAmount: 100,
    debtAmount: 0,
    dueDate: day(30).slice(0, 10),
    status: 'paid',
    note: '',
    staffName: '',
    ownerId: 'o',
    createdAt: day(-1),
    updatedAt: day(-1),
    ...p,
  } as SaleTransaction;
}

test('margin helper and markup price rounding', () => {
  const m = computeMarginInfo(350000, 285000);
  assert.equal(m.profitPerUnit, 65000);
  assert.equal(m.marginPct, 18.6);
  assert.equal(m.markupPct, 22.8);
  assert.equal(priceFromMarkup(285000, 20), 342000);
  assert.equal(priceFromMarkup(0, 20), 0);
  assert.equal(computeMarginInfo(0, 100).marginPct, 0);
});

test('smart min stock from sales velocity', () => {
  assert.equal(suggestMinStockFromVelocity({ id: 'p' }, [], { nowMs: NOW }), null);
  const sales = [
    sale({ id: 's1', productId: 'p', quantity: 30, createdAt: day(-5) }),
    sale({ id: 's2', productId: 'p', quantity: 30, createdAt: day(-40) }), // outside window
    sale({ id: 's3', productId: 'other', quantity: 99 }),
  ];
  // 30 / 30 days = 1/day * 7 * 1.5 = 10.5 -> 11
  assert.equal(suggestMinStockFromVelocity({ id: 'p' }, sales, { nowMs: NOW }), 11);
  const tiny = [sale({ id: 's4', productId: 'p', quantity: 1, createdAt: day(-2) })];
  assert.equal(suggestMinStockFromVelocity({ id: 'p' }, tiny, { nowMs: NOW }), 1);
});

test('credit grade A/B/C/D and credit limit', () => {
  const paid = [sale({ id: 'a', productId: 'p' })];
  assert.equal(computeCustomerCreditGrade(paid, NOW).grade, 'A');

  const notDue = [sale({ id: 'b', productId: 'p', debtAmount: 500, dueDate: day(10).slice(0, 10) })];
  assert.equal(computeCustomerCreditGrade(notDue, NOW).grade, 'A');

  const mostlyFine = [
    sale({ id: 'c1', productId: 'p', debtAmount: 100, dueDate: day(-10).slice(0, 10) }),
    sale({ id: 'c2', productId: 'p', debtAmount: 900, dueDate: day(20).slice(0, 10) }),
  ];
  assert.equal(computeCustomerCreditGrade(mostlyFine, NOW).grade, 'B');

  const c = [
    sale({ id: 'd1', productId: 'p', debtAmount: 100, dueDate: day(-45).slice(0, 10) }),
    sale({ id: 'd2', productId: 'p', debtAmount: 900, dueDate: day(20).slice(0, 10) }),
  ];
  assert.equal(computeCustomerCreditGrade(c, NOW).grade, 'C');

  const old = [sale({ id: 'e1', productId: 'p', debtAmount: 100, dueDate: day(-90).slice(0, 10) })];
  const r = computeCustomerCreditGrade(old, NOW);
  assert.equal(r.grade, 'D');
  assert.equal(r.overdueAmount, 100);

  const half = [
    sale({ id: 'f1', productId: 'p', debtAmount: 600, dueDate: day(-3).slice(0, 10) }),
    sale({ id: 'f2', productId: 'p', debtAmount: 400, dueDate: day(20).slice(0, 10) }),
  ];
  assert.equal(computeCustomerCreditGrade(half, NOW).grade, 'D');

  assert.equal(isOverCreditLimit(1_000_001, 1_000_000), true);
  assert.equal(isOverCreditLimit(1_000_000, 1_000_000), false);
  assert.equal(isOverCreditLimit(5_000_000, 0), false);
  assert.equal(isOverCreditLimit(5_000_000, undefined), false);
});

test('frequently bought together uses invoice groups with fallback', () => {
  const sales = [
    sale({ id: '1', productId: 'A', invoiceGroupId: 'g1', productName: 'A' }),
    sale({ id: '2', productId: 'B', invoiceGroupId: 'g1', productName: 'B' }),
    sale({ id: '3', productId: 'A', invoiceGroupId: 'g2', productName: 'A' }),
    sale({ id: '4', productId: 'B', invoiceGroupId: 'g2', productName: 'B' }),
    sale({ id: '5', productId: 'C', invoiceGroupId: 'g2', productName: 'C' }),
    // fallback (no group id): same code + customer + date
    sale({ id: '6', productId: 'A', invoiceCode: 'HD-9', productName: 'A' }),
    sale({ id: '7', productId: 'C', invoiceCode: 'HD-9', productName: 'C' }),
    sale({ id: '8', productId: 'Z', invoiceCode: 'HD-10', productName: 'Z' }),
  ];
  const top = computeFrequentlyBoughtTogether(sales, 'A', 3);
  assert.deepEqual(top.map((t) => [t.productId, t.count]), [['B', 2], ['C', 2]]);
  assert.equal(computeFrequentlyBoughtTogether(sales, 'A', 1).length, 1);
  assert.deepEqual(computeFrequentlyBoughtTogether(sales, 'Z'), []);
});

test('slow moving: stock > 0 and no sale in 60 days', () => {
  const sales = [
    sale({ id: '1', productId: 'fast', createdAt: day(-3) }),
    sale({ id: '2', productId: 'old', createdAt: day(-90) }),
  ];
  assert.equal(isSlowMovingProduct({ id: 'fast', stock: 5 }, sales, NOW), false);
  assert.equal(isSlowMovingProduct({ id: 'old', stock: 5 }, sales, NOW), true);
  assert.equal(isSlowMovingProduct({ id: 'never', stock: 5 }, sales, NOW), true);
  assert.equal(isSlowMovingProduct({ id: 'never', stock: 0 }, sales, NOW), false);
});

test('customer group price resolution', () => {
  const p = { sellPrice: 200000, groupPrices: { 'Đại lý cấp 2': 180000, 'Trang trại': 0 } };
  assert.deepEqual(resolveCustomerGroupPrice(p, 'Đại lý cấp 2'), { price: 180000, isGroupPrice: true });
  assert.deepEqual(resolveCustomerGroupPrice(p, 'Trang trại'), { price: 200000, isGroupPrice: false });
  assert.deepEqual(resolveCustomerGroupPrice(p, 'Nhà nông'), { price: 200000, isGroupPrice: false });
  assert.deepEqual(resolveCustomerGroupPrice({ sellPrice: 5 }, undefined), { price: 5, isGroupPrice: false });
});

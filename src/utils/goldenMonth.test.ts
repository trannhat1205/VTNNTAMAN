import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCustomerFifoDebtSettlement,
  applySupplierFifoDebtSettlement,
  buildCustomerReturnRefundVouchers,
  computeCashflowAndFinancialReport,
  computeCustomerSaleReturnCalculation,
  computeProductStockMovementLedger,
  computeTaxAuthorityFinancialStatement,
  findLinkedReceiptVouchersForSale,
  reconcileCustomersFromSales,
} from './businessLogic';
import type {
  CashPaymentVoucher,
  CashReceiptVoucher,
  CustomerProfile,
  ImportTransaction,
  ProductItem,
  SaleTransaction,
  StockAdjustmentRecord,
} from '../types';

const WH = 'Tâm An Mỹ Ngãi';
const OWNER = 'owner_1';
const at = (day: string) => `${day}T03:00:00.000Z`;

function product(id: string, code: string, name: string, stock: number, importPrice: number): ProductItem {
  return {
    id,
    code,
    name,
    category: 'Thuốc BVTV' as ProductItem['category'],
    unit: 'chai',
    importPrice,
    sellPrice: importPrice * 2,
    stock,
    minStock: 1,
    supplierName: 'NCC A',
    warehouseName: WH,
    ownerId: OWNER,
    createdAt: at('2026-10-01'),
    updatedAt: at('2026-10-01'),
  };
}

function imp(
  id: string,
  code: string,
  p: ProductItem,
  qty: number,
  unitCost: number,
  paid: number,
  day: string
): ImportTransaction {
  const total = qty * unitCost;
  return {
    id,
    receiptCode: code,
    supplierName: 'NCC A',
    supplierPhone: '0900000001',
    productId: p.id,
    productName: p.name,
    unit: p.unit,
    quantity: qty,
    unitCost,
    totalCost: total,
    paidAmount: paid,
    debtAmount: total - paid,
    dueDate: '2026-12-31',
    status: paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
    warehouseName: WH,
    note: '',
    staffName: 'Admin',
    ownerId: OWNER,
    createdAt: at(day),
    updatedAt: at(day),
  };
}

function sale(
  id: string,
  code: string,
  cust: { id: string; name: string; phone: string },
  p: ProductItem,
  qty: number,
  unitPrice: number,
  paid: number,
  day: string
): SaleTransaction {
  const total = qty * unitPrice;
  return {
    id,
    invoiceCode: code,
    customerId: cust.id,
    customerName: cust.name,
    customerPhone: cust.phone,
    productId: p.id,
    productName: p.name,
    unit: p.unit,
    quantity: qty,
    unitPrice,
    unitCost: p.importPrice,
    totalAmount: total,
    paidAmount: paid,
    debtAmount: total - paid,
    dueDate: '2026-12-31',
    status: paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
    warehouseName: WH,
    note: '',
    staffName: 'Admin',
    ownerId: OWNER,
    createdAt: at(day),
    updatedAt: at(day),
  };
}

test('Golden month: every report agrees on revenue, debt, stock and cash', () => {
  const A = product('pA', 'A-01', 'Thuốc A', 0, 100000);
  const B = product('pB', 'B-01', 'Thuốc B', 0, 50000);
  const c1 = { id: 'c1', name: 'Khách 1', phone: '0911111111' };
  const c2 = { id: 'c2', name: 'Khách 2', phone: '0922222222' };

  // --- October ---------------------------------------------------------
  let imports: ImportTransaction[] = [
    imp('i1', 'PN-2610-001', A, 20, 100000, 1200000, '2026-10-05'), // debt 800k
    imp('i2', 'PN-2610-002', B, 10, 50000, 500000, '2026-10-05'),
  ];
  let sales: SaleTransaction[] = [
    sale('s1', 'HD-2610-001', c1, A, 5, 130000, 400000, '2026-10-10'), // debt 250k
    sale('s2', 'HD-2610-001', c1, B, 4, 70000, 280000, '2026-10-10'),
    sale('s3', 'HD-2610-002', c2, A, 3, 130000, 390000, '2026-10-12'),
  ];
  let receipts: CashReceiptVoucher[] = [];
  let payments: CashPaymentVoucher[] = [];

  // --- November --------------------------------------------------------
  // 1) Customer 1 pays 150k, FIFO-settled onto the oldest debt
  const settle = applyCustomerFifoDebtSettlement(
    sales,
    { customerId: 'c1', warehouseName: WH },
    150000,
    '',
    at('2026-11-03')
  );
  sales = settle.updatedSales;
  receipts = [
    {
      id: 'rv1',
      voucherCode: 'PT-2611-001',
      groupName: 'Thu nợ bán hàng khách hàng',
      warehouseName: WH,
      partnerId: 'c1',
      partnerName: c1.name,
      partnerPhone: c1.phone,
      amount: settle.totalAllocated,
      paymentMethod: 'Tiền mặt',
      isDebtSettlement: true,
      settledAllocations: settle.settledAllocations,
      countsTowardOtherIncome: false,
      note: '',
      staffName: 'Admin',
      ownerId: OWNER,
      createdAt: at('2026-11-03'),
      updatedAt: at('2026-11-03'),
    },
  ];
  assert.equal(settle.totalAllocated, 150000);

  // 2) Customer 2 returns 1 of 3 (paid in full) → 130k cash refund
  const original = sales.find((s) => s.id === 's3')!;
  const calc = computeCustomerSaleReturnCalculation({ sale: original, returnQuantity: 1 });
  assert.equal(calc.cashRefundAmount, 130000);
  assert.equal(calc.nextTotalAmount, 260000);
  sales = sales.map((s) =>
    s.id === 's3'
      ? {
          ...s,
          quantity: calc.remainingQuantity,
          totalAmount: calc.nextTotalAmount,
          paidAmount: calc.nextPaidAmount,
          debtAmount: calc.nextDebtAmount,
          status: calc.nextStatus,
        }
      : s
  );
  const pair = buildCustomerReturnRefundVouchers({
    sale: original,
    cashRefundAmount: calc.cashRefundAmount,
    returnCode: 'TH-2611-001',
    receiptId: 'rv2',
    receiptCode: 'PT-2611-002',
    paymentId: 'pv1',
    paymentCode: 'PC-2611-001',
    ownerId: OWNER,
    warehouseName: WH,
    staffName: 'Admin',
    nowIso: at('2026-11-05'),
  });
  assert.ok(pair);
  receipts = [pair!.receipt, ...receipts];
  payments = [pair!.payment, ...payments];
  // Refund vouchers must never lock the sale (only debt-settlement vouchers do)
  assert.equal(findLinkedReceiptVouchersForSale(original, [pair!.receipt]).length, 0);

  // 3) Stocktake B: -1
  const adj: StockAdjustmentRecord = {
    id: 'adj1',
    adjustmentCode: 'KK-2611-001',
    productId: 'pB',
    productCode: 'B-01',
    productName: B.name,
    unit: B.unit,
    warehouseName: WH,
    systemStockBefore: 6,
    actualCountedStock: 5,
    diffQty: -1,
    unitCost: 50000,
    diffValue: -50000,
    reason: 'Hao hụt',
    note: '',
    staffName: 'Admin',
    ownerId: OWNER,
    createdAt: at('2026-11-07'),
  };

  // 4) Pay supplier 500k (FIFO onto the oldest debt)
  const supplierSettle = applySupplierFifoDebtSettlement(
    imports,
    { supplierName: 'NCC A', supplierPhone: '0900000001', warehouseName: WH },
    500000,
    '',
    at('2026-11-09')
  );
  imports = supplierSettle.updatedImports;
  payments = [
    {
      id: 'pv2',
      voucherCode: 'PC-2611-002',
      groupName: 'Chi trả nợ Nhà cung cấp',
      warehouseName: WH,
      partnerName: 'NCC A',
      partnerPhone: '0900000001',
      amount: supplierSettle.totalAllocated,
      paymentMethod: 'Tiền mặt',
      isDebtSettlement: true,
      settledAllocations: supplierSettle.settledAllocations,
      countsTowardOperatingExpense: false,
      note: '',
      staffName: 'Admin',
      ownerId: OWNER,
      createdAt: at('2026-11-09'),
      updatedAt: at('2026-11-09'),
    },
    ...payments,
  ];

  // Final stock: A 20-5-2 = 13, B 10-4-1 = 5
  const finalA = { ...A, stock: 13 };
  const finalB = { ...B, stock: 5 };
  const products = [finalA, finalB];

  // ---------------- Invariants ------------------------------------------
  const all = computeCashflowAndFinancialReport({ sales, imports, products, receiptVouchers: receipts, paymentVouchers: payments });
  const sumSales = sales.reduce((s, r) => s + r.totalAmount, 0);
  assert.equal(sumSales, 1190000);
  assert.equal(all.netSalesRevenue, sumSales);

  const tax = computeTaxAuthorityFinancialStatement({ sales, imports, products, receiptVouchers: receipts, paymentVouchers: payments });
  assert.equal(tax.netRevenue10, all.netSalesRevenue);

  // Debts
  const salesDebt = sales.reduce((s, r) => s + r.debtAmount, 0);
  assert.equal(salesDebt, 100000);
  assert.equal(all.totalReceivableDebt, salesDebt);
  assert.equal(tax.customerReceivables131, salesDebt);
  const customers: CustomerProfile[] = [c1, c2].map((c) => ({
    id: c.id,
    code: c.id,
    name: c.name,
    phone: c.phone,
    email: '',
    address: '',
    group: 'Khách lẻ' as CustomerProfile['group'],
    note: '',
    totalPurchased: 0,
    totalDebt: 0,
    warehouseName: WH,
    ownerId: OWNER,
    createdAt: at('2026-10-01'),
    updatedAt: at('2026-10-01'),
  }));
  const reconciled = reconcileCustomersFromSales(customers, sales, at('2026-11-30')).customers;
  assert.equal(reconciled.reduce((s, c) => s + c.totalDebt, 0), salesDebt);
  assert.equal(reconciled.find((c) => c.id === 'c1')!.totalDebt, 100000);

  const importsDebt = imports.reduce((s, r) => s + r.debtAmount, 0);
  assert.equal(importsDebt, 300000);
  assert.equal(all.totalPayableDebt, importsDebt);
  assert.equal(tax.supplierPayables331, importsDebt);

  // Stock ledger closes on product.stock
  for (const p of products) {
    const ledger = computeProductStockMovementLedger(p, sales, imports, { stockAdjustments: [adj] });
    assert.equal(ledger.closingStock, p.stock, `ledger closing ${p.code}`);
  }

  // Profit is untouched by settlements and refund adjustment vouchers
  assert.equal(all.totalCogs, 700000 + 200000);
  assert.equal(all.grossProfit, 1190000 - 900000);
  assert.equal(all.otherIncome, 0);
  assert.equal(all.operatingExpenses, 0);
  assert.equal(all.netProfit, 290000);

  // Cash: all-time equals the independent event list
  assert.equal(all.netCashflow, 400000 + 280000 + 390000 + 150000 - 130000 - 1200000 - 500000 - 500000);

  // Cash per month is period-exact (refund PT sits in the sale month, PC in the refund month)
  const oct = computeCashflowAndFinancialReport({
    sales, imports, products, receiptVouchers: receipts, paymentVouchers: payments,
    fromDate: '2026-10-01', toDate: '2026-10-31',
  });
  const nov = computeCashflowAndFinancialReport({
    sales, imports, products, receiptVouchers: receipts, paymentVouchers: payments,
    fromDate: '2026-11-01', toDate: '2026-11-30',
  });
  assert.equal(oct.totalCashInflow, 400000 + 280000 + 390000);
  assert.equal(oct.totalCashOutflow, 1200000 + 500000);
  assert.equal(oct.netCashflow, -630000);
  assert.equal(nov.totalCashInflow, 150000);
  assert.equal(nov.totalCashOutflow, 500000 + 130000);
  assert.equal(nov.netCashflow, -480000);
  assert.equal(oct.netCashflow + nov.netCashflow, all.netCashflow);
});

test('Customer return without cash refund builds no vouchers', () => {
  const pair = buildCustomerReturnRefundVouchers({
    sale: {
      invoiceCode: 'HD-1', customerId: 'c', customerName: 'K', customerPhone: '', createdAt: at('2026-10-01'),
      warehouseName: WH, ownerId: OWNER,
    },
    cashRefundAmount: 0,
    returnCode: 'TH-1', receiptId: 'a', receiptCode: 'PT-1', paymentId: 'b', paymentCode: 'PC-1',
    ownerId: OWNER, warehouseName: WH, staffName: 'x', nowIso: at('2026-11-01'),
  });
  assert.equal(pair, null);
});

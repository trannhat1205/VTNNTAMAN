import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDataHealthReport, findDuplicateSkuProductsToRename } from './dataHealth';
import { buildMissingDirectVouchersForExistingRecords } from './businessLogic';
import type {
  CashReceiptVoucher,
  CustomerProfile,
  ImportTransaction,
  ProductItem,
  SaleTransaction,
} from '../types';

const WH = 'Tâm An Mỹ Ngãi';

function makeProduct(id: string, code: string, extra: Partial<ProductItem> = {}): ProductItem {
  return {
    id,
    code,
    name: `Vật tư ${id}`,
    category: 'Thuốc BVTV',
    unit: 'Chai',
    importPrice: 100,
    sellPrice: 150,
    stock: 0,
    minStock: 5,
    supplierName: 'NCC',
    warehouseName: WH,
    ownerId: 'u1',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...extra,
  };
}

function makeSale(id: string, extra: Partial<SaleTransaction> = {}): SaleTransaction {
  return {
    id,
    invoiceCode: `HD-${id}`,
    customerId: 'c1',
    customerName: 'Khách A',
    customerPhone: '0900000001',
    productId: 'p1',
    productName: 'Vật tư p1',
    unit: 'Chai',
    quantity: 2,
    unitPrice: 100,
    totalAmount: 200,
    paidAmount: 200,
    debtAmount: 0,
    dueDate: '2026-12-01',
    status: 'paid',
    warehouseName: WH,
    note: '',
    staffName: 'Admin',
    ownerId: 'u1',
    createdAt: '2026-11-10T00:00:00.000Z',
    updatedAt: '2026-11-10T00:00:00.000Z',
    ...extra,
  };
}

function makeImport(id: string, extra: Partial<ImportTransaction> = {}): ImportTransaction {
  return {
    id,
    receiptCode: `PN-${id}`,
    supplierName: 'NCC',
    supplierPhone: '',
    productId: 'p1',
    productName: 'Vật tư p1',
    unit: 'Chai',
    quantity: 5,
    unitCost: 100,
    totalCost: 500,
    paidAmount: 500,
    debtAmount: 0,
    dueDate: '2026-12-01',
    status: 'paid',
    warehouseName: WH,
    note: '',
    staffName: 'Admin',
    ownerId: 'u1',
    createdAt: '2026-11-05T00:00:00.000Z',
    updatedAt: '2026-11-05T00:00:00.000Z',
    ...extra,
  };
}

const emptyInput = {
  products: [] as ProductItem[],
  customers: [] as CustomerProfile[],
  sales: [] as SaleTransaction[],
  imports: [] as ImportTransaction[],
  receiptVouchers: [] as CashReceiptVoucher[],
  paymentVouchers: [],
  stockAdjustments: [],
  warehouses: [WH],
  staffList: [],
};

test('Data health: empty workspace has zero issues and exposes all 15 groups', () => {
  const report = computeDataHealthReport(emptyInput);
  assert.equal(report.groups.length, 15);
  assert.equal(report.totalIssues, 0);
});

test('Data health: detects duplicate SKUs (same warehouse, case-insensitive) and keeps the oldest product', () => {
  const products = [
    makeProduct('p1', 'VT-01', { createdAt: '2026-11-01T00:00:00.000Z', stock: 3 }),
    makeProduct('p2', 'vt-01', { createdAt: '2026-11-02T00:00:00.000Z', stock: 3 }),
    makeProduct('p3', 'VT-02', { stock: 3 }),
  ];
  const imports = [makeImport('i1', { productId: 'p1', quantity: 3, totalCost: 300, paidAmount: 300 })];
  const report = computeDataHealthReport({ ...emptyInput, products, imports });
  assert.equal(report.byId.duplicateSkus.count, 2);
  assert.deepEqual(
    findDuplicateSkuProductsToRename(products).map((p) => p.id),
    ['p2']
  );
});

test('Data health: detects orphan vouchers, missing allocations, amount mismatch, stock drift and customer debt mismatch', () => {
  const products = [makeProduct('p1', 'VT-01', { stock: 0 })];
  const imports = [makeImport('i1', { productId: 'p1', quantity: 5 })]; // stock 0 but 5 imported -> drift
  const customers: CustomerProfile[] = [
    {
      id: 'c1',
      code: 'KH-01',
      name: 'Khách A',
      phone: '0900000001',
      email: '',
      address: '',
      group: 'Nhà nông',
      note: '',
      totalPurchased: 999,
      totalDebt: 999,
      warehouseName: WH,
      ownerId: 'u1',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    },
  ];
  const sales = [
    makeSale('s_orphan', { productId: 'ghost', productName: 'Vật tư ma' }),
    makeSale('s_bad_amount', { totalAmount: 150, paidAmount: 150 }),
    makeSale('s_no_customer', { customerId: 'ghost_c', customerPhone: '0999999999' }),
  ];
  const receiptVouchers: CashReceiptVoucher[] = [
    {
      id: 'rv1',
      voucherCode: 'PT-1',
      groupName: 'Thu nợ',
      warehouseName: WH,
      partnerName: 'Khách A',
      partnerPhone: '',
      amount: 100,
      paymentMethod: 'Tiền mặt',
      isDebtSettlement: true,
      settledAllocations: [
        {
          recordId: 'ghost_sale',
          code: 'HD-GHOST',
          date: '2026-11-01',
          dueDate: '2026-12-01',
          productName: 'x',
          previousDebt: 100,
          allocatedAmount: 100,
          remainingDebt: 0,
        },
      ],
      note: '',
      staffName: 'Admin',
      ownerId: 'u1',
      createdAt: '2026-11-11T00:00:00.000Z',
      updatedAt: '2026-11-11T00:00:00.000Z',
    },
  ];
  const report = computeDataHealthReport({
    ...emptyInput,
    products,
    imports,
    customers,
    sales,
    receiptVouchers,
  });
  assert.equal(report.byId.orphanSaleProducts.count, 1);
  assert.equal(report.byId.orphanSaleCustomers.count, 1);
  assert.equal(report.byId.amountInconsistency.count, 1);
  assert.equal(report.byId.receiptAllocMissingSale.count, 1);
  assert.equal(report.byId.stockDrift.count, 1);
  assert.equal(report.byId.customerDebtMismatch.count >= 1, true);
  assert.equal(report.totalIssues > 0, true);
});

test('Data health: flags duplicate warehouse names written differently and empty warehouses (info only)', () => {
  const report = computeDataHealthReport({
    ...emptyInput,
    warehouses: ['Tâm An Mỹ Ngãi', 'TÂM AN MỸ NGÃI', 'Kho Trống'],
  });
  assert.equal(report.byId.duplicateWarehouseNames.count, 1);
  assert.equal(report.byId.emptyWarehouses.count >= 1, true);
  // empty warehouses are informational and never counted in totalIssues
  assert.equal(report.totalIssues, report.byId.duplicateWarehouseNames.count);
});

test('Data health: flags zero-price stocked products (ignores gifts) and unbacked opening stock as info', () => {
  const products = [
    makeProduct('p1', 'BPRO', { stock: 5, importPrice: 0 }),
    makeProduct('p2', 'QUATANG', { stock: 5, importPrice: 0, sellPrice: 0 }),
  ];
  const report = computeDataHealthReport({ ...emptyInput, products });
  assert.equal(report.byId.zeroPriceProducts.count, 1);
  assert.equal(report.byId.zeroPriceProducts.severity, 'warning');

  const opening = computeDataHealthReport({
    ...emptyInput,
    products: [makeProduct('p3', 'OPEN', { stock: 10 })],
  });
  assert.equal(opening.byId.unbackedOpeningStock.severity, 'info');
  assert.ok(opening.byId.unbackedOpeningStock.count >= 1);
  assert.equal(opening.totalIssues, 0);
});

test('Data health: flags paid sales/imports missing direct PT-/PC- vouchers and clears to 0 after backfill', () => {
  const products = [makeProduct('p1', 'VT-01', { stock: 3 })];
  const customers: CustomerProfile[] = [
    {
      id: 'c1',
      code: 'KH-01',
      name: 'Khách A',
      phone: '0900000001',
      email: '',
      address: '',
      group: 'Nhà nông',
      note: '',
      totalPurchased: 200,
      totalDebt: 100,
      warehouseName: WH,
      ownerId: 'u1',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    },
  ];
  const imports = [
    makeImport('i_part', {
      receiptCode: 'PN-2611-002',
      quantity: 5,
      unitCost: 160000,
      totalCost: 800000,
      paidAmount: 100000,
      debtAmount: 700000,
      status: 'partial',
    }),
  ];
  const sales = [
    makeSale('s_part', {
      invoiceCode: 'HD-2611-001',
      quantity: 2,
      unitPrice: 100,
      totalAmount: 200,
      paidAmount: 100,
      debtAmount: 100,
      status: 'partial',
    }),
  ];

  const before = computeDataHealthReport({
    ...emptyInput,
    products,
    customers,
    sales,
    imports,
  });
  assert.equal(before.byId.missingDirectVouchers.count, 2);

  const backfill = buildMissingDirectVouchersForExistingRecords({
    sales,
    imports,
    receiptVouchers: [],
    paymentVouchers: [],
  });
  assert.equal(backfill.createdReceipts.length, 1);
  assert.equal(backfill.createdPayments.length, 1);

  const after = computeDataHealthReport({
    ...emptyInput,
    products,
    customers,
    sales,
    imports,
    receiptVouchers: backfill.createdReceipts,
    paymentVouchers: backfill.createdPayments,
  });
  assert.equal(after.byId.missingDirectVouchers.count, 0);
});

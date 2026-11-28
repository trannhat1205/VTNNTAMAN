import {
  CashPaymentVoucher,
  CashReceiptVoucher,
  CrossLinkTargetTab,
  CustomerProfile,
  ImportTransaction,
  ProductItem,
  SaleTransaction,
  StaffMember,
  StockAdjustmentRecord,
} from '../types';
import {
  doesRecordMatchProduct,
  evaluateProductStockIntegrity,
  normalizeVietnameseSearch,
  normalizeWarehouseKey,
  reconcileCustomersFromSales,
} from './businessLogic';

export type DataHealthGroupId =
  | 'duplicateSkus'
  | 'orphanSaleProducts'
  | 'orphanImportProducts'
  | 'orphanSaleCustomers'
  | 'receiptAllocMissingSale'
  | 'paymentAllocMissingImport'
  | 'stockDrift'
  | 'zeroPriceProducts'
  | 'unbackedOpeningStock'
  | 'customerDebtMismatch'
  | 'amountInconsistency'
  | 'negativeOrNaN'
  | 'duplicateWarehouseNames'
  | 'emptyWarehouses';

export type DataHealthFixAction = 'duplicateSkus' | 'customerDebtMismatch' | 'stockDrift';

export interface DataHealthItem {
  id: string;
  code: string;
  label: string;
  tab?: CrossLinkTargetTab;
  recordId?: string;
}

export interface DataHealthGroup {
  id: DataHealthGroupId;
  title: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
  count: number;
  items: DataHealthItem[];
  fixAction?: DataHealthFixAction;
}

export interface DataHealthReport {
  groups: DataHealthGroup[];
  byId: Record<DataHealthGroupId, DataHealthGroup>;
  /** Number of problems (info-only groups are excluded) */
  totalIssues: number;
}

export interface DataHealthInput {
  products: ProductItem[];
  customers: CustomerProfile[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  receiptVouchers: CashReceiptVoucher[];
  paymentVouchers: CashPaymentVoucher[];
  stockAdjustments: StockAdjustmentRecord[];
  warehouses: string[];
  staffList: StaffMember[];
}

const isBadNumber = (v: unknown): boolean =>
  typeof v === 'number' ? !Number.isFinite(v) : v !== undefined && v !== null && Number.isNaN(Number(v));

/**
 * Returns every product that shares its SKU code with another product of the same warehouse,
 * EXCEPT the oldest one (which keeps the code). These are the products to renumber.
 */
export function findDuplicateSkuProductsToRename(products: ProductItem[]): ProductItem[] {
  const groups = new Map<string, ProductItem[]>();
  for (const p of products || []) {
    const code = (p.code || '').trim().toUpperCase();
    if (!code) continue;
    const key = `${normalizeWarehouseKey(p.warehouseName)}|${code}`;
    const list = groups.get(key) || [];
    list.push(p);
    groups.set(key, list);
  }
  const toRename: ProductItem[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) =>
      (a.createdAt || '').localeCompare(b.createdAt || '') || a.id.localeCompare(b.id)
    );
    toRename.push(...sorted.slice(1));
  }
  return toRename;
}

export function computeDataHealthReport(input: DataHealthInput): DataHealthReport {
  const {
    products = [],
    customers = [],
    sales = [],
    imports = [],
    receiptVouchers = [],
    paymentVouchers = [],
    stockAdjustments = [],
    warehouses = [],
    staffList = [],
  } = input;

  // 1. Duplicate SKUs
  const dupGroups = new Map<string, ProductItem[]>();
  for (const p of products) {
    const code = (p.code || '').trim().toUpperCase();
    if (!code) continue;
    const key = `${normalizeWarehouseKey(p.warehouseName)}|${code}`;
    const list = dupGroups.get(key) || [];
    list.push(p);
    dupGroups.set(key, list);
  }
  const duplicateSkuItems: DataHealthItem[] = [];
  for (const list of dupGroups.values()) {
    if (list.length < 2) continue;
    for (const p of list) {
      duplicateSkuItems.push({
        id: `dup_${p.id}`,
        code: p.code,
        label: `${p.name} (${p.warehouseName || 'Chưa gán kho'})`,
        tab: 'inventory',
        recordId: p.id,
      });
    }
  }

  // 2. Orphan sale / import → product
  const orphanSaleProducts: DataHealthItem[] = sales
    .filter(
      (s) =>
        !products.some((p) => doesRecordMatchProduct(p, s.productId, s.productName, s.warehouseName))
    )
    .map((s) => ({
      id: `osp_${s.id}`,
      code: s.invoiceCode,
      label: `${s.productName} — vật tư gốc không còn trong kho`,
      tab: 'sales' as CrossLinkTargetTab,
      recordId: s.id,
    }));
  const orphanImportProducts: DataHealthItem[] = imports
    .filter(
      (i) =>
        !products.some((p) => doesRecordMatchProduct(p, i.productId, i.productName, i.warehouseName))
    )
    .map((i) => ({
      id: `oip_${i.id}`,
      code: i.receiptCode,
      label: `${i.productName} — vật tư gốc không còn trong kho`,
      tab: 'imports' as CrossLinkTargetTab,
      recordId: i.id,
    }));

  // 3. Orphan sale → customer
  const customerIdSet = new Set(customers.map((c) => c.id));
  const customerPhoneSet = new Set(customers.map((c) => (c.phone || '').trim()).filter(Boolean));
  const supplierNameSet = new Set(
    imports.map((i) => normalizeVietnameseSearch(i.supplierName)).filter(Boolean)
  );
  const orphanSaleCustomers: DataHealthItem[] = sales
    .filter((s) => {
      if (!s.customerId) return false;
      if (s.isSupplierSale) return false;
      if ((s.customerId || '').startsWith('sup_') || (s.customerId || '').startsWith('sup::')) {
        return false;
      }
      if (supplierNameSet.has(normalizeVietnameseSearch(s.customerName))) return false;
      if (customerIdSet.has(s.customerId)) return false;
      const phone = (s.customerPhone || '').trim();
      return !(phone && customerPhoneSet.has(phone));
    })
    .map((s) => ({
      id: `osc_${s.id}`,
      code: s.invoiceCode,
      label: `${s.customerName} — hồ sơ khách hàng đã bị xóa`,
      tab: 'sales' as CrossLinkTargetTab,
      recordId: s.id,
    }));

  // 4. Settled allocations pointing to missing sale / import
  const saleIdSet = new Set(sales.map((s) => s.id));
  const saleCodeSet = new Set(sales.map((s) => s.invoiceCode));
  const receiptAllocMissingSale: DataHealthItem[] = receiptVouchers
    .filter(
      (rv) =>
        rv.isDebtSettlement &&
        (rv.settledAllocations || []).some(
          (a) => !saleIdSet.has(a.recordId) && !saleCodeSet.has(a.code)
        )
    )
    .map((rv) => ({
      id: `ras_${rv.id}`,
      code: rv.voucherCode,
      label: `${rv.partnerName} — phiếu thu trỏ tới hóa đơn đã hủy`,
      tab: 'receipt_vouchers' as CrossLinkTargetTab,
      recordId: rv.id,
    }));

  const importIdSet = new Set(imports.map((i) => i.id));
  const importCodeSet = new Set(imports.map((i) => i.receiptCode));
  const paymentAllocMissingImport: DataHealthItem[] = paymentVouchers
    .filter(
      (pv) =>
        pv.isDebtSettlement &&
        (pv.settledAllocations || []).some(
          (a) => !importIdSet.has(a.recordId) && !importCodeSet.has(a.code)
        )
    )
    .map((pv) => ({
      id: `pai_${pv.id}`,
      code: pv.voucherCode,
      label: `${pv.partnerName} — phiếu chi trỏ tới phiếu nhập đã hủy`,
      tab: 'payment_vouchers' as CrossLinkTargetTab,
      recordId: pv.id,
    }));

  // 5. Stock drift
  const stockDriftItems: DataHealthItem[] = [];
  const zeroPriceItems: DataHealthItem[] = [];
  const unbackedOpeningItems: DataHealthItem[] = [];
  for (const p of products) {
    const integrity = evaluateProductStockIntegrity(p, sales, imports, stockAdjustments);
    if (integrity.hasNegativeDrift) {
      stockDriftItems.push({
        id: `drift_${p.id}`,
        code: p.code,
        label: `${p.name}: tồn ${p.stock} nhưng sổ chứng từ chỉ còn ${integrity.recommendedReconciledStock}`,
        tab: 'inventory',
        recordId: p.id,
      });
    }
    if (integrity.impliedOpeningStock > 0 && integrity.linkedImportCount === 0) {
      unbackedOpeningItems.push({
        id: `uos_${p.id}`,
        code: p.code,
        label: `${p.name}: tồn đầu kỳ ${integrity.impliedOpeningStock} ${p.unit} chưa có phiếu nhập PN-... nào`,
        tab: 'inventory',
        recordId: p.id,
      });
    }
    const isGiftItem =
      (p.code || '').trim().toUpperCase() === 'QUATANG' ||
      normalizeVietnameseSearch(`${p.name} ${p.category}`).includes('qua tang');
    if (
      (Number(p.stock) || 0) > 0 &&
      !isGiftItem &&
      ((Number(p.importPrice) || 0) <= 0 || (Number(p.sellPrice) || 0) <= 0)
    ) {
      zeroPriceItems.push({
        id: `zp_${p.id}`,
        code: p.code,
        label: `${p.name}: còn tồn ${p.stock} ${p.unit} nhưng ${
          (Number(p.importPrice) || 0) <= 0 ? 'Giá nhập' : 'Giá bán'
        } đang là 0 đ`,
        tab: 'inventory',
        recordId: p.id,
      });
    }
  }

  // 6. Customer debt mismatch
  const reconciled = reconcileCustomersFromSales(customers, sales);
  const customerDebtMismatch: DataHealthItem[] = reconciled.changedCustomers.map((c) => ({
    id: `cdm_${c.id}`,
    code: c.code,
    label: `${c.name}: sổ khách hàng lệch so với tổng các hóa đơn`,
    tab: 'customers' as CrossLinkTargetTab,
    recordId: c.id,
  }));

  // 7. Amount inconsistency
  const amountItems: DataHealthItem[] = [];
  for (const s of sales) {
    const expectedTotal = Math.round((Number(s.quantity) || 0) * (Number(s.unitPrice) || 0)) -
      (Number(s.discountAmount) || 0);
    const totalOff = Math.abs(expectedTotal - (Number(s.totalAmount) || 0)) > 1;
    const splitOff =
      Math.abs((Number(s.paidAmount) || 0) + (Number(s.debtAmount) || 0) - (Number(s.totalAmount) || 0)) > 1;
    if (totalOff || splitOff) {
      amountItems.push({
        id: `ais_${s.id}`,
        code: s.invoiceCode,
        label: `Hóa đơn ${s.customerName}: ${totalOff ? 'thành tiền ≠ SL × đơn giá' : 'đã thu + còn nợ ≠ thành tiền'}`,
        tab: 'sales',
        recordId: s.id,
      });
    }
  }
  for (const i of imports) {
    const expectedTotal = Math.round((Number(i.quantity) || 0) * (Number(i.unitCost) || 0));
    const totalOff = Math.abs(expectedTotal - (Number(i.totalCost) || 0)) > 1;
    const splitOff =
      Math.abs((Number(i.paidAmount) || 0) + (Number(i.debtAmount) || 0) - (Number(i.totalCost) || 0)) > 1;
    if (totalOff || splitOff) {
      amountItems.push({
        id: `aii_${i.id}`,
        code: i.receiptCode,
        label: `Phiếu nhập ${i.supplierName}: ${totalOff ? 'tổng tiền ≠ SL × giá nhập' : 'đã trả + còn nợ ≠ tổng tiền'}`,
        tab: 'imports',
        recordId: i.id,
      });
    }
  }

  // 8. Negative / NaN
  const negativeItems: DataHealthItem[] = [];
  for (const p of products) {
    if ((Number(p.stock) || 0) < 0 || isBadNumber(p.stock) || isBadNumber(p.importPrice) || isBadNumber(p.sellPrice)) {
      negativeItems.push({
        id: `neg_${p.id}`,
        code: p.code,
        label: `${p.name}: tồn kho hoặc giá bị âm / không hợp lệ`,
        tab: 'inventory',
        recordId: p.id,
      });
    }
  }
  for (const s of sales) {
    if (isBadNumber(s.totalAmount) || isBadNumber(s.paidAmount) || isBadNumber(s.debtAmount) || isBadNumber(s.quantity)) {
      negativeItems.push({
        id: `negs_${s.id}`,
        code: s.invoiceCode,
        label: 'Hóa đơn có số liệu không hợp lệ (NaN)',
        tab: 'sales',
        recordId: s.id,
      });
    }
  }

  // 9. Duplicate warehouse names (report only)
  const whGroups = new Map<string, Set<string>>();
  const registerWh = (name?: string) => {
    const clean = (name || '').trim();
    if (!clean || clean === 'Tất cả kho') return;
    const key = normalizeWarehouseKey(clean);
    if (!key) return;
    const set = whGroups.get(key) || new Set<string>();
    set.add(clean);
    whGroups.set(key, set);
  };
  warehouses.forEach(registerWh);
  products.forEach((p) => registerWh(p.warehouseName));
  sales.forEach((s) => registerWh(s.warehouseName));
  imports.forEach((i) => registerWh(i.warehouseName));
  const duplicateWarehouseItems: DataHealthItem[] = [];
  for (const [key, names] of whGroups.entries()) {
    if (names.size > 1) {
      duplicateWarehouseItems.push({
        id: `dwh_${key}`,
        code: 'KHO',
        label: `Cùng một kho nhưng viết ${names.size} kiểu: ${Array.from(names).join(' / ')}`,
      });
    }
  }

  // 10. Empty warehouses (report only)
  const emptyWarehouseItems: DataHealthItem[] = [];
  for (const [key, names] of whGroups.entries()) {
    const hasRecords =
      products.some((p) => normalizeWarehouseKey(p.warehouseName) === key) ||
      sales.some((s) => normalizeWarehouseKey(s.warehouseName) === key) ||
      imports.some((i) => normalizeWarehouseKey(i.warehouseName) === key) ||
      receiptVouchers.some((r) => normalizeWarehouseKey(r.warehouseName) === key) ||
      paymentVouchers.some((p) => normalizeWarehouseKey(p.warehouseName) === key);
    const hasStaff = staffList.some(
      (st) =>
        normalizeWarehouseKey(st.assignedWarehouse) === key ||
        (st.assignedWarehouses || []).some((w) => normalizeWarehouseKey(w) === key)
    );
    if (!hasRecords && !hasStaff) {
      emptyWarehouseItems.push({
        id: `ewh_${key}`,
        code: 'KHO',
        label: `${Array.from(names)[0]} — chưa có dữ liệu và chưa gán nhân sự`,
      });
    }
  }

  const make = (
    id: DataHealthGroupId,
    title: string,
    description: string,
    severity: DataHealthGroup['severity'],
    items: DataHealthItem[],
    fixAction?: DataHealthFixAction
  ): DataHealthGroup => ({
    id,
    title,
    description,
    severity,
    count: items.length,
    items,
    fixAction,
  });

  const groups: DataHealthGroup[] = [
    make(
      'duplicateSkus',
      'Mã vật tư (SKU) bị trùng',
      'Hai vật tư trong cùng kho mang cùng mã. Dễ nhầm khi quét mã hoặc nhập/xuất Excel.',
      'warning',
      duplicateSkuItems,
      'duplicateSkus'
    ),
    make(
      'orphanSaleProducts',
      'Hóa đơn bán mất vật tư gốc',
      'Hóa đơn tham chiếu vật tư không còn trong danh mục kho.',
      'warning',
      orphanSaleProducts
    ),
    make(
      'orphanImportProducts',
      'Phiếu nhập mất vật tư gốc',
      'Phiếu nhập tham chiếu vật tư không còn trong danh mục kho.',
      'warning',
      orphanImportProducts
    ),
    make(
      'orphanSaleCustomers',
      'Hóa đơn mất hồ sơ khách hàng',
      'Hóa đơn tham chiếu khách hàng đã bị xóa khỏi danh sách.',
      'warning',
      orphanSaleCustomers
    ),
    make(
      'receiptAllocMissingSale',
      'Phiếu thu trỏ tới hóa đơn đã hủy',
      'Phiếu thu nợ có phân bổ vào hóa đơn không còn tồn tại.',
      'error',
      receiptAllocMissingSale
    ),
    make(
      'paymentAllocMissingImport',
      'Phiếu chi trỏ tới phiếu nhập đã hủy',
      'Phiếu chi trả nợ NCC có phân bổ vào phiếu nhập không còn tồn tại.',
      'error',
      paymentAllocMissingImport
    ),
    make(
      'stockDrift',
      'Lệch thẻ kho (XNT)',
      'Tồn kho hiện tại nhỏ hơn số tính từ chứng từ nhập – xuất – kiểm kê.',
      'error',
      stockDriftItems,
      'stockDrift'
    ),
    make(
      'zeroPriceProducts',
      'Vật tư còn tồn nhưng giá 0 đ',
      'Có tồn kho nhưng Giá nhập hoặc Giá bán bằng 0 đ → giá trị tồn và lãi gộp bị sai. Hàng tặng/quà KM được bỏ qua.',
      'warning',
      zeroPriceItems
    ),
    make(
      'unbackedOpeningStock',
      'Tồn đầu kỳ chưa có phiếu nhập',
      'Phần tồn có sẵn từ lúc tạo vật tư, chưa có phiếu nhập PN-... tương ứng nên Nhật ký Nhập hàng không hiện. Chỉ để tham khảo.',
      'info',
      unbackedOpeningItems
    ),
    make(
      'customerDebtMismatch',
      'Lệch công nợ khách hàng',
      'Tổng mua / tổng nợ trong hồ sơ khách khác tổng các hóa đơn thực tế.',
      'error',
      customerDebtMismatch,
      'customerDebtMismatch'
    ),
    make(
      'amountInconsistency',
      'Số tiền chứng từ không khớp công thức',
      'Thành tiền ≠ SL × đơn giá, hoặc đã thu/trả + còn nợ ≠ tổng tiền.',
      'error',
      amountItems
    ),
    make(
      'negativeOrNaN',
      'Số liệu âm hoặc không hợp lệ',
      'Tồn kho âm, giá hoặc số tiền không phải số hợp lệ.',
      'error',
      negativeItems
    ),
    make(
      'duplicateWarehouseNames',
      'Kho trùng tên (khác cách viết)',
      'Cùng một kho nhưng bị viết hoa/thường hoặc có dấu khác nhau. Chỉ báo cáo, không tự sửa.',
      'warning',
      duplicateWarehouseItems
    ),
    make(
      'emptyWarehouses',
      'Kho trống',
      'Kho chưa có dữ liệu và chưa gán nhân sự. Chỉ để tham khảo.',
      'info',
      emptyWarehouseItems
    ),
  ];

  const byId = groups.reduce(
    (acc, g) => {
      acc[g.id] = g;
      return acc;
    },
    {} as Record<DataHealthGroupId, DataHealthGroup>
  );

  return {
    groups,
    byId,
    totalIssues: groups.filter((g) => g.severity !== 'info').reduce((sum, g) => sum + g.count, 0),
  };
}

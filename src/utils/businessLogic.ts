import {
  AppNotification,
  AuditActionCategory,
  AuditLogEntry,
  AuditTargetEntity,
  BackupEntry,
  BackupSnapshotPayload,
  CashPaymentVoucher,
  CashReceiptVoucher,
  CustomerGroup,
  CustomerProfile,
  DebtUrgencyLevel,
  FifoDebtAllocationItem,
  ImportTransaction,
  NotificationPrefs,
  PaymentStatus,
  ProductItem,
  ReportModuleCategory,
  SalePromotionType,
  SaleTransaction,
  SavedVoucherRecord,
  StaffFunctionalPermission,
  StaffMember,
  StaffPositionRole,
  StockAdjustmentRecord,
  StockAlertLevel,
  SupplierProfile,
  UserRole,
} from '../types';

export interface SaleSummaryResult {
  grossAmount: number;
  discountAmount: number;
  totalAmount: number;
  paidAmount: number;
  debtAmount: number;
  status: PaymentStatus;
}

export function calculateSaleSummary(
  quantity: number,
  unitPrice: number,
  paidAmountInput: number,
  discountAmountInput = 0
): SaleSummaryResult {
  const safeQty = Math.max(0, Number(quantity) || 0);
  const safePrice = Math.max(0, Number(unitPrice) || 0);
  const grossAmount = Math.round(safeQty * safePrice);
  const discountAmount = Math.min(
    grossAmount,
    Math.max(0, Math.round(Number(discountAmountInput) || 0))
  );
  const totalAmount = Math.max(0, grossAmount - discountAmount);
  const paidAmount = Math.min(totalAmount, Math.max(0, Math.round(Number(paidAmountInput) || 0)));
  const debtAmount = Math.max(0, totalAmount - paidAmount);

  let status: PaymentStatus = 'paid';
  if (debtAmount > 0 && paidAmount === 0) {
    status = 'unpaid';
  } else if (debtAmount > 0 && paidAmount > 0) {
    status = 'partial';
  }

  return {
    grossAmount,
    discountAmount,
    totalAmount,
    paidAmount,
    debtAmount,
    status,
  };
}

export interface ImportSummaryResult {
  totalCost: number;
  paidAmount: number;
  debtAmount: number;
  status: PaymentStatus;
}

export function calculateImportSummary(
  quantity: number,
  unitCost: number,
  paidAmountInput: number
): ImportSummaryResult {
  const safeQty = Math.max(0, Number(quantity) || 0);
  const safeCost = Math.max(0, Number(unitCost) || 0);
  const totalCost = Math.round(safeQty * safeCost);
  const paidAmount = Math.min(totalCost, Math.max(0, Math.round(Number(paidAmountInput) || 0)));
  const debtAmount = Math.max(0, totalCost - paidAmount);

  let status: PaymentStatus = 'paid';
  if (debtAmount > 0 && paidAmount === 0) {
    status = 'unpaid';
  } else if (debtAmount > 0 && paidAmount > 0) {
    status = 'partial';
  }

  return {
    totalCost,
    paidAmount,
    debtAmount,
    status,
  };
}

export function applySaleToInventory(
  products: ProductItem[],
  productId: string,
  quantitySold: number,
  nowIso: string,
  giftProductId?: string,
  giftQuantity = 0
): {
  updatedProducts: ProductItem[];
  updatedProduct: ProductItem;
  updatedGiftProduct?: ProductItem;
} {
  const target = products.find((p) => p.id === productId);
  if (!target) {
    throw new Error('Không tìm thấy sản phẩm trong kho.');
  }
  if (!Number.isFinite(quantitySold) || quantitySold <= 0) {
    throw new Error('Số lượng bán phải là số hợp lệ lớn hơn 0.');
  }
  const rawGift = Number(giftQuantity);
  if (giftQuantity !== undefined && !Number.isFinite(rawGift)) {
    throw new Error('Số lượng quà tặng phải là số hợp lệ.');
  }

  const safeGiftQty = Math.max(0, Math.round(rawGift || 0));
  const hasGift = Boolean(giftProductId && safeGiftQty > 0);

  if (hasGift && giftProductId === productId) {
    const combinedNeed = quantitySold + safeGiftQty;
    if (target.stock < combinedNeed) {
      throw new Error(
        `Tồn kho không đủ để bán (${quantitySold}) + tặng kèm (${safeGiftQty})! Sản phẩm "${target.name}" chỉ còn ${target.stock} ${target.unit}.`
      );
    }
    const updatedProduct: ProductItem = {
      ...target,
      stock: target.stock - combinedNeed,
      updatedAt: nowIso,
    };
    const updatedProducts = products.map((p) => (p.id === productId ? updatedProduct : p));
    return { updatedProducts, updatedProduct, updatedGiftProduct: updatedProduct };
  }

  if (target.stock < quantitySold) {
    throw new Error(
      `Tồn kho không đủ! Sản phẩm "${target.name}" chỉ còn ${target.stock} ${target.unit}.`
    );
  }

  let updatedGiftProduct: ProductItem | undefined;
  if (hasGift && giftProductId) {
    const giftTarget = products.find((p) => p.id === giftProductId);
    if (!giftTarget) {
      throw new Error('Không tìm thấy mặt hàng quà tặng khuyến mãi trong kho.');
    }
    if (giftTarget.stock < safeGiftQty) {
      throw new Error(
        `Tồn kho quà tặng không đủ! Quà tặng "${giftTarget.name}" hiện chỉ còn ${giftTarget.stock} ${giftTarget.unit}.`
      );
    }
    updatedGiftProduct = {
      ...giftTarget,
      stock: giftTarget.stock - safeGiftQty,
      updatedAt: nowIso,
    };
  }

  const updatedProduct: ProductItem = {
    ...target,
    stock: target.stock - quantitySold,
    updatedAt: nowIso,
  };

  const updatedProducts = products.map((p) => {
    if (p.id === productId) return updatedProduct;
    if (updatedGiftProduct && p.id === updatedGiftProduct.id) return updatedGiftProduct;
    return p;
  });
  return { updatedProducts, updatedProduct, updatedGiftProduct };
}

export function computeWeightedAverageImportPrice(
  currentStock: number,
  currentImportPrice: number,
  importedQty: number,
  importedUnitCost: number
): number {
  const safeCurCost = Math.max(0, Math.round(Number(currentImportPrice) || 0));
  if (!Number.isFinite(importedUnitCost) || importedUnitCost <= 0) {
    return safeCurCost;
  }
  const safeCurStock = Math.max(0, Number(currentStock) || 0);
  const safeInQty = Math.max(0, Number(importedQty) || 0);
  if (safeInQty <= 0) {
    return safeCurCost;
  }
  if (safeCurStock <= 0 || safeCurCost <= 0) {
    return Math.round(importedUnitCost);
  }
  return Math.round(
    (safeCurStock * safeCurCost + safeInQty * importedUnitCost) / (safeCurStock + safeInQty)
  );
}

export function recalculateImportPriceOnImportMutation(params: {
  product: Pick<ProductItem, 'id' | 'stock' | 'importPrice'>;
  oldQty: number;
  oldUnitCost: number;
  newQty: number;
  newUnitCost: number;
  remainingImports: ImportTransaction[];
}): number {
  const curStock = Math.max(0, Number(params.product.stock) || 0);
  const curCost = Math.max(0, Math.round(Number(params.product.importPrice) || 0));
  const oldQty = Math.max(0, Number(params.oldQty) || 0);
  const oldCost = Math.max(0, Number(params.oldUnitCost) || 0);
  const newQty = Math.max(0, Number(params.newQty) || 0);
  const newCost = Math.max(0, Number(params.newUnitCost) || 0);

  const nextStock = curStock - oldQty + newQty;
  const nextValue = curStock * curCost - oldQty * oldCost + newQty * newCost;
  if (nextStock > 0 && nextValue > 0) {
    return Math.round(nextValue / nextStock);
  }

  const validImports = (params.remainingImports || []).filter(
    (imp) => imp.productId === params.product.id && (Number(imp.quantity) || 0) > 0 && (Number(imp.unitCost) || 0) > 0
  );
  if (validImports.length > 0) {
    let sumQty = 0;
    let sumVal = 0;
    for (const imp of validImports) {
      const q = Number(imp.quantity) || 0;
      const c = Number(imp.unitCost) || 0;
      sumQty += q;
      sumVal += q * c;
    }
    if (sumQty > 0 && sumVal > 0) {
      return Math.round(sumVal / sumQty);
    }
  }

  return newCost > 0 ? Math.round(newCost) : curCost;
}

export function resolveSaleUnitCost(
  sale: Pick<SaleTransaction, 'unitCost' | 'unitPrice' | 'productId'>,
  products: ProductItem[]
): number {
  if (
    sale.unitCost !== undefined &&
    sale.unitCost !== null &&
    Number.isFinite(Number(sale.unitCost)) &&
    Number(sale.unitCost) >= 0
  ) {
    return Math.round(Number(sale.unitCost));
  }
  const prod = products.find((p) => p.id === sale.productId);
  if (prod && Number.isFinite(Number(prod.importPrice)) && Number(prod.importPrice) >= 0) {
    return Math.round(Number(prod.importPrice));
  }
  return Math.round((Number(sale.unitPrice) || 0) * 0.85);
}

export function resolveSaleGiftUnitCost(
  sale: Pick<SaleTransaction, 'giftUnitCost' | 'giftProductId'>,
  products: ProductItem[]
): number {
  if (
    sale.giftUnitCost !== undefined &&
    sale.giftUnitCost !== null &&
    Number.isFinite(Number(sale.giftUnitCost)) &&
    Number(sale.giftUnitCost) >= 0
  ) {
    return Math.round(Number(sale.giftUnitCost));
  }
  if (sale.giftProductId) {
    const giftProd = products.find((p) => p.id === sale.giftProductId);
    if (giftProd && Number.isFinite(Number(giftProd.importPrice)) && Number(giftProd.importPrice) >= 0) {
      return Math.round(Number(giftProd.importPrice));
    }
  }
  return 0;
}

export function applyImportToInventory(
  products: ProductItem[],
  productId: string,
  quantityImported: number,
  unitCost: number,
  nowIso: string
): { updatedProducts: ProductItem[]; updatedProduct: ProductItem } {
  const target = products.find((p) => p.id === productId);
  if (!target) {
    throw new Error('Không tìm thấy sản phẩm trong kho.');
  }
  if (!Number.isFinite(quantityImported) || quantityImported <= 0) {
    throw new Error('Số lượng nhập phải là số hợp lệ lớn hơn 0.');
  }
  if (!Number.isFinite(unitCost) || unitCost < 0) {
    throw new Error('Đơn giá nhập phải là số không âm hợp lệ.');
  }

  const nextImportPrice = computeWeightedAverageImportPrice(
    target.stock,
    target.importPrice,
    quantityImported,
    unitCost
  );

  const updatedProduct: ProductItem = {
    ...target,
    stock: target.stock + quantityImported,
    importPrice: nextImportPrice,
    updatedAt: nowIso,
  };

  const updatedProducts = products.map((p) => (p.id === productId ? updatedProduct : p));
  return { updatedProducts, updatedProduct };
}

export function applyDebtPayment<
  T extends { totalAmount?: number; totalCost?: number; paidAmount: number; debtAmount: number; status: PaymentStatus; updatedAt: string }
>(record: T, additionalPayment: number, nowIso: string): T {
  const amount = Math.max(0, Math.round(Number(additionalPayment) || 0));
  if (amount <= 0) {
    throw new Error('Số tiền thanh toán phải lớn hơn 0.');
  }
  const total = record.totalAmount ?? record.totalCost ?? record.paidAmount + record.debtAmount;
  const newPaid = Math.min(total, record.paidAmount + amount);
  const newDebt = Math.max(0, total - newPaid);
  const newStatus: PaymentStatus =
    newDebt === 0 ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid';

  return {
    ...record,
    paidAmount: newPaid,
    debtAmount: newDebt,
    status: newStatus,
    updatedAt: nowIso,
  };
}

export function evaluateStockAlert(product: Pick<ProductItem, 'stock' | 'minStock'>): StockAlertLevel {
  if (product.stock <= 0) return 'out_of_stock';
  if (product.stock <= product.minStock) return 'low_stock';
  return 'normal';
}

export function getTodayVietnamDateStr(dateInput: Date = new Date()): string {
  const vnTime = new Date(dateInput.getTime() + 7 * 60 * 60 * 1000);
  return vnTime.toISOString().slice(0, 10);
}

export function getCurrentMonthRangeVietnam(dateInput: Date = new Date()): {
  from: string;
  to: string;
  label: string;
} {
  const todayStr = getTodayVietnamDateStr(dateInput);
  const year = Number(todayStr.slice(0, 4));
  const month = Number(todayStr.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return {
    from: `${year}-${mm}-01`,
    to: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
    label: `Tháng ${mm}/${year}`,
  };
}

export function getRecentDaysRangeVietnam(
  days: number,
  dateInput: Date = new Date()
): { from: string; to: string } {
  const to = getTodayVietnamDateStr(dateInput);
  const safeDays = Math.max(0, Math.round(days) - 1);
  const parts = to.split('-').map(Number);
  const startUtc = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] - safeDays));
  return {
    from: startUtc.toISOString().slice(0, 10),
    to,
  };
}

export function getCurrentQuarterRangeVietnam(dateInput: Date = new Date()): {
  from: string;
  to: string;
  label: string;
} {
  const todayStr = getTodayVietnamDateStr(dateInput);
  const year = Number(todayStr.slice(0, 4));
  const month = Number(todayStr.slice(5, 7));
  const quarter = Math.floor((month - 1) / 3) + 1;
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  return {
    from: `${year}-${String(startMonth).padStart(2, '0')}-01`,
    to: `${year}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    label: `Quý ${quarter}/${year}`,
  };
}

export function generateSequentialVoucherCode(
  prefix: string,
  existingCodes: string[],
  dateInput: Date = new Date()
): string {
  const todayStr = getTodayVietnamDateStr(dateInput);
  const yymm = `${todayStr.slice(2, 4)}${todayStr.slice(5, 7)}`;
  const fullPrefix = `${prefix}-${yymm}-`;
  let maxSeq = 0;
  for (const code of existingCodes) {
    if (typeof code === 'string' && code.startsWith(fullPrefix)) {
      const tail = Number(code.slice(fullPrefix.length));
      if (!Number.isNaN(tail) && tail > maxSeq) {
        maxSeq = tail;
      }
    }
  }
  const nextSeq = maxSeq + 1;
  return `${fullPrefix}${String(nextSeq).padStart(3, '0')}`;
}

export function evaluateDebtUrgency(
  dueDateStr: string,
  debtAmount: number,
  referenceDateStr = getTodayVietnamDateStr(),
  leadDays = 5
): { urgency: DebtUrgencyLevel; daysRemaining: number } {
  if (debtAmount <= 0 || !dueDateStr) {
    return { urgency: 'settled', daysRemaining: 0 };
  }
  const ref = new Date(referenceDateStr.slice(0, 10) + 'T00:00:00Z');
  const due = new Date(dueDateStr.slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(ref.getTime()) || Number.isNaN(due.getTime())) {
    return { urgency: 'upcoming', daysRemaining: 7 };
  }
  const diffMs = due.getTime() - ref.getTime();
  const daysRemaining = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (daysRemaining < 0) {
    return { urgency: 'overdue', daysRemaining };
  }
  if (daysRemaining <= leadDays) {
    return { urgency: 'due_soon', daysRemaining };
  }
  return { urgency: 'upcoming', daysRemaining };
}

export interface CustomerLedgerMetrics {
  customerId: string;
  transactionCount: number;
  totalPurchased: number;
  totalPaid: number;
  totalDebt: number;
  overdueCount: number;
  dueSoonCount: number;
  transactions: SaleTransaction[];
}

export function computeCustomerLedger(
  customer: CustomerProfile,
  sales: SaleTransaction[],
  referenceDateStr = getTodayVietnamDateStr(),
  leadDays = 5
): CustomerLedgerMetrics {
  const customerSales = sales
    .filter(
      (s) =>
        s.customerId === customer.id ||
        s.customerPhone === customer.phone ||
        s.customerName.toLowerCase() === customer.name.toLowerCase()
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  let totalPurchased = 0;
  let totalPaid = 0;
  let totalDebt = 0;
  let overdueCount = 0;
  let dueSoonCount = 0;

  for (const sale of customerSales) {
    totalPurchased += sale.totalAmount;
    totalPaid += sale.paidAmount;
    totalDebt += sale.debtAmount;
    if (sale.debtAmount > 0) {
      const { urgency } = evaluateDebtUrgency(sale.dueDate, sale.debtAmount, referenceDateStr, leadDays);
      if (urgency === 'overdue') overdueCount += 1;
      if (urgency === 'due_soon') dueSoonCount += 1;
    }
  }

  return {
    customerId: customer.id,
    transactionCount: customerSales.length,
    totalPurchased,
    totalPaid,
    totalDebt,
    overdueCount,
    dueSoonCount,
    transactions: customerSales,
  };
}

export type CustomerDebtFilter = 'all' | 'has_debt' | 'overdue' | 'no_debt';

export function normalizeVietnameseSearch(input: string): string {
  return (input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .trim();
}

export interface SearchableOptionItem {
  value: string;
  label: string;
  subLabel?: string;
  badge?: string;
  keywords?: string;
}

export function filterSearchableOptions<T extends SearchableOptionItem>(
  options: T[],
  query: string
): T[] {
  const normalizedQuery = normalizeVietnameseSearch(query);
  if (!normalizedQuery) return options;
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);

  return options.filter((opt) => {
    const haystack = normalizeVietnameseSearch(
      `${opt.label} ${opt.subLabel || ''} ${opt.badge || ''} ${opt.keywords || ''} ${opt.value}`
    );
    return tokens.every((tk) => haystack.includes(tk));
  });
}

export function filterCustomers(
  customers: CustomerProfile[],
  sales: SaleTransaction[],
  searchQuery: string,
  groupFilter: CustomerGroup | 'all',
  debtFilter: CustomerDebtFilter,
  referenceDateStr = getTodayVietnamDateStr(),
  leadDays = 5
): { customer: CustomerProfile; ledger: CustomerLedgerMetrics }[] {
  const q = normalizeVietnameseSearch(searchQuery);

  return customers
    .map((customer) => ({
      customer,
      ledger: computeCustomerLedger(customer, sales, referenceDateStr, leadDays),
    }))
    .filter(({ customer, ledger }) => {
      if (groupFilter !== 'all' && customer.group !== groupFilter) {
        return false;
      }
      if (debtFilter === 'has_debt' && ledger.totalDebt <= 0) {
        return false;
      }
      if (debtFilter === 'overdue' && ledger.overdueCount === 0) {
        return false;
      }
      if (debtFilter === 'no_debt' && ledger.totalDebt > 0) {
        return false;
      }
      if (!q) return true;
      const haystack = normalizeVietnameseSearch(
        `${customer.name} ${customer.code} ${customer.phone} ${customer.email} ${customer.address} ${customer.group}`
      );
      return haystack.includes(q);
    });
}

export function generateSmartNotifications(
  products: ProductItem[],
  sales: SaleTransaction[],
  imports: ImportTransaction[],
  backups: BackupEntry[],
  prefs: NotificationPrefs,
  referenceDateStr = getTodayVietnamDateStr()
): AppNotification[] {
  const notifications: AppNotification[] = [];
  const leadDays = prefs.leadDays || 5;

  // 1. Supplier Debt Notifications
  if (prefs.debtSupplierEnabled) {
    for (const imp of imports) {
      if (imp.debtAmount <= 0) continue;
      const { urgency, daysRemaining } = evaluateDebtUrgency(
        imp.dueDate,
        imp.debtAmount,
        referenceDateStr,
        leadDays
      );
      if (urgency === 'overdue') {
        notifications.push({
          id: `notif-sup-overdue-${imp.id}`,
          category: 'supplier_debt',
          severity: 'critical',
          title: `Quá hạn nợ NCC: ${imp.supplierName}`,
          message: `Phiếu nhập ${imp.receiptCode} (${imp.productName}) còn nợ ${imp.debtAmount.toLocaleString('vi-VN')} đ đã quá hạn ${Math.abs(daysRemaining)} ngày (Hạn: ${imp.dueDate}).`,
          timestamp: imp.updatedAt,
          read: false,
          actionTab: 'debts',
          relatedId: imp.id,
        });
      } else if (urgency === 'due_soon') {
        notifications.push({
          id: `notif-sup-soon-${imp.id}`,
          category: 'supplier_debt',
          severity: 'warning',
          title: `Sắp đến hạn trả nợ NCC: ${imp.supplierName}`,
          message: `Phiếu ${imp.receiptCode} cần thanh toán ${imp.debtAmount.toLocaleString('vi-VN')} đ trong ${daysRemaining === 0 ? 'hôm nay' : `${daysRemaining} ngày tới`} (Hạn: ${imp.dueDate}).`,
          timestamp: imp.updatedAt,
          read: false,
          actionTab: 'debts',
          relatedId: imp.id,
        });
      }
    }
  }

  // 2. Customer Debt Notifications
  if (prefs.debtCustomerEnabled) {
    for (const sale of sales) {
      if (sale.debtAmount <= 0) continue;
      const { urgency, daysRemaining } = evaluateDebtUrgency(
        sale.dueDate,
        sale.debtAmount,
        referenceDateStr,
        leadDays
      );
      if (urgency === 'overdue') {
        notifications.push({
          id: `notif-cust-overdue-${sale.id}`,
          category: 'customer_debt',
          severity: 'critical',
          title: `Khách hàng quá hạn thanh toán: ${sale.customerName} (${sale.invoiceCode})`,
          message: `Hóa đơn ${sale.invoiceCode} còn nợ ${sale.debtAmount.toLocaleString('vi-VN')} đ đã quá hạn ${Math.abs(daysRemaining)} ngày (SĐT: ${sale.customerPhone || 'Chưa cập nhật'}). Bấm để mở chứng từ ${sale.invoiceCode}.`,
          timestamp: sale.updatedAt,
          read: false,
          actionTab: 'debts',
          relatedId: sale.id,
        });
      } else if (urgency === 'due_soon') {
        notifications.push({
          id: `notif-cust-soon-${sale.id}`,
          category: 'customer_debt',
          severity: 'warning',
          title: `Nhắc thu nợ khách hàng: ${sale.customerName} (${sale.invoiceCode})`,
          message: `Hóa đơn ${sale.invoiceCode} (${sale.debtAmount.toLocaleString('vi-VN')} đ) sẽ đến hạn vào ngày ${sale.dueDate}. Bấm để mở chứng từ ${sale.invoiceCode}.`,
          timestamp: sale.updatedAt,
          read: false,
          actionTab: 'debts',
          relatedId: sale.id,
        });
      }
    }
  }

  // 3. Low Stock Notifications
  if (prefs.lowStockEnabled) {
    for (const product of products) {
      const alert = evaluateStockAlert(product);
      if (alert === 'out_of_stock') {
        notifications.push({
          id: `notif-stock-out-${product.id}`,
          category: 'low_stock',
          severity: 'critical',
          title: `Hết hàng trong kho: ${product.name}`,
          message: `Vật tư [${product.code}] đã hết tồn kho (0 ${product.unit}). Cần tạo phiếu nhập hàng ngay từ ${product.supplierName}.`,
          timestamp: product.updatedAt,
          read: false,
          actionTab: 'inventory',
          relatedId: product.id,
        });
      } else if (alert === 'low_stock') {
        notifications.push({
          id: `notif-stock-low-${product.id}`,
          category: 'low_stock',
          severity: 'warning',
          title: `Cảnh báo sắp hết hàng: ${product.name}`,
          message: `Tồn kho hiện tại còn ${product.stock} ${product.unit} (mức tối thiểu: ${product.minStock} ${product.unit}). Hãy nhập thêm kịp thời.`,
          timestamp: product.updatedAt,
          read: false,
          actionTab: 'inventory',
          relatedId: product.id,
        });
      }

      if ((Number(product.stock) || 0) > 0 && product.expiryDate) {
        const exp = evaluateProductExpiry(product.expiryDate, referenceDateStr);
        if (exp.status === 'expired') {
          notifications.push({
            id: `notif-expiry-expired-${product.id}`,
            category: 'low_stock',
            severity: 'critical',
            title: `Hàng đã hết hạn sử dụng: ${product.name}`,
            message: `Lô ${product.batchNumber || 'hiện tại'} (${product.stock} ${product.unit}) đã hết hạn ngày ${product.expiryDate}. Vui lòng ngừng bán và kiểm kê tách lô!`,
            timestamp: product.updatedAt,
            read: false,
            actionTab: 'inventory',
            relatedId: product.id,
          });
        } else if (exp.status === 'expiring_30d') {
          notifications.push({
            id: `notif-expiry-soon-${product.id}`,
            category: 'low_stock',
            severity: 'warning',
            title: `Sắp hết hạn sử dụng (FEFO): ${product.name}`,
            message: `Lô ${product.batchNumber || 'hiện tại'} (${product.stock} ${product.unit}) còn ${exp.daysRemaining} ngày (HSD: ${product.expiryDate}). Hãy ưu tiên xuất bán trước!`,
            timestamp: product.updatedAt,
            read: false,
            actionTab: 'inventory',
            relatedId: product.id,
          });
        }
      }
    }
  }

  // 4. Periodic Report & Daily Backup Ready Notifications
  if (prefs.periodicReportEnabled) {
    const totalSalesRevenue = sales.reduce((sum, s) => sum + s.totalAmount, 0);
    notifications.push({
      id: `notif-report-ready-${referenceDateStr}`,
      category: 'periodic_report',
      severity: 'info',
      title: `Báo cáo định kỳ & Đối soát (${referenceDateStr}) đã sẵn sàng`,
      message: `Báo cáo tổng hợp (${sales.length} đơn bán, doanh thu ${totalSalesRevenue.toLocaleString('vi-VN')} đ, ${imports.length} phiếu nhập) đã sẵn sàng xuất Excel (.xlsx) và PDF.`,
      timestamp: `${referenceDateStr}T08:00:00.000Z`,
      read: false,
      actionTab: 'reports',
    });

    if (backups.length > 0) {
      const latest = backups[0];
      notifications.push({
        id: `notif-backup-latest-${latest.id}`,
        category: 'periodic_report',
        severity: 'info',
        title: `Sao lưu tự động Google Drive hoàn tất`,
        message: `Tệp "${latest.fileName}" (${latest.recordCount} bản ghi) đã được đồng bộ tới ${latest.targetEmail}.`,
        timestamp: latest.createdAt,
        read: false,
        actionTab: 'reports',
      });
    }
  }

  return notifications;
}

export type RoleAction =
  | 'view_profit'
  | 'edit_record'
  | 'delete_record'
  | 'manage_staff'
  | 'configure_backup'
  | 'create_sale'
  | 'create_import'
  | 'export_report';

export function canPerformRoleAction(role: UserRole, action: RoleAction): boolean {
  if (role === 'manager') return true;
  // Staff permissions: can sell, import, view inventory, manage customer debts, export reports
  // ONLY Manager can edit_record, delete_record, view_profit, manage_staff, configure_backup
  const staffAllowed: RoleAction[] = ['create_sale', 'create_import', 'export_report'];
  return staffAllowed.includes(action);
}

export const PRIMARY_ADMIN_UID = 'Gu6OYdsdiWbRvbEINqaWZXj3LV83';
export const PRIMARY_MANAGER_EMAIL = 'trannhat1205@gmail.com';
export const PRIMARY_MANAGER_PHONE = '0393120246';
export const MANDATORY_WAREHOUSE_PREFIX = 'TÂM AN';

/**
 * Generates the default warehouse display name for a newly registered Gmail account:
 * "TÂM AN " + uppercase Gmail prefix before "@".
 * Example: "vtnntaman@gmail.com" -> "TÂM AN VTNNTAMAN"
 */
export function formatDefaultWarehouseNameFromGmail(email: string): string {
  const trimmed = (email || '').trim().toLowerCase();
  const localPart = (trimmed.split('@')[0] || '')
    .replace(/[^a-zA-Z0-9À-ỹ_\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  if (!localPart) {
    return `${MANDATORY_WAREHOUSE_PREFIX} KHO MỚI`;
  }
  const stripped = localPart.replace(/^TÂM\s+AN\s+/i, '').replace(/^TAM\s+AN\s+/i, '').trim();
  return `${MANDATORY_WAREHOUSE_PREFIX} ${stripped || localPart}`;
}

/**
 * Extracts the editable suffix after the mandatory "TÂM AN" prefix.
 * Example: "TÂM AN VTNNTAMAN" -> "VTNNTAMAN", "Tâm An Ba Sao" -> "BA SAO"
 */
export function extractCustomWarehouseSuffix(warehouseName: string): string {
  const trimmed = (warehouseName || '').trim();
  const withoutPrefix = trimmed
    .replace(/^TÂM\s+AN\s*/i, '')
    .replace(/^TAM\s+AN\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return withoutPrefix.toUpperCase();
}

/**
 * Normalizes any custom warehouse name input so the mandatory "TÂM AN" prefix
 * is always preserved in uppercase (e.g., "Ba Sao" or "Tâm An Ba Sao" -> "TÂM AN BA SAO").
 */
export function normalizeCustomTamAnWarehouseName(
  customInput: string,
  fallbackEmail?: string
): string {
  const suffix = extractCustomWarehouseSuffix(customInput);
  if (!suffix) {
    return fallbackEmail
      ? formatDefaultWarehouseNameFromGmail(fallbackEmail)
      : `${MANDATORY_WAREHOUSE_PREFIX} KHO MỚI`;
  }
  return `${MANDATORY_WAREHOUSE_PREFIX} ${suffix}`;
}

/**
 * Full functional permissions for an independent single-warehouse user account.
 * Grants all administrative & operational capabilities within their own assigned warehouse.
 */
export function getIndependentWarehouseFullPermissions(): StaffFunctionalPermission[] {
  return [
    'manage_single_warehouse',
    'warehouse_accounting',
    'sales_accounting',
    'customer_debt_accounting',
    'supplier_debt_accounting',
    'cash_treasurer',
    'bank_treasurer',
    'sales_and_invoicing',
    'import_and_supplier',
    'edit_delete_vouchers',
    'export_import_excel',
    'view_assigned_reports',
  ];
}

/**
 * ONLY the primary Admin account (Firebase UID Gu6OYdsdiWbRvbEINqaWZXj3LV83,
 * Gmail trannhat1205@gmail.com, or Phone 0393120246)
 * is the system-wide Admin with authority to manage all warehouses and assign warehouse permissions.
 */
export function canAccountCreateStaff(
  staff:
    | (Pick<StaffMember, 'email' | 'phone' | 'positionRole'> & { uid?: string })
    | null
    | undefined
): boolean {
  if (!staff) return false;
  if (staff.uid === PRIMARY_ADMIN_UID || staff.uid === 'staff_manager_01') {
    return true;
  }
  const normalizedEmail = (staff.email || '').trim().toLowerCase();
  const normalizedPhone = (staff.phone || '').replace(/\D+/g, '');
  if (stackMatchesPrimaryOwner(normalizedEmail, normalizedPhone)) {
    return true;
  }
  return false;
}

function stackMatchesPrimaryOwner(normalizedEmail: string, normalizedPhone: string): boolean {
  return (
    normalizedEmail === PRIMARY_MANAGER_EMAIL ||
    normalizedPhone === PRIMARY_MANAGER_PHONE
  );
}

export const ALL_STAFF_FUNCTIONAL_PERMISSIONS: {
  key: StaffFunctionalPermission;
  label: string;
  description: string;
}[] = [
  {
    key: 'manage_single_warehouse',
    label: 'Quản lý kho riêng',
    description:
      'Chức năng: Kiểm soát nhập - xuất - tồn kho, định mức cảnh báo hết hàng, điều chỉnh danh mục vật tư và quản lý vận hành tại kho riêng được giao.',
  },
  {
    key: 'manage_all_warehouses',
    label: 'Phó quản lý chung tất cả các kho',
    description:
      'Chức năng: Phụ tiếp tài khoản Quản lý chính giám sát, điều phối vật tư, hóa đơn và công nợ trên toàn bộ các kho (Mỹ Ngãi, Cao Lãnh, Mỹ Trà...).',
  },
  {
    key: 'sales_accounting',
    label: 'Kế toán bán hàng',
    description:
      'Chức năng: Lập & kiểm tra hóa đơn bán hàng, kiểm soát đơn giá bán - thành tiền, xuất phiếu in hóa đơn PDF và tổng hợp sổ nhật ký bán hàng.',
  },
  {
    key: 'customer_debt_accounting',
    label: 'Kế toán công nợ bán hàng (Công nợ Khách hàng)',
    description:
      'Chức năng: Theo dõi công nợ cũ & công nợ phát sinh của khách hàng, nhắc lịch thu nợ đến hạn/quá hạn, ghi nhận thu nợ và xuất Phiếu thu tiền KH.',
  },
  {
    key: 'supplier_debt_accounting',
    label: 'Kế toán công nợ Nhà cung cấp',
    description:
      'Chức năng: Đối soát công nợ phải trả Nhà cung cấp theo từng lô nhập kho, theo dõi hạn trả nợ NCC, ghi nhận thanh toán và xuất Phiếu chi trả nợ NCC.',
  },
  {
    key: 'cash_treasurer',
    label: 'Thủ quỹ tiền mặt',
    description:
      'Chức năng: Quản lý thu - chi tiền mặt thực tế tại quầy/kho, đối chiếu số tiền mặt khách trả trực tiếp, duyệt phiếu thu/chi tiền mặt và chốt quỹ cuối ngày.',
  },
  {
    key: 'bank_treasurer',
    label: 'Thủ quỹ Ngân hàng (Chuyển khoản / Sao kê)',
    description:
      'Chức năng: Kiểm tra biến động số dư & sao kê ngân hàng, xác nhận khoản khách chuyển khoản/QR và lập lệnh chuyển khoản thanh toán cho Nhà cung cấp.',
  },
  {
    key: 'warehouse_accounting',
    label: 'Kế toán tổng hợp từng kho riêng',
    description:
      'Chức năng: Phụ trách toàn bộ nghiệp vụ kế toán nội bộ, đối soát tồn kho - doanh thu - công nợ riêng của chi nhánh kho được phân công.',
  },
  {
    key: 'sales_and_invoicing',
    label: 'Nhân viên Bán hàng & Xuất phiếu giao hàng',
    description:
      'Chức năng: Tạo đơn bán hàng mới, tra cứu giá bán & tồn kho nhanh, thêm hồ sơ khách hàng mới và in hóa đơn giao hàng.',
  },
  {
    key: 'import_and_supplier',
    label: 'Nhân viên Nhập kho & Tiếp nhận vật tư NCC',
    description:
      'Chức năng: Lập phiếu nhập kho khi hàng về, kiểm đếm số lượng nhập thực tế, cập nhật giá nhập và thông tin Nhà cung cấp.',
  },
  {
    key: 'edit_delete_vouchers',
    label: 'Quyền Sửa / Xóa hóa đơn, chứng từ & phiếu thu',
    description:
      'Chức năng: Được phép mở chỉnh sửa trực tiếp hoặc xóa các hóa đơn bán hàng, phiếu nhập kho, phiếu thu/chi đã lưu trong hệ thống.',
  },
  {
    key: 'export_import_excel',
    label: 'Nhập / Xuất dữ liệu mẫu Excel (.xlsx) & Báo cáo',
    description:
      'Chức năng: Tải tệp Excel mẫu, nhập dữ liệu hàng loạt từ Excel lên ứng dụng và xuất báo cáo tổng hợp định kỳ ra Excel/PDF.',
  },
  {
    key: 'view_assigned_reports',
    label: 'Xem & Xuất báo cáo theo nhiệm vụ',
    description:
      'Chức năng: Nhân viên được xem, kiểm tra chi tiết và xuất báo cáo (Từ ngày... đến ngày...) tương ứng đúng với mục nghiệp vụ do mình quản lý.',
  },
];

export function getDefaultPermissionsForPosition(
  positionRole: StaffPositionRole
): StaffFunctionalPermission[] {
  switch (positionRole) {
    case 'primary_manager':
      return [
        'create_staff_accounts',
        'manage_all_warehouses',
        'manage_single_warehouse',
        'warehouse_accounting',
        'sales_accounting',
        'customer_debt_accounting',
        'supplier_debt_accounting',
        'cash_treasurer',
        'bank_treasurer',
        'sales_and_invoicing',
        'import_and_supplier',
        'edit_delete_vouchers',
        'export_import_excel',
        'view_assigned_reports',
      ];
    case 'deputy_general_manager':
      return [
        'manage_all_warehouses',
        'manage_single_warehouse',
        'warehouse_accounting',
        'sales_accounting',
        'customer_debt_accounting',
        'supplier_debt_accounting',
        'sales_and_invoicing',
        'import_and_supplier',
        'edit_delete_vouchers',
        'export_import_excel',
        'view_assigned_reports',
      ];
    case 'warehouse_manager':
      return [
        'manage_single_warehouse',
        'sales_and_invoicing',
        'import_and_supplier',
        'export_import_excel',
        'view_assigned_reports',
      ];
    case 'warehouse_accountant':
      return [
        'warehouse_accounting',
        'sales_accounting',
        'customer_debt_accounting',
        'supplier_debt_accounting',
        'export_import_excel',
        'view_assigned_reports',
      ];
    case 'sales_accountant':
      return [
        'sales_accounting',
        'customer_debt_accounting',
        'sales_and_invoicing',
        'export_import_excel',
        'view_assigned_reports',
      ];
    case 'debt_accountant':
      return [
        'customer_debt_accounting',
        'supplier_debt_accounting',
        'warehouse_accounting',
        'export_import_excel',
        'view_assigned_reports',
      ];
    case 'cash_bank_treasurer':
      return [
        'cash_treasurer',
        'bank_treasurer',
        'customer_debt_accounting',
        'supplier_debt_accounting',
        'view_assigned_reports',
      ];
    case 'sales_warehouse_staff':
    default:
      return [
        'sales_and_invoicing',
        'import_and_supplier',
        'export_import_excel',
        'view_assigned_reports',
      ];
  }
}

export function getPositionRoleLabel(positionRole?: StaffPositionRole): string {
  switch (positionRole) {
    case 'primary_manager':
      return 'Quản lý chính (Toàn quyền & Cấp tài khoản)';
    case 'deputy_general_manager':
      return 'Phó quản lý chung tất cả các kho';
    case 'warehouse_manager':
      return 'Nhân sự Quản lý từng kho riêng';
    case 'warehouse_accountant':
      return 'Nhân sự Kế toán từng kho riêng';
    case 'sales_accountant':
      return 'Kế toán bán hàng & Hóa đơn';
    case 'debt_accountant':
      return 'Kế toán công nợ Bán hàng & Nhà cung cấp';
    case 'cash_bank_treasurer':
      return 'Thủ quỹ Tiền mặt & Ngân hàng';
    case 'sales_warehouse_staff':
    default:
      return 'Nhân viên bán hàng & quản lý kho riêng';
  }
}


export function updateSaleRecord(
  existing: SaleTransaction,
  changes: {
    invoiceCode?: string;
    warehouseName?: string;
    customerName?: string;
    customerPhone?: string;
    productName?: string;
    unit?: string;
    quantity: number;
    unitPrice: number;
    unitCost?: number;
    paidAmount: number;
    dueDate: string;
    note: string;
    promotionType?: SalePromotionType;
    discountAmount?: number;
    discountPercent?: number;
    giftProductId?: string;
    giftProductName?: string;
    giftUnit?: string;
    giftQuantity?: number;
    giftUnitCost?: number;
  },
  nowIso: string
): SaleTransaction {
  const effectiveDiscount =
    changes.discountAmount !== undefined ? changes.discountAmount : existing.discountAmount || 0;
  const summary = calculateSaleSummary(
    changes.quantity,
    changes.unitPrice,
    changes.paidAmount,
    effectiveDiscount
  );
  return {
    ...existing,
    invoiceCode: changes.invoiceCode?.trim() || existing.invoiceCode,
    warehouseName: changes.warehouseName?.trim() || existing.warehouseName || 'Tâm An Mỹ Ngãi',
    customerName: changes.customerName?.trim() || existing.customerName,
    customerPhone: changes.customerPhone?.trim() ?? existing.customerPhone,
    productName: changes.productName?.trim() || existing.productName,
    unit: changes.unit?.trim() || existing.unit,
    quantity: Math.max(1, Math.round(Number(changes.quantity) || 1)),
    unitPrice: Math.max(0, Math.round(Number(changes.unitPrice) || 0)),
    unitCost:
      changes.unitCost !== undefined
        ? Math.max(0, Math.round(Number(changes.unitCost) || 0))
        : existing.unitCost,
    totalAmount: summary.totalAmount,
    paidAmount: summary.paidAmount,
    debtAmount: summary.debtAmount,
    status: summary.status,
    dueDate: changes.dueDate || existing.dueDate,
    promotionType: changes.promotionType ?? existing.promotionType,
    discountAmount: summary.discountAmount,
    discountPercent: changes.discountPercent ?? existing.discountPercent,
    giftProductId: changes.giftProductId ?? existing.giftProductId,
    giftProductName: changes.giftProductName ?? existing.giftProductName,
    giftUnit: changes.giftUnit ?? existing.giftUnit,
    giftQuantity:
      changes.giftQuantity !== undefined ? Math.max(0, Number(changes.giftQuantity) || 0) : existing.giftQuantity,
    giftUnitCost: changes.giftUnitCost ?? existing.giftUnitCost,
    note: changes.note,
    updatedAt: nowIso,
  };
}

export function updateImportRecord(
  existing: ImportTransaction,
  changes: {
    receiptCode?: string;
    warehouseName?: string;
    supplierName?: string;
    supplierPhone?: string;
    productName?: string;
    unit?: string;
    quantity: number;
    unitCost: number;
    paidAmount: number;
    dueDate: string;
    note: string;
  },
  nowIso: string
): ImportTransaction {
  const summary = calculateImportSummary(changes.quantity, changes.unitCost, changes.paidAmount);
  return {
    ...existing,
    receiptCode: changes.receiptCode?.trim() || existing.receiptCode,
    warehouseName: changes.warehouseName?.trim() || existing.warehouseName || 'Tâm An Mỹ Ngãi',
    supplierName: changes.supplierName?.trim() || existing.supplierName,
    supplierPhone: changes.supplierPhone?.trim() ?? existing.supplierPhone,
    productName: changes.productName?.trim() || existing.productName,
    unit: changes.unit?.trim() || existing.unit,
    quantity: Math.max(1, Math.round(Number(changes.quantity) || 1)),
    unitCost: Math.max(0, Math.round(Number(changes.unitCost) || 0)),
    totalCost: summary.totalCost,
    paidAmount: summary.paidAmount,
    debtAmount: summary.debtAmount,
    status: summary.status,
    dueDate: changes.dueDate || existing.dueDate,
    note: changes.note,
    updatedAt: nowIso,
  };
}

export interface CustomerOldDebtSummary {
  hasCustomer: boolean;
  customerName: string;
  oldDebtAmount: number;
  currentOrderDebt: number;
  cumulativeTotalDebt: number;
  unpaidInvoices: SaleTransaction[];
}

export function computeCustomerOldDebtSummary(
  customer: CustomerProfile | null | undefined,
  sales: SaleTransaction[],
  currentOrderDebt: number
): CustomerOldDebtSummary {
  const safeCurrentDebt = Math.max(0, Math.round(Number(currentOrderDebt) || 0));
  if (!customer) {
    return {
      hasCustomer: false,
      customerName: '',
      oldDebtAmount: 0,
      currentOrderDebt: safeCurrentDebt,
      cumulativeTotalDebt: safeCurrentDebt,
      unpaidInvoices: [],
    };
  }

  const unpaidInvoices = sales.filter(
    (s) =>
      s.debtAmount > 0 &&
      (s.customerId === customer.id ||
        (customer.phone && s.customerPhone === customer.phone) ||
        s.customerName.trim().toLowerCase() === customer.name.trim().toLowerCase())
  );

  const sumUnpaidSales = unpaidInvoices.reduce((sum, s) => sum + s.debtAmount, 0);
  const oldDebtAmount =
    unpaidInvoices.length > 0 ? sumUnpaidSales : Math.max(0, Math.round(customer.totalDebt || 0));

  return {
    hasCustomer: true,
    customerName: customer.name,
    oldDebtAmount,
    currentOrderDebt: safeCurrentDebt,
    cumulativeTotalDebt: oldDebtAmount + safeCurrentDebt,
    unpaidInvoices,
  };
}

export interface SupplierOldDebtSummary {
  hasSupplier: boolean;
  supplierName: string;
  oldDebtAmount: number;
  currentImportDebt: number;
  cumulativeTotalDebt: number;
  unpaidReceipts: ImportTransaction[];
}

export function computeSupplierOldDebtSummary(
  supplierName: string | null | undefined,
  imports: ImportTransaction[],
  currentImportDebt: number
): SupplierOldDebtSummary {
  const safeCurrentDebt = Math.max(0, Math.round(Number(currentImportDebt) || 0));
  const trimmedName = (supplierName || '').trim();
  if (!trimmedName || trimmedName === '__new_supplier__') {
    return {
      hasSupplier: false,
      supplierName: '',
      oldDebtAmount: 0,
      currentImportDebt: safeCurrentDebt,
      cumulativeTotalDebt: safeCurrentDebt,
      unpaidReceipts: [],
    };
  }

  const normalizedTarget = normalizeVietnameseSearch(trimmedName);
  const unpaidReceipts = imports.filter(
    (imp) =>
      imp.debtAmount > 0 &&
      normalizeVietnameseSearch(imp.supplierName) === normalizedTarget
  );

  const oldDebtAmount = unpaidReceipts.reduce((sum, imp) => sum + imp.debtAmount, 0);

  return {
    hasSupplier: true,
    supplierName: trimmedName,
    oldDebtAmount,
    currentImportDebt: safeCurrentDebt,
    cumulativeTotalDebt: oldDebtAmount + safeCurrentDebt,
    unpaidReceipts,
  };
}

export function formatVND(amount: number): string {
  return `${Math.round(amount || 0).toLocaleString('vi-VN')}\u00A0đ`;
}

export interface StaffAccessScope {
  isPrimaryOwner: boolean;
  effectivePermissions: StaffFunctionalPermission[];
  canAccessSales: boolean;
  canAccessImports: boolean;
  canAccessInventory: boolean;
  canAccessCustomers: boolean;
  canAccessCustomerDebts: boolean;
  canAccessSupplierDebts: boolean;
  canAccessDebts: boolean;
  canAccessReceiptVouchers: boolean;
  canAccessPaymentVouchers: boolean;
  canAccessVouchers: boolean;
  canAccessCashflow: boolean;
  canAccessReports: boolean;
  canAccessBackupHistory: boolean;
  canEditDeleteVouchers: boolean;
  allowedTabs: string[];
  allowedReportCategories: ReportModuleCategory[];
}

export function evaluateStaffAccessScope(
  staff: StaffMember | null | undefined
): StaffAccessScope {
  const isPrimaryOwner = canAccountCreateStaff(staff);
  const perms: StaffFunctionalPermission[] =
    staff?.permissions && staff.permissions.length > 0
      ? staff.permissions
      : getDefaultPermissionsForPosition(staff?.positionRole || 'sales_warehouse_staff');

  const hasAllWarehouses = isPrimaryOwner || perms.includes('manage_all_warehouses');

  const canAccessSales =
    hasAllWarehouses ||
    perms.includes('sales_accounting') ||
    perms.includes('sales_and_invoicing') ||
    perms.includes('warehouse_accounting');

  const canAccessImports =
    hasAllWarehouses ||
    perms.includes('import_and_supplier') ||
    perms.includes('manage_single_warehouse') ||
    perms.includes('warehouse_accounting');

  const canAccessInventory =
    hasAllWarehouses ||
    perms.includes('manage_single_warehouse') ||
    perms.includes('warehouse_accounting');

  const canAccessCustomers =
    hasAllWarehouses ||
    perms.includes('sales_accounting') ||
    perms.includes('customer_debt_accounting') ||
    perms.includes('sales_and_invoicing') ||
    perms.includes('warehouse_accounting');

  const canAccessCustomerDebts =
    hasAllWarehouses ||
    perms.includes('customer_debt_accounting') ||
    perms.includes('cash_treasurer') ||
    perms.includes('bank_treasurer') ||
    perms.includes('warehouse_accounting');

  const canAccessSupplierDebts =
    hasAllWarehouses ||
    perms.includes('supplier_debt_accounting') ||
    perms.includes('cash_treasurer') ||
    perms.includes('bank_treasurer') ||
    perms.includes('warehouse_accounting');

  const canAccessDebts = canAccessCustomerDebts || canAccessSupplierDebts;

  const canAccessReceiptVouchers =
    hasAllWarehouses ||
    perms.includes('cash_treasurer') ||
    perms.includes('bank_treasurer') ||
    perms.includes('customer_debt_accounting') ||
    perms.includes('sales_accounting') ||
    perms.includes('warehouse_accounting') ||
    perms.includes('sales_and_invoicing');

  const canAccessPaymentVouchers =
    hasAllWarehouses ||
    perms.includes('cash_treasurer') ||
    perms.includes('bank_treasurer') ||
    perms.includes('supplier_debt_accounting') ||
    perms.includes('warehouse_accounting') ||
    perms.includes('import_and_supplier');

  const canAccessCashflow =
    hasAllWarehouses ||
    perms.includes('cash_treasurer') ||
    perms.includes('bank_treasurer') ||
    perms.includes('warehouse_accounting') ||
    perms.includes('sales_accounting') ||
    perms.includes('customer_debt_accounting') ||
    perms.includes('supplier_debt_accounting');

  const canAccessVouchers =
    hasAllWarehouses ||
    perms.includes('sales_accounting') ||
    perms.includes('customer_debt_accounting') ||
    perms.includes('supplier_debt_accounting') ||
    perms.includes('cash_treasurer') ||
    perms.includes('bank_treasurer') ||
    perms.includes('sales_and_invoicing') ||
    perms.includes('import_and_supplier') ||
    perms.includes('warehouse_accounting');

  const canAccessReports =
    hasAllWarehouses ||
    perms.includes('view_assigned_reports') ||
    perms.includes('export_import_excel') ||
    perms.includes('warehouse_accounting');

  const hasFullSingleWarehouseAdmin =
    isPrimaryOwner ||
    (perms.includes('manage_single_warehouse') &&
      perms.includes('warehouse_accounting') &&
      perms.includes('edit_delete_vouchers'));

  // STRICT RULE: Only the 1 primary admin account (trannhat1205@gmail.com / Gu6OYdsdiWbRvbEINqaWZXj3LV83) sees "Sao lưu & Lịch sử"
  const canAccessBackupHistory = isPrimaryOwner;

  const canEditDeleteVouchers =
    hasAllWarehouses || perms.includes('edit_delete_vouchers');

  // Determine the exact report tabs this staff member is authorized to view & export for upper management
  // Ordered sequentially 1 -> 8 to match REPORT_CATEGORY_META labels (1, 2, 3, 4, 5, 6, 7, 8)
  const allowedReportCategories: ReportModuleCategory[] = [];
  if (canAccessReports) {
    allowedReportCategories.push('overview');
    if (canAccessCustomers) allowedReportCategories.push('customers_items');
    if (canAccessSales) allowedReportCategories.push('sales_log');
    if (canAccessImports) allowedReportCategories.push('imports_log');
    if (canAccessInventory) allowedReportCategories.push('inventory_stock');
    if (canAccessDebts) allowedReportCategories.push('debts_receivable_payable');
    if (canAccessCashflow) allowedReportCategories.push('cashflow_treasury');
    if (isPrimaryOwner || hasFullSingleWarehouseAdmin) {
      allowedReportCategories.push('financial_profit');
    }
  }

  const allowedTabs: string[] = ['dashboard'];
  if (canAccessSales) allowedTabs.push('sales');
  if (canAccessImports) allowedTabs.push('imports');
  if (canAccessReceiptVouchers) allowedTabs.push('receipt_vouchers');
  if (canAccessPaymentVouchers) allowedTabs.push('payment_vouchers');
  if (canAccessInventory) allowedTabs.push('inventory');
  if (canAccessCustomers) allowedTabs.push('customers');
  if (canAccessDebts) allowedTabs.push('debts');
  if (canAccessVouchers) allowedTabs.push('vouchers');
  allowedTabs.push('staff_accounts');
  if (canAccessReports) allowedTabs.push('reports');
  allowedTabs.push('gemini_chat');
  allowedTabs.push('internal_chat');
  if (canAccessBackupHistory) allowedTabs.push('backup_history');

  return {
    isPrimaryOwner,
    effectivePermissions: perms,
    canAccessSales,
    canAccessImports,
    canAccessInventory,
    canAccessCustomers,
    canAccessCustomerDebts,
    canAccessSupplierDebts,
    canAccessDebts,
    canAccessReceiptVouchers,
    canAccessPaymentVouchers,
    canAccessVouchers,
    canAccessCashflow,
    canAccessReports,
    canAccessBackupHistory,
    canEditDeleteVouchers,
    allowedTabs,
    allowedReportCategories,
  };
}

/**
 * STRICT EXCLUSIVE RULE:
 * ONLY the 1 primary admin account (Gmail trannhat1205@gmail.com or Phone 0393120246)
 * is permitted to view the operation audit history (Lịch sử các thao tác đã thực hiện)
 * and download/restore full backup files on the computer.
 * Even Deputy Managers or managers granted delete permissions cannot view the audit history.
 */
export function canViewAuditHistory(
  staff: Pick<StaffMember, 'email' | 'phone' | 'positionRole'> | null | undefined
): boolean {
  return canAccountCreateStaff(staff);
}

export function createAuditLogEntry(params: {
  actor: StaffMember;
  category: AuditActionCategory;
  targetEntity: AuditTargetEntity;
  targetCode: string;
  actionTitle: string;
  details: string;
  warehouseName?: string;
  snapshotObject?: unknown;
  nowIso?: string;
}): AuditLogEntry {
  const timestamp = params.nowIso || new Date().toISOString();
  let snapshotData: string | undefined;
  if (params.snapshotObject !== undefined) {
    try {
      snapshotData = JSON.stringify(params.snapshotObject);
    } catch {
      snapshotData = undefined;
    }
  }

  return {
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp,
    actorUid: params.actor.uid,
    actorUsername: params.actor.username,
    actorDisplayName: params.actor.displayName,
    actorEmail: params.actor.email || '',
    actorRoleLabel: getPositionRoleLabel(params.actor.positionRole),
    warehouseName:
      params.warehouseName || params.actor.assignedWarehouse || 'Tất cả kho',
    category: params.category,
    targetEntity: params.targetEntity,
    targetCode: params.targetCode,
    actionTitle: params.actionTitle,
    details: params.details,
    snapshotData,
  };
}

export function buildBackupSnapshotPayload(params: {
  fileName: string;
  exportedByEmail: string;
  exportedAt: string;
  warehouses: string[];
  customerGroups: string[];
  productCategories: string[];
  receiptGroups?: string[];
  paymentGroups?: string[];
  products: ProductItem[];
  customers: CustomerProfile[];
  suppliers: SupplierProfile[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  savedVouchers: SavedVoucherRecord[];
  receiptVouchers?: CashReceiptVoucher[];
  paymentVouchers?: CashPaymentVoucher[];
  stockAdjustments?: StockAdjustmentRecord[];
  staffList: StaffMember[];
  auditLogs: AuditLogEntry[];
}): BackupSnapshotPayload {
  const receiptVouchers = params.receiptVouchers || [];
  const paymentVouchers = params.paymentVouchers || [];
  const stockAdjustments = params.stockAdjustments || [];
  const recordCount =
    params.products.length +
    params.customers.length +
    params.sales.length +
    params.imports.length +
    params.savedVouchers.length +
    receiptVouchers.length +
    paymentVouchers.length +
    stockAdjustments.length;

  return {
    version: '2.1-cashflow-fifo-enabled',
    exportedAt: params.exportedAt,
    exportedByEmail: params.exportedByEmail,
    fileName: params.fileName,
    recordCount,
    auditLogCount: params.auditLogs.length,
    warehouses: [...params.warehouses],
    customerGroups: [...params.customerGroups],
    productCategories: [...params.productCategories],
    receiptGroups: params.receiptGroups ? [...params.receiptGroups] : undefined,
    paymentGroups: params.paymentGroups ? [...params.paymentGroups] : undefined,
    products: [...params.products],
    customers: [...params.customers],
    suppliers: [...params.suppliers],
    sales: [...params.sales],
    imports: [...params.imports],
    savedVouchers: [...params.savedVouchers],
    receiptVouchers: [...receiptVouchers],
    paymentVouchers: [...paymentVouchers],
    stockAdjustments: [...stockAdjustments],
    staffList: [...params.staffList],
    auditLogs: [...params.auditLogs],
  };
}

export function parseAndValidateBackupPayload(
  rawJson: string
): { ok: true; payload: BackupSnapshotPayload } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: 'Tệp sao lưu không đúng định dạng JSON hợp lệ.' };
    }
    if (
      !Array.isArray(parsed.products) ||
      !Array.isArray(parsed.customers) ||
      !Array.isArray(parsed.sales) ||
      !Array.isArray(parsed.imports)
    ) {
      return {
        ok: false,
        error:
          'Tệp sao lưu thiếu dữ liệu cốt lõi (vật tư, khách hàng, đơn bán hoặc phiếu nhập).',
      };
    }

    const missingCollections: string[] = [];
    if (!Array.isArray(parsed.savedVouchers)) missingCollections.push('savedVouchers');
    if (!Array.isArray(parsed.receiptVouchers)) missingCollections.push('receiptVouchers');
    if (!Array.isArray(parsed.paymentVouchers)) missingCollections.push('paymentVouchers');
    if (!Array.isArray(parsed.suppliers)) missingCollections.push('suppliers');
    if (!Array.isArray(parsed.stockAdjustments)) missingCollections.push('stockAdjustments');

    const auditLogs: AuditLogEntry[] = Array.isArray(parsed.auditLogs)
      ? parsed.auditLogs
      : [];
    const savedVouchers: SavedVoucherRecord[] = Array.isArray(parsed.savedVouchers)
      ? parsed.savedVouchers
      : [];
    const receiptVouchers: CashReceiptVoucher[] = Array.isArray(parsed.receiptVouchers)
      ? parsed.receiptVouchers
      : [];
    const paymentVouchers: CashPaymentVoucher[] = Array.isArray(parsed.paymentVouchers)
      ? parsed.paymentVouchers
      : [];
    const stockAdjustments: StockAdjustmentRecord[] = Array.isArray(parsed.stockAdjustments)
      ? parsed.stockAdjustments
      : [];
    const suppliers: SupplierProfile[] = Array.isArray(parsed.suppliers)
      ? parsed.suppliers
      : [];
    const staffList: StaffMember[] = Array.isArray(parsed.staffList)
      ? parsed.staffList
      : [];
    const warehouses: string[] = Array.isArray(parsed.warehouses)
      ? parsed.warehouses
      : ['Tâm An Mỹ Ngãi', 'Tâm An Cao Lãnh', 'Tâm An Mỹ Trà'];
    const customerGroups: string[] = Array.isArray(parsed.customerGroups)
      ? parsed.customerGroups
      : ['Nhà nông', 'Đại lý cấp 2', 'Trang trại', 'Khách lẻ'];
    const productCategories: string[] = Array.isArray(parsed.productCategories)
      ? parsed.productCategories
      : ['Phân bón', 'Thuốc BVTV', 'Hạt giống', 'Chế phẩm sinh học', 'Vật tư & Dụng cụ'];
    const receiptGroups: string[] | undefined = Array.isArray(parsed.receiptGroups)
      ? parsed.receiptGroups
      : undefined;
    const paymentGroups: string[] | undefined = Array.isArray(parsed.paymentGroups)
      ? parsed.paymentGroups
      : undefined;

    const recordCount =
      parsed.products.length +
      parsed.customers.length +
      parsed.sales.length +
      parsed.imports.length +
      savedVouchers.length +
      receiptVouchers.length +
      paymentVouchers.length +
      stockAdjustments.length;

    return {
      ok: true,
      payload: {
        version: String(parsed.version || '2.0-audit-enabled'),
        exportedAt: String(parsed.exportedAt || new Date().toISOString()),
        exportedByEmail: String(parsed.exportedByEmail || PRIMARY_MANAGER_EMAIL),
        fileName: String(parsed.fileName || 'VTNN_TamAn_Backup_Restored.json'),
        recordCount,
        auditLogCount: auditLogs.length,
        warehouses,
        customerGroups,
        productCategories,
        receiptGroups,
        paymentGroups,
        products: parsed.products,
        customers: parsed.customers,
        suppliers,
        sales: parsed.sales,
        imports: parsed.imports,
        savedVouchers,
        receiptVouchers,
        paymentVouchers,
        stockAdjustments,
        staffList,
        auditLogs,
        ...(missingCollections.length > 0 ? { missingCollections } : {}),
      },
    };
  } catch {
    return {
      ok: false,
      error: 'Không thể đọc tệp sao lưu JSON. Vui lòng chọn đúng tệp sao lưu (.json) của VTNN Tâm An.',
    };
  }
}

/**
 * Checks whether a staff or manager account has completed supplementing a valid personal Gmail
 * in the personal profile settings (as opposed to an empty email or auto-generated @vtnntaman.vn).
 */
export function hasCompletedStaffPersonalGmail(
  staff: Pick<StaffMember, 'email'> | null | undefined
): boolean {
  if (!staff || !staff.email) return false;
  const email = staff.email.trim().toLowerCase();
  if (!email.includes('@')) return false;
  if (email.endsWith('@vtnntaman.vn')) return false;
  return true;
}

/**
 * Authenticates any employee or manager via Google Sign-In once they have completed
 * supplementing their personal Gmail in the personal profile settings.
 */
export function authenticateStaffByGoogleEmail(
  staffList: StaffMember[],
  rawEmail: string
):
  | { ok: true; staff: StaffMember; message: string }
  | { ok: false; message: string } {
  const email = (rawEmail || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return {
      ok: false,
      message: 'Vui lòng nhập hoặc chọn địa chỉ Gmail hợp lệ để đăng nhập bằng Google.',
    };
  }

  const matched = staffList.find(
    (s) => (s.email || '').trim().toLowerCase() === email
  );

  if (!matched) {
    return {
      ok: false,
      message: `Địa chỉ Gmail "${rawEmail}" chưa được bổ sung trong mục Thông tin cá nhân của nhân viên. Vui lòng đăng nhập bằng Tên đăng nhập / SĐT và mật khẩu, sau đó vào mục "Chỉnh sửa thông tin cá nhân — Bổ sung Gmail nhân viên" để liên kết Gmail cho lần đăng nhập sau.`,
    };
  }

  if (!matched.active) {
    return {
      ok: false,
      message: `Tài khoản @${matched.username} (${matched.displayName}) hiện đang bị khóa bởi Quản lý chính.`,
    };
  }

  if (!hasCompletedStaffPersonalGmail(matched)) {
    return {
      ok: false,
      message: `Tài khoản @${matched.username} chưa hoàn tất bổ sung Gmail cá nhân trong mục Chỉnh sửa thông tin cá nhân.`,
    };
  }

  return {
    ok: true,
    staff: matched,
    message: `Đăng nhập bằng Google thành công (${matched.email}) — Tài khoản: ${matched.displayName} (@${matched.username}) · Kho: ${matched.assignedWarehouse}`,
  };
}

export const DEBT_TERM_DAY_OPTIONS = [7, 30, 60, 90, 120] as const;

export type DebtTermDayOption = (typeof DEBT_TERM_DAY_OPTIONS)[number];

/**
 * Computes the due date string (YYYY-MM-DD) by adding `days` to `baseDateStr` (or today's local date).
 */
export function computeDueDateAfterDays(days: number, baseDateStr?: string): string {
  const safeDays = Math.max(0, Math.round(Number(days) || 0));
  let year: number;
  let month: number;
  let day: number;

  if (baseDateStr && /^\d{4}-\d{2}-\d{2}/.test(baseDateStr.trim())) {
    const parts = baseDateStr.trim().slice(0, 10).split('-').map(Number);
    year = parts[0];
    month = parts[1];
    day = parts[2];
  } else {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth() + 1;
    day = now.getDate();
  }

  const targetUtc = new Date(Date.UTC(year, month - 1, day + safeDays));
  const y = targetUtc.getUTCFullYear();
  const m = String(targetUtc.getUTCMonth() + 1).padStart(2, '0');
  const d = String(targetUtc.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Checks whether a dueDate string matches one of the preset debt term day options (7, 30, 60, 90, 120).
 */
export function matchDebtTermDays(
  dueDateStr: string,
  baseDateStr?: string
): DebtTermDayOption | '' {
  if (!dueDateStr) return '';
  const trimmed = dueDateStr.trim().slice(0, 10);
  for (const days of DEBT_TERM_DAY_OPTIONS) {
    if (computeDueDateAfterDays(days, baseDateStr) === trimmed) {
      return days;
    }
  }
  return '';
}

/**
 * Reads a numeric Excel cell across candidate column headers without treating explicit `0` as falsy.
 * Returns `fallback` ONLY when all candidate keys are missing or blank (`undefined | null | ''`).
 * Strips formatting characters in strings (keeping a leading `-`, e.g. `"150.000 đ"` -> `150000`).
 * Returns `NaN` when the cell is present but cannot be parsed into a finite number.
 */
export function readExcelNumber(
  row: Record<string, unknown>,
  keys: string[],
  fallback: number
): number {
  let rawVal: unknown = undefined;
  let hasValue = false;
  for (const key of keys) {
    const val = row?.[key];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      rawVal = val;
      hasValue = true;
      break;
    }
  }
  if (!hasValue) return fallback;
  if (typeof rawVal === 'number') {
    return Number.isFinite(rawVal) ? rawVal : NaN;
  }
  const trimmed = String(rawVal).trim();
  const isNegative = trimmed.startsWith('-');
  const digitsOnly = trimmed.replace(/\D/g, '');
  if (!digitsOnly) return NaN;
  const parsed = Number((isNegative ? '-' : '') + digitsOnly);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/**
 * Converts an ISO timestamp (with `T`) or bare `YYYY-MM-DD` string into Vietnam local date (`YYYY-MM-DD`, UTC+7).
 */
export function toVietnamDateStr(isoOrDate: string | null | undefined): string {
  if (!isoOrDate) return '';
  const trimmed = String(isoOrDate).trim();
  if (!trimmed) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (trimmed.includes('T')) {
    const ms = Date.parse(trimmed);
    if (Number.isFinite(ms)) {
      return new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 10);
    }
  }
  const prefix = trimmed.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(prefix) ? prefix : '';
}

/**
 * Checks whether an ISO timestamp or YYYY-MM-DD date string falls within [fromDate, toDate] inclusive (Vietnam UTC+7).
 */
export function isDateWithinRange(
  isoOrDateStr: string | null | undefined,
  fromDate?: string,
  toDate?: string
): boolean {
  if (!isoOrDateStr) return true;
  const datePart = toVietnamDateStr(isoOrDateStr);
  if (!datePart) return true;
  if (fromDate && /^\d{4}-\d{2}-\d{2}$/.test(fromDate.trim().slice(0, 10))) {
    if (datePart < fromDate.trim().slice(0, 10)) return false;
  }
  if (toDate && /^\d{4}-\d{2}-\d{2}$/.test(toDate.trim().slice(0, 10))) {
    if (datePart > toDate.trim().slice(0, 10)) return false;
  }
  return true;
}

export interface ReceivedItemReportRow {
  saleId: string;
  invoiceCode: string;
  date: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discountAmount?: number;
  giftProductId?: string;
  giftProductName?: string;
  giftUnit?: string;
  giftQuantity?: number;
  totalAmount: number;
  paidAmount: number;
  debtAmount: number;
  dueDate: string;
  status: 'paid' | 'partial' | 'unpaid';
  warehouseName: string;
  staffName: string;
  note: string;
}

export interface ReceivedItemsAndDebtReportResult {
  items: ReceivedItemReportRow[];
  totalItemsCount: number;
  totalQuantity: number;
  totalAmount: number;
  totalPaid: number;
  totalDebt: number;
  unpaidItemCount: number;
  customerItems: SaleTransaction[];
  supplierItems: ImportTransaction[];
  totalCustomerQuantity: number;
  totalCustomerAmount: number;
  totalCustomerPaid: number;
  totalCustomerRemainingDebt: number;
  unpaidCustomerInvoiceCount: number;
  totalSupplierQuantity: number;
  totalSupplierCost: number;
  totalSupplierPaid: number;
  totalSupplierRemainingDebt: number;
  unpaidSupplierReceiptCount: number;
}

export interface ReceivedItemsReportOptions {
  sales?: SaleTransaction[];
  imports?: ImportTransaction[];
  fromDate?: string;
  toDate?: string;
  customerId?: string;
  supplierName?: string;
  warehouseName?: string | null;
  onlyUnpaid?: boolean;
}

/**
 * Computes the combined list of goods received / sold and remaining debt within [fromDate, toDate].
 * Supports both `computeReceivedItemsAndDebtReport(sales, options)` and `computeReceivedItemsAndDebtReport({ sales, ...options })`.
 */
export function computeReceivedItemsAndDebtReport(
  salesOrParams: SaleTransaction[] | ReceivedItemsReportOptions,
  maybeOptions?: ReceivedItemsReportOptions
): ReceivedItemsAndDebtReportResult {
  const isArrayArg = Array.isArray(salesOrParams);
  const sales: SaleTransaction[] = isArrayArg
    ? salesOrParams
    : Array.isArray(salesOrParams?.sales)
    ? salesOrParams.sales
    : [];
  const opts: ReceivedItemsReportOptions = isArrayArg
    ? maybeOptions || {}
    : salesOrParams || {};

  const {
    imports = [],
    fromDate,
    toDate,
    customerId,
    supplierName,
    warehouseName,
    onlyUnpaid = false,
  } = opts;

  const customerItems = sales
    .filter((s) => {
      if (warehouseName && s.warehouseName !== warehouseName) return false;
      if (customerId && customerId !== 'all' && s.customerId !== customerId) return false;
      if (!isDateWithinRange(s.createdAt, fromDate, toDate)) return false;
      if (onlyUnpaid && s.debtAmount <= 0) return false;
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const items: ReceivedItemReportRow[] = customerItems.map((s) => ({
    saleId: s.id,
    invoiceCode: s.invoiceCode,
    date: (s.createdAt || '').slice(0, 10),
    customerId: s.customerId,
    customerName: s.customerName,
    customerPhone: s.customerPhone,
    productId: s.productId,
    productName: s.productName,
    unit: s.unit,
    quantity: s.quantity,
    unitPrice: s.unitPrice,
    discountAmount: s.discountAmount || 0,
    giftProductId: s.giftProductId,
    giftProductName: s.giftProductName,
    giftUnit: s.giftUnit,
    giftQuantity: s.giftQuantity || 0,
    totalAmount: s.totalAmount,
    paidAmount: s.paidAmount,
    debtAmount: s.debtAmount,
    dueDate: s.dueDate,
    status: s.status,
    warehouseName: s.warehouseName || 'Tâm An Mỹ Ngãi',
    staffName: s.staffName,
    note: s.note || '',
  }));

  const normSupplier = supplierName ? normalizeVietnameseSearch(supplierName) : '';
  const supplierItems = (Array.isArray(imports) ? imports : [])
    .filter((imp) => {
      if (warehouseName && imp.warehouseName !== warehouseName) return false;
      if (normSupplier && normalizeVietnameseSearch(imp.supplierName) !== normSupplier) return false;
      if (!isDateWithinRange(imp.createdAt, fromDate, toDate)) return false;
      if (onlyUnpaid && imp.debtAmount <= 0) return false;
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const totalCustomerQuantity = customerItems.reduce((sum, s) => sum + s.quantity, 0);
  const totalCustomerAmount = customerItems.reduce((sum, s) => sum + s.totalAmount, 0);
  const totalCustomerPaid = customerItems.reduce((sum, s) => sum + s.paidAmount, 0);
  const totalCustomerRemainingDebt = customerItems.reduce((sum, s) => sum + s.debtAmount, 0);
  const unpaidCustomerInvoiceCount = customerItems.filter((s) => s.debtAmount > 0).length;

  const totalSupplierQuantity = supplierItems.reduce((sum, i) => sum + i.quantity, 0);
  const totalSupplierCost = supplierItems.reduce((sum, i) => sum + i.totalCost, 0);
  const totalSupplierPaid = supplierItems.reduce((sum, i) => sum + i.paidAmount, 0);
  const totalSupplierRemainingDebt = supplierItems.reduce((sum, i) => sum + i.debtAmount, 0);
  const unpaidSupplierReceiptCount = supplierItems.filter((i) => i.debtAmount > 0).length;

  return {
    items,
    totalItemsCount: items.length,
    totalQuantity: totalCustomerQuantity,
    totalAmount: totalCustomerAmount,
    totalPaid: totalCustomerPaid,
    totalDebt: totalCustomerRemainingDebt,
    unpaidItemCount: unpaidCustomerInvoiceCount,
    customerItems,
    supplierItems,
    totalCustomerQuantity,
    totalCustomerAmount,
    totalCustomerPaid,
    totalCustomerRemainingDebt,
    unpaidCustomerInvoiceCount,
    totalSupplierQuantity,
    totalSupplierCost,
    totalSupplierPaid,
    totalSupplierRemainingDebt,
    unpaidSupplierReceiptCount,
  };
}

export interface SmartReportRecommendation {
  id: string;
  category: ReportModuleCategory;
  targetCategory: ReportModuleCategory;
  priority: 'high' | 'medium' | 'low';
  badgeLabel: string;
  title: string;
  summary: string;
  suggestedAction: string;
  actionAdvice: string;
  metricHighlight: string;
}

/**
 * Automatically analyzes the selected date range [fromDate, toDate] and the active staff account's
 * assigned permissions/warehouse to recommend the most suitable and urgent reports to review and export.
 */
export function generateSmartReportRecommendations(params: {
  staff: StaffMember;
  accessScope?: StaffAccessScope;
  fromDate: string;
  toDate: string;
  products: ProductItem[];
  customers: CustomerProfile[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  receiptVouchers?: CashReceiptVoucher[];
  paymentVouchers?: CashPaymentVoucher[];
}): SmartReportRecommendation[] {
  const {
    staff,
    fromDate,
    toDate,
    products = [],
    sales = [],
    imports = [],
    receiptVouchers = [],
    paymentVouchers = [],
  } = params;
  const resolvedScope = params.accessScope || evaluateStaffAccessScope(staff);
  const recommendations: SmartReportRecommendation[] = [];
  const allowed = resolvedScope.allowedReportCategories;

  const rangeSales = sales.filter((s) => isDateWithinRange(s.createdAt, fromDate, toDate));
  const rangeImports = imports.filter((i) => isDateWithinRange(i.createdAt, fromDate, toDate));
  const rangeReceipts = receiptVouchers.filter((rv) => isDateWithinRange(rv.createdAt, fromDate, toDate));
  const rangePayments = paymentVouchers.filter((pv) => isDateWithinRange(pv.createdAt, fromDate, toDate));

  const unpaidSales = rangeSales.filter((s) => s.debtAmount > 0);
  const totalSalesRevenue = rangeSales.reduce((sum, s) => sum + s.totalAmount, 0);
  const totalSalesPaid = rangeSales.reduce((sum, s) => sum + s.paidAmount, 0);
  const totalSalesDebt = unpaidSales.reduce((sum, s) => sum + s.debtAmount, 0);

  const unpaidImports = rangeImports.filter((i) => i.debtAmount > 0);
  const totalImportCost = rangeImports.reduce((sum, i) => sum + i.totalCost, 0);
  const totalImportPaid = rangeImports.reduce((sum, i) => sum + i.paidAmount, 0);
  const totalImportDebt = unpaidImports.reduce((sum, i) => sum + i.debtAmount, 0);

  const lowStockItems = products.filter((p) => p.stock <= p.minStock);

  // 1. Debt & Goods Received Collection Recommendation
  if (allowed.includes('debts_receivable_payable') || allowed.includes('customers_items')) {
    if (unpaidSales.length > 0 || unpaidImports.length > 0) {
      const cat: ReportModuleCategory = allowed.includes('debts_receivable_payable')
        ? 'debts_receivable_payable'
        : 'customers_items';
      const advice =
        'Nên xuất ngay "Phiếu Tổng hợp Hàng hóa Đã nhận & Còn nợ (Từ ngày... đến ngày...)" gửi cho từng khách hàng để đối chiếu số lượng vật tư đã lấy và thu hồi công nợ đúng hạn.';
      recommendations.push({
        id: 'rec_debt_collection',
        category: cat,
        targetCategory: cat,
        priority: 'high',
        badgeLabel: 'Đề xuất ưu tiên số 1 · Thu hồi Công nợ & Đối chiếu Hàng đã nhận',
        title: 'Báo cáo Tổng hợp Hàng hóa Còn nợ & Lịch Thu nợ Khách hàng / NCC',
        summary: `Trong kỳ (${fromDate || 'Đầu kỳ'} → ${toDate || 'Hiện tại'}), có ${unpaidSales.length} đơn hàng khách nhận còn nợ (${formatVND(totalSalesDebt)}) và ${unpaidImports.length} lô nhập kho còn nợ NCC (${formatVND(totalImportDebt)}).`,
        suggestedAction: advice,
        actionAdvice: advice,
        metricHighlight: `Phải thu KH: ${formatVND(totalSalesDebt)} (${unpaidSales.length} đơn) · Phải trả NCC: ${formatVND(totalImportDebt)}`,
      });
    }
  }

  // 2. Inventory & Low Stock Restock Recommendation
  if (allowed.includes('inventory_stock')) {
    const advice =
      'Nhân sự phụ trách kho nên xuất Báo cáo Tồn kho để lên kế hoạch nhập hàng kịp thời trước cao điểm mùa vụ.';
    recommendations.push({
      id: 'rec_inventory_stock',
      category: 'inventory_stock',
      targetCategory: 'inventory_stock',
      priority: lowStockItems.length > 0 ? 'high' : 'low',
      badgeLabel:
        lowStockItems.length > 0
          ? `Cảnh báo tồn kho (${lowStockItems.length} mặt hàng sắp hết)`
          : 'Đề xuất kiểm kê định kỳ',
      title: 'Báo cáo Kiểm kê Tồn kho Vật tư & Dự trù Nhập hàng Bổ sung',
      summary: `Kho ${staff.assignedWarehouse} đang quản lý ${products.length} danh mục vật tư nông nghiệp, trong đó có ${lowStockItems.length} mặt hàng chạm hoặc dưới định mức tối thiểu (${lowStockItems.map((p) => p.name).slice(0, 2).join(', ') || 'Ổn định'}).`,
      suggestedAction: advice,
      actionAdvice: advice,
      metricHighlight: `${lowStockItems.length} / ${products.length} vật tư cần nhập thêm`,
    });
  }

  // 3. Sales Log & Revenue Performance Recommendation
  if (allowed.includes('sales_log')) {
    const collectionRate =
      totalSalesRevenue > 0 ? Math.round((totalSalesPaid / totalSalesRevenue) * 100) : 100;
    const advice =
      'Xuất báo cáo chi tiết các mặt hàng bán chạy nhất trong kỳ để điều chỉnh lượng hàng dự trữ và chính sách chiết khấu.';
    recommendations.push({
      id: 'rec_sales_performance',
      category: 'sales_log',
      targetCategory: 'sales_log',
      priority: 'medium',
      badgeLabel: 'Đề xuất Báo cáo Bán hàng',
      title: 'Báo cáo Nhật ký Bán hàng & Tỷ lệ Thu tiền Thực tế theo Kỳ',
      summary: `Ghi nhận ${rangeSales.length} hóa đơn xuất bán với tổng doanh thu ${formatVND(totalSalesRevenue)}, đã thu thực tế ${formatVND(totalSalesPaid)} (Đạt tỷ lệ thu tiền ${collectionRate}%).`,
      suggestedAction: advice,
      actionAdvice: advice,
      metricHighlight: `Doanh thu: ${formatVND(totalSalesRevenue)} · Tỷ lệ thu: ${collectionRate}%`,
    });
  }

  // 4. Import Log & Supplier Delivery Verification
  if (allowed.includes('imports_log')) {
    const advice =
      'Kiểm tra đối chiếu bảng tổng hợp các mặt hàng đã nhận từ Nhà cung cấp theo khoảng ngày để chốt công nợ cuối kỳ chính xác.';
    recommendations.push({
      id: 'rec_imports_supplier',
      category: 'imports_log',
      targetCategory: 'imports_log',
      priority: 'low',
      badgeLabel: 'Đề xuất Đối soát Nhập kho NCC',
      title: 'Báo cáo Nhật ký Nhập hàng & Tổng hợp Vật tư Đã nhận từ Nhà cung cấp',
      summary: `Đã tiếp nhận ${rangeImports.length} lô hàng vật tư với tổng giá trị nhập ${formatVND(totalImportCost)}, đã thanh toán ${formatVND(totalImportPaid)}.`,
      suggestedAction: advice,
      actionAdvice: advice,
      metricHighlight: `${rangeImports.length} phiếu nhập · Tổng nhập: ${formatVND(totalImportCost)}`,
    });
  }

  // 5. Cashflow & Treasury Inflow / Outflow Recommendation
  if (allowed.includes('cashflow_treasury')) {
    const otherReceiptInflow = rangeReceipts
      .filter((rv) => !rv.isDebtSettlement)
      .reduce((sum, rv) => sum + (Number(rv.amount) || 0), 0);
    const operatingPaymentOutflow = rangePayments
      .filter((pv) => !pv.isDebtSettlement)
      .reduce((sum, pv) => sum + (Number(pv.amount) || 0), 0);
    const totalInflow = totalSalesPaid + otherReceiptInflow;
    const totalOutflow = totalImportPaid + operatingPaymentOutflow;
    const netCashflow = totalInflow - totalOutflow;
    const advice =
      'Thủ quỹ và Kế toán nên chốt sổ thu - chi theo khoảng ngày để báo cáo số dư quỹ thực tế và chuẩn bị nguồn tiền thanh toán các lô hàng sắp đến hạn.';
    recommendations.push({
      id: 'rec_cashflow_treasury',
      category: 'cashflow_treasury',
      targetCategory: 'cashflow_treasury',
      priority: 'medium',
      badgeLabel: 'Đề xuất Thủ quỹ & Kế toán Dòng tiền',
      title: 'Báo cáo Thu - Chi Dòng tiền Thực tế & Cân đối Quỹ Tiền mặt / Ngân hàng',
      summary: `Tổng dòng tiền thực thu (bán hàng, thu nợ & thu khác) đạt ${formatVND(totalInflow)}; tổng dòng tiền thực chi (trả NCC & chi vận hành) là ${formatVND(totalOutflow)}.`,
      suggestedAction: advice,
      actionAdvice: advice,
      metricHighlight: `Dòng tiền ròng: ${netCashflow >= 0 ? '+' : ''}${formatVND(netCashflow)}`,
    });
  }

  // 6. Exclusive Primary Manager Financial & Gross Profit Recommendation
  if (allowed.includes('financial_profit')) {
    const estimatedGrossProfit = rangeSales.reduce((sum, sale) => {
      const cost = Math.round(resolveSaleUnitCost(sale, products) * sale.quantity);
      const giftCost = Math.round(resolveSaleGiftUnitCost(sale, products) * (sale.giftQuantity || 0));
      return sum + (sale.totalAmount - cost - giftCost);
    }, 0);
    const marginPct =
      totalSalesRevenue > 0 ? Math.round((estimatedGrossProfit / totalSalesRevenue) * 100) : 0;
    const advice =
      'Đối chiếu tỷ suất lợi nhuận từng mặt hàng phân bón / thuốc BVTV và cân đối giữa tổng phải thu khách hàng với tổng phải trả nhà cung cấp.';

    recommendations.push({
      id: 'rec_financial_profit',
      category: 'financial_profit',
      targetCategory: 'financial_profit',
      priority: 'high',
      badgeLabel: 'Độc quyền Quản lý chính (trannhat1205@gmail.com)',
      title: 'Báo cáo Tài chính Tổng hợp, Lợi nhuận Gộp & Hiệu quả Kinh doanh Đa Kho',
      summary: `Lợi nhuận gộp ước tính trong kỳ đạt ${formatVND(estimatedGrossProfit)} (Biên lợi nhuận gộp ~${marginPct}% trên tổng doanh thu ${formatVND(totalSalesRevenue)}).`,
      suggestedAction: advice,
      actionAdvice: advice,
      metricHighlight: `Lợi nhuận gộp: ${formatVND(estimatedGrossProfit)} (~${marginPct}%)`,
    });
  }

  return recommendations;
}

export interface CustomerMatchIdentifier {
  customerId?: string;
  customerPhone?: string;
  customerName?: string;
  warehouseName?: string | null;
}

export interface CustomerFifoSettlementPreview {
  unpaidInvoicesOrdered: SaleTransaction[];
  allocations: FifoDebtAllocationItem[];
  totalPreviousDebt: number;
  totalAllocated: number;
  unallocatedExcess: number;
  totalRemainingDebt: number;
}

export function matchesCustomerRecord(
  sale: SaleTransaction,
  identifier: CustomerMatchIdentifier
): boolean {
  if (identifier.warehouseName && sale.warehouseName !== identifier.warehouseName) {
    return false;
  }
  if (identifier.customerId && sale.customerId === identifier.customerId) {
    return true;
  }
  const cleanPhone = (identifier.customerPhone || '').trim();
  if (cleanPhone && sale.customerPhone && sale.customerPhone.trim() === cleanPhone) {
    return true;
  }
  const cleanName = normalizeVietnameseSearch(identifier.customerName || '');
  if (cleanName && normalizeVietnameseSearch(sale.customerName) === cleanName) {
    return true;
  }
  return false;
}

/**
 * Previews automatic FIFO debt deduction across all unpaid invoices of a customer
 * sorted strictly by oldest debt date first (createdAt ascending, then dueDate ascending).
 */
export function previewCustomerFifoDebtSettlement(
  sales: SaleTransaction[],
  identifier: CustomerMatchIdentifier,
  lumpSumAmountInput: number
): CustomerFifoSettlementPreview {
  const safeInput = Math.max(0, Math.round(Number(lumpSumAmountInput) || 0));

  const unpaidInvoicesOrdered = sales
    .filter((s) => s.debtAmount > 0 && matchesCustomerRecord(s, identifier))
    .sort((a, b) => {
      const dateCmp = (a.createdAt || '').localeCompare(b.createdAt || '');
      if (dateCmp !== 0) return dateCmp;
      const dueCmp = (a.dueDate || '').localeCompare(b.dueDate || '');
      if (dueCmp !== 0) return dueCmp;
      return (a.invoiceCode || '').localeCompare(b.invoiceCode || '');
    });

  const totalPreviousDebt = unpaidInvoicesOrdered.reduce((sum, s) => sum + s.debtAmount, 0);
  let remainingToAllocate = safeInput;
  let totalAllocated = 0;

  const allocations: FifoDebtAllocationItem[] = unpaidInvoicesOrdered.map((sale) => {
    const allocatedAmount = Math.min(sale.debtAmount, remainingToAllocate);
    remainingToAllocate = Math.max(0, remainingToAllocate - allocatedAmount);
    totalAllocated += allocatedAmount;
    const remainingDebt = Math.max(0, sale.debtAmount - allocatedAmount);

    return {
      recordId: sale.id,
      code: sale.invoiceCode,
      date: (sale.createdAt || '').slice(0, 10),
      dueDate: sale.dueDate || '',
      productName: sale.productName,
      previousDebt: sale.debtAmount,
      allocatedAmount,
      remainingDebt,
    };
  });

  return {
    unpaidInvoicesOrdered,
    allocations,
    totalPreviousDebt,
    totalAllocated,
    unallocatedExcess: Math.max(0, safeInput - totalAllocated),
    totalRemainingDebt: Math.max(0, totalPreviousDebt - totalAllocated),
  };
}

/**
 * Applies automatic FIFO debt settlement across all older unpaid invoices of a customer
 * sorted by oldest debt date first (theo thứ tự ngày nợ).
 */
export function applyCustomerFifoDebtSettlement(
  sales: SaleTransaction[],
  identifier: CustomerMatchIdentifier,
  lumpSumAmountInput: number,
  note: string,
  nowIso: string
): CustomerFifoSettlementPreview & {
  updatedSales: SaleTransaction[];
  settledAllocations: FifoDebtAllocationItem[];
} {
  const preview = previewCustomerFifoDebtSettlement(sales, identifier, lumpSumAmountInput);
  if (preview.totalAllocated <= 0) {
    throw new Error('Số tiền thu quyết toán phải lớn hơn 0 và khách hàng phải có hóa đơn còn nợ.');
  }

  const allocationByRecordId = new Map<string, FifoDebtAllocationItem>();
  for (const alloc of preview.allocations) {
    if (alloc.allocatedAmount > 0) {
      allocationByRecordId.set(alloc.recordId, alloc);
    }
  }

  const cleanNote = (note || '').trim();
  const updatedSales = sales.map((sale) => {
    const alloc = allocationByRecordId.get(sale.id);
    if (!alloc || alloc.allocatedAmount <= 0) return sale;

    const settled = applyDebtPayment(sale, alloc.allocatedAmount, nowIso);
    const noteSuffix = cleanNote
      ? `[Quyết toán công nợ theo thứ tự ngày nợ: +${alloc.allocatedAmount.toLocaleString('vi-VN')}đ - ${cleanNote}]`
      : `[Quyết toán công nợ theo thứ tự ngày nợ: +${alloc.allocatedAmount.toLocaleString('vi-VN')}đ]`;

    return {
      ...settled,
      note: sale.note ? `${sale.note} | ${noteSuffix}` : noteSuffix,
    };
  });

  const settledAllocations = preview.allocations.filter((a) => a.allocatedAmount > 0);

  return {
    ...preview,
    updatedSales,
    settledAllocations,
  };
}

export interface SupplierMatchIdentifier {
  supplierName: string;
  supplierPhone?: string;
  warehouseName?: string | null;
}

export interface SupplierFifoSettlementPreview {
  unpaidReceiptsOrdered: ImportTransaction[];
  allocations: FifoDebtAllocationItem[];
  totalPreviousDebt: number;
  totalAllocated: number;
  unallocatedExcess: number;
  totalRemainingDebt: number;
}

export function matchesSupplierRecord(
  imp: ImportTransaction,
  identifier: SupplierMatchIdentifier
): boolean {
  if (identifier.warehouseName && imp.warehouseName !== identifier.warehouseName) {
    return false;
  }
  const cleanPhone = (identifier.supplierPhone || '').trim();
  if (cleanPhone && imp.supplierPhone && imp.supplierPhone.trim() === cleanPhone) {
    return true;
  }
  const cleanName = normalizeVietnameseSearch(identifier.supplierName || '');
  if (cleanName && normalizeVietnameseSearch(imp.supplierName) === cleanName) {
    return true;
  }
  return false;
}

/**
 * Previews automatic FIFO debt deduction across all unpaid import receipts of a supplier
 * sorted strictly by oldest debt date first (createdAt ascending, then dueDate ascending).
 */
export function previewSupplierFifoDebtSettlement(
  imports: ImportTransaction[],
  identifier: SupplierMatchIdentifier,
  lumpSumAmountInput: number
): SupplierFifoSettlementPreview {
  const safeInput = Math.max(0, Math.round(Number(lumpSumAmountInput) || 0));

  const unpaidReceiptsOrdered = imports
    .filter((imp) => imp.debtAmount > 0 && matchesSupplierRecord(imp, identifier))
    .sort((a, b) => {
      const dateCmp = (a.createdAt || '').localeCompare(b.createdAt || '');
      if (dateCmp !== 0) return dateCmp;
      const dueCmp = (a.dueDate || '').localeCompare(b.dueDate || '');
      if (dueCmp !== 0) return dueCmp;
      return (a.receiptCode || '').localeCompare(b.receiptCode || '');
    });

  const totalPreviousDebt = unpaidReceiptsOrdered.reduce((sum, imp) => sum + imp.debtAmount, 0);
  let remainingToAllocate = safeInput;
  let totalAllocated = 0;

  const allocations: FifoDebtAllocationItem[] = unpaidReceiptsOrdered.map((imp) => {
    const allocatedAmount = Math.min(imp.debtAmount, remainingToAllocate);
    remainingToAllocate = Math.max(0, remainingToAllocate - allocatedAmount);
    totalAllocated += allocatedAmount;
    const remainingDebt = Math.max(0, imp.debtAmount - allocatedAmount);

    return {
      recordId: imp.id,
      code: imp.receiptCode,
      date: (imp.createdAt || '').slice(0, 10),
      dueDate: imp.dueDate || '',
      productName: imp.productName,
      previousDebt: imp.debtAmount,
      allocatedAmount,
      remainingDebt,
    };
  });

  return {
    unpaidReceiptsOrdered,
    allocations,
    totalPreviousDebt,
    totalAllocated,
    unallocatedExcess: Math.max(0, safeInput - totalAllocated),
    totalRemainingDebt: Math.max(0, totalPreviousDebt - totalAllocated),
  };
}

/**
 * Applies automatic FIFO debt settlement across all older unpaid import receipts of a supplier
 * sorted by oldest debt date first (theo thứ tự ngày nợ).
 */
export function applySupplierFifoDebtSettlement(
  imports: ImportTransaction[],
  identifier: SupplierMatchIdentifier,
  lumpSumAmountInput: number,
  note: string,
  nowIso: string
): SupplierFifoSettlementPreview & {
  updatedImports: ImportTransaction[];
  settledAllocations: FifoDebtAllocationItem[];
} {
  const preview = previewSupplierFifoDebtSettlement(imports, identifier, lumpSumAmountInput);
  if (preview.totalAllocated <= 0) {
    throw new Error('Số tiền chi trả quyết toán phải lớn hơn 0 và Nhà cung cấp phải có phiếu nhập còn nợ.');
  }

  const allocationByRecordId = new Map<string, FifoDebtAllocationItem>();
  for (const alloc of preview.allocations) {
    if (alloc.allocatedAmount > 0) {
      allocationByRecordId.set(alloc.recordId, alloc);
    }
  }

  const cleanNote = (note || '').trim();
  const updatedImports = imports.map((imp) => {
    const alloc = allocationByRecordId.get(imp.id);
    if (!alloc || alloc.allocatedAmount <= 0) return imp;

    const settled = applyDebtPayment(imp, alloc.allocatedAmount, nowIso);
    const noteSuffix = cleanNote
      ? `[Quyết toán nợ NCC theo thứ tự ngày nợ: +${alloc.allocatedAmount.toLocaleString('vi-VN')}đ - ${cleanNote}]`
      : `[Quyết toán nợ NCC theo thứ tự ngày nợ: +${alloc.allocatedAmount.toLocaleString('vi-VN')}đ]`;

    return {
      ...settled,
      note: imp.note ? `${imp.note} | ${noteSuffix}` : noteSuffix,
    };
  });

  const settledAllocations = preview.allocations.filter((a) => a.allocatedAmount > 0);

  return {
    ...preview,
    updatedImports,
    settledAllocations,
  };
}

export interface VoucherGroupSummaryItem {
  groupName: string;
  count: number;
  totalAmount: number;
  debtSettlementAmount: number;
  directOrOperatingAmount: number;
}

export interface CashflowAndFinancialReportSummary {
  // Cashflow metrics (7. Thu - Chi Dòng Tiền)
  salesPaidInflow: number;
  otherReceiptInflow: number;
  debtSettlementReceiptTotal: number;
  totalCashInflow: number;
  importsPaidOutflow: number;
  operatingPaymentOutflow: number;
  debtSettlementPaymentTotal: number;
  totalCashOutflow: number;
  netCashflow: number;
  receiptGroupBreakdown: VoucherGroupSummaryItem[];
  paymentGroupBreakdown: VoucherGroupSummaryItem[];
  filteredReceiptVouchers: CashReceiptVoucher[];
  filteredPaymentVouchers: CashPaymentVoucher[];
  // Financial & Profit metrics (8. Báo Cáo Tài Chính & Lợi Nhuận)
  grossSalesRevenueBeforeDiscount: number;
  totalSalesDiscount: number;
  netSalesRevenue: number;
  totalProductCogs: number;
  totalGiftPromoCost: number;
  totalCogs: number;
  grossProfit: number;
  otherIncome: number;
  operatingExpenses: number;
  netProfit: number;
  grossMarginPct: number;
  netMarginPct: number;
  totalReceivableDebt: number;
  totalPayableDebt: number;
}

/**
 * Computes integrated Cashflow (7. Thu - Chi Dòng Tiền) and Financial Profit (8. Báo Cáo Tài Chính & Lợi Nhuận)
 * combining Sales, Imports, Receipt Vouchers (Phiếu thu tiền), and Payment Vouchers (Phiếu chi tiền)
 * without double-counting debt settlement vouchers that have already updated sale.paidAmount / import.paidAmount.
 */
export function computeCashflowAndFinancialReport(params: {
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  products: ProductItem[];
  receiptVouchers?: CashReceiptVoucher[];
  paymentVouchers?: CashPaymentVoucher[];
  fromDate?: string;
  toDate?: string;
  warehouseName?: string | null;
}): CashflowAndFinancialReportSummary {
  const {
    sales = [],
    imports = [],
    products = [],
    receiptVouchers = [],
    paymentVouchers = [],
    fromDate,
    toDate,
    warehouseName,
  } = params;

  const filteredSales = sales.filter((s) => {
    if (warehouseName && s.warehouseName !== warehouseName) return false;
    return isDateWithinRange(s.createdAt, fromDate, toDate);
  });

  const filteredImports = imports.filter((i) => {
    if (warehouseName && i.warehouseName !== warehouseName) return false;
    return isDateWithinRange(i.createdAt, fromDate, toDate);
  });

  const filteredReceiptVouchers = receiptVouchers.filter((rv) => {
    if (warehouseName && rv.warehouseName !== warehouseName) return false;
    return isDateWithinRange(rv.createdAt, fromDate, toDate);
  });

  const filteredPaymentVouchers = paymentVouchers.filter((pv) => {
    if (warehouseName && pv.warehouseName !== warehouseName) return false;
    return isDateWithinRange(pv.createdAt, fromDate, toDate);
  });

  // Cashflow calculations
  const salesPaidInflow = filteredSales.reduce((sum, s) => sum + s.paidAmount, 0);
  const debtSettlementReceiptTotal = filteredReceiptVouchers
    .filter((rv) => rv.isDebtSettlement)
    .reduce((sum, rv) => sum + rv.amount, 0);
  const otherReceiptInflow = filteredReceiptVouchers
    .filter((rv) => !rv.isDebtSettlement)
    .reduce((sum, rv) => sum + rv.amount, 0);
  const totalCashInflow = salesPaidInflow + otherReceiptInflow;

  const importsPaidOutflow = filteredImports.reduce((sum, i) => sum + i.paidAmount, 0);
  const debtSettlementPaymentTotal = filteredPaymentVouchers
    .filter((pv) => pv.isDebtSettlement)
    .reduce((sum, pv) => sum + pv.amount, 0);
  const operatingPaymentOutflow = filteredPaymentVouchers
    .filter((pv) => !pv.isDebtSettlement)
    .reduce((sum, pv) => sum + pv.amount, 0);
  const totalCashOutflow = importsPaidOutflow + operatingPaymentOutflow;

  const netCashflow = totalCashInflow - totalCashOutflow;

  // Group breakdown for Receipt Vouchers
  const receiptGroupMap = new Map<string, VoucherGroupSummaryItem>();
  for (const rv of filteredReceiptVouchers) {
    const group = (rv.groupName || 'Nhóm phiếu thu khác').trim();
    const existing = receiptGroupMap.get(group) || {
      groupName: group,
      count: 0,
      totalAmount: 0,
      debtSettlementAmount: 0,
      directOrOperatingAmount: 0,
    };
    existing.count += 1;
    existing.totalAmount += rv.amount;
    if (rv.isDebtSettlement) {
      existing.debtSettlementAmount += rv.amount;
    } else {
      existing.directOrOperatingAmount += rv.amount;
    }
    receiptGroupMap.set(group, existing);
  }
  const receiptGroupBreakdown = Array.from(receiptGroupMap.values()).sort(
    (a, b) => b.totalAmount - a.totalAmount
  );

  // Group breakdown for Payment Vouchers
  const paymentGroupMap = new Map<string, VoucherGroupSummaryItem>();
  for (const pv of filteredPaymentVouchers) {
    const group = (pv.groupName || 'Nhóm phiếu chi khác').trim();
    const existing = paymentGroupMap.get(group) || {
      groupName: group,
      count: 0,
      totalAmount: 0,
      debtSettlementAmount: 0,
      directOrOperatingAmount: 0,
    };
    existing.count += 1;
    existing.totalAmount += pv.amount;
    if (pv.isDebtSettlement) {
      existing.debtSettlementAmount += pv.amount;
    } else {
      existing.directOrOperatingAmount += pv.amount;
    }
    paymentGroupMap.set(group, existing);
  }
  const paymentGroupBreakdown = Array.from(paymentGroupMap.values()).sort(
    (a, b) => b.totalAmount - a.totalAmount
  );

  // Financial & Profit calculations
  const totalSalesDiscount = filteredSales.reduce((sum, s) => sum + (s.discountAmount || 0), 0);
  const netSalesRevenue = filteredSales.reduce((sum, s) => sum + s.totalAmount, 0);
  const grossSalesRevenueBeforeDiscount = netSalesRevenue + totalSalesDiscount;

  let totalProductCogs = 0;
  let totalGiftPromoCost = 0;

  for (const sale of filteredSales) {
    const unitImportCost = resolveSaleUnitCost(sale, products);
    totalProductCogs += Math.round(unitImportCost * sale.quantity);

    const giftUnitCost = resolveSaleGiftUnitCost(sale, products);
    totalGiftPromoCost += Math.round(giftUnitCost * (sale.giftQuantity || 0));
  }

  const totalCogs = totalProductCogs + totalGiftPromoCost;
  const grossProfit = netSalesRevenue - totalCogs;

  const otherIncome = filteredReceiptVouchers
    .filter((rv) => !rv.isDebtSettlement && rv.countsTowardOtherIncome !== false)
    .reduce((sum, rv) => sum + rv.amount, 0);

  const operatingExpenses = filteredPaymentVouchers
    .filter((pv) => !pv.isDebtSettlement && pv.countsTowardOperatingExpense !== false)
    .reduce((sum, pv) => sum + pv.amount, 0);

  const netProfit = grossProfit + otherIncome - operatingExpenses;

  const grossMarginPct =
    netSalesRevenue > 0 ? Math.round((grossProfit / netSalesRevenue) * 1000) / 10 : 0;
  const netMarginPct =
    netSalesRevenue + otherIncome > 0
      ? Math.round((netProfit / (netSalesRevenue + otherIncome)) * 1000) / 10
      : 0;

  const totalReceivableDebt = filteredSales.reduce((sum, s) => sum + s.debtAmount, 0);
  const totalPayableDebt = filteredImports.reduce((sum, i) => sum + i.debtAmount, 0);

  return {
    salesPaidInflow,
    otherReceiptInflow,
    debtSettlementReceiptTotal,
    totalCashInflow,
    importsPaidOutflow,
    operatingPaymentOutflow,
    debtSettlementPaymentTotal,
    totalCashOutflow,
    netCashflow,
    receiptGroupBreakdown,
    paymentGroupBreakdown,
    filteredReceiptVouchers,
    filteredPaymentVouchers,
    grossSalesRevenueBeforeDiscount,
    totalSalesDiscount,
    netSalesRevenue,
    totalProductCogs,
    totalGiftPromoCost,
    totalCogs,
    grossProfit,
    otherIncome,
    operatingExpenses,
    netProfit,
    grossMarginPct,
    netMarginPct,
    totalReceivableDebt,
    totalPayableDebt,
  };
}

export function extractRecordYear(
  dateOrIso: string | null | undefined,
  fallbackYear = 2026
): number {
  if (!dateOrIso) return fallbackYear;
  const vnDate = toVietnamDateStr(dateOrIso);
  const match = (vnDate || dateOrIso.trim()).match(/^(\d{4})/);
  if (match) {
    const parsed = Number(match[1]);
    if (parsed >= 2000 && parsed <= 2100) return parsed;
  }
  return fallbackYear;
}

export interface FiscalYearClosePreview {
  fiscalYear: number;
  newFiscalYear: number;
  // Records to be purged (settled / closed in <= fiscalYear)
  settledSalesToDelete: SaleTransaction[];
  settledImportsToDelete: ImportTransaction[];
  receiptVouchersToDelete: CashReceiptVoucher[];
  paymentVouchersToDelete: CashPaymentVoucher[];
  savedVouchersToDelete: SavedVoucherRecord[];
  totalRecordsToDelete: number;
  settledSalesRevenueTotal: number;
  settledImportsCostTotal: number;
  deletedReceiptVouchersAmountTotal: number;
  deletedPaymentVouchersAmountTotal: number;
  // Carry-over balances into newFiscalYear (Tồn lưu chuyển sang năm tài chính mới)
  carriedInventoryCount: number;
  carriedInventoryTotalUnits: number;
  carriedInventoryTotalValue: number;
  carriedUnpaidSales: SaleTransaction[];
  carriedCustomerDebtCount: number;
  carriedCustomerDebtTotal: number;
  carriedUnpaidImports: ImportTransaction[];
  carriedSupplierDebtCount: number;
  carriedSupplierDebtTotal: number;
}

export interface FiscalYearCloseExecutionResult {
  preview: FiscalYearClosePreview;
  remainingProducts: ProductItem[];
  updatedCustomers: CustomerProfile[];
  updatedSuppliers: SupplierProfile[];
  remainingSales: SaleTransaction[];
  remainingImports: ImportTransaction[];
  remainingReceiptVouchers: CashReceiptVoucher[];
  remainingPaymentVouchers: CashPaymentVoucher[];
  remainingSavedVouchers: SavedVoucherRecord[];
}

/**
 * Previews what will be deleted vs. carried forward when closing a fiscal year (Chốt sổ năm báo cáo tài chính).
 * - Purges settled sales (debtAmount === 0), settled imports (debtAmount === 0), receipt vouchers, payment vouchers,
 *   and saved print vouchers in `<= fiscalYear` to make the application clean and fast.
 * - Carries forward all current inventory stock, unpaid customer invoices (debtAmount > 0), and unpaid supplier imports (debtAmount > 0)
 *   into `fiscalYear + 1` as opening balances of the new fiscal year.
 */
export function previewFiscalYearCloseAndCleanup(params: {
  fiscalYear: number;
  products: ProductItem[];
  customers: CustomerProfile[];
  suppliers?: SupplierProfile[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  receiptVouchers?: CashReceiptVoucher[];
  paymentVouchers?: CashPaymentVoucher[];
  savedVouchers?: SavedVoucherRecord[];
}): FiscalYearClosePreview {
  const fiscalYear = Math.round(Number(params.fiscalYear) || 2026);
  const newFiscalYear = fiscalYear + 1;
  const products = params.products || [];
  const sales = params.sales || [];
  const imports = params.imports || [];
  const receiptVouchers = params.receiptVouchers || [];
  const paymentVouchers = params.paymentVouchers || [];
  const savedVouchers = params.savedVouchers || [];

  const settledSalesToDelete = sales.filter(
    (s) => extractRecordYear(s.createdAt, fiscalYear) <= fiscalYear && s.debtAmount <= 0
  );
  const settledImportsToDelete = imports.filter(
    (i) => extractRecordYear(i.createdAt, fiscalYear) <= fiscalYear && i.debtAmount <= 0
  );
  const receiptVouchersToDelete = receiptVouchers.filter(
    (rv) => extractRecordYear(rv.createdAt, fiscalYear) <= fiscalYear
  );
  const paymentVouchersToDelete = paymentVouchers.filter(
    (pv) => extractRecordYear(pv.createdAt, fiscalYear) <= fiscalYear
  );
  const savedVouchersToDelete = savedVouchers.filter(
    (sv) => extractRecordYear(sv.createdAt, fiscalYear) <= fiscalYear
  );

  const totalRecordsToDelete =
    settledSalesToDelete.length +
    settledImportsToDelete.length +
    receiptVouchersToDelete.length +
    paymentVouchersToDelete.length +
    savedVouchersToDelete.length;

  const settledSalesRevenueTotal = settledSalesToDelete.reduce((sum, s) => sum + s.totalAmount, 0);
  const settledImportsCostTotal = settledImportsToDelete.reduce((sum, i) => sum + i.totalCost, 0);
  const deletedReceiptVouchersAmountTotal = receiptVouchersToDelete.reduce(
    (sum, rv) => sum + rv.amount,
    0
  );
  const deletedPaymentVouchersAmountTotal = paymentVouchersToDelete.reduce(
    (sum, pv) => sum + pv.amount,
    0
  );

  const carriedInventoryCount = products.length;
  const carriedInventoryTotalUnits = products.reduce((sum, p) => sum + Math.max(0, p.stock), 0);
  const carriedInventoryTotalValue = products.reduce(
    (sum, p) => sum + Math.max(0, p.stock) * Math.max(0, p.importPrice),
    0
  );

  const carriedUnpaidSales = sales.filter((s) => s.debtAmount > 0);
  const carriedCustomerDebtCount = carriedUnpaidSales.length;
  const carriedCustomerDebtTotal = carriedUnpaidSales.reduce((sum, s) => sum + s.debtAmount, 0);

  const carriedUnpaidImports = imports.filter((i) => i.debtAmount > 0);
  const carriedSupplierDebtCount = carriedUnpaidImports.length;
  const carriedSupplierDebtTotal = carriedUnpaidImports.reduce((sum, i) => sum + i.debtAmount, 0);

  return {
    fiscalYear,
    newFiscalYear,
    settledSalesToDelete,
    settledImportsToDelete,
    receiptVouchersToDelete,
    paymentVouchersToDelete,
    savedVouchersToDelete,
    totalRecordsToDelete,
    settledSalesRevenueTotal,
    settledImportsCostTotal,
    deletedReceiptVouchersAmountTotal,
    deletedPaymentVouchersAmountTotal,
    carriedInventoryCount,
    carriedInventoryTotalUnits,
    carriedInventoryTotalValue,
    carriedUnpaidSales,
    carriedCustomerDebtCount,
    carriedCustomerDebtTotal,
    carriedUnpaidImports,
    carriedSupplierDebtCount,
    carriedSupplierDebtTotal,
  };
}

/**
 * Executes the Fiscal Year Rollover & Settled Data Cleanup.
 * Deletes settled transactions/vouchers of `<= fiscalYear` and carries over remaining inventory stock,
 * unpaid customer debts, and unpaid supplier debts into `newFiscalYear = fiscalYear + 1`.
 */
export function executeFiscalYearCloseAndCleanup(params: {
  fiscalYear: number;
  products: ProductItem[];
  customers: CustomerProfile[];
  suppliers?: SupplierProfile[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  receiptVouchers?: CashReceiptVoucher[];
  paymentVouchers?: CashPaymentVoucher[];
  savedVouchers?: SavedVoucherRecord[];
  nowIso?: string;
}): FiscalYearCloseExecutionResult {
  const nowIso = params.nowIso || new Date().toISOString();
  const preview = previewFiscalYearCloseAndCleanup(params);
  const { fiscalYear, newFiscalYear } = preview;

  const remainingProducts = (params.products || []).map((p) => ({
    ...p,
    updatedAt: nowIso,
  }));

  const carrySaleTag = `[Tồn lưu chốt sổ năm ${fiscalYear} -> Chuyển sang đầu kỳ năm ${newFiscalYear}]`;
  const remainingSales = (params.sales || [])
    .filter((s) => extractRecordYear(s.createdAt, fiscalYear) > fiscalYear || s.debtAmount > 0)
    .map((s) => {
      if (extractRecordYear(s.createdAt, fiscalYear) <= fiscalYear && s.debtAmount > 0) {
        const hasTag = (s.note || '').includes(`Chốt sổ năm ${fiscalYear}`) || (s.note || '').includes(carrySaleTag);
        return {
          ...s,
          note: hasTag ? s.note : s.note ? `${s.note} | ${carrySaleTag}` : carrySaleTag,
          updatedAt: nowIso,
        };
      }
      return s;
    });

  const carryImportTag = `[Tồn lưu nợ NCC chốt sổ năm ${fiscalYear} -> Chuyển sang đầu kỳ năm ${newFiscalYear}]`;
  const remainingImports = (params.imports || [])
    .filter((i) => extractRecordYear(i.createdAt, fiscalYear) > fiscalYear || i.debtAmount > 0)
    .map((i) => {
      if (extractRecordYear(i.createdAt, fiscalYear) <= fiscalYear && i.debtAmount > 0) {
        const hasTag = (i.note || '').includes(`Chốt sổ năm ${fiscalYear}`) || (i.note || '').includes(carryImportTag);
        return {
          ...i,
          note: hasTag ? i.note : i.note ? `${i.note} | ${carryImportTag}` : carryImportTag,
          updatedAt: nowIso,
        };
      }
      return i;
    });

  const remainingReceiptVouchers = (params.receiptVouchers || []).filter(
    (rv) => extractRecordYear(rv.createdAt, fiscalYear) > fiscalYear
  );
  const remainingPaymentVouchers = (params.paymentVouchers || []).filter(
    (pv) => extractRecordYear(pv.createdAt, fiscalYear) > fiscalYear
  );
  const remainingSavedVouchers = (params.savedVouchers || []).filter(
    (sv) => extractRecordYear(sv.createdAt, fiscalYear) > fiscalYear
  );

  const updatedCustomers = (params.customers || []).map((c) => {
    const custSales = remainingSales.filter(
      (s) =>
        s.customerId === c.id ||
        (c.phone && s.customerPhone === c.phone) ||
        s.customerName.trim().toLowerCase() === c.name.trim().toLowerCase()
    );
    const carriedDebt = custSales.reduce((sum, s) => sum + s.debtAmount, 0);
    const carriedPurchased = custSales.reduce((sum, s) => sum + s.totalAmount, 0);
    return {
      ...c,
      totalDebt: carriedDebt,
      totalPurchased: carriedPurchased,
      updatedAt: nowIso,
    };
  });

  const updatedSuppliers = [...(params.suppliers || [])];

  return {
    preview,
    remainingProducts,
    updatedCustomers,
    updatedSuppliers,
    remainingSales,
    remainingImports,
    remainingReceiptVouchers,
    remainingPaymentVouchers,
    remainingSavedVouchers,
  };
}

/**
 * Executes a full data wipe of all business records for the Primary Manager,
 * while preserving the Primary Manager staff account so the system remains accessible.
 */
export function executeFullApplicationDataWipe(params: {
  staffList: StaffMember[];
}): {
  products: ProductItem[];
  customers: CustomerProfile[];
  suppliers: SupplierProfile[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  receiptVouchers: CashReceiptVoucher[];
  paymentVouchers: CashPaymentVoucher[];
  savedVouchers: SavedVoucherRecord[];
  preservedStaffList: StaffMember[];
} {
  const preservedStaffList = (params.staffList || []).filter((s) => canAccountCreateStaff(s));
  return {
    products: [],
    customers: [],
    suppliers: [],
    sales: [],
    imports: [],
    receiptVouchers: [],
    paymentVouchers: [],
    savedVouchers: [],
    preservedStaffList:
      preservedStaffList.length > 0 ? preservedStaffList : params.staffList.slice(0, 1),
  };
}

/**
 * Generates a continuous, future-proof list of fiscal years so the manager can always select
 * 2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032... up to 2040+ and automatically expand
 * further into the future as time progresses or later years are selected.
 */
export function generateFiscalYearOptions(params?: {
  startYear?: number;
  minEndYear?: number;
  currentYear?: number;
  dataYears?: number[];
  selectedYear?: number;
}): number[] {
  const startYear = Math.max(2020, Math.round(Number(params?.startYear) || 2024));
  const minEndYear = Math.max(2040, Math.round(Number(params?.minEndYear) || 2040));
  const nowYear = Math.round(Number(params?.currentYear) || new Date().getFullYear());
  const selectedYear = Math.round(Number(params?.selectedYear) || nowYear);
  const validDataYears = (params?.dataYears || []).filter(
    (y) => Number.isFinite(y) && y >= 2000 && y <= 2100
  );
  const maxDataYear = validDataYears.length > 0 ? Math.max(...validDataYears) : nowYear;
  const minDataYear = validDataYears.length > 0 ? Math.min(...validDataYears) : startYear;

  const effectiveStart = Math.min(startYear, minDataYear, selectedYear);
  const effectiveEnd = Math.max(
    minEndYear,
    nowYear + 15,
    maxDataYear + 10,
    selectedYear + 5
  );

  const years: number[] = [];
  for (let yr = effectiveStart; yr <= effectiveEnd; yr += 1) {
    years.push(yr);
  }
  return years;
}

export type TaxFinancialDrillDownCode =
  | '01_gross_revenue'
  | '02_revenue_deduction'
  | '10_net_revenue'
  | '11_cogs_total'
  | '20_gross_profit'
  | '24_operating_expenses'
  | '30_operating_profit'
  | '31_other_income'
  | '50_profit_before_tax'
  | '51_estimated_tax'
  | '60_profit_after_tax'
  | '110_cash_and_equivalents'
  | '131_customer_receivables'
  | '156_inventory_assets'
  | '331_supplier_payables'
  | '400_net_working_capital';

export interface TaxFinancialStatementLineItem {
  code: string;
  drillDownCode: TaxFinancialDrillDownCode;
  section: 'B02_INCOME_STATEMENT' | 'B01_B03_BALANCE_CASHFLOW';
  title: string;
  noteCode: string;
  formulaText: string;
  recordCount: number;
  recordCountLabel: string;
  amount: number;
  ratioToNetRevenuePct: number;
  isHighlightRow?: boolean;
  description: string;
}

export interface SaleCogsAuditRow {
  sale: SaleTransaction;
  grossAmountBeforeDiscount: number;
  discountAmount: number;
  netRevenueAmount: number;
  unitImportCost: number;
  productCogsAmount: number;
  giftUnitCost: number;
  giftCogsAmount: number;
  totalCogsAmount: number;
  grossProfitAmount: number;
  grossMarginPct: number;
}

export interface InventoryValuationAuditRow {
  product: ProductItem;
  stockQuantity: number;
  unitImportCost: number;
  unitRetailPrice: number;
  totalInventoryCostValue: number;
  totalEstimatedRetailValue: number;
}

export interface TaxAuthorityFinancialStatementResult {
  fiscalYear: number;
  fromDate: string;
  toDate: string;
  taxRatePct: number;
  incomeStatementLines: TaxFinancialStatementLineItem[];
  balanceAndCashflowLines: TaxFinancialStatementLineItem[];
  allLines: TaxFinancialStatementLineItem[];
  // Underlying audit datasets for 100% verifiable drill-down inspection
  filteredSales: SaleTransaction[];
  discountedSales: SaleTransaction[];
  unpaidSalesInPeriod: SaleTransaction[];
  filteredImports: ImportTransaction[];
  unpaidImportsInPeriod: ImportTransaction[];
  operatingPaymentVouchers: CashPaymentVoucher[];
  otherIncomeReceiptVouchers: CashReceiptVoucher[];
  allFilteredReceiptVouchers: CashReceiptVoucher[];
  allFilteredPaymentVouchers: CashPaymentVoucher[];
  saleCogsBreakdown: SaleCogsAuditRow[];
  inventoryValuationRows: InventoryValuationAuditRow[];
  // Key summary metrics
  grossRevenue01: number;
  revenueDeduction02: number;
  netRevenue10: number;
  productCogs11a: number;
  giftCogs11b: number;
  totalCogs11: number;
  grossProfit20: number;
  operatingExpenses24: number;
  operatingProfit30: number;
  otherIncome31: number;
  profitBeforeTax50: number;
  estimatedTax51: number;
  profitAfterTax60: number;
  totalCashInflow: number;
  totalCashOutflow: number;
  netCashflow110: number;
  customerReceivables131: number;
  inventoryValue156: number;
  supplierPayables331: number;
  netWorkingCapital400: number;
}

/**
 * Computes a complete Tax-Authority-Grade Financial Statement (Báo cáo Tài chính Năm theo biểu mẫu
 * Kê khai Cơ quan Thuế: Mẫu B02-DN Kết quả HĐKD, Mẫu B01-DN Cân đối Tài sản - Tồn kho - Công nợ,
 * Mẫu B03-DN Lưu chuyển dòng tiền) with full drill-down audit datasets for every line item.
 */
export function computeTaxAuthorityFinancialStatement(params: {
  fiscalYear?: number;
  fromDate?: string;
  toDate?: string;
  warehouseName?: string | null;
  taxRatePct?: number;
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  products: ProductItem[];
  receiptVouchers?: CashReceiptVoucher[];
  paymentVouchers?: CashPaymentVoucher[];
}): TaxAuthorityFinancialStatementResult {
  const fromDate = params.fromDate || '';
  const toDate = params.toDate || '';
  const inferredYear = fromDate
    ? extractRecordYear(fromDate, 2026)
    : toDate
    ? extractRecordYear(toDate, 2026)
    : 2026;
  const fiscalYear = Math.round(Number(params.fiscalYear) || inferredYear);
  const taxRatePct =
    params.taxRatePct !== undefined ? Math.max(0, Number(params.taxRatePct) || 0) : 1.5;

  const baseReport = computeCashflowAndFinancialReport({
    sales: params.sales || [],
    imports: params.imports || [],
    products: params.products || [],
    receiptVouchers: params.receiptVouchers || [],
    paymentVouchers: params.paymentVouchers || [],
    fromDate,
    toDate,
    warehouseName: params.warehouseName,
  });

  const filteredSales = (params.sales || [])
    .filter((s) => {
      if (params.warehouseName && s.warehouseName !== params.warehouseName) return false;
      return isDateWithinRange(s.createdAt, fromDate, toDate);
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const discountedSales = filteredSales.filter((s) => (s.discountAmount || 0) > 0);
  const unpaidSalesInPeriod = filteredSales.filter((s) => s.debtAmount > 0);

  const filteredImports = (params.imports || [])
    .filter((i) => {
      if (params.warehouseName && i.warehouseName !== params.warehouseName) return false;
      return isDateWithinRange(i.createdAt, fromDate, toDate);
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const unpaidImportsInPeriod = filteredImports.filter((i) => i.debtAmount > 0);

  const operatingPaymentVouchers = baseReport.filteredPaymentVouchers.filter(
    (pv) => !pv.isDebtSettlement && pv.countsTowardOperatingExpense !== false
  );

  const otherIncomeReceiptVouchers = baseReport.filteredReceiptVouchers.filter(
    (rv) => !rv.isDebtSettlement && rv.countsTowardOtherIncome !== false
  );

  const saleCogsBreakdown: SaleCogsAuditRow[] = filteredSales.map((sale) => {
    const discountAmount = Math.max(0, Math.round(sale.discountAmount || 0));
    const netRevenueAmount = Math.max(0, Math.round(sale.totalAmount || 0));
    const grossAmountBeforeDiscount = netRevenueAmount + discountAmount;

    const unitImportCost = resolveSaleUnitCost(sale, params.products || []);
    const productCogsAmount = Math.round(unitImportCost * sale.quantity);

    const giftUnitCost = resolveSaleGiftUnitCost(sale, params.products || []);
    const giftCogsAmount = Math.round(giftUnitCost * (sale.giftQuantity || 0));

    const totalCogsAmount = productCogsAmount + giftCogsAmount;
    const grossProfitAmount = netRevenueAmount - totalCogsAmount;
    const grossMarginPct =
      netRevenueAmount > 0 ? Math.round((grossProfitAmount / netRevenueAmount) * 1000) / 10 : 0;

    return {
      sale,
      grossAmountBeforeDiscount,
      discountAmount,
      netRevenueAmount,
      unitImportCost,
      productCogsAmount,
      giftUnitCost,
      giftCogsAmount,
      totalCogsAmount,
      grossProfitAmount,
      grossMarginPct,
    };
  });

  const filteredProducts = (params.products || []).filter((p) => {
    if (params.warehouseName && p.warehouseName && p.warehouseName !== params.warehouseName) {
      return false;
    }
    return true;
  });

  const inventoryValuationRows: InventoryValuationAuditRow[] = filteredProducts.map((product) => {
    const stockQuantity = Math.max(0, Math.round(product.stock || 0));
    const unitImportCost = Math.max(0, Math.round(product.importPrice || 0));
    const unitRetailPrice = Math.max(0, Math.round(product.sellPrice || 0));
    return {
      product,
      stockQuantity,
      unitImportCost,
      unitRetailPrice,
      totalInventoryCostValue: stockQuantity * unitImportCost,
      totalEstimatedRetailValue: stockQuantity * unitRetailPrice,
    };
  });

  const grossRevenue01 = baseReport.grossSalesRevenueBeforeDiscount;
  const revenueDeduction02 = baseReport.totalSalesDiscount;
  const netRevenue10 = baseReport.netSalesRevenue;
  const productCogs11a = baseReport.totalProductCogs;
  const giftCogs11b = baseReport.totalGiftPromoCost;
  const totalCogs11 = baseReport.totalCogs;
  const grossProfit20 = baseReport.grossProfit;
  const operatingExpenses24 = baseReport.operatingExpenses;
  const operatingProfit30 = grossProfit20 - operatingExpenses24;
  const otherIncome31 = baseReport.otherIncome;
  const profitBeforeTax50 = operatingProfit30 + otherIncome31;
  const estimatedTax51 = Math.max(0, Math.round((netRevenue10 * taxRatePct) / 100));
  const profitAfterTax60 = profitBeforeTax50 - estimatedTax51;

  const netCashflow110 = baseReport.netCashflow;
  const cumSalesAsOfToDate = (params.sales || []).filter((s) => {
    if (params.warehouseName && s.warehouseName !== params.warehouseName) return false;
    return toDate ? isDateWithinRange(s.createdAt, undefined, toDate) : true;
  });
  const cumImportsAsOfToDate = (params.imports || []).filter((i) => {
    if (params.warehouseName && i.warehouseName !== params.warehouseName) return false;
    return toDate ? isDateWithinRange(i.createdAt, undefined, toDate) : true;
  });
  const customerReceivables131 = cumSalesAsOfToDate.reduce(
    (sum, s) => sum + Math.max(0, Number(s.debtAmount) || 0),
    0
  );
  const inventoryValue156 = inventoryValuationRows.reduce(
    (sum, r) => sum + r.totalInventoryCostValue,
    0
  );
  const supplierPayables331 = cumImportsAsOfToDate.reduce(
    (sum, i) => sum + Math.max(0, Number(i.debtAmount) || 0),
    0
  );
  const netWorkingCapital400 =
    netCashflow110 + customerReceivables131 + inventoryValue156 - supplierPayables331;

  const pctOfNetRev = (amt: number): number =>
    netRevenue10 > 0 ? Math.round((amt / netRevenue10) * 1000) / 10 : 0;

  const incomeStatementLines: TaxFinancialStatementLineItem[] = [
    {
      code: '01',
      drillDownCode: '01_gross_revenue',
      section: 'B02_INCOME_STATEMENT',
      title: '1. Doanh thu bán hàng và cung cấp dịch vụ',
      noteCode: 'TM.01',
      formulaText: '∑ Tổng tiền hàng trước chiết khấu/giảm giá',
      recordCount: filteredSales.length,
      recordCountLabel: `${filteredSales.length} hóa đơn bán`,
      amount: grossRevenue01,
      ratioToNetRevenuePct: pctOfNetRev(grossRevenue01),
      description:
        'Tổng doanh thu xuất bán vật tư nông nghiệp theo đơn giá bán niêm yết trước khi trừ chiết khấu/giảm giá khuyến mãi.',
    },
    {
      code: '02',
      drillDownCode: '02_revenue_deduction',
      section: 'B02_INCOME_STATEMENT',
      title: '2. Các khoản giảm trừ doanh thu (Chiết khấu / Giảm giá KM)',
      noteCode: 'TM.02',
      formulaText: '∑ Tiền giảm giá trực tiếp trên hóa đơn',
      recordCount: discountedSales.length,
      recordCountLabel: `${discountedSales.length} đơn có giảm giá`,
      amount: revenueDeduction02,
      ratioToNetRevenuePct: pctOfNetRev(revenueDeduction02),
      description:
        'Tổng số tiền chiết khấu thương mại và giảm giá bán trực tiếp trên các hóa đơn bán hàng trong kỳ.',
    },
    {
      code: '10',
      drillDownCode: '10_net_revenue',
      section: 'B02_INCOME_STATEMENT',
      title: '3. Doanh thu thuần về bán hàng và cung cấp dịch vụ (10 = 01 - 02)',
      noteCode: 'TM.03',
      formulaText: 'Mã 10 = Mã 01 - Mã 02',
      recordCount: filteredSales.length,
      recordCountLabel: `${filteredSales.length} hóa đơn thuần`,
      amount: netRevenue10,
      ratioToNetRevenuePct: netRevenue10 > 0 ? 100 : 0,
      isHighlightRow: true,
      description:
        'Doanh thu thực tế sau khi trừ các khoản giảm trừ doanh thu, làm căn cứ tính doanh thu kê khai thuế và lợi nhuận gộp.',
    },
    {
      code: '11',
      drillDownCode: '11_cogs_total',
      section: 'B02_INCOME_STATEMENT',
      title: '4. Giá vốn hàng bán & Giá vốn quà tặng khuyến mãi (11 = Giá vốn hàng + Quà KM)',
      noteCode: 'TM.04',
      formulaText: `Hàng bán (${formatVND(productCogs11a)}) + Quà KM (${formatVND(giftCogs11b)})`,
      recordCount: saleCogsBreakdown.length,
      recordCountLabel: `${saleCogsBreakdown.length} dòng giá vốn`,
      amount: totalCogs11,
      ratioToNetRevenuePct: pctOfNetRev(totalCogs11),
      description:
        'Tổng giá vốn nhập kho của các mặt hàng vật tư đã xuất bán cộng với giá vốn của hàng hóa xuất làm quà tặng khuyến mãi kèm đơn.',
    },
    {
      code: '20',
      drillDownCode: '20_gross_profit',
      section: 'B02_INCOME_STATEMENT',
      title: '5. Lợi nhuận gộp về bán hàng và cung cấp dịch vụ (20 = 10 - 11)',
      noteCode: 'TM.05',
      formulaText: 'Mã 20 = Mã 10 - Mã 11',
      recordCount: saleCogsBreakdown.length,
      recordCountLabel: `${saleCogsBreakdown.length} đơn đối chiếu lãi gộp`,
      amount: grossProfit20,
      ratioToNetRevenuePct: pctOfNetRev(grossProfit20),
      isHighlightRow: true,
      description:
        'Chênh lệch giữa Doanh thu thuần (Mã 10) và Giá vốn hàng bán + quà khuyến mãi (Mã 11) của từng hóa đơn.',
    },
    {
      code: '24',
      drillDownCode: '24_operating_expenses',
      section: 'B02_INCOME_STATEMENT',
      title: '6. Chi phí bán hàng, vận hành & quản lý doanh nghiệp',
      noteCode: 'TM.06',
      formulaText: '∑ Phiếu chi vận hành (không tính chi trả nợ gốc NCC)',
      recordCount: operatingPaymentVouchers.length,
      recordCountLabel: `${operatingPaymentVouchers.length} phiếu chi vận hành`,
      amount: operatingExpenses24,
      ratioToNetRevenuePct: pctOfNetRev(operatingExpenses24),
      description:
        'Tổng hợp các phiếu chi phục vụ vận hành: chi phí vận chuyển, bốc xếp, tiền lương nhân sự, điện nước, kho bãi...',
    },
    {
      code: '30',
      drillDownCode: '30_operating_profit',
      section: 'B02_INCOME_STATEMENT',
      title: '7. Lợi nhuận thuần từ hoạt động kinh doanh (30 = 20 - 24)',
      noteCode: 'TM.07',
      formulaText: 'Mã 30 = Mã 20 - Mã 24',
      recordCount: filteredSales.length + operatingPaymentVouchers.length,
      recordCountLabel: `${filteredSales.length} đơn + ${operatingPaymentVouchers.length} phiếu chi`,
      amount: operatingProfit30,
      ratioToNetRevenuePct: pctOfNetRev(operatingProfit30),
      isHighlightRow: true,
      description:
        'Lợi nhuận từ hoạt động kinh doanh chính sau khi lấy Lợi nhuận gộp trừ đi toàn bộ Chi phí vận hành & quản lý.',
    },
    {
      code: '31',
      drillDownCode: '31_other_income',
      section: 'B02_INCOME_STATEMENT',
      title: '8. Thu nhập khác (Thưởng chiết khấu NCC, hỗ trợ đại lý & thu khác)',
      noteCode: 'TM.08',
      formulaText: '∑ Phiếu thu khác (không tính thu nợ hóa đơn KH)',
      recordCount: otherIncomeReceiptVouchers.length,
      recordCountLabel: `${otherIncomeReceiptVouchers.length} phiếu thu khác`,
      amount: otherIncome31,
      ratioToNetRevenuePct: pctOfNetRev(otherIncome31),
      description:
        'Các khoản thu nhập ngoài hóa đơn bán hàng như tiền thưởng doanh số/chiết khấu từ Nhà cung cấp, hỗ trợ vận chuyển...',
    },
    {
      code: '50',
      drillDownCode: '50_profit_before_tax',
      section: 'B02_INCOME_STATEMENT',
      title: '9. Tổng lợi nhuận kế toán trước thuế (50 = 30 + 31)',
      noteCode: 'TM.09',
      formulaText: 'Mã 50 = Mã 30 + Mã 31',
      recordCount:
        filteredSales.length + operatingPaymentVouchers.length + otherIncomeReceiptVouchers.length,
      recordCountLabel: 'Toàn bộ chứng từ KQKD',
      amount: profitBeforeTax50,
      ratioToNetRevenuePct: pctOfNetRev(profitBeforeTax50),
      isHighlightRow: true,
      description:
        'Tổng lợi nhuận kế toán thực tế trước thuế của đơn vị trong kỳ báo cáo tài chính.',
    },
    {
      code: '51',
      drillDownCode: '51_estimated_tax',
      section: 'B02_INCOME_STATEMENT',
      title: `10. Nghĩa vụ thuế tham chiếu kê khai (${taxRatePct}% trên Doanh thu thuần Mã 10)`,
      noteCode: 'TM.10',
      formulaText: `Mã 10 × ${taxRatePct}% (Tỷ lệ thuế phân phối hàng hóa tham chiếu)`,
      recordCount: filteredSales.length,
      recordCountLabel: `Tính trên ${filteredSales.length} hóa đơn`,
      amount: estimatedTax51,
      ratioToNetRevenuePct: taxRatePct,
      description:
        'Mức thuế tham chiếu để chủ cơ sở/doanh nghiệp đối chiếu nghĩa vụ thuế GTGT & TNCN/TNDN với Cơ quan Thuế.',
    },
    {
      code: '60',
      drillDownCode: '60_profit_after_tax',
      section: 'B02_INCOME_STATEMENT',
      title: '11. Lợi nhuận thuần sau thuế (60 = 50 - 51)',
      noteCode: 'TM.11',
      formulaText: 'Mã 60 = Mã 50 - Mã 51',
      recordCount:
        filteredSales.length + operatingPaymentVouchers.length + otherIncomeReceiptVouchers.length,
      recordCountLabel: 'Tổng hợp sau thuế',
      amount: profitAfterTax60,
      ratioToNetRevenuePct: pctOfNetRev(profitAfterTax60),
      isHighlightRow: true,
      description:
        'Lợi nhuận ròng còn lại sau khi trừ toàn bộ giá vốn, chi phí vận hành và nghĩa vụ thuế ước tính.',
    },
  ];

  const balanceAndCashflowLines: TaxFinancialStatementLineItem[] = [
    {
      code: '110',
      drillDownCode: '110_cash_and_equivalents',
      section: 'B01_B03_BALANCE_CASHFLOW',
      title: 'I. Tiền & Lưu chuyển dòng tiền thuần trong kỳ (Thực thu - Thực chi)',
      noteCode: 'B03-DN',
      formulaText: `Thực thu (${formatVND(baseReport.totalCashInflow)}) - Thực chi (${formatVND(
        baseReport.totalCashOutflow
      )})`,
      recordCount:
        filteredSales.length +
        filteredImports.length +
        baseReport.filteredReceiptVouchers.length +
        baseReport.filteredPaymentVouchers.length,
      recordCountLabel: `${
        filteredSales.length + baseReport.filteredReceiptVouchers.length
      } khoản thu / ${
        filteredImports.length + baseReport.filteredPaymentVouchers.length
      } khoản chi`,
      amount: netCashflow110,
      ratioToNetRevenuePct: pctOfNetRev(netCashflow110),
      isHighlightRow: true,
      description:
        'Chênh lệch giữa Tổng tiền thực thu (Khách trả ngay + Thu nợ + Phiếu thu khác) và Tổng tiền thực chi (Trả NCC + Phiếu chi vận hành).',
    },
    {
      code: '131',
      drillDownCode: '131_customer_receivables',
      section: 'B01_B03_BALANCE_CASHFLOW',
      title: 'II. Các khoản phải thu ngắn hạn của Khách hàng (Công nợ KH còn nợ)',
      noteCode: 'TK.131',
      formulaText: '∑ Số tiền khách hàng còn nợ trên các hóa đơn trong kỳ',
      recordCount: unpaidSalesInPeriod.length,
      recordCountLabel: `${unpaidSalesInPeriod.length} hóa đơn KH còn nợ`,
      amount: customerReceivables131,
      ratioToNetRevenuePct: pctOfNetRev(customerReceivables131),
      description:
        'Tổng số dư công nợ phải thu từ khách hàng đối với các hóa đơn xuất bán chưa thanh toán hết.',
    },
    {
      code: '156',
      drillDownCode: '156_inventory_assets',
      section: 'B01_B03_BALANCE_CASHFLOW',
      title: 'III. Hàng tồn kho vật tư nông nghiệp cuối kỳ (Theo giá vốn nhập kho)',
      noteCode: 'TK.156',
      formulaText: '∑ (Số lượng tồn kho thực tế × Đơn giá vốn nhập kho)',
      recordCount: inventoryValuationRows.length,
      recordCountLabel: `${inventoryValuationRows.length} danh mục vật tư`,
      amount: inventoryValue156,
      ratioToNetRevenuePct: pctOfNetRev(inventoryValue156),
      description:
        'Tổng giá trị tài sản hàng hóa vật tư nông nghiệp hiện đang tồn kho tính theo đơn giá vốn nhập kho.',
    },
    {
      code: '331',
      drillDownCode: '331_supplier_payables',
      section: 'B01_B03_BALANCE_CASHFLOW',
      title: 'IV. Phải trả cho người bán ngắn hạn (Công nợ Nhà cung cấp còn nợ)',
      noteCode: 'TK.331',
      formulaText: '∑ Số tiền còn nợ Nhà cung cấp trên các phiếu nhập kho',
      recordCount: unpaidImportsInPeriod.length,
      recordCountLabel: `${unpaidImportsInPeriod.length} phiếu nhập còn nợ NCC`,
      amount: supplierPayables331,
      ratioToNetRevenuePct: pctOfNetRev(supplierPayables331),
      description:
        'Tổng số dư nghĩa vụ công nợ phải trả cho các Nhà cung cấp phân bón, thuốc BVTV, giống cây trồng.',
    },
    {
      code: '400',
      drillDownCode: '400_net_working_capital',
      section: 'B01_B03_BALANCE_CASHFLOW',
      title: 'V. Giá trị Tài sản thuần & Vốn lưu động ròng cuối kỳ (110 + 131 + 156 - 331)',
      noteCode: 'B01-DN',
      formulaText: 'Mã 110 + Mã 131 + Mã 156 - Mã 331',
      recordCount:
        inventoryValuationRows.length + unpaidSalesInPeriod.length + unpaidImportsInPeriod.length,
      recordCountLabel: 'Tổng hợp Tài sản & Nguồn vốn',
      amount: netWorkingCapital400,
      ratioToNetRevenuePct: pctOfNetRev(netWorkingCapital400),
      isHighlightRow: true,
      description:
        'Tổng giá trị tài sản ròng gồm Dòng tiền ròng + Phải thu khách hàng + Giá trị tồn kho trừ đi Nợ phải trả Nhà cung cấp.',
    },
  ];

  return {
    fiscalYear,
    fromDate,
    toDate,
    taxRatePct,
    incomeStatementLines,
    balanceAndCashflowLines,
    allLines: [...incomeStatementLines, ...balanceAndCashflowLines],
    filteredSales,
    discountedSales,
    unpaidSalesInPeriod,
    filteredImports,
    unpaidImportsInPeriod,
    operatingPaymentVouchers,
    otherIncomeReceiptVouchers,
    allFilteredReceiptVouchers: baseReport.filteredReceiptVouchers,
    allFilteredPaymentVouchers: baseReport.filteredPaymentVouchers,
    saleCogsBreakdown,
    inventoryValuationRows,
    grossRevenue01,
    revenueDeduction02,
    netRevenue10,
    productCogs11a,
    giftCogs11b,
    totalCogs11,
    grossProfit20,
    operatingExpenses24,
    operatingProfit30,
    otherIncome31,
    profitBeforeTax50,
    estimatedTax51,
    profitAfterTax60,
    totalCashInflow: baseReport.totalCashInflow,
    totalCashOutflow: baseReport.totalCashOutflow,
    netCashflow110,
    customerReceivables131,
    inventoryValue156,
    supplierPayables331,
    netWorkingCapital400,
  };
}

/**
 * Checks whether a staff account is authorized to view and filter across all/multiple warehouses:
 * - Primary Manager ('primary_manager')
 * - Deputy General Manager ('deputy_general_manager')
 * - Any account with 'manage_all_warehouses' permission or assignedWarehouse === 'Tất cả kho'
 */
export function canStaffFilterMultiWarehouses(staff: StaffMember): boolean {
  return (
    canAccountCreateStaff(staff) ||
    staff.positionRole === 'primary_manager' ||
    staff.positionRole === 'deputy_general_manager' ||
    Boolean(staff.permissions?.includes('manage_all_warehouses')) ||
    staff.assignedWarehouse === 'Tất cả kho'
  );
}

/**
 * Normalizes the selected warehouse list against all existing warehouses.
 * Empty array or matching all available warehouses means "All Warehouses" are active.
 */
export function resolveActiveWarehouses(
  staff: StaffMember,
  allWarehouses: string[],
  selectedWarehouses: string[]
): string[] {
  const defaultWarehouse = allWarehouses[0] || 'Tâm An Mỹ Ngãi';
  if (!canStaffFilterMultiWarehouses(staff)) {
    const locked =
      staff.assignedWarehouse && staff.assignedWarehouse !== 'Tất cả kho'
        ? staff.assignedWarehouse
        : defaultWarehouse;
    return [locked];
  }
  const validSelected = selectedWarehouses.filter((w) => allWarehouses.includes(w));
  if (validSelected.length === 0 || validSelected.length === allWarehouses.length) {
    return allWarehouses;
  }
  return validSelected;
}

/**
 * Filters records with an optional warehouseName field by the currently selected warehouses.
 */
export function filterRecordsBySelectedWarehouses<T extends { warehouseName?: string }>(
  records: T[],
  staff: StaffMember,
  allWarehouses: string[],
  selectedWarehouses: string[]
): T[] {
  const defaultWarehouse = allWarehouses[0] || 'Tâm An Mỹ Ngãi';
  const activeSet = new Set(resolveActiveWarehouses(staff, allWarehouses, selectedWarehouses));
  if (canStaffFilterMultiWarehouses(staff) && activeSet.size >= allWarehouses.length) {
    return records;
  }
  return records.filter((rec) => activeSet.has(rec.warehouseName || defaultWarehouse));
}

/**
 * Formats the concise label for the warehouse filter badge (e.g. "Tất cả kho (3)", "Tâm An Mỹ Ngãi", "Đã chọn 2/3 kho").
 */
export function formatSelectedWarehousesBadge(
  staff: StaffMember,
  allWarehouses: string[],
  selectedWarehouses: string[],
  detailed = false
): string {
  const active = resolveActiveWarehouses(staff, allWarehouses, selectedWarehouses);
  if (!canStaffFilterMultiWarehouses(staff)) {
    return active[0] || 'Tâm An Mỹ Ngãi';
  }
  if (active.length === 0 || active.length >= allWarehouses.length) {
    return `Tất cả kho (${allWarehouses.length})`;
  }
  if (active.length === 1) {
    return active[0];
  }
  if (detailed) {
    return `${active.join(', ')} (${active.length}/${allWarehouses.length} kho)`;
  }
  return `Đã chọn ${active.length}/${allWarehouses.length} kho`;
}

/**
 * Computes net inventory stock deltas (`+` restores stock, `-` deducts stock) when an
 * existing sale invoice is edited (accounting for both main product and gift product changes).
 */
export function computeSaleEditStockDeltas(
  existingSale: Pick<SaleTransaction, 'productId' | 'quantity' | 'giftProductId' | 'giftQuantity'>,
  updatedSale: Pick<SaleTransaction, 'productId' | 'quantity' | 'giftProductId' | 'giftQuantity'>
): Record<string, number> {
  const deltas: Record<string, number> = {};
  const addDelta = (prodId: string | undefined, qty: number) => {
    if (!prodId || !Number.isFinite(qty) || qty === 0) return;
    deltas[prodId] = (deltas[prodId] || 0) + qty;
  };

  // Restore previous deductions
  addDelta(existingSale.productId, Number(existingSale.quantity) || 0);
  if (existingSale.giftProductId && (Number(existingSale.giftQuantity) || 0) > 0) {
    addDelta(existingSale.giftProductId, Number(existingSale.giftQuantity) || 0);
  }

  // Apply new deductions
  addDelta(updatedSale.productId, -(Number(updatedSale.quantity) || 0));
  if (updatedSale.giftProductId && (Number(updatedSale.giftQuantity) || 0) > 0) {
    addDelta(updatedSale.giftProductId, -(Number(updatedSale.giftQuantity) || 0));
  }

  for (const key of Object.keys(deltas)) {
    if (deltas[key] === 0) {
      delete deltas[key];
    }
  }
  return deltas;
}

/**
 * Reconciles customer `totalPurchased` and `totalDebt` strictly from linked sales transactions.
 * Customers with zero matched sales retain their existing opening balances unless `resetZeroSales` is true.
 */
export function reconcileCustomersFromSales(
  customers: CustomerProfile[],
  sales: SaleTransaction[],
  nowIso?: string,
  options?: { resetZeroSalesCustomerIds?: Set<string> }
): {
  customers: CustomerProfile[];
  changedCustomers: CustomerProfile[];
} {
  const changedCustomers: CustomerProfile[] = [];
  const nextCustomers = customers.map((c) => {
    const cleanPhone = (c.phone || '').trim();
    const cleanName = normalizeVietnameseSearch(c.name);
    const matchedSales = sales.filter((s) => {
      if (s.customerId === c.id) return true;
      if ((s.customerId || '').startsWith('cust_xl_')) {
        if (c.warehouseName && s.warehouseName && c.warehouseName !== s.warehouseName) {
          return false;
        }
        if (cleanPhone && s.customerPhone && s.customerPhone.trim() === cleanPhone) {
          return true;
        }
        if (cleanName && normalizeVietnameseSearch(s.customerName) === cleanName) {
          return true;
        }
      }
      return false;
    });

    if (matchedSales.length === 0) {
      if (options?.resetZeroSalesCustomerIds?.has(c.id)) {
        if (c.totalPurchased !== 0 || c.totalDebt !== 0) {
          const resetCust: CustomerProfile = {
            ...c,
            totalPurchased: 0,
            totalDebt: 0,
            updatedAt: nowIso || c.updatedAt,
          };
          changedCustomers.push(resetCust);
          return resetCust;
        }
      }
      return c;
    }

    const nextPurchased = Math.max(
      0,
      Math.round(matchedSales.reduce((sum, s) => sum + (Number(s.totalAmount) || 0), 0))
    );
    const nextDebt = Math.max(
      0,
      Math.round(matchedSales.reduce((sum, s) => sum + (Number(s.debtAmount) || 0), 0))
    );

    if (c.totalPurchased === nextPurchased && c.totalDebt === nextDebt) {
      return c;
    }

    const updated: CustomerProfile = {
      ...c,
      totalPurchased: nextPurchased,
      totalDebt: nextDebt,
      updatedAt: nowIso || c.updatedAt,
    };
    changedCustomers.push(updated);
    return updated;
  });

  return { customers: nextCustomers, changedCustomers };
}

/**
 * Reverses allocated debt settlements on linked sales invoices when a debt-settlement receipt voucher is deleted or re-allocated.
 */
export function reverseCustomerReceiptVoucherAllocations(
  sales: SaleTransaction[],
  voucher: Pick<CashReceiptVoucher, 'voucherCode' | 'isDebtSettlement' | 'settledAllocations'>,
  nowIso: string
): { updatedSales: SaleTransaction[]; reversedSaleIds: string[] } {
  if (!voucher.isDebtSettlement || !voucher.settledAllocations?.length) {
    return { updatedSales: sales, reversedSaleIds: [] };
  }

  const byRecordId = new Map<string, number>();
  const byCodeNoId = new Map<string, number>();
  for (const alloc of voucher.settledAllocations) {
    const amt = Math.max(0, Math.round(Number(alloc.allocatedAmount) || 0));
    if (amt <= 0) continue;
    if (alloc.recordId) {
      byRecordId.set(alloc.recordId, (byRecordId.get(alloc.recordId) || 0) + amt);
    } else if (alloc.code) {
      byCodeNoId.set(alloc.code, (byCodeNoId.get(alloc.code) || 0) + amt);
    }
  }

  const reversedSaleIds: string[] = [];
  const updatedSales = sales.map((s) => {
    const reversal = byRecordId.get(s.id) ?? (byRecordId.size === 0 ? byCodeNoId.get(s.invoiceCode) : undefined) ?? 0;
    if (reversal <= 0) return s;

    const total = Math.max(0, Number(s.totalAmount) || 0);
    const nextPaid = Math.max(0, Math.min(total, (Number(s.paidAmount) || 0) - reversal));
    const nextDebt = Math.max(0, total - nextPaid);
    const nextStatus: PaymentStatus =
      nextDebt === 0 ? 'paid' : nextPaid > 0 ? 'partial' : 'unpaid';
    const noteSuffix = `[Hoàn hủy phiếu thu ${voucher.voucherCode}: -${reversal.toLocaleString('vi-VN')}đ]`;
    reversedSaleIds.push(s.id);
    return {
      ...s,
      paidAmount: nextPaid,
      debtAmount: nextDebt,
      status: nextStatus,
      note: s.note ? `${s.note} | ${noteSuffix}` : noteSuffix,
      updatedAt: nowIso,
    };
  });

  return { updatedSales, reversedSaleIds };
}

/**
 * Reverses allocated debt settlements on linked import receipts when a debt-settlement payment voucher is deleted or re-allocated.
 */
export function reverseSupplierPaymentVoucherAllocations(
  imports: ImportTransaction[],
  voucher: Pick<CashPaymentVoucher, 'voucherCode' | 'isDebtSettlement' | 'settledAllocations'>,
  nowIso: string
): { updatedImports: ImportTransaction[]; reversedImportIds: string[] } {
  if (!voucher.isDebtSettlement || !voucher.settledAllocations?.length) {
    return { updatedImports: imports, reversedImportIds: [] };
  }

  const byRecordId = new Map<string, number>();
  const byCodeNoId = new Map<string, number>();
  for (const alloc of voucher.settledAllocations) {
    const amt = Math.max(0, Math.round(Number(alloc.allocatedAmount) || 0));
    if (amt <= 0) continue;
    if (alloc.recordId) {
      byRecordId.set(alloc.recordId, (byRecordId.get(alloc.recordId) || 0) + amt);
    } else if (alloc.code) {
      byCodeNoId.set(alloc.code, (byCodeNoId.get(alloc.code) || 0) + amt);
    }
  }

  const reversedImportIds: string[] = [];
  const updatedImports = imports.map((imp) => {
    const reversal = byRecordId.get(imp.id) ?? (byRecordId.size === 0 ? byCodeNoId.get(imp.receiptCode) : undefined) ?? 0;
    if (reversal <= 0) return imp;

    const total = Math.max(0, Number(imp.totalCost) || 0);
    const nextPaid = Math.max(0, Math.min(total, (Number(imp.paidAmount) || 0) - reversal));
    const nextDebt = Math.max(0, total - nextPaid);
    const nextStatus: PaymentStatus =
      nextDebt === 0 ? 'paid' : nextPaid > 0 ? 'partial' : 'unpaid';
    const noteSuffix = `[Hoàn hủy phiếu chi ${voucher.voucherCode}: -${reversal.toLocaleString('vi-VN')}đ]`;
    reversedImportIds.push(imp.id);
    return {
      ...imp,
      paidAmount: nextPaid,
      debtAmount: nextDebt,
      status: nextStatus,
      note: imp.note ? `${imp.note} | ${noteSuffix}` : noteSuffix,
      updatedAt: nowIso,
    };
  });

  return { updatedImports, reversedImportIds };
}

/**
 * Finds debt-settlement receipt vouchers (`isDebtSettlement`) allocated to a sale invoice.
 * Used to block deleting/editing sales until linked debt receipts are cancelled first.
 */
export function findLinkedReceiptVouchersForSale(
  sale: Pick<SaleTransaction, 'id' | 'invoiceCode'>,
  receiptVouchers: CashReceiptVoucher[]
): CashReceiptVoucher[] {
  return (receiptVouchers || []).filter(
    (rv) =>
      rv.isDebtSettlement &&
      rv.settledAllocations?.some(
        (a) =>
          (Number(a.allocatedAmount) || 0) > 0 &&
          (a.recordId ? a.recordId === sale.id : a.code === sale.invoiceCode)
      )
  );
}

/**
 * Finds debt-settlement payment vouchers (`isDebtSettlement`) allocated to an import receipt.
 * Used to block deleting/editing imports until linked supplier payments are cancelled first.
 */
export function findLinkedPaymentVouchersForImport(
  imp: Pick<ImportTransaction, 'id' | 'receiptCode'>,
  paymentVouchers: CashPaymentVoucher[]
): CashPaymentVoucher[] {
  return (paymentVouchers || []).filter(
    (pv) =>
      pv.isDebtSettlement &&
      pv.settledAllocations?.some(
        (a) =>
          (Number(a.allocatedAmount) || 0) > 0 &&
          (a.recordId ? a.recordId === imp.id : a.code === imp.receiptCode)
      )
  );
}

export interface StockMovementRecord {
  id: string;
  dateIso: string;
  type: 'import' | 'sale' | 'gift_export' | 'stocktake_in' | 'stocktake_out';
  voucherCode: string;
  partnerName: string;
  partnerPhone: string;
  warehouseName: string;
  unitPriceOrCost: number;
  qtyIn: number;
  qtyOut: number;
  balanceAfter: number;
  totalValue: number;
  note: string;
  staffName: string;
}

export interface ProductStockMovementLedger {
  product: ProductItem;
  openingStock: number;
  periodImportCount: number;
  periodImportQty: number;
  periodImportValue: number;
  periodExportCount: number;
  periodExportSaleQty: number;
  periodExportGiftQty: number;
  periodExportAdjustmentQty?: number;
  periodExportTotalQty: number;
  periodExportRevenue: number;
  closingStock: number;
  allTimeImportQty: number;
  allTimeExportQty: number;
  movementsInPeriod: StockMovementRecord[];
}

/**
 * Computes the complete Stock Movement Ledger (Thẻ kho Xuất - Nhập - Tồn) for a single product,
 * reconciling opening balance, chronological imports, retail sales, promotional gift exports,
 * stocktake adjustments (`stockAdjustments`), running stock balance after every document, and closing balance matching `product.stock`.
 */
export function computeProductStockMovementLedger(
  product: ProductItem,
  sales: SaleTransaction[],
  imports: ImportTransaction[],
  options?: { fromDate?: string; toDate?: string; stockAdjustments?: StockAdjustmentRecord[] }
): ProductStockMovementLedger {
  const prodWh = product.warehouseName || '';
  const normProdName = normalizeVietnameseSearch(product.name);
  const matchesProduct = (recProdId: string | undefined, recProdName: string | undefined, recWh?: string) => {
    if (recProdId && recProdId === product.id) return true;
    if (recProdId && recProdId.startsWith('prod_xl_') && recProdName) {
      if (prodWh && recWh && prodWh !== recWh) return false;
      return normalizeVietnameseSearch(recProdName) === normProdName;
    }
    return false;
  };

  type RawEvent = Omit<StockMovementRecord, 'balanceAfter'>;
  const rawEvents: RawEvent[] = [];
  let allTimeImportQty = 0;
  let allTimeExportQty = 0;

  for (const imp of imports) {
    if (!matchesProduct(imp.productId, imp.productName, imp.warehouseName)) continue;
    const qty = Math.max(0, Number(imp.quantity) || 0);
    if (qty <= 0) continue;
    allTimeImportQty += qty;
    rawEvents.push({
      id: `imp_${imp.id}`,
      dateIso: imp.createdAt || '',
      type: 'import',
      voucherCode: imp.receiptCode,
      partnerName: imp.supplierName || 'Nhà cung cấp',
      partnerPhone: imp.supplierPhone || '',
      warehouseName: imp.warehouseName || prodWh || 'Tâm An Mỹ Ngãi',
      unitPriceOrCost: Math.max(0, Number(imp.unitCost) || 0),
      qtyIn: qty,
      qtyOut: 0,
      totalValue: Math.max(0, Number(imp.totalCost) || 0),
      note: imp.note || '',
      staffName: imp.staffName || '',
    });
  }

  for (const s of sales) {
    if (matchesProduct(s.productId, s.productName, s.warehouseName)) {
      const qty = Math.max(0, Number(s.quantity) || 0);
      if (qty > 0) {
        allTimeExportQty += qty;
        rawEvents.push({
          id: `sale_${s.id}`,
          dateIso: s.createdAt || '',
          type: 'sale',
          voucherCode: s.invoiceCode,
          partnerName: s.customerName || 'Khách hàng',
          partnerPhone: s.customerPhone || '',
          warehouseName: s.warehouseName || prodWh || 'Tâm An Mỹ Ngãi',
          unitPriceOrCost: Math.max(0, Number(s.unitPrice) || 0),
          qtyIn: 0,
          qtyOut: qty,
          totalValue: Math.max(0, Number(s.totalAmount) || 0),
          note: s.note || '',
          staffName: s.staffName || '',
        });
      }
    }

    if (
      s.giftProductId &&
      (Number(s.giftQuantity) || 0) > 0 &&
      matchesProduct(s.giftProductId, s.giftProductName, s.warehouseName)
    ) {
      const giftQty = Math.max(0, Number(s.giftQuantity) || 0);
      if (giftQty > 0) {
        allTimeExportQty += giftQty;
        const unitCost =
          s.giftUnitCost !== undefined ? Number(s.giftUnitCost) || 0 : Number(product.importPrice) || 0;
        rawEvents.push({
          id: `gift_${s.id}`,
          dateIso: s.createdAt || '',
          type: 'gift_export',
          voucherCode: s.invoiceCode,
          partnerName: `${s.customerName || 'Khách hàng'} (Quà KM)`,
          partnerPhone: s.customerPhone || '',
          warehouseName: s.warehouseName || prodWh || 'Tâm An Mỹ Ngãi',
          unitPriceOrCost: unitCost,
          qtyIn: 0,
          qtyOut: giftQty,
          totalValue: Math.round(unitCost * giftQty),
          note: `Quà tặng KM kèm HĐ ${s.invoiceCode}`,
          staffName: s.staffName || '',
        });
      }
    }
  }

  for (const adj of options?.stockAdjustments || []) {
    if (adj.productId !== product.id) continue;
    const diff = Math.round(Number(adj.diffQty) || 0);
    if (diff === 0) continue;
    const unitCost = Math.max(0, Number(adj.unitCost) || Number(product.importPrice) || 0);
    if (diff > 0) {
      allTimeImportQty += diff;
      rawEvents.push({
        id: `adj_${adj.id}`,
        dateIso: adj.createdAt || '',
        type: 'stocktake_in',
        voucherCode: adj.adjustmentCode,
        partnerName: `Kiểm kê kho (${adj.reason || 'Điều chỉnh tăng'})`,
        partnerPhone: '',
        warehouseName: adj.warehouseName || prodWh || 'Tâm An Mỹ Ngãi',
        unitPriceOrCost: unitCost,
        qtyIn: diff,
        qtyOut: 0,
        totalValue: Math.round(diff * unitCost),
        note: adj.note || `Kiểm thực tế ${adj.actualCountedStock} (Hệ thống: ${adj.systemStockBefore})`,
        staffName: adj.staffName || '',
      });
    } else {
      const absDiff = Math.abs(diff);
      allTimeExportQty += absDiff;
      rawEvents.push({
        id: `adj_${adj.id}`,
        dateIso: adj.createdAt || '',
        type: 'stocktake_out',
        voucherCode: adj.adjustmentCode,
        partnerName: `Kiểm kê kho (${adj.reason || 'Hao hụt / Điều chỉnh giảm'})`,
        partnerPhone: '',
        warehouseName: adj.warehouseName || prodWh || 'Tâm An Mỹ Ngãi',
        unitPriceOrCost: unitCost,
        qtyIn: 0,
        qtyOut: absDiff,
        totalValue: Math.round(absDiff * unitCost),
        note: adj.note || `Kiểm thực tế ${adj.actualCountedStock} (Hệ thống: ${adj.systemStockBefore})`,
        staffName: adj.staffName || '',
      });
    }
  }

  rawEvents.sort((a, b) => {
    const cmp = (a.dateIso || '').localeCompare(b.dateIso || '');
    if (cmp !== 0) return cmp;
    if (a.type === 'import' && b.type !== 'import') return -1;
    if (a.type !== 'import' && b.type === 'import') return 1;
    return (a.voucherCode || '').localeCompare(b.voucherCode || '');
  });

  const currentStock = Math.max(0, Number(product.stock) || 0);
  const initialBaseStock = currentStock - (allTimeImportQty - allTimeExportQty);
  let running = initialBaseStock;

  const eventsWithBalance: StockMovementRecord[] = rawEvents.map((ev) => {
    running = running + ev.qtyIn - ev.qtyOut;
    return {
      ...ev,
      balanceAfter: running,
    };
  });

  const fromDate = options?.fromDate?.trim() || '';
  const toDate = options?.toDate?.trim() || '';

  let openingStock = initialBaseStock;
  const movementsInPeriodAsc: StockMovementRecord[] = [];
  let periodImportCount = 0;
  let periodImportQty = 0;
  let periodImportValue = 0;
  let periodExportCount = 0;
  let periodExportSaleQty = 0;
  let periodExportGiftQty = 0;
  let periodExportAdjustmentQty = 0;
  let periodExportRevenue = 0;

  for (const ev of eventsWithBalance) {
    const datePart = toVietnamDateStr(ev.dateIso);
    const isBeforeStart = Boolean(fromDate && /^\d{4}-\d{2}-\d{2}$/.test(datePart) && datePart < fromDate);
    if (isBeforeStart) {
      openingStock = ev.balanceAfter;
      continue;
    }
    if (!isDateWithinRange(ev.dateIso, fromDate, toDate)) {
      continue;
    }
    movementsInPeriodAsc.push(ev);
    if (ev.type === 'import' || ev.type === 'stocktake_in') {
      periodImportCount += 1;
      periodImportQty += ev.qtyIn;
      periodImportValue += ev.totalValue;
    } else if (ev.type === 'sale') {
      periodExportCount += 1;
      periodExportSaleQty += ev.qtyOut;
      periodExportRevenue += ev.totalValue;
    } else if (ev.type === 'stocktake_out') {
      periodExportCount += 1;
      periodExportAdjustmentQty += ev.qtyOut;
    } else {
      periodExportCount += 1;
      periodExportGiftQty += ev.qtyOut;
    }
  }

  const periodExportTotalQty =
    periodExportSaleQty + periodExportGiftQty + periodExportAdjustmentQty;
  const closingStock =
    movementsInPeriodAsc.length > 0
      ? movementsInPeriodAsc[movementsInPeriodAsc.length - 1].balanceAfter
      : openingStock;

  return {
    product,
    openingStock,
    periodImportCount,
    periodImportQty,
    periodImportValue,
    periodExportCount,
    periodExportSaleQty,
    periodExportGiftQty,
    periodExportAdjustmentQty,
    periodExportTotalQty,
    periodExportRevenue,
    closingStock,
    allTimeImportQty,
    allTimeExportQty,
    movementsInPeriod: [...movementsInPeriodAsc].reverse(),
  };
}

export type ExpiryAlertStatus =
  | 'none'
  | 'expired'
  | 'expiring_30d'
  | 'expiring_60d'
  | 'expiring_90d'
  | 'safe';

export function evaluateProductExpiry(
  expiryDate?: string,
  todayStr = getTodayVietnamDateStr()
): { status: ExpiryAlertStatus; daysRemaining: number | null; badgeLabel: string } {
  const clean = (expiryDate || '').trim().slice(0, 10);
  if (!clean || !/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    return { status: 'none', daysRemaining: null, badgeLabel: 'Chưa có HSD' };
  }
  const ref = toVietnamDateStr(todayStr) || getTodayVietnamDateStr();
  const [ey, em, ed] = clean.split('-').map(Number);
  const [ry, rm, rd] = ref.split('-').map(Number);
  const expMs = Date.UTC(ey, em - 1, ed);
  const refMs = Date.UTC(ry, rm - 1, rd);
  if (!Number.isFinite(expMs) || !Number.isFinite(refMs)) {
    return { status: 'none', daysRemaining: null, badgeLabel: 'Chưa có HSD' };
  }
  const daysRemaining = Math.round((expMs - refMs) / 86_400_000);
  if (daysRemaining < 0) {
    return {
      status: 'expired',
      daysRemaining,
      badgeLabel: `Đã hết hạn (${Math.abs(daysRemaining)} ngày)`,
    };
  }
  if (daysRemaining <= 30) {
    return {
      status: 'expiring_30d',
      daysRemaining,
      badgeLabel: daysRemaining === 0 ? 'Hết hạn hôm nay' : `Hết hạn sau ${daysRemaining} ngày`,
    };
  }
  if (daysRemaining <= 60) {
    return {
      status: 'expiring_60d',
      daysRemaining,
      badgeLabel: `Còn ${daysRemaining} ngày`,
    };
  }
  if (daysRemaining <= 90) {
    return {
      status: 'expiring_90d',
      daysRemaining,
      badgeLabel: `Còn ${daysRemaining} ngày`,
    };
  }
  return { status: 'safe', daysRemaining, badgeLabel: `Còn ${daysRemaining} ngày` };
}

export function pickEarlierFefoBatch(
  existingBatch?: string,
  existingExpiry?: string,
  incomingBatch?: string,
  incomingExpiry?: string,
  currentStock = 0
): { batchNumber?: string; expiryDate?: string } {
  const curExp = (existingExpiry || '').trim().slice(0, 10);
  const inExp = (incomingExpiry || '').trim().slice(0, 10);
  const curValid = /^\d{4}-\d{2}-\d{2}$/.test(curExp);
  const inValid = /^\d{4}-\d{2}-\d{2}$/.test(inExp);
  const cleanCurBatch = existingBatch?.trim() || undefined;
  const cleanInBatch = incomingBatch?.trim() || undefined;

  if (currentStock <= 0 || !curValid) {
    return {
      batchNumber: cleanInBatch || cleanCurBatch,
      expiryDate: inValid ? inExp : curValid ? curExp : undefined,
    };
  }
  if (!inValid) {
    return {
      batchNumber: cleanCurBatch || cleanInBatch,
      expiryDate: curExp,
    };
  }
  // Both valid with existing stock > 0 -> FEFO keeps earlier expiry batch first
  if (inExp < curExp) {
    return {
      batchNumber: cleanInBatch || cleanCurBatch,
      expiryDate: inExp,
    };
  }
  return {
    batchNumber: cleanCurBatch || cleanInBatch,
    expiryDate: curExp,
  };
}

export interface SmartReorderSuggestionItem {
  product: ProductItem;
  soldQtyLookback: number;
  dailyVelocity: number;
  daysOfStockLeft: number | null;
  suggestedOrderQty: number;
  estimatedCost: number;
  urgency: 'critical' | 'high' | 'watch';
  reason: string;
}

export function computeSmartReorderSuggestions(
  products: ProductItem[],
  sales: SaleTransaction[],
  options?: { lookbackDays?: number; coverDays?: number; todayStr?: string }
): SmartReorderSuggestionItem[] {
  const lookbackDays = Math.max(1, Math.round(options?.lookbackDays ?? 30));
  const coverDays = Math.max(7, Math.round(options?.coverDays ?? 21));
  const todayStr = toVietnamDateStr(options?.todayStr) || getTodayVietnamDateStr();
  const [ty, tm, td] = todayStr.split('-').map(Number);
  const fromUtc = new Date(Date.UTC(ty, tm - 1, td - lookbackDays));
  const fromDateStr = fromUtc.toISOString().slice(0, 10);

  const soldByProduct = new Map<string, number>();
  for (const s of sales) {
    const saleDate = toVietnamDateStr(s.createdAt);
    if (!saleDate || saleDate < fromDateStr || saleDate > todayStr) continue;
    const qty = Math.max(0, Number(s.quantity) || 0);
    if (qty > 0 && s.productId) {
      soldByProduct.set(s.productId, (soldByProduct.get(s.productId) || 0) + qty);
    }
    const giftQty = Math.max(0, Number(s.giftQuantity) || 0);
    if (giftQty > 0 && s.giftProductId) {
      soldByProduct.set(s.giftProductId, (soldByProduct.get(s.giftProductId) || 0) + giftQty);
    }
  }

  const suggestions: SmartReorderSuggestionItem[] = [];
  for (const product of products) {
    const curStock = Math.max(0, Number(product.stock) || 0);
    const minStk = Math.max(0, Number(product.minStock) || 0);
    const soldQtyLookback = soldByProduct.get(product.id) || 0;
    const dailyVelocity = soldQtyLookback / lookbackDays;
    const daysOfStockLeft = dailyVelocity > 0 ? Math.floor(curStock / dailyVelocity) : null;

    const needsReorder = curStock <= minStk || (daysOfStockLeft !== null && daysOfStockLeft <= 14);
    if (!needsReorder) continue;

    const targetStock = Math.max(minStk * 1.5, dailyVelocity * coverDays);
    const suggestedOrderQty = Math.max(1, Math.ceil(targetStock - curStock));
    const estimatedCost = Math.round(suggestedOrderQty * Math.max(0, Number(product.importPrice) || 0));

    const urgency: 'critical' | 'high' | 'watch' =
      curStock <= 0 || (daysOfStockLeft !== null && daysOfStockLeft <= 3)
        ? 'critical'
        : curStock <= minStk || (daysOfStockLeft !== null && daysOfStockLeft <= 7)
        ? 'high'
        : 'watch';

    const reason =
      curStock <= 0
        ? 'Đã hết tồn kho'
        : daysOfStockLeft !== null && daysOfStockLeft <= 14
        ? `Ước tính chỉ đủ bán ~${daysOfStockLeft} ngày (${dailyVelocity.toFixed(1)} ${product.unit}/ngày)`
        : `Tồn (${curStock}) dưới mức tối thiểu (${minStk})`;

    suggestions.push({
      product,
      soldQtyLookback,
      dailyVelocity,
      daysOfStockLeft,
      suggestedOrderQty,
      estimatedCost,
      urgency,
      reason,
    });
  }

  const rank = { critical: 0, high: 1, watch: 2 };
  return suggestions.sort((a, b) => {
    if (rank[a.urgency] !== rank[b.urgency]) return rank[a.urgency] - rank[b.urgency];
    return b.soldQtyLookback - a.soldQtyLookback;
  });
}

export interface DebtAgingBucketSummary {
  currentAmount: number;
  currentCount: number;
  overdue1To30Amount: number;
  overdue1To30Count: number;
  overdue31To60Amount: number;
  overdue31To60Count: number;
  overdue60PlusAmount: number;
  overdue60PlusCount: number;
  totalDebtAmount: number;
  totalDebtCount: number;
}

export function computeDebtAgingSummary<T extends { debtAmount: number; dueDate: string }>(
  records: T[],
  todayStr = getTodayVietnamDateStr()
): DebtAgingBucketSummary {
  const summary: DebtAgingBucketSummary = {
    currentAmount: 0,
    currentCount: 0,
    overdue1To30Amount: 0,
    overdue1To30Count: 0,
    overdue31To60Amount: 0,
    overdue31To60Count: 0,
    overdue60PlusAmount: 0,
    overdue60PlusCount: 0,
    totalDebtAmount: 0,
    totalDebtCount: 0,
  };

  for (const r of records) {
    const debt = Math.max(0, Math.round(Number(r.debtAmount) || 0));
    if (debt <= 0) continue;
    summary.totalDebtAmount += debt;
    summary.totalDebtCount += 1;

    const { daysRemaining } = evaluateDebtUrgency(r.dueDate, debt, todayStr, 3);
    if (daysRemaining >= 0) {
      summary.currentAmount += debt;
      summary.currentCount += 1;
    } else {
      const overdueDays = Math.abs(daysRemaining);
      if (overdueDays <= 30) {
        summary.overdue1To30Amount += debt;
        summary.overdue1To30Count += 1;
      } else if (overdueDays <= 60) {
        summary.overdue31To60Amount += debt;
        summary.overdue31To60Count += 1;
      } else {
        summary.overdue60PlusAmount += debt;
        summary.overdue60PlusCount += 1;
      }
    }
  }
  return summary;
}

export function buildZaloDebtReminderMessage(params: {
  storeName?: string;
  customerName: string;
  customerPhone?: string;
  totalDebt: number;
  unpaidInvoices: Array<{
    invoiceCode: string;
    date: string;
    productName: string;
    debtAmount: number;
    dueDate: string;
  }>;
  todayStr?: string;
}): { message: string; zaloUrl: string | null } {
  const storeName = params.storeName?.trim() || 'VTNN Tâm An';
  const today = params.todayStr || getTodayVietnamDateStr();
  const totalStr = formatVND(Math.max(0, Math.round(params.totalDebt)));
  const lines = (params.unpaidInvoices || [])
    .slice(0, 8)
    .map(
      (inv, i) =>
        `${i + 1}. ${inv.invoiceCode} (${inv.date.slice(0, 10)}) — ${inv.productName}: còn nợ ${formatVND(
          inv.debtAmount
        )} (Hạn: ${inv.dueDate || '—'})`
    );
  if ((params.unpaidInvoices || []).length > 8) {
    lines.push(`... và ${params.unpaidInvoices.length - 8} hóa đơn khác.`);
  }

  const message = [
    `Kính gửi Anh/Chị ${params.customerName},`,
    `${storeName} xin gửi bảng đối soát công nợ vật tư nông nghiệp tính đến ngày ${today}:`,
    ...lines,
    `=> Tổng dư nợ hiện tại: ${totalStr}.`,
    `Rất mong Anh/Chị kiểm tra đối chiếu và thu xếp thanh toán thuận tiện. Trân trọng cảm ơn!`,
  ].join('\n');

  let digits = (params.customerPhone || '').replace(/\D+/g, '');
  if (digits.startsWith('84') && digits.length >= 11) {
    digits = '0' + digits.slice(2);
  }
  const zaloUrl = digits.length >= 9 && digits.length <= 11 ? `https://zalo.me/${digits}` : null;
  return { message, zaloUrl };
}




import {
  AppNotification,
  AuditActionCategory,
  AuditLogEntry,
  AuditTargetEntity,
  BackupEntry,
  BackupSnapshotPayload,
  CustomerGroup,
  CustomerProfile,
  DebtUrgencyLevel,
  ImportTransaction,
  NotificationPrefs,
  PaymentStatus,
  ProductItem,
  ReportModuleCategory,
  SaleTransaction,
  SavedVoucherRecord,
  StaffFunctionalPermission,
  StaffMember,
  StaffPositionRole,
  StockAlertLevel,
  SupplierProfile,
  UserRole,
} from '../types';

export interface SaleSummaryResult {
  totalAmount: number;
  paidAmount: number;
  debtAmount: number;
  status: PaymentStatus;
}

export function calculateSaleSummary(
  quantity: number,
  unitPrice: number,
  paidAmountInput: number
): SaleSummaryResult {
  const safeQty = Math.max(0, Number(quantity) || 0);
  const safePrice = Math.max(0, Number(unitPrice) || 0);
  const totalAmount = Math.round(safeQty * safePrice);
  const paidAmount = Math.min(totalAmount, Math.max(0, Math.round(Number(paidAmountInput) || 0)));
  const debtAmount = Math.max(0, totalAmount - paidAmount);

  let status: PaymentStatus = 'paid';
  if (debtAmount > 0 && paidAmount === 0) {
    status = 'unpaid';
  } else if (debtAmount > 0 && paidAmount > 0) {
    status = 'partial';
  }

  return {
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
  nowIso: string
): { updatedProducts: ProductItem[]; updatedProduct: ProductItem } {
  const target = products.find((p) => p.id === productId);
  if (!target) {
    throw new Error('Không tìm thấy sản phẩm trong kho.');
  }
  if (quantitySold <= 0) {
    throw new Error('Số lượng bán phải lớn hơn 0.');
  }
  if (target.stock < quantitySold) {
    throw new Error(
      `Tồn kho không đủ! Sản phẩm "${target.name}" chỉ còn ${target.stock} ${target.unit}.`
    );
  }

  const updatedProduct: ProductItem = {
    ...target,
    stock: target.stock - quantitySold,
    updatedAt: nowIso,
  };

  const updatedProducts = products.map((p) => (p.id === productId ? updatedProduct : p));
  return { updatedProducts, updatedProduct };
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
  if (quantityImported <= 0) {
    throw new Error('Số lượng nhập phải lớn hơn 0.');
  }

  const updatedProduct: ProductItem = {
    ...target,
    stock: target.stock + quantityImported,
    importPrice: unitCost > 0 ? unitCost : target.importPrice,
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

export function evaluateDebtUrgency(
  dueDateStr: string,
  debtAmount: number,
  referenceDateStr = '2026-11-16',
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
  referenceDateStr = '2026-11-16',
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
  referenceDateStr = '2026-11-16',
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
  referenceDateStr = '2026-11-16'
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

export const PRIMARY_MANAGER_EMAIL = 'trannhat1205@gmail.com';
export const PRIMARY_MANAGER_PHONE = '0393120246';

/**
 * ONLY the primary account (Gmail trannhat1205@gmail.com or Phone 0393120246 via SMS OTP)
 * has the authority to create accounts and assign permissions to personnel.
 */
export function canAccountCreateStaff(
  staff: Pick<StaffMember, 'email' | 'phone' | 'positionRole'> | null | undefined
): boolean {
  if (!staff) return false;
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
    label: 'Phó quản lý chung tất cả các kho (Phụ tiếp Quản lý chính)',
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
    label: 'Quyền Sửa / Xóa hóa đơn, chứng từ & phiếu thu đã lưu',
    description:
      'Chức năng: Được phép mở chỉnh sửa trực tiếp hoặc xóa các hóa đơn bán hàng, phiếu nhập kho, phiếu thu/chi đã lưu trong hệ thống.',
  },
  {
    key: 'export_import_excel',
    label: 'Nhập / Xuất dữ liệu mẫu Excel (.xlsx) & Báo cáo định kỳ',
    description:
      'Chức năng: Tải tệp Excel mẫu, nhập dữ liệu hàng loạt từ Excel lên ứng dụng và xuất báo cáo tổng hợp định kỳ ra Excel/PDF.',
  },
  {
    key: 'view_assigned_reports',
    label: 'Xem & Xuất báo cáo theo nhiệm vụ được phân công (Từ ngày... đến ngày...)',
    description:
      'Chức năng: Nhân viên được xem, kiểm tra chi tiết và xuất báo cáo cấp trên (Từ ngày... đến ngày...) tương ứng đúng với mục nghiệp vụ do mình quản lý để báo cáo kịp thời cho Quản lý.',
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
      return 'Phó quản lý chung tất cả các kho (Phụ tiếp Quản lý chính)';
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
    paidAmount: number;
    dueDate: string;
    note: string;
  },
  nowIso: string
): SaleTransaction {
  const summary = calculateSaleSummary(changes.quantity, changes.unitPrice, changes.paidAmount);
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
    totalAmount: summary.totalAmount,
    paidAmount: summary.paidAmount,
    debtAmount: summary.debtAmount,
    status: summary.status,
    dueDate: changes.dueDate || existing.dueDate,
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

  const canAccessBackupHistory = isPrimaryOwner;

  const canEditDeleteVouchers =
    hasAllWarehouses || perms.includes('edit_delete_vouchers');

  // Determine the exact report tabs this staff member is authorized to view & export for upper management
  const allowedReportCategories: ReportModuleCategory[] = [];
  if (canAccessReports) {
    allowedReportCategories.push('overview');
    if (canAccessSales) allowedReportCategories.push('sales_log');
    if (canAccessImports) allowedReportCategories.push('imports_log');
    if (canAccessInventory) allowedReportCategories.push('inventory_stock');
    if (canAccessCustomers) allowedReportCategories.push('customers_items');
    if (canAccessDebts) allowedReportCategories.push('debts_receivable_payable');
    if (canAccessCashflow) allowedReportCategories.push('cashflow_treasury');
    if (isPrimaryOwner) allowedReportCategories.push('financial_profit');
  }

  const allowedTabs: string[] = ['dashboard'];
  if (canAccessSales) allowedTabs.push('sales');
  if (canAccessImports) allowedTabs.push('imports');
  if (canAccessInventory) allowedTabs.push('inventory');
  if (canAccessCustomers) allowedTabs.push('customers');
  if (canAccessDebts) allowedTabs.push('debts');
  if (canAccessVouchers) allowedTabs.push('vouchers');
  allowedTabs.push('staff_accounts');
  if (canAccessReports) allowedTabs.push('reports');
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
  products: ProductItem[];
  customers: CustomerProfile[];
  suppliers: SupplierProfile[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  savedVouchers: SavedVoucherRecord[];
  staffList: StaffMember[];
  auditLogs: AuditLogEntry[];
}): BackupSnapshotPayload {
  const recordCount =
    params.products.length +
    params.customers.length +
    params.sales.length +
    params.imports.length +
    params.savedVouchers.length;

  return {
    version: '2.0-audit-enabled',
    exportedAt: params.exportedAt,
    exportedByEmail: params.exportedByEmail,
    fileName: params.fileName,
    recordCount,
    auditLogCount: params.auditLogs.length,
    warehouses: [...params.warehouses],
    customerGroups: [...params.customerGroups],
    productCategories: [...params.productCategories],
    products: [...params.products],
    customers: [...params.customers],
    suppliers: [...params.suppliers],
    sales: [...params.sales],
    imports: [...params.imports],
    savedVouchers: [...params.savedVouchers],
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

    const auditLogs: AuditLogEntry[] = Array.isArray(parsed.auditLogs)
      ? parsed.auditLogs
      : [];
    const savedVouchers: SavedVoucherRecord[] = Array.isArray(parsed.savedVouchers)
      ? parsed.savedVouchers
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

    const recordCount =
      parsed.products.length +
      parsed.customers.length +
      parsed.sales.length +
      parsed.imports.length +
      savedVouchers.length;

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
        products: parsed.products,
        customers: parsed.customers,
        suppliers,
        sales: parsed.sales,
        imports: parsed.imports,
        savedVouchers,
        staffList,
        auditLogs,
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
 * Checks whether an ISO timestamp or YYYY-MM-DD date string falls within [fromDate, toDate] inclusive.
 */
export function isDateWithinRange(
  isoOrDateStr: string | null | undefined,
  fromDate?: string,
  toDate?: string
): boolean {
  if (!isoOrDateStr) return true;
  const datePart = isoOrDateStr.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return true;
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
}): SmartReportRecommendation[] {
  const { staff, fromDate, toDate, products = [], sales = [], imports = [] } = params;
  const resolvedScope = params.accessScope || evaluateStaffAccessScope(staff);
  const recommendations: SmartReportRecommendation[] = [];
  const allowed = resolvedScope.allowedReportCategories;

  const rangeSales = sales.filter((s) => isDateWithinRange(s.createdAt, fromDate, toDate));
  const rangeImports = imports.filter((i) => isDateWithinRange(i.createdAt, fromDate, toDate));

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
      'Nhân sự phụ trách kho nên xuất Báo cáo Tồn kho gửi cấp trên để phê duyệt kế hoạch nhập hàng kịp thời trước cao điểm mùa vụ.';
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
      'Xuất báo cáo chi tiết các mặt hàng bán chạy nhất trong kỳ để trình Quản lý điều chỉnh lượng hàng dự trữ và chính sách chiết khấu.';
    recommendations.push({
      id: 'rec_sales_performance',
      category: 'sales_log',
      targetCategory: 'sales_log',
      priority: 'medium',
      badgeLabel: 'Đề xuất Báo cáo Bán hàng cấp trên',
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
    const netCashflow = totalSalesPaid - totalImportPaid;
    const advice =
      'Thủ quỹ và Kế toán nên chốt sổ thu - chi theo khoảng ngày để báo cáo số dư quỹ thực tế và chuẩn bị nguồn tiền thanh toán các lô hàng sắp đến hạn.';
    recommendations.push({
      id: 'rec_cashflow_treasury',
      category: 'cashflow_treasury',
      targetCategory: 'cashflow_treasury',
      priority: 'medium',
      badgeLabel: 'Đề xuất Thủ quỹ & Kế toán Dòng tiền',
      title: 'Báo cáo Thu - Chi Dòng tiền Thực tế & Cân đối Quỹ Tiền mặt / Ngân hàng',
      summary: `Tổng dòng tiền thực thu từ bán hàng & thu nợ đạt ${formatVND(totalSalesPaid)}; tổng dòng tiền thực chi trả NCC là ${formatVND(totalImportPaid)}.`,
      suggestedAction: advice,
      actionAdvice: advice,
      metricHighlight: `Dòng tiền ròng: ${netCashflow >= 0 ? '+' : ''}${formatVND(netCashflow)}`,
    });
  }

  // 6. Exclusive Primary Manager Financial & Gross Profit Recommendation
  if (allowed.includes('financial_profit')) {
    const estimatedGrossProfit = rangeSales.reduce((sum, sale) => {
      const prod = products.find((p) => p.id === sale.productId);
      const cost = (prod ? prod.importPrice : sale.unitPrice * 0.85) * sale.quantity;
      return sum + (sale.totalAmount - cost);
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




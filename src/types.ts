export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export type UserRole = 'manager' | 'staff';

export type ProductCategory =
  | 'Phân bón'
  | 'Thuốc BVTV'
  | 'Hạt giống'
  | 'Chế phẩm sinh học'
  | 'Vật tư & Dụng cụ'
  | string;

export type CustomerGroup =
  | 'Nhà nông'
  | 'Đại lý cấp 2'
  | 'Trang trại'
  | 'Khách lẻ'
  | string;

export type PaymentStatus = 'paid' | 'partial' | 'unpaid';

export type StockAlertLevel = 'out_of_stock' | 'low_stock' | 'normal';

export type DebtUrgencyLevel = 'settled' | 'overdue' | 'due_soon' | 'upcoming';

export interface ProductItem {
  id: string;
  code: string;
  name: string;
  category: ProductCategory;
  unit: string;
  importPrice: number;
  sellPrice: number;
  stock: number;
  minStock: number;
  supplierName: string;
  warehouseName?: string;
  batchNumber?: string;
  expiryDate?: string;
  barcode?: string;
  dosageGuide?: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerProfile {
  id: string;
  code: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  group: CustomerGroup;
  note: string;
  totalPurchased: number;
  totalDebt: number;
  warehouseName?: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export type SalePromotionType = 'none' | 'gift' | 'discount' | 'both';

export interface SaleTransaction {
  id: string;
  invoiceCode: string;
  invoiceGroupId?: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  unitCost?: number;
  totalAmount: number;
  paidAmount: number;
  debtAmount: number;
  dueDate: string;
  status: PaymentStatus;
  warehouseName?: string;
  promotionType?: SalePromotionType;
  discountAmount?: number;
  discountPercent?: number;
  giftProductId?: string;
  giftProductName?: string;
  giftUnit?: string;
  giftQuantity?: number;
  giftUnitCost?: number;
  dosageGuide?: string;
  note: string;
  staffName: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface VietQrBankConfig {
  bankCode: string;
  bankBin?: string;
  accountNumber: string;
  accountName: string;
  template?: 'compact' | 'compact2' | 'qr_only' | 'print';
  updatedAt?: string;
}

export interface ProductNoteTemplate {
  id: string;
  title: string;
  content: string;
  category?: string;
  updatedAt: string;
}

export interface ImportTransaction {
  id: string;
  receiptCode: string;
  supplierName: string;
  supplierPhone: string;
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  paidAmount: number;
  debtAmount: number;
  dueDate: string;
  status: PaymentStatus;
  warehouseName?: string;
  batchNumber?: string;
  expiryDate?: string;
  note: string;
  staffName: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationPrefs {
  uid: string;
  debtCustomerEnabled: boolean;
  debtSupplierEnabled: boolean;
  lowStockEnabled: boolean;
  periodicReportEnabled: boolean;
  browserPushEnabled: boolean;
  leadDays: number;
  updatedAt: string;
}

export type NotificationCategory =
  | 'customer_debt'
  | 'supplier_debt'
  | 'low_stock'
  | 'periodic_report';

export interface AppNotification {
  id: string;
  category: NotificationCategory;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  actionTab?:
    | 'sales'
    | 'imports'
    | 'inventory'
    | 'debts'
    | 'customers'
    | 'receipt_vouchers'
    | 'payment_vouchers'
    | 'vouchers'
    | 'staff_accounts'
    | 'reports';
  relatedId?: string;
}

export interface FifoDebtAllocationItem {
  recordId: string;
  code: string;
  date: string;
  dueDate: string;
  productName: string;
  previousDebt: number;
  allocatedAmount: number;
  remainingDebt: number;
}

export interface CashReceiptVoucher {
  id: string;
  voucherCode: string;
  groupName: string;
  warehouseName: string;
  partnerId?: string;
  partnerName: string;
  partnerPhone: string;
  amount: number;
  paymentMethod: string;
  isDebtSettlement: boolean;
  settledAllocations?: FifoDebtAllocationItem[];
  totalPreviousDebt?: number;
  totalRemainingDebt?: number;
  countsTowardOtherIncome?: boolean;
  note: string;
  staffName: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CashPaymentVoucher {
  id: string;
  voucherCode: string;
  groupName: string;
  warehouseName: string;
  partnerName: string;
  partnerPhone: string;
  amount: number;
  paymentMethod: string;
  isDebtSettlement: boolean;
  settledAllocations?: FifoDebtAllocationItem[];
  totalPreviousDebt?: number;
  totalRemainingDebt?: number;
  countsTowardOperatingExpense?: boolean;
  note: string;
  staffName: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackupEntry {
  id: string;
  fileName: string;
  driveFileId: string;
  targetEmail: string;
  recordCount: number;
  auditLogCount?: number;
  status: 'completed' | 'failed';
  triggerType: 'auto_daily' | 'manual';
  ownerId: string;
  createdAt: string;
  snapshotPayload?: BackupSnapshotPayload;
}

export interface SupplierProfile {
  id: string;
  name: string;
  phone: string;
  address: string;
  note: string;
  warehouseName?: string;
  createdAt: string;
}

export type StaffPositionRole =
  | 'primary_manager'
  | 'deputy_general_manager'
  | 'warehouse_manager'
  | 'warehouse_accountant'
  | 'sales_accountant'
  | 'debt_accountant'
  | 'cash_bank_treasurer'
  | 'sales_warehouse_staff';

export type StaffFunctionalPermission =
  | 'create_staff_accounts'
  | 'manage_all_warehouses'
  | 'manage_single_warehouse'
  | 'warehouse_accounting'
  | 'sales_accounting'
  | 'customer_debt_accounting'
  | 'supplier_debt_accounting'
  | 'cash_treasurer'
  | 'bank_treasurer'
  | 'sales_and_invoicing'
  | 'import_and_supplier'
  | 'edit_delete_vouchers'
  | 'export_import_excel'
  | 'view_assigned_reports';

export type ReportModuleCategory =
  | 'overview'
  | 'sales_log'
  | 'imports_log'
  | 'inventory_stock'
  | 'customers_items'
  | 'debts_receivable_payable'
  | 'cashflow_treasury'
  | 'financial_profit';

export interface DeletedRecordTombstone {
  id: string;
  deletedAt: string;
}

export interface StaffMember {
  uid: string;
  username: string;
  password: string;
  displayName: string;
  email: string;
  phone: string;
  role: UserRole;
  positionRole?: StaffPositionRole;
  permissions?: StaffFunctionalPermission[];
  assignedWarehouse: string;
  /** Optional list of 2+ designated warehouses granted by Primary Admin (enables multi-warehouse & edit/delete rights). */
  assignedWarehouses?: string[];
  /** Explicit flag set ONLY by Primary Admin when granting multi-warehouse management (2+ warehouses or All). */
  multiWarehouseGrantedByAdmin?: boolean;
  /** Map of workspace owner UIDs readable/writable by a designated multi-warehouse manager in Firebase RTDB. */
  assignedOwnerUids?: Record<string, boolean>;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type SavedVoucherKind =
  | 'sale_invoice'
  | 'customer_receipt'
  | 'supplier_payment'
  | 'import_receipt';

export interface SavedVoucherRecord {
  id: string;
  voucherCode: string;
  voucherType: SavedVoucherKind;
  warehouseName: string;
  partnerName: string;
  partnerPhone: string;
  partnerAddress: string;
  refCode: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  totalOrPrevDebt: number;
  paidOrCollected: number;
  remainingDebt: number;
  dueDate: string;
  paymentMethod: string;
  note: string;
  staffName: string;
  createdAt: string;
  updatedAt: string;
}

export type AuditActionCategory =
  | 'delete_record'
  | 'edit_record'
  | 'create_record'
  | 'debt_settlement'
  | 'permission_change'
  | 'backup_restore'
  | 'auth_session';

export type AuditTargetEntity =
  | 'sale'
  | 'import'
  | 'product'
  | 'customer'
  | 'voucher'
  | 'staff'
  | 'backup'
  | 'system';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorUid: string;
  actorUsername: string;
  actorDisplayName: string;
  actorEmail: string;
  actorRoleLabel: string;
  warehouseName: string;
  category: AuditActionCategory;
  targetEntity: AuditTargetEntity;
  targetCode: string;
  actionTitle: string;
  details: string;
  /** JSON snapshot of deleted or modified record for evidence and 1-click restoration */
  snapshotData?: string;
  restoredAt?: string;
}

export interface StockAdjustmentRecord {
  id: string;
  adjustmentCode: string;
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  warehouseName: string;
  systemStockBefore: number;
  actualCountedStock: number;
  diffQty: number;
  unitCost: number;
  diffValue: number;
  reason: string;
  note: string;
  staffName: string;
  ownerId: string;
  createdAt: string;
  updatedAt?: string;
}

export interface BackupSnapshotPayload {
  version: string;
  exportedAt: string;
  exportedByEmail: string;
  fileName: string;
  recordCount: number;
  auditLogCount: number;
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
  stockAdjustments?: StockAdjustmentRecord[];
  savedVouchers: SavedVoucherRecord[];
  receiptVouchers?: CashReceiptVoucher[];
  paymentVouchers?: CashPaymentVoucher[];
  staffList: StaffMember[];
  auditLogs: AuditLogEntry[];
  missingCollections?: string[];
}




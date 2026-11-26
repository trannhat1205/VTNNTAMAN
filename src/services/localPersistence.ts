import {
  AuditLogEntry,
  BackupEntry,
  CashPaymentVoucher,
  CashReceiptVoucher,
  CustomerProfile,
  ImportTransaction,
  NotificationPrefs,
  ProductItem,
  SaleTransaction,
  SavedVoucherRecord,
  StaffMember,
  StockAdjustmentRecord,
  SupplierProfile,
  VietQrBankConfig,
} from '../types';
import {
  ADMIN_BACKUP_EMAIL,
  ADMIN_PRIMARY_PHONE,
  DEFAULT_NOTIFICATION_PREFS,
  INITIAL_CUSTOMER_GROUPS,
  INITIAL_PAYMENT_GROUPS,
  INITIAL_PRODUCT_CATEGORIES,
  INITIAL_RECEIPT_GROUPS,
  INITIAL_WAREHOUSES,
  PRIMARY_ADMIN_UID,
  PRODUCTION_PRIMARY_ADMIN,
} from '../data/seedData';
import { isHashedPassword } from '../utils/authSecurity';

export const WORKSPACE_STORAGE_KEY = 'vtnn_taman_workspace_v2';
const LEGACY_STAFF_STORAGE_KEY = 'vtnn_taman_staff_realtime_v1';

export interface WorkspacePersistedState {
  version: number;
  products: ProductItem[];
  customers: CustomerProfile[];
  suppliers: SupplierProfile[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  stockAdjustments?: StockAdjustmentRecord[];
  receiptVouchers: CashReceiptVoucher[];
  paymentVouchers: CashPaymentVoucher[];
  savedVouchers: SavedVoucherRecord[];
  backups: BackupEntry[];
  auditLogs: AuditLogEntry[];
  warehouses: string[];
  customerGroups: string[];
  productCategories: string[];
  receiptGroups: string[];
  paymentGroups: string[];
  staffList: StaffMember[];
  notificationPrefs: NotificationPrefs;
  bankQrConfig?: VietQrBankConfig;
  autoDailyBackupEnabled: boolean;
}

export function createEmptyWorkspaceState(): WorkspacePersistedState {
  return {
    version: 2,
    products: [],
    customers: [],
    suppliers: [],
    sales: [],
    imports: [],
    stockAdjustments: [],
    receiptVouchers: [],
    paymentVouchers: [],
    savedVouchers: [],
    backups: [],
    auditLogs: [],
    warehouses: [...INITIAL_WAREHOUSES],
    customerGroups: [...INITIAL_CUSTOMER_GROUPS],
    productCategories: [...INITIAL_PRODUCT_CATEGORIES],
    receiptGroups: [...INITIAL_RECEIPT_GROUPS],
    paymentGroups: [...INITIAL_PAYMENT_GROUPS],
    staffList: [{ ...PRODUCTION_PRIMARY_ADMIN }],
    notificationPrefs: { ...DEFAULT_NOTIFICATION_PREFS },
    autoDailyBackupEnabled: true,
  };
}

export function sanitizeStaffListForStorage(staffList: StaffMember[]): StaffMember[] {
  const seen = new Set<string>();
  const sanitized: StaffMember[] = [];

  for (const raw of staffList) {
    if (!raw || !raw.uid || seen.has(raw.uid)) continue;
    seen.add(raw.uid);

    const isPrimary =
      raw.uid === PRIMARY_ADMIN_UID ||
      raw.email?.toLowerCase() === ADMIN_BACKUP_EMAIL.toLowerCase();

    const safePassword = isHashedPassword(raw.password) ? raw.password : '';

    if (isPrimary) {
      sanitized.push({
        ...PRODUCTION_PRIMARY_ADMIN,
        ...raw,
        uid: PRIMARY_ADMIN_UID,
        username: raw.username || 'admin',
        email: ADMIN_BACKUP_EMAIL,
        phone: raw.phone || ADMIN_PRIMARY_PHONE,
        role: 'manager',
        positionRole: 'primary_manager',
        permissions: PRODUCTION_PRIMARY_ADMIN.permissions,
        assignedWarehouse: 'Tất cả kho',
        password: safePassword,
        active: true,
      });
    } else {
      sanitized.push({
        ...raw,
        password: safePassword,
      });
    }
  }

  if (!sanitized.some((s) => s.uid === PRIMARY_ADMIN_UID)) {
    sanitized.unshift({ ...PRODUCTION_PRIMARY_ADMIN });
  }

  return sanitized;
}

export function loadWorkspaceFromStorage(): WorkspacePersistedState {
  const defaults = createEmptyWorkspaceState();
  if (typeof window === 'undefined' || !window.localStorage) {
    return defaults;
  }

  try {
    // Remove legacy staff storage key that previously held plaintext passwords
    if (window.localStorage.getItem(LEGACY_STAFF_STORAGE_KEY)) {
      window.localStorage.removeItem(LEGACY_STAFF_STORAGE_KEY);
    }

    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) {
      return defaults;
    }

    const parsed = JSON.parse(raw) as Partial<WorkspacePersistedState>;
    if (!parsed || typeof parsed !== 'object') {
      return defaults;
    }

    return {
      version: 2,
      products: Array.isArray(parsed.products) ? parsed.products : [],
      customers: Array.isArray(parsed.customers) ? parsed.customers : [],
      suppliers: Array.isArray(parsed.suppliers) ? parsed.suppliers : [],
      sales: Array.isArray(parsed.sales) ? parsed.sales : [],
      imports: Array.isArray(parsed.imports) ? parsed.imports : [],
      stockAdjustments: Array.isArray(parsed.stockAdjustments) ? parsed.stockAdjustments : [],
      receiptVouchers: Array.isArray(parsed.receiptVouchers) ? parsed.receiptVouchers : [],
      paymentVouchers: Array.isArray(parsed.paymentVouchers) ? parsed.paymentVouchers : [],
      savedVouchers: Array.isArray(parsed.savedVouchers) ? parsed.savedVouchers : [],
      backups: Array.isArray(parsed.backups) ? parsed.backups : [],
      auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs : [],
      warehouses:
        Array.isArray(parsed.warehouses) && parsed.warehouses.length > 0
          ? parsed.warehouses
          : defaults.warehouses,
      customerGroups:
        Array.isArray(parsed.customerGroups) && parsed.customerGroups.length > 0
          ? parsed.customerGroups
          : defaults.customerGroups,
      productCategories:
        Array.isArray(parsed.productCategories) && parsed.productCategories.length > 0
          ? parsed.productCategories
          : defaults.productCategories,
      receiptGroups:
        Array.isArray(parsed.receiptGroups) && parsed.receiptGroups.length > 0
          ? parsed.receiptGroups
          : defaults.receiptGroups,
      paymentGroups:
        Array.isArray(parsed.paymentGroups) && parsed.paymentGroups.length > 0
          ? parsed.paymentGroups
          : defaults.paymentGroups,
      staffList:
        Array.isArray(parsed.staffList) && parsed.staffList.length > 0
          ? sanitizeStaffListForStorage(parsed.staffList)
          : defaults.staffList,
      notificationPrefs:
        parsed.notificationPrefs && typeof parsed.notificationPrefs === 'object'
          ? { ...defaults.notificationPrefs, ...parsed.notificationPrefs }
          : defaults.notificationPrefs,
      autoDailyBackupEnabled:
        typeof parsed.autoDailyBackupEnabled === 'boolean'
          ? parsed.autoDailyBackupEnabled
          : true,
    };
  } catch {
    return defaults;
  }
}

export function saveWorkspaceToStorage(state: WorkspacePersistedState): {
  ok: boolean;
  trimmedBackups?: boolean;
} {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ok: false };
  }

  const sanitizedState: WorkspacePersistedState = {
    ...state,
    version: 2,
    staffList: sanitizeStaffListForStorage(state.staffList),
  };

  try {
    const json = JSON.stringify(sanitizedState);
    if (window.localStorage.getItem(WORKSPACE_STORAGE_KEY) !== json) {
      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, json);
    }
    return { ok: true };
  } catch {
    // Handle QuotaExceededError by omitting inline backup snapshot payloads
    try {
      const compactBackups = sanitizedState.backups.slice(0, 20).map((bk) => ({
        ...bk,
        snapshotPayload: undefined,
      }));
      const compactState: WorkspacePersistedState = {
        ...sanitizedState,
        backups: compactBackups,
        auditLogs: sanitizedState.auditLogs.slice(0, 300),
      };
      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(compactState));
      return { ok: true, trimmedBackups: true };
    } catch {
      return { ok: false };
    }
  }
}

export function mergeRecordsById<T extends { id: string; updatedAt?: string }>(
  localItems: T[],
  cloudItems: T[]
): T[] {
  const map = new Map<string, T>();
  for (const item of localItems) {
    if (item && item.id) {
      map.set(item.id, item);
    }
  }
  for (const cloud of cloudItems) {
    if (!cloud || !cloud.id) continue;
    const local = map.get(cloud.id);
    if (!local) {
      map.set(cloud.id, cloud);
    } else {
      const localTime = local.updatedAt ? Date.parse(local.updatedAt) : 0;
      const cloudTime = cloud.updatedAt ? Date.parse(cloud.updatedAt) : 0;
      if (!Number.isNaN(cloudTime) && cloudTime >= (Number.isNaN(localTime) ? 0 : localTime)) {
        // Cloud is newer or equal: preserve local-only extension fields (e.g. warehouseName, promo metadata)
        map.set(cloud.id, { ...local, ...cloud });
      }
    }
  }
  return Array.from(map.values());
}

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
  SupplierProfile,
} from '../types';
import {
  INITIAL_CUSTOMER_GROUPS,
  INITIAL_PAYMENT_GROUPS,
  INITIAL_PRODUCT_CATEGORIES,
  INITIAL_RECEIPT_GROUPS,
  INITIAL_WAREHOUSES,
  PRIMARY_ADMIN_UID,
} from '../data/seedData';
import { canAccountCreateStaff, getDefaultPermissionsForPosition } from './businessLogic';

export interface RtdbWorkspaceMeta {
  ownerUid: string;
  ownerEmail: string;
  ownerDisplayName: string;
  assignedWarehouse: string;
  updatedAt: string;
  updatedByUid: string;
  schemaVersion: number;
}

export interface RtdbWorkspaceSettings {
  warehouses: string[];
  customerGroups: string[];
  productCategories: string[];
  receiptGroups: string[];
  paymentGroups: string[];
  notificationPrefs: NotificationPrefs;
  autoDailyBackupEnabled: boolean;
}

export interface RtdbWorkspacePayload {
  meta: RtdbWorkspaceMeta;
  products: ProductItem[];
  customers: CustomerProfile[];
  suppliers: SupplierProfile[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  receiptVouchers: CashReceiptVoucher[];
  paymentVouchers: CashPaymentVoucher[];
  savedVouchers: SavedVoucherRecord[];
  auditLogs: AuditLogEntry[];
  backups: BackupEntry[];
  settings: RtdbWorkspaceSettings;
}

export interface RtdbUserDirectoryProfile {
  uid: string;
  username: string;
  displayName: string;
  phone: string;
  email: string;
  role: 'manager' | 'staff';
  positionRole: StaffMember['positionRole'];
  permissions: StaffMember['permissions'];
  assignedWarehouse: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastSyncedAt?: string;
}

export interface AdminWarehouseAccountSummary {
  uid: string;
  displayName: string;
  username: string;
  email: string;
  phone: string;
  assignedWarehouse: string;
  roleLabel: string;
  isPrimaryAdmin: boolean;
  active: boolean;
  productsCount: number;
  customersCount: number;
  salesCount: number;
  salesRevenue: number;
  customerDebtTotal: number;
  importsCount: number;
  importsCost: number;
  supplierDebtTotal: number;
  receiptVouchersCount: number;
  paymentVouchersCount: number;
  savedVouchersCount: number;
  lastSyncedAt: string;
}

const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  uid: PRIMARY_ADMIN_UID,
  debtCustomerEnabled: true,
  debtSupplierEnabled: true,
  lowStockEnabled: true,
  periodicReportEnabled: true,
  browserPushEnabled: false,
  leadDays: 3,
  updatedAt: '',
};

/**
 * Recursively strips `undefined`, `NaN`, `Infinity`, and functions before calling Firebase RTDB `set()`.
 * Firebase RTDB throws a fatal error if any nested property value is `undefined`.
 */
export function sanitizeForRealtimeDb<T>(value: T): T {
  if (value === null || value === undefined) {
    return null as unknown as T;
  }
  if (typeof value === 'number') {
    return (Number.isFinite(value) ? value : 0) as unknown as T;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined && typeof item !== 'function')
      .map((item) => sanitizeForRealtimeDb(item)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined || typeof v === 'function' || typeof v === 'symbol') {
        continue;
      }
      out[k] = sanitizeForRealtimeDb(v);
    }
    return out as T;
  }
  return value;
}

export function ensureArrayFromRtdb<T>(raw: unknown): T[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter((item): item is T => item !== null && item !== undefined);
  }
  if (typeof raw === 'object') {
    return Object.values(raw as Record<string, unknown>).filter(
      (item): item is T => item !== null && item !== undefined
    );
  }
  return [];
}

export function toRtdbUserDirectoryProfile(
  staff: StaffMember,
  nowIso = new Date().toISOString()
): RtdbUserDirectoryProfile {
  return sanitizeForRealtimeDb({
    uid: staff.uid,
    username: staff.username || '',
    displayName: staff.displayName || staff.username || 'Thành viên VTNN Tâm An',
    phone: staff.phone || '',
    email: (staff.email || '').toLowerCase(),
    role: staff.role || 'staff',
    positionRole:
      staff.positionRole || (canAccountCreateStaff(staff) ? 'primary_manager' : 'warehouse_manager'),
    permissions:
      staff.permissions ||
      getDefaultPermissionsForPosition(staff.positionRole || 'warehouse_manager'),
    assignedWarehouse: staff.assignedWarehouse || 'Tâm An Mỹ Ngãi',
    active: staff.active !== false,
    createdAt: staff.createdAt || nowIso,
    updatedAt: staff.updatedAt || nowIso,
    lastSyncedAt: nowIso,
  });
}

export function mergeDirectoryIntoStaffList(
  localStaff: StaffMember[],
  directoryUsers: RtdbUserDirectoryProfile[]
): StaffMember[] {
  const byUid = new Map<string, StaffMember>();
  for (const st of localStaff) {
    byUid.set(st.uid, st);
  }

  for (const dir of directoryUsers) {
    if (!dir || !dir.uid) continue;
    const prev = byUid.get(dir.uid);
    byUid.set(dir.uid, {
      uid: dir.uid,
      username: dir.username || prev?.username || `user_${dir.uid.slice(0, 6)}`,
      password: prev?.password || '', // Preserve local hash only; never overwrite from directory
      displayName: dir.displayName || prev?.displayName || 'Thành viên VTNN Tâm An',
      phone: dir.phone ?? prev?.phone ?? '',
      email: dir.email || prev?.email || '',
      role: dir.role || prev?.role || 'staff',
      positionRole: dir.positionRole || prev?.positionRole || 'warehouse_manager',
      permissions: dir.permissions || prev?.permissions,
      assignedWarehouse: dir.assignedWarehouse || prev?.assignedWarehouse || 'Tâm An Mỹ Ngãi',
      active: dir.active !== undefined ? dir.active : prev?.active ?? true,
      createdAt: dir.createdAt || prev?.createdAt || new Date().toISOString(),
      updatedAt: dir.updatedAt || prev?.updatedAt || new Date().toISOString(),
    });
  }

  return Array.from(byUid.values());
}

function attachOwnerId<T extends object>(items: T[], ownerUid: string): T[] {
  return items.map((item) => {
    const rec = item as T & { ownerId?: string };
    return rec.ownerId ? item : ({ ...item, ownerId: ownerUid } as T);
  });
}

export function normalizeWorkspaceFromRtdb(raw: unknown, ownerUid: string): RtdbWorkspacePayload {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rawMeta =
    obj.meta && typeof obj.meta === 'object' ? (obj.meta as Record<string, unknown>) : {};
  const rawSettings =
    obj.settings && typeof obj.settings === 'object'
      ? (obj.settings as Record<string, unknown>)
      : {};

  const warehouses = ensureArrayFromRtdb<string>(rawSettings.warehouses);
  const customerGroups = ensureArrayFromRtdb<string>(rawSettings.customerGroups);
  const productCategories = ensureArrayFromRtdb<string>(rawSettings.productCategories);
  const receiptGroups = ensureArrayFromRtdb<string>(rawSettings.receiptGroups);
  const paymentGroups = ensureArrayFromRtdb<string>(rawSettings.paymentGroups);
  const rawPrefs =
    rawSettings.notificationPrefs && typeof rawSettings.notificationPrefs === 'object'
      ? (rawSettings.notificationPrefs as Partial<NotificationPrefs>)
      : {};

  return {
    meta: {
      ownerUid: String(rawMeta.ownerUid || ownerUid),
      ownerEmail: String(rawMeta.ownerEmail || ''),
      ownerDisplayName: String(rawMeta.ownerDisplayName || ''),
      assignedWarehouse: String(rawMeta.assignedWarehouse || ''),
      updatedAt: String(rawMeta.updatedAt || ''),
      updatedByUid: String(rawMeta.updatedByUid || ownerUid),
      schemaVersion: Number(rawMeta.schemaVersion) || 1,
    },
    products: attachOwnerId(ensureArrayFromRtdb<ProductItem>(obj.products), ownerUid),
    customers: attachOwnerId(ensureArrayFromRtdb<CustomerProfile>(obj.customers), ownerUid),
    suppliers: attachOwnerId(ensureArrayFromRtdb<SupplierProfile>(obj.suppliers), ownerUid),
    sales: attachOwnerId(ensureArrayFromRtdb<SaleTransaction>(obj.sales), ownerUid),
    imports: attachOwnerId(ensureArrayFromRtdb<ImportTransaction>(obj.imports), ownerUid),
    receiptVouchers: attachOwnerId(
      ensureArrayFromRtdb<CashReceiptVoucher>(obj.receiptVouchers),
      ownerUid
    ),
    paymentVouchers: attachOwnerId(
      ensureArrayFromRtdb<CashPaymentVoucher>(obj.paymentVouchers),
      ownerUid
    ),
    savedVouchers: attachOwnerId(ensureArrayFromRtdb<SavedVoucherRecord>(obj.savedVouchers), ownerUid),
    auditLogs: ensureArrayFromRtdb<AuditLogEntry>(obj.auditLogs).slice(0, 500),
    backups: ensureArrayFromRtdb<BackupEntry>(obj.backups).map((b) => ({
      ...b,
      snapshotPayload: undefined,
    })),
    settings: {
      warehouses: warehouses.length > 0 ? warehouses : [...INITIAL_WAREHOUSES],
      customerGroups: customerGroups.length > 0 ? customerGroups : [...INITIAL_CUSTOMER_GROUPS],
      productCategories:
        productCategories.length > 0 ? productCategories : [...INITIAL_PRODUCT_CATEGORIES],
      receiptGroups: receiptGroups.length > 0 ? receiptGroups : [...INITIAL_RECEIPT_GROUPS],
      paymentGroups: paymentGroups.length > 0 ? paymentGroups : [...INITIAL_PAYMENT_GROUPS],
      notificationPrefs: {
        ...DEFAULT_NOTIFICATION_PREFS,
        ...rawPrefs,
      },
      autoDailyBackupEnabled:
        typeof rawSettings.autoDailyBackupEnabled === 'boolean'
          ? rawSettings.autoDailyBackupEnabled
          : true,
    },
  };
}

/**
 * Strips volatile timestamp metadata and builds a deterministic fingerprint to avoid write echo loops.
 */
export function computeWorkspaceFingerprint(payload: RtdbWorkspacePayload): string {
  const comparable = {
    ownerUid: payload.meta.ownerUid,
    assignedWarehouse: payload.meta.assignedWarehouse,
    products: payload.products,
    customers: payload.customers,
    suppliers: payload.suppliers,
    sales: payload.sales,
    imports: payload.imports,
    receiptVouchers: payload.receiptVouchers,
    paymentVouchers: payload.paymentVouchers,
    savedVouchers: payload.savedVouchers,
    auditLogs: payload.auditLogs.slice(0, 500),
    backups: payload.backups.map((b) => ({ ...b, snapshotPayload: undefined })),
    settings: payload.settings,
  };
  return JSON.stringify(sanitizeForRealtimeDb(comparable));
}

export function dedupeRecordsById<T extends { id: string; updatedAt?: string; createdAt?: string }>(
  records: T[]
): T[] {
  const map = new Map<string, T>();
  for (const item of records) {
    if (!item || !item.id) continue;
    const prev = map.get(item.id);
    if (!prev) {
      map.set(item.id, item);
    } else {
      const prevStamp = prev.updatedAt || prev.createdAt || '';
      const nextStamp = item.updatedAt || item.createdAt || '';
      if (nextStamp >= prevStamp) {
        map.set(item.id, item);
      }
    }
  }
  return Array.from(map.values());
}

/**
 * Aggregates every warehouse account's `/workspaces/{ownerUid}` and `/users_directory/{uid}`
 * into the Primary Admin's unified real-time state + per-account live monitor summaries.
 */
export function aggregateAdminWorkspacesFromRtdb(
  workspacesMap: Record<string, unknown>,
  usersDirectoryMap: Record<string, RtdbUserDirectoryProfile>
): {
  products: ProductItem[];
  customers: CustomerProfile[];
  suppliers: SupplierProfile[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  receiptVouchers: CashReceiptVoucher[];
  paymentVouchers: CashPaymentVoucher[];
  savedVouchers: SavedVoucherRecord[];
  auditLogs: AuditLogEntry[];
  backups: BackupEntry[];
  warehouses: string[];
  customerGroups: string[];
  productCategories: string[];
  receiptGroups: string[];
  paymentGroups: string[];
  adminSummaries: AdminWarehouseAccountSummary[];
  normalizedWorkspaces: Record<string, RtdbWorkspacePayload>;
} {
  const allProducts: ProductItem[] = [];
  const allCustomers: CustomerProfile[] = [];
  const allSuppliers: SupplierProfile[] = [];
  const allSales: SaleTransaction[] = [];
  const allImports: ImportTransaction[] = [];
  const allReceiptVouchers: CashReceiptVoucher[] = [];
  const allPaymentVouchers: CashPaymentVoucher[] = [];
  const allSavedVouchers: SavedVoucherRecord[] = [];
  const allAuditLogs: AuditLogEntry[] = [];
  const allBackups: BackupEntry[] = [];
  const warehouseSet = new Set<string>(INITIAL_WAREHOUSES);
  const custGroupSet = new Set<string>(INITIAL_CUSTOMER_GROUPS);
  const prodCatSet = new Set<string>(INITIAL_PRODUCT_CATEGORIES);
  const recGroupSet = new Set<string>(INITIAL_RECEIPT_GROUPS);
  const payGroupSet = new Set<string>(INITIAL_PAYMENT_GROUPS);

  const normalizedWorkspaces: Record<string, RtdbWorkspacePayload> = {};
  const ownerUids = new Set<string>([
    ...Object.keys(workspacesMap || {}),
    ...Object.keys(usersDirectoryMap || {}),
  ]);

  for (const ownerUid of ownerUids) {
    const rawWs = workspacesMap?.[ownerUid];
    if (!rawWs) continue;
    const norm = normalizeWorkspaceFromRtdb(rawWs, ownerUid);
    normalizedWorkspaces[ownerUid] = norm;

    allProducts.push(...norm.products);
    allCustomers.push(...norm.customers);
    allSuppliers.push(...norm.suppliers);
    allSales.push(...norm.sales);
    allImports.push(...norm.imports);
    allReceiptVouchers.push(...norm.receiptVouchers);
    allPaymentVouchers.push(...norm.paymentVouchers);
    allSavedVouchers.push(...norm.savedVouchers);
    allAuditLogs.push(...norm.auditLogs);
    allBackups.push(...norm.backups);

    norm.settings.warehouses.forEach((w) => {
      if (w && w !== 'Tất cả kho') warehouseSet.add(w);
    });
    if (norm.meta.assignedWarehouse && norm.meta.assignedWarehouse !== 'Tất cả kho') {
      warehouseSet.add(norm.meta.assignedWarehouse);
    }
    norm.settings.customerGroups.forEach((g) => g && custGroupSet.add(g));
    norm.settings.productCategories.forEach((c) => c && prodCatSet.add(c));
    norm.settings.receiptGroups.forEach((g) => g && recGroupSet.add(g));
    norm.settings.paymentGroups.forEach((g) => g && payGroupSet.add(g));
  }

  for (const user of Object.values(usersDirectoryMap || {})) {
    if (user?.assignedWarehouse && user.assignedWarehouse !== 'Tất cả kho') {
      warehouseSet.add(user.assignedWarehouse);
    }
  }

  const adminSummaries: AdminWarehouseAccountSummary[] = Array.from(ownerUids)
    .map((uid) => {
      const dir = usersDirectoryMap?.[uid];
      const ws = normalizedWorkspaces[uid];
      const assignedWh = dir?.assignedWarehouse || ws?.meta.assignedWarehouse || 'Chưa phân kho';
      const isPrimary =
        uid === PRIMARY_ADMIN_UID ||
        dir?.positionRole === 'primary_manager' ||
        assignedWh === 'Tất cả kho';

      const salesArr = ws?.sales || [];
      const impArr = ws?.imports || [];

      return {
        uid,
        displayName: dir?.displayName || ws?.meta.ownerDisplayName || 'Tài khoản kho',
        username: dir?.username || uid.slice(0, 8),
        email: dir?.email || ws?.meta.ownerEmail || '',
        phone: dir?.phone || '',
        assignedWarehouse: assignedWh,
        roleLabel: isPrimary
          ? 'Quản lý chính (Admin)'
          : dir?.role === 'manager'
          ? 'Quản lý kho'
          : 'Nhân viên kho',
        isPrimaryAdmin: isPrimary,
        active: dir?.active !== false,
        productsCount: ws?.products.length || 0,
        customersCount: ws?.customers.length || 0,
        salesCount: salesArr.length,
        salesRevenue: salesArr.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0),
        customerDebtTotal: salesArr.reduce((s, r) => s + (Number(r.debtAmount) || 0), 0),
        importsCount: impArr.length,
        importsCost: impArr.reduce((s, r) => s + (Number(r.totalCost) || 0), 0),
        supplierDebtTotal: impArr.reduce((s, r) => s + (Number(r.debtAmount) || 0), 0),
        receiptVouchersCount: ws?.receiptVouchers.length || 0,
        paymentVouchersCount: ws?.paymentVouchers.length || 0,
        savedVouchersCount: ws?.savedVouchers.length || 0,
        lastSyncedAt: ws?.meta.updatedAt || dir?.lastSyncedAt || dir?.updatedAt || '',
      };
    })
    .sort((a, b) => {
      if (a.isPrimaryAdmin !== b.isPrimaryAdmin) return a.isPrimaryAdmin ? -1 : 1;
      return b.salesRevenue + b.productsCount - (a.salesRevenue + a.productsCount);
    });

  const sortedAuditLogs = dedupeRecordsById(allAuditLogs).sort((a, b) =>
    (b.timestamp || '').localeCompare(a.timestamp || '')
  );

  return {
    products: dedupeRecordsById(allProducts),
    customers: dedupeRecordsById(allCustomers),
    suppliers: dedupeRecordsById(allSuppliers),
    sales: dedupeRecordsById(allSales),
    imports: dedupeRecordsById(allImports),
    receiptVouchers: dedupeRecordsById(allReceiptVouchers),
    paymentVouchers: dedupeRecordsById(allPaymentVouchers),
    savedVouchers: dedupeRecordsById(allSavedVouchers),
    auditLogs: sortedAuditLogs,
    backups: dedupeRecordsById(allBackups),
    warehouses: Array.from(warehouseSet),
    customerGroups: Array.from(custGroupSet),
    productCategories: Array.from(prodCatSet),
    receiptGroups: Array.from(recGroupSet),
    paymentGroups: Array.from(payGroupSet),
    adminSummaries,
    normalizedWorkspaces,
  };
}

/**
 * Partitions the Primary Admin's unified in-memory state back into per-owner `/workspaces/{ownerUid}` payloads
 * so Admin edits/creates/deletes always land cleanly on the respective warehouse account's RTDB node.
 */
export function partitionAdminStateByWorkspace(params: {
  products: ProductItem[];
  customers: CustomerProfile[];
  suppliers: SupplierProfile[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  receiptVouchers: CashReceiptVoucher[];
  paymentVouchers: CashPaymentVoucher[];
  savedVouchers: SavedVoucherRecord[];
  auditLogs: AuditLogEntry[];
  backups: BackupEntry[];
  settings: RtdbWorkspaceSettings;
  staffList: StaffMember[];
  knownOwnerUids: string[];
  adminUid: string;
  nowIso: string;
}): Record<string, RtdbWorkspacePayload> {
  const {
    products,
    customers,
    suppliers,
    sales,
    imports,
    receiptVouchers,
    paymentVouchers,
    savedVouchers,
    auditLogs,
    backups,
    settings,
    staffList,
    knownOwnerUids,
    adminUid,
    nowIso,
  } = params;

  const ownerByWarehouse = new Map<string, string>();
  const staffByUid = new Map<string, StaffMember>();
  for (const st of staffList) {
    staffByUid.set(st.uid, st);
    if (st.assignedWarehouse && st.assignedWarehouse !== 'Tất cả kho' && !ownerByWarehouse.has(st.assignedWarehouse)) {
      ownerByWarehouse.set(st.assignedWarehouse, st.uid);
    }
  }

  const resolveOwner = (record: { ownerId?: string; warehouseName?: string; actorUid?: string }): string => {
    if (record.ownerId && record.ownerId.trim()) return record.ownerId.trim();
    if (record.actorUid && record.actorUid.trim()) return record.actorUid.trim();
    if (record.warehouseName && ownerByWarehouse.has(record.warehouseName)) {
      return ownerByWarehouse.get(record.warehouseName) || adminUid;
    }
    return adminUid;
  };

  const buckets = new Map<string, RtdbWorkspacePayload>();
  const ensureBucket = (uid: string): RtdbWorkspacePayload => {
    const existing = buckets.get(uid);
    if (existing) return existing;
    const ownerStaff = staffByUid.get(uid);
    const created: RtdbWorkspacePayload = {
      meta: {
        ownerUid: uid,
        ownerEmail: ownerStaff?.email || '',
        ownerDisplayName: ownerStaff?.displayName || '',
        assignedWarehouse:
          ownerStaff?.assignedWarehouse || (uid === adminUid ? 'Tất cả kho' : ''),
        updatedAt: nowIso,
        updatedByUid: adminUid,
        schemaVersion: 1,
      },
      products: [],
      customers: [],
      suppliers: [],
      sales: [],
      imports: [],
      receiptVouchers: [],
      paymentVouchers: [],
      savedVouchers: [],
      auditLogs: [],
      backups: [],
      settings: {
        ...settings,
        warehouses:
          ownerStaff?.assignedWarehouse && ownerStaff.assignedWarehouse !== 'Tất cả kho'
            ? Array.from(new Set([ownerStaff.assignedWarehouse]))
            : settings.warehouses,
      },
    };
    buckets.set(uid, created);
    return created;
  };

  knownOwnerUids.forEach((uid) => {
    if (uid) ensureBucket(uid);
  });
  ensureBucket(adminUid);

  products.forEach((item) => ensureBucket(resolveOwner(item)).products.push(item));
  customers.forEach((item) => ensureBucket(resolveOwner(item)).customers.push(item));
  suppliers.forEach((item) => ensureBucket(resolveOwner(item)).suppliers.push(item));
  sales.forEach((item) => ensureBucket(resolveOwner(item)).sales.push(item));
  imports.forEach((item) => ensureBucket(resolveOwner(item)).imports.push(item));
  receiptVouchers.forEach((item) => ensureBucket(resolveOwner(item)).receiptVouchers.push(item));
  paymentVouchers.forEach((item) => ensureBucket(resolveOwner(item)).paymentVouchers.push(item));
  savedVouchers.forEach((item) => ensureBucket(resolveOwner(item)).savedVouchers.push(item));
  auditLogs.slice(0, 500).forEach((item) => ensureBucket(resolveOwner(item)).auditLogs.push(item));
  backups.forEach((item) =>
    ensureBucket(adminUid).backups.push({ ...item, snapshotPayload: undefined })
  );

  const out: Record<string, RtdbWorkspacePayload> = {};
  buckets.forEach((val, key) => {
    out[key] = sanitizeForRealtimeDb(val);
  });
  return out;
}

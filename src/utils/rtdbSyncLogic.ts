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
} from '../types';
import {
  ADMIN_BACKUP_EMAIL,
  ADMIN_PRIMARY_PHONE,
  INITIAL_CUSTOMER_GROUPS,
  INITIAL_PAYMENT_GROUPS,
  INITIAL_PRODUCT_CATEGORIES,
  INITIAL_RECEIPT_GROUPS,
  INITIAL_WAREHOUSES,
  PRIMARY_ADMIN_UID,
  PRODUCTION_PRIMARY_ADMIN,
} from '../data/seedData';
import {
  canAccountCreateStaff,
  formatDefaultWarehouseNameFromGmail,
  getDefaultPermissionsForPosition,
  getIndependentWarehouseFullPermissions,
} from './businessLogic';

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
  stockAdjustments?: StockAdjustmentRecord[];
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

/**
 * Ensures any self-registered independent Gmail/Google warehouse account always retains
 * full single-warehouse permissions (including Inventory & Warehouse management) and a valid
 * `TÂM AN ...` warehouse name — recovering cleanly even if legacy Firestore seeding overwrote it.
 */
export function normalizeIndependentWarehouseStaffMember(staff: StaffMember): StaffMember {
  if (!staff || !staff.uid) return staff;
  if (staff.uid === PRIMARY_ADMIN_UID) {
    const wasOverwrittenByPreview = Boolean(staff.username && staff.username !== 'admin');
    return {
      ...PRODUCTION_PRIMARY_ADMIN,
      ...staff,
      uid: PRIMARY_ADMIN_UID,
      username: 'admin',
      displayName: wasOverwrittenByPreview
        ? PRODUCTION_PRIMARY_ADMIN.displayName
        : staff.displayName || PRODUCTION_PRIMARY_ADMIN.displayName,
      email: ADMIN_BACKUP_EMAIL,
      phone: staff.phone || ADMIN_PRIMARY_PHONE,
      role: 'manager',
      positionRole: 'primary_manager',
      permissions: getDefaultPermissionsForPosition('primary_manager'),
      assignedWarehouse: 'Tất cả kho',
      active: true,
    };
  }
  if (canAccountCreateStaff(staff)) {
    return staff;
  }

  const isInternalAdminCreated = staff.uid.startsWith('staff_');
  const rawWh = (staff.assignedWarehouse || '').trim();
  const hasInvalidLegacyWh =
    !rawWh ||
    rawWh === 'Kho VTNN Tâm An' ||
    rawWh === 'VTNN Tâm An' ||
    rawWh === 'Tất cả kho';

  if (isInternalAdminCreated) {
    return staff;
  }

  const fixedWarehouse = hasInvalidLegacyWh
    ? formatDefaultWarehouseNameFromGmail(staff.email || staff.username || '')
    : rawWh;

  const existingPerms = staff.permissions || [];
  const hasFullWarehousePerms =
    existingPerms.includes('manage_single_warehouse') &&
    existingPerms.includes('warehouse_accounting') &&
    existingPerms.includes('edit_delete_vouchers');

  return {
    ...staff,
    role: 'manager',
    positionRole: 'warehouse_manager',
    permissions: hasFullWarehousePerms
      ? existingPerms
      : getIndependentWarehouseFullPermissions(),
    assignedWarehouse: fixedWarehouse,
  };
}

export function toRtdbUserDirectoryProfile(
  staff: StaffMember,
  nowIso = new Date().toISOString()
): RtdbUserDirectoryProfile {
  const normalized = normalizeIndependentWarehouseStaffMember(staff);
  return sanitizeForRealtimeDb({
    uid: normalized.uid,
    username: normalized.username || '',
    displayName: normalized.displayName || normalized.username || 'Thành viên VTNN Tâm An',
    phone: normalized.phone || '',
    email: (normalized.email || '').toLowerCase(),
    role: normalized.role || 'staff',
    positionRole:
      normalized.positionRole ||
      (canAccountCreateStaff(normalized) ? 'primary_manager' : 'warehouse_manager'),
    permissions:
      normalized.permissions ||
      getDefaultPermissionsForPosition(normalized.positionRole || 'warehouse_manager'),
    assignedWarehouse: normalized.assignedWarehouse || 'Tâm An Mỹ Ngãi',
    active: normalized.active !== false,
    createdAt: normalized.createdAt || nowIso,
    updatedAt: normalized.updatedAt || nowIso,
    lastSyncedAt: nowIso,
  });
}

export function mergeDirectoryIntoStaffList(
  localStaff: StaffMember[],
  directoryUsers: RtdbUserDirectoryProfile[]
): StaffMember[] {
  const byUid = new Map<string, StaffMember>();
  for (const st of localStaff) {
    byUid.set(st.uid, normalizeIndependentWarehouseStaffMember(st));
  }

  for (const dir of directoryUsers) {
    if (!dir || !dir.uid) continue;
    const prev = byUid.get(dir.uid);
    const merged = normalizeIndependentWarehouseStaffMember({
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
    byUid.set(dir.uid, merged);
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
    stockAdjustments: attachOwnerId(
      ensureArrayFromRtdb<StockAdjustmentRecord>(obj.stockAdjustments),
      ownerUid
    ),
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
    stockAdjustments: payload.stockAdjustments || [],
    auditLogs: payload.auditLogs.slice(0, 500),
    backups: payload.backups.map((b) => ({ ...b, snapshotPayload: undefined })),
    settings: payload.settings,
  };
  return JSON.stringify(sanitizeForRealtimeDb(comparable));
}

/**
 * Collections stored per-record under `/workspaces/{ownerUid}/{collection}/{recordKey}` so that
 * concurrent writes from multiple devices (or Admin + warehouse owner) merge per record
 * instead of overwriting the whole workspace (last-write-wins on the entire node).
 */
export const RTDB_RECORD_COLLECTIONS = [
  'products',
  'customers',
  'suppliers',
  'sales',
  'imports',
  'receiptVouchers',
  'paymentVouchers',
  'savedVouchers',
  'stockAdjustments',
  'auditLogs',
  'backups',
] as const;

export type RtdbRecordCollection = (typeof RTDB_RECORD_COLLECTIONS)[number];

/** Deterministic RTDB-safe record key. `k_` prefix guarantees RTDB never returns the node as an array. */
export function toRtdbRecordKey(id: string): string {
  return 'k_' + String(id || '').replace(/[.#$\[\]\/]/g, '_');
}

function prepareCollectionRecords(
  payload: RtdbWorkspacePayload,
  col: RtdbRecordCollection
): Array<{ id: string }> {
  const raw = (payload[col] || []) as unknown as Array<{ id: string }>;
  if (col === 'auditLogs') return raw.slice(0, 500);
  if (col === 'backups') {
    return (raw as unknown as BackupEntry[]).map((b) => ({ ...b, snapshotPayload: undefined }));
  }
  return raw;
}

export function toKeyedRecordMap<T extends { id: string }>(records: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const r of records || []) {
    if (!r || !r.id) continue;
    out[toRtdbRecordKey(r.id)] = sanitizeForRealtimeDb(r);
  }
  return out;
}

/** True when the raw RTDB workspace node still uses the legacy array layout for any collection. */
export function isLegacyArrayWorkspaceLayout(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  return RTDB_RECORD_COLLECTIONS.some((col) => Array.isArray(obj[col]));
}

/** Full keyed layout of a workspace (used for first write / one-time legacy array migration). */
export function buildFullKeyedWorkspace(payload: RtdbWorkspacePayload): Record<string, unknown> {
  const out: Record<string, unknown> = {
    meta: sanitizeForRealtimeDb(payload.meta),
    settings: sanitizeForRealtimeDb(payload.settings),
  };
  for (const col of RTDB_RECORD_COLLECTIONS) {
    out[col] = toKeyedRecordMap(prepareCollectionRecords(payload, col));
  }
  return out;
}

/**
 * Builds a multi-path update map (relative to `/workspaces/{ownerUid}`) containing ONLY the records
 * that were added, modified (`record`) or removed (`null`) between `prev` (last known server state)
 * and `next` (local state). `meta` is always written. Returns the full keyed layout when `prev` is null.
 */
export function buildWorkspaceDiffUpdates(
  prev: RtdbWorkspacePayload | null,
  next: RtdbWorkspacePayload
): Record<string, unknown> {
  if (!prev) return buildFullKeyedWorkspace(next);

  const updates: Record<string, unknown> = {
    meta: sanitizeForRealtimeDb(next.meta),
  };

  for (const col of RTDB_RECORD_COLLECTIONS) {
    const prevMap = toKeyedRecordMap(prepareCollectionRecords(prev, col));
    const nextMap = toKeyedRecordMap(prepareCollectionRecords(next, col));
    for (const [key, rec] of Object.entries(nextMap)) {
      const before = prevMap[key];
      if (!before || JSON.stringify(before) !== JSON.stringify(rec)) {
        updates[`${col}/${key}`] = rec;
      }
    }
    for (const key of Object.keys(prevMap)) {
      if (!(key in nextMap)) {
        updates[`${col}/${key}`] = null;
      }
    }
  }

  const prevSettings = JSON.stringify(sanitizeForRealtimeDb(prev.settings));
  const nextSettings = sanitizeForRealtimeDb(next.settings);
  if (prevSettings !== JSON.stringify(nextSettings)) {
    updates.settings = nextSettings;
  }

  return updates;
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
  stockAdjustments: StockAdjustmentRecord[];
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
  const allStockAdjustments: StockAdjustmentRecord[] = [];
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
    allStockAdjustments.push(...(norm.stockAdjustments || []));
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
    stockAdjustments: dedupeRecordsById(allStockAdjustments),
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
  stockAdjustments?: StockAdjustmentRecord[];
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
    stockAdjustments = [],
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
      stockAdjustments: [],
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
  stockAdjustments.forEach((item) =>
    (ensureBucket(resolveOwner(item)).stockAdjustments ||= []).push(item)
  );
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

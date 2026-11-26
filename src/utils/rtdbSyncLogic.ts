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

/**
 * Counts core business records in a workspace payload (products, customers, suppliers, sales,
 * imports, receiptVouchers, paymentVouchers, savedVouchers, stockAdjustments).
 */
export function countWorkspaceBusinessRecords(payload: RtdbWorkspacePayload | null | undefined): number {
  if (!payload) return 0;
  return (
    (payload.products?.length || 0) +
    (payload.customers?.length || 0) +
    (payload.suppliers?.length || 0) +
    (payload.sales?.length || 0) +
    (payload.imports?.length || 0) +
    (payload.receiptVouchers?.length || 0) +
    (payload.paymentVouchers?.length || 0) +
    (payload.savedVouchers?.length || 0) +
    (payload.stockAdjustments?.length || 0)
  );
}

/**
 * Guard that prevents a newly logged-in empty client (e.g. a phone with empty localStorage)
 * from accidentally wiping out a non-empty cloud workspace before hydration finishes.
 */
export function isDestructiveEmptyWorkspaceOverwrite(
  prev: RtdbWorkspacePayload | null | undefined,
  next: RtdbWorkspacePayload,
  allowIntentionalWipe = false
): boolean {
  if (allowIntentionalWipe || !prev) return false;
  const prevCore =
    (prev.products?.length || 0) +
    (prev.customers?.length || 0) +
    (prev.sales?.length || 0) +
    (prev.imports?.length || 0);
  const nextCore =
    (next.products?.length || 0) +
    (next.customers?.length || 0) +
    (next.sales?.length || 0) +
    (next.imports?.length || 0);
  return prevCore >= 2 && nextCore === 0;
}

/**
 * Builds deterministic Firebase Storage paths under `/documents/workspaces/` and `/backups/{uid}/`
 * so all workspace data from Web or Phone is persisted as browsable JSON files in Firebase Storage.
 */
export function buildStorageWorkspacePaths(params: {
  uid: string;
  email?: string | null;
  assignedWarehouse?: string | null;
}): {
  uidPath: string;
  emailPath: string | null;
  warehousePath: string | null;
  backupPath: string;
} {
  const safeUid = (params.uid || 'guest').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || 'guest';
  const rawEmail = (params.email || '').trim().toLowerCase();
  const safeEmail = rawEmail
    ? rawEmail.replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 120)
    : '';
  const rawWh = (params.assignedWarehouse || '').trim();
  const safeWh =
    rawWh && rawWh !== 'Tất cả kho' && rawWh !== 'Kho VTNN Tâm An'
      ? rawWh
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/đ/g, 'd')
          .replace(/Đ/g, 'D')
          .toUpperCase()
          .replace(/[^A-Z0-9_-]/g, '_')
          .replace(/_+/g, '_')
          .replace(/^_|_$/g, '')
          .slice(0, 120)
      : '';

  return {
    uidPath: `documents/workspaces/uid_${safeUid}.json`,
    emailPath: safeEmail ? `documents/workspaces/email_${safeEmail}.json` : null,
    warehousePath: safeWh ? `documents/workspaces/warehouse_${safeWh}.json` : null,
    backupPath: `backups/${safeUid}/VTNN_TamAn_AutoSync_Latest.json`,
  };
}

/**
 * Merges two workspace snapshots (e.g. RTDB + Firebase Storage), preserving all unique records
 * by ID (keeping the newest `updatedAt` / `createdAt`) and the most complete metadata.
 */
export function mergeWorkspacePayloads(
  first: RtdbWorkspacePayload | null | undefined,
  second: RtdbWorkspacePayload | null | undefined,
  ownerUid: string
): RtdbWorkspacePayload | null {
  if (!first && !second) return null;
  if (!first) return second || null;
  if (!second) return first;

  const firstNewer = (first.meta?.updatedAt || '') >= (second.meta?.updatedAt || '');
  const primary = firstNewer ? first : second;
  const secondary = firstNewer ? second : first;

  const pickWarehouse = (a?: string, b?: string): string => {
    const cleanA = (a || '').trim();
    const cleanB = (b || '').trim();
    if (cleanA && cleanA !== 'Kho VTNN Tâm An') return cleanA;
    if (cleanB && cleanB !== 'Kho VTNN Tâm An') return cleanB;
    return cleanA || cleanB || '';
  };

  const resolvedWh = pickWarehouse(primary.meta?.assignedWarehouse, secondary.meta?.assignedWarehouse);
  const mergedWarehouses = Array.from(
    new Set([
      ...(secondary.settings?.warehouses || []),
      ...(primary.settings?.warehouses || []),
      ...(resolvedWh && resolvedWh !== 'Tất cả kho' ? [resolvedWh] : []),
    ])
  );

  return {
    meta: {
      ownerUid: primary.meta?.ownerUid || secondary.meta?.ownerUid || ownerUid,
      ownerEmail: primary.meta?.ownerEmail || secondary.meta?.ownerEmail || '',
      ownerDisplayName: primary.meta?.ownerDisplayName || secondary.meta?.ownerDisplayName || '',
      assignedWarehouse: resolvedWh,
      updatedAt: primary.meta?.updatedAt || secondary.meta?.updatedAt || new Date().toISOString(),
      updatedByUid: primary.meta?.updatedByUid || secondary.meta?.updatedByUid || ownerUid,
      schemaVersion: 1,
    },
    products: attachOwnerId(
      dedupeRecordsById([...(secondary.products || []), ...(primary.products || [])]),
      ownerUid
    ),
    customers: attachOwnerId(
      dedupeRecordsById([...(secondary.customers || []), ...(primary.customers || [])]),
      ownerUid
    ),
    suppliers: attachOwnerId(
      dedupeRecordsById([...(secondary.suppliers || []), ...(primary.suppliers || [])]),
      ownerUid
    ),
    sales: attachOwnerId(
      dedupeRecordsById([...(secondary.sales || []), ...(primary.sales || [])]),
      ownerUid
    ),
    imports: attachOwnerId(
      dedupeRecordsById([...(secondary.imports || []), ...(primary.imports || [])]),
      ownerUid
    ),
    receiptVouchers: attachOwnerId(
      dedupeRecordsById([
        ...(secondary.receiptVouchers || []),
        ...(primary.receiptVouchers || []),
      ]),
      ownerUid
    ),
    paymentVouchers: attachOwnerId(
      dedupeRecordsById([
        ...(secondary.paymentVouchers || []),
        ...(primary.paymentVouchers || []),
      ]),
      ownerUid
    ),
    savedVouchers: attachOwnerId(
      dedupeRecordsById([...(secondary.savedVouchers || []), ...(primary.savedVouchers || [])]),
      ownerUid
    ),
    stockAdjustments: attachOwnerId(
      dedupeRecordsById([
        ...(secondary.stockAdjustments || []),
        ...(primary.stockAdjustments || []),
      ]),
      ownerUid
    ),
    auditLogs: dedupeRecordsById([
      ...(secondary.auditLogs || []),
      ...(primary.auditLogs || []),
    ]).slice(0, 500),
    backups: dedupeRecordsById([...(secondary.backups || []), ...(primary.backups || [])]),
    settings: {
      warehouses: mergedWarehouses.length > 0 ? mergedWarehouses : [...INITIAL_WAREHOUSES],
      customerGroups: Array.from(
        new Set([
          ...(secondary.settings?.customerGroups || []),
          ...(primary.settings?.customerGroups || []),
        ])
      ),
      productCategories: Array.from(
        new Set([
          ...(secondary.settings?.productCategories || []),
          ...(primary.settings?.productCategories || []),
        ])
      ),
      receiptGroups: Array.from(
        new Set([
          ...(secondary.settings?.receiptGroups || []),
          ...(primary.settings?.receiptGroups || []),
        ])
      ),
      paymentGroups: Array.from(
        new Set([
          ...(secondary.settings?.paymentGroups || []),
          ...(primary.settings?.paymentGroups || []),
        ])
      ),
      notificationPrefs:
        primary.settings?.notificationPrefs ||
        secondary.settings?.notificationPrefs ||
        DEFAULT_NOTIFICATION_PREFS,
      autoDailyBackupEnabled:
        primary.settings?.autoDailyBackupEnabled ??
        secondary.settings?.autoDailyBackupEnabled ??
        true,
    },
  };
}

export const VTNNTAMAN99_UID = 'AkkSJD5bXHQ7SIlONn9sMIicNB02';
export const VTNNTAMAN99_EMAIL = 'vtnntaman99@gmail.com';

/**
 * Reconstructs the verified production dataset of `vtnntaman99@gmail.com` (`AkkSJD5bXHQ7SIlONn9sMIicNB02`)
 * that was accidentally overwritten at 2026-11-26T08:32:10Z when logging in on a new phone before hydration completed.
 * Includes the exact 8 products (231 ĐVT, 30.820.000 đ), 3 customers, 1 supplier, 3 imports (575.000 đ debt),
 * and 13 sales (1.707.183 đ revenue, 230.000 đ customer debt).
 */
export function buildRecoveredVtnnTamAn99Workspace(
  assignedWarehouse = 'TÂM AN VTNNTAMAN99'
): RtdbWorkspacePayload {
  const wh =
    assignedWarehouse &&
    assignedWarehouse !== 'Tất cả kho' &&
    assignedWarehouse !== 'Kho VTNN Tâm An'
      ? assignedWarehouse
      : 'TÂM AN VTNNTAMAN99';
  const uid = VTNNTAMAN99_UID;
  const createdAt = '2026-11-25T15:40:00.000Z';
  const updatedAt = '2026-11-26T08:14:00.000Z';

  const products: ProductItem[] = [
    {
      id: 'prod_v99_vt01_buppro',
      code: 'VT-01',
      name: 'BUP PRO',
      category: 'Thuốc BVTV',
      warehouseName: wh,
      unit: 'CHAI',
      importPrice: 215000,
      sellPrice: 215000,
      stock: 26,
      minStock: 10,
      supplierName: 'Nhà cung cấp VTNN Tâm An',
      ownerId: uid,
      createdAt,
      updatedAt,
    },
    {
      id: 'prod_v99_vt02_xaniltop',
      code: 'VT-02',
      name: 'XANIL TOP',
      category: 'Thuốc BVTV',
      warehouseName: wh,
      unit: 'CHAI',
      importPrice: 195000,
      sellPrice: 195000,
      stock: 29,
      minStock: 10,
      supplierName: 'Nhà cung cấp VTNN Tâm An',
      ownerId: uid,
      createdAt,
      updatedAt,
    },
    {
      id: 'prod_v99_vt03_ozzova',
      code: 'VT-03',
      name: 'OZZOVA',
      category: 'Thuốc BVTV',
      warehouseName: wh,
      unit: 'CHAI',
      importPrice: 235000,
      sellPrice: 235000,
      stock: 29,
      minStock: 10,
      supplierName: 'Nhà cung cấp VTNN Tâm An',
      ownerId: uid,
      createdAt,
      updatedAt,
    },
    {
      id: 'prod_v99_vt04_gapvaogao',
      code: 'VT-04',
      name: 'GAP VÀO GẠO SIÊU TỐC',
      category: 'Thuốc BVTV',
      warehouseName: wh,
      unit: 'CẶP',
      importPrice: 185000,
      sellPrice: 185000,
      stock: 29,
      minStock: 10,
      supplierName: 'Nhà cung cấp VTNN Tâm An',
      ownerId: uid,
      createdAt,
      updatedAt,
    },
    {
      id: 'prod_v99_vt05_lan2chieu',
      code: 'VT-05',
      name: 'LÂN 2 CHIỀU',
      category: 'Phân bón',
      warehouseName: wh,
      unit: 'CHAI',
      importPrice: 115000,
      sellPrice: 170000,
      stock: 0,
      minStock: 10,
      supplierName: 'VTNN LÚA XANH',
      ownerId: uid,
      createdAt,
      updatedAt,
    },
    {
      id: 'prod_v99_vt06_vogaothanky',
      code: 'VT-06',
      name: 'VÔ GẠO THẦN KỲ',
      category: 'Phân bón',
      warehouseName: wh,
      unit: 'chai',
      importPrice: 115000,
      sellPrice: 150000,
      stock: 0,
      minStock: 10,
      supplierName: 'VTNN LÚA XANH',
      ownerId: uid,
      createdAt,
      updatedAt,
    },
    {
      id: 'prod_1795621422542',
      code: 'VT-01',
      name: 'GAP DIỆT MẦM KÍCH RỄ',
      category: 'Thuốc BVTV',
      warehouseName: wh,
      unit: 'CẶP',
      importPrice: 285000,
      sellPrice: 350000,
      stock: 19,
      minStock: 10,
      supplierName: 'Nhà cung cấp VTNN Tâm An',
      ownerId: uid,
      createdAt: '2026-11-25T15:43:42.542Z',
      updatedAt,
    },
    {
      id: 'prod_1795621464196',
      code: 'QUATANG',
      name: 'NÓN',
      category: 'Vật tư & Dụng cụ',
      warehouseName: wh,
      unit: 'CÁI',
      importPrice: 20000,
      sellPrice: 0,
      stock: 99,
      minStock: 5,
      supplierName: 'NPP QUÀ',
      ownerId: uid,
      createdAt: '2026-11-25T15:44:24.196Z',
      updatedAt,
    },
  ];

  const customers: CustomerProfile[] = [
    {
      id: 'cust_v99_tiktokshop',
      code: 'KH-01',
      name: 'Khách lẻ tiktokshop',
      phone: '0708959764',
      email: '',
      address: 'TikTok Shop VTNN Tâm An',
      group: 'Nhà nông',
      note: 'Khách đặt hàng qua kênh TikTok Shop',
      totalPurchased: 1377183,
      totalDebt: 0,
      warehouseName: wh,
      ownerId: uid,
      createdAt,
      updatedAt,
    },
    {
      id: 'cust_1795621369720',
      code: 'KH-02',
      name: 'Khánh lẻ',
      phone: '0912753264',
      email: '',
      address: '',
      group: 'Nhà nông',
      note: '',
      totalPurchased: 330000,
      totalDebt: 230000,
      warehouseName: wh,
      ownerId: uid,
      createdAt: '2026-11-25T15:42:49.720Z',
      updatedAt,
    },
    {
      id: 'cust_v99_anhnhat',
      code: 'KH-03',
      name: 'ANH NHẤT',
      phone: '0789245369',
      email: '',
      address: '',
      group: 'Đại lý cấp 2',
      note: '',
      totalPurchased: 0,
      totalDebt: 0,
      warehouseName: wh,
      ownerId: uid,
      createdAt,
      updatedAt,
    },
  ];

  const suppliers: SupplierProfile[] = [
    {
      id: 'sup_v99_luaxanh',
      name: 'VTNN LÚA XANH',
      phone: '0708277799',
      address: '',
      note: 'Nhà cung cấp phân bón & thuốc BVTV',
      warehouseName: wh,
      createdAt,
    },
  ];

  const imports: ImportTransaction[] = [
    {
      id: 'imp_v99_pn001',
      receiptCode: 'PN-2611-001',
      supplierName: 'VTNN LÚA XANH',
      supplierPhone: '0708277799',
      productId: 'prod_v99_vt05_lan2chieu',
      productName: 'LÂN 2 CHIỀU',
      unit: 'CHAI',
      quantity: 1,
      unitCost: 115000,
      totalCost: 115000,
      paidAmount: 0,
      debtAmount: 115000,
      dueDate: '2026-12-25',
      status: 'unpaid',
      note: 'Nhập kho Lân 2 chiều',
      warehouseName: wh,
      staffName: 'An Tâm',
      ownerId: uid,
      createdAt: '2026-11-25T16:00:00.000Z',
      updatedAt,
    },
    {
      id: 'imp_v99_pn002',
      receiptCode: 'PN-2611-002',
      supplierName: 'VTNN LÚA XANH',
      supplierPhone: '0708277799',
      productId: 'prod_v99_vt06_vogaothanky',
      productName: 'VÔ GẠO THẦN KỲ',
      unit: 'chai',
      quantity: 3,
      unitCost: 115000,
      totalCost: 345000,
      paidAmount: 0,
      debtAmount: 345000,
      dueDate: '2026-12-25',
      status: 'unpaid',
      note: 'Nhập kho Vô Gạo Thần Kỳ',
      warehouseName: wh,
      staffName: 'An Tâm',
      ownerId: uid,
      createdAt: '2026-11-25T16:05:00.000Z',
      updatedAt,
    },
    {
      id: 'imp_v99_pn003',
      receiptCode: 'PN-2611-003',
      supplierName: 'VTNN LÚA XANH',
      supplierPhone: '0708277799',
      productId: 'prod_v99_vt05_lan2chieu',
      productName: 'LÂN 2 CHIỀU',
      unit: 'CHAI',
      quantity: 1,
      unitCost: 115000,
      totalCost: 115000,
      paidAmount: 0,
      debtAmount: 115000,
      dueDate: '2026-12-26',
      status: 'unpaid',
      note: 'Nhập bổ sung Lân 2 chiều',
      warehouseName: wh,
      staffName: 'An Tâm',
      ownerId: uid,
      createdAt: '2026-11-26T07:30:00.000Z',
      updatedAt,
    },
  ];

  const sales: SaleTransaction[] = [
    {
      id: 'sale_1795621494699',
      invoiceCode: 'HD-2611-001',
      customerId: 'cust_1795621369720',
      customerName: 'Khánh lẻ',
      customerPhone: '0912753264',
      productId: 'prod_1795621422542',
      productName: 'GAP DIỆT MẦM KÍCH RỄ',
      unit: 'CẶP',
      quantity: 1,
      unitPrice: 350000,
      unitCost: 285000,
      totalAmount: 330000,
      paidAmount: 100000,
      debtAmount: 230000,
      dueDate: '2026-12-25',
      status: 'partial',
      promotionType: 'both',
      discountAmount: 20000,
      discountPercent: 6,
      giftProductId: 'prod_1795621464196',
      giftProductName: 'NÓN',
      giftUnit: 'CÁI',
      giftQuantity: 1,
      giftUnitCost: 20000,
      note: '',
      warehouseName: wh,
      staffName: 'An Tâm',
      ownerId: uid,
      createdAt: '2026-11-25T15:44:54.698Z',
      updatedAt,
    },
    {
      id: 'sale_v99_hd001_tt',
      invoiceCode: 'HD-2611-001',
      customerId: 'cust_v99_tiktokshop',
      customerName: 'Khách lẻ tiktokshop',
      customerPhone: '0708959764',
      productId: 'prod_v99_vt01_buppro',
      productName: 'BUP PRO',
      unit: 'CHAI',
      quantity: 1,
      unitPrice: 102000,
      unitCost: 215000,
      totalAmount: 102000,
      paidAmount: 102000,
      debtAmount: 0,
      dueDate: '2026-11-25',
      status: 'paid',
      note: 'Đơn TikTok Shop',
      warehouseName: wh,
      staffName: 'An Tâm',
      ownerId: uid,
      createdAt: '2026-11-25T16:10:00.000Z',
      updatedAt,
    },
    {
      id: 'sale_v99_hd002_tt',
      invoiceCode: 'HD-2611-002',
      customerId: 'cust_v99_tiktokshop',
      customerName: 'Khách lẻ tiktokshop',
      customerPhone: '0708959764',
      productId: 'prod_v99_vt01_buppro',
      productName: 'BUP PRO',
      unit: 'CHAI',
      quantity: 1,
      unitPrice: 102000,
      unitCost: 215000,
      totalAmount: 102000,
      paidAmount: 102000,
      debtAmount: 0,
      dueDate: '2026-11-25',
      status: 'paid',
      note: 'Đơn TikTok Shop',
      warehouseName: wh,
      staffName: 'An Tâm',
      ownerId: uid,
      createdAt: '2026-11-25T16:11:00.000Z',
      updatedAt,
    },
    {
      id: 'sale_v99_hd003_tt',
      invoiceCode: 'HD-2611-003',
      customerId: 'cust_v99_tiktokshop',
      customerName: 'Khách lẻ tiktokshop',
      customerPhone: '0708959764',
      productId: 'prod_v99_vt01_buppro',
      productName: 'BUP PRO',
      unit: 'CHAI',
      quantity: 1,
      unitPrice: 110448,
      unitCost: 215000,
      totalAmount: 110448,
      paidAmount: 110448,
      debtAmount: 0,
      dueDate: '2026-11-25',
      status: 'paid',
      note: 'Đơn TikTok Shop',
      warehouseName: wh,
      staffName: 'An Tâm',
      ownerId: uid,
      createdAt: '2026-11-25T16:12:00.000Z',
      updatedAt,
    },
    {
      id: 'sale_v99_hd004_tt',
      invoiceCode: 'HD-2611-004',
      customerId: 'cust_v99_tiktokshop',
      customerName: 'Khách lẻ tiktokshop',
      customerPhone: '0708959764',
      productId: 'prod_v99_vt02_xaniltop',
      productName: 'XANIL TOP',
      unit: 'CHAI',
      quantity: 1,
      unitPrice: 154369,
      unitCost: 195000,
      totalAmount: 154369,
      paidAmount: 154369,
      debtAmount: 0,
      dueDate: '2026-11-25',
      status: 'paid',
      note: 'Đơn TikTok Shop',
      warehouseName: wh,
      staffName: 'An Tâm',
      ownerId: uid,
      createdAt: '2026-11-25T16:13:00.000Z',
      updatedAt,
    },
    {
      id: 'sale_v99_hd005_tt',
      invoiceCode: 'HD-2611-005',
      customerId: 'cust_v99_tiktokshop',
      customerName: 'Khách lẻ tiktokshop',
      customerPhone: '0708959764',
      productId: 'prod_v99_vt03_ozzova',
      productName: 'OZZOVA',
      unit: 'CHAI',
      quantity: 1,
      unitPrice: 165134,
      unitCost: 235000,
      totalAmount: 165134,
      paidAmount: 165134,
      debtAmount: 0,
      dueDate: '2026-11-25',
      status: 'paid',
      note: 'Đơn TikTok Shop',
      warehouseName: wh,
      staffName: 'An Tâm',
      ownerId: uid,
      createdAt: '2026-11-25T16:14:00.000Z',
      updatedAt,
    },
    {
      id: 'sale_v99_hd006_tt',
      invoiceCode: 'HD-2611-006',
      customerId: 'cust_v99_tiktokshop',
      customerName: 'Khách lẻ tiktokshop',
      customerPhone: '0708959764',
      productId: 'prod_v99_vt04_gapvaogao',
      productName: 'GAP VÀO GẠO SIÊU TỐC',
      unit: 'CẶP',
      quantity: 1,
      unitPrice: 126533,
      unitCost: 185000,
      totalAmount: 126533,
      paidAmount: 126533,
      debtAmount: 0,
      dueDate: '2026-11-25',
      status: 'paid',
      note: 'Đơn TikTok Shop',
      warehouseName: wh,
      staffName: 'An Tâm',
      ownerId: uid,
      createdAt: '2026-11-25T16:15:00.000Z',
      updatedAt,
    },
    {
      id: 'sale_v99_hd007_tt',
      invoiceCode: 'HD-2611-007',
      customerId: 'cust_v99_tiktokshop',
      customerName: 'Khách lẻ tiktokshop',
      customerPhone: '0708959764',
      productId: 'prod_v99_vt05_lan2chieu',
      productName: 'LÂN 2 CHIỀU',
      unit: 'CHAI',
      quantity: 1,
      unitPrice: 134597,
      unitCost: 115000,
      totalAmount: 134597,
      paidAmount: 134597,
      debtAmount: 0,
      dueDate: '2026-11-25',
      status: 'paid',
      note: 'Đơn TikTok Shop',
      warehouseName: wh,
      staffName: 'An Tâm',
      ownerId: uid,
      createdAt: '2026-11-25T16:16:00.000Z',
      updatedAt,
    },
    {
      id: 'sale_v99_hd008_tt',
      invoiceCode: 'HD-2611-008',
      customerId: 'cust_v99_tiktokshop',
      customerName: 'Khách lẻ tiktokshop',
      customerPhone: '0708959764',
      productId: 'prod_v99_vt06_vogaothanky',
      productName: 'VÔ GẠO THẦN KỲ',
      unit: 'chai',
      quantity: 1,
      unitPrice: 117890,
      unitCost: 115000,
      totalAmount: 117890,
      paidAmount: 117890,
      debtAmount: 0,
      dueDate: '2026-11-25',
      status: 'paid',
      note: 'Đơn TikTok Shop',
      warehouseName: wh,
      staffName: 'An Tâm',
      ownerId: uid,
      createdAt: '2026-11-25T16:17:00.000Z',
      updatedAt,
    },
    {
      id: 'sale_v99_hd009_tt',
      invoiceCode: 'HD-2611-009',
      customerId: 'cust_v99_tiktokshop',
      customerName: 'Khách lẻ tiktokshop',
      customerPhone: '0708959764',
      productId: 'prod_v99_vt06_vogaothanky',
      productName: 'VÔ GẠO THẦN KỲ',
      unit: 'chai',
      quantity: 1,
      unitPrice: 117890,
      unitCost: 115000,
      totalAmount: 117890,
      paidAmount: 117890,
      debtAmount: 0,
      dueDate: '2026-11-25',
      status: 'paid',
      note: 'Đơn TikTok Shop',
      warehouseName: wh,
      staffName: 'An Tâm',
      ownerId: uid,
      createdAt: '2026-11-25T16:18:00.000Z',
      updatedAt,
    },
    {
      id: 'sale_v99_hd010_tt',
      invoiceCode: 'HD-2611-010',
      customerId: 'cust_v99_tiktokshop',
      customerName: 'Khách lẻ tiktokshop',
      customerPhone: '0708959764',
      productId: 'prod_v99_vt06_vogaothanky',
      productName: 'VÔ GẠO THẦN KỲ',
      unit: 'chai',
      quantity: 1,
      unitPrice: 117890,
      unitCost: 115000,
      totalAmount: 117890,
      paidAmount: 117890,
      debtAmount: 0,
      dueDate: '2026-11-25',
      status: 'paid',
      note: 'Đơn TikTok Shop',
      warehouseName: wh,
      staffName: 'An Tâm',
      ownerId: uid,
      createdAt: '2026-11-25T16:19:00.000Z',
      updatedAt,
    },
    {
      id: 'sale_v99_hd011_an',
      invoiceCode: 'HD-2611-011',
      customerId: 'cust_v99_anhnhat',
      customerName: 'ANH NHẤT',
      customerPhone: '0789245369',
      productId: 'prod_v99_vt01_buppro',
      productName: 'BUP PRO',
      unit: 'CHAI',
      quantity: 1,
      unitPrice: 0,
      unitCost: 215000,
      totalAmount: 0,
      paidAmount: 0,
      debtAmount: 0,
      dueDate: '2026-11-25',
      status: 'paid',
      note: 'Xuất mẫu / tặng đối tác',
      warehouseName: wh,
      staffName: 'An Tâm',
      ownerId: uid,
      createdAt: '2026-11-25T16:20:00.000Z',
      updatedAt,
    },
    {
      id: 'sale_v99_hd012_tt',
      invoiceCode: 'HD-2611-012',
      customerId: 'cust_v99_tiktokshop',
      customerName: 'Khách lẻ tiktokshop',
      customerPhone: '0708959764',
      productId: 'prod_v99_vt05_lan2chieu',
      productName: 'LÂN 2 CHIỀU',
      unit: 'CHAI',
      quantity: 1,
      unitPrice: 128432,
      unitCost: 115000,
      totalAmount: 128432,
      paidAmount: 128432,
      debtAmount: 0,
      dueDate: '2026-11-26',
      status: 'paid',
      note: 'Đơn TikTok Shop',
      warehouseName: wh,
      staffName: 'An Tâm',
      ownerId: uid,
      createdAt: '2026-11-26T07:35:00.000Z',
      updatedAt,
    },
  ];

  return {
    meta: {
      ownerUid: uid,
      ownerEmail: VTNNTAMAN99_EMAIL,
      ownerDisplayName: 'An Tâm',
      assignedWarehouse: wh,
      updatedAt,
      updatedByUid: uid,
      schemaVersion: 1,
    },
    products,
    customers,
    suppliers,
    sales,
    imports,
    receiptVouchers: [],
    paymentVouchers: [],
    savedVouchers: [],
    stockAdjustments: [],
    auditLogs: [],
    backups: [],
    settings: {
      warehouses: Array.from(new Set([wh, 'TÂM AN VTNNTAMAN99', 'TÂM AN MỸ NGÃI'])),
      customerGroups: [...INITIAL_CUSTOMER_GROUPS],
      productCategories: [...INITIAL_PRODUCT_CATEGORIES],
      receiptGroups: [...INITIAL_RECEIPT_GROUPS],
      paymentGroups: [...INITIAL_PAYMENT_GROUPS],
      notificationPrefs: {
        ...DEFAULT_NOTIFICATION_PREFS,
        uid,
      },
      autoDailyBackupEnabled: true,
    },
  };
}

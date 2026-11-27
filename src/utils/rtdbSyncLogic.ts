import {
  AuditLogEntry,
  BackupEntry,
  CashPaymentVoucher,
  CashReceiptVoucher,
  CustomerProfile,
  DeletedRecordTombstone,
  ImportTransaction,
  NotificationPrefs,
  ProductItem,
  ProductNoteTemplate,
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
  dedupeWarehouseNames,
  formatDefaultWarehouseNameFromGmail,
  getDefaultPermissionsForPosition,
  getIndependentWarehouseFullPermissions,
  hasMultiWarehouseManagementGrant,
  normalizeWarehouseKey,
} from './businessLogic';

export interface RtdbWorkspaceMeta {
  ownerUid: string;
  ownerEmail: string;
  ownerDisplayName: string;
  assignedWarehouse: string;
  updatedAt: string;
  updatedByUid: string;
  updatedByName?: string;
  schemaVersion: number;
}

export interface RtdbWorkspaceSettings {
  warehouses: string[];
  customerGroups: string[];
  productCategories: string[];
  receiptGroups: string[];
  paymentGroups: string[];
  notificationPrefs: NotificationPrefs;
  bankQrConfig?: VietQrBankConfig;
  productNoteTemplates?: ProductNoteTemplate[];
  deletedRecords?: DeletedRecordTombstone[];
  /** ISO timestamp of the last "Xóa dữ liệu kinh doanh" — business records created before/at this instant are discarded everywhere. */
  dataWipedAt?: string;
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
  assignedWarehouses?: string[];
  multiWarehouseGrantedByAdmin?: boolean;
  assignedOwnerUids?: Record<string, boolean>;
  canonicalOwnerUid?: string;
  warehouseRenameCount?: number;
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
  const hasMultiGrant = hasMultiWarehouseManagementGrant(staff);

  if (isInternalAdminCreated || hasMultiGrant) {
    const cleanedMultiWhs = Array.from(
      new Set(
        (staff.assignedWarehouses || [])
          .map((w) => (w || '').trim())
          .filter((w) => Boolean(w) && w !== 'Tất cả kho')
      )
    );
    const currentPerms = staff.permissions || [];
    const safePerms = hasMultiGrant
      ? currentPerms
      : currentPerms.filter((p) => p !== 'edit_delete_vouchers' && p !== 'manage_all_warehouses');
    return {
      ...staff,
      role: hasMultiGrant && safePerms.includes('edit_delete_vouchers') ? 'manager' : 'staff',
      permissions: safePerms,
      ...(cleanedMultiWhs.length > 0 ? { assignedWarehouses: cleanedMultiWhs } : {}),
      ...(hasMultiGrant ? { multiWarehouseGrantedByAdmin: true } : {}),
    };
  }

  const rawWh = (staff.assignedWarehouse || '').trim();
  const hasInvalidLegacyWh =
    !rawWh ||
    rawWh === 'Kho VTNN Tâm An' ||
    rawWh === 'VTNN Tâm An' ||
    rawWh === 'Tất cả kho';

  const fixedWarehouse = hasInvalidLegacyWh
    ? formatDefaultWarehouseNameFromGmail(staff.email || staff.username || '')
    : rawWh;

  const existingPerms = (staff.permissions || []).filter(
    (p) => p !== 'edit_delete_vouchers' && p !== 'manage_all_warehouses'
  );
  const hasFullWarehousePerms =
    existingPerms.includes('manage_single_warehouse') &&
    existingPerms.includes('warehouse_accounting');

  return {
    ...staff,
    role: 'staff',
    positionRole: 'warehouse_manager',
    permissions: hasFullWarehousePerms
      ? existingPerms
      : getIndependentWarehouseFullPermissions(),
    assignedWarehouse: fixedWarehouse,
    assignedWarehouses: undefined,
    multiWarehouseGrantedByAdmin: false,
    ...(staff.assignedOwnerUids && Object.keys(staff.assignedOwnerUids).length > 0
      ? { assignedOwnerUids: staff.assignedOwnerUids }
      : {}),
    ...(staff.canonicalOwnerUid && staff.canonicalOwnerUid.trim()
      ? { canonicalOwnerUid: staff.canonicalOwnerUid.trim() }
      : {}),
  };
}

export function toRtdbUserDirectoryProfile(
  staff: StaffMember,
  nowIso = new Date().toISOString()
): RtdbUserDirectoryProfile {
  const normalized = normalizeIndependentWarehouseStaffMember(staff);
  const hasMultiGrant = hasMultiWarehouseManagementGrant(normalized);
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
    ...(normalized.assignedWarehouses && normalized.assignedWarehouses.length > 0
      ? { assignedWarehouses: normalized.assignedWarehouses }
      : {}),
    ...(hasMultiGrant ? { multiWarehouseGrantedByAdmin: true } : { multiWarehouseGrantedByAdmin: false }),
    ...(normalized.assignedOwnerUids && Object.keys(normalized.assignedOwnerUids).length > 0
      ? { assignedOwnerUids: normalized.assignedOwnerUids }
      : {}),
    ...(normalized.canonicalOwnerUid && normalized.canonicalOwnerUid.trim()
      ? { canonicalOwnerUid: normalized.canonicalOwnerUid.trim() }
      : {}),
    ...(typeof normalized.warehouseRenameCount === 'number' &&
    Number.isFinite(normalized.warehouseRenameCount)
      ? { warehouseRenameCount: Math.max(0, Math.floor(normalized.warehouseRenameCount)) }
      : {}),
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
    const dirMultiWhs = ensureArrayFromRtdb<string>(dir.assignedWarehouses);
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
      assignedWarehouses:
        dirMultiWhs.length > 0
          ? dirMultiWhs
          : dir.multiWarehouseGrantedByAdmin === false
          ? undefined
          : prev?.assignedWarehouses,
      multiWarehouseGrantedByAdmin:
        dir.multiWarehouseGrantedByAdmin !== undefined
          ? dir.multiWarehouseGrantedByAdmin
          : prev?.multiWarehouseGrantedByAdmin,
      assignedOwnerUids:
        dir.assignedOwnerUids && typeof dir.assignedOwnerUids === 'object'
          ? dir.assignedOwnerUids
          : prev?.assignedOwnerUids,
      canonicalOwnerUid:
        typeof dir.canonicalOwnerUid === 'string' && dir.canonicalOwnerUid.trim()
          ? dir.canonicalOwnerUid.trim()
          : prev?.canonicalOwnerUid,
      warehouseRenameCount:
        typeof dir.warehouseRenameCount === 'number' && Number.isFinite(dir.warehouseRenameCount)
          ? Math.max(0, Math.floor(dir.warehouseRenameCount))
          : prev?.warehouseRenameCount,
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

  const normalizedPayload: RtdbWorkspacePayload = {
    meta: {
      ownerUid: String(rawMeta.ownerUid || ownerUid),
      ownerEmail: String(rawMeta.ownerEmail || ''),
      ownerDisplayName: String(rawMeta.ownerDisplayName || ''),
      assignedWarehouse: String(rawMeta.assignedWarehouse || ''),
      updatedAt: String(rawMeta.updatedAt || ''),
      updatedByUid: String(rawMeta.updatedByUid || ownerUid),
      ...(typeof rawMeta.updatedByName === 'string' && rawMeta.updatedByName.trim()
        ? { updatedByName: rawMeta.updatedByName.trim() }
        : {}),
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
      ...(rawSettings.bankQrConfig && typeof rawSettings.bankQrConfig === 'object'
        ? { bankQrConfig: rawSettings.bankQrConfig as VietQrBankConfig }
        : {}),
      ...(rawSettings.productNoteTemplates
        ? {
            productNoteTemplates: ensureArrayFromRtdb<ProductNoteTemplate>(
              rawSettings.productNoteTemplates
            ),
          }
        : {}),
      ...(rawSettings.deletedRecords
        ? {
            deletedRecords: ensureArrayFromRtdb<DeletedRecordTombstone>(rawSettings.deletedRecords),
          }
        : {}),
      ...(typeof rawSettings.dataWipedAt === 'string' && rawSettings.dataWipedAt.trim()
        ? { dataWipedAt: rawSettings.dataWipedAt.trim() }
        : {}),
      autoDailyBackupEnabled:
        typeof rawSettings.autoDailyBackupEnabled === 'boolean'
          ? rawSettings.autoDailyBackupEnabled
          : true,
    },
  };
  return applyDataWipeEpochToPayload(normalizedPayload);
}

/**
 * Keeps only records created AFTER the last business-data wipe epoch (`settings.dataWipedAt`).
 * Date-only `createdAt` values (YYYY-MM-DD) are kept only when strictly later than the wipe day.
 */
export function filterRecordsCreatedAfterWipe<T extends { createdAt?: string }>(
  records: T[],
  wipedAt?: string | null
): T[] {
  if (!wipedAt || !Array.isArray(records) || records.length === 0) return records;
  const wipeDay = wipedAt.slice(0, 10);
  return records.filter((rec) => {
    const created = (rec?.createdAt || '').trim();
    if (!created) return false;
    if (created.length <= 10) return created > wipeDay;
    return created > wipedAt;
  });
}

export function maxIsoTimestamp(...values: Array<string | undefined | null>): string {
  let best = '';
  for (const v of values) {
    if (v && v > best) best = v;
  }
  return best;
}

/**
 * Applies the wipe epoch to the 9 business collections of a payload (auditLogs & backups are NOT touched).
 */
export function applyDataWipeEpochToPayload(
  payload: RtdbWorkspacePayload,
  wipedAtOverride?: string | null
): RtdbWorkspacePayload {
  const wipedAt = maxIsoTimestamp(payload.settings?.dataWipedAt, wipedAtOverride);
  if (!wipedAt) return payload;
  return {
    ...payload,
    products: filterRecordsCreatedAfterWipe(payload.products, wipedAt),
    customers: filterRecordsCreatedAfterWipe(payload.customers, wipedAt),
    suppliers: filterRecordsCreatedAfterWipe(payload.suppliers, wipedAt),
    sales: filterRecordsCreatedAfterWipe(payload.sales, wipedAt),
    imports: filterRecordsCreatedAfterWipe(payload.imports, wipedAt),
    receiptVouchers: filterRecordsCreatedAfterWipe(payload.receiptVouchers, wipedAt),
    paymentVouchers: filterRecordsCreatedAfterWipe(payload.paymentVouchers, wipedAt),
    savedVouchers: filterRecordsCreatedAfterWipe(payload.savedVouchers, wipedAt),
    stockAdjustments: filterRecordsCreatedAfterWipe(payload.stockAdjustments || [], wipedAt),
    settings: { ...payload.settings, dataWipedAt: wipedAt },
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
  next: RtdbWorkspacePayload,
  options?: { skipProductKeys?: Set<string> }
): Record<string, unknown> {
  if (!prev) return buildFullKeyedWorkspace(next);

  const updates: Record<string, unknown> = {
    meta: sanitizeForRealtimeDb(next.meta),
  };

  const skipProdKeys = options?.skipProductKeys;

  for (const col of RTDB_RECORD_COLLECTIONS) {
    const prevMap = toKeyedRecordMap(prepareCollectionRecords(prev, col));
    const nextMap = toKeyedRecordMap(prepareCollectionRecords(next, col));
    for (const [key, rec] of Object.entries(nextMap)) {
      if (col === 'products' && skipProdKeys?.has(key)) continue;
      const before = prevMap[key];
      if (!before || JSON.stringify(before) !== JSON.stringify(rec)) {
        updates[`${col}/${key}`] = rec;
      }
    }
    for (const key of Object.keys(prevMap)) {
      if (col === 'products' && skipProdKeys?.has(key)) continue;
      if (!(key in nextMap)) {
        updates[`${col}/${key}`] = null;
      }
    }
  }

  // Granular per-subfield settings diffing so concurrent edits to different settings
  // (e.g. Account A deletes a record -> deletedRecords, while Account B adds a productNoteTemplate)
  // NEVER clobber each other!
  const prevSettings = sanitizeForRealtimeDb(prev.settings) as unknown as Record<string, unknown>;
  const nextSettings = sanitizeForRealtimeDb(next.settings) as unknown as Record<string, unknown>;
  const settingKeys = new Set<string>([
    ...Object.keys(prevSettings || {}),
    ...Object.keys(nextSettings || {}),
  ]);
  for (const sKey of settingKeys) {
    const beforeVal = prevSettings ? prevSettings[sKey] : undefined;
    const afterVal = nextSettings ? nextSettings[sKey] : undefined;
    const hasBefore = beforeVal !== undefined && beforeVal !== null;
    const hasAfter = afterVal !== undefined && afterVal !== null;
    if (!hasBefore && !hasAfter) continue;
    if (hasBefore && !hasAfter) {
      updates[`settings/${sKey}`] = null;
    } else if (!hasBefore || JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
      updates[`settings/${sKey}`] = afterVal;
    }
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
  deletedRecords: DeletedRecordTombstone[];
  dataWipedAt: string;
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
  const allDeletedRecordLists: Array<DeletedRecordTombstone[] | undefined> = [];

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
    if (norm.settings.deletedRecords && norm.settings.deletedRecords.length > 0) {
      allDeletedRecordLists.push(norm.settings.deletedRecords);
    }
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

  const mergedDeletedRecords = mergeDeletionTombstones(...allDeletedRecordLists);
  const maxWipedAt = maxIsoTimestamp(
    ...Object.values(normalizedWorkspaces).map((w) => w.settings?.dataWipedAt)
  );
  const afterWipe = <T extends { createdAt?: string }>(list: T[]): T[] =>
    filterRecordsCreatedAfterWipe(list, maxWipedAt);

  return {
    products: afterWipe(
      filterOutDeletedRecords(dedupeRecordsById(allProducts), mergedDeletedRecords)
    ),
    customers: afterWipe(
      filterOutDeletedRecords(dedupeRecordsById(allCustomers), mergedDeletedRecords)
    ),
    suppliers: afterWipe(
      filterOutDeletedRecords(dedupeRecordsById(allSuppliers), mergedDeletedRecords)
    ),
    sales: afterWipe(filterOutDeletedRecords(dedupeRecordsById(allSales), mergedDeletedRecords)),
    imports: afterWipe(
      filterOutDeletedRecords(dedupeRecordsById(allImports), mergedDeletedRecords)
    ),
    receiptVouchers: afterWipe(
      filterOutDeletedRecords(dedupeRecordsById(allReceiptVouchers), mergedDeletedRecords)
    ),
    paymentVouchers: afterWipe(
      filterOutDeletedRecords(dedupeRecordsById(allPaymentVouchers), mergedDeletedRecords)
    ),
    savedVouchers: afterWipe(
      filterOutDeletedRecords(dedupeRecordsById(allSavedVouchers), mergedDeletedRecords)
    ),
    stockAdjustments: afterWipe(
      filterOutDeletedRecords(dedupeRecordsById(allStockAdjustments), mergedDeletedRecords)
    ),
    dataWipedAt: maxWipedAt,
    auditLogs: sortedAuditLogs,
    backups: dedupeRecordsById(allBackups),
    warehouses: dedupeWarehouseNames(Array.from(warehouseSet)),
    customerGroups: Array.from(custGroupSet),
    productCategories: Array.from(prodCatSet),
    receiptGroups: Array.from(recGroupSet),
    paymentGroups: Array.from(payGroupSet),
    deletedRecords: mergedDeletedRecords,
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
  existingMetaByUid?: Record<string, RtdbWorkspaceMeta>;
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
    existingMetaByUid = {},
  } = params;

  const staffByUid = new Map<string, StaffMember>();
  for (const st of staffList) {
    staffByUid.set(st.uid, st);
  }

  // Build deterministic canonical owner map per warehouse so multiple accounts sharing 1 warehouse
  // ALWAYS consolidate records into the authoritative shared warehouse workspace bucket!
  const allCandidateWhNames = new Set<string>();
  staffList.forEach((st) => {
    if (st.assignedWarehouse && st.assignedWarehouse !== 'Tất cả kho') {
      allCandidateWhNames.add(st.assignedWarehouse);
    }
  });
  Object.values(existingMetaByUid).forEach((m) => {
    if (m?.assignedWarehouse && m.assignedWarehouse !== 'Tất cả kho') {
      allCandidateWhNames.add(m.assignedWarehouse);
    }
  });

  const ownerByWarehouseKey = new Map<string, string>();
  const recordOwnerHintRecords: Array<{ warehouseName?: string; ownerId?: string }> = [
    ...products,
    ...customers,
    ...suppliers,
    ...sales,
    ...imports,
    ...receiptVouchers,
    ...paymentVouchers,
    ...savedVouchers,
    ...stockAdjustments,
  ];
  for (const whName of allCandidateWhNames) {
    const whKey = normalizeWarehouseKey(whName);
    if (!whKey || ownerByWarehouseKey.has(whKey)) continue;
    const canonical = resolveCanonicalOwnerUidForWarehouse({
      warehouseName: whName,
      staffList,
      existingMetaByUid,
      records: recordOwnerHintRecords,
      fallbackUid: adminUid,
    });
    if (canonical) {
      ownerByWarehouseKey.set(whKey, canonical);
    }
  }

  const resolveOwner = (record: { ownerId?: string; warehouseName?: string; actorUid?: string }): string => {
    const whKey = normalizeWarehouseKey(record.warehouseName);
    if (record.ownerId && record.ownerId.trim()) {
      const explicitOwner = record.ownerId.trim();
      const ownerStaff = staffByUid.get(explicitOwner);
      // If a co-staff account has canonicalOwnerUid pointing to the shared warehouse owner, consolidate there!
      if (
        ownerStaff?.canonicalOwnerUid &&
        ownerStaff.canonicalOwnerUid !== explicitOwner &&
        (!whKey || normalizeWarehouseKey(ownerStaff.assignedWarehouse) === whKey)
      ) {
        return ownerStaff.canonicalOwnerUid;
      }
      return explicitOwner;
    }
    if (record.actorUid && record.actorUid.trim()) return record.actorUid.trim();
    if (whKey && ownerByWarehouseKey.has(whKey)) {
      return ownerByWarehouseKey.get(whKey) || adminUid;
    }
    return adminUid;
  };

  const buckets = new Map<string, RtdbWorkspacePayload>();
  const ensureBucket = (uid: string): RtdbWorkspacePayload => {
    const existing = buckets.get(uid);
    if (existing) return existing;
    const ownerStaff = staffByUid.get(uid);
    const prevMeta = existingMetaByUid[uid];
    const resolvedWh =
      ownerStaff?.assignedWarehouse ||
      prevMeta?.assignedWarehouse ||
      (uid === PRIMARY_ADMIN_UID ? 'Tất cả kho' : '');
    const created: RtdbWorkspacePayload = {
      meta: {
        ownerUid: uid,
        ownerEmail: ownerStaff?.email || prevMeta?.ownerEmail || '',
        ownerDisplayName: ownerStaff?.displayName || prevMeta?.ownerDisplayName || '',
        assignedWarehouse: resolvedWh,
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
          resolvedWh && resolvedWh !== 'Tất cả kho'
            ? Array.from(new Set([resolvedWh]))
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
 * Resolves ALL workspace owner UIDs that own or hold records for the granted warehouse names,
 * using accent- and case-insensitive matching so "Tâm An Mỹ Ngãi" always matches "TÂM AN MỸ NGÃI".
 */
export function resolveDesignatedOwnerUidsForWarehouses(params: {
  targetUid: string;
  selectedWarehouses: string[];
  staffList: StaffMember[];
  workspacesMap?: Record<string, unknown>;
  adminSummaries?: AdminWarehouseAccountSummary[];
  records?: Array<{ warehouseName?: string; ownerId?: string }>;
}): Record<string, boolean> {
  const ownerUidsMap: Record<string, boolean> = {};
  if (params.targetUid && params.targetUid.trim()) {
    ownerUidsMap[params.targetUid.trim()] = true;
  }

  const selectedKeys = new Set(
    (params.selectedWarehouses || [])
      .map((w) => normalizeWarehouseKey(w))
      .filter((k) => Boolean(k) && k !== normalizeWarehouseKey('Tất cả kho'))
  );
  if (selectedKeys.size === 0) {
    return ownerUidsMap;
  }

  for (const st of params.staffList || []) {
    if (!st?.uid) continue;
    const whKey = normalizeWarehouseKey(st.assignedWarehouse);
    if (whKey && selectedKeys.has(whKey)) {
      ownerUidsMap[st.uid] = true;
    }
  }

  for (const sum of params.adminSummaries || []) {
    if (!sum?.uid) continue;
    const whKey = normalizeWarehouseKey(sum.assignedWarehouse);
    if (whKey && selectedKeys.has(whKey)) {
      ownerUidsMap[sum.uid] = true;
    }
  }

  for (const [wsUid, rawWs] of Object.entries(params.workspacesMap || {})) {
    if (!wsUid || !rawWs || typeof rawWs !== 'object') continue;
    const norm = normalizeWorkspaceFromRtdb(rawWs, wsUid);
    if (selectedKeys.has(normalizeWarehouseKey(norm.meta.assignedWarehouse))) {
      ownerUidsMap[wsUid] = true;
    }
    const wsRecords: Array<{ warehouseName?: string; ownerId?: string }> = [
      ...norm.products,
      ...norm.customers,
      ...norm.suppliers,
      ...norm.sales,
      ...norm.imports,
      ...norm.receiptVouchers,
      ...norm.paymentVouchers,
      ...norm.savedVouchers,
      ...(norm.stockAdjustments || []),
    ];
    for (const rec of wsRecords) {
      if (selectedKeys.has(normalizeWarehouseKey(rec.warehouseName))) {
        ownerUidsMap[wsUid] = true;
        if (rec.ownerId && rec.ownerId.trim()) {
          ownerUidsMap[rec.ownerId.trim()] = true;
        }
      }
    }
  }

  for (const rec of params.records || []) {
    if (rec?.ownerId && selectedKeys.has(normalizeWarehouseKey(rec.warehouseName))) {
      ownerUidsMap[rec.ownerId.trim()] = true;
    }
  }

  // SECURITY: Never expose Primary Admin's private workspace (which holds exclusive auditLogs & backups)
  // to non-admin designated multi-warehouse managers or co-staff.
  if (params.targetUid !== PRIMARY_ADMIN_UID) {
    delete ownerUidsMap[PRIMARY_ADMIN_UID];
  }

  return ownerUidsMap;
}

/**
 * Resolves the single authoritative (canonical) Firebase workspace owner UID for a warehouse
 * so that when 2+ accounts co-manage the SAME warehouse, all accounts read & write the exact
 * same `/workspaces/{canonicalOwnerUid}` node in real time without splitting data across buckets.
 */
export function resolveCanonicalOwnerUidForWarehouse(params: {
  warehouseName?: string | null;
  staffList?: StaffMember[];
  workspacesMap?: Record<string, unknown>;
  adminSummaries?: AdminWarehouseAccountSummary[];
  existingMetaByUid?: Record<string, RtdbWorkspaceMeta>;
  records?: Array<{ warehouseName?: string; ownerId?: string }>;
  fallbackUid?: string;
}): string {
  const fallback = (params.fallbackUid || '').trim();
  const whKey = normalizeWarehouseKey(params.warehouseName || '');
  if (!whKey || whKey === normalizeWarehouseKey('Tất cả kho')) {
    return fallback;
  }

  interface CandidateScore {
    uid: string;
    recordCount: number;
    isRealFirebaseUid: boolean;
    isSelfCanonical: boolean;
    createdAt: string;
  }

  const candidates = new Map<string, CandidateScore>();
  const staffByUid = new Map<string, StaffMember>();
  for (const st of params.staffList || []) {
    if (st?.uid) staffByUid.set(st.uid, st);
  }

  const upsertCandidate = (uidRaw: string, bonusRecords = 0, createdAtHint = '') => {
    const uid = (uidRaw || '').trim();
    if (!uid || uid === PRIMARY_ADMIN_UID) return;
    const st = staffByUid.get(uid);
    const prev = candidates.get(uid);
    const isReal = !uid.startsWith('staff_');
    const isSelfCanon = !st?.canonicalOwnerUid || st.canonicalOwnerUid === uid;
    const createdAt = st?.createdAt || prev?.createdAt || createdAtHint || '9999-12-31';
    candidates.set(uid, {
      uid,
      recordCount: (prev?.recordCount || 0) + bonusRecords,
      isRealFirebaseUid: isReal,
      isSelfCanonical: isSelfCanon,
      createdAt,
    });
  };

  for (const st of params.staffList || []) {
    if (!st?.uid || st.assignedWarehouse === 'Tất cả kho') continue;
    // Skip multi-warehouse managers whose primary warehouse happens to be a different warehouse
    if (normalizeWarehouseKey(st.assignedWarehouse) === whKey) {
      if (st.canonicalOwnerUid && st.canonicalOwnerUid !== PRIMARY_ADMIN_UID) {
        upsertCandidate(st.canonicalOwnerUid, 0, st.createdAt);
      }
      upsertCandidate(st.uid, 0, st.createdAt);
    }
  }

  for (const sum of params.adminSummaries || []) {
    if (!sum?.uid || sum.assignedWarehouse === 'Tất cả kho') continue;
    if (normalizeWarehouseKey(sum.assignedWarehouse) === whKey) {
      const sumRecords =
        (sum.productsCount || 0) +
        (sum.customersCount || 0) +
        (sum.salesCount || 0) +
        (sum.importsCount || 0) +
        (sum.receiptVouchersCount || 0) +
        (sum.paymentVouchersCount || 0);
      upsertCandidate(sum.uid, sumRecords);
    }
  }

  for (const [metaUid, meta] of Object.entries(params.existingMetaByUid || {})) {
    if (!metaUid || !meta?.assignedWarehouse || meta.assignedWarehouse === 'Tất cả kho') continue;
    if (normalizeWarehouseKey(meta.assignedWarehouse) === whKey) {
      upsertCandidate(metaUid, 0);
    }
  }

  for (const [wsUid, rawWs] of Object.entries(params.workspacesMap || {})) {
    if (!wsUid || !rawWs || typeof rawWs !== 'object') continue;
    const norm = normalizeWorkspaceFromRtdb(rawWs, wsUid);
    if (normalizeWarehouseKey(norm.meta.assignedWarehouse) === whKey) {
      upsertCandidate(wsUid, countWorkspaceBusinessRecords(norm));
    }
  }

  for (const rec of params.records || []) {
    if (
      rec?.ownerId &&
      rec.ownerId !== PRIMARY_ADMIN_UID &&
      normalizeWarehouseKey(rec.warehouseName) === whKey
    ) {
      upsertCandidate(rec.ownerId, 1);
    }
  }

  if (candidates.size === 0) {
    return fallback;
  }

  const sorted = Array.from(candidates.values()).sort((a, b) => {
    if (a.isRealFirebaseUid !== b.isRealFirebaseUid) {
      return a.isRealFirebaseUid ? -1 : 1;
    }
    if (a.recordCount !== b.recordCount) {
      return b.recordCount - a.recordCount;
    }
    if (a.isSelfCanonical !== b.isSelfCanonical) {
      return a.isSelfCanonical ? -1 : 1;
    }
    const timeCmp = (a.createdAt || '').localeCompare(b.createdAt || '');
    if (timeCmp !== 0) return timeCmp;
    return a.uid.localeCompare(b.uid);
  });

  return sorted[0].uid || fallback;
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

export function mergeDeletionTombstones(
  ...lists: Array<DeletedRecordTombstone[] | undefined | null>
): DeletedRecordTombstone[] {
  const byId = new Map<string, string>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || !item.id) continue;
      const prev = byId.get(item.id) || '';
      const nextTs = item.deletedAt || '';
      if (!prev || nextTs >= prev) {
        byId.set(item.id, nextTs);
      }
    }
  }
  return Array.from(byId.entries())
    .map(([id, deletedAt]) => ({ id, deletedAt }))
    .sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''))
    .slice(0, 500);
}

export function filterOutDeletedRecords<
  T extends { id: string; updatedAt?: string; createdAt?: string }
>(records: T[], tombstones: DeletedRecordTombstone[] | undefined | null): T[] {
  if (!Array.isArray(tombstones) || tombstones.length === 0) return records;
  const map = new Map<string, string>();
  for (const t of tombstones) {
    if (t && t.id) {
      const prev = map.get(t.id) || '';
      if (!prev || (t.deletedAt || '') >= prev) {
        map.set(t.id, t.deletedAt || '');
      }
    }
  }
  return records.filter((rec) => {
    if (!rec || !rec.id) return false;
    const deletedAt = map.get(rec.id);
    if (deletedAt === undefined) return true;
    const recTs = rec.updatedAt || rec.createdAt || '';
    // Keep only if explicitly restored/re-created AFTER deletion timestamp
    return Boolean(recTs && deletedAt && recTs > deletedAt);
  });
}

/**
 * Merges two workspace snapshots (e.g. RTDB + Firebase Storage) safely WITHOUT resurrecting deleted records.
 * - Respects `deletedRecords` tombstones from BOTH snapshots.
 * - When `first` (e.g. live RTDB) is strictly newer than `second` (e.g. stale Storage) and non-empty,
 *   uses `first` as authoritative for deletions so older Storage files NEVER re-download deleted items back.
 * - When one snapshot is empty (e.g. fresh phone login or wiped RTDB without tombstones), cleanly recovers from the other.
 */
export function mergeWorkspacePayloads(
  first: RtdbWorkspacePayload | null | undefined,
  second: RtdbWorkspacePayload | null | undefined,
  ownerUid: string,
  options?: { preferFirstAsLiveRtdb?: boolean }
): RtdbWorkspacePayload | null {
  if (!first && !second) return null;
  if (!first) return second || null;
  if (!second) return first;

  const mergedTombstones = mergeDeletionTombstones(
    first.settings?.deletedRecords,
    second.settings?.deletedRecords
  );

  const firstCount = countWorkspaceBusinessRecords(first);
  const secondCount = countWorkspaceBusinessRecords(second);
  const firstTs = first.meta?.updatedAt || '';
  const secondTs = second.meta?.updatedAt || '';
  const firstHasAuthoritativeData =
    firstCount > 0 || (first.settings?.deletedRecords?.length || 0) > 0;

  // When `preferFirstAsLiveRtdb` is true and live RTDB (`first`) is populated,
  // ALWAYS treat live RTDB as authoritative so client clock skew on another device's cached Storage file
  // can NEVER overwrite live real-time RTDB mutations!
  const firstIsAuthoritative = options?.preferFirstAsLiveRtdb
    ? firstHasAuthoritativeData
    : firstTs > secondTs && firstHasAuthoritativeData;
  const secondIsAuthoritative =
    !firstIsAuthoritative &&
    secondTs > firstTs &&
    (secondCount > 0 || (second.settings?.deletedRecords?.length || 0) > 0);

  const primary = secondIsAuthoritative
    ? second
    : firstIsAuthoritative || firstTs >= secondTs
    ? first
    : second;
  const secondary = primary === first ? second : first;

  // If primary is strictly newer & healthy (or carries explicit deletion tombstones),
  // do NOT blindly union stale records from the older secondary snapshot!
  const useStrictPrimaryRecords =
    (firstIsAuthoritative || secondIsAuthoritative) &&
    (countWorkspaceBusinessRecords(primary) > 0 || mergedTombstones.length > 0);

  const mergedWipedAt = maxIsoTimestamp(first.settings?.dataWipedAt, second.settings?.dataWipedAt);

  const mergeCol = <T extends { id: string; updatedAt?: string; createdAt?: string }>(
    primList: T[] | undefined,
    secList: T[] | undefined
  ): T[] => {
    if (useStrictPrimaryRecords) {
      return filterRecordsCreatedAfterWipe(
        attachOwnerId(
          filterOutDeletedRecords(dedupeRecordsById(primList || []), mergedTombstones),
          ownerUid
        ),
        mergedWipedAt
      );
    }
    return filterRecordsCreatedAfterWipe(
      attachOwnerId(
        filterOutDeletedRecords(
          dedupeRecordsById([...(secList || []), ...(primList || [])]),
          mergedTombstones
        ),
        ownerUid
      ),
      mergedWipedAt
    );
  };

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
    products: mergeCol(primary.products, secondary.products),
    customers: mergeCol(primary.customers, secondary.customers),
    suppliers: mergeCol(primary.suppliers, secondary.suppliers),
    sales: mergeCol(primary.sales, secondary.sales),
    imports: mergeCol(primary.imports, secondary.imports),
    receiptVouchers: mergeCol(primary.receiptVouchers, secondary.receiptVouchers),
    paymentVouchers: mergeCol(primary.paymentVouchers, secondary.paymentVouchers),
    savedVouchers: mergeCol(primary.savedVouchers, secondary.savedVouchers),
    stockAdjustments: mergeCol(primary.stockAdjustments, secondary.stockAdjustments),
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
      ...(primary.settings?.bankQrConfig || secondary.settings?.bankQrConfig
        ? { bankQrConfig: primary.settings?.bankQrConfig || secondary.settings?.bankQrConfig }
        : {}),
      ...(primary.settings?.productNoteTemplates || secondary.settings?.productNoteTemplates
        ? {
            productNoteTemplates:
              primary.settings?.productNoteTemplates || secondary.settings?.productNoteTemplates,
          }
        : {}),
      ...(mergedTombstones.length > 0 ? { deletedRecords: mergedTombstones } : {}),
      ...(mergedWipedAt ? { dataWipedAt: mergedWipedAt } : {}),
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

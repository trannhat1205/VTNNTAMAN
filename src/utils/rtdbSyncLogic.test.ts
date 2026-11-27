import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  aggregateAdminWorkspacesFromRtdb,
  applyDataWipeEpochToPayload,
  buildFullKeyedWorkspace,
  buildRecoveredVtnnTamAn99Workspace,
  buildStorageWorkspacePaths,
  buildWorkspaceDiffUpdates,
  countWorkspaceBusinessRecords,
  filterOutDeletedRecords,
  filterRecordsCreatedAfterWipe,
  isDestructiveEmptyWorkspaceOverwrite,
  isLegacyArrayWorkspaceLayout,
  maxIsoTimestamp,
  mergeDeletionTombstones,
  mergeDirectoryIntoStaffList,
  mergeWorkspacePayloads,
  normalizeIndependentWarehouseStaffMember,
  normalizeWorkspaceFromRtdb,
  partitionAdminStateByWorkspace,
  resolveCanonicalOwnerUidForWarehouse,
  resolveDesignatedOwnerUidsForWarehouses,
  RTDB_RECORD_COLLECTIONS,
  RtdbWorkspacePayload,
  toRtdbRecordKey,
  toRtdbUserDirectoryProfile,
  VTNNTAMAN99_UID,
} from './rtdbSyncLogic';
import {
  canStaffFilterMultiWarehouses,
  canStaffRenameWarehouse,
  computeAtomicProductImportAddition,
  computeAtomicProductStockDelta,
  dedupeWarehouseNames,
  evaluateStaffAccessScope,
  filterRecordsBySelectedWarehouses,
  formatSelectedWarehousesBadge,
  generateSequentialVoucherCode,
  generateUniqueRecordId,
  getIndependentWarehouseFullPermissions,
  getSelfWarehouseRenameCount,
  getStaffAllowedWarehouses,
  hasMultiWarehouseManagementGrant,
  normalizeWarehouseKey,
  PRIMARY_ADMIN_UID,
  resolveCanonicalSelectWarehouseValue,
} from './businessLogic';
import type { AuditLogEntry, BackupEntry, SaleTransaction } from '../types';

function makeBasePayload(): RtdbWorkspacePayload {
  return {
    meta: {
      ownerUid: 'uid_kho_1',
      ownerEmail: 'kho1@gmail.com',
      ownerDisplayName: 'Chủ Kho 1',
      assignedWarehouse: 'TÂM AN KHO 1',
      updatedAt: '2026-11-26T01:00:00Z',
      updatedByUid: 'uid_kho_1',
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
      warehouses: ['TÂM AN KHO 1'],
      customerGroups: ['Nhà nông'],
      productCategories: ['Phân bón'],
      receiptGroups: ['Thu bán hàng'],
      paymentGroups: ['Chi nhập hàng'],
      notificationPrefs: {
        uid: 'uid_kho_1',
        debtCustomerEnabled: true,
        debtSupplierEnabled: true,
        lowStockEnabled: true,
        periodicReportEnabled: true,
        browserPushEnabled: false,
        leadDays: 3,
        updatedAt: '2026-11-26T01:00:00Z',
      },
      autoDailyBackupEnabled: true,
    },
  };
}

function makeSale(id: string, totalAmount = 100000): SaleTransaction {
  return {
    id,
    invoiceCode: `HD-${id}`,
    customerId: 'c1',
    customerName: 'Anh Ba',
    customerPhone: '0909',
    productId: 'p1',
    productName: 'NPK 20-20-15',
    unit: 'Bao',
    quantity: 1,
    unitPrice: totalAmount,
    totalAmount,
    paidAmount: totalAmount,
    debtAmount: 0,
    dueDate: '2026-12-01',
    status: 'paid',
    warehouseName: 'TÂM AN KHO 1',
    note: '',
    staffName: 'Chủ Kho 1',
    ownerId: 'uid_kho_1',
    createdAt: '2026-11-26T01:00:00Z',
    updatedAt: '2026-11-26T01:00:00Z',
  };
}

function applyRtdbUpdates(target: Record<string, unknown>, updates: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(target)) as Record<string, unknown>;
  for (const [rawPath, value] of Object.entries(updates)) {
    const parts = rawPath.split('/').filter(Boolean);
    let cursor: Record<string, unknown> = clone;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) {
        cursor[part] = {};
      }
      cursor = cursor[part] as Record<string, unknown>;
    }
    const leaf = parts[parts.length - 1];
    if (value === null) {
      delete cursor[leaf];
    } else {
      cursor[leaf] = JSON.parse(JSON.stringify(value));
    }
  }
  return clone;
}

test('RTDB per-record sync: full keyed layout, record key sanitization, and limits', () => {
  const base = makeBasePayload();
  const dirtyId = 's.a#l$e[1]/2';
  assert.equal(toRtdbRecordKey(dirtyId), 'k_s_a_l_e_1__2');

  const logs: AuditLogEntry[] = Array.from({ length: 505 }, (_, i) => ({
    id: `log_${i}`,
    timestamp: '2026-11-26T01:00:00Z',
    actorUid: 'uid_kho_1',
    actorUsername: 'kho1',
    actorDisplayName: 'Kho 1',
    actorEmail: 'kho1@gmail.com',
    actorRoleLabel: 'Quản lý kho',
    warehouseName: 'TÂM AN KHO 1',
    category: 'create_record',
    targetEntity: 'sale',
    targetCode: `HD-${i}`,
    actionTitle: 'Tạo đơn',
    details: 'Chi tiết',
  }));
  const backupWithSnapshot: BackupEntry = {
    id: 'bk_1',
    fileName: 'bk.json',
    driveFileId: 'drive_1',
    targetEmail: 'kho1@gmail.com',
    recordCount: 1,
    status: 'completed',
    triggerType: 'manual',
    ownerId: 'uid_kho_1',
    createdAt: '2026-11-26T01:00:00Z',
    snapshotPayload: {
      version: '2.0',
      exportedAt: '2026-11-26T01:00:00Z',
      exportedByEmail: 'kho1@gmail.com',
      fileName: 'bk.json',
      recordCount: 1,
      auditLogCount: 0,
      warehouses: [],
      customerGroups: [],
      productCategories: [],
      products: [],
      customers: [],
      suppliers: [],
      sales: [],
      imports: [],
      savedVouchers: [],
      staffList: [],
      auditLogs: [],
    },
  };

  const payload: RtdbWorkspacePayload = {
    ...base,
    sales: [makeSale(dirtyId)],
    auditLogs: logs,
    backups: [backupWithSnapshot],
  };

  const full = buildWorkspaceDiffUpdates(null, payload) as Record<string, Record<string, unknown>>;
  assert.ok(full.sales[toRtdbRecordKey(dirtyId)]);
  assert.equal(Object.keys(full.auditLogs).length, 500);
  const storedBackup = full.backups[toRtdbRecordKey('bk_1')] as Record<string, unknown>;
  assert.equal('snapshotPayload' in storedBackup, false);
});

test('RTDB per-record sync: unchanged diff writes only meta; add/modify/delete emit exact paths', () => {
  const base = makeBasePayload();
  const s1 = makeSale('s1', 100000);
  const s2 = makeSale('s2', 200000);
  const prev: RtdbWorkspacePayload = { ...base, sales: [s1, s2] };

  const unchangedDiff = buildWorkspaceDiffUpdates(prev, prev);
  assert.deepEqual(Object.keys(unchangedDiff), ['meta']);

  const s1Modified = { ...s1, totalAmount: 150000 };
  const s3Added = makeSale('s3', 300000);
  const next: RtdbWorkspacePayload = {
    ...base,
    sales: [s1Modified, s3Added], // s2 deleted
  };
  const diff = buildWorkspaceDiffUpdates(prev, next);
  assert.ok(diff['sales/k_s1']);
  assert.ok(diff['sales/k_s3']);
  assert.equal(diff['sales/k_s2'], null);
  assert.equal(Object.keys(diff).length, 4); // meta + k_s1 + k_s3 + k_s2(null)
});

test('RTDB concurrent multi-device merge preserves both devices records and safe deletes', () => {
  const sBaseKeep = makeSale('base_keep', 100000);
  const sBaseDelete = makeSale('base_del', 50000);
  const base: RtdbWorkspacePayload = { ...makeBasePayload(), sales: [sBaseKeep, sBaseDelete] };

  let serverNode = buildFullKeyedWorkspace(base);

  // Device A adds sale1 and deletes sBaseDelete; Device B concurrently adds sale2
  const devA: RtdbWorkspacePayload = { ...base, sales: [sBaseKeep, makeSale('sale1', 120000)] };
  const devB: RtdbWorkspacePayload = {
    ...base,
    sales: [sBaseKeep, sBaseDelete, makeSale('sale2', 240000)],
  };

  const diffA = buildWorkspaceDiffUpdates(base, devA);
  const diffB = buildWorkspaceDiffUpdates(base, devB);

  serverNode = applyRtdbUpdates(serverNode, diffA);
  serverNode = applyRtdbUpdates(serverNode, diffB);

  const normalized = normalizeWorkspaceFromRtdb(serverNode, 'uid_kho_1');
  const ids = normalized.sales.map((s) => s.id).sort();
  assert.deepEqual(ids, ['base_keep', 'sale1', 'sale2']);
});

test('RTDB legacy array layout detection and database.rules.json schema validation coverage', () => {
  assert.equal(isLegacyArrayWorkspaceLayout({ sales: [makeSale('1')] }), true);
  assert.equal(isLegacyArrayWorkspaceLayout({ sales: { k_1: makeSale('1') } }), false);
  assert.equal(isLegacyArrayWorkspaceLayout(null), false);

  const rulesPath = path.resolve(process.cwd(), 'database.rules.json');
  const rulesObj = JSON.parse(fs.readFileSync(rulesPath, 'utf-8')) as {
    rules: {
      workspaces: {
        $ownerUid: Record<string, { $recKey?: { '.validate'?: string } }>;
      };
      users_directory: { $uid: { '.validate'?: string } };
    };
  };

  for (const col of RTDB_RECORD_COLLECTIONS) {
    assert.ok(rulesObj.rules.workspaces.$ownerUid[col]?.$recKey?.['.validate'], `Missing .validate on ${col}`);
  }
  assert.ok(RTDB_RECORD_COLLECTIONS.includes('stockAdjustments'));
  assert.ok(rulesObj.rules.users_directory.$uid['.validate']);

  // Verify stockAdjustments per-record diff & normalization
  const baseWithAdj: RtdbWorkspacePayload = {
    ...makeBasePayload(),
    stockAdjustments: [
      {
        id: 'kk_test_1',
        adjustmentCode: 'KK-2611-001',
        productId: 'p1',
        productCode: 'VT-01',
        productName: 'NPK 20-20-15',
        unit: 'Bao',
        warehouseName: 'TÂM AN KHO 1',
        systemStockBefore: 10,
        actualCountedStock: 12,
        diffQty: 2,
        unitCost: 500000,
        diffValue: 1000000,
        reason: 'Kiểm kê định kỳ',
        note: '',
        staffName: 'Chủ Kho 1',
        ownerId: 'uid_kho_1',
        createdAt: '2026-11-26T02:00:00Z',
        updatedAt: '2026-11-26T02:00:00Z',
      },
    ],
  };
  const adjDiff = buildWorkspaceDiffUpdates(makeBasePayload(), baseWithAdj);
  assert.ok(adjDiff['stockAdjustments/k_kk_test_1']);
  const serverWithAdj = applyRtdbUpdates(buildFullKeyedWorkspace(makeBasePayload()), adjDiff);
  const normAdj = normalizeWorkspaceFromRtdb(serverWithAdj, 'uid_kho_1');
  assert.equal(normAdj.stockAdjustments?.length, 1);
  assert.equal(normAdj.stockAdjustments?.[0].diffQty, 2);
});

test('Web <-> Phone dual Cloud sync: destructive empty-overwrite guard, Firebase Storage paths, merge & vtnntaman99 recovery', () => {
  const recovered = buildRecoveredVtnnTamAn99Workspace('TÂM AN VTNNTAMAN99');
  assert.equal(recovered.products.length, 8);
  assert.equal(recovered.customers.length, 3);
  assert.equal(recovered.imports.length, 3);
  assert.equal(recovered.sales.length, 13);

  const totalStock = recovered.products.reduce((s, p) => s + p.stock, 0);
  const totalInvCost = recovered.products.reduce((s, p) => s + p.stock * p.importPrice, 0);
  const totalSalesRev = recovered.sales.reduce((s, r) => s + r.totalAmount, 0);
  const totalCustDebt = recovered.sales.reduce((s, r) => s + r.debtAmount, 0);
  const totalSupDebt = recovered.imports.reduce((s, i) => s + i.debtAmount, 0);

  assert.equal(totalStock, 231);
  assert.equal(totalInvCost, 30820000);
  assert.equal(totalSalesRev, 1707183);
  assert.equal(totalCustDebt, 230000);
  assert.equal(totalSupDebt, 575000);
  assert.equal(countWorkspaceBusinessRecords(recovered), 28);

  // Guard blocks empty phone state from overwriting non-empty cloud workspace unless allowIntentionalWipe is true
  const emptyPhonePayload = makeBasePayload();
  assert.equal(isDestructiveEmptyWorkspaceOverwrite(recovered, emptyPhonePayload, false), true);
  assert.equal(isDestructiveEmptyWorkspaceOverwrite(recovered, emptyPhonePayload, true), false);

  // Storage paths under /documents/workspaces/ and /backups/{uid}/
  const paths = buildStorageWorkspacePaths({
    uid: VTNNTAMAN99_UID,
    email: 'vtnntaman99@gmail.com',
    assignedWarehouse: 'TÂM AN MỸ NGÃI',
  });
  assert.equal(paths.uidPath, `documents/workspaces/uid_${VTNNTAMAN99_UID}.json`);
  assert.equal(paths.emailPath, 'documents/workspaces/email_vtnntaman99_gmail_com.json');
  assert.equal(paths.warehousePath, 'documents/workspaces/warehouse_TAM_AN_MY_NGAI.json');
  assert.equal(paths.backupPath, `backups/${VTNNTAMAN99_UID}/VTNN_TamAn_AutoSync_Latest.json`);

  // Merge empty RTDB with populated Storage payload restores all records
  const merged = mergeWorkspacePayloads(emptyPhonePayload, recovered, VTNNTAMAN99_UID);
  assert.ok(merged);
  assert.equal(merged.sales.length, 13);
  assert.equal(merged.products.length, 8);

  // Single-warehouse owner sees records owned by their UID even if warehouseName was renamed on another device
  const staffOnPhone = {
    uid: VTNNTAMAN99_UID,
    username: 'vtnntaman99',
    password: '',
    displayName: 'An Tâm',
    phone: '',
    email: 'vtnntaman99@gmail.com',
    role: 'manager' as const,
    positionRole: 'warehouse_manager' as const,
    permissions: getIndependentWarehouseFullPermissions(),
    assignedWarehouse: 'TÂM AN VTNNTAMAN99',
    active: true,
    createdAt: '2026-11-26T00:00:00Z',
    updatedAt: '2026-11-26T00:00:00Z',
  };
  const recordsWithOldWhName = recovered.sales.map((s) => ({
    ...s,
    warehouseName: 'TÂM AN MỸ NGÃI',
  }));
  const visibleOnPhone = filterRecordsBySelectedWarehouses(
    recordsWithOldWhName,
    staffOnPhone,
    ['TÂM AN VTNNTAMAN99'],
    []
  );
  assert.equal(visibleOnPhone.length, 13);
});

test('Deletion tombstones & Storage sync: deleted records NEVER resurrect from older Firebase Storage snapshots and restore works', () => {
  const olderStorageSnap = buildRecoveredVtnnTamAn99Workspace('TÂM AN VTNNTAMAN99');
  // Simulate Admin deleting HD-2611-001 (sale_v99_hd001_tt) and PN-2611-001 (imp_v99_pn001) on Web/Phone
  const deletedAtIso = '2026-11-26T10:32:32.000Z';
  const newerRtdbSnap: RtdbWorkspacePayload = {
    ...olderStorageSnap,
    meta: { ...olderStorageSnap.meta, updatedAt: deletedAtIso },
    sales: olderStorageSnap.sales.filter((s) => s.id !== 'sale_v99_hd001_tt'),
    imports: olderStorageSnap.imports.filter((i) => i.id !== 'imp_v99_pn001'),
    settings: {
      ...olderStorageSnap.settings,
      deletedRecords: [
        { id: 'sale_v99_hd001_tt', deletedAt: deletedAtIso },
        { id: 'imp_v99_pn001', deletedAt: deletedAtIso },
      ],
    },
  };

  // Even when merging newer RTDB with stale Storage snapshot that still has deleted records, deleted items MUST stay gone
  const merged1 = mergeWorkspacePayloads(newerRtdbSnap, olderStorageSnap, VTNNTAMAN99_UID);
  assert.ok(merged1);
  assert.equal(merged1.sales.some((s) => s.id === 'sale_v99_hd001_tt'), false);
  assert.equal(merged1.imports.some((i) => i.id === 'imp_v99_pn001'), false);
  assert.equal(merged1.sales.length, 12);
  assert.equal(merged1.imports.length, 2);

  // Even if timestamps are equal, tombstones still strip deleted items cleanly
  const sameTsStorage: RtdbWorkspacePayload = {
    ...olderStorageSnap,
    meta: { ...olderStorageSnap.meta, updatedAt: deletedAtIso },
  };
  const merged2 = mergeWorkspacePayloads(sameTsStorage, newerRtdbSnap, VTNNTAMAN99_UID);
  assert.ok(merged2);
  assert.equal(merged2.sales.some((s) => s.id === 'sale_v99_hd001_tt'), false);
  assert.equal(merged2.imports.some((i) => i.id === 'imp_v99_pn001'), false);

  // If Admin explicitly restores a deleted item later with updatedAt > deletedAt, filterOutDeletedRecords allows it back
  const tombstones = mergeDeletionTombstones(newerRtdbSnap.settings.deletedRecords);
  const restoredSale = {
    ...olderStorageSnap.sales.find((s) => s.id === 'sale_v99_hd001_tt')!,
    updatedAt: '2026-11-26T11:00:00.000Z',
  };
  const afterRestore = filterOutDeletedRecords([restoredSale], tombstones);
  assert.equal(afterRestore.length, 1);
});

test('Multi-warehouse RBAC: ONLY Primary Admin & designated multi-warehouse managers can edit/delete vouchers', () => {
  const allWhs = [
    'TÂM AN PHUCANTAMGROUP',
    'TÂM AN NHÂN QUẢ 3',
    'TÂM AN HONGHUY2802',
    'TÂM AN TTNHON55555',
    'TÂM AN MỸ NGÃI',
  ];

  // 1. Regular single-warehouse account (even if stale edit_delete_vouchers existed in legacy storage)
  const singleWhUser = normalizeIndependentWarehouseStaffMember({
    uid: 'uid_tuan',
    username: 'tuanngacm_230',
    password: '',
    displayName: 'Tuấn',
    phone: '',
    email: 'tuanngacm@gmail.com',
    role: 'manager',
    positionRole: 'warehouse_manager',
    permissions: [...getIndependentWarehouseFullPermissions(), 'edit_delete_vouchers'],
    assignedWarehouse: 'TÂM AN TUANNGACM',
    active: true,
    createdAt: '2026-11-26T00:00:00Z',
    updatedAt: '2026-11-26T00:00:00Z',
  });
  assert.equal(hasMultiWarehouseManagementGrant(singleWhUser), false);
  assert.equal(singleWhUser.role, 'staff');
  assert.equal(singleWhUser.permissions?.includes('edit_delete_vouchers'), false);
  const singleScope = evaluateStaffAccessScope(singleWhUser);
  assert.equal(singleScope.canEditDeleteVouchers, false);
  assert.equal(canStaffFilterMultiWarehouses(singleWhUser), false);

  // 2. Same account after Primary Admin grants 4 designated warehouses
  const multiWhUser = normalizeIndependentWarehouseStaffMember({
    ...singleWhUser,
    role: 'manager',
    assignedWarehouse: 'TÂM AN PHUCANTAMGROUP',
    assignedWarehouses: [
      'TÂM AN PHUCANTAMGROUP',
      'TÂM AN NHÂN QUẢ 3',
      'TÂM AN HONGHUY2802',
      'TÂM AN TTNHON55555',
    ],
    multiWarehouseGrantedByAdmin: true,
    permissions: [...getIndependentWarehouseFullPermissions(), 'edit_delete_vouchers'],
  });
  assert.equal(hasMultiWarehouseManagementGrant(multiWhUser), true);
  assert.equal(multiWhUser.role, 'manager');
  assert.equal(multiWhUser.permissions?.includes('edit_delete_vouchers'), true);
  const multiScope = evaluateStaffAccessScope(multiWhUser);
  assert.equal(multiScope.canEditDeleteVouchers, true);
  assert.equal(canStaffFilterMultiWarehouses(multiWhUser), true);

  // Allowed warehouses strictly scoped to the 4 granted warehouses (NOT 'TÂM AN MỸ NGÃI')
  const allowed = getStaffAllowedWarehouses(multiWhUser, allWhs);
  assert.equal(allowed.length, 4);
  assert.equal(allowed.includes('TÂM AN MỸ NGÃI'), false);
  assert.equal(formatSelectedWarehousesBadge(multiWhUser, allWhs, []), '4 kho được cấp');

  const sampleRecs = allWhs.map((w, idx) => ({ id: `r${idx}`, warehouseName: w }));
  const filtered = filterRecordsBySelectedWarehouses(sampleRecs, multiWhUser, allWhs, []);
  assert.equal(filtered.length, 4);
  assert.equal(filtered.some((r) => r.warehouseName === 'TÂM AN MỸ NGÃI'), false);
});

test('Case-insensitive multi-warehouse matching & owner UID resolution: "Tâm An Mỹ Ngãi" matches "TÂM AN MỸ NGÃI" (vtnntaman99)', () => {
  // 1. Normalization & deduplication unify Title Case and ALL CAPS variants
  assert.equal(normalizeWarehouseKey('Tâm An Mỹ Ngãi'), normalizeWarehouseKey('TÂM AN MỸ NGÃI'));
  const deduped = dedupeWarehouseNames([
    'Tâm An Mỹ Ngãi',
    'TÂM AN MỸ NGÃI',
    'Tâm An Cao Lãnh',
    'Tâm An Mỹ Trà',
  ]);
  assert.equal(deduped.length, 3);
  assert.equal(deduped[0], 'TÂM AN MỸ NGÃI');

  // 2. Granting "Tâm An Mỹ Ngãi" (Title Case) resolves @vtnntaman99's UID whose warehouse is "TÂM AN MỸ NGÃI" (ALL CAPS)
  const v99Ws = buildRecoveredVtnnTamAn99Workspace('TÂM AN MỸ NGÃI');
  const ownerMap = resolveDesignatedOwnerUidsForWarehouses({
    targetUid: 'LAiiKyabFmg4XxjkaTEgIcW4DnK2',
    selectedWarehouses: ['TÂM AN NHATTAMNHANQUA99', 'Tâm An Mỹ Ngãi', 'Tâm An Cao Lãnh'],
    staffList: [
      {
        uid: VTNNTAMAN99_UID,
        username: 'vtnntaman99',
        password: '',
        displayName: 'Nguyễn Trịnh Huỳnh Như',
        phone: '0708959764',
        email: 'vtnntaman99@gmail.com',
        role: 'staff',
        positionRole: 'warehouse_manager',
        assignedWarehouse: 'TÂM AN MỸ NGÃI',
        active: true,
        createdAt: '2026-11-26T00:00:00Z',
        updatedAt: '2026-11-26T00:00:00Z',
      },
    ],
    workspacesMap: {
      [VTNNTAMAN99_UID]: v99Ws,
    },
  });
  assert.equal(ownerMap['LAiiKyabFmg4XxjkaTEgIcW4DnK2'], true);
  assert.equal(ownerMap[VTNNTAMAN99_UID], true);

  // 3. Filtering records when designated user selects Title Case "Tâm An Mỹ Ngãi" STILL returns all 8 products & 13 sales tagged "TÂM AN MỸ NGÃI"
  const designatedManager = normalizeIndependentWarehouseStaffMember({
    uid: 'LAiiKyabFmg4XxjkaTEgIcW4DnK2',
    username: 'nhattamnhanqua99',
    password: '',
    displayName: 'Tâm Nhất',
    phone: '',
    email: 'nhattamnhanqua99@gmail.com',
    role: 'manager',
    positionRole: 'warehouse_manager',
    permissions: [...getIndependentWarehouseFullPermissions(), 'edit_delete_vouchers'],
    assignedWarehouse: 'TÂM AN NHATTAMNHANQUA99',
    assignedWarehouses: [
      'TÂM AN NHATTAMNHANQUA99',
      'Tâm An Mỹ Ngãi',
      'Tâm An Cao Lãnh',
      'Tâm An Mỹ Trà',
    ],
    assignedOwnerUids: ownerMap,
    multiWarehouseGrantedByAdmin: true,
    active: true,
    createdAt: '2026-11-26T00:00:00Z',
    updatedAt: '2026-11-26T00:00:00Z',
  });
  const allWhs = [
    'TÂM AN NHATTAMNHANQUA99',
    'Tâm An Mỹ Ngãi',
    'TÂM AN MỸ NGÃI',
    'Tâm An Cao Lãnh',
    'Tâm An Mỹ Trà',
  ];
  const visibleWhenFilteredSingle = filterRecordsBySelectedWarehouses(
    v99Ws.products,
    designatedManager,
    allWhs,
    ['Tâm An Mỹ Ngãi']
  );
  assert.equal(visibleWhenFilteredSingle.length, 8);
  const visibleSalesWhenAll = filterRecordsBySelectedWarehouses(
    v99Ws.sales,
    designatedManager,
    allWhs,
    []
  );
  assert.equal(visibleSalesWhenAll.length, 13);

  // 4. partitionAdminStateByWorkspace preserves existingMetaByUid for another owner's workspace even if staffList omits them
  const partitioned = partitionAdminStateByWorkspace({
    products: v99Ws.products,
    customers: v99Ws.customers,
    suppliers: v99Ws.suppliers,
    sales: v99Ws.sales,
    imports: v99Ws.imports,
    receiptVouchers: [],
    paymentVouchers: [],
    savedVouchers: [],
    auditLogs: [],
    backups: [],
    settings: v99Ws.settings,
    staffList: [designatedManager],
    knownOwnerUids: ['LAiiKyabFmg4XxjkaTEgIcW4DnK2', VTNNTAMAN99_UID],
    adminUid: 'LAiiKyabFmg4XxjkaTEgIcW4DnK2',
    nowIso: '2026-11-26T17:00:00.000Z',
    existingMetaByUid: {
      [VTNNTAMAN99_UID]: {
        ownerUid: VTNNTAMAN99_UID,
        ownerEmail: 'vtnntaman99@gmail.com',
        ownerDisplayName: 'Nguyễn Trịnh Huỳnh Như',
        assignedWarehouse: 'TÂM AN MỸ NGÃI',
        updatedAt: '2026-11-26T16:00:00.000Z',
        updatedByUid: VTNNTAMAN99_UID,
        schemaVersion: 1,
      },
    },
  });
  assert.equal(partitioned[VTNNTAMAN99_UID].meta.assignedWarehouse, 'TÂM AN MỸ NGÃI');
  assert.equal(partitioned[VTNNTAMAN99_UID].meta.ownerEmail, 'vtnntaman99@gmail.com');
  assert.equal(partitioned[VTNNTAMAN99_UID].products.length, 8);

  // 5. Security: PRIMARY_ADMIN_UID is NEVER exposed in non-admin assignedOwnerUids
  const ownerMapWithAdminRec = resolveDesignatedOwnerUidsForWarehouses({
    targetUid: 'LAiiKyabFmg4XxjkaTEgIcW4DnK2',
    selectedWarehouses: ['TÂM AN MỸ NGÃI'],
    staffList: [],
    records: [
      { warehouseName: 'Tâm An Mỹ Ngãi', ownerId: PRIMARY_ADMIN_UID },
      { warehouseName: 'TÂM AN MỸ NGÃI', ownerId: VTNNTAMAN99_UID },
    ],
  });
  assert.equal(ownerMapWithAdminRec[VTNNTAMAN99_UID], true);
  assert.equal(ownerMapWithAdminRec[PRIMARY_ADMIN_UID], undefined);
});

test('One-time warehouse rename policy, Primary Admin unlimited renames, canonical select fallback, and RTDB rules enforcement', () => {
  const primaryAdmin = {
    uid: PRIMARY_ADMIN_UID,
    username: 'admin',
    password: '',
    displayName: 'Trần Đình Nhất',
    email: 'trannhat1205@gmail.com',
    phone: '0393120246',
    role: 'manager' as const,
    positionRole: 'primary_manager' as const,
    assignedWarehouse: 'Tất cả kho',
    active: true,
    createdAt: '2026-11-25T00:00:00Z',
    updatedAt: '2026-11-25T00:00:00Z',
  };

  // 1. Brand-new registered account with default Gmail warehouse name -> 0/1 used -> allowed ONCE
  const freshUser = {
    uid: 'uid_new_user_1',
    username: 'taman010205',
    password: '',
    displayName: 'Tâm An Mới',
    email: 'taman010205@gmail.com',
    phone: '',
    role: 'staff' as const,
    positionRole: 'warehouse_manager' as const,
    assignedWarehouse: 'TÂM AN TAMAN010205',
    warehouseRenameCount: 0,
    active: true,
    createdAt: '2026-11-26T00:00:00Z',
    updatedAt: '2026-11-26T00:00:00Z',
  };
  assert.equal(getSelfWarehouseRenameCount(freshUser), 0);
  const firstCheck = canStaffRenameWarehouse(freshUser, freshUser);
  assert.equal(firstCheck.allowed, true);
  assert.equal(firstCheck.remainingSelfRenames, 1);

  // 2. After using their 1 rename -> LOCKED for self (even if granted multi-warehouse later!)
  const renamedOnceUser = {
    ...freshUser,
    assignedWarehouse: 'TÂM AN BA SAO',
    warehouseRenameCount: 1,
    multiWarehouseGrantedByAdmin: true,
    assignedWarehouses: ['TÂM AN BA SAO', 'TÂM AN MỸ NGÃI'],
  };
  assert.equal(getSelfWarehouseRenameCount(renamedOnceUser), 1);
  const secondSelfCheck = canStaffRenameWarehouse(renamedOnceUser, renamedOnceUser);
  assert.equal(secondSelfCheck.allowed, false);
  assert.equal(secondSelfCheck.remainingSelfRenames, 0);

  // 3. Legacy account without warehouseRenameCount that ALREADY changed away from Gmail default -> inferred 1/1 LOCKED
  const legacyRenamedUser = {
    ...freshUser,
    uid: 'gBW4G38AvAfmHqMJ5FXyMj0Wovn1',
    username: 'hanhandt0211',
    email: 'hanhandt0211@gmail.com',
    assignedWarehouse: 'TÂM AN HAN',
    warehouseRenameCount: undefined,
  };
  assert.equal(getSelfWarehouseRenameCount(legacyRenamedUser), 1);
  assert.equal(canStaffRenameWarehouse(legacyRenamedUser, legacyRenamedUser).allowed, false);

  // 4. Legacy account with auto-fallback TÂM AN USER_O0XY7Z -> still gets 1 free rename
  const legacyFallbackUser = {
    ...freshUser,
    uid: 'O0xy7zgvgbhwedEYRzAn1afNqvd2',
    username: 'user_O0xy7z',
    email: 'phucantamgroup@gmail.com',
    assignedWarehouse: 'TÂM AN USER_O0XY7Z',
    warehouseRenameCount: undefined,
  };
  assert.equal(getSelfWarehouseRenameCount(legacyFallbackUser), 0);
  assert.equal(canStaffRenameWarehouse(legacyFallbackUser, legacyFallbackUser).allowed, true);

  // 5. ONLY Primary Admin can rename ANY account's warehouse unlimited times (even after user used 1/1!)
  const adminCheck = canStaffRenameWarehouse(renamedOnceUser, primaryAdmin);
  assert.equal(adminCheck.allowed, true);
  assert.equal(adminCheck.isPrimaryAdminActor, true);

  // 6. Another non-admin user CANNOT rename someone else's warehouse
  const anotherNonAdmin = { ...renamedOnceUser, uid: 'uid_other_user_2' };
  assert.equal(canStaffRenameWarehouse(freshUser, anotherNonAdmin).allowed, false);

  // 7. Canonical <select> value resolution prevents Title Case "Tâm An Mỹ Ngãi" from falling back to "Tất cả kho"
  const dropdownOpts = ['TÂM AN MỸ NGÃI', 'Tâm An Cao Lãnh', 'TÂM AN CHUNG'];
  assert.equal(
    resolveCanonicalSelectWarehouseValue('Tâm An Mỹ Ngãi', dropdownOpts),
    'TÂM AN MỸ NGÃI'
  );
  assert.equal(resolveCanonicalSelectWarehouseValue('Tất cả kho', dropdownOpts), 'Tất cả kho');

  // 8. Firebase RTDB database.rules.json enforces server-side warehouseRenameCount lock
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'database.rules.json'), 'utf8');
  assert.equal(rulesText.includes('warehouseRenameCount'), true);
});

test('Phase 1 — Shared single-warehouse canonical routing, atomic stock/cost mutators, collision-free IDs, granular settings diffing, and clock-skew-safe RTDB priority', () => {
  // 1. Canonical owner resolution when 2+ accounts co-manage the SAME single warehouse ("TÂM AN MỸ NGÃI")
  const v99Ws = buildRecoveredVtnnTamAn99Workspace('TÂM AN MỸ NGÃI');
  const ownerStaff = {
    uid: VTNNTAMAN99_UID,
    username: 'vtnntaman99',
    password: '',
    displayName: 'Chủ kho Mỹ Ngãi',
    phone: '0708959764',
    email: 'vtnntaman99@gmail.com',
    role: 'staff' as const,
    positionRole: 'warehouse_manager' as const,
    permissions: getIndependentWarehouseFullPermissions(),
    assignedWarehouse: 'TÂM AN MỸ NGÃI',
    active: true,
    createdAt: '2026-11-25T00:00:00Z',
    updatedAt: '2026-11-25T00:00:00Z',
  };
  const coStaffRaw = {
    uid: 'uid_costaff_banhang_01',
    username: 'nhanvien_myngai',
    password: '',
    displayName: 'Nhân viên Bán hàng Mỹ Ngãi',
    phone: '0901234567',
    email: 'nhanvien.myngai@gmail.com',
    role: 'staff' as const,
    positionRole: 'sales_warehouse_staff' as const,
    permissions: getIndependentWarehouseFullPermissions(),
    assignedWarehouse: 'Tâm An Mỹ Ngãi', // Mixed case!
    assignedOwnerUids: { uid_costaff_banhang_01: true, [VTNNTAMAN99_UID]: true },
    canonicalOwnerUid: VTNNTAMAN99_UID,
    multiWarehouseGrantedByAdmin: false,
    active: true,
    createdAt: '2026-11-27T00:00:00Z',
    updatedAt: '2026-11-27T00:00:00Z',
  };

  // Even when coStaff appears FIRST in staffList, canonical resolution picks VTNNTAMAN99_UID (populated owner)
  const resolvedCanon = resolveCanonicalOwnerUidForWarehouse({
    warehouseName: 'Tâm An Mỹ Ngãi',
    staffList: [coStaffRaw, ownerStaff],
    workspacesMap: {
      [VTNNTAMAN99_UID]: v99Ws,
      uid_costaff_banhang_01: makeBasePayload(),
    },
    fallbackUid: 'uid_costaff_banhang_01',
  });
  assert.equal(resolvedCanon, VTNNTAMAN99_UID);

  // Single-warehouse co-staff retains canonicalOwnerUid & assignedOwnerUids through directory round-trip,
  // while STILL keeping single-warehouse RBAC (no edit_delete_vouchers!)
  const dirProfile = toRtdbUserDirectoryProfile(coStaffRaw);
  assert.equal(dirProfile.canonicalOwnerUid, VTNNTAMAN99_UID);
  assert.equal(dirProfile.assignedOwnerUids?.[VTNNTAMAN99_UID], true);
  assert.equal(dirProfile.multiWarehouseGrantedByAdmin, false);
  const mergedBack = mergeDirectoryIntoStaffList([], [dirProfile]);
  assert.equal(mergedBack[0].canonicalOwnerUid, VTNNTAMAN99_UID);
  assert.equal(mergedBack[0].assignedOwnerUids?.[VTNNTAMAN99_UID], true);
  assert.equal(evaluateStaffAccessScope(mergedBack[0]).canEditDeleteVouchers, false);

  // Records created by coStaff on "Tâm An Mỹ Ngãi" consolidate into VTNNTAMAN99_UID's workspace bucket!
  const coStaffSale: SaleTransaction = {
    ...makeSale('sale_by_costaff', 430000),
    warehouseName: 'Tâm An Mỹ Ngãi',
    ownerId: 'uid_costaff_banhang_01',
  };
  const partitionedShared = partitionAdminStateByWorkspace({
    products: v99Ws.products,
    customers: v99Ws.customers,
    suppliers: v99Ws.suppliers,
    sales: [...v99Ws.sales, coStaffSale],
    imports: v99Ws.imports,
    receiptVouchers: [],
    paymentVouchers: [],
    savedVouchers: [],
    auditLogs: [],
    backups: [],
    settings: v99Ws.settings,
    staffList: [mergedBack[0], ownerStaff],
    knownOwnerUids: [VTNNTAMAN99_UID, 'uid_costaff_banhang_01'],
    adminUid: 'uid_costaff_banhang_01',
    nowIso: '2026-11-27T05:00:00Z',
  });
  assert.equal(partitionedShared[VTNNTAMAN99_UID].sales.length, 14);
  assert.equal(
    partitionedShared[VTNNTAMAN99_UID].sales.some((s) => s.id === 'sale_by_costaff'),
    true
  );
  assert.equal(partitionedShared['uid_costaff_banhang_01'].sales.length, 0);

  // 2. Atomic server-side stock & weighted-average cost mutators + skipProductKeys lock
  const serverProd0 = {
    ...v99Ws.products[0], // BUP PRO, stock=26, importPrice=215000
    stock: 20,
    importPrice: 200000,
  };
  // Account A imports +10 @ 230,000 -> stock=30, weighted avg = (20*200k + 10*230k)/30 = 210,000
  const serverProd1 = computeAtomicProductImportAddition({
    currentProduct: serverProd0,
    importQty: 10,
    unitCost: 230000,
    nowIso: '2026-11-27T05:01:00Z',
    batchNumber: 'LO-2711',
    expiryDate: '2027-06-30',
  });
  assert.equal(serverProd1.stock, 30);
  assert.equal(serverProd1.importPrice, 210000);
  // Account B sells 2 and Account C sells 3 concurrently on the server node -> 30 - 2 - 3 = 25 (zero lost update!)
  const serverProd2 = computeAtomicProductStockDelta(serverProd1, -2, '2026-11-27T05:01:01Z');
  const serverProd3 = computeAtomicProductStockDelta(serverProd2, -3, '2026-11-27T05:01:02Z');
  assert.equal(serverProd3.stock, 25);
  assert.equal(serverProd3.importPrice, 210000);

  // skipProductKeys prevents debounced workspace diff from clobbering atomic product stock
  const stalePrev: RtdbWorkspacePayload = { ...makeBasePayload(), products: [serverProd0] };
  const staleNext: RtdbWorkspacePayload = {
    ...makeBasePayload(),
    products: [{ ...serverProd0, stock: 18 }],
    sales: [makeSale('s_new', 215000)],
  };
  const lockedDiff = buildWorkspaceDiffUpdates(stalePrev, staleNext, {
    skipProductKeys: new Set([toRtdbRecordKey(serverProd0.id)]),
  });
  assert.equal(`products/${toRtdbRecordKey(serverProd0.id)}` in lockedDiff, false);
  assert.ok(lockedDiff['sales/k_s_new']);

  // 3. Collision-free unique IDs & reserved sequential voucher codes
  const generatedIds = new Set<string>();
  const fixedNow = 1795752000000;
  for (let i = 0; i < 200; i++) {
    const id = generateUniqueRecordId('sale', fixedNow);
    assert.equal(id.length <= 40, true);
    assert.match(id, /^[a-zA-Z0-9_]+$/);
    generatedIds.add(id);
  }
  assert.equal(generatedIds.size, 200);

  const fixedDate = new Date('2026-11-27T05:00:00Z');
  const nextSeqCode = generateSequentialVoucherCode('HD', ['HD-2611-004'], fixedDate, 7);
  assert.equal(nextSeqCode, 'HD-2611-008');

  // 4. Granular settings/* diffing: Account A deletes a record while Account B adds a productNoteTemplate
  const baseSettingsWs = makeBasePayload();
  const wsAfterDeleteByA: RtdbWorkspacePayload = {
    ...baseSettingsWs,
    settings: {
      ...baseSettingsWs.settings,
      deletedRecords: [{ id: 'sale_del_1', deletedAt: '2026-11-27T05:02:00Z' }],
    },
  };
  const wsAfterNoteByB: RtdbWorkspacePayload = {
    ...baseSettingsWs,
    settings: {
      ...baseSettingsWs.settings,
      productNoteTemplates: [
        {
          id: 'tpl_1',
          title: 'Liều phun lúa đòng',
          content: 'Pha 25ml / bình 25 lít',
          updatedAt: '2026-11-27T05:02:01Z',
        },
      ],
    },
  };
  const diffSettingsA = buildWorkspaceDiffUpdates(baseSettingsWs, wsAfterDeleteByA);
  const diffSettingsB = buildWorkspaceDiffUpdates(baseSettingsWs, wsAfterNoteByB);
  assert.ok(diffSettingsA['settings/deletedRecords']);
  assert.equal('settings' in diffSettingsA, false);
  assert.ok(diffSettingsB['settings/productNoteTemplates']);
  assert.equal('settings' in diffSettingsB, false);

  let serverSettingsNode = buildFullKeyedWorkspace(baseSettingsWs);
  serverSettingsNode = applyRtdbUpdates(serverSettingsNode, diffSettingsA);
  serverSettingsNode = applyRtdbUpdates(serverSettingsNode, diffSettingsB);
  const normSettingsMerged = normalizeWorkspaceFromRtdb(serverSettingsNode, 'uid_kho_1');
  assert.equal(normSettingsMerged.settings.deletedRecords?.length, 1);
  assert.equal(normSettingsMerged.settings.productNoteTemplates?.length, 1);

  // 5. Clock-skew-safe live RTDB priority: live RTDB (14 sales, 05:00:00Z) beats skewed cached Storage (13 sales, 05:00:45Z)
  const liveRtdbWithNewSale: RtdbWorkspacePayload = {
    ...v99Ws,
    meta: { ...v99Ws.meta, updatedAt: '2026-11-27T05:00:00.000Z' },
    sales: [...v99Ws.sales, makeSale('sale_live_14', 500000)],
  };
  const skewedOlderStorage: RtdbWorkspacePayload = {
    ...v99Ws,
    meta: { ...v99Ws.meta, updatedAt: '2026-11-27T05:00:45.000Z' }, // Phone clock 45s ahead!
  };
  const skewSafeMerged = mergeWorkspacePayloads(
    liveRtdbWithNewSale,
    skewedOlderStorage,
    VTNNTAMAN99_UID,
    { preferFirstAsLiveRtdb: true }
  );
  assert.ok(skewSafeMerged);
  assert.equal(skewSafeMerged.sales.length, 14);
  assert.equal(skewSafeMerged.sales.some((s) => s.id === 'sale_live_14'), true);

  // 6. Verify database.rules.json contains atomic counters rule and anti-escalation validation on assignedOwnerUids
  const rulesRaw = fs.readFileSync(path.resolve(process.cwd(), 'database.rules.json'), 'utf8');
  const parsedRules = JSON.parse(rulesRaw);
  assert.ok(parsedRules.rules.workspaces.$ownerUid.counters.$counterKey['.validate']);
  assert.ok(
    parsedRules.rules.users_directory.$uid.assignedOwnerUids.$targetOwnerUid['.validate']
  );
});

test('Wipe epoch: dataWipedAt discards pre-wipe business records in filter, normalize, merge and admin aggregate', () => {
  const wipe = '2026-11-27T10:00:00.000Z';
  const recs = [
    { id: 'a', createdAt: '2026-11-27T09:59:59.000Z' },
    { id: 'b', createdAt: wipe },
    { id: 'c', createdAt: '2026-11-27T10:00:01.000Z' },
    { id: 'd', createdAt: '2026-11-28' },
    { id: 'e', createdAt: '2026-11-27' },
  ];
  assert.deepEqual(
    filterRecordsCreatedAfterWipe(recs, wipe).map((r) => r.id),
    ['c', 'd']
  );
  assert.equal(filterRecordsCreatedAfterWipe(recs, '').length, 5);
  assert.equal(maxIsoTimestamp('2026-01-01', '', '2026-03-01', undefined), '2026-03-01');

  const oldSale = { id: 'sale_old', createdAt: '2026-11-26T01:00:00.000Z' };
  const newSale = { id: 'sale_new', createdAt: '2026-11-27T11:00:00.000Z' };

  // normalize: epoch stored in settings filters the bucket's own records
  const normalized = normalizeWorkspaceFromRtdb(
    {
      meta: { ownerUid: 'u1' },
      sales: { sale_old: oldSale, sale_new: newSale },
      settings: { dataWipedAt: wipe },
    },
    'u1'
  );
  assert.deepEqual(
    normalized.sales.map((s) => s.id),
    ['sale_new']
  );
  assert.equal(normalized.settings.dataWipedAt, wipe);

  // admin aggregate: one bucket carries the epoch, stale records of ANOTHER bucket are dropped too
  const agg = aggregateAdminWorkspacesFromRtdb(
    {
      u1: { meta: { ownerUid: 'u1' }, sales: { sale_new: newSale }, settings: { dataWipedAt: wipe } },
      u2: {
        meta: { ownerUid: 'u2' },
        sales: { sale_old: { ...oldSale, id: 'sale_old_u2' } },
      },
    },
    {}
  );
  assert.deepEqual(
    agg.sales.map((s) => s.id),
    ['sale_new']
  );
  assert.equal(agg.dataWipedAt, wipe);

  // merge: stale cached snapshot cannot resurrect old records and the max epoch wins
  const base = makeBasePayload();
  const live: RtdbWorkspacePayload = {
    ...base,
    meta: { ...base.meta, updatedAt: '2026-11-27T11:30:00.000Z' },
    sales: [newSale as unknown as SaleTransaction],
    settings: { ...base.settings, dataWipedAt: wipe },
  };
  const stale: RtdbWorkspacePayload = {
    ...base,
    meta: { ...base.meta, updatedAt: '2026-11-26T01:00:00.000Z' },
    sales: [oldSale as unknown as SaleTransaction],
  };
  const merged = mergeWorkspacePayloads(live, stale, 'uid_kho_1', { preferFirstAsLiveRtdb: true });
  assert.ok(merged);
  assert.deepEqual(
    merged.sales.map((s) => s.id),
    ['sale_new']
  );
  assert.equal(merged.settings.dataWipedAt, wipe);

  const stripped = applyDataWipeEpochToPayload({ ...stale, sales: [oldSale as unknown as SaleTransaction] }, wipe);
  assert.equal(stripped.sales.length, 0);
});

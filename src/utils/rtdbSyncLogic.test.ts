import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildFullKeyedWorkspace,
  buildRecoveredVtnnTamAn99Workspace,
  buildStorageWorkspacePaths,
  buildWorkspaceDiffUpdates,
  countWorkspaceBusinessRecords,
  isDestructiveEmptyWorkspaceOverwrite,
  isLegacyArrayWorkspaceLayout,
  mergeWorkspacePayloads,
  normalizeWorkspaceFromRtdb,
  RTDB_RECORD_COLLECTIONS,
  RtdbWorkspacePayload,
  toRtdbRecordKey,
  VTNNTAMAN99_UID,
} from './rtdbSyncLogic';
import { filterRecordsBySelectedWarehouses, getIndependentWarehouseFullPermissions } from './businessLogic';
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

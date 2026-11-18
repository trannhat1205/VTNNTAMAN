import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDebtPayment,
  applyImportToInventory,
  applySaleToInventory,
  authenticateStaffByGoogleEmail,
  buildBackupSnapshotPayload,
  calculateImportSummary,
  calculateSaleSummary,
  canAccountCreateStaff,
  canPerformRoleAction,
  canViewAuditHistory,
  computeCustomerLedger,
  computeCustomerOldDebtSummary,
  computeDueDateAfterDays,
  computeReceivedItemsAndDebtReport,
  computeSupplierOldDebtSummary,
  createAuditLogEntry,
  DEBT_TERM_DAY_OPTIONS,
  evaluateDebtUrgency,
  evaluateStaffAccessScope,
  evaluateStockAlert,
  filterCustomers,
  filterSearchableOptions,
  generateSmartNotifications,
  generateSmartReportRecommendations,
  getDefaultPermissionsForPosition,
  hasCompletedStaffPersonalGmail,
  isDateWithinRange,
  matchDebtTermDays,
  normalizeVietnameseSearch,
  parseAndValidateBackupPayload,
  updateImportRecord,
  updateSaleRecord,
} from './businessLogic';
import {
  CustomerProfile,
  ImportTransaction,
  NotificationPrefs,
  ProductItem,
  SaleTransaction,
  StaffMember,
} from '../types';

const mockProducts: ProductItem[] = [
  {
    id: 'prod_1',
    code: 'NPK-202015',
    name: 'Phân bón NPK 20-20-15 Đầu Trâu',
    category: 'Phân bón',
    unit: 'Bao 50kg',
    importPrice: 680000,
    sellPrice: 750000,
    stock: 40,
    minStock: 15,
    supplierName: 'Công ty Phân bón Bình Điền',
    ownerId: 'u1',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  },
  {
    id: 'prod_2',
    code: 'BVTV-RAD60',
    name: 'Thuốc trừ sâu sinh học Radiant 60SC',
    category: 'Thuốc BVTV',
    unit: 'Chai 100ml',
    importPrice: 145000,
    sellPrice: 175000,
    stock: 6,
    minStock: 10,
    supplierName: 'Công ty CP BVTV Sài Gòn',
    ownerId: 'u1',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  },
];

test('calculateSaleSummary and calculateImportSummary compute total, debt, and status accurately', () => {
  const fullPaid = calculateSaleSummary(10, 750000, 7500000);
  assert.equal(fullPaid.totalAmount, 7500000);
  assert.equal(fullPaid.debtAmount, 0);
  assert.equal(fullPaid.status, 'paid');

  const partial = calculateSaleSummary(4, 750000, 1000000);
  assert.equal(partial.totalAmount, 3000000);
  assert.equal(partial.paidAmount, 1000000);
  assert.equal(partial.debtAmount, 2000000);
  assert.equal(partial.status, 'partial');

  const unpaidImport = calculateImportSummary(20, 145000, 0);
  assert.equal(unpaidImport.totalCost, 2900000);
  assert.equal(unpaidImport.debtAmount, 2900000);
  assert.equal(unpaidImport.status, 'unpaid');
});

test('applySaleToInventory decrements stock and throws when insufficient stock', () => {
  const { updatedProduct } = applySaleToInventory(mockProducts, 'prod_1', 12, '2026-11-16T02:00:00Z');
  assert.equal(updatedProduct.stock, 28);

  assert.throws(() => {
    applySaleToInventory(mockProducts, 'prod_2', 10, '2026-11-16T02:00:00Z');
  }, /Tồn kho không đủ/);
});

test('applyImportToInventory increments stock and updates importPrice', () => {
  const { updatedProduct } = applyImportToInventory(
    mockProducts,
    'prod_2',
    24,
    148000,
    '2026-11-16T02:00:00Z'
  );
  assert.equal(updatedProduct.stock, 30);
  assert.equal(updatedProduct.importPrice, 148000);
  assert.equal(evaluateStockAlert(updatedProduct), 'normal');
});

test('applyDebtPayment transitions partial/unpaid records to paid when settled', () => {
  const sale: SaleTransaction = {
    id: 'sale_1',
    invoiceCode: 'HD-001',
    customerId: 'cust_1',
    customerName: 'Nguyễn Văn Hòa',
    customerPhone: '0912345678',
    productId: 'prod_1',
    productName: 'Phân bón NPK',
    unit: 'Bao',
    quantity: 4,
    unitPrice: 750000,
    totalAmount: 3000000,
    paidAmount: 1000000,
    debtAmount: 2000000,
    dueDate: '2026-11-18',
    status: 'partial',
    note: '',
    staffName: 'Admin',
    ownerId: 'u1',
    createdAt: '2026-11-10T00:00:00Z',
    updatedAt: '2026-11-10T00:00:00Z',
  };

  const settled = applyDebtPayment(sale, 2000000, '2026-11-16T03:00:00Z');
  assert.equal(settled.paidAmount, 3000000);
  assert.equal(settled.debtAmount, 0);
  assert.equal(settled.status, 'paid');
});

test('evaluateDebtUrgency and generateSmartNotifications respect user NotificationPrefs', () => {
  const overdueCheck = evaluateDebtUrgency('2026-11-10', 1500000, '2026-11-16', 5);
  assert.equal(overdueCheck.urgency, 'overdue');
  assert.equal(overdueCheck.daysRemaining, -6);

  const dueSoonCheck = evaluateDebtUrgency('2026-11-19', 1500000, '2026-11-16', 5);
  assert.equal(dueSoonCheck.urgency, 'due_soon');
  assert.equal(dueSoonCheck.daysRemaining, 3);

  const sales: SaleTransaction[] = [
    {
      id: 's1',
      invoiceCode: 'HD-101',
      customerId: 'c1',
      customerName: 'Ông Hòa',
      customerPhone: '0909111222',
      productId: 'prod_1',
      productName: 'NPK',
      unit: 'Bao',
      quantity: 2,
      unitPrice: 750000,
      totalAmount: 1500000,
      paidAmount: 0,
      debtAmount: 1500000,
      dueDate: '2026-11-12',
      status: 'unpaid',
      note: '',
      staffName: 'Admin',
      ownerId: 'u1',
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    },
  ];

  const imports: ImportTransaction[] = [
    {
      id: 'i1',
      receiptCode: 'PN-201',
      supplierName: 'Công ty Bình Điền',
      supplierPhone: '02838111222',
      productId: 'prod_1',
      productName: 'NPK',
      unit: 'Bao',
      quantity: 10,
      unitCost: 680000,
      totalCost: 6800000,
      paidAmount: 2000000,
      debtAmount: 4800000,
      dueDate: '2026-11-18',
      status: 'partial',
      note: '',
      staffName: 'Admin',
      ownerId: 'u1',
      createdAt: '2026-11-05T00:00:00Z',
      updatedAt: '2026-11-05T00:00:00Z',
    },
  ];

  const allEnabledPrefs: NotificationPrefs = {
    uid: 'u1',
    debtCustomerEnabled: true,
    debtSupplierEnabled: true,
    lowStockEnabled: true,
    periodicReportEnabled: true,
    browserPushEnabled: false,
    leadDays: 5,
    updatedAt: '2026-11-16T00:00:00Z',
  };

  const notifs = generateSmartNotifications(mockProducts, sales, imports, [], allEnabledPrefs, '2026-11-16');
  assert.equal(notifs.some((n) => n.category === 'customer_debt'), true);
  assert.equal(notifs.some((n) => n.category === 'supplier_debt'), true);
  assert.equal(notifs.some((n) => n.category === 'low_stock'), true);
  assert.equal(notifs.some((n) => n.category === 'periodic_report'), true);

  // Turn off low_stock and customer_debt
  const filteredNotifs = generateSmartNotifications(
    mockProducts,
    sales,
    imports,
    [],
    { ...allEnabledPrefs, lowStockEnabled: false, debtCustomerEnabled: false },
    '2026-11-16'
  );
  assert.equal(filteredNotifs.some((n) => n.category === 'low_stock'), false);
  assert.equal(filteredNotifs.some((n) => n.category === 'customer_debt'), false);
  assert.equal(filteredNotifs.some((n) => n.category === 'supplier_debt'), true);
});

test('filterCustomers and computeCustomerLedger filter by search query, group, and debt status', () => {
  const customers: CustomerProfile[] = [
    {
      id: 'c1',
      code: 'KH-001',
      name: 'Nguyễn Văn Hòa',
      phone: '0912345678',
      email: 'hoa.nguyen@agri.vn',
      address: 'Ấp 3, Xã Tân Thạnh',
      group: 'Đại lý cấp 2',
      note: '',
      totalPurchased: 0,
      totalDebt: 0,
      ownerId: 'u1',
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    },
    {
      id: 'c2',
      code: 'KH-002',
      name: 'Trần Thị Bích',
      phone: '0988777666',
      email: 'bich.tran@gmail.com',
      address: 'Xã Mỹ An',
      group: 'Nhà nông',
      note: '',
      totalPurchased: 0,
      totalDebt: 0,
      ownerId: 'u1',
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    },
  ];

  const sales: SaleTransaction[] = [
    {
      id: 's1',
      invoiceCode: 'HD-01',
      customerId: 'c1',
      customerName: 'Nguyễn Văn Hòa',
      customerPhone: '0912345678',
      productId: 'prod_1',
      productName: 'NPK',
      unit: 'Bao',
      quantity: 2,
      unitPrice: 750000,
      totalAmount: 1500000,
      paidAmount: 500000,
      debtAmount: 1000000,
      dueDate: '2026-11-10',
      status: 'partial',
      note: '',
      staffName: 'Admin',
      ownerId: 'u1',
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    },
  ];

  const overdueOnly = filterCustomers(customers, sales, '', 'all', 'overdue', '2026-11-16');
  assert.equal(overdueOnly.length, 1);
  assert.equal(overdueOnly[0].customer.id, 'c1');
  assert.equal(overdueOnly[0].ledger.totalDebt, 1000000);

  const searchByAddress = filterCustomers(customers, sales, 'Mỹ An', 'all', 'all', '2026-11-16');
  assert.equal(searchByAddress.length, 1);
  assert.equal(searchByAddress[0].customer.id, 'c2');
});

test('canPerformRoleAction enforces RBAC between manager and staff', () => {
  assert.equal(canPerformRoleAction('manager', 'edit_record'), true);
  assert.equal(canPerformRoleAction('manager', 'delete_record'), true);
  assert.equal(canPerformRoleAction('manager', 'view_profit'), true);
  assert.equal(canPerformRoleAction('staff', 'edit_record'), false);
  assert.equal(canPerformRoleAction('staff', 'delete_record'), false);
  assert.equal(canPerformRoleAction('staff', 'view_profit'), false);
  assert.equal(canPerformRoleAction('staff', 'create_sale'), true);
});

test('updateSaleRecord and updateImportRecord recalculate totals, debt, and status accurately', () => {
  const originalSale: SaleTransaction = {
    id: 'sale_5',
    invoiceCode: 'HD-2611-005',
    customerId: 'cust_05',
    customerName: 'Chị Phạm Thị Mai',
    customerPhone: '0974556677',
    productId: 'prod_anvil_5sc',
    productName: 'Thuốc trừ bệnh Anvil 5SC',
    unit: 'Chai 1 Lít',
    quantity: 10,
    unitPrice: 255000,
    totalAmount: 2550000,
    paidAmount: 2550000,
    debtAmount: 0,
    dueDate: '2026-11-15',
    status: 'paid',
    warehouseName: 'Tâm An Cao Lãnh',
    note: 'Thanh toán tiền mặt',
    staffName: 'Admin',
    ownerId: 'u1',
    createdAt: '2026-11-15T00:00:00Z',
    updatedAt: '2026-11-15T00:00:00Z',
  };

  const editedSale = updateSaleRecord(
    originalSale,
    {
      warehouseName: 'Tâm An Mỹ Ngãi',
      quantity: 12,
      unitPrice: 255000,
      paidAmount: 2000000,
      dueDate: '2026-11-22',
      note: 'Quản lý điều chỉnh số lượng lên 12 chai',
    },
    '2026-11-16T08:00:00Z'
  );
  assert.equal(editedSale.warehouseName, 'Tâm An Mỹ Ngãi');
  assert.equal(editedSale.totalAmount, 3060000);
  assert.equal(editedSale.paidAmount, 2000000);
  assert.equal(editedSale.debtAmount, 1060000);
  assert.equal(editedSale.status, 'partial');

  const originalImport: ImportTransaction = {
    id: 'imp_1',
    receiptCode: 'PN-2611-001',
    supplierName: 'Công ty Bình Điền',
    supplierPhone: '02837560110',
    productId: 'prod_npk_202015',
    productName: 'Phân bón NPK',
    unit: 'Bao 50kg',
    quantity: 60,
    unitCost: 685000,
    totalCost: 41100000,
    paidAmount: 25000000,
    debtAmount: 16100000,
    dueDate: '2026-11-17',
    status: 'partial',
    warehouseName: 'Tâm An Mỹ Ngãi',
    note: '',
    staffName: 'Admin',
    ownerId: 'u1',
    createdAt: '2026-11-03T00:00:00Z',
    updatedAt: '2026-11-03T00:00:00Z',
  };

  const editedImport = updateImportRecord(
    originalImport,
    {
      quantity: 50,
      unitCost: 680000,
      paidAmount: 34000000,
      dueDate: '2026-11-17',
      note: 'Quản lý cập nhật tất toán đủ',
    },
    '2026-11-16T09:00:00Z'
  );
  assert.equal(editedImport.totalCost, 34000000);
  assert.equal(editedImport.debtAmount, 0);
  assert.equal(editedImport.status, 'paid');
});

test('normalizeVietnameseSearch and filterSearchableOptions match Vietnamese names with or without accents', () => {
  assert.equal(normalizeVietnameseSearch('Ông Nguyễn Văn Hòa - ĐT: 0913'), 'ong nguyen van hoa - dt: 0913');
  const items = [
    {
      value: 'HD-2611-001',
      label: 'HD-2611-001 — Ông Nguyễn Văn Hòa',
      subLabel: 'Phân bón NPK 20-20-15+TE Đầu Trâu · 22.800.000 đ',
      keywords: '0913456789 Đại lý cấp 2',
    },
    {
      value: 'HD-2611-005',
      label: 'HD-2611-005 — Chị Phạm Thị Mai',
      subLabel: 'Thuốc trừ bệnh Anvil 5SC · 2.550.000 đ',
      keywords: '0974556677 Tâm An Cao Lãnh',
    },
  ];
  const matchedNoAccent = filterSearchableOptions(items, 'nguyen van hoa');
  assert.equal(matchedNoAccent.length, 1);
  assert.equal(matchedNoAccent[0].value, 'HD-2611-001');

  const matchedByPhoneOrWarehouse = filterSearchableOptions(items, 'cao lanh anvil');
  assert.equal(matchedByPhoneOrWarehouse.length, 1);
  assert.equal(matchedByPhoneOrWarehouse[0].value, 'HD-2611-005');
});

test('computeCustomerOldDebtSummary and computeSupplierOldDebtSummary calculate old debt and cumulative total debt accurately', () => {
  const customerBich: CustomerProfile = {
    id: 'cust_03',
    code: 'KH-003',
    name: 'Bà Trần Thị Bích',
    phone: '0907654321',
    email: '',
    address: 'Ấp Mỹ Hưng',
    group: 'Nhà nông',
    note: '',
    totalPurchased: 10200000,
    totalDebt: 3200000,
    ownerId: 'u1',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  };

  const salesList: SaleTransaction[] = [
    {
      id: 'sale_03',
      invoiceCode: 'HD-2611-003',
      customerId: 'cust_03',
      customerName: 'Bà Trần Thị Bích',
      customerPhone: '0907654321',
      productId: 'prod_1',
      productName: 'Lúa giống ST25',
      unit: 'Bao',
      quantity: 12,
      unitPrice: 850000,
      totalAmount: 10200000,
      paidAmount: 7000000,
      debtAmount: 3200000,
      dueDate: '2026-11-18',
      status: 'partial',
      note: '',
      staffName: 'Admin',
      ownerId: 'u1',
      createdAt: '2026-11-08T00:00:00Z',
      updatedAt: '2026-11-08T00:00:00Z',
    },
  ];

  // Current new order debt = 250,000 VND (350,000 total - 100,000 paid)
  const custSummary = computeCustomerOldDebtSummary(customerBich, salesList, 250000);
  assert.equal(custSummary.hasCustomer, true);
  assert.equal(custSummary.oldDebtAmount, 3200000);
  assert.equal(custSummary.currentOrderDebt, 250000);
  assert.equal(custSummary.cumulativeTotalDebt, 3450000);
  assert.equal(custSummary.unpaidInvoices.length, 1);

  const importsList: ImportTransaction[] = [
    {
      id: 'imp_01',
      receiptCode: 'PN-2611-001',
      supplierName: 'Công ty CP Phân bón Bình Điền',
      supplierPhone: '02837560110',
      productId: 'prod_1',
      productName: 'NPK Đầu Trâu',
      unit: 'Bao',
      quantity: 60,
      unitCost: 685000,
      totalCost: 41100000,
      paidAmount: 25000000,
      debtAmount: 16100000,
      dueDate: '2026-11-17',
      status: 'partial',
      note: '',
      staffName: 'Admin',
      ownerId: 'u1',
      createdAt: '2026-11-03T00:00:00Z',
      updatedAt: '2026-11-03T00:00:00Z',
    },
  ];

  const supSummary = computeSupplierOldDebtSummary(
    'Công ty CP Phân bón Bình Điền',
    importsList,
    4000000
  );
  assert.equal(supSummary.hasSupplier, true);
  assert.equal(supSummary.oldDebtAmount, 16100000);
  assert.equal(supSummary.currentImportDebt, 4000000);
  assert.equal(supSummary.cumulativeTotalDebt, 20100000);
  assert.equal(supSummary.unpaidReceipts.length, 1);
});

test('canAccountCreateStaff only allows trannhat1205@gmail.com or phone 0393120246 to create staff accounts', () => {
  assert.equal(
    canAccountCreateStaff({
      email: 'trannhat1205@gmail.com',
      phone: '0900000000',
      positionRole: 'primary_manager',
    }),
    true
  );
  assert.equal(
    canAccountCreateStaff({
      email: 'other@gmail.com',
      phone: '0393120246',
      positionRole: 'primary_manager',
    }),
    true
  );
  // Deputy manager or warehouse manager cannot create staff accounts unless using primary Gmail or 0393120246
  assert.equal(
    canAccountCreateStaff({
      email: 'minhquan.phoquanly@gmail.com',
      phone: '0917888666',
      positionRole: 'deputy_general_manager',
    }),
    false
  );
  assert.equal(
    getDefaultPermissionsForPosition('warehouse_accountant').includes('warehouse_accounting'),
    true
  );
  assert.equal(
    getDefaultPermissionsForPosition('deputy_general_manager').includes('manage_all_warehouses'),
    true
  );

  // Real-time permission scoping test: a staff member granted ONLY customer_debt_accounting
  const customerDebtOnlyStaff: StaffMember = {
    uid: 'staff_debt_kh',
    username: 'ketoan_congno_kh',
    password: '123456',
    displayName: 'Kế toán công nợ KH',
    phone: '0901112222',
    email: 'congno.kh@taman.vn',
    role: 'staff',
    positionRole: 'debt_accountant',
    permissions: ['customer_debt_accounting'],
    assignedWarehouse: 'Tâm An Mỹ Ngãi',
    active: true,
    createdAt: '2026-11-16',
    updatedAt: '2026-11-16',
  };

  const scope = evaluateStaffAccessScope(customerDebtOnlyStaff);
  assert.equal(scope.isPrimaryOwner, false);
  assert.equal(scope.canAccessSales, false);
  assert.equal(scope.canAccessImports, false);
  assert.equal(scope.canAccessInventory, false);
  assert.equal(scope.canAccessCustomers, true);
  assert.equal(scope.canAccessCustomerDebts, true);
  assert.equal(scope.canAccessSupplierDebts, false);
  assert.equal(scope.canAccessDebts, true);
  assert.equal(scope.canEditDeleteVouchers, false);
  assert.deepEqual(scope.allowedTabs, [
    'dashboard',
    'customers',
    'debts',
    'vouchers',
    'staff_accounts',
  ]);
});

test('canViewAuditHistory, createAuditLogEntry, buildBackupSnapshotPayload, and parseAndValidateBackupPayload enforce exclusive audit access and full backup restoration', () => {
  const primaryOwner: StaffMember = {
    uid: 'staff_manager_01',
    username: 'admin',
    password: '885300',
    displayName: 'Trần Đình Nhất',
    email: 'trannhat1205@gmail.com',
    phone: '0393120246',
    role: 'manager',
    positionRole: 'primary_manager',
    permissions: ['create_staff_accounts', 'manage_all_warehouses', 'edit_delete_vouchers'],
    assignedWarehouse: 'Tất cả kho',
    active: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-11-16',
  };

  const deputyManagerWithDelete: StaffMember = {
    uid: 'staff_deputy_01',
    username: 'pho_quanly',
    password: '123456',
    displayName: 'Nguyễn Minh Quân (Phó quản lý)',
    email: 'minhquan.phoquanly@gmail.com',
    phone: '0917888666',
    role: 'manager',
    positionRole: 'deputy_general_manager',
    permissions: ['manage_all_warehouses', 'edit_delete_vouchers'],
    assignedWarehouse: 'Tất cả kho',
    active: true,
    createdAt: '2026-03-10',
    updatedAt: '2026-11-16',
  };

  // ONLY trannhat1205@gmail.com / 0393120246 can view audit history
  assert.equal(canViewAuditHistory(primaryOwner), true);
  assert.equal(canViewAuditHistory(deputyManagerWithDelete), false);

  const deleteAudit = createAuditLogEntry({
    actor: deputyManagerWithDelete,
    category: 'delete_record',
    targetEntity: 'sale',
    targetCode: 'HD-2611-002',
    actionTitle: 'Xóa hóa đơn bán hàng HD-2611-002',
    details: 'Phó quản lý Nguyễn Minh Quân đã xóa hóa đơn HD-2611-002 (8.750.000 đ)',
    warehouseName: 'Tâm An Mỹ Ngãi',
    snapshotObject: { id: 'sale_02', invoiceCode: 'HD-2611-002', totalAmount: 8750000 },
    nowIso: '2026-11-16T10:30:00.000Z',
  });

  assert.equal(deleteAudit.actorUsername, 'pho_quanly');
  assert.equal(deleteAudit.category, 'delete_record');
  assert.equal(deleteAudit.targetCode, 'HD-2611-002');
  assert.equal(Boolean(deleteAudit.snapshotData), true);

  const backupPayload = buildBackupSnapshotPayload({
    fileName: 'VTNN_TamAn_Backup_2026-11-16.json',
    exportedByEmail: 'trannhat1205@gmail.com',
    exportedAt: '2026-11-16T06:00:00.000Z',
    warehouses: ['Tâm An Mỹ Ngãi'],
    customerGroups: ['Nhà nông'],
    productCategories: ['Phân bón'],
    products: mockProducts,
    customers: [],
    suppliers: [],
    sales: [],
    imports: [],
    savedVouchers: [],
    staffList: [primaryOwner, deputyManagerWithDelete],
    auditLogs: [deleteAudit],
  });

  assert.equal(backupPayload.recordCount, 2);
  assert.equal(backupPayload.auditLogCount, 1);
  assert.equal(backupPayload.auditLogs[0].targetCode, 'HD-2611-002');

  const parsedResult = parseAndValidateBackupPayload(JSON.stringify(backupPayload));
  assert.equal(parsedResult.ok, true);
  if (parsedResult.ok) {
    assert.equal(parsedResult.payload.auditLogs.length, 1);
    assert.equal(parsedResult.payload.auditLogs[0].actorUsername, 'pho_quanly');
    assert.equal(parsedResult.payload.products.length, 2);
  }

  // Test staff Google Sign-In after supplementing personal Gmail
  const unlinkedStaff: StaffMember = {
    uid: 'staff_new_01',
    username: 'khoa_kho',
    password: '123456',
    displayName: 'Trần Minh Khoa',
    email: 'khoa_kho@vtnntaman.vn',
    phone: '0909112233',
    role: 'staff',
    positionRole: 'warehouse_manager',
    permissions: ['manage_single_warehouse'],
    assignedWarehouse: 'Tâm An Mỹ Ngãi',
    active: true,
    createdAt: '2026-11-16',
    updatedAt: '2026-11-16',
  };
  assert.equal(hasCompletedStaffPersonalGmail(unlinkedStaff), false);
  const unlinkedRes = authenticateStaffByGoogleEmail(
    [primaryOwner, deputyManagerWithDelete, unlinkedStaff],
    'khoa_kho@vtnntaman.vn'
  );
  assert.equal(unlinkedRes.ok, false);

  const linkedStaff: StaffMember = {
    ...unlinkedStaff,
    email: 'minhkhoa.taman@gmail.com',
  };
  assert.equal(hasCompletedStaffPersonalGmail(linkedStaff), true);
  const linkedRes = authenticateStaffByGoogleEmail(
    [primaryOwner, deputyManagerWithDelete, linkedStaff],
    'minhkhoa.taman@gmail.com'
  );
  assert.equal(linkedRes.ok, true);
  if (linkedRes.ok) {
    assert.equal(linkedRes.staff.username, 'khoa_kho');
    assert.equal(linkedRes.staff.assignedWarehouse, 'Tâm An Mỹ Ngãi');
  }
});

test('computeDueDateAfterDays and matchDebtTermDays calculate 7, 30, 60, 90, 120 day due dates accurately', () => {
  assert.deepEqual(DEBT_TERM_DAY_OPTIONS, [7, 30, 60, 90, 120]);
  const baseDate = '2026-11-17';
  assert.equal(computeDueDateAfterDays(7, baseDate), '2026-11-24');
  assert.equal(computeDueDateAfterDays(30, baseDate), '2026-12-17');
  assert.equal(computeDueDateAfterDays(60, baseDate), '2027-01-16');
  assert.equal(computeDueDateAfterDays(90, baseDate), '2027-02-15');
  assert.equal(computeDueDateAfterDays(120, baseDate), '2027-03-17');

  assert.equal(matchDebtTermDays('2026-11-24', baseDate), 7);
  assert.equal(matchDebtTermDays('2026-12-17', baseDate), 30);
  assert.equal(matchDebtTermDays('2027-01-16', baseDate), 60);
  assert.equal(matchDebtTermDays('2027-02-15', baseDate), 90);
  assert.equal(matchDebtTermDays('2027-03-17', baseDate), 120);
  assert.equal(matchDebtTermDays('2026-12-01', baseDate), '');
});

test('isDateWithinRange, computeReceivedItemsAndDebtReport, generateSmartReportRecommendations, and separated reports vs backup_history tabs work accurately', () => {
  assert.equal(isDateWithinRange('2026-11-15T08:00:00Z', '2026-11-01', '2026-11-30'), true);
  assert.equal(isDateWithinRange('2026-10-25T08:00:00Z', '2026-11-01', '2026-11-30'), false);

  const sampleSales: SaleTransaction[] = [
    {
      id: 's_1',
      invoiceCode: 'HD-2611-001',
      customerId: 'cust_01',
      customerName: 'Ông Nguyễn Văn Hòa',
      customerPhone: '0913456789',
      productId: 'prod_1',
      productName: 'Phân bón NPK 20-20-15+TE Đầu Trâu',
      unit: 'Bao 50kg',
      quantity: 30,
      unitPrice: 760000,
      totalAmount: 22800000,
      paidAmount: 22800000,
      debtAmount: 0,
      dueDate: '2026-11-05',
      status: 'paid',
      warehouseName: 'Tâm An Mỹ Ngãi',
      note: '',
      staffName: 'Trần Đình Nhất',
      ownerId: 'u1',
      createdAt: '2026-11-05T08:00:00Z',
      updatedAt: '2026-11-05T08:00:00Z',
    },
    {
      id: 's_2',
      invoiceCode: 'HD-2611-007',
      customerId: 'cust_01',
      customerName: 'Ông Nguyễn Văn Hòa',
      customerPhone: '0913456789',
      productId: 'prod_2',
      productName: 'GAP DIỆT MẦM KÍCH RỄ',
      unit: 'CẶP',
      quantity: 1,
      unitPrice: 350000,
      totalAmount: 350000,
      paidAmount: 0,
      debtAmount: 350000,
      dueDate: '2026-11-25',
      status: 'unpaid',
      warehouseName: 'Tâm An Mỹ Ngãi',
      note: '',
      staffName: 'Nguyễn Trịnh Huỳnh Như',
      ownerId: 'u1',
      createdAt: '2026-11-17T08:00:00Z',
      updatedAt: '2026-11-17T08:00:00Z',
    },
  ];

  const allReceived = computeReceivedItemsAndDebtReport({
    sales: sampleSales,
    fromDate: '2026-11-01',
    toDate: '2026-11-30',
    customerId: 'cust_01',
    onlyUnpaid: false,
  });
  assert.equal(allReceived.customerItems.length, 2);
  assert.equal(allReceived.totalCustomerAmount, 23150000);
  assert.equal(allReceived.totalCustomerPaid, 22800000);
  assert.equal(allReceived.totalCustomerRemainingDebt, 350000);
  assert.equal(allReceived.unpaidCustomerInvoiceCount, 1);

  const unpaidOnly = computeReceivedItemsAndDebtReport({
    sales: sampleSales,
    fromDate: '2026-11-01',
    toDate: '2026-11-30',
    customerId: 'cust_01',
    onlyUnpaid: true,
  });
  assert.equal(unpaidOnly.customerItems.length, 1);
  assert.equal(unpaidOnly.customerItems[0].invoiceCode, 'HD-2611-007');

  // Primary manager gets both 'reports' and 'backup_history' and all report categories including financial_profit
  const primaryManager: StaffMember = {
    uid: 'staff_manager_01',
    username: 'admin',
    password: '885300',
    displayName: 'Trần Đình Nhất',
    email: 'trannhat1205@gmail.com',
    phone: '0393120246',
    role: 'manager',
    positionRole: 'primary_manager',
    permissions: ['create_staff_accounts', 'manage_all_warehouses', 'view_assigned_reports'],
    assignedWarehouse: 'Tất cả kho',
    active: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-11-18',
  };
  const primaryScope = evaluateStaffAccessScope(primaryManager);
  assert.equal(primaryScope.allowedTabs.includes('reports'), true);
  assert.equal(primaryScope.allowedTabs.includes('backup_history'), true);
  assert.equal(primaryScope.allowedReportCategories.includes('financial_profit'), true);

  // Employee with customer_debt_accounting + view_assigned_reports gets 'reports' (only assigned categories) and NEVER 'backup_history' or 'financial_profit'
  const debtStaffWithReport: StaffMember = {
    uid: 'staff_debt_02',
    username: 'congno_staff',
    password: '123456',
    displayName: 'Nhân viên Công nợ',
    email: 'congno@taman.vn',
    phone: '0902223333',
    role: 'staff',
    positionRole: 'debt_accountant',
    permissions: ['customer_debt_accounting', 'view_assigned_reports'],
    assignedWarehouse: 'Tâm An Mỹ Ngãi',
    active: true,
    createdAt: '2026-11-01',
    updatedAt: '2026-11-18',
  };
  const staffScope = evaluateStaffAccessScope(debtStaffWithReport);
  assert.equal(staffScope.allowedTabs.includes('reports'), true);
  assert.equal(staffScope.allowedTabs.includes('backup_history'), false);
  assert.equal(staffScope.allowedReportCategories.includes('financial_profit'), false);
  assert.deepEqual(staffScope.allowedReportCategories, [
    'overview',
    'customers_items',
    'debts_receivable_payable',
    'cashflow_treasury',
  ]);

  const recs = generateSmartReportRecommendations({
    staff: debtStaffWithReport,
    accessScope: staffScope,
    sales: sampleSales,
    imports: [],
    products: mockProducts,
    customers: [],
    fromDate: '2026-11-01',
    toDate: '2026-11-30',
  });
  assert.equal(recs.length > 0, true);
  assert.equal(
    recs.every((r) => staffScope.allowedReportCategories.includes(r.targetCategory)),
    true
  );
});



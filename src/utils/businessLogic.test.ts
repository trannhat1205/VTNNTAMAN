import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCustomerFifoDebtSettlement,
  applyDebtPayment,
  applyImportToInventory,
  applySaleToInventory,
  applySupplierFifoDebtSettlement,
  authenticateStaffByGoogleEmail,
  buildBackupSnapshotPayload,
  calculateImportSummary,
  calculateSaleSummary,
  canAccountCreateStaff,
  canPerformRoleAction,
  canStaffFilterMultiWarehouses,
  canViewAuditHistory,
  computeCashflowAndFinancialReport,
  computeCustomerLedger,
  computeCustomerOldDebtSummary,
  computeDueDateAfterDays,
  computeReceivedItemsAndDebtReport,
  computeSupplierOldDebtSummary,
  computeTaxAuthorityFinancialStatement,
  createAuditLogEntry,
  DEBT_TERM_DAY_OPTIONS,
  evaluateDebtUrgency,
  evaluateStaffAccessScope,
  evaluateStockAlert,
  executeFiscalYearCloseAndCleanup,
  executeFullApplicationDataWipe,
  filterCustomers,
  filterRecordsBySelectedWarehouses,
  filterSearchableOptions,
  formatSelectedWarehousesBadge,
  generateFiscalYearOptions,
  generateSmartNotifications,
  generateSmartReportRecommendations,
  getDefaultPermissionsForPosition,
  hasCompletedStaffPersonalGmail,
  isDateWithinRange,
  matchDebtTermDays,
  normalizeVietnameseSearch,
  parseAndValidateBackupPayload,
  previewCustomerFifoDebtSettlement,
  previewFiscalYearCloseAndCleanup,
  previewSupplierFifoDebtSettlement,
  resolveActiveWarehouses,
  updateImportRecord,
  updateSaleRecord,
  PRIMARY_ADMIN_UID,
  formatDefaultWarehouseNameFromGmail,
  extractCustomWarehouseSuffix,
  normalizeCustomTamAnWarehouseName,
  getIndependentWarehouseFullPermissions,
  generateSequentialVoucherCode,
  getCurrentMonthRangeVietnam,
  getTodayVietnamDateStr,
} from './businessLogic';
import { hashPassword, isHashedPassword, verifyPassword } from './authSecurity';
import {
  createEmptyWorkspaceState,
  sanitizeStaffListForStorage,
} from '../services/localPersistence';
import {
  buildGeminiQueryCacheKey,
  buildGeminiSystemInstruction,
  buildWarehouseReportSnapshot,
  classifyQueryRoutingAndCostConfig,
  DEFAULT_GEMINI_MODEL,
  GEMINI_MODEL_OPTIONS,
  generateSmartReportAnswer,
  shouldEnableExternalWebSearch,
} from './geminiReportAssistant';
import {
  CustomerProfile,
  ImportTransaction,
  NotificationPrefs,
  ProductItem,
  SaleTransaction,
  StaffMember,
} from '../types';
import {
  INITIAL_CUSTOMERS,
  INITIAL_IMPORTS,
  INITIAL_PAYMENT_VOUCHERS,
  INITIAL_PRODUCTS,
  INITIAL_RECEIPT_VOUCHERS,
  INITIAL_SALES,
  INITIAL_SAVED_VOUCHERS,
  PRODUCTION_PRIMARY_ADMIN,
  INITIAL_SUPPLIERS,
} from '../data/seedData';

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
    'receipt_vouchers',
    'customers',
    'debts',
    'vouchers',
    'staff_accounts',
    'gemini_chat',
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

test('applyCustomerFifoDebtSettlement and applySupplierFifoDebtSettlement settle unpaid records strictly in chronological order of debt date and update cashflow/financial reports', () => {
  const multiSales: SaleTransaction[] = [
    {
      id: 'sale_newer',
      invoiceCode: 'HD-2611-010',
      customerId: 'cust_01',
      customerName: 'Ông Nguyễn Văn Hòa',
      customerPhone: '0913456789',
      productId: 'prod_2',
      productName: 'Thuốc trừ sâu Radiant 60SC',
      unit: 'Chai',
      quantity: 10,
      unitPrice: 350000,
      totalAmount: 3500000,
      paidAmount: 500000,
      debtAmount: 3000000,
      dueDate: '2026-11-25',
      status: 'partial',
      warehouseName: 'Tâm An Mỹ Ngãi',
      note: '',
      staffName: 'Admin',
      ownerId: 'u1',
      createdAt: '2026-11-12T10:00:00Z',
      updatedAt: '2026-11-12T10:00:00Z',
    },
    {
      id: 'sale_oldest',
      invoiceCode: 'HD-2611-001',
      customerId: 'cust_01',
      customerName: 'Ông Nguyễn Văn Hòa',
      customerPhone: '0913456789',
      productId: 'prod_1',
      productName: 'Phân bón NPK Đầu Trâu',
      unit: 'Bao 50kg',
      quantity: 10,
      unitPrice: 750000,
      totalAmount: 7500000,
      paidAmount: 2500000,
      debtAmount: 5000000,
      dueDate: '2026-11-10',
      status: 'partial',
      warehouseName: 'Tâm An Mỹ Ngãi',
      note: '',
      staffName: 'Admin',
      ownerId: 'u1',
      createdAt: '2026-11-02T09:00:00Z',
      updatedAt: '2026-11-02T09:00:00Z',
    },
  ];

  // Total customer debt = 5,000,000 (oldest 2026-11-02) + 3,000,000 (newer 2026-11-12) = 8,000,000
  // Entering lump-sum 6,200,000 should completely settle HD-2611-001 (5,000,000) and deduct 1,200,000 from HD-2611-010 (leaving 1,800,000)
  const preview = previewCustomerFifoDebtSettlement(
    multiSales,
    { customerId: 'cust_01' },
    6200000
  );
  assert.equal(preview.totalPreviousDebt, 8000000);
  assert.equal(preview.totalAllocated, 6200000);
  assert.equal(preview.totalRemainingDebt, 1800000);
  assert.equal(preview.allocations[0].code, 'HD-2611-001');
  assert.equal(preview.allocations[0].allocatedAmount, 5000000);
  assert.equal(preview.allocations[0].remainingDebt, 0);
  assert.equal(preview.allocations[1].code, 'HD-2611-010');
  assert.equal(preview.allocations[1].allocatedAmount, 1200000);
  assert.equal(preview.allocations[1].remainingDebt, 1800000);

  const settledCustomer = applyCustomerFifoDebtSettlement(
    multiSales,
    { customerId: 'cust_01' },
    6200000,
    'Thu quyết toán tổng công nợ Ông Hòa',
    '2026-11-16T10:00:00Z'
  );
  const updatedOldest = settledCustomer.updatedSales.find((s) => s.id === 'sale_oldest')!;
  const updatedNewer = settledCustomer.updatedSales.find((s) => s.id === 'sale_newer')!;
  assert.equal(updatedOldest.debtAmount, 0);
  assert.equal(updatedOldest.status, 'paid');
  assert.equal(updatedNewer.debtAmount, 1800000);
  assert.equal(updatedNewer.status, 'partial');

  // Supplier FIFO settlement test
  const multiImports: ImportTransaction[] = [
    {
      id: 'imp_newer',
      receiptCode: 'PN-2611-009',
      supplierName: 'Công ty Phân bón Bình Điền',
      supplierPhone: '02837560110',
      productId: 'prod_1',
      productName: 'NPK Đầu Trâu',
      unit: 'Bao 50kg',
      quantity: 10,
      unitCost: 680000,
      totalCost: 6800000,
      paidAmount: 2800000,
      debtAmount: 4000000,
      dueDate: '2026-11-25',
      status: 'partial',
      warehouseName: 'Tâm An Mỹ Ngãi',
      note: '',
      staffName: 'Admin',
      ownerId: 'u1',
      createdAt: '2026-11-10T08:00:00Z',
      updatedAt: '2026-11-10T08:00:00Z',
    },
    {
      id: 'imp_oldest',
      receiptCode: 'PN-2611-001',
      supplierName: 'Công ty Phân bón Bình Điền',
      supplierPhone: '02837560110',
      productId: 'prod_1',
      productName: 'NPK Đầu Trâu',
      unit: 'Bao 50kg',
      quantity: 20,
      unitCost: 680000,
      totalCost: 13600000,
      paidAmount: 3600000,
      debtAmount: 10000000,
      dueDate: '2026-11-15',
      status: 'partial',
      warehouseName: 'Tâm An Mỹ Ngãi',
      note: '',
      staffName: 'Admin',
      ownerId: 'u1',
      createdAt: '2026-11-01T08:00:00Z',
      updatedAt: '2026-11-01T08:00:00Z',
    },
  ];

  const supPreview = previewSupplierFifoDebtSettlement(
    multiImports,
    { supplierName: 'Công ty Phân bón Bình Điền' },
    11500000
  );
  assert.equal(supPreview.totalPreviousDebt, 14000000);
  assert.equal(supPreview.allocations[0].code, 'PN-2611-001');
  assert.equal(supPreview.allocations[0].allocatedAmount, 10000000);
  assert.equal(supPreview.allocations[1].code, 'PN-2611-009');
  assert.equal(supPreview.allocations[1].allocatedAmount, 1500000);

  const settledSupplier = applySupplierFifoDebtSettlement(
    multiImports,
    { supplierName: 'Công ty Phân bón Bình Điền' },
    11500000,
    'Chi quyết toán nợ NCC Bình Điền',
    '2026-11-16T11:00:00Z'
  );
  const updatedImpOldest = settledSupplier.updatedImports.find((i) => i.id === 'imp_oldest')!;
  const updatedImpNewer = settledSupplier.updatedImports.find((i) => i.id === 'imp_newer')!;
  assert.equal(updatedImpOldest.debtAmount, 0);
  assert.equal(updatedImpOldest.status, 'paid');
  assert.equal(updatedImpNewer.debtAmount, 2500000);

  // Cashflow & Financial Profit integration test
  const report = computeCashflowAndFinancialReport({
    sales: settledCustomer.updatedSales,
    imports: settledSupplier.updatedImports,
    products: mockProducts,
    receiptVouchers: [
      {
        id: 'rv_1',
        voucherCode: 'PT-01',
        groupName: 'Thu nợ bán hàng khách hàng',
        warehouseName: 'Tâm An Mỹ Ngãi',
        partnerName: 'Ông Nguyễn Văn Hòa',
        partnerPhone: '0913456789',
        amount: 6200000,
        paymentMethod: 'Chuyển khoản ngân hàng',
        isDebtSettlement: true,
        settledAllocations: settledCustomer.settledAllocations,
        note: '',
        staffName: 'Admin',
        ownerId: 'u1',
        createdAt: '2026-11-16T10:00:00Z',
        updatedAt: '2026-11-16T10:00:00Z',
      },
      {
        id: 'rv_2',
        voucherCode: 'PT-02',
        groupName: 'Thu chiết khấu / Hỗ trợ từ Nhà cung cấp',
        warehouseName: 'Tâm An Mỹ Ngãi',
        partnerName: 'NCC Bình Điền',
        partnerPhone: '02837560110',
        amount: 500000,
        paymentMethod: 'Chuyển khoản ngân hàng',
        isDebtSettlement: false,
        countsTowardOtherIncome: true,
        note: 'Thưởng chiết khấu',
        staffName: 'Admin',
        ownerId: 'u1',
        createdAt: '2026-11-16T10:30:00Z',
        updatedAt: '2026-11-16T10:30:00Z',
      },
    ],
    paymentVouchers: [
      {
        id: 'pv_1',
        voucherCode: 'PC-01',
        groupName: 'Chi trả nợ Nhà cung cấp',
        warehouseName: 'Tâm An Mỹ Ngãi',
        partnerName: 'Công ty Phân bón Bình Điền',
        partnerPhone: '02837560110',
        amount: 11500000,
        paymentMethod: 'Chuyển khoản ngân hàng',
        isDebtSettlement: true,
        settledAllocations: settledSupplier.settledAllocations,
        note: '',
        staffName: 'Admin',
        ownerId: 'u1',
        createdAt: '2026-11-16T11:00:00Z',
        updatedAt: '2026-11-16T11:00:00Z',
      },
      {
        id: 'pv_2',
        voucherCode: 'PC-02',
        groupName: 'Chi phí vận chuyển & Bốc xếp hàng hóa',
        warehouseName: 'Tâm An Mỹ Ngãi',
        partnerName: 'Đội xe bốc xếp',
        partnerPhone: '0900111222',
        amount: 300000,
        paymentMethod: 'Tiền mặt',
        isDebtSettlement: false,
        countsTowardOperatingExpense: true,
        note: 'Chi bốc xếp',
        staffName: 'Admin',
        ownerId: 'u1',
        createdAt: '2026-11-16T11:30:00Z',
        updatedAt: '2026-11-16T11:30:00Z',
      },
    ],
    fromDate: '2026-11-01',
    toDate: '2026-11-30',
  });

  // Sales paid inflow = 7,500,000 + 1,700,000 = 9,200,000; other receipt inflow = 500,000 -> totalCashInflow = 9,700,000
  assert.equal(report.salesPaidInflow, 9200000);
  assert.equal(report.otherReceiptInflow, 500000);
  assert.equal(report.totalCashInflow, 9700000);
  // Imports paid outflow = 13,600,000 + 4,300,000 = 17,900,000; operating payment outflow = 300,000 -> totalCashOutflow = 18,200,000
  assert.equal(report.importsPaidOutflow, 17900000);
  assert.equal(report.operatingPaymentOutflow, 300000);
  assert.equal(report.totalCashOutflow, 18200000);
  // Gross profit = (7,500,000 + 3,500,000) - (10*680,000 + 10*145,000) = 11,000,000 - 8,250,000 = 2,750,000
  // Net profit = 2,750,000 + 500,000 (other income) - 300,000 (operating expense) = 2,950,000
  assert.equal(report.grossProfit, 2750000);
  assert.equal(report.otherIncome, 500000);
  assert.equal(report.operatingExpenses, 300000);
  assert.equal(report.netProfit, 2950000);
});

test('previewFiscalYearCloseAndCleanup, executeFiscalYearCloseAndCleanup, and executeFullApplicationDataWipe clean up settled fiscal year data while carrying forward remaining inventory and debts into the new fiscal year', () => {
  const sampleCustomers: CustomerProfile[] = [
    {
      id: 'cust_01',
      code: 'KH-001',
      name: 'Ông Nguyễn Văn Hòa',
      phone: '0913456789',
      email: '',
      address: 'Cao Lãnh',
      group: 'Nhà nông',
      note: '',
      totalPurchased: 30000000,
      totalDebt: 3500000,
      ownerId: 'u1',
      createdAt: '2026-01-01',
      updatedAt: '2026-11-01',
    },
  ];

  const sampleSales: SaleTransaction[] = [
    {
      id: 's_paid_2026',
      invoiceCode: 'HD-2605-001',
      customerId: 'cust_01',
      customerName: 'Ông Nguyễn Văn Hòa',
      customerPhone: '0913456789',
      productId: 'prod_1',
      productName: 'Phân bón NPK 20-20-15 Đầu Trâu',
      unit: 'Bao 50kg',
      quantity: 20,
      unitPrice: 750000,
      totalAmount: 15000000,
      paidAmount: 15000000,
      debtAmount: 0,
      dueDate: '2026-05-15',
      status: 'paid',
      warehouseName: 'Tâm An Mỹ Ngãi',
      note: 'Đã tất toán hết công nợ năm 2026',
      staffName: 'Trần Đình Nhất',
      ownerId: 'u1',
      createdAt: '2026-05-10T08:00:00Z',
      updatedAt: '2026-05-10T08:00:00Z',
    },
    {
      id: 's_unpaid_2026',
      invoiceCode: 'HD-2611-002',
      customerId: 'cust_01',
      customerName: 'Ông Nguyễn Văn Hòa',
      customerPhone: '0913456789',
      productId: 'prod_2',
      productName: 'Thuốc trừ sâu Radiant 60SC',
      unit: 'Chai',
      quantity: 10,
      unitPrice: 350000,
      totalAmount: 3500000,
      paidAmount: 1000000,
      debtAmount: 2500000,
      dueDate: '2026-12-10',
      status: 'partial',
      warehouseName: 'Tâm An Mỹ Ngãi',
      note: 'Còn nợ chuyển qua năm mới',
      staffName: 'Trần Đình Nhất',
      ownerId: 'u1',
      createdAt: '2026-11-12T08:00:00Z',
      updatedAt: '2026-11-12T08:00:00Z',
    },
  ];

  const sampleImports: ImportTransaction[] = [
    {
      id: 'i_paid_2026',
      receiptCode: 'PN-2603-001',
      supplierName: 'Công ty Phân bón Bình Điền',
      supplierPhone: '02837560110',
      productId: 'prod_1',
      productName: 'Phân bón NPK 20-20-15 Đầu Trâu',
      unit: 'Bao 50kg',
      quantity: 30,
      unitCost: 680000,
      totalCost: 20400000,
      paidAmount: 20400000,
      debtAmount: 0,
      dueDate: '2026-04-01',
      status: 'paid',
      warehouseName: 'Tâm An Mỹ Ngãi',
      note: 'Đã trả hết nợ NCC',
      staffName: 'Trần Đình Nhất',
      ownerId: 'u1',
      createdAt: '2026-03-15T08:00:00Z',
      updatedAt: '2026-03-15T08:00:00Z',
    },
    {
      id: 'i_unpaid_2026',
      receiptCode: 'PN-2611-005',
      supplierName: 'Công ty Phân bón Bình Điền',
      supplierPhone: '02837560110',
      productId: 'prod_1',
      productName: 'Phân bón NPK 20-20-15 Đầu Trâu',
      unit: 'Bao 50kg',
      quantity: 20,
      unitCost: 680000,
      totalCost: 13600000,
      paidAmount: 5600000,
      debtAmount: 8000000,
      dueDate: '2026-12-20',
      status: 'partial',
      warehouseName: 'Tâm An Mỹ Ngãi',
      note: 'Còn nợ NCC',
      staffName: 'Trần Đình Nhất',
      ownerId: 'u1',
      createdAt: '2026-11-14T08:00:00Z',
      updatedAt: '2026-11-14T08:00:00Z',
    },
  ];

  const preview = previewFiscalYearCloseAndCleanup({
    fiscalYear: 2026,
    products: mockProducts,
    customers: sampleCustomers,
    sales: sampleSales,
    imports: sampleImports,
    receiptVouchers: [
      {
        id: 'rv_2026',
        voucherCode: 'PT-2611-001',
        groupName: 'Thu nợ bán hàng khách hàng',
        warehouseName: 'Tâm An Mỹ Ngãi',
        partnerName: 'Ông Nguyễn Văn Hòa',
        partnerPhone: '0913456789',
        amount: 5000000,
        paymentMethod: 'Tiền mặt',
        isDebtSettlement: true,
        note: '',
        staffName: 'Admin',
        ownerId: 'u1',
        createdAt: '2026-11-01T08:00:00Z',
        updatedAt: '2026-11-01T08:00:00Z',
      },
    ],
    paymentVouchers: [
      {
        id: 'pv_2026',
        voucherCode: 'PC-2611-001',
        groupName: 'Chi trả nợ Nhà cung cấp',
        warehouseName: 'Tâm An Mỹ Ngãi',
        partnerName: 'Công ty Phân bón Bình Điền',
        partnerPhone: '02837560110',
        amount: 10000000,
        paymentMethod: 'Chuyển khoản ngân hàng',
        isDebtSettlement: true,
        note: '',
        staffName: 'Admin',
        ownerId: 'u1',
        createdAt: '2026-11-05T08:00:00Z',
        updatedAt: '2026-11-05T08:00:00Z',
      },
    ],
    savedVouchers: [],
  });

  assert.equal(preview.fiscalYear, 2026);
  assert.equal(preview.newFiscalYear, 2027);
  assert.equal(preview.settledSalesToDelete.length, 1);
  assert.equal(preview.settledImportsToDelete.length, 1);
  assert.equal(preview.receiptVouchersToDelete.length, 1);
  assert.equal(preview.paymentVouchersToDelete.length, 1);
  assert.equal(preview.totalRecordsToDelete, 4);
  assert.equal(preview.carriedInventoryCount, 2);
  assert.equal(preview.carriedCustomerDebtCount, 1);
  assert.equal(preview.carriedCustomerDebtTotal, 2500000);
  assert.equal(preview.carriedSupplierDebtCount, 1);
  assert.equal(preview.carriedSupplierDebtTotal, 8000000);

  const execution = executeFiscalYearCloseAndCleanup({
    fiscalYear: 2026,
    products: mockProducts,
    customers: sampleCustomers,
    sales: sampleSales,
    imports: sampleImports,
    receiptVouchers: preview.receiptVouchersToDelete,
    paymentVouchers: preview.paymentVouchersToDelete,
    savedVouchers: [],
    nowIso: '2026-12-31T23:59:00Z',
  });

  assert.equal(execution.remainingProducts.length, 2);
  assert.equal(execution.remainingSales.length, 1);
  assert.equal(execution.remainingSales[0].invoiceCode, 'HD-2611-002');
  assert.equal(execution.remainingSales[0].debtAmount, 2500000);
  assert.equal(execution.remainingSales[0].note.includes('Chuyển sang đầu kỳ năm 2027'), true);
  assert.equal(execution.remainingImports.length, 1);
  assert.equal(execution.remainingImports[0].receiptCode, 'PN-2611-005');
  assert.equal(execution.remainingImports[0].debtAmount, 8000000);
  assert.equal(execution.remainingReceiptVouchers.length, 0);
  assert.equal(execution.remainingPaymentVouchers.length, 0);
  assert.equal(execution.updatedCustomers[0].totalDebt, 2500000);

  // Full application data wipe preserves primary manager account
  const primaryManager: StaffMember = {
    uid: 'staff_manager_01',
    username: 'admin',
    password: '885300',
    displayName: 'Trần Đình Nhất',
    email: 'trannhat1205@gmail.com',
    phone: '0393120246',
    role: 'manager',
    positionRole: 'primary_manager',
    permissions: ['create_staff_accounts', 'manage_all_warehouses'],
    assignedWarehouse: 'Tất cả kho',
    active: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-11-18',
  };
  const wipeResult = executeFullApplicationDataWipe({
    staffList: [primaryManager],
  });
  assert.equal(wipeResult.products.length, 0);
  assert.equal(wipeResult.sales.length, 0);
  assert.equal(wipeResult.imports.length, 0);
  assert.equal(wipeResult.preservedStaffList.length, 1);
  assert.equal(wipeResult.preservedStaffList[0].email, 'trannhat1205@gmail.com');
});

test('generateFiscalYearOptions pre-calculates future fiscal years (2028, 2029, 2030, 2031, 2032... 2040+) and computeTaxAuthorityFinancialStatement produces full tax-authority line items with drill-down audit records', () => {
  const defaultYears = generateFiscalYearOptions({ currentYear: 2026 });
  assert.equal(defaultYears.includes(2024), true);
  assert.equal(defaultYears.includes(2028), true);
  assert.equal(defaultYears.includes(2029), true);
  assert.equal(defaultYears.includes(2030), true);
  assert.equal(defaultYears.includes(2031), true);
  assert.equal(defaultYears.includes(2032), true);
  assert.equal(defaultYears.includes(2040), true);
  assert.equal(defaultYears[defaultYears.length - 1] >= 2041, true);

  // Selecting year 2045 automatically extends options through 2050
  const extendedYears = generateFiscalYearOptions({ currentYear: 2026, selectedYear: 2045 });
  assert.equal(extendedYears.includes(2045), true);
  assert.equal(extendedYears.includes(2050), true);

  const taxReport = computeTaxAuthorityFinancialStatement({
    fiscalYear: 2026,
    fromDate: '2026-01-01',
    toDate: '2026-12-31',
    taxRatePct: 1.5,
    products: mockProducts,
    sales: [
      {
        id: 'sale_tax_1',
        invoiceCode: 'HD-2611-001',
        customerId: 'cust_01',
        customerName: 'Ông Nguyễn Văn Hòa',
        customerPhone: '0913456789',
        productId: 'prod_1',
        productName: 'Phân bón NPK 20-20-15 Đầu Trâu',
        unit: 'Bao 50kg',
        quantity: 20,
        unitPrice: 750000,
        discountAmount: 500000,
        giftProductId: 'prod_2',
        giftProductName: 'Thuốc trừ sâu sinh học Radiant 60SC',
        giftUnit: 'Chai 100ml',
        giftQuantity: 2,
        giftUnitCost: 145000,
        totalAmount: 14500000, // (20 * 750,000) - 500,000
        paidAmount: 10000000,
        debtAmount: 4500000,
        dueDate: '2026-12-15',
        status: 'partial',
        warehouseName: 'Tâm An Mỹ Ngãi',
        note: '',
        staffName: 'Trần Đình Nhất',
        ownerId: 'u1',
        createdAt: '2026-11-10T08:00:00Z',
        updatedAt: '2026-11-10T08:00:00Z',
      },
    ],
    imports: [
      {
        id: 'imp_tax_1',
        receiptCode: 'PN-2611-001',
        supplierName: 'Công ty Phân bón Bình Điền',
        supplierPhone: '02837560110',
        productId: 'prod_1',
        productName: 'Phân bón NPK 20-20-15 Đầu Trâu',
        unit: 'Bao 50kg',
        quantity: 20,
        unitCost: 680000,
        totalCost: 13600000,
        paidAmount: 8600000,
        debtAmount: 5000000,
        dueDate: '2026-12-20',
        status: 'partial',
        warehouseName: 'Tâm An Mỹ Ngãi',
        note: '',
        staffName: 'Trần Đình Nhất',
        ownerId: 'u1',
        createdAt: '2026-11-05T08:00:00Z',
        updatedAt: '2026-11-05T08:00:00Z',
      },
    ],
    receiptVouchers: [
      {
        id: 'rv_tax_1',
        voucherCode: 'PT-2611-01',
        groupName: 'Thu thưởng chiết khấu Nhà cung cấp',
        warehouseName: 'Tâm An Mỹ Ngãi',
        partnerName: 'NCC Bình Điền',
        partnerPhone: '02837560110',
        amount: 600000,
        paymentMethod: 'Chuyển khoản ngân hàng',
        isDebtSettlement: false,
        countsTowardOtherIncome: true,
        note: 'Thưởng đại lý',
        staffName: 'Trần Đình Nhất',
        ownerId: 'u1',
        createdAt: '2026-11-12T08:00:00Z',
        updatedAt: '2026-11-12T08:00:00Z',
      },
    ],
    paymentVouchers: [
      {
        id: 'pv_tax_1',
        voucherCode: 'PC-2611-01',
        groupName: 'Chi phí vận chuyển & bốc xếp',
        warehouseName: 'Tâm An Mỹ Ngãi',
        partnerName: 'Đội xe vận tải',
        partnerPhone: '0909123456',
        amount: 400000,
        paymentMethod: 'Tiền mặt',
        isDebtSettlement: false,
        countsTowardOperatingExpense: true,
        note: 'Chi bốc xếp',
        staffName: 'Trần Đình Nhất',
        ownerId: 'u1',
        createdAt: '2026-11-14T08:00:00Z',
        updatedAt: '2026-11-14T08:00:00Z',
      },
    ],
  });

  // Mã 01: Gross revenue = 15,000,000
  assert.equal(taxReport.grossRevenue01, 15000000);
  // Mã 02: Revenue deduction = 500,000
  assert.equal(taxReport.revenueDeduction02, 500000);
  // Mã 10: Net revenue = 14,500,000
  assert.equal(taxReport.netRevenue10, 14500000);
  // Mã 11: COGS = 20 * 680,000 (13,600,000) + 2 * 145,000 (290,000) = 13,890,000
  assert.equal(taxReport.productCogs11a, 13600000);
  assert.equal(taxReport.giftCogs11b, 290000);
  assert.equal(taxReport.totalCogs11, 13890000);
  // Mã 20: Gross profit = 14,500,000 - 13,890,000 = 610,000
  assert.equal(taxReport.grossProfit20, 610000);
  // Mã 24: Operating expenses = 400,000
  assert.equal(taxReport.operatingExpenses24, 400000);
  // Mã 30: Operating profit = 610,000 - 400,000 = 210,000
  assert.equal(taxReport.operatingProfit30, 210000);
  // Mã 31: Other income = 600,000
  assert.equal(taxReport.otherIncome31, 600000);
  // Mã 50: Profit before tax = 210,000 + 600,000 = 810,000
  assert.equal(taxReport.profitBeforeTax50, 810000);
  // Mã 51: Estimated tax (1.5% of 14,500,000) = 217,500
  assert.equal(taxReport.estimatedTax51, 217500);
  // Mã 60: Profit after tax = 810,000 - 217,500 = 592,500
  assert.equal(taxReport.profitAfterTax60, 592500);
  // Mã 131: Customer receivables = 4,500,000; Mã 331: Supplier payables = 5,000,000
  assert.equal(taxReport.customerReceivables131, 4500000);
  assert.equal(taxReport.supplierPayables331, 5000000);
  // Drill-down line count check
  assert.equal(taxReport.incomeStatementLines.length, 11);
  assert.equal(taxReport.balanceAndCashflowLines.length, 5);
  assert.equal(taxReport.saleCogsBreakdown.length, 1);
  assert.equal(taxReport.inventoryValuationRows.length, 2);
});

test('canStaffFilterMultiWarehouses, resolveActiveWarehouses, filterRecordsBySelectedWarehouses, and formatSelectedWarehousesBadge support single, multi-checkbox, and all-warehouse filtering for Primary Manager and Deputy General Manager', () => {
  const warehouses = ['Tâm An Mỹ Ngãi', 'Tâm An Cao Lãnh', 'Tâm An Mỹ Trà'];

  const primaryManager: StaffMember = {
    uid: 'staff_01',
    username: 'admin',
    password: '885300',
    displayName: 'Trần Đình Nhất',
    email: 'trannhat1205@gmail.com',
    phone: '0393120246',
    role: 'manager',
    positionRole: 'primary_manager',
    permissions: ['create_staff_accounts', 'manage_all_warehouses'],
    assignedWarehouse: 'Tất cả kho',
    active: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-11-21',
  };

  const deputyManager: StaffMember = {
    uid: 'staff_02',
    username: 'pho_quanly',
    password: '123456',
    displayName: 'Nguyễn Minh Quân',
    email: 'quan.pho@gmail.com',
    phone: '0909111222',
    role: 'manager',
    positionRole: 'deputy_general_manager',
    permissions: ['manage_all_warehouses'],
    assignedWarehouse: 'Tất cả kho',
    active: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-11-21',
  };

  const singleWarehouseStaff: StaffMember = {
    uid: 'staff_03',
    username: 'nam_banhang',
    password: '123456',
    displayName: 'Lê Hoàng Nam',
    email: 'nam@gmail.com',
    phone: '0909333444',
    role: 'staff',
    positionRole: 'warehouse_manager',
    permissions: ['manage_single_warehouse'],
    assignedWarehouse: 'Tâm An Mỹ Ngãi',
    active: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-11-21',
  };

  assert.equal(canStaffFilterMultiWarehouses(primaryManager), true);
  assert.equal(canStaffFilterMultiWarehouses(deputyManager), true);
  assert.equal(canStaffFilterMultiWarehouses(singleWarehouseStaff), false);

  const sampleRecords = [
    { id: 'r1', warehouseName: 'Tâm An Mỹ Ngãi' },
    { id: 'r2', warehouseName: 'Tâm An Cao Lãnh' },
    { id: 'r3', warehouseName: 'Tâm An Mỹ Trà' },
  ];

  // 1. All warehouses selected (empty or all 3)
  assert.equal(
    filterRecordsBySelectedWarehouses(sampleRecords, primaryManager, warehouses, []).length,
    3
  );
  assert.equal(
    formatSelectedWarehousesBadge(primaryManager, warehouses, []),
    'Tất cả kho (3)'
  );

  // 2. Single warehouse selected by Deputy General Manager
  const singleFiltered = filterRecordsBySelectedWarehouses(
    sampleRecords,
    deputyManager,
    warehouses,
    ['Tâm An Cao Lãnh']
  );
  assert.equal(singleFiltered.length, 1);
  assert.equal(singleFiltered[0].id, 'r2');
  assert.equal(
    formatSelectedWarehousesBadge(deputyManager, warehouses, ['Tâm An Cao Lãnh']),
    'Tâm An Cao Lãnh'
  );

  // 3. Multi-warehouse (2 warehouses checked simultaneously)
  const twoWarehouses = ['Tâm An Mỹ Ngãi', 'Tâm An Mỹ Trà'];
  const multiFiltered = filterRecordsBySelectedWarehouses(
    sampleRecords,
    primaryManager,
    warehouses,
    twoWarehouses
  );
  assert.equal(multiFiltered.length, 2);
  assert.deepEqual(
    multiFiltered.map((r) => r.id),
    ['r1', 'r3']
  );
  assert.equal(
    formatSelectedWarehousesBadge(primaryManager, warehouses, twoWarehouses, false),
    'Đã chọn 2/3 kho'
  );
  assert.equal(
    formatSelectedWarehousesBadge(primaryManager, warehouses, twoWarehouses, true),
    'Tâm An Mỹ Ngãi, Tâm An Mỹ Trà (2/3 kho)'
  );

  // 4. Single warehouse staff is always locked to their assigned warehouse even if selectedWarehouses is passed
  const staffFiltered = filterRecordsBySelectedWarehouses(
    sampleRecords,
    singleWarehouseStaff,
    warehouses,
    ['Tâm An Cao Lãnh', 'Tâm An Mỹ Trà']
  );
  assert.equal(staffFiltered.length, 1);
  assert.equal(staffFiltered[0].warehouseName, 'Tâm An Mỹ Ngãi');
  assert.deepEqual(
    resolveActiveWarehouses(singleWarehouseStaff, warehouses, ['Tâm An Cao Lãnh']),
    ['Tâm An Mỹ Ngãi']
  );
});

test('Gmail registration default warehouse naming, immutable TÂM AN prefix rename, Admin UID, and independent warehouse full admin features', () => {
  // 1. Default warehouse name from Gmail registration: vtnntaman@gmail.com -> TÂM AN VTNNTAMAN
  assert.equal(
    formatDefaultWarehouseNameFromGmail('vtnntaman@gmail.com'),
    'TÂM AN VTNNTAMAN'
  );
  assert.equal(
    formatDefaultWarehouseNameFromGmail('  DaiLyBaSao@gmail.com '),
    'TÂM AN DAILYBASAO'
  );

  // 2. Extracting and normalizing custom warehouse display name with immutable "TÂM AN" prefix
  assert.equal(
    extractCustomWarehouseSuffix('TÂM AN VTNNTAMAN'),
    'VTNNTAMAN'
  );
  assert.equal(
    normalizeCustomTamAnWarehouseName('Ba Sao', 'TÂM AN VTNNTAMAN'),
    'TÂM AN BA SAO'
  );
  assert.equal(
    normalizeCustomTamAnWarehouseName('TÂM AN BA SAO', 'TÂM AN VTNNTAMAN'),
    'TÂM AN BA SAO'
  );
  assert.equal(
    normalizeCustomTamAnWarehouseName('   ', 'TÂM AN VTNNTAMAN'),
    'TÂM AN VTNNTAMAN'
  );

  // 3. Admin UID Gu6OYdsdiWbRvbEINqaWZXj3LV83 recognition
  assert.equal(PRIMARY_ADMIN_UID, 'Gu6OYdsdiWbRvbEINqaWZXj3LV83');
  const adminAccount: StaffMember = {
    uid: PRIMARY_ADMIN_UID,
    username: 'admin.firebase',
    password: '123456',
    displayName: 'Quản Trị Viên Hệ Thống',
    role: 'manager',
    positionRole: 'primary_manager',
    assignedWarehouse: 'Tất cả kho',
    permissions: getDefaultPermissionsForPosition('primary_manager'),
    phone: '0909123456',
    email: 'admin@gmail.com',
    active: true,
    createdAt: '2026-11-20',
    updatedAt: '2026-11-20',
  };
  assert.equal(canAccountCreateStaff(adminAccount), true);
  const adminScope = evaluateStaffAccessScope(adminAccount);
  assert.equal(adminScope.isPrimaryOwner, true);
  assert.equal(adminScope.canAccessBackupHistory, true);
  assert.equal(adminScope.allowedTabs.includes('backup_history'), true);
  assert.equal(adminScope.allowedTabs.includes('gemini_chat'), true);
  assert.equal(adminScope.allowedTabs.length, 13);

  // 4. Independent single-warehouse user account has 12 tabs (all tabs EXCEPT backup_history) and all 8 report categories (including financial_profit) scoped strictly to their own warehouse
  const newGmailUser: StaffMember = {
    uid: 'user_uid_vtnntaman',
    username: 'vtnntaman',
    password: '123456',
    displayName: 'Đại Lý Ba Sao',
    role: 'staff',
    positionRole: 'warehouse_manager',
    assignedWarehouse: 'TÂM AN VTNNTAMAN',
    permissions: getIndependentWarehouseFullPermissions(),
    phone: '',
    email: 'vtnntaman@gmail.com',
    active: true,
    createdAt: '2026-11-22',
    updatedAt: '2026-11-22',
  };

  assert.equal(canAccountCreateStaff(newGmailUser), false);
  const userScope = evaluateStaffAccessScope(newGmailUser);
  assert.equal(userScope.isPrimaryOwner, false);
  assert.equal(userScope.canAccessBackupHistory, false);
  assert.equal(userScope.allowedTabs.length, 12);
  assert.equal(userScope.allowedTabs.includes('reports'), true);
  assert.equal(userScope.allowedTabs.includes('gemini_chat'), true);
  assert.equal(userScope.allowedTabs.includes('backup_history'), false);
  assert.equal(userScope.allowedReportCategories.includes('financial_profit'), true);
  assert.equal(userScope.allowedReportCategories.length, 8);

  // 5. Complete warehouse isolation for customers, suppliers, and saved vouchers:
  // A newly created account (@nhattamnhanqua1 -> TÂM AN NHATTAMNHANQUA1) sees 0 customers, 0 suppliers, and 0 saved vouchers from other warehouses.
  const allWarehouses = [
    'Tâm An Mỹ Ngãi',
    'Tâm An Cao Lãnh',
    'Tâm An Mỹ Trà',
    'TÂM AN NHATTAMNHANQUA1',
  ];
  const nhatTamUser: StaffMember = {
    uid: 'staff_nhattamnhanqua1',
    username: 'nhattamnhanqua1',
    password: '123456',
    displayName: 'nhattamnhanqua1',
    role: 'manager',
    positionRole: 'warehouse_manager',
    assignedWarehouse: 'TÂM AN NHATTAMNHANQUA1',
    permissions: getIndependentWarehouseFullPermissions(),
    phone: '',
    email: 'nhattamnhanqua1@gmail.com',
    active: true,
    createdAt: '2026-11-22',
    updatedAt: '2026-11-22',
  };

  assert.equal(
    filterRecordsBySelectedWarehouses(INITIAL_CUSTOMERS, nhatTamUser, allWarehouses, []).length,
    0
  );
  assert.equal(
    filterRecordsBySelectedWarehouses(INITIAL_SUPPLIERS, nhatTamUser, allWarehouses, []).length,
    0
  );
  assert.equal(
    filterRecordsBySelectedWarehouses(INITIAL_SAVED_VOUCHERS, nhatTamUser, allWarehouses, [])
      .length,
    0
  );

  // When Primary Admin assigns that user to 'Tâm An Mỹ Ngãi', they see only 'Tâm An Mỹ Ngãi' customers (2), suppliers (2), and saved vouchers (2)
  const adminAssignedMyNgaiUser: StaffMember = {
    ...nhatTamUser,
    assignedWarehouse: 'Tâm An Mỹ Ngãi',
  };
  assert.equal(
    filterRecordsBySelectedWarehouses(
      INITIAL_CUSTOMERS,
      adminAssignedMyNgaiUser,
      allWarehouses,
      []
    ).length,
    2
  );
  assert.equal(
    filterRecordsBySelectedWarehouses(
      INITIAL_SUPPLIERS,
      adminAssignedMyNgaiUser,
      allWarehouses,
      []
    ).length,
    2
  );
  assert.equal(
    filterRecordsBySelectedWarehouses(
      INITIAL_SAVED_VOUCHERS,
      adminAssignedMyNgaiUser,
      allWarehouses,
      []
    ).length,
    2
  );
});

test('Production hardening: sequential voucher codes, Vietnam dates, SHA-256 password hashing, and clean empty workspace', async () => {
  const fixedDate = new Date('2026-11-23T14:00:00.000Z');
  assert.equal(getTodayVietnamDateStr(fixedDate), '2026-11-23');
  const monthRange = getCurrentMonthRangeVietnam(fixedDate);
  assert.equal(monthRange.from, '2026-11-01');
  assert.equal(monthRange.to, '2026-11-30');

  assert.equal(generateSequentialVoucherCode('HD', [], fixedDate), 'HD-2611-001');
  assert.equal(
    generateSequentialVoucherCode('HD', ['HD-2611-001', 'HD-2611-004'], fixedDate),
    'HD-2611-005'
  );

  const hashed = await hashPassword('MatKhauManh#2026', 'uid_test_1');
  assert.equal(isHashedPassword(hashed), true);
  assert.equal(await verifyPassword('MatKhauManh#2026', hashed, 'uid_test_1'), true);
  assert.equal(await verifyPassword('SaiMatKhau', hashed, 'uid_test_1'), false);
  assert.equal(await verifyPassword('885300', '885300', 'uid_test_1'), false);

  const emptyWs = createEmptyWorkspaceState();
  assert.equal(emptyWs.products.length, 0);
  assert.equal(emptyWs.customers.length, 0);
  assert.equal(emptyWs.sales.length, 0);
  assert.equal(emptyWs.imports.length, 0);
  assert.equal(emptyWs.receiptVouchers.length, 0);
  assert.equal(emptyWs.paymentVouchers.length, 0);
  assert.equal(emptyWs.staffList.length, 1);
  assert.equal(emptyWs.staffList[0].password, '');

  const sanitized = sanitizeStaffListForStorage([
    {
      ...emptyWs.staffList[0],
      password: 'plaintext_should_be_stripped',
    },
  ]);
  assert.equal(sanitized[0].password, '');
});

test('Gemini Report Assistant: builds accurate warehouse report snapshot, system instruction, cost-optimized model routing, and answers in-app and external queries', () => {
  assert.equal(GEMINI_MODEL_OPTIONS.length, 4);
  assert.equal(DEFAULT_GEMINI_MODEL, 'gemini-3.1-flash-lite');
  assert.equal(GEMINI_MODEL_OPTIONS[0].id, 'gemini-3.1-flash-lite');
  assert.equal(GEMINI_MODEL_OPTIONS[0].badge, 'Cơ bản');
  assert.equal(GEMINI_MODEL_OPTIONS[1].id, 'gemini-4-hydrogen');

  // Rule 1 & Rule 2: Simple warehouse / price queries default to gemini-3.1-flash-lite with MINIMAL thinking & 900 maxOutputTokens
  const simpleRouting = classifyQueryRoutingAndCostConfig('Tóm tắt báo cáo doanh thu kho');
  assert.equal(simpleRouting.targetModel, 'gemini-3.1-flash-lite');
  assert.equal(simpleRouting.thinkingLevel, 'MINIMAL');
  assert.equal(simpleRouting.maxOutputTokens, 900);
  assert.equal(simpleRouting.isComplexQuery, false);
  assert.equal(simpleRouting.enableExternalSearch, false);

  // Complex reconciliation/forecasting escalates to gemini-4-hydrogen with 1400 maxOutputTokens
  const complexRouting = classifyQueryRoutingAndCostConfig(
    'Phân tích sâu và dự báo dòng tiền, đối soát công nợ chiến lược 6 tháng tới'
  );
  assert.equal(complexRouting.targetModel, 'gemini-4-hydrogen');
  assert.equal(complexRouting.thinkingLevel, 'LOW');
  assert.equal(complexRouting.maxOutputTokens, 1400);
  assert.equal(complexRouting.isComplexQuery, true);

  // Explicit user selection of larger model is respected
  const userSelectedNeon = classifyQueryRoutingAndCostConfig(
    'Kiểm tra tồn kho',
    'gemini-4-neon'
  );
  assert.equal(userSelectedNeon.targetModel, 'gemini-4-neon');
  assert.equal(userSelectedNeon.thinkingLevel, 'LOW');

  // Rule 3: External web search only enabled when query genuinely requires fresh external info
  assert.equal(shouldEnableExternalWebSearch('Tóm tắt báo cáo doanh thu kho hiện tại'), false);
  assert.equal(shouldEnableExternalWebSearch('Danh sách khách hàng đang nợ quá hạn'), false);
  assert.equal(shouldEnableExternalWebSearch('Kỹ thuật bón phân NPK cho lúa'), false);
  assert.equal(shouldEnableExternalWebSearch('giá phân bón hiện nay thế nào'), true);
  assert.equal(shouldEnableExternalWebSearch('giá lúa om18 hôm nay bao nhiêu'), true);

  const scope = evaluateStaffAccessScope(PRODUCTION_PRIMARY_ADMIN);
  assert.equal(scope.allowedTabs.includes('gemini_chat'), true);

  const snapshot = buildWarehouseReportSnapshot({
    warehouseLabel: 'Tâm An Mỹ Ngãi',
    currentStaff: PRODUCTION_PRIMARY_ADMIN,
    products: INITIAL_PRODUCTS,
    customers: INITIAL_CUSTOMERS,
    suppliers: INITIAL_SUPPLIERS,
    sales: INITIAL_SALES,
    imports: INITIAL_IMPORTS,
    receiptVouchers: INITIAL_RECEIPT_VOUCHERS,
    paymentVouchers: INITIAL_PAYMENT_VOUCHERS,
  });

  // Rule 3: Cache key differentiates internal warehouse state vs external market queries
  const internalKey1 = buildGeminiQueryCacheKey('Tóm tắt báo cáo doanh thu', snapshot);
  const internalKey2 = buildGeminiQueryCacheKey('  Tóm tắt   báo cáo doanh thu ', snapshot);
  assert.equal(internalKey1, internalKey2);
  assert.ok(internalKey1.startsWith('vtnn_ai_cache_int_'));

  const extKey = buildGeminiQueryCacheKey('giá phân bón hiện nay thế nào', snapshot);
  assert.ok(extKey.startsWith('vtnn_ai_cache_ext_'));

  assert.equal(snapshot.warehouseLabel, 'Tâm An Mỹ Ngãi');
  assert.equal(snapshot.productsCount, INITIAL_PRODUCTS.length);
  assert.equal(snapshot.customersCount, INITIAL_CUSTOMERS.length);
  assert.equal(snapshot.salesCount, INITIAL_SALES.length);
  assert.ok(snapshot.totalSalesRevenue > 0);
  assert.ok(snapshot.totalCustomerDebt > 0);
  assert.ok(snapshot.debtorCustomers.length > 0);

  const sysInstruction = buildGeminiSystemInstruction(snapshot);
  assert.ok(sysInstruction.includes('Tâm An Mỹ Ngãi'));
  assert.ok(sysInstruction.includes('SỐ LIỆU BÁO CÁO THỜI GIAN THỰC CỦA KHO'));

  const overviewAns = generateSmartReportAnswer('Tóm tắt báo cáo doanh thu', snapshot);
  assert.ok(overviewAns.includes('Báo cáo Tổng hợp Hoạt động Kinh doanh'));

  const debtAns = generateSmartReportAnswer('Danh sách khách hàng đang nợ', snapshot);
  assert.ok(debtAns.includes('Báo cáo Công nợ Phải thu Khách hàng'));

  const om18Ans = generateSmartReportAnswer('giá lúa om18 hiện nay bao nhiêu', snapshot);
  assert.ok(om18Ans.includes('Cập nhật Giá Lúa Gạo Thị Trường Khu Vực ĐBSCL'));
  assert.ok(om18Ans.includes('Lúa OM 18'));

  // Test fertilizer price query in NFC, NFD (combining diacritics), and unaccented Vietnamese
  const fertNfcAns = generateSmartReportAnswer('giá phân bón hiện nay thế nào', snapshot);
  assert.ok(fertNfcAns.includes('Cập nhật Giá Phân Bón Thị Trường Hiện Nay'));
  assert.ok(!fertNfcAns.includes('Báo cáo Tổng hợp Hoạt động Kinh doanh'));

  const fertNfdQuery = 'giá phân bón hiện nay thế nào'.normalize('NFD');
  const fertNfdAns = generateSmartReportAnswer(fertNfdQuery, snapshot);
  assert.ok(fertNfdAns.includes('Cập nhật Giá Phân Bón Thị Trường Hiện Nay'));
  assert.ok(!fertNfdAns.includes('Báo cáo Tổng hợp Hoạt động Kinh doanh'));

  const fertAsciiAns = generateSmartReportAnswer('gia phan bon hien nay the nao', snapshot);
  assert.ok(fertAsciiAns.includes('Cập nhật Giá Phân Bón Thị Trường Hiện Nay'));
  assert.ok(!fertAsciiAns.includes('Báo cáo Tổng hợp Hoạt động Kinh doanh'));

  const bvtvAns = generateSmartReportAnswer('giá thuốc trừ sâu hiện nay', snapshot);
  assert.ok(bvtvAns.includes('Bảng Giá & Danh Mục Thuốc Bảo Vệ Thực Vật'));

  const durianAns = generateSmartReportAnswer('giá sầu riêng ri6 hôm nay', snapshot);
  assert.ok(durianAns.includes('Cập nhật Giá Nông Sản & Trái Cây Chủ Lực'));

  const agroAns = generateSmartReportAnswer('Kỹ thuật bón phân cho lúa và sầu riêng', snapshot);
  assert.ok(agroAns.includes('Tư vấn Kỹ thuật Nông nghiệp'));
});



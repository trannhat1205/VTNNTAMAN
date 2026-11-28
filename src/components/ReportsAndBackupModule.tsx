import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  Calendar,
  CheckCircle2,
  CloudUpload,
  Download,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  FileText,
  History,
  Lightbulb,
  Printer,
  RotateCcw,
  Search,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Trash2,
  TrendingUp,
  Truck,
  Upload,
  Users,
  Wallet,
  Warehouse,
  X,
} from 'lucide-react';
import {
  AuditActionCategory,
  AuditLogEntry,
  BackupEntry,
  BackupSnapshotPayload,
  CashPaymentVoucher,
  CashReceiptVoucher,
  CustomerProfile,
  ImportTransaction,
  ProductItem,
  ReportModuleCategory,
  SaleTransaction,
  SavedVoucherRecord,
  StaffMember,
  UserRole,
} from '../types';
import { ADMIN_BACKUP_EMAIL } from '../data/seedData';
import {
  ALL_STAFF_FUNCTIONAL_PERMISSIONS,
  canViewAuditHistory,
  computeCashflowAndFinancialReport,
  computeProvisionalCashbookProfitSummary,
  computeReceivedItemsAndDebtReport,
  computeTaxAuthorityFinancialStatement,
  countDistinctImportReceipts,
  countDistinctSalesInvoices,
  evaluateDebtUrgency,
  evaluateStaffAccessScope,
  evaluateStockAlert,
  extractRecordYear,
  findDirectPaymentVouchersForImport,
  findDirectReceiptVouchersForSale,
  findLinkedPaymentVouchersForImport,
  findLinkedReceiptVouchersForSale,
  formatVND,
  generateFiscalYearOptions,
  generateSmartReportRecommendations,
  getCurrentMonthRangeVietnam,
  getCurrentQuarterRangeVietnam,
  getDefaultPermissionsForPosition,
  getPositionRoleLabel,
  getRecentDaysRangeVietnam,
  getReportCategoryMetaForAccount,
  getTodayVietnamDateStr,
  isContraOffsetVoucher,
  isDateWithinRange,
  normalizeVietnameseSearch,
  parseAndValidateBackupPayload,
  previewFiscalYearCloseAndCleanup,
  resolveSaleGiftUnitCost,
  resolveSaleUnitCost,
  TaxFinancialDrillDownCode,
  toVietnamDateStr,
} from '../utils/businessLogic';
import {
  exportCombinedReceivedItemsAndDebtExcel,
  exportCombinedReceivedItemsAndDebtPDF,
  exportComprehensiveDateRangeReportExcel,
  exportComprehensiveDateRangeReportPDF,
  exportImportReceiptPDF,
  exportSaleInvoicePDF,
  exportTaxAuthorityFinancialReportExcel,
  exportTaxAuthorityFinancialReportPDF,
} from '../utils/exportReports';
import { uploadFileToFirebaseStorage } from '../services/firebaseService';
import { WarehouseCashbookReportPanel } from './WarehouseCashbookReportPanel';

export type ReportsOrBackupViewMode = 'reports' | 'backup_history';

interface ReportsAndBackupModuleProps {
  mode?: ReportsOrBackupViewMode;
  activeWarehouseLabel?: string;
  role: UserRole;
  currentStaff: StaffMember;
  isGoogleAuthenticated: boolean;
  currentUserEmail: string | null;
  products: ProductItem[];
  customers: CustomerProfile[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  receiptVouchers?: CashReceiptVoucher[];
  paymentVouchers?: CashPaymentVoucher[];
  savedVouchers?: SavedVoucherRecord[];
  backups: BackupEntry[];
  staffList: StaffMember[];
  auditLogs: AuditLogEntry[];
  autoDailyBackupEnabled: boolean;
  onToggleAutoDailyBackup: (enabled: boolean) => void;
  onTriggerDriveBackup: () => Promise<void>;
  onDeleteBackupRecord: (backup: BackupEntry) => Promise<void>;
  onDownloadBackupFile: (backup?: BackupEntry) => void;
  onRestoreBackupPayload: (payload: BackupSnapshotPayload) => void;
  onRestoreDeletedRecordFromAudit: (audit: AuditLogEntry) => void;
  onGoogleLogin: (role: UserRole) => Promise<unknown>;
  onSwitchRolePreview: (role: UserRole) => void;
  onNotifyToast: (message: string) => void;
  onCollectCustomerDebt?: (saleId: string, amount: number, note: string) => void;
  onCollectCustomerDebtBatch?: (
    items: Array<{ saleId: string; amount: number }>,
    note: string
  ) => void;
  onSettleCustomerTotalDebtFifo?: (params: {
    customerId?: string;
    customerName: string;
    customerPhone: string;
    totalAmount: number;
    groupName: string;
    paymentMethod: string;
    note: string;
  }) => void;
  onPaySupplierDebt?: (importId: string, amount: number, note: string) => void;
  onExecuteFiscalYearCloseAndCleanup?: (
    fiscalYear: number,
    autoDownloadBackup: boolean
  ) => void;
  onExecuteFullApplicationDataWipe?: (autoDownloadBackup: boolean) => void | Promise<void>;
  onNavigateToModule?: (
    tab:
      | 'sales'
      | 'imports'
      | 'inventory'
      | 'customers'
      | 'debts'
      | 'receipt_vouchers'
      | 'payment_vouchers'
      | 'vouchers',
    focusedRecordId?: string
  ) => void;
}

type DrillDownTarget =
  | { type: 'sale'; record: SaleTransaction }
  | { type: 'import'; record: ImportTransaction }
  | { type: 'product'; record: ProductItem }
  | { type: 'customer'; record: CustomerProfile };

const REPORT_CATEGORY_META: Record<
  ReportModuleCategory,
  { label: string; shortLabel: string; description: string }
> = {
  overview: {
    label: '1. Tổng Hợp Chung',
    shortLabel: 'Tổng hợp chung',
    description: 'Bức tranh tổng thể các chỉ số trong khoảng thời gian đã chọn',
  },
  customers_items: {
    label: '2. Hàng Hóa Đã Nhận & Khách Hàng',
    shortLabel: 'Hàng đã nhận & KH',
    description: 'Danh sách mặt hàng đã nhận, còn nợ & thu nợ tổng hợp từ ngày ... đến ngày ...',
  },
  sales_log: {
    label: '3. Nhật Ký Bán Hàng',
    shortLabel: 'Nhật ký Bán hàng',
    description: 'Chi tiết hóa đơn xuất bán, số lượng, đơn giá, thực thu và công nợ phát sinh',
  },
  imports_log: {
    label: '4. Nhật Ký Nhập Hàng',
    shortLabel: 'Nhật ký Nhập hàng',
    description: 'Chi tiết phiếu nhập kho vật tư từ Nhà cung cấp và công nợ phải trả',
  },
  inventory_stock: {
    label: '5. Quản Lý Tồn Kho',
    shortLabel: 'Quản lý Tồn kho',
    description: 'Biến động Nhập - Xuất - Tồn trong kỳ và cảnh báo vật tư sắp hết',
  },
  debts_receivable_payable: {
    label: '6. Quản Lý Công Nợ (KH & NCC)',
    shortLabel: 'Quản lý Công nợ',
    description: 'Tổng hợp tất cả hàng hóa còn nợ, hạn hẹn thanh toán và thu/trả nợ',
  },
  cashflow_treasury: {
    label: '7. Thu - Chi Dòng Tiền',
    shortLabel: 'Thu - Chi Dòng tiền',
    description: 'Sổ quỹ dòng tiền thực thu, thực chi và dòng tiền ròng từ ngày ... đến ngày ...',
  },
  financial_profit: {
    label: '8. Báo Cáo Tài Chính & Lợi Nhuận',
    shortLabel: 'Báo cáo Tài chính',
    description: 'Phân tích Doanh thu, Giá vốn, Lợi nhuận gộp và Tỷ suất sinh lời (Quản lý chính)',
  },
};

export const ReportsAndBackupModule: React.FC<ReportsAndBackupModuleProps> = ({
  mode = 'reports',
  activeWarehouseLabel,
  role,
  currentStaff,
  isGoogleAuthenticated,
  currentUserEmail,
  products,
  customers,
  sales,
  imports,
  receiptVouchers = [],
  paymentVouchers = [],
  savedVouchers = [],
  backups,
  staffList,
  auditLogs,
  autoDailyBackupEnabled,
  onToggleAutoDailyBackup,
  onTriggerDriveBackup,
  onDeleteBackupRecord,
  onDownloadBackupFile,
  onRestoreBackupPayload,
  onRestoreDeletedRecordFromAudit,
  onGoogleLogin,
  onSwitchRolePreview,
  onNotifyToast,
  onCollectCustomerDebt,
  onCollectCustomerDebtBatch,
  onSettleCustomerTotalDebtFifo,
  onExecuteFiscalYearCloseAndCleanup,
  onExecuteFullApplicationDataWipe,
  onNavigateToModule,
}) => {
  // STRICT RULE: Only Admin (Gu6OYdsdiWbRvbEINqaWZXj3LV83 / trannhat1205@gmail.com) sees & accesses "Sao lưu & Lịch sử"
  const isPrimaryAdmin = canViewAuditHistory(currentStaff);
  const accessScope = useMemo(() => evaluateStaffAccessScope(currentStaff), [currentStaff]);
  const canAccessWarehouseAdminFeatures = isPrimaryAdmin;
  const allowedCategories = accessScope.allowedReportCategories;

  // Date range state (Từ ngày ... Đến ngày ...)
  const todayStr = getTodayVietnamDateStr();
  const currentMonthRange = useMemo(() => getCurrentMonthRangeVietnam(), []);
  const recent7DaysRange = useMemo(() => getRecentDaysRangeVietnam(7), []);
  const currentQuarterRange = useMemo(() => getCurrentQuarterRangeVietnam(), []);
  const [fromDate, setFromDate] = useState<string>(currentMonthRange.from);
  const [toDate, setToDate] = useState<string>(currentMonthRange.to);
  const [activeCategory, setActiveCategory] = useState<ReportModuleCategory>('overview');
  const [reportSearch, setReportSearch] = useState<string>('');

  // Filters for "Danh sách tổng hợp tất cả các hàng hóa đã nhận / còn nợ & thu nợ"
  const [selectedCustomerIdFilter, setSelectedCustomerIdFilter] = useState<string>('all');
  const [onlyUnpaidGoods, setOnlyUnpaidGoods] = useState<boolean>(false);

  // Batch debt collection modal inside Reports
  const [isBatchCollectOpen, setIsBatchCollectOpen] = useState<boolean>(false);
  const [batchCollectAmount, setBatchCollectAmount] = useState<string>('');
  const [batchCollectNote, setBatchCollectNote] = useState<string>('');

  // Drill-down detail inspection modal when clicking any item in a report
  const [drillDownItem, setDrillDownItem] = useState<DrillDownTarget | null>(null);

  // Backup & Audit states (when mode === 'backup_history')
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [confirmBackupModal, setConfirmBackupModal] = useState(false);
  const [confirmDeleteBackup, setConfirmDeleteBackup] = useState<BackupEntry | null>(null);
  const [pendingRestorePayload, setPendingRestorePayload] =
    useState<BackupSnapshotPayload | null>(null);
  const [inspectingAuditSnapshot, setInspectingAuditSnapshot] =
    useState<AuditLogEntry | null>(null);
  const [auditCategoryFilter, setAuditCategoryFilter] = useState<'all' | AuditActionCategory>(
    'all'
  );
  const [auditSearchQuery, setAuditSearchQuery] = useState('');
  const backupFileInputRef = useRef<HTMLInputElement | null>(null);

  // Primary Manager Fiscal Year Close & Settled Data Cleanup + Full Data Wipe states
  const [selectedFiscalYearToClose, setSelectedFiscalYearToClose] = useState<number>(2026);
  const [autoBackupBeforeFiscalClose, setAutoBackupBeforeFiscalClose] = useState<boolean>(true);
  const [confirmFiscalCloseModalOpen, setConfirmFiscalCloseModalOpen] = useState<boolean>(false);
  const [autoBackupBeforeFullWipe, setAutoBackupBeforeFullWipe] = useState<boolean>(true);
  const [confirmFullWipeModalOpen, setConfirmFullWipeModalOpen] = useState<boolean>(false);
  const [wipeConfirmPhrase, setWipeConfirmPhrase] = useState<string>('');
  const fiscalCloseSectionRef = useRef<HTMLDivElement | null>(null);
  const fullWipeSectionRef = useRef<HTMLDivElement | null>(null);

  // Tax-Authority Financial Statement (Báo cáo Tài chính Năm chuẩn Cơ quan Thuế) states
  const [selectedFinancialReportYear, setSelectedFinancialReportYear] = useState<number>(2026);
  const [taxRatePct, setTaxRatePct] = useState<number>(1.5);
  const [activeTaxDrillDownCode, setActiveTaxDrillDownCode] =
    useState<TaxFinancialDrillDownCode>('10_net_revenue');
  const taxDrillDownPanelRef = useRef<HTMLDivElement | null>(null);

  const availableFiscalYears = useMemo(() => {
    const dataYears: number[] = [];
    sales.forEach((s) => dataYears.push(extractRecordYear(s.createdAt, 2026)));
    imports.forEach((i) => dataYears.push(extractRecordYear(i.createdAt, 2026)));
    receiptVouchers.forEach((rv) => dataYears.push(extractRecordYear(rv.createdAt, 2026)));
    paymentVouchers.forEach((pv) => dataYears.push(extractRecordYear(pv.createdAt, 2026)));
    return generateFiscalYearOptions({
      startYear: 2024,
      minEndYear: 2040,
      currentYear: new Date().getFullYear(),
      dataYears,
      selectedYear: Math.max(selectedFiscalYearToClose, selectedFinancialReportYear),
    });
  }, [
    sales,
    imports,
    receiptVouchers,
    paymentVouchers,
    selectedFiscalYearToClose,
    selectedFinancialReportYear,
  ]);

  const fiscalYearClosePreview = useMemo(
    () =>
      previewFiscalYearCloseAndCleanup({
        fiscalYear: selectedFiscalYearToClose,
        products,
        customers,
        sales,
        imports,
        receiptVouchers,
        paymentVouchers,
        savedVouchers,
      }),
    [
      selectedFiscalYearToClose,
      products,
      customers,
      sales,
      imports,
      receiptVouchers,
      paymentVouchers,
      savedVouchers,
    ]
  );

  // Ensure activeCategory is always within the staff member's allowedReportCategories
  useEffect(() => {
    if (allowedCategories.length > 0 && !allowedCategories.includes(activeCategory)) {
      const fallback = allowedCategories[0] || 'overview';
      if (activeCategory !== fallback) {
        setActiveCategory(fallback);
      }
    }
  }, [allowedCategories, activeCategory]);

  // Filtered transactions by selected Date Range (Từ ngày ... Đến ngày ...) + search query
  const salesInRange = useMemo(() => {
    const q = normalizeVietnameseSearch(reportSearch);
    return sales.filter((s) => {
      if (!isDateWithinRange(s.createdAt, fromDate, toDate)) return false;
      if (!q) return true;
      return normalizeVietnameseSearch(
        `${s.invoiceCode} ${s.customerName} ${s.customerPhone} ${s.productName} ${s.warehouseName || ''} ${s.staffName}`
      ).includes(q);
    });
  }, [sales, fromDate, toDate, reportSearch]);

  const importsInRange = useMemo(() => {
    const q = normalizeVietnameseSearch(reportSearch);
    return imports.filter((i) => {
      if (!isDateWithinRange(i.createdAt, fromDate, toDate)) return false;
      if (!q) return true;
      return normalizeVietnameseSearch(
        `${i.receiptCode} ${i.supplierName} ${i.supplierPhone} ${i.productName} ${i.warehouseName || ''} ${i.staffName}`
      ).includes(q);
    });
  }, [imports, fromDate, toDate, reportSearch]);

  const filteredProducts = useMemo(() => {
    const q = normalizeVietnameseSearch(reportSearch);
    if (!q) return products;
    return products.filter((p) =>
      normalizeVietnameseSearch(
        `${p.code} ${p.name} ${p.category} ${p.supplierName} ${p.warehouseName || ''}`
      ).includes(q)
    );
  }, [products, reportSearch]);

  const filteredCustomers = useMemo(() => {
    const q = normalizeVietnameseSearch(reportSearch);
    if (!q) return customers;
    return customers.filter((c) =>
      normalizeVietnameseSearch(`${c.code} ${c.name} ${c.phone} ${c.group} ${c.address}`).includes(q)
    );
  }, [customers, reportSearch]);

  // Combined Received Items & Debt Report (Từ ngày ... Đến ngày ...)
  const receivedItemsReport = useMemo(
    () =>
      computeReceivedItemsAndDebtReport(salesInRange, {
        fromDate,
        toDate,
        customerId: selectedCustomerIdFilter === 'all' ? undefined : selectedCustomerIdFilter,
        onlyUnpaid: onlyUnpaidGoods,
      }),
    [salesInRange, fromDate, toDate, selectedCustomerIdFilter, onlyUnpaidGoods]
  );

  const selectedCustomerObj = useMemo(
    () => customers.find((c) => c.id === selectedCustomerIdFilter) || null,
    [customers, selectedCustomerIdFilter]
  );

  // Automatic Smart Report Recommendations tailored to the staff's assigned permissions & date range
  const smartRecommendations = useMemo(
    () =>
      generateSmartReportRecommendations({
        staff: currentStaff,
        products,
        customers,
        sales,
        imports,
        receiptVouchers,
        paymentVouchers,
        fromDate,
        toDate,
      }),
    [currentStaff, products, customers, sales, imports, receiptVouchers, paymentVouchers, fromDate, toDate]
  );

  // Date-range KPI calculations (including promotional discounts, gift items, receipt vouchers & payment vouchers)
  const cashflowFinancial = useMemo(
    () =>
      computeCashflowAndFinancialReport({
        sales,
        imports,
        products,
        receiptVouchers,
        paymentVouchers,
        fromDate,
        toDate,
      }),
    [sales, imports, products, receiptVouchers, paymentVouchers, fromDate, toDate]
  );

  // Tax-Authority-Grade Annual Financial Report (Mẫu B02-DN, B01-DN, B03-DN) with clickable line-item audit breakdown
  const taxFinancialStatement = useMemo(
    () =>
      computeTaxAuthorityFinancialStatement({
        fiscalYear: selectedFinancialReportYear,
        fromDate,
        toDate,
        taxRatePct,
        sales,
        imports,
        products,
        receiptVouchers,
        paymentVouchers,
      }),
    [
      selectedFinancialReportYear,
      fromDate,
      toDate,
      taxRatePct,
      sales,
      imports,
      products,
      receiptVouchers,
      paymentVouchers,
    ]
  );

  const activeTaxLineItem = useMemo(
    () =>
      taxFinancialStatement.allLines.find((l) => l.drillDownCode === activeTaxDrillDownCode) ||
      taxFinancialStatement.incomeStatementLines[2],
    [taxFinancialStatement, activeTaxDrillDownCode]
  );

  // Sổ Quỹ & lợi nhuận tạm tính (tài khoản kho không phải quản lý chính)
  const provisionalCashbookSummary = useMemo(
    () =>
      computeProvisionalCashbookProfitSummary({
        sales,
        imports,
        products,
        receiptVouchers,
        paymentVouchers,
        fromDate,
        toDate,
      }),
    [sales, imports, products, receiptVouchers, paymentVouchers, fromDate, toDate]
  );

  const handleSelectFinancialYear = (yr: number) => {
    const safeYr = Math.max(2020, Math.round(Number(yr) || 2026));
    setSelectedFinancialReportYear(safeYr);
    setFromDate(`${safeYr}-01-01`);
    setToDate(`${safeYr}-12-31`);
  };

  const handleSelectTaxLineForAudit = (code: TaxFinancialDrillDownCode) => {
    setActiveTaxDrillDownCode(code);
    setTimeout(() => {
      taxDrillDownPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
  };

  const totalRevenue = salesInRange.reduce((sum, s) => sum + s.totalAmount, 0);
  const totalDiscount = salesInRange.reduce((sum, s) => sum + (s.discountAmount || 0), 0);
  const totalGiftItemsCount = salesInRange.reduce((sum, s) => sum + (s.giftQuantity || 0), 0);
  const totalGiftCost = salesInRange.reduce((sum, s) => {
    if (!s.giftQuantity || s.giftQuantity <= 0) return sum;
    return sum + Math.round(resolveSaleGiftUnitCost(s, products) * s.giftQuantity);
  }, 0);
  const totalCollected = salesInRange.reduce((sum, s) => sum + s.paidAmount, 0);
  const totalCustomerDebt = salesInRange.reduce((sum, s) => sum + s.debtAmount, 0);
  const totalImportCost = importsInRange.reduce((sum, i) => sum + i.totalCost, 0);
  const totalPaidSupplier = importsInRange.reduce((sum, i) => sum + i.paidAmount, 0);
  const totalSupplierDebt = importsInRange.reduce((sum, i) => sum + i.debtAmount, 0);

  const totalCashInflow = cashflowFinancial.totalCashInflow;
  const totalCashOutflow = cashflowFinancial.totalCashOutflow;
  const netCashflow = cashflowFinancial.netCashflow;
  const otherIncome = cashflowFinancial.otherIncome;
  const operatingExpenses = cashflowFinancial.operatingExpenses;

  const estimatedGrossProfit = useMemo(() => {
    return salesInRange.reduce((sum, sale) => {
      const cost = Math.round(resolveSaleUnitCost(sale, products) * sale.quantity);
      const giftCost =
        sale.giftQuantity && sale.giftQuantity > 0
          ? Math.round(resolveSaleGiftUnitCost(sale, products) * sale.giftQuantity)
          : 0;
      return sum + (sale.totalAmount - cost - giftCost);
    }, 0);
  }, [salesInRange, products]);

  const totalCOGS = Math.max(0, Math.round(totalRevenue - estimatedGrossProfit));
  const profitMarginPct =
    totalRevenue > 0 ? Math.round((estimatedGrossProfit / totalRevenue) * 100) : 0;
  const netProfit = estimatedGrossProfit + otherIncome - operatingExpenses;
  const netProfitMarginPct =
    totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100) : 0;

  const effectiveWarehouseLabel =
    activeWarehouseLabel || currentStaff.assignedWarehouse || 'Tất cả kho';

  const handleExportComprehensiveExcel = () => {
    const fileName = exportComprehensiveDateRangeReportExcel({
      fromDate,
      toDate,
      staffName: currentStaff.displayName,
      staffRoleLabel: getPositionRoleLabel(currentStaff.positionRole),
      warehouseLabel: effectiveWarehouseLabel,
      allowedCategories,
      products: filteredProducts,
      customers: filteredCustomers,
      sales: salesInRange,
      imports: importsInRange,
      allSales: sales,
      allImports: imports,
      allReceiptVouchers: receiptVouchers,
      allPaymentVouchers: paymentVouchers,
      receiptVouchers: cashflowFinancial.filteredReceiptVouchers,
      paymentVouchers: cashflowFinancial.filteredPaymentVouchers,
      savedVouchers,
      isPrimaryAdmin,
      recommendations: smartRecommendations,
    });
    onNotifyToast(
      `Đã xuất Báo cáo tổng hợp Excel (${fromDate} đến ${toDate}): ${fileName}`
    );
  };

  const handleExportComprehensivePDF = () => {
    const fileName = exportComprehensiveDateRangeReportPDF({
      fromDate,
      toDate,
      staffName: currentStaff.displayName,
      staffRoleLabel: getPositionRoleLabel(currentStaff.positionRole),
      warehouseLabel: effectiveWarehouseLabel,
      allowedCategories,
      products: filteredProducts,
      customers: filteredCustomers,
      sales: salesInRange,
      imports: importsInRange,
      allSales: sales,
      allImports: imports,
      allReceiptVouchers: receiptVouchers,
      allPaymentVouchers: paymentVouchers,
      receiptVouchers: cashflowFinancial.filteredReceiptVouchers,
      paymentVouchers: cashflowFinancial.filteredPaymentVouchers,
    });
    onNotifyToast(
      `Đã xuất Báo cáo tổng hợp PDF (${fromDate} đến ${toDate}): ${fileName}`
    );
  };

  const handleExportReceivedItemsPDF = () => {
    const fileName = exportCombinedReceivedItemsAndDebtPDF({
      customerName: selectedCustomerObj
        ? selectedCustomerObj.name
        : 'Tất cả khách hàng nhận hàng trong kỳ',
      customerPhone: selectedCustomerObj?.phone || '',
      customerAddress: selectedCustomerObj?.address || '',
      fromDate,
      toDate,
      items: receivedItemsReport.items,
      onlyUnpaid: onlyUnpaidGoods,
      staffName: currentStaff.displayName,
    });
    onNotifyToast(
      `Đã xuất Phiếu tổng hợp các mặt hàng đã nhận (${fromDate} đến ${toDate}): ${fileName}`
    );
  };

  const handleExportReceivedItemsExcel = () => {
    const fileName = exportCombinedReceivedItemsAndDebtExcel({
      customerName: selectedCustomerObj
        ? selectedCustomerObj.name
        : 'Tất cả khách hàng trong kỳ',
      fromDate,
      toDate,
      items: receivedItemsReport.items,
      onlyUnpaid: onlyUnpaidGoods,
      staffName: currentStaff.displayName,
    });
    onNotifyToast(
      `Đã xuất Tệp báo cáo Excel các mặt hàng đã nhận (${fromDate} đến ${toDate}): ${fileName}`
    );
  };

  const handleConfirmDriveUpload = async () => {
    setConfirmBackupModal(false);
    setIsBackingUp(true);
    try {
      await onTriggerDriveBackup();
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleConfirmDeleteDriveFile = async () => {
    if (!confirmDeleteBackup) return;
    const target = confirmDeleteBackup;
    setConfirmDeleteBackup(null);
    await onDeleteBackupRecord(target);
  };

  const handleUploadBackupFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!canAccessWarehouseAdminFeatures) {
      onNotifyToast(
        'Tài khoản của bạn không có quyền khôi phục dữ liệu từ tệp sao lưu.'
      );
      return;
    }

    try {
      // Upload backup file directly to Firebase Storage bucket in production
      uploadFileToFirebaseStorage(file, 'backups').catch(() => {});
      const rawText = await file.text();
      const validated = parseAndValidateBackupPayload(rawText);
      if ('error' in validated) {
        onNotifyToast(validated.error);
        return;
      }
      setPendingRestorePayload({
        ...validated.payload,
        fileName: file.name || validated.payload.fileName,
      });
    } catch {
      onNotifyToast('Không thể đọc tệp sao lưu. Vui lòng kiểm tra lại định dạng tệp (.json).');
    }
  };

  const filteredAuditLogs = auditLogs.filter((entry) => {
    if (auditCategoryFilter !== 'all' && entry.category !== auditCategoryFilter) {
      return false;
    }
    const q = normalizeVietnameseSearch(auditSearchQuery);
    if (!q) return true;
    const haystack = normalizeVietnameseSearch(
      `${entry.actorDisplayName} ${entry.actorUsername} ${entry.actorEmail} ${entry.targetCode} ${entry.actionTitle} ${entry.details} ${entry.warehouseName}`
    );
    return haystack.includes(q);
  });

  const deleteAuditCount = auditLogs.filter((a) => a.category === 'delete_record').length;
  const editAuditCount = auditLogs.filter((a) => a.category === 'edit_record').length;

  const getCategoryBadge = (category: AuditActionCategory) => {
    switch (category) {
      case 'delete_record':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold bg-red-50 text-red-700 border border-red-200 rounded-md whitespace-nowrap">
            <AlertTriangle className="w-3 h-3 shrink-0" />
            <span>Xóa phiếu / Xóa dữ liệu</span>
          </span>
        );
      case 'edit_record':
        return (
          <span className="inline-block px-2 py-0.5 text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 rounded-md whitespace-nowrap">
            Chỉnh sửa chứng từ
          </span>
        );
      case 'create_record':
        return (
          <span className="inline-block px-2 py-0.5 text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-md whitespace-nowrap">
            Tạo mới chứng từ
          </span>
        );
      case 'debt_settlement':
        return (
          <span className="inline-block px-2 py-0.5 text-[11px] font-semibold bg-teal-50 text-teal-800 border border-teal-200 rounded-md whitespace-nowrap">
            Thu / Trả công nợ
          </span>
        );
      case 'permission_change':
        return (
          <span className="inline-block px-2 py-0.5 text-[11px] font-semibold bg-indigo-50 text-indigo-800 border border-indigo-200 rounded-md whitespace-nowrap">
            Phân quyền nhân sự
          </span>
        );
      case 'backup_restore':
        return (
          <span className="inline-block px-2 py-0.5 text-[11px] font-semibold bg-slate-100 text-slate-800 border border-slate-300 rounded-md whitespace-nowrap">
            Sao lưu & Khôi phục
          </span>
        );
      default:
        return (
          <span className="inline-block px-2 py-0.5 text-[11px] font-medium bg-slate-100 text-slate-600 rounded-md whitespace-nowrap">
            Hệ thống
          </span>
        );
    }
  };

  // ============================================================================
  // VIEW MODE 1: BÁO CÁO CHUYÊN NGHIỆP (TỪ NGÀY ... ĐẾN NGÀY ...)
  // ============================================================================
  if (mode === 'reports') {
    return (
      <div className="space-y-6">
        {/* Top Master Date-Range & Role-Designated Report Control Header */}
        <div className="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 space-y-5">
          <div className="flex flex-col gap-3.5">
            <div className="space-y-1.5 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 text-xs font-bold bg-emerald-700 text-white rounded-md">
                  TRUNG TÂM BÁO CÁO CHUYÊN SÂU
                </span>
                <span className="px-2.5 py-0.5 text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-md">
                  Người lập: {currentStaff.displayName} (@{currentStaff.username}) · Kho:{' '}
                  {effectiveWarehouseLabel}
                </span>
              </div>
              <h2 className="text-base sm:text-xl font-bold text-slate-900">
                Báo Cáo Tổng Hợp & Kiểm Tra Chi Tiết Từ Ngày {fromDate} Đến Ngày {toDate}
              </h2>
            </div>
          </div>

          {/* Date Range Filter Bar: Từ ngày ... Đến ngày ... + Quick Presets + Search */}
          <div className="p-3.5 sm:p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label
                  htmlFor="report-from-date"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Từ ngày (Bắt đầu kỳ báo cáo)
                </label>
                <input
                  id="report-from-date"
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-900"
                />
              </div>

              <div>
                <label
                  htmlFor="report-to-date"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Đến ngày (Kết thúc kỳ báo cáo)
                </label>
                <input
                  id="report-to-date"
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-900"
                />
              </div>

              <div className="sm:col-span-2">
                <label
                  htmlFor="report-global-search"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Tìm kiếm nhanh chứng từ, mặt hàng, khách hàng hoặc nhà cung cấp trong báo cáo
                </label>
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="report-global-search"
                    type="text"
                    value={reportSearch}
                    onChange={(e) => setReportSearch(e.target.value)}
                    placeholder="Gõ mã phiếu, tên vật tư, tên khách hàng..."
                    className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-600 mr-1">Chọn nhanh kỳ:</span>
                {[
                  { label: `Hôm nay (${todayStr.slice(8, 10)}/${todayStr.slice(5, 7)})`, from: todayStr, to: todayStr },
                  { label: '7 ngày gần nhất', from: recent7DaysRange.from, to: recent7DaysRange.to },
                  { label: currentMonthRange.label, from: currentMonthRange.from, to: currentMonthRange.to },
                  { label: currentQuarterRange.label, from: currentQuarterRange.from, to: currentQuarterRange.to },
                  { label: 'Toàn bộ lịch sử', from: '2020-01-01', to: '2035-12-31' },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      setFromDate(preset.from);
                      setToDate(preset.to);
                    }}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors ${
                      fromDate === preset.from && toDate === preset.to
                        ? 'bg-emerald-700 text-white border-emerald-700'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Designated Report Category Tabs for the Logged-in Account (Balanced Sequential Grid 1 -> 8) */}
          <div className="space-y-2.5">
            <div className="text-xs font-bold text-slate-800 flex flex-wrap items-center justify-end gap-2">
              <span className="text-[11px] font-medium text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-md border border-emerald-200">
                Đang xem: {getReportCategoryMetaForAccount(activeCategory, isPrimaryAdmin).shortLabel}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {allowedCategories.map((catKey, index) => {
                const meta = getReportCategoryMetaForAccount(catKey, isPrimaryAdmin);
                const isActive = activeCategory === catKey;
                const cleanTitle = meta.label.replace(/^\d+\.\s*/, '');
                return (
                  <button
                    key={catKey}
                    type="button"
                    onClick={() => setActiveCategory(catKey)}
                    className={`px-3 py-2.5 text-xs font-bold rounded-lg border transition-colors flex items-center justify-between gap-2 text-left ${
                      isActive
                        ? 'bg-emerald-700 text-white border-emerald-700 shadow-2xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-emerald-50 hover:border-emerald-200'
                    }`}
                  >
                    <span className="truncate">
                      {index + 1}. {cleanTitle}
                    </span>
                    {isActive && (
                      <span className="w-2 h-2 rounded-full bg-white shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ====================================================================
            TAB 1: OVERVIEW (TỔNG HỢP CHUNG TẤT CẢ CÁC MỤC ĐƯỢC PHÂN QUYỀN)
           ==================================================================== */}
        {activeCategory === 'overview' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {allowedCategories.includes('sales_log') && (
                <div
                  onClick={() => setActiveCategory('sales_log')}
                  className="bg-white p-4 rounded-xl border border-slate-200 hover:border-emerald-400 cursor-pointer transition-colors space-y-1"
                >
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Doanh thu Bán hàng ({countDistinctSalesInvoices(salesInRange)} đơn)</span>
                    <ShoppingCart className="w-4 h-4 text-emerald-700" />
                  </div>
                  <div className="text-lg font-bold font-mono text-slate-900">
                    {formatVND(totalRevenue)}
                  </div>
                  <div className="text-xs text-emerald-700 font-semibold flex flex-wrap items-center gap-1 pt-1">
                    <span>Đã thu: {formatVND(totalCollected)}</span>
                    {totalDiscount > 0 && (
                      <span className="text-amber-700">· Giảm giá: -{formatVND(totalDiscount)}</span>
                    )}
                    {totalGiftItemsCount > 0 && (
                      <span className="text-emerald-800">· Quà KM: {totalGiftItemsCount} SP</span>
                    )}
                  </div>
                </div>
              )}

              {allowedCategories.includes('imports_log') && (
                <div
                  onClick={() => setActiveCategory('imports_log')}
                  className="bg-white p-4 rounded-xl border border-slate-200 hover:border-emerald-400 cursor-pointer transition-colors space-y-1"
                >
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Giá trị Nhập hàng ({countDistinctImportReceipts(importsInRange)} phiếu)</span>
                    <Truck className="w-4 h-4 text-amber-700" />
                  </div>
                  <div className="text-lg font-bold font-mono text-slate-900">
                    {formatVND(totalImportCost)}
                  </div>
                  <div className="text-xs text-amber-800 font-semibold flex items-center gap-1 pt-1">
                    <span>Đã trả NCC: {formatVND(totalPaidSupplier)} · Xem chi tiết →</span>
                  </div>
                </div>
              )}

              {allowedCategories.includes('debts_receivable_payable') && (
                <div
                  onClick={() => setActiveCategory('debts_receivable_payable')}
                  className="bg-white p-4 rounded-xl border border-slate-200 hover:border-emerald-400 cursor-pointer transition-colors space-y-1"
                >
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Công nợ Phải thu KH / Phải trả NCC</span>
                    <Wallet className="w-4 h-4 text-red-600" />
                  </div>
                  <div className="text-lg font-bold font-mono text-red-600">
                    {formatVND(totalCustomerDebt)}
                  </div>
                  <div className="text-xs text-slate-600 font-semibold flex items-center gap-1 pt-1">
                    <span>Nợ NCC: {formatVND(totalSupplierDebt)} · Kiểm tra nợ →</span>
                  </div>
                </div>
              )}

              {allowedCategories.includes('cashflow_treasury') && (
                <div
                  onClick={() => setActiveCategory('cashflow_treasury')}
                  className="bg-white p-4 rounded-xl border border-slate-200 hover:border-emerald-400 cursor-pointer transition-colors space-y-1"
                >
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Thu - Chi Dòng tiền ròng</span>
                    <TrendingUp className="w-4 h-4 text-emerald-700" />
                  </div>
                  <div
                    className={`text-lg font-bold font-mono ${
                      netCashflow >= 0 ? 'text-emerald-700' : 'text-red-600'
                    }`}
                  >
                    {formatVND(netCashflow)}
                  </div>
                  <div className="text-xs text-emerald-700 font-semibold flex items-center gap-1 pt-1">
                    <span>Mở sổ quỹ dòng tiền →</span>
                  </div>
                </div>
              )}

              {allowedCategories.includes('inventory_stock') && (
                <div
                  onClick={() => setActiveCategory('inventory_stock')}
                  className="bg-white p-4 rounded-xl border border-slate-200 hover:border-emerald-400 cursor-pointer transition-colors space-y-1"
                >
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Quản lý Tồn kho vật tư</span>
                    <Boxes className="w-4 h-4 text-emerald-700" />
                  </div>
                  <div className="text-lg font-bold font-mono text-slate-900">
                    {filteredProducts.length} mặt hàng
                  </div>
                  <div className="text-xs text-amber-700 font-semibold flex items-center gap-1 pt-1">
                    <span>
                      {filteredProducts.filter((p) => evaluateStockAlert(p) !== 'normal').length} mặt
                      hàng cần nhập · Xem kho →
                    </span>
                  </div>
                </div>
              )}

              {allowedCategories.includes('customers_items') && (
                <div
                  onClick={() => setActiveCategory('customers_items')}
                  className="bg-white p-4 rounded-xl border border-slate-200 hover:border-emerald-400 cursor-pointer transition-colors space-y-1"
                >
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Hàng hóa đã nhận & Khách hàng</span>
                    <Users className="w-4 h-4 text-emerald-700" />
                  </div>
                  <div className="text-lg font-bold font-mono text-slate-900">
                    {receivedItemsReport.totalItemsCount} lượt nhận hàng
                  </div>
                  <div className="text-xs text-emerald-700 font-semibold flex items-center gap-1 pt-1">
                    <span>Xem bảng hàng đã nhận & thu nợ →</span>
                  </div>
                </div>
              )}

              {!isPrimaryAdmin && allowedCategories.includes('financial_profit') && (
                <div
                  onClick={() => setActiveCategory('financial_profit')}
                  className="bg-emerald-50/70 p-4 rounded-xl border border-emerald-200 hover:border-emerald-500 cursor-pointer transition-colors space-y-1 sm:col-span-2"
                >
                  <div className="flex items-center justify-between text-xs font-semibold text-emerald-900">
                    <span>Sổ Quỹ &amp; Lợi nhuận tạm tính ({effectiveWarehouseLabel})</span>
                    <Wallet className="w-4 h-4 text-emerald-700" />
                  </div>
                  <div
                    className={`text-lg font-bold font-mono ${
                      provisionalCashbookSummary.provisionalNetProfit >= 0
                        ? 'text-emerald-800'
                        : 'text-rose-700'
                    }`}
                  >
                    Lợi nhuận tạm tính: {formatVND(provisionalCashbookSummary.provisionalNetProfit)} (Tỷ suất:{' '}
                    {provisionalCashbookSummary.provisionalMarginPct}%)
                  </div>
                  <div className="text-xs text-emerald-800 font-semibold flex flex-wrap items-center gap-1 pt-1">
                    <span>Doanh thu trước CK: +{formatVND(provisionalCashbookSummary.grossSalesRevenue)}</span>
                    <span>· Thu khác: +{formatVND(provisionalCashbookSummary.otherIncomeReceipts)}</span>
                    <span>· Giá vốn: -{formatVND(provisionalCashbookSummary.productCogs)}</span>
                    <span>
                      · CK &amp; Quà KM: -
                      {formatVND(provisionalCashbookSummary.discountCost + provisionalCashbookSummary.giftPromoCost)}
                    </span>
                    <span>· Chi phí khác: -{formatVND(provisionalCashbookSummary.otherOperatingExpenses)}</span>
                    <span>· Mở Sổ Quỹ →</span>
                  </div>
                </div>
              )}

              {canAccessWarehouseAdminFeatures && allowedCategories.includes('financial_profit') && (
                <div
                  onClick={() => setActiveCategory('financial_profit')}
                  className="bg-emerald-50/70 p-4 rounded-xl border border-emerald-200 hover:border-emerald-500 cursor-pointer transition-colors space-y-1 sm:col-span-2"
                >
                  <div className="flex items-center justify-between text-xs font-semibold text-emerald-900">
                    <span>
                      Báo cáo Tài chính &amp; Lợi nhuận Ròng (
                      {isPrimaryAdmin
                        ? 'Quản lý chính · Tất cả kho'
                        : `Kho độc lập: ${currentStaff.assignedWarehouse}`}
                      )
                    </span>
                    <ShieldCheck className="w-4 h-4 text-emerald-700" />
                  </div>
                  <div className="text-lg font-bold font-mono text-emerald-800">
                    Lợi nhuận ròng: {formatVND(netProfit)} (Tỷ suất ròng: {netProfitMarginPct}% · Lợi nhuận gộp: {formatVND(estimatedGrossProfit)})
                  </div>
                  <div className="text-xs text-emerald-800 font-semibold flex flex-wrap items-center gap-1 pt-1">
                    <span>Giá vốn (kèm quà KM): {formatVND(totalCOGS)}</span>
                    <span>· Thu khác: +{formatVND(otherIncome)}</span>
                    <span>· Chi phí vận hành: -{formatVND(operatingExpenses)}</span>
                    {totalDiscount > 0 && (
                      <span>· Tổng giảm giá bán: {formatVND(totalDiscount)}</span>
                    )}
                    <span>· Xem chi tiết →</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ====================================================================
            TAB 2 OR OVERVIEW SUB-PANEL: DANH SÁCH TỔNG HỢP TẤT CẢ CÁC HÀNG HÓA ĐÃ NHẬN / CÒN NỢ & THU NỢ (TỪ NGÀY ... ĐẾN NGÀY ...)
           ==================================================================== */}
        {(activeCategory === 'customers_items' || activeCategory === 'overview') &&
          allowedCategories.includes('customers_items') && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="p-4 sm:p-6 border-b border-slate-200 bg-emerald-50/40 flex flex-col gap-3.5">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-emerald-800 uppercase tracking-wide flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                    <span>
                      Báo Cáo Các Mặt Hàng Đã Nhận & Còn Nợ Thu Nợ (Từ ngày {fromDate} đến ngày{' '}
                      {toDate})
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleExportReceivedItemsPDF}
                    className="px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Printer className="w-4 h-4 shrink-0" />
                    <span>In Phiếu Tổng Hợp Hàng Đã Nhận (PDF)</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleExportReceivedItemsExcel}
                    className="px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span>Xuất Tệp Báo Cáo Hàng Nhận (Excel)</span>
                  </button>

                  {receivedItemsReport.totalDebt > 0 && onCollectCustomerDebt && (
                    <button
                      type="button"
                      onClick={() => {
                        setBatchCollectAmount(String(receivedItemsReport.totalDebt));
                        setBatchCollectNote(
                          `Thu nợ tổng hợp các mặt hàng từ ngày ${fromDate} đến ngày ${toDate}`
                        );
                        setIsBatchCollectOpen(true);
                      }}
                      className="px-3.5 py-2 text-xs font-bold text-amber-950 bg-amber-100 border border-amber-300 hover:bg-amber-200 rounded-lg flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Wallet className="w-4 h-4 text-amber-800 shrink-0" />
                      <span>Thu Nợ Tổng Hợp Kỳ Này ({formatVND(receivedItemsReport.totalDebt)})</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Filter strip for Customer & Paid/Unpaid toggle */}
              <div className="px-4 sm:px-6 py-3 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    htmlFor="report-cust-filter"
                    className="text-xs font-semibold text-slate-700"
                  >
                    Lọc theo khách hàng:
                  </label>
                  <select
                    id="report-cust-filter"
                    value={selectedCustomerIdFilter}
                    onChange={(e) => setSelectedCustomerIdFilter(e.target.value)}
                    className="px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 rounded-lg text-slate-900"
                  >
                    <option value="all">Tất cả khách hàng ({customers.length})</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.phone}) — Nợ: {formatVND(c.totalDebt)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-200 self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setOnlyUnpaidGoods(false)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                      !onlyUnpaidGoods
                        ? 'bg-emerald-700 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Tất cả mặt hàng đã nhận
                  </button>
                  <button
                    type="button"
                    onClick={() => setOnlyUnpaidGoods(true)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                      onlyUnpaidGoods
                        ? 'bg-red-600 text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Chỉ hàng hóa còn nợ
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[940px] text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-200 font-semibold text-slate-600">
                      <th className="py-2.5 px-2.5 whitespace-nowrap w-[86px]">Ngày nhận</th>
                      <th className="py-2.5 px-2.5 whitespace-nowrap w-[100px]">Mã HĐ (Nhấp xem)</th>
                      <th className="py-2.5 px-2.5 min-w-[148px]">Khách hàng</th>
                      <th className="py-2.5 px-2.5 min-w-[200px]">Tên mặt hàng & Quà KM</th>
                      <th className="py-2.5 px-2.5 text-center whitespace-nowrap w-[85px]">SL & ĐVT</th>
                      <th className="py-2.5 px-2.5 text-right whitespace-nowrap w-[85px]">Đơn giá</th>
                      <th className="py-2.5 px-2.5 text-right whitespace-nowrap w-[100px]">Thành tiền</th>
                      <th className="py-2.5 px-2.5 text-right whitespace-nowrap w-[95px]">Đã thanh toán</th>
                      <th className="py-2.5 px-2.5 text-right whitespace-nowrap w-[92px]">Còn nợ</th>
                      <th className="py-2.5 px-2.5 text-right whitespace-nowrap w-[85px]">Kiểm tra chi tiết</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {receivedItemsReport.items.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="py-8 text-center text-slate-500">
                          Không có mặt hàng nào khớp với khoảng thời gian từ {fromDate} đến {toDate}.
                        </td>
                      </tr>
                    ) : (
                      receivedItemsReport.items.map((item) => {
                        const matchedSale = sales.find((s) => s.id === item.saleId);
                        return (
                          <tr
                            key={item.saleId}
                            onClick={() => {
                              if (matchedSale) setDrillDownItem({ type: 'sale', record: matchedSale });
                            }}
                            className="hover:bg-emerald-50/50 cursor-pointer transition-colors"
                          >
                            <td className="py-2.5 px-2.5 font-mono whitespace-nowrap align-middle">{item.date}</td>
                            <td className="py-2.5 px-2.5 font-mono font-bold text-emerald-800 underline whitespace-nowrap align-middle">
                              {item.invoiceCode}
                            </td>
                            <td className="py-2.5 px-2.5 min-w-[148px] align-middle">
                              <div className="font-semibold text-slate-900 leading-snug">{item.customerName}</div>
                              <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                                {item.customerPhone}
                              </div>
                            </td>
                            <td className="py-2.5 px-2.5 min-w-[200px] font-semibold text-slate-900 leading-snug align-middle">
                              <div>{item.productName}</div>
                              <div className="text-[11px] font-normal text-slate-500 mt-0.5">
                                Kho: {item.warehouseName}
                              </div>
                              {((item.discountAmount || 0) > 0 || (item.giftQuantity || 0) > 0) && (
                                <div className="flex flex-wrap items-center gap-1 mt-1">
                                  {(item.discountAmount || 0) > 0 && (
                                    <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200 rounded">
                                      Giảm giá: -{formatVND(item.discountAmount || 0)}
                                    </span>
                                  )}
                                  {(item.giftQuantity || 0) > 0 && item.giftProductName && (
                                    <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                                      Tặng KM: {item.giftQuantity} {item.giftUnit || 'CÁI'} {item.giftProductName}
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-2.5 text-center font-mono whitespace-nowrap align-middle">
                              {item.quantity} {item.unit}
                            </td>
                            <td className="py-2.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap align-middle">
                              {formatVND(item.unitPrice)}
                            </td>
                            <td className="py-2.5 px-2.5 text-right font-mono tabular-nums font-semibold whitespace-nowrap align-middle">
                              <div>{formatVND(item.totalAmount)}</div>
                              {(item.discountAmount || 0) > 0 && (
                                <div className="text-[10px] text-amber-700 font-normal">
                                  (-{formatVND(item.discountAmount || 0)})
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-emerald-700 whitespace-nowrap align-middle">
                              {formatVND(item.paidAmount)}
                            </td>
                            <td className="py-2.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap align-middle">
                              <span
                                className={
                                  item.debtAmount > 0 ? 'font-bold text-red-600' : 'text-slate-500'
                                }
                              >
                                {formatVND(item.debtAmount)}
                              </span>
                            </td>
                            <td className="py-2.5 px-2.5 text-right whitespace-nowrap align-middle">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (matchedSale) {
                                    setDrillDownItem({ type: 'sale', record: matchedSale });
                                  }
                                }}
                                className="px-2 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md inline-flex items-center gap-1 whitespace-nowrap"
                              >
                                <Eye className="w-3.5 h-3.5 shrink-0" />
                                <span>Chi tiết</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="px-4 sm:px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="font-bold text-slate-900">
                  Tổng cộng ({receivedItemsReport.totalItemsCount} mặt hàng /{' '}
                  {receivedItemsReport.totalQuantity} đơn vị):
                </div>
                <div className="flex flex-wrap items-center gap-4 font-mono">
                  <span>
                    Tổng giá trị hàng nhận:{' '}
                    <strong className="text-slate-900">
                      {formatVND(receivedItemsReport.totalAmount)}
                    </strong>
                  </span>
                  {totalDiscount > 0 && (
                    <span className="text-amber-800">
                      Tổng giảm giá KM: <strong>-{formatVND(totalDiscount)}</strong>
                    </span>
                  )}
                  <span className="text-emerald-700">
                    Đã thanh toán: <strong>{formatVND(receivedItemsReport.totalPaid)}</strong>
                  </span>
                  <span className="text-red-600 font-bold">
                    Tổng còn nợ: {formatVND(receivedItemsReport.totalDebt)}
                  </span>
                </div>
              </div>
            </div>
          )}

        {/* ====================================================================
            TAB 3: NHẬT KÝ BÁN HÀNG (TỪ NGÀY ... ĐẾN NGÀY ...)
           ==================================================================== */}
        {activeCategory === 'sales_log' && allowedCategories.includes('sales_log') && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="p-4 sm:p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Báo Cáo Tổng Hợp Nhật Ký Bán Hàng (Từ ngày {fromDate} đến ngày {toDate})
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tổng số: {salesInRange.length} hóa đơn · Doanh thu thuần: {formatVND(totalRevenue)} ·
                  Giảm giá KM: {formatVND(totalDiscount)} · Quà tặng KM: {totalGiftItemsCount} SP ·
                  Thực thu: {formatVND(totalCollected)} · Còn nợ: {formatVND(totalCustomerDebt)}
                </p>
              </div>
              {onNavigateToModule && (
                <button
                  type="button"
                  onClick={() => onNavigateToModule('sales')}
                  className="px-3 py-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg flex items-center gap-1.5 self-start sm:self-auto"
                >
                  <span>Mở phân hệ Nhật ký Bán hàng</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                    <th className="py-3 px-3.5 whitespace-nowrap w-[105px]">Ngày bán</th>
                    <th className="py-3 px-3.5 whitespace-nowrap w-[115px]">Mã HĐ</th>
                    <th className="py-3 px-3.5 whitespace-nowrap w-[135px]">Kho xuất</th>
                    <th className="py-3 px-3.5 min-w-[175px]">Khách hàng</th>
                    <th className="py-3 px-3.5 min-w-[240px]">Vật tư & Quà tặng KM / Giảm giá</th>
                    <th className="py-3 px-3.5 text-center whitespace-nowrap w-[100px]">SL</th>
                    <th className="py-3 px-3.5 text-right whitespace-nowrap w-[115px]">Thành tiền</th>
                    <th className="py-3 px-3.5 text-right whitespace-nowrap w-[115px]">Đã thu</th>
                    <th className="py-3 px-3.5 text-right whitespace-nowrap w-[115px]">Còn nợ</th>
                    <th className="py-3 px-3.5 text-right whitespace-nowrap w-[130px]">Liên kết chi tiết</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {salesInRange.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => setDrillDownItem({ type: 'sale', record: s })}
                      className="hover:bg-emerald-50/50 cursor-pointer"
                    >
                      <td className="py-3 px-3.5 font-mono whitespace-nowrap align-middle">
                        {s.createdAt.slice(0, 10)}
                      </td>
                      <td className="py-3 px-3.5 font-mono font-bold text-emerald-800 underline whitespace-nowrap align-middle">
                        {s.invoiceCode}
                      </td>
                      <td className="py-3 px-3.5 whitespace-nowrap align-middle">
                        {s.warehouseName || 'Tâm An Mỹ Ngãi'}
                      </td>
                      <td className="py-3 px-3.5 font-semibold text-slate-900 min-w-[175px] leading-snug align-middle">
                        {s.customerName}
                      </td>
                      <td className="py-3 px-3.5 font-medium text-slate-900 min-w-[240px] leading-snug align-middle">
                        <div>{s.productName}</div>
                        {((s.discountAmount || 0) > 0 || (s.giftQuantity || 0) > 0) && (
                          <div className="flex flex-wrap items-center gap-1 mt-1">
                            {(s.discountAmount || 0) > 0 && (
                              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200 rounded">
                                Giảm giá: -{formatVND(s.discountAmount || 0)}
                              </span>
                            )}
                            {(s.giftQuantity || 0) > 0 && s.giftProductName && (
                              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                                Tặng KM: {s.giftQuantity} {s.giftUnit || 'CÁI'} {s.giftProductName}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3.5 text-center font-mono whitespace-nowrap align-middle">
                        {s.quantity} {s.unit}
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums font-semibold whitespace-nowrap align-middle">
                        <div>{formatVND(s.totalAmount)}</div>
                        {(s.discountAmount || 0) > 0 && (
                          <div className="text-[10px] text-amber-700 font-normal">
                            (-{formatVND(s.discountAmount || 0)})
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums text-emerald-700 whitespace-nowrap align-middle">
                        {formatVND(s.paidAmount)}
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums font-bold text-red-600 whitespace-nowrap align-middle">
                        {formatVND(s.debtAmount)}
                      </td>
                      <td className="py-3 px-3.5 text-right whitespace-nowrap align-middle">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDrillDownItem({ type: 'sale', record: s });
                          }}
                          className="px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md whitespace-nowrap"
                        >
                          Xem & Kiểm tra →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ====================================================================
            TAB 4: NHẬT KÝ NHẬP HÀNG (TỪ NGÀY ... ĐẾN NGÀY ...)
           ==================================================================== */}
        {activeCategory === 'imports_log' && allowedCategories.includes('imports_log') && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="p-4 sm:p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Báo Cáo Tổng Hợp Nhật Ký Nhập Hàng (Từ ngày {fromDate} đến ngày {toDate})
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tổng số: {importsInRange.length} phiếu nhập · Tổng giá trị nhập:{' '}
                  {formatVND(totalImportCost)} · Đã trả NCC: {formatVND(totalPaidSupplier)} · Còn nợ
                  NCC: {formatVND(totalSupplierDebt)}
                </p>
              </div>
              {onNavigateToModule && (
                <button
                  type="button"
                  onClick={() => onNavigateToModule('imports')}
                  className="px-3 py-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg flex items-center gap-1.5 self-start sm:self-auto whitespace-nowrap shrink-0"
                >
                  <span>Mở phân hệ Nhật ký Nhập hàng</span>
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                    <th className="py-3 px-3.5 whitespace-nowrap w-[105px]">Ngày nhập</th>
                    <th className="py-3 px-3.5 whitespace-nowrap w-[115px]">Mã phiếu</th>
                    <th className="py-3 px-3.5 whitespace-nowrap w-[135px]">Kho nhập</th>
                    <th className="py-3 px-3.5 min-w-[190px]">Nhà cung cấp</th>
                    <th className="py-3 px-3.5 min-w-[230px]">Vật tư nhập kho</th>
                    <th className="py-3 px-3.5 text-center whitespace-nowrap w-[100px]">SL nhập</th>
                    <th className="py-3 px-3.5 text-right whitespace-nowrap w-[115px]">Tổng tiền nhập</th>
                    <th className="py-3 px-3.5 text-right whitespace-nowrap w-[115px]">Đã trả NCC</th>
                    <th className="py-3 px-3.5 text-right whitespace-nowrap w-[115px]">Còn nợ NCC</th>
                    <th className="py-3 px-3.5 text-right whitespace-nowrap w-[130px]">Liên kết chi tiết</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {importsInRange.map((imp) => (
                    <tr
                      key={imp.id}
                      onClick={() => setDrillDownItem({ type: 'import', record: imp })}
                      className="hover:bg-emerald-50/50 cursor-pointer"
                    >
                      <td className="py-3 px-3.5 font-mono whitespace-nowrap align-middle">
                        {imp.createdAt.slice(0, 10)}
                      </td>
                      <td className="py-3 px-3.5 font-mono font-bold text-emerald-800 underline whitespace-nowrap align-middle">
                        {imp.receiptCode}
                      </td>
                      <td className="py-3 px-3.5 whitespace-nowrap align-middle">
                        {imp.warehouseName || 'Tâm An Mỹ Ngãi'}
                      </td>
                      <td className="py-3 px-3.5 font-semibold text-slate-900 min-w-[190px] leading-snug align-middle">
                        {imp.supplierName}
                      </td>
                      <td className="py-3 px-3.5 font-medium text-slate-900 min-w-[230px] leading-snug align-middle">
                        {imp.productName}
                      </td>
                      <td className="py-3 px-3.5 text-center font-mono whitespace-nowrap align-middle">
                        {imp.quantity} {imp.unit}
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums font-semibold whitespace-nowrap align-middle">
                        {formatVND(imp.totalCost)}
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums text-emerald-700 whitespace-nowrap align-middle">
                        {formatVND(imp.paidAmount)}
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums font-bold text-red-600 whitespace-nowrap align-middle">
                        {formatVND(imp.debtAmount)}
                      </td>
                      <td className="py-3 px-3.5 text-right whitespace-nowrap align-middle">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDrillDownItem({ type: 'import', record: imp });
                          }}
                          className="px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md whitespace-nowrap"
                        >
                          Xem & Kiểm tra →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ====================================================================
            TAB 5: QUẢN LÝ TỒN KHO (BIẾN ĐỘNG NHẬP - XUẤT - TỒN TỪ NGÀY ... ĐẾN NGÀY ...)
           ==================================================================== */}
        {activeCategory === 'inventory_stock' && allowedCategories.includes('inventory_stock') && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="p-4 sm:p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Báo Cáo Quản Lý Tồn Kho & Biến Động Nhập - Xuất (Từ ngày {fromDate} đến ngày{' '}
                  {toDate})
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Bao gồm số lượng xuất bán và số lượng xuất tặng khuyến mãi · Nhấp vào từng mặt hàng để kiểm tra chi tiết
                </p>
              </div>
              {onNavigateToModule && (
                <button
                  type="button"
                  onClick={() => onNavigateToModule('inventory')}
                  className="px-3 py-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg flex items-center gap-1.5 self-start sm:self-auto whitespace-nowrap shrink-0"
                >
                  <span>Mở phân hệ Quản lý Tồn kho</span>
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                    <th className="py-3 px-3.5 whitespace-nowrap w-[95px]">Mã VT</th>
                    <th className="py-3 px-3.5 whitespace-nowrap w-[140px]">Kho lưu trữ</th>
                    <th className="py-3 px-3.5 min-w-[240px]">Tên vật tư nông nghiệp</th>
                    <th className="py-3 px-3.5 text-center whitespace-nowrap w-[115px]">Nhập trong kỳ</th>
                    <th className="py-3 px-3.5 text-center whitespace-nowrap w-[125px]">Xuất bán & KM</th>
                    <th className="py-3 px-3.5 text-center whitespace-nowrap w-[115px]">Tồn hiện tại</th>
                    <th className="py-3 px-3.5 text-right whitespace-nowrap w-[125px]">Giá trị tồn kho</th>
                    <th className="py-3 px-3.5 text-center whitespace-nowrap w-[110px]">Cảnh báo</th>
                    <th className="py-3 px-3.5 text-right whitespace-nowrap w-[130px]">Liên kết kiểm tra</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredProducts.map((p) => {
                    const importedInPeriod = importsInRange
                      .filter((i) => i.productId === p.id)
                      .reduce((s, i) => s + i.quantity, 0);
                    const soldInPeriod = salesInRange
                      .filter((s) => s.productId === p.id)
                      .reduce((s, x) => s + x.quantity, 0);
                    const giftedInPeriod = salesInRange
                      .filter((s) => s.giftProductId === p.id && (s.giftQuantity || 0) > 0)
                      .reduce((s, x) => s + (x.giftQuantity || 0), 0);
                    const totalExportedInPeriod = soldInPeriod + giftedInPeriod;
                    const alert = evaluateStockAlert(p);
                    return (
                      <tr
                        key={p.id}
                        onClick={() => setDrillDownItem({ type: 'product', record: p })}
                        className="hover:bg-emerald-50/50 cursor-pointer"
                      >
                        <td className="py-3 px-3.5 font-mono font-bold text-emerald-800 underline whitespace-nowrap align-middle">
                          {p.code}
                        </td>
                        <td className="py-3 px-3.5 whitespace-nowrap align-middle">
                          {p.warehouseName || 'Tâm An Mỹ Ngãi'}
                        </td>
                        <td className="py-3 px-3.5 font-semibold text-slate-900 min-w-[240px] leading-snug align-middle">
                          {p.name}
                        </td>
                        <td className="py-3 px-3.5 text-center font-mono text-emerald-700 font-semibold whitespace-nowrap align-middle">
                          +{importedInPeriod} {p.unit}
                        </td>
                        <td className="py-3 px-3.5 text-center font-mono text-amber-800 font-semibold whitespace-nowrap align-middle">
                          <div>
                            -{totalExportedInPeriod} {p.unit}
                          </div>
                          {giftedInPeriod > 0 && (
                            <div className="text-[10px] text-emerald-700 font-normal">
                              (Tặng KM: {giftedInPeriod} {p.unit})
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3.5 text-center font-mono font-bold text-slate-900 whitespace-nowrap align-middle">
                          {p.stock} {p.unit}
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono tabular-nums whitespace-nowrap align-middle">
                          {formatVND(p.stock * p.importPrice)}
                        </td>
                        <td className="py-3 px-3.5 text-center whitespace-nowrap align-middle">
                          <span
                            className={`px-2 py-0.5 text-[11px] font-bold rounded whitespace-nowrap ${
                              alert === 'out_of_stock'
                                ? 'bg-red-100 text-red-800'
                                : alert === 'low_stock'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-emerald-50 text-emerald-700'
                            }`}
                          >
                            {alert === 'out_of_stock'
                              ? 'Hết hàng'
                              : alert === 'low_stock'
                              ? 'Sắp hết'
                              : 'Đủ hàng'}
                          </span>
                        </td>
                        <td className="py-3 px-3.5 text-right whitespace-nowrap align-middle">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDrillDownItem({ type: 'product', record: p });
                            }}
                            className="px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md whitespace-nowrap"
                          >
                            Kiểm tra kho →
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ====================================================================
            TAB 6: QUẢN LÝ CÔNG NỢ KHÁCH HÀNG & NHÀ CUNG CẤP (TỪ NGÀY ... ĐẾN NGÀY ...)
           ==================================================================== */}
        {activeCategory === 'debts_receivable_payable' &&
          allowedCategories.includes('debts_receivable_payable') && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="p-4 sm:p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Báo Cáo Tổng Hợp Công Nợ Phải Thu KH & Phải Trả NCC (Từ ngày {fromDate} đến
                    ngày {toDate})
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Tổng nợ phải thu Khách hàng: {formatVND(totalCustomerDebt)} · Tổng nợ phải trả
                    Nhà cung cấp: {formatVND(totalSupplierDebt)}
                  </p>
                </div>
                {onNavigateToModule && (
                  <button
                    type="button"
                    onClick={() => onNavigateToModule('debts')}
                    className="px-3 py-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg flex items-center gap-1.5 self-start sm:self-auto whitespace-nowrap shrink-0"
                  >
                    <span>Mở phân hệ Quản lý Công nợ</span>
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  </button>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[1040px] text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                      <th className="py-3 px-3.5 whitespace-nowrap w-[120px]">Loại công nợ</th>
                      <th className="py-3 px-3.5 whitespace-nowrap w-[125px]">Ngày / Mã phiếu</th>
                      <th className="py-3 px-3.5 min-w-[185px]">Khách hàng / Nhà cung cấp</th>
                      <th className="py-3 px-3.5 min-w-[230px]">Mặt hàng còn nợ</th>
                      <th className="py-3 px-3.5 text-right whitespace-nowrap w-[115px]">Tổng tiền</th>
                      <th className="py-3 px-3.5 text-right whitespace-nowrap w-[115px]">Đã trả</th>
                      <th className="py-3 px-3.5 text-right whitespace-nowrap w-[115px]">Còn nợ</th>
                      <th className="py-3 px-3.5 whitespace-nowrap w-[140px]">Hạn thanh toán</th>
                      <th className="py-3 px-3.5 text-right whitespace-nowrap w-[145px]">Kiểm tra & Thu/Trả</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {salesInRange
                      .filter((s) => s.debtAmount > 0)
                      .map((s) => {
                        const { urgency, daysRemaining } = evaluateDebtUrgency(
                          s.dueDate,
                          s.debtAmount
                        );
                        return (
                          <tr
                            key={s.id}
                            onClick={() => setDrillDownItem({ type: 'sale', record: s })}
                            className="hover:bg-red-50/30 cursor-pointer"
                          >
                            <td className="py-3 px-3.5 whitespace-nowrap align-middle">
                              <span className="px-2 py-0.5 text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded whitespace-nowrap">
                                Phải thu KH
                              </span>
                            </td>
                            <td className="py-3 px-3.5 font-mono whitespace-nowrap align-middle">
                              <div className="font-bold text-emerald-800 underline">
                                {s.invoiceCode}
                              </div>
                              <div className="text-[11px] text-slate-500 mt-0.5">
                                {s.createdAt.slice(0, 10)}
                              </div>
                            </td>
                            <td className="py-3 px-3.5 font-semibold text-slate-900 min-w-[185px] leading-snug align-middle">
                              <div>{s.customerName}</div>
                              <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                                {s.customerPhone}
                              </div>
                            </td>
                            <td className="py-3 px-3.5 min-w-[230px] leading-snug align-middle">
                              {s.productName} ({s.quantity} {s.unit})
                            </td>
                            <td className="py-3 px-3.5 text-right font-mono tabular-nums whitespace-nowrap align-middle">
                              {formatVND(s.totalAmount)}
                            </td>
                            <td className="py-3 px-3.5 text-right font-mono tabular-nums text-emerald-700 whitespace-nowrap align-middle">
                              {formatVND(s.paidAmount)}
                            </td>
                            <td className="py-3 px-3.5 text-right font-mono tabular-nums font-bold text-red-600 whitespace-nowrap align-middle">
                              {formatVND(s.debtAmount)}
                            </td>
                            <td className="py-3 px-3.5 font-mono whitespace-nowrap align-middle">
                              <div>{s.dueDate}</div>
                              <div
                                className={`text-[11px] font-semibold mt-0.5 ${
                                  urgency === 'overdue' ? 'text-red-600' : 'text-amber-700'
                                }`}
                              >
                                {urgency === 'overdue'
                                  ? `Quá hạn ${Math.abs(daysRemaining)} ngày`
                                  : `Còn ${daysRemaining} ngày`}
                              </div>
                            </td>
                            <td className="py-3 px-3.5 text-right whitespace-nowrap align-middle">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (onNavigateToModule) {
                                    onNavigateToModule('debts', s.id);
                                  } else {
                                    setDrillDownItem({ type: 'sale', record: s });
                                  }
                                }}
                                className="px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md whitespace-nowrap"
                              >
                                Đối soát & Thu nợ →
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    {importsInRange
                      .filter((i) => i.debtAmount > 0)
                      .map((i) => {
                        const { urgency, daysRemaining } = evaluateDebtUrgency(
                          i.dueDate,
                          i.debtAmount
                        );
                        return (
                          <tr
                            key={i.id}
                            onClick={() => setDrillDownItem({ type: 'import', record: i })}
                            className="hover:bg-amber-50/40 cursor-pointer"
                          >
                            <td className="py-3 px-3.5 whitespace-nowrap align-middle">
                              <span className="px-2 py-0.5 text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200 rounded whitespace-nowrap">
                                Phải trả NCC
                              </span>
                            </td>
                            <td className="py-3 px-3.5 font-mono whitespace-nowrap align-middle">
                              <div className="font-bold text-amber-900 underline">
                                {i.receiptCode}
                              </div>
                              <div className="text-[11px] text-slate-500 mt-0.5">
                                {i.createdAt.slice(0, 10)}
                              </div>
                            </td>
                            <td className="py-3 px-3.5 font-semibold text-slate-900 min-w-[185px] leading-snug align-middle">
                              <div>{i.supplierName}</div>
                              <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                                {i.supplierPhone}
                              </div>
                            </td>
                            <td className="py-3 px-3.5 min-w-[230px] leading-snug align-middle">
                              {i.productName} ({i.quantity} {i.unit})
                            </td>
                            <td className="py-3 px-3.5 text-right font-mono tabular-nums whitespace-nowrap align-middle">
                              {formatVND(i.totalCost)}
                            </td>
                            <td className="py-3 px-3.5 text-right font-mono tabular-nums text-emerald-700 whitespace-nowrap align-middle">
                              {formatVND(i.paidAmount)}
                            </td>
                            <td className="py-3 px-3.5 text-right font-mono tabular-nums font-bold text-red-600 whitespace-nowrap align-middle">
                              {formatVND(i.debtAmount)}
                            </td>
                            <td className="py-3 px-3.5 font-mono whitespace-nowrap align-middle">
                              <div>{i.dueDate}</div>
                              <div
                                className={`text-[11px] font-semibold mt-0.5 ${
                                  urgency === 'overdue' ? 'text-red-600' : 'text-amber-700'
                                }`}
                              >
                                {urgency === 'overdue'
                                  ? `Quá hạn ${Math.abs(daysRemaining)} ngày`
                                  : `Còn ${daysRemaining} ngày`}
                              </div>
                            </td>
                            <td className="py-3 px-3.5 text-right whitespace-nowrap align-middle">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (onNavigateToModule) {
                                    onNavigateToModule('debts', i.id);
                                  } else {
                                    setDrillDownItem({ type: 'import', record: i });
                                  }
                                }}
                                className="px-2.5 py-1 text-xs font-semibold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md whitespace-nowrap"
                              >
                                Mở phiếu nợ NCC →
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        {/* ====================================================================
            TAB 7: THU - CHI DÒNG TIỀN (TỪ NGÀY ... ĐẾN NGÀY ...)
           ==================================================================== */}
        {activeCategory === 'cashflow_treasury' &&
          allowedCategories.includes('cashflow_treasury') && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="p-4 sm:p-6 border-b border-slate-200 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Báo Cáo Thu - Chi Dòng Tiền & Sổ Quỹ (Từ ngày {fromDate} đến ngày {toDate})
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Tổng hợp toàn bộ dòng tiền từ Nhật ký Bán hàng, Nhật ký Nhập hàng, Nhật ký Phiếu Thu Tiền và Nhật ký Phiếu Chi Tiền theo từng nhóm phiếu
                    </p>
                  </div>
                  {onNavigateToModule && (
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => onNavigateToModule('receipt_vouchers')}
                        className="px-3 py-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg transition-colors whitespace-nowrap"
                      >
                        + Mở Nhật ký Phiếu Thu
                      </button>
                      <button
                        type="button"
                        onClick={() => onNavigateToModule('payment_vouchers')}
                        className="px-3 py-1.5 text-xs font-bold text-amber-900 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg transition-colors whitespace-nowrap"
                      >
                        + Mở Nhật ký Phiếu Chi
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
                  <div className="p-3.5 bg-emerald-50/60 border border-emerald-200 rounded-xl">
                    <div className="text-xs text-emerald-900 font-semibold">
                      Tổng Dòng Tiền Thực Thu (+)
                    </div>
                    <div className="text-base font-bold font-mono text-emerald-700 mt-1">
                      +{formatVND(totalCashInflow)}
                    </div>
                    <div className="text-[11px] text-emerald-800 mt-1 space-y-0.5">
                      <div>Thu bán hàng & thu nợ KH: +{formatVND(cashflowFinancial.salesPaidInflow)}</div>
                      <div>Phiếu thu khác: +{formatVND(cashflowFinancial.otherReceiptInflow)}</div>
                    </div>
                  </div>
                  <div className="p-3.5 bg-amber-50/60 border border-amber-200 rounded-xl">
                    <div className="text-xs text-amber-900 font-semibold">
                      Tổng Dòng Tiền Thực Chi (-)
                    </div>
                    <div className="text-base font-bold font-mono text-amber-800 mt-1">
                      -{formatVND(totalCashOutflow)}
                    </div>
                    <div className="text-[11px] text-amber-900 mt-1 space-y-0.5">
                      <div>Chi nhập hàng & trả nợ NCC: -{formatVND(cashflowFinancial.importsPaidOutflow)}</div>
                      <div>Phiếu chi vận hành/khác: -{formatVND(cashflowFinancial.operatingPaymentOutflow)}</div>
                    </div>
                  </div>
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
                    <div className="text-xs text-slate-700 font-semibold">
                      Phiếu Thu & Phiếu Chi Lập Trong Kỳ
                    </div>
                    <div className="text-base font-bold font-mono text-slate-900 mt-1">
                      {cashflowFinancial.filteredReceiptVouchers.filter((v) => !isContraOffsetVoucher(v)).length}{' '}
                      Phiếu thu ·{' '}
                      {cashflowFinancial.filteredPaymentVouchers.filter((v) => !isContraOffsetVoucher(v)).length}{' '}
                      Phiếu chi
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      Phân loại theo nhóm phiếu thu & nhóm phiếu chi
                    </div>
                  </div>
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
                    <div className="text-xs text-slate-700 font-semibold">
                      Chênh Lệch Dòng Tiền Ròng (Thu - Chi)
                    </div>
                    <div
                      className={`text-base font-bold font-mono mt-1 ${
                        netCashflow >= 0 ? 'text-emerald-700' : 'text-red-600'
                      }`}
                    >
                      {netCashflow >= 0 ? `+${formatVND(netCashflow)}` : formatVND(netCashflow)}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      Tồn quỹ thực tế phát sinh trong kỳ
                    </div>
                  </div>
                </div>

                {/* Group Breakdown: Nhóm Phiếu Thu & Nhóm Phiếu Chi */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pt-1">
                  <div className="p-3.5 bg-emerald-50/30 border border-emerald-200 rounded-xl space-y-2">
                    <div className="text-xs font-bold text-emerald-900 flex items-center justify-between">
                      <span>Thống Kê Theo Nhóm Phiếu Thu Tiền</span>
                      <span className="font-mono text-emerald-700">
                        {cashflowFinancial.filteredReceiptVouchers.length} phiếu
                      </span>
                    </div>
                    {cashflowFinancial.receiptGroupBreakdown.length === 0 ? (
                      <div className="text-xs text-slate-500">
                        Chưa có phiếu thu tiền nào trong khoảng thời gian này.
                      </div>
                    ) : (
                      <div className="divide-y divide-emerald-200/60 text-xs">
                        {cashflowFinancial.receiptGroupBreakdown.map((item) => (
                          <div
                            key={item.groupName}
                            className="py-1.5 flex items-center justify-between gap-2"
                          >
                            <span className="font-semibold text-slate-800">
                              {item.groupName} ({item.count} phiếu)
                            </span>
                            <span className="font-mono font-bold text-emerald-700">
                              +{formatVND(item.totalAmount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="p-3.5 bg-amber-50/30 border border-amber-200 rounded-xl space-y-2">
                    <div className="text-xs font-bold text-amber-900 flex items-center justify-between">
                      <span>Thống Kê Theo Nhóm Phiếu Chi Tiền</span>
                      <span className="font-mono text-amber-800">
                        {cashflowFinancial.filteredPaymentVouchers.length} phiếu
                      </span>
                    </div>
                    {cashflowFinancial.paymentGroupBreakdown.length === 0 ? (
                      <div className="text-xs text-slate-500">
                        Chưa có phiếu chi tiền nào trong khoảng thời gian này.
                      </div>
                    ) : (
                      <div className="divide-y divide-amber-200/60 text-xs">
                        {cashflowFinancial.paymentGroupBreakdown.map((item) => (
                          <div
                            key={item.groupName}
                            className="py-1.5 flex items-center justify-between gap-2"
                          >
                            <span className="font-semibold text-slate-800">
                              {item.groupName} ({item.count} phiếu)
                            </span>
                            <span className="font-mono font-bold text-amber-800">
                              -{formatVND(item.totalAmount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[1040px] text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                      <th className="py-3 px-3.5 whitespace-nowrap w-[105px]">Ngày giao dịch</th>
                      <th className="py-3 px-3.5 whitespace-nowrap w-[170px]">Nhóm Phiếu Thu / Chi</th>
                      <th className="py-3 px-3.5 whitespace-nowrap w-[125px]">Mã chứng từ</th>
                      <th className="py-3 px-3.5 min-w-[175px]">Đối tác / Khách hàng</th>
                      <th className="py-3 px-3.5 min-w-[240px]">Diễn giải nội dung dòng tiền</th>
                      <th className="py-3 px-3.5 text-right whitespace-nowrap w-[120px]">Tiền Thu (+)</th>
                      <th className="py-3 px-3.5 text-right whitespace-nowrap w-[120px]">Tiền Chi (-)</th>
                      <th className="py-3 px-3.5 text-right whitespace-nowrap w-[105px]">Kiểm tra</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {cashflowFinancial.filteredReceiptVouchers
                      .filter((rv) => !isContraOffsetVoucher(rv))
                      .map((rv) => (
                        <tr key={`cf_rv_${rv.id}`} className="bg-emerald-50/20 hover:bg-emerald-50/50">
                          <td className="py-3 px-3.5 font-mono whitespace-nowrap align-middle">
                            {toVietnamDateStr(rv.createdAt)}
                          </td>
                          <td className="py-3 px-3.5 whitespace-nowrap align-middle">
                            <span className="px-2 py-0.5 text-[11px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300 rounded whitespace-nowrap">
                              PHIẾU THU · {rv.groupName}
                            </span>
                          </td>
                          <td className="py-3 px-3.5 font-mono font-bold text-emerald-800 whitespace-nowrap align-middle">
                            {rv.voucherCode}
                          </td>
                          <td className="py-3 px-3.5 font-semibold text-slate-900 min-w-[175px] leading-snug align-middle">
                            {rv.partnerName}
                          </td>
                          <td className="py-3 px-3.5 min-w-[240px] leading-snug align-middle">
                            <div>{rv.note}</div>
                            {rv.isDebtSettlement && (rv.settledAllocations || []).length > 0 && (
                              <div className="text-[11px] text-emerald-700 font-semibold mt-0.5">
                                Đã trừ quyết toán theo thứ tự ngày nợ:{' '}
                                {(rv.settledAllocations || [])
                                  .map((a) => `${a.code} (-${formatVND(a.allocatedAmount)})`)
                                  .join(', ')}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3.5 text-right font-mono tabular-nums font-bold text-emerald-700 whitespace-nowrap align-middle">
                            +{formatVND(rv.amount)}
                          </td>
                          <td className="py-3 px-3.5 text-right font-mono tabular-nums text-slate-400 whitespace-nowrap align-middle">
                            0 đ
                          </td>
                          <td className="py-3 px-3.5 text-right whitespace-nowrap align-middle">
                            {onNavigateToModule && (
                              <button
                                type="button"
                                onClick={() => onNavigateToModule('receipt_vouchers')}
                                className="px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md whitespace-nowrap"
                              >
                                Phiếu thu →
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}

                    {cashflowFinancial.filteredPaymentVouchers
                      .filter((pv) => !isContraOffsetVoucher(pv))
                      .map((pv) => (
                        <tr key={`cf_pv_${pv.id}`} className="bg-amber-50/20 hover:bg-amber-50/50">
                          <td className="py-3 px-3.5 font-mono whitespace-nowrap align-middle">
                            {toVietnamDateStr(pv.createdAt)}
                          </td>
                          <td className="py-3 px-3.5 whitespace-nowrap align-middle">
                            <span className="px-2 py-0.5 text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300 rounded whitespace-nowrap">
                              PHIẾU CHI · {pv.groupName}
                            </span>
                          </td>
                          <td className="py-3 px-3.5 font-mono font-bold text-amber-900 whitespace-nowrap align-middle">
                            {pv.voucherCode}
                          </td>
                          <td className="py-3 px-3.5 font-semibold text-slate-900 min-w-[175px] leading-snug align-middle">
                            {pv.partnerName}
                          </td>
                          <td className="py-3 px-3.5 min-w-[240px] leading-snug align-middle">
                            <div>{pv.note}</div>
                            {pv.isDebtSettlement && (pv.settledAllocations || []).length > 0 && (
                              <div className="text-[11px] text-amber-800 font-semibold mt-0.5">
                                Đã trừ quyết toán theo thứ tự ngày nợ:{' '}
                                {(pv.settledAllocations || [])
                                  .map((a) => `${a.code} (-${formatVND(a.allocatedAmount)})`)
                                  .join(', ')}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3.5 text-right font-mono tabular-nums text-slate-400 whitespace-nowrap align-middle">
                            0 đ
                          </td>
                          <td className="py-3 px-3.5 text-right font-mono tabular-nums font-bold text-amber-800 whitespace-nowrap align-middle">
                            -{formatVND(pv.amount)}
                          </td>
                          <td className="py-3 px-3.5 text-right whitespace-nowrap align-middle">
                            {onNavigateToModule && (
                              <button
                                type="button"
                                onClick={() => onNavigateToModule('payment_vouchers')}
                                className="px-2.5 py-1 text-xs font-semibold text-amber-900 bg-amber-50 border border-amber-200 rounded-md whitespace-nowrap"
                              >
                                Phiếu chi →
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}

                    {(() => {
                      const allRvs = receiptVouchers || [];
                      const coveredSaleGroupIds = new Set<string>();
                      for (const rv of allRvs) {
                        if (rv.linkedSaleGroupId) coveredSaleGroupIds.add(rv.linkedSaleGroupId);
                      }
                      return salesInRange
                        .map((s) => {
                          if (s.invoiceGroupId && coveredSaleGroupIds.has(s.invoiceGroupId)) {
                            return { s, unvouchered: 0 };
                          }
                          const debtPaid = findLinkedReceiptVouchersForSale(s, allRvs).reduce(
                            (sum, rv) =>
                              sum +
                              (rv.settledAllocations || [])
                                .filter((a) => a.recordId === s.id || a.code === s.invoiceCode)
                                .reduce((ss, a) => ss + (Number(a.allocatedAmount) || 0), 0),
                            0
                          );
                          const directPaid = findDirectReceiptVouchersForSale(s, allRvs).reduce(
                            (sum, rv) => sum + (Number(rv.amount) || 0),
                            0
                          );
                          const contraAmt = Math.max(0, Math.round(Number(s.supplierOffsetAmount) || 0));
                          const unvouchered = Math.max(
                            0,
                            Math.round((Number(s.paidAmount) || 0) - debtPaid - directPaid - contraAmt)
                          );
                          return { s, unvouchered };
                        })
                        .filter(({ unvouchered }) => unvouchered > 0)
                        .map(({ s, unvouchered }) => (
                          <tr
                            key={`cf_in_${s.id}`}
                            onClick={() => setDrillDownItem({ type: 'sale', record: s })}
                            className="hover:bg-emerald-50/40 cursor-pointer"
                          >
                            <td className="py-3 px-3.5 font-mono whitespace-nowrap align-middle">
                              {toVietnamDateStr(s.createdAt)}
                            </td>
                            <td className="py-3 px-3.5 whitespace-nowrap align-middle">
                              <span className="px-2 py-0.5 text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded whitespace-nowrap">
                                THU TẠI ĐƠN BÁN (CŨ)
                              </span>
                            </td>
                            <td className="py-3 px-3.5 font-mono font-bold text-emerald-800 underline whitespace-nowrap align-middle">
                              {s.invoiceCode}
                            </td>
                            <td className="py-3 px-3.5 font-semibold text-slate-900 min-w-[175px] leading-snug align-middle">
                              {s.customerName}
                            </td>
                            <td className="py-3 px-3.5 min-w-[240px] leading-snug align-middle">
                              Thu tiền bán {s.quantity} {s.unit} {s.productName}
                            </td>
                            <td className="py-3 px-3.5 text-right font-mono tabular-nums font-bold text-emerald-700 whitespace-nowrap align-middle">
                              +{formatVND(unvouchered)}
                            </td>
                            <td className="py-3 px-3.5 text-right font-mono tabular-nums text-slate-400 whitespace-nowrap align-middle">
                              0 đ
                            </td>
                            <td className="py-3 px-3.5 text-right whitespace-nowrap align-middle">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDrillDownItem({ type: 'sale', record: s });
                                }}
                                className="px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 rounded-md whitespace-nowrap"
                              >
                                Chi tiết →
                              </button>
                            </td>
                          </tr>
                        ));
                    })()}
                    {(() => {
                      const allPvs = paymentVouchers || [];
                      const coveredImportGroupIds = new Set<string>();
                      for (const pv of allPvs) {
                        if (pv.linkedImportGroupId) coveredImportGroupIds.add(pv.linkedImportGroupId);
                      }
                      return importsInRange
                        .map((i) => {
                          if (i.importGroupId && coveredImportGroupIds.has(i.importGroupId)) {
                            return { i, unvouchered: 0 };
                          }
                          const debtPaid = findLinkedPaymentVouchersForImport(i, allPvs).reduce(
                            (sum, pv) =>
                              sum +
                              (pv.settledAllocations || [])
                                .filter((a) => a.recordId === i.id || a.code === i.receiptCode)
                                .reduce((ss, a) => ss + (Number(a.allocatedAmount) || 0), 0),
                            0
                          );
                          const directPaid = findDirectPaymentVouchersForImport(i, allPvs).reduce(
                            (sum, pv) => sum + (Number(pv.amount) || 0),
                            0
                          );
                          const unvouchered = Math.max(
                            0,
                            Math.round((Number(i.paidAmount) || 0) - debtPaid - directPaid)
                          );
                          return { i, unvouchered };
                        })
                        .filter(({ unvouchered }) => unvouchered > 0)
                        .map(({ i, unvouchered }) => (
                          <tr
                            key={`cf_out_${i.id}`}
                            onClick={() => setDrillDownItem({ type: 'import', record: i })}
                            className="hover:bg-amber-50/40 cursor-pointer"
                          >
                            <td className="py-3 px-3.5 font-mono whitespace-nowrap align-middle">
                              {toVietnamDateStr(i.createdAt)}
                            </td>
                            <td className="py-3 px-3.5 whitespace-nowrap align-middle">
                              <span className="px-2 py-0.5 text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200 rounded whitespace-nowrap">
                                CHI TẠI PHIẾU NHẬP (CŨ)
                              </span>
                            </td>
                            <td className="py-3 px-3.5 font-mono font-bold text-amber-900 underline whitespace-nowrap align-middle">
                              {i.receiptCode}
                            </td>
                            <td className="py-3 px-3.5 font-semibold text-slate-900 min-w-[175px] leading-snug align-middle">
                              {i.supplierName}
                            </td>
                            <td className="py-3 px-3.5 min-w-[240px] leading-snug align-middle">
                              Chi thanh toán nhập {i.quantity} {i.unit} {i.productName}
                            </td>
                            <td className="py-3 px-3.5 text-right font-mono tabular-nums text-slate-400 whitespace-nowrap align-middle">
                              0 đ
                            </td>
                            <td className="py-3 px-3.5 text-right font-mono tabular-nums font-bold text-amber-800 whitespace-nowrap align-middle">
                              -{formatVND(unvouchered)}
                            </td>
                            <td className="py-3 px-3.5 text-right whitespace-nowrap align-middle">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDrillDownItem({ type: 'import', record: i });
                                }}
                                className="px-2.5 py-1 text-xs font-semibold text-amber-900 bg-amber-50 rounded-md whitespace-nowrap"
                              >
                                Chi tiết →
                              </button>
                            </td>
                          </tr>
                        ));
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        {/* ====================================================================
            TAB 8: BÁO CÁO TÀI CHÍNH NĂM CHUẨN BIỂU MẪU CƠ QUAN THUẾ (B02-DN / B01-DN / B03-DN)
            CHỌN TỪNG NĂM (2024 -> 2032... 2040+), IN BCTC THUẾ & BẤM VÀO TỪNG MỤC ĐỂ KIỂM TRA CHI TIẾT
           ==================================================================== */}
        {canAccessWarehouseAdminFeatures &&
          activeCategory === 'financial_profit' &&
          allowedCategories.includes('financial_profit') && (
            <div className="bg-white rounded-xl border-2 border-emerald-200 overflow-hidden shadow-sm space-y-0">
              {/* Top Control Bar: Fiscal Year Selector (2024..2040+) + Tax Rate Reference + Print/Export Tax Authority BCTC */}
              <div className="p-4 sm:p-6 border-b border-slate-200 bg-emerald-50/60 space-y-4">
                <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-100 border border-emerald-300 text-xs font-bold text-emerald-950">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                      <span>
                        Báo Cáo Tài Chính Năm · Biểu Mẫu Kê Khai Cơ Quan Thuế (Mẫu B02-DN / B01-DN / B03-DN)
                      </span>
                    </div>
                    <h3 className="text-base sm:text-lg font-extrabold text-slate-900">
                      Báo Cáo Tài Chính & Kết Quả Hoạt Động Kinh Doanh Năm {selectedFinancialReportYear}{' '}
                      <span className="text-xs sm:text-sm font-semibold text-emerald-800">
                        (Kỳ báo cáo: Từ ngày {fromDate} đến ngày {toDate})
                      </span>
                    </h3>
                  </div>

                  {/* Print PDF & Export Excel Tax Authority Financial Statement Buttons */}
                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        const fn = exportTaxAuthorityFinancialReportPDF({
                          statement: taxFinancialStatement,
                          staffName: currentStaff.displayName,
                          warehouseLabel: effectiveWarehouseLabel,
                        });
                        onNotifyToast(
                          `Đã xuất bản in Báo Cáo Tài Chính Năm ${selectedFinancialReportYear} chuẩn Cơ quan Thuế (${fn})`
                        );
                      }}
                      className="w-full sm:w-auto px-4 py-2.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                    >
                      <Printer className="w-4 h-4 shrink-0" />
                      <span>In Báo Cáo Tài Chính Năm PDF (Mẫu Cơ Quan Thuế)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const fn = exportTaxAuthorityFinancialReportExcel({
                          statement: taxFinancialStatement,
                          staffName: currentStaff.displayName,
                          warehouseLabel: effectiveWarehouseLabel,
                        });
                        onNotifyToast(
                          `Đã xuất hồ sơ Báo Cáo Tài Chính Năm ${selectedFinancialReportYear} ra Excel 5 Sheet chi tiết (${fn})`
                        );
                      }}
                      className="w-full sm:w-auto px-4 py-2.5 text-xs font-bold text-emerald-950 bg-white hover:bg-emerald-50 border border-emerald-400 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                    >
                      <FileSpreadsheet className="w-4 h-4 text-emerald-700 shrink-0" />
                      <span>Xuất Hồ Sơ BCTC Năm Excel (.xlsx 5 Sheet)</span>
                    </button>
                  </div>
                </div>

                {/* Fiscal Year Picker & Quick Year Switcher (2024 -> 2028, 2029, 2030, 2031, 2032... 2040+) */}
                <div className="p-3.5 bg-white rounded-xl border border-emerald-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3 overflow-hidden">
                  <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 w-full lg:w-auto min-w-0">
                    <label
                      htmlFor="select-tax-financial-year"
                      className="text-xs font-bold text-slate-800 flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Calendar className="w-4 h-4 text-emerald-700 shrink-0" />
                      <span>Chọn năm Báo cáo tài chính:</span>
                    </label>

                    <div className="flex items-center gap-1.5 w-full sm:w-auto min-w-0">
                      <button
                        type="button"
                        onClick={() => handleSelectFinancialYear(selectedFinancialReportYear - 1)}
                        className="px-2.5 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg shrink-0"
                        title="Lùi 1 năm tài chính"
                      >
                        -1 năm
                      </button>
                      <select
                        id="select-tax-financial-year"
                        value={selectedFinancialReportYear}
                        onChange={(e) => handleSelectFinancialYear(Number(e.target.value))}
                        className="flex-1 sm:flex-initial min-w-0 w-full sm:w-auto px-2.5 py-1.5 text-xs font-bold text-emerald-950 bg-emerald-50/70 border border-emerald-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600 truncate"
                      >
                        {availableFiscalYears.map((yr) => (
                          <option key={`bctc_yr_${yr}`} value={yr}>
                            Năm tài chính {yr} (01/01 → 31/12)
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => handleSelectFinancialYear(selectedFinancialReportYear + 1)}
                        className="px-2.5 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg shrink-0"
                        title="Tăng 1 năm tài chính về sau"
                      >
                        +1 năm
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSelectFinancialYear(selectedFinancialReportYear)}
                      className={`w-full sm:w-auto px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors ${
                        fromDate === `${selectedFinancialReportYear}-01-01` &&
                        toDate === `${selectedFinancialReportYear}-12-31`
                          ? 'bg-emerald-700 text-white border-emerald-700'
                          : 'bg-white text-emerald-900 border-emerald-300 hover:bg-emerald-50'
                      }`}
                    >
                      Trọn năm {selectedFinancialReportYear} (01/01 → 31/12)
                    </button>
                  </div>

                  {/* Quick Year Buttons including 2026, 2027, 2028, 2029, 2030, 2031, 2032 + Tax Reference % */}
                  <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 w-full lg:w-auto min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032].map((yr) => {
                        const isSelectedYr =
                          selectedFinancialReportYear === yr &&
                          fromDate === `${yr}-01-01` &&
                          toDate === `${yr}-12-31`;
                        return (
                          <button
                            key={`quick_yr_${yr}`}
                            type="button"
                            onClick={() => handleSelectFinancialYear(yr)}
                            className={`px-2.5 py-1 text-xs font-mono font-bold rounded-md border transition-colors ${
                              isSelectedYr
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-emerald-50 hover:border-emerald-300'
                            }`}
                          >
                            {yr}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-1.5 w-full sm:w-auto min-w-0 pt-2 sm:pt-0 sm:pl-2 border-t sm:border-t-0 sm:border-l border-slate-200">
                      <label
                        htmlFor="input-tax-rate-pct"
                        className="text-[11px] font-semibold text-slate-600 whitespace-nowrap shrink-0"
                      >
                        Thuế tham chiếu (%):
                      </label>
                      <select
                        id="input-tax-rate-pct"
                        value={taxRatePct}
                        onChange={(e) => setTaxRatePct(Number(e.target.value))}
                        className="flex-1 sm:flex-initial min-w-0 w-full sm:w-auto px-2 py-1 text-xs font-mono font-bold text-slate-900 bg-slate-50 border border-slate-300 rounded-md truncate"
                      >
                        <option value={1.5}>1.5% (Phân phối VTNN: 1% GTGT + 0.5% TNCN)</option>
                        <option value={1}>1.0% (Thuế GTGT thương mại)</option>
                        <option value={2}>2.0% (Hộ kinh doanh tổng hợp)</option>
                        <option value={0}>0% (Chưa tính thuế)</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* 6 Core Financial Summary Cards (Clickable to jump directly to each Tax Line Item audit) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
                  <button
                    type="button"
                    onClick={() => handleSelectTaxLineForAudit('10_net_revenue')}
                    className={`p-3.5 text-left rounded-xl border transition-all ${
                      activeTaxDrillDownCode === '10_net_revenue' ||
                      activeTaxDrillDownCode === '01_gross_revenue'
                        ? 'bg-emerald-50 border-emerald-500 ring-2 ring-emerald-500/20'
                        : 'bg-white border-slate-200 hover:border-emerald-300'
                    }`}
                  >
                    <div className="text-xs text-slate-500 flex items-center justify-between">
                      <span>[Mã 10] Doanh Thu Thuần</span>
                      <span className="text-[10px] font-bold text-emerald-700 underline">Chi tiết</span>
                    </div>
                    <div className="text-base font-bold font-mono text-slate-900 mt-1">
                      {formatVND(taxFinancialStatement.netRevenue10)}
                    </div>
                    <div className="text-[11px] font-mono text-amber-700 mt-0.5">
                      Gộp [01]: {formatVND(taxFinancialStatement.grossRevenue01)} · Giảm [02]: -
                      {formatVND(taxFinancialStatement.revenueDeduction02)}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSelectTaxLineForAudit('11_cogs_total')}
                    className={`p-3.5 text-left rounded-xl border transition-all ${
                      activeTaxDrillDownCode === '11_cogs_total'
                        ? 'bg-emerald-50 border-emerald-500 ring-2 ring-emerald-500/20'
                        : 'bg-white border-slate-200 hover:border-emerald-300'
                    }`}
                  >
                    <div className="text-xs text-slate-500 flex items-center justify-between">
                      <span>[Mã 11] Giá Vốn (Hàng+Quà)</span>
                      <span className="text-[10px] font-bold text-emerald-700 underline">Chi tiết</span>
                    </div>
                    <div className="text-base font-bold font-mono text-slate-800 mt-1">
                      {formatVND(taxFinancialStatement.totalCogs11)}
                    </div>
                    <div className="text-[11px] font-mono text-emerald-700 mt-0.5">
                      Hàng: {formatVND(taxFinancialStatement.productCogs11a)} · Quà KM:{' '}
                      {formatVND(taxFinancialStatement.giftCogs11b)}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSelectTaxLineForAudit('20_gross_profit')}
                    className={`p-3.5 text-left rounded-xl border transition-all ${
                      activeTaxDrillDownCode === '20_gross_profit'
                        ? 'bg-emerald-50 border-emerald-500 ring-2 ring-emerald-500/20'
                        : 'bg-white border-emerald-200 hover:border-emerald-400'
                    }`}
                  >
                    <div className="text-xs text-emerald-800 font-semibold flex items-center justify-between">
                      <span>[Mã 20] Lợi Nhuận Gộp</span>
                      <span className="text-[10px] font-bold text-emerald-700 underline">Chi tiết</span>
                    </div>
                    <div className="text-base font-bold font-mono text-emerald-700 mt-1">
                      {formatVND(taxFinancialStatement.grossProfit20)}
                    </div>
                    <div className="text-[11px] font-mono text-emerald-800 mt-0.5">
                      Biên lãi gộp: {profitMarginPct}% ({taxFinancialStatement.filteredSales.length} đơn)
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSelectTaxLineForAudit('24_operating_expenses')}
                    className={`p-3.5 text-left rounded-xl border transition-all ${
                      activeTaxDrillDownCode === '24_operating_expenses'
                        ? 'bg-amber-50 border-amber-500 ring-2 ring-amber-500/20'
                        : 'bg-white border-amber-200 hover:border-amber-400'
                    }`}
                  >
                    <div className="text-xs text-amber-900 font-semibold flex items-center justify-between">
                      <span>[Mã 24] Chi Phí Vận Hành</span>
                      <span className="text-[10px] font-bold text-amber-800 underline">Chi tiết</span>
                    </div>
                    <div className="text-base font-bold font-mono text-amber-800 mt-1">
                      -{formatVND(taxFinancialStatement.operatingExpenses24)}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {taxFinancialStatement.operatingPaymentVouchers.length} phiếu chi vận hành
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSelectTaxLineForAudit('31_other_income')}
                    className={`p-3.5 text-left rounded-xl border transition-all ${
                      activeTaxDrillDownCode === '31_other_income'
                        ? 'bg-emerald-50 border-emerald-500 ring-2 ring-emerald-500/20'
                        : 'bg-white border-emerald-200 hover:border-emerald-400'
                    }`}
                  >
                    <div className="text-xs text-emerald-800 font-semibold flex items-center justify-between">
                      <span>[Mã 31] Thu Nhập Khác</span>
                      <span className="text-[10px] font-bold text-emerald-700 underline">Chi tiết</span>
                    </div>
                    <div className="text-base font-bold font-mono text-emerald-700 mt-1">
                      +{formatVND(taxFinancialStatement.otherIncome31)}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {taxFinancialStatement.otherIncomeReceiptVouchers.length} phiếu thu thưởng/CK NCC
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSelectTaxLineForAudit('50_profit_before_tax')}
                    className="p-3.5 text-left bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl border border-emerald-800 transition-colors"
                  >
                    <div className="text-xs font-semibold text-emerald-100 flex items-center justify-between">
                      <span>[Mã 50] Lợi Nhuận Trước Thuế</span>
                      <span className="text-[10px] font-bold text-white underline">Chi tiết</span>
                    </div>
                    <div className="text-base font-bold font-mono mt-1">
                      {formatVND(taxFinancialStatement.profitBeforeTax50)}
                    </div>
                    <div className="text-[11px] font-mono text-emerald-100 mt-0.5">
                      Sau thuế [60]: {formatVND(taxFinancialStatement.profitAfterTax60)}
                    </div>
                  </button>
                </div>
              </div>

              {/* ====================================================================
                  OFFICIAL TAX AUTHORITY FINANCIAL STATEMENT PAPER SHEET
                  (MẪU SỐ B02-DN & B01-DN / B03-DN — BẤM VÀO TỪNG MỤC ĐỂ XEM CHI TIẾT)
                 ==================================================================== */}
              <div className="p-4 sm:p-6 bg-white space-y-6">
                {/* Official Tax Form Header Block */}
                <div className="p-4 sm:p-5 rounded-xl border-2 border-slate-300 bg-slate-50/60 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-3.5 border-b border-slate-300 text-xs">
                    <div className="space-y-1">
                      <div className="font-extrabold text-emerald-900 text-sm uppercase">
                        ĐƠN VỊ BÁO CÁO: CỬA HÀNG VẬT TƯ NÔNG NGHIỆP TÂM AN
                      </div>
                      <div className="text-slate-700 font-medium">
                        Lĩnh vực kinh doanh: Phân bón, Thuốc BVTV, Hạt giống & Vật tư nông nghiệp
                      </div>
                      <div className="text-slate-600">
                        Phạm vi kho tổng hợp:{' '}
                        <strong className="text-slate-900">
                          {effectiveWarehouseLabel}
                        </strong>{' '}
                        · Quản lý chính: <strong className="font-mono">{ADMIN_BACKUP_EMAIL}</strong>
                      </div>
                    </div>

                    <div className="md:text-right space-y-1">
                      <div className="font-extrabold text-slate-900 text-sm uppercase">
                        CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
                      </div>
                      <div className="font-bold text-slate-800">Độc lập - Tự do - Hạnh phúc</div>
                      <div className="text-slate-600 font-medium">
                        Biểu mẫu số: <strong className="text-slate-900">B02-DN / B01-DN / B03-DN</strong>{' '}
                        (Chuẩn Báo cáo Tài chính Cơ quan Thuế)
                      </div>
                    </div>
                  </div>

                  <div className="text-center space-y-1">
                    <h4 className="text-base sm:text-lg font-extrabold text-slate-950 uppercase tracking-tight">
                      BÁO CÁO TÀI CHÍNH & KẾT QUẢ HOẠT ĐỘNG KINH DOANH NĂM {selectedFinancialReportYear}
                    </h4>
                    <p className="text-xs font-semibold text-slate-700">
                      Kỳ báo cáo: Từ ngày <span className="font-mono">{fromDate}</span> đến ngày{' '}
                      <span className="font-mono">{toDate}</span> · Đơn vị tính: Đồng Việt Nam (VNĐ)
                    </p>
                    <p className="text-xs text-emerald-800 font-semibold">
                      💡 Hướng dẫn kiểm tra: Nhấp trực tiếp vào bất kỳ dòng chỉ tiêu (Mã 01 → Mã 400)
                      trong bảng dưới đây để mở danh sách toàn bộ chứng từ gốc cấu thành con số đó.
                    </p>
                  </div>
                </div>

                {/* PHẦN I: BÁO CÁO KẾT QUẢ HOẠT ĐỘNG KINH DOANH NĂM (MẪU B02-DN) */}
                <div className="space-y-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <h5 className="text-xs sm:text-sm font-extrabold text-slate-900 uppercase flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-emerald-700 text-white font-mono text-xs">
                        Mẫu B02-DN
                      </span>
                      <span>
                        Phần I. Báo Cáo Kết Quả Hoạt Động Kinh Doanh Năm {selectedFinancialReportYear}
                      </span>
                    </h5>
                    <span className="text-xs font-semibold text-emerald-800">
                      Bấm vào từng dòng chỉ tiêu để kiểm tra chứng từ chi tiết ↓
                    </span>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-slate-300">
                    <table className="w-full min-w-[940px] text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-900 text-white font-bold">
                          <th className="py-3 px-3 text-center whitespace-nowrap w-[68px] border-r border-slate-700">
                            Mã số
                          </th>
                          <th className="py-3 px-3.5 min-w-[290px] border-r border-slate-700">
                            Chỉ tiêu Báo cáo Kết quả Hoạt động Kinh doanh (1)
                          </th>
                          <th className="py-3 px-2.5 text-center whitespace-nowrap w-[76px] border-r border-slate-700">
                            T.Minh
                          </th>
                          <th className="py-3 px-3 min-w-[210px] border-r border-slate-700">
                            Công thức & Căn cứ chứng từ
                          </th>
                          <th className="py-3 px-3.5 text-right whitespace-nowrap w-[145px] border-r border-slate-700">
                            Số tiền kỳ báo cáo (VNĐ)
                          </th>
                          <th className="py-3 px-2.5 text-right whitespace-nowrap w-[78px] border-r border-slate-700">
                            Tỷ trọng
                          </th>
                          <th className="py-3 px-3 text-center whitespace-nowrap w-[135px]">
                            Kiểm tra chi tiết
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {taxFinancialStatement.incomeStatementLines.map((line) => {
                          const isSelected = activeTaxDrillDownCode === line.drillDownCode;
                          return (
                            <tr
                              key={`b02_${line.code}`}
                              onClick={() => handleSelectTaxLineForAudit(line.drillDownCode)}
                              className={`cursor-pointer transition-colors ${
                                isSelected
                                  ? 'bg-emerald-100/90 font-bold'
                                  : line.isHighlightRow
                                  ? 'bg-emerald-50/60 hover:bg-emerald-100/60 font-semibold'
                                  : 'bg-white hover:bg-slate-50'
                              }`}
                            >
                              <td className="py-3 px-3 text-center font-mono font-bold text-slate-900 border-r border-slate-200 align-middle">
                                <span
                                  className={`inline-block px-2 py-0.5 rounded border ${
                                    isSelected
                                      ? 'bg-emerald-700 text-white border-emerald-800'
                                      : 'bg-slate-100 text-slate-800 border-slate-300'
                                  }`}
                                >
                                  {line.code}
                                </span>
                              </td>
                              <td className="py-3 px-3.5 border-r border-slate-200 align-middle">
                                <div className="text-slate-900 font-bold">{line.title}</div>
                                <div className="text-[11px] text-slate-500 font-normal mt-0.5">
                                  {line.description}
                                </div>
                              </td>
                              <td className="py-3 px-2.5 text-center font-mono text-slate-600 border-r border-slate-200 align-middle">
                                {line.noteCode}
                              </td>
                              <td className="py-3 px-3 border-r border-slate-200 align-middle">
                                <div className="font-mono text-[11px] text-slate-700">
                                  {line.formulaText}
                                </div>
                                <div className="text-[11px] font-semibold text-emerald-800 mt-0.5">
                                  Căn cứ: {line.recordCountLabel}
                                </div>
                              </td>
                              <td
                                className={`py-3 px-3.5 text-right font-mono tabular-nums text-sm border-r border-slate-200 align-middle ${
                                  line.code === '02' || line.code === '24' || line.code === '51'
                                    ? 'text-amber-800 font-bold'
                                    : line.isHighlightRow
                                    ? 'text-emerald-800 font-extrabold'
                                    : 'text-slate-900 font-bold'
                                }`}
                              >
                                {formatVND(line.amount)}
                              </td>
                              <td className="py-3 px-2.5 text-right font-mono text-slate-700 border-r border-slate-200 align-middle">
                                {line.ratioToNetRevenuePct}%
                              </td>
                              <td className="py-3 px-3 text-center align-middle">
                                <span
                                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold border ${
                                    isSelected
                                      ? 'bg-emerald-700 text-white border-emerald-800'
                                      : 'bg-white text-emerald-800 border-emerald-300 hover:bg-emerald-50'
                                  }`}
                                >
                                  <Eye className="w-3.5 h-3.5 shrink-0" />
                                  <span>{isSelected ? 'Đang xem' : 'Xem chi tiết'}</span>
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* PHẦN II: BẢNG CÂN ĐỐI TÀI SẢN, TỒN KHO, CÔNG NỢ & LƯU CHUYỂN DÒNG TIỀN (MẪU B01-DN & B03-DN) */}
                <div className="space-y-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <h5 className="text-xs sm:text-sm font-extrabold text-slate-900 uppercase flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-slate-900 text-white font-mono text-xs">
                        Mẫu B01-DN & B03-DN
                      </span>
                      <span>
                        Phần II. Bảng Cân Đối Tài Sản, Hàng Tồn Kho, Công Nợ & Lưu Chuyển Dòng Tiền Cuối Kỳ
                      </span>
                    </h5>
                    <span className="text-xs font-semibold text-emerald-800">
                      Bấm vào từng mục Tài sản / Tồn kho / Công nợ để đối chiếu ↓
                    </span>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-slate-300">
                    <table className="w-full min-w-[940px] text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-800 text-white font-bold">
                          <th className="py-3 px-3 text-center whitespace-nowrap w-[68px] border-r border-slate-700">
                            Mã số
                          </th>
                          <th className="py-3 px-3.5 min-w-[290px] border-r border-slate-700">
                            Chỉ tiêu Tài sản - Hàng tồn kho - Công nợ - Dòng tiền
                          </th>
                          <th className="py-3 px-2.5 text-center whitespace-nowrap w-[76px] border-r border-slate-700">
                            TK / Mẫu
                          </th>
                          <th className="py-3 px-3 min-w-[210px] border-r border-slate-700">
                            Công thức & Căn cứ chứng từ
                          </th>
                          <th className="py-3 px-3.5 text-right whitespace-nowrap w-[145px] border-r border-slate-700">
                            Số dư cuối kỳ (VNĐ)
                          </th>
                          <th className="py-3 px-2.5 text-right whitespace-nowrap w-[78px] border-r border-slate-700">
                            Tỷ trọng
                          </th>
                          <th className="py-3 px-3 text-center whitespace-nowrap w-[135px]">
                            Kiểm tra chi tiết
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {taxFinancialStatement.balanceAndCashflowLines.map((line) => {
                          const isSelected = activeTaxDrillDownCode === line.drillDownCode;
                          return (
                            <tr
                              key={`b01_${line.code}`}
                              onClick={() => handleSelectTaxLineForAudit(line.drillDownCode)}
                              className={`cursor-pointer transition-colors ${
                                isSelected
                                  ? 'bg-emerald-100/90 font-bold'
                                  : line.isHighlightRow
                                  ? 'bg-slate-100/80 hover:bg-emerald-50/70 font-semibold'
                                  : 'bg-white hover:bg-slate-50'
                              }`}
                            >
                              <td className="py-3 px-3 text-center font-mono font-bold text-slate-900 border-r border-slate-200 align-middle">
                                <span
                                  className={`inline-block px-2 py-0.5 rounded border ${
                                    isSelected
                                      ? 'bg-emerald-700 text-white border-emerald-800'
                                      : 'bg-slate-100 text-slate-800 border-slate-300'
                                  }`}
                                >
                                  {line.code}
                                </span>
                              </td>
                              <td className="py-3 px-3.5 border-r border-slate-200 align-middle">
                                <div className="text-slate-900 font-bold">{line.title}</div>
                                <div className="text-[11px] text-slate-500 font-normal mt-0.5">
                                  {line.description}
                                </div>
                              </td>
                              <td className="py-3 px-2.5 text-center font-mono text-slate-600 border-r border-slate-200 align-middle">
                                {line.noteCode}
                              </td>
                              <td className="py-3 px-3 border-r border-slate-200 align-middle">
                                <div className="font-mono text-[11px] text-slate-700">
                                  {line.formulaText}
                                </div>
                                <div className="text-[11px] font-semibold text-emerald-800 mt-0.5">
                                  Căn cứ: {line.recordCountLabel}
                                </div>
                              </td>
                              <td
                                className={`py-3 px-3.5 text-right font-mono tabular-nums text-sm border-r border-slate-200 align-middle ${
                                  line.code === '331'
                                    ? 'text-amber-800 font-bold'
                                    : line.code === '131'
                                    ? 'text-rose-700 font-bold'
                                    : 'text-emerald-800 font-extrabold'
                                }`}
                              >
                                {formatVND(line.amount)}
                              </td>
                              <td className="py-3 px-2.5 text-right font-mono text-slate-700 border-r border-slate-200 align-middle">
                                {line.ratioToNetRevenuePct}%
                              </td>
                              <td className="py-3 px-3 text-center align-middle">
                                <span
                                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold border ${
                                    isSelected
                                      ? 'bg-emerald-700 text-white border-emerald-800'
                                      : 'bg-white text-emerald-800 border-emerald-300 hover:bg-emerald-50'
                                  }`}
                                >
                                  <Eye className="w-3.5 h-3.5 shrink-0" />
                                  <span>{isSelected ? 'Đang xem' : 'Xem chi tiết'}</span>
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* ====================================================================
                    INTERACTIVE DRILL-DOWN AUDIT INSPECTOR:
                    KIỂM TRA CHI TIẾT TỪNG MỤC TRONG BÁO CÁO TÀI CHÍNH ĐỂ XÁC MINH TÍNH CHÍNH XÁC
                   ==================================================================== */}
                <div
                  ref={taxDrillDownPanelRef}
                  className="rounded-xl border-2 border-emerald-400 bg-emerald-50/40 overflow-hidden shadow-sm"
                >
                  <div className="p-4 sm:p-5 bg-emerald-900 text-white space-y-3">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-emerald-700 text-emerald-100 text-[11px] font-mono font-bold">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            BẢNG KÊ KIỂM TRA & ĐỐI CHIẾU CHI TIẾT CHỈ TIÊU BÁO CÁO TÀI CHÍNH — MÃ SỐ [
                            {activeTaxLineItem.code}]
                          </span>
                        </div>
                        <h4 className="text-sm sm:text-base font-extrabold text-white">
                          [Mã {activeTaxLineItem.code}] {activeTaxLineItem.title}
                        </h4>
                        <p className="text-xs text-emerald-100">
                          Công thức kiểm chứng: <strong className="font-mono">{activeTaxLineItem.formulaText}</strong>{' '}
                          · Nguồn dữ liệu: <strong>{activeTaxLineItem.recordCountLabel}</strong>
                        </p>
                      </div>

                      <div className="p-3 rounded-lg bg-emerald-950/80 border border-emerald-700 text-right shrink-0">
                        <div className="text-[11px] text-emerald-200">
                          Tổng số tiền chỉ tiêu [Mã {activeTaxLineItem.code}] đã khớp 100%:
                        </div>
                        <div className="text-lg font-extrabold font-mono text-white">
                          {formatVND(activeTaxLineItem.amount)}
                        </div>
                      </div>
                    </div>

                    {/* Quick Pills to Switch Between Any of the 16 Tax Report Line Items */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-emerald-800">
                      <span className="text-[11px] font-semibold text-emerald-200 mr-1">
                        Chọn nhanh mục cần kiểm tra:
                      </span>
                      {taxFinancialStatement.allLines.map((line) => (
                        <button
                          key={`pill_${line.code}`}
                          type="button"
                          onClick={() => setActiveTaxDrillDownCode(line.drillDownCode)}
                          className={`px-2.5 py-1 rounded text-[11px] font-mono font-bold transition-colors ${
                            activeTaxDrillDownCode === line.drillDownCode
                              ? 'bg-white text-emerald-950 shadow-sm'
                              : 'bg-emerald-800/80 text-emerald-100 hover:bg-emerald-700'
                          }`}
                        >
                          Mã {line.code}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Dynamic Audit Content Based on Selected Line Item */}
                  <div className="p-4 sm:p-5 bg-white space-y-4">
                    {/* CASE 1: Sales & COGS & Gross Profit Line Items (01, 02, 10, 11, 20, 51) */}
                    {(activeTaxDrillDownCode === '01_gross_revenue' ||
                      activeTaxDrillDownCode === '02_revenue_deduction' ||
                      activeTaxDrillDownCode === '10_net_revenue' ||
                      activeTaxDrillDownCode === '11_cogs_total' ||
                      activeTaxDrillDownCode === '20_gross_profit' ||
                      activeTaxDrillDownCode === '51_estimated_tax') && (
                      <div className="space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                          <div className="font-bold text-slate-800">
                            Bảng kê chi tiết từng hóa đơn cấu thành [Mã {activeTaxLineItem.code}] (Nhấp vào
                            bất kỳ hóa đơn nào để mở phiếu gốc kiểm tra):
                          </div>
                          {onNavigateToModule && (
                            <button
                              type="button"
                              onClick={() => onNavigateToModule('sales')}
                              className="px-3 py-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-lg inline-flex items-center gap-1.5 self-start"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>Mở Nhật ký Bán hàng gốc</span>
                            </button>
                          )}
                        </div>

                        <div className="overflow-x-auto rounded-lg border border-slate-200">
                          <table className="w-full min-w-[1040px] text-left border-collapse text-xs">
                            <thead>
                              <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-700">
                                <th className="py-2.5 px-3 whitespace-nowrap">Ngày HĐ</th>
                                <th className="py-2.5 px-3 whitespace-nowrap">Mã HĐ (Bấm xem)</th>
                                <th className="py-2.5 px-3 min-w-[160px]">Khách hàng</th>
                                <th className="py-2.5 px-3 min-w-[220px]">Mặt hàng & Quà tặng KM</th>
                                <th className="py-2.5 px-3 text-center whitespace-nowrap">SL</th>
                                <th className="py-2.5 px-3 text-right whitespace-nowrap">
                                  Doanh thu gộp [01]
                                </th>
                                <th className="py-2.5 px-3 text-right whitespace-nowrap">
                                  Giảm giá KM [02]
                                </th>
                                <th className="py-2.5 px-3 text-right whitespace-nowrap">
                                  Doanh thu thuần [10]
                                </th>
                                <th className="py-2.5 px-3 text-right whitespace-nowrap">
                                  Giá vốn Hàng+Quà [11]
                                </th>
                                <th className="py-2.5 px-3 text-right whitespace-nowrap">
                                  Lợi nhuận gộp [20]
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                              {(activeTaxDrillDownCode === '02_revenue_deduction'
                                ? taxFinancialStatement.saleCogsBreakdown.filter(
                                    (r) => r.discountAmount > 0
                                  )
                                : taxFinancialStatement.saleCogsBreakdown
                              ).map((row) => (
                                <tr
                                  key={`audit_sale_${row.sale.id}`}
                                  onClick={() =>
                                    setDrillDownItem({ type: 'sale', record: row.sale })
                                  }
                                  className="hover:bg-emerald-50/50 cursor-pointer"
                                >
                                  <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                                    {(row.sale.createdAt || '').slice(0, 10)}
                                  </td>
                                  <td className="py-2.5 px-3 font-mono font-bold text-emerald-800 underline whitespace-nowrap">
                                    {row.sale.invoiceCode}
                                  </td>
                                  <td className="py-2.5 px-3 font-semibold text-slate-900">
                                    {row.sale.customerName}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <div className="font-medium text-slate-900">
                                      {row.sale.productName}
                                    </div>
                                    <div className="text-[11px] text-slate-500 font-mono">
                                      Giá vốn nhập: {formatVND(row.unitImportCost)}/{row.sale.unit}
                                      {row.giftCogsAmount > 0 &&
                                        ` · Quà KM: ${row.sale.giftQuantity} ${row.sale.giftUnit || ''} ${
                                          row.sale.giftProductName || ''
                                        } (Vốn: ${formatVND(row.giftCogsAmount)})`}
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 text-center font-mono whitespace-nowrap">
                                    {row.sale.quantity} {row.sale.unit}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                                    {formatVND(row.grossAmountBeforeDiscount)}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-amber-800 whitespace-nowrap">
                                    {row.discountAmount > 0
                                      ? `-${formatVND(row.discountAmount)}`
                                      : '0 đ'}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900 whitespace-nowrap">
                                    {formatVND(row.netRevenueAmount)}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                                    {formatVND(row.totalCogsAmount)}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-emerald-700 whitespace-nowrap">
                                    {row.grossProfitAmount >= 0
                                      ? `+${formatVND(row.grossProfitAmount)}`
                                      : formatVND(row.grossProfitAmount)}{' '}
                                    ({row.grossMarginPct}%)
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="bg-emerald-50/90 border-t-2 border-emerald-300 font-extrabold text-slate-900">
                                <td colSpan={5} className="py-3 px-3 text-right">
                                  TỔNG CỘNG ĐỐI CHIẾU KHỚP BÁO CÁO TÀI CHÍNH:
                                </td>
                                <td className="py-3 px-3 text-right font-mono">
                                  {formatVND(taxFinancialStatement.grossRevenue01)}
                                </td>
                                <td className="py-3 px-3 text-right font-mono text-amber-800">
                                  -{formatVND(taxFinancialStatement.revenueDeduction02)}
                                </td>
                                <td className="py-3 px-3 text-right font-mono text-emerald-900">
                                  {formatVND(taxFinancialStatement.netRevenue10)}
                                </td>
                                <td className="py-3 px-3 text-right font-mono text-slate-800">
                                  {formatVND(taxFinancialStatement.totalCogs11)}
                                </td>
                                <td className="py-3 px-3 text-right font-mono text-emerald-800">
                                  {formatVND(taxFinancialStatement.grossProfit20)}
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* CASE 2: Operating Expenses [Mã 24] */}
                    {activeTaxDrillDownCode === '24_operating_expenses' && (
                      <div className="space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                          <div className="font-bold text-slate-800">
                            Danh sách từng Phiếu Chi vận hành cấu thành [Mã 24 - Chi phí bán hàng & vận
                            hành] (Tổng: {formatVND(taxFinancialStatement.operatingExpenses24)}):
                          </div>
                          {onNavigateToModule && (
                            <button
                              type="button"
                              onClick={() => onNavigateToModule('payment_vouchers')}
                              className="px-3 py-1.5 text-xs font-bold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-lg inline-flex items-center gap-1.5 self-start"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>Mở Nhật ký Phiếu chi tiền</span>
                            </button>
                          )}
                        </div>

                        {taxFinancialStatement.operatingPaymentVouchers.length === 0 ? (
                          <div className="p-4 text-xs text-slate-600 bg-slate-50 rounded-lg border border-slate-200">
                            Không có phiếu chi vận hành nào trong kỳ ({fromDate} → {toDate}).
                          </div>
                        ) : (
                          <div className="overflow-x-auto rounded-lg border border-slate-200">
                            <table className="w-full min-w-[780px] text-left border-collapse text-xs">
                              <thead>
                                <tr className="bg-amber-50 border-b border-amber-200 font-bold text-amber-950">
                                  <th className="py-2.5 px-3">Ngày chi</th>
                                  <th className="py-2.5 px-3">Mã phiếu chi</th>
                                  <th className="py-2.5 px-3">Nhóm phiếu chi</th>
                                  <th className="py-2.5 px-3">Đối tác / Người nhận</th>
                                  <th className="py-2.5 px-3">Hình thức</th>
                                  <th className="py-2.5 px-3">Ghi chú diễn giải</th>
                                  <th className="py-2.5 px-3 text-right">Số tiền chi [Mã 24]</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200">
                                {taxFinancialStatement.operatingPaymentVouchers.map((pv) => (
                                  <tr key={pv.id} className="hover:bg-amber-50/40">
                                    <td className="py-2.5 px-3 font-mono">
                                      {(pv.createdAt || '').slice(0, 10)}
                                    </td>
                                    <td className="py-2.5 px-3 font-mono font-bold text-amber-900">
                                      {pv.voucherCode}
                                    </td>
                                    <td className="py-2.5 px-3 font-semibold text-slate-900">
                                      {pv.groupName}
                                    </td>
                                    <td className="py-2.5 px-3">
                                      {pv.partnerName} {pv.partnerPhone ? `(${pv.partnerPhone})` : ''}
                                    </td>
                                    <td className="py-2.5 px-3">{pv.paymentMethod}</td>
                                    <td className="py-2.5 px-3 text-slate-600">{pv.note}</td>
                                    <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-800">
                                      -{formatVND(pv.amount)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}

                    {/* CASE 3: Other Income [Mã 31] */}
                    {activeTaxDrillDownCode === '31_other_income' && (
                      <div className="space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                          <div className="font-bold text-slate-800">
                            Danh sách từng Phiếu Thu khác cấu thành [Mã 31 - Thu nhập khác / Thưởng chiết
                            khấu NCC] (Tổng: +{formatVND(taxFinancialStatement.otherIncome31)}):
                          </div>
                          {onNavigateToModule && (
                            <button
                              type="button"
                              onClick={() => onNavigateToModule('receipt_vouchers')}
                              className="px-3 py-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-lg inline-flex items-center gap-1.5 self-start"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>Mở Nhật ký Phiếu thu tiền</span>
                            </button>
                          )}
                        </div>

                        {taxFinancialStatement.otherIncomeReceiptVouchers.length === 0 ? (
                          <div className="p-4 text-xs text-slate-600 bg-slate-50 rounded-lg border border-slate-200">
                            Không có phiếu thu nhập khác nào trong kỳ ({fromDate} → {toDate}).
                          </div>
                        ) : (
                          <div className="overflow-x-auto rounded-lg border border-slate-200">
                            <table className="w-full min-w-[780px] text-left border-collapse text-xs">
                              <thead>
                                <tr className="bg-emerald-50 border-b border-emerald-200 font-bold text-emerald-950">
                                  <th className="py-2.5 px-3">Ngày thu</th>
                                  <th className="py-2.5 px-3">Mã phiếu thu</th>
                                  <th className="py-2.5 px-3">Nhóm phiếu thu</th>
                                  <th className="py-2.5 px-3">Đối tác / Người nộp</th>
                                  <th className="py-2.5 px-3">Hình thức</th>
                                  <th className="py-2.5 px-3">Ghi chú diễn giải</th>
                                  <th className="py-2.5 px-3 text-right">Số tiền thu [Mã 31]</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200">
                                {taxFinancialStatement.otherIncomeReceiptVouchers.map((rv) => (
                                  <tr key={rv.id} className="hover:bg-emerald-50/40">
                                    <td className="py-2.5 px-3 font-mono">
                                      {(rv.createdAt || '').slice(0, 10)}
                                    </td>
                                    <td className="py-2.5 px-3 font-mono font-bold text-emerald-800">
                                      {rv.voucherCode}
                                    </td>
                                    <td className="py-2.5 px-3 font-semibold text-slate-900">
                                      {rv.groupName}
                                    </td>
                                    <td className="py-2.5 px-3">
                                      {rv.partnerName} {rv.partnerPhone ? `(${rv.partnerPhone})` : ''}
                                    </td>
                                    <td className="py-2.5 px-3">{rv.paymentMethod}</td>
                                    <td className="py-2.5 px-3 text-slate-600">{rv.note}</td>
                                    <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700">
                                      +{formatVND(rv.amount)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}

                    {/* CASE 4: Composite Profit Reconciliation (Mã 30, Mã 50, Mã 60) */}
                    {(activeTaxDrillDownCode === '30_operating_profit' ||
                      activeTaxDrillDownCode === '50_profit_before_tax' ||
                      activeTaxDrillDownCode === '60_profit_after_tax') && (
                      <div className="space-y-4 text-xs">
                        <div className="font-bold text-slate-900">
                          Bảng đối chiếu công thức tính Lợi nhuận kế toán [Mã 30 → Mã 50 → Mã 60] (Bấm vào
                          từng thành phần để mở chứng từ gốc):
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
                            <div className="font-bold text-slate-800">
                              Bước 1: Lợi nhuận gộp bán hàng [Mã 20]
                            </div>
                            <div className="flex justify-between">
                              <span>Doanh thu thuần [Mã 10]:</span>
                              <strong className="font-mono">
                                {formatVND(taxFinancialStatement.netRevenue10)}
                              </strong>
                            </div>
                            <div className="flex justify-between">
                              <span>Trừ Giá vốn hàng + quà [Mã 11]:</span>
                              <strong className="font-mono text-amber-800">
                                -{formatVND(taxFinancialStatement.totalCogs11)}
                              </strong>
                            </div>
                            <div className="flex justify-between pt-1 border-t border-slate-200 font-bold text-emerald-800">
                              <span>= Lợi nhuận gộp [Mã 20]:</span>
                              <span className="font-mono">
                                {formatVND(taxFinancialStatement.grossProfit20)}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setActiveTaxDrillDownCode('20_gross_profit')}
                              className="text-[11px] font-bold text-emerald-700 underline pt-1"
                            >
                              Kiểm tra {taxFinancialStatement.saleCogsBreakdown.length} hóa đơn bán →
                            </button>
                          </div>

                          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
                            <div className="font-bold text-slate-800">
                              Bước 2: Lợi nhuận trước thuế [Mã 50]
                            </div>
                            <div className="flex justify-between">
                              <span>Trừ Chi phí vận hành [Mã 24]:</span>
                              <strong className="font-mono text-amber-800">
                                -{formatVND(taxFinancialStatement.operatingExpenses24)}
                              </strong>
                            </div>
                            <div className="flex justify-between">
                              <span>Cộng Thu nhập khác [Mã 31]:</span>
                              <strong className="font-mono text-emerald-700">
                                +{formatVND(taxFinancialStatement.otherIncome31)}
                              </strong>
                            </div>
                            <div className="flex justify-between pt-1 border-t border-slate-200 font-bold text-emerald-900">
                              <span>= Lợi nhuận trước thuế [Mã 50]:</span>
                              <span className="font-mono">
                                {formatVND(taxFinancialStatement.profitBeforeTax50)}
                              </span>
                            </div>
                            <div className="flex gap-3 pt-1">
                              <button
                                type="button"
                                onClick={() => setActiveTaxDrillDownCode('24_operating_expenses')}
                                className="text-[11px] font-bold text-amber-800 underline"
                              >
                                Xem Phiếu chi [24] →
                              </button>
                              <button
                                type="button"
                                onClick={() => setActiveTaxDrillDownCode('31_other_income')}
                                className="text-[11px] font-bold text-emerald-700 underline"
                              >
                                Xem Phiếu thu [31] →
                              </button>
                            </div>
                          </div>

                          <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 space-y-1.5">
                            <div className="font-bold text-emerald-950">
                              Bước 3: Lợi nhuận sau thuế [Mã 60]
                            </div>
                            <div className="flex justify-between">
                              <span>Tổng LN trước thuế [Mã 50]:</span>
                              <strong className="font-mono">
                                {formatVND(taxFinancialStatement.profitBeforeTax50)}
                              </strong>
                            </div>
                            <div className="flex justify-between">
                              <span>Trừ Thuế tham chiếu ({taxRatePct}%) [Mã 51]:</span>
                              <strong className="font-mono text-amber-800">
                                -{formatVND(taxFinancialStatement.estimatedTax51)}
                              </strong>
                            </div>
                            <div className="flex justify-between pt-1 border-t border-emerald-200 font-extrabold text-emerald-900">
                              <span>= Lợi nhuận sau thuế [Mã 60]:</span>
                              <span className="font-mono">
                                {formatVND(taxFinancialStatement.profitAfterTax60)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* CASE 5: Cash & Cashflow Statement [Mã 110] */}
                    {activeTaxDrillDownCode === '110_cash_and_equivalents' && (
                      <div className="space-y-3 text-xs">
                        <div className="font-bold text-slate-900">
                          Đối chiếu Lưu chuyển dòng tiền thực thu - thực chi trong kỳ [Mã 110 — Mẫu B03-DN]:
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200">
                            <div className="text-slate-600">1. Tổng dòng tiền Thực Thu (+)</div>
                            <div className="text-base font-extrabold font-mono text-emerald-800 mt-1">
                              +{formatVND(taxFinancialStatement.totalCashInflow)}
                            </div>
                            <div className="text-[11px] text-slate-600 mt-1">
                              Gồm thu bán hàng & thu nợ ({formatVND(cashflowFinancial.salesPaidInflow)}) +
                              Phiếu thu khác ({formatVND(cashflowFinancial.otherReceiptInflow)})
                            </div>
                          </div>
                          <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200">
                            <div className="text-slate-600">2. Tổng dòng tiền Thực Chi (-)</div>
                            <div className="text-base font-extrabold font-mono text-amber-800 mt-1">
                              -{formatVND(taxFinancialStatement.totalCashOutflow)}
                            </div>
                            <div className="text-[11px] text-slate-600 mt-1">
                              Gồm chi trả nhập hàng NCC ({formatVND(cashflowFinancial.importsPaidOutflow)})
                              + Phiếu chi vận hành ({formatVND(cashflowFinancial.operatingPaymentOutflow)})
                            </div>
                          </div>
                          <div className="p-3.5 rounded-lg bg-slate-900 text-white">
                            <div className="text-slate-300">
                              3. Lưu chuyển tiền thuần [Mã 110 = Thu - Chi]
                            </div>
                            <div className="text-base font-extrabold font-mono text-emerald-400 mt-1">
                              {formatVND(taxFinancialStatement.netCashflow110)}
                            </div>
                            <button
                              type="button"
                              onClick={() => setActiveCategory('cashflow_treasury')}
                              className="text-[11px] font-bold text-emerald-300 underline mt-1 inline-block"
                            >
                              Mở sổ chi tiết Thu - Chi Dòng Tiền (Mục 7) →
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* CASE 6: Customer Receivables [Mã 131] */}
                    {activeTaxDrillDownCode === '131_customer_receivables' && (
                      <div className="space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                          <div className="font-bold text-slate-800">
                            Bảng kê chi tiết các hóa đơn Khách hàng còn nợ cấu thành [Mã 131 - Phải thu
                            khách hàng] (Tổng: {formatVND(taxFinancialStatement.customerReceivables131)}):
                          </div>
                          {onNavigateToModule && (
                            <button
                              type="button"
                              onClick={() => onNavigateToModule('debts')}
                              className="px-3 py-1.5 text-xs font-bold text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-300 rounded-lg inline-flex items-center gap-1.5 self-start"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>Mở Quản lý Công nợ gốc</span>
                            </button>
                          )}
                        </div>

                        {taxFinancialStatement.unpaidSalesInPeriod.length === 0 ? (
                          <div className="p-4 text-xs text-slate-600 bg-slate-50 rounded-lg border border-slate-200">
                            Tất cả hóa đơn trong kỳ đã thu đủ 100% (Không còn nợ phải thu khách hàng).
                          </div>
                        ) : (
                          <div className="overflow-x-auto rounded-lg border border-slate-200">
                            <table className="w-full min-w-[820px] text-left border-collapse text-xs">
                              <thead>
                                <tr className="bg-rose-50 border-b border-rose-200 font-bold text-rose-950">
                                  <th className="py-2.5 px-3">Ngày HĐ</th>
                                  <th className="py-2.5 px-3">Mã HĐ (Bấm xem)</th>
                                  <th className="py-2.5 px-3">Khách hàng</th>
                                  <th className="py-2.5 px-3">Mặt hàng</th>
                                  <th className="py-2.5 px-3 text-right">Tổng tiền HĐ</th>
                                  <th className="py-2.5 px-3 text-right">Đã thanh toán</th>
                                  <th className="py-2.5 px-3 text-right">Còn nợ phải thu [Mã 131]</th>
                                  <th className="py-2.5 px-3 text-center">Hạn thanh toán</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200">
                                {taxFinancialStatement.unpaidSalesInPeriod.map((s) => (
                                  <tr
                                    key={`131_${s.id}`}
                                    onClick={() => setDrillDownItem({ type: 'sale', record: s })}
                                    className="hover:bg-rose-50/40 cursor-pointer"
                                  >
                                    <td className="py-2.5 px-3 font-mono">
                                      {(s.createdAt || '').slice(0, 10)}
                                    </td>
                                    <td className="py-2.5 px-3 font-mono font-bold text-emerald-800 underline">
                                      {s.invoiceCode}
                                    </td>
                                    <td className="py-2.5 px-3 font-semibold text-slate-900">
                                      {s.customerName} ({s.customerPhone})
                                    </td>
                                    <td className="py-2.5 px-3">
                                      {s.productName} ({s.quantity} {s.unit})
                                    </td>
                                    <td className="py-2.5 px-3 text-right font-mono">
                                      {formatVND(s.totalAmount)}
                                    </td>
                                    <td className="py-2.5 px-3 text-right font-mono text-emerald-700">
                                      {formatVND(s.paidAmount)}
                                    </td>
                                    <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-700">
                                      {formatVND(s.debtAmount)}
                                    </td>
                                    <td className="py-2.5 px-3 text-center font-mono">{s.dueDate}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}

                    {/* CASE 7: Inventory Valuation [Mã 156] */}
                    {activeTaxDrillDownCode === '156_inventory_assets' && (
                      <div className="space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                          <div className="font-bold text-slate-800">
                            Bảng kê chi tiết Hàng tồn kho cuối kỳ theo giá vốn nhập kho cấu thành [Mã 156]
                            (Tổng giá trị tồn kho: {formatVND(taxFinancialStatement.inventoryValue156)}):
                          </div>
                          {onNavigateToModule && (
                            <button
                              type="button"
                              onClick={() => onNavigateToModule('inventory')}
                              className="px-3 py-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-lg inline-flex items-center gap-1.5 self-start"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>Mở Quản lý Tồn kho gốc</span>
                            </button>
                          )}
                        </div>

                        <div className="overflow-x-auto rounded-lg border border-slate-200">
                          <table className="w-full min-w-[820px] text-left border-collapse text-xs">
                            <thead>
                              <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-800">
                                <th className="py-2.5 px-3">Mã VT (Bấm xem)</th>
                                <th className="py-2.5 px-3">Tên vật tư nông nghiệp</th>
                                <th className="py-2.5 px-3">Nhóm hàng</th>
                                <th className="py-2.5 px-3">Kho lưu trữ</th>
                                <th className="py-2.5 px-3 text-center">Số lượng tồn</th>
                                <th className="py-2.5 px-3 text-right">Đơn giá vốn nhập</th>
                                <th className="py-2.5 px-3 text-right">
                                  Thành tiền giá trị tồn [Mã 156]
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                              {taxFinancialStatement.inventoryValuationRows.map((row) => (
                                <tr
                                  key={`156_${row.product.id}`}
                                  onClick={() =>
                                    setDrillDownItem({ type: 'product', record: row.product })
                                  }
                                  className="hover:bg-emerald-50/40 cursor-pointer"
                                >
                                  <td className="py-2.5 px-3 font-mono font-bold text-emerald-800 underline">
                                    {row.product.code}
                                  </td>
                                  <td className="py-2.5 px-3 font-semibold text-slate-900">
                                    {row.product.name}
                                  </td>
                                  <td className="py-2.5 px-3">{row.product.category}</td>
                                  <td className="py-2.5 px-3">
                                    {row.product.warehouseName || 'Tâm An Mỹ Ngãi'}
                                  </td>
                                  <td className="py-2.5 px-3 text-center font-mono font-bold">
                                    {row.stockQuantity} {row.product.unit}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono">
                                    {formatVND(row.unitImportCost)}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-800">
                                    {formatVND(row.totalInventoryCostValue)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* CASE 8: Supplier Payables [Mã 331] */}
                    {activeTaxDrillDownCode === '331_supplier_payables' && (
                      <div className="space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                          <div className="font-bold text-slate-800">
                            Bảng kê các phiếu nhập kho còn nợ Nhà cung cấp cấu thành [Mã 331 - Phải trả
                            người bán] (Tổng: {formatVND(taxFinancialStatement.supplierPayables331)}):
                          </div>
                          {onNavigateToModule && (
                            <button
                              type="button"
                              onClick={() => onNavigateToModule('imports')}
                              className="px-3 py-1.5 text-xs font-bold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-lg inline-flex items-center gap-1.5 self-start"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>Mở Nhật ký Nhập hàng gốc</span>
                            </button>
                          )}
                        </div>

                        {taxFinancialStatement.unpaidImportsInPeriod.length === 0 ? (
                          <div className="p-4 text-xs text-slate-600 bg-slate-50 rounded-lg border border-slate-200">
                            Không có phiếu nhập kho nào còn nợ Nhà cung cấp trong kỳ.
                          </div>
                        ) : (
                          <div className="overflow-x-auto rounded-lg border border-slate-200">
                            <table className="w-full min-w-[820px] text-left border-collapse text-xs">
                              <thead>
                                <tr className="bg-amber-50 border-b border-amber-200 font-bold text-amber-950">
                                  <th className="py-2.5 px-3">Ngày nhập</th>
                                  <th className="py-2.5 px-3">Mã phiếu (Bấm xem)</th>
                                  <th className="py-2.5 px-3">Nhà cung cấp</th>
                                  <th className="py-2.5 px-3">Vật tư nhập</th>
                                  <th className="py-2.5 px-3 text-right">Tổng tiền nhập</th>
                                  <th className="py-2.5 px-3 text-right">Đã trả NCC</th>
                                  <th className="py-2.5 px-3 text-right">Còn nợ NCC [Mã 331]</th>
                                  <th className="py-2.5 px-3 text-center">Hạn trả</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200">
                                {taxFinancialStatement.unpaidImportsInPeriod.map((imp) => (
                                  <tr
                                    key={`331_${imp.id}`}
                                    onClick={() => setDrillDownItem({ type: 'import', record: imp })}
                                    className="hover:bg-amber-50/40 cursor-pointer"
                                  >
                                    <td className="py-2.5 px-3 font-mono">
                                      {(imp.createdAt || '').slice(0, 10)}
                                    </td>
                                    <td className="py-2.5 px-3 font-mono font-bold text-amber-900 underline">
                                      {imp.receiptCode}
                                    </td>
                                    <td className="py-2.5 px-3 font-semibold text-slate-900">
                                      {imp.supplierName}
                                    </td>
                                    <td className="py-2.5 px-3">
                                      {imp.productName} ({imp.quantity} {imp.unit})
                                    </td>
                                    <td className="py-2.5 px-3 text-right font-mono">
                                      {formatVND(imp.totalCost)}
                                    </td>
                                    <td className="py-2.5 px-3 text-right font-mono text-emerald-700">
                                      {formatVND(imp.paidAmount)}
                                    </td>
                                    <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-800">
                                      {formatVND(imp.debtAmount)}
                                    </td>
                                    <td className="py-2.5 px-3 text-center font-mono">
                                      {imp.dueDate}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}

                    {/* CASE 9: Net Working Capital & Net Assets [Mã 400] */}
                    {activeTaxDrillDownCode === '400_net_working_capital' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                        <button
                          type="button"
                          onClick={() => setActiveTaxDrillDownCode('110_cash_and_equivalents')}
                          className="p-3.5 text-left rounded-lg bg-slate-50 hover:bg-emerald-50 border border-slate-200"
                        >
                          <div className="font-bold text-slate-700">
                            1. Dòng tiền thuần [Mã 110] (+)
                          </div>
                          <div className="text-sm font-extrabold font-mono text-emerald-800 mt-1">
                            {formatVND(taxFinancialStatement.netCashflow110)}
                          </div>
                          <div className="text-[11px] text-emerald-700 underline mt-1">
                            Bấm xem chi tiết Thu - Chi →
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveTaxDrillDownCode('131_customer_receivables')}
                          className="p-3.5 text-left rounded-lg bg-slate-50 hover:bg-emerald-50 border border-slate-200"
                        >
                          <div className="font-bold text-slate-700">
                            2. Phải thu Khách hàng [Mã 131] (+)
                          </div>
                          <div className="text-sm font-extrabold font-mono text-rose-700 mt-1">
                            +{formatVND(taxFinancialStatement.customerReceivables131)}
                          </div>
                          <div className="text-[11px] text-emerald-700 underline mt-1">
                            Bấm xem {taxFinancialStatement.unpaidSalesInPeriod.length} đơn KH nợ →
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveTaxDrillDownCode('156_inventory_assets')}
                          className="p-3.5 text-left rounded-lg bg-slate-50 hover:bg-emerald-50 border border-slate-200"
                        >
                          <div className="font-bold text-slate-700">
                            3. Hàng tồn kho [Mã 156] (+)
                          </div>
                          <div className="text-sm font-extrabold font-mono text-emerald-800 mt-1">
                            +{formatVND(taxFinancialStatement.inventoryValue156)}
                          </div>
                          <div className="text-[11px] text-emerald-700 underline mt-1">
                            Bấm xem {taxFinancialStatement.inventoryValuationRows.length} vật tư →
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveTaxDrillDownCode('331_supplier_payables')}
                          className="p-3.5 text-left rounded-lg bg-amber-50/70 hover:bg-amber-100/70 border border-amber-200"
                        >
                          <div className="font-bold text-amber-950">
                            4. Trừ Nợ phải trả NCC [Mã 331] (-)
                          </div>
                          <div className="text-sm font-extrabold font-mono text-amber-800 mt-1">
                            -{formatVND(taxFinancialStatement.supplierPayables331)}
                          </div>
                          <div className="text-[11px] text-amber-900 underline mt-1">
                            Bấm xem {taxFinancialStatement.unpaidImportsInPeriod.length} phiếu nợ NCC →
                          </div>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

        {!isPrimaryAdmin &&
          activeCategory === 'financial_profit' &&
          allowedCategories.includes('financial_profit') && (
            <WarehouseCashbookReportPanel
              warehouseLabel={effectiveWarehouseLabel}
              fromDate={fromDate}
              toDate={toDate}
              onChangeDateRange={(from, to) => {
                setFromDate(from);
                setToDate(to);
              }}
              searchQuery={reportSearch}
              onChangeSearchQuery={setReportSearch}
              summary={provisionalCashbookSummary}
              onExportExcel={handleExportComprehensiveExcel}
              onExportPDF={handleExportComprehensivePDF}
              onSelectSale={(sale) => setDrillDownItem({ type: 'sale', record: sale })}
              onNavigateToModule={onNavigateToModule}
            />
          )}

        {/* Section: Tự Động Đề Xuất Các Báo Cáo Phù Hợp & Tốt Nhất */}
        <div className="bg-white p-4 sm:p-6 rounded-xl border border-emerald-200 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="text-xs font-bold text-emerald-800 uppercase tracking-wide flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>Hệ Thống Tự Động Phân Tích</span>
              </div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900 mt-0.5">
                Đề Xuất Các Báo Cáo Phù Hợp &amp; Tốt Nhất ({fromDate} → {toDate})
              </h3>
            </div>
            <span className="px-2.5 py-1 text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg self-start sm:self-auto">
              {smartRecommendations.length} đề xuất trọng tâm trong kỳ
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {smartRecommendations.map((rec) => (
              <div
                key={rec.id}
                className={`p-4 rounded-xl border space-y-2 flex flex-col justify-between ${
                  rec.priority === 'high'
                    ? 'bg-red-50/40 border-red-200'
                    : rec.priority === 'medium'
                    ? 'bg-amber-50/40 border-amber-200'
                    : 'bg-slate-50/70 border-slate-200'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <Lightbulb
                        className={`w-4 h-4 shrink-0 ${
                          rec.priority === 'high'
                            ? 'text-red-600'
                            : rec.priority === 'medium'
                            ? 'text-amber-600'
                            : 'text-emerald-700'
                        }`}
                      />
                      <span className="text-xs font-bold text-slate-900">{rec.title}</span>
                    </div>
                    <span
                      className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded shrink-0 ${
                        rec.priority === 'high'
                          ? 'bg-red-100 text-red-800'
                          : rec.priority === 'medium'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {rec.priority === 'high'
                        ? 'Ưu tiên khẩn'
                        : rec.priority === 'medium'
                        ? 'Quan trọng'
                        : 'Đề xuất tốt nhất'}
                    </span>
                  </div>

                  <p className="text-xs text-slate-700 leading-relaxed">{rec.summary}</p>
                  <div className="text-xs font-semibold text-emerald-900 bg-white/80 p-2 rounded-lg border border-slate-200/80">
                    <strong>Đề xuất hành động:</strong> {rec.suggestedAction}
                  </div>
                </div>

                <div className="pt-2 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (allowedCategories.includes(rec.category)) {
                        setActiveCategory(rec.category);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }
                    }}
                    className="px-3 py-1.5 text-xs font-bold text-emerald-800 bg-white border border-emerald-300 hover:bg-emerald-50 rounded-lg flex items-center gap-1"
                  >
                    <span>Mở bảng báo cáo chi tiết</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={handleExportComprehensiveExcel}
                    className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 underline"
                  >
                    Xuất tệp
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom Report Export Bar (Moved to bottom of page) */}
        <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs font-semibold text-slate-700">
            Xuất tệp báo cáo tổng hợp ({fromDate} → {toDate}):
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportComprehensiveExcel}
              className="px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <FileSpreadsheet className="w-4 h-4 shrink-0" />
              <span>Xuất Báo Cáo Tổng Hợp (Excel .xlsx)</span>
            </button>

            <button
              type="button"
              onClick={handleExportComprehensivePDF}
              className="px-3.5 py-2 text-xs font-bold text-slate-900 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <FileText className="w-4 h-4 text-red-600 shrink-0" />
              <span>Xuất Báo Cáo (PDF .pdf)</span>
            </button>
          </div>
        </div>

        {/* Modal: Kiểm tra chi tiết chứng từ / mặt hàng khi nhấp vào bất kỳ dòng nào trong Báo cáo */}
        {drillDownItem && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2.5 sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Kiểm tra chi tiết mục trong báo cáo"
          >
            <div className="bg-white rounded-xl border border-slate-200 w-full max-w-lg max-h-[calc(100dvh-1.25rem)] flex flex-col overflow-hidden shadow-xl">
              <div className="px-4 sm:px-6 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
                <div>
                  <div className="text-[11px] font-bold text-emerald-800 uppercase">
                    Liên Kết Kiểm Tra Chi Tiết Mục Trong Báo Cáo
                  </div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 mt-0.5">
                    {drillDownItem.type === 'sale'
                      ? `Hóa đơn Bán hàng: ${drillDownItem.record.invoiceCode}`
                      : drillDownItem.type === 'import'
                      ? `Phiếu Nhập kho: ${drillDownItem.record.receiptCode}`
                      : drillDownItem.type === 'product'
                      ? `Vật tư Tồn kho: [${drillDownItem.record.code}] ${drillDownItem.record.name}`
                      : `Khách hàng: ${drillDownItem.record.name}`}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setDrillDownItem(null)}
                  aria-label="Đóng cửa sổ chi tiết báo cáo"
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 sm:p-6 space-y-3 overflow-y-auto flex-1 text-xs">
                {drillDownItem.type === 'sale' && (
                  <div className="space-y-2.5">
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5">
                      <div>
                        Mã hóa đơn:{' '}
                        <strong className="font-mono text-slate-900">
                          {drillDownItem.record.invoiceCode}
                        </strong>{' '}
                        · Ngày lập:{' '}
                        <span className="font-mono">
                          {drillDownItem.record.createdAt.slice(0, 10)}
                        </span>
                      </div>
                      <div>
                        Khách hàng:{' '}
                        <strong className="text-slate-900">
                          {drillDownItem.record.customerName}
                        </strong>{' '}
                        ({drillDownItem.record.customerPhone})
                      </div>
                      <div>
                        Kho xuất bán:{' '}
                        <strong className="text-emerald-800">
                          {drillDownItem.record.warehouseName || 'Tâm An Mỹ Ngãi'}
                        </strong>{' '}
                        · Nhân viên: {drillDownItem.record.staffName}
                      </div>
                    </div>

                    <div className="p-3 bg-emerald-50/50 rounded-lg border border-emerald-200 space-y-1.5">
                      <div className="font-bold text-slate-900">
                        Mặt hàng đã nhận: {drillDownItem.record.productName}
                      </div>
                      <div className="font-mono">
                        Số lượng: {drillDownItem.record.quantity} {drillDownItem.record.unit} ×{' '}
                        {formatVND(drillDownItem.record.unitPrice)} ={' '}
                        <strong>
                          {formatVND(drillDownItem.record.quantity * drillDownItem.record.unitPrice)}
                        </strong>
                      </div>
                      {(drillDownItem.record.discountAmount || 0) > 0 && (
                        <div className="font-mono text-amber-800">
                          Giảm giá bán khuyến mãi:{' '}
                          <strong>-{formatVND(drillDownItem.record.discountAmount || 0)}</strong>
                        </div>
                      )}
                      {(drillDownItem.record.giftQuantity || 0) > 0 &&
                        drillDownItem.record.giftProductName && (
                          <div className="text-emerald-800 font-semibold">
                            Quà tặng khuyến mãi kèm đơn: {drillDownItem.record.giftQuantity}{' '}
                            {drillDownItem.record.giftUnit || 'CÁI'}{' '}
                            {drillDownItem.record.giftProductName} (0 đ)
                          </div>
                        )}
                      <div className="font-mono">
                        Thành tiền thanh toán:{' '}
                        <strong>{formatVND(drillDownItem.record.totalAmount)}</strong>
                      </div>
                      <div className="font-mono text-emerald-700">
                        Đã thanh toán: <strong>{formatVND(drillDownItem.record.paidAmount)}</strong>
                      </div>
                      <div className="font-mono text-red-600 font-bold">
                        Còn nợ: {formatVND(drillDownItem.record.debtAmount)} (Hạn trả:{' '}
                        {drillDownItem.record.dueDate})
                      </div>
                      {drillDownItem.record.note && (
                        <div className="text-slate-600">Ghi chú: {drillDownItem.record.note}</div>
                      )}
                    </div>
                  </div>
                )}

                {drillDownItem.type === 'import' && (
                  <div className="space-y-2.5">
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5">
                      <div>
                        Mã phiếu nhập:{' '}
                        <strong className="font-mono text-slate-900">
                          {drillDownItem.record.receiptCode}
                        </strong>{' '}
                        · Ngày nhập:{' '}
                        <span className="font-mono">
                          {drillDownItem.record.createdAt.slice(0, 10)}
                        </span>
                      </div>
                      <div>
                        Nhà cung cấp:{' '}
                        <strong className="text-slate-900">
                          {drillDownItem.record.supplierName}
                        </strong>{' '}
                        ({drillDownItem.record.supplierPhone})
                      </div>
                      <div>
                        Kho nhập:{' '}
                        <strong className="text-emerald-800">
                          {drillDownItem.record.warehouseName || 'Tâm An Mỹ Ngãi'}
                        </strong>{' '}
                        · Người nhập: {drillDownItem.record.staffName}
                      </div>
                    </div>

                    <div className="p-3 bg-amber-50/50 rounded-lg border border-amber-200 space-y-1.5">
                      <div className="font-bold text-slate-900">
                        Vật tư nhập kho: {drillDownItem.record.productName}
                      </div>
                      <div className="font-mono">
                        Số lượng: {drillDownItem.record.quantity} {drillDownItem.record.unit} ×{' '}
                        {formatVND(drillDownItem.record.unitCost)} ={' '}
                        <strong>{formatVND(drillDownItem.record.totalCost)}</strong>
                      </div>
                      <div className="font-mono text-emerald-700">
                        Đã trả NCC: <strong>{formatVND(drillDownItem.record.paidAmount)}</strong>
                      </div>
                      <div className="font-mono text-red-600 font-bold">
                        Còn nợ NCC: {formatVND(drillDownItem.record.debtAmount)} (Hạn trả:{' '}
                        {drillDownItem.record.dueDate})
                      </div>
                    </div>
                  </div>
                )}

                {drillDownItem.type === 'product' && (
                  <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5">
                    <div>
                      Mã vật tư:{' '}
                      <strong className="font-mono">{drillDownItem.record.code}</strong> · Nhóm:{' '}
                      {drillDownItem.record.category}
                    </div>
                    <div>
                      Tên vật tư:{' '}
                      <strong className="text-slate-900">{drillDownItem.record.name}</strong>
                    </div>
                    <div>
                      Kho lưu trữ:{' '}
                      <strong className="text-emerald-800">
                        {drillDownItem.record.warehouseName || 'Tâm An Mỹ Ngãi'}
                      </strong>
                    </div>
                    <div className="font-mono">
                      Tồn hiện tại: <strong>{drillDownItem.record.stock}</strong>{' '}
                      {drillDownItem.record.unit} (Định mức tối thiểu:{' '}
                      {drillDownItem.record.minStock})
                    </div>
                    <div className="font-mono">
                      Giá nhập: {formatVND(drillDownItem.record.importPrice)} · Giá bán lẻ:{' '}
                      <strong>{formatVND(drillDownItem.record.sellPrice)}</strong>
                    </div>
                  </div>
                )}
              </div>

              <div className="px-4 sm:px-6 py-3 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-end gap-2 shrink-0">
                {drillDownItem.type === 'sale' && (
                  <>
                    <button
                      type="button"
                      onClick={() => exportSaleInvoicePDF(drillDownItem.record)}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg flex items-center gap-1"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>In Hóa Đơn PDF</span>
                    </button>
                    {onNavigateToModule && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            const rec = drillDownItem.record;
                            setDrillDownItem(null);
                            onNavigateToModule('sales', rec.id);
                          }}
                          className="px-3 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg flex items-center gap-1"
                        >
                          <span>Mở Nhật ký Bán</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                        {drillDownItem.record.debtAmount > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              const rec = drillDownItem.record;
                              setDrillDownItem(null);
                              onNavigateToModule('debts', rec.id);
                            }}
                            className="px-3 py-1.5 text-xs font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg flex items-center gap-1"
                          >
                            <span>Công nợ KH</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {drillDownItem.record.productId && (
                          <button
                            type="button"
                            onClick={() => {
                              const rec = drillDownItem.record;
                              setDrillDownItem(null);
                              onNavigateToModule('inventory', rec.productId);
                            }}
                            className="px-3 py-1.5 text-xs font-semibold text-indigo-900 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg flex items-center gap-1"
                          >
                            <span>Thẻ kho VT</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </>
                )}

                {drillDownItem.type === 'import' && (
                  <>
                    <button
                      type="button"
                      onClick={() => exportImportReceiptPDF(drillDownItem.record)}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg flex items-center gap-1"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>In Phiếu Nhập PDF</span>
                    </button>
                    {onNavigateToModule && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            const rec = drillDownItem.record;
                            setDrillDownItem(null);
                            onNavigateToModule('imports', rec.id);
                          }}
                          className="px-3 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg flex items-center gap-1"
                        >
                          <span>Mở &amp; Sửa/Hủy Phiếu Nhập</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                        {drillDownItem.record.debtAmount > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              const rec = drillDownItem.record;
                              setDrillDownItem(null);
                              onNavigateToModule('debts', rec.id);
                            }}
                            className="px-3 py-1.5 text-xs font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg flex items-center gap-1"
                          >
                            <span>Công nợ NCC</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {drillDownItem.record.productId && (
                          <button
                            type="button"
                            onClick={() => {
                              const rec = drillDownItem.record;
                              setDrillDownItem(null);
                              onNavigateToModule('inventory', rec.productId);
                            }}
                            className="px-3 py-1.5 text-xs font-semibold text-indigo-900 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg flex items-center gap-1"
                          >
                            <span>Thẻ kho VT</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </>
                )}

                {drillDownItem.type === 'product' && onNavigateToModule && (
                  <button
                    type="button"
                    onClick={() => {
                      const rec = drillDownItem.record;
                      setDrillDownItem(null);
                      onNavigateToModule('inventory', rec.id);
                    }}
                    className="px-3.5 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg flex items-center gap-1"
                  >
                    <span>Mở tại Quản lý Tồn kho</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setDrillDownItem(null)}
                  className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Thu nợ tổng hợp các mặt hàng đã nhận trong kỳ (Từ ngày ... Đến ngày ...) */}
        {isBatchCollectOpen && onCollectCustomerDebt && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2.5 sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Thu nợ tổng hợp các mặt hàng còn nợ trong kỳ"
          >
            <div className="bg-white rounded-xl border border-slate-200 w-full max-w-lg max-h-[calc(100dvh-1.25rem)] flex flex-col overflow-hidden shadow-xl">
              <div className="px-4 sm:px-6 py-3.5 border-b border-slate-200 flex items-center justify-between bg-white shrink-0">
                <h3 className="text-sm sm:text-base font-bold text-slate-900">
                  Thu Nợ Tổng Hợp Hàng Đã Nhận ({fromDate} → {toDate})
                </h3>
                <button
                  type="button"
                  onClick={() => setIsBatchCollectOpen(false)}
                  aria-label="Đóng cửa sổ thu nợ tổng hợp"
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1 text-xs">
                <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-lg space-y-1">
                  <div>
                    Đối tượng:{' '}
                    <strong className="text-slate-900">
                      {selectedCustomerObj ? selectedCustomerObj.name : 'Tất cả khách hàng trong kỳ'}
                    </strong>
                  </div>
                  <div>
                    Tổng số mặt hàng còn nợ trong kỳ:{' '}
                    <strong>
                      {receivedItemsReport.items.filter((i) => i.debtAmount > 0).length} mặt hàng
                    </strong>{' '}
                    · Tổng nợ:{' '}
                    <strong className="font-mono text-red-600">
                      {formatVND(receivedItemsReport.totalDebt)}
                    </strong>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="rep-batch-collect-amount"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Số tiền thu nợ đợt này (VNĐ) *
                  </label>
                  <input
                    id="rep-batch-collect-amount"
                    type="number"
                    min={1000}
                    max={receivedItemsReport.totalDebt}
                    value={batchCollectAmount}
                    onChange={(e) => setBatchCollectAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>

                <div>
                  <label
                    htmlFor="rep-batch-collect-note"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Ghi chú thu nợ tổng hợp
                  </label>
                  <input
                    id="rep-batch-collect-note"
                    type="text"
                    value={batchCollectNote}
                    onChange={(e) => setBatchCollectNote(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="px-4 sm:px-6 py-3 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsBatchCollectOpen(false)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const totalToCollect = Math.max(0, Number(batchCollectAmount) || 0);
                    if (totalToCollect <= 0) return;
                    const noteText =
                      batchCollectNote.trim() ||
                      `Thu nợ tổng hợp theo thứ tự ngày nợ kỳ ${fromDate} -> ${toDate}`;

                    if (selectedCustomerObj && onSettleCustomerTotalDebtFifo) {
                      onSettleCustomerTotalDebtFifo({
                        customerId: selectedCustomerObj.id,
                        customerName: selectedCustomerObj.name,
                        customerPhone: selectedCustomerObj.phone,
                        totalAmount: totalToCollect,
                        groupName: 'Thu nợ bán hàng khách hàng',
                        paymentMethod: 'Chuyển khoản ngân hàng',
                        note: noteText,
                      });
                    } else {
                      let remaining = totalToCollect;
                      const unpaidRows = [...receivedItemsReport.items]
                        .filter((i) => i.debtAmount > 0)
                        .sort((a, b) => {
                          const dCmp = a.date.localeCompare(b.date);
                          if (dCmp !== 0) return dCmp;
                          return a.dueDate.localeCompare(b.dueDate);
                        });
                      const batchItems: Array<{ saleId: string; amount: number }> = [];
                      unpaidRows.forEach((row) => {
                        if (remaining <= 0) return;
                        const pay = Math.min(row.debtAmount, remaining);
                        if (pay > 0) {
                          batchItems.push({ saleId: row.saleId, amount: pay });
                          remaining -= pay;
                        }
                      });
                      if (batchItems.length > 0) {
                        if (onCollectCustomerDebtBatch) {
                          onCollectCustomerDebtBatch(batchItems, noteText);
                        } else {
                          batchItems.forEach((item) => {
                            onCollectCustomerDebt(item.saleId, item.amount, noteText);
                          });
                        }
                      }
                    }
                    exportCombinedReceivedItemsAndDebtPDF({
                      customerName: selectedCustomerObj
                        ? selectedCustomerObj.name
                        : 'Khách hàng thanh toán công nợ trong kỳ',
                      customerPhone: selectedCustomerObj?.phone || '',
                      customerAddress: selectedCustomerObj?.address || '',
                      fromDate,
                      toDate,
                      items: receivedItemsReport.items,
                      onlyUnpaid: onlyUnpaidGoods,
                      collectedThisSession: Math.max(0, Number(batchCollectAmount) || 0),
                      staffName: currentStaff.displayName,
                    });
                    setIsBatchCollectOpen(false);
                  }}
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg flex items-center gap-1.5"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Xác Nhận Thu Nợ & In Phiếu Tổng Hợp PDF</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============================================================================
  // VIEW MODE 2: SAO LƯU & LỊCH SỬ THAO TÁC (ĐỘC QUYỀN QUẢN LÝ CHÍNH)
  // ============================================================================
  return (
    <div className="space-y-6">
      {canAccessWarehouseAdminFeatures && (
        <div className="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 space-y-5">
          {/* Backup to Computer, Upload Backup to Restore (connected to Firebase Storage), Fiscal Year Rollover & Full Data Wipe */}
          <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl flex flex-col gap-3">
            <div className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>
                {isPrimaryAdmin
                  ? 'Quản lý chính · Toàn bộ các kho'
                  : `Quản Lý 1 Kho Độc Lập (${currentStaff.assignedWarehouse}) — Đầy Đủ Chức Năng Quản Trị`}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <input
                ref={backupFileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleUploadBackupFileChange}
                className="hidden"
                aria-label="Chọn tệp sao lưu JSON từ máy tính để khôi phục"
              />
              <button
                type="button"
                onClick={() => onDownloadBackupFile()}
                className="w-full sm:w-auto px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors flex items-center justify-center gap-1.5"
              >
                <Download className="w-4 h-4 shrink-0" />
                <span>Tải tệp sao lưu về máy tính (.json)</span>
              </button>
              <button
                type="button"
                onClick={() => backupFileInputRef.current?.click()}
                className="w-full sm:w-auto px-3.5 py-2 text-xs font-bold text-emerald-900 bg-white border border-emerald-300 hover:bg-emerald-100 rounded-lg transition-colors flex items-center justify-center gap-1.5"
              >
                <Upload className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>Đăng tải tệp sao lưu lên để khôi phục</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  fiscalCloseSectionRef.current?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                  });
                  setConfirmFiscalCloseModalOpen(true);
                }}
                className="w-full sm:w-auto px-3.5 py-2 text-xs font-bold text-amber-950 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg transition-colors flex items-center justify-center gap-1.5 text-center leading-snug"
              >
                <Calendar className="w-4 h-4 text-amber-800 shrink-0" />
                <span>Chốt sổ năm tài chính & Xóa dữ liệu cũ đã tất toán</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  fullWipeSectionRef.current?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                  });
                  setConfirmFullWipeModalOpen(true);
                }}
                className="w-full sm:w-auto px-3.5 py-2 text-xs font-bold text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-300 rounded-lg transition-colors flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-4 h-4 text-rose-700 shrink-0" />
                <span>Xóa dữ liệu kinh doanh để nhập lại từ đầu</span>
              </button>
            </div>
          </div>

          {/* MỤC 1 (QUYỀN QUẢN LÝ CHÍNH): CHỐT SỔ NĂM BÁO CÁO TÀI CHÍNH & XÓA DỮ LIỆU CŨ ĐÃ TẤT TOÁN — CHUYỂN TỒN LƯU QUA NĂM TÀI CHÍNH MỚI */}
          <div
            ref={fiscalCloseSectionRef}
            className="p-4 sm:p-5 bg-white border-2 border-amber-200 rounded-xl space-y-4 shadow-sm"
          >
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pb-3 border-b border-slate-200">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 text-xs font-bold text-amber-900 self-start">
                <Calendar className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                <span>
                  Mục 1 ·{' '}
                  {isPrimaryAdmin
                    ? `Quản lý chính (${ADMIN_BACKUP_EMAIL})`
                    : `Quản lý kho (${currentStaff.assignedWarehouse})`}
                  : Chốt Sổ Năm Báo Cáo Tài Chính &amp; Kết Chuyển Tồn Lưu Sang Năm Mới
                </span>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2 shrink-0 bg-amber-50/70 p-3 rounded-lg border border-amber-200">
                <label
                  htmlFor="select-fiscal-year-close"
                  className="text-xs font-bold text-slate-800 whitespace-nowrap"
                >
                  Chọn năm đã chốt báo cáo tài chính:
                </label>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedFiscalYearToClose((prev) => Math.max(2020, prev - 1))
                    }
                    className="px-2.5 py-2 text-xs font-bold text-amber-950 bg-white hover:bg-amber-100 border border-amber-300 rounded-lg shrink-0"
                    title="Lùi 1 năm"
                  >
                    -1 năm
                  </button>
                  <select
                    id="select-fiscal-year-close"
                    value={selectedFiscalYearToClose}
                    onChange={(e) => setSelectedFiscalYearToClose(Number(e.target.value))}
                    className="w-full sm:w-auto px-3 py-2 text-xs font-bold text-slate-900 bg-white border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-600"
                  >
                    {availableFiscalYears.map((yr) => (
                      <option key={yr} value={yr}>
                        Năm {yr} → Chuyển tồn lưu qua {yr + 1}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setSelectedFiscalYearToClose((prev) => prev + 1)}
                    className="px-2.5 py-2 text-xs font-bold text-amber-950 bg-white hover:bg-amber-100 border border-amber-300 rounded-lg shrink-0"
                    title="Tăng sang năm tiếp theo (2028, 2029, 2030...)"
                  >
                    +1 năm
                  </button>
                </div>
              </div>
            </div>

            {/* Mandatory Reminder to Save Backup Before Deleting Old Year Data */}
            <div className="p-3.5 bg-amber-50/90 border border-amber-300 rounded-lg flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="space-y-1.5 text-xs min-w-0">
                <div className="font-bold text-amber-950 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>
                    Nhắc lưu dữ liệu trước khi xóa dữ liệu năm {selectedFiscalYearToClose}:
                  </span>
                </div>
                <label className="inline-flex items-start sm:items-center gap-2 font-semibold text-emerald-900 cursor-pointer leading-snug">
                  <input
                    type="checkbox"
                    checked={autoBackupBeforeFiscalClose}
                    onChange={(e) => setAutoBackupBeforeFiscalClose(e.target.checked)}
                    className="w-4 h-4 mt-0.5 sm:mt-0 accent-emerald-700 rounded cursor-pointer shrink-0"
                  />
                  <span>
                    Tự động tải tệp sao lưu (.json) của năm {selectedFiscalYearToClose} về máy tính
                    trước khi xóa & chuyển sổ sang năm {fiscalYearClosePreview.newFiscalYear}
                  </span>
                </label>
              </div>

              <button
                type="button"
                onClick={() => onDownloadBackupFile()}
                className="w-full lg:w-auto px-3.5 py-2 text-xs font-bold text-emerald-950 bg-white hover:bg-emerald-50 border border-emerald-400 rounded-lg flex items-center justify-center gap-1.5 text-center leading-snug shrink-0"
              >
                <Download className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                <span>Tải tệp sao lưu năm {selectedFiscalYearToClose} trước khi xóa (.json)</span>
              </button>
            </div>

            {/* 2-Column Comparison: What Will Be Cleaned vs. What Will Be Carried Forward to New Fiscal Year */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
              {/* Column 1: Settled Data to Delete */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5">
                <div className="font-bold text-rose-800 flex items-center justify-between gap-2 pb-1.5 border-b border-slate-200">
                  <span>
                    1. Dữ liệu cũ năm ≤ {selectedFiscalYearToClose} đã tất toán SẼ XÓA LÀM SẠCH
                  </span>
                  <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-mono text-[11px] shrink-0">
                    Xóa {fiscalYearClosePreview.totalRecordsToDelete} chứng từ
                  </span>
                </div>
                <ul className="space-y-1.5 text-slate-700">
                  <li className="flex items-center justify-between gap-2">
                    <span>• Phiếu xuất bán hàng đã hết công nợ KH:</span>
                    <strong className="font-mono text-slate-900 text-right">
                      {fiscalYearClosePreview.settledSalesToDelete.length} phiếu (
                      {formatVND(fiscalYearClosePreview.settledSalesRevenueTotal)})
                    </strong>
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span>• Phiếu nhập kho hàng hóa đã hết công nợ NCC:</span>
                    <strong className="font-mono text-slate-900 text-right">
                      {fiscalYearClosePreview.settledImportsToDelete.length} phiếu (
                      {formatVND(fiscalYearClosePreview.settledImportsCostTotal)})
                    </strong>
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span>• Nhật ký Phiếu thu tiền đã chốt sổ năm {selectedFiscalYearToClose}:</span>
                    <strong className="font-mono text-slate-900 text-right">
                      {fiscalYearClosePreview.receiptVouchersToDelete.length} phiếu (
                      {formatVND(fiscalYearClosePreview.deletedReceiptVouchersAmountTotal)})
                    </strong>
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span>• Nhật ký Phiếu chi tiền đã chốt sổ năm {selectedFiscalYearToClose}:</span>
                    <strong className="font-mono text-slate-900 text-right">
                      {fiscalYearClosePreview.paymentVouchersToDelete.length} phiếu (
                      {formatVND(fiscalYearClosePreview.deletedPaymentVouchersAmountTotal)})
                    </strong>
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span>• Phiếu chứng từ in đã lưu năm {selectedFiscalYearToClose}:</span>
                    <strong className="font-mono text-slate-900 text-right">
                      {fiscalYearClosePreview.savedVouchersToDelete.length} phiếu
                    </strong>
                  </li>
                </ul>
              </div>

              {/* Column 2: Carry-Over Opening Balances into New Fiscal Year */}
              <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-lg space-y-2.5">
                <div className="font-bold text-emerald-950 flex items-center justify-between gap-2 pb-1.5 border-b border-emerald-200">
                  <span>
                    2. Dữ liệu tồn lưu cũ ĐƯA QUA SỔ NĂM TÀI CHÍNH MỚI (
                    {fiscalYearClosePreview.newFiscalYear})
                  </span>
                  <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-mono text-[11px] shrink-0">
                    Số dư đầu kỳ {fiscalYearClosePreview.newFiscalYear}
                  </span>
                </div>
                <ul className="space-y-1.5 text-slate-700">
                  <li className="flex items-center justify-between gap-2">
                    <span>• Tồn kho vật tư chuyển sang đầu kỳ năm mới:</span>
                    <strong className="font-mono text-emerald-900 text-right">
                      {fiscalYearClosePreview.carriedInventoryCount} mặt hàng (
                      {fiscalYearClosePreview.carriedInventoryTotalUnits} ĐVT ·{' '}
                      {formatVND(fiscalYearClosePreview.carriedInventoryTotalValue)})
                    </strong>
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span>• Công nợ Khách hàng còn lại chuyển sang năm mới:</span>
                    <strong className="font-mono text-rose-700 text-right">
                      {fiscalYearClosePreview.carriedCustomerDebtCount} hóa đơn còn nợ (
                      {formatVND(fiscalYearClosePreview.carriedCustomerDebtTotal)})
                    </strong>
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span>• Công nợ Nhà cung cấp còn lại chuyển sang năm mới:</span>
                    <strong className="font-mono text-amber-800 text-right">
                      {fiscalYearClosePreview.carriedSupplierDebtCount} phiếu nhập còn nợ (
                      {formatVND(fiscalYearClosePreview.carriedSupplierDebtTotal)})
                    </strong>
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span>• Danh mục Khách hàng, Nhà cung cấp & Kho:</span>
                    <strong className="font-mono text-emerald-900 text-right">
                      Giữ nguyên 100% ({customers.length} KH)
                    </strong>
                  </li>
                </ul>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setConfirmFiscalCloseModalOpen(true)}
                className="w-full sm:w-auto px-4 py-2.5 text-xs font-bold text-white bg-amber-700 hover:bg-amber-800 rounded-lg transition-colors flex items-center justify-center gap-1.5 text-center leading-snug shadow-sm"
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  Thực hiện Chốt sổ năm {selectedFiscalYearToClose} · Xóa dữ liệu cũ đã tất toán &
                  Chuyển tồn lưu qua năm {fiscalYearClosePreview.newFiscalYear}
                </span>
              </button>
            </div>
          </div>

          {/* MỤC 2 (QUYỀN QUẢN LÝ CHÍNH): XÓA TOÀN BỘ DỮ LIỆU ỨNG DỤNG (LÀM SẠCH TOÀN BỘ HỆ THỐNG) */}
          <div
            ref={fullWipeSectionRef}
            className="p-4 sm:p-5 bg-rose-50/50 border-2 border-rose-200 rounded-xl"
          >
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-100 border border-rose-200 text-xs font-bold text-rose-900 self-start">
                <Trash2 className="w-3.5 h-3.5 text-rose-700 shrink-0" />
                <span>
                  Mục 2 ·{' '}
                  {isPrimaryAdmin
                    ? `Quản lý chính (${ADMIN_BACKUP_EMAIL}): Xóa Dữ Liệu Kinh Doanh Toàn Hệ Thống`
                    : `Quản lý kho (${currentStaff.assignedWarehouse}): Xóa Toàn Bộ Dữ Liệu Kho ${currentStaff.assignedWarehouse}`}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => onDownloadBackupFile()}
                  className="w-full sm:w-auto px-3.5 py-2 text-xs font-bold text-emerald-900 bg-white hover:bg-emerald-50 border border-emerald-300 rounded-lg flex items-center justify-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                  <span>Lưu tệp sao lưu trước khi xóa (.json)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmFullWipeModalOpen(true)}
                  className="w-full sm:w-auto px-4 py-2 text-xs font-bold text-white bg-rose-700 hover:bg-rose-800 rounded-lg flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Xóa dữ liệu kinh doanh</span>
                </button>
              </div>
            </div>
          </div>

          {/* Backup History: Mobile Card View (< md) */}
          <div className="md:hidden divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
            {backups.map((bk) => (
              <div key={bk.id} className="p-4 space-y-2.5 hover:bg-slate-50 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-mono font-bold text-slate-900 break-all">{bk.fileName}</div>
                  <span className="px-2 py-0.5 text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md shrink-0">
                    Hoàn tất
                  </span>
                </div>

                <div className="text-slate-600 space-y-0.5">
                  <div>
                    Gmail nhận: <span className="font-mono text-slate-800">{bk.targetEmail}</span>
                  </div>
                  <div>
                    Loại:{' '}
                    <span>
                      {bk.triggerType === 'auto_daily' ? 'Tự động hàng ngày' : 'Sao lưu thủ công'}
                    </span>{' '}
                    · Thời gian:{' '}
                    <span className="font-mono">
                      {bk.createdAt.replace('T', ' ').slice(0, 16)}
                    </span>
                  </div>
                  <div>
                    Dữ liệu lưu:{' '}
                    <strong className="font-mono text-slate-900">{bk.recordCount} bản ghi</strong> +{' '}
                    <strong className="font-mono text-emerald-800">
                      {bk.auditLogCount ?? auditLogs.length} bước lịch sử thao tác
                    </strong>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onDownloadBackupFile(bk)}
                      className="px-2.5 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md flex items-center gap-1"
                    >
                      <Download className="w-3.5 h-3.5 shrink-0" />
                      <span>Tải về máy</span>
                    </button>
                    {bk.snapshotPayload && (
                      <button
                        type="button"
                        onClick={() => setPendingRestorePayload(bk.snapshotPayload!)}
                        className="px-2.5 py-1.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-md flex items-center gap-1"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                        <span>Khôi phục</span>
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setConfirmDeleteBackup(bk)}
                    aria-label={`Xóa bản sao lưu ${bk.fileName}`}
                    className="p-1.5 text-slate-400 hover:text-red-600 rounded-md border border-slate-200"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Backup History: Desktop Balanced Table (>= md) */}
          <div className="hidden md:block overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full min-w-[940px] text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                  <th className="py-2.5 px-3.5 min-w-[235px]">Tên tệp sao lưu</th>
                  <th className="py-2.5 px-3.5 min-w-[180px]">Gmail nhận</th>
                  <th className="py-2.5 px-3.5 whitespace-nowrap w-[140px]">Loại & Trạng thái</th>
                  <th className="py-2.5 px-3.5 text-right whitespace-nowrap w-[160px]">Bản ghi & Lịch sử</th>
                  <th className="py-2.5 px-3.5 whitespace-nowrap w-[135px]">Thời gian</th>
                  <th className="py-2.5 px-3.5 text-right whitespace-nowrap w-[170px]">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {backups.map((bk) => (
                  <tr key={bk.id} className="hover:bg-slate-50">
                    <td className="py-3 px-3.5 font-mono font-medium text-slate-900 min-w-[235px] align-middle">
                      {bk.fileName}
                    </td>
                    <td className="py-3 px-3.5 font-mono text-slate-700 min-w-[180px] align-middle">
                      {bk.targetEmail}
                    </td>
                    <td className="py-3 px-3.5 text-slate-600 whitespace-nowrap align-middle">
                      {bk.triggerType === 'auto_daily' ? 'Tự động' : 'Thủ công'}
                      <span className="mx-1" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-emerald-700 font-medium">Hoàn tất</span>
                    </td>
                    <td className="py-3 px-3.5 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap align-middle">
                      <span className="font-semibold">{bk.recordCount} bản ghi</span>
                      <span className="mx-1 text-slate-400">·</span>
                      <span className="text-emerald-800 font-semibold">
                        {bk.auditLogCount ?? auditLogs.length} thao tác
                      </span>
                    </td>
                    <td className="py-3 px-3.5 font-mono text-slate-500 whitespace-nowrap align-middle">
                      {bk.createdAt.replace('T', ' ').slice(0, 16)}
                    </td>
                    <td className="py-3 px-3.5 text-right whitespace-nowrap align-middle">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onDownloadBackupFile(bk)}
                          title="Tải tệp sao lưu này về máy tính (.json)"
                          className="px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md flex items-center gap-1 whitespace-nowrap"
                        >
                          <Download className="w-3.5 h-3.5 shrink-0" />
                          <span>Tải về máy</span>
                        </button>
                        {bk.snapshotPayload && (
                          <button
                            type="button"
                            onClick={() => setPendingRestorePayload(bk.snapshotPayload!)}
                            title="Khôi phục dữ liệu theo tệp sao lưu này"
                            className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md flex items-center gap-1 whitespace-nowrap"
                          >
                            <RotateCcw className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                            <span>Khôi phục</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteBackup(bk)}
                          aria-label={`Xóa bản sao lưu ${bk.fileName}`}
                          className="p-1.5 text-slate-400 hover:text-red-600 rounded-md"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Operation Audit Log (Lịch sử các thao tác đã thực hiện) */}
      {canAccessWarehouseAdminFeatures && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-50/60">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-emerald-700 shrink-0" />
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                {isPrimaryAdmin
                  ? 'Giám Sát Lịch Sử Thao Tác Hệ Thống'
                  : `Lịch Sử Thao Tác Kho Độc Lập (${currentStaff.assignedWarehouse})`}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-1 text-xs font-semibold bg-red-50 text-red-700 border border-red-200 rounded-lg whitespace-nowrap">
                {deleteAuditCount} thao tác xóa đã ghi bằng chứng
              </span>
              <span className="px-2.5 py-1 text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 rounded-lg whitespace-nowrap">
                {editAuditCount} thao tác chỉnh sửa
              </span>
              <button
                type="button"
                onClick={() => onDownloadBackupFile()}
                className="px-3 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg flex items-center gap-1.5 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span>Tải Sao Lưu Kèm Lịch Sử (.json)</span>
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="px-4 sm:px-6 pt-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { id: 'all', label: `Tất cả (${auditLogs.length})` },
                  { id: 'delete_record', label: `Xóa phiếu / dữ liệu (${deleteAuditCount})` },
                  { id: 'edit_record', label: `Chỉnh sửa (${editAuditCount})` },
                  { id: 'create_record', label: 'Tạo mới' },
                  { id: 'debt_settlement', label: 'Thu / Trả nợ' },
                  { id: 'permission_change', label: 'Phân quyền [X]' },
                  { id: 'backup_restore', label: 'Sao lưu & Khôi phục' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() =>
                      setAuditCategoryFilter(tab.id as 'all' | AuditActionCategory)
                    }
                    className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap ${
                      auditCategoryFilter === tab.id
                        ? 'bg-emerald-700 text-white border-emerald-700'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="relative w-full lg:w-72 shrink-0">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={auditSearchQuery}
                  onChange={(e) => setAuditSearchQuery(e.target.value)}
                  placeholder="Tìm nhân viên, mã phiếu HD/PN, kho..."
                  aria-label="Tìm kiếm trong lịch sử thao tác"
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg"
                />
              </div>
            </div>

            <div className="overflow-x-auto border-t border-slate-200">
              <table className="w-full min-w-[1040px] text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-3.5 whitespace-nowrap w-[150px]">Thời gian & Kho</th>
                    <th className="py-3 px-3.5 min-w-[205px]">Tài khoản nhân sự thực hiện</th>
                    <th className="py-3 px-3.5 whitespace-nowrap w-[160px]">Loại thao tác & Mã phiếu</th>
                    <th className="py-3 px-3.5 min-w-[300px]">Chi tiết bước thực hiện (Bằng chứng lưu trữ)</th>
                    <th className="py-3 px-3.5 text-right whitespace-nowrap w-[150px]">
                      Bằng chứng / Khôi phục
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {filteredAuditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-slate-500">
                        Không có bản ghi lịch sử thao tác nào khớp với bộ lọc hiện tại.
                      </td>
                    </tr>
                  ) : (
                    filteredAuditLogs.map((entry) => (
                      <tr
                        key={entry.id}
                        className={
                          entry.category === 'delete_record'
                            ? 'bg-red-50/25 hover:bg-red-50/50'
                            : 'hover:bg-slate-50'
                        }
                      >
                        <td className="py-3.5 px-3.5 whitespace-nowrap align-middle">
                          <div className="font-mono font-semibold text-slate-900">
                            {entry.timestamp.replace('T', ' ').slice(0, 19)}
                          </div>
                          <div className="text-[11px] font-semibold text-emerald-800 mt-0.5 flex items-center gap-1">
                            <Warehouse className="w-3 h-3 shrink-0" />
                            <span>{entry.warehouseName}</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-3.5 align-middle min-w-[205px]">
                          <div className="font-bold text-slate-900 leading-snug">{entry.actorDisplayName}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            <span className="font-mono font-semibold text-emerald-800">
                              @{entry.actorUsername}
                            </span>
                            {entry.actorEmail ? ` · ${entry.actorEmail}` : ''}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{entry.actorRoleLabel}</div>
                        </td>
                        <td className="py-3.5 px-3.5 align-middle whitespace-nowrap">
                          <div>{getCategoryBadge(entry.category)}</div>
                          <div className="font-mono font-bold text-slate-900 mt-1">
                            Mã: {entry.targetCode}
                          </div>
                        </td>
                        <td className="py-3.5 px-3.5 align-middle min-w-[300px]">
                          <div className="font-semibold text-slate-900 leading-snug">{entry.actionTitle}</div>
                          <div className="text-slate-600 mt-0.5 leading-relaxed">
                            {entry.details}
                          </div>
                        </td>
                        <td className="py-3.5 px-3.5 text-right whitespace-nowrap align-middle">
                          <div className="flex flex-col items-end gap-1.5">
                            {entry.snapshotData ? (
                              <button
                                type="button"
                                onClick={() => setInspectingAuditSnapshot(entry)}
                                className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1 whitespace-nowrap"
                              >
                                <Eye className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                                <span>Xem dữ liệu gốc</span>
                              </button>
                            ) : (
                              <span className="text-[11px] text-slate-400">Đã ghi nhận</span>
                            )}

                            {entry.category === 'delete_record' &&
                              entry.snapshotData &&
                              (entry.restoredAt ? (
                                <span className="px-2.5 py-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-1 whitespace-nowrap">
                                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                  <span>Đã khôi phục</span>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => onRestoreDeletedRecordFromAudit(entry)}
                                  className="px-2.5 py-1 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg flex items-center gap-1 whitespace-nowrap"
                                >
                                  <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                                  <span>Khôi phục lại</span>
                                </button>
                              ))}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Section 3: Google Authentication & Role-Based Access Control (RBAC) — Exclusive to Primary Manager */}
      {isPrimaryAdmin && (
        <div className="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 space-y-5">
          <div className="flex flex-col gap-3.5">
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>Đăng nhập Google & Bảng Phân Quyền Nhân Sự Chi Tiết</span>
              </h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Phân quyền chặt chẽ theo đánh dấu [X] thời gian thực: Mỗi nhân viên được chỉ định
                xem và xuất báo cáo đúng theo nhiệm vụ của mình.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => onGoogleLogin('manager')}
                className="inline-flex items-center gap-2.5 px-3.5 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors"
              >
                <span>
                  {isGoogleAuthenticated
                    ? `Đã kết nối Google (${currentUserEmail})`
                    : 'Sign in with Google (Quản lý / Nhân viên)'}
                </span>
              </button>

              <div
                className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg"
                role="group"
                aria-label="Chuyển đổi chế độ phân quyền"
              >
                <button
                  type="button"
                  onClick={() => onSwitchRolePreview('manager')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    role === 'manager'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Chế độ Quản lý
                </button>
                <button
                  type="button"
                  onClick={() => onSwitchRolePreview('staff')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    role === 'staff'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Chế độ Nhân viên
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full min-w-[960px] text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4 min-w-[210px]">Nhân sự & Kho phụ trách</th>
                  <th className="py-3 px-4 whitespace-nowrap w-[195px]">Tài khoản Google (Gmail)</th>
                  <th className="py-3 px-4 min-w-[180px]">Vai trò chức danh</th>
                  <th className="py-3 px-4 min-w-[340px]">
                    Quyền hạn [X] & Mục Báo cáo được chỉ định
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {staffList.map((st) => {
                  const isPrimary = canViewAuditHistory(st);
                  const stScope = evaluateStaffAccessScope(st);
                  const perms =
                    st.permissions && st.permissions.length > 0
                      ? st.permissions
                      : getDefaultPermissionsForPosition(
                          st.positionRole || 'sales_warehouse_staff'
                        );
                  const permLabels = ALL_STAFF_FUNCTIONAL_PERMISSIONS.filter((p) =>
                    perms.includes(p.key)
                  ).map((p) => p.label);

                  return (
                    <tr key={st.uid} className="hover:bg-slate-50">
                      <td className="py-3.5 px-4 min-w-[210px] align-middle">
                        <div className="font-bold text-slate-900 leading-snug">{st.displayName}</div>
                        <div className="text-[11px] text-emerald-800 font-semibold mt-0.5">
                          @{st.username} · Kho: {st.assignedWarehouse}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-700 whitespace-nowrap align-middle">
                        {st.email || '---'}
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-slate-800 min-w-[180px] leading-snug align-middle">
                        {getPositionRoleLabel(st.positionRole)}
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 leading-relaxed min-w-[340px] align-middle">
                        <div>{permLabels.join(' · ')}</div>
                        <div className="text-[11px] font-semibold text-emerald-800 mt-1">
                          Mục báo cáo chỉ định ({stScope.allowedReportCategories.length}):{' '}
                          {stScope.allowedReportCategories
                            .map((c) => REPORT_CATEGORY_META[c].shortLabel)
                            .join(', ')}
                        </div>
                        {isPrimary && (
                          <div className="text-[11px] font-bold text-emerald-900 mt-0.5">
                            ★ Tài khoản Quản lý chính ({ADMIN_BACKUP_EMAIL}): Toàn quyền Sao lưu &
                            Lịch sử thao tác
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Inspect Deleted/Modified Record Snapshot Evidence */}
      {inspectingAuditSnapshot && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2.5 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Chi tiết bằng chứng dữ liệu gốc trong lịch sử thao tác"
        >
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-lg max-h-[calc(100dvh-1.25rem)] flex flex-col overflow-hidden shadow-xl">
            <div className="px-4 sm:px-6 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
              <div className="min-w-0 pr-2">
                <h3 className="text-sm sm:text-base font-bold text-slate-900 truncate">
                  Bằng chứng dữ liệu gốc ({inspectingAuditSnapshot.targetCode})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInspectingAuditSnapshot(null)}
                aria-label="Đóng cửa sổ xem bằng chứng"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-3 overflow-y-auto flex-1 text-xs">
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
                <div className="font-bold text-slate-900">
                  {inspectingAuditSnapshot.actionTitle}
                </div>
                <div className="text-slate-600">{inspectingAuditSnapshot.details}</div>
              </div>
              <pre className="p-3 bg-slate-900 text-emerald-300 font-mono text-[11px] rounded-lg overflow-x-auto">
                {inspectingAuditSnapshot.snapshotData}
              </pre>
            </div>

            <div className="px-4 sm:px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
              {inspectingAuditSnapshot.category === 'delete_record' &&
                !inspectingAuditSnapshot.restoredAt && (
                  <button
                    type="button"
                    onClick={() => {
                      const target = inspectingAuditSnapshot;
                      setInspectingAuditSnapshot(null);
                      onRestoreDeletedRecordFromAudit(target);
                    }}
                    className="px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Khôi phục lại phiếu/dữ liệu này</span>
                  </button>
                )}
              <button
                type="button"
                onClick={() => setInspectingAuditSnapshot(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal before restoring from a Backup File */}
      {pendingRestorePayload && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2.5 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Xác nhận khôi phục dữ liệu từ tệp sao lưu"
        >
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-md flex flex-col overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm sm:text-base font-bold text-slate-900">
                Xác nhận khôi phục dữ liệu từ tệp sao lưu?
              </h3>
              <button
                type="button"
                onClick={() => setPendingRestorePayload(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs text-slate-600">
              <p>
                Khôi phục toàn bộ dữ liệu theo tệp{' '}
                <strong className="font-mono text-slate-900">
                  {pendingRestorePayload.fileName}
                </strong>
                .
              </p>
              <div className="flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setPendingRestorePayload(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const target = pendingRestorePayload;
                    setPendingRestorePayload(null);
                    onRestoreBackupPayload(target);
                  }}
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                >
                  Xác nhận khôi phục ngay
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal before creating Cloud / Firebase Storage backup */}
      {confirmBackupModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2.5 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Xác nhận sao lưu dữ liệu lên hệ thống lưu trữ"
        >
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-md flex flex-col overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm sm:text-base font-bold text-slate-900">
                Xác nhận tạo bản sao lưu dữ liệu?
              </h3>
              <button
                type="button"
                onClick={() => setConfirmBackupModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs text-slate-600">
              <p>
                Tạo tệp sao lưu mới chứa toàn bộ dữ liệu kinh doanh và {auditLogs.length} bản ghi
                lịch sử thao tác trên Firebase Storage ({ADMIN_BACKUP_EMAIL}).
              </p>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmBackupModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDriveUpload}
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                >
                  Xác nhận sao lưu ngay
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal before deleting a backup file */}
      {confirmDeleteBackup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2.5 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Xác nhận xóa tệp sao lưu"
        >
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-md flex flex-col overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm sm:text-base font-bold text-slate-900">
                Xác nhận xóa bản sao lưu?
              </h3>
              <button
                type="button"
                onClick={() => setConfirmDeleteBackup(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs text-slate-600">
              <p>
                Xóa tệp sao lưu{' '}
                <strong className="font-mono text-slate-900">{confirmDeleteBackup.fileName}</strong>
                ?
              </p>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteBackup(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDeleteDriveFile}
                  className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg"
                >
                  Xác nhận xóa
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal: Fiscal Year Rollover & Settled Data Cleanup (Mục 1) */}
      {confirmFiscalCloseModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-2.5 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Xác nhận chốt sổ năm báo cáo tài chính và xóa dữ liệu cũ đã tất toán"
        >
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-xl max-h-[calc(100dvh-1.5rem)] flex flex-col overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-amber-50">
              <div className="flex items-center gap-2 min-w-0">
                <Calendar className="w-4 h-4 text-amber-800 shrink-0" />
                <h3 className="text-sm sm:text-base font-bold text-slate-900 truncate">
                  Xác Nhận Chốt Sổ Năm {selectedFiscalYearToClose} & Chuyển Tồn Lưu Qua Năm{' '}
                  {fiscalYearClosePreview.newFiscalYear}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setConfirmFiscalCloseModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto text-xs text-slate-700">
              <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-lg space-y-2">
                <div className="font-bold text-amber-950 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>
                    Nhắc nhở bắt buộc lưu dữ liệu trước khi xóa dữ liệu năm{' '}
                    {selectedFiscalYearToClose}:
                  </span>
                </div>
                <p className="text-amber-900 leading-relaxed">
                  Hãy đảm bảo bạn đã lưu tệp sao lưu (.json) của năm {selectedFiscalYearToClose}{' '}
                  trước khi xóa. Bạn có thể bấm nút tải tệp sao lưu ngay bên dưới hoặc giữ tùy chọn
                  tự động tải tệp sao lưu khi xác nhận.
                </p>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <label className="inline-flex items-center gap-2 font-bold text-emerald-900 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoBackupBeforeFiscalClose}
                      onChange={(e) => setAutoBackupBeforeFiscalClose(e.target.checked)}
                      className="w-4 h-4 accent-emerald-700 rounded cursor-pointer"
                    />
                    <span>Tự động tải tệp sao lưu (.json) trước khi xóa dữ liệu cũ</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => onDownloadBackupFile()}
                    className="px-3 py-1.5 text-xs font-bold text-emerald-900 bg-white border border-emerald-400 hover:bg-emerald-50 rounded-lg flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                    <span>Tải tệp sao lưu ngay (.json)</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2 bg-slate-50 p-3.5 rounded-lg border border-slate-200">
                <div className="font-bold text-slate-900">
                  Tóm tắt dữ liệu năm ≤ {selectedFiscalYearToClose} sẽ xóa làm sạch (
                  {fiscalYearClosePreview.totalRecordsToDelete} chứng từ):
                </div>
                <ul className="space-y-1 text-slate-600">
                  <li>
                    • Hóa đơn xuất bán hàng đã hết công nợ KH:{' '}
                    <strong className="text-slate-900">
                      {fiscalYearClosePreview.settledSalesToDelete.length} phiếu
                    </strong>
                  </li>
                  <li>
                    • Phiếu nhập hàng hóa đã hết công nợ NCC:{' '}
                    <strong className="text-slate-900">
                      {fiscalYearClosePreview.settledImportsToDelete.length} phiếu
                    </strong>
                  </li>
                  <li>
                    • Phiếu thu tiền & Phiếu chi tiền năm {selectedFiscalYearToClose}:{' '}
                    <strong className="text-slate-900">
                      {fiscalYearClosePreview.receiptVouchersToDelete.length} phiếu thu ·{' '}
                      {fiscalYearClosePreview.paymentVouchersToDelete.length} phiếu chi
                    </strong>
                  </li>
                  <li>
                    • Chứng từ in đã lưu năm {selectedFiscalYearToClose}:{' '}
                    <strong className="text-slate-900">
                      {fiscalYearClosePreview.savedVouchersToDelete.length} phiếu
                    </strong>
                  </li>
                </ul>
              </div>

              <div className="space-y-2 bg-emerald-50/80 p-3.5 rounded-lg border border-emerald-200">
                <div className="font-bold text-emerald-950">
                  Tồn lưu năm {selectedFiscalYearToClose} chuyển qua sổ đầu kỳ năm tài chính mới{' '}
                  {fiscalYearClosePreview.newFiscalYear}:
                </div>
                <ul className="space-y-1 text-emerald-900">
                  <li>
                    • Tồn kho vật tư giữ nguyên chuyển sang năm mới:{' '}
                    <strong>
                      {fiscalYearClosePreview.carriedInventoryCount} mặt hàng (
                      {fiscalYearClosePreview.carriedInventoryTotalUnits} ĐVT · Giá trị tồn:{' '}
                      {formatVND(fiscalYearClosePreview.carriedInventoryTotalValue)})
                    </strong>
                  </li>
                  <li>
                    • Công nợ Khách hàng còn lại chuyển sang năm mới:{' '}
                    <strong>
                      {fiscalYearClosePreview.carriedCustomerDebtCount} hóa đơn còn nợ (
                      {formatVND(fiscalYearClosePreview.carriedCustomerDebtTotal)})
                    </strong>
                  </li>
                  <li>
                    • Công nợ Nhà cung cấp còn lại chuyển sang năm mới:{' '}
                    <strong>
                      {fiscalYearClosePreview.carriedSupplierDebtCount} phiếu nhập còn nợ (
                      {formatVND(fiscalYearClosePreview.carriedSupplierDebtTotal)})
                    </strong>
                  </li>
                </ul>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmFiscalCloseModalOpen(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={() => {
                  const closedYear = selectedFiscalYearToClose;
                  setConfirmFiscalCloseModalOpen(false);
                  onExecuteFiscalYearCloseAndCleanup?.(
                    closedYear,
                    autoBackupBeforeFiscalClose
                  );
                  setSelectedFiscalYearToClose(closedYear + 1);
                }}
                className="px-4 py-2 text-xs font-bold text-white bg-amber-700 hover:bg-amber-800 rounded-lg flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  Xác nhận xóa dữ liệu cũ năm {selectedFiscalYearToClose} & Chuyển tồn lưu qua năm{' '}
                  {fiscalYearClosePreview.newFiscalYear}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal: Full Application Data Wipe (Mục 2) */}
      {confirmFullWipeModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-2.5 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Xác nhận xóa toàn bộ dữ liệu ứng dụng"
        >
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-lg max-h-[calc(100dvh-1.5rem)] flex flex-col overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-rose-50">
              <div className="flex items-center gap-2 min-w-0">
                <Trash2 className="w-4 h-4 text-rose-700 shrink-0" />
                <h3 className="text-sm sm:text-base font-bold text-rose-950 truncate">
                  Xóa Dữ Liệu Kinh Doanh Để Nhập Lại Từ Đầu?
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setConfirmFullWipeModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto text-xs text-slate-700">
              <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-lg space-y-2">
                <div className="font-bold text-amber-950 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>Nhắc lưu dữ liệu trước khi xóa toàn bộ:</span>
                </div>
                <p className="text-amber-900 leading-relaxed">
                  Thao tác này sẽ xóa vĩnh viễn trên <strong>tất cả các kho</strong> (Realtime Database
                  + Firestore cũ): danh mục vật tư ({products.length}), hồ sơ khách hàng (
                  {customers.length}), nhà cung cấp, hóa đơn bán hàng ({sales.length}), phiếu nhập kho (
                  {imports.length}), phiếu thu ({receiptVouchers.length}), phiếu chi (
                  {paymentVouchers.length}), phiếu kiểm kê và chứng từ in. Vui lòng lưu tệp sao lưu (.json)
                  về máy tính trước khi xóa.
                </p>
                <div className="p-2.5 bg-emerald-50 border border-emerald-300 rounded-md text-emerald-950 leading-relaxed">
                  <strong>GIỮ NGUYÊN:</strong> tài khoản nhân viên &amp; phân quyền, danh sách kho, mẫu ghi
                  chú sản phẩm, cấu hình VietQR, lịch sử thao tác và các bản sao lưu.
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <label className="inline-flex items-center gap-2 font-bold text-emerald-900 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoBackupBeforeFullWipe}
                      onChange={(e) => setAutoBackupBeforeFullWipe(e.target.checked)}
                      className="w-4 h-4 accent-emerald-700 rounded cursor-pointer"
                    />
                    <span>Tự động tải tệp sao lưu (.json) về máy tính ngay trước khi xóa</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => onDownloadBackupFile()}
                    className="px-3 py-1.5 text-xs font-bold text-emerald-900 bg-white border border-emerald-400 hover:bg-emerald-50 rounded-lg flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                    <span>Tải tệp sao lưu ngay (.json)</span>
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-rose-900">
                  Gõ chính xác cụm <span className="font-mono">XOA DU LIEU</span> để mở khóa nút xóa:
                </label>
                <input
                  type="text"
                  value={wipeConfirmPhrase}
                  onChange={(e) => setWipeConfirmPhrase(e.target.value)}
                  placeholder="XOA DU LIEU"
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-rose-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setConfirmFullWipeModalOpen(false);
                  setWipeConfirmPhrase('');
                }}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={wipeConfirmPhrase.trim().toUpperCase() !== 'XOA DU LIEU'}
                onClick={() => {
                  setConfirmFullWipeModalOpen(false);
                  setWipeConfirmPhrase('');
                  void onExecuteFullApplicationDataWipe?.(autoBackupBeforeFullWipe);
                }}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-700 hover:bg-rose-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg flex items-center gap-1.5"
              >
                <Trash2 className="w-4 h-4 shrink-0" />
                <span>Xác nhận xóa dữ liệu kinh doanh</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

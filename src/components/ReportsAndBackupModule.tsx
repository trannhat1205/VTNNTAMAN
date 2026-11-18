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
  computeReceivedItemsAndDebtReport,
  evaluateDebtUrgency,
  evaluateStaffAccessScope,
  evaluateStockAlert,
  formatVND,
  generateSmartReportRecommendations,
  getDefaultPermissionsForPosition,
  getPositionRoleLabel,
  isDateWithinRange,
  normalizeVietnameseSearch,
  parseAndValidateBackupPayload,
} from '../utils/businessLogic';
import {
  exportCombinedReceivedItemsAndDebtExcel,
  exportCombinedReceivedItemsAndDebtPDF,
  exportComprehensiveDateRangeReportExcel,
  exportComprehensiveDateRangeReportPDF,
  exportImportReceiptPDF,
  exportSaleInvoicePDF,
} from '../utils/exportReports';

export type ReportsOrBackupViewMode = 'reports' | 'backup_history';

interface ReportsAndBackupModuleProps {
  mode?: ReportsOrBackupViewMode;
  role: UserRole;
  currentStaff: StaffMember;
  isGoogleAuthenticated: boolean;
  currentUserEmail: string | null;
  products: ProductItem[];
  customers: CustomerProfile[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
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
  onGoogleLogin: (role: UserRole) => Promise<void>;
  onSwitchRolePreview: (role: UserRole) => void;
  onNotifyToast: (message: string) => void;
  onCollectCustomerDebt?: (saleId: string, amount: number, note: string) => void;
  onPaySupplierDebt?: (importId: string, amount: number, note: string) => void;
  onNavigateToModule?: (
    tab: 'sales' | 'imports' | 'inventory' | 'customers' | 'debts' | 'vouchers',
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
  role,
  currentStaff,
  isGoogleAuthenticated,
  currentUserEmail,
  products,
  customers,
  sales,
  imports,
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
  onNavigateToModule,
}) => {
  // Exclusive check: ONLY trannhat1205@gmail.com (or 0393120246) can view audit history, backup & financial profit
  const isPrimaryAdmin = canViewAuditHistory(currentStaff);
  const accessScope = useMemo(() => evaluateStaffAccessScope(currentStaff), [currentStaff]);
  const allowedCategories = accessScope.allowedReportCategories;

  // Date range state (Từ ngày ... Đến ngày ...)
  const [fromDate, setFromDate] = useState<string>('2026-11-01');
  const [toDate, setToDate] = useState<string>('2026-11-30');
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

  // Ensure activeCategory is always within the staff member's allowedReportCategories
  useEffect(() => {
    if (!allowedCategories.includes(activeCategory)) {
      setActiveCategory(allowedCategories[0] || 'overview');
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
        fromDate,
        toDate,
      }),
    [currentStaff, products, customers, sales, imports, fromDate, toDate]
  );

  // Date-range KPI calculations
  const totalRevenue = salesInRange.reduce((sum, s) => sum + s.totalAmount, 0);
  const totalCollected = salesInRange.reduce((sum, s) => sum + s.paidAmount, 0);
  const totalCustomerDebt = salesInRange.reduce((sum, s) => sum + s.debtAmount, 0);
  const totalImportCost = importsInRange.reduce((sum, i) => sum + i.totalCost, 0);
  const totalPaidSupplier = importsInRange.reduce((sum, i) => sum + i.paidAmount, 0);
  const totalSupplierDebt = importsInRange.reduce((sum, i) => sum + i.debtAmount, 0);
  const netCashflow = totalCollected - totalPaidSupplier;

  const estimatedGrossProfit = useMemo(() => {
    return salesInRange.reduce((sum, sale) => {
      const prod = products.find((p) => p.id === sale.productId);
      const cost = (prod ? prod.importPrice : sale.unitPrice * 0.85) * sale.quantity;
      return sum + (sale.totalAmount - cost);
    }, 0);
  }, [salesInRange, products]);

  const totalCOGS = Math.max(0, Math.round(totalRevenue - estimatedGrossProfit));
  const profitMarginPct =
    totalRevenue > 0 ? Math.round((estimatedGrossProfit / totalRevenue) * 100) : 0;

  const handleExportComprehensiveExcel = () => {
    const fileName = exportComprehensiveDateRangeReportExcel({
      fromDate,
      toDate,
      staffName: currentStaff.displayName,
      staffRoleLabel: getPositionRoleLabel(currentStaff.positionRole),
      warehouseLabel: currentStaff.assignedWarehouse || 'Tất cả kho',
      allowedCategories,
      products: filteredProducts,
      customers: filteredCustomers,
      sales: salesInRange,
      imports: importsInRange,
      savedVouchers,
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
      warehouseLabel: currentStaff.assignedWarehouse || 'Tất cả kho',
      allowedCategories,
      products: filteredProducts,
      customers: filteredCustomers,
      sales: salesInRange,
      imports: importsInRange,
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
    if (!isPrimaryAdmin) {
      onNotifyToast(
        `Chỉ tài khoản Quản lý chính (${ADMIN_BACKUP_EMAIL}) mới có quyền khôi phục dữ liệu từ tệp sao lưu.`
      );
      return;
    }

    try {
      const rawText = await file.text();
      const validated = parseAndValidateBackupPayload(rawText);
      if (!validated.ok) {
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
          <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 text-xs font-bold bg-emerald-700 text-white rounded-md">
                  TRUNG TÂM BÁO CÁO CHUYÊN SÂU
                </span>
                <span className="px-2.5 py-0.5 text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-md">
                  Người lập: {currentStaff.displayName} (@{currentStaff.username}) · Kho:{' '}
                  {currentStaff.assignedWarehouse}
                </span>
              </div>
              <h2 className="text-base sm:text-xl font-bold text-slate-900">
                Báo Cáo Tổng Hợp & Kiểm Tra Chi Tiết Từ Ngày {fromDate} Đến Ngày {toDate}
              </h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                {isPrimaryAdmin
                  ? 'Tài khoản Quản lý chính (trannhat1205@gmail.com): Toàn quyền xem, kiểm tra liên kết chi tiết và xuất tất cả 8 phân hệ báo cáo (bao gồm Báo cáo Tài chính & Lợi nhuận gộp).'
                  : `Tài khoản Nhân sự (${getPositionRoleLabel(
                      currentStaff.positionRole
                    )}): Được chỉ định xem và xuất ${
                      allowedCategories.length
                    } mục báo cáo tương ứng với nhiệm vụ quản lý để báo cáo kịp thời lên cấp trên.`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleExportComprehensiveExcel}
                className="px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Xuất Báo Cáo Tổng Hợp (Excel .xlsx)</span>
              </button>

              <button
                type="button"
                onClick={handleExportComprehensivePDF}
                className="px-3.5 py-2 text-xs font-bold text-slate-900 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <FileText className="w-4 h-4 text-red-600" />
                <span>Xuất Báo Cáo Cấp Trên (PDF .pdf)</span>
              </button>
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
                    placeholder="Gõ mã HĐ-2611..., PN-2611..., tên vật tư, tên khách hàng..."
                    className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-900"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-600 mr-1">Chọn nhanh kỳ:</span>
                {[
                  { label: 'Hôm nay (16/11)', from: '2026-11-16', to: '2026-11-16' },
                  { label: '7 ngày gần nhất', from: '2026-11-10', to: '2026-11-18' },
                  { label: 'Tháng 11/2026', from: '2026-11-01', to: '2026-11-30' },
                  { label: 'Quý 4/2026', from: '2026-10-01', to: '2026-12-31' },
                  { label: 'Toàn bộ lịch sử', from: '2025-01-01', to: '2027-12-31' },
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

              <div className="text-xs text-slate-500">
                Nhấp trực tiếp vào bất kỳ dòng/mã nào bên dưới để <strong>Xem & Kiểm tra chi tiết</strong>
              </div>
            </div>
          </div>

          {/* Designated Report Category Tabs for the Logged-in Account */}
          <div className="space-y-2">
            <div className="text-xs font-bold text-slate-700 flex items-center justify-between">
              <span>
                Danh mục báo cáo được chỉ định theo phân quyền của tài khoản ({allowedCategories.length} mục):
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {allowedCategories.map((catKey) => {
                const meta = REPORT_CATEGORY_META[catKey];
                const isActive = activeCategory === catKey;
                return (
                  <button
                    key={catKey}
                    type="button"
                    onClick={() => setActiveCategory(catKey)}
                    className={`px-3 py-2 text-xs font-bold rounded-lg border transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                      isActive
                        ? 'bg-emerald-700 text-white border-emerald-700 shadow-2xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-emerald-50 hover:border-emerald-200'
                    }`}
                  >
                    <span>{meta.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Section: Tự Động Đề Xuất Các Báo Cáo Phù Hợp & Tốt Nhất Theo Nhiệm Vụ Cần Có */}
        <div className="bg-white p-4 sm:p-6 rounded-xl border border-emerald-200 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="text-xs font-bold text-emerald-800 uppercase tracking-wide flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>Hệ Thống Tự Động Phân Tích & Viết Đề Xuất Báo Cáo Cấp Trên</span>
              </div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900 mt-0.5">
                Đề Xuất Các Báo Cáo Phù Hợp & Tốt Nhất Theo Nhu Cầu Quản Lý ({fromDate} → {toDate})
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
                    <strong>Đề xuất hành động & báo cáo cấp trên:</strong> {rec.suggestedAction}
                  </div>
                </div>

                <div className="pt-2 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (allowedCategories.includes(rec.category)) {
                        setActiveCategory(rec.category);
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
                    Xuất tệp gửi Quản lý
                  </button>
                </div>
              </div>
            ))}
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
                    <span>Doanh thu Bán hàng ({salesInRange.length} đơn)</span>
                    <ShoppingCart className="w-4 h-4 text-emerald-700" />
                  </div>
                  <div className="text-lg font-bold font-mono text-slate-900">
                    {formatVND(totalRevenue)}
                  </div>
                  <div className="text-xs text-emerald-700 font-semibold flex items-center gap-1 pt-1">
                    <span>Đã thu: {formatVND(totalCollected)} · Xem chi tiết →</span>
                  </div>
                </div>
              )}

              {allowedCategories.includes('imports_log') && (
                <div
                  onClick={() => setActiveCategory('imports_log')}
                  className="bg-white p-4 rounded-xl border border-slate-200 hover:border-emerald-400 cursor-pointer transition-colors space-y-1"
                >
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Giá trị Nhập hàng ({importsInRange.length} phiếu)</span>
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

              {isPrimaryAdmin && allowedCategories.includes('financial_profit') && (
                <div
                  onClick={() => setActiveCategory('financial_profit')}
                  className="bg-emerald-50/70 p-4 rounded-xl border border-emerald-200 hover:border-emerald-500 cursor-pointer transition-colors space-y-1 sm:col-span-2"
                >
                  <div className="flex items-center justify-between text-xs font-semibold text-emerald-900">
                    <span>Báo cáo Tài chính & Lợi nhuận gộp (Độc quyền Quản lý chính)</span>
                    <ShieldCheck className="w-4 h-4 text-emerald-700" />
                  </div>
                  <div className="text-lg font-bold font-mono text-emerald-800">
                    Lợi nhuận gộp: {formatVND(estimatedGrossProfit)} (Tỷ suất: {profitMarginPct}%)
                  </div>
                  <div className="text-xs text-emerald-800 font-semibold flex items-center gap-1 pt-1">
                    <span>Giá vốn ước tính: {formatVND(totalCOGS)} · Xem phân tích tài chính chi tiết →</span>
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
              <div className="p-4 sm:p-6 border-b border-slate-200 bg-emerald-50/40 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-bold text-emerald-800 uppercase tracking-wide flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-emerald-700" />
                    <span>
                      Báo Cáo Các Mặt Hàng Đã Nhận & Còn Nợ Thu Nợ (Từ ngày {fromDate} đến ngày{' '}
                      {toDate})
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-slate-900 mt-0.5">
                    Danh Sách Tổng Hợp Tất Cả Các Mặt Hàng Khách Đã Nhận & Phiếu Tổng Hợp Chung
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Nhấp vào bất kỳ mã hóa đơn hoặc mặt hàng nào trong bảng để kiểm tra chi tiết, thu nợ tổng hợp hoặc xuất Phiếu tổng hợp chung (PDF & Excel).
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleExportReceivedItemsPDF}
                    className="px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Printer className="w-4 h-4" />
                    <span>In Phiếu Tổng Hợp Hàng Đã Nhận (PDF)</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleExportReceivedItemsExcel}
                    className="px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
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
                      <Wallet className="w-4 h-4 text-amber-800" />
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
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
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
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
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
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-200 font-semibold text-slate-600">
                      <th className="py-3 px-3 whitespace-nowrap">Ngày nhận</th>
                      <th className="py-3 px-3 whitespace-nowrap">Mã HĐ (Nhấp xem)</th>
                      <th className="py-3 px-3">Khách hàng</th>
                      <th className="py-3 px-3">Tên mặt hàng đã nhận</th>
                      <th className="py-3 px-3 text-center whitespace-nowrap">SL & ĐVT</th>
                      <th className="py-3 px-3 text-right whitespace-nowrap">Đơn giá</th>
                      <th className="py-3 px-3 text-right whitespace-nowrap">Thành tiền</th>
                      <th className="py-3 px-3 text-right whitespace-nowrap">Đã thanh toán</th>
                      <th className="py-3 px-3 text-right whitespace-nowrap">Còn nợ</th>
                      <th className="py-3 px-3 text-right whitespace-nowrap">Kiểm tra chi tiết</th>
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
                            <td className="py-3 px-3 font-mono whitespace-nowrap">{item.date}</td>
                            <td className="py-3 px-3 font-mono font-bold text-emerald-800 underline whitespace-nowrap">
                              {item.invoiceCode}
                            </td>
                            <td className="py-3 px-3">
                              <div className="font-semibold text-slate-900">{item.customerName}</div>
                              <div className="text-[11px] font-mono text-slate-500">
                                {item.customerPhone}
                              </div>
                            </td>
                            <td className="py-3 px-3 font-semibold text-slate-900">
                              {item.productName}
                              <div className="text-[11px] font-normal text-slate-500">
                                Kho: {item.warehouseName}
                              </div>
                            </td>
                            <td className="py-3 px-3 text-center font-mono whitespace-nowrap">
                              {item.quantity} {item.unit}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                              {formatVND(item.unitPrice)}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold whitespace-nowrap">
                              {formatVND(item.totalAmount)}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums text-emerald-700 whitespace-nowrap">
                              {formatVND(item.paidAmount)}
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                              <span
                                className={
                                  item.debtAmount > 0 ? 'font-bold text-red-600' : 'text-slate-500'
                                }
                              >
                                {formatVND(item.debtAmount)}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (matchedSale) {
                                    setDrillDownItem({ type: 'sale', record: matchedSale });
                                  }
                                }}
                                className="px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md inline-flex items-center gap-1"
                              >
                                <Eye className="w-3.5 h-3.5" />
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
                  Tổng số: {salesInRange.length} hóa đơn · Doanh thu: {formatVND(totalRevenue)} ·
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
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                    <th className="py-3 px-3">Ngày bán</th>
                    <th className="py-3 px-3">Mã HĐ</th>
                    <th className="py-3 px-3">Kho xuất</th>
                    <th className="py-3 px-3">Khách hàng</th>
                    <th className="py-3 px-3">Vật tư nông nghiệp</th>
                    <th className="py-3 px-3 text-center">SL</th>
                    <th className="py-3 px-3 text-right">Thành tiền</th>
                    <th className="py-3 px-3 text-right">Đã thu</th>
                    <th className="py-3 px-3 text-right">Còn nợ</th>
                    <th className="py-3 px-3 text-right">Liên kết chi tiết</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {salesInRange.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => setDrillDownItem({ type: 'sale', record: s })}
                      className="hover:bg-emerald-50/50 cursor-pointer"
                    >
                      <td className="py-3 px-3 font-mono whitespace-nowrap">
                        {s.createdAt.slice(0, 10)}
                      </td>
                      <td className="py-3 px-3 font-mono font-bold text-emerald-800 underline whitespace-nowrap">
                        {s.invoiceCode}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        {s.warehouseName || 'Tâm An Mỹ Ngãi'}
                      </td>
                      <td className="py-3 px-3 font-semibold text-slate-900">{s.customerName}</td>
                      <td className="py-3 px-3 font-medium text-slate-900">{s.productName}</td>
                      <td className="py-3 px-3 text-center font-mono whitespace-nowrap">
                        {s.quantity} {s.unit}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-semibold whitespace-nowrap">
                        {formatVND(s.totalAmount)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-emerald-700 whitespace-nowrap">
                        {formatVND(s.paidAmount)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-red-600 whitespace-nowrap">
                        {formatVND(s.debtAmount)}
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDrillDownItem({ type: 'sale', record: s });
                          }}
                          className="px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md"
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
                  className="px-3 py-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg flex items-center gap-1.5 self-start sm:self-auto"
                >
                  <span>Mở phân hệ Nhật ký Nhập hàng</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                    <th className="py-3 px-3">Ngày nhập</th>
                    <th className="py-3 px-3">Mã phiếu</th>
                    <th className="py-3 px-3">Kho nhập</th>
                    <th className="py-3 px-3">Nhà cung cấp</th>
                    <th className="py-3 px-3">Vật tư nhập kho</th>
                    <th className="py-3 px-3 text-center">SL nhập</th>
                    <th className="py-3 px-3 text-right">Tổng tiền nhập</th>
                    <th className="py-3 px-3 text-right">Đã trả NCC</th>
                    <th className="py-3 px-3 text-right">Còn nợ NCC</th>
                    <th className="py-3 px-3 text-right">Liên kết chi tiết</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {importsInRange.map((imp) => (
                    <tr
                      key={imp.id}
                      onClick={() => setDrillDownItem({ type: 'import', record: imp })}
                      className="hover:bg-emerald-50/50 cursor-pointer"
                    >
                      <td className="py-3 px-3 font-mono whitespace-nowrap">
                        {imp.createdAt.slice(0, 10)}
                      </td>
                      <td className="py-3 px-3 font-mono font-bold text-emerald-800 underline whitespace-nowrap">
                        {imp.receiptCode}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        {imp.warehouseName || 'Tâm An Mỹ Ngãi'}
                      </td>
                      <td className="py-3 px-3 font-semibold text-slate-900">{imp.supplierName}</td>
                      <td className="py-3 px-3 font-medium text-slate-900">{imp.productName}</td>
                      <td className="py-3 px-3 text-center font-mono whitespace-nowrap">
                        {imp.quantity} {imp.unit}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-semibold whitespace-nowrap">
                        {formatVND(imp.totalCost)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-emerald-700 whitespace-nowrap">
                        {formatVND(imp.paidAmount)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-red-600 whitespace-nowrap">
                        {formatVND(imp.debtAmount)}
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDrillDownItem({ type: 'import', record: imp });
                          }}
                          className="px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md"
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
                  Nhấp vào từng mặt hàng để xem chi tiết lịch sử nhập - xuất và kiểm tra tồn kho thực tế
                </p>
              </div>
              {onNavigateToModule && (
                <button
                  type="button"
                  onClick={() => onNavigateToModule('inventory')}
                  className="px-3 py-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg flex items-center gap-1.5 self-start sm:self-auto"
                >
                  <span>Mở phân hệ Quản lý Tồn kho</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                    <th className="py-3 px-3">Mã VT</th>
                    <th className="py-3 px-3">Kho lưu trữ</th>
                    <th className="py-3 px-3">Tên vật tư nông nghiệp</th>
                    <th className="py-3 px-3 text-center">Nhập trong kỳ</th>
                    <th className="py-3 px-3 text-center">Xuất trong kỳ</th>
                    <th className="py-3 px-3 text-center">Tồn hiện tại</th>
                    <th className="py-3 px-3 text-right">Giá trị tồn kho</th>
                    <th className="py-3 px-3 text-center">Cảnh báo</th>
                    <th className="py-3 px-3 text-right">Liên kết kiểm tra</th>
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
                    const alert = evaluateStockAlert(p);
                    return (
                      <tr
                        key={p.id}
                        onClick={() => setDrillDownItem({ type: 'product', record: p })}
                        className="hover:bg-emerald-50/50 cursor-pointer"
                      >
                        <td className="py-3 px-3 font-mono font-bold text-emerald-800 underline">
                          {p.code}
                        </td>
                        <td className="py-3 px-3">{p.warehouseName || 'Tâm An Mỹ Ngãi'}</td>
                        <td className="py-3 px-3 font-semibold text-slate-900">{p.name}</td>
                        <td className="py-3 px-3 text-center font-mono text-emerald-700 font-semibold">
                          +{importedInPeriod} {p.unit}
                        </td>
                        <td className="py-3 px-3 text-center font-mono text-amber-800 font-semibold">
                          -{soldInPeriod} {p.unit}
                        </td>
                        <td className="py-3 px-3 text-center font-mono font-bold text-slate-900">
                          {p.stock} {p.unit}
                        </td>
                        <td className="py-3 px-3 text-right font-mono">
                          {formatVND(p.stock * p.importPrice)}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span
                            className={`px-2 py-0.5 text-[11px] font-bold rounded ${
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
                        <td className="py-3 px-3 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDrillDownItem({ type: 'product', record: p });
                            }}
                            className="px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md"
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
                    className="px-3 py-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg flex items-center gap-1.5 self-start sm:self-auto"
                  >
                    <span>Mở phân hệ Quản lý Công nợ</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                      <th className="py-3 px-3">Loại công nợ</th>
                      <th className="py-3 px-3">Ngày / Mã phiếu</th>
                      <th className="py-3 px-3">Khách hàng / Nhà cung cấp</th>
                      <th className="py-3 px-3">Mặt hàng còn nợ</th>
                      <th className="py-3 px-3 text-right">Tổng tiền</th>
                      <th className="py-3 px-3 text-right">Đã trả</th>
                      <th className="py-3 px-3 text-right">Còn nợ</th>
                      <th className="py-3 px-3">Hạn thanh toán</th>
                      <th className="py-3 px-3 text-right">Kiểm tra & Thu/Trả</th>
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
                            <td className="py-3 px-3">
                              <span className="px-2 py-0.5 text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                                Phải thu KH
                              </span>
                            </td>
                            <td className="py-3 px-3 font-mono">
                              <div className="font-bold text-emerald-800 underline">
                                {s.invoiceCode}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {s.createdAt.slice(0, 10)}
                              </div>
                            </td>
                            <td className="py-3 px-3 font-semibold text-slate-900">
                              {s.customerName}
                              <div className="text-[11px] font-mono text-slate-500">
                                {s.customerPhone}
                              </div>
                            </td>
                            <td className="py-3 px-3">
                              {s.productName} ({s.quantity} {s.unit})
                            </td>
                            <td className="py-3 px-3 text-right font-mono">
                              {formatVND(s.totalAmount)}
                            </td>
                            <td className="py-3 px-3 text-right font-mono text-emerald-700">
                              {formatVND(s.paidAmount)}
                            </td>
                            <td className="py-3 px-3 text-right font-mono font-bold text-red-600">
                              {formatVND(s.debtAmount)}
                            </td>
                            <td className="py-3 px-3 font-mono">
                              <div>{s.dueDate}</div>
                              <div
                                className={`text-[11px] font-semibold ${
                                  urgency === 'overdue' ? 'text-red-600' : 'text-amber-700'
                                }`}
                              >
                                {urgency === 'overdue'
                                  ? `Quá hạn ${Math.abs(daysRemaining)} ngày`
                                  : `Còn ${daysRemaining} ngày`}
                              </div>
                            </td>
                            <td className="py-3 px-3 text-right">
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
                                className="px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md"
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
                            <td className="py-3 px-3">
                              <span className="px-2 py-0.5 text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200 rounded">
                                Phải trả NCC
                              </span>
                            </td>
                            <td className="py-3 px-3 font-mono">
                              <div className="font-bold text-amber-900 underline">
                                {i.receiptCode}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {i.createdAt.slice(0, 10)}
                              </div>
                            </td>
                            <td className="py-3 px-3 font-semibold text-slate-900">
                              {i.supplierName}
                              <div className="text-[11px] font-mono text-slate-500">
                                {i.supplierPhone}
                              </div>
                            </td>
                            <td className="py-3 px-3">
                              {i.productName} ({i.quantity} {i.unit})
                            </td>
                            <td className="py-3 px-3 text-right font-mono">
                              {formatVND(i.totalCost)}
                            </td>
                            <td className="py-3 px-3 text-right font-mono text-emerald-700">
                              {formatVND(i.paidAmount)}
                            </td>
                            <td className="py-3 px-3 text-right font-mono font-bold text-red-600">
                              {formatVND(i.debtAmount)}
                            </td>
                            <td className="py-3 px-3 font-mono">
                              <div>{i.dueDate}</div>
                              <div
                                className={`text-[11px] font-semibold ${
                                  urgency === 'overdue' ? 'text-red-600' : 'text-amber-700'
                                }`}
                              >
                                {urgency === 'overdue'
                                  ? `Quá hạn ${Math.abs(daysRemaining)} ngày`
                                  : `Còn ${daysRemaining} ngày`}
                              </div>
                            </td>
                            <td className="py-3 px-3 text-right">
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
                                className="px-2.5 py-1 text-xs font-semibold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md"
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
              <div className="p-4 sm:p-6 border-b border-slate-200 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Báo Cáo Thu - Chi Dòng Tiền & Sổ Quỹ (Từ ngày {fromDate} đến ngày {toDate})
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Đối soát toàn bộ dòng tiền thực thu từ khách hàng và dòng tiền thực chi trả
                      Nhà cung cấp trong kỳ
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  <div className="p-3.5 bg-emerald-50/60 border border-emerald-200 rounded-xl">
                    <div className="text-xs text-emerald-900 font-semibold">
                      Tổng Dòng Tiền Thực Thu (+)
                    </div>
                    <div className="text-base font-bold font-mono text-emerald-700 mt-1">
                      +{formatVND(totalCollected)}
                    </div>
                  </div>
                  <div className="p-3.5 bg-amber-50/60 border border-amber-200 rounded-xl">
                    <div className="text-xs text-amber-900 font-semibold">
                      Tổng Dòng Tiền Thực Chi (-)
                    </div>
                    <div className="text-base font-bold font-mono text-amber-800 mt-1">
                      -{formatVND(totalPaidSupplier)}
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
                      {formatVND(netCashflow)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                      <th className="py-3 px-3">Ngày giao dịch</th>
                      <th className="py-3 px-3">Loại phiếu Thu / Chi</th>
                      <th className="py-3 px-3">Mã chứng từ</th>
                      <th className="py-3 px-3">Đối tác / Khách hàng</th>
                      <th className="py-3 px-3">Diễn giải nội dung dòng tiền</th>
                      <th className="py-3 px-3 text-right">Tiền Thu (+)</th>
                      <th className="py-3 px-3 text-right">Tiền Chi (-)</th>
                      <th className="py-3 px-3 text-right">Kiểm tra</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {salesInRange
                      .filter((s) => s.paidAmount > 0)
                      .map((s) => (
                        <tr
                          key={`cf_in_${s.id}`}
                          onClick={() => setDrillDownItem({ type: 'sale', record: s })}
                          className="hover:bg-emerald-50/40 cursor-pointer"
                        >
                          <td className="py-3 px-3 font-mono">{s.createdAt.slice(0, 10)}</td>
                          <td className="py-3 px-3">
                            <span className="px-2 py-0.5 text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                              PHIẾU THU BÁN HÀNG
                            </span>
                          </td>
                          <td className="py-3 px-3 font-mono font-bold text-emerald-800 underline">
                            {s.invoiceCode}
                          </td>
                          <td className="py-3 px-3 font-semibold text-slate-900">
                            {s.customerName}
                          </td>
                          <td className="py-3 px-3">
                            Thu tiền bán {s.quantity} {s.unit} {s.productName}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-emerald-700">
                            +{formatVND(s.paidAmount)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-slate-400">0 đ</td>
                          <td className="py-3 px-3 text-right">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDrillDownItem({ type: 'sale', record: s });
                              }}
                              className="px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 rounded-md"
                            >
                              Chi tiết →
                            </button>
                          </td>
                        </tr>
                      ))}
                    {importsInRange
                      .filter((i) => i.paidAmount > 0)
                      .map((i) => (
                        <tr
                          key={`cf_out_${i.id}`}
                          onClick={() => setDrillDownItem({ type: 'import', record: i })}
                          className="hover:bg-amber-50/40 cursor-pointer"
                        >
                          <td className="py-3 px-3 font-mono">{i.createdAt.slice(0, 10)}</td>
                          <td className="py-3 px-3">
                            <span className="px-2 py-0.5 text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200 rounded">
                              PHIẾU CHI NHẬP KHO
                            </span>
                          </td>
                          <td className="py-3 px-3 font-mono font-bold text-amber-900 underline">
                            {i.receiptCode}
                          </td>
                          <td className="py-3 px-3 font-semibold text-slate-900">
                            {i.supplierName}
                          </td>
                          <td className="py-3 px-3">
                            Chi thanh toán nhập {i.quantity} {i.unit} {i.productName}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-slate-400">0 đ</td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-amber-800">
                            -{formatVND(i.paidAmount)}
                          </td>
                          <td className="py-3 px-3 text-right">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDrillDownItem({ type: 'import', record: i });
                              }}
                              className="px-2.5 py-1 text-xs font-semibold text-amber-900 bg-amber-50 rounded-md"
                            >
                              Chi tiết →
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
            TAB 8: BÁO CÁO TÀI CHÍNH & LỢI NHUẬN GỘP (ĐỘC QUYỀN QUẢN LÝ CHÍNH)
           ==================================================================== */}
        {isPrimaryAdmin &&
          activeCategory === 'financial_profit' &&
          allowedCategories.includes('financial_profit') && (
            <div className="bg-white rounded-xl border border-emerald-200 overflow-hidden">
              <div className="p-4 sm:p-6 border-b border-slate-200 bg-emerald-50/50 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-emerald-800 uppercase">
                      Báo Cáo Tài Chính Độc Quyền Quản Lý Chính ({ADMIN_BACKUP_EMAIL})
                    </div>
                    <h3 className="text-base font-bold text-slate-900 mt-0.5">
                      Phân Tích Doanh Thu, Giá Vốn & Lợi Nhuận Gộp (Từ ngày {fromDate} đến ngày{' '}
                      {toDate})
                    </h3>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div className="p-3.5 bg-white rounded-xl border border-slate-200">
                    <div className="text-xs text-slate-500">Tổng Doanh Thu Bán Hàng</div>
                    <div className="text-base font-bold font-mono text-slate-900 mt-1">
                      {formatVND(totalRevenue)}
                    </div>
                  </div>
                  <div className="p-3.5 bg-white rounded-xl border border-slate-200">
                    <div className="text-xs text-slate-500">Tổng Giá Vốn Hàng Bán (COGS)</div>
                    <div className="text-base font-bold font-mono text-slate-700 mt-1">
                      {formatVND(totalCOGS)}
                    </div>
                  </div>
                  <div className="p-3.5 bg-white rounded-xl border border-emerald-200">
                    <div className="text-xs text-emerald-800 font-semibold">
                      Lợi Nhuận Gộp Ước Tính
                    </div>
                    <div className="text-base font-bold font-mono text-emerald-700 mt-1">
                      {formatVND(estimatedGrossProfit)}
                    </div>
                  </div>
                  <div className="p-3.5 bg-white rounded-xl border border-slate-200">
                    <div className="text-xs text-slate-500">Tỷ Suất Lợi Nhuận Gộp (%)</div>
                    <div className="text-base font-bold font-mono text-emerald-800 mt-1">
                      {profitMarginPct}%
                    </div>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                      <th className="py-3 px-3">Ngày bán</th>
                      <th className="py-3 px-3">Mã HĐ</th>
                      <th className="py-3 px-3">Khách hàng</th>
                      <th className="py-3 px-3">Mặt hàng</th>
                      <th className="py-3 px-3 text-center">SL</th>
                      <th className="py-3 px-3 text-right">Doanh thu bán</th>
                      <th className="py-3 px-3 text-right">Giá vốn</th>
                      <th className="py-3 px-3 text-right">Lợi nhuận gộp</th>
                      <th className="py-3 px-3 text-center">Tỷ suất</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {salesInRange.map((s) => {
                      const prod = products.find((p) => p.id === s.productId);
                      const unitCost = prod ? prod.importPrice : Math.round(s.unitPrice * 0.85);
                      const totalCost = unitCost * s.quantity;
                      const profit = s.totalAmount - totalCost;
                      const margin =
                        s.totalAmount > 0 ? Math.round((profit / s.totalAmount) * 100) : 0;
                      return (
                        <tr
                          key={`fin_${s.id}`}
                          onClick={() => setDrillDownItem({ type: 'sale', record: s })}
                          className="hover:bg-emerald-50/40 cursor-pointer"
                        >
                          <td className="py-3 px-3 font-mono">{s.createdAt.slice(0, 10)}</td>
                          <td className="py-3 px-3 font-mono font-bold text-emerald-800 underline">
                            {s.invoiceCode}
                          </td>
                          <td className="py-3 px-3 font-semibold text-slate-900">
                            {s.customerName}
                          </td>
                          <td className="py-3 px-3">{s.productName}</td>
                          <td className="py-3 px-3 text-center font-mono">
                            {s.quantity} {s.unit}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-semibold">
                            {formatVND(s.totalAmount)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-slate-600">
                            {formatVND(totalCost)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-emerald-700">
                            +{formatVND(profit)}
                          </td>
                          <td className="py-3 px-3 text-center font-mono font-semibold text-emerald-800">
                            {margin}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

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
                      <button
                        type="button"
                        onClick={() => {
                          const rec = drillDownItem.record;
                          setDrillDownItem(null);
                          onNavigateToModule(rec.debtAmount > 0 ? 'debts' : 'sales', rec.id);
                        }}
                        className="px-3.5 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg flex items-center gap-1"
                      >
                        <span>Mở trực tiếp tại phân hệ gốc</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
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
                      <button
                        type="button"
                        onClick={() => {
                          const rec = drillDownItem.record;
                          setDrillDownItem(null);
                          onNavigateToModule(rec.debtAmount > 0 ? 'debts' : 'imports', rec.id);
                        }}
                        className="px-3.5 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg flex items-center gap-1"
                      >
                        <span>Mở trực tiếp tại phân hệ gốc</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
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
                    let remaining = Math.max(0, Number(batchCollectAmount) || 0);
                    if (remaining <= 0) return;
                    const unpaidRows = receivedItemsReport.items.filter((i) => i.debtAmount > 0);
                    unpaidRows.forEach((row) => {
                      if (remaining <= 0) return;
                      const pay = Math.min(row.debtAmount, remaining);
                      if (pay > 0) {
                        onCollectCustomerDebt(
                          row.saleId,
                          pay,
                          batchCollectNote.trim() || `Thu nợ tổng hợp kỳ ${fromDate} -> ${toDate}`
                        );
                        remaining -= pay;
                      }
                    });
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
      {isPrimaryAdmin && (
        <div className="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="text-xs text-emerald-700 font-semibold">
                Đồng bộ đám mây Google Workspace & Sao lưu về máy tính (Kèm Lịch sử thao tác)
              </div>
              <h3 className="text-base font-bold text-slate-900 mt-0.5">
                Sao lưu dữ liệu tự động hàng ngày vào Google Drive & Khôi phục dữ liệu
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Tài khoản Gmail nhận sao lưu mặc định:{' '}
                <strong className="font-mono text-slate-900">{ADMIN_BACKUP_EMAIL}</strong> · Mỗi tệp
                sao lưu đều đính kèm toàn bộ{' '}
                <strong className="text-emerald-800">
                  {auditLogs.length} bản ghi lịch sử thao tác
                </strong>{' '}
                làm bằng chứng đối chiếu và phục hồi.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoDailyBackupEnabled}
                  onChange={(e) => onToggleAutoDailyBackup(e.target.checked)}
                  aria-label="Tự động sao lưu hàng ngày lên Google Drive"
                  className="w-4 h-4 accent-emerald-700 rounded cursor-pointer"
                />
                <span>Tự động sao lưu mỗi ngày (06:00 sáng)</span>
              </label>

              <button
                type="button"
                disabled={isBackingUp}
                onClick={() => setConfirmBackupModal(true)}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <CloudUpload className="w-4 h-4" />
                <span>
                  {isBackingUp ? 'Đang tải lên Drive...' : 'Sao lưu ngay lên Google Drive'}
                </span>
              </button>
            </div>
          </div>

          {/* Exclusive Primary Manager Box: Download Backup to Computer & Upload Backup to Restore */}
          <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>
                  Quyền Quản Lý Chính ({ADMIN_BACKUP_EMAIL}): Tải Tệp Sao Lưu Về Máy Tính & Đăng Tải
                  Khôi Phục Dữ Liệu
                </span>
              </div>
              <p className="text-xs text-slate-600">
                Tải trực tiếp tệp sao lưu (.json) chứa toàn bộ dữ liệu + lịch sử thao tác về máy
                tính, hoặc chọn tệp sao lưu từ máy tính đăng tải lên để khôi phục nguyên trạng dữ
                liệu khi cần thiết.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
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
                className="px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <Download className="w-4 h-4 shrink-0" />
                <span>Tải tệp sao lưu về máy tính (.json)</span>
              </button>
              <button
                type="button"
                onClick={() => backupFileInputRef.current?.click()}
                className="px-3.5 py-2 text-xs font-bold text-emerald-900 bg-white border border-emerald-300 hover:bg-emerald-100 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <Upload className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>Đăng tải tệp sao lưu lên để khôi phục</span>
              </button>
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
                      <Download className="w-3.5 h-3.5" />
                      <span>Tải về máy</span>
                    </button>
                    {bk.snapshotPayload && (
                      <button
                        type="button"
                        onClick={() => setPendingRestorePayload(bk.snapshotPayload!)}
                        className="px-2.5 py-1.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-md flex items-center gap-1"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-emerald-700" />
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
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                  <th className="py-2.5 px-3">Tên tệp sao lưu</th>
                  <th className="py-2.5 px-3">Gmail nhận</th>
                  <th className="py-2.5 px-3">Loại & Trạng thái</th>
                  <th className="py-2.5 px-3 text-right">Bản ghi & Lịch sử</th>
                  <th className="py-2.5 px-3">Thời gian</th>
                  <th className="py-2.5 px-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {backups.map((bk) => (
                  <tr key={bk.id} className="hover:bg-slate-50">
                    <td className="py-3 px-3 font-mono font-medium text-slate-900 break-all">
                      {bk.fileName}
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-700 break-all">
                      {bk.targetEmail}
                    </td>
                    <td className="py-3 px-3 text-slate-600">
                      {bk.triggerType === 'auto_daily' ? 'Tự động' : 'Thủ công'}
                      <span className="mx-1" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-emerald-700 font-medium">Hoàn tất</span>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                      <span className="font-semibold">{bk.recordCount} bản ghi</span>
                      <span className="mx-1 text-slate-400">·</span>
                      <span className="text-emerald-800 font-semibold">
                        {bk.auditLogCount ?? auditLogs.length} thao tác
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-500 whitespace-nowrap">
                      {bk.createdAt.replace('T', ' ').slice(0, 16)}
                    </td>
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onDownloadBackupFile(bk)}
                          title="Tải tệp sao lưu này về máy tính (.json)"
                          className="px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md flex items-center gap-1 whitespace-nowrap"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Tải về máy</span>
                        </button>
                        {bk.snapshotPayload && (
                          <button
                            type="button"
                            onClick={() => setPendingRestorePayload(bk.snapshotPayload!)}
                            title="Khôi phục dữ liệu theo tệp sao lưu này"
                            className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md flex items-center gap-1 whitespace-nowrap"
                          >
                            <RotateCcw className="w-3.5 h-3.5 text-emerald-700" />
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

      {/* Operation Audit Log (Lịch sử các thao tác đã thực hiện — EXCLUSIVE to trannhat1205@gmail.com) */}
      {isPrimaryAdmin && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-4 sm:p-6 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-50/60">
            <div>
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-emerald-700 shrink-0" />
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                  Giám Sát Độc Quyền Quản Lý Chính ({ADMIN_BACKUP_EMAIL})
                </span>
              </div>
              <h3 className="text-base sm:text-lg font-bold text-slate-900 mt-0.5">
                Lịch Sử Các Thao Tác Đã Thực Hiện ({auditLogs.length} bước thao tác đã ghi nhận)
              </h3>
              <p className="text-xs text-slate-600 mt-1">
                Lưu lại toàn bộ các bước thực hiện (đặc biệt khi cấp quyền xóa phiếu / xóa dữ liệu
                hoặc chỉnh sửa cho các Quản lý & Nhân viên). Chỉ duy nhất tài khoản{' '}
                <strong className="font-mono text-slate-900">{ADMIN_BACKUP_EMAIL}</strong> có quyền
                xem và khôi phục lại dữ liệu đã xóa từ lịch sử này.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <span className="px-2.5 py-1 text-xs font-semibold bg-red-50 text-red-700 border border-red-200 rounded-lg">
                {deleteAuditCount} thao tác xóa đã ghi bằng chứng
              </span>
              <span className="px-2.5 py-1 text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 rounded-lg">
                {editAuditCount} thao tác chỉnh sửa
              </span>
              <button
                type="button"
                onClick={() => onDownloadBackupFile()}
                className="px-3 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg flex items-center gap-1.5 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Tải Sao Lưu Kèm Lịch Sử (.json)</span>
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="px-4 sm:px-6 pt-4 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
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

              <div className="relative w-full xl:w-72">
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
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-3 whitespace-nowrap">Thời gian & Kho</th>
                    <th className="py-3 px-3">Tài khoản nhân sự thực hiện</th>
                    <th className="py-3 px-3">Loại thao tác & Mã phiếu</th>
                    <th className="py-3 px-3">Chi tiết bước thực hiện (Bằng chứng lưu trữ)</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">
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
                        <td className="py-3.5 px-3 whitespace-nowrap align-top">
                          <div className="font-mono font-semibold text-slate-900">
                            {entry.timestamp.replace('T', ' ').slice(0, 19)}
                          </div>
                          <div className="text-[11px] font-semibold text-emerald-800 mt-0.5 flex items-center gap-1">
                            <Warehouse className="w-3 h-3 shrink-0" />
                            <span>{entry.warehouseName}</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-3 align-top max-w-[200px]">
                          <div className="font-bold text-slate-900">{entry.actorDisplayName}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5 break-all">
                            <span className="font-mono font-semibold text-emerald-800">
                              @{entry.actorUsername}
                            </span>
                            {entry.actorEmail ? ` · ${entry.actorEmail}` : ''}
                          </div>
                          <div className="text-[11px] text-slate-500">{entry.actorRoleLabel}</div>
                        </td>
                        <td className="py-3.5 px-3 align-top whitespace-nowrap">
                          <div>{getCategoryBadge(entry.category)}</div>
                          <div className="font-mono font-bold text-slate-900 mt-1">
                            Mã: {entry.targetCode}
                          </div>
                        </td>
                        <td className="py-3.5 px-3 align-top">
                          <div className="font-semibold text-slate-900">{entry.actionTitle}</div>
                          <div className="text-slate-600 mt-0.5 leading-relaxed">
                            {entry.details}
                          </div>
                        </td>
                        <td className="py-3.5 px-3 text-right whitespace-nowrap align-top">
                          <div className="flex flex-col items-end gap-1.5">
                            {entry.snapshotData ? (
                              <button
                                type="button"
                                onClick={() => setInspectingAuditSnapshot(entry)}
                                className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1 whitespace-nowrap"
                              >
                                <Eye className="w-3.5 h-3.5 text-slate-600" />
                                <span>Xem dữ liệu gốc</span>
                              </button>
                            ) : (
                              <span className="text-[11px] text-slate-400">Đã ghi nhận</span>
                            )}

                            {entry.category === 'delete_record' &&
                              entry.snapshotData &&
                              (entry.restoredAt ? (
                                <span className="px-2.5 py-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-1 whitespace-nowrap">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>Đã khôi phục</span>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => onRestoreDeletedRecordFromAudit(entry)}
                                  className="px-2.5 py-1 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg flex items-center gap-1 whitespace-nowrap"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
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
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>Đăng nhập Google & Bảng Phân Quyền Nhân Sự Chi Tiết</span>
              </h3>
              <p className="text-xs text-slate-500 mt-1">
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
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
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
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
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
            <table className="w-full min-w-[880px] text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4 min-w-[210px]">Nhân sự & Kho phụ trách</th>
                  <th className="py-3 px-4 whitespace-nowrap">Tài khoản Google (Gmail)</th>
                  <th className="py-3 px-4 min-w-[170px]">Vai trò chức danh</th>
                  <th className="py-3 px-4 min-w-[300px]">
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
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900">{st.displayName}</div>
                        <div className="text-[11px] text-emerald-800 font-semibold mt-0.5">
                          @{st.username} · Kho: {st.assignedWarehouse}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-700">
                        {st.email || '---'}
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-slate-800">
                        {getPositionRoleLabel(st.positionRole)}
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 leading-relaxed">
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

      {/* Confirmation Modal before uploading to Google Drive */}
      {confirmBackupModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2.5 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Xác nhận sao lưu dữ liệu lên Google Drive"
        >
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-md flex flex-col overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm sm:text-base font-bold text-slate-900">
                Xác nhận tạo bản sao lưu trên Google Drive?
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
                lịch sử thao tác lên Google Drive ({ADMIN_BACKUP_EMAIL}).
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
    </div>
  );
};

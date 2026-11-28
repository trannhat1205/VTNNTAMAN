import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  Calendar,
  CheckCircle2,
  FileSpreadsheet,
  Lock,
  MapPin,
  Minus,
  PackagePlus,
  Pencil,
  Phone,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  TrendingUp,
  Truck,
  Wallet,
  X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  CashPaymentVoucher,
  CrossLinkNavigateRequest,
  ImportTransaction,
  ProductItem,
  SaleTransaction,
  SupplierProfile,
  UserRole,
} from '../types';
import {
  canPerformRoleAction,
  computeSupplierDetailLedgers,
  evaluateDebtUrgency,
  formatVND,
  generateUniqueSupplierCodeFromName,
  getCurrentMonthRangeVietnam,
  getRecentDaysRangeVietnam,
  getTodayVietnamDateStr,
  isContraOffsetVoucher,
  isDateWithinRange,
  normalizeVietnameseSearch,
  previewSupplierFifoDebtSettlement,
  SupplierDetailLedger,
} from '../utils/businessLogic';
import { CrossLinkChip } from './VoucherCrossLinkUI';

interface SupplierModuleProps {
  suppliers: SupplierProfile[];
  imports: ImportTransaction[];
  products: ProductItem[];
  sales: SaleTransaction[];
  paymentVouchers: CashPaymentVoucher[];
  warehouses: string[];
  lockedWarehouse: string | null;
  paymentGroups?: string[];
  role: UserRole;
  leadDays: number;
  focusedSupplierKey?: string | null;
  onClearFocusedSupplier?: () => void;
  onSaveSupplier: (
    data: Omit<SupplierProfile, 'id' | 'createdAt'>,
    editingId?: string
  ) => SupplierProfile;
  onDeleteSupplier: (supplierId: string) => void;
  onSettleSupplierTotalDebtFifo?: (params: {
    supplierName: string;
    supplierPhone: string;
    totalAmount: number;
    groupName: string;
    paymentMethod: string;
    note: string;
    warehouseName?: string;
  }) => void;
  onQuickImportFromSupplier: (supplierName: string, productId?: string) => void;
  onQuickSellOffsetToSupplier: (supplierKey: string) => void;
  onNavigateCrossLink?: (req: CrossLinkNavigateRequest) => void;
}

type SupplierDebtFilter = 'all' | 'has_debt' | 'overdue' | 'settled';
type SupplierSubTab = 'price_history' | 'imports' | 'payments';

export const SupplierModule: React.FC<SupplierModuleProps> = ({
  suppliers,
  imports,
  products,
  sales,
  paymentVouchers,
  warehouses,
  lockedWarehouse,
  paymentGroups = ['Chi trả nợ Nhà cung cấp'],
  role,
  leadDays,
  focusedSupplierKey,
  onClearFocusedSupplier,
  onSaveSupplier,
  onDeleteSupplier,
  onSettleSupplierTotalDebtFifo,
  onQuickImportFromSupplier,
  onQuickSellOffsetToSupplier,
  onNavigateCrossLink,
}) => {
  const canEdit = canPerformRoleAction(role, 'edit_record');
  const canDelete = canPerformRoleAction(role, 'delete_record');
  const todayStr = getTodayVietnamDateStr();
  const currentMonth = useMemo(() => getCurrentMonthRangeVietnam(), []);
  const recent7 = useMemo(() => getRecentDaysRangeVietnam(7), []);

  const [searchQuery, setSearchQuery] = useState('');
  const [debtFilter, setDebtFilter] = useState<SupplierDebtFilter>('all');
  const [subTab, setSubTab] = useState<SupplierSubTab>('price_history');

  const ledgers = useMemo(
    () =>
      computeSupplierDetailLedgers({
        suppliers,
        imports,
        products,
        sales,
        paymentVouchers,
        todayStr,
        leadDays,
      }),
    [suppliers, imports, products, sales, paymentVouchers, todayStr, leadDays]
  );

  const [selectedKey, setSelectedKey] = useState<string | null>(
    () => ledgers[0]?.key || null
  );

  useEffect(() => {
    if (!focusedSupplierKey) return;
    const normFocus = normalizeVietnameseSearch(focusedSupplierKey);
    const matched = ledgers.find(
      (l) =>
        l.key === normFocus ||
        l.profile?.id === focusedSupplierKey ||
        normalizeVietnameseSearch(l.code) === normFocus ||
        normalizeVietnameseSearch(l.name) === normFocus
    );
    if (matched) {
      setSearchQuery('');
      setDebtFilter('all');
      setSelectedKey(matched.key);
    }
    onClearFocusedSupplier?.();
  }, [focusedSupplierKey, ledgers, onClearFocusedSupplier]);

  const filteredLedgers = useMemo(() => {
    const q = normalizeVietnameseSearch(searchQuery);
    return ledgers.filter((l) => {
      if (debtFilter === 'has_debt' && l.totalRemainingDebt <= 0) return false;
      if (debtFilter === 'overdue' && l.overdueDebtAmount <= 0) return false;
      if (debtFilter === 'settled' && l.totalRemainingDebt > 0) return false;
      if (!q) return true;
      const prodNames = l.productPriceHistory.map((p) => p.productName).join(' ');
      return normalizeVietnameseSearch(
        `${l.code} ${l.name} ${l.phone} ${l.address} ${l.note} ${prodNames}`
      ).includes(q);
    });
  }, [ledgers, searchQuery, debtFilter]);

  useEffect(() => {
    if (filteredLedgers.length === 0) {
      setSelectedKey(null);
      return;
    }
    if (!selectedKey || !filteredLedgers.some((l) => l.key === selectedKey)) {
      setSelectedKey(filteredLedgers[0].key);
    }
  }, [filteredLedgers, selectedKey]);

  const activeLedger: SupplierDetailLedger | null = useMemo(
    () => filteredLedgers.find((l) => l.key === selectedKey) || filteredLedgers[0] || null,
    [filteredLedgers, selectedKey]
  );

  // Date filter for PN-... receipt list inside active supplier ledger
  const [fromDate, setFromDate] = useState<string>('2020-01-01');
  const [toDate, setToDate] = useState<string>('2035-12-31');
  const [onlyUnpaidReceipts, setOnlyUnpaidReceipts] = useState<boolean>(false);

  const filteredSupplierImports = useMemo(() => {
    if (!activeLedger) return [];
    return activeLedger.importReceipts.filter((imp) => {
      if (onlyUnpaidReceipts && (Number(imp.debtAmount) || 0) <= 0) return false;
      return isDateWithinRange(imp.createdAt, fromDate, toDate);
    });
  }, [activeLedger, fromDate, toDate, onlyUnpaidReceipts]);

  // Add / Edit Supplier Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<SupplierProfile | null>(null);
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formNote, setFormNote] = useState('');
  const [formWarehouse, setFormWarehouse] = useState(
    lockedWarehouse || warehouses[0] || 'Tâm An Mỹ Ngãi'
  );
  const [formError, setFormError] = useState<string | null>(null);

  const openAddSupplierModal = (prefill?: Partial<SupplierDetailLedger>) => {
    setEditingSupplier(null);
    setFormName(prefill?.name || '');
    setFormPhone(prefill?.phone || '');
    setFormAddress(prefill?.address || '');
    setFormNote(prefill?.note || '');
    setFormWarehouse(
      lockedWarehouse || prefill?.warehouseName || warehouses[0] || 'Tâm An Mỹ Ngãi'
    );
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditSupplierModal = (profile: SupplierProfile) => {
    if (!canEdit) return;
    setEditingSupplier(profile);
    setFormName(profile.name);
    setFormPhone(profile.phone || '');
    setFormAddress(profile.address || '');
    setFormNote(profile.note || '');
    setFormWarehouse(
      lockedWarehouse || profile.warehouseName || warehouses[0] || 'Tâm An Mỹ Ngãi'
    );
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSubmitSupplierForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setFormError('Vui lòng nhập Tên Nhà cung cấp.');
      return;
    }
    const saved = onSaveSupplier(
      {
        code: generateUniqueSupplierCodeFromName(
          formName.trim(),
          suppliers,
          editingSupplier?.id
        ),
        name: formName.trim(),
        phone: formPhone.trim(),
        address: formAddress.trim(),
        note: formNote.trim(),
        warehouseName: lockedWarehouse || formWarehouse || warehouses[0] || 'Tâm An Mỹ Ngãi',
      },
      editingSupplier?.id
    );
    setSelectedKey(normalizeVietnameseSearch(saved.name));
    setIsModalOpen(false);
  };

  // FIFO Supplier Debt Settlement Modal
  const [isSettleOpen, setIsSettleOpen] = useState(false);
  const [settleAmountInput, setSettleAmountInput] = useState('');
  const [settleMethod, setSettleMethod] = useState('Chuyển khoản ngân hàng');
  const [settleNote, setSettleNote] = useState('');

  const fifoPreview = useMemo(() => {
    if (!isSettleOpen || !activeLedger) return null;
    return previewSupplierFifoDebtSettlement(
      imports,
      { supplierName: activeLedger.name, supplierPhone: activeLedger.phone },
      Number(settleAmountInput) || 0
    );
  }, [isSettleOpen, activeLedger, imports, settleAmountInput]);

  const handleExportSuppliersExcel = () => {
    const wb = XLSX.utils.book_new();
    const summaryRows = ledgers.map((l, idx) => ({
      STT: idx + 1,
      'Mã NCC': l.code,
      'Tên Nhà Cung Cấp': l.name,
      'Số Điện Thoại': l.phone,
      'Địa Chỉ': l.address,
      'Số Mặt Hàng Cung Cấp': l.suppliedProductsCount,
      'Số Phiếu Nhập': l.distinctReceiptCount,
      'Tổng Giá Trị Nhập (VNĐ)': l.totalImportedCost,
      'Đã Thanh Toán & Cấn Trừ (VNĐ)': l.totalPaidAmount,
      'Trong Đó Cấn Trừ Hàng Bán (VNĐ)': l.totalContraOffsetAmount,
      'Còn Nợ Phải Trả NCC (VNĐ)': l.totalRemainingDebt,
      'Nợ Quá Hạn (VNĐ)': l.overdueDebtAmount,
      'Ngày Nhập Gần Nhất': l.lastImportDate,
      'Ghi Chú': l.note,
    }));
    const ws1 = XLSX.utils.json_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, ws1, 'So_Nha_Cung_Cap');

    const priceRows = ledgers.flatMap((l) =>
      l.productPriceHistory.map((p) => ({
        'Mã NCC': l.code,
        'Nhà Cung Cấp': l.name,
        'Mã Vật Tư': p.productCode || '',
        'Tên Vật Tư': p.productName,
        ĐVT: p.unit,
        'Số Lần Nhập': p.importCount,
        'Tổng SL Nhập': p.totalQtyImported,
        'Giá Nhập Gần Nhất (VNĐ)': p.latestUnitCost,
        'Ngày Nhập Gần Nhất': p.latestDate,
        'Giá Nhập Lần Trước (VNĐ)': p.previousUnitCost ?? '',
        'Chênh Lệch So Lần Trước (VNĐ)': p.costDelta,
        'Giá Nhập Thấp Nhất (VNĐ)': p.minUnitCost,
        'Giá Nhập Cao Nhất (VNĐ)': p.maxUnitCost,
        'Giá Bán Lẻ Hiện Tại (VNĐ)': p.currentSellPrice ?? '',
      }))
    );
    if (priceRows.length > 0) {
      const ws2 = XLSX.utils.json_to_sheet(priceRows);
      XLSX.utils.book_append_sheet(wb, ws2, 'Lich_Su_Gia_Nhap_NCC');
    }
    XLSX.writeFile(wb, `So_Chi_Tiet_Nha_Cung_Cap_${todayStr}.xlsx`);
  };

  // Global KPIs
  const totalSuppliersCount = ledgers.length;
  const indebtedSuppliersCount = ledgers.filter((l) => l.totalRemainingDebt > 0).length;
  const grandTotalImported = ledgers.reduce((s, l) => s + l.totalImportedCost, 0);
  const grandTotalPaid = ledgers.reduce((s, l) => s + l.totalPaidAmount, 0);
  const grandTotalContra = ledgers.reduce((s, l) => s + l.totalContraOffsetAmount, 0);
  const grandTotalDebt = ledgers.reduce((s, l) => s + l.totalRemainingDebt, 0);
  const grandOverdueDebt = ledgers.reduce((s, l) => s + l.overdueDebtAmount, 0);

  return (
    <div className="space-y-5">
      {/* Top KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Tổng Danh Mục Nhà Cung Cấp</span>
            <Building2 className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="text-xl font-bold font-mono text-slate-900 mt-1.5">
            {totalSuppliersCount} NCC
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Đang còn công nợ: <strong className="text-amber-700">{indebtedSuppliersCount} NCC</strong>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Tổng Giá Trị Nhập Hàng</span>
            <Truck className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="text-xl font-bold font-mono text-slate-900 mt-1.5">
            {formatVND(grandTotalImported)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Tổng tiền hàng nhận từ các NCC
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Đã Thanh Toán &amp; Cấn Trừ</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="text-xl font-bold font-mono text-emerald-700 mt-1.5">
            {formatVND(grandTotalPaid)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {grandTotalContra > 0
              ? `Trong đó cấn trừ hàng bán: ${formatVND(grandTotalContra)}`
              : 'Chi tiền mặt / chuyển khoản NCC'}
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Tổng Nợ Phải Trả Nhà Cung Cấp</span>
            <Wallet className="w-4 h-4 text-rose-600" />
          </div>
          <div
            className={`text-xl font-bold font-mono mt-1.5 ${
              grandTotalDebt > 0 ? 'text-rose-600' : 'text-emerald-700'
            }`}
          >
            {formatVND(grandTotalDebt)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {grandOverdueDebt > 0 ? (
              <span className="text-rose-600 font-semibold">
                Quá hạn trả: {formatVND(grandOverdueDebt)}
              </span>
            ) : (
              'Tất cả khoản nợ trong hạn an toàn'
            )}
          </div>
        </div>
      </div>

      {/* Filter & Actions Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm tên NCC, mã NCC, SĐT hoặc tên vật tư cung cấp..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                { id: 'all', label: `Tất cả (${ledgers.length})` },
                { id: 'has_debt', label: `Đang nợ (${indebtedSuppliersCount})` },
                {
                  id: 'overdue',
                  label: `Quá hạn (${ledgers.filter((l) => l.overdueDebtAmount > 0).length})`,
                },
                {
                  id: 'settled',
                  label: `Hết nợ (${ledgers.filter((l) => l.totalRemainingDebt <= 0).length})`,
                },
              ] as Array<{ id: SupplierDebtFilter; label: string }>
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setDebtFilter(f.id)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                  debtFilter === f.id
                    ? 'bg-white text-emerald-800 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportSuppliersExcel}
            disabled={ledgers.length === 0}
            className="px-3 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 border border-emerald-200 rounded-lg inline-flex items-center gap-1.5"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Xuất Excel Sổ NCC</span>
          </button>
          <button
            type="button"
            onClick={() => openAddSupplierModal()}
            className="px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg inline-flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Thêm Nhà cung cấp mới</span>
          </button>
        </div>
      </div>

      {/* Master - Detail Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: Supplier List */}
        <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-700">
              Danh sách Nhà cung cấp ({filteredLedgers.length})
            </h2>
          </div>

          {filteredLedgers.length === 0 ? (
            <div className="p-8 text-center space-y-3">
              <div className="text-xs text-slate-500">
                Chưa có Nhà cung cấp nào khớp với bộ lọc hiện tại.
              </div>
              <button
                type="button"
                onClick={() => openAddSupplierModal()}
                className="px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg inline-flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Tạo Nhà cung cấp đầu tiên</span>
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-200 max-h-[70vh] overflow-y-auto">
              {filteredLedgers.map((item) => {
                const active = activeLedger?.key === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setSelectedKey(item.key)}
                    className={`w-full text-left p-3.5 transition-colors flex flex-col gap-1.5 ${
                      active
                        ? 'bg-emerald-50/80 border-l-4 border-l-emerald-600'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-slate-100 text-emerald-800 border border-slate-200 rounded">
                            {item.code}
                          </span>
                          <span className="text-sm font-bold text-slate-900 truncate">
                            {item.name}
                          </span>
                        </div>
                        <div className="text-xs font-mono text-slate-500 mt-0.5">
                          {item.phone || 'Chưa cập nhật SĐT'} · {item.suppliedProductsCount} mặt hàng
                        </div>
                      </div>

                      <span
                        className={`px-2 py-0.5 text-[11px] font-mono font-bold rounded-md shrink-0 ${
                          item.totalRemainingDebt > 0
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        }`}
                      >
                        {item.totalRemainingDebt > 0
                          ? `Nợ: ${formatVND(item.totalRemainingDebt)}`
                          : 'Không nợ'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100">
                      <span>
                        Đã nhập: <strong className="font-mono text-slate-700">{formatVND(item.totalImportedCost)}</strong>
                      </span>
                      <span>{item.distinctReceiptCount} phiếu PN</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Active Supplier Detail Ledger */}
        <div className="lg:col-span-8 bg-white rounded-xl border border-slate-200 overflow-hidden">
          {!activeLedger ? (
            <div className="p-10 text-center text-xs text-slate-500">
              Chọn một Nhà cung cấp ở cột bên trái để xem lịch sử giá nhập theo từng mặt hàng và sổ công nợ chi tiết.
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {/* Supplier Header & Quick Actions */}
              <div className="p-5 bg-slate-50/50 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2 py-0.5 text-xs font-mono font-bold bg-emerald-100 text-emerald-900 border border-emerald-300 rounded">
                        {activeLedger.code}
                      </span>
                      <h3 className="text-lg font-extrabold text-slate-900">
                        {activeLedger.name}
                      </h3>
                      {activeLedger.isImplicitFromImports && (
                        <span className="px-2 py-0.5 text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 rounded">
                          Tự tổng hợp từ phiếu nhập
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                      <span className="inline-flex items-center gap-1 font-mono">
                        <Phone className="w-3.5 h-3.5 text-slate-400" />
                        {activeLedger.phone || 'Chưa có SĐT'}
                      </span>
                      {activeLedger.address && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-slate-400" />
                          {activeLedger.address}
                        </span>
                      )}
                    </div>

                    {activeLedger.note && (
                      <p className="text-xs text-slate-600 italic pt-0.5">
                        Ghi chú: {activeLedger.note}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onQuickImportFromSupplier(activeLedger.name)}
                      className="px-3 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg inline-flex items-center gap-1"
                    >
                      <PackagePlus className="w-3.5 h-3.5" />
                      <span>Nhập hàng NCC này</span>
                    </button>

                    {activeLedger.totalRemainingDebt > 0 && (
                      <button
                        type="button"
                        onClick={() => onQuickSellOffsetToSupplier(activeLedger.key)}
                        className="px-3 py-1.5 text-xs font-bold text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg inline-flex items-center gap-1"
                        title="Xuất bán hàng lại cho Nhà cung cấp này để cấn trừ trực tiếp công nợ phải trả"
                      >
                        <ShoppingCart className="w-3.5 h-3.5" />
                        <span>Xuất hàng cấn trừ nợ</span>
                      </button>
                    )}

                    {activeLedger.totalRemainingDebt > 0 && onSettleSupplierTotalDebtFifo && (
                      <button
                        type="button"
                        onClick={() => {
                          setSettleAmountInput(String(activeLedger.totalRemainingDebt));
                          setSettleMethod('Chuyển khoản ngân hàng');
                          setSettleNote('');
                          setIsSettleOpen(true);
                        }}
                        className="px-3 py-1.5 text-xs font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg inline-flex items-center gap-1"
                      >
                        <Wallet className="w-3.5 h-3.5" />
                        <span>Trả nợ FIFO</span>
                      </button>
                    )}

                    {activeLedger.isImplicitFromImports ? (
                      <button
                        type="button"
                        onClick={() => openAddSupplierModal(activeLedger)}
                        className="px-2.5 py-1.5 text-xs font-semibold text-emerald-800 bg-white hover:bg-emerald-50 border border-emerald-300 rounded-lg"
                      >
                        + Lưu hồ sơ NCC
                      </button>
                    ) : canEdit && activeLedger.profile ? (
                      <>
                        <button
                          type="button"
                          onClick={() => openEditSupplierModal(activeLedger.profile!)}
                          className="p-1.5 text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg"
                          title="Sửa hồ sơ Nhà cung cấp"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => {
                              if (activeLedger.totalRemainingDebt > 0) {
                                window.alert(
                                  `Nhà cung cấp "${activeLedger.name}" đang còn công nợ phải trả ${formatVND(
                                    activeLedger.totalRemainingDebt
                                  )}. Vui lòng tất toán trước khi xóa hồ sơ!`
                                );
                                return;
                              }
                              if (
                                window.confirm(
                                  `Xác nhận xóa hồ sơ Nhà cung cấp "${activeLedger.name}"?`
                                )
                              ) {
                                onDeleteSupplier(activeLedger.profile!.id);
                              }
                            }}
                            className="p-1.5 text-rose-600 hover:text-rose-800 bg-rose-50 border border-rose-200 hover:bg-rose-100 rounded-lg"
                            title="Xóa hồ sơ Nhà cung cấp"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </>
                    ) : (
                      <span className="px-2 py-1 text-[11px] text-slate-400 inline-flex items-center gap-1">
                        <Lock className="w-3 h-3" />
                        <span>Khóa sửa/xóa</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Mini Financial Strip for Selected Supplier */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                  <div className="p-2.5 bg-white rounded-lg border border-slate-200">
                    <div className="text-[11px] text-slate-500">Tổng nhập lũy kế</div>
                    <div className="font-mono font-bold text-slate-900 mt-0.5">
                      {formatVND(activeLedger.totalImportedCost)}
                    </div>
                  </div>
                  <div className="p-2.5 bg-white rounded-lg border border-slate-200">
                    <div className="text-[11px] text-slate-500">Đã trả tiền mặt / CK</div>
                    <div className="font-mono font-bold text-emerald-700 mt-0.5">
                      {formatVND(
                        Math.max(0, activeLedger.totalPaidAmount - activeLedger.totalContraOffsetAmount)
                      )}
                    </div>
                  </div>
                  <div className="p-2.5 bg-white rounded-lg border border-slate-200">
                    <div className="text-[11px] text-slate-500">Cấn trừ hàng xuất bán</div>
                    <div className="font-mono font-bold text-indigo-700 mt-0.5">
                      {formatVND(activeLedger.totalContraOffsetAmount)}
                    </div>
                  </div>
                  <div className="p-2.5 bg-white rounded-lg border border-slate-200">
                    <div className="text-[11px] text-slate-500">Còn nợ phải trả NCC</div>
                    <div
                      className={`font-mono font-extrabold mt-0.5 ${
                        activeLedger.totalRemainingDebt > 0 ? 'text-rose-600' : 'text-emerald-700'
                      }`}
                    >
                      {formatVND(activeLedger.totalRemainingDebt)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Sub-tab Switcher */}
              <div className="px-5 py-2.5 bg-white flex flex-wrap items-center gap-1.5">
                {(
                  [
                    {
                      id: 'price_history',
                      label: `Bảng giá & Biến động giá nhập (${activeLedger.productPriceHistory.length})`,
                    },
                    {
                      id: 'imports',
                      label: `Lịch sử Phiếu nhập PN (${activeLedger.importReceipts.length})`,
                    },
                    {
                      id: 'payments',
                      label: `Thanh toán & Cấn trừ (${activeLedger.paymentHistory.length})`,
                    },
                  ] as Array<{ id: SupplierSubTab; label: string }>
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSubTab(t.id)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                      subTab === t.id
                        ? 'bg-emerald-700 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Sub-tab 1: Per-Product Import Price History & Trend */}
              {subTab === 'price_history' && (
                <div className="p-5 space-y-3">
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-600">
                    <span className="font-semibold flex items-center gap-1.5 text-slate-800">
                      <TrendingUp className="w-4 h-4 text-emerald-700" />
                      <span>
                        Theo dõi giá nhập gần nhất so với lần nhập trước của từng mặt hàng từ{' '}
                        <strong>{activeLedger.name}</strong>
                      </span>
                    </span>
                  </div>

                  {activeLedger.productPriceHistory.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 rounded-lg border border-slate-200">
                      Chưa có mặt hàng nào được nhập từ Nhà cung cấp này.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full min-w-[760px] text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-700">
                            <th className="py-2.5 px-3">Mặt hàng &amp; Tồn kho</th>
                            <th className="py-2.5 px-3 text-right">Tổng SL đã nhập</th>
                            <th className="py-2.5 px-3 text-right">Giá nhập gần nhất</th>
                            <th className="py-2.5 px-3 text-right">Biến động vs lần trước</th>
                            <th className="py-2.5 px-3 text-right">Thấp nhất – Cao nhất</th>
                            <th className="py-2.5 px-3 text-right">Giá bán lẻ hiện tại</th>
                            <th className="py-2.5 px-3 text-right">Thao tác</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {activeLedger.productPriceHistory.map((track) => (
                            <tr key={track.productKey} className="hover:bg-slate-50">
                              <td className="py-2.5 px-3">
                                <div className="font-bold text-slate-900">{track.productName}</div>
                                <div className="text-[11px] text-slate-500 font-mono flex flex-wrap items-center gap-1.5 mt-0.5">
                                  {track.productCode && <span>Mã: {track.productCode}</span>}
                                  <span>· ĐVT: {track.unit}</span>
                                  {track.currentStock !== null && (
                                    <span className="text-emerald-800 font-semibold">
                                      · Tồn: {track.currentStock} {track.unit}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono">
                                <div className="font-bold text-slate-900">
                                  {track.totalQtyImported} {track.unit}
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  {track.importCount} lần · {formatVND(track.totalValueImported)}
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono">
                                <div className="font-bold text-slate-900">
                                  {formatVND(track.latestUnitCost)}
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  {track.latestDate} ({track.latestReceiptCode})
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono">
                                {track.previousUnitCost === null ? (
                                  <span className="px-2 py-0.5 text-[10px] font-sans font-semibold bg-slate-100 text-slate-600 rounded">
                                    Mới nhập 1 lần
                                  </span>
                                ) : track.costDelta > 0 ? (
                                  <div className="inline-flex flex-col items-end text-rose-700 font-bold">
                                    <span className="inline-flex items-center gap-0.5">
                                      <ArrowUpRight className="w-3.5 h-3.5" />+{formatVND(track.costDelta)} (
                                      +{track.costDeltaPct}%)
                                    </span>
                                    <span className="text-[10px] font-normal text-slate-500">
                                      Trước: {formatVND(track.previousUnitCost)}
                                    </span>
                                  </div>
                                ) : track.costDelta < 0 ? (
                                  <div className="inline-flex flex-col items-end text-emerald-700 font-bold">
                                    <span className="inline-flex items-center gap-0.5">
                                      <ArrowDownRight className="w-3.5 h-3.5" />
                                      {formatVND(track.costDelta)} ({track.costDeltaPct}%)
                                    </span>
                                    <span className="text-[10px] font-normal text-slate-500">
                                      Trước: {formatVND(track.previousUnitCost)}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="inline-flex items-center gap-0.5 text-slate-600 font-semibold">
                                    <Minus className="w-3 h-3" /> Ổn định
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                                {track.minUnitCost === track.maxUnitCost
                                  ? formatVND(track.minUnitCost)
                                  : `${formatVND(track.minUnitCost)} – ${formatVND(track.maxUnitCost)}`}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono">
                                {track.currentSellPrice !== null ? (
                                  <span
                                    className={`font-bold ${
                                      track.currentSellPrice <= track.latestUnitCost &&
                                      track.latestUnitCost > 0
                                        ? 'text-rose-600'
                                        : 'text-emerald-800'
                                    }`}
                                  >
                                    {formatVND(track.currentSellPrice)}
                                  </span>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-right whitespace-nowrap">
                                <div className="inline-flex items-center gap-1">
                                  {track.productId && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onQuickImportFromSupplier(activeLedger.name, track.productId)
                                      }
                                      className="px-2 py-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded"
                                    >
                                      + Nhập tiếp
                                    </button>
                                  )}
                                  {track.productId && onNavigateCrossLink && (
                                    <CrossLinkChip
                                      tone="indigo"
                                      label="Thẻ kho"
                                      onClick={() =>
                                        onNavigateCrossLink({
                                          tab: 'inventory',
                                          recordId: track.productId,
                                          label: `Thẻ kho ${track.productName}`,
                                        })
                                      }
                                    />
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Sub-tab 2: Import Receipts History */}
              {subTab === 'imports' && (
                <div className="p-5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <Calendar className="w-3.5 h-3.5 text-slate-500" />
                      <input
                        type="date"
                        value={fromDate}
                        onChange={(e) => setFromDate(e.target.value)}
                        className="px-2 py-1 border border-slate-200 rounded font-mono text-xs"
                      />
                      <span>→</span>
                      <input
                        type="date"
                        value={toDate}
                        onChange={(e) => setToDate(e.target.value)}
                        className="px-2 py-1 border border-slate-200 rounded font-mono text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setFromDate(recent7.from);
                          setToDate(recent7.to);
                        }}
                        className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded font-semibold"
                      >
                        7 ngày
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setFromDate(currentMonth.from);
                          setToDate(currentMonth.to);
                        }}
                        className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded font-semibold"
                      >
                        Tháng này
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setFromDate('2020-01-01');
                          setToDate('2035-12-31');
                        }}
                        className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded font-semibold"
                      >
                        Toàn bộ
                      </button>
                    </div>

                    <label className="inline-flex items-center gap-1.5 font-semibold text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={onlyUnpaidReceipts}
                        onChange={(e) => setOnlyUnpaidReceipts(e.target.checked)}
                      />
                      <span>Chỉ hiện phiếu còn nợ</span>
                    </label>
                  </div>

                  {filteredSupplierImports.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 rounded-lg border border-slate-200">
                      Không có phiếu nhập kho nào trong khoảng thời gian đã chọn.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full min-w-[740px] text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-700">
                            <th className="py-2.5 px-3">Mã PN &amp; Ngày</th>
                            <th className="py-2.5 px-3">Vật tư nhập</th>
                            <th className="py-2.5 px-3 text-right">SL × Đơn giá</th>
                            <th className="py-2.5 px-3 text-right">Tổng tiền</th>
                            <th className="py-2.5 px-3 text-right">Đã trả / Còn nợ</th>
                            <th className="py-2.5 px-3 text-right">Liên kết</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {filteredSupplierImports.map((imp) => {
                            const urg = evaluateDebtUrgency(
                              imp.dueDate,
                              imp.debtAmount,
                              todayStr,
                              leadDays
                            );
                            return (
                              <tr key={imp.id} className="hover:bg-slate-50">
                                <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                                  <div className="font-bold text-slate-900">{imp.receiptCode}</div>
                                  <div className="text-[11px] text-slate-500">
                                    {(imp.createdAt || '').slice(0, 10)}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3">
                                  <div className="font-semibold text-slate-900">{imp.productName}</div>
                                  <div className="text-[11px] text-slate-500">
                                    Kho: {imp.warehouseName || 'Tâm An Mỹ Ngãi'}
                                    {imp.batchNumber ? ` · Lô: ${imp.batchNumber}` : ''}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono">
                                  {imp.quantity} {imp.unit} × {formatVND(imp.unitCost)}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                                  {formatVND(imp.totalCost)}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono">
                                  <div className="text-emerald-700">Trả: {formatVND(imp.paidAmount)}</div>
                                  {imp.debtAmount > 0 ? (
                                    <div
                                      className={`font-bold ${
                                        urg.urgency === 'overdue' ? 'text-rose-600' : 'text-amber-700'
                                      }`}
                                    >
                                      Nợ: {formatVND(imp.debtAmount)} ({imp.dueDate})
                                    </div>
                                  ) : (
                                    <div className="text-[11px] text-slate-500">Đã tất toán</div>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-right whitespace-nowrap">
                                  {onNavigateCrossLink && (
                                    <div className="inline-flex items-center gap-1">
                                      <CrossLinkChip
                                        tone="emerald"
                                        label={imp.receiptCode}
                                        onClick={() =>
                                          onNavigateCrossLink({
                                            tab: 'imports',
                                            recordId: imp.id,
                                            voucherCode: imp.receiptCode,
                                            label: `Phiếu nhập ${imp.receiptCode}`,
                                          })
                                        }
                                      />
                                      {imp.debtAmount > 0 && (
                                        <CrossLinkChip
                                          tone="amber"
                                          label="Công nợ"
                                          onClick={() =>
                                            onNavigateCrossLink({
                                              tab: 'debts',
                                              recordId: imp.id,
                                              subTab: 'supplier',
                                              label: `Công nợ ${imp.receiptCode}`,
                                            })
                                          }
                                        />
                                      )}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Sub-tab 3: Payments & Contra Offsets */}
              {subTab === 'payments' && (
                <div className="p-5 space-y-3">
                  {activeLedger.paymentHistory.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 rounded-lg border border-slate-200">
                      Chưa có phiếu chi thanh toán hoặc bút toán cấn trừ công nợ nào cho Nhà cung cấp này.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full min-w-[700px] text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-700">
                            <th className="py-2.5 px-3">Mã Phiếu Chi &amp; Ngày</th>
                            <th className="py-2.5 px-3">Hình thức</th>
                            <th className="py-2.5 px-3">Diễn giải &amp; Phân bổ FIFO</th>
                            <th className="py-2.5 px-3 text-right">Số tiền</th>
                            <th className="py-2.5 px-3 text-right">Mở chứng từ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {activeLedger.paymentHistory.map((pv) => {
                            const isContra = isContraOffsetVoucher(pv);
                            return (
                              <tr key={pv.id} className="hover:bg-slate-50">
                                <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                                  <div className="font-bold text-slate-900">{pv.voucherCode}</div>
                                  <div className="text-[11px] text-slate-500">
                                    {(pv.createdAt || '').slice(0, 10)}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3 whitespace-nowrap">
                                  <span
                                    className={`px-2 py-0.5 text-[11px] font-semibold rounded border ${
                                      isContra
                                        ? 'bg-indigo-50 text-indigo-800 border-indigo-200'
                                        : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                    }`}
                                  >
                                    {isContra ? 'Cấn trừ hàng xuất bán' : pv.paymentMethod}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 text-slate-700">
                                  <div>{pv.note}</div>
                                  {pv.settledAllocations && pv.settledAllocations.length > 0 && (
                                    <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                                      Trừ phiếu:{' '}
                                      {pv.settledAllocations
                                        .map((a) => `${a.code} (-${formatVND(a.allocatedAmount)})`)
                                        .join(' · ')}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-800 whitespace-nowrap">
                                  -{formatVND(pv.amount)}
                                </td>
                                <td className="py-2.5 px-3 text-right whitespace-nowrap">
                                  {onNavigateCrossLink && (
                                    <div className="inline-flex items-center gap-1">
                                      <CrossLinkChip
                                        tone="rose"
                                        label={pv.voucherCode}
                                        onClick={() =>
                                          onNavigateCrossLink({
                                            tab: 'payment_vouchers',
                                            recordId: pv.id,
                                            voucherCode: pv.voucherCode,
                                            label: `Phiếu chi ${pv.voucherCode}`,
                                          })
                                        }
                                      />
                                      {pv.linkedSaleIds?.[0] && (
                                        <CrossLinkChip
                                          tone="sky"
                                          label={pv.linkedSaleInvoiceCode || 'HĐ xuất'}
                                          onClick={() =>
                                            onNavigateCrossLink({
                                              tab: 'sales',
                                              recordId: pv.linkedSaleIds![0],
                                              voucherCode: pv.linkedSaleInvoiceCode,
                                              label: `Hóa đơn ${pv.linkedSaleInvoiceCode || ''}`,
                                            })
                                          }
                                        />
                                      )}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add / Edit Supplier Modal */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={editingSupplier ? 'Cập nhật Nhà cung cấp' : 'Thêm Nhà cung cấp mới'}
        >
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-emerald-700" />
                <span>
                  {editingSupplier ? 'Chỉnh sửa hồ sơ Nhà cung cấp' : 'Thêm Nhà cung cấp mới'}
                </span>
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitSupplierForm} className="p-5 space-y-3.5 text-xs">
              {formError && (
                <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 flex items-center gap-1.5 font-semibold">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="flex items-center gap-1 font-semibold text-slate-700 mb-1">
                    <Lock className="w-3 h-3 text-slate-500" /> Mã NCC (Tự sinh)
                  </label>
                  <input
                    type="text"
                    readOnly
                    tabIndex={-1}
                    value={generateUniqueSupplierCodeFromName(
                      formName,
                      suppliers,
                      editingSupplier?.id,
                      true
                    )}
                    placeholder="VD: GNHAT"
                    className="w-full px-3 py-2 font-mono font-bold bg-slate-100 text-emerald-800 border border-slate-200 rounded-lg cursor-not-allowed"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">
                    Tên Nhà cung cấp / Công ty phân phối *
                  </label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="VD: Công ty CP Phân bón Bình Điền / GAP Nhất"
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Số điện thoại liên hệ
                  </label>
                  <input
                    type="tel"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    placeholder="VD: 0393120246"
                    className="w-full px-3 py-2 font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
                {!lockedWarehouse && (
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Kho giao dịch chính
                    </label>
                    <select
                      value={formWarehouse}
                      onChange={(e) => setFormWarehouse(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg"
                    >
                      {warehouses.map((w) => (
                        <option key={w} value={w}>
                          {w}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Địa chỉ kho / Văn phòng NCC
                </label>
                <input
                  type="text"
                  value={formAddress}
                  onChange={(e) => setFormAddress(e.target.value)}
                  placeholder="VD: KCN Sa Đéc, Đồng Tháp..."
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Ghi chú chính sách chiết khấu / mặt hàng chủ lực
                </label>
                <textarea
                  rows={2}
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  placeholder="VD: Chiết khấu cuối quý 3%, chuyên thuốc trừ nấm & phân bón lá..."
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                >
                  {editingSupplier ? 'Lưu cập nhật' : 'Lưu hồ sơ Nhà cung cấp'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* FIFO Supplier Debt Settlement Modal */}
      {isSettleOpen && activeLedger && onSettleSupplierTotalDebtFifo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Quyết toán công nợ Nhà cung cấp theo FIFO"
        >
          <div className="bg-white rounded-2xl border border-amber-200 shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Chi Quyết Toán Nợ NCC ({activeLedger.name})
                </h3>
                <p className="text-[11px] text-amber-900 mt-0.5">
                  Tự động trừ vào phiếu nhập nợ cũ nhất trước (FIFO) &amp; lập phiếu chi PC-...
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSettleOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const amt = Math.max(0, Math.round(Number(settleAmountInput) || 0));
                if (amt <= 0) return;
                onSettleSupplierTotalDebtFifo({
                  supplierName: activeLedger.name,
                  supplierPhone: activeLedger.phone,
                  totalAmount: amt,
                  groupName: paymentGroups[0] || 'Chi trả nợ Nhà cung cấp',
                  paymentMethod: settleMethod,
                  note: settleNote.trim(),
                  warehouseName: lockedWarehouse || activeLedger.warehouseName,
                });
                setIsSettleOpen(false);
              }}
              className="p-5 space-y-3.5 text-xs"
            >
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
                <span className="font-semibold text-slate-700">Tổng dư nợ hiện tại:</span>
                <span className="font-mono font-extrabold text-sm text-rose-600">
                  {formatVND(activeLedger.totalRemainingDebt)}
                </span>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Số tiền chi trả đợt này (VNĐ) *
                </label>
                <input
                  type="number"
                  min={1}
                  max={activeLedger.totalRemainingDebt}
                  required
                  value={settleAmountInput}
                  onChange={(e) => setSettleAmountInput(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono font-bold bg-white border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Hình thức chi trả
                </label>
                <select
                  value={settleMethod}
                  onChange={(e) => setSettleMethod(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg"
                >
                  <option value="Chuyển khoản ngân hàng">Chuyển khoản ngân hàng</option>
                  <option value="Tiền mặt">Tiền mặt</option>
                </select>
              </div>

              {fifoPreview && fifoPreview.allocations.some((a) => a.allocatedAmount > 0) && (
                <div className="p-2.5 bg-emerald-50/70 border border-emerald-200 rounded-lg space-y-1">
                  <div className="font-bold text-emerald-900">
                    Dự kiến trừ vào các phiếu nhập:
                  </div>
                  {fifoPreview.allocations
                    .filter((a) => a.allocatedAmount > 0)
                    .map((a) => (
                      <div key={a.recordId} className="flex justify-between font-mono text-[11px]">
                        <span>
                          {a.code} ({a.date})
                        </span>
                        <span className="text-emerald-800 font-semibold">
                          -{formatVND(a.allocatedAmount)} → còn {formatVND(a.remainingDebt)}
                        </span>
                      </div>
                    ))}
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Ghi chú phiếu chi</label>
                <input
                  type="text"
                  value={settleNote}
                  onChange={(e) => setSettleNote(e.target.value)}
                  placeholder="VD: Chuyển khoản tất toán đợt hàng tháng 11..."
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsSettleOpen(false)}
                  className="px-3.5 py-2 font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                >
                  Xác nhận chi trả &amp; Lưu phiếu PC
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

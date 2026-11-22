import React, { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Edit3,
  FileDown,
  FolderPlus,
  Layers,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Trash2,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react';
import {
  CashPaymentVoucher,
  CashReceiptVoucher,
  CustomerGroup,
  CustomerProfile,
  ImportTransaction,
  SaleTransaction,
  SupplierProfile,
  UserRole,
} from '../types';
import {
  formatVND,
  normalizeVietnameseSearch,
  previewCustomerFifoDebtSettlement,
  previewSupplierFifoDebtSettlement,
  SearchableOptionItem,
} from '../utils/businessLogic';
import {
  exportCustomerReceiptPDF,
  exportSupplierPaymentPDF,
} from '../utils/exportReports';
import { SearchableSelect } from './SearchableSelect';

export interface CreateReceiptVoucherInput {
  warehouseName: string;
  groupName: string;
  isDebtSettlement: boolean;
  customerId?: string;
  partnerName: string;
  partnerPhone: string;
  amount: number;
  paymentMethod: string;
  countsTowardOtherIncome: boolean;
  note: string;
}

export interface CreatePaymentVoucherInput {
  warehouseName: string;
  groupName: string;
  isDebtSettlement: boolean;
  partnerName: string;
  partnerPhone: string;
  amount: number;
  paymentMethod: string;
  countsTowardOperatingExpense: boolean;
  note: string;
}

interface ReceiptVoucherLogViewProps {
  receiptVouchers: CashReceiptVoucher[];
  receiptGroups: string[];
  customers: CustomerProfile[];
  customerGroups: CustomerGroup[];
  sales: SaleTransaction[];
  warehouses: string[];
  selectedWarehouse: string | null;
  role: UserRole;
  canEditDelete?: boolean;
  onAddWarehouse: (name: string) => void;
  onAddReceiptGroup: (groupName: string) => void;
  onCreateReceiptVoucher: (input: CreateReceiptVoucherInput) => void;
  onUpdateReceiptVoucher: (
    voucherId: string,
    changes: {
      voucherCode: string;
      groupName: string;
      warehouseName: string;
      partnerName: string;
      partnerPhone: string;
      amount: number;
      paymentMethod: string;
      note: string;
    }
  ) => void;
  onDeleteReceiptVoucher: (voucherId: string) => void;
  onAddCustomer: (input: {
    name: string;
    phone: string;
    email: string;
    address: string;
    group: CustomerGroup;
    note: string;
  }) => CustomerProfile;
  onAddCustomerGroup: (groupName: string) => void;
}

export const ReceiptVoucherLogView: React.FC<ReceiptVoucherLogViewProps> = ({
  receiptVouchers,
  receiptGroups,
  customers,
  customerGroups,
  sales,
  warehouses,
  selectedWarehouse,
  role,
  canEditDelete,
  onAddWarehouse,
  onAddReceiptGroup,
  onCreateReceiptVoucher,
  onUpdateReceiptVoucher,
  onDeleteReceiptVoucher,
  onAddCustomer,
}) => {
  const isManager = canEditDelete !== undefined ? canEditDelete : role === 'manager';

  const [warehouseName, setWarehouseName] = useState<string>(
    selectedWarehouse || warehouses[0] || 'Tâm An Mỹ Ngãi'
  );
  const [showNewWarehouseInput, setShowNewWarehouseInput] = useState(false);
  const [newWarehouseInput, setNewWarehouseInput] = useState('');

  const [groupName, setGroupName] = useState<string>(
    receiptGroups[0] || 'Thu nợ bán hàng khách hàng'
  );
  const [showNewGroupInput, setShowNewGroupInput] = useState(false);
  const [newGroupInput, setNewGroupInput] = useState('');

  const [isDebtSettlement, setIsDebtSettlement] = useState<boolean>(true);
  const [customerId, setCustomerId] = useState<string>('');
  const [partnerName, setPartnerName] = useState<string>('');
  const [partnerPhone, setPartnerPhone] = useState<string>('');
  const [amountInput, setAmountInput] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<string>('Chuyển khoản ngân hàng');
  const [countsTowardOtherIncome, setCountsTowardOtherIncome] = useState<boolean>(true);
  const [note, setNote] = useState<string>('');
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(
    null
  );

  // Quick Add Customer inline state
  const [showQuickCustomer, setShowQuickCustomer] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustGroup, setNewCustGroup] = useState<CustomerGroup>(
    customerGroups[0] || 'Nhà nông'
  );
  const [newCustAddress, setNewCustAddress] = useState('');

  // Filter & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState<string>('all');

  // Edit & Delete Modals
  const [editingVoucher, setEditingVoucher] = useState<CashReceiptVoucher | null>(null);
  const [editCode, setEditCode] = useState('');
  const [editGroup, setEditGroup] = useState('');
  const [editWarehouse, setEditWarehouse] = useState('');
  const [editPartnerName, setEditPartnerName] = useState('');
  const [editPartnerPhone, setEditPartnerPhone] = useState('');
  const [editAmount, setEditAmount] = useState(0);
  const [editPaymentMethod, setEditPaymentMethod] = useState('Tiền mặt');
  const [editNote, setEditNote] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId) || null,
    [customers, customerId]
  );

  const numericAmount = Math.max(0, Math.round(Number(amountInput) || 0));

  // FIFO debt settlement preview for selected customer
  const fifoPreview = useMemo(() => {
    if (!isDebtSettlement || !selectedCustomer) {
      return null;
    }
    return previewCustomerFifoDebtSettlement(
      sales,
      {
        customerId: selectedCustomer.id,
        customerPhone: selectedCustomer.phone,
        customerName: selectedCustomer.name,
      },
      numericAmount
    );
  }, [isDebtSettlement, selectedCustomer, sales, numericAmount]);

  const warehouseOptions: SearchableOptionItem[] = useMemo(
    () =>
      warehouses.map((w) => ({
        value: w,
        label: `Kho: ${w}`,
        subLabel: 'Chi nhánh kho vật tư Tâm An',
      })),
    [warehouses]
  );

  const receiptGroupOptions: SearchableOptionItem[] = useMemo(
    () =>
      receiptGroups.map((g) => ({
        value: g,
        label: g,
        subLabel: 'Nhóm phiếu thu tiền',
      })),
    [receiptGroups]
  );

  const customerOptions: SearchableOptionItem[] = useMemo(
    () =>
      customers.map((c) => {
        const preview = previewCustomerFifoDebtSettlement(
          sales,
          { customerId: c.id, customerPhone: c.phone, customerName: c.name },
          0
        );
        return {
          value: c.id,
          label: `${c.name} (${c.phone || 'Chưa có SĐT'})`,
          subLabel: `${c.group} · ${c.address || 'Chưa cập nhật địa chỉ'}`,
          badge:
            preview.totalPreviousDebt > 0
              ? `Tổng nợ (${preview.unpaidInvoicesOrdered.length} HĐ): ${formatVND(preview.totalPreviousDebt)}`
              : 'Không nợ',
          keywords: `${c.code} ${c.phone} ${c.group}`,
        };
      }),
    [customers, sales]
  );

  const handleSelectCustomer = (id: string) => {
    setCustomerId(id);
    const found = customers.find((c) => c.id === id);
    if (found) {
      setPartnerName(found.name);
      setPartnerPhone(found.phone);
      const preview = previewCustomerFifoDebtSettlement(
        sales,
        { customerId: found.id, customerPhone: found.phone, customerName: found.name },
        0
      );
      if (isDebtSettlement && preview.totalPreviousDebt > 0) {
        setAmountInput(String(preview.totalPreviousDebt));
      }
    }
  };

  const handleCreateNewGroup = () => {
    const clean = newGroupInput.trim();
    if (!clean) return;
    onAddReceiptGroup(clean);
    setGroupName(clean);
    setNewGroupInput('');
    setShowNewGroupInput(false);
    setFeedback({
      type: 'success',
      text: `Đã tạo nhóm phiếu thu mới "${clean}" và chọn vào phiếu thu!`,
    });
  };

  const handleQuickCreateCustomer = () => {
    if (!newCustName.trim() || !newCustPhone.trim()) {
      setFeedback({ type: 'error', text: 'Vui lòng nhập họ tên và SĐT khách hàng mới.' });
      return;
    }
    const created = onAddCustomer({
      name: newCustName.trim(),
      phone: newCustPhone.trim(),
      email: '',
      address: newCustAddress.trim() || 'Đồng Tháp',
      group: newCustGroup,
      note: 'Tạo nhanh từ Nhật ký Phiếu thu tiền',
    });
    setCustomerId(created.id);
    setPartnerName(created.name);
    setPartnerPhone(created.phone);
    setNewCustName('');
    setNewCustPhone('');
    setNewCustAddress('');
    setShowQuickCustomer(false);
    setFeedback({
      type: 'success',
      text: `Đã thêm khách hàng "${created.name}" và chọn vào phiếu thu!`,
    });
  };

  const handleClearForm = () => {
    setCustomerId('');
    setPartnerName('');
    setPartnerPhone('');
    setAmountInput('');
    setNote('');
    setFeedback(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (!groupName.trim()) {
      setFeedback({ type: 'error', text: 'Vui lòng chọn hoặc tạo Nhóm phiếu thu.' });
      return;
    }

    if (isDebtSettlement) {
      if (!selectedCustomer) {
        setFeedback({
          type: 'error',
          text: 'Vui lòng chọn Khách hàng cần thu tiền quyết toán tổng công nợ.',
        });
        return;
      }
      if (!fifoPreview || fifoPreview.totalPreviousDebt <= 0) {
        setFeedback({
          type: 'error',
          text: `Khách hàng "${selectedCustomer.name}" hiện không có hóa đơn nào còn nợ để trừ quyết toán. Bạn có thể chuyển sang chế độ "Thu tiền khác / Thu ngoài công nợ".`,
        });
        return;
      }
      if (numericAmount <= 0) {
        setFeedback({
          type: 'error',
          text: 'Vui lòng nhập số tiền tổng khách thanh toán lớn hơn 0 đ.',
        });
        return;
      }
      const effectiveAmount = Math.min(numericAmount, fifoPreview.totalPreviousDebt);
      onCreateReceiptVoucher({
        warehouseName,
        groupName: groupName.trim(),
        isDebtSettlement: true,
        customerId: selectedCustomer.id,
        partnerName: selectedCustomer.name,
        partnerPhone: selectedCustomer.phone,
        amount: effectiveAmount,
        paymentMethod,
        countsTowardOtherIncome: false,
        note:
          note.trim() ||
          `Thu quyết toán tổng công nợ theo thứ tự ngày nợ (${fifoPreview.allocations.filter((a) => a.allocatedAmount > 0).length} hóa đơn)`,
      });
      setAmountInput('');
      setNote('');
      setFeedback({
        type: 'success',
        text: `Đã lưu Phiếu thu tiền ${formatVND(effectiveAmount)} cho "${selectedCustomer.name}" và tự động trừ quyết toán vào ${
          fifoPreview.allocations.filter((a) => a.allocatedAmount > 0).length
        } hóa đơn nợ cũ theo thứ tự ngày nợ!`,
      });
    } else {
      const targetPartnerName = (partnerName || selectedCustomer?.name || '').trim();
      const targetPartnerPhone = (partnerPhone || selectedCustomer?.phone || '').trim();
      if (!targetPartnerName) {
        setFeedback({
          type: 'error',
          text: 'Vui lòng nhập tên người nộp tiền hoặc chọn đối tác.',
        });
        return;
      }
      if (numericAmount <= 0) {
        setFeedback({
          type: 'error',
          text: 'Vui lòng nhập số tiền thu lớn hơn 0 đ.',
        });
        return;
      }
      onCreateReceiptVoucher({
        warehouseName,
        groupName: groupName.trim(),
        isDebtSettlement: false,
        customerId: selectedCustomer?.id,
        partnerName: targetPartnerName,
        partnerPhone: targetPartnerPhone,
        amount: numericAmount,
        paymentMethod,
        countsTowardOtherIncome,
        note: note.trim() || `Thu tiền thuộc nhóm: ${groupName.trim()}`,
      });
      setAmountInput('');
      setNote('');
      setFeedback({
        type: 'success',
        text: `Đã ghi nhận Phiếu thu tiền ${formatVND(numericAmount)} (${groupName}) vào sổ Nhật ký Phiếu thu & Báo cáo dòng tiền!`,
      });
    }
  };

  const filteredVouchers = useMemo(() => {
    const q = normalizeVietnameseSearch(searchQuery);
    return receiptVouchers.filter((rv) => {
      if (groupFilter !== 'all' && rv.groupName !== groupFilter) return false;
      if (!q) return true;
      const allocCodes = (rv.settledAllocations || []).map((a) => a.code).join(' ');
      const haystack = normalizeVietnameseSearch(
        `${rv.voucherCode} ${rv.groupName} ${rv.partnerName} ${rv.partnerPhone} ${rv.warehouseName} ${rv.note} ${allocCodes}`
      );
      return haystack.includes(q);
    });
  }, [receiptVouchers, groupFilter, searchQuery]);

  const groupSummaries = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const rv of filteredVouchers) {
      const curr = map.get(rv.groupName) || { count: 0, total: 0 };
      curr.count += 1;
      curr.total += rv.amount;
      map.set(rv.groupName, curr);
    }
    return Array.from(map.entries()).map(([name, data]) => ({
      name,
      count: data.count,
      total: data.total,
    }));
  }, [filteredVouchers]);

  const totalReceiptAmount = useMemo(
    () => filteredVouchers.reduce((sum, rv) => sum + rv.amount, 0),
    [filteredVouchers]
  );

  const openEditModal = (rv: CashReceiptVoucher) => {
    setEditingVoucher(rv);
    setEditCode(rv.voucherCode);
    setEditGroup(rv.groupName);
    setEditWarehouse(rv.warehouseName);
    setEditPartnerName(rv.partnerName);
    setEditPartnerPhone(rv.partnerPhone);
    setEditAmount(rv.amount);
    setEditPaymentMethod(rv.paymentMethod);
    setEditNote(rv.note);
  };

  return (
    <div className="space-y-6">
      {/* Top Summary Banner */}
      <div className="bg-white rounded-xl border border-stone-200/80 shadow-xs p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-md">
              <ArrowDownLeft className="w-3.5 h-3.5" />
              Sổ Quỹ & Quyết Toán Công Nợ Phải Thu Tự Động Theo Ngày Nợ
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="bg-emerald-50/90 border border-emerald-200 rounded-xl px-4 py-2.5">
              <p className="text-[11px] font-medium text-emerald-800">
                Tổng tiền thu ({filteredVouchers.length} phiếu)
              </p>
              <p className="text-lg font-bold font-mono tabular-nums text-emerald-900">
                {formatVND(totalReceiptAmount)}
              </p>
            </div>
            <div className="bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5">
              <p className="text-[11px] font-medium text-stone-500">Số nhóm phiếu thu</p>
              <p className="text-base font-bold font-mono text-stone-900">
                {receiptGroups.length} nhóm
              </p>
            </div>
          </div>
        </div>

        {/* Group Summary Strip */}
        {groupSummaries.length > 0 && (
          <div className="mt-4 pt-3.5 border-t border-stone-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {groupSummaries.map((gs) => (
              <button
                key={gs.name}
                type="button"
                onClick={() => setGroupFilter(groupFilter === gs.name ? 'all' : gs.name)}
                className={`text-left p-2.5 rounded-lg border transition-colors ${
                  groupFilter === gs.name
                    ? 'bg-emerald-900 text-white border-emerald-900'
                    : 'bg-stone-50/80 hover:bg-emerald-50/50 border-stone-200/80 text-stone-800'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold truncate">{gs.name}</span>
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      groupFilter === gs.name
                        ? 'bg-emerald-800 text-emerald-100'
                        : 'bg-stone-200/70 text-stone-700'
                    }`}
                  >
                    {gs.count} phiếu
                  </span>
                </div>
                <p
                  className={`text-sm font-bold font-mono tabular-nums mt-1 ${
                    groupFilter === gs.name ? 'text-emerald-200' : 'text-emerald-800'
                  }`}
                >
                  +{formatVND(gs.total)}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Create Receipt Voucher Form */}
        <div className="lg:col-span-5 bg-white rounded-xl border border-stone-200/80 shadow-xs overflow-hidden">
          <div className="px-5 py-4 border-b border-stone-100 bg-emerald-950/3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-emerald-800" />
              <h3 className="text-sm font-semibold text-stone-900">
                Lập Phiếu Thu Tiền Mới
              </h3>
            </div>
            <button
              type="button"
              onClick={handleClearForm}
              className="inline-flex items-center gap-1 text-xs font-medium text-stone-500 hover:text-stone-800 px-2 py-1 rounded border border-stone-200 bg-white hover:bg-stone-50 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              Làm trống
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {feedback && (
              <div
                className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 border ${
                  feedback.type === 'error'
                    ? 'bg-red-50 text-red-800 border-red-200'
                    : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                }`}
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{feedback.text}</span>
              </div>
            )}

            {/* Warehouse Selector */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-stone-700">
                  Chọn kho lập phiếu thu <span className="text-red-600">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowNewWarehouseInput(!showNewWarehouseInput)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 hover:text-emerald-950"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  {showNewWarehouseInput ? 'Đóng' : '+ Tạo thêm kho mới'}
                </button>
              </div>
              <SearchableSelect
                options={warehouseOptions}
                value={warehouseName}
                onChange={(val) => setWarehouseName(val || warehouses[0] || 'Tâm An Mỹ Ngãi')}
                placeholder="Gõ tên kho..."
              />
              {showNewWarehouseInput && (
                <div className="mt-2 p-2.5 rounded-lg bg-emerald-50/70 border border-emerald-200 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <input
                    type="text"
                    value={newWarehouseInput}
                    onChange={(e) => setNewWarehouseInput(e.target.value)}
                    placeholder="Nhập tên kho mới..."
                    className="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-white border border-emerald-300 rounded-md"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const clean = newWarehouseInput.trim();
                      if (!clean) return;
                      onAddWarehouse(clean);
                      setWarehouseName(clean);
                      setNewWarehouseInput('');
                      setShowNewWarehouseInput(false);
                    }}
                    className="px-3 py-1.5 text-xs font-semibold bg-emerald-800 text-white rounded-md hover:bg-emerald-900 whitespace-nowrap"
                  >
                    Lưu kho
                  </button>
                </div>
              )}
            </div>

            {/* Receipt Group Selector + Create New Group */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-stone-700">
                  1. Chọn Nhóm phiếu thu <span className="text-red-600">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowNewGroupInput(!showNewGroupInput)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 hover:text-emerald-950"
                >
                  <Layers className="w-3.5 h-3.5" />
                  {showNewGroupInput ? 'Đóng' : '+ Tạo nhóm phiếu thu mới'}
                </button>
              </div>
              <SearchableSelect
                options={receiptGroupOptions}
                value={groupName}
                onChange={(val) => setGroupName(val || receiptGroups[0] || 'Thu nợ bán hàng khách hàng')}
                placeholder="Chọn hoặc tìm nhóm phiếu thu..."
              />
              {showNewGroupInput && (
                <div className="mt-2 p-3 rounded-lg bg-emerald-50/80 border border-emerald-200 space-y-2">
                  <p className="text-[11px] font-semibold text-emerald-900">
                    Tạo Nhóm Phiếu Thu Mới (VD: Thu nợ vụ Đông Xuân, Thu lãi tiền gửi, Thu bán phế liệu...)
                  </p>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <input
                      type="text"
                      value={newGroupInput}
                      onChange={(e) => setNewGroupInput(e.target.value)}
                      placeholder="Nhập tên nhóm phiếu thu mới..."
                      className="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-white border border-emerald-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                    <button
                      type="button"
                      onClick={handleCreateNewGroup}
                      className="px-3 py-1.5 text-xs font-semibold bg-emerald-800 text-white rounded-md hover:bg-emerald-900 shrink-0 whitespace-nowrap"
                    >
                      Lưu nhóm
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Mode Switch: FIFO Debt Settlement vs Other Receipt */}
            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1.5">
                2. Chế độ hạch toán phiếu thu
              </label>
              <div className="grid grid-cols-2 gap-2 p-1 bg-stone-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => {
                    setIsDebtSettlement(true);
                    setGroupName('Thu nợ bán hàng khách hàng');
                  }}
                  className={`py-2 px-2.5 text-xs font-semibold rounded-md transition-all ${
                    isDebtSettlement
                      ? 'bg-emerald-800 text-white shadow-xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  Thu quyết toán nợ KH
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsDebtSettlement(false);
                    if (groupName === 'Thu nợ bán hàng khách hàng' && receiptGroups.length > 2) {
                      setGroupName(receiptGroups[2]);
                    }
                  }}
                  className={`py-2 px-2.5 text-xs font-semibold rounded-md transition-all ${
                    !isDebtSettlement
                      ? 'bg-emerald-800 text-white shadow-xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  Thu tiền khác / Chiết khấu NCC
                </button>
              </div>
            </div>

            {/* Customer / Partner Selection */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-stone-700">
                  3. {isDebtSettlement ? 'Chọn khách hàng cần thu nợ *' : 'Chọn khách hàng / Đối tác nộp tiền'}
                </label>
                <button
                  type="button"
                  onClick={() => setShowQuickCustomer(!showQuickCustomer)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 hover:text-emerald-950"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  {showQuickCustomer ? 'Đóng' : '+ Tạo khách hàng mới'}
                </button>
              </div>

              <SearchableSelect
                options={customerOptions}
                value={customerId}
                onChange={handleSelectCustomer}
                placeholder="Gõ tên khách hàng, SĐT để xem tổng nợ..."
              />

              {showQuickCustomer && (
                <div className="mt-2.5 p-3.5 rounded-lg bg-emerald-50/70 border border-emerald-200 space-y-2.5">
                  <p className="text-xs font-semibold text-emerald-950">Thêm nhanh hồ sơ khách hàng</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={newCustName}
                      onChange={(e) => setNewCustName(e.target.value)}
                      placeholder="Họ tên khách hàng *"
                      className="px-2.5 py-1.5 text-xs bg-white border border-stone-300 rounded-md"
                    />
                    <input
                      type="text"
                      value={newCustPhone}
                      onChange={(e) => setNewCustPhone(e.target.value)}
                      placeholder="Số điện thoại *"
                      className="px-2.5 py-1.5 text-xs bg-white border border-stone-300 rounded-md"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={newCustGroup}
                      onChange={(e) => setNewCustGroup(e.target.value)}
                      className="px-2.5 py-1.5 text-xs bg-white border border-stone-300 rounded-md"
                    >
                      {customerGroups.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={newCustAddress}
                      onChange={(e) => setNewCustAddress(e.target.value)}
                      placeholder="Địa chỉ (Ấp, Xã...)"
                      className="px-2.5 py-1.5 text-xs bg-white border border-stone-300 rounded-md"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleQuickCreateCustomer}
                      className="px-3 py-1.5 text-xs font-semibold bg-emerald-800 text-white rounded-md hover:bg-emerald-900"
                    >
                      Lưu & Chọn khách hàng
                    </button>
                  </div>
                </div>
              )}

              {!isDebtSettlement && (
                <div className="grid grid-cols-2 gap-2 mt-2.5">
                  <div>
                    <label className="block text-[11px] font-medium text-stone-600 mb-1">
                      Tên người nộp / Đơn vị *
                    </label>
                    <input
                      type="text"
                      value={partnerName}
                      onChange={(e) => setPartnerName(e.target.value)}
                      placeholder="Nhập tên người nộp..."
                      className="w-full px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-stone-600 mb-1">
                      Số điện thoại
                    </label>
                    <input
                      type="text"
                      value={partnerPhone}
                      onChange={(e) => setPartnerPhone(e.target.value)}
                      placeholder="SĐT liên hệ..."
                      className="w-full px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-lg font-mono"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* FIFO Debt Allocation Live Preview Box when Customer is selected */}
            {isDebtSettlement && selectedCustomer && fifoPreview && (
              <div className="p-3.5 rounded-xl bg-amber-50/90 border border-amber-300 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold text-amber-950">
                      Tổng công nợ phải thu ({selectedCustomer.name}):
                    </p>
                    <p className="text-[11px] text-amber-800">
                      {fifoPreview.unpaidInvoicesOrdered.length} hóa đơn đang nợ (Sắp xếp từ ngày nợ cũ nhất)
                    </p>
                  </div>
                  <span className="text-base font-bold font-mono tabular-nums text-red-700">
                    {formatVND(fifoPreview.totalPreviousDebt)}
                  </span>
                </div>

                {fifoPreview.totalPreviousDebt > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setAmountInput(String(fifoPreview.totalPreviousDebt))}
                      className="px-2.5 py-1 text-[11px] font-semibold bg-emerald-800 text-white rounded-md hover:bg-emerald-900"
                    >
                      Thu tất toán 100% ({formatVND(fifoPreview.totalPreviousDebt)})
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setAmountInput(String(Math.round(fifoPreview.totalPreviousDebt / 2)))
                      }
                      className="px-2.5 py-1 text-[11px] font-semibold bg-white text-amber-900 border border-amber-300 rounded-md hover:bg-amber-100"
                    >
                      Thu 50% ({formatVND(Math.round(fifoPreview.totalPreviousDebt / 2))})
                    </button>
                    {fifoPreview.unpaidInvoicesOrdered.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setAmountInput(String(fifoPreview.unpaidInvoicesOrdered[0].debtAmount))
                        }
                        className="px-2.5 py-1 text-[11px] font-semibold bg-white text-stone-700 border border-stone-300 rounded-md hover:bg-stone-100"
                      >
                        Đơn cũ nhất ({fifoPreview.unpaidInvoicesOrdered[0].invoiceCode}:{' '}
                        {formatVND(fifoPreview.unpaidInvoicesOrdered[0].debtAmount)})
                      </button>
                    )}
                  </div>
                )}

                {fifoPreview.allocations.length > 0 && (
                  <div className="bg-white rounded-lg border border-amber-200 overflow-hidden">
                    <div className="px-2.5 py-1.5 bg-amber-100/70 border-b border-amber-200 flex items-center justify-between text-[11px] font-semibold text-amber-950">
                      <span>Thứ tự tự động trừ theo ngày nợ (Cũ → Mới)</span>
                      <span>Tự động trừ: {formatVND(fifoPreview.totalAllocated)}</span>
                    </div>
                    <div className="divide-y divide-stone-100 max-h-48 overflow-y-auto">
                      {fifoPreview.allocations.map((alloc, idx) => (
                        <div
                          key={alloc.recordId}
                          className={`px-2.5 py-2 text-xs flex items-center justify-between gap-2 ${
                            alloc.allocatedAmount > 0 ? 'bg-emerald-50/40' : ''
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-200 text-amber-950 text-[10px] font-bold">
                                {idx + 1}
                              </span>
                              <span className="font-mono font-bold text-stone-900">
                                {alloc.code}
                              </span>
                              <span className="text-[11px] text-stone-500 font-mono">
                                ({alloc.date})
                              </span>
                            </div>
                            <p className="text-[11px] text-stone-600 truncate mt-0.5">
                              {alloc.productName} · Nợ cũ: {formatVND(alloc.previousDebt)}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p
                              className={`font-mono font-bold ${
                                alloc.allocatedAmount > 0 ? 'text-emerald-700' : 'text-stone-400'
                              }`}
                            >
                              -{formatVND(alloc.allocatedAmount)}
                            </p>
                            <p className="text-[10px] font-mono text-stone-500">
                              {alloc.remainingDebt === 0 && alloc.allocatedAmount > 0 ? (
                                <span className="text-emerald-700 font-semibold">
                                  ✓ Tất toán hết nợ
                                </span>
                              ) : (
                                `Còn: ${formatVND(alloc.remainingDebt)}`
                              )}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Amount & Payment Method */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">
                  4. {isDebtSettlement ? 'Nhập số tiền tổng thu (VNĐ) *' : 'Số tiền thu (VNĐ) *'}
                </label>
                <input
                  type="number"
                  min={1000}
                  step={1000}
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  placeholder="Nhập số tiền tổng..."
                  className="w-full px-3 py-2 text-sm font-mono font-bold bg-stone-50 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">
                  Hình thức thu tiền
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-medium bg-stone-50 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                >
                  <option value="Chuyển khoản ngân hàng">Chuyển khoản ngân hàng</option>
                  <option value="Tiền mặt">Tiền mặt tại quầy / kho</option>
                </select>
              </div>
            </div>

            {!isDebtSettlement && (
              <label className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-50/60 border border-emerald-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={countsTowardOtherIncome}
                  onChange={(e) => setCountsTowardOtherIncome(e.target.checked)}
                  className="rounded text-emerald-800 focus:ring-emerald-700"
                />
                <span className="text-xs font-medium text-emerald-950">
                  Cộng khoản thu này vào mục <strong>Thu nhập khác</strong> trong Báo cáo Tài chính & Lợi nhuận
                </span>
              </label>
            )}

            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1">
                Ghi chú / Diễn giải phiếu thu
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="VD: Khách chuyển khoản tất toán nợ phân bón vụ Đông Xuân..."
                className="w-full px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:bg-white"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2.5 px-4 bg-emerald-800 hover:bg-emerald-900 text-white font-semibold text-sm rounded-lg shadow-xs transition-colors flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>Lưu Phiếu Thu</span>
            </button>
          </form>
        </div>

        {/* Right: Receipt Voucher Log Table */}
        <div className="lg:col-span-7 bg-white rounded-xl border border-stone-200/80 shadow-xs overflow-hidden">
          <div className="px-5 py-4 border-b border-stone-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-stone-900">
                Danh Sách Nhật Ký Phiếu Thu Tiền ({filteredVouchers.length})
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-stone-50 border border-stone-200 rounded-lg text-stone-700"
              >
                <option value="all">Tất cả nhóm phiếu thu ({receiptGroups.length})</option>
                {receiptGroups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <div className="relative w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm mã PT, tên KH, mã HĐ..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:bg-white"
                />
              </div>
            </div>
          </div>

          <div className="divide-y divide-stone-100">
            {filteredVouchers.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-stone-400">
                Chưa có phiếu thu tiền nào khớp với bộ lọc.
              </div>
            ) : (
              filteredVouchers.map((rv) => (
                <div
                  key={rv.id}
                  className="p-4 hover:bg-stone-50/70 transition-colors flex flex-col gap-2.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold text-emerald-900 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                          {rv.voucherCode}
                        </span>
                        <span className="text-xs font-semibold text-stone-800 bg-stone-100 border border-stone-200 px-2 py-0.5 rounded">
                          {rv.groupName}
                        </span>
                        <span className="text-[11px] font-medium text-emerald-800 bg-emerald-50/70 px-2 py-0.5 rounded">
                          {rv.warehouseName}
                        </span>
                        <span className="text-[11px] text-stone-500 font-mono">
                          Ngày: {(rv.createdAt || '').slice(0, 10)}
                        </span>
                      </div>
                      <p className="text-sm font-bold text-stone-900 mt-1.5">
                        {rv.partnerName}{' '}
                        {rv.partnerPhone && (
                          <span className="text-xs font-mono font-normal text-stone-500">
                            ({rv.partnerPhone})
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-base font-bold font-mono tabular-nums text-emerald-700">
                        +{formatVND(rv.amount)}
                      </p>
                      <p className="text-[11px] text-stone-500">{rv.paymentMethod}</p>
                    </div>
                  </div>

                  {/* Settled invoices breakdown if FIFO debt settlement */}
                  {rv.isDebtSettlement &&
                    rv.settledAllocations &&
                    rv.settledAllocations.length > 0 && (
                      <div className="p-2.5 rounded-lg bg-amber-50/70 border border-amber-200/80 space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-amber-950">
                          <span>
                            Đã tự động trừ quyết toán {rv.settledAllocations.length} hóa đơn theo thứ tự ngày nợ:
                          </span>
                          {rv.totalRemainingDebt !== undefined && (
                            <span>
                              Tổng dư nợ KH còn lại:{' '}
                              <strong className="text-red-700 font-mono">
                                {formatVND(rv.totalRemainingDebt)}
                              </strong>
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {rv.settledAllocations.map((alloc) => (
                            <span
                              key={`${rv.id}-${alloc.recordId}`}
                              className="inline-flex items-center gap-1 text-[11px] font-mono bg-white border border-amber-300 text-stone-800 px-2 py-0.5 rounded"
                            >
                              <strong>{alloc.code}</strong> ({alloc.date}): trừ{' '}
                              <strong className="text-emerald-700">
                                {formatVND(alloc.allocatedAmount)}
                              </strong>{' '}
                              → còn {formatVND(alloc.remainingDebt)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <p className="text-xs text-stone-600">
                      {rv.note || 'Phiếu thu tiền'} ·{' '}
                      <span className="text-stone-400">Lập bởi: {rv.staffName}</span>
                    </p>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          exportCustomerReceiptPDF({
                            voucherCode: rv.voucherCode,
                            customerName: rv.partnerName,
                            customerPhone: rv.partnerPhone,
                            invoiceCode:
                              rv.settledAllocations && rv.settledAllocations.length > 0
                                ? rv.settledAllocations.map((a) => a.code).join(', ')
                                : rv.groupName,
                            previousDebt: rv.totalPreviousDebt ?? rv.amount,
                            collectedAmount: rv.amount,
                            remainingDebt: rv.totalRemainingDebt ?? 0,
                            paymentMethod: rv.paymentMethod,
                            note: `${rv.groupName} (${rv.warehouseName}) — ${rv.note}`,
                            staffName: rv.staffName,
                            createdAt: rv.createdAt,
                          })
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        In Phiếu Thu PDF
                      </button>

                      {isManager && (
                        <>
                          <button
                            type="button"
                            onClick={() => openEditModal(rv)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-md"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            Sửa
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(rv.id)}
                            className="p-1 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-md"
                            title="Xóa phiếu thu"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      {editingVoucher && (
        <div className="fixed inset-0 z-50 bg-stone-950/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-stone-200 shadow-xl max-w-md w-full overflow-hidden">
            <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-stone-900">
                Chỉnh Sửa Phiếu Thu {editingVoucher.voucherCode}
              </h3>
              <button
                type="button"
                onClick={() => setEditingVoucher(null)}
                className="text-stone-400 hover:text-stone-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    Mã phiếu thu
                  </label>
                  <input
                    type="text"
                    value={editCode}
                    onChange={(e) => setEditCode(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono border border-stone-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    Nhóm phiếu thu
                  </label>
                  <select
                    value={editGroup}
                    onChange={(e) => setEditGroup(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-stone-300 rounded-lg"
                  >
                    {receiptGroups.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    Người nộp tiền
                  </label>
                  <input
                    type="text"
                    value={editPartnerName}
                    onChange={(e) => setEditPartnerName(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-stone-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    Số điện thoại
                  </label>
                  <input
                    type="text"
                    value={editPartnerPhone}
                    onChange={(e) => setEditPartnerPhone(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono border border-stone-300 rounded-lg"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    Số tiền thu (VNĐ)
                  </label>
                  <input
                    type="number"
                    value={editAmount}
                    onChange={(e) => setEditAmount(Number(e.target.value) || 0)}
                    className="w-full px-3 py-1.5 text-xs font-mono font-bold border border-stone-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    Hình thức
                  </label>
                  <input
                    type="text"
                    value={editPaymentMethod}
                    onChange={(e) => setEditPaymentMethod(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-stone-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">
                  Ghi chú
                </label>
                <input
                  type="text"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-stone-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingVoucher(null)}
                  className="px-3 py-1.5 text-xs font-medium text-stone-600 bg-stone-100 rounded-lg"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onUpdateReceiptVoucher(editingVoucher.id, {
                      voucherCode: editCode,
                      groupName: editGroup,
                      warehouseName: editWarehouse,
                      partnerName: editPartnerName,
                      partnerPhone: editPartnerPhone,
                      amount: editAmount,
                      paymentMethod: editPaymentMethod,
                      note: editNote,
                    });
                    setEditingVoucher(null);
                  }}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-emerald-800 hover:bg-emerald-900 rounded-lg"
                >
                  Lưu thay đổi
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 bg-stone-950/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-stone-200 shadow-xl max-w-sm w-full p-5 space-y-3">
            <h3 className="text-sm font-bold text-stone-900">Xác nhận xóa phiếu thu tiền?</h3>
            <p className="text-xs text-stone-600">
              Phiếu thu sẽ bị xóa khỏi sổ nhật ký (và lưu bản gốc vào Lịch sử thao tác để Quản lý chính khôi phục khi cần).
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="px-3 py-1.5 text-xs font-medium text-stone-600 bg-stone-100 rounded-lg"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteReceiptVoucher(confirmDeleteId);
                  setConfirmDeleteId(null);
                }}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg"
              >
                Xóa phiếu thu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface PaymentVoucherLogViewProps {
  paymentVouchers: CashPaymentVoucher[];
  paymentGroups: string[];
  suppliers: SupplierProfile[];
  imports: ImportTransaction[];
  warehouses: string[];
  selectedWarehouse: string | null;
  role: UserRole;
  canEditDelete?: boolean;
  onAddWarehouse: (name: string) => void;
  onAddPaymentGroup: (groupName: string) => void;
  onCreatePaymentVoucher: (input: CreatePaymentVoucherInput) => void;
  onUpdatePaymentVoucher: (
    voucherId: string,
    changes: {
      voucherCode: string;
      groupName: string;
      warehouseName: string;
      partnerName: string;
      partnerPhone: string;
      amount: number;
      paymentMethod: string;
      note: string;
    }
  ) => void;
  onDeletePaymentVoucher: (voucherId: string) => void;
  onAddSupplier: (input: {
    name: string;
    phone: string;
    address: string;
    note: string;
  }) => SupplierProfile;
}

export const PaymentVoucherLogView: React.FC<PaymentVoucherLogViewProps> = ({
  paymentVouchers,
  paymentGroups,
  suppliers,
  imports,
  warehouses,
  selectedWarehouse,
  role,
  canEditDelete,
  onAddWarehouse,
  onAddPaymentGroup,
  onCreatePaymentVoucher,
  onUpdatePaymentVoucher,
  onDeletePaymentVoucher,
  onAddSupplier,
}) => {
  const isManager = canEditDelete !== undefined ? canEditDelete : role === 'manager';

  const [warehouseName, setWarehouseName] = useState<string>(
    selectedWarehouse || warehouses[0] || 'Tâm An Mỹ Ngãi'
  );
  const [showNewWarehouseInput, setShowNewWarehouseInput] = useState(false);
  const [newWarehouseInput, setNewWarehouseInput] = useState('');

  const [groupName, setGroupName] = useState<string>(
    paymentGroups[0] || 'Chi trả nợ Nhà cung cấp'
  );
  const [showNewGroupInput, setShowNewGroupInput] = useState(false);
  const [newGroupInput, setNewGroupInput] = useState('');

  const [isDebtSettlement, setIsDebtSettlement] = useState<boolean>(true);
  const [selectedSupplierName, setSelectedSupplierName] = useState<string>('');
  const [partnerName, setPartnerName] = useState<string>('');
  const [partnerPhone, setPartnerPhone] = useState<string>('');
  const [amountInput, setAmountInput] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<string>('Chuyển khoản ngân hàng');
  const [countsTowardOperatingExpense, setCountsTowardOperatingExpense] = useState<boolean>(true);
  const [note, setNote] = useState<string>('');
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(
    null
  );

  // Quick Add Supplier
  const [showQuickSupplier, setShowQuickSupplier] = useState(false);
  const [newSupName, setNewSupName] = useState('');
  const [newSupPhone, setNewSupPhone] = useState('');
  const [newSupAddress, setNewSupAddress] = useState('');

  // Filter & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState<string>('all');

  // Edit & Delete Modals
  const [editingVoucher, setEditingVoucher] = useState<CashPaymentVoucher | null>(null);
  const [editCode, setEditCode] = useState('');
  const [editGroup, setEditGroup] = useState('');
  const [editWarehouse, setEditWarehouse] = useState('');
  const [editPartnerName, setEditPartnerName] = useState('');
  const [editPartnerPhone, setEditPartnerPhone] = useState('');
  const [editAmount, setEditAmount] = useState(0);
  const [editPaymentMethod, setEditPaymentMethod] = useState('Chuyển khoản ngân hàng');
  const [editNote, setEditNote] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const numericAmount = Math.max(0, Math.round(Number(amountInput) || 0));

  const fifoPreview = useMemo(() => {
    if (!isDebtSettlement || !selectedSupplierName) return null;
    return previewSupplierFifoDebtSettlement(
      imports,
      {
        supplierName: selectedSupplierName,
        supplierPhone: partnerPhone,
      },
      numericAmount
    );
  }, [isDebtSettlement, selectedSupplierName, partnerPhone, imports, numericAmount]);

  const warehouseOptions: SearchableOptionItem[] = useMemo(
    () =>
      warehouses.map((w) => ({
        value: w,
        label: `Kho: ${w}`,
        subLabel: 'Chi nhánh kho vật tư Tâm An',
      })),
    [warehouses]
  );

  const paymentGroupOptions: SearchableOptionItem[] = useMemo(
    () =>
      paymentGroups.map((g) => ({
        value: g,
        label: g,
        subLabel: 'Nhóm phiếu chi tiền',
      })),
    [paymentGroups]
  );

  const supplierOptions: SearchableOptionItem[] = useMemo(() => {
    const namesMap = new Map<string, { name: string; phone: string; address: string }>();
    for (const s of suppliers) {
      namesMap.set(s.name, { name: s.name, phone: s.phone, address: s.address });
    }
    for (const imp of imports) {
      if (!namesMap.has(imp.supplierName)) {
        namesMap.set(imp.supplierName, {
          name: imp.supplierName,
          phone: imp.supplierPhone,
          address: '',
        });
      }
    }
    return Array.from(namesMap.values()).map((sup) => {
      const preview = previewSupplierFifoDebtSettlement(
        imports,
        { supplierName: sup.name, supplierPhone: sup.phone },
        0
      );
      return {
        value: sup.name,
        label: `${sup.name} (${sup.phone || 'Chưa có SĐT'})`,
        subLabel: sup.address || 'Nhà cung cấp vật tư nông nghiệp',
        badge:
          preview.totalPreviousDebt > 0
            ? `Nợ NCC (${preview.unpaidReceiptsOrdered.length} phiếu): ${formatVND(preview.totalPreviousDebt)}`
            : 'Không nợ',
        keywords: `${sup.name} ${sup.phone}`,
      };
    });
  }, [suppliers, imports]);

  const handleSelectSupplier = (supName: string) => {
    setSelectedSupplierName(supName);
    setPartnerName(supName);
    const found = suppliers.find((s) => s.name === supName);
    const phone =
      found?.phone ||
      imports.find((i) => i.supplierName === supName)?.supplierPhone ||
      '';
    setPartnerPhone(phone);

    const preview = previewSupplierFifoDebtSettlement(
      imports,
      { supplierName: supName, supplierPhone: phone },
      0
    );
    if (isDebtSettlement && preview.totalPreviousDebt > 0) {
      setAmountInput(String(preview.totalPreviousDebt));
    }
  };

  const handleCreateNewGroup = () => {
    const clean = newGroupInput.trim();
    if (!clean) return;
    onAddPaymentGroup(clean);
    setGroupName(clean);
    setNewGroupInput('');
    setShowNewGroupInput(false);
    setFeedback({
      type: 'success',
      text: `Đã tạo nhóm phiếu chi mới "${clean}" và chọn vào phiếu chi!`,
    });
  };

  const handleQuickCreateSupplier = () => {
    if (!newSupName.trim()) {
      setFeedback({ type: 'error', text: 'Vui lòng nhập tên Nhà cung cấp / Đơn vị nhận tiền.' });
      return;
    }
    const created = onAddSupplier({
      name: newSupName.trim(),
      phone: newSupPhone.trim(),
      address: newSupAddress.trim() || 'TP.HCM',
      note: 'Tạo nhanh từ Nhật ký Phiếu chi tiền',
    });
    setSelectedSupplierName(created.name);
    setPartnerName(created.name);
    setPartnerPhone(created.phone);
    setNewSupName('');
    setNewSupPhone('');
    setNewSupAddress('');
    setShowQuickSupplier(false);
    setFeedback({
      type: 'success',
      text: `Đã thêm Nhà cung cấp "${created.name}" và chọn vào phiếu chi!`,
    });
  };

  const handleClearForm = () => {
    setSelectedSupplierName('');
    setPartnerName('');
    setPartnerPhone('');
    setAmountInput('');
    setNote('');
    setFeedback(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (!groupName.trim()) {
      setFeedback({ type: 'error', text: 'Vui lòng chọn hoặc tạo Nhóm phiếu chi.' });
      return;
    }

    if (isDebtSettlement) {
      if (!selectedSupplierName) {
        setFeedback({
          type: 'error',
          text: 'Vui lòng chọn Nhà cung cấp cần chi trả quyết toán tổng công nợ.',
        });
        return;
      }
      if (!fifoPreview || fifoPreview.totalPreviousDebt <= 0) {
        setFeedback({
          type: 'error',
          text: `Nhà cung cấp "${selectedSupplierName}" hiện không có phiếu nhập nào còn nợ để quyết toán. Bạn có thể chuyển sang chế độ "Chi phí vận hành / Chi khác".`,
        });
        return;
      }
      if (numericAmount <= 0) {
        setFeedback({
          type: 'error',
          text: 'Vui lòng nhập số tiền tổng chi trả Nhà cung cấp lớn hơn 0 đ.',
        });
        return;
      }
      const effectiveAmount = Math.min(numericAmount, fifoPreview.totalPreviousDebt);
      onCreatePaymentVoucher({
        warehouseName,
        groupName: groupName.trim(),
        isDebtSettlement: true,
        partnerName: selectedSupplierName,
        partnerPhone,
        amount: effectiveAmount,
        paymentMethod,
        countsTowardOperatingExpense: false,
        note:
          note.trim() ||
          `Chi quyết toán tổng công nợ NCC theo thứ tự ngày nợ (${fifoPreview.allocations.filter((a) => a.allocatedAmount > 0).length} phiếu nhập)`,
      });
      setAmountInput('');
      setNote('');
      setFeedback({
        type: 'success',
        text: `Đã lưu Phiếu chi tiền ${formatVND(effectiveAmount)} cho "${selectedSupplierName}" và tự động trừ quyết toán vào ${
          fifoPreview.allocations.filter((a) => a.allocatedAmount > 0).length
        } phiếu nhập nợ cũ theo thứ tự ngày nợ!`,
      });
    } else {
      const targetName = (partnerName || selectedSupplierName || '').trim();
      if (!targetName) {
        setFeedback({
          type: 'error',
          text: 'Vui lòng nhập tên người nhận tiền / đơn vị cung cấp dịch vụ.',
        });
        return;
      }
      if (numericAmount <= 0) {
        setFeedback({
          type: 'error',
          text: 'Vui lòng nhập số tiền chi lớn hơn 0 đ.',
        });
        return;
      }
      onCreatePaymentVoucher({
        warehouseName,
        groupName: groupName.trim(),
        isDebtSettlement: false,
        partnerName: targetName,
        partnerPhone: partnerPhone.trim(),
        amount: numericAmount,
        paymentMethod,
        countsTowardOperatingExpense,
        note: note.trim() || `Chi phí thuộc nhóm: ${groupName.trim()}`,
      });
      setAmountInput('');
      setNote('');
      setFeedback({
        type: 'success',
        text: `Đã ghi nhận Phiếu chi tiền ${formatVND(numericAmount)} (${groupName}) vào sổ Nhật ký Phiếu chi, Báo cáo dòng tiền & Báo cáo Tài chính Lợi nhuận!`,
      });
    }
  };

  const filteredVouchers = useMemo(() => {
    const q = normalizeVietnameseSearch(searchQuery);
    return paymentVouchers.filter((pv) => {
      if (groupFilter !== 'all' && pv.groupName !== groupFilter) return false;
      if (!q) return true;
      const allocCodes = (pv.settledAllocations || []).map((a) => a.code).join(' ');
      const haystack = normalizeVietnameseSearch(
        `${pv.voucherCode} ${pv.groupName} ${pv.partnerName} ${pv.partnerPhone} ${pv.warehouseName} ${pv.note} ${allocCodes}`
      );
      return haystack.includes(q);
    });
  }, [paymentVouchers, groupFilter, searchQuery]);

  const groupSummaries = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const pv of filteredVouchers) {
      const curr = map.get(pv.groupName) || { count: 0, total: 0 };
      curr.count += 1;
      curr.total += pv.amount;
      map.set(pv.groupName, curr);
    }
    return Array.from(map.entries()).map(([name, data]) => ({
      name,
      count: data.count,
      total: data.total,
    }));
  }, [filteredVouchers]);

  const totalPaymentAmount = useMemo(
    () => filteredVouchers.reduce((sum, pv) => sum + pv.amount, 0),
    [filteredVouchers]
  );

  const openEditModal = (pv: CashPaymentVoucher) => {
    setEditingVoucher(pv);
    setEditCode(pv.voucherCode);
    setEditGroup(pv.groupName);
    setEditWarehouse(pv.warehouseName);
    setEditPartnerName(pv.partnerName);
    setEditPartnerPhone(pv.partnerPhone);
    setEditAmount(pv.amount);
    setEditPaymentMethod(pv.paymentMethod);
    setEditNote(pv.note);
  };

  return (
    <div className="space-y-6">
      {/* Top Summary Banner */}
      <div className="bg-white rounded-xl border border-stone-200/80 shadow-xs p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-900 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-md">
              <ArrowUpRight className="w-3.5 h-3.5" />
              Sổ Quỹ Chi Tiền, Chi Phí Vận Hành & Quyết Toán Nợ NCC Theo Ngày Nợ
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="bg-amber-50/90 border border-amber-200 rounded-xl px-4 py-2.5">
              <p className="text-[11px] font-medium text-amber-900">
                Tổng tiền chi ({filteredVouchers.length} phiếu)
              </p>
              <p className="text-lg font-bold font-mono tabular-nums text-amber-900">
                {formatVND(totalPaymentAmount)}
              </p>
            </div>
            <div className="bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5">
              <p className="text-[11px] font-medium text-stone-500">Số nhóm phiếu chi</p>
              <p className="text-base font-bold font-mono text-stone-900">
                {paymentGroups.length} nhóm
              </p>
            </div>
          </div>
        </div>

        {/* Group Summary Strip */}
        {groupSummaries.length > 0 && (
          <div className="mt-4 pt-3.5 border-t border-stone-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {groupSummaries.map((gs) => (
              <button
                key={gs.name}
                type="button"
                onClick={() => setGroupFilter(groupFilter === gs.name ? 'all' : gs.name)}
                className={`text-left p-2.5 rounded-lg border transition-colors ${
                  groupFilter === gs.name
                    ? 'bg-amber-900 text-white border-amber-900'
                    : 'bg-stone-50/80 hover:bg-amber-50/60 border-stone-200/80 text-stone-800'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold truncate">{gs.name}</span>
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      groupFilter === gs.name
                        ? 'bg-amber-800 text-amber-100'
                        : 'bg-stone-200/70 text-stone-700'
                    }`}
                  >
                    {gs.count} phiếu
                  </span>
                </div>
                <p
                  className={`text-sm font-bold font-mono tabular-nums mt-1 ${
                    groupFilter === gs.name ? 'text-amber-200' : 'text-amber-800'
                  }`}
                >
                  -{formatVND(gs.total)}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Create Payment Voucher Form */}
        <div className="lg:col-span-5 bg-white rounded-xl border border-stone-200/80 shadow-xs overflow-hidden">
          <div className="px-5 py-4 border-b border-stone-100 bg-amber-950/3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-amber-800" />
              <h3 className="text-sm font-semibold text-stone-900">
                Lập Phiếu Chi Tiền Mới
              </h3>
            </div>
            <button
              type="button"
              onClick={handleClearForm}
              className="inline-flex items-center gap-1 text-xs font-medium text-stone-500 hover:text-stone-800 px-2 py-1 rounded border border-stone-200 bg-white hover:bg-stone-50 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              Làm trống
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {feedback && (
              <div
                className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 border ${
                  feedback.type === 'error'
                    ? 'bg-red-50 text-red-800 border-red-200'
                    : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                }`}
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{feedback.text}</span>
              </div>
            )}

            {/* Warehouse Selector */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-stone-700">
                  Chọn kho lập phiếu chi <span className="text-red-600">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowNewWarehouseInput(!showNewWarehouseInput)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 hover:text-emerald-950"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  {showNewWarehouseInput ? 'Đóng' : '+ Tạo thêm kho mới'}
                </button>
              </div>
              <SearchableSelect
                options={warehouseOptions}
                value={warehouseName}
                onChange={(val) => setWarehouseName(val || warehouses[0] || 'Tâm An Mỹ Ngãi')}
                placeholder="Gõ tên kho..."
              />
              {showNewWarehouseInput && (
                <div className="mt-2 p-2.5 rounded-lg bg-emerald-50/70 border border-emerald-200 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <input
                    type="text"
                    value={newWarehouseInput}
                    onChange={(e) => setNewWarehouseInput(e.target.value)}
                    placeholder="Nhập tên kho mới..."
                    className="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-white border border-emerald-300 rounded-md"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const clean = newWarehouseInput.trim();
                      if (!clean) return;
                      onAddWarehouse(clean);
                      setWarehouseName(clean);
                      setNewWarehouseInput('');
                      setShowNewWarehouseInput(false);
                    }}
                    className="px-3 py-1.5 text-xs font-semibold bg-emerald-800 text-white rounded-md hover:bg-emerald-900 whitespace-nowrap"
                  >
                    Lưu kho
                  </button>
                </div>
              )}
            </div>

            {/* Payment Group Selector + Create New Group */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-stone-700">
                  1. Chọn Nhóm phiếu chi <span className="text-red-600">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowNewGroupInput(!showNewGroupInput)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800 hover:text-amber-950"
                >
                  <Layers className="w-3.5 h-3.5" />
                  {showNewGroupInput ? 'Đóng' : '+ Tạo nhóm phiếu chi mới'}
                </button>
              </div>
              <SearchableSelect
                options={paymentGroupOptions}
                value={groupName}
                onChange={(val) => setGroupName(val || paymentGroups[0] || 'Chi trả nợ Nhà cung cấp')}
                placeholder="Chọn hoặc tìm nhóm phiếu chi..."
              />
              {showNewGroupInput && (
                <div className="mt-2 p-3 rounded-lg bg-amber-50/80 border border-amber-200 space-y-2">
                  <p className="text-[11px] font-semibold text-amber-950">
                    Tạo Nhóm Phiếu Chi Mới (VD: Chi xăng xe giao hàng, Chi thưởng doanh số, Chi sửa chữa kho...)
                  </p>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <input
                      type="text"
                      value={newGroupInput}
                      onChange={(e) => setNewGroupInput(e.target.value)}
                      placeholder="Nhập tên nhóm phiếu chi mới..."
                      className="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-white border border-amber-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-700"
                    />
                    <button
                      type="button"
                      onClick={handleCreateNewGroup}
                      className="px-3 py-1.5 text-xs font-semibold bg-amber-800 text-white rounded-md hover:bg-amber-900 shrink-0 whitespace-nowrap"
                    >
                      Lưu nhóm
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Mode Switch: FIFO Supplier Debt Settlement vs Operating Expense */}
            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1.5">
                2. Chế độ hạch toán phiếu chi
              </label>
              <div className="grid grid-cols-2 gap-2 p-1 bg-stone-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => {
                    setIsDebtSettlement(true);
                    setGroupName('Chi trả nợ Nhà cung cấp');
                  }}
                  className={`py-2 px-2.5 text-xs font-semibold rounded-md transition-all ${
                    isDebtSettlement
                      ? 'bg-amber-800 text-white shadow-xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  Chi quyết toán nợ NCC
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsDebtSettlement(false);
                    if (groupName === 'Chi trả nợ Nhà cung cấp' && paymentGroups.length > 1) {
                      setGroupName(paymentGroups[1]);
                    }
                  }}
                  className={`py-2 px-2.5 text-xs font-semibold rounded-md transition-all ${
                    !isDebtSettlement
                      ? 'bg-amber-800 text-white shadow-xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  Chi phí vận hành / Chi khác
                </button>
              </div>
            </div>

            {/* Supplier / Recipient Selection */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-stone-700">
                  3. {isDebtSettlement ? 'Chọn Nhà cung cấp cần trả nợ *' : 'Chọn NCC / Đơn vị nhận tiền'}
                </label>
                <button
                  type="button"
                  onClick={() => setShowQuickSupplier(!showQuickSupplier)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 hover:text-emerald-950"
                >
                  <Building2 className="w-3.5 h-3.5" />
                  {showQuickSupplier ? 'Đóng' : '+ Thêm NCC mới'}
                </button>
              </div>

              <SearchableSelect
                options={supplierOptions}
                value={selectedSupplierName}
                onChange={handleSelectSupplier}
                placeholder="Gõ tên Nhà cung cấp, SĐT để xem tổng nợ..."
              />

              {showQuickSupplier && (
                <div className="mt-2.5 p-3.5 rounded-lg bg-emerald-50/70 border border-emerald-200 space-y-2.5">
                  <p className="text-xs font-semibold text-emerald-950">Thêm nhanh Nhà cung cấp mới</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={newSupName}
                      onChange={(e) => setNewSupName(e.target.value)}
                      placeholder="Tên Nhà cung cấp *"
                      className="px-2.5 py-1.5 text-xs bg-white border border-stone-300 rounded-md"
                    />
                    <input
                      type="text"
                      value={newSupPhone}
                      onChange={(e) => setNewSupPhone(e.target.value)}
                      placeholder="SĐT Nhà cung cấp"
                      className="px-2.5 py-1.5 text-xs bg-white border border-stone-300 rounded-md"
                    />
                  </div>
                  <input
                    type="text"
                    value={newSupAddress}
                    onChange={(e) => setNewSupAddress(e.target.value)}
                    placeholder="Địa chỉ Nhà cung cấp"
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-stone-300 rounded-md"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleQuickCreateSupplier}
                      className="px-3 py-1.5 text-xs font-semibold bg-emerald-800 text-white rounded-md hover:bg-emerald-900"
                    >
                      Lưu & Chọn NCC
                    </button>
                  </div>
                </div>
              )}

              {!isDebtSettlement && (
                <div className="grid grid-cols-2 gap-2 mt-2.5">
                  <div>
                    <label className="block text-[11px] font-medium text-stone-600 mb-1">
                      Người nhận tiền / Đơn vị *
                    </label>
                    <input
                      type="text"
                      value={partnerName}
                      onChange={(e) => setPartnerName(e.target.value)}
                      placeholder="VD: Đội xe bốc xếp, Điện lực..."
                      className="w-full px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-stone-600 mb-1">
                      Số điện thoại
                    </label>
                    <input
                      type="text"
                      value={partnerPhone}
                      onChange={(e) => setPartnerPhone(e.target.value)}
                      placeholder="SĐT liên hệ..."
                      className="w-full px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-lg font-mono"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* FIFO Supplier Debt Allocation Live Preview Box */}
            {isDebtSettlement && selectedSupplierName && fifoPreview && (
              <div className="p-3.5 rounded-xl bg-amber-50/90 border border-amber-300 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold text-amber-950">
                      Tổng công nợ phải trả ({selectedSupplierName}):
                    </p>
                    <p className="text-[11px] text-amber-800">
                      {fifoPreview.unpaidReceiptsOrdered.length} phiếu nhập đang nợ (Sắp xếp từ ngày nợ cũ nhất)
                    </p>
                  </div>
                  <span className="text-base font-bold font-mono tabular-nums text-red-700">
                    {formatVND(fifoPreview.totalPreviousDebt)}
                  </span>
                </div>

                {fifoPreview.totalPreviousDebt > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setAmountInput(String(fifoPreview.totalPreviousDebt))}
                      className="px-2.5 py-1 text-[11px] font-semibold bg-amber-800 text-white rounded-md hover:bg-amber-900"
                    >
                      Trả tất toán 100% ({formatVND(fifoPreview.totalPreviousDebt)})
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setAmountInput(String(Math.round(fifoPreview.totalPreviousDebt / 2)))
                      }
                      className="px-2.5 py-1 text-[11px] font-semibold bg-white text-amber-900 border border-amber-300 rounded-md hover:bg-amber-100"
                    >
                      Trả 50% ({formatVND(Math.round(fifoPreview.totalPreviousDebt / 2))})
                    </button>
                    {fifoPreview.unpaidReceiptsOrdered.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setAmountInput(String(fifoPreview.unpaidReceiptsOrdered[0].debtAmount))
                        }
                        className="px-2.5 py-1 text-[11px] font-semibold bg-white text-stone-700 border border-stone-300 rounded-md hover:bg-stone-100"
                      >
                        Phiếu cũ nhất ({fifoPreview.unpaidReceiptsOrdered[0].receiptCode}:{' '}
                        {formatVND(fifoPreview.unpaidReceiptsOrdered[0].debtAmount)})
                      </button>
                    )}
                  </div>
                )}

                {fifoPreview.allocations.length > 0 && (
                  <div className="bg-white rounded-lg border border-amber-200 overflow-hidden">
                    <div className="px-2.5 py-1.5 bg-amber-100/70 border-b border-amber-200 flex items-center justify-between text-[11px] font-semibold text-amber-950">
                      <span>Thứ tự tự động trừ theo ngày nợ (Cũ → Mới)</span>
                      <span>Tự động trừ: {formatVND(fifoPreview.totalAllocated)}</span>
                    </div>
                    <div className="divide-y divide-stone-100 max-h-48 overflow-y-auto">
                      {fifoPreview.allocations.map((alloc, idx) => (
                        <div
                          key={alloc.recordId}
                          className={`px-2.5 py-2 text-xs flex items-center justify-between gap-2 ${
                            alloc.allocatedAmount > 0 ? 'bg-emerald-50/40' : ''
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-200 text-amber-950 text-[10px] font-bold">
                                {idx + 1}
                              </span>
                              <span className="font-mono font-bold text-stone-900">
                                {alloc.code}
                              </span>
                              <span className="text-[11px] text-stone-500 font-mono">
                                ({alloc.date})
                              </span>
                            </div>
                            <p className="text-[11px] text-stone-600 truncate mt-0.5">
                              {alloc.productName} · Nợ cũ: {formatVND(alloc.previousDebt)}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p
                              className={`font-mono font-bold ${
                                alloc.allocatedAmount > 0 ? 'text-emerald-700' : 'text-stone-400'
                              }`}
                            >
                              -{formatVND(alloc.allocatedAmount)}
                            </p>
                            <p className="text-[10px] font-mono text-stone-500">
                              {alloc.remainingDebt === 0 && alloc.allocatedAmount > 0 ? (
                                <span className="text-emerald-700 font-semibold">
                                  ✓ Tất toán hết nợ
                                </span>
                              ) : (
                                `Còn: ${formatVND(alloc.remainingDebt)}`
                              )}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Amount & Payment Method */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">
                  4. {isDebtSettlement ? 'Nhập số tiền tổng chi trả (VNĐ) *' : 'Số tiền chi (VNĐ) *'}
                </label>
                <input
                  type="number"
                  min={1000}
                  step={1000}
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  placeholder="Nhập số tiền tổng..."
                  className="w-full px-3 py-2 text-sm font-mono font-bold bg-stone-50 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-700 focus:bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">
                  Hình thức chi tiền
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-medium bg-stone-50 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-700"
                >
                  <option value="Chuyển khoản ngân hàng">Chuyển khoản ngân hàng</option>
                  <option value="Tiền mặt">Tiền mặt tại quầy / kho</option>
                </select>
              </div>
            </div>

            {!isDebtSettlement && (
              <label className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-50/70 border border-amber-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={countsTowardOperatingExpense}
                  onChange={(e) => setCountsTowardOperatingExpense(e.target.checked)}
                  className="rounded text-amber-800 focus:ring-amber-700"
                />
                <span className="text-xs font-medium text-amber-950">
                  Khấu trừ khoản chi này vào mục <strong>Chi phí vận hành</strong> trong Báo cáo Tài chính & Lợi nhuận
                </span>
              </label>
            )}

            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1">
                Ghi chú / Diễn giải phiếu chi
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="VD: Chuyển khoản thanh toán nợ phân bón / Chi tiền bốc xếp kho..."
                className="w-full px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-700 focus:bg-white"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2.5 px-4 bg-amber-800 hover:bg-amber-900 text-white font-semibold text-sm rounded-lg shadow-xs transition-colors flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>Lưu Phiếu Chi</span>
            </button>
          </form>
        </div>

        {/* Right: Payment Voucher Log Table */}
        <div className="lg:col-span-7 bg-white rounded-xl border border-stone-200/80 shadow-xs overflow-hidden">
          <div className="px-5 py-4 border-b border-stone-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-stone-900">
                Danh Sách Nhật Ký Phiếu Chi Tiền ({filteredVouchers.length})
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-stone-50 border border-stone-200 rounded-lg text-stone-700"
              >
                <option value="all">Tất cả nhóm phiếu chi ({paymentGroups.length})</option>
                {paymentGroups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <div className="relative w-full sm:w-56">
                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm mã PC, tên NCC, mã PN..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-stone-50 border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-700 focus:bg-white"
                />
              </div>
            </div>
          </div>

          <div className="divide-y divide-stone-100">
            {filteredVouchers.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-stone-400">
                Chưa có phiếu chi tiền nào khớp với bộ lọc.
              </div>
            ) : (
              filteredVouchers.map((pv) => (
                <div
                  key={pv.id}
                  className="p-4 hover:bg-stone-50/70 transition-colors flex flex-col gap-2.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold text-amber-900 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                          {pv.voucherCode}
                        </span>
                        <span className="text-xs font-semibold text-stone-800 bg-stone-100 border border-stone-200 px-2 py-0.5 rounded">
                          {pv.groupName}
                        </span>
                        <span className="text-[11px] font-medium text-emerald-800 bg-emerald-50/70 px-2 py-0.5 rounded">
                          {pv.warehouseName}
                        </span>
                        <span className="text-[11px] text-stone-500 font-mono">
                          Ngày: {(pv.createdAt || '').slice(0, 10)}
                        </span>
                      </div>
                      <p className="text-sm font-bold text-stone-900 mt-1.5">
                        {pv.partnerName}{' '}
                        {pv.partnerPhone && (
                          <span className="text-xs font-mono font-normal text-stone-500">
                            ({pv.partnerPhone})
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-base font-bold font-mono tabular-nums text-amber-800">
                        -{formatVND(pv.amount)}
                      </p>
                      <p className="text-[11px] text-stone-500">{pv.paymentMethod}</p>
                    </div>
                  </div>

                  {/* Settled import receipts breakdown if FIFO debt settlement */}
                  {pv.isDebtSettlement &&
                    pv.settledAllocations &&
                    pv.settledAllocations.length > 0 && (
                      <div className="p-2.5 rounded-lg bg-amber-50/70 border border-amber-200/80 space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-amber-950">
                          <span>
                            Đã tự động trừ quyết toán {pv.settledAllocations.length} phiếu nhập theo thứ tự ngày nợ:
                          </span>
                          {pv.totalRemainingDebt !== undefined && (
                            <span>
                              Tổng nợ NCC còn lại:{' '}
                              <strong className="text-red-700 font-mono">
                                {formatVND(pv.totalRemainingDebt)}
                              </strong>
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {pv.settledAllocations.map((alloc) => (
                            <span
                              key={`${pv.id}-${alloc.recordId}`}
                              className="inline-flex items-center gap-1 text-[11px] font-mono bg-white border border-amber-300 text-stone-800 px-2 py-0.5 rounded"
                            >
                              <strong>{alloc.code}</strong> ({alloc.date}): trừ{' '}
                              <strong className="text-emerald-700">
                                {formatVND(alloc.allocatedAmount)}
                              </strong>{' '}
                              → còn {formatVND(alloc.remainingDebt)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <p className="text-xs text-stone-600">
                      {pv.note || 'Phiếu chi tiền'} ·{' '}
                      <span className="text-stone-400">Lập bởi: {pv.staffName}</span>
                    </p>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          exportSupplierPaymentPDF({
                            voucherCode: pv.voucherCode,
                            supplierName: pv.partnerName,
                            supplierPhone: pv.partnerPhone,
                            receiptCode:
                              pv.settledAllocations && pv.settledAllocations.length > 0
                                ? pv.settledAllocations.map((a) => a.code).join(', ')
                                : pv.groupName,
                            previousDebt: pv.totalPreviousDebt ?? pv.amount,
                            paidAmount: pv.amount,
                            remainingDebt: pv.totalRemainingDebt ?? 0,
                            paymentMethod: pv.paymentMethod,
                            note: `${pv.groupName} (${pv.warehouseName}) — ${pv.note}`,
                            staffName: pv.staffName,
                            createdAt: pv.createdAt,
                          })
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        In Phiếu Chi PDF
                      </button>

                      {isManager && (
                        <>
                          <button
                            type="button"
                            onClick={() => openEditModal(pv)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-md"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            Sửa
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(pv.id)}
                            className="p-1 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-md"
                            title="Xóa phiếu chi"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      {editingVoucher && (
        <div className="fixed inset-0 z-50 bg-stone-950/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-stone-200 shadow-xl max-w-md w-full overflow-hidden">
            <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-stone-900">
                Chỉnh Sửa Phiếu Chi {editingVoucher.voucherCode}
              </h3>
              <button
                type="button"
                onClick={() => setEditingVoucher(null)}
                className="text-stone-400 hover:text-stone-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    Mã phiếu chi
                  </label>
                  <input
                    type="text"
                    value={editCode}
                    onChange={(e) => setEditCode(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono border border-stone-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    Nhóm phiếu chi
                  </label>
                  <select
                    value={editGroup}
                    onChange={(e) => setEditGroup(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-stone-300 rounded-lg"
                  >
                    {paymentGroups.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    Người nhận tiền
                  </label>
                  <input
                    type="text"
                    value={editPartnerName}
                    onChange={(e) => setEditPartnerName(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-stone-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    Số điện thoại
                  </label>
                  <input
                    type="text"
                    value={editPartnerPhone}
                    onChange={(e) => setEditPartnerPhone(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono border border-stone-300 rounded-lg"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    Số tiền chi (VNĐ)
                  </label>
                  <input
                    type="number"
                    value={editAmount}
                    onChange={(e) => setEditAmount(Number(e.target.value) || 0)}
                    className="w-full px-3 py-1.5 text-xs font-mono font-bold border border-stone-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    Hình thức
                  </label>
                  <input
                    type="text"
                    value={editPaymentMethod}
                    onChange={(e) => setEditPaymentMethod(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-stone-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">
                  Ghi chú
                </label>
                <input
                  type="text"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-stone-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingVoucher(null)}
                  className="px-3 py-1.5 text-xs font-medium text-stone-600 bg-stone-100 rounded-lg"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onUpdatePaymentVoucher(editingVoucher.id, {
                      voucherCode: editCode,
                      groupName: editGroup,
                      warehouseName: editWarehouse,
                      partnerName: editPartnerName,
                      partnerPhone: editPartnerPhone,
                      amount: editAmount,
                      paymentMethod: editPaymentMethod,
                      note: editNote,
                    });
                    setEditingVoucher(null);
                  }}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-amber-800 hover:bg-amber-900 rounded-lg"
                >
                  Lưu thay đổi
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 bg-stone-950/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-stone-200 shadow-xl max-w-sm w-full p-5 space-y-3">
            <h3 className="text-sm font-bold text-stone-900">Xác nhận xóa phiếu chi tiền?</h3>
            <p className="text-xs text-stone-600">
              Phiếu chi sẽ bị xóa khỏi sổ nhật ký (và lưu bản gốc vào Lịch sử thao tác để Quản lý chính khôi phục khi cần).
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="px-3 py-1.5 text-xs font-medium text-stone-600 bg-stone-100 rounded-lg"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeletePaymentVoucher(confirmDeleteId);
                  setConfirmDeleteId(null);
                }}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg"
              >
                Xóa phiếu chi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

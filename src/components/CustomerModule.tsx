import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  FileDown,
  FileSpreadsheet,
  FolderPlus,
  Lock,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Printer,
  Search,
  Trash2,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react';
import {
  CashReceiptVoucher,
  CrossLinkNavigateRequest,
  CustomerGroup,
  CustomerProfile,
  ImportTransaction,
  ProductItem,
  SaleTransaction,
  UserRole,
} from '../types';
import {
  canPerformRoleAction,
  computeReceivedItemsAndDebtReport,
  CustomerDebtFilter,
  evaluateDebtUrgency,
  filterCustomers,
  findLinkedReceiptVouchersForSale,
  formatVND,
  getCurrentMonthRangeVietnam,
  getRecentDaysRangeVietnam,
  getTodayVietnamDateStr,
  previewCustomerFifoDebtSettlement,
} from '../utils/businessLogic';
import { CrossLinkChip } from './VoucherCrossLinkUI';
import {
  exportCombinedReceivedItemsAndDebtExcel,
  exportCombinedReceivedItemsAndDebtPDF,
  exportCustomerReceiptPDF,
  exportModuleDataExcel,
  exportSaleInvoicePDF,
} from '../utils/exportReports';
import { ExcelDataBar } from './ExcelDataBar';
import { SearchableSelect } from './SearchableSelect';

interface CustomerModuleProps {
  customers: CustomerProfile[];
  products: ProductItem[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  receiptVouchers?: CashReceiptVoucher[];
  role: UserRole;
  customerGroups: string[];
  onAddCustomerGroup: (groupName: string) => void;
  onSaveCustomer: (
    customerData: Omit<CustomerProfile, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>,
    editingId?: string
  ) => CustomerProfile;
  onDeleteCustomer: (customerId: string) => void;
  onImportCustomersFromExcel: (rows: Record<string, unknown>[]) => number;
  onCollectCustomerDebt: (saleId: string, amount: number, note: string) => void;
  onSettleCustomerTotalDebtFifo?: (params: {
    customerId?: string;
    customerName: string;
    customerPhone: string;
    totalAmount: number;
    groupName: string;
    paymentMethod: string;
    note: string;
  }) => void;
  onCreateSaleForCustomer: (customerId: string) => void;
  focusedCustomerId?: string | null;
  onClearFocusedCustomer?: () => void;
  onNavigateCrossLink?: (req: CrossLinkNavigateRequest) => void;
  leadDays: number;
}

export const CustomerModule: React.FC<CustomerModuleProps> = ({
  customers,
  products,
  sales,
  imports,
  receiptVouchers = [],
  role,
  customerGroups,
  onAddCustomerGroup,
  onSaveCustomer,
  onDeleteCustomer,
  onImportCustomersFromExcel,
  onCollectCustomerDebt,
  onSettleCustomerTotalDebtFifo,
  onCreateSaleForCustomer,
  focusedCustomerId,
  onClearFocusedCustomer,
  onNavigateCrossLink,
  leadDays,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState<CustomerGroup | 'all'>('all');
  const [debtFilter, setDebtFilter] = useState<CustomerDebtFilter>('all');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    focusedCustomerId || customers[0]?.id || null
  );

  useEffect(() => {
    if (!focusedCustomerId) return;
    const found = customers.find(
      (c) => c.id === focusedCustomerId || c.code === focusedCustomerId
    );
    if (found) {
      setSearchQuery('');
      setGroupFilter('all');
      setDebtFilter('all');
      setSelectedCustomerId(found.id);
    }
    onClearFocusedCustomer?.();
  }, [focusedCustomerId, customers, onClearFocusedCustomer]);

  // Date-range filter for "Danh sách tổng hợp các mặt hàng đã nhận & còn nợ (Từ ngày ... đến ngày ...)"
  const currentMonthRange = useMemo(() => getCurrentMonthRangeVietnam(), []);
  const recent7DaysRange = useMemo(() => getRecentDaysRangeVietnam(7), []);
  const todayStr = getTodayVietnamDateStr();
  const [itemsFromDate, setItemsFromDate] = useState(currentMonthRange.from);
  const [itemsToDate, setItemsToDate] = useState(currentMonthRange.to);
  const [onlyUnpaidItems, setOnlyUnpaidItems] = useState(false);
  const [isBatchCollectOpen, setIsBatchCollectOpen] = useState(false);
  const [batchCollectAmount, setBatchCollectAmount] = useState('');
  const [batchCollectNote, setBatchCollectNote] = useState('');

  // Add / Edit Customer Modal State (Blank by default on Add)
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerProfile | null>(null);
  const [formCode, setFormCode] = useState('');
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formGroup, setFormGroup] = useState<CustomerGroup>('');
  const [formNote, setFormNote] = useState('');
  const [formError, setFormError] = useState('');

  // Inline New Customer Group Creation State inside Modal
  const [showNewGroupInput, setShowNewGroupInput] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  // Quick Debt Collection State inside Customer History
  const [collectingSale, setCollectingSale] = useState<SaleTransaction | null>(null);
  const [collectAmount, setCollectAmount] = useState('');
  const [collectNote, setCollectNote] = useState('');

  const filteredList = filterCustomers(
    customers,
    sales,
    searchQuery,
    groupFilter,
    debtFilter,
    todayStr,
    leadDays
  );

  const activeEntry =
    filteredList.find((item) => item.customer.id === selectedCustomerId) ||
    filteredList[0] ||
    null;

  const customerReceivedItemsReport = useMemo(() => {
    if (!activeEntry) {
      return computeReceivedItemsAndDebtReport([], {
        fromDate: itemsFromDate,
        toDate: itemsToDate,
        onlyUnpaid: onlyUnpaidItems,
      });
    }
    return computeReceivedItemsAndDebtReport(sales, {
      fromDate: itemsFromDate,
      toDate: itemsToDate,
      customerId: activeEntry.customer.id,
      onlyUnpaid: onlyUnpaidItems,
    });
  }, [sales, activeEntry, itemsFromDate, itemsToDate, onlyUnpaidItems]);

  const resetCustomerFormToBlank = () => {
    setFormCode('');
    setFormName('');
    setFormPhone('');
    setFormEmail('');
    setFormAddress('');
    setFormGroup('');
    setFormNote('');
    setFormError('');
    setShowNewGroupInput(false);
    setNewGroupName('');
  };

  const openAddModal = () => {
    setEditingCustomer(null);
    resetCustomerFormToBlank();
    setIsModalOpen(true);
  };

  const openEditModal = (c: CustomerProfile) => {
    setEditingCustomer(c);
    setFormCode(c.code);
    setFormName(c.name);
    setFormPhone(c.phone);
    setFormEmail(c.email);
    setFormAddress(c.address);
    setFormGroup(c.group);
    setFormNote(c.note);
    setFormError('');
    setShowNewGroupInput(false);
    setNewGroupName('');
    setIsModalOpen(true);
  };

  const handleConfirmInlineGroup = (): string | null => {
    const trimmed = newGroupName.trim();
    if (!trimmed) {
      setFormError('Vui lòng nhập tên nhóm khách hàng mới.');
      return null;
    }
    onAddCustomerGroup(trimmed);
    setFormGroup(trimmed);
    setShowNewGroupInput(false);
    setNewGroupName('');
    setFormError('');
    return trimmed;
  };

  const handleSubmitCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setFormError('Vui lòng nhập họ tên khách hàng.');
      return;
    }
    if (!formPhone.trim()) {
      setFormError('Vui lòng nhập số điện thoại liên hệ.');
      return;
    }

    let resolvedGroup = formGroup;
    if (showNewGroupInput || formGroup === '__new_group__') {
      const createdGrp = handleConfirmInlineGroup();
      if (!createdGrp) return;
      resolvedGroup = createdGrp;
    }
    if (!resolvedGroup || resolvedGroup === '__new_group__') {
      resolvedGroup = customerGroups[0] || 'Nhà nông';
    }

    const nextNum = String(customers.length + 1).padStart(3, '0');
    const saved = onSaveCustomer(
      {
        code: formCode.trim() || `KH-${nextNum}`,
        name: formName.trim(),
        phone: formPhone.trim(),
        email: formEmail.trim(),
        address: formAddress.trim(),
        group: resolvedGroup,
        note: formNote.trim(),
        totalPurchased: editingCustomer ? editingCustomer.totalPurchased : 0,
        totalDebt: editingCustomer ? editingCustomer.totalDebt : 0,
      },
      editingCustomer?.id
    );
    setSelectedCustomerId(saved.id);
    resetCustomerFormToBlank();
    setIsModalOpen(false);
  };

  const submitCollectDebt = (shouldExportPDF: boolean) => {
    if (!collectingSale) return;
    const val = Number(collectAmount);
    if (!val || val <= 0) return;

    const prevDebt = collectingSale.debtAmount;
    const remaining = Math.max(0, prevDebt - val);
    onCollectCustomerDebt(collectingSale.id, val, collectNote.trim());

    if (shouldExportPDF) {
      exportCustomerReceiptPDF({
        voucherCode: `PT-${Date.now().toString().slice(-4)}`,
        customerName: collectingSale.customerName,
        customerPhone: collectingSale.customerPhone,
        customerAddress: activeEntry?.customer.address || '',
        invoiceCode: collectingSale.invoiceCode,
        previousDebt: prevDebt,
        collectedAmount: val,
        remainingDebt: remaining,
        paymentMethod: 'Tiền mặt / Chuyển khoản',
        note: collectNote.trim() || `Thu nợ hóa đơn ${collectingSale.invoiceCode}`,
        staffName: 'Trần Đình Nhất (Quản lý chính)',
        createdAt: new Date().toISOString(),
      });
    }

    setCollectingSale(null);
    setCollectAmount('');
    setCollectNote('');
  };

  return (
    <div className="space-y-5">
      {/* Header Action Strip */}
      <div className="flex items-center justify-start sm:justify-end bg-white p-4 rounded-xl border border-slate-200">
        <button
          type="button"
          onClick={openAddModal}
          className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
        >
          <UserPlus className="w-4 h-4" />
          <span>Thêm khách hàng mới</span>
        </button>
      </div>

      {/* Search & Multi-Criteria Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm theo tên khách hàng, mã KH, số điện thoại, email hoặc địa chỉ..."
            aria-label="Tìm kiếm khách hàng theo tên, SĐT, email hoặc địa chỉ"
            className="w-full pl-10 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-emerald-600"
          />
        </div>

        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3 w-full lg:w-auto">
          <div className="flex items-center gap-2">
            <label
              htmlFor="customer-group-filter"
              className="text-xs font-medium text-slate-600 whitespace-nowrap"
            >
              Nhóm KH:
            </label>
            <select
              id="customer-group-filter"
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value as CustomerGroup | 'all')}
              className="flex-1 sm:flex-initial px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-800"
            >
              <option value="all">Tất cả nhóm ({customerGroups.length})</option>
              {customerGroups.map((grp) => (
                <option key={grp} value={grp}>
                  {grp}
                </option>
              ))}
            </select>
          </div>

          <div
            className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg"
            role="group"
            aria-label="Lọc theo tình trạng công nợ khách hàng"
          >
            {[
              { id: 'all', label: 'Tất cả' },
              { id: 'has_debt', label: 'Đang nợ' },
              { id: 'overdue', label: 'Nợ quá hạn' },
              { id: 'no_debt', label: 'Không nợ' },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setDebtFilter(item.id as CustomerDebtFilter)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors text-center break-words ${
                  debtFilter === item.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Split View: Customer Table (Left) + Detailed Profile & Purchase History (Right) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-7 bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">
              Danh sách khách hàng ({filteredList.length})
            </h3>
            <span className="text-xs text-slate-500">
              Nhấn vào khách hàng để xem lịch sử giao dịch
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[500px] text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-3 min-w-[155px]">Khách hàng</th>
                  <th className="py-3 px-3 min-w-[140px]">Liên hệ & Địa chỉ</th>
                  <th className="py-3 px-3 w-[100px] text-right whitespace-nowrap">Tổng mua</th>
                  <th className="py-3 px-3 w-[115px] text-right whitespace-nowrap">Công nợ hiện tại</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredList.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12 px-4 text-center text-slate-500">
                      Không tìm thấy khách hàng phù hợp với bộ lọc hiện tại.
                    </td>
                  </tr>
                ) : (
                  filteredList.map(({ customer, ledger }) => {
                    const isSelected = activeEntry?.customer.id === customer.id;
                    return (
                      <tr
                        key={customer.id}
                        onClick={() => setSelectedCustomerId(customer.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-emerald-50/60' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-3 px-3 min-w-[155px] align-middle">
                          <div className="font-semibold text-slate-900 leading-snug">{customer.name}</div>
                          <div className="text-xs text-slate-500 mt-0.5 whitespace-nowrap">
                            <span className="font-mono">{customer.code}</span>
                            <span className="mx-1.5" aria-hidden="true">·</span>
                            <span>{customer.group}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3 min-w-[140px] align-middle">
                          <div className="text-xs font-mono text-slate-800 whitespace-nowrap">
                            {customer.phone}
                          </div>
                          <div className="text-xs text-slate-500 truncate max-w-[150px] mt-0.5">
                            {customer.address || customer.email || 'Chưa cập nhật địa chỉ'}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap align-middle">
                          {formatVND(ledger.totalPurchased)}
                        </td>
                        <td className="py-3 px-3 text-right whitespace-nowrap align-middle">
                          <div
                            className={`font-mono tabular-nums text-xs font-semibold ${
                              ledger.totalDebt > 0 ? 'text-red-600' : 'text-emerald-700'
                            }`}
                          >
                            {ledger.totalDebt > 0 ? formatVND(ledger.totalDebt) : '0\u00A0đ'}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5 whitespace-nowrap">
                            {ledger.overdueCount > 0 ? (
                              <span className="text-red-600 font-medium">
                                {ledger.overdueCount} đơn quá hạn
                              </span>
                            ) : ledger.totalDebt > 0 ? (
                              <span className="text-amber-700">Đang trong hạn</span>
                            ) : (
                              <span>Đã tất toán</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Customer Detail & Purchase History Drawer/Panel */}
        <div className="xl:col-span-5 bg-white rounded-xl border border-slate-200 overflow-hidden">
          {!activeEntry ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              Chọn một khách hàng ở bảng bên trái để xem thông tin chi tiết và lịch sử mua hàng.
            </div>
          ) : (
            <div>
              <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-slate-500 flex flex-wrap items-center gap-1.5">
                    <span className="font-mono font-semibold text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded">
                      {activeEntry.customer.code}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-slate-600">{activeEntry.customer.group}</span>
                  </div>
                  <h3 className="text-base sm:text-lg font-bold text-slate-900 mt-1">
                    {activeEntry.customer.name}
                  </h3>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canPerformRoleAction(role, 'edit_record') ? (
                    <>
                      <button
                        type="button"
                        onClick={() => openEditModal(activeEntry.customer)}
                        className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-200 rounded-lg hover:bg-slate-200 flex items-center gap-1 whitespace-nowrap"
                      >
                        <Pencil className="w-3 h-3" />
                        <span>Sửa KH</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteCustomer(activeEntry.customer.id)}
                        aria-label={`Xóa khách hàng ${activeEntry.customer.name}`}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg border border-slate-200"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <span
                      title="Chỉ Quản lý mới có quyền sửa hoặc xóa khách hàng đã lưu"
                      className="px-2.5 py-1 text-[11px] text-slate-400 bg-slate-50 border border-slate-200 rounded-lg flex items-center gap-1 whitespace-nowrap"
                    >
                      <Lock className="w-3 h-3" />
                      <span>Khóa sửa/xóa</span>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onCreateSaleForCustomer(activeEntry.customer.id)}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg whitespace-nowrap"
                  >
                    + Tạo đơn bán
                  </button>
                </div>
              </div>

              <div className="px-4 sm:px-5 py-3.5 bg-slate-50/60 border-b border-slate-200 space-y-2 text-xs">
                <div className="flex items-center gap-2 text-slate-700">
                  <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="font-semibold">Điện thoại:</span>
                  <span className="font-mono">{activeEntry.customer.phone}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-700">
                  <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="font-semibold">Email:</span>
                  <span className="break-all">{activeEntry.customer.email || 'Chưa cập nhật'}</span>
                </div>
                <div className="flex items-start gap-2 text-slate-700">
                  <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                  <span className="font-semibold shrink-0">Địa chỉ:</span>
                  <span>{activeEntry.customer.address || 'Chưa cập nhật'}</span>
                </div>
                {activeEntry.customer.note && (
                  <p className="text-slate-500 pt-1 border-t border-slate-200/80">
                    Ghi chú: {activeEntry.customer.note}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-3 divide-x divide-slate-200 border-b border-slate-200">
                <div className="p-3 sm:p-4">
                  <div className="text-[11px] sm:text-xs text-slate-500">Tổng mua tích lũy</div>
                  <div className="text-xs sm:text-sm font-bold font-mono tabular-nums text-slate-900 mt-1">
                    {formatVND(activeEntry.ledger.totalPurchased)}
                  </div>
                </div>
                <div className="p-3 sm:p-4">
                  <div className="text-[11px] sm:text-xs text-slate-500">Đã thanh toán</div>
                  <div className="text-xs sm:text-sm font-bold font-mono tabular-nums text-emerald-700 mt-1">
                    {formatVND(activeEntry.ledger.totalPaid)}
                  </div>
                </div>
                <div className="p-3 sm:p-4">
                  <div className="text-[11px] sm:text-xs text-slate-500">Dư nợ hiện tại</div>
                  <div
                    className={`text-xs sm:text-sm font-bold font-mono tabular-nums mt-1 ${
                      activeEntry.ledger.totalDebt > 0 ? 'text-red-600' : 'text-slate-900'
                    }`}
                  >
                    {formatVND(activeEntry.ledger.totalDebt)}
                  </div>
                </div>
              </div>

              {/* NEW: Danh Sách Tổng Hợp Các Mặt Hàng Đã Nhận & Còn Nợ / Thu Nợ */}
              <div className="p-4 sm:p-5 border-b border-slate-200 bg-emerald-50/30 space-y-3.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                      <span>
                        Danh sách tổng hợp các mặt hàng đã nhận & còn nợ
                      </span>
                    </div>
                  </div>
                </div>

                {/* Date Range Inputs & Mode Toggle */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label
                      htmlFor="cust-items-from-date"
                      className="block text-[11px] font-semibold text-slate-600 mb-1"
                    >
                      Từ ngày
                    </label>
                    <input
                      id="cust-items-from-date"
                      type="date"
                      value={itemsFromDate}
                      onChange={(e) => setItemsFromDate(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-900"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="cust-items-to-date"
                      className="block text-[11px] font-semibold text-slate-600 mb-1"
                    >
                      Đến ngày
                    </label>
                    <input
                      id="cust-items-to-date"
                      type="date"
                      value={itemsToDate}
                      onChange={(e) => setItemsToDate(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-900"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1">
                    {[
                      { label: currentMonthRange.label, from: currentMonthRange.from, to: currentMonthRange.to },
                      { label: '7 ngày qua', from: recent7DaysRange.from, to: recent7DaysRange.to },
                      { label: 'Tất cả kỳ', from: '2020-01-01', to: '2035-12-31' },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setItemsFromDate(preset.from);
                          setItemsToDate(preset.to);
                        }}
                        className={`px-2 py-1 text-[11px] font-semibold rounded border transition-colors ${
                          itemsFromDate === preset.from && itemsToDate === preset.to
                            ? 'bg-emerald-700 text-white border-emerald-700'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-1 bg-white p-0.5 rounded-lg border border-slate-200">
                    <button
                      type="button"
                      onClick={() => setOnlyUnpaidItems(false)}
                      className={`px-2 py-1 text-[11px] font-semibold rounded-md ${
                        !onlyUnpaidItems
                          ? 'bg-emerald-700 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Tất cả hàng nhận
                    </button>
                    <button
                      type="button"
                      onClick={() => setOnlyUnpaidItems(true)}
                      className={`px-2 py-1 text-[11px] font-semibold rounded-md ${
                        onlyUnpaidItems
                          ? 'bg-red-600 text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Chỉ hàng còn nợ
                    </button>
                  </div>
                </div>

                {/* Received Items Table in Date Range */}
                <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                  <div className="overflow-x-auto max-h-[260px]">
                    <table className="w-full min-w-[460px] text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                          <th className="py-2.5 px-2.5 w-[95px] whitespace-nowrap">Ngày / Mã HĐ</th>
                          <th className="py-2.5 px-2.5 min-w-[165px]">Mặt hàng đã nhận</th>
                          <th className="py-2.5 px-2.5 w-[70px] text-center whitespace-nowrap">SL</th>
                          <th className="py-2.5 px-2.5 w-[85px] text-right whitespace-nowrap">Thành tiền</th>
                          <th className="py-2.5 px-2.5 w-[85px] text-right whitespace-nowrap">Còn nợ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {customerReceivedItemsReport.items.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-5 px-3 text-center text-slate-500">
                              Không có mặt hàng nào trong khoảng từ {itemsFromDate} đến {itemsToDate}.
                            </td>
                          </tr>
                        ) : (
                          customerReceivedItemsReport.items.map((item) => (
                            <tr key={item.saleId} className="hover:bg-slate-50">
                              <td className="py-2.5 px-2.5 whitespace-nowrap align-middle">
                                {onNavigateCrossLink ? (
                                  <CrossLinkChip
                                    tone="emerald"
                                    label={item.invoiceCode}
                                    onClick={() =>
                                      onNavigateCrossLink({
                                        tab: 'sales',
                                        recordId: item.saleId,
                                        voucherCode: item.invoiceCode,
                                        label: `Hóa đơn ${item.invoiceCode}`,
                                      })
                                    }
                                  />
                                ) : (
                                  <div className="font-mono font-semibold text-slate-900">
                                    {item.invoiceCode}
                                  </div>
                                )}
                                <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                                  {item.date}
                                </div>
                              </td>
                              <td className="py-2.5 px-2.5 min-w-[165px] align-middle">
                                <div className="font-semibold text-slate-900 leading-snug">
                                  {item.productName}
                                </div>
                                <div className="text-[11px] text-slate-500 mt-0.5">
                                  Đơn giá: {formatVND(item.unitPrice)} / {item.unit}
                                </div>
                              </td>
                              <td className="py-2.5 px-2.5 text-center font-mono whitespace-nowrap align-middle">
                                {item.quantity} {item.unit}
                              </td>
                              <td className="py-2.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap align-middle">
                                {formatVND(item.totalAmount)}
                              </td>
                              <td className="py-2.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap align-middle">
                                <span
                                  className={
                                    item.debtAmount > 0
                                      ? 'font-bold text-red-600'
                                      : 'text-emerald-700 font-medium'
                                  }
                                >
                                  {item.debtAmount > 0 ? formatVND(item.debtAmount) : '0 đ'}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Summary Strip of Received Items in Range */}
                  <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-slate-600">
                      Tổng hợp kỳ ({customerReceivedItemsReport.totalItemsCount} mặt hàng /{' '}
                      {customerReceivedItemsReport.totalQuantity} ĐVT):
                    </span>
                    <div className="flex flex-wrap items-center gap-3 font-mono">
                      <span>
                        Tổng nhận: <strong>{formatVND(customerReceivedItemsReport.totalAmount)}</strong>
                      </span>
                      <span className="text-red-600 font-bold">
                        Còn nợ: {formatVND(customerReceivedItemsReport.totalDebt)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions: Print Combined PDF Voucher, Export Excel, Batch Collect Debt */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      exportCombinedReceivedItemsAndDebtPDF({
                        customerName: activeEntry.customer.name,
                        customerPhone: activeEntry.customer.phone,
                        customerAddress: activeEntry.customer.address,
                        fromDate: itemsFromDate,
                        toDate: itemsToDate,
                        items: customerReceivedItemsReport.items,
                        onlyUnpaid: onlyUnpaidItems,
                        staffName: 'Trần Đình Nhất',
                      })
                    }
                    className="px-3 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>In Phiếu Tổng Hợp Hàng Nhận & Công Nợ (PDF)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      exportCombinedReceivedItemsAndDebtExcel({
                        customerName: activeEntry.customer.name,
                        fromDate: itemsFromDate,
                        toDate: itemsToDate,
                        items: customerReceivedItemsReport.items,
                        onlyUnpaid: onlyUnpaidItems,
                        staffName: 'Trần Đình Nhất',
                      })
                    }
                    className="px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                    <span>Xuất Báo Cáo Hàng Nhận (Excel)</span>
                  </button>

                  {customerReceivedItemsReport.totalDebt > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setBatchCollectAmount(String(customerReceivedItemsReport.totalDebt));
                        setBatchCollectNote(
                          `Thu nợ tổng hợp các mặt hàng từ ${itemsFromDate} đến ${itemsToDate}`
                        );
                        setIsBatchCollectOpen(true);
                      }}
                      className="px-3 py-1.5 text-xs font-bold text-amber-900 bg-amber-100 border border-amber-300 hover:bg-amber-200 rounded-lg flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Wallet className="w-3.5 h-3.5 text-amber-800" />
                      <span>
                        Thu nợ tổng hợp trong kỳ ({formatVND(customerReceivedItemsReport.totalDebt)})
                      </span>
                    </button>
                  )}
                </div>
              </div>

              <div className="p-4 sm:p-5">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-bold text-slate-900">
                    Lịch sử giao dịch mua hàng ({activeEntry.ledger.transactions.length} đơn)
                  </h4>
                </div>

                {activeEntry.ledger.transactions.length === 0 ? (
                  <p className="text-xs text-slate-500 py-6 text-center">
                    Khách hàng này chưa có giao dịch mua hàng nào.
                  </p>
                ) : (
                  <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                    {activeEntry.ledger.transactions.map((tx) => {
                      const { urgency, daysRemaining } = evaluateDebtUrgency(
                        tx.dueDate,
                        tx.debtAmount,
                        todayStr,
                        leadDays
                      );
                      return (
                        <div
                          key={tx.id}
                          className="p-3.5 rounded-lg border border-slate-200 bg-white space-y-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {onNavigateCrossLink ? (
                                <CrossLinkChip
                                  tone="emerald"
                                  label={tx.invoiceCode}
                                  onClick={() =>
                                    onNavigateCrossLink({
                                      tab: 'sales',
                                      recordId: tx.id,
                                      voucherCode: tx.invoiceCode,
                                      label: `Hóa đơn ${tx.invoiceCode}`,
                                    })
                                  }
                                />
                              ) : (
                                <span className="font-mono font-semibold text-slate-900">
                                  {tx.invoiceCode}
                                </span>
                              )}
                              <span className="text-slate-400" aria-hidden="true">·</span>
                              <span className="font-normal text-slate-500 font-mono">
                                {tx.createdAt.slice(0, 10)}
                              </span>
                            </div>
                            <span
                              className={`font-medium ${
                                tx.debtAmount === 0
                                  ? 'text-emerald-700'
                                  : urgency === 'overdue'
                                  ? 'text-red-600 font-semibold'
                                  : 'text-amber-700'
                              }`}
                            >
                              {tx.debtAmount === 0
                                ? 'Đã trả đủ'
                                : urgency === 'overdue'
                                ? `Quá hạn ${Math.abs(daysRemaining)} ngày`
                                : `Hạn trả: ${tx.dueDate}`}
                            </span>
                          </div>

                          <div className="text-xs text-slate-800 font-medium">
                            {tx.productName} ({tx.quantity} {tx.unit} × {formatVND(tx.unitPrice)})
                          </div>

                          {onNavigateCrossLink && (() => {
                            const linkedRvs = findLinkedReceiptVouchersForSale(tx, receiptVouchers);
                            const matchedProd = products.find((p) => p.id === tx.productId);
                            return (
                              <div className="flex flex-wrap items-center gap-1.5">
                                {matchedProd && (
                                  <CrossLinkChip
                                    tone="indigo"
                                    label={`Thẻ kho ${matchedProd.code}`}
                                    onClick={() =>
                                      onNavigateCrossLink({
                                        tab: 'inventory',
                                        recordId: matchedProd.id,
                                        label: `Thẻ kho ${matchedProd.name}`,
                                      })
                                    }
                                  />
                                )}
                                {tx.debtAmount > 0 && (
                                  <CrossLinkChip
                                    tone="amber"
                                    label="Công nợ"
                                    onClick={() =>
                                      onNavigateCrossLink({
                                        tab: 'debts',
                                        recordId: tx.id,
                                        subTab: 'customer',
                                        label: `Công nợ ${tx.invoiceCode}`,
                                      })
                                    }
                                  />
                                )}
                                {linkedRvs.map((rv) => (
                                  <CrossLinkChip
                                    key={rv.id}
                                    tone="rose"
                                    label={`Phiếu thu ${rv.voucherCode}`}
                                    onClick={() =>
                                      onNavigateCrossLink({
                                        tab: 'receipt_vouchers',
                                        recordId: rv.id,
                                        voucherCode: rv.voucherCode,
                                        label: `Phiếu thu ${rv.voucherCode}`,
                                      })
                                    }
                                  />
                                ))}
                              </div>
                            );
                          })()}

                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-1 border-t border-slate-100">
                            <div className="text-slate-600 font-mono tabular-nums">
                              Tổng:{' '}
                              <strong className="text-slate-900">
                                {formatVND(tx.totalAmount)}
                              </strong>
                              {tx.debtAmount > 0 && (
                                <>
                                  <span className="mx-1.5" aria-hidden="true">·</span>
                                  <span className="text-red-600 font-semibold">
                                    Còn nợ: {formatVND(tx.debtAmount)}
                                  </span>
                                </>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  exportSaleInvoicePDF({
                                    ...tx,
                                    customerAddress: activeEntry.customer.address,
                                  })
                                }
                                className="px-2 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap"
                              >
                                In HĐ PDF
                              </button>
                              {tx.debtAmount > 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCollectingSale(tx);
                                    setCollectAmount(String(tx.debtAmount));
                                    setCollectNote(`Thu nợ hóa đơn ${tx.invoiceCode}`);
                                  }}
                                  className="px-2.5 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md transition-colors whitespace-nowrap"
                                >
                                  Thu nợ & In Phiếu
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Excel Sample Template Download & Upload Bar (Moved to bottom of page) */}
      <ExcelDataBar
        moduleType="customers"
        moduleTitle="Quản Lý Khách Hàng"
        onImportRows={onImportCustomersFromExcel}
        onExportCurrentData={() =>
          exportModuleDataExcel({
            moduleType: 'customers',
            products,
            customers,
            sales,
            imports,
          })
        }
      />

      {/* Modal: Thu nợ tổng hợp các mặt hàng đã nhận trong kỳ (Từ ngày ... Đến ngày ...) */}
      {isBatchCollectOpen && activeEntry && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2.5 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Thu nợ tổng hợp trong kỳ và xuất phiếu chung"
        >
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-lg max-h-[calc(100dvh-1.25rem)] flex flex-col overflow-hidden shadow-xl">
            <div className="px-4 sm:px-6 py-3.5 border-b border-slate-200 flex items-center justify-between bg-white shrink-0">
              <h3 className="text-sm sm:text-base font-bold text-slate-900">
                Thu nợ tổng hợp & In Phiếu Tổng Hợp ({itemsFromDate} → {itemsToDate})
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
                  Khách hàng: <strong className="text-slate-900">{activeEntry.customer.name}</strong> ({activeEntry.customer.phone})
                </div>
                <div>
                  Kỳ đối soát hàng đã nhận: <strong className="font-mono">{itemsFromDate}</strong> đến{' '}
                  <strong className="font-mono">{itemsToDate}</strong>
                </div>
                <div>
                  Tổng số mặt hàng còn nợ trong kỳ:{' '}
                  <strong>
                    {customerReceivedItemsReport.items.filter((i) => i.debtAmount > 0).length} đơn hàng
                  </strong>{' '}
                  · Tổng nợ kỳ này:{' '}
                  <strong className="font-mono text-red-600">
                    {formatVND(customerReceivedItemsReport.totalDebt)}
                  </strong>
                </div>
              </div>

              <div>
                <label
                  htmlFor="batch-collect-amount"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Số tiền khách thanh toán cho các mặt hàng trong kỳ (VNĐ) *
                </label>
                <input
                  id="batch-collect-amount"
                  type="number"
                  min={1000}
                  max={customerReceivedItemsReport.totalDebt}
                  value={batchCollectAmount}
                  onChange={(e) => setBatchCollectAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label
                  htmlFor="batch-collect-note"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Ghi chú thu nợ tổng hợp (Tự động trừ các hóa đơn nợ cũ theo thứ tự ngày nợ)
                </label>
                <input
                  id="batch-collect-note"
                  type="text"
                  value={batchCollectNote}
                  onChange={(e) => setBatchCollectNote(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                />
              </div>

              {/* Live FIFO Debt Allocation Preview by Date */}
              {(() => {
                const fifoPreview = previewCustomerFifoDebtSettlement(
                  sales,
                  {
                    customerId: activeEntry.customer.id,
                    customerPhone: activeEntry.customer.phone,
                    customerName: activeEntry.customer.name,
                  },
                  Math.max(0, Number(batchCollectAmount) || 0)
                );
                if (fifoPreview.allocations.length === 0) return null;
                return (
                  <div className="bg-amber-50/70 border border-amber-200 rounded-lg overflow-hidden">
                    <div className="px-3 py-2 bg-amber-100/70 border-b border-amber-200 flex items-center justify-between text-[11px] font-bold text-amber-950">
                      <span>Thứ tự trừ tự động theo ngày nợ (Cũ → Mới)</span>
                      <span>Tự động trừ: {formatVND(fifoPreview.totalAllocated)}</span>
                    </div>
                    <div className="divide-y divide-amber-100 max-h-40 overflow-y-auto bg-white">
                      {fifoPreview.allocations.map((alloc, idx) => (
                        <div
                          key={alloc.recordId}
                          className="px-3 py-1.5 flex items-center justify-between text-xs"
                        >
                          <div>
                            <span className="font-mono font-bold text-slate-900">
                              #{idx + 1} {alloc.code}
                            </span>{' '}
                            <span className="text-[11px] text-slate-500 font-mono">
                              ({alloc.date})
                            </span>
                            <div className="text-[11px] text-slate-600">
                              {alloc.productName} · Nợ: {formatVND(alloc.previousDebt)}
                            </div>
                          </div>
                          <div className="text-right font-mono">
                            <div className="font-bold text-emerald-700">
                              -{formatVND(alloc.allocatedAmount)}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              Còn: {formatVND(alloc.remainingDebt)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
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
                  const amountVal = Math.max(0, Number(batchCollectAmount) || 0);
                  if (amountVal <= 0) return;

                  if (onSettleCustomerTotalDebtFifo) {
                    onSettleCustomerTotalDebtFifo({
                      customerId: activeEntry.customer.id,
                      customerName: activeEntry.customer.name,
                      customerPhone: activeEntry.customer.phone,
                      totalAmount: amountVal,
                      groupName: 'Thu nợ bán hàng khách hàng',
                      paymentMethod: 'Chuyển khoản ngân hàng',
                      note:
                        batchCollectNote.trim() ||
                        `Thu nợ tổng hợp theo thứ tự ngày nợ (${itemsFromDate} -> ${itemsToDate})`,
                    });
                  } else {
                    let remainingToAllocate = amountVal;
                    const unpaidRows = [...customerReceivedItemsReport.items]
                      .filter((i) => i.debtAmount > 0)
                      .sort((a, b) => a.date.localeCompare(b.date));
                    unpaidRows.forEach((row) => {
                      if (remainingToAllocate <= 0) return;
                      const payForThisSale = Math.min(row.debtAmount, remainingToAllocate);
                      if (payForThisSale > 0) {
                        onCollectCustomerDebt(
                          row.saleId,
                          payForThisSale,
                          batchCollectNote.trim() ||
                            `Thu nợ tổng hợp kỳ ${itemsFromDate} -> ${itemsToDate}`
                        );
                        remainingToAllocate -= payForThisSale;
                      }
                    });
                  }
                  exportCombinedReceivedItemsAndDebtPDF({
                    customerName: activeEntry.customer.name,
                    customerPhone: activeEntry.customer.phone,
                    customerAddress: activeEntry.customer.address,
                    fromDate: itemsFromDate,
                    toDate: itemsToDate,
                    items: customerReceivedItemsReport.items,
                    onlyUnpaid: onlyUnpaidItems,
                    collectedThisSession: amountVal,
                    staffName: 'Trần Đình Nhất',
                  });
                  setIsBatchCollectOpen(false);
                }}
                className="px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg flex items-center gap-1.5"
              >
                <FileDown className="w-3.5 h-3.5" />
                <span>Xác nhận thu nợ theo ngày nợ & In Phiếu Tổng Hợp PDF</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add / Edit Customer with Inline Customer Group Creation */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2.5 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={editingCustomer ? 'Cập nhật hồ sơ khách hàng' : 'Thêm khách hàng mới'}
        >
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-lg max-h-[calc(100dvh-1.25rem)] sm:max-h-[90vh] flex flex-col overflow-hidden shadow-xl">
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 flex items-center justify-between shrink-0 bg-white">
              <h3 className="text-sm sm:text-base font-bold text-slate-900">
                {editingCustomer ? 'Cập nhật hồ sơ khách hàng' : 'Thêm khách hàng mới'}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                aria-label="Đóng cửa sổ khách hàng"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitCustomer} className="flex flex-col flex-1 min-h-0 overflow-hidden">
              <div className="p-4 sm:p-6 space-y-3.5 sm:space-y-4 overflow-y-auto flex-1 overscroll-contain">
              {formError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 font-medium">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label
                    htmlFor="cust-code"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Mã KH (Tự sinh nếu trống)
                  </label>
                  <input
                    id="cust-code"
                    type="text"
                    value={formCode}
                    onChange={(e) => setFormCode(e.target.value)}
                    placeholder={`KH-00${customers.length + 1}`}
                    className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label
                    htmlFor="cust-name"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Họ và tên khách hàng *
                  </label>
                  <input
                    id="cust-name"
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="VD: Ông Nguyễn Văn Hòa"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                <div>
                  <label
                    htmlFor="cust-phone"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Số điện thoại *
                  </label>
                  <input
                    id="cust-phone"
                    type="tel"
                    required
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    placeholder="VD: 0913456789"
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>

                {/* Customer Group Selection + Direct Inline New Group Creation */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-1">
                    <label
                      htmlFor="cust-group"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Phân nhóm khách hàng
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !showNewGroupInput;
                        setShowNewGroupInput(next);
                        setFormGroup(next ? '__new_group__' : '');
                      }}
                      className="text-[11px] font-semibold text-emerald-700 hover:underline flex items-center gap-0.5 whitespace-nowrap"
                    >
                      <FolderPlus className="w-3 h-3" />
                      <span>{showNewGroupInput ? 'Đóng' : '+ Tạo nhóm mới'}</span>
                    </button>
                  </div>

                  <SearchableSelect
                    id="cust-group"
                    value={formGroup === '__new_group__' ? '' : formGroup}
                    onChange={(val) => {
                      setFormGroup(val);
                      setShowNewGroupInput(false);
                    }}
                    placeholder="Gõ tên phân nhóm KH để chọn nhanh..."
                    emptyOptionLabel="-- Chưa chọn nhóm --"
                    createActionLabel="+ Tạo nhóm khách hàng mới trực tiếp..."
                    onCreateAction={(kw) => {
                      setFormGroup('__new_group__');
                      setShowNewGroupInput(true);
                      if (kw) setNewGroupName(kw);
                    }}
                    options={customerGroups.map((grp) => ({
                      value: grp,
                      label: grp,
                      keywords: grp,
                    }))}
                  />

                  {showNewGroupInput && (
                    <div className="p-2.5 bg-emerald-50/70 border border-emerald-200 rounded-lg space-y-2">
                      <input
                        id="inline-new-cust-group"
                        type="text"
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        placeholder="Nhập tên nhóm mới (VD: Đại lý cấp 1, HTX)..."
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
                      />
                      <button
                        type="button"
                        onClick={handleConfirmInlineGroup}
                        className="w-full py-1 px-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md"
                      >
                        Thêm nhóm mới & Chọn ngay
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label
                  htmlFor="cust-email"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Địa chỉ Email
                </label>
                <input
                  id="cust-email"
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="VD: khachhang@gmail.com"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label
                  htmlFor="cust-address"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Địa chỉ nhận hàng / Canh tác
                </label>
                <input
                  id="cust-address"
                  type="text"
                  value={formAddress}
                  onChange={(e) => setFormAddress(e.target.value)}
                  placeholder="VD: Ấp 3, Xã Tân Thạnh, Huyện Tháp Mười, Đồng Tháp"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label
                  htmlFor="cust-note"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Ghi chú canh tác / Hạn mức tín dụng
                </label>
                <textarea
                  id="cust-note"
                  rows={2}
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  placeholder="Ghi chú mùa vụ, diện tích canh tác hoặc thói quen thanh toán..."
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                />
              </div>

              </div>

              <div className="px-4 sm:px-6 py-3 border-t border-slate-200 bg-slate-50/90 flex items-center justify-end gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                >
                  Lưu hồ sơ khách hàng
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Quick Debt Collection + PDF Receipt Export */}
      {collectingSale && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2.5 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Ghi nhận thu nợ khách hàng"
        >
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-md max-h-[calc(100dvh-1.25rem)] sm:max-h-[90vh] flex flex-col overflow-hidden shadow-xl">
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 flex items-center justify-between shrink-0 bg-white">
              <h3 className="text-sm sm:text-base font-bold text-slate-900">
                Thu nợ hóa đơn {collectingSale.invoiceCode}
              </h3>
              <button
                type="button"
                onClick={() => setCollectingSale(null)}
                aria-label="Đóng cửa sổ thu nợ"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitCollectDebt(false);
              }}
              className="flex flex-col flex-1 min-h-0 overflow-hidden"
            >
              <div className="p-4 sm:p-6 space-y-3.5 sm:space-y-4 overflow-y-auto flex-1 overscroll-contain">
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1">
                <div>
                  Khách hàng: <strong>{collectingSale.customerName}</strong>
                </div>
                <div>
                  Dư nợ hiện tại:{' '}
                  <strong className="font-mono text-red-600">
                    {formatVND(collectingSale.debtAmount)}
                  </strong>
                </div>
              </div>

              <div>
                <label
                  htmlFor="collect-amount-input"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Số tiền khách thanh toán (VNĐ) *
                </label>
                <input
                  id="collect-amount-input"
                  type="number"
                  min={1000}
                  max={collectingSale.debtAmount}
                  required
                  value={collectAmount}
                  onChange={(e) => setCollectAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label
                  htmlFor="collect-note-input"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Ghi chú thu nợ
                </label>
                <input
                  id="collect-note-input"
                  type="text"
                  value={collectNote}
                  onChange={(e) => setCollectNote(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                />
              </div>

              </div>

              <div className="px-4 sm:px-6 py-3 border-t border-slate-200 bg-slate-50/90 flex flex-wrap items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setCollectingSale(null)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                >
                  Xác nhận thu nợ
                </button>
                <button
                  type="button"
                  onClick={() => submitCollectDebt(true)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-900 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1"
                >
                  <FileDown className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Thu nợ & Xuất Phiếu PDF</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

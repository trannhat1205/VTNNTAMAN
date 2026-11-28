import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  FileDown,
  Lock,
  MessageCircle,
  Pencil,
  QrCode,
  Search,
  Trash2,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  CashPaymentVoucher,
  CashReceiptVoucher,
  CrossLinkNavigateRequest,
  CustomerProfile,
  ImportTransaction,
  ProductItem,
  SaleTransaction,
  StockAdjustmentRecord,
  UserRole,
  VietQrBankConfig,
} from '../types';
import {
  buildZaloDebtReminderMessage,
  canPerformRoleAction,
  computeDebtAgingSummary,
  computeDueDateAfterDays,
  DEBT_TERM_DAY_OPTIONS,
  diagnoseImportVoucher,
  diagnoseSaleVoucher,
  evaluateDebtUrgency,
  findAllVouchersForImport,
  findAllVouchersForSale,
  formatVND,
  getTodayVietnamDateStr,
  isDirectImportPaymentVoucher,
  isDirectSaleReceiptVoucher,
  matchDebtTermDays,
  normalizeVietnameseSearch,
  previewCustomerFifoDebtSettlement,
  previewSupplierFifoDebtSettlement,
  toVietnamDateStr,
} from '../utils/businessLogic';
import {
  exportCustomerReceiptPDF,
  exportModuleDataExcel,
  exportSupplierPaymentPDF,
} from '../utils/exportReports';
import { ExcelDataBar } from './ExcelDataBar';
import { VietQrPaymentModal } from './VietQrPaymentModal';
import {
  buildCustomerZaloDebtReminderQueue,
  CustomerZaloReminderItem,
  formatVietQrSummaryForDebt,
  loadZaloRemindedTodaySet,
  markCustomerZaloRemindedToday,
} from '../utils/smartInsights';
import {
  CancelImportConfirmModal,
  CancelSaleConfirmModal,
  CrossLinkChip,
} from './VoucherCrossLinkUI';

interface DebtModuleProps {
  products: ProductItem[];
  customers: CustomerProfile[];
  imports: ImportTransaction[];
  sales: SaleTransaction[];
  receiptVouchers?: CashReceiptVoucher[];
  paymentVouchers?: CashPaymentVoucher[];
  stockAdjustments?: StockAdjustmentRecord[];
  role: UserRole;
  leadDays: number;
  focusedRecordId?: string | null;
  onClearFocusedRecord?: () => void;
  onNavigateCrossLink?: (req: CrossLinkNavigateRequest) => void;
  onPaySupplierDebt: (importId: string, amount: number, note: string) => void;
  onCollectCustomerDebt: (saleId: string, amount: number, note: string) => void;
  onUpdateSale: (
    saleId: string,
    changes: {
      invoiceCode: string;
      warehouseName: string;
      customerName: string;
      customerPhone: string;
      productName: string;
      unit: string;
      quantity: number;
      unitPrice: number;
      paidAmount: number;
      dueDate: string;
      note: string;
    }
  ) => void;
  onDeleteSale: (saleId: string) => void;
  onUpdateImport: (
    importId: string,
    changes: {
      receiptCode: string;
      warehouseName: string;
      supplierName: string;
      supplierPhone: string;
      productName: string;
      unit: string;
      quantity: number;
      unitCost: number;
      paidAmount: number;
      dueDate: string;
      note: string;
    }
  ) => void;
  onDeleteImport: (importId: string) => void;
  onImportDebtPaymentsFromExcel: (rows: Record<string, unknown>[]) => number;
  canAccessCustomerDebts?: boolean;
  canAccessSupplierDebts?: boolean;
  receiptGroups?: string[];
  paymentGroups?: string[];
  onSettleCustomerTotalDebtFifo?: (params: {
    customerId?: string;
    customerName: string;
    customerPhone: string;
    totalAmount: number;
    groupName: string;
    paymentMethod: string;
    note: string;
  }) => void;
  onSettleSupplierTotalDebtFifo?: (params: {
    supplierName: string;
    supplierPhone: string;
    totalAmount: number;
    groupName: string;
    paymentMethod: string;
    note: string;
  }) => void;
  storeName?: string;
  bankQrConfig?: VietQrBankConfig | null;
  onSaveBankQrConfig?: (config: VietQrBankConfig) => void;
  onShowToast?: (msg: string) => void;
}

export const DebtModule: React.FC<DebtModuleProps> = ({
  products,
  customers,
  imports,
  sales,
  receiptVouchers = [],
  paymentVouchers = [],
  stockAdjustments = [],
  role,
  leadDays,
  focusedRecordId,
  onClearFocusedRecord,
  onNavigateCrossLink,
  onPaySupplierDebt,
  onCollectCustomerDebt,
  onUpdateSale,
  onDeleteSale,
  onUpdateImport,
  onDeleteImport,
  onImportDebtPaymentsFromExcel,
  canAccessCustomerDebts = true,
  canAccessSupplierDebts = true,
  receiptGroups = ['Thu nợ bán hàng khách hàng'],
  paymentGroups = ['Chi trả nợ Nhà cung cấp'],
  onSettleCustomerTotalDebtFifo,
  onSettleSupplierTotalDebtFifo,
  storeName = 'VTNN Tâm An',
  bankQrConfig,
  onSaveBankQrConfig,
  onShowToast,
}) => {
  const [activeTab, setActiveTab] = useState<'supplier' | 'customer'>(
    canAccessSupplierDebts ? 'supplier' : 'customer'
  );
  const [urgencyFilter, setUrgencyFilter] = useState<'all' | 'overdue' | 'due_soon'>('all');
  const [agingFilter, setAgingFilter] = useState<
    'all' | 'not_due' | 'overdue_1_30' | 'overdue_31_60' | 'overdue_over_60'
  >('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLinkedVoucherId, setSelectedLinkedVoucherId] = useState<string | null>(null);

  // Lump-sum FIFO Debt Settlement state (auto-deduct across all older unpaid invoices/receipts by debt date)
  const [fifoPartnerKey, setFifoPartnerKey] = useState<string>('');
  const [fifoLumpSumInput, setFifoLumpSumInput] = useState<string>('');
  const [fifoGroupName, setFifoGroupName] = useState<string>(
    canAccessSupplierDebts
      ? paymentGroups[0] || 'Chi trả nợ Nhà cung cấp'
      : receiptGroups[0] || 'Thu nợ bán hàng khách hàng'
  );
  const [fifoPaymentMethod, setFifoPaymentMethod] = useState<string>('Chuyển khoản ngân hàng');
  const [fifoNote, setFifoNote] = useState<string>('');
  const [fifoFeedback, setFifoFeedback] = useState<string | null>(null);

  useEffect(() => {
    const validGroups = activeTab === 'customer' ? receiptGroups : paymentGroups;
    const defaultGroup =
      activeTab === 'customer'
        ? receiptGroups[0] || 'Thu nợ bán hàng khách hàng'
        : paymentGroups[0] || 'Chi trả nợ Nhà cung cấp';
    if (!validGroups.includes(fifoGroupName)) {
      setFifoGroupName(defaultGroup);
      setFifoPartnerKey('');
      setFifoLumpSumInput('');
    }
  }, [activeTab, receiptGroups, paymentGroups, fifoGroupName]);

  useEffect(() => {
    if (!canAccessSupplierDebts && canAccessCustomerDebts && activeTab === 'supplier') {
      setActiveTab('customer');
    } else if (!canAccessCustomerDebts && canAccessSupplierDebts && activeTab === 'customer') {
      setActiveTab('supplier');
    }
  }, [canAccessCustomerDebts, canAccessSupplierDebts, activeTab]);

  // Sync deep-linked focusedRecordId from Notifications or Dashboard Reminders
  useEffect(() => {
    if (!focusedRecordId) return;
    const matchedImp = imports.find(
      (i) => i.id === focusedRecordId || i.receiptCode === focusedRecordId
    );
    if (matchedImp) {
      setActiveTab('supplier');
      setUrgencyFilter('all');
      setSelectedLinkedVoucherId(matchedImp.id);
      return;
    }
    const matchedSale = sales.find(
      (s) =>
        s.id === focusedRecordId ||
        s.invoiceCode === focusedRecordId ||
        s.customerId === focusedRecordId
    );
    if (matchedSale) {
      setActiveTab('customer');
      setUrgencyFilter('all');
      setSelectedLinkedVoucherId(matchedSale.id);
    }
  }, [focusedRecordId, imports, sales]);

  // Modal state for debt settlement
  const [settlingType, setSettlingType] = useState<'supplier' | 'customer' | null>(null);
  const [settlingId, setSettlingId] = useState<string>('');
  const [settlingCode, setSettlingCode] = useState<string>('');
  const [settlingPartner, setSettlingPartner] = useState<string>('');
  const [settlingPhone, setSettlingPhone] = useState<string>('');
  const [settlingMaxDebt, setSettlingMaxDebt] = useState<number>(0);
  const [paymentAmount, setPaymentAmount] = useState<string>('');
  const [paymentNote, setPaymentNote] = useState<string>('');
  const [vietQrTarget, setVietQrTarget] = useState<{
    title: string;
    subtitle: string;
    amount: number;
    addInfo: string;
    customerPhone?: string;
    zaloMessage?: string;
  } | null>(null);

  // Manager-only Quick Edit & Cancel Debt Record Modal
  const [editingDebtType, setEditingDebtType] = useState<'supplier' | 'customer' | null>(null);
  const [cancelingImport, setCancelingImport] = useState<ImportTransaction | null>(null);
  const [cancelingSale, setCancelingSale] = useState<SaleTransaction | null>(null);
  const [editingDebtId, setEditingDebtId] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editWarehouse, setEditWarehouse] = useState('');
  const [editPartner, setEditPartner] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editProduct, setEditProduct] = useState('');
  const [editUnit, setEditUnit] = useState('');
  const [editQty, setEditQty] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editPaid, setEditPaid] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editNote, setEditNote] = useState('');

  const supplierDebts = imports.filter((i) => i.debtAmount > 0);
  const customerDebts = sales.filter((s) => s.debtAmount > 0);

  const totalSupplierDebt = supplierDebts.reduce((sum, i) => sum + i.debtAmount, 0);
  const totalCustomerDebt = customerDebts.reduce((sum, s) => sum + s.debtAmount, 0);

  const todayStr = getTodayVietnamDateStr();
  const [isZaloQueueExpanded, setIsZaloQueueExpanded] = useState<boolean>(true);
  const [zaloQueueFilter, setZaloQueueFilter] = useState<'urgent' | 'overdue' | 'all'>('urgent');
  const [expandedZaloMsgKey, setExpandedZaloMsgKey] = useState<string | null>(null);
  const [remindedTodayKeys, setRemindedTodayKeys] = useState<Set<string>>(() =>
    loadZaloRemindedTodaySet(todayStr)
  );

  const zaloReminderQueue = useMemo(
    () =>
      buildCustomerZaloDebtReminderQueue({
        sales,
        customers,
        storeName,
        bankQrConfig,
        todayStr,
        leadDays,
      }),
    [sales, customers, storeName, bankQrConfig, todayStr, leadDays]
  );

  const urgentZaloCount = useMemo(
    () => zaloReminderQueue.filter((item) => item.urgency !== 'normal').length,
    [zaloReminderQueue]
  );
  const overdueZaloCount = useMemo(
    () => zaloReminderQueue.filter((item) => item.urgency === 'overdue').length,
    [zaloReminderQueue]
  );

  const displayedZaloQueue = useMemo(() => {
    if (zaloQueueFilter === 'overdue') {
      return zaloReminderQueue.filter((item) => item.urgency === 'overdue');
    }
    if (zaloQueueFilter === 'urgent') {
      const urgent = zaloReminderQueue.filter((item) => item.urgency !== 'normal');
      return urgent.length > 0 ? urgent : zaloReminderQueue;
    }
    return zaloReminderQueue;
  }, [zaloReminderQueue, zaloQueueFilter]);

  const handleDispatchZaloQueueItem = (
    item: CustomerZaloReminderItem,
    openZaloTab: boolean
  ) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(item.message).catch(() => undefined);
    }
    const updatedSet = markCustomerZaloRemindedToday(item.customerKey, todayStr);
    setRemindedTodayKeys(new Set(updatedSet));
    const notify = (msg: string) => {
      if (onShowToast) onShowToast(msg);
      else setFifoFeedback(msg);
    };
    if (openZaloTab && item.zaloUrl && typeof window !== 'undefined') {
      window.open(item.zaloUrl, '_blank', 'noopener,noreferrer');
      notify(`Đã sao chép tin nhắc nợ + VietQR cho ${item.customerName} & mở Zalo!`);
    } else if (openZaloTab && !item.zaloUrl) {
      notify(
        `Đã sao chép tin nhắc nợ + VietQR cho ${item.customerName} (khách chưa có SĐT để mở Zalo tự động).`
      );
    } else {
      notify(`Đã sao chép nội dung nhắc nợ + VietQR của ${item.customerName}!`);
    }
  };
  const overdueSuppliers = supplierDebts.filter(
    (i) => evaluateDebtUrgency(i.dueDate, i.debtAmount, todayStr, leadDays).urgency === 'overdue'
  );
  const dueSoonSuppliers = supplierDebts.filter(
    (i) => evaluateDebtUrgency(i.dueDate, i.debtAmount, todayStr, leadDays).urgency === 'due_soon'
  );

  const overdueCustomers = customerDebts.filter(
    (s) => evaluateDebtUrgency(s.dueDate, s.debtAmount, todayStr, leadDays).urgency === 'overdue'
  );
  const dueSoonCustomers = customerDebts.filter(
    (s) => evaluateDebtUrgency(s.dueDate, s.debtAmount, todayStr, leadDays).urgency === 'due_soon'
  );

  const matchesAgingFilter = (dueDate: string): boolean => {
    if (agingFilter === 'all') return true;
    const { daysRemaining } = evaluateDebtUrgency(dueDate, 1, todayStr, leadDays);
    if (agingFilter === 'not_due') return daysRemaining >= 0;
    if (agingFilter === 'overdue_1_30') return daysRemaining < 0 && daysRemaining >= -30;
    if (agingFilter === 'overdue_31_60') return daysRemaining < -30 && daysRemaining >= -60;
    return daysRemaining < -60;
  };

  const activeAgingSummary = computeDebtAgingSummary(
    activeTab === 'supplier'
      ? (supplierDebts as Array<{ debtAmount: number; dueDate: string }>)
      : customerDebts,
    todayStr
  );

  const handleOpenCustomerDebtQr = (sale: SaleTransaction, customAmount?: number) => {
    const qrAmt = customAmount && customAmount > 0 ? customAmount : sale.debtAmount;
    const matchingUnpaid = customerDebts.filter(
      (s) =>
        (sale.customerId && s.customerId === sale.customerId) ||
        (sale.customerPhone && s.customerPhone === sale.customerPhone) ||
        s.customerName === sale.customerName
    );
    const totalCustDebt = matchingUnpaid.reduce((sum, s) => sum + s.debtAmount, 0);
    const qrSummary = formatVietQrSummaryForDebt(
      bankQrConfig,
      qrAmt,
      `THU NO ${sale.invoiceCode} ${sale.customerName}`
    );
    const { message } = buildZaloDebtReminderMessage({
      storeName,
      customerName: sale.customerName,
      customerPhone: sale.customerPhone,
      totalDebt: totalCustDebt,
      unpaidInvoices: matchingUnpaid.map((s) => ({
        invoiceCode: s.invoiceCode,
        date: s.createdAt.slice(0, 10),
        productName: s.productName,
        debtAmount: s.debtAmount,
        dueDate: s.dueDate,
      })),
      todayStr,
      vietQrSummary: qrSummary,
    });
    setVietQrTarget({
      title: `VietQR thu nợ ${sale.customerName}`,
      subtitle: `Hóa đơn ${sale.invoiceCode} · Còn nợ ${formatVND(sale.debtAmount)}`,
      amount: qrAmt,
      addInfo: `THU NO ${sale.invoiceCode} ${sale.customerName}`,
      customerPhone: sale.customerPhone,
      zaloMessage: message,
    });
  };

  const handleSendZaloReminder = (sale: SaleTransaction) => {
    const matchingUnpaid = customerDebts.filter(
      (s) =>
        (sale.customerId && s.customerId === sale.customerId) ||
        (sale.customerPhone && s.customerPhone === sale.customerPhone) ||
        s.customerName === sale.customerName
    );
    const totalCustDebt = matchingUnpaid.reduce((sum, s) => sum + s.debtAmount, 0);
    const qrSummary = formatVietQrSummaryForDebt(
      bankQrConfig,
      totalCustDebt,
      matchingUnpaid.length === 1
        ? `THU NO ${sale.invoiceCode} ${sale.customerName}`
        : `THU NO ${sale.customerName}`
    );
    const { message, zaloUrl } = buildZaloDebtReminderMessage({
      storeName,
      customerName: sale.customerName,
      customerPhone: sale.customerPhone,
      totalDebt: totalCustDebt,
      unpaidInvoices: matchingUnpaid.map((s) => ({
        invoiceCode: s.invoiceCode,
        date: s.createdAt.slice(0, 10),
        productName: s.productName,
        debtAmount: s.debtAmount,
        dueDate: s.dueDate,
      })),
      todayStr,
      vietQrSummary: qrSummary,
    });
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(message).catch(() => undefined);
    }
    const matchedQueueItem = zaloReminderQueue.find(
      (q) =>
        (sale.customerId && q.customerId === sale.customerId) ||
        (sale.customerPhone && q.customerPhone === sale.customerPhone) ||
        q.customerName === sale.customerName
    );
    if (matchedQueueItem) {
      setRemindedTodayKeys(
        new Set(markCustomerZaloRemindedToday(matchedQueueItem.customerKey, todayStr))
      );
    }
    const toastMsg = zaloUrl
      ? `Đã sao chép tin nhắn nhắc nợ (kèm VietQR) cho ${sale.customerName} & mở Zalo!`
      : `Đã sao chép nội dung nhắc nợ (kèm VietQR) cho ${sale.customerName} (chưa có SĐT để mở Zalo trực tiếp).`;
    if (onShowToast) {
      onShowToast(toastMsg);
    } else {
      setFifoFeedback(toastMsg);
    }
    if (zaloUrl && typeof window !== 'undefined') {
      window.open(zaloUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const filteredSupplierDebts = supplierDebts.filter((item) => {
    const { urgency } = evaluateDebtUrgency(item.dueDate, item.debtAmount, todayStr, leadDays);
    if (urgencyFilter === 'overdue' && urgency !== 'overdue') return false;
    if (urgencyFilter === 'due_soon' && urgency !== 'due_soon') return false;
    if (!matchesAgingFilter(item.dueDate)) return false;
    const q = normalizeVietnameseSearch(searchTerm);
    if (!q) return true;
    const haystack = normalizeVietnameseSearch(
      `${item.supplierName} ${item.receiptCode} ${item.productName} ${item.supplierPhone}`
    );
    return haystack.includes(q);
  });

  const filteredCustomerDebts = customerDebts.filter((item) => {
    const { urgency } = evaluateDebtUrgency(item.dueDate, item.debtAmount, todayStr, leadDays);
    if (urgencyFilter === 'overdue' && urgency !== 'overdue') return false;
    if (urgencyFilter === 'due_soon' && urgency !== 'due_soon') return false;
    if (!matchesAgingFilter(item.dueDate)) return false;
    const q = normalizeVietnameseSearch(searchTerm);
    if (!q) return true;
    const haystack = normalizeVietnameseSearch(
      `${item.customerName} ${item.invoiceCode} ${item.customerPhone} ${item.productName}`
    );
    return haystack.includes(q);
  });

  const linkedSupplierRecord =
    supplierDebts.find((i) => i.id === selectedLinkedVoucherId) || null;
  const linkedCustomerRecord =
    customerDebts.find((s) => s.id === selectedLinkedVoucherId) || null;

  const handleOpenSettle = (
    type: 'supplier' | 'customer',
    id: string,
    code: string,
    partner: string,
    phone: string,
    debt: number
  ) => {
    setSettlingType(type);
    setSettlingId(id);
    setSettlingCode(code);
    setSettlingPartner(partner);
    setSettlingPhone(phone);
    setSettlingMaxDebt(debt);
    setPaymentAmount(String(debt));
    setPaymentNote(
      type === 'supplier'
        ? `Thanh toán công nợ NCC phiếu ${code}`
        : `Thu tiền công nợ khách hàng hóa đơn ${code}`
    );
  };

  const openManagerEditSupplierDebt = (imp: ImportTransaction) => {
    if (!canPerformRoleAction(role, 'edit_record')) return;
    setEditingDebtType('supplier');
    setEditingDebtId(imp.id);
    setEditCode(imp.receiptCode);
    setEditWarehouse(imp.warehouseName || 'Tâm An Mỹ Ngãi');
    setEditPartner(imp.supplierName);
    setEditPhone(imp.supplierPhone);
    setEditProduct(imp.productName);
    setEditUnit(imp.unit);
    setEditQty(String(imp.quantity));
    setEditPrice(String(imp.unitCost));
    setEditPaid(String(imp.paidAmount));
    setEditDueDate(imp.dueDate);
    setEditNote(imp.note);
  };

  const openManagerEditCustomerDebt = (sale: SaleTransaction) => {
    if (!canPerformRoleAction(role, 'edit_record')) return;
    setEditingDebtType('customer');
    setEditingDebtId(sale.id);
    setEditCode(sale.invoiceCode);
    setEditWarehouse(sale.warehouseName || 'Tâm An Mỹ Ngãi');
    setEditPartner(sale.customerName);
    setEditPhone(sale.customerPhone);
    setEditProduct(sale.productName);
    setEditUnit(sale.unit);
    setEditQty(String(sale.quantity));
    setEditPrice(String(sale.unitPrice));
    setEditPaid(String(sale.paidAmount));
    setEditDueDate(sale.dueDate);
    setEditNote(sale.note);
  };

  const submitManagerEditDebt = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDebtType || !canPerformRoleAction(role, 'edit_record')) return;
    if (editingDebtType === 'supplier') {
      onUpdateImport(editingDebtId, {
        receiptCode: editCode,
        warehouseName: editWarehouse,
        supplierName: editPartner,
        supplierPhone: editPhone,
        productName: editProduct,
        unit: editUnit,
        quantity: Math.max(1, Number(editQty) || 1),
        unitCost: Math.max(0, Number(editPrice) || 0),
        paidAmount: Math.max(0, Number(editPaid) || 0),
        dueDate: editDueDate,
        note: editNote,
      });
    } else {
      onUpdateSale(editingDebtId, {
        invoiceCode: editCode,
        warehouseName: editWarehouse,
        customerName: editPartner,
        customerPhone: editPhone,
        productName: editProduct,
        unit: editUnit,
        quantity: Math.max(1, Number(editQty) || 1),
        unitPrice: Math.max(0, Number(editPrice) || 0),
        paidAmount: Math.max(0, Number(editPaid) || 0),
        dueDate: editDueDate,
        note: editNote,
      });
    }
    setEditingDebtType(null);
  };

  const submitDebtPayment = (shouldExportPDF: boolean) => {
    const val = Number(paymentAmount);
    if (!val || val <= 0 || !settlingType) return;
    const remaining = Math.max(0, settlingMaxDebt - val);

    if (settlingType === 'supplier') {
      onPaySupplierDebt(settlingId, val, paymentNote.trim());
      if (shouldExportPDF) {
        exportSupplierPaymentPDF({
          voucherCode: `PC-${Date.now().toString().slice(-4)}`,
          supplierName: settlingPartner,
          supplierPhone: settlingPhone,
          receiptCode: settlingCode,
          previousDebt: settlingMaxDebt,
          paidAmount: val,
          remainingDebt: remaining,
          paymentMethod: 'Chuyển khoản / Tiền mặt',
          note: paymentNote.trim(),
          staffName: 'Trần Đình Nhất (Quản lý chính)',
          createdAt: new Date().toISOString(),
        });
      }
    } else {
      onCollectCustomerDebt(settlingId, val, paymentNote.trim());
      if (shouldExportPDF) {
        exportCustomerReceiptPDF({
          voucherCode: `PT-${Date.now().toString().slice(-4)}`,
          customerName: settlingPartner,
          customerPhone: settlingPhone,
          invoiceCode: settlingCode,
          previousDebt: settlingMaxDebt,
          collectedAmount: val,
          remainingDebt: remaining,
          paymentMethod: 'Tiền mặt / Chuyển khoản',
          note: paymentNote.trim(),
          staffName: 'Trần Đình Nhất (Quản lý chính)',
          createdAt: new Date().toISOString(),
        });
      }
    }

    setSettlingType(null);
    setPaymentAmount('');
    setPaymentNote('');
  };

  return (
    <div className="space-y-5">
      {/* Top Summary Metrics with Direct Interactive Links to Overdue / Due-Soon Vouchers */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {canAccessSupplierDebts && (
          <div className="bg-white p-5 rounded-xl border border-slate-200 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500 gap-2">
              <span>Tổng Công Nợ Phải Trả Nhà Cung Cấp</span>
              <Building2 className="w-4 h-4 text-amber-600 shrink-0" />
            </div>
            <div className="text-xl font-bold font-mono tabular-nums text-slate-900">
              {formatVND(totalSupplierDebt)}
            </div>
            <div className="text-xs flex flex-wrap items-center gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('supplier');
                  setUrgencyFilter('all');
                  setSelectedLinkedVoucherId(supplierDebts[0]?.id || null);
                }}
                className="px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-800 font-medium transition-colors"
              >
                {supplierDebts.length} phiếu đang nợ
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('supplier');
                  setUrgencyFilter('overdue');
                  setSelectedLinkedVoucherId(overdueSuppliers[0]?.id || null);
                }}
                className="px-2 py-1 rounded-md bg-red-50 border border-red-200 hover:bg-red-100 text-red-700 font-semibold transition-colors flex items-center gap-1"
              >
                <span>{overdueSuppliers.length} quá hạn</span>
                <ExternalLink className="w-3 h-3 shrink-0" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('supplier');
                  setUrgencyFilter('due_soon');
                  setSelectedLinkedVoucherId(dueSoonSuppliers[0]?.id || null);
                }}
                className="px-2 py-1 rounded-md bg-amber-50 border border-amber-200 hover:bg-amber-100 text-amber-800 font-semibold transition-colors flex items-center gap-1"
              >
                <span>{dueSoonSuppliers.length} sắp đến hạn</span>
                <ExternalLink className="w-3 h-3 shrink-0" />
              </button>
            </div>
          </div>
        )}

        {canAccessCustomerDebts && (
          <div className="bg-white p-5 rounded-xl border border-slate-200 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500 gap-2">
              <span>Tổng Công Nợ Phải Thu Khách Hàng</span>
              <Users className="w-4 h-4 text-emerald-700 shrink-0" />
            </div>
            <div className="text-xl font-bold font-mono tabular-nums text-slate-900">
              {formatVND(totalCustomerDebt)}
            </div>
            <div className="text-xs flex flex-wrap items-center gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('customer');
                  setUrgencyFilter('all');
                  setSelectedLinkedVoucherId(customerDebts[0]?.id || null);
                }}
                className="px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-800 font-medium transition-colors"
              >
                {customerDebts.length} hóa đơn chưa tất toán
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('customer');
                  setUrgencyFilter('overdue');
                  setSelectedLinkedVoucherId(overdueCustomers[0]?.id || null);
                }}
                className="px-2 py-1 rounded-md bg-red-50 border border-red-200 hover:bg-red-100 text-red-700 font-semibold transition-colors flex items-center gap-1"
              >
                <span>{overdueCustomers.length} quá hạn</span>
                <ExternalLink className="w-3 h-3 shrink-0" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('customer');
                  setUrgencyFilter('due_soon');
                  setSelectedLinkedVoucherId(dueSoonCustomers[0]?.id || null);
                }}
                className="px-2 py-1 rounded-md bg-amber-50 border border-amber-200 hover:bg-amber-100 text-amber-800 font-semibold transition-colors flex items-center gap-1"
              >
                <span>{dueSoonCustomers.length} sắp đến hạn</span>
                <ExternalLink className="w-3 h-3 shrink-0" />
              </button>
            </div>
          </div>
        )}

        {canAccessCustomerDebts && canAccessSupplierDebts && (
          <div className="bg-white p-5 rounded-xl border border-slate-200 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500 gap-2">
              <span>Cân Đối Công Nợ Ròng (Phải Thu - Phải Trả)</span>
              <Wallet className="w-4 h-4 text-slate-700 shrink-0" />
            </div>
            <div
              className={`text-xl font-bold font-mono tabular-nums ${
                totalCustomerDebt - totalSupplierDebt >= 0 ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              {formatVND(totalCustomerDebt - totalSupplierDebt)}
            </div>
          </div>
        )}
      </div>

      {/* 4-Bucket Debt Aging Breakdown (Phân tích tuổi nợ theo tab đang xem) */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-bold text-slate-800">
            Phân tích Tuổi Nợ ({activeTab === 'supplier' ? 'Phải trả Nhà cung cấp' : 'Phải thu Khách hàng'})
          </div>
          {agingFilter !== 'all' && (
            <button
              type="button"
              onClick={() => setAgingFilter('all')}
              className="text-[11px] font-semibold text-emerald-700 hover:underline"
            >
              Bỏ lọc tuổi nợ
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {(
            [
              {
                id: 'not_due',
                label: 'Chưa đến hạn',
                amount: activeAgingSummary.currentAmount,
                count: activeAgingSummary.currentCount,
                tone: 'border-emerald-200 bg-emerald-50/50 text-emerald-900',
                activeTone: 'border-emerald-600 ring-2 ring-emerald-500/20 bg-emerald-50',
              },
              {
                id: 'overdue_1_30',
                label: 'Quá hạn 1–30 ngày',
                amount: activeAgingSummary.overdue1To30Amount,
                count: activeAgingSummary.overdue1To30Count,
                tone: 'border-amber-200 bg-amber-50/50 text-amber-900',
                activeTone: 'border-amber-600 ring-2 ring-amber-500/20 bg-amber-50',
              },
              {
                id: 'overdue_31_60',
                label: 'Quá hạn 31–60 ngày',
                amount: activeAgingSummary.overdue31To60Amount,
                count: activeAgingSummary.overdue31To60Count,
                tone: 'border-orange-200 bg-orange-50/60 text-orange-900',
                activeTone: 'border-orange-600 ring-2 ring-orange-500/20 bg-orange-50',
              },
              {
                id: 'overdue_over_60',
                label: 'Quá hạn >60 ngày',
                amount: activeAgingSummary.overdue60PlusAmount,
                count: activeAgingSummary.overdue60PlusCount,
                tone: 'border-red-200 bg-red-50/70 text-red-900',
                activeTone: 'border-red-600 ring-2 ring-red-500/20 bg-red-50',
              },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() =>
                setAgingFilter((prev) => (prev === item.id ? 'all' : item.id))
              }
              className={`text-left p-3 rounded-lg border transition-colors ${
                agingFilter === item.id ? item.activeTone : item.tone
              }`}
            >
              <div className="text-[11px] font-medium opacity-85">{item.label}</div>
              <div className="text-sm font-bold font-mono tabular-nums mt-0.5">
                {formatVND(item.amount)}
              </div>
              <div className="text-[11px] opacity-75">{item.count} chứng từ</div>
            </button>
          ))}
        </div>
      </div>

      {/* FIFO Lump-Sum Debt Settlement by Oldest Debt Date (Tự Động Trừ Quyết Toán Vào Tất Cả Các Hóa Đơn Nợ Trước Đó Theo Thứ Tự Ngày Nợ) */}
      {(() => {
        const isCustomerMode = activeTab === 'customer';
        // Build unique list of indebted customers or suppliers
        const indebtedCustomersMap = new Map<
          string,
          { id?: string; name: string; phone: string; totalDebt: number; count: number }
        >();
        for (const s of customerDebts) {
          const key = s.customerId || s.customerPhone || s.customerName;
          const existing = indebtedCustomersMap.get(key) || {
            id: s.customerId,
            name: s.customerName,
            phone: s.customerPhone,
            totalDebt: 0,
            count: 0,
          };
          existing.totalDebt += s.debtAmount;
          existing.count += 1;
          indebtedCustomersMap.set(key, existing);
        }
        const indebtedCustomerList = Array.from(indebtedCustomersMap.entries()).map(
          ([key, val]) => ({ key, ...val })
        );

        const indebtedSuppliersMap = new Map<
          string,
          { name: string; phone: string; totalDebt: number; count: number }
        >();
        for (const imp of supplierDebts) {
          const key = imp.supplierName;
          const existing = indebtedSuppliersMap.get(key) || {
            name: imp.supplierName,
            phone: imp.supplierPhone,
            totalDebt: 0,
            count: 0,
          };
          existing.totalDebt += imp.debtAmount;
          existing.count += 1;
          indebtedSuppliersMap.set(key, existing);
        }
        const indebtedSupplierList = Array.from(indebtedSuppliersMap.entries()).map(
          ([key, val]) => ({ key, ...val })
        );

        const activePartnerList = isCustomerMode ? indebtedCustomerList : indebtedSupplierList;
        const selectedPartner =
          activePartnerList.find((p) => p.key === fifoPartnerKey) ||
          activePartnerList[0] ||
          null;

        const numericLumpSum = Math.max(0, Math.round(Number(fifoLumpSumInput) || 0));

        const fifoPreview = selectedPartner
          ? isCustomerMode
            ? previewCustomerFifoDebtSettlement(
                sales,
                {
                  customerId: (selectedPartner as { id?: string }).id,
                  customerPhone: selectedPartner.phone,
                  customerName: selectedPartner.name,
                },
                numericLumpSum
              )
            : previewSupplierFifoDebtSettlement(
                imports,
                {
                  supplierName: selectedPartner.name,
                  supplierPhone: selectedPartner.phone,
                },
                numericLumpSum
              )
          : null;

        const availableGroups = isCustomerMode ? receiptGroups : paymentGroups;

        return (
          <div className="bg-white rounded-xl border-2 border-emerald-700/80 shadow-xs p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {canAccessCustomerDebts && (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('customer');
                      setFifoPartnerKey('');
                      setFifoLumpSumInput('');
                      setFifoGroupName(receiptGroups[0] || 'Thu nợ bán hàng khách hàng');
                      setFifoFeedback(null);
                    }}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                      isCustomerMode
                        ? 'bg-emerald-800 text-white border-emerald-800'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    Thu tổng nợ Khách hàng ({indebtedCustomerList.length} KH)
                  </button>
                )}
                {canAccessSupplierDebts && (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('supplier');
                      setFifoPartnerKey('');
                      setFifoLumpSumInput('');
                      setFifoGroupName(paymentGroups[0] || 'Chi trả nợ Nhà cung cấp');
                      setFifoFeedback(null);
                    }}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                      !isCustomerMode
                        ? 'bg-amber-800 text-white border-amber-800'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    Trả tổng nợ Nhà cung cấp ({indebtedSupplierList.length} NCC)
                  </button>
                )}
              </div>
            </div>

            {fifoFeedback && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-900 flex items-center justify-between">
                <span>{fifoFeedback}</span>
                <button
                  type="button"
                  onClick={() => setFifoFeedback(null)}
                  className="text-emerald-700 hover:text-emerald-950 font-bold"
                >
                  ✕
                </button>
              </div>
            )}

            {activePartnerList.length === 0 ? (
              <div className="p-4 rounded-lg bg-slate-50 text-center text-xs text-slate-500">
                Hiện không có {isCustomerMode ? 'khách hàng' : 'nhà cung cấp'} nào còn dư nợ cần quyết toán.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                {/* Left Input Controls */}
                <div className="lg:col-span-5 space-y-3 bg-slate-50/80 p-3.5 rounded-xl border border-slate-200/80">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      1. Chọn {isCustomerMode ? 'Khách hàng đang có công nợ' : 'Nhà cung cấp đang có công nợ'}
                    </label>
                    <select
                      value={selectedPartner?.key || ''}
                      onChange={(e) => {
                        const nextKey = e.target.value;
                        setFifoPartnerKey(nextKey);
                        const found = activePartnerList.find((p) => p.key === nextKey);
                        if (found) {
                          setFifoLumpSumInput(String(found.totalDebt));
                        }
                      }}
                      className="w-full px-3 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    >
                      {activePartnerList.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.name} ({p.phone || 'Chưa SĐT'}) — Tổng nợ ({p.count} đơn):{' '}
                          {formatVND(p.totalDebt)}
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedPartner && fifoPreview && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setFifoLumpSumInput(String(fifoPreview.totalPreviousDebt))}
                        className="px-2.5 py-1 text-[11px] font-semibold bg-emerald-800 text-white rounded-md hover:bg-emerald-900"
                      >
                        Quyết toán 100% tổng nợ ({formatVND(fifoPreview.totalPreviousDebt)})
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setFifoLumpSumInput(
                            String(Math.round(fifoPreview.totalPreviousDebt / 2))
                          )
                        }
                        className="px-2.5 py-1 text-[11px] font-semibold bg-white text-slate-800 border border-slate-300 rounded-md hover:bg-slate-100"
                      >
                        Trừ 50% tổng nợ ({formatVND(Math.round(fifoPreview.totalPreviousDebt / 2))})
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        2. Nhập số tiền tổng (VNĐ) *
                      </label>
                      <input
                        type="number"
                        min={1000}
                        step={1000}
                        value={fifoLumpSumInput}
                        onChange={(e) => setFifoLumpSumInput(e.target.value)}
                        placeholder={
                          fifoPreview
                            ? `Tối đa ${fifoPreview.totalPreviousDebt.toLocaleString('vi-VN')} đ`
                            : 'Nhập số tiền tổng...'
                        }
                        className="w-full px-3 py-2 text-sm font-mono font-bold bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        {isCustomerMode ? 'Nhóm phiếu thu' : 'Nhóm phiếu chi'}
                      </label>
                      <select
                        value={fifoGroupName}
                        onChange={(e) => setFifoGroupName(e.target.value)}
                        className="w-full px-2.5 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                      >
                        {availableGroups.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Hình thức thanh toán
                      </label>
                      <select
                        value={fifoPaymentMethod}
                        onChange={(e) => setFifoPaymentMethod(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="Chuyển khoản ngân hàng">Chuyển khoản ngân hàng</option>
                        <option value="Tiền mặt">Tiền mặt</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Ghi chú quyết toán
                      </label>
                      <input
                        type="text"
                        value={fifoNote}
                        onChange={(e) => setFifoNote(e.target.value)}
                        placeholder="Ghi chú phiếu thu/chi..."
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedPartner || !fifoPreview) return;
                      const amountToSettle =
                        numericLumpSum > 0
                          ? Math.min(numericLumpSum, fifoPreview.totalPreviousDebt)
                          : fifoPreview.totalPreviousDebt;
                      if (amountToSettle <= 0) return;

                      if (isCustomerMode && onSettleCustomerTotalDebtFifo) {
                        onSettleCustomerTotalDebtFifo({
                          customerId: (selectedPartner as { id?: string }).id,
                          customerName: selectedPartner.name,
                          customerPhone: selectedPartner.phone,
                          totalAmount: amountToSettle,
                          groupName:
                            fifoGroupName || receiptGroups[0] || 'Thu nợ bán hàng khách hàng',
                          paymentMethod: fifoPaymentMethod,
                          note:
                            fifoNote.trim() ||
                            `Thu quyết toán tổng công nợ KH theo thứ tự ngày nợ (${selectedPartner.name})`,
                        });
                        setFifoFeedback(
                          `Đã thu tổng số tiền ${formatVND(amountToSettle)} của "${selectedPartner.name}", tự động trừ quyết toán các hóa đơn nợ cũ theo thứ tự ngày nợ và lưu vào Nhật ký Phiếu Thu Tiền!`
                        );
                        setFifoLumpSumInput('');
                        setFifoNote('');
                      } else if (!isCustomerMode && onSettleSupplierTotalDebtFifo) {
                        onSettleSupplierTotalDebtFifo({
                          supplierName: selectedPartner.name,
                          supplierPhone: selectedPartner.phone,
                          totalAmount: amountToSettle,
                          groupName:
                            fifoGroupName || paymentGroups[0] || 'Chi trả nợ Nhà cung cấp',
                          paymentMethod: fifoPaymentMethod,
                          note:
                            fifoNote.trim() ||
                            `Chi quyết toán tổng công nợ NCC theo thứ tự ngày nợ (${selectedPartner.name})`,
                        });
                        setFifoFeedback(
                          `Đã chi tổng số tiền ${formatVND(amountToSettle)} cho "${selectedPartner.name}", tự động trừ quyết toán các phiếu nhập nợ cũ theo thứ tự ngày nợ và lưu vào Nhật ký Phiếu Chi Tiền!`
                        );
                        setFifoLumpSumInput('');
                        setFifoNote('');
                      }
                    }}
                    className={`w-full py-2.5 px-4 text-xs sm:text-sm font-bold text-white rounded-lg shadow-xs transition-colors ${
                      isCustomerMode
                        ? 'bg-emerald-800 hover:bg-emerald-900'
                        : 'bg-amber-800 hover:bg-amber-900'
                    }`}
                  >
                    {isCustomerMode
                      ? `Quyết Toán Tự Động Theo Ngày Nợ & Lập Phiếu Thu (${formatVND(
                          numericLumpSum > 0 && fifoPreview
                            ? Math.min(numericLumpSum, fifoPreview.totalPreviousDebt)
                            : fifoPreview?.totalPreviousDebt || 0
                        )})`
                      : `Quyết Toán Tự Động Theo Ngày Nợ & Lập Phiếu Chi (${formatVND(
                          numericLumpSum > 0 && fifoPreview
                            ? Math.min(numericLumpSum, fifoPreview.totalPreviousDebt)
                            : fifoPreview?.totalPreviousDebt || 0
                        )})`}
                  </button>
                </div>

                {/* Right Live FIFO Allocation Preview Table */}
                <div className="lg:col-span-7 bg-amber-50/50 rounded-xl border border-amber-200 overflow-hidden">
                  <div className="px-4 py-3 bg-amber-100/70 border-b border-amber-200 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-bold text-amber-950">
                        Bảng Thứ Tự Các Hóa Đơn Nợ Trước Đó Của "{selectedPartner?.name}" (Sắp Xếp Từ Ngày Nợ Cũ Nhất)
                      </p>
                      <p className="text-[11px] text-amber-800">
                        {numericLumpSum > 0
                          ? `Đang nhập số tiền tổng: ${formatVND(numericLumpSum)} → Hệ thống tự động trừ lần lượt từ đơn số #1 trở đi`
                          : 'Nếu bấm nút quyết toán ngay, hệ thống mặc định trừ tất toán 100% hoặc nhập số tiền tổng bất kỳ để xem mức trừ từng đơn'}
                      </p>
                    </div>
                    {fifoPreview && (
                      <div className="text-right font-mono text-xs">
                        <span className="text-slate-600">Tổng nợ hiện tại: </span>
                        <strong className="text-red-700">
                          {formatVND(fifoPreview.totalPreviousDebt)}
                        </strong>
                      </div>
                    )}
                  </div>

                  {fifoPreview && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-white border-b border-amber-200 text-[11px] font-semibold text-slate-600">
                            <th className="py-2 px-3">Thứ tự ưu tiên</th>
                            <th className="py-2 px-3">Ngày nợ</th>
                            <th className="py-2 px-3">Mã chứng từ</th>
                            <th className="py-2 px-3">Vật tư</th>
                            <th className="py-2 px-3 text-right">Nợ hiện tại</th>
                            <th className="py-2 px-3 text-right">Tự động trừ</th>
                            <th className="py-2 px-3 text-right">Còn nợ sau trừ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-amber-100 bg-white text-xs">
                          {(() => {
                            const effectivePreview =
                              numericLumpSum > 0
                                ? fifoPreview
                                : isCustomerMode && selectedPartner
                                ? previewCustomerFifoDebtSettlement(
                                    sales,
                                    {
                                      customerId: (selectedPartner as { id?: string }).id,
                                      customerPhone: selectedPartner.phone,
                                      customerName: selectedPartner.name,
                                    },
                                    fifoPreview.totalPreviousDebt
                                  )
                                : selectedPartner
                                ? previewSupplierFifoDebtSettlement(
                                    imports,
                                    {
                                      supplierName: selectedPartner.name,
                                      supplierPhone: selectedPartner.phone,
                                    },
                                    fifoPreview.totalPreviousDebt
                                  )
                                : fifoPreview;

                            return effectivePreview.allocations.map((alloc, idx) => (
                              <tr
                                key={alloc.recordId}
                                className={
                                  alloc.allocatedAmount > 0 ? 'bg-emerald-50/40' : ''
                                }
                              >
                                <td className="py-2 px-3 font-mono font-bold text-amber-900">
                                  #{idx + 1} (Cũ nhất)
                                </td>
                                <td className="py-2 px-3 font-mono text-slate-700">
                                  {alloc.date}
                                </td>
                                <td className="py-2 px-3 font-mono font-bold text-slate-900">
                                  {alloc.code}
                                </td>
                                <td className="py-2 px-3 text-slate-700 max-w-[160px] truncate">
                                  {alloc.productName}
                                </td>
                                <td className="py-2 px-3 text-right font-mono text-red-700 font-semibold">
                                  {formatVND(alloc.previousDebt)}
                                </td>
                                <td className="py-2 px-3 text-right font-mono font-bold text-emerald-700">
                                  -{formatVND(alloc.allocatedAmount)}
                                </td>
                                <td className="py-2 px-3 text-right font-mono">
                                  {alloc.remainingDebt === 0 && alloc.allocatedAmount > 0 ? (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                                      Hết nợ (0 đ)
                                    </span>
                                  ) : (
                                    <span className="text-slate-800 font-semibold">
                                      {formatVND(alloc.remainingDebt)}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ));
                          })()}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Direct Linked Voucher Inspector Card (appears when user clicks a reminder badge, notification, or voucher code) */}
      {(linkedSupplierRecord || linkedCustomerRecord) && (
        <div className="bg-emerald-50/90 border-2 border-emerald-600 rounded-xl p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-900">
              <ExternalLink className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>
                CHỨNG TỪ ĐƯỢC LIÊN KẾT TRỰC TIẾP:{' '}
                <span className="font-mono underline">
                  {linkedSupplierRecord
                    ? linkedSupplierRecord.receiptCode
                    : linkedCustomerRecord?.invoiceCode}
                </span>
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedLinkedVoucherId(null);
                setUrgencyFilter('all');
                if (onClearFocusedRecord) onClearFocusedRecord();
              }}
              className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-md flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" />
              <span>Đóng khung kiểm soát nhanh</span>
            </button>
          </div>

          {linkedSupplierRecord && (() => {
            const supDiag = diagnoseImportVoucher({
              imp: linkedSupplierRecord,
              products,
              sales,
              imports,
              paymentVouchers,
              stockAdjustments,
            });
            return (
            <div className="bg-white rounded-lg border border-emerald-200 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1.5 text-xs">
                <div className="text-sm font-bold text-slate-900 flex flex-wrap items-center gap-2">
                  <span>
                    Phiếu nhập {linkedSupplierRecord.receiptCode} — {linkedSupplierRecord.supplierName}
                  </span>
                  {supDiag.statusLevel !== 'ok' && (
                    <span
                      className={`px-2 py-0.5 text-[11px] font-bold rounded border ${
                        supDiag.statusLevel === 'blocked'
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : 'bg-amber-50 text-amber-800 border-amber-200'
                      }`}
                    >
                      {supDiag.statusLabel}
                    </span>
                  )}
                </div>
                <div className="text-slate-600">
                  Vật tư: <strong>{linkedSupplierRecord.productName}</strong> ({linkedSupplierRecord.quantity}{' '}
                  {linkedSupplierRecord.unit}) · Kho:{' '}
                  <strong className="text-emerald-800">
                    {linkedSupplierRecord.warehouseName || 'Tâm An Mỹ Ngãi'}
                  </strong>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono">
                  <span>Tổng lô: {formatVND(linkedSupplierRecord.totalCost)}</span>
                  <span className="text-emerald-700">
                    Đã trả: {formatVND(linkedSupplierRecord.paidAmount)}
                  </span>
                  <span className="text-red-600 font-bold">
                    Còn nợ NCC: {formatVND(linkedSupplierRecord.debtAmount)}
                  </span>
                  <span>Hạn trả: {linkedSupplierRecord.dueDate}</span>
                </div>
                {onNavigateCrossLink && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <CrossLinkChip
                      tone="emerald"
                      label={`Mở phiếu nhập ${linkedSupplierRecord.receiptCode}`}
                      onClick={() =>
                        onNavigateCrossLink({
                          tab: 'imports',
                          recordId: linkedSupplierRecord.id,
                          voucherCode: linkedSupplierRecord.receiptCode,
                          label: `Phiếu nhập ${linkedSupplierRecord.receiptCode}`,
                        })
                      }
                    />
                    {supDiag.linkedProduct && (
                      <CrossLinkChip
                        tone="indigo"
                        label={`Thẻ kho ${supDiag.linkedProduct.code} (Tồn ${supDiag.linkedProduct.stock})`}
                        onClick={() =>
                          onNavigateCrossLink({
                            tab: 'inventory',
                            recordId: supDiag.linkedProduct!.id,
                            label: `Thẻ kho ${supDiag.linkedProduct!.name}`,
                          })
                        }
                      />
                    )}
                    {findAllVouchersForImport(linkedSupplierRecord, paymentVouchers).map((pv) => (
                      <CrossLinkChip
                        key={pv.id}
                        tone={isDirectImportPaymentVoucher(pv) ? 'emerald' : 'rose'}
                        label={`Phiếu chi ${pv.voucherCode}${isDirectImportPaymentVoucher(pv) ? ' (Tại PN)' : ''}`}
                        onClick={() =>
                          onNavigateCrossLink({
                            tab: 'payment_vouchers',
                            recordId: pv.id,
                            voucherCode: pv.voucherCode,
                            label: `Phiếu chi ${pv.voucherCode}`,
                          })
                        }
                      />
                    ))}
                    {supDiag.relatedSales.slice(0, 3).map((s) => (
                      <CrossLinkChip
                        key={s.id}
                        tone="sky"
                        label={`HĐ bán ${s.invoiceCode}`}
                        onClick={() =>
                          onNavigateCrossLink({
                            tab: 'sales',
                            recordId: s.id,
                            voucherCode: s.invoiceCode,
                            label: `Hóa đơn ${s.invoiceCode}`,
                          })
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    handleOpenSettle(
                      'supplier',
                      linkedSupplierRecord.id,
                      linkedSupplierRecord.receiptCode,
                      linkedSupplierRecord.supplierName,
                      linkedSupplierRecord.supplierPhone,
                      linkedSupplierRecord.debtAmount
                    )
                  }
                  className="px-3 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                >
                  Thanh toán nợ NCC ngay
                </button>
                <button
                  type="button"
                  onClick={() =>
                    exportSupplierPaymentPDF({
                      voucherCode: `PC-${linkedSupplierRecord.receiptCode}`,
                      supplierName: linkedSupplierRecord.supplierName,
                      supplierPhone: linkedSupplierRecord.supplierPhone,
                      receiptCode: linkedSupplierRecord.receiptCode,
                      previousDebt: linkedSupplierRecord.totalCost,
                      paidAmount: linkedSupplierRecord.paidAmount,
                      remainingDebt: linkedSupplierRecord.debtAmount,
                      paymentMethod: 'Chuyển khoản ngân hàng',
                      note: linkedSupplierRecord.note,
                      staffName: linkedSupplierRecord.staffName,
                      createdAt: linkedSupplierRecord.createdAt,
                    })
                  }
                  className="px-3 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Xuất Phiếu PDF
                </button>
                {canPerformRoleAction(role, 'edit_record') && (
                  <>
                    <button
                      type="button"
                      onClick={() => openManagerEditSupplierDebt(linkedSupplierRecord)}
                      className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>Sửa chứng từ</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCancelingImport(linkedSupplierRecord)}
                      className="px-3 py-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 rounded-lg flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Hủy phiếu</span>
                    </button>
                  </>
                )}
              </div>
            </div>
            );
          })()}

          {linkedCustomerRecord && (() => {
            const custDiag = diagnoseSaleVoucher({
              sale: linkedCustomerRecord,
              products,
              customers,
              imports,
              receiptVouchers,
            });
            return (
            <div className="bg-white rounded-lg border border-emerald-200 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1.5 text-xs">
                <div className="text-sm font-bold text-slate-900 flex flex-wrap items-center gap-2">
                  <span>
                    Hóa đơn {linkedCustomerRecord.invoiceCode} — {linkedCustomerRecord.customerName} (
                    {linkedCustomerRecord.customerPhone})
                  </span>
                  {custDiag.statusLevel !== 'ok' && (
                    <span
                      className={`px-2 py-0.5 text-[11px] font-bold rounded border ${
                        custDiag.statusLevel === 'blocked'
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : 'bg-amber-50 text-amber-800 border-amber-200'
                      }`}
                    >
                      {custDiag.statusLabel}
                    </span>
                  )}
                </div>
                <div className="text-slate-600">
                  Vật tư: <strong>{linkedCustomerRecord.productName}</strong> ({linkedCustomerRecord.quantity}{' '}
                  {linkedCustomerRecord.unit}) · Kho:{' '}
                  <strong className="text-emerald-800">
                    {linkedCustomerRecord.warehouseName || 'Tâm An Mỹ Ngãi'}
                  </strong>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono">
                  <span>Tổng HĐ: {formatVND(linkedCustomerRecord.totalAmount)}</span>
                  <span className="text-emerald-700">
                    Đã thu: {formatVND(linkedCustomerRecord.paidAmount)}
                  </span>
                  <span className="text-red-600 font-bold">
                    Còn phải thu: {formatVND(linkedCustomerRecord.debtAmount)}
                  </span>
                  <span>Hạn thu: {linkedCustomerRecord.dueDate}</span>
                </div>
                {onNavigateCrossLink && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <CrossLinkChip
                      tone="emerald"
                      label={`Mở hóa đơn ${linkedCustomerRecord.invoiceCode}`}
                      onClick={() =>
                        onNavigateCrossLink({
                          tab: 'sales',
                          recordId: linkedCustomerRecord.id,
                          voucherCode: linkedCustomerRecord.invoiceCode,
                          label: `Hóa đơn ${linkedCustomerRecord.invoiceCode}`,
                        })
                      }
                    />
                    {custDiag.linkedCustomer && (
                      <CrossLinkChip
                        tone="sky"
                        label={`Hồ sơ KH ${custDiag.linkedCustomer.code || custDiag.linkedCustomer.name}`}
                        onClick={() =>
                          onNavigateCrossLink({
                            tab: 'customers',
                            recordId: custDiag.linkedCustomer!.id,
                            label: `Khách hàng ${custDiag.linkedCustomer!.name}`,
                          })
                        }
                      />
                    )}
                    {custDiag.linkedProduct && (
                      <CrossLinkChip
                        tone="indigo"
                        label={`Thẻ kho ${custDiag.linkedProduct.code}`}
                        onClick={() =>
                          onNavigateCrossLink({
                            tab: 'inventory',
                            recordId: custDiag.linkedProduct!.id,
                            label: `Thẻ kho ${custDiag.linkedProduct!.name}`,
                          })
                        }
                      />
                    )}
                    {findAllVouchersForSale(linkedCustomerRecord, receiptVouchers).map((rv) => (
                      <CrossLinkChip
                        key={rv.id}
                        tone={isDirectSaleReceiptVoucher(rv) ? 'emerald' : 'rose'}
                        label={`Phiếu thu ${rv.voucherCode}${isDirectSaleReceiptVoucher(rv) ? ' (Tại đơn)' : ''}`}
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
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    handleOpenSettle(
                      'customer',
                      linkedCustomerRecord.id,
                      linkedCustomerRecord.invoiceCode,
                      linkedCustomerRecord.customerName,
                      linkedCustomerRecord.customerPhone,
                      linkedCustomerRecord.debtAmount
                    )
                  }
                  className="px-3 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                >
                  Thu nợ khách hàng ngay
                </button>
                <button
                  type="button"
                  onClick={() =>
                    exportCustomerReceiptPDF({
                      voucherCode: `PT-${linkedCustomerRecord.invoiceCode}`,
                      customerName: linkedCustomerRecord.customerName,
                      customerPhone: linkedCustomerRecord.customerPhone,
                      invoiceCode: linkedCustomerRecord.invoiceCode,
                      previousDebt: linkedCustomerRecord.totalAmount,
                      collectedAmount: linkedCustomerRecord.paidAmount,
                      remainingDebt: linkedCustomerRecord.debtAmount,
                      paymentMethod: 'Tiền mặt / Chuyển khoản',
                      note: linkedCustomerRecord.note,
                      staffName: linkedCustomerRecord.staffName,
                      createdAt: linkedCustomerRecord.createdAt,
                    })
                  }
                  className="px-3 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Xuất Phiếu Thu PDF
                </button>
                {canPerformRoleAction(role, 'edit_record') && (
                  <>
                    <button
                      type="button"
                      onClick={() => openManagerEditCustomerDebt(linkedCustomerRecord)}
                      className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>Sửa hóa đơn</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCancelingSale(linkedCustomerRecord)}
                      className="px-3 py-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 rounded-lg flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Hủy HĐ</span>
                    </button>
                  </>
                )}
              </div>
            </div>
            );
          })()}
        </div>
      )}

      {/* Controls & Switcher — Responsive across all mobile phone widths without overflowing */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div
          className="grid grid-cols-1 sm:grid-cols-2 w-full lg:w-auto gap-1 p-1 bg-slate-100 rounded-lg"
          role="tablist"
        >
          {canAccessSupplierDebts && (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'supplier'}
              onClick={() => setActiveTab('supplier')}
              className={`px-3 py-2 text-xs font-semibold rounded-md transition-colors text-center break-words ${
                activeTab === 'supplier'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Công nợ Nhà cung cấp ({supplierDebts.length})
            </button>
          )}
          {canAccessCustomerDebts && (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'customer'}
              onClick={() => setActiveTab('customer')}
              className={`px-3 py-2 text-xs font-semibold rounded-md transition-colors text-center break-words ${
                activeTab === 'customer'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Công nợ Khách hàng ({customerDebts.length})
            </button>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2.5 w-full lg:w-auto">
          <div className="relative flex-1 sm:flex-initial">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Gõ tên đối tác, mã phiếu để tìm nhanh..."
              aria-label="Tìm kiếm khoản công nợ"
              className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 w-full sm:w-60"
            />
          </div>

          <div className="grid grid-cols-3 sm:flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {[
              { id: 'all', label: 'Tất cả' },
              { id: 'overdue', label: 'Đã quá hạn' },
              { id: 'due_soon', label: 'Sắp đến hạn' },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setUrgencyFilter(f.id as 'all' | 'overdue' | 'due_soon')}
                className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors text-center break-words ${
                  urgencyFilter === f.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Phase 4C: Batch Zalo Debt Reminder Queue with Pre-Built Message & VietQR */}
      {canAccessCustomerDebts && zaloReminderQueue.length > 0 && (
        <div className="bg-white rounded-xl border border-sky-200 overflow-hidden shadow-2xs">
          <div className="px-4 sm:px-5 py-3.5 bg-sky-50/70 border-b border-sky-200 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <MessageCircle className="w-4 h-4 text-sky-700 shrink-0" />
              <h3 className="text-xs sm:text-sm font-bold text-slate-900">
                Danh Sách Nhắc Nợ Đến Hạn Qua Zalo (Tạo Sẵn Tin &amp; Mã VietQR)
              </h3>
              <span className="px-2 py-0.5 text-[11px] font-bold rounded-md bg-sky-100 text-sky-900 border border-sky-200">
                {zaloReminderQueue.length} khách đang nợ
              </span>
              {urgentZaloCount > 0 && (
                <span className="px-2 py-0.5 text-[11px] font-bold rounded-md bg-rose-100 text-rose-800 border border-rose-200">
                  {urgentZaloCount} cần nhắc ngay
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {displayedZaloQueue.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const combined = displayedZaloQueue
                      .map((it, idx) => `--- [${idx + 1}] ${it.customerName} (${it.customerPhone || 'Chưa có SĐT'}) ---\n${it.message}`)
                      .join('\n\n');
                    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                      void navigator.clipboard.writeText(combined).catch(() => undefined);
                    }
                    const msg = `Đã sao chép trọn bộ ${displayedZaloQueue.length} tin nhắn nhắc nợ Zalo kèm VietQR!`;
                    if (onShowToast) onShowToast(msg);
                    else setFifoFeedback(msg);
                  }}
                  className="px-2.5 py-1 text-xs font-semibold text-sky-900 bg-white border border-sky-300 hover:bg-sky-100 rounded-lg inline-flex items-center gap-1"
                >
                  <Copy className="w-3.5 h-3.5 shrink-0" />
                  <span>Sao chép tất cả ({displayedZaloQueue.length})</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsZaloQueueExpanded((v) => !v)}
                className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg inline-flex items-center gap-1"
              >
                {isZaloQueueExpanded ? (
                  <>
                    <ChevronUp className="w-3.5 h-3.5" />
                    <span>Thu gọn</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3.5 h-3.5" />
                    <span>Mở danh sách ({zaloReminderQueue.length})</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {isZaloQueueExpanded && (
            <div className="p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  {(
                    [
                      {
                        id: 'urgent',
                        label:
                          urgentZaloCount > 0
                            ? `Quá hạn & Sắp đến hạn (${urgentZaloCount})`
                            : `Ưu tiên nhắc (${zaloReminderQueue.length})`,
                      },
                      { id: 'overdue', label: `Chỉ đã quá hạn (${overdueZaloCount})` },
                      { id: 'all', label: `Tất cả KH đang nợ (${zaloReminderQueue.length})` },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setZaloQueueFilter(f.id)}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                        zaloQueueFilter === f.id
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-slate-500">
                  Bấm <strong>Gửi Zalo</strong> để tự sao chép bảng đối soát + thông tin VietQR và mở thẳng khung chat Zalo của khách.
                </span>
              </div>

              {displayedZaloQueue.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-500">
                  Không có khách hàng nào trong nhóm lọc này.
                </div>
              ) : (
                <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
                  {displayedZaloQueue.map((item) => {
                    const isReminded = remindedTodayKeys.has(item.customerKey);
                    const isMsgOpen = expandedZaloMsgKey === item.customerKey;
                    return (
                      <div
                        key={item.customerKey}
                        className={`p-3.5 transition-colors ${
                          isReminded ? 'bg-emerald-50/30' : 'bg-white hover:bg-slate-50/80'
                        }`}
                      >
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-xs sm:text-sm font-bold text-slate-900">
                                {item.customerName}
                              </span>
                              {item.customerPhone ? (
                                <span className="px-2 py-0.5 text-[11px] font-mono font-semibold bg-slate-100 text-slate-700 rounded">
                                  {item.customerPhone}
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-800 rounded">
                                  Chưa có SĐT
                                </span>
                              )}
                              {item.urgency === 'overdue' ? (
                                <span className="px-2 py-0.5 text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200 rounded">
                                  Quá hạn {Math.abs(item.daysDelta)} ngày ({item.overdueInvoiceCount} HĐ)
                                </span>
                              ) : item.urgency === 'due_soon' ? (
                                <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-200 rounded">
                                  Còn {item.daysDelta} ngày đến hạn
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-600 rounded">
                                  Hạn gần nhất: {item.nearestDueDate}
                                </span>
                              )}
                              {isReminded && (
                                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200 rounded">
                                  <CheckCircle2 className="w-3 h-3 shrink-0" />
                                  <span>Đã nhắc hôm nay ✓</span>
                                </span>
                              )}
                            </div>

                            <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span>
                                Gồm <strong>{item.invoiceCount}</strong> hóa đơn chưa tất toán
                              </span>
                              <span>·</span>
                              <span>
                                Tổng nợ phải thu:{' '}
                                <strong className="font-mono text-red-600">
                                  {formatVND(item.totalDebt)}
                                </strong>
                              </span>
                              {item.vietQrUrl && (
                                <>
                                  <span>·</span>
                                  <span className="text-teal-700 font-semibold">
                                    Đã đính kèm VietQR
                                  </span>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedZaloMsgKey(isMsgOpen ? null : item.customerKey)
                              }
                              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                            >
                              {isMsgOpen ? 'Ẩn tin mẫu' : 'Xem tin mẫu'}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setVietQrTarget({
                                  title: `VietQR thu tổng nợ ${item.customerName}`,
                                  subtitle: `${item.invoiceCount} hóa đơn · Tổng dư nợ ${formatVND(item.totalDebt)}`,
                                  amount: item.totalDebt,
                                  addInfo: item.transferAddInfo,
                                  customerPhone: item.customerPhone,
                                  zaloMessage: item.message,
                                })
                              }
                              className="px-2.5 py-1.5 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg inline-flex items-center gap-1"
                            >
                              <QrCode className="w-3.5 h-3.5 shrink-0" />
                              <span>Hiện QR</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDispatchZaloQueueItem(item, false)}
                              className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg inline-flex items-center gap-1"
                            >
                              <Copy className="w-3.5 h-3.5 shrink-0" />
                              <span>Sao chép</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDispatchZaloQueueItem(item, true)}
                              className="px-3 py-1.5 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-lg inline-flex items-center gap-1 shadow-2xs"
                            >
                              <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                              <span>Gửi Zalo</span>
                            </button>
                          </div>
                        </div>

                        {isMsgOpen && (
                          <div className="mt-2.5 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-2">
                            <pre className="whitespace-pre-wrap font-sans text-slate-800 leading-relaxed">
                              {item.message}
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Debt Table */}
      {activeTab === 'supplier' ? (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Bảng theo dõi & Nhắc hạn Công nợ Nhà cung cấp
              </h3>
            </div>
            <span className="text-xs text-slate-500 whitespace-nowrap">
              Đang hiển thị {filteredSupplierDebts.length} phiếu công nợ
            </span>
          </div>

          {/* Mobile Card View (< md): Full-width balanced layout, zero column squishing */}
          <div className="md:hidden divide-y divide-slate-200">
            {filteredSupplierDebts.length === 0 ? (
              <div className="py-12 px-4 text-center text-xs text-slate-500">
                Không có khoản công nợ nhà cung cấp nào trong mục này.
                {imports.length === 0 && onNavigateCrossLink && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => onNavigateCrossLink({ tab: 'imports', label: 'Lập phiếu nhập' })}
                      className="px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                    >
                      Lập phiếu nhập đầu tiên
                    </button>
                  </div>
                )}
              </div>
            ) : (
              filteredSupplierDebts.map((imp) => {
                const { urgency, daysRemaining } = evaluateDebtUrgency(
                  imp.dueDate,
                  imp.debtAmount,
                  todayStr,
                  leadDays
                );
                const isHighlighted = selectedLinkedVoucherId === imp.id;
                return (
                  <div
                    key={imp.id}
                    className={`p-4 space-y-3 transition-colors ${
                      isHighlighted
                        ? 'bg-emerald-50/80 ring-1 ring-inset ring-emerald-500'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <button
                          type="button"
                          onClick={() => setSelectedLinkedVoucherId(imp.id)}
                          className="font-mono font-bold text-xs text-emerald-800 hover:underline flex items-center gap-1"
                        >
                          <span>{imp.receiptCode}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </button>
                        <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                          Ngày lập: {imp.createdAt.slice(0, 10)}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setSelectedLinkedVoucherId(imp.id)}
                        className="text-xs flex items-center gap-1 hover:underline text-right shrink-0"
                      >
                        {urgency === 'overdue' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-50 text-red-700 border border-red-200 font-semibold text-[11px]">
                            <AlertTriangle className="w-3 h-3 text-red-600 shrink-0" />
                            <span>Quá hạn {Math.abs(daysRemaining)} ngày ({imp.dueDate})</span>
                          </span>
                        ) : urgency === 'due_soon' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 font-medium text-[11px]">
                            <CalendarClock className="w-3 h-3 text-amber-600 shrink-0" />
                            <span>Còn {daysRemaining} ngày ({imp.dueDate})</span>
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-mono text-[11px]">
                            Hạn {imp.dueDate} ({daysRemaining} ngày)
                          </span>
                        )}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-0.5">
                      <div className="p-2.5 bg-slate-50/70 rounded-lg border border-slate-200/70">
                        <div className="text-[11px] text-slate-500">Nhà cung cấp</div>
                        <div className="text-xs font-bold text-slate-900 mt-0.5">
                          {imp.supplierName}
                        </div>
                        <div className="text-xs font-mono text-slate-500">{imp.supplierPhone}</div>
                      </div>
                      <div className="p-2.5 bg-slate-50/70 rounded-lg border border-slate-200/70">
                        <div className="text-[11px] text-slate-500">Vật tư nhập</div>
                        <div className="text-xs font-semibold text-slate-900 mt-0.5">
                          {imp.productName}
                        </div>
                        <div className="text-xs text-slate-600 font-mono">
                          SL: {imp.quantity} {imp.unit}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-xs">
                      <div>
                        <div className="text-[11px] text-slate-500">Tổng tiền nhập</div>
                        <div className="font-mono tabular-nums font-semibold text-slate-800 mt-0.5">
                          {formatVND(imp.totalCost)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500">Đã trả NCC</div>
                        <div className="font-mono tabular-nums font-semibold text-emerald-700 mt-0.5">
                          {formatVND(imp.paidAmount)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] text-slate-500">Còn nợ NCC</div>
                        <div className="font-mono tabular-nums font-bold text-red-600 mt-0.5">
                          {formatVND(imp.debtAmount)}
                        </div>
                      </div>
                    </div>

                    {onNavigateCrossLink && (() => {
                      const allPayVouchers = findAllVouchersForImport(imp, paymentVouchers);
                      if (allPayVouchers.length === 0) return null;
                      return (
                        <div className="flex flex-wrap items-center gap-1">
                          {allPayVouchers.map((pv) => (
                            <CrossLinkChip
                              key={pv.id}
                              tone={isDirectImportPaymentVoucher(pv) ? 'emerald' : 'rose'}
                              label={`${pv.voucherCode}${isDirectImportPaymentVoucher(pv) ? ' (Tại PN)' : ''}`}
                              onClick={() =>
                                onNavigateCrossLink({
                                  tab: 'payment_vouchers',
                                  recordId: pv.id,
                                  voucherCode: pv.voucherCode,
                                  label: `Phiếu chi ${pv.voucherCode}`,
                                })
                              }
                            />
                          ))}
                        </div>
                      );
                    })()}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            handleOpenSettle(
                              'supplier',
                              imp.id,
                              imp.receiptCode,
                              imp.supplierName,
                              imp.supplierPhone,
                              imp.debtAmount
                            )
                          }
                          aria-label={`Thanh toán nợ nhà cung cấp ${imp.receiptCode}`}
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap"
                        >
                          Trả nợ NCC
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const latestPv = findAllVouchersForImport(imp, paymentVouchers)[0];
                            exportSupplierPaymentPDF({
                              voucherCode: latestPv?.voucherCode || `PC-${imp.receiptCode}`,
                              supplierName: imp.supplierName,
                              supplierPhone: imp.supplierPhone,
                              receiptCode: imp.receiptCode,
                              previousDebt: imp.totalCost,
                              paidAmount: imp.paidAmount,
                              remainingDebt: imp.debtAmount,
                              paymentMethod:
                                latestPv?.paymentMethod || imp.paymentMethod || 'Tiền mặt',
                              note: imp.note,
                              staffName: imp.staffName,
                              createdAt: imp.createdAt,
                            });
                          }}
                          className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap"
                        >
                          Phiếu PDF
                        </button>
                      </div>

                      {canPerformRoleAction(role, 'edit_record') ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openManagerEditSupplierDebt(imp)}
                            aria-label={`Sửa công nợ phiếu ${imp.receiptCode}`}
                            className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1 whitespace-nowrap"
                          >
                            <Pencil className="w-3 h-3" />
                            <span>Sửa</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setCancelingImport(imp)}
                            aria-label={`Hủy phiếu nợ ${imp.receiptCode}`}
                            className="px-2.5 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg border border-rose-200 flex items-center gap-1 whitespace-nowrap"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Hủy phiếu</span>
                          </button>
                        </div>
                      ) : (
                        <span
                          title="Chỉ Quản lý mới có quyền sửa/xóa"
                          className="px-2 py-1 text-[11px] text-slate-400 flex items-center gap-1 whitespace-nowrap"
                        >
                          <Lock className="w-3 h-3" />
                          <span>Khóa sửa/xóa</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop Balanced Table (>= md) */}
          <div className="hidden md:block overflow-x-auto max-h-[72vh]">
            <table className="w-full min-w-[1000px] text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-xs shadow-2xs">
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4 w-[135px] whitespace-nowrap">Mã phiếu & Ngày</th>
                  <th className="py-3 px-4 min-w-[190px]">Nhà cung cấp</th>
                  <th className="py-3 px-4 min-w-[210px]">Vật tư nhập</th>
                  <th className="py-3 px-4 w-[120px] text-right whitespace-nowrap">Tổng tiền nhập</th>
                  <th className="py-3 px-4 w-[115px] text-right whitespace-nowrap">Đã trả NCC</th>
                  <th className="py-3 px-4 w-[120px] text-right whitespace-nowrap">Còn nợ NCC</th>
                  <th className="py-3 px-4 w-[150px] whitespace-nowrap">Hạn trả & Nhắc hẹn</th>
                  <th className="py-3 px-4 w-[210px] text-right whitespace-nowrap">
                    Thao tác / Sửa & Xóa (Quản lý)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredSupplierDebts.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 px-4 text-center text-slate-500">
                      Không có khoản công nợ nhà cung cấp nào trong mục này.
                {imports.length === 0 && onNavigateCrossLink && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => onNavigateCrossLink({ tab: 'imports', label: 'Lập phiếu nhập' })}
                      className="px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                    >
                      Lập phiếu nhập đầu tiên
                    </button>
                  </div>
                )}
                    </td>
                  </tr>
                ) : (
                  filteredSupplierDebts.map((imp) => {
                    const { urgency, daysRemaining } = evaluateDebtUrgency(
                      imp.dueDate,
                      imp.debtAmount,
                      todayStr,
                      leadDays
                    );
                    const isHighlighted = selectedLinkedVoucherId === imp.id;
                    const supDiag = diagnoseImportVoucher({
                      imp,
                      products,
                      sales,
                      imports,
                      paymentVouchers,
                      stockAdjustments,
                    });
                    return (
                      <tr
                        key={imp.id}
                        className={`transition-colors ${
                          isHighlighted
                            ? 'bg-emerald-50/80 ring-1 ring-inset ring-emerald-500'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-3.5 px-4 whitespace-nowrap align-middle">
                          <button
                            type="button"
                            onClick={() => setSelectedLinkedVoucherId(imp.id)}
                            className="font-mono font-bold text-xs text-emerald-800 hover:underline flex items-center gap-1"
                          >
                            <span>{imp.receiptCode}</span>
                            <ExternalLink className="w-3 h-3" />
                          </button>
                          <div className="text-xs text-slate-500 font-mono mt-0.5">
                            {toVietnamDateStr(imp.createdAt)}
                          </div>
                          {supDiag.statusLevel !== 'ok' && (
                            <div className="mt-1">
                              <span
                                className={`inline-block px-1.5 py-0.5 text-[10px] font-bold rounded border ${
                                  supDiag.statusLevel === 'blocked'
                                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                                    : 'bg-amber-50 text-amber-800 border-amber-200'
                                }`}
                              >
                                {supDiag.statusLabel}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 min-w-[190px] align-middle">
                          <div className="font-semibold text-slate-900 leading-snug">{imp.supplierName}</div>
                          <div className="text-xs font-mono text-slate-500 mt-0.5">{imp.supplierPhone}</div>
                        </td>
                        <td className="py-3.5 px-4 min-w-[210px] align-middle">
                          <div className="text-xs font-medium text-slate-800 leading-snug">{imp.productName}</div>
                          <div className="text-xs text-slate-500 font-mono mt-0.5">
                            SL: {imp.quantity} {imp.unit}
                          </div>
                          {onNavigateCrossLink && (
                            <div className="flex flex-wrap items-center gap-1 mt-1.5">
                              <CrossLinkChip
                                tone="emerald"
                                label="Phiếu nhập"
                                onClick={() =>
                                  onNavigateCrossLink({
                                    tab: 'imports',
                                    recordId: imp.id,
                                    voucherCode: imp.receiptCode,
                                    label: `Phiếu nhập ${imp.receiptCode}`,
                                  })
                                }
                              />
                              {supDiag.linkedProduct && (
                                <CrossLinkChip
                                  tone="indigo"
                                  label={`Kho (${supDiag.linkedProduct.stock})`}
                                  onClick={() =>
                                    onNavigateCrossLink({
                                      tab: 'inventory',
                                      recordId: supDiag.linkedProduct!.id,
                                      label: `Thẻ kho ${supDiag.linkedProduct!.name}`,
                                    })
                                  }
                                />
                              )}
                              {findAllVouchersForImport(imp, paymentVouchers).map((pv) => (
                                <CrossLinkChip
                                  key={pv.id}
                                  tone={isDirectImportPaymentVoucher(pv) ? 'emerald' : 'rose'}
                                  label={`${pv.voucherCode}${isDirectImportPaymentVoucher(pv) ? ' (Tại PN)' : ''}`}
                                  onClick={() =>
                                    onNavigateCrossLink({
                                      tab: 'payment_vouchers',
                                      recordId: pv.id,
                                      voucherCode: pv.voucherCode,
                                      label: `Phiếu chi ${pv.voucherCode}`,
                                    })
                                  }
                                />
                              ))}
                              {supDiag.relatedSales.slice(0, 1).map((s) => (
                                <CrossLinkChip
                                  key={s.id}
                                  tone="sky"
                                  label={s.invoiceCode}
                                  onClick={() =>
                                    onNavigateCrossLink({
                                      tab: 'sales',
                                      recordId: s.id,
                                      voucherCode: s.invoiceCode,
                                      label: `Hóa đơn ${s.invoiceCode}`,
                                    })
                                  }
                                />
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap align-middle">
                          {formatVND(imp.totalCost)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums text-xs text-emerald-700 whitespace-nowrap align-middle">
                          {formatVND(imp.paidAmount)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums text-xs font-bold text-red-600 whitespace-nowrap align-middle">
                          {formatVND(imp.debtAmount)}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap align-middle">
                          <div className="font-mono text-xs text-slate-900">{imp.dueDate}</div>
                          <button
                            type="button"
                            onClick={() => setSelectedLinkedVoucherId(imp.id)}
                            className="text-xs mt-0.5 flex items-center gap-1 hover:underline text-left"
                          >
                            {urgency === 'overdue' ? (
                              <>
                                <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                                <span className="text-red-600 font-semibold">
                                  Quá hạn {Math.abs(daysRemaining)} ngày
                                </span>
                              </>
                            ) : urgency === 'due_soon' ? (
                              <>
                                <CalendarClock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                <span className="text-amber-700 font-medium">
                                  Còn {daysRemaining} ngày đến hạn
                                </span>
                              </>
                            ) : (
                              <span className="text-slate-500">Còn {daysRemaining} ngày</span>
                            )}
                          </button>
                        </td>
                        <td className="py-3.5 px-4 text-right whitespace-nowrap align-middle">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                handleOpenSettle(
                                  'supplier',
                                  imp.id,
                                  imp.receiptCode,
                                  imp.supplierName,
                                  imp.supplierPhone,
                                  imp.debtAmount
                                )
                              }
                              aria-label={`Thanh toán nợ nhà cung cấp ${imp.receiptCode}`}
                              className="px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap"
                            >
                              Trả nợ NCC
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                exportSupplierPaymentPDF({
                                  voucherCode: `PC-${imp.receiptCode}`,
                                  supplierName: imp.supplierName,
                                  supplierPhone: imp.supplierPhone,
                                  receiptCode: imp.receiptCode,
                                  previousDebt: imp.totalCost,
                                  paidAmount: imp.paidAmount,
                                  remainingDebt: imp.debtAmount,
                                  paymentMethod: 'Chuyển khoản ngân hàng',
                                  note: imp.note,
                                  staffName: imp.staffName,
                                  createdAt: imp.createdAt,
                                })
                              }
                              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap"
                            >
                              Phiếu PDF
                            </button>
                            {canPerformRoleAction(role, 'edit_record') ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openManagerEditSupplierDebt(imp)}
                                  aria-label={`Sửa công nợ phiếu ${imp.receiptCode}`}
                                  className="px-2 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1 whitespace-nowrap"
                                >
                                  <Pencil className="w-3 h-3" />
                                  <span>Sửa</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setCancelingImport(imp)}
                                  aria-label={`Hủy phiếu nợ ${imp.receiptCode}`}
                                  className="px-2 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg flex items-center gap-1 whitespace-nowrap"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  <span>Hủy phiếu</span>
                                </button>
                              </>
                            ) : (
                              <span
                                title="Chỉ Quản lý mới có quyền sửa/xóa"
                                className="px-2 py-1 text-[11px] text-slate-400 flex items-center gap-1 whitespace-nowrap"
                              >
                                <Lock className="w-3 h-3" />
                                <span>Khóa sửa/xóa</span>
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {filteredSupplierDebts.length > 0 && (
                <tfoot className="border-t-2 border-amber-200 bg-amber-50/70 text-xs font-semibold text-slate-800">
                  <tr>
                    <td colSpan={3} className="py-3 px-4">
                      Tổng cộng theo bộ lọc: <strong>{filteredSupplierDebts.length}</strong> phiếu công nợ NCC
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap text-slate-800">
                      {formatVND(filteredSupplierDebts.reduce((sum, i) => sum + i.totalCost, 0))}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap text-emerald-700">
                      {formatVND(filteredSupplierDebts.reduce((sum, i) => sum + i.paidAmount, 0))}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap font-bold text-red-700">
                      {formatVND(filteredSupplierDebts.reduce((sum, i) => sum + i.debtAmount, 0))}
                    </td>
                    <td colSpan={2} className="py-3 px-4 text-right text-[11px] text-slate-500">
                      Đã đối soát trực tiếp từ sổ Nhập hàng
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Bảng theo dõi Công nợ Khách hàng
              </h3>
            </div>
            <span className="text-xs text-slate-500 whitespace-nowrap">
              Đang hiển thị {filteredCustomerDebts.length} hóa đơn nợ
            </span>
          </div>

          {/* Mobile Card View (< md): Full-width balanced layout, zero column squishing */}
          <div className="md:hidden divide-y divide-slate-200">
            {filteredCustomerDebts.length === 0 ? (
              <div className="py-12 px-4 text-center text-xs text-slate-500">
                Không có khoản công nợ khách hàng nào trong mục này.
                {sales.length === 0 && onNavigateCrossLink && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => onNavigateCrossLink({ tab: 'sales', label: 'Lập đơn bán' })}
                      className="px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                    >
                      Lập đơn bán đầu tiên
                    </button>
                  </div>
                )}
              </div>
            ) : (
              filteredCustomerDebts.map((sale) => {
                const { urgency, daysRemaining } = evaluateDebtUrgency(
                  sale.dueDate,
                  sale.debtAmount,
                  todayStr,
                  leadDays
                );
                const isHighlighted = selectedLinkedVoucherId === sale.id;
                return (
                  <div
                    key={sale.id}
                    className={`p-4 space-y-3 transition-colors ${
                      isHighlighted
                        ? 'bg-emerald-50/80 ring-1 ring-inset ring-emerald-500'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <button
                          type="button"
                          onClick={() => setSelectedLinkedVoucherId(sale.id)}
                          className="font-mono font-bold text-xs text-emerald-800 hover:underline flex items-center gap-1"
                        >
                          <span>{sale.invoiceCode}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </button>
                        <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                          Ngày lập: {sale.createdAt.slice(0, 10)}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setSelectedLinkedVoucherId(sale.id)}
                        className="text-xs flex items-center gap-1 hover:underline text-right shrink-0"
                      >
                        {urgency === 'overdue' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-50 text-red-700 border border-red-200 font-semibold text-[11px]">
                            <AlertTriangle className="w-3 h-3 text-red-600 shrink-0" />
                            <span>Quá hạn {Math.abs(daysRemaining)} ngày ({sale.dueDate})</span>
                          </span>
                        ) : urgency === 'due_soon' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 font-medium text-[11px]">
                            <CalendarClock className="w-3 h-3 text-amber-600 shrink-0" />
                            <span>Còn {daysRemaining} ngày ({sale.dueDate})</span>
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-mono text-[11px]">
                            Hạn {sale.dueDate} ({daysRemaining} ngày)
                          </span>
                        )}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-0.5">
                      <div className="p-2.5 bg-slate-50/70 rounded-lg border border-slate-200/70">
                        <div className="text-[11px] text-slate-500">Khách hàng</div>
                        <div className="text-xs font-bold text-slate-900 mt-0.5">
                          {sale.customerName}
                        </div>
                        <div className="text-xs font-mono text-slate-500">{sale.customerPhone}</div>
                      </div>
                      <div className="p-2.5 bg-slate-50/70 rounded-lg border border-slate-200/70">
                        <div className="text-[11px] text-slate-500">Vật tư mua</div>
                        <div className="text-xs font-semibold text-slate-900 mt-0.5">
                          {sale.productName}
                        </div>
                        <div className="text-xs text-slate-600 font-mono">
                          SL: {sale.quantity} {sale.unit}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-xs">
                      <div>
                        <div className="text-[11px] text-slate-500">Tổng hóa đơn</div>
                        <div className="font-mono tabular-nums font-semibold text-slate-800 mt-0.5">
                          {formatVND(sale.totalAmount)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500">Đã thu</div>
                        <div className="font-mono tabular-nums font-semibold text-emerald-700 mt-0.5">
                          {formatVND(sale.paidAmount)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] text-slate-500">Còn phải thu</div>
                        <div className="font-mono tabular-nums font-bold text-red-600 mt-0.5">
                          {formatVND(sale.debtAmount)}
                        </div>
                      </div>
                    </div>

                    {onNavigateCrossLink && (() => {
                      const allRecVouchers = findAllVouchersForSale(sale, receiptVouchers);
                      if (allRecVouchers.length === 0) return null;
                      return (
                        <div className="flex flex-wrap items-center gap-1">
                          {allRecVouchers.map((rv) => (
                            <CrossLinkChip
                              key={rv.id}
                              tone={isDirectSaleReceiptVoucher(rv) ? 'emerald' : 'rose'}
                              label={`${rv.voucherCode}${isDirectSaleReceiptVoucher(rv) ? ' (Tại đơn)' : ''}`}
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

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            handleOpenSettle(
                              'customer',
                              sale.id,
                              sale.invoiceCode,
                              sale.customerName,
                              sale.customerPhone,
                              sale.debtAmount
                            )
                          }
                          aria-label={`Thu tiền công nợ hóa đơn ${sale.invoiceCode}`}
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap"
                        >
                          Thu nợ khách
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const latestRv = findAllVouchersForSale(sale, receiptVouchers)[0];
                            exportCustomerReceiptPDF({
                              voucherCode: latestRv?.voucherCode || `PT-${sale.invoiceCode}`,
                              customerName: sale.customerName,
                              customerPhone: sale.customerPhone,
                              invoiceCode: sale.invoiceCode,
                              previousDebt: sale.totalAmount,
                              collectedAmount: sale.paidAmount,
                              remainingDebt: sale.debtAmount,
                              paymentMethod:
                                latestRv?.paymentMethod ||
                                sale.paymentMethod ||
                                'Tiền mặt / Chuyển khoản',
                              note: sale.note,
                              staffName: sale.staffName,
                              createdAt: sale.createdAt,
                            });
                          }}
                          className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap"
                        >
                          Phiếu PDF
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSendZaloReminder(sale)}
                          aria-label={`Nhắc nợ Zalo khách ${sale.customerName}`}
                          className="px-2.5 py-1.5 text-xs font-semibold text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg flex items-center gap-1 whitespace-nowrap"
                        >
                          <MessageCircle className="w-3 h-3" />
                          <span>Nhắc nợ Zalo</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenCustomerDebtQr(sale)}
                          aria-label={`Hiện mã VietQR thu nợ ${sale.customerName}`}
                          className="px-2.5 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg flex items-center gap-1 whitespace-nowrap"
                        >
                          <QrCode className="w-3 h-3" />
                          <span>VietQR</span>
                        </button>
                      </div>

                      {canPerformRoleAction(role, 'edit_record') ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openManagerEditCustomerDebt(sale)}
                            aria-label={`Sửa công nợ hóa đơn ${sale.invoiceCode}`}
                            className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1 whitespace-nowrap"
                          >
                            <Pencil className="w-3 h-3" />
                            <span>Sửa</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setCancelingSale(sale)}
                            aria-label={`Hủy hóa đơn nợ ${sale.invoiceCode}`}
                            className="px-2.5 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg border border-rose-200 flex items-center gap-1 whitespace-nowrap"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Hủy HĐ</span>
                          </button>
                        </div>
                      ) : (
                        <span
                          title="Chỉ Quản lý mới có quyền sửa/xóa"
                          className="px-2 py-1 text-[11px] text-slate-400 flex items-center gap-1 whitespace-nowrap"
                        >
                          <Lock className="w-3 h-3" />
                          <span>Khóa sửa/xóa</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop Balanced Table (>= md) */}
          <div className="hidden md:block overflow-x-auto max-h-[72vh]">
            <table className="w-full min-w-[1000px] text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-xs shadow-2xs">
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4 w-[135px] whitespace-nowrap">Mã HĐ & Ngày</th>
                  <th className="py-3 px-4 min-w-[190px]">Khách hàng</th>
                  <th className="py-3 px-4 min-w-[210px]">Vật tư mua</th>
                  <th className="py-3 px-4 w-[120px] text-right whitespace-nowrap">Tổng hóa đơn</th>
                  <th className="py-3 px-4 w-[115px] text-right whitespace-nowrap">Đã thu</th>
                  <th className="py-3 px-4 w-[120px] text-right whitespace-nowrap">Còn phải thu</th>
                  <th className="py-3 px-4 w-[150px] whitespace-nowrap">Hạn thu nợ</th>
                  <th className="py-3 px-4 w-[210px] text-right whitespace-nowrap">
                    Thao tác / Sửa & Xóa (Quản lý)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredCustomerDebts.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 px-4 text-center text-slate-500">
                      Không có khoản công nợ khách hàng nào trong mục này.
                {sales.length === 0 && onNavigateCrossLink && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => onNavigateCrossLink({ tab: 'sales', label: 'Lập đơn bán' })}
                      className="px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                    >
                      Lập đơn bán đầu tiên
                    </button>
                  </div>
                )}
                    </td>
                  </tr>
                ) : (
                  filteredCustomerDebts.map((sale) => {
                    const { urgency, daysRemaining } = evaluateDebtUrgency(
                      sale.dueDate,
                      sale.debtAmount,
                      todayStr,
                      leadDays
                    );
                    const isHighlighted = selectedLinkedVoucherId === sale.id;
                    const custDiag = diagnoseSaleVoucher({
                      sale,
                      products,
                      customers,
                      imports,
                      receiptVouchers,
                    });
                    return (
                      <tr
                        key={sale.id}
                        className={`transition-colors ${
                          isHighlighted
                            ? 'bg-emerald-50/80 ring-1 ring-inset ring-emerald-500'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-3.5 px-4 whitespace-nowrap align-middle">
                          <button
                            type="button"
                            onClick={() => setSelectedLinkedVoucherId(sale.id)}
                            className="font-mono font-bold text-xs text-emerald-800 hover:underline flex items-center gap-1"
                          >
                            <span>{sale.invoiceCode}</span>
                            <ExternalLink className="w-3 h-3" />
                          </button>
                          <div className="text-xs text-slate-500 font-mono mt-0.5">
                            {toVietnamDateStr(sale.createdAt)}
                          </div>
                          {custDiag.statusLevel !== 'ok' && (
                            <div className="mt-1">
                              <span
                                className={`inline-block px-1.5 py-0.5 text-[10px] font-bold rounded border ${
                                  custDiag.statusLevel === 'blocked'
                                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                                    : 'bg-amber-50 text-amber-800 border-amber-200'
                                }`}
                              >
                                {custDiag.statusLabel}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 min-w-[190px] align-middle">
                          <div className="font-semibold text-slate-900 leading-snug">{sale.customerName}</div>
                          <div className="text-xs font-mono text-slate-500 mt-0.5">{sale.customerPhone}</div>
                        </td>
                        <td className="py-3.5 px-4 min-w-[210px] align-middle">
                          <div className="text-xs font-medium text-slate-800 leading-snug">{sale.productName}</div>
                          <div className="text-xs text-slate-500 font-mono mt-0.5">
                            SL: {sale.quantity} {sale.unit}
                          </div>
                          {onNavigateCrossLink && (
                            <div className="flex flex-wrap items-center gap-1 mt-1.5">
                              <CrossLinkChip
                                tone="emerald"
                                label="Hóa đơn"
                                onClick={() =>
                                  onNavigateCrossLink({
                                    tab: 'sales',
                                    recordId: sale.id,
                                    voucherCode: sale.invoiceCode,
                                    label: `Hóa đơn ${sale.invoiceCode}`,
                                  })
                                }
                              />
                              {custDiag.linkedCustomer && (
                                <CrossLinkChip
                                  tone="sky"
                                  label="Hồ sơ KH"
                                  onClick={() =>
                                    onNavigateCrossLink({
                                      tab: 'customers',
                                      recordId: custDiag.linkedCustomer!.id,
                                      label: `Khách hàng ${custDiag.linkedCustomer!.name}`,
                                    })
                                  }
                                />
                              )}
                              {custDiag.linkedProduct && (
                                <CrossLinkChip
                                  tone="indigo"
                                  label={`Kho (${custDiag.linkedProduct.stock})`}
                                  onClick={() =>
                                    onNavigateCrossLink({
                                      tab: 'inventory',
                                      recordId: custDiag.linkedProduct!.id,
                                      label: `Thẻ kho ${custDiag.linkedProduct!.name}`,
                                    })
                                  }
                                />
                              )}
                              {findAllVouchersForSale(sale, receiptVouchers).map((rv) => (
                                <CrossLinkChip
                                  key={rv.id}
                                  tone={isDirectSaleReceiptVoucher(rv) ? 'emerald' : 'rose'}
                                  label={`${rv.voucherCode}${isDirectSaleReceiptVoucher(rv) ? ' (Tại đơn)' : ''}`}
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
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap align-middle">
                          {formatVND(sale.totalAmount)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums text-xs text-emerald-700 whitespace-nowrap align-middle">
                          {formatVND(sale.paidAmount)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums text-xs font-bold text-red-600 whitespace-nowrap align-middle">
                          {formatVND(sale.debtAmount)}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap align-middle">
                          <div className="font-mono text-xs text-slate-900">{sale.dueDate}</div>
                          <button
                            type="button"
                            onClick={() => setSelectedLinkedVoucherId(sale.id)}
                            className="text-xs mt-0.5 flex items-center gap-1 hover:underline text-left"
                          >
                            {urgency === 'overdue' ? (
                              <>
                                <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                                <span className="text-red-600 font-semibold">
                                  Quá hạn {Math.abs(daysRemaining)} ngày
                                </span>
                              </>
                            ) : urgency === 'due_soon' ? (
                              <>
                                <CalendarClock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                <span className="text-amber-700 font-medium">
                                  Còn {daysRemaining} ngày đến hạn
                                </span>
                              </>
                            ) : (
                              <span className="text-slate-500">Còn {daysRemaining} ngày</span>
                            )}
                          </button>
                        </td>
                        <td className="py-3.5 px-4 text-right whitespace-nowrap align-middle">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                handleOpenSettle(
                                  'customer',
                                  sale.id,
                                  sale.invoiceCode,
                                  sale.customerName,
                                  sale.customerPhone,
                                  sale.debtAmount
                                )
                              }
                              aria-label={`Thu tiền công nợ hóa đơn ${sale.invoiceCode}`}
                              className="px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap"
                            >
                              Thu nợ khách
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                exportCustomerReceiptPDF({
                                  voucherCode: `PT-${sale.invoiceCode}`,
                                  customerName: sale.customerName,
                                  customerPhone: sale.customerPhone,
                                  invoiceCode: sale.invoiceCode,
                                  previousDebt: sale.totalAmount,
                                  collectedAmount: sale.paidAmount,
                                  remainingDebt: sale.debtAmount,
                                  paymentMethod: 'Tiền mặt / Chuyển khoản',
                                  note: sale.note,
                                  staffName: sale.staffName,
                                  createdAt: sale.createdAt,
                                })
                              }
                              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap"
                            >
                              Phiếu PDF
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSendZaloReminder(sale)}
                              aria-label={`Nhắc nợ Zalo khách ${sale.customerName}`}
                              className="px-2.5 py-1.5 text-xs font-semibold text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg flex items-center gap-1 whitespace-nowrap"
                            >
                              <MessageCircle className="w-3 h-3" />
                              <span>Nhắc nợ Zalo</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenCustomerDebtQr(sale)}
                              aria-label={`Hiện mã VietQR thu nợ ${sale.customerName}`}
                              className="px-2.5 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg flex items-center gap-1 whitespace-nowrap"
                            >
                              <QrCode className="w-3 h-3" />
                              <span>VietQR</span>
                            </button>
                            {canPerformRoleAction(role, 'edit_record') ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openManagerEditCustomerDebt(sale)}
                                  aria-label={`Sửa công nợ hóa đơn ${sale.invoiceCode}`}
                                  className="px-2 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1 whitespace-nowrap"
                                >
                                  <Pencil className="w-3 h-3" />
                                  <span>Sửa</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setCancelingSale(sale)}
                                  aria-label={`Hủy hóa đơn nợ ${sale.invoiceCode}`}
                                  className="px-2 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg flex items-center gap-1 whitespace-nowrap"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  <span>Hủy HĐ</span>
                                </button>
                              </>
                            ) : (
                              <span
                                title="Chỉ Quản lý mới có quyền sửa/xóa"
                                className="px-2 py-1 text-[11px] text-slate-400 flex items-center gap-1 whitespace-nowrap"
                              >
                                <Lock className="w-3 h-3" />
                                <span>Khóa sửa/xóa</span>
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {filteredCustomerDebts.length > 0 && (
                <tfoot className="border-t-2 border-emerald-200 bg-emerald-50/70 text-xs font-semibold text-slate-800">
                  <tr>
                    <td colSpan={3} className="py-3 px-4">
                      Tổng cộng theo bộ lọc: <strong>{filteredCustomerDebts.length}</strong> hóa đơn công nợ KH
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap text-slate-800">
                      {formatVND(filteredCustomerDebts.reduce((sum, s) => sum + s.totalAmount, 0))}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap text-emerald-700">
                      {formatVND(filteredCustomerDebts.reduce((sum, s) => sum + s.paidAmount, 0))}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap font-bold text-red-700">
                      {formatVND(filteredCustomerDebts.reduce((sum, s) => sum + s.debtAmount, 0))}
                    </td>
                    <td colSpan={2} className="py-3 px-4 text-right text-[11px] text-slate-500">
                      Đã đối soát trực tiếp từ sổ Bán hàng
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* Excel Sample Template Download & Upload Bar (Moved to bottom of page) */}
      <ExcelDataBar
        moduleType="debts"
        moduleTitle="Quản Lý Công Nợ Khách Hàng & Nhà Cung Cấp"
        onImportRows={onImportDebtPaymentsFromExcel}
        validationContext={{
          products,
          sales,
          imports,
        }}
        onExportCurrentData={() =>
          exportModuleDataExcel({
            moduleType: 'debts',
            products,
            customers,
            sales,
            imports,
          })
        }
      />

      {/* Manager-Only Edit Debt Record Modal */}
      {editingDebtType && canPerformRoleAction(role, 'edit_record') && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2.5 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Chỉnh sửa chứng từ công nợ (Dành cho Quản lý)"
        >
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-lg max-h-[calc(100dvh-1.25rem)] sm:max-h-[90vh] flex flex-col overflow-hidden shadow-xl">
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/90 shrink-0">
              <div className="min-w-0 pr-2">
                <h3 className="text-sm sm:text-base font-bold text-slate-900 truncate">
                  Chỉnh sửa chứng từ công nợ ({editCode})
                </h3>
                <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">
                  Chỉ Quản lý mới có quyền thay đổi số liệu công nợ đã lưu
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingDebtType(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={submitManagerEditDebt} className="flex flex-col flex-1 min-h-0 overflow-hidden">
              <div className="p-4 sm:p-6 space-y-3.5 sm:space-y-4 overflow-y-auto flex-1 overscroll-contain">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Đối tác ({editingDebtType === 'supplier' ? 'Nhà cung cấp' : 'Khách hàng'})
                  </label>
                  <input
                    type="text"
                    required
                    value={editPartner}
                    onChange={(e) => setEditPartner(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Số điện thoại
                  </label>
                  <input
                    type="text"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Số lượng ({editUnit})
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={editQty}
                    onChange={(e) => setEditQty(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Đơn giá (VNĐ)
                  </label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Đã thanh toán (VNĐ)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={editPaid}
                    onChange={(e) => setEditPaid(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="debt-edit-days" className="block text-xs font-semibold text-slate-700 mb-1">
                      Chọn ngày nợ (Tự động nhảy ngày)
                    </label>
                    <select
                      id="debt-edit-days"
                      value={matchDebtTermDays(editDueDate)}
                      onChange={(e) => {
                        const days = Number(e.target.value);
                        if (days > 0) {
                          setEditDueDate(computeDueDateAfterDays(days));
                        }
                      }}
                      className="w-full px-3 py-2 text-sm font-semibold bg-white border border-slate-200 rounded-lg text-slate-900"
                    >
                      <option value="">-- Chọn số ngày nợ --</option>
                      {DEBT_TERM_DAY_OPTIONS.map((days) => (
                        <option key={days} value={days}>
                          {days} ngày
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Hạn hẹn thanh toán nợ
                    </label>
                    <input
                      type="date"
                      value={editDueDate}
                      onChange={(e) => setEditDueDate(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {DEBT_TERM_DAY_OPTIONS.map((days) => {
                    const targetDate = computeDueDateAfterDays(days);
                    const isSelected = editDueDate === targetDate;
                    return (
                      <button
                        key={days}
                        type="button"
                        onClick={() => setEditDueDate(targetDate)}
                        className={`py-1.5 px-0.5 text-[11px] sm:text-xs font-semibold rounded-lg border transition-colors text-center whitespace-nowrap ${
                          isSelected
                            ? 'bg-emerald-700 text-white border-emerald-700'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-emerald-50 hover:border-emerald-300'
                        }`}
                      >
                        {days} ngày
                      </button>
                    );
                  })}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Ghi chú
                  </label>
                  <input
                    type="text"
                    value={editNote}
                    onChange={(e) => setEditNote(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              </div>

              <div className="px-4 sm:px-6 py-3 border-t border-slate-200 bg-slate-50/90 flex flex-wrap items-center justify-between gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const t = editingDebtType;
                    const id = editingDebtId;
                    setEditingDebtType(null);
                    if (t === 'supplier') {
                      const found = imports.find((i) => i.id === id);
                      if (found) setCancelingImport(found);
                    } else if (t === 'customer') {
                      const found = sales.find((s) => s.id === id);
                      if (found) setCancelingSale(found);
                    }
                  }}
                  className="px-3 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{editingDebtType === 'supplier' ? 'Hủy phiếu mua hàng' : 'Hủy hóa đơn'}</span>
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingDebtType(null)}
                    className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
                  >
                    Đóng
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                  >
                    Lưu cập nhật công nợ
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Debt Settlement Modal */}
      {settlingType && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2.5 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Thanh toán công nợ"
        >
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-md max-h-[calc(100dvh-1.25rem)] sm:max-h-[90vh] flex flex-col overflow-hidden shadow-xl">
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 flex items-center justify-between shrink-0 bg-white">
              <h3 className="text-sm sm:text-base font-bold text-slate-900">
                {settlingType === 'supplier'
                  ? `Thanh toán nợ NCC (${settlingCode})`
                  : `Thu nợ khách hàng (${settlingCode})`}
              </h3>
              <button
                type="button"
                onClick={() => setSettlingType(null)}
                aria-label="Đóng cửa sổ thanh toán công nợ"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitDebtPayment(false);
              }}
              className="flex flex-col flex-1 min-h-0 overflow-hidden"
            >
              <div className="p-4 sm:p-6 space-y-3.5 sm:space-y-4 overflow-y-auto flex-1 overscroll-contain">
              <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1">
                <div>
                  Đối tác: <strong>{settlingPartner}</strong>
                </div>
                <div>
                  Số tiền còn nợ:{' '}
                  <strong className="font-mono text-red-600">{formatVND(settlingMaxDebt)}</strong>
                </div>
              </div>

              <div>
                <label
                  htmlFor="debt-settle-amount"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Số tiền thanh toán đợt này (VNĐ) *
                </label>
                <input
                  id="debt-settle-amount"
                  type="number"
                  min={1000}
                  max={settlingMaxDebt}
                  required
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                />
              </div>

              <div>
                <label
                  htmlFor="debt-settle-note"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Ghi chú chứng từ / chuyển khoản
                </label>
                <input
                  id="debt-settle-note"
                  type="text"
                  value={paymentNote}
                  onChange={(e) => setPaymentNote(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                />
              </div>

              </div>

              <div className="px-4 sm:px-6 py-3 border-t border-slate-200 bg-slate-50/90 flex flex-wrap items-center justify-end gap-2 shrink-0">
                {settlingType === 'customer' && (
                  <button
                    type="button"
                    onClick={() =>
                      setVietQrTarget({
                        title: `VietQR thu nợ ${settlingPartner}`,
                        subtitle: `Hóa đơn ${settlingCode}`,
                        amount: Math.max(0, Number(paymentAmount) || settlingMaxDebt),
                        addInfo: `THU NO ${settlingCode} ${settlingPartner}`,
                        customerPhone: settlingPhone,
                      })
                    }
                    className="px-3 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg flex items-center gap-1 mr-auto"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>Hiện QR thu nợ</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSettlingType(null)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                >
                  Xác nhận thanh toán
                </button>
                <button
                  type="button"
                  onClick={() => submitDebtPayment(true)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-900 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1"
                >
                  <FileDown className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Lưu & Xuất Phiếu PDF</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {cancelingImport && (
        <CancelImportConfirmModal
          targetImport={cancelingImport}
          products={products}
          sales={sales}
          imports={imports}
          paymentVouchers={paymentVouchers}
          stockAdjustments={stockAdjustments}
          onClose={() => setCancelingImport(null)}
          onConfirmDelete={onDeleteImport}
          onNavigateCrossLink={onNavigateCrossLink}
        />
      )}

      {cancelingSale && (
        <CancelSaleConfirmModal
          targetSale={cancelingSale}
          products={products}
          customers={customers}
          imports={imports}
          receiptVouchers={receiptVouchers}
          onClose={() => setCancelingSale(null)}
          onConfirmDelete={onDeleteSale}
          onNavigateCrossLink={onNavigateCrossLink}
        />
      )}

      <VietQrPaymentModal
        isOpen={Boolean(vietQrTarget)}
        onClose={() => setVietQrTarget(null)}
        title={vietQrTarget?.title}
        subtitle={vietQrTarget?.subtitle}
        amount={vietQrTarget?.amount || 0}
        addInfo={vietQrTarget?.addInfo || ''}
        customerPhone={vietQrTarget?.customerPhone}
        zaloMessage={vietQrTarget?.zaloMessage}
        bankConfig={bankQrConfig}
        onSaveBankConfig={onSaveBankQrConfig}
        onNotifyToast={onShowToast}
      />
    </div>
  );
};

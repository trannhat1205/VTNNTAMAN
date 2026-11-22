import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  ExternalLink,
  FileDown,
  Lock,
  Pencil,
  Search,
  Trash2,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  CustomerProfile,
  ImportTransaction,
  ProductItem,
  SaleTransaction,
  UserRole,
} from '../types';
import {
  canPerformRoleAction,
  computeDueDateAfterDays,
  DEBT_TERM_DAY_OPTIONS,
  evaluateDebtUrgency,
  formatVND,
  matchDebtTermDays,
  normalizeVietnameseSearch,
  previewCustomerFifoDebtSettlement,
  previewSupplierFifoDebtSettlement,
} from '../utils/businessLogic';
import {
  exportCustomerReceiptPDF,
  exportModuleDataExcel,
  exportSupplierPaymentPDF,
} from '../utils/exportReports';
import { ExcelDataBar } from './ExcelDataBar';

interface DebtModuleProps {
  products: ProductItem[];
  customers: CustomerProfile[];
  imports: ImportTransaction[];
  sales: SaleTransaction[];
  role: UserRole;
  leadDays: number;
  focusedRecordId?: string | null;
  onClearFocusedRecord?: () => void;
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
}

export const DebtModule: React.FC<DebtModuleProps> = ({
  products,
  customers,
  imports,
  sales,
  role,
  leadDays,
  focusedRecordId,
  onClearFocusedRecord,
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
}) => {
  const [activeTab, setActiveTab] = useState<'supplier' | 'customer'>(
    canAccessSupplierDebts ? 'supplier' : 'customer'
  );
  const [urgencyFilter, setUrgencyFilter] = useState<'all' | 'overdue' | 'due_soon'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLinkedVoucherId, setSelectedLinkedVoucherId] = useState<string | null>(null);

  // Lump-sum FIFO Debt Settlement state (auto-deduct across all older unpaid invoices/receipts by debt date)
  const [fifoPartnerKey, setFifoPartnerKey] = useState<string>('');
  const [fifoLumpSumInput, setFifoLumpSumInput] = useState<string>('');
  const [fifoGroupName, setFifoGroupName] = useState<string>(
    receiptGroups[0] || 'Thu nợ bán hàng khách hàng'
  );
  const [fifoPaymentMethod, setFifoPaymentMethod] = useState<string>('Chuyển khoản ngân hàng');
  const [fifoNote, setFifoNote] = useState<string>('');
  const [fifoFeedback, setFifoFeedback] = useState<string | null>(null);

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

  // Manager-only Quick Edit Debt Record Modal
  const [editingDebtType, setEditingDebtType] = useState<'supplier' | 'customer' | null>(null);
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

  const overdueSuppliers = supplierDebts.filter(
    (i) => evaluateDebtUrgency(i.dueDate, i.debtAmount, '2026-11-16', leadDays).urgency === 'overdue'
  );
  const dueSoonSuppliers = supplierDebts.filter(
    (i) => evaluateDebtUrgency(i.dueDate, i.debtAmount, '2026-11-16', leadDays).urgency === 'due_soon'
  );

  const overdueCustomers = customerDebts.filter(
    (s) => evaluateDebtUrgency(s.dueDate, s.debtAmount, '2026-11-16', leadDays).urgency === 'overdue'
  );
  const dueSoonCustomers = customerDebts.filter(
    (s) => evaluateDebtUrgency(s.dueDate, s.debtAmount, '2026-11-16', leadDays).urgency === 'due_soon'
  );

  const filteredSupplierDebts = supplierDebts.filter((item) => {
    const { urgency } = evaluateDebtUrgency(item.dueDate, item.debtAmount, '2026-11-16', leadDays);
    if (urgencyFilter === 'overdue' && urgency !== 'overdue') return false;
    if (urgencyFilter === 'due_soon' && urgency !== 'due_soon') return false;
    const q = normalizeVietnameseSearch(searchTerm);
    if (!q) return true;
    const haystack = normalizeVietnameseSearch(
      `${item.supplierName} ${item.receiptCode} ${item.productName} ${item.supplierPhone}`
    );
    return haystack.includes(q);
  });

  const filteredCustomerDebts = customerDebts.filter((item) => {
    const { urgency } = evaluateDebtUrgency(item.dueDate, item.debtAmount, '2026-11-16', leadDays);
    if (urgencyFilter === 'overdue' && urgency !== 'overdue') return false;
    if (urgencyFilter === 'due_soon' && urgency !== 'due_soon') return false;
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

          {linkedSupplierRecord && (
            <div className="bg-white rounded-lg border border-emerald-200 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1 text-xs">
                <div className="text-sm font-bold text-slate-900">
                  Phiếu nhập {linkedSupplierRecord.receiptCode} — {linkedSupplierRecord.supplierName}
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
                  <button
                    type="button"
                    onClick={() => openManagerEditSupplierDebt(linkedSupplierRecord)}
                    className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>Sửa chứng từ</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {linkedCustomerRecord && (
            <div className="bg-white rounded-lg border border-emerald-200 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1 text-xs">
                <div className="text-sm font-bold text-slate-900">
                  Hóa đơn {linkedCustomerRecord.invoiceCode} — {linkedCustomerRecord.customerName} (
                  {linkedCustomerRecord.customerPhone})
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
                  <button
                    type="button"
                    onClick={() => openManagerEditCustomerDebt(linkedCustomerRecord)}
                    className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>Sửa hóa đơn</span>
                  </button>
                )}
              </div>
            </div>
          )}
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
              </div>
            ) : (
              filteredSupplierDebts.map((imp) => {
                const { urgency, daysRemaining } = evaluateDebtUrgency(
                  imp.dueDate,
                  imp.debtAmount,
                  '2026-11-16',
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
                            onClick={() => onDeleteImport(imp.id)}
                            aria-label={`Xóa phiếu nợ ${imp.receiptCode}`}
                            className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg border border-slate-200"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
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
                    </td>
                  </tr>
                ) : (
                  filteredSupplierDebts.map((imp) => {
                    const { urgency, daysRemaining } = evaluateDebtUrgency(
                      imp.dueDate,
                      imp.debtAmount,
                      '2026-11-16',
                      leadDays
                    );
                    const isHighlighted = selectedLinkedVoucherId === imp.id;
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
                            {imp.createdAt.slice(0, 10)}
                          </div>
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
                                  onClick={() => onDeleteImport(imp.id)}
                                  aria-label={`Xóa phiếu nợ ${imp.receiptCode}`}
                                  className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
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
              </div>
            ) : (
              filteredCustomerDebts.map((sale) => {
                const { urgency, daysRemaining } = evaluateDebtUrgency(
                  sale.dueDate,
                  sale.debtAmount,
                  '2026-11-16',
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
                            onClick={() => onDeleteSale(sale.id)}
                            aria-label={`Xóa hóa đơn nợ ${sale.invoiceCode}`}
                            className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg border border-slate-200"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
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
                    </td>
                  </tr>
                ) : (
                  filteredCustomerDebts.map((sale) => {
                    const { urgency, daysRemaining } = evaluateDebtUrgency(
                      sale.dueDate,
                      sale.debtAmount,
                      '2026-11-16',
                      leadDays
                    );
                    const isHighlighted = selectedLinkedVoucherId === sale.id;
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
                            {sale.createdAt.slice(0, 10)}
                          </div>
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
                                  onClick={() => onDeleteSale(sale.id)}
                                  aria-label={`Xóa hóa đơn nợ ${sale.invoiceCode}`}
                                  className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
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
            </table>
          </div>
        </div>
      )}

      {/* Excel Sample Template Download & Upload Bar (Moved to bottom of page) */}
      <ExcelDataBar
        moduleType="debts"
        moduleTitle="Quản Lý Công Nợ Khách Hàng & Nhà Cung Cấp"
        onImportRows={onImportDebtPaymentsFromExcel}
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

              <div className="px-4 sm:px-6 py-3 border-t border-slate-200 bg-slate-50/90 flex items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setEditingDebtType(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                >
                  Lưu cập nhật công nợ
                </button>
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
    </div>
  );
};

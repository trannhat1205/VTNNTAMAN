import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  FileDown,
  FileSpreadsheet,
  FileText,
  Lock,
  Pencil,
  Printer,
  RotateCcw,
  ShoppingCart,
  Trash2,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';
import {
  CustomerProfile,
  ImportTransaction,
  ProductItem,
  SaleTransaction,
  SavedVoucherRecord,
  UserRole,
} from '../types';
import {
  canPerformRoleAction,
  computeDueDateAfterDays,
  computeReceivedItemsAndDebtReport,
  DEBT_TERM_DAY_OPTIONS,
  formatVND,
  getCurrentMonthRangeVietnam,
  getTodayVietnamDateStr,
  matchDebtTermDays,
} from '../utils/businessLogic';
import {
  exportCombinedReceivedItemsAndDebtExcel,
  exportCombinedReceivedItemsAndDebtPDF,
  exportCustomerReceiptPDF,
  exportImportReceiptPDF,
  exportSaleInvoicePDF,
  exportSupplierPaymentPDF,
  exportThermalReceiptPDF,
} from '../utils/exportReports';
import { AutocompleteTextInput, SearchableSelect } from './SearchableSelect';

export type VoucherType =
  | 'sale_invoice'
  | 'customer_receipt'
  | 'supplier_payment'
  | 'import_receipt';

interface VoucherPrintCenterProps {
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  customers: CustomerProfile[];
  products: ProductItem[];
  role: UserRole;
  savedVouchers: SavedVoucherRecord[];
  onSaveVoucher: (
    data: Omit<SavedVoucherRecord, 'id' | 'createdAt' | 'updatedAt'>,
    editingId?: string
  ) => SavedVoucherRecord;
  onDeleteVoucher: (voucherId: string) => void;
  currentStaffName: string;
  lockedWarehouse?: string | null;
  onNotifyToast: (msg: string) => void;
}

export const VoucherPrintCenter: React.FC<VoucherPrintCenterProps> = ({
  sales,
  imports,
  customers,
  products,
  role,
  savedVouchers,
  onSaveVoucher,
  onDeleteVoucher,
  currentStaffName,
  lockedWarehouse,
  onNotifyToast,
}) => {
  const [activeVoucher, setActiveVoucher] = useState<VoucherType>('sale_invoice');
  const [paperFormat, setPaperFormat] = useState<'a4' | 'k80' | 'k58'>('a4');
  const [selectedSourceCreatedAt, setSelectedSourceCreatedAt] = useState<string>('');
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [editingVoucherId, setEditingVoucherId] = useState<string | null>(null);
  const [lastExportedPreview, setLastExportedPreview] = useState<{
    fileName: string;
    dataUrl: string;
  } | null>(null);

  // Blank-by-default form state so fields always clear after saving/exporting
  const [voucherCode, setVoucherCode] = useState<string>('');
  const [warehouseName, setWarehouseName] = useState<string>(
    lockedWarehouse || 'Tâm An Mỹ Ngãi'
  );

  useEffect(() => {
    if (lockedWarehouse) {
      setWarehouseName(lockedWarehouse);
    }
  }, [lockedWarehouse]);
  const [partnerName, setPartnerName] = useState<string>('');
  const [partnerPhone, setPartnerPhone] = useState<string>('');
  const [partnerAddress, setPartnerAddress] = useState<string>('');
  const [refCode, setRefCode] = useState<string>('');
  const [productName, setProductName] = useState<string>('');
  const [unit, setUnit] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('');
  const [unitPrice, setUnitPrice] = useState<string>('');
  const [discountAmount, setDiscountAmount] = useState<string>('0');
  const [paidOrCollected, setPaidOrCollected] = useState<string>('');
  const [previousDebt, setPreviousDebt] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<string>('Tiền mặt / Chuyển khoản');
  const [note, setNote] = useState<string>('');
  const [selectedQuickFillId, setSelectedQuickFillId] = useState<string>('');

  // Combined General Voucher ("Phiếu tổng hợp chung các mặt hàng đã nhận & còn nợ từ ngày ... đến ngày ...")
  const currentMonthRange = useMemo(() => getCurrentMonthRangeVietnam(), []);
  const todayDateStr = getTodayVietnamDateStr();
  const [combinedFromDate, setCombinedFromDate] = useState<string>(currentMonthRange.from);
  const [combinedToDate, setCombinedToDate] = useState<string>(currentMonthRange.to);
  const [combinedCustomerId, setCombinedCustomerId] = useState<string>('all');
  const [combinedOnlyUnpaid, setCombinedOnlyUnpaid] = useState<boolean>(false);

  const combinedReceivedReport = useMemo(
    () =>
      computeReceivedItemsAndDebtReport(sales, {
        fromDate: combinedFromDate,
        toDate: combinedToDate,
        customerId: combinedCustomerId === 'all' ? undefined : combinedCustomerId,
        onlyUnpaid: combinedOnlyUnpaid,
      }),
    [sales, combinedFromDate, combinedToDate, combinedCustomerId, combinedOnlyUnpaid]
  );

  const selectedCombinedCustomer = useMemo(
    () => customers.find((c) => c.id === combinedCustomerId) || null,
    [customers, combinedCustomerId]
  );

  const resetAllFieldsToBlank = () => {
    setEditingVoucherId(null);
    setVoucherCode('');
    setWarehouseName(lockedWarehouse || 'Tâm An Mỹ Ngãi');
    setPartnerName('');
    setPartnerPhone('');
    setPartnerAddress('');
    setRefCode('');
    setProductName('');
    setUnit('');
    setQuantity('');
    setUnitPrice('');
    setDiscountAmount('0');
    setPaidOrCollected('');
    setPreviousDebt('');
    setDueDate('');
    setPaymentMethod('Tiền mặt / Chuyển khoản');
    setNote('');
    setSelectedQuickFillId('');
    setSelectedSourceCreatedAt('');
  };

  const handleLoadSavedVoucherForEdit = (vc: SavedVoucherRecord) => {
    if (!canPerformRoleAction(role, 'edit_record')) return;
    setActiveVoucher(vc.voucherType);
    setEditingVoucherId(vc.id);
    setVoucherCode(vc.voucherCode);
    setWarehouseName(vc.warehouseName || 'Tâm An Mỹ Ngãi');
    setPartnerName(vc.partnerName);
    setPartnerPhone(vc.partnerPhone);
    setPartnerAddress(vc.partnerAddress);
    setRefCode(vc.refCode);
    setProductName(vc.productName);
    setUnit(vc.unit);
    setQuantity(String(vc.quantity || 1));
    setUnitPrice(String(vc.unitPrice || 0));
    setPreviousDebt(String(vc.totalOrPrevDebt || 0));
    setPaidOrCollected(String(vc.paidOrCollected || 0));
    setDueDate(vc.dueDate);
    setPaymentMethod(vc.paymentMethod || 'Tiền mặt / Chuyển khoản');
    setNote(vc.note);
    setStatusBanner(
      `Đang ở chế độ Quản lý chỉnh sửa chứng từ "${vc.voucherCode}" — Thay đổi thông tin bên dưới và bấm Lưu / Xuất PDF để cập nhật.`
    );
  };

  const handleSwitchVoucherType = (type: VoucherType) => {
    setActiveVoucher(type);
    resetAllFieldsToBlank();
    setStatusBanner(null);
  };

  // Optional quick pre-fill from existing transactions if user chooses one from dropdown
  const handleQuickFill = (id: string) => {
    setSelectedQuickFillId(id);
    if (!id) {
      resetAllFieldsToBlank();
      return;
    }

    if (activeVoucher === 'sale_invoice') {
      const sale = sales.find((s) => s.id === id);
      if (sale) {
        const cust = customers.find((c) => c.id === sale.customerId);
        setVoucherCode(sale.invoiceCode);
        setWarehouseName(sale.warehouseName || 'Tâm An Mỹ Ngãi');
        setPartnerName(sale.customerName);
        setPartnerPhone(sale.customerPhone);
        setPartnerAddress(cust?.address || '');
        setProductName(sale.productName);
        setUnit(sale.unit);
        setQuantity(String(sale.quantity));
        setUnitPrice(String(sale.unitPrice));
        setDiscountAmount(String(sale.discountAmount || 0));
        setPaidOrCollected(String(sale.paidAmount));
        setDueDate(sale.dueDate);
        setNote(sale.note);
        setSelectedSourceCreatedAt(sale.createdAt);
      }
    } else if (activeVoucher === 'customer_receipt') {
      const sale = sales.find((s) => s.id === id);
      if (sale) {
        const cust = customers.find((c) => c.id === sale.customerId);
        setVoucherCode(`PT-${Date.now().toString().slice(-4)}`);
        setPartnerName(sale.customerName);
        setPartnerPhone(sale.customerPhone);
        setPartnerAddress(cust?.address || '');
        setRefCode(sale.invoiceCode);
        setPreviousDebt(String(sale.debtAmount || sale.totalAmount));
        setPaidOrCollected(String(sale.debtAmount || sale.paidAmount));
        setNote(`Thu tiền khách hàng theo hóa đơn ${sale.invoiceCode}`);
        setSelectedSourceCreatedAt(sale.createdAt);
      }
    } else if (activeVoucher === 'supplier_payment') {
      const imp = imports.find((i) => i.id === id);
      if (imp) {
        setVoucherCode(`PC-${Date.now().toString().slice(-4)}`);
        setPartnerName(imp.supplierName);
        setPartnerPhone(imp.supplierPhone);
        setRefCode(imp.receiptCode);
        setPreviousDebt(String(imp.debtAmount || imp.totalCost));
        setPaidOrCollected(String(imp.debtAmount || imp.paidAmount));
        setNote(`Thanh toán tiền nhà cung cấp phiếu ${imp.receiptCode}`);
        setSelectedSourceCreatedAt(imp.createdAt);
      }
    } else if (activeVoucher === 'import_receipt') {
      const imp = imports.find((i) => i.id === id);
      if (imp) {
        setVoucherCode(imp.receiptCode);
        setWarehouseName(imp.warehouseName || 'Tâm An Mỹ Ngãi');
        setPartnerName(imp.supplierName);
        setPartnerPhone(imp.supplierPhone);
        setProductName(imp.productName);
        setUnit(imp.unit);
        setQuantity(String(imp.quantity));
        setUnitPrice(String(imp.unitCost));
        setPaidOrCollected(String(imp.paidAmount));
        setDueDate(imp.dueDate);
        setNote(imp.note);
        setSelectedSourceCreatedAt(imp.createdAt);
      }
    }
  };

  const qtyNum = Math.max(0, Number(quantity) || 0);
  const priceNum = Math.max(0, Number(unitPrice) || 0);
  const discountNum =
    activeVoucher === 'sale_invoice' ? Math.max(0, Math.round(Number(discountAmount) || 0)) : 0;
  const computedTotal = Math.max(0, Math.round(qtyNum * priceNum) - discountNum);
  const paidNum = Math.max(0, Number(paidOrCollected) || 0);
  const prevDebtNum = Math.max(0, Number(previousDebt) || 0);
  const remainingDebt =
    activeVoucher === 'sale_invoice' || activeVoucher === 'import_receipt'
      ? Math.max(0, computedTotal - paidNum)
      : Math.max(0, prevDebtNum - paidNum);

  const handleExportPDF = (e: React.FormEvent) => {
    e.preventDefault();
    const todayIso = new Date().toISOString();
    const effectiveCreatedAt = selectedSourceCreatedAt || todayIso;
    let exportedFileName = '';

    if (paperFormat === 'k80' || paperFormat === 'k58') {
      const paperWidthMm: 58 | 80 = paperFormat === 'k58' ? 58 : 80;
      const thermalCode =
        voucherCode.trim() ||
        (activeVoucher === 'sale_invoice'
          ? `HD-${Date.now().toString().slice(-4)}`
          : activeVoucher === 'customer_receipt'
          ? `PT-${Date.now().toString().slice(-4)}`
          : activeVoucher === 'supplier_payment'
          ? `PC-${Date.now().toString().slice(-4)}`
          : `PN-${Date.now().toString().slice(-4)}`);
      exportedFileName = exportThermalReceiptPDF({
        paperWidthMm,
        storeName: warehouseName.trim() || 'VTNN Tâm An',
        voucherTitle:
          activeVoucher === 'sale_invoice'
            ? 'Hóa Đơn Bán Hàng'
            : activeVoucher === 'customer_receipt'
            ? 'Phiếu Thu Tiền Khách'
            : activeVoucher === 'supplier_payment'
            ? 'Phiếu Chi Trả NCC'
            : 'Phiếu Nhập Kho',
        voucherCode: thermalCode,
        dateStr: effectiveCreatedAt.slice(0, 10),
        partnerLabel:
          activeVoucher === 'sale_invoice' || activeVoucher === 'customer_receipt'
            ? 'Khách hàng'
            : 'Nhà cung cấp',
        partnerName: partnerName.trim() || 'Khách lẻ',
        partnerPhone: partnerPhone.trim(),
        productName:
          activeVoucher === 'sale_invoice' || activeVoucher === 'import_receipt'
            ? productName.trim() || 'Vật tư nông nghiệp Tâm An'
            : undefined,
        unit: unit.trim() || 'Đơn vị',
        quantity: qtyNum || 1,
        unitPrice: priceNum,
        discountAmount: discountNum,
        totalLabel:
          activeVoucher === 'sale_invoice' || activeVoucher === 'import_receipt'
            ? 'Tổng thanh toán:'
            : 'Nợ gốc / Trước GD:',
        totalAmount:
          activeVoucher === 'sale_invoice' || activeVoucher === 'import_receipt'
            ? computedTotal
            : prevDebtNum,
        paidLabel:
          activeVoucher === 'supplier_payment' || activeVoucher === 'import_receipt'
            ? 'Đã trả NCC:'
            : 'Đã thanh toán:',
        paidAmount: paidNum,
        debtLabel: 'Còn lại:',
        remainingDebt,
        dueDate: dueDate || todayIso.slice(0, 10),
        staffName: currentStaffName,
        note: note.trim(),
      });
    } else if (activeVoucher === 'sale_invoice') {
      const code = voucherCode.trim() || `HD-${Date.now().toString().slice(-4)}`;
      exportedFileName = exportSaleInvoicePDF({
        invoiceCode: code,
        warehouseName: warehouseName.trim() || 'Tâm An Mỹ Ngãi',
        customerName: partnerName.trim() || 'Khách hàng mua lẻ',
        customerPhone: partnerPhone.trim(),
        customerAddress: partnerAddress.trim(),
        productName: productName.trim() || 'Vật tư nông nghiệp Tâm An',
        unit: unit.trim() || 'Đơn vị',
        quantity: qtyNum || 1,
        unitPrice: priceNum,
        discountAmount: discountNum,
        totalAmount: computedTotal,
        paidAmount: paidNum,
        debtAmount: remainingDebt,
        dueDate: dueDate || todayIso.slice(0, 10),
        note: note.trim(),
        staffName: currentStaffName,
        createdAt: effectiveCreatedAt,
      });
    } else if (activeVoucher === 'customer_receipt') {
      const code = voucherCode.trim() || `PT-${Date.now().toString().slice(-4)}`;
      exportedFileName = exportCustomerReceiptPDF({
        voucherCode: code,
        customerName: partnerName.trim() || 'Khách hàng',
        customerPhone: partnerPhone.trim(),
        customerAddress: partnerAddress.trim(),
        invoiceCode: refCode.trim() || 'HD-MOI',
        previousDebt: prevDebtNum,
        collectedAmount: paidNum,
        remainingDebt,
        paymentMethod: paymentMethod.trim() || 'Tiền mặt / Chuyển khoản',
        note: note.trim() || 'Thu tiền công nợ khách hàng',
        staffName: currentStaffName,
        createdAt: effectiveCreatedAt,
      });
    } else if (activeVoucher === 'supplier_payment') {
      const code = voucherCode.trim() || `PC-${Date.now().toString().slice(-4)}`;
      exportedFileName = exportSupplierPaymentPDF({
        voucherCode: code,
        supplierName: partnerName.trim() || 'Nhà cung cấp VTNN',
        supplierPhone: partnerPhone.trim(),
        receiptCode: refCode.trim() || 'PN-MOI',
        previousDebt: prevDebtNum,
        paidAmount: paidNum,
        remainingDebt,
        paymentMethod: paymentMethod.trim() || 'Chuyển khoản ngân hàng',
        note: note.trim() || 'Thanh toán công nợ nhà cung cấp',
        staffName: currentStaffName,
        createdAt: effectiveCreatedAt,
      });
    } else if (activeVoucher === 'import_receipt') {
      const code = voucherCode.trim() || `PN-${Date.now().toString().slice(-4)}`;
      exportedFileName = exportImportReceiptPDF({
        receiptCode: code,
        warehouseName: warehouseName.trim() || 'Tâm An Mỹ Ngãi',
        supplierName: partnerName.trim() || 'Nhà cung cấp VTNN',
        supplierPhone: partnerPhone.trim(),
        productName: productName.trim() || 'Vật tư nông nghiệp',
        unit: unit.trim() || 'Bao',
        quantity: qtyNum || 1,
        unitCost: priceNum,
        totalCost: computedTotal,
        paidAmount: paidNum,
        debtAmount: remainingDebt,
        dueDate: dueDate || todayIso.slice(0, 10),
        note: note.trim(),
        staffName: currentStaffName,
        createdAt: effectiveCreatedAt,
      });
    }

    const finalCode =
      voucherCode.trim() ||
      (activeVoucher === 'sale_invoice'
        ? `HD-${Date.now().toString().slice(-4)}`
        : activeVoucher === 'customer_receipt'
        ? `PT-${Date.now().toString().slice(-4)}`
        : activeVoucher === 'supplier_payment'
        ? `PC-${Date.now().toString().slice(-4)}`
        : `PN-${Date.now().toString().slice(-4)}`);

    onSaveVoucher(
      {
        voucherCode: finalCode,
        voucherType: activeVoucher,
        warehouseName: lockedWarehouse || warehouseName.trim() || 'Tâm An Mỹ Ngãi',
        partnerName: partnerName.trim() || 'Khách hàng / Đối tác',
        partnerPhone: partnerPhone.trim(),
        partnerAddress: partnerAddress.trim(),
        refCode: refCode.trim() || finalCode,
        productName: productName.trim() || 'Vật tư nông nghiệp Tâm An',
        unit: unit.trim() || 'Đơn vị',
        quantity: qtyNum || 1,
        unitPrice: priceNum,
        totalOrPrevDebt:
          activeVoucher === 'sale_invoice' || activeVoucher === 'import_receipt'
            ? computedTotal
            : prevDebtNum,
        paidOrCollected: paidNum,
        remainingDebt,
        dueDate: dueDate || todayIso.slice(0, 10),
        paymentMethod: paymentMethod.trim() || 'Tiền mặt / Chuyển khoản',
        note: note.trim(),
        staffName: currentStaffName,
      },
      editingVoucherId || undefined
    );

    const latestWinPreview = (
      window as unknown as {
        __lastExportedPdfPreview?: { fileName: string; dataUrl: string };
      }
    ).__lastExportedPdfPreview;
    if (latestWinPreview) {
      setLastExportedPreview(latestWinPreview);
    }

    const wasEditing = Boolean(editingVoucherId);
    // Immediately reset all fields to blank per user requirement so staff can enter new data next
    resetAllFieldsToBlank();

    const msg = wasEditing
      ? `Đã cập nhật chứng từ & xuất lại PDF tiếng Việt có dấu "${exportedFileName}" và làm trống toàn bộ ô nhập liệu!`
      : `Đã lưu chứng từ & xuất phiếu PDF tiếng Việt có dấu "${exportedFileName}" và làm trống toàn bộ ô nhập liệu!`;
    setStatusBanner(msg);
    onNotifyToast(msg);
  };

  const voucherTabs: { id: VoucherType; label: string; icon: React.ReactNode }[] = [
    {
      id: 'sale_invoice',
      label: '1. Phiếu in Hóa đơn Bán hàng',
      icon: <ShoppingCart className="w-4 h-4" />,
    },
    {
      id: 'customer_receipt',
      label: '2. Phiếu in Thu tiền Khách hàng',
      icon: <Users className="w-4 h-4" />,
    },
    {
      id: 'supplier_payment',
      label: '3. Phiếu in Thanh toán Nhà cung cấp',
      icon: <Wallet className="w-4 h-4" />,
    },
    {
      id: 'import_receipt',
      label: '4. Phiếu in Nhập hàng / Nhập kho',
      icon: <Truck className="w-4 h-4" />,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header & 4 Voucher Type Switcher */}
      <div className="bg-white p-5 sm:p-6 rounded-xl border border-slate-200 space-y-3">
        <div className="flex items-center justify-start sm:justify-end">
          <button
            type="button"
            onClick={resetAllFieldsToBlank}
            className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Làm trống toàn bộ ô nhập</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-2">
          {voucherTabs.map((t) => {
            const isActive = activeVoucher === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => handleSwitchVoucherType(t.id)}
                className={`p-3 rounded-lg border text-left transition-colors flex items-center gap-2.5 ${
                  isActive
                    ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
                    : 'bg-slate-50 text-slate-800 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <span className="shrink-0">{t.icon}</span>
                <span className="text-xs font-bold leading-snug">{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* NEW: Phiếu Tổng Hợp Chung Danh Sách Các Mặt Hàng Đã Nhận & Còn Nợ */}
      <div className="bg-white p-4 sm:p-6 rounded-xl border border-emerald-200 space-y-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const fileName = exportCombinedReceivedItemsAndDebtPDF({
                  customerName: selectedCombinedCustomer
                    ? selectedCombinedCustomer.name
                    : 'Tất cả khách hàng nhận hàng trong kỳ',
                  customerPhone: selectedCombinedCustomer?.phone || '',
                  customerAddress: selectedCombinedCustomer?.address || '',
                  fromDate: combinedFromDate,
                  toDate: combinedToDate,
                  items: combinedReceivedReport.items,
                  onlyUnpaid: combinedOnlyUnpaid,
                  staffName: currentStaffName,
                });
                const latestWinPreview = (
                  window as unknown as {
                    __lastExportedPdfPreview?: { fileName: string; dataUrl: string };
                  }
                ).__lastExportedPdfPreview;
                if (latestWinPreview) {
                  setLastExportedPreview(latestWinPreview);
                }
                const msg = `Đã xuất Phiếu tổng hợp chung các mặt hàng đã nhận (${combinedFromDate} đến ${combinedToDate}): ${fileName}`;
                setStatusBanner(msg);
                onNotifyToast(msg);
              }}
              className="px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg flex items-center gap-1.5 whitespace-nowrap"
            >
              <Printer className="w-4 h-4 shrink-0" />
              <span>In Phiếu Tổng Hợp Chung (PDF)</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const fileName = exportCombinedReceivedItemsAndDebtExcel({
                  customerName: selectedCombinedCustomer
                    ? selectedCombinedCustomer.name
                    : 'Tất cả khách hàng trong kỳ',
                  fromDate: combinedFromDate,
                  toDate: combinedToDate,
                  items: combinedReceivedReport.items,
                  onlyUnpaid: combinedOnlyUnpaid,
                  staffName: currentStaffName,
                });
                const msg = `Đã xuất tệp báo cáo Excel các mặt hàng đã nhận (${combinedFromDate} đến ${combinedToDate}): ${fileName}`;
                setStatusBanner(msg);
                onNotifyToast(msg);
              }}
              className="px-3.5 py-2 text-xs font-semibold text-slate-900 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1.5 whitespace-nowrap"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>Xuất Tệp Báo Cáo Mặt Hàng Đã Nhận</span>
            </button>
          </div>
        </div>

        {/* Filter Bar: Từ ngày ... Đến ngày ... + Chọn Khách hàng + Tất cả / Chỉ còn nợ */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-3.5 bg-slate-50 rounded-xl border border-slate-200">
          <div>
            <label
              htmlFor="vc-combined-from"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Từ ngày
            </label>
            <input
              id="vc-combined-from"
              type="date"
              value={combinedFromDate}
              onChange={(e) => setCombinedFromDate(e.target.value)}
              className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-900"
            />
          </div>
          <div>
            <label
              htmlFor="vc-combined-to"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Đến ngày
            </label>
            <input
              id="vc-combined-to"
              type="date"
              value={combinedToDate}
              onChange={(e) => setCombinedToDate(e.target.value)}
              className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-900"
            />
          </div>
          <div>
            <label
              htmlFor="vc-combined-customer"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Khách hàng nhận hàng
            </label>
            <select
              id="vc-combined-customer"
              value={combinedCustomerId}
              onChange={(e) => setCombinedCustomerId(e.target.value)}
              className="w-full px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 rounded-lg text-slate-900"
            >
              <option value="all">Tất cả khách hàng ({customers.length})</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.phone})
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="block text-xs font-semibold text-slate-700 mb-1">
              Trạng thái hàng hóa
            </span>
            <div className="grid grid-cols-2 gap-1 p-0.5 bg-white rounded-lg border border-slate-200">
              <button
                type="button"
                onClick={() => setCombinedOnlyUnpaid(false)}
                className={`py-1.5 px-2 text-xs font-semibold rounded-md transition-colors ${
                  !combinedOnlyUnpaid
                    ? 'bg-emerald-700 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Tất cả đã nhận
              </button>
              <button
                type="button"
                onClick={() => setCombinedOnlyUnpaid(true)}
                className={`py-1.5 px-2 text-xs font-semibold rounded-md transition-colors ${
                  combinedOnlyUnpaid
                    ? 'bg-red-600 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Chỉ còn nợ
              </button>
            </div>
          </div>
        </div>

        {/* Table of Received Items from Date to Date */}
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto max-h-[320px]">
            <table className="w-full min-w-[860px] text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                  <th className="py-2.5 px-2.5 w-[88px] whitespace-nowrap">Ngày nhận</th>
                  <th className="py-2.5 px-2.5 w-[98px] whitespace-nowrap">Mã HĐ</th>
                  <th className="py-2.5 px-2.5 min-w-[150px]">Khách hàng</th>
                  <th className="py-2.5 px-2.5 min-w-[190px]">Tên mặt hàng đã nhận</th>
                  <th className="py-2.5 px-2.5 w-[90px] text-center whitespace-nowrap">Số lượng</th>
                  <th className="py-2.5 px-2.5 w-[88px] text-right whitespace-nowrap">Đơn giá</th>
                  <th className="py-2.5 px-2.5 w-[96px] text-right whitespace-nowrap">Thành tiền</th>
                  <th className="py-2.5 px-2.5 w-[96px] text-right whitespace-nowrap">Đã trả</th>
                  <th className="py-2.5 px-2.5 w-[96px] text-right whitespace-nowrap">Còn nợ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {combinedReceivedReport.items.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-slate-500">
                      Không có mặt hàng nào được ghi nhận từ ngày {combinedFromDate} đến ngày{' '}
                      {combinedToDate}.
                    </td>
                  </tr>
                ) : (
                  combinedReceivedReport.items.map((item) => (
                    <tr key={item.saleId} className="hover:bg-slate-50">
                      <td className="py-2.5 px-2.5 font-mono whitespace-nowrap align-middle">{item.date}</td>
                      <td className="py-2.5 px-2.5 font-mono font-bold text-emerald-800 whitespace-nowrap align-middle">
                        {item.invoiceCode}
                      </td>
                      <td className="py-2.5 px-2.5 min-w-[150px] font-semibold text-slate-900 align-middle leading-snug">
                        {item.customerName}
                      </td>
                      <td className="py-2.5 px-2.5 min-w-[190px] font-medium text-slate-900 align-middle leading-snug">
                        {item.productName}
                      </td>
                      <td className="py-2.5 px-2.5 text-center font-mono whitespace-nowrap align-middle">
                        {item.quantity} {item.unit}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap align-middle">
                        {formatVND(item.unitPrice)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono tabular-nums font-semibold whitespace-nowrap align-middle">
                        {formatVND(item.totalAmount)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-emerald-700 whitespace-nowrap align-middle">
                        {formatVND(item.paidAmount)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap align-middle">
                        <span
                          className={
                            item.debtAmount > 0
                              ? 'font-bold text-red-600'
                              : 'text-slate-500'
                          }
                        >
                          {formatVND(item.debtAmount)}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 bg-emerald-50/60 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="font-semibold text-slate-800">
              Tổng hợp từ {combinedFromDate} đến {combinedToDate}:{' '}
              <span className="text-emerald-800">
                {combinedReceivedReport.totalItemsCount} mặt hàng ({combinedReceivedReport.totalQuantity} đơn vị)
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-4 font-mono">
              <span>
                Tổng tiền hàng: <strong>{formatVND(combinedReceivedReport.totalAmount)}</strong>
              </span>
              <span className="text-emerald-700">
                Đã thu: <strong>{formatVND(combinedReceivedReport.totalPaid)}</strong>
              </span>
              <span className="text-red-600 font-bold">
                Còn nợ phải thu: {formatVND(combinedReceivedReport.totalDebt)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {statusBanner && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 font-semibold flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>{statusBanner}</span>
        </div>
      )}

      {/* Main Split View: Blank Form Input (Left) + Live Printable Voucher Preview (Right) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-6 bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/60 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Điền Thông Tin Xuất{' '}
                {voucherTabs.find((v) => v.id === activeVoucher)?.label.replace(/^\d+\.\s*/, '')}
              </h3>
            </div>
          </div>

          <form onSubmit={handleExportPDF} className="p-6 space-y-4">
            {/* Print Paper Format Selector (A4 / K80 / K58 Thermal) */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-emerald-50/60 rounded-lg border border-emerald-200">
              <span className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                <Printer className="w-3.5 h-3.5 text-emerald-700" />
                <span>Khổ giấy in PDF:</span>
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: 'a4', label: 'Khổ chuẩn A4' },
                    { id: 'k80', label: 'In nhiệt K80 (80mm)' },
                    { id: 'k58', label: 'In nhiệt K58 (58mm)' },
                  ] as const
                ).map((fmt) => (
                  <button
                    key={fmt.id}
                    type="button"
                    onClick={() => setPaperFormat(fmt.id)}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                      paperFormat === fmt.id
                        ? 'bg-emerald-700 text-white shadow-xs'
                        : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {fmt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Optional Quick Prefill from existing records with instant type-ahead search */}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <label
                htmlFor="voucher-quickfill-select"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Nạp nhanh dữ liệu từ phiếu đã lưu (Gõ tên KH, mã HĐ, tên vật tư để tìm nhanh)
              </label>
              <SearchableSelect
                id="voucher-quickfill-select"
                value={selectedQuickFillId}
                onChange={(val) => handleQuickFill(val)}
                placeholder="Gõ mã phiếu, tên khách hàng, SĐT hoặc tên vật tư để chọn nhanh..."
                emptyOptionLabel="-- Màn hình trống (Tự điền mới) --"
                options={
                  activeVoucher === 'sale_invoice' || activeVoucher === 'customer_receipt'
                    ? sales.map((s) => ({
                        value: s.id,
                        label: `${s.invoiceCode} — ${s.customerName} (${s.productName} · ${formatVND(s.totalAmount)})`,
                        subLabel: `SĐT: ${s.customerPhone || '---'} · Kho: ${s.warehouseName || 'Tâm An Mỹ Ngãi'} · Còn nợ: ${formatVND(s.debtAmount)}`,
                        badge: formatVND(s.totalAmount),
                        keywords: `${s.invoiceCode} ${s.customerName} ${s.customerPhone} ${s.productName} ${s.warehouseName || ''}`,
                      }))
                    : imports.map((i) => ({
                        value: i.id,
                        label: `${i.receiptCode} — ${i.supplierName} (${i.productName} · ${formatVND(i.totalCost)})`,
                        subLabel: `SĐT NCC: ${i.supplierPhone || '---'} · Kho: ${i.warehouseName || 'Tâm An Mỹ Ngãi'} · Còn nợ NCC: ${formatVND(i.debtAmount)}`,
                        badge: formatVND(i.totalCost),
                        keywords: `${i.receiptCode} ${i.supplierName} ${i.supplierPhone} ${i.productName} ${i.warehouseName || ''}`,
                      }))
                }
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="vc-code" className="block text-xs font-semibold text-slate-700 mb-1">
                  Mã phiếu in (Tự sinh nếu để trống)
                </label>
                <input
                  id="vc-code"
                  type="text"
                  value={voucherCode}
                  onChange={(e) => setVoucherCode(e.target.value)}
                  placeholder="VD: HD-001 / PT-001"
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                />
              </div>

              {(activeVoucher === 'customer_receipt' || activeVoucher === 'supplier_payment') && (
                <div>
                  <label htmlFor="vc-ref" className="block text-xs font-semibold text-slate-700 mb-1">
                    Theo mã Hóa đơn / Phiếu nhập gốc (Gõ để tìm nhanh)
                  </label>
                  <AutocompleteTextInput
                    id="vc-ref"
                    value={refCode}
                    onChange={setRefCode}
                    placeholder="Gõ mã hóa đơn hoặc tên đối tác để chọn nhanh"
                    suggestions={
                      activeVoucher === 'customer_receipt'
                        ? sales.map((s) => ({
                            value: s.id,
                            label: s.invoiceCode,
                            subLabel: `${s.customerName} · Nợ: ${formatVND(s.debtAmount || s.totalAmount)}`,
                            badge: formatVND(s.debtAmount || s.totalAmount),
                            keywords: `${s.customerName} ${s.customerPhone} ${s.productName}`,
                          }))
                        : imports.map((i) => ({
                            value: i.id,
                            label: i.receiptCode,
                            subLabel: `${i.supplierName} · Nợ NCC: ${formatVND(i.debtAmount || i.totalCost)}`,
                            badge: formatVND(i.debtAmount || i.totalCost),
                            keywords: `${i.supplierName} ${i.supplierPhone} ${i.productName}`,
                          }))
                    }
                    onSelectSuggestion={(item) => handleQuickFill(item.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="vc-partner" className="block text-xs font-semibold text-slate-700 mb-1">
                  {activeVoucher === 'sale_invoice' || activeVoucher === 'customer_receipt'
                    ? 'Họ tên Khách hàng *'
                    : 'Tên Nhà cung cấp *'}
                </label>
                <AutocompleteTextInput
                  id="vc-partner"
                  required
                  value={partnerName}
                  onChange={setPartnerName}
                  placeholder={
                    activeVoucher === 'sale_invoice' || activeVoucher === 'customer_receipt'
                      ? 'Gõ tên hoặc SĐT khách hàng để hiện gợi ý nhanh...'
                      : 'Gõ tên hoặc SĐT nhà cung cấp để hiện gợi ý nhanh...'
                  }
                  suggestions={
                    activeVoucher === 'sale_invoice' || activeVoucher === 'customer_receipt'
                      ? customers.map((c) => ({
                          value: c.id,
                          label: c.name,
                          subLabel: `SĐT: ${c.phone} · ${c.group} · ${c.address}`,
                          badge: c.code,
                          keywords: `${c.phone} ${c.code} ${c.address} ${c.group}`,
                        }))
                      : Array.from(
                          new Map(
                            imports.map((i) => [
                              i.supplierName,
                              {
                                value: i.id,
                                label: i.supplierName,
                                subLabel: `SĐT NCC: ${i.supplierPhone} · SP gần nhất: ${i.productName}`,
                                badge: i.receiptCode,
                                keywords: `${i.supplierPhone} ${i.productName}`,
                              },
                            ])
                          ).values()
                        )
                  }
                  onSelectSuggestion={(item) => {
                    if (activeVoucher === 'sale_invoice' || activeVoucher === 'customer_receipt') {
                      const foundCust = customers.find((c) => c.id === item.value);
                      if (foundCust) {
                        setPartnerName(foundCust.name);
                        setPartnerPhone(foundCust.phone);
                        setPartnerAddress(foundCust.address);
                      }
                    } else {
                      const foundImp = imports.find((i) => i.id === item.value);
                      if (foundImp) {
                        setPartnerName(foundImp.supplierName);
                        setPartnerPhone(foundImp.supplierPhone);
                      }
                    }
                  }}
                />
              </div>
              <div>
                <label htmlFor="vc-phone" className="block text-xs font-semibold text-slate-700 mb-1">
                  Số điện thoại liên hệ
                </label>
                <input
                  id="vc-phone"
                  type="tel"
                  value={partnerPhone}
                  onChange={(e) => setPartnerPhone(e.target.value)}
                  placeholder="VD: 0913..."
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                />
              </div>
            </div>

            {(activeVoucher === 'sale_invoice' || activeVoucher === 'customer_receipt') && (
              <div>
                <label htmlFor="vc-address" className="block text-xs font-semibold text-slate-700 mb-1">
                  Địa chỉ khách hàng
                </label>
                <input
                  id="vc-address"
                  type="text"
                  value={partnerAddress}
                  onChange={(e) => setPartnerAddress(e.target.value)}
                  placeholder="VD: Ấp 3, Xã Tân Thạnh, Tháp Mười..."
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                />
              </div>
            )}

            {(activeVoucher === 'sale_invoice' || activeVoucher === 'import_receipt') && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <label htmlFor="vc-product" className="block text-xs font-semibold text-slate-700 mb-1">
                      Tên vật tư nông nghiệp *
                    </label>
                    <AutocompleteTextInput
                      id="vc-product"
                      required
                      value={productName}
                      onChange={(val) => {
                        setProductName(val);
                        const matched = products.find(
                          (p) => p.name.toLowerCase() === val.trim().toLowerCase()
                        );
                        if (matched) {
                          setUnit(matched.unit);
                          setUnitPrice(
                            String(
                              activeVoucher === 'sale_invoice'
                                ? matched.sellPrice
                                : matched.importPrice
                            )
                          );
                        }
                      }}
                      placeholder="Gõ tên vật tư, mã VT hoặc hoạt chất để chọn nhanh..."
                      suggestions={products.map((p) => ({
                        value: p.id,
                        label: p.name,
                        subLabel: `Mã: ${p.code} · Tồn: ${p.stock} ${p.unit} · Kho: ${p.warehouseName || 'Tâm An Mỹ Ngãi'}`,
                        badge: formatVND(
                          activeVoucher === 'sale_invoice' ? p.sellPrice : p.importPrice
                        ),
                        keywords: `${p.code} ${p.category} ${p.supplierName} ${p.warehouseName || ''}`,
                      }))}
                      onSelectSuggestion={(item) => {
                        const matched = products.find((p) => p.id === item.value);
                        if (matched) {
                          setProductName(matched.name);
                          setUnit(matched.unit);
                          setUnitPrice(
                            String(
                              activeVoucher === 'sale_invoice'
                                ? matched.sellPrice
                                : matched.importPrice
                            )
                          );
                        }
                      }}
                    />
                  </div>
                  <div>
                    <label htmlFor="vc-unit" className="block text-xs font-semibold text-slate-700 mb-1">
                      Đơn vị tính *
                    </label>
                    <input
                      id="vc-unit"
                      type="text"
                      required
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                      placeholder="CẶP / Bao 50kg"
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label htmlFor="vc-qty" className="block text-xs font-semibold text-slate-700 mb-1">
                      Số lượng *
                    </label>
                    <input
                      id="vc-qty"
                      type="number"
                      min={1}
                      required
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      placeholder="0"
                      className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label htmlFor="vc-price" className="block text-xs font-semibold text-slate-700 mb-1">
                      Đơn giá (VNĐ) *
                    </label>
                    <input
                      id="vc-price"
                      type="number"
                      min={0}
                      required
                      value={unitPrice}
                      onChange={(e) => setUnitPrice(e.target.value)}
                      placeholder="0"
                      className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                    />
                  </div>
                  <div>
                    <label htmlFor="vc-paid" className="block text-xs font-semibold text-slate-700 mb-1">
                      Đã thanh toán (VNĐ)
                    </label>
                    <input
                      id="vc-paid"
                      type="number"
                      min={0}
                      value={paidOrCollected}
                      onChange={(e) => setPaidOrCollected(e.target.value)}
                      placeholder="0"
                      className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                    />
                  </div>
                </div>
              </>
            )}

            {(activeVoucher === 'customer_receipt' || activeVoucher === 'supplier_payment') && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="vc-prevdebt" className="block text-xs font-semibold text-slate-700 mb-1">
                    Dư nợ trước khi thu/trả (VNĐ) *
                  </label>
                  <input
                    id="vc-prevdebt"
                    type="number"
                    min={0}
                    required
                    value={previousDebt}
                    onChange={(e) => setPreviousDebt(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="vc-collected" className="block text-xs font-semibold text-slate-700 mb-1">
                    Số tiền thu/trả kỳ này (VNĐ) *
                  </label>
                  <input
                    id="vc-collected"
                    type="number"
                    min={1000}
                    required
                    value={paidOrCollected}
                    onChange={(e) => setPaidOrCollected(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="vc-method" className="block text-xs font-semibold text-slate-700 mb-1">
                    Hình thức thanh toán
                  </label>
                  <input
                    id="vc-method"
                    type="text"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                  />
                </div>
              </div>
            )}

            <div className="space-y-3">
              {(activeVoucher === 'sale_invoice' || activeVoucher === 'import_receipt') && (
                <div className="space-y-2 p-3 bg-amber-50/40 rounded-lg border border-amber-200/80">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="vc-debt-days" className="block text-xs font-semibold text-slate-700 mb-1">
                        Chọn ngày nợ (Tự động nhảy ngày)
                      </label>
                      <select
                        id="vc-debt-days"
                        value={matchDebtTermDays(dueDate)}
                        onChange={(e) => {
                          const days = Number(e.target.value);
                          if (days > 0) {
                            setDueDate(computeDueDateAfterDays(days));
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
                      <label htmlFor="vc-duedate" className="block text-xs font-semibold text-slate-700 mb-1">
                        Hạn hẹn thanh toán nợ (nếu còn nợ)
                      </label>
                      <input
                        id="vc-duedate"
                        type="date"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-5 gap-1.5">
                    {DEBT_TERM_DAY_OPTIONS.map((days) => {
                      const targetDate = computeDueDateAfterDays(days);
                      const isSelected = dueDate === targetDate;
                      return (
                        <button
                          key={days}
                          type="button"
                          onClick={() => setDueDate(targetDate)}
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
                </div>
              )}
              <div>
                <label htmlFor="vc-note" className="block text-xs font-semibold text-slate-700 mb-1">
                  Ghi chú / Diễn giải trên phiếu in
                </label>
                <input
                  id="vc-note"
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Nhập ghi chú in trên phiếu PDF..."
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3 px-4 text-sm font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <FileDown className="w-4 h-4" />
              <span>Xuất & Tải Phiếu</span>
            </button>
          </form>
        </div>

        {/* Right: Live Printable Voucher Preview */}
        <div className="xl:col-span-6 bg-white rounded-xl border border-slate-200 p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-200 pb-4">
            <div className="flex items-center gap-3">
              <img
                src="/assets/logo-taman.png?v=3"
                alt="Logo VTNN Tâm An"
                className="w-12 h-12 rounded-lg object-contain border border-slate-200 p-0.5"
              />
              <div>
                <div className="text-sm font-bold text-emerald-800">
                  CỬA HÀNG VẬT TƯ NÔNG NGHIỆP TÂM AN
                </div>
                <div className="text-xs text-slate-500">
                  Vật tư Tâm An - Nhà Nông an tâm
                </div>
              </div>
            </div>
          </div>

          <div className="text-center py-2">
            <h4 className="text-base font-bold text-slate-900 uppercase">
              {activeVoucher === 'sale_invoice'
                ? 'PHIẾU HÓA ĐƠN BÁN HÀNG'
                : activeVoucher === 'customer_receipt'
                ? 'PHIẾU THU TIỀN KHÁCH HÀNG'
                : activeVoucher === 'supplier_payment'
                ? 'PHIẾU THANH TOÁN TIỀN NHÀ CUNG CẤP'
                : 'PHIẾU NHẬP KHO VẬT TƯ NÔNG NGHIỆP'}
            </h4>
            <p className="text-xs font-mono text-slate-500 mt-0.5">
              Mã phiếu: {voucherCode || '(Tự động cấp khi xuất)'} · Ngày lập: {todayDateStr}
            </p>
          </div>

          <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1.5">
            <div>
              <span className="text-slate-500">Đối tác / Khách hàng: </span>
              <strong className="text-slate-900">{partnerName || '---'}</strong>
            </div>
            <div>
              <span className="text-slate-500">Số điện thoại: </span>
              <span className="font-mono text-slate-800">{partnerPhone || '---'}</span>
            </div>
            {(activeVoucher === 'sale_invoice' || activeVoucher === 'import_receipt') && (
              <div>
                <span className="text-slate-500">Vật tư: </span>
                <strong className="text-slate-900">{productName || '---'}</strong> (
                <span className="font-mono">
                  {qtyNum} {unit || 'Đơn vị'} × {formatVND(priceNum)}
                </span>
                )
              </div>
            )}
            <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
              <span className="font-semibold text-slate-700">
                {activeVoucher === 'sale_invoice' || activeVoucher === 'import_receipt'
                  ? 'Tổng thành tiền:'
                  : 'Dư nợ trước thu/trả:'}
              </span>
              <span className="font-mono font-bold text-sm text-slate-900">
                {formatVND(
                  activeVoucher === 'sale_invoice' || activeVoucher === 'import_receipt'
                    ? computedTotal
                    : prevDebtNum
                )}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Số tiền thanh toán đợt này:</span>
              <span className="font-mono font-bold text-emerald-700">{formatVND(paidNum)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600">Công nợ còn lại:</span>
              <span className="font-mono font-bold text-red-600">{formatVND(remainingDebt)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-4 text-center text-xs text-slate-600">
            <div>
              <div className="font-bold text-slate-900">
                {activeVoucher === 'sale_invoice' || activeVoucher === 'customer_receipt'
                  ? 'KHÁCH HÀNG'
                  : 'ĐẠI DIỆN NHÀ CUNG CẤP'}
              </div>
              <div className="text-[11px] text-slate-400">(Ký, ghi rõ họ tên)</div>
              <div className="mt-8 font-semibold text-slate-800">{partnerName}</div>
            </div>
            <div>
              <div className="font-bold text-slate-900">VTNN TÂM AN</div>
              <div className="text-[11px] text-slate-400">(Ký, ghi rõ họ tên)</div>
              <div className="mt-8 font-semibold text-slate-800">
                {currentStaffName.replace(/\s*\(.*?\)\s*/g, '').trim()}
              </div>
            </div>
          </div>

          {lastExportedPreview && (
            <div className="pt-4 border-t border-slate-200 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-emerald-800 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" />
                  <span>Bản PDF A4 Tiếng Việt Có Dấu Vừa Xuất: {lastExportedPreview.fileName}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setLastExportedPreview(null)}
                  className="text-slate-500 hover:text-slate-800 font-semibold"
                >
                  Ẩn ảnh PDF
                </button>
              </div>
              <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50 p-2">
                <img
                  src={lastExportedPreview.dataUrl}
                  alt={lastExportedPreview.fileName}
                  className="w-full h-auto rounded shadow-xs border border-slate-200"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Saved Vouchers & Receipts History Table with Manager-Only Inline Edit & Delete */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-2 bg-slate-50/60">
          <h3 className="text-base font-bold text-slate-900">
            Danh Sách Hóa Đơn, Chứng Từ & Phiếu Thu Đã Lưu ({savedVouchers.length} chứng từ)
          </h3>
        </div>

        {/* Mobile Card View (< md): Full-width balanced layout */}
        <div className="md:hidden divide-y divide-slate-200">
          {savedVouchers.length === 0 ? (
            <div className="py-10 px-4 text-center text-xs text-slate-500">
              Chưa có chứng từ nào được lưu.
            </div>
          ) : (
            savedVouchers.map((vc) => {
              const typeLabel =
                vc.voucherType === 'sale_invoice'
                  ? 'Hóa đơn bán hàng'
                  : vc.voucherType === 'customer_receipt'
                  ? 'Phiếu thu tiền KH'
                  : vc.voucherType === 'supplier_payment'
                  ? 'Phiếu thanh toán NCC'
                  : 'Phiếu nhập kho';
              return (
                <div key={vc.id} className="p-4 space-y-3 hover:bg-slate-50">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono text-xs font-bold text-slate-900">
                        {vc.voucherCode}
                      </div>
                      <div className="text-xs text-emerald-800 font-medium mt-0.5">{typeLabel}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="inline-block px-2 py-0.5 text-[11px] font-semibold bg-slate-100 text-slate-800 rounded-md">
                        {vc.warehouseName || 'Tâm An Mỹ Ngãi'}
                      </span>
                      <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                        {vc.createdAt.slice(0, 10)}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-slate-500">Đối tác / Khách hàng:</div>
                    <div className="text-sm font-bold text-slate-900">{vc.partnerName}</div>
                    <div className="text-xs text-slate-500">
                      <span className="font-mono">{vc.partnerPhone}</span>
                      {vc.note ? ` · ${vc.note}` : ''}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-xs">
                    <div>
                      <div className="text-[11px] text-slate-500">Tổng / Nợ gốc</div>
                      <div className="font-mono tabular-nums font-semibold text-slate-800 mt-0.5">
                        {formatVND(vc.totalOrPrevDebt)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Thu / Trả</div>
                      <div className="font-mono tabular-nums font-semibold text-emerald-700 mt-0.5">
                        {formatVND(vc.paidOrCollected)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] text-slate-500">Còn nợ</div>
                      <div className="font-mono tabular-nums font-bold text-red-600 mt-0.5">
                        {formatVND(vc.remainingDebt)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-1.5 pt-0.5">
                    {canPerformRoleAction(role, 'edit_record') ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleLoadSavedVoucherForEdit(vc)}
                          aria-label={`Sửa chứng từ ${vc.voucherCode}`}
                          className="px-3 py-1.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-md flex items-center gap-1 whitespace-nowrap"
                        >
                          <Pencil className="w-3 h-3" />
                          <span>Sửa ngay</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteVoucher(vc.id)}
                          aria-label={`Xóa chứng từ ${vc.voucherCode}`}
                          className="p-1.5 text-slate-400 hover:text-red-600 rounded-md border border-slate-200"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <span
                        title="Chỉ Quản lý mới có quyền sửa hoặc xóa chứng từ đã lưu"
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
          <table className="w-full min-w-[900px] text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                <th className="py-3 px-3.5 w-[145px] whitespace-nowrap">Mã chứng từ & Loại phiếu</th>
                <th className="py-3 px-3.5 w-[125px] whitespace-nowrap">Kho & Ngày lập</th>
                <th className="py-3 px-3.5 min-w-[200px]">Khách hàng / Nhà cung cấp</th>
                <th className="py-3 px-3.5 w-[130px] text-right whitespace-nowrap">Tổng tiền / Dư nợ gốc</th>
                <th className="py-3 px-3.5 w-[120px] text-right whitespace-nowrap">Thu / Trả đợt này</th>
                <th className="py-3 px-3.5 w-[115px] text-right whitespace-nowrap">Còn nợ</th>
                <th className="py-3 px-3.5 w-[135px] text-right whitespace-nowrap">
                  In PDF / Sửa & Xóa (Quản lý)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {savedVouchers.map((vc) => {
                const typeLabel =
                  vc.voucherType === 'sale_invoice'
                    ? 'Hóa đơn bán hàng'
                    : vc.voucherType === 'customer_receipt'
                    ? 'Phiếu thu tiền KH'
                    : vc.voucherType === 'supplier_payment'
                    ? 'Phiếu thanh toán NCC'
                    : 'Phiếu nhập kho';
                return (
                  <tr key={vc.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 whitespace-nowrap align-middle">
                      <div className="font-mono text-xs font-bold text-slate-900">
                        {vc.voucherCode}
                      </div>
                      <div className="text-xs text-emerald-800 font-medium mt-0.5">{typeLabel}</div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap align-middle">
                      <div className="text-xs font-semibold text-slate-800">
                        {vc.warehouseName || 'Tâm An Mỹ Ngãi'}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500">
                        {vc.createdAt.slice(0, 10)}
                      </div>
                    </td>
                    <td className="py-3 px-4 min-w-[220px] align-middle">
                      <div className="font-semibold text-slate-900 leading-snug">{vc.partnerName}</div>
                      <div className="text-xs text-slate-500 mt-0.5 leading-snug">
                        <span className="font-mono">{vc.partnerPhone}</span>
                        {vc.note ? ` · ${vc.note}` : ''}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-800 whitespace-nowrap align-middle">
                      {formatVND(vc.totalOrPrevDebt)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-xs font-semibold text-emerald-700 whitespace-nowrap align-middle">
                      {formatVND(vc.paidOrCollected)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-xs font-bold text-red-600 whitespace-nowrap align-middle">
                      {formatVND(vc.remainingDebt)}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap align-middle">
                      <div className="flex items-center justify-end gap-1.5">
                        {canPerformRoleAction(role, 'edit_record') ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleLoadSavedVoucherForEdit(vc)}
                              aria-label={`Sửa chứng từ ${vc.voucherCode}`}
                              className="px-2.5 py-1 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-md flex items-center gap-1 whitespace-nowrap"
                            >
                              <Pencil className="w-3 h-3" />
                              <span>Sửa ngay</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteVoucher(vc.id)}
                              aria-label={`Xóa chứng từ ${vc.voucherCode}`}
                              className="p-1.5 text-slate-400 hover:text-red-600 rounded-md"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <span
                            title="Chỉ Quản lý mới có quyền sửa hoặc xóa chứng từ đã lưu"
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
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

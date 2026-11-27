import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Link2,
  ShieldAlert,
  Trash2,
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
} from '../types';
import {
  diagnoseImportVoucher,
  diagnoseSaleVoucher,
  formatVND,
} from '../utils/businessLogic';

export type CrossLinkChipTone =
  | 'emerald'
  | 'amber'
  | 'sky'
  | 'indigo'
  | 'rose'
  | 'slate';

const TONE_CLASSES: Record<CrossLinkChipTone, string> = {
  emerald:
    'bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border-emerald-200',
  amber: 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-200',
  sky: 'bg-sky-50 hover:bg-sky-100 text-sky-900 border-sky-200',
  indigo: 'bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border-indigo-200',
  rose: 'bg-rose-50 hover:bg-rose-100 text-rose-800 border-rose-200',
  slate: 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200',
};

export const CrossLinkChip: React.FC<{
  label: string;
  tone?: CrossLinkChipTone;
  title?: string;
  onClick: () => void;
}> = ({ label, tone = 'emerald', title, onClick }) => (
  <button
    type="button"
    title={title || `Bấm để mở chứng từ liên kết: ${label}`}
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-semibold rounded border transition-colors whitespace-nowrap ${TONE_CLASSES[tone]}`}
  >
    <Link2 className="w-2.5 h-2.5 shrink-0 opacity-75" />
    <span>{label}</span>
    <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-70" />
  </button>
);

export const FocusedLinkBanner: React.FC<{
  code: string;
  title: string;
  onClear: () => void;
  actions?: React.ReactNode;
}> = ({ code, title, onClear, actions }) => (
  <div className="mx-4 mt-4 p-3 rounded-xl bg-emerald-50 border-2 border-emerald-500 flex flex-wrap items-center justify-between gap-2 text-xs">
    <div className="flex items-center gap-2 min-w-0">
      <Link2 className="w-4 h-4 text-emerald-700 shrink-0" />
      <div className="min-w-0">
        <span className="font-bold text-emerald-950">Đang xem chứng từ liên kết: </span>
        <span className="font-mono font-extrabold text-emerald-800">{code}</span>
        <span className="text-emerald-900"> — {title}</span>
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
      {actions}
      <button
        type="button"
        onClick={onClear}
        className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-md inline-flex items-center gap-1"
      >
        <X className="w-3.5 h-3.5" />
        <span>Bỏ chọn</span>
      </button>
    </div>
  </div>
);

interface CancelImportConfirmModalProps {
  targetImport: ImportTransaction;
  products: ProductItem[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  paymentVouchers: CashPaymentVoucher[];
  stockAdjustments?: StockAdjustmentRecord[];
  onClose: () => void;
  onConfirmDelete: (importId: string) => void;
  onNavigateCrossLink?: (req: CrossLinkNavigateRequest) => void;
}

export const CancelImportConfirmModal: React.FC<CancelImportConfirmModalProps> = ({
  targetImport,
  products,
  sales,
  imports,
  paymentVouchers,
  stockAdjustments = [],
  onClose,
  onConfirmDelete,
  onNavigateCrossLink,
}) => {
  const diag = diagnoseImportVoucher({
    imp: targetImport,
    products,
    sales,
    imports,
    paymentVouchers,
    stockAdjustments,
  });
  const { deleteSafety, linkedProduct } = diag;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Xác nhận hủy phiếu mua hàng ${targetImport.receiptCode}`}
    >
      <div className="bg-white rounded-xl border border-slate-200 w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        <div
          className={`px-5 py-4 border-b flex items-center justify-between gap-2 ${
            deleteSafety.allowed
              ? 'bg-rose-50 border-rose-200'
              : 'bg-amber-50 border-amber-200'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {deleteSafety.allowed ? (
              <Trash2 className="w-4 h-4 text-rose-700 shrink-0" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
            )}
            <h3 className="text-sm sm:text-base font-bold text-slate-900 truncate">
              {deleteSafety.allowed
                ? `Xác Nhận Hủy Phiếu Mua Hàng (${targetImport.receiptCode})`
                : `Chưa Thể Hủy Phiếu (${targetImport.receiptCode}) — Có Chứng Từ Liên Kết`}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng hộp thoại hủy phiếu mua hàng"
            className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3.5 overflow-y-auto text-xs text-slate-700">
          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
            <div className="font-bold text-slate-900">
              {targetImport.receiptCode} — {targetImport.supplierName}
            </div>
            <div>
              Vật tư: <strong>{targetImport.productName}</strong> (+{targetImport.quantity}{' '}
              {targetImport.unit} × {formatVND(targetImport.unitCost)})
            </div>
            <div className="font-mono flex flex-wrap gap-x-3 gap-y-1">
              <span>
                Tổng tiền nhập: <strong>{formatVND(targetImport.totalCost)}</strong>
              </span>
              {targetImport.debtAmount > 0 && (
                <span className="text-red-600 font-bold">
                  Công nợ NCC sẽ xóa: {formatVND(targetImport.debtAmount)}
                </span>
              )}
            </div>
            {linkedProduct && (
              <div className="text-[11px] text-slate-600">
                Tồn kho hiện tại của vật tư: <strong className="font-mono">{linkedProduct.stock} {linkedProduct.unit}</strong> → Sau khi hủy:{' '}
                <strong className="font-mono text-emerald-800">
                  {deleteSafety.clampedNextStock} {linkedProduct.unit}
                </strong>
              </div>
            )}
          </div>

          {!deleteSafety.allowed ? (
            <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 space-y-2.5 text-rose-950">
              <div className="font-bold flex items-start gap-1.5">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{deleteSafety.message}</span>
              </div>

              {deleteSafety.blockingPaymentVouchers.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold text-rose-800">
                    Bấm để mở &amp; hủy các Phiếu chi trả nợ đang khóa phiếu này:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {deleteSafety.blockingPaymentVouchers.map((pv) => (
                      <CrossLinkChip
                        key={pv.id}
                        tone="rose"
                        label={`${pv.voucherCode} (-${formatVND(pv.amount)})`}
                        onClick={() => {
                          onClose();
                          onNavigateCrossLink?.({
                            tab: 'payment_vouchers',
                            recordId: pv.id,
                            voucherCode: pv.voucherCode,
                            label: `Phiếu chi ${pv.voucherCode}`,
                          });
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {deleteSafety.blockingSales.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold text-rose-800">
                    Bấm để mở &amp; kiểm tra các Hóa đơn bán hàng đang xuất từ lô vật tư này:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {deleteSafety.blockingSales.slice(0, 6).map((s) => (
                      <CrossLinkChip
                        key={s.id}
                        tone="amber"
                        label={`${s.invoiceCode} (${s.customerName} · -${s.quantity} ${s.unit})`}
                        onClick={() => {
                          onClose();
                          onNavigateCrossLink?.({
                            tab: 'sales',
                            recordId: s.id,
                            voucherCode: s.invoiceCode,
                            label: `Hóa đơn ${s.invoiceCode}`,
                          });
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : deleteSafety.hasStockDrift ? (
            <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-950 space-y-1.5">
              <div className="font-bold flex items-start gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <span>Đã kiểm tra đối soát chứng từ — Cho phép hủy phiếu nhập!</span>
              </div>
              <p className="leading-relaxed">{deleteSafety.message}</p>
            </div>
          ) : (
            <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-950 flex items-start gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              <span>
                Không có phiếu chi trả nợ hay hóa đơn bán hàng nào bị xung đột. Hệ thống sẽ hủy
                phiếu, cập nhật lại tồn kho, xóa công nợ NCC liên quan và đồng bộ lên Firebase Storage.
              </span>
            </div>
          )}

          {/* Quick Jump to Related Documents */}
          {onNavigateCrossLink && (
            <div className="pt-1 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500">Mở nhanh liên kết:</span>
              {linkedProduct && (
                <CrossLinkChip
                  tone="indigo"
                  label={`Thẻ kho XNT (${linkedProduct.code})`}
                  onClick={() => {
                    onClose();
                    onNavigateCrossLink({
                      tab: 'inventory',
                      recordId: linkedProduct.id,
                      label: `Thẻ kho ${linkedProduct.name}`,
                    });
                  }}
                />
              )}
              {targetImport.debtAmount > 0 && (
                <CrossLinkChip
                  tone="amber"
                  label="Công nợ NCC"
                  onClick={() => {
                    onClose();
                    onNavigateCrossLink({
                      tab: 'debts',
                      recordId: targetImport.id,
                      subTab: 'supplier',
                      label: `Công nợ ${targetImport.receiptCode}`,
                    });
                  }}
                />
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg"
          >
            Đóng
          </button>
          {deleteSafety.allowed && (
            <button
              type="button"
              onClick={() => {
                onConfirmDelete(targetImport.id);
                onClose();
              }}
              className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg inline-flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Xác nhận hủy phiếu mua hàng</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

interface CancelSaleConfirmModalProps {
  targetSale: SaleTransaction;
  products: ProductItem[];
  customers: CustomerProfile[];
  imports: ImportTransaction[];
  receiptVouchers: CashReceiptVoucher[];
  onClose: () => void;
  onConfirmDelete: (saleId: string) => void;
  onNavigateCrossLink?: (req: CrossLinkNavigateRequest) => void;
}

export const CancelSaleConfirmModal: React.FC<CancelSaleConfirmModalProps> = ({
  targetSale,
  products,
  customers,
  imports,
  receiptVouchers,
  onClose,
  onConfirmDelete,
  onNavigateCrossLink,
}) => {
  const diag = diagnoseSaleVoucher({
    sale: targetSale,
    products,
    customers,
    imports,
    receiptVouchers,
  });
  const isBlocked = diag.linkedReceiptVouchers.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Xác nhận hủy hóa đơn bán hàng ${targetSale.invoiceCode}`}
    >
      <div className="bg-white rounded-xl border border-slate-200 w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        <div
          className={`px-5 py-4 border-b flex items-center justify-between gap-2 ${
            isBlocked ? 'bg-amber-50 border-amber-200' : 'bg-rose-50 border-rose-200'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {isBlocked ? (
              <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
            ) : (
              <Trash2 className="w-4 h-4 text-rose-700 shrink-0" />
            )}
            <h3 className="text-sm sm:text-base font-bold text-slate-900 truncate">
              {isBlocked
                ? `Chưa Thể Hủy Hóa Đơn (${targetSale.invoiceCode}) — Đã Có Phiếu Thu`
                : `Xác Nhận Hủy Hóa Đơn Bán Hàng (${targetSale.invoiceCode})`}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng hộp thoại hủy hóa đơn"
            className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3.5 overflow-y-auto text-xs text-slate-700">
          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
            <div className="font-bold text-slate-900">
              {targetSale.invoiceCode} — {targetSale.customerName}
            </div>
            <div>
              Vật tư: <strong>{targetSale.productName}</strong> ({targetSale.quantity}{' '}
              {targetSale.unit} × {formatVND(targetSale.unitPrice)})
            </div>
            <div className="font-mono flex flex-wrap gap-x-3 gap-y-1">
              <span>
                Thành tiền: <strong>{formatVND(targetSale.totalAmount)}</strong>
              </span>
              <span className="text-emerald-700">
                Sẽ hoàn lại kho: +{targetSale.quantity} {targetSale.unit}
              </span>
            </div>
          </div>

          {isBlocked ? (
            <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 space-y-2 text-rose-950">
              <div className="font-bold flex items-start gap-1.5">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>
                  Hóa đơn {targetSale.invoiceCode} đã có {diag.linkedReceiptVouchers.length} phiếu
                  thu nợ liên kết. Vui lòng hủy phiếu thu trước khi sửa hoặc hủy hóa đơn!
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {diag.linkedReceiptVouchers.map((rv) => (
                  <CrossLinkChip
                    key={rv.id}
                    tone="rose"
                    label={`${rv.voucherCode} (+${formatVND(rv.amount)})`}
                    onClick={() => {
                      onClose();
                      onNavigateCrossLink?.({
                        tab: 'receipt_vouchers',
                        recordId: rv.id,
                        voucherCode: rv.voucherCode,
                        label: `Phiếu thu ${rv.voucherCode}`,
                      });
                    }}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-950 flex items-start gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              <span>
                Hóa đơn không bị khóa bởi phiếu thu nợ. Hệ thống sẽ hủy hóa đơn, hoàn lại tồn kho{' '}
                <strong>+{targetSale.quantity} {targetSale.unit}</strong>, cập nhật công nợ khách
                hàng và đồng bộ Firebase Storage.
              </span>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg"
          >
            Đóng
          </button>
          {!isBlocked && (
            <button
              type="button"
              onClick={() => {
                onConfirmDelete(targetSale.id);
                onClose();
              }}
              className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg inline-flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Xác nhận hủy hóa đơn</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

import React, { useMemo, useState } from 'react';
import { FileDown, Printer, Wallet, X } from 'lucide-react';
import type {
  AuditLogEntry,
  CashPaymentVoucher,
  CashReceiptVoucher,
  ImportTransaction,
  ProductItem,
  SaleTransaction,
} from '../types';
import {
  areWarehouseNamesEquivalent,
  computeCashflowAndFinancialReport,
  formatVND,
  getTodayVietnamDateStr,
  isContraOffsetVoucher,
} from '../utils/businessLogic';
import { computeShiftCloseSummary } from '../utils/smartInsights';

export const SHIFT_CLOSE_CODE_PREFIX = 'CHOT-CA-';

interface CashDrawerCloseModalProps {
  isOpen: boolean;
  onClose: () => void;
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  products: ProductItem[];
  receiptVouchers: CashReceiptVoucher[];
  paymentVouchers: CashPaymentVoucher[];
  warehouses: string[];
  lockedWarehouse: string | null;
  currentStaffName?: string;
  auditLogs: AuditLogEntry[];
  onSaveClose: (params: { dateStr: string; warehouse: string; summary: string; details: string }) => void;
}

export const CashDrawerCloseModal: React.FC<CashDrawerCloseModalProps> = ({
  isOpen,
  onClose,
  sales,
  imports,
  products,
  receiptVouchers,
  paymentVouchers,
  warehouses,
  lockedWarehouse,
  currentStaffName,
  auditLogs,
  onSaveClose,
}) => {
  const [dateStr, setDateStr] = useState(() => getTodayVietnamDateStr());
  const [warehouse, setWarehouse] = useState<string>(lockedWarehouse || '');
  const [openingCash, setOpeningCash] = useState('');
  const [countedCash, setCountedCash] = useState('');

  const effectiveWarehouse = lockedWarehouse || warehouse;

  const report = useMemo(
    () =>
      computeCashflowAndFinancialReport({
        sales,
        imports,
        products,
        receiptVouchers,
        paymentVouchers,
        fromDate: dateStr,
        toDate: dateStr,
        warehouseName: effectiveWarehouse || null,
      }),
    [sales, imports, products, receiptVouchers, paymentVouchers, dateStr, effectiveWarehouse]
  );

  const summary = useMemo(
    () =>
      computeShiftCloseSummary({
        salesInitialPaidInflow: report.salesInitialPaidInflow,
        importsInitialPaidOutflow: report.importsInitialPaidOutflow,
        receipts: report.filteredReceiptVouchers
          .filter((r) => !isContraOffsetVoucher(r))
          .map((r) => ({
            amount: r.amount,
            paymentMethod: r.paymentMethod,
          })),
        payments: report.filteredPaymentVouchers
          .filter((p) => !isContraOffsetVoucher(p))
          .map((p) => ({
            amount: p.amount,
            paymentMethod: p.paymentMethod,
          })),
        openingCash: Number(openingCash) || 0,
        countedCash: countedCash.trim() === '' ? null : Number(countedCash) || 0,
      }),
    [report, openingCash, countedCash]
  );

  const history = useMemo(
    () =>
      auditLogs
        .filter((l) => (l.targetCode || '').startsWith(SHIFT_CLOSE_CODE_PREFIX))
        .filter(
          (l) => !lockedWarehouse || areWarehouseNamesEquivalent(l.warehouseName, lockedWarehouse)
        )
        .slice(0, 8),
    [auditLogs, lockedWarehouse]
  );

  if (!isOpen) return null;

  const whLabel = effectiveWarehouse || 'Tất cả kho';

  const handleSave = () => {
    const diffText =
      summary.difference === null
        ? 'chưa đếm tiền'
        : summary.difference === 0
        ? 'khớp'
        : summary.difference > 0
        ? `thừa ${formatVND(summary.difference)}`
        : `thiếu ${formatVND(Math.abs(summary.difference))}`;
    onSaveClose({
      dateStr,
      warehouse: whLabel,
      summary: `Chốt ca ${dateStr} (${whLabel}): tiền mặt dự kiến ${formatVND(summary.expectedCash)}, ${diffText}`,
      details: [
        `Tiền đầu ca: ${formatVND(Number(openingCash) || 0)}`,
        `Thu tiền mặt: ${formatVND(summary.cashIn)} · Chi tiền mặt: ${formatVND(summary.cashOut)}`,
        `Thu không tiền mặt: ${formatVND(summary.nonCashIn)} · Chi không tiền mặt: ${formatVND(summary.nonCashOut)}`,
        `Tiền mặt dự kiến: ${formatVND(summary.expectedCash)}`,
        summary.difference === null
          ? 'Thực đếm: chưa nhập'
          : `Thực đếm: ${formatVND(Number(countedCash) || 0)} (${diffText})`,
        `Doanh thu thuần trong ngày: ${formatVND(report.netSalesRevenue)}`,
      ].join(' · '),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Chốt ca cuối ngày"
    >
      <div className="bg-white rounded-2xl border border-emerald-200 shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-4 bg-emerald-50/90 border-b border-emerald-200 flex items-center justify-between gap-2 sticky top-0">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Wallet className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>Chốt ca cuối ngày</span>
            </h3>
            <p className="text-[11px] text-emerald-900 mt-0.5">
              Đối chiếu tiền mặt thực đếm với số liệu hệ thống trong ngày
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 rounded-lg" aria-label="Đóng">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3.5 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="shift-date" className="block font-semibold text-slate-700 mb-1">
                Ngày chốt
              </label>
              <input
                id="shift-date"
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="shift-warehouse" className="block font-semibold text-slate-700 mb-1">
                Kho
              </label>
              {lockedWarehouse ? (
                <div className="px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg">{lockedWarehouse}</div>
              ) : (
                <select
                  id="shift-warehouse"
                  value={warehouse}
                  onChange={(e) => setWarehouse(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                >
                  <option value="">Tất cả kho</option>
                  {warehouses.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="p-2.5 rounded-lg border border-emerald-200 bg-emerald-50/60">
              <div className="text-[11px] text-slate-500">Thu tiền mặt</div>
              <div className="font-mono font-bold text-emerald-800">{formatVND(summary.cashIn)}</div>
              <div className="text-[10px] text-slate-500">
                {report.salesInitialPaidInflow > 0
                  ? `gồm đơn cũ chưa tách phiếu ${formatVND(report.salesInitialPaidInflow)}`
                  : 'gồm thu tại đơn & phiếu thu tiền mặt'}
              </div>
            </div>
            <div className="p-2.5 rounded-lg border border-rose-200 bg-rose-50/60">
              <div className="text-[11px] text-slate-500">Chi tiền mặt</div>
              <div className="font-mono font-bold text-rose-800">{formatVND(summary.cashOut)}</div>
              <div className="text-[10px] text-slate-500">
                {report.importsInitialPaidOutflow > 0
                  ? `gồm phiếu nhập cũ chưa tách phiếu ${formatVND(report.importsInitialPaidOutflow)}`
                  : 'gồm chi tại phiếu nhập & phiếu chi tiền mặt'}
              </div>
            </div>
            <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50">
              <div className="text-[11px] text-slate-500">Thu không tiền mặt (CK…)</div>
              <div className="font-mono font-bold text-slate-800">{formatVND(summary.nonCashIn)}</div>
            </div>
            <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50">
              <div className="text-[11px] text-slate-500">Chi không tiền mặt (CK…)</div>
              <div className="font-mono font-bold text-slate-800">{formatVND(summary.nonCashOut)}</div>
            </div>
          </div>

          {(Object.keys(summary.byMethodIn).length > 0 || Object.keys(summary.byMethodOut).length > 0) && (
            <div className="p-2.5 rounded-lg border border-slate-200 text-[11px] text-slate-600 space-y-0.5">
              {Object.entries(summary.byMethodIn).map(([m, v]) => (
                <div key={`in-${m}`} className="flex justify-between">
                  <span>Phiếu thu · {m}</span>
                  <span className="font-mono">{formatVND(v)}</span>
                </div>
              ))}
              {Object.entries(summary.byMethodOut).map(([m, v]) => (
                <div key={`out-${m}`} className="flex justify-between">
                  <span>Phiếu chi · {m}</span>
                  <span className="font-mono">{formatVND(v)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="shift-opening" className="block font-semibold text-slate-700 mb-1">
                Tiền mặt đầu ca (VNĐ)
              </label>
              <input
                id="shift-opening"
                type="number"
                min={0}
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="shift-counted" className="block font-semibold text-slate-700 mb-1">
                Tiền mặt thực đếm (VNĐ)
              </label>
              <input
                id="shift-counted"
                type="number"
                min={0}
                value={countedCash}
                onChange={(e) => setCountedCash(e.target.value)}
                placeholder="Nhập số tiền đếm được"
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
              />
            </div>
          </div>

          <div
            className={`p-3 rounded-lg border font-mono ${
              summary.difference === null
                ? 'bg-slate-50 border-slate-200 text-slate-700'
                : summary.difference === 0
                ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                : 'bg-amber-50 border-amber-300 text-amber-900'
            }`}
          >
            <div className="flex justify-between">
              <span className="font-sans font-semibold">Tiền mặt dự kiến cuối ca:</span>
              <strong>{formatVND(summary.expectedCash)}</strong>
            </div>
            <div className="flex justify-between mt-1">
              <span className="font-sans font-semibold">Chênh lệch (đếm − dự kiến):</span>
              <strong>
                {summary.difference === null
                  ? '— chưa đếm'
                  : summary.difference === 0
                  ? 'Khớp'
                  : `${summary.difference > 0 ? '+' : '−'}${formatVND(Math.abs(summary.difference))}`}
              </strong>
            </div>
            <div className="text-[10px] text-slate-500 font-sans mt-1">
              Doanh thu thuần trong ngày: {formatVND(report.netSalesRevenue)} · Tự động tách riêng Tiền mặt & Chuyển
              khoản theo phương thức trên đơn/phiếu.
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={async () => {
                  const { exportShiftCloseReportPDF } = await import('../utils/exportReports');
                  exportShiftCloseReportPDF({
                    format: 'k80',
                    dateStr,
                    warehouseName: whLabel,
                    staffName: currentStaffName,
                    openingCash: Number(openingCash) || 0,
                    cashIn: summary.cashIn,
                    salesInitialPaidInflow: report.salesInitialPaidInflow,
                    cashOut: summary.cashOut,
                    importsInitialPaidOutflow: report.importsInitialPaidOutflow,
                    nonCashIn: summary.nonCashIn,
                    nonCashOut: summary.nonCashOut,
                    expectedCash: summary.expectedCash,
                    countedCash: countedCash.trim() === '' ? null : Number(countedCash) || 0,
                    difference: summary.difference,
                    netSalesRevenue: report.netSalesRevenue,
                    byMethodIn: summary.byMethodIn,
                    byMethodOut: summary.byMethodOut,
                  });
                }}
                className="px-3 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg inline-flex items-center gap-1"
              >
                <Printer className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                <span>In K80</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  const { exportShiftCloseReportPDF } = await import('../utils/exportReports');
                  exportShiftCloseReportPDF({
                    format: 'a5',
                    dateStr,
                    warehouseName: whLabel,
                    staffName: currentStaffName,
                    openingCash: Number(openingCash) || 0,
                    cashIn: summary.cashIn,
                    salesInitialPaidInflow: report.salesInitialPaidInflow,
                    cashOut: summary.cashOut,
                    importsInitialPaidOutflow: report.importsInitialPaidOutflow,
                    nonCashIn: summary.nonCashIn,
                    nonCashOut: summary.nonCashOut,
                    expectedCash: summary.expectedCash,
                    countedCash: countedCash.trim() === '' ? null : Number(countedCash) || 0,
                    difference: summary.difference,
                    netSalesRevenue: report.netSalesRevenue,
                    byMethodIn: summary.byMethodIn,
                    byMethodOut: summary.byMethodOut,
                  });
                }}
                className="px-3 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg inline-flex items-center gap-1"
              >
                <FileDown className="w-3.5 h-3.5 shrink-0" />
                <span>Biên bản A5</span>
              </button>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <button type="button" onClick={onClose} className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg">
                Đóng
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
              >
                Lưu chốt ca
              </button>
            </div>
          </div>

          {history.length > 0 && (
            <div className="pt-2 border-t border-slate-200">
              <div className="font-bold text-slate-700 mb-1">Lịch sử chốt ca gần đây</div>
              <ul className="space-y-1">
                {history.map((h) => (
                  <li key={h.id} className="text-[11px] text-slate-600 leading-snug">
                    <span className="font-mono text-slate-500">
                      {new Date(h.timestamp).toLocaleString('vi-VN')}
                    </span>{' '}
                    — {h.actionTitle}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

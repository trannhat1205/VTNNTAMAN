import React, { useMemo, useState } from 'react';
import { BookOpen, Calendar, ExternalLink, FileSpreadsheet, FileText, Search } from 'lucide-react';
import type { CashPaymentVoucher, CashReceiptVoucher, SaleTransaction } from '../types';
import {
  formatVND,
  getCurrentMonthRangeVietnam,
  getCurrentQuarterRangeVietnam,
  getRecentDaysRangeVietnam,
  getTodayVietnamDateStr,
  normalizeVietnameseSearch,
  type ProvisionalCashbookProfitSummary,
} from '../utils/businessLogic';

type CashbookSubTab = 'all_sales' | 'promo_discount' | 'other_receipts' | 'other_expenses';

interface WarehouseCashbookReportPanelProps {
  warehouseLabel: string;
  fromDate: string;
  toDate: string;
  onChangeDateRange: (from: string, to: string) => void;
  searchQuery: string;
  onChangeSearchQuery: (q: string) => void;
  summary: ProvisionalCashbookProfitSummary;
  onExportExcel: () => void;
  onExportPDF: () => void;
  onSelectSale?: (sale: SaleTransaction) => void;
  onNavigateToModule?: (tab: 'sales' | 'receipt_vouchers' | 'payment_vouchers') => void;
}

export const WarehouseCashbookReportPanel: React.FC<WarehouseCashbookReportPanelProps> = ({
  warehouseLabel,
  fromDate,
  toDate,
  onChangeDateRange,
  searchQuery,
  onChangeSearchQuery,
  summary,
  onExportExcel,
  onExportPDF,
  onSelectSale,
  onNavigateToModule,
}) => {
  const [subTab, setSubTab] = useState<CashbookSubTab>('all_sales');

  const todayStr = getTodayVietnamDateStr();
  const recent7 = useMemo(() => getRecentDaysRangeVietnam(7), []);
  const month = useMemo(() => getCurrentMonthRangeVietnam(), []);
  const quarter = useMemo(() => getCurrentQuarterRangeVietnam(), []);

  const presets = [
    { label: 'Hôm nay', from: todayStr, to: todayStr },
    { label: '7 ngày gần nhất', from: recent7.from, to: recent7.to },
    { label: 'Tháng này', from: month.from, to: month.to },
    { label: 'Quý này', from: quarter.from, to: quarter.to },
    { label: 'Toàn bộ lịch sử', from: '2020-01-01', to: '2035-12-31' },
  ];

  const q = normalizeVietnameseSearch(searchQuery);
  const matches = (text: string) => !q || normalizeVietnameseSearch(text).includes(q);

  const saleRows = useMemo(
    () =>
      summary.saleRows.filter((r) =>
        matches(`${r.sale.invoiceCode} ${r.sale.customerName} ${r.sale.productName}`)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [summary.saleRows, q]
  );
  const promoRows = useMemo(
    () =>
      summary.promoOrDiscountRows.filter((r) =>
        matches(`${r.sale.invoiceCode} ${r.sale.customerName} ${r.sale.productName}`)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [summary.promoOrDiscountRows, q]
  );
  const receiptRows = useMemo(
    () =>
      summary.otherIncomeVouchers.filter((rv: CashReceiptVoucher) =>
        matches(`${rv.voucherCode} ${rv.partnerName} ${rv.groupName} ${rv.note}`)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [summary.otherIncomeVouchers, q]
  );
  const expenseRows = useMemo(
    () =>
      summary.otherExpenseVouchers.filter((pv: CashPaymentVoucher) =>
        matches(`${pv.voucherCode} ${pv.partnerName} ${pv.groupName} ${pv.note}`)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [summary.otherExpenseVouchers, q]
  );

  const expenseGroupChips = useMemo(() => {
    const map = new Map<string, number>();
    for (const pv of summary.otherExpenseVouchers) {
      const g = (pv.groupName || 'Chi phí khác').trim();
      map.set(g, (map.get(g) || 0) + pv.amount);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [summary.otherExpenseVouchers]);

  const profit = summary.provisionalNetProfit;

  const kpiCards: Array<{
    key: CashbookSubTab;
    title: string;
    value: string;
    sub: string;
    tone: string;
  }> = [
    {
      key: 'all_sales',
      title: '(+) Doanh thu bán hàng (trước CK)',
      value: `+${formatVND(summary.grossSalesRevenue)}`,
      sub: `Thuần sau CK: ${formatVND(summary.netSalesRevenue)} · ${summary.saleRows.length} dòng HĐ`,
      tone: 'text-emerald-800',
    },
    {
      key: 'other_receipts',
      title: '(+) Phiếu thu khác',
      value: `+${formatVND(summary.otherIncomeReceipts)}`,
      sub: `${summary.otherIncomeVouchers.length} phiếu thu`,
      tone: 'text-emerald-800',
    },
    {
      key: 'all_sales',
      title: '(−) Giá vốn hàng bán',
      value: `−${formatVND(summary.productCogs)}`,
      sub: 'Giá vốn bình quân xuất kho',
      tone: 'text-rose-700',
    },
    {
      key: 'promo_discount',
      title: '(−) Chiết khấu / Giảm giá',
      value: `−${formatVND(summary.discountCost)}`,
      sub: 'Giảm trừ trực tiếp trên hóa đơn',
      tone: 'text-rose-700',
    },
    {
      key: 'promo_discount',
      title: '(−) Chi phí quà tặng KM',
      value: `−${formatVND(summary.giftPromoCost)}`,
      sub: 'Giá vốn hàng tặng kèm',
      tone: 'text-rose-700',
    },
    {
      key: 'other_expenses',
      title: '(−) Chi phí khác (Phiếu chi)',
      value: `−${formatVND(summary.otherOperatingExpenses)}`,
      sub: `${summary.otherExpenseVouchers.length} phiếu chi vận hành / khác`,
      tone: 'text-rose-700',
    },
  ];

  const renderSaleTable = (rows: typeof saleRows) => (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[900px] text-left border-collapse text-xs">
        <thead>
          <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-800">
            <th className="py-2.5 px-3">Ngày</th>
            <th className="py-2.5 px-3">Mã HĐ</th>
            <th className="py-2.5 px-3">Khách hàng</th>
            <th className="py-2.5 px-3">Vật tư & SL</th>
            <th className="py-2.5 px-3 text-right">Tiền hàng trước CK (+)</th>
            <th className="py-2.5 px-3 text-right">Chiết khấu (−)</th>
            <th className="py-2.5 px-3 text-right">Quà KM (−)</th>
            <th className="py-2.5 px-3 text-right">Giá vốn (−)</th>
            <th className="py-2.5 px-3 text-right">Lãi tạm tính (=)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} className="py-6 px-3 text-center text-slate-500">
                Không có hóa đơn nào trong kỳ đã chọn.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr
              key={r.sale.id}
              onClick={() => onSelectSale?.(r.sale)}
              className={onSelectSale ? 'hover:bg-emerald-50/40 cursor-pointer' : ''}
            >
              <td className="py-2.5 px-3 font-mono whitespace-nowrap">{(r.sale.createdAt || '').slice(0, 10)}</td>
              <td className="py-2.5 px-3 font-mono font-bold text-emerald-800 whitespace-nowrap">
                {r.sale.invoiceCode}
              </td>
              <td className="py-2.5 px-3 font-semibold text-slate-900">{r.sale.customerName}</td>
              <td className="py-2.5 px-3">
                {r.sale.productName} ({r.sale.quantity} {r.sale.unit})
                {r.giftCost > 0 && (
                  <span className="ml-1 text-[10px] font-bold text-emerald-700">
                    +Quà {r.sale.giftQuantity} {r.sale.giftUnit || ''}
                  </span>
                )}
              </td>
              <td className="py-2.5 px-3 text-right font-mono text-emerald-800">+{formatVND(r.grossAmount)}</td>
              <td className="py-2.5 px-3 text-right font-mono text-rose-700">
                {r.discountAmount > 0 ? `−${formatVND(r.discountAmount)}` : '0 đ'}
              </td>
              <td className="py-2.5 px-3 text-right font-mono text-rose-700">
                {r.giftCost > 0 ? `−${formatVND(r.giftCost)}` : '0 đ'}
              </td>
              <td className="py-2.5 px-3 text-right font-mono text-rose-700">−{formatVND(r.productCogs)}</td>
              <td
                className={`py-2.5 px-3 text-right font-mono font-bold ${
                  r.rowProvisionalProfit >= 0 ? 'text-emerald-800' : 'text-rose-700'
                }`}
              >
                {formatVND(r.rowProvisionalProfit)}
              </td>
            </tr>
          ))}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="bg-emerald-50 border-t-2 border-emerald-200 font-bold text-slate-900">
              <td colSpan={4} className="py-2.5 px-3">
                Tổng cộng ({rows.length} dòng)
              </td>
              <td className="py-2.5 px-3 text-right font-mono">
                +{formatVND(rows.reduce((s, r) => s + r.grossAmount, 0))}
              </td>
              <td className="py-2.5 px-3 text-right font-mono">
                −{formatVND(rows.reduce((s, r) => s + r.discountAmount, 0))}
              </td>
              <td className="py-2.5 px-3 text-right font-mono">
                −{formatVND(rows.reduce((s, r) => s + r.giftCost, 0))}
              </td>
              <td className="py-2.5 px-3 text-right font-mono">
                −{formatVND(rows.reduce((s, r) => s + r.productCogs, 0))}
              </td>
              <td className="py-2.5 px-3 text-right font-mono">
                {formatVND(rows.reduce((s, r) => s + r.rowProvisionalProfit, 0))}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );

  const renderVoucherTable = (
    rows: Array<CashReceiptVoucher | CashPaymentVoucher>,
    sign: '+' | '−',
    emptyText: string
  ) => (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[720px] text-left border-collapse text-xs">
        <thead>
          <tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-800">
            <th className="py-2.5 px-3">Ngày</th>
            <th className="py-2.5 px-3">Mã phiếu</th>
            <th className="py-2.5 px-3">Nhóm</th>
            <th className="py-2.5 px-3">Đối tác</th>
            <th className="py-2.5 px-3">Diễn giải</th>
            <th className="py-2.5 px-3 text-right">Số tiền ({sign})</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="py-6 px-3 text-center text-slate-500">
                {emptyText}
              </td>
            </tr>
          )}
          {rows.map((v) => (
            <tr key={v.id}>
              <td className="py-2.5 px-3 font-mono whitespace-nowrap">{(v.createdAt || '').slice(0, 10)}</td>
              <td className="py-2.5 px-3 font-mono font-bold whitespace-nowrap">{v.voucherCode}</td>
              <td className="py-2.5 px-3">{v.groupName}</td>
              <td className="py-2.5 px-3 font-semibold text-slate-900">{v.partnerName}</td>
              <td className="py-2.5 px-3">{v.note}</td>
              <td
                className={`py-2.5 px-3 text-right font-mono font-bold ${
                  sign === '+' ? 'text-emerald-800' : 'text-rose-700'
                }`}
              >
                {sign}
                {formatVND(v.amount)}
              </td>
            </tr>
          ))}
        </tbody>
        {rows.length > 0 && (
          <tfoot>
            <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold text-slate-900">
              <td colSpan={5} className="py-2.5 px-3">
                Tổng cộng ({rows.length} phiếu)
              </td>
              <td className="py-2.5 px-3 text-right font-mono">
                {sign}
                {formatVND(rows.reduce((s, v) => s + v.amount, 0))}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );

  return (
    <div className="bg-white rounded-xl border-2 border-emerald-200 overflow-hidden shadow-sm">
      <div className="p-4 sm:p-6 border-b border-slate-200 bg-emerald-50/60 space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-100 border border-emerald-300 text-xs font-bold text-emerald-950">
              <BookOpen className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
              <span>SỔ QUỸ KHO · LỢI NHUẬN TẠM TÍNH THEO KỲ</span>
            </div>
            <h3 className="text-base sm:text-lg font-extrabold text-slate-900">
              Sổ Quỹ & Kết Quả Lợi Nhuận Tạm Tính ({warehouseLabel})
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onExportExcel}
              className="px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg flex items-center gap-1.5"
            >
              <FileSpreadsheet className="w-4 h-4 shrink-0" />
              <span>Xuất Sổ Quỹ Excel (.xlsx)</span>
            </button>
            <button
              type="button"
              onClick={onExportPDF}
              className="px-3.5 py-2 text-xs font-bold text-slate-900 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1.5"
            >
              <FileText className="w-4 h-4 text-red-600 shrink-0" />
              <span>Xuất Sổ Quỹ PDF (.pdf)</span>
            </button>
          </div>
        </div>

        <div className="p-3.5 bg-white rounded-xl border border-emerald-200 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label htmlFor="cashbook-from-date" className="flex items-center gap-1 text-xs font-semibold text-slate-700 mb-1">
                <Calendar className="w-3.5 h-3.5 text-emerald-700" /> Từ ngày
              </label>
              <input
                id="cashbook-from-date"
                type="date"
                value={fromDate}
                onChange={(e) => onChangeDateRange(e.target.value, toDate)}
                className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="cashbook-to-date" className="flex items-center gap-1 text-xs font-semibold text-slate-700 mb-1">
                <Calendar className="w-3.5 h-3.5 text-emerald-700" /> Đến ngày
              </label>
              <input
                id="cashbook-to-date"
                type="date"
                value={toDate}
                onChange={(e) => onChangeDateRange(fromDate, e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="cashbook-search" className="block text-xs font-semibold text-slate-700 mb-1">
                Tìm nhanh mã phiếu, khách hàng, vật tư...
              </label>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="cashbook-search"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => onChangeSearchQuery(e.target.value)}
                  placeholder="Gõ để lọc bảng bên dưới..."
                  className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg"
                />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-600 mr-1">Chọn nhanh:</span>
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => onChangeDateRange(p.from, p.to)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors ${
                  fromDate === p.from && toDate === p.to
                    ? 'bg-emerald-700 text-white border-emerald-700'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div
          className={`p-4 rounded-xl border-2 ${
            profit >= 0 ? 'bg-emerald-50 border-emerald-300' : 'bg-rose-50 border-rose-300'
          }`}
        >
          <div className="text-xs font-bold text-slate-700">
            Lợi nhuận tạm tính ({fromDate} → {toDate})
          </div>
          <div
            className={`text-2xl sm:text-3xl font-extrabold font-mono mt-0.5 ${
              profit >= 0 ? 'text-emerald-800' : 'text-rose-700'
            }`}
          >
            {formatVND(profit)}{' '}
            <span className="text-sm font-semibold text-slate-600">
              (Tỷ suất: {summary.provisionalMarginPct}%)
            </span>
          </div>
          <div className="mt-2 text-[11px] sm:text-xs font-mono text-slate-700 leading-relaxed">
            Doanh thu trước CK <strong className="text-emerald-800">(+{formatVND(summary.grossSalesRevenue)})</strong>
            {' + '}Phiếu thu khác <strong className="text-emerald-800">(+{formatVND(summary.otherIncomeReceipts)})</strong>
            {' − '}Giá vốn <strong className="text-rose-700">(−{formatVND(summary.productCogs)})</strong>
            {' − '}Chiết khấu <strong className="text-rose-700">(−{formatVND(summary.discountCost)})</strong>
            {' − '}Quà tặng KM <strong className="text-rose-700">(−{formatVND(summary.giftPromoCost)})</strong>
            {' − '}Chi phí khác <strong className="text-rose-700">(−{formatVND(summary.otherOperatingExpenses)})</strong>
            {' = '}
            <strong className={profit >= 0 ? 'text-emerald-800' : 'text-rose-700'}>{formatVND(profit)}</strong>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-white border border-slate-200 text-xs space-y-1">
          <div className="font-bold text-slate-800">Đối chiếu dòng tiền thực thu − thực chi của quỹ trong kỳ</div>
          <div className="font-mono text-slate-700 flex flex-wrap gap-x-4 gap-y-1">
            <span>
              Thực thu: <strong className="text-emerald-800">+{formatVND(summary.actualCashInflow)}</strong>
            </span>
            <span>
              Thực chi: <strong className="text-rose-700">−{formatVND(summary.actualCashOutflow)}</strong>
            </span>
            <span>
              Dòng tiền ròng:{' '}
              <strong className={summary.actualNetCashflow >= 0 ? 'text-emerald-800' : 'text-rose-700'}>
                {formatVND(summary.actualNetCashflow)}
              </strong>
            </span>
          </div>
          <p className="text-[11px] text-slate-500">
            Lợi nhuận tính theo doanh thu đã bán; dòng tiền chỉ tính tiền thực đã thu/chi nên sẽ khác nhau khi có bán
            chịu, thu nợ cũ hoặc nhập hàng còn nợ.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {kpiCards.map((c) => (
            <button
              key={c.title}
              type="button"
              onClick={() => setSubTab(c.key)}
              className={`p-3.5 text-left rounded-xl border transition-all ${
                subTab === c.key
                  ? 'bg-emerald-50 border-emerald-500 ring-2 ring-emerald-500/20'
                  : 'bg-white border-slate-200 hover:border-emerald-300'
              }`}
            >
              <div className="text-xs text-slate-600 font-semibold">{c.title}</div>
              <div className={`text-base font-bold font-mono mt-1 ${c.tone}`}>{c.value}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{c.sub}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-3.5">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['all_sales', `Hóa đơn bán (${saleRows.length})`],
              ['promo_discount', `Chiết khấu & Quà KM (${promoRows.length})`],
              ['other_receipts', `Phiếu thu khác (${receiptRows.length})`],
              ['other_expenses', `Chi phí khác (${expenseRows.length})`],
            ] as Array<[CashbookSubTab, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSubTab(key)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg border ${
                subTab === key
                  ? 'bg-emerald-700 text-white border-emerald-700'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-emerald-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {subTab === 'all_sales' && renderSaleTable(saleRows)}
        {subTab === 'promo_discount' && renderSaleTable(promoRows)}

        {subTab === 'other_receipts' && (
          <div className="space-y-2.5">
            {onNavigateToModule && (
              <button
                type="button"
                onClick={() => onNavigateToModule('receipt_vouchers')}
                className="px-3 py-1.5 text-xs font-bold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-lg inline-flex items-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Mở Nhật ký Phiếu thu</span>
              </button>
            )}
            {renderVoucherTable(receiptRows, '+', 'Không có phiếu thu khác trong kỳ.')}
          </div>
        )}

        {subTab === 'other_expenses' && (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              {onNavigateToModule && (
                <button
                  type="button"
                  onClick={() => onNavigateToModule('payment_vouchers')}
                  className="px-3 py-1.5 text-xs font-bold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-lg inline-flex items-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Mở Nhật ký Phiếu chi</span>
                </button>
              )}
              {expenseGroupChips.map(([g, amt]) => (
                <span
                  key={g}
                  className="px-2 py-0.5 text-[11px] font-semibold bg-amber-50 text-amber-900 border border-amber-200 rounded-full"
                >
                  {g}: −{formatVND(amt)}
                </span>
              ))}
            </div>
            {renderVoucherTable(expenseRows, '−', 'Không có chi phí khác trong kỳ.')}
          </div>
        )}
      </div>
    </div>
  );
};

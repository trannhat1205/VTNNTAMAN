import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownCircle,
  ArrowRight,
  ArrowUpCircle,
  Boxes,
  Search,
  ShoppingCart,
  Truck,
  Users,
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
} from '../types';
import { formatVND, normalizeVietnameseSearch } from '../utils/businessLogic';

interface GlobalQuickSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  allowedTabs: string[];
  products: ProductItem[];
  customers: CustomerProfile[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  receiptVouchers: CashReceiptVoucher[];
  paymentVouchers: CashPaymentVoucher[];
  onNavigateCrossLink: (req: CrossLinkNavigateRequest) => void;
  onQuickCreateSaleForCustomer?: (customerId: string) => void;
  onQuickRestockProduct?: (productId: string) => void;
}

interface SearchHit {
  key: string;
  categoryLabel: string;
  codeBadge: string;
  title: string;
  subtitle: string;
  rightMetric?: string;
  rightTone?: 'emerald' | 'rose' | 'amber' | 'slate';
  icon: React.ReactNode;
  onSelect: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}

export const GlobalQuickSearchModal: React.FC<GlobalQuickSearchModalProps> = ({
  isOpen,
  onClose,
  allowedTabs,
  products,
  customers,
  sales,
  imports,
  receiptVouchers,
  paymentVouchers,
  onNavigateCrossLink,
  onQuickCreateSaleForCustomer,
  onQuickRestockProduct,
}) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIndex(0);
      const timer = window.setTimeout(() => {
        inputRef.current?.focus();
      }, 30);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [isOpen]);

  const allowedSet = useMemo(() => new Set(allowedTabs), [allowedTabs]);

  const results = useMemo<SearchHit[]>(() => {
    if (!isOpen) return [];
    const q = normalizeVietnameseSearch(query);
    const hits: SearchHit[] = [];

    const matchesQuery = (text: string) => {
      if (!q) return true;
      return normalizeVietnameseSearch(text).includes(q);
    };

    // 1. Products (Inventory)
    if (allowedSet.has('inventory')) {
      const matchedProducts = products
        .filter((p) =>
          matchesQuery(
            `${p.code} ${p.name} ${p.barcode || ''} ${p.category} ${p.supplierName} ${p.warehouseName || ''}`
          )
        )
        .slice(0, q ? 8 : 3);

      for (const p of matchedProducts) {
        hits.push({
          key: `prod_${p.id}`,
          categoryLabel: 'Vật tư tồn kho',
          codeBadge: p.code,
          title: p.name,
          subtitle: `${p.warehouseName || 'Tâm An Mỹ Ngãi'} · Giá bán: ${formatVND(p.sellPrice)}/${p.unit}`,
          rightMetric: `Tồn: ${p.stock} ${p.unit}`,
          rightTone: p.stock <= 0 ? 'rose' : p.stock <= p.minStock ? 'amber' : 'emerald',
          icon: <Boxes className="w-4 h-4 text-indigo-700" />,
          onSelect: () => {
            onNavigateCrossLink({
              tab: 'inventory',
              recordId: p.id,
              label: `Thẻ kho ${p.name}`,
            });
            onClose();
          },
          secondaryActionLabel:
            allowedSet.has('imports') && onQuickRestockProduct ? '+ Nhập thêm' : undefined,
          onSecondaryAction:
            allowedSet.has('imports') && onQuickRestockProduct
              ? () => {
                  onQuickRestockProduct(p.id);
                  onClose();
                }
              : undefined,
        });
      }
    }

    // 2. Customers
    if (allowedSet.has('customers')) {
      const matchedCusts = customers
        .filter((c) =>
          matchesQuery(
            `${c.code} ${c.name} ${c.phone} ${c.address} ${c.group} ${c.warehouseName || ''}`
          )
        )
        .slice(0, q ? 8 : 3);

      for (const c of matchedCusts) {
        hits.push({
          key: `cust_${c.id}`,
          categoryLabel: 'Khách hàng',
          codeBadge: c.code || 'KH',
          title: `${c.name}${c.phone ? ` (${c.phone})` : ''}`,
          subtitle: `${c.group} · Mua tích lũy: ${formatVND(c.totalPurchased)}`,
          rightMetric: c.totalDebt > 0 ? `Nợ: ${formatVND(c.totalDebt)}` : '0 đ nợ',
          rightTone: c.totalDebt > 0 ? 'rose' : 'emerald',
          icon: <Users className="w-4 h-4 text-sky-700" />,
          onSelect: () => {
            onNavigateCrossLink({
              tab: 'customers',
              recordId: c.id,
              label: `Khách hàng ${c.name}`,
            });
            onClose();
          },
          secondaryActionLabel:
            allowedSet.has('sales') && onQuickCreateSaleForCustomer ? '+ Bán hàng' : undefined,
          onSecondaryAction:
            allowedSet.has('sales') && onQuickCreateSaleForCustomer
              ? () => {
                  onQuickCreateSaleForCustomer(c.id);
                  onClose();
                }
              : undefined,
        });
      }
    }

    // 3. Sales Invoices (HD-...)
    if (allowedSet.has('sales')) {
      const matchedSales = sales
        .filter((s) =>
          matchesQuery(
            `${s.invoiceCode} ${s.customerName} ${s.customerPhone} ${s.productName} ${s.warehouseName || ''}`
          )
        )
        .slice(0, q ? 8 : 3);

      for (const s of matchedSales) {
        hits.push({
          key: `sale_${s.id}`,
          categoryLabel: 'Hóa đơn bán',
          codeBadge: s.invoiceCode,
          title: `${s.customerName} — ${s.productName} (${s.quantity} ${s.unit})`,
          subtitle: `${(s.createdAt || '').slice(0, 10)} · ${s.warehouseName || 'Tâm An Mỹ Ngãi'}`,
          rightMetric:
            s.debtAmount > 0 ? `Nợ: ${formatVND(s.debtAmount)}` : formatVND(s.totalAmount),
          rightTone: s.debtAmount > 0 ? 'rose' : 'emerald',
          icon: <ShoppingCart className="w-4 h-4 text-emerald-700" />,
          onSelect: () => {
            onNavigateCrossLink({
              tab: 'sales',
              recordId: s.id,
              voucherCode: s.invoiceCode,
              label: `Hóa đơn ${s.invoiceCode}`,
            });
            onClose();
          },
        });
      }
    }

    // 4. Import Receipts (PN-...)
    if (allowedSet.has('imports')) {
      const matchedImports = imports
        .filter((i) =>
          matchesQuery(
            `${i.receiptCode} ${i.supplierName} ${i.supplierPhone} ${i.productName} ${i.batchNumber || ''} ${i.warehouseName || ''}`
          )
        )
        .slice(0, q ? 6 : 2);

      for (const i of matchedImports) {
        hits.push({
          key: `imp_${i.id}`,
          categoryLabel: 'Phiếu nhập kho',
          codeBadge: i.receiptCode,
          title: `${i.supplierName} — +${i.quantity} ${i.unit} ${i.productName}`,
          subtitle: `${(i.createdAt || '').slice(0, 10)} · ${i.warehouseName || 'Tâm An Mỹ Ngãi'}`,
          rightMetric:
            i.debtAmount > 0 ? `Nợ NCC: ${formatVND(i.debtAmount)}` : formatVND(i.totalCost),
          rightTone: i.debtAmount > 0 ? 'amber' : 'emerald',
          icon: <Truck className="w-4 h-4 text-amber-700" />,
          onSelect: () => {
            onNavigateCrossLink({
              tab: 'imports',
              recordId: i.id,
              voucherCode: i.receiptCode,
              label: `Phiếu nhập ${i.receiptCode}`,
            });
            onClose();
          },
        });
      }
    }

    // 5. Receipt Vouchers (PT-...)
    if (allowedSet.has('receipt_vouchers') && q) {
      const matchedRvs = receiptVouchers
        .filter((rv) =>
          matchesQuery(
            `${rv.voucherCode} ${rv.partnerName} ${rv.partnerPhone} ${rv.groupName} ${rv.note}`
          )
        )
        .slice(0, 5);

      for (const rv of matchedRvs) {
        hits.push({
          key: `rv_${rv.id}`,
          categoryLabel: 'Phiếu thu tiền',
          codeBadge: rv.voucherCode,
          title: `${rv.partnerName} · ${rv.groupName}`,
          subtitle: `${(rv.createdAt || '').slice(0, 10)} · ${rv.warehouseName}`,
          rightMetric: `+${formatVND(rv.amount)}`,
          rightTone: 'emerald',
          icon: <ArrowDownCircle className="w-4 h-4 text-emerald-700" />,
          onSelect: () => {
            onNavigateCrossLink({
              tab: 'receipt_vouchers',
              recordId: rv.id,
              voucherCode: rv.voucherCode,
              label: `Phiếu thu ${rv.voucherCode}`,
            });
            onClose();
          },
        });
      }
    }

    // 6. Payment Vouchers (PC-...)
    if (allowedSet.has('payment_vouchers') && q) {
      const matchedPvs = paymentVouchers
        .filter((pv) =>
          matchesQuery(
            `${pv.voucherCode} ${pv.partnerName} ${pv.partnerPhone} ${pv.groupName} ${pv.note}`
          )
        )
        .slice(0, 5);

      for (const pv of matchedPvs) {
        hits.push({
          key: `pv_${pv.id}`,
          categoryLabel: 'Phiếu chi tiền',
          codeBadge: pv.voucherCode,
          title: `${pv.partnerName} · ${pv.groupName}`,
          subtitle: `${(pv.createdAt || '').slice(0, 10)} · ${pv.warehouseName}`,
          rightMetric: `-${formatVND(pv.amount)}`,
          rightTone: 'amber',
          icon: <ArrowUpCircle className="w-4 h-4 text-amber-700" />,
          onSelect: () => {
            onNavigateCrossLink({
              tab: 'payment_vouchers',
              recordId: pv.id,
              voucherCode: pv.voucherCode,
              label: `Phiếu chi ${pv.voucherCode}`,
            });
            onClose();
          },
        });
      }
    }

    return hits.slice(0, 30);
  }, [
    isOpen,
    query,
    allowedSet,
    products,
    customers,
    sales,
    imports,
    receiptVouchers,
    paymentVouchers,
    onNavigateCrossLink,
    onQuickCreateSaleForCustomer,
    onQuickRestockProduct,
    onClose,
  ]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-xs flex items-start justify-center p-2.5 sm:p-6 pt-12 sm:pt-16"
      role="dialog"
      aria-modal="true"
      aria-label="Tìm kiếm nhanh toàn hệ thống (Ctrl+K)"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[82dvh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2.5 bg-slate-50/80">
          <Search className="w-4 h-4 text-emerald-700 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIndex((prev) => (results.length > 0 ? (prev + 1) % results.length : 0));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIndex((prev) =>
                  results.length > 0 ? (prev - 1 + results.length) % results.length : 0
                );
              } else if (e.key === 'Enter' && results[activeIndex]) {
                e.preventDefault();
                results[activeIndex].onSelect();
              }
            }}
            placeholder="Gõ tên thuốc/phân, SĐT khách, mã VT, HD-..., PN-..., PT-..., PC-... (Không dấu cũng khớp)"
            className="flex-1 min-w-0 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:text-slate-800 bg-slate-200/70 rounded"
            >
              Xóa
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng tìm kiếm nhanh"
            className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto divide-y divide-slate-100 flex-1">
          {results.length === 0 ? (
            <div className="py-12 px-4 text-center text-xs text-slate-500">
              Không tìm thấy vật tư, khách hàng hay chứng từ nào khớp từ khóa{' '}
              <strong className="text-slate-800">&quot;{query}&quot;</strong>.
            </div>
          ) : (
            results.map((hit, idx) => {
              const isSelected = idx === activeIndex;
              return (
                <div
                  key={hit.key}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={hit.onSelect}
                  className={`px-4 py-2.5 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                    isSelected ? 'bg-emerald-50/90' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    <div className="mt-0.5 p-1.5 rounded-lg bg-white border border-slate-200 shrink-0">
                      {hit.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          {hit.categoryLabel}
                        </span>
                        <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-slate-100 text-slate-800 border border-slate-200 rounded">
                          {hit.codeBadge}
                        </span>
                      </div>
                      <div className="text-xs sm:text-sm font-semibold text-slate-900 truncate mt-0.5">
                        {hit.title}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">{hit.subtitle}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {hit.rightMetric && (
                      <span
                        className={`text-xs font-mono font-bold whitespace-nowrap ${
                          hit.rightTone === 'rose'
                            ? 'text-rose-600'
                            : hit.rightTone === 'amber'
                            ? 'text-amber-700'
                            : hit.rightTone === 'emerald'
                            ? 'text-emerald-700'
                            : 'text-slate-700'
                        }`}
                      >
                        {hit.rightMetric}
                      </span>
                    )}
                    {hit.secondaryActionLabel && hit.onSecondaryAction && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          hit.onSecondaryAction?.();
                        }}
                        className="px-2 py-1 text-[11px] font-semibold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 rounded-md whitespace-nowrap"
                      >
                        {hit.secondaryActionLabel}
                      </button>
                    )}
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400 hidden sm:block" />
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
          <span>
            Mẹo: Nhấn <kbd className="px-1.5 py-0.5 bg-white border border-slate-300 rounded font-mono text-[10px]">Ctrl + K</kbd> ở bất kỳ trang nào để mở nhanh
          </span>
          <span className="hidden sm:inline">
            ↑↓ Di chuyển · Enter Mở ngay · Esc Đóng
          </span>
        </div>
      </div>
    </div>
  );
};

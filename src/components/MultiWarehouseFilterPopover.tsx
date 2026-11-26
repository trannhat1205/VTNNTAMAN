import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Warehouse } from 'lucide-react';
import { dedupeWarehouseNames, normalizeWarehouseKey } from '../utils/businessLogic';

interface MultiWarehouseFilterPopoverProps {
  allWarehouses: string[];
  selectedWarehouses: string[];
  onChangeSelectedWarehouses: (warehouses: string[]) => void;
  canFilterMultiWarehouses: boolean;
  lockedWarehouseLabel: string;
  compact?: boolean;
  triggerId?: string;
}

export const MultiWarehouseFilterPopover: React.FC<MultiWarehouseFilterPopoverProps> = ({
  allWarehouses,
  selectedWarehouses,
  onChangeSelectedWarehouses,
  canFilterMultiWarehouses,
  lockedWarehouseLabel,
  compact = false,
  triggerId,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Deduplicate and normalize selected list case- & accent-insensitively
  const canonicalWarehouses = dedupeWarehouseNames(allWarehouses);
  const byKey = new Map(canonicalWarehouses.map((w) => [normalizeWarehouseKey(w), w]));
  const validSelected = dedupeWarehouseNames(
    selectedWarehouses
      .map((w) => byKey.get(normalizeWarehouseKey(w)))
      .filter((w): w is string => Boolean(w))
  );
  const isAllSelected =
    validSelected.length === 0 || validSelected.length >= canonicalWarehouses.length;
  const activeList = isAllSelected ? canonicalWarehouses : validSelected;
  const activeKeySet = new Set(activeList.map((w) => normalizeWarehouseKey(w)));

  if (!canFilterMultiWarehouses) {
    return (
      <span
        title={lockedWarehouseLabel}
        className={`inline-flex items-center gap-1.5 font-semibold text-emerald-800 bg-emerald-50/90 border border-emerald-200 rounded-lg whitespace-nowrap shrink-0 max-w-full ${
          compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs'
        }`}
      >
        <Warehouse className="w-3.5 h-3.5 shrink-0 text-emerald-700" />
        <span className="truncate max-w-[155px] sm:max-w-[210px] lg:max-w-[240px] xl:max-w-[280px]">
          {lockedWarehouseLabel}
        </span>
      </span>
    );
  }

  const badgeText = isAllSelected
    ? `Tất cả kho (${canonicalWarehouses.length})`
    : activeList.length === 1
    ? activeList[0]
    : `Đã chọn ${activeList.length}/${canonicalWarehouses.length} kho`;

  const handleSelectAll = () => {
    onChangeSelectedWarehouses(canonicalWarehouses);
  };

  const handleSelectSingleOnly = (warehouse: string) => {
    onChangeSelectedWarehouses([warehouse]);
    setIsOpen(false);
  };

  const handleToggleCheckbox = (warehouse: string) => {
    const whKey = normalizeWarehouseKey(warehouse);
    if (isAllSelected) {
      // Unchecking one from all -> keep the rest; if only 1 total warehouse, keep it
      const remaining = canonicalWarehouses.filter((w) => normalizeWarehouseKey(w) !== whKey);
      onChangeSelectedWarehouses(remaining.length > 0 ? remaining : [warehouse]);
      return;
    }
    if (activeKeySet.has(whKey)) {
      const remaining = activeList.filter((w) => normalizeWarehouseKey(w) !== whKey);
      // If user unchecks the last remaining warehouse, revert to all warehouses so view is never dead
      onChangeSelectedWarehouses(remaining.length > 0 ? remaining : canonicalWarehouses);
    } else {
      const next = [...activeList, warehouse];
      onChangeSelectedWarehouses(next);
    }
  };

  return (
    <div ref={containerRef} className="relative inline-block text-left shrink-0 max-w-full">
      <button
        id={triggerId}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-label={`Chọn lọc kho xem dữ liệu: ${badgeText}`}
        className={`inline-flex items-center gap-1 font-semibold rounded-lg border transition-colors whitespace-nowrap max-w-full ${
          compact
            ? 'px-2 py-1 text-[11px]'
            : 'px-2.5 py-1.5 text-xs'
        } ${
          !isAllSelected
            ? 'bg-emerald-700 text-white border-emerald-700 shadow-2xs hover:bg-emerald-800'
            : 'bg-emerald-50/90 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
        }`}
      >
        <Warehouse className="w-3.5 h-3.5 shrink-0" />
        <span className="max-w-[145px] sm:max-w-[220px] truncate">{badgeText}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1.5 w-[min(20rem,calc(100vw-1.5rem))] bg-white rounded-xl border border-slate-200 shadow-xl z-50 p-3 space-y-2.5 text-xs">
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100">
            <span className="font-bold text-slate-900 flex items-center gap-1.5">
              <Warehouse className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
              <span>Lọc dữ liệu & Báo cáo theo Kho</span>
            </span>
            <button
              type="button"
              onClick={() => {
                handleSelectAll();
                setIsOpen(false);
              }}
              className={`px-2 py-0.5 text-[11px] font-bold rounded border transition-colors ${
                isAllSelected
                  ? 'bg-emerald-700 text-white border-emerald-700'
                  : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
              }`}
            >
              Chọn tất cả ({canonicalWarehouses.length})
            </button>
          </div>

          {/* All Warehouses Master Toggle Row */}
          <button
            type="button"
            onClick={handleSelectAll}
            className={`w-full px-2.5 py-2 rounded-lg border text-left flex items-center justify-between gap-2 transition-colors ${
              isAllSelected
                ? 'bg-emerald-50/90 border-emerald-500 text-emerald-950 font-bold'
                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100 font-semibold'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 ${
                  isAllSelected
                    ? 'bg-emerald-700 border-emerald-700 text-white'
                    : 'bg-white border-slate-300 text-transparent'
                }`}
              >
                <Check className="w-3 h-3" />
              </span>
              <span className="truncate">Tất cả kho ({canonicalWarehouses.length} kho)</span>
            </div>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 shrink-0">
              Tổng hợp
            </span>
          </button>

          {/* Individual Warehouses: Checkbox to combine multiple OR "Chỉ xem" to view single warehouse */}
          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
            {canonicalWarehouses.map((wh) => {
              const whKey = normalizeWarehouseKey(wh);
              const isChecked = activeKeySet.has(whKey);
              const isSingleSelected =
                !isAllSelected &&
                activeList.length === 1 &&
                normalizeWarehouseKey(activeList[0]) === whKey;
              return (
                <div
                  key={wh}
                  className={`p-2 rounded-lg border flex items-center justify-between gap-2 transition-colors ${
                    isChecked
                      ? 'bg-emerald-50/50 border-emerald-300 text-slate-900'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleToggleCheckbox(wh)}
                    className="flex items-center gap-2 min-w-0 flex-1 text-left"
                    title="Tích chọn hoặc bỏ tích để gộp nhiều kho cùng lúc"
                  >
                    <span
                      className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 ${
                        isChecked
                          ? 'bg-emerald-700 border-emerald-700 text-white'
                          : 'bg-white border-slate-300 text-transparent'
                      }`}
                    >
                      <Check className="w-3 h-3" />
                    </span>
                    <span className="font-semibold truncate">{wh}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSelectSingleOnly(wh)}
                    className={`px-2 py-1 text-[10px] font-bold rounded border shrink-0 transition-colors ${
                      isSingleSelected
                        ? 'bg-emerald-700 text-white border-emerald-700'
                        : 'bg-white text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                    }`}
                    title={`Chỉ xem riêng thống kê & báo cáo của kho ${wh}`}
                  >
                    {isSingleSelected ? 'Đang xem riêng' : 'Chỉ xem kho này'}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="pt-1.5 border-t border-slate-100 flex items-center justify-between gap-2 text-[11px] text-slate-500">
            <span className="truncate">
              Đang lọc: <strong className="text-emerald-800">{badgeText}</strong>
            </span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="px-2.5 py-1 font-bold text-white bg-slate-800 hover:bg-slate-900 rounded-md shrink-0"
            >
              Xong
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

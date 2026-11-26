import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Minus, Plus, Search, ShoppingCart, X } from 'lucide-react';
import {
  filterSearchableOptions,
  SearchableOptionItem,
} from '../utils/businessLogic';

interface SearchableSelectProps {
  id?: string;
  value: string;
  onChange: (newValue: string) => void;
  options: SearchableOptionItem[];
  placeholder?: string;
  emptyOptionLabel?: string;
  createActionLabel?: string;
  onCreateAction?: (typedKeyword?: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  /** Optional quick multi-item quantity selector inside dropdown (keeps dropdown open while picking) */
  quickQuantities?: Record<string, number>;
  quickMaxQuantities?: Record<string, number>;
  onQuickQuantityChange?: (optionValue: string, nextQuantity: number) => void;
  quickCartSummaryLabel?: string;
}

/**
 * Combobox with instant type-ahead search (supports Vietnamese accents & unaccented typing).
 * Clicking or typing in the input box immediately filters and displays matching items to pick.
 */
export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  id,
  value,
  onChange,
  options,
  placeholder = 'Gõ tên, mã, SĐT để tìm nhanh...',
  emptyOptionLabel = '-- Để trống / Chưa chọn --',
  createActionLabel,
  onCreateAction,
  disabled = false,
  ariaLabel,
  quickQuantities,
  quickMaxQuantities,
  onQuickQuantityChange,
  quickCartSummaryLabel,
}) => {
  const quickPickedCount = useMemo(() => {
    if (!quickQuantities) return 0;
    return Object.values(quickQuantities).filter((q) => q > 0).length;
  }, [quickQuantities]);
  const quickPickedUnits = useMemo(() => {
    if (!quickQuantities) return 0;
    return Object.values(quickQuantities).reduce((s, q) => s + (q > 0 ? q : 0), 0);
  }, [quickQuantities]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selectedOption = useMemo(
    () => options.find((opt) => opt.value === value) || null,
    [options, value]
  );

  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const selectedLabel = selectedOption ? selectedOption.label : '';

  // Keep input text synchronized with selected option when closed
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery((prev) => (prev === selectedLabel ? prev : selectedLabel));
    }
  }, [isOpen, selectedLabel]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const cleanCreateLabel = useMemo(
    () => (createActionLabel ? createActionLabel.replace(/^\+\s*/, '') : ''),
    [createActionLabel]
  );

  const filteredOptions = useMemo(() => {
    // When user just opened the dropdown and hasn't changed the selected label yet, show all options
    if (selectedOption && searchQuery === selectedOption.label) {
      return options;
    }
    return filterSearchableOptions(options, searchQuery);
  }, [options, searchQuery, selectedOption]);

  const handleOpenAndFocus = () => {
    if (disabled) return;
    setIsOpen(true);
    setSearchQuery('');
    setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div
        className={`flex items-center w-full bg-white border rounded-lg transition-colors ${
          disabled
            ? 'bg-slate-100 border-slate-200 opacity-75 cursor-not-allowed'
            : isOpen
            ? 'border-emerald-600 ring-2 ring-emerald-500/15'
            : 'border-slate-200 hover:border-slate-300'
        }`}
      >
        <Search className="w-3.5 h-3.5 text-slate-400 ml-3 shrink-0 pointer-events-none" />
        <input
          ref={inputRef}
          id={id}
          type="text"
          disabled={disabled}
          aria-label={ariaLabel || placeholder}
          aria-expanded={isOpen}
          autoComplete="off"
          value={isOpen ? searchQuery : selectedOption ? selectedOption.label : ''}
          placeholder={
            selectedOption
              ? selectedOption.label
              : quickCartSummaryLabel || placeholder
          }
          onFocus={() => {
            if (!disabled) {
              setIsOpen(true);
              setSearchQuery('');
            }
          }}
          onChange={(e) => {
            if (!isOpen) setIsOpen(true);
            setSearchQuery(e.target.value);
          }}
          className="w-full px-2.5 py-2 text-sm text-slate-900 bg-transparent focus:outline-none placeholder:text-slate-400 truncate"
        />

        {!disabled && (value || (isOpen && searchQuery)) && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
              setSearchQuery('');
              setIsOpen(true);
              inputRef.current?.focus();
            }}
            title="Xóa chọn để gõ tìm kiếm mới"
            aria-label="Xóa lựa chọn"
            className="p-1.5 text-slate-400 hover:text-slate-700 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}

        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (isOpen) {
              setIsOpen(false);
            } else {
              handleOpenAndFocus();
            }
          }}
          aria-label="Mở danh sách chọn nhanh"
          className="px-2.5 py-2 text-slate-400 hover:text-slate-700 shrink-0"
        >
          <ChevronDown
            className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180 text-emerald-700' : ''}`}
          />
        </button>
      </div>

      {isOpen && !disabled && (
        <div
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-72 overflow-y-auto divide-y divide-slate-100"
        >
          {/* Sticky helper header showing count & quick clear */}
          <div className="px-3 py-1.5 bg-slate-50 text-[11px] text-slate-500 flex items-center justify-between sticky top-0 z-10 border-b border-slate-200">
            <span>
              Hiển thị <strong>{filteredOptions.length}</strong> / {options.length} kết quả (gõ chữ không dấu hoặc có dấu)
            </span>
            {emptyOptionLabel && (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setSearchQuery('');
                  setIsOpen(false);
                }}
                className="text-emerald-700 font-semibold hover:underline"
              >
                {emptyOptionLabel}
              </button>
            )}
          </div>

          {/* Create New Inline Action at top if provided */}
          {createActionLabel && onCreateAction && (
            <button
              type="button"
              onClick={() => {
                const kw = searchQuery.trim();
                setIsOpen(false);
                onCreateAction(kw);
              }}
              className="w-full px-3.5 py-2.5 text-left text-xs font-semibold text-emerald-800 bg-emerald-50/80 hover:bg-emerald-100/80 flex items-center justify-between gap-2 transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {cleanCreateLabel}
                  {searchQuery.trim() ? ` ("${searchQuery.trim()}")` : ''}
                </span>
              </span>
              <span className="text-[11px] font-normal text-emerald-700">Bấm để tạo ngay</span>
            </button>
          )}

          {filteredOptions.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-500 space-y-2">
              <div>
                Không tìm thấy dữ liệu khớp với từ khóa{' '}
                <strong className="text-slate-800">"{searchQuery}"</strong>.
              </div>
              {createActionLabel && onCreateAction && (
                <button
                  type="button"
                  onClick={() => {
                    const kw = searchQuery.trim();
                    setIsOpen(false);
                    onCreateAction(kw);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{cleanCreateLabel}</span>
                </button>
              )}
            </div>
          ) : (
            filteredOptions.map((opt) => {
              const isSelected = opt.value === value;
              const quickQty = quickQuantities?.[opt.value] || 0;
              const maxQty = quickMaxQuantities?.[opt.value];
              const isOutOfStock = maxQty !== undefined && maxQty <= 0;
              return (
                <div
                  key={opt.value}
                  role="option"
                  aria-selected={isSelected || quickQty > 0}
                  className={`w-full px-3 py-2 text-left transition-colors flex items-center justify-between gap-2 ${
                    quickQty > 0
                      ? 'bg-emerald-50/95 text-emerald-950'
                      : isSelected
                      ? 'bg-emerald-50/80 text-emerald-950 font-semibold'
                      : 'hover:bg-slate-50 text-slate-900'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onChange(opt.value);
                      setSearchQuery(opt.label);
                      setIsOpen(false);
                    }}
                    className="min-w-0 flex-1 text-left focus:outline-none"
                  >
                    <div className="text-xs sm:text-sm font-medium truncate">{opt.label}</div>
                    {opt.subLabel && (
                      <div className="text-[11px] text-slate-500 truncate mt-0.5">
                        {opt.subLabel}
                      </div>
                    )}
                  </button>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {onQuickQuantityChange && (
                      <div
                        className="flex items-center gap-0.5 bg-white border border-emerald-300 rounded-lg p-0.5 shadow-2xs"
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        {isOutOfStock ? (
                          <span className="px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 whitespace-nowrap">
                            Hết hàng
                          </span>
                        ) : quickQty === 0 ? (
                          <button
                            type="button"
                            onClick={() => onQuickQuantityChange(opt.value, 1)}
                            title="Chọn nhanh 1 vào hóa đơn chung"
                            aria-label={`Thêm nhanh 1 ${opt.label} vào hóa đơn chung`}
                            className="px-2 py-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-md inline-flex items-center gap-0.5 whitespace-nowrap transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                            <span>SL</span>
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => onQuickQuantityChange(opt.value, Math.max(0, quickQty - 1))}
                              aria-label={`Giảm số lượng ${opt.label}`}
                              className="w-6 h-6 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-800 flex items-center justify-center"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <input
                              type="number"
                              min={0}
                              max={maxQty}
                              value={quickQty}
                              aria-label={`Số lượng chọn nhanh ${opt.label}`}
                              onChange={(e) => {
                                const parsed = Math.max(0, Math.round(Number(e.target.value) || 0));
                                onQuickQuantityChange(opt.value, parsed);
                              }}
                              className="w-10 text-center text-xs font-mono font-bold text-emerald-900 bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <button
                              type="button"
                              disabled={maxQty !== undefined && quickQty >= maxQty}
                              onClick={() => onQuickQuantityChange(opt.value, quickQty + 1)}
                              aria-label={`Tăng số lượng ${opt.label}`}
                              className="w-6 h-6 rounded-md bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 text-white flex items-center justify-center"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </>
                        )}
                      </div>
                    )}

                    {opt.badge && (
                      <span className="text-[11px] font-mono font-semibold text-emerald-800 bg-emerald-100/70 px-2 py-0.5 rounded whitespace-nowrap">
                        {opt.badge}
                      </span>
                    )}
                    {isSelected && !onQuickQuantityChange && (
                      <Check className="w-4 h-4 text-emerald-700 shrink-0" />
                    )}
                  </div>
                </div>
              );
            })
          )}

          {/* Sticky Footer when Quick Multi-Item Quantity Mode has selected items */}
          {onQuickQuantityChange && quickPickedCount > 0 && (
            <div className="px-3 py-2 bg-emerald-700 text-white sticky bottom-0 z-10 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold min-w-0">
                <ShoppingCart className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  Đã chọn {quickPickedCount} mặt hàng ({quickPickedUnits} ĐVT) vào hóa đơn chung
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-2.5 py-1 text-xs font-bold text-emerald-900 bg-white hover:bg-emerald-50 rounded-md whitespace-nowrap shrink-0"
              >
                Xong ({quickPickedCount})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface AutocompleteTextInputProps {
  id?: string;
  value: string;
  onChange: (val: string) => void;
  suggestions: SearchableOptionItem[];
  onSelectSuggestion?: (item: SearchableOptionItem) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
}

/**
 * Free-text input with automatic type-ahead suggestions dropdown when typing.
 * Allows either picking an existing Customer/Product/Supplier/Invoice OR typing any custom text.
 */
export const AutocompleteTextInput: React.FC<AutocompleteTextInputProps> = ({
  id,
  value,
  onChange,
  suggestions,
  onSelectSuggestion,
  placeholder = 'Nhập thông tin hoặc gõ chữ để hiện gợi ý nhanh...',
  required = false,
  className = 'w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const matched = useMemo(
    () => filterSearchableOptions(suggestions, value).slice(0, 12),
    [suggestions, value]
  );

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <input
          id={id}
          type="text"
          required={required}
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            onChange(e.target.value);
            setIsOpen(true);
          }}
          className={className}
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange('');
              setIsOpen(true);
            }}
            title="Xóa nhanh"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {isOpen && matched.length > 0 && (
        <div className="absolute left-0 right-0 z-50 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto divide-y divide-slate-100">
          <div className="px-3 py-1 bg-slate-50 text-[11px] text-slate-500 flex items-center justify-between">
            <span>Gợi ý tự động ({matched.length} kết quả khớp) — Bấm để điền nhanh</span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-slate-700"
            >
              Đóng
            </button>
          </div>
          {matched.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => {
                onChange(item.label);
                if (onSelectSuggestion) {
                  onSelectSuggestion(item);
                }
                setIsOpen(false);
              }}
              className="w-full px-3 py-2 text-left hover:bg-emerald-50/70 transition-colors flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900 truncate">{item.label}</div>
                {item.subLabel && (
                  <div className="text-[11px] text-slate-500 truncate">{item.subLabel}</div>
                )}
              </div>
              {item.badge && (
                <span className="text-[11px] font-mono text-emerald-800 bg-emerald-100/70 px-2 py-0.5 rounded shrink-0">
                  {item.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

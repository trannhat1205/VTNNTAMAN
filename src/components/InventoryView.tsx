import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowUpRight,
  Boxes,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  FileSpreadsheet,
  FolderPlus,
  History,
  Lock,
  PackagePlus,
  Pencil,
  QrCode,
  Search,
  Sparkles,
  Trash2,
  TrendingUp,
  Warehouse,
  X,
} from 'lucide-react';
import {
  CrossLinkNavigateRequest,
  CustomerProfile,
  ImportTransaction,
  ProductCategory,
  ProductItem,
  SaleTransaction,
  StockAdjustmentRecord,
  UserRole,
} from '../types';
import {
  areWarehouseNamesEquivalent,
  canPerformRoleAction,
  computeProductStockMovementLedger,
  computeSmartReorderSuggestions,
  doesRecordMatchProduct,
  evaluateProductExpiry,
  evaluateProductStockIntegrity,
  evaluateStockAlert,
  findCollidingProductCodeInWarehouse,
  formatVND,
  generateNextUniqueProductCode,
  getCurrentMonthRangeVietnam,
  getRecentDaysRangeVietnam,
  normalizeVietnameseSearch,
  normalizeWarehouseKey,
} from '../utils/businessLogic';
import { CrossLinkChip } from './VoucherCrossLinkUI';
import {
  exportModuleDataExcel,
  exportProductStockCardExcel,
  exportSmartReorderExcel,
} from '../utils/exportReports';
import { ExcelDataBar } from './ExcelDataBar';
import { SearchableSelect } from './SearchableSelect';
import { generateUniqueProductCodeFromName } from '../utils/businessLogic';
import { BarcodeScannerModal } from './BarcodeScannerModal';
import { DOSAGE_GUIDE_PRESETS } from '../utils/smartPosFeatures';
import {
  COMMON_VTNN_UNITS,
  computeMarginInfo,
  isSlowMovingProduct,
  priceFromMarkup,
  suggestMinStockFromVelocity,
} from '../utils/smartInsights';
import { TableDensityToggle, useTableDensity } from './CloudRecordSyncBadge';

interface InventoryViewProps {
  products: ProductItem[];
  customers: CustomerProfile[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  stockAdjustments?: StockAdjustmentRecord[];
  role: UserRole;
  warehouses: string[];
  onAddWarehouse: (warehouseName: string) => void;
  lockedWarehouse: string | null;
  productCategories: string[];
  onAddProductCategory: (catName: string) => void;
  onSaveProduct: (
    data: Omit<ProductItem, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>,
    editingId?: string,
    options?: {
      createInitialImportReceipt?: boolean;
      initialImportPaidMode?: 'paid' | 'debt';
      initialImportDueDate?: string;
    }
  ) => ProductItem;
  onDeleteProduct: (productId: string) => void;
  onExecuteStocktake?: (params: {
    productId: string;
    actualQty: number;
    reason: string;
    note?: string;
  }) => StockAdjustmentRecord | null;
  onDeleteStockAdjustment?: (adjustmentId: string) => void;
  onTransferStock?: (params: {
    productId: string;
    destinationWarehouse: string;
    quantity: number;
    note?: string;
  }) => boolean;
  onReconcileProductStock?: (productId: string) => void;
  onImportProductsFromExcel: (rows: Record<string, unknown>[]) => number;
  onQuickRestock: (productId: string) => void;
  onRequestAddNewProductInImports?: () => void;
  focusedProductId?: string | null;
  onClearFocusedProduct?: () => void;
  onNavigateCrossLink?: (req: CrossLinkNavigateRequest) => void;
}

export const InventoryView: React.FC<InventoryViewProps> = ({
  products,
  customers,
  sales,
  imports,
  stockAdjustments = [],
  role,
  warehouses,
  onAddWarehouse,
  lockedWarehouse,
  productCategories,
  onAddProductCategory,
  onSaveProduct,
  onDeleteProduct,
  onExecuteStocktake,
  onDeleteStockAdjustment,
  onTransferStock,
  onReconcileProductStock,
  onImportProductsFromExcel,
  onQuickRestock,
  onRequestAddNewProductInImports,
  focusedProductId,
  onClearFocusedProduct,
  onNavigateCrossLink,
}) => {
  const [tableDensity, setTableDensity] = useTableDensity();
  const isCompactTable = tableDensity === 'compact';
  const [searchQuery, setSearchQuery] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<ProductCategory | 'all'>('all');
  const [stockFilter, setStockFilter] = useState<
    'all' | 'low_or_out' | 'out_of_stock' | 'normal' | 'expiring' | 'slow'
  >('all');

  // Detailed Stock Movement Ledger Modal (Chi tiết Xuất - Nhập - Tồn kho) when clicking any item
  const [detailProductId, setDetailProductId] = useState<string | null>(null);
  const [ledgerFromDate, setLedgerFromDate] = useState<string>('');
  const [ledgerToDate, setLedgerToDate] = useState<string>('');
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState<'all' | 'import' | 'export'>('all');

  useEffect(() => {
    if (focusedProductId) {
      setDetailProductId(focusedProductId);
    }
  }, [focusedProductId]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductItem | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ProductCategory>('');
  const [warehouseName, setWarehouseName] = useState<string>(lockedWarehouse || '');
  const [unit, setUnit] = useState('');
  const [importPrice, setImportPrice] = useState<string>('');
  const [sellPrice, setSellPrice] = useState<string>('');
  const [stock, setStock] = useState<string>('');
  const [minStock, setMinStock] = useState<string>('');
  const [supplierName, setSupplierName] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [barcode, setBarcode] = useState('');
  const [dosageGuide, setDosageGuide] = useState('');
  const [groupPriceInputs, setGroupPriceInputs] = useState<Record<string, string>>({});
  // New product with opening stock: create a real PN receipt (default) or record opening stock only
  const [initialReceiptMode, setInitialReceiptMode] = useState<'pn_paid' | 'pn_debt' | 'opening_only'>(
    'pn_paid'
  );
  const [zeroPriceConfirmed, setZeroPriceConfirmed] = useState(false);
  const [productFormError, setProductFormError] = useState<string | null>(null);

  // Stocktake Modal (Kiểm kê & Điều chỉnh tồn kho KK-YYMM-XXX)
  const [isStocktakeModalOpen, setIsStocktakeModalOpen] = useState(false);
  const [stocktakeProductId, setStocktakeProductId] = useState('');
  const [stocktakeActualQty, setStocktakeActualQty] = useState('');
  const [stocktakeReason, setStocktakeReason] = useState('Kiểm kê định kỳ');
  const [stocktakeNote, setStocktakeNote] = useState('');
  const [stocktakeFeedback, setStocktakeFeedback] = useState<string | null>(null);

  // Warehouse transfer modal (Chuyển kho CK-YYMM-XXX)
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferProductId, setTransferProductId] = useState('');
  const [transferDestWarehouse, setTransferDestWarehouse] = useState('');
  const [transferQty, setTransferQty] = useState('1');
  const [transferNote, setTransferNote] = useState('');
  const [showSmartReorderPanel, setShowSmartReorderPanel] = useState(true);
  const [barcodeScanTarget, setBarcodeScanTarget] = useState<'search' | 'product_modal' | null>(null);

  // Inline New Product Category Creation inside Modal
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  // Inline New Warehouse Creation inside Modal
  const [showNewWarehouseInput, setShowNewWarehouseInput] = useState(false);
  const [newWarehouseText, setNewWarehouseText] = useState('');

  const lowStockCount = products.filter((p) => evaluateStockAlert(p) !== 'normal').length;

  const scopedBaseProducts = useMemo(
    () =>
      products.filter((p) => {
        const pWarehouse = p.warehouseName || 'Tâm An Mỹ Ngãi';
        if (lockedWarehouse && !areWarehouseNamesEquivalent(pWarehouse, lockedWarehouse)) {
          return false;
        }
        if (
          !lockedWarehouse &&
          warehouseFilter !== 'all' &&
          !areWarehouseNamesEquivalent(pWarehouse, warehouseFilter)
        ) {
          return false;
        }
        return true;
      }),
    [products, lockedWarehouse, warehouseFilter]
  );

  // Detect duplicate SKU codes within the same warehouse (e.g. two products sharing VT-01)
  const duplicateCodeProductIds = useMemo(() => {
    const bucket = new Map<string, string[]>();
    for (const p of scopedBaseProducts) {
      const cleanCode = (p.code || '').trim().toUpperCase();
      if (!cleanCode) continue;
      const whKey = normalizeWarehouseKey(p.warehouseName || 'Tâm An Mỹ Ngãi');
      const key = `${whKey}::${cleanCode}`;
      const arr = bucket.get(key) || [];
      arr.push(p.id);
      bucket.set(key, arr);
    }
    const dupIds = new Set<string>();
    bucket.forEach((ids) => {
      if (ids.length >= 2) ids.forEach((id) => dupIds.add(id));
    });
    return dupIds;
  }, [scopedBaseProducts]);

  const productMovementCounts = useMemo(() => {
    const map = new Map<string, { qtyIn: number; qtyOut: number }>();
    for (const p of scopedBaseProducts) {
      let qtyIn = 0;
      let qtyOut = 0;
      for (const imp of imports) {
        if (doesRecordMatchProduct(p, imp.productId, imp.productName, imp.warehouseName)) {
          qtyIn += Math.max(0, Number(imp.quantity) || 0);
        }
      }
      for (const s of sales) {
        if (doesRecordMatchProduct(p, s.productId, s.productName, s.warehouseName)) {
          qtyOut += Math.max(0, Number(s.quantity) || 0);
        }
        if (
          s.giftProductId &&
          (Number(s.giftQuantity) || 0) > 0 &&
          doesRecordMatchProduct(p, s.giftProductId, s.giftProductName, s.warehouseName)
        ) {
          qtyOut += Math.max(0, Number(s.giftQuantity) || 0);
        }
      }
      for (const adj of stockAdjustments) {
        if (adj.productId !== p.id) continue;
        const diff = Math.round(Number(adj.diffQty) || 0);
        if (diff > 0) qtyIn += diff;
        else if (diff < 0) qtyOut += Math.abs(diff);
      }
      map.set(p.id, { qtyIn, qtyOut });
    }
    return map;
  }, [scopedBaseProducts, imports, sales, stockAdjustments]);

  const inventorySummaryKpis = useMemo(() => {
    let totalUnits = 0;
    let totalCostValue = 0;
    let totalRetailValue = 0;
    let outCount = 0;
    let lowCount = 0;
    let totalInUnits = 0;
    let totalOutUnits = 0;
    let belowCostCount = 0;

    for (const p of scopedBaseProducts) {
      const stk = Math.max(0, Number(p.stock) || 0);
      const impP = Math.max(0, Number(p.importPrice) || 0);
      const sellP = Math.max(0, Number(p.sellPrice) || 0);
      totalUnits += stk;
      totalCostValue += stk * impP;
      totalRetailValue += stk * sellP;
      if (sellP > 0 && sellP < impP) belowCostCount += 1;
      const alert = evaluateStockAlert(p);
      if (alert === 'out_of_stock') outCount += 1;
      else if (alert === 'low_stock') lowCount += 1;
      const mov = productMovementCounts.get(p.id);
      if (mov) {
        totalInUnits += mov.qtyIn;
        totalOutUnits += mov.qtyOut;
      }
    }

    return {
      productCount: scopedBaseProducts.length,
      totalUnits,
      totalCostValue,
      totalRetailValue,
      outCount,
      lowCount,
      alertTotal: outCount + lowCount,
      totalInUnits,
      totalOutUnits,
      belowCostCount,
    };
  }, [scopedBaseProducts, productMovementCounts]);

  const detailProduct = useMemo(
    () => (detailProductId ? products.find((p) => p.id === detailProductId) || null : null),
    [detailProductId, products]
  );

  const detailLedger = useMemo(() => {
    if (!detailProduct) return null;
    return computeProductStockMovementLedger(detailProduct, sales, imports, {
      fromDate: ledgerFromDate || undefined,
      toDate: ledgerToDate || undefined,
      stockAdjustments,
    });
  }, [detailProduct, sales, imports, stockAdjustments, ledgerFromDate, ledgerToDate]);

  const smartReorderSuggestions = useMemo(
    () => computeSmartReorderSuggestions(scopedBaseProducts, sales),
    [scopedBaseProducts, sales]
  );

  const expiringOrExpiredCount = useMemo(
    () =>
      scopedBaseProducts.filter((p) => {
        if ((Number(p.stock) || 0) <= 0) return false;
        const st = evaluateProductExpiry(p.expiryDate).status;
        return st === 'expired' || st === 'expiring_30d' || st === 'expiring_60d' || st === 'expiring_90d';
      }).length,
    [scopedBaseProducts]
  );

  const filteredDetailMovements = useMemo(() => {
    if (!detailLedger) return [];
    if (ledgerTypeFilter === 'all') return detailLedger.movementsInPeriod;
    if (ledgerTypeFilter === 'import') {
      return detailLedger.movementsInPeriod.filter((m) => m.type === 'import');
    }
    return detailLedger.movementsInPeriod.filter((m) => m.type !== 'import');
  }, [detailLedger, ledgerTypeFilter]);

  const filteredProducts = products.filter((p) => {
    const pWarehouse = p.warehouseName || 'Tâm An Mỹ Ngãi';
    if (lockedWarehouse && !areWarehouseNamesEquivalent(pWarehouse, lockedWarehouse)) return false;
    if (
      !lockedWarehouse &&
      warehouseFilter !== 'all' &&
      !areWarehouseNamesEquivalent(pWarehouse, warehouseFilter)
    ) {
      return false;
    }
    if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
    const alert = evaluateStockAlert(p);
    if (stockFilter === 'low_or_out' && alert === 'normal') return false;
    if (stockFilter === 'out_of_stock' && alert !== 'out_of_stock') return false;
    if (stockFilter === 'normal' && alert !== 'normal') return false;
    if (stockFilter === 'expiring') {
      const exp = evaluateProductExpiry(p.expiryDate).status;
      const isExpiring =
        (Number(p.stock) || 0) > 0 &&
        (exp === 'expired' || exp === 'expiring_30d' || exp === 'expiring_60d' || exp === 'expiring_90d');
      if (!isExpiring) return false;
    }
    if (stockFilter === 'slow' && !isSlowMovingProduct(p, sales)) return false;
    const q = normalizeVietnameseSearch(searchQuery);
    if (!q) return true;
    return normalizeVietnameseSearch(
      `${p.name} ${p.code} ${p.barcode || ''} ${p.batchNumber || ''} ${p.category} ${p.supplierName} ${pWarehouse}`
    ).includes(q);
  });

  const handleApplySmartMinStock = () => {
    const changes = scopedBaseProducts
      .map((p) => ({ p, suggested: suggestMinStockFromVelocity(p, sales) }))
      .filter(
        (x): x is { p: ProductItem; suggested: number } =>
          x.suggested !== null && x.suggested !== x.p.minStock
      );
    if (changes.length === 0) {
      window.alert('Chưa có đề xuất mới: các vật tư chưa có doanh số 30 ngày hoặc định mức đã khớp.');
      return;
    }
    const preview = changes
      .slice(0, 8)
      .map((c) => `• ${c.p.name}: ${c.p.minStock} → ${c.suggested} ${c.p.unit}`)
      .join('\n');
    if (
      !window.confirm(
        `Áp dụng định mức tối thiểu thông minh cho ${changes.length} vật tư?\n(= doanh số 30 ngày × 7 ngày giao hàng × 1,5 an toàn)\n\n${preview}${
          changes.length > 8 ? `\n… và ${changes.length - 8} vật tư khác` : ''
        }`
      )
    ) {
      return;
    }
    for (const { p, suggested } of changes) {
      const { id: _id, ownerId: _owner, createdAt: _created, updatedAt: _updated, ...data } = p;
      void _id;
      void _owner;
      void _created;
      void _updated;
      onSaveProduct({ ...data, minStock: suggested }, p.id);
    }
  };

  const [inventoryRowLimit, setInventoryRowLimit] = useState<number>(80);
  useEffect(() => {
    setInventoryRowLimit(80);
  }, [searchQuery, warehouseFilter, categoryFilter, stockFilter]);

  const displayedProducts =
    focusedProductId && filteredProducts.findIndex((p) => p.id === focusedProductId) >= inventoryRowLimit
      ? filteredProducts
      : filteredProducts.slice(0, inventoryRowLimit);

  const lockedProductCodePreview = (() => {
    const previewWh =
      lockedWarehouse ||
      (warehouseName && warehouseName !== '__new_warehouse__'
        ? warehouseName
        : warehouses[0] || 'Tâm An Mỹ Ngãi');
    const cleanName = name.trim();
    if (editingProduct) {
      const ownCode = (editingProduct.code || '').trim();
      const sameName =
        normalizeVietnameseSearch(cleanName) === normalizeVietnameseSearch(editingProduct.name);
      if (
        sameName &&
        ownCode &&
        !findCollidingProductCodeInWarehouse(ownCode, products, previewWh, editingProduct.id)
      ) {
        return ownCode;
      }
      return generateUniqueProductCodeFromName(cleanName, products, previewWh, editingProduct.id, true);
    }
    return generateUniqueProductCodeFromName(cleanName, products, previewWh, undefined, true);
  })();

  const resetProductModalToBlank = () => {
    setCode('');
    setName('');
    setCategory('');
    setWarehouseName(lockedWarehouse || '');
    setUnit('');
    setImportPrice('');
    setSellPrice('');
    setStock('');
    setMinStock('');
    setSupplierName('');
    setBatchNumber('');
    setExpiryDate('');
    setBarcode('');
    setDosageGuide('');
    setGroupPriceInputs({});
    setInitialReceiptMode('pn_paid');
    setZeroPriceConfirmed(false);
    setProductFormError(null);
    setShowNewCategoryInput(false);
    setNewCategoryName('');
    setShowNewWarehouseInput(false);
    setNewWarehouseText('');
  };

  const openAddModal = () => {
    setEditingProduct(null);
    resetProductModalToBlank();
    const defaultWh = lockedWarehouse || (warehouseFilter !== 'all' ? warehouseFilter : warehouses[0] || '');
    setWarehouseName(defaultWh);
    setCode(generateNextUniqueProductCode(products, defaultWh));
    setIsModalOpen(true);
  };

  const openEditModal = (p: ProductItem) => {
    setEditingProduct(p);
    setCode(p.code);
    setName(p.name);
    setCategory(p.category);
    setWarehouseName(lockedWarehouse || p.warehouseName || 'Tâm An Mỹ Ngãi');
    setUnit(p.unit);
    setImportPrice(String(p.importPrice));
    setSellPrice(String(p.sellPrice));
    setStock(String(p.stock));
    setMinStock(String(p.minStock));
    setSupplierName(p.supplierName);
    setBatchNumber(p.batchNumber || '');
    setExpiryDate(p.expiryDate || '');
    setBarcode(p.barcode || '');
    setDosageGuide(p.dosageGuide || '');
    setGroupPriceInputs(
      Object.fromEntries(
        Object.entries(p.groupPrices || {}).map(([g, v]) => [g, String(v)])
      )
    );
    setShowNewCategoryInput(false);
    setNewCategoryName('');
    setShowNewWarehouseInput(false);
    setNewWarehouseText('');
    setIsModalOpen(true);
  };

  const handleConfirmInlineCategory = (): string | null => {
    const trimmed = newCategoryName.trim();
    if (!trimmed) return null;
    onAddProductCategory(trimmed);
    setCategory(trimmed);
    setShowNewCategoryInput(false);
    setNewCategoryName('');
    return trimmed;
  };

  const handleConfirmInlineWarehouse = (): string | null => {
    const trimmed = newWarehouseText.trim();
    if (!trimmed) return null;
    onAddWarehouse(trimmed);
    setWarehouseName(trimmed);
    setShowNewWarehouseInput(false);
    setNewWarehouseText('');
    return trimmed;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    let resolvedCategory = category;
    if (showNewCategoryInput || category === '__new_category__') {
      const createdCat = handleConfirmInlineCategory();
      if (createdCat) resolvedCategory = createdCat;
    }
    if (!resolvedCategory || resolvedCategory === '__new_category__') {
      resolvedCategory = productCategories[0] || 'Phân bón';
    }

    let resolvedWarehouse = lockedWarehouse || warehouseName;
    if (!lockedWarehouse && (showNewWarehouseInput || warehouseName === '__new_warehouse__')) {
      const createdWh = handleConfirmInlineWarehouse();
      if (createdWh) resolvedWarehouse = createdWh;
    }
    if (!resolvedWarehouse || resolvedWarehouse === '__new_warehouse__') {
      resolvedWarehouse = warehouses[0] || 'Tâm An Mỹ Ngãi';
    }

    const finalSafeCode =
      lockedProductCodePreview ||
      generateUniqueProductCodeFromName(name, products, resolvedWarehouse, editingProduct?.id);

    const openingStockNum = Math.max(0, Number(stock) || 0);
    const importPriceNum = Math.max(0, Number(importPrice) || 0);
    if (!editingProduct && openingStockNum > 0 && importPriceNum <= 0 && !zeroPriceConfirmed) {
      setProductFormError(
        'Tồn kho ban đầu > 0 nhưng Giá nhập đang là 0 đ. Vui lòng nhập Giá nhập thực tế (> 0 đ), hoặc tích chọn "Đây là hàng tặng / hàng mẫu 0 đ" bên dưới.'
      );
      return;
    }
    setProductFormError(null);

    onSaveProduct(
      {
        code: finalSafeCode,
        name: name.trim(),
        category: resolvedCategory,
        warehouseName: resolvedWarehouse,
        unit: unit.trim() || 'Bao',
        importPrice: importPriceNum,
        sellPrice: Math.max(0, Number(sellPrice) || 0),
        stock: openingStockNum,
        minStock: Math.max(0, Number(minStock) || (editingProduct ? 10 : 5)),
        supplierName: supplierName.trim() || 'Nhà cung cấp VTNN',
        batchNumber: batchNumber.trim() || undefined,
        expiryDate: expiryDate.trim() || undefined,
        barcode: barcode.trim() || undefined,
        dosageGuide: dosageGuide.trim() || undefined,
        groupPrices: (() => {
          const entries = Object.entries(groupPriceInputs)
            .map(([g, v]) => [g, Math.round(Number(v) || 0)] as const)
            .filter(([, v]) => v > 0);
          return entries.length > 0 ? Object.fromEntries(entries) : undefined;
        })(),
      },
      editingProduct?.id,
      !editingProduct && openingStockNum > 0 && initialReceiptMode !== 'opening_only'
        ? {
            createInitialImportReceipt: true,
            initialImportPaidMode: initialReceiptMode === 'pn_debt' ? 'debt' : 'paid',
          }
        : undefined
    );
    resetProductModalToBlank();
    setIsModalOpen(false);
  };

  return (
    <div className="space-y-5">
      {/* 4 Interactive Inventory Overview KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => setStockFilter('all')}
          className={`text-left bg-white p-4 rounded-xl border transition-colors ${
            stockFilter === 'all'
              ? 'border-emerald-600 ring-2 ring-emerald-500/15'
              : 'border-slate-200 hover:border-emerald-300'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Tổng Danh Mục &amp; Tồn Kho</span>
            <Boxes className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1.5">
            {inventorySummaryKpis.productCount} mặt hàng
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Tổng tồn:{' '}
            <strong className="font-mono text-emerald-800">
              {inventorySummaryKpis.totalUnits.toLocaleString('vi-VN')} ĐVT
            </strong>
          </div>
        </button>

        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Tổng Giá Trị Tồn Kho</span>
            <TrendingUp className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="text-xl font-bold font-mono tabular-nums text-emerald-800 mt-1.5">
            {formatVND(inventorySummaryKpis.totalCostValue)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Giá trị bán lẻ:{' '}
            <strong className="font-mono text-slate-800">
              {formatVND(inventorySummaryKpis.totalRetailValue)}
            </strong>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Tổng Nhập / Xuất Lũy Kế</span>
            <History className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="flex items-baseline gap-3 mt-1.5 font-mono tabular-nums">
            <span className="text-base font-bold text-emerald-700">
              +{inventorySummaryKpis.totalInUnits.toLocaleString('vi-VN')} nhập
            </span>
            <span className="text-slate-300">|</span>
            <span className="text-base font-bold text-amber-700">
              -{inventorySummaryKpis.totalOutUnits.toLocaleString('vi-VN')} xuất
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Bấm vào từng mặt hàng bên dưới để xem chi tiết Xuất - Nhập - Tồn
          </div>
        </div>

        <button
          type="button"
          onClick={() =>
            setStockFilter((prev) => (prev === 'low_or_out' ? 'all' : 'low_or_out'))
          }
          className={`text-left bg-white p-4 rounded-xl border transition-colors ${
            stockFilter === 'low_or_out'
              ? 'border-amber-600 ring-2 ring-amber-500/15'
              : 'border-slate-200 hover:border-amber-300'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Cảnh Báo Sắp Hết / Hết Hàng</span>
            <AlertTriangle className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-xl font-bold font-mono tabular-nums text-amber-700 mt-1.5">
            {inventorySummaryKpis.alertTotal} mặt hàng
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Hết hàng: <strong className="text-red-600">{inventorySummaryKpis.outCount}</strong> · Sắp hết:{' '}
            <strong className="text-amber-700">{inventorySummaryKpis.lowCount}</strong>
          </div>
        </button>
      </div>

      {/* Alert Banner for Low Stock / Expiry */}
      {(lowStockCount > 0 || expiringOrExpiredCount > 0) && (
        <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <div className="text-sm font-bold text-slate-900">
              {lowStockCount > 0 && (
                <span>Cảnh báo tồn kho ({lowStockCount} mặt hàng chạm định mức tối thiểu)</span>
              )}
              {lowStockCount > 0 && expiringOrExpiredCount > 0 && <span className="mx-2 text-slate-400">·</span>}
              {expiringOrExpiredCount > 0 && (
                <span className="text-red-700">
                  {expiringOrExpiredCount} mặt hàng sắp hết hạn / quá hạn (FEFO)
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {expiringOrExpiredCount > 0 && (
              <button
                type="button"
                onClick={() =>
                  setStockFilter((prev) => (prev === 'expiring' ? 'all' : 'expiring'))
                }
                className="px-3 py-1.5 text-xs font-semibold bg-white text-red-700 border border-red-200 rounded-lg hover:bg-red-50 transition-colors whitespace-nowrap"
              >
                {stockFilter === 'expiring'
                  ? 'Xem toàn bộ kho'
                  : `Lọc ${expiringOrExpiredCount} hàng sắp hết hạn`}
              </button>
            )}
            {lowStockCount > 0 && (
              <button
                type="button"
                onClick={() =>
                  setStockFilter((prev) => (prev === 'low_or_out' ? 'all' : 'low_or_out'))
                }
                className="px-3.5 py-1.5 text-xs font-semibold bg-white text-amber-800 border border-amber-300 rounded-lg hover:bg-amber-100/50 transition-colors whitespace-nowrap"
              >
                {stockFilter === 'low_or_out'
                  ? 'Xem toàn bộ kho'
                  : `Chỉ xem ${lowStockCount} mặt hàng sắp hết`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Smart Reorder Suggestions Panel */}
      {smartReorderSuggestions.length > 0 && (
        <div className="bg-white border border-emerald-200 rounded-xl p-4 space-y-3 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-700 shrink-0" />
              <h3 className="text-xs sm:text-sm font-bold text-slate-900">
                Đề Xuất Nhập Hàng Thông Minh ({smartReorderSuggestions.length} vật tư cần nhập theo tốc độ bán 30 ngày)
              </h3>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() =>
                  exportSmartReorderExcel(
                    smartReorderSuggestions,
                    lockedWarehouse || (warehouseFilter !== 'all' ? warehouseFilter : 'Tất cả kho')
                  )
                }
                className="px-2.5 py-1 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg flex items-center gap-1"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Xuất Excel Đề Xuất</span>
              </button>
              <button
                type="button"
                onClick={() => setShowSmartReorderPanel((v) => !v)}
                className="px-2.5 py-1 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg"
              >
                {showSmartReorderPanel ? 'Thu gọn' : 'Mở rộng'}
              </button>
            </div>
          </div>
          {showSmartReorderPanel && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {smartReorderSuggestions.slice(0, 6).map((item) => (
                <div
                  key={item.product.id}
                  className={`p-3 rounded-lg border flex flex-col justify-between gap-2 text-xs ${
                    item.urgency === 'critical'
                      ? 'bg-red-50/60 border-red-200'
                      : 'bg-amber-50/50 border-amber-200'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-slate-900 truncate">{item.product.name}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                          item.urgency === 'critical'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {item.urgency === 'critical' ? 'Khẩn cấp' : 'Sắp thiếu'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-600 mt-1 font-mono">
                      Tồn: <strong>{item.product.stock}</strong> {item.product.unit} · Bán TB:{' '}
                      <strong>{Number(item.dailyVelocity.toFixed(2))}</strong>/ngày
                      {item.daysOfStockLeft !== null ? ` (còn ~${item.daysOfStockLeft} ngày)` : ''}
                    </div>
                    <div className="text-[11px] text-emerald-800 font-semibold mt-0.5 font-mono">
                      Gợi ý nhập: +{item.suggestedOrderQty} {item.product.unit} (~{formatVND(item.estimatedCost)})
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onQuickRestock(item.product.id)}
                    className="w-full py-1.5 text-[11px] font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors"
                  >
                    Nhập ngay (+{item.suggestedOrderQty} {item.product.unit})
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Linked Product Inspector when navigating from Low Stock Notification or Dashboard */}
      {focusedProductId &&
        (() => {
          const linkedProd = products.find((p) => p.id === focusedProductId);
          if (!linkedProd) return null;
          return (
            <div className="bg-emerald-50/90 border-2 border-emerald-600 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="text-xs space-y-1">
                <div className="font-bold text-emerald-900">
                  VẬT TƯ ĐƯỢC LIÊN KẾT TRỰC TIẾP TỪ THÔNG BÁO: [{linkedProd.code}] {linkedProd.name}
                </div>
                <div className="text-slate-700">
                  Kho: <strong>{linkedProd.warehouseName || 'Tâm An Mỹ Ngãi'}</strong> · Tồn hiện tại:{' '}
                  <strong className="text-red-600 font-mono">
                    {linkedProd.stock} {linkedProd.unit}
                  </strong>{' '}
                  (Định mức tối thiểu: {linkedProd.minStock} {linkedProd.unit}) · Giá nhập:{' '}
                  <span className="font-mono">{formatVND(linkedProd.importPrice)}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onQuickRestock(linkedProd.id)}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg"
                >
                  Nhập thêm kho ngay
                </button>
                {canPerformRoleAction(role, 'edit_record') && (
                  <button
                    type="button"
                    onClick={() => openEditModal(linkedProd)}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg"
                  >
                    Sửa vật tư
                  </button>
                )}
                {onClearFocusedProduct && (
                  <button
                    type="button"
                    onClick={onClearFocusedProduct}
                    className="px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg"
                  >
                    Đóng
                  </button>
                )}
              </div>
            </div>
          );
        })()}

      {/* Filter & Action Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3 flex-1">
          <div className="flex items-center gap-1.5 flex-1 sm:min-w-[240px]">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm tên vật tư, mã VT, barcode, nhà cung cấp..."
                aria-label="Tìm kiếm vật tư tồn kho"
                className="w-full pl-10 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg"
              />
            </div>
            <button
              type="button"
              onClick={() => setBarcodeScanTarget('search')}
              title="Quét mã vạch bằng camera hoặc đầu đọc USB"
              className="px-2.5 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg flex items-center gap-1 shrink-0"
            >
              <QrCode className="w-4 h-4" />
              <span className="hidden sm:inline">Quét mã</span>
            </button>
          </div>

          {lockedWarehouse ? (
            <div className="px-3 py-2 text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg flex items-center gap-1.5">
              <Warehouse className="w-3.5 h-3.5 shrink-0" />
              <span>Kho quản lý riêng: {lockedWarehouse}</span>
            </div>
          ) : (
            <select
              aria-label="Lọc theo kho hàng"
              value={warehouseFilter}
              onChange={(e) => setWarehouseFilter(e.target.value)}
              className="px-3 py-2 text-xs font-semibold bg-white border border-slate-200 rounded-lg text-emerald-800"
            >
              <option value="all">Tất cả kho ({warehouses.length} kho)</option>
              {warehouses.map((w) => (
                <option key={w} value={w}>
                  Kho: {w}
                </option>
              ))}
            </select>
          )}

          <select
            aria-label="Lọc theo danh mục vật tư"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as ProductCategory | 'all')}
            className="px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-800"
          >
            <option value="all">Tất cả nhóm vật tư ({productCategories.length})</option>
            {productCategories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          <select
            aria-label="Lọc trạng thái tồn kho"
            value={stockFilter}
            onChange={(e) =>
              setStockFilter(
                e.target.value as 'all' | 'low_or_out' | 'out_of_stock' | 'normal' | 'expiring' | 'slow'
              )
            }
            className="px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-800"
          >
            <option value="all">Tất cả trạng thái tồn</option>
            <option value="normal">Đủ tồn kho</option>
            <option value="low_or_out">Sắp hết / Hết hàng</option>
            <option value="out_of_stock">Chỉ hết hàng (0)</option>
            <option value="expiring">Sắp hết hạn / Quá hạn ({expiringOrExpiredCount})</option>
            <option value="slow">Hàng chậm bán (60 ngày không bán)</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <TableDensityToggle density={tableDensity} onChange={setTableDensity} />
          {canPerformRoleAction(role, 'edit_record') && (
            <button
              type="button"
              onClick={handleApplySmartMinStock}
              title="Tự tính định mức tối thiểu = doanh số bán 30 ngày × 7 ngày giao hàng × 1,5 an toàn"
              className="px-3.5 py-2 text-xs font-semibold text-violet-800 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-lg transition-colors flex items-center justify-center gap-1.5 shrink-0"
            >
              <Sparkles className="w-4 h-4" />
              <span>Áp dụng định mức thông minh</span>
            </button>
          )}
          {onTransferStock &&
            canPerformRoleAction(role, 'edit_record') &&
            !lockedWarehouse &&
            warehouses.length >= 2 && (
              <button
                type="button"
                onClick={() => {
                  const first = scopedBaseProducts.find((p) => (Number(p.stock) || 0) > 0);
                  setTransferProductId(first?.id || '');
                  const firstWh = first?.warehouseName || '';
                  setTransferDestWarehouse(
                    warehouses.find((w) => !areWarehouseNamesEquivalent(w, firstWh)) || ''
                  );
                  setTransferQty('1');
                  setTransferNote('');
                  setIsTransferModalOpen(true);
                }}
                className="px-3.5 py-2 text-xs font-semibold text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors flex items-center justify-center gap-1.5 shrink-0"
              >
                <Warehouse className="w-4 h-4" />
                <span>Chuyển kho</span>
              </button>
            )}
          {onExecuteStocktake && canPerformRoleAction(role, 'edit_record') && (
            <button
              type="button"
              onClick={() => {
                const firstProd = scopedBaseProducts[0];
                setStocktakeProductId(firstProd?.id || '');
                setStocktakeActualQty(firstProd ? String(firstProd.stock) : '');
                setStocktakeReason('Kiểm kê định kỳ');
                setStocktakeNote('');
                setStocktakeFeedback(null);
                setIsStocktakeModalOpen(true);
              }}
              className="px-3.5 py-2 text-xs font-semibold text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors flex items-center justify-center gap-1.5 shrink-0"
            >
              <ClipboardCheck className="w-4 h-4" />
              <span>Kiểm kê kho</span>
            </button>
          )}
          {onRequestAddNewProductInImports && (
            <button
              type="button"
              onClick={onRequestAddNewProductInImports}
              className="px-3.5 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors flex items-center justify-center gap-1.5 shrink-0"
            >
              <ArrowDownToLine className="w-4 h-4" />
              <span>Nhập hàng &amp; VT mới</span>
            </button>
          )}
          <button
            type="button"
            onClick={openAddModal}
            className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors flex items-center justify-center gap-2 shrink-0"
          >
            <PackagePlus className="w-4 h-4" />
            <span>Thêm vật tư mới</span>
          </button>
        </div>
      </div>

      {/* Inventory Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {/* Mobile Card View (< md): Full-width balanced layout, zero column squishing */}
        <div className="md:hidden divide-y divide-slate-200">
          {filteredProducts.length === 0 ? (
            <div className="py-10 px-4 text-center text-xs text-slate-500">
              Không tìm thấy vật tư nông nghiệp nào khớp với bộ lọc hiện tại.
            </div>
          ) : (
            displayedProducts.map((p) => {
              const alert = evaluateStockAlert(p);
              const movCounts = productMovementCounts.get(p.id) || { qtyIn: 0, qtyOut: 0 };
              const mobileIntegrity = evaluateProductStockIntegrity(p, sales, imports, stockAdjustments);
              return (
                <div
                  key={p.id}
                  onClick={() => {
                    setLedgerFromDate('');
                    setLedgerToDate('');
                    setLedgerTypeFilter('all');
                    setDetailProductId(p.id);
                  }}
                  className={`${
                    isCompactTable ? 'p-2.5 space-y-1.5' : 'p-4 space-y-3'
                  } hover:bg-emerald-50/40 cursor-pointer transition-colors`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                        <span className="truncate">{p.name}</span>
                        <Eye className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5">
                        <span className="font-mono font-semibold text-slate-700">{p.code}</span>
                        <span aria-hidden="true">·</span>
                        <span>ĐVT: {p.unit}</span>
                        <span aria-hidden="true">·</span>
                        {mobileIntegrity.impliedOpeningStock > 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200 font-mono text-[10px] font-semibold">
                            Đầu kỳ {mobileIntegrity.impliedOpeningStock}
                          </span>
                        )}
                        {p.sellPrice > 0 && p.sellPrice === p.importPrice && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold">
                            Lãi 0%
                          </span>
                        )}
                        <span className="font-mono text-emerald-700">+{movCounts.qtyIn}</span>
                        <span className="font-mono text-amber-700">-{movCounts.qtyOut}</span>
                        {p.batchNumber && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px]">
                            Lô: {p.batchNumber}
                          </span>
                        )}
                        {p.expiryDate &&
                          (() => {
                            const exp = evaluateProductExpiry(p.expiryDate);
                            return (
                              <span
                                className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-semibold ${
                                  exp.status === 'expired'
                                    ? 'bg-red-100 text-red-700'
                                    : exp.status === 'expiring_30d' || exp.status === 'expiring_60d'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-emerald-50 text-emerald-700'
                                }`}
                              >
                                HSD: {p.expiryDate}
                              </span>
                            );
                          })()}
                      </div>
                    </div>
                    <span className="px-2 py-0.5 text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-md whitespace-nowrap shrink-0 flex items-center gap-1">
                      <Warehouse className="w-3 h-3 shrink-0" />
                      <span>{p.warehouseName || 'Tâm An Mỹ Ngãi'}</span>
                    </span>
                  </div>

                  <div className="text-xs text-slate-600">
                    <span className="font-semibold text-slate-800">{p.category}</span>
                    <span className="mx-1.5" aria-hidden="true">·</span>
                    <span>NCC: {p.supplierName}</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-xs">
                    <div>
                      <div className="text-[11px] text-slate-500">Giá nhập</div>
                      <div className="font-mono tabular-nums text-slate-700 font-semibold mt-0.5">
                        {formatVND(p.importPrice)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Giá bán</div>
                      <div className="font-mono tabular-nums text-slate-900 font-bold mt-0.5">
                        {formatVND(p.sellPrice)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] text-slate-500">Tồn / Tối thiểu</div>
                      <div className="font-mono tabular-nums mt-0.5">
                        <span
                          className={`font-bold ${
                            alert === 'out_of_stock'
                              ? 'text-red-600'
                              : alert === 'low_stock'
                              ? 'text-amber-700'
                              : 'text-slate-900'
                          }`}
                        >
                          {p.stock}
                        </span>
                        <span className="text-slate-400"> / {p.minStock}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                    <div className="text-xs">
                      {alert === 'out_of_stock' ? (
                        <span className="text-red-600 font-bold flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>Hết hàng (0)</span>
                        </span>
                      ) : alert === 'low_stock' ? (
                        <span className="text-amber-700 font-semibold flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>Sắp hết hàng</span>
                        </span>
                      ) : (
                        <span className="text-emerald-700 font-medium flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>Đủ tồn kho</span>
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLedgerFromDate('');
                          setLedgerToDate('');
                          setLedgerTypeFilter('all');
                          setDetailProductId(p.id);
                        }}
                        className="px-2.5 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-md flex items-center gap-1 whitespace-nowrap"
                      >
                        <Eye className="w-3 h-3" />
                        <span>Chi tiết XNT</span>
                      </button>
                      {canPerformRoleAction(role, 'edit_record') ? (
                        <>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditModal(p);
                            }}
                            aria-label={`Sửa vật tư ${p.name}`}
                            className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md flex items-center gap-1 whitespace-nowrap"
                          >
                            <Pencil className="w-3 h-3" />
                            <span>Sửa</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (
                                window.confirm(
                                  `Xác nhận xóa vật tư "${p.name}" (${p.code}) khỏi danh mục kho?`
                                )
                              ) {
                                onDeleteProduct(p.id);
                              }
                            }}
                            aria-label={`Xóa vật tư ${p.name}`}
                            className="p-1.5 text-slate-400 hover:text-red-600 rounded-md border border-slate-200"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        <span
                          title="Chỉ Quản lý mới có quyền sửa hoặc xóa vật tư đã lưu"
                          className="px-2 py-1 text-[11px] text-slate-400 flex items-center gap-1 whitespace-nowrap"
                        >
                          <Lock className="w-3 h-3" />
                          <span>Khóa sửa/xóa</span>
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onQuickRestock(p.id);
                        }}
                        aria-label={`Nhập thêm ngay cho ${p.name}`}
                        className={`px-2.5 py-1.5 text-xs font-semibold rounded-md flex items-center gap-1 whitespace-nowrap ${
                          alert !== 'normal'
                            ? 'bg-amber-600 text-white hover:bg-amber-700'
                            : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        }`}
                      >
                        <ArrowDownToLine className="w-3 h-3" />
                        <span>Nhập thêm ngay</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Desktop Balanced Table (>= md) */}
        <div className="hidden md:block overflow-x-auto max-h-[72vh]">
          <table className="w-full min-w-[980px] text-left border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-xs shadow-2xs">
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4 min-w-[230px]">Mã & Tên vật tư</th>
                <th className="py-3 px-4 w-[135px] whitespace-nowrap">Kho lưu trữ</th>
                <th className="py-3 px-4 min-w-[190px]">Nhóm & Nhà cung cấp</th>
                <th className="py-3 px-4 w-[105px] text-right whitespace-nowrap">Giá nhập</th>
                <th className="py-3 px-4 w-[105px] text-right whitespace-nowrap">Giá bán</th>
                <th className="py-3 px-4 w-[135px] text-right whitespace-nowrap">Tồn kho / Định mức</th>
                <th className="py-3 px-4 w-[135px] whitespace-nowrap">Trạng thái cảnh báo</th>
                <th className="py-3 px-4 w-[190px] text-right whitespace-nowrap">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 px-4 text-center text-xs text-slate-500">
                    Chưa có vật tư nông nghiệp nào khớp với bộ lọc hiện tại. Bấm &quot;+ Nhập hàng &amp; VT mới&quot; hoặc &quot;+ Thêm vật tư mới&quot; để khởi tạo danh mục kho.
                  </td>
                </tr>
              ) : (
              displayedProducts.map((p) => {
                const alert = evaluateStockAlert(p);
                const movCounts = productMovementCounts.get(p.id) || { qtyIn: 0, qtyOut: 0 };
                const integrity = evaluateProductStockIntegrity(p, sales, imports, stockAdjustments);
                const invCellPad = isCompactTable ? 'py-1.5 px-3' : 'py-3.5 px-4';
                return (
                  <tr
                    key={p.id}
                    onClick={() => {
                      setLedgerFromDate('');
                      setLedgerToDate('');
                      setLedgerTypeFilter('all');
                      setDetailProductId(p.id);
                    }}
                    title="Bấm để xem Chi tiết Xuất - Nhập - Tồn kho của mặt hàng này"
                    className={`cursor-pointer transition-colors ${
                      integrity.hasNegativeDrift
                        ? 'bg-amber-50/40 hover:bg-amber-50/80'
                        : 'hover:bg-emerald-50/50'
                    }`}
                  >
                    <td className={`${invCellPad} min-w-[230px] align-middle`}>
                      <div className="font-semibold text-slate-900 leading-snug flex flex-wrap items-center gap-1.5">
                        <span>{p.name}</span>
                        <Eye className="w-3.5 h-3.5 text-emerald-700 shrink-0 opacity-75" />
                        {integrity.hasNegativeDrift && (
                          <span
                            title={`Tồn hiện tại ${p.stock} < tồn theo chứng từ XNT ${integrity.recommendedReconciledStock}. Bấm để đối soát thẻ kho.`}
                            className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 rounded"
                          >
                            Lệch XNT ({p.stock}/{integrity.recommendedReconciledStock})
                          </span>
                        )}
                        {duplicateCodeProductIds.has(p.id) && (
                          <span
                            title={`Mã vật tư ${p.code} đang bị trùng với mặt hàng khác trong cùng kho. Bấm Sửa để đổi mã riêng.`}
                            className="px-1.5 py-0.5 text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300 rounded"
                          >
                            Trùng mã {p.code}
                          </span>
                        )}
                        {p.sellPrice > 0 && p.sellPrice < p.importPrice && (
                          <span
                            title={`Giá bán lẻ (${formatVND(p.sellPrice)}) đang thấp hơn giá vốn bình quân (${formatVND(p.importPrice)})`}
                            className="px-1.5 py-0.5 text-[10px] font-bold bg-red-100 text-red-700 border border-red-300 rounded"
                          >
                            Bán &lt; Giá vốn
                          </span>
                        )}
                        {p.sellPrice > 0 && p.sellPrice === p.importPrice && (
                          <span
                            title="Giá bán bằng giá vốn: bán ra không có lãi"
                            className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 rounded"
                          >
                            Lãi 0%
                          </span>
                        )}
                      </div>
                      {(!isCompactTable || integrity.hasNegativeDrift) && (
                      <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5">
                        <span className="font-mono">{p.code}</span>
                        <span aria-hidden="true">·</span>
                        <span>Đơn vị: {p.unit}</span>
                        <span aria-hidden="true">·</span>
                        {integrity.impliedOpeningStock > 0 && (
                          <span
                            title="Phần tồn có sẵn từ lúc tạo vật tư, chưa có phiếu nhập kho tương ứng"
                            className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200 font-mono text-[10px] font-semibold"
                          >
                            Đầu kỳ {integrity.impliedOpeningStock}
                          </span>
                        )}
                        <span className="font-mono text-emerald-700 font-semibold">
                          +{movCounts.qtyIn}
                        </span>
                        <span className="font-mono text-amber-700 font-semibold">
                          -{movCounts.qtyOut}
                        </span>
                        {p.barcode && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[10px]">
                            BC: {p.barcode}
                          </span>
                        )}
                        {p.batchNumber && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px]">
                            Lô: {p.batchNumber}
                          </span>
                        )}
                        {p.expiryDate &&
                          (() => {
                            const exp = evaluateProductExpiry(p.expiryDate);
                            return (
                              <span
                                className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-semibold ${
                                  exp.status === 'expired'
                                    ? 'bg-red-100 text-red-700'
                                    : exp.status === 'expiring_30d' || exp.status === 'expiring_60d'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-emerald-50 text-emerald-700'
                                }`}
                              >
                                HSD: {p.expiryDate} ({exp.badgeLabel})
                              </span>
                            );
                          })()}
                      </div>
                      )}
                    </td>
                    <td className={`${invCellPad} whitespace-nowrap align-middle`}>
                      <span className="text-xs font-semibold text-emerald-800 flex items-center gap-1">
                        <Warehouse className="w-3.5 h-3.5 shrink-0" />
                        <span>{p.warehouseName || 'Tâm An Mỹ Ngãi'}</span>
                      </span>
                    </td>
                    <td className={`${invCellPad} min-w-[190px] align-middle`}>
                      <div className="text-xs font-medium text-slate-800 leading-snug">{p.category}</div>
                      {!isCompactTable && (
                        <div className="text-xs text-slate-500 mt-0.5 leading-snug">{p.supplierName}</div>
                      )}
                    </td>
                    <td className={`${invCellPad} text-right font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap align-middle`}>
                      {formatVND(p.importPrice)}
                    </td>
                    <td className={`${invCellPad} text-right font-mono tabular-nums text-xs font-semibold text-slate-900 whitespace-nowrap align-middle`}>
                      {formatVND(p.sellPrice)}
                    </td>
                    <td className={`${invCellPad} text-right font-mono tabular-nums whitespace-nowrap align-middle`}>
                      <span
                        className={`text-sm font-bold ${
                          alert === 'out_of_stock'
                            ? 'text-red-600'
                            : alert === 'low_stock'
                            ? 'text-amber-700'
                            : 'text-slate-900'
                        }`}
                      >
                        {p.stock}
                      </span>
                      <span className="text-xs text-slate-400">
                        {' '}
                        / {p.minStock} {p.unit}
                      </span>
                    </td>
                    <td className={`${invCellPad} text-xs whitespace-nowrap align-middle`}>
                      {alert === 'out_of_stock' ? (
                        <span className="text-red-600 font-bold flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>Hết hàng (0)</span>
                        </span>
                      ) : alert === 'low_stock' ? (
                        <span className="text-amber-700 font-semibold flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>Sắp hết hàng</span>
                        </span>
                      ) : (
                        <span className="text-emerald-700 font-medium flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>Đủ tồn kho</span>
                        </span>
                      )}
                    </td>
                    <td className={`${invCellPad} text-right whitespace-nowrap align-middle`}>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLedgerFromDate('');
                            setLedgerToDate('');
                            setLedgerTypeFilter('all');
                            setDetailProductId(p.id);
                          }}
                          title="Xem chi tiết Xuất - Nhập - Tồn kho"
                          className="px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-md flex items-center gap-1 whitespace-nowrap"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Chi tiết</span>
                        </button>
                        {canPerformRoleAction(role, 'edit_record') ? (
                          <>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditModal(p);
                              }}
                              aria-label={`Sửa vật tư ${p.name}`}
                              className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md flex items-center gap-1 whitespace-nowrap"
                            >
                              <Pencil className="w-3 h-3" />
                              <span>Sửa</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (
                                  window.confirm(
                                    `Xác nhận xóa vật tư "${p.name}" (${p.code}) khỏi danh mục kho?`
                                  )
                                ) {
                                  onDeleteProduct(p.id);
                                }
                              }}
                              aria-label={`Xóa vật tư ${p.name}`}
                              className="p-1.5 text-slate-400 hover:text-red-600 rounded-md"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <span
                            title="Chỉ Quản lý mới có quyền sửa hoặc xóa vật tư đã lưu"
                            className="px-2 py-1 text-[11px] text-slate-400 flex items-center gap-1 whitespace-nowrap"
                          >
                            <Lock className="w-3 h-3" />
                            <span>Khóa sửa/xóa</span>
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onQuickRestock(p.id);
                          }}
                          aria-label={`Nhập thêm ngay cho ${p.name}`}
                          className={`px-2.5 py-1 text-xs font-semibold rounded-md flex items-center gap-1 whitespace-nowrap ${
                            alert !== 'normal'
                              ? 'bg-amber-600 text-white hover:bg-amber-700'
                              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          }`}
                        >
                          <ArrowDownToLine className="w-3 h-3" />
                          <span>Nhập thêm ngay</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
              )}
            </tbody>
            {filteredProducts.length > 0 &&
              (() => {
                let sumStock = 0;
                let sumIn = 0;
                let sumOut = 0;
                let sumCostVal = 0;
                let sumRetailVal = 0;
                for (const p of filteredProducts) {
                  const stk = Math.max(0, Number(p.stock) || 0);
                  sumStock += stk;
                  sumCostVal += stk * Math.max(0, Number(p.importPrice) || 0);
                  sumRetailVal += stk * Math.max(0, Number(p.sellPrice) || 0);
                  const mv = productMovementCounts.get(p.id);
                  if (mv) {
                    sumIn += mv.qtyIn;
                    sumOut += mv.qtyOut;
                  }
                }
                const estProfit = sumRetailVal - sumCostVal;
                return (
                  <tfoot className="border-t-2 border-emerald-200 bg-emerald-50/70 text-xs font-semibold text-slate-800">
                    <tr>
                      <td colSpan={3} className="py-3 px-4">
                        <span>
                          Tổng kết bộ lọc: <strong>{filteredProducts.length}</strong> mặt hàng
                        </span>
                        <span className="mx-2 text-slate-400">·</span>
                        <span className="font-mono text-emerald-800">+{sumIn.toLocaleString('vi-VN')} nhập</span>
                        <span className="mx-1.5 text-slate-400">/</span>
                        <span className="font-mono text-amber-800">-{sumOut.toLocaleString('vi-VN')} xuất</span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono whitespace-nowrap text-slate-700">
                        <div>∑ Vốn tồn:</div>
                        <div className="font-bold text-slate-900">{formatVND(sumCostVal)}</div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono whitespace-nowrap text-emerald-800">
                        <div>∑ Giá trị bán:</div>
                        <div className="font-bold">{formatVND(sumRetailVal)}</div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono whitespace-nowrap">
                        <div className="text-[11px] text-slate-500">∑ Tồn hiện tại</div>
                        <div className="text-sm font-bold text-slate-900">
                          {sumStock.toLocaleString('vi-VN')} ĐVT
                        </div>
                      </td>
                      <td colSpan={2} className="py-3 px-4 text-right font-mono whitespace-nowrap">
                        <div className="text-[11px] text-slate-500">Lãi gộp tiềm năng kho</div>
                        <div
                          className={`font-bold ${
                            estProfit >= 0 ? 'text-emerald-800' : 'text-red-600'
                          }`}
                        >
                          {estProfit >= 0 ? '+' : ''}
                          {formatVND(estProfit)}
                        </div>
                      </td>
                    </tr>
                  </tfoot>
                );
              })()}
          </table>
        </div>
        {filteredProducts.length > displayedProducts.length && (
          <div className="p-3.5 border-t border-slate-200 bg-slate-50/70 text-center">
            <button
              type="button"
              onClick={() => setInventoryRowLimit((prev) => prev + 80)}
              className="px-4 py-2 text-xs font-semibold text-emerald-800 bg-white hover:bg-emerald-50 border border-emerald-300 rounded-lg shadow-2xs transition-colors"
            >
              Hiển thị thêm mặt hàng (Đang xem {displayedProducts.length} / {filteredProducts.length} vật tư)
            </button>
          </div>
        )}
      </div>

      {/* Excel Sample Template Download & Upload Bar (Moved to bottom of page) */}
      <ExcelDataBar
        moduleType="inventory"
        moduleTitle="Quản Lý Tồn Kho Vật Tư"
        onImportRows={onImportProductsFromExcel}
        validationContext={{
          products,
          sales,
          imports,
          lockedWarehouse,
          defaultWarehouse: warehouses[0] || 'Tâm An Mỹ Ngãi',
        }}
        onExportCurrentData={() =>
          exportModuleDataExcel({
            moduleType: 'inventory',
            products: filteredProducts,
            customers,
            sales,
            imports,
          })
        }
      />

      {/* Add / Edit Product Modal with Inline Category & Warehouse Creation */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2.5 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={editingProduct ? 'Cập nhật vật tư' : 'Thêm vật tư mới'}
        >
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-lg max-h-[calc(100dvh-1.25rem)] sm:max-h-[90vh] flex flex-col overflow-hidden shadow-xl">
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 flex items-center justify-between shrink-0 bg-white">
              <h3 className="text-sm sm:text-base font-bold text-slate-900">
                {editingProduct ? 'Cập nhật vật tư nông nghiệp' : 'Thêm vật tư nông nghiệp mới'}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                aria-label="Đóng cửa sổ vật tư"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
              <div className="p-4 sm:p-6 space-y-3.5 sm:space-y-4 overflow-y-auto flex-1 overscroll-contain">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label
                    htmlFor="prod-code"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    <span className="inline-flex items-center gap-1">
                      <Lock className="w-3 h-3 text-slate-500" /> Mã VT (Tự sinh)
                    </span>
                  </label>
                  <input
                    id="prod-code"
                    type="text"
                    readOnly
                    tabIndex={-1}
                    value={lockedProductCodePreview}
                    placeholder="Tự sinh theo tên VT"
                    className="w-full px-3 py-2 text-sm font-mono font-bold bg-slate-100 text-emerald-800 border border-slate-200 rounded-lg cursor-not-allowed select-all"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label
                    htmlFor="prod-name"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Tên vật tư nông nghiệp *
                  </label>
                  <input
                    id="prod-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="VD: Phân bón Kali Phú Mỹ"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              {/* Warehouse Selector + Inline Warehouse Creation */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-1">
                  <label
                    htmlFor="prod-warehouse"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Kho lưu trữ vật tư *
                  </label>
                  {!lockedWarehouse && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = !showNewWarehouseInput;
                        setShowNewWarehouseInput(next);
                        setWarehouseName(next ? '__new_warehouse__' : '');
                      }}
                      className="text-[11px] font-semibold text-emerald-700 hover:underline flex items-center gap-0.5 whitespace-nowrap"
                    >
                      <FolderPlus className="w-3 h-3" />
                      <span>{showNewWarehouseInput ? 'Đóng' : '+ Tạo thêm kho mới'}</span>
                    </button>
                  )}
                </div>

                {lockedWarehouse ? (
                  <input
                    type="text"
                    disabled
                    value={lockedWarehouse}
                    className="w-full px-3 py-2 text-sm bg-emerald-50/70 border border-emerald-200 rounded-lg text-emerald-900 font-semibold"
                  />
                ) : (
                  <SearchableSelect
                    id="prod-warehouse"
                    value={warehouseName === '__new_warehouse__' ? '' : warehouseName}
                    onChange={(val) => {
                      setWarehouseName(val);
                      setShowNewWarehouseInput(false);
                    }}
                    placeholder="Gõ tên kho lưu trữ để chọn nhanh..."
                    emptyOptionLabel="-- Chưa chọn kho --"
                    createActionLabel="+ Tạo thêm kho mới trực tiếp..."
                    onCreateAction={(kw) => {
                      setWarehouseName('__new_warehouse__');
                      setShowNewWarehouseInput(true);
                      if (kw) setNewWarehouseText(kw);
                    }}
                    options={warehouses.map((w) => ({
                      value: w,
                      label: w,
                      keywords: w,
                    }))}
                  />
                )}

                {showNewWarehouseInput && !lockedWarehouse && (
                  <div className="p-2.5 bg-emerald-50/70 border border-emerald-200 rounded-lg space-y-2">
                    <input
                      type="text"
                      value={newWarehouseText}
                      onChange={(e) => setNewWarehouseText(e.target.value)}
                      placeholder="Nhập tên kho mới (VD: Tâm An Tháp Mười)..."
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
                    />
                    <button
                      type="button"
                      onClick={handleConfirmInlineWarehouse}
                      className="w-full py-1 px-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md"
                    >
                      Lưu kho mới & Chọn ngay
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-1">
                    <label
                      htmlFor="prod-cat"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Nhóm vật tư
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !showNewCategoryInput;
                        setShowNewCategoryInput(next);
                        setCategory(next ? '__new_category__' : '');
                      }}
                      className="text-[11px] font-semibold text-emerald-700 hover:underline flex items-center gap-0.5 whitespace-nowrap"
                    >
                      <FolderPlus className="w-3 h-3" />
                      <span>{showNewCategoryInput ? 'Đóng' : '+ Tạo nhóm mới'}</span>
                    </button>
                  </div>
                  <SearchableSelect
                    id="prod-cat"
                    value={category === '__new_category__' ? '' : category}
                    onChange={(val) => {
                      setCategory(val);
                      setShowNewCategoryInput(false);
                    }}
                    placeholder="Gõ nhóm vật tư để chọn nhanh..."
                    emptyOptionLabel="-- Chưa chọn nhóm VT --"
                    createActionLabel="+ Tạo nhóm vật tư mới trực tiếp..."
                    onCreateAction={(kw) => {
                      setCategory('__new_category__');
                      setShowNewCategoryInput(true);
                      if (kw) setNewCategoryName(kw);
                    }}
                    options={productCategories.map((cat) => ({
                      value: cat,
                      label: cat,
                      keywords: cat,
                    }))}
                  />

                  {showNewCategoryInput && (
                    <div className="p-2.5 bg-emerald-50/70 border border-emerald-200 rounded-lg space-y-2">
                      <input
                        type="text"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        placeholder="Nhập tên nhóm vật tư mới..."
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
                      />
                      <button
                        type="button"
                        onClick={handleConfirmInlineCategory}
                        className="w-full py-1 px-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md"
                      >
                        Lưu nhóm VT & Chọn ngay
                      </button>
                    </div>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="prod-unit"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Đơn vị tính *
                  </label>
                  <input
                    id="prod-unit"
                    type="text"
                    required
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder="CẶP / Bao 50kg / Chai 500ml"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                  />
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {COMMON_VTNN_UNITS.map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setUnit(u)}
                        className={`px-2 py-0.5 text-[11px] font-semibold rounded border transition-colors ${
                          unit.trim().toLowerCase() === u.toLowerCase()
                            ? 'bg-emerald-700 text-white border-emerald-700'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-emerald-300'
                        }`}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="prod-import-price"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Giá nhập (VNĐ)
                  </label>
                  <input
                    id="prod-import-price"
                    type="number"
                    min={0}
                    value={importPrice}
                    onChange={(e) => setImportPrice(e.target.value)}
                    placeholder="285000"
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="prod-sell-price"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Giá bán lẻ (VNĐ)
                  </label>
                  <input
                    id="prod-sell-price"
                    type="number"
                    min={0}
                    value={sellPrice}
                    onChange={(e) => setSellPrice(e.target.value)}
                    placeholder="350000"
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              {Number(sellPrice) > 0 &&
                Number(importPrice) > 0 &&
                Number(sellPrice) < Number(importPrice) && (
                  <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs font-semibold text-red-800 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
                    <span>
                      Cảnh báo: Giá bán lẻ ({formatVND(Number(sellPrice))}) đang thấp hơn Giá nhập vốn (
                      {formatVND(Number(importPrice))}) — sẽ gây lỗ gộp khi xuất bán!
                    </span>
                  </div>
                )}

              {Number(sellPrice) > 0 && Number(importPrice) > 0 && Number(sellPrice) >= Number(importPrice) && (
                <div className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
                  Lãi gộp: {formatVND(computeMarginInfo(Number(sellPrice), Number(importPrice)).profitPerUnit)} /{' '}
                  {unit || 'đơn vị'} ({computeMarginInfo(Number(sellPrice), Number(importPrice)).marginPct}% giá bán ·{' '}
                  {computeMarginInfo(Number(sellPrice), Number(importPrice)).markupPct}% trên vốn)
                </div>
              )}
              {Number(importPrice) > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 -mt-2">
                  <span className="text-[11px] text-slate-500">Gợi ý giá bán theo % lãi trên vốn:</span>
                  {[10, 15, 20, 25].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setSellPrice(String(priceFromMarkup(Number(importPrice), m)))}
                      className="px-2 py-0.5 text-[11px] font-bold text-emerald-800 bg-white hover:bg-emerald-50 border border-emerald-300 rounded-md"
                    >
                      +{m}%
                    </button>
                  ))}
                </div>
              )}

              <details className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
                <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                  Giá theo nhóm khách (không bắt buộc)
                  {Object.values(groupPriceInputs).some((v) => Number(v) > 0) ? ' · đang có giá riêng' : ''}
                </summary>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {Array.from(new Set(customers.map((c) => (c.group || '').trim()).filter(Boolean))).map((g) => (
                    <label key={g} className="text-[11px] font-semibold text-slate-600">
                      {g}
                      <input
                        type="number"
                        min={0}
                        value={groupPriceInputs[g] ?? ''}
                        onChange={(e) => setGroupPriceInputs((prev) => ({ ...prev, [g]: e.target.value }))}
                        placeholder={`Giá lẻ: ${sellPrice || 0}`}
                        className="mt-0.5 w-full px-2.5 py-1.5 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                      />
                    </label>
                  ))}
                  {customers.length === 0 && (
                    <p className="text-[11px] text-slate-400">Chưa có khách hàng nào để lập nhóm giá.</p>
                  )}
                </div>
                <p className="mt-1.5 text-[10px] text-slate-400">
                  Khi bán cho khách thuộc nhóm này, đơn giá tự điền theo giá riêng (để trống = dùng giá lẻ).
                </p>
              </details>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="prod-stock"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Tồn kho ban đầu
                  </label>
                  <input
                    id="prod-stock"
                    type="number"
                    min={0}
                    value={stock}
                    onChange={(e) => setStock(e.target.value)}
                    placeholder="25"
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="prod-minstock"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Mức cảnh báo sắp hết
                  </label>
                  <input
                    id="prod-minstock"
                    type="number"
                    min={0}
                    value={minStock}
                    onChange={(e) => setMinStock(e.target.value)}
                    placeholder={editingProduct ? '10' : '5'}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                  {editingProduct &&
                    (() => {
                      const suggested = suggestMinStockFromVelocity(editingProduct, sales);
                      if (suggested === null) {
                        return (
                          <p className="mt-1 text-[10px] text-slate-400">
                            Chưa có doanh số 30 ngày để gợi ý định mức.
                          </p>
                        );
                      }
                      return (
                        <button
                          type="button"
                          onClick={() => setMinStock(String(suggested))}
                          className="mt-1 text-[11px] font-semibold text-indigo-700 hover:text-indigo-900 underline underline-offset-2"
                        >
                          Gợi ý thông minh: {suggested} {editingProduct.unit} (bán 30 ngày) · Áp dụng
                        </button>
                      );
                    })()}
                </div>
              </div>

              {!editingProduct && Number(stock) > 0 && (
                <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50/70 space-y-2">
                  <div className="text-xs font-bold text-emerald-900">
                    Tồn kho ban đầu {Number(stock).toLocaleString('vi-VN')} {unit || 'đơn vị'} — ghi nhận thế nào?
                  </div>
                  {(
                    [
                      {
                        id: 'pn_paid',
                        label: 'Lập kèm Phiếu nhập kho (PN-...) — đã thanh toán đủ NCC',
                        hint: 'Hiện ngay trong Nhật ký Nhập hàng, Thẻ kho (+nhập) và Sổ quỹ.',
                      },
                      {
                        id: 'pn_debt',
                        label: 'Lập kèm Phiếu nhập kho (PN-...) — ghi nợ NCC 30 ngày',
                        hint: 'Hiện thêm trong Quản lý Công nợ (phải trả NCC).',
                      },
                      {
                        id: 'opening_only',
                        label: 'Chỉ ghi Tồn đầu kỳ (hàng có sẵn, không tạo phiếu nhập)',
                        hint: 'Nhật ký Nhập hàng sẽ không có phiếu cho phần tồn này.',
                      },
                    ] as const
                  ).map((opt) => (
                    <label
                      key={opt.id}
                      className={`flex items-start gap-2 p-2 rounded-md border cursor-pointer text-xs ${
                        initialReceiptMode === opt.id
                          ? 'bg-white border-emerald-500'
                          : 'bg-transparent border-transparent hover:bg-white/60'
                      }`}
                    >
                      <input
                        type="radio"
                        name="prod-initial-receipt-mode"
                        checked={initialReceiptMode === opt.id}
                        onChange={() => setInitialReceiptMode(opt.id)}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="font-semibold text-slate-900">{opt.label}</span>
                        <span className="block text-[11px] text-slate-500">{opt.hint}</span>
                      </span>
                    </label>
                  ))}
                  {Number(importPrice) <= 0 && (
                    <label className="flex items-start gap-2 text-xs font-semibold text-amber-900 bg-amber-50 border border-amber-200 rounded-md p-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={zeroPriceConfirmed}
                        onChange={(e) => setZeroPriceConfirmed(e.target.checked)}
                        className="mt-0.5"
                      />
                      <span>
                        Giá nhập đang là 0 đ — tích vào đây nếu đây là hàng tặng / hàng mẫu 0 đ (không tính tiền).
                      </span>
                    </label>
                  )}
                </div>
              )}

              <div>
                <label
                  htmlFor="prod-supplier"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Nhà cung cấp chính
                </label>
                <input
                  id="prod-supplier"
                  type="text"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  placeholder="Nhập tên nhà cung cấp..."
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <div>
                  <label
                    htmlFor="prod-barcode"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Mã vạch / Barcode
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      id="prod-barcode"
                      type="text"
                      value={barcode}
                      onChange={(e) => setBarcode(e.target.value)}
                      placeholder="893..."
                      className="flex-1 min-w-0 px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => setBarcodeScanTarget('product_modal')}
                      title="Quét mã vạch để điền tự động"
                      aria-label="Quét mã vạch vật tư"
                      className="p-2 text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg shrink-0"
                    >
                      <QrCode className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="prod-batch"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Số lô (Batch)
                  </label>
                  <input
                    id="prod-batch"
                    type="text"
                    value={batchNumber}
                    onChange={(e) => setBatchNumber(e.target.value)}
                    placeholder="LO-2611"
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="prod-expiry"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Hạn sử dụng (FEFO)
                  </label>
                  <input
                    id="prod-expiry"
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="pt-1 space-y-1.5">
                <label
                  htmlFor="prod-dosage-guide"
                  className="block text-xs font-semibold text-emerald-900"
                >
                  Hướng dẫn liều lượng &amp; cách pha phun mặc định (tự điền khi bán &amp; in kèm hóa đơn)
                </label>
                <textarea
                  id="prod-dosage-guide"
                  rows={2}
                  value={dosageGuide}
                  onChange={(e) => setDosageGuide(e.target.value)}
                  placeholder="VD: Pha 25-30ml / bình 25 lít nước, phun đều tán lá lúc sáng sớm hoặc chiều mát..."
                  className="w-full px-3 py-2 text-xs bg-white border border-emerald-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <div className="flex flex-wrap gap-1.5">
                  {DOSAGE_GUIDE_PRESETS.slice(0, 4).map((preset, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setDosageGuide(preset)}
                      className="px-2 py-0.5 text-[11px] font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-full transition-colors text-left"
                    >
                      + {preset.length > 42 ? `${preset.slice(0, 42)}…` : preset}
                    </button>
                  ))}
                </div>
              </div>

              </div>

              {productFormError && (
                <div className="px-4 sm:px-6 py-2 bg-red-50 border-t border-red-200 text-xs font-semibold text-red-700 flex items-start gap-1.5 shrink-0">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{productFormError}</span>
                </div>
              )}

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
                  Lưu vật tư
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detailed Stock Movement Ledger Modal (Chi tiết Xuất - Nhập - Tồn kho từng mặt hàng) */}
      {detailProduct && detailLedger && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-2.5 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Chi tiết xuất nhập tồn kho ${detailProduct.name}`}
        >
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-4xl max-h-[calc(100dvh-1.25rem)] sm:max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-4 sm:px-6 py-4 border-b border-slate-200 bg-emerald-50/70 flex items-start justify-between gap-3 shrink-0">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2 py-0.5 text-[11px] font-mono font-bold bg-emerald-700 text-white rounded">
                    {detailProduct.code}
                  </span>
                  <span className="px-2 py-0.5 text-[11px] font-semibold bg-white text-emerald-900 border border-emerald-200 rounded flex items-center gap-1">
                    <Warehouse className="w-3 h-3" />
                    <span>{detailProduct.warehouseName || 'Tâm An Mỹ Ngãi'}</span>
                  </span>
                  <span className="text-[11px] font-medium text-slate-600">
                    Nhóm: {detailProduct.category} · ĐVT: {detailProduct.unit}
                  </span>
                </div>
                <h3 className="text-base sm:text-lg font-bold text-slate-900 truncate">
                  Chi Tiết Xuất - Nhập - Tồn Kho: {detailProduct.name}
                </h3>
                <div className="text-xs text-slate-600 flex flex-wrap gap-x-3 gap-y-1">
                  <span>
                    Giá nhập: <strong className="font-mono">{formatVND(detailProduct.importPrice)}</strong>
                  </span>
                  <span>
                    Giá bán: <strong className="font-mono text-emerald-800">{formatVND(detailProduct.sellPrice)}</strong>
                  </span>
                  <span>
                    Định mức tối thiểu: <strong className="font-mono">{detailProduct.minStock} {detailProduct.unit}</strong>
                  </span>
                </div>
                {detailProduct.dosageGuide && (
                  <div className="mt-1.5 px-2.5 py-1.5 rounded-lg bg-white/90 border border-emerald-200 text-xs text-emerald-900">
                    <span className="font-bold">Hướng dẫn liều lượng: </span>
                    <span>{detailProduct.dosageGuide}</span>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDetailProductId(null)}
                aria-label="Đóng chi tiết xuất nhập tồn"
                className="p-1.5 text-slate-400 hover:text-slate-800 bg-white rounded-lg border border-slate-200 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1 overscroll-contain">
              {/* Stock Integrity Diagnostic Banner (Detects drifted stock e.g. stock=0 despite imports & 0 sales) */}
              {(() => {
                const integrity = evaluateProductStockIntegrity(
                  detailProduct,
                  sales,
                  imports,
                  stockAdjustments
                );
                if (!integrity.hasNegativeDrift) return null;
                return (
                  <div className="p-3.5 rounded-xl bg-amber-50 border-2 border-amber-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div className="space-y-1 text-amber-950">
                      <div className="font-bold flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                        <span>
                          Phát hiện lệch tồn kho so với chứng từ XNT (Lệch{' '}
                          {integrity.impliedOpeningStock} {detailProduct.unit})
                        </span>
                      </div>
                      <p className="text-amber-900">
                        Tổng nhập: <strong>+{integrity.totalImportedQty}</strong> · Tổng xuất bán/KM:{' '}
                        <strong>-{integrity.totalExportedQty}</strong> · Kiểm kê:{' '}
                        <strong>{integrity.totalStocktakeDiffQty}</strong> → Tồn theo chứng từ phải là{' '}
                        <strong className="font-mono">
                          {integrity.recommendedReconciledStock} {detailProduct.unit}
                        </strong>
                        , nhưng tồn hiện tại đang là{' '}
                        <strong className="font-mono text-red-700">
                          {detailProduct.stock} {detailProduct.unit}
                        </strong>
                        . Bấm vào các phiếu bên dưới để kiểm tra hoặc đối soát tự động.
                      </p>
                    </div>
                    {canPerformRoleAction(role, 'edit_record') && onReconcileProductStock && (
                      <button
                        type="button"
                        onClick={() => onReconcileProductStock(detailProduct.id)}
                        className="px-3 py-2 text-xs font-bold text-white bg-amber-700 hover:bg-amber-800 rounded-lg whitespace-nowrap shrink-0"
                      >
                        Đối soát tồn ({detailProduct.stock} → {integrity.recommendedReconciledStock}{' '}
                        {detailProduct.unit})
                      </button>
                    )}
                  </div>
                );
              })()}

              {/* 4 Stock Balance Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-[11px] text-slate-500">Tồn đầu kỳ</div>
                  <div className="text-lg font-bold font-mono text-slate-900 mt-1">
                    {detailLedger.openingStock.toLocaleString('vi-VN')} {detailProduct.unit}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200">
                  <div className="text-[11px] text-emerald-800 font-medium">
                    Nhập kho trong kỳ ({detailLedger.periodImportCount} phiếu)
                  </div>
                  <div className="text-lg font-bold font-mono text-emerald-800 mt-1">
                    +{detailLedger.periodImportQty.toLocaleString('vi-VN')} {detailProduct.unit}
                  </div>
                  <div className="text-[11px] font-mono text-emerald-700">
                    {formatVND(detailLedger.periodImportValue)}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200">
                  <div className="text-[11px] text-amber-800 font-medium">
                    Xuất bán &amp; KM ({detailLedger.periodExportCount} lượt)
                  </div>
                  <div className="text-lg font-bold font-mono text-amber-800 mt-1">
                    -{detailLedger.periodExportTotalQty.toLocaleString('vi-VN')} {detailProduct.unit}
                  </div>
                  <div className="text-[11px] font-mono text-amber-700">
                    {detailLedger.periodExportGiftQty > 0
                      ? `Bán: ${detailLedger.periodExportSaleQty} · Tặng KM: ${detailLedger.periodExportGiftQty}`
                      : formatVND(detailLedger.periodExportRevenue)}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-emerald-700 text-white">
                  <div className="text-[11px] text-emerald-100">
                    Tồn cuối kỳ / Thực tế hiện tại
                  </div>
                  <div className="text-lg font-bold font-mono mt-1">
                    {detailLedger.closingStock.toLocaleString('vi-VN')} {detailProduct.unit}
                  </div>
                  <div className="text-[11px] text-emerald-100 font-mono">
                    Thực tế kho: {detailProduct.stock} {detailProduct.unit}
                  </div>
                </div>
              </div>

              {/* Filter & Date Range Controls */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                  <button
                    type="button"
                    onClick={() => {
                      setLedgerFromDate('');
                      setLedgerToDate('');
                    }}
                    className={`px-2.5 py-1 rounded-md font-semibold ${
                      !ledgerFromDate && !ledgerToDate
                        ? 'bg-emerald-700 text-white'
                        : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    Toàn thời gian
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const r = getCurrentMonthRangeVietnam();
                      setLedgerFromDate(r.from);
                      setLedgerToDate(r.to);
                    }}
                    className="px-2.5 py-1 rounded-md font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
                  >
                    Tháng này
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const r = getRecentDaysRangeVietnam(7);
                      setLedgerFromDate(r.from);
                      setLedgerToDate(r.to);
                    }}
                    className="px-2.5 py-1 rounded-md font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
                  >
                    7 ngày qua
                  </button>
                  <input
                    type="date"
                    aria-label="Từ ngày"
                    value={ledgerFromDate}
                    onChange={(e) => setLedgerFromDate(e.target.value)}
                    className="px-2 py-1 rounded-md border border-slate-200 bg-white font-mono text-xs"
                  />
                  <span>→</span>
                  <input
                    type="date"
                    aria-label="Đến ngày"
                    value={ledgerToDate}
                    onChange={(e) => setLedgerToDate(e.target.value)}
                    className="px-2 py-1 rounded-md border border-slate-200 bg-white font-mono text-xs"
                  />
                </div>

                <div className="flex items-center gap-1.5">
                  {(
                    [
                      { id: 'all', label: 'Tất cả' },
                      { id: 'import', label: 'Chỉ Nhập (+)' },
                      { id: 'export', label: 'Chỉ Xuất (-)' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setLedgerTypeFilter(t.id)}
                      className={`px-2.5 py-1 rounded-md font-semibold ${
                        ledgerTypeFilter === t.id
                          ? 'bg-slate-900 text-white'
                          : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Chronological Stock Card Ledger Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] text-left border-collapse text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                      <tr>
                        <th className="py-2.5 px-3">Ngày chứng từ</th>
                        <th className="py-2.5 px-3">Loại &amp; Mã phiếu</th>
                        <th className="py-2.5 px-3">Đối tác (NCC / Khách hàng)</th>
                        <th className="py-2.5 px-3 text-right">Nhập (+)</th>
                        <th className="py-2.5 px-3 text-right">Xuất (-)</th>
                        <th className="py-2.5 px-3 text-right">Tồn sau GD</th>
                        <th className="py-2.5 px-3 text-right">Đơn giá / Thành tiền</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {filteredDetailMovements.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 px-4 text-center text-slate-500">
                            Chưa có chứng từ nhập hoặc xuất nào cho mặt hàng này trong khoảng thời gian đã chọn.
                          </td>
                        </tr>
                      ) : (
                        filteredDetailMovements.map((mov) => (
                          <tr key={mov.id} className="hover:bg-slate-50">
                            <td className="py-2.5 px-3 font-mono text-slate-600 whitespace-nowrap">
                              {(mov.dateIso || '').slice(0, 16).replace('T', ' ')}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                {mov.type === 'import' ? (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900 font-semibold text-[11px]">
                                    <ArrowDownLeft className="w-3 h-3" />
                                    Nhập
                                  </span>
                                ) : mov.type === 'stocktake_in' ? (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-teal-100 text-teal-900 font-semibold text-[11px]">
                                    <ArrowDownLeft className="w-3 h-3" />
                                    Kiểm kê (+)
                                  </span>
                                ) : mov.type === 'stocktake_out' ? (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-100 text-rose-900 font-semibold text-[11px]">
                                    <ArrowUpRight className="w-3 h-3" />
                                    Kiểm kê (-)
                                  </span>
                                ) : mov.type === 'gift_export' ? (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-100 text-purple-900 font-semibold text-[11px]">
                                    <ArrowUpRight className="w-3 h-3" />
                                    Quà KM
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-semibold text-[11px]">
                                    <ArrowUpRight className="w-3 h-3" />
                                    Xuất bán
                                  </span>
                                )}
                                {onNavigateCrossLink &&
                                (mov.type === 'import' ||
                                  mov.type === 'sale' ||
                                  mov.type === 'gift_export') ? (
                                  <CrossLinkChip
                                    tone={mov.type === 'import' ? 'emerald' : 'amber'}
                                    label={mov.voucherCode}
                                    title={`Bấm để mở chứng từ gốc ${mov.voucherCode}`}
                                    onClick={() => {
                                      setDetailProductId(null);
                                      onClearFocusedProduct?.();
                                      onNavigateCrossLink({
                                        tab: mov.type === 'import' ? 'imports' : 'sales',
                                        recordId: mov.sourceRecordId || mov.voucherCode,
                                        voucherCode: mov.voucherCode,
                                        label: `${
                                          mov.type === 'import' ? 'Phiếu nhập' : 'Hóa đơn'
                                        } ${mov.voucherCode}`,
                                      });
                                    }}
                                  />
                                ) : (
                                  <span className="inline-flex items-center gap-1.5">
                                    <span className="font-mono font-bold text-slate-800">
                                      {mov.voucherCode}
                                    </span>
                                    {(mov.type === 'stocktake_in' || mov.type === 'stocktake_out') &&
                                      mov.sourceRecordId &&
                                      onDeleteStockAdjustment &&
                                      canPerformRoleAction(role, 'delete_record') && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (
                                              window.confirm(
                                                `Hủy phiếu kiểm kê ${mov.voucherCode} và hoàn trả chênh lệch kho về trước kiểm kê?`
                                              )
                                            ) {
                                              onDeleteStockAdjustment(mov.sourceRecordId!);
                                            }
                                          }}
                                          className="px-1.5 py-0.5 text-[10px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded"
                                          title="Hủy phiếu điều chỉnh kiểm kê này và hoàn lại tồn kho"
                                        >
                                          Hủy KK
                                        </button>
                                      )}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="font-medium text-slate-900">{mov.partnerName}</div>
                              {mov.note && (
                                <div className="text-[11px] text-slate-500 truncate max-w-[200px]">
                                  {mov.note}
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700 whitespace-nowrap">
                              {mov.qtyIn > 0 ? `+${mov.qtyIn}` : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-700 whitespace-nowrap">
                              {mov.qtyOut > 0 ? `-${mov.qtyOut}` : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 whitespace-nowrap">
                              {mov.balanceAfter} {detailProduct.unit}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono whitespace-nowrap">
                              <div className="text-slate-900 font-semibold">
                                {formatVND(mov.totalValue)}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                ĐG: {formatVND(mov.unitPriceOrCost)}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="px-4 sm:px-6 py-3 border-t border-slate-200 bg-slate-50/90 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const targetId = detailProduct.id;
                    setDetailProductId(null);
                    onQuickRestock(targetId);
                  }}
                  className="px-3.5 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg flex items-center gap-1.5"
                >
                  <ArrowDownToLine className="w-3.5 h-3.5" />
                  <span>Nhập thêm hàng</span>
                </button>
                {canPerformRoleAction(role, 'edit_record') && (
                  <button
                    type="button"
                    onClick={() => {
                      const prod = detailProduct;
                      setDetailProductId(null);
                      openEditModal(prod);
                    }}
                    className="px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg flex items-center gap-1.5"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>Sửa vật tư</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const periodStr =
                      ledgerFromDate || ledgerToDate
                        ? `Từ ${ledgerFromDate || 'Đầu kỳ'} đến ${ledgerToDate || 'Hiện tại'}`
                        : 'Toàn thời gian';
                    exportProductStockCardExcel(detailLedger, periodStr);
                  }}
                  className="px-3.5 py-2 text-xs font-semibold text-emerald-900 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 rounded-lg flex items-center gap-1.5"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Xuất Thẻ Kho Excel</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDetailProductId(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stocktake Modal (Kiểm kê kho & Điều chỉnh tồn KK-YYMM-XXX) */}
      {isTransferModalOpen &&
        onTransferStock &&
        (() => {
          const tProd = products.find((p) => p.id === transferProductId) || null;
          const tStock = Math.max(0, Number(tProd?.stock) || 0);
          const tSrcWh = tProd?.warehouseName || '';
          const tQty = Math.round(Number(transferQty) || 0);
          const destOptions = warehouses.filter((w) => !areWarehouseNamesEquivalent(w, tSrcWh));
          const canSubmit = Boolean(tProd) && Boolean(transferDestWarehouse) && tQty >= 1 && tQty <= tStock;
          return (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-3 sm:p-4"
              role="dialog"
              aria-modal="true"
              aria-label="Chuyển hàng giữa các kho"
            >
              <div className="bg-white rounded-2xl border border-sky-200 shadow-2xl w-full max-w-md overflow-hidden">
                <div className="px-5 py-4 bg-sky-50/90 border-b border-sky-200 flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                      <Warehouse className="w-4 h-4 text-sky-700 shrink-0" />
                      <span>Chuyển hàng giữa các kho</span>
                    </h3>
                    <p className="text-[11px] text-sky-900 mt-0.5">
                      Trừ kho nguồn, cộng kho đích theo giá vốn bình quân, tạo 2 phiếu CK liên kết
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsTransferModalOpen(false)}
                    className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
                    aria-label="Đóng"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!canSubmit || !tProd) return;
                    const ok = onTransferStock({
                      productId: tProd.id,
                      destinationWarehouse: transferDestWarehouse,
                      quantity: tQty,
                      note: transferNote,
                    });
                    if (ok) setIsTransferModalOpen(false);
                  }}
                  className="p-5 space-y-3.5 text-xs"
                >
                  <div>
                    <label htmlFor="transfer-product" className="block font-semibold text-slate-700 mb-1">
                      Vật tư cần chuyển *
                    </label>
                    <select
                      id="transfer-product"
                      value={transferProductId}
                      onChange={(e) => {
                        const next = products.find((p) => p.id === e.target.value);
                        setTransferProductId(e.target.value);
                        setTransferDestWarehouse(
                          warehouses.find((w) => !areWarehouseNamesEquivalent(w, next?.warehouseName || '')) || ''
                        );
                        setTransferQty('1');
                      }}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                    >
                      {scopedBaseProducts
                        .filter((p) => (Number(p.stock) || 0) > 0)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} — {p.warehouseName || 'Kho'} (tồn {p.stock} {p.unit})
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="transfer-dest" className="block font-semibold text-slate-700 mb-1">
                        Kho đích *
                      </label>
                      <select
                        id="transfer-dest"
                        value={transferDestWarehouse}
                        onChange={(e) => setTransferDestWarehouse(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                      >
                        {destOptions.map((w) => (
                          <option key={w} value={w}>
                            {w}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="transfer-qty" className="block font-semibold text-slate-700 mb-1">
                        Số lượng * (tối đa {tStock})
                      </label>
                      <input
                        id="transfer-qty"
                        type="number"
                        min={1}
                        max={tStock}
                        value={transferQty}
                        onChange={(e) => setTransferQty(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="transfer-note" className="block font-semibold text-slate-700 mb-1">
                      Ghi chú
                    </label>
                    <input
                      id="transfer-note"
                      type="text"
                      value={transferNote}
                      onChange={(e) => setTransferNote(e.target.value)}
                      placeholder="VD: Điều hàng cho kho Cao Lãnh"
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                    />
                  </div>
                  {tProd && (
                    <div className="p-2.5 bg-sky-50 border border-sky-200 rounded-lg font-mono text-[11px] text-slate-700">
                      {tSrcWh}: {tStock} → {Math.max(0, tStock - (tQty || 0))} {tProd.unit} · Giá vốn chuyển:{' '}
                      {formatVND(tProd.importPrice)}
                    </div>
                  )}
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsTransferModalOpen(false)}
                      className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
                    >
                      Hủy
                    </button>
                    <button
                      type="submit"
                      disabled={!canSubmit}
                      className="px-4 py-2 text-xs font-semibold text-white bg-sky-700 hover:bg-sky-800 disabled:opacity-50 rounded-lg"
                    >
                      Xác nhận chuyển kho
                    </button>
                  </div>
                </form>
              </div>
            </div>
          );
        })()}

      {isStocktakeModalOpen && onExecuteStocktake && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Kiểm kê & Điều chỉnh tồn kho"
        >
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-200 bg-indigo-50/70 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-indigo-700" />
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-900">
                    Kiểm Kê Thực Tế &amp; Lập Phiếu Điều Chỉnh (KK-YYMM-XXX)
                  </h3>
                  <p className="text-[11px] text-slate-600">
                    Ghi nhận chênh lệch kiểm kê vào Thẻ Kho &amp; đồng bộ Realtime Database
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsStocktakeModalOpen(false)}
                aria-label="Đóng hộp thoại kiểm kê"
                className="p-1.5 text-slate-400 hover:text-slate-700 bg-white rounded-lg border border-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {stocktakeFeedback && (
                <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-900">
                  {stocktakeFeedback}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  1. Chọn vật tư cần kiểm kê *
                </label>
                <SearchableSelect
                  id="stocktake-product-select"
                  value={stocktakeProductId}
                  onChange={(val) => {
                    setStocktakeProductId(val);
                    const p = scopedBaseProducts.find((item) => item.id === val);
                    setStocktakeActualQty(p ? String(p.stock) : '');
                  }}
                  placeholder="Tìm theo tên vật tư, mã VT hoặc barcode..."
                  emptyOptionLabel="-- Chọn vật tư --"
                  options={scopedBaseProducts.map((p) => ({
                    value: p.id,
                    label: `${p.name} [${p.warehouseName || 'Tâm An Mỹ Ngãi'}] — Hệ thống: ${p.stock} ${p.unit}`,
                    subLabel: `Mã: ${p.code}${p.barcode ? ` · BC: ${p.barcode}` : ''}`,
                    badge: `${p.stock} ${p.unit}`,
                    keywords: `${p.name} ${p.code} ${p.barcode || ''} ${p.batchNumber || ''}`,
                  }))}
                />
              </div>

              {(() => {
                const target = scopedBaseProducts.find((p) => p.id === stocktakeProductId);
                if (!target) return null;
                const sysQty = Math.max(0, Number(target.stock) || 0);
                const actQty = Math.max(0, Number(stocktakeActualQty) || 0);
                const diff = actQty - sysQty;
                const unitCost = Math.max(0, Number(target.importPrice) || 0);
                return (
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                    <div className="grid grid-cols-3 gap-3 text-xs">
                      <div>
                        <div className="text-slate-500">Tồn sổ sách</div>
                        <div className="text-base font-bold font-mono text-slate-900">
                          {sysQty} {target.unit}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Chênh lệch</div>
                        <div
                          className={`text-base font-bold font-mono ${
                            diff > 0
                              ? 'text-emerald-700'
                              : diff < 0
                              ? 'text-red-600'
                              : 'text-slate-700'
                          }`}
                        >
                          {diff > 0 ? `+${diff}` : diff} {target.unit}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-slate-500">Giá trị lệch (Vốn)</div>
                        <div className="text-sm font-bold font-mono text-slate-900">
                          {formatVND(diff * unitCost)}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label
                          htmlFor="stocktake-actual-qty"
                          className="block text-xs font-semibold text-slate-700 mb-1"
                        >
                          2. Số lượng thực tế kiểm đếm ({target.unit}) *
                        </label>
                        <input
                          id="stocktake-actual-qty"
                          type="number"
                          min={0}
                          value={stocktakeActualQty}
                          onChange={(e) => setStocktakeActualQty(e.target.value)}
                          className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="stocktake-reason"
                          className="block text-xs font-semibold text-slate-700 mb-1"
                        >
                          3. Lý do điều chỉnh
                        </label>
                        <select
                          id="stocktake-reason"
                          value={stocktakeReason}
                          onChange={(e) => setStocktakeReason(e.target.value)}
                          className="w-full px-3 py-2 text-xs font-medium bg-white border border-slate-300 rounded-lg"
                        >
                          <option value="Kiểm kê định kỳ">Kiểm kê định kỳ</option>
                          <option value="Hư hỏng / rách bao">Hư hỏng / rách bao</option>
                          <option value="Hết hạn sử dụng">Hết hạn sử dụng</option>
                          <option value="Thất thoát / Nhầm lẫn">Thất thoát / Nhầm lẫn</option>
                          <option value="Hàng dôi dư">Hàng dôi dư</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="stocktake-note"
                        className="block text-xs font-semibold text-slate-700 mb-1"
                      >
                        Ghi chú kiểm kê
                      </label>
                      <input
                        id="stocktake-note"
                        type="text"
                        value={stocktakeNote}
                        onChange={(e) => setStocktakeNote(e.target.value)}
                        placeholder="VD: Kiểm cuối tháng tại kệ A2..."
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        const res = onExecuteStocktake({
                          productId: target.id,
                          actualQty: actQty,
                          reason: stocktakeReason,
                          note: stocktakeNote,
                        });
                        if (res) {
                          setStocktakeFeedback(
                            `Đã lập phiếu ${res.adjustmentCode}: ${res.productName} (${res.systemStockBefore} → ${res.actualCountedStock} ${res.unit}).`
                          );
                          setStocktakeNote('');
                        }
                      }}
                      className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg transition-colors"
                    >
                      Xác nhận lưu phiếu kiểm kê &amp; Cập nhật tồn kho
                    </button>
                  </div>
                );
              })()}

              {stockAdjustments.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-200">
                  <div className="text-xs font-bold text-slate-700">
                    Lịch sử phiếu kiểm kê gần đây ({stockAdjustments.length})
                  </div>
                  <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 text-xs">
                    {stockAdjustments.slice(0, 15).map((adj) => (
                      <div key={adj.id} className="px-3 py-2 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 truncate">
                            <span className="font-mono text-indigo-700 mr-1.5">{adj.adjustmentCode}</span>
                            {adj.productName}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {adj.createdAt.slice(0, 10)} · {adj.reason} · {adj.staffName}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-right font-mono">
                            <span
                              className={`font-bold ${
                                adj.diffQty > 0
                                  ? 'text-emerald-700'
                                  : adj.diffQty < 0
                                  ? 'text-red-600'
                                  : 'text-slate-600'
                              }`}
                            >
                              {adj.diffQty > 0 ? `+${adj.diffQty}` : adj.diffQty} {adj.unit}
                            </span>
                            <div className="text-[10px] text-slate-500">
                              {adj.systemStockBefore} → {adj.actualCountedStock}
                            </div>
                          </div>
                          {onDeleteStockAdjustment && canPerformRoleAction(role, 'delete_record') && (
                            <button
                              type="button"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Xác nhận hủy phiếu kiểm kê ${adj.adjustmentCode} (${adj.productName}) và hoàn trả chênh lệch ${
                                      adj.diffQty > 0 ? -adj.diffQty : `+${Math.abs(adj.diffQty)}`
                                    } ${adj.unit}?`
                                  )
                                ) {
                                  onDeleteStockAdjustment(adj.id);
                                }
                              }}
                              title={`Hủy phiếu kiểm kê ${adj.adjustmentCode}`}
                              className="px-2 py-1 text-[10px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md"
                            >
                              Hủy KK
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <BarcodeScannerModal
        isOpen={barcodeScanTarget !== null}
        onClose={() => setBarcodeScanTarget(null)}
        title={
          barcodeScanTarget === 'product_modal'
            ? 'Quét Mã Vạch Gán Cho Vật Tư'
            : 'Quét Mã Vạch Tìm Kiếm Trong Kho'
        }
        onDetected={(scanned) => {
          if (barcodeScanTarget === 'product_modal') {
            setBarcode(scanned);
          } else {
            setSearchQuery(scanned);
          }
        }}
      />
    </div>
  );
};

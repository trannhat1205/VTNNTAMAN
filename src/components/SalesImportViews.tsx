import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileDown,
  FolderPlus,
  Gift,
  Layers,
  Leaf,
  List,
  Lock,
  MessageCircle,
  PackagePlus,
  Pencil,
  Percent,
  Plus,
  Printer,
  QrCode,
  RotateCcw,
  Search,
  ShoppingCart,
  Tag,
  Trash2,
  Truck,
  UserPlus,
  Warehouse,
  X,
} from 'lucide-react';
import {
  CashPaymentVoucher,
  CashReceiptVoucher,
  CrossLinkNavigateRequest,
  CustomerGroup,
  CustomerProfile,
  ImportTransaction,
  PaymentStatus,
  ProductCategory,
  ProductItem,
  ProductNoteTemplate,
  SalePromotionType,
  SaleTransaction,
  StockAdjustmentRecord,
  SupplierProfile,
  UserRole,
  VietQrBankConfig,
} from '../types';
import {
  areWarehouseNamesEquivalent,
  calculateImportSummary,
  calculateSaleSummary,
  canPerformRoleAction,
  computeCustomerOldDebtSummary,
  computeCustomerSaleReturnCalculation,
  computeDueDateAfterDays,
  computeSupplierOldDebtSummary,
  countDistinctImportReceipts,
  countDistinctSalesInvoices,
  DEBT_TERM_DAY_OPTIONS,
  diagnoseImportVoucher,
  diagnoseSaleVoucher,
  evaluateDebtUrgency,
  evaluateProductExpiry,
  formatVND,
  generateNextUniqueProductCode,
  matchDebtTermDays,
  normalizeVietnameseSearch,
} from '../utils/businessLogic';
import {
  CancelImportConfirmModal,
  CancelSaleConfirmModal,
  CrossLinkChip,
  FocusedLinkBanner,
} from './VoucherCrossLinkUI';
import {
  exportImportReceiptPDF,
  exportModuleDataExcel,
  exportSaleInvoicePDF,
  exportThermalReceiptPDF,
} from '../utils/exportReports';
import {
  allocatePaymentAcrossCartItems,
  allocatePaymentAcrossImportItems,
  buildZaloInvoiceAndDosageMessage,
  DEFAULT_PRODUCT_NOTE_TEMPLATES,
  findImportGroupTransactions,
  findInvoiceGroupSales,
  groupSalesByInvoice,
  ImportCartDraftItem,
  PosCartDraftItem,
  upsertQuickCartProductQuantity,
  upsertQuickImportProductQuantity,
  validateCartInventory,
} from '../utils/smartPosFeatures';
import { ExcelDataBar } from './ExcelDataBar';
import { SearchableSelect } from './SearchableSelect';
import { BarcodeScannerModal } from './BarcodeScannerModal';
import { VietQrPaymentModal } from './VietQrPaymentModal';

interface SalesLogViewProps {
  products: ProductItem[];
  customers: CustomerProfile[];
  sales: SaleTransaction[];
  imports?: ImportTransaction[];
  receiptVouchers?: CashReceiptVoucher[];
  role: UserRole;
  resetKey: number;
  warehouses: string[];
  onAddWarehouse: (warehouseName: string) => void;
  lockedWarehouse: string | null;
  customerGroups: string[];
  onAddCustomerGroup: (groupName: string) => void;
  productCategories: string[];
  onAddProductCategory: (catName: string) => void;
  preselectedCustomerId: string | null;
  onClearPreselectedCustomer: () => void;
  focusedSaleId?: string | null;
  onClearFocusedSale?: () => void;
  onNavigateCrossLink?: (req: CrossLinkNavigateRequest) => void;
  onCreateSale: (payload: {
    customerId: string;
    customerName: string;
    customerPhone: string;
    productId: string;
    quantity: number;
    unitPrice: number;
    paidAmount: number;
    dueDate: string;
    note: string;
    warehouseName: string;
    promotionType?: SalePromotionType;
    discountAmount?: number;
    discountPercent?: number;
    giftProductId?: string;
    giftProductName?: string;
    giftUnit?: string;
    giftQuantity?: number;
    giftUnitCost?: number;
    dosageGuide?: string;
  }) => SaleTransaction;
  onCreateMultiItemSale?: (payload: {
    customerId: string;
    customerName: string;
    customerPhone: string;
    warehouseName: string;
    dueDate: string;
    note: string;
    totalPaidAmount: number;
    items: PosCartDraftItem[];
  }) => SaleTransaction[];
  bankQrConfig?: VietQrBankConfig | null;
  onSaveBankQrConfig?: (config: VietQrBankConfig) => void;
  productNoteTemplates?: ProductNoteTemplate[];
  onSaveProductNoteTemplate?: (
    draft: { title: string; content: string; category?: string },
    editingId?: string
  ) => ProductNoteTemplate;
  onDeleteProductNoteTemplate?: (templateId: string) => void;
  onBindProductNoteToProduct?: (productId: string, noteContent: string) => void;
  onNotifyToast?: (msg: string) => void;
  onCreateCustomerInline: (
    data: Omit<CustomerProfile, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
  ) => CustomerProfile;
  onCreateProductInline: (
    data: Omit<ProductItem, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
  ) => ProductItem;
  onImportSalesFromExcel: (rows: Record<string, unknown>[]) => number;
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
      promotionType?: SalePromotionType;
      discountAmount?: number;
      giftProductName?: string;
      giftUnit?: string;
      giftQuantity?: number;
      dosageGuide?: string;
    }
  ) => void;
  onDeleteSale: (saleId: string) => void;
  onDeleteSaleGroup?: (saleIds: string[]) => void;
  onProcessCustomerReturn?: (params: {
    saleId: string;
    returnQuantity: number;
    returnGiftQuantity?: number;
    reason: string;
  }) => void;
  onOpenDebtRecord?: (recordId: string) => void;
  onRequestAddNewProductInImports?: (initialKeyword?: string) => void;
}

export const SalesLogView: React.FC<SalesLogViewProps> = ({
  products,
  customers,
  sales,
  imports = [],
  receiptVouchers = [],
  role,
  resetKey,
  warehouses,
  onAddWarehouse,
  lockedWarehouse,
  customerGroups,
  onAddCustomerGroup,
  preselectedCustomerId,
  onClearPreselectedCustomer,
  focusedSaleId,
  onClearFocusedSale,
  onNavigateCrossLink,
  onCreateSale,
  onCreateMultiItemSale,
  bankQrConfig,
  onSaveBankQrConfig,
  productNoteTemplates = DEFAULT_PRODUCT_NOTE_TEMPLATES,
  onSaveProductNoteTemplate,
  onDeleteProductNoteTemplate,
  onBindProductNoteToProduct,
  onNotifyToast,
  onCreateCustomerInline,
  onCreateProductInline,
  onImportSalesFromExcel,
  onUpdateSale,
  onDeleteSale,
  onDeleteSaleGroup,
  onProcessCustomerReturn,
  onOpenDebtRecord,
  onRequestAddNewProductInImports,
}) => {
  // Blank initial form state per user requirement
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>(lockedWarehouse || '');
  const [showNewWarehouseBox, setShowNewWarehouseBox] = useState<boolean>(false);
  const [newWarehouseName, setNewWarehouseName] = useState<string>('');

  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(
    preselectedCustomerId || ''
  );
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('');
  const [unitPrice, setUnitPrice] = useState<string>('');
  const [paymentMode, setPaymentMode] = useState<'full' | 'debt'>('full');
  const [paidAmount, setPaidAmount] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [dosageGuide, setDosageGuide] = useState<string>('');
  const [selectedNoteTemplateId, setSelectedNoteTemplateId] = useState<string>('');
  const [noteTargetProductId, setNoteTargetProductId] = useState<string>('');
  const [showNoteTemplateEditor, setShowNoteTemplateEditor] = useState<boolean>(false);
  const [editingNoteTemplateId, setEditingNoteTemplateId] = useState<string | null>(null);
  const [tplTitleInput, setTplTitleInput] = useState<string>('');
  const [tplCategoryInput, setTplCategoryInput] = useState<string>('Liều lượng & Pha phun');
  const [tplContentInput, setTplContentInput] = useState<string>('');
  const [autoRememberedBadge, setAutoRememberedBadge] = useState<string | null>(null);
  const [posCartItems, setPosCartItems] = useState<PosCartDraftItem[]>([]);
  const [lastCreatedOrder, setLastCreatedOrder] = useState<{
    invoiceCode: string;
    warehouseName: string;
    customerName: string;
    customerPhone: string;
    customerAddress?: string;
    sales: SaleTransaction[];
  } | null>(null);
  const [vietQrModalTarget, setVietQrModalTarget] = useState<{
    title: string;
    subtitle: string;
    amount: number;
    addInfo: string;
    customerPhone?: string;
    zaloMessage?: string;
  } | null>(null);
  const [formMessage, setFormMessage] = useState<{
    type: 'error' | 'success';
    text: string;
  } | null>(null);
  const [isBarcodeScannerOpen, setIsBarcodeScannerOpen] = useState<boolean>(false);

  // Inline New Customer Creation State
  const [showNewCustomerBox, setShowNewCustomerBox] = useState<boolean>(false);
  const [newCustName, setNewCustName] = useState<string>('');
  const [newCustPhone, setNewCustPhone] = useState<string>('');
  const [newCustAddress, setNewCustAddress] = useState<string>('');
  const [newCustEmail, setNewCustEmail] = useState<string>('');
  const [newCustGroup, setNewCustGroup] = useState<CustomerGroup>('');
  const [showInlineCustGroupInput, setShowInlineCustGroupInput] = useState<boolean>(false);
  const [inlineCustGroupText, setInlineCustGroupText] = useState<string>('');

  // Inline New Product Creation State
  const [showNewProductBox, setShowNewProductBox] = useState<boolean>(false);
  const [newProdCode, setNewProdCode] = useState<string>('');
  const [newProdName, setNewProdName] = useState<string>('');
  const [newProdCategory, setNewProdCategory] = useState<ProductCategory>('Thuốc BVTV');
  const [newProdUnit, setNewProdUnit] = useState<string>('');
  const [newProdImportPrice, setNewProdImportPrice] = useState<string>('');
  const [newProdSellPrice, setNewProdSellPrice] = useState<string>('');
  const [newProdStock, setNewProdStock] = useState<string>('');
  const [newProdSupplier, setNewProdSupplier] = useState<string>('');

  // Promotional Gift & Discount State
  const [promotionType, setPromotionType] = useState<SalePromotionType>('none');
  const [discountMode, setDiscountMode] = useState<'amount' | 'percent'>('amount');
  const [discountInput, setDiscountInput] = useState<string>('');
  const [selectedGiftProductId, setSelectedGiftProductId] = useState<string>('');
  const [giftQuantity, setGiftQuantity] = useState<string>('1');
  const [showNewGiftBox, setShowNewGiftBox] = useState<boolean>(false);
  const [newGiftCode, setNewGiftCode] = useState<string>('QUATANG');
  const [newGiftName, setNewGiftName] = useState<string>('');
  const [newGiftUnit, setNewGiftUnit] = useState<string>('CÁI');
  const [newGiftImportPrice, setNewGiftImportPrice] = useState<string>('');
  const [newGiftStock, setNewGiftStock] = useState<string>('50');

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | PaymentStatus>('all');
  const [warehouseTableFilter, setWarehouseTableFilter] = useState<string>('all');
  const [cancelingSale, setCancelingSale] = useState<SaleTransaction | null>(null);

  const focusedSaleRecord = focusedSaleId
    ? sales.find((s) => s.id === focusedSaleId || s.invoiceCode === focusedSaleId) || null
    : null;

  useEffect(() => {
    if (focusedSaleId) {
      setSearchQuery('');
      setStatusFilter('all');
      setWarehouseTableFilter('all');
    }
  }, [focusedSaleId]);

  // Manager-only Edit Saved Sale Invoice State
  const [editingSale, setEditingSale] = useState<SaleTransaction | null>(null);
  const [editSaleCode, setEditSaleCode] = useState('');
  const [editSaleWarehouse, setEditSaleWarehouse] = useState('');
  const [editSaleCustomerName, setEditSaleCustomerName] = useState('');
  const [editSaleCustomerPhone, setEditSaleCustomerPhone] = useState('');
  const [editSaleProductName, setEditSaleProductName] = useState('');
  const [editSaleUnit, setEditSaleUnit] = useState('');
  const [editSaleQty, setEditSaleQty] = useState('');
  const [editSalePrice, setEditSalePrice] = useState('');
  const [editSaleDiscount, setEditSaleDiscount] = useState('');
  const [editSaleGiftName, setEditSaleGiftName] = useState('');
  const [editSaleGiftUnit, setEditSaleGiftUnit] = useState('');
  const [editSaleGiftQty, setEditSaleGiftQty] = useState('');
  const [editSalePaid, setEditSalePaid] = useState('');
  const [editSaleDueDate, setEditSaleDueDate] = useState('');
  const [editSaleNote, setEditSaleNote] = useState('');
  const [editSaleDosageGuide, setEditSaleDosageGuide] = useState('');

  const openEditSaleModal = (s: SaleTransaction) => {
    if (!canPerformRoleAction(role, 'edit_record')) return;
    setEditingSale(s);
    setEditSaleCode(s.invoiceCode);
    setEditSaleWarehouse(s.warehouseName || warehouses[0] || 'Tâm An Mỹ Ngãi');
    setEditSaleCustomerName(s.customerName);
    setEditSaleCustomerPhone(s.customerPhone);
    setEditSaleProductName(s.productName);
    setEditSaleUnit(s.unit);
    setEditSaleQty(String(s.quantity));
    setEditSalePrice(String(s.unitPrice));
    setEditSaleDiscount(String(s.discountAmount || 0));
    setEditSaleGiftName(s.giftProductName || '');
    setEditSaleGiftUnit(s.giftUnit || 'CÁI');
    setEditSaleGiftQty(String(s.giftQuantity || 0));
    setEditSalePaid(String(s.paidAmount));
    setEditSaleDueDate(s.dueDate);
    setEditSaleNote(s.note);
    setEditSaleDosageGuide(s.dosageGuide || '');
  };

  useEffect(() => {
    if (lockedWarehouse) {
      setSelectedWarehouse(lockedWarehouse);
      setShowNewWarehouseBox(false);
    }
  }, [lockedWarehouse]);

  const resetAllSaleFieldsToBlank = () => {
    setSelectedWarehouse(lockedWarehouse || '');
    setShowNewWarehouseBox(false);
    setNewWarehouseName('');
    setSelectedCustomerId('');
    setSelectedProductId('');
    setQuantity('');
    setUnitPrice('');
    setPromotionType('none');
    setDiscountMode('amount');
    setDiscountInput('');
    setSelectedGiftProductId('');
    setGiftQuantity('1');
    setShowNewGiftBox(false);
    setNewGiftCode('QUATANG');
    setNewGiftName('');
    setNewGiftUnit('CÁI');
    setNewGiftImportPrice('');
    setNewGiftStock('50');
    setPaymentMode('full');
    setPaidAmount('');
    setDueDate('');
    setNote('');
    setDosageGuide('');
    setSelectedNoteTemplateId('');
    setNoteTargetProductId('');
    setShowNoteTemplateEditor(false);
    setEditingNoteTemplateId(null);
    setAutoRememberedBadge(null);
    setPosCartItems([]);
    setShowNewCustomerBox(false);
    setNewCustName('');
    setNewCustPhone('');
    setNewCustAddress('');
    setNewCustEmail('');
    setNewCustGroup('');
    setShowInlineCustGroupInput(false);
    setInlineCustGroupText('');
    setShowNewProductBox(false);
    setNewProdCode('');
    setNewProdName('');
    setNewProdUnit('');
    setNewProdImportPrice('');
    setNewProdSellPrice('');
    setNewProdStock('');
    setNewProdSupplier('');
  };

  useEffect(() => {
    if (resetKey > 0 && !preselectedCustomerId) {
      resetAllSaleFieldsToBlank();
    }
    if (resetKey > 0 && typeof window !== 'undefined') {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
  }, [resetKey, preselectedCustomerId]);

  useEffect(() => {
    if (preselectedCustomerId) {
      setSelectedCustomerId(preselectedCustomerId);
      setShowNewCustomerBox(false);
      onClearPreselectedCustomer();
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      }
    }
  }, [preselectedCustomerId, onClearPreselectedCustomer]);

  const currentProduct = products.find((p) => p.id === selectedProductId);

  const handleConfirmInlineWarehouseInSale = (): string | null => {
    const trimmed = newWarehouseName.trim();
    if (!trimmed) {
      setFormMessage({
        type: 'error',
        text: 'Vui lòng nhập tên kho mới để bổ sung.',
      });
      return null;
    }
    onAddWarehouse(trimmed);
    setSelectedWarehouse(trimmed);
    setShowNewWarehouseBox(false);
    setNewWarehouseName('');
    setFormMessage({
      type: 'success',
      text: `Đã tạo thêm kho "${trimmed}" và chọn cho hóa đơn bán hàng!`,
    });
    return trimmed;
  };

  const handleCustomerSelectChange = (val: string) => {
    if (val === '__new_customer__') {
      setSelectedCustomerId('__new_customer__');
      setShowNewCustomerBox(true);
    } else {
      setSelectedCustomerId(val);
      setShowNewCustomerBox(false);
    }
  };

  const handleProductSelectChange = (prodId: string) => {
    if (prodId === '__new_product__') {
      if (onRequestAddNewProductInImports) {
        onRequestAddNewProductInImports('');
        return;
      }
      setSelectedProductId('__new_product__');
      setShowNewProductBox(true);
      return;
    }
    setSelectedProductId(prodId);
    setShowNewProductBox(false);
    const prod = products.find((p) => p.id === prodId);
    if (prod) {
      setUnitPrice(String(prod.sellPrice));
      const remembered = prod.dosageGuide || '';
      setDosageGuide(remembered);
      setNoteTargetProductId(prod.id);
      const matchedTpl = remembered
        ? productNoteTemplates.find((t) => t.content.trim() === remembered.trim())
        : undefined;
      setSelectedNoteTemplateId(matchedTpl?.id || '');
      setAutoRememberedBadge(
        remembered
          ? `Đã tự động gắn ghi chú đã nhớ của "${prod.name}"`
          : null
      );
      if (!quantity) setQuantity('1');
      if (!selectedWarehouse && !lockedWarehouse && prod.warehouseName) {
        setSelectedWarehouse(prod.warehouseName);
      }
    } else {
      setUnitPrice('');
      setDosageGuide('');
      setSelectedNoteTemplateId('');
      setAutoRememberedBadge(null);
    }
  };

  const handleConfirmInlineCustomer = () => {
    if (!newCustName.trim() || !newCustPhone.trim()) {
      setFormMessage({
        type: 'error',
        text: 'Vui lòng nhập Tên khách hàng mới và Số điện thoại để lưu.',
      });
      return null;
    }
    let resolvedGrp = newCustGroup;
    if (
      (showInlineCustGroupInput || newCustGroup === '__new_group__') &&
      inlineCustGroupText.trim()
    ) {
      resolvedGrp = inlineCustGroupText.trim();
      onAddCustomerGroup(resolvedGrp);
    }
    if (!resolvedGrp || resolvedGrp === '__new_group__') {
      resolvedGrp = customerGroups[0] || 'Nhà nông';
    }
    const created = onCreateCustomerInline({
      code: `KH-00${customers.length + 1}`,
      name: newCustName.trim(),
      phone: newCustPhone.trim(),
      email: newCustEmail.trim(),
      address: newCustAddress.trim(),
      group: resolvedGrp,
      note: 'Tạo trực tiếp khi lập hóa đơn bán hàng',
      totalPurchased: 0,
      totalDebt: 0,
    });
    setSelectedCustomerId(created.id);
    setShowNewCustomerBox(false);
    setNewCustName('');
    setNewCustPhone('');
    setNewCustAddress('');
    setNewCustEmail('');
    setNewCustGroup('');
    setShowInlineCustGroupInput(false);
    setInlineCustGroupText('');
    setFormMessage({
      type: 'success',
      text: `Đã tạo và chọn khách hàng mới: ${created.name} (${created.phone} · ${created.group})`,
    });
    return created;
  };

  const handleConfirmInlineProduct = () => {
    if (!newProdName.trim() || !newProdUnit.trim() || !newProdSellPrice) {
      setFormMessage({
        type: 'error',
        text: 'Vui lòng điền Tên vật tư, Đơn vị tính và Giá bán để thêm vật tư mới.',
      });
      return null;
    }
    const sellNum = Math.max(0, Number(newProdSellPrice) || 0);
    const importNum = Math.max(0, Number(newProdImportPrice) || Math.round(sellNum * 0.82));
    const stockNum = Math.max(1, Number(newProdStock) || 30);

    const resolvedProdWh =
      lockedWarehouse ||
      (selectedWarehouse && selectedWarehouse !== '__new_warehouse__'
        ? selectedWarehouse
        : warehouses[0] || 'Tâm An Mỹ Ngãi');

    const created = onCreateProductInline({
      code: newProdCode.trim() || generateNextUniqueProductCode(products, resolvedProdWh),
      name: newProdName.trim(),
      category: newProdCategory,
      warehouseName: resolvedProdWh,
      unit: newProdUnit.trim(),
      importPrice: importNum,
      sellPrice: sellNum,
      stock: stockNum,
      minStock: 10,
      supplierName: newProdSupplier.trim() || 'Nhà cung cấp VTNN Tâm An',
    });
    setSelectedProductId(created.id);
    setUnitPrice(String(created.sellPrice));
    if (!quantity) setQuantity('1');
    setShowNewProductBox(false);
    setNewProdCode('');
    setNewProdName('');
    setNewProdUnit('');
    setNewProdImportPrice('');
    setNewProdSellPrice('');
    setNewProdStock('');
    setNewProdSupplier('');
    setFormMessage({
      type: 'success',
      text: `Đã bổ sung vật tư mới "${created.name}" (${created.stock} ${created.unit}) và chọn vào đơn!`,
    });
    return created;
  };

  const handleConfirmInlineGiftProduct = () => {
    if (!newGiftName.trim() || !newGiftUnit.trim()) {
      setFormMessage({
        type: 'error',
        text: 'Vui lòng nhập Tên quà tặng khuyến mãi và Đơn vị tính (VD: CÁI, Gói, Áo...).',
      });
      return null;
    }
    const importNum = Math.max(0, Number(newGiftImportPrice) || 0);
    const stockNum = Math.max(1, Number(newGiftStock) || 50);

    const createdGift = onCreateProductInline({
      code: newGiftCode.trim() || 'QUATANG',
      name: newGiftName.trim(),
      category: 'Vật tư & Dụng cụ',
      warehouseName:
        lockedWarehouse ||
        (selectedWarehouse && selectedWarehouse !== '__new_warehouse__'
          ? selectedWarehouse
          : warehouses[0] || 'Tâm An Mỹ Ngãi'),
      unit: newGiftUnit.trim(),
      importPrice: importNum,
      sellPrice: 0,
      stock: stockNum,
      minStock: 5,
      supplierName: 'NPP QUÀ',
    });
    setSelectedGiftProductId(createdGift.id);
    if (!giftQuantity) setGiftQuantity('1');
    setShowNewGiftBox(false);
    setNewGiftName('');
    setFormMessage({
      type: 'success',
      text: `Đã bổ sung quà tặng mới "[${createdGift.code}] ${createdGift.name}" (${createdGift.stock} ${createdGift.unit}) và chọn tặng kèm đơn!`,
    });
    return createdGift;
  };

  const qtyNum = Math.max(0, Number(quantity) || 0);
  const priceNum = Math.max(0, Number(unitPrice) || 0);
  const grossTotal = Math.round(qtyNum * priceNum);

  const hasDiscountActive = promotionType === 'discount' || promotionType === 'both';
  const hasGiftActive = promotionType === 'gift' || promotionType === 'both';

  const rawDiscountNum = Math.max(0, Number(discountInput) || 0);
  const computedDiscountAmount = hasDiscountActive
    ? discountMode === 'percent'
      ? Math.round((grossTotal * Math.min(100, rawDiscountNum)) / 100)
      : Math.min(grossTotal, Math.round(rawDiscountNum))
    : 0;
  const computedDiscountPercent =
    hasDiscountActive && grossTotal > 0
      ? discountMode === 'percent'
        ? Math.min(100, rawDiscountNum)
        : Math.round((computedDiscountAmount / grossTotal) * 100)
      : 0;

  const selectedGiftProductObj =
    hasGiftActive && selectedGiftProductId && selectedGiftProductId !== '__new_gift__'
      ? products.find((p) => p.id === selectedGiftProductId) || null
      : null;
  const giftQtyNum = hasGiftActive ? Math.max(1, Math.round(Number(giftQuantity) || 1)) : 0;

  const netPayableTotal = Math.max(0, grossTotal - computedDiscountAmount);
  const currentDraftItem: PosCartDraftItem | null =
    currentProduct && qtyNum > 0
      ? {
          id: '__draft__',
          productId: currentProduct.id,
          productName: currentProduct.name,
          unit: currentProduct.unit,
          quantity: qtyNum,
          unitPrice: priceNum > 0 ? priceNum : currentProduct.sellPrice,
          promotionType,
          discountAmount: computedDiscountAmount,
          discountPercent: computedDiscountPercent,
          giftProductId: selectedGiftProductObj?.id,
          giftProductName: selectedGiftProductObj?.name,
          giftUnit: selectedGiftProductObj?.unit,
          giftQuantity: selectedGiftProductObj ? giftQtyNum : 0,
          dosageGuide: dosageGuide.trim() || undefined,
        }
      : null;

  const combinedPreviewItems: PosCartDraftItem[] =
    posCartItems.length > 0
      ? currentDraftItem
        ? [...posCartItems, currentDraftItem]
        : posCartItems
      : currentDraftItem
      ? [currentDraftItem]
      : [];

  const cartAllocation = allocatePaymentAcrossCartItems(
    combinedPreviewItems,
    paymentMode === 'full' ? Number.MAX_SAFE_INTEGER : Math.max(0, Number(paidAmount) || 0)
  );

  const effectiveTotalPayable =
    posCartItems.length > 0 ? cartAllocation.netTotal : netPayableTotal;
  const paidNum =
    paymentMode === 'full' ? effectiveTotalPayable : Math.max(0, Number(paidAmount) || 0);
  const summary =
    posCartItems.length > 0
      ? {
          grossAmount: cartAllocation.grossTotal,
          discountAmount: cartAllocation.totalDiscount,
          totalAmount: cartAllocation.netTotal,
          paidAmount: cartAllocation.totalPaid,
          debtAmount: cartAllocation.totalDebt,
          status: cartAllocation.status,
        }
      : calculateSaleSummary(qtyNum, priceNum, paidNum, computedDiscountAmount);

  const clearCurrentLineInputsOnly = () => {
    setSelectedProductId('');
    setQuantity('');
    setUnitPrice('');
    setDosageGuide('');
    setPromotionType('none');
    setDiscountMode('amount');
    setDiscountInput('');
    setSelectedGiftProductId('');
    setGiftQuantity('1');
    setShowNewGiftBox(false);
  };

  const handleAddCurrentItemToCart = () => {
    setFormMessage(null);
    let resolvedProduct = products.find((p) => p.id === selectedProductId) || null;
    if (showNewProductBox || selectedProductId === '__new_product__') {
      const createdProd = handleConfirmInlineProduct();
      if (!createdProd) return;
      resolvedProduct = createdProd;
    }
    if (!resolvedProduct) {
      setFormMessage({
        type: 'error',
        text: 'Vui lòng chọn vật tư nông nghiệp trước khi thêm vào giỏ hóa đơn.',
      });
      return;
    }
    if (qtyNum <= 0) {
      setFormMessage({ type: 'error', text: 'Vui lòng nhập Số lượng bán lớn hơn 0.' });
      return;
    }

    let resolvedGiftProduct: ProductItem | null = null;
    if (hasGiftActive) {
      if (showNewGiftBox || selectedGiftProductId === '__new_gift__') {
        const createdGift = handleConfirmInlineGiftProduct();
        if (!createdGift) return;
        resolvedGiftProduct = createdGift;
      } else if (selectedGiftProductId) {
        resolvedGiftProduct = products.find((p) => p.id === selectedGiftProductId) || null;
      }
      if (!resolvedGiftProduct) {
        setFormMessage({
          type: 'error',
          text: 'Vui lòng chọn mặt hàng Quà tặng khuyến mãi trước khi thêm vào giỏ.',
        });
        return;
      }
    }

    const effectivePrice = priceNum > 0 ? priceNum : resolvedProduct.sellPrice;
    const effectiveGross = Math.round(qtyNum * effectivePrice);
    const effectiveDiscount = hasDiscountActive
      ? discountMode === 'percent'
        ? Math.round((effectiveGross * Math.min(100, rawDiscountNum)) / 100)
        : Math.min(effectiveGross, Math.round(rawDiscountNum))
      : 0;

    const newItem: PosCartDraftItem = {
      id: `cart_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      productId: resolvedProduct.id,
      productName: resolvedProduct.name,
      unit: resolvedProduct.unit,
      quantity: qtyNum,
      unitPrice: effectivePrice,
      promotionType,
      discountAmount: effectiveDiscount,
      discountPercent: computedDiscountPercent,
      giftProductId: resolvedGiftProduct?.id,
      giftProductName: resolvedGiftProduct?.name,
      giftUnit: resolvedGiftProduct?.unit,
      giftQuantity: resolvedGiftProduct ? giftQtyNum : 0,
      dosageGuide: dosageGuide.trim() || undefined,
    };

    const nextCart = [...posCartItems, newItem];
    const check = validateCartInventory(products, nextCart);
    if (!check.valid) {
      setFormMessage({ type: 'error', text: check.error || 'Tồn kho không đủ.' });
      return;
    }

    setPosCartItems(nextCart);
    if (dosageGuide.trim() && dosageGuide.trim() !== (resolvedProduct.dosageGuide || '').trim()) {
      onBindProductNoteToProduct?.(resolvedProduct.id, dosageGuide.trim());
    }
    clearCurrentLineInputsOnly();
    setFormMessage({
      type: 'success',
      text: `Đã thêm "${resolvedProduct.name}" (${qtyNum} ${resolvedProduct.unit}) vào giỏ POS (${nextCart.length} mặt hàng trên 1 hóa đơn). Chọn tiếp vật tư khác hoặc bấm Lưu đơn!`,
    });
  };

  const quickCartQuantities = posCartItems.reduce<Record<string, number>>((acc, item) => {
    acc[item.productId] = (acc[item.productId] || 0) + item.quantity;
    return acc;
  }, {});

  const quickMaxQuantities = products.reduce<Record<string, number>>((acc, p) => {
    acc[p.id] = Math.max(0, Number(p.stock) || 0);
    return acc;
  }, {});

  const handleQuickSetCartProductQuantity = (productId: string, nextQty: number) => {
    const prod = products.find((p) => p.id === productId);
    if (!prod) return;
    setFormMessage(null);
    const res = upsertQuickCartProductQuantity(posCartItems, prod, nextQty, products);
    if (res.error) {
      setFormMessage({ type: 'error', text: res.error });
      return;
    }
    setPosCartItems(res.items);
    // Avoid double-counting if the same product was also filled in single-item inputs
    if (selectedProductId === productId) {
      clearCurrentLineInputsOnly();
    }
    if (!selectedWarehouse && !lockedWarehouse && prod.warehouseName && nextQty > 0) {
      setSelectedWarehouse(prod.warehouseName);
    }
  };

  const handleUpdateCartItemQty = (itemId: string, delta: number) => {
    setPosCartItems((prev) => {
      const next = prev
        .map((item) =>
          item.id === itemId ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item
        )
        .filter((item) => item.quantity > 0);
      const check = validateCartInventory(products, next);
      if (!check.valid) {
        setFormMessage({ type: 'error', text: check.error || 'Tồn kho không đủ.' });
        return prev;
      }
      return next;
    });
  };

  const handleExportGroupedInvoicePdf = (sale: SaleTransaction) => {
    const groupSales = findInvoiceGroupSales(sales, sale);
    const cust = customers.find((c) => c.id === sale.customerId);
    exportSaleInvoicePDF({
      ...sale,
      customerAddress: cust?.address,
      totalAmount: groupSales.reduce((sum, r) => sum + r.totalAmount, 0),
      paidAmount: groupSales.reduce((sum, r) => sum + r.paidAmount, 0),
      debtAmount: groupSales.reduce((sum, r) => sum + r.debtAmount, 0),
      discountAmount: groupSales.reduce((sum, r) => sum + (r.discountAmount || 0), 0),
      items: groupSales.map((r) => ({
        productName: r.productName,
        unit: r.unit,
        quantity: r.quantity,
        unitPrice: r.unitPrice,
        discountAmount: r.discountAmount,
        giftProductName: r.giftProductName,
        giftUnit: r.giftUnit,
        giftQuantity: r.giftQuantity,
        dosageGuide: r.dosageGuide,
      })),
      bankQrConfig,
    });
  };

  const handleExportGroupedThermalPdf = (sale: SaleTransaction, paperWidthMm: 58 | 80 = 80) => {
    const groupSales = findInvoiceGroupSales(sales, sale);
    exportThermalReceiptPDF({
      paperWidthMm,
      storeName: sale.warehouseName || 'VTNN Tâm An',
      voucherTitle: 'Hóa Đơn Bán Hàng',
      voucherCode: sale.invoiceCode,
      dateStr: sale.createdAt.slice(0, 16),
      partnerLabel: 'Khách hàng',
      partnerName: sale.customerName,
      partnerPhone: sale.customerPhone,
      items: groupSales.map((r) => ({
        productName: r.productName,
        unit: r.unit,
        quantity: r.quantity,
        unitPrice: r.unitPrice,
        discountAmount: r.discountAmount,
        giftProductName: r.giftProductName,
        giftUnit: r.giftUnit,
        giftQuantity: r.giftQuantity,
        dosageGuide: r.dosageGuide,
      })),
      bankQrConfig,
      totalLabel: 'Tổng thanh toán:',
      totalAmount: groupSales.reduce((sum, r) => sum + r.totalAmount, 0),
      paidLabel: 'Đã thanh toán:',
      paidAmount: groupSales.reduce((sum, r) => sum + r.paidAmount, 0),
      debtLabel: 'Còn ghi nợ:',
      remainingDebt: groupSales.reduce((sum, r) => sum + r.debtAmount, 0),
      dueDate: sale.dueDate,
      staffName: sale.staffName,
      note: sale.note,
    });
  };

  const handleSendInvoiceZalo = (targetSales: SaleTransaction[]) => {
    if (targetSales.length === 0) return;
    const first = targetSales[0];
    const { message, zaloUrl } = buildZaloInvoiceAndDosageMessage({
      storeName: first.warehouseName || 'VTNN Tâm An',
      invoiceCode: first.invoiceCode,
      customerName: first.customerName,
      customerPhone: first.customerPhone,
      dateStr: first.createdAt,
      items: targetSales.map((s) => ({
        productName: s.productName,
        quantity: s.quantity,
        unit: s.unit,
        unitPrice: s.unitPrice,
        totalAmount: s.totalAmount,
        discountAmount: s.discountAmount,
        giftProductName: s.giftProductName,
        giftQuantity: s.giftQuantity,
        giftUnit: s.giftUnit,
        dosageGuide: s.dosageGuide,
      })),
      totalAmount: targetSales.reduce((sum, s) => sum + s.totalAmount, 0),
      paidAmount: targetSales.reduce((sum, s) => sum + s.paidAmount, 0),
      debtAmount: targetSales.reduce((sum, s) => sum + s.debtAmount, 0),
      dueDate: first.dueDate,
      bankConfig: bankQrConfig,
    });
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(message).catch(() => undefined);
    }
    if (zaloUrl && typeof window !== 'undefined') {
      window.open(zaloUrl, '_blank', 'noopener,noreferrer');
      onNotifyToast?.(
        `Đã sao chép Hóa đơn + Hướng dẫn pha phun (${first.invoiceCode}) & mở Zalo cho ${first.customerName}!`
      );
    } else {
      onNotifyToast?.(
        `Đã sao chép Hóa đơn + Hướng dẫn pha phun (${first.invoiceCode}) vào bộ nhớ tạm!`
      );
    }
  };

  const handleOpenSaleVietQr = (targetSales: SaleTransaction[]) => {
    if (targetSales.length === 0) return;
    const first = targetSales[0];
    const totalAmt = targetSales.reduce((sum, s) => sum + s.totalAmount, 0);
    const totalDebt = targetSales.reduce((sum, s) => sum + s.debtAmount, 0);
    const qrAmount = totalDebt > 0 ? totalDebt : totalAmt;
    const { message } = buildZaloInvoiceAndDosageMessage({
      storeName: first.warehouseName || 'VTNN Tâm An',
      invoiceCode: first.invoiceCode,
      customerName: first.customerName,
      customerPhone: first.customerPhone,
      dateStr: first.createdAt,
      items: targetSales.map((s) => ({
        productName: s.productName,
        quantity: s.quantity,
        unit: s.unit,
        unitPrice: s.unitPrice,
        totalAmount: s.totalAmount,
        discountAmount: s.discountAmount,
        giftProductName: s.giftProductName,
        giftQuantity: s.giftQuantity,
        giftUnit: s.giftUnit,
        dosageGuide: s.dosageGuide,
      })),
      totalAmount: totalAmt,
      paidAmount: targetSales.reduce((sum, s) => sum + s.paidAmount, 0),
      debtAmount: totalDebt,
      dueDate: first.dueDate,
      bankConfig: bankQrConfig,
    });
    setVietQrModalTarget({
      title: `VietQR hóa đơn ${first.invoiceCode}`,
      subtitle: `${first.customerName} · ${targetSales.length} mặt hàng`,
      amount: qrAmount,
      addInfo: `TT ${first.invoiceCode} ${first.customerName}`,
      customerPhone: first.customerPhone,
      zaloMessage: message,
    });
  };

  const selectedCustomerObj =
    selectedCustomerId && selectedCustomerId !== '__new_customer__'
      ? customers.find((c) => c.id === selectedCustomerId) || null
      : null;
  const customerOldDebt = computeCustomerOldDebtSummary(
    selectedCustomerObj,
    sales,
    summary.debtAmount
  );

  // Sort products so gift items ([QUATANG] or sellPrice === 0 or name contains QUÀ) appear first in gift selector
  const giftSortedProducts = [...products].sort((a, b) => {
    const aIsGift =
      a.code.toUpperCase().includes('QUA') ||
      a.name.toUpperCase().includes('QUÀ') ||
      a.sellPrice === 0
        ? 1
        : 0;
    const bIsGift =
      b.code.toUpperCase().includes('QUA') ||
      b.name.toUpperCase().includes('QUÀ') ||
      b.sellPrice === 0
        ? 1
        : 0;
    return bIsGift - aIsGift;
  });

  const submitSale = (shouldExportPDF: boolean) => {
    setFormMessage(null);

    // Resolve warehouse
    let resolvedWarehouse = lockedWarehouse || selectedWarehouse;
    if (!lockedWarehouse && (showNewWarehouseBox || selectedWarehouse === '__new_warehouse__')) {
      const createdWh = handleConfirmInlineWarehouseInSale();
      if (!createdWh) return;
      resolvedWarehouse = createdWh;
    }

    // Resolve customer (either existing or auto-create if inline customer box has data)
    let resolvedCustomer = customers.find((c) => c.id === selectedCustomerId) || null;
    if (showNewCustomerBox || selectedCustomerId === '__new_customer__') {
      const createdCust = handleConfirmInlineCustomer();
      if (!createdCust) return;
      resolvedCustomer = createdCust;
    }
    if (!resolvedCustomer) {
      setFormMessage({
        type: 'error',
        text: 'Vui lòng chọn khách hàng hoặc bấm "+ Tạo khách hàng mới" để điền thông tin.',
      });
      return;
    }

    // MULTI-ITEM POS CART CHECKOUT PATH
    if (posCartItems.length > 0 && onCreateMultiItemSale) {
      const finalCartItems: PosCartDraftItem[] = [...posCartItems];
      // Also include currently selected product in form if user filled it without clicking "+ Thêm vào giỏ"
      if (selectedProductId && selectedProductId !== '__new_product__' && qtyNum > 0) {
        const draftProd = products.find((p) => p.id === selectedProductId);
        if (draftProd) {
          const effPrice = priceNum > 0 ? priceNum : draftProd.sellPrice;
          const effGross = Math.round(qtyNum * effPrice);
          const effDiscount = hasDiscountActive
            ? discountMode === 'percent'
              ? Math.round((effGross * Math.min(100, rawDiscountNum)) / 100)
              : Math.min(effGross, Math.round(rawDiscountNum))
            : 0;
          finalCartItems.push({
            id: `cart_last_${Date.now()}`,
            productId: draftProd.id,
            productName: draftProd.name,
            unit: draftProd.unit,
            quantity: qtyNum,
            unitPrice: effPrice,
            promotionType,
            discountAmount: effDiscount,
            discountPercent: computedDiscountPercent,
            giftProductId: selectedGiftProductObj?.id,
            giftProductName: selectedGiftProductObj?.name,
            giftUnit: selectedGiftProductObj?.unit,
            giftQuantity: selectedGiftProductObj ? giftQtyNum : 0,
            dosageGuide: dosageGuide.trim() || undefined,
          });
        }
      }

      const invCheck = validateCartInventory(products, finalCartItems);
      if (!invCheck.valid) {
        setFormMessage({ type: 'error', text: invCheck.error || 'Tồn kho không đủ.' });
        return;
      }

      if (!resolvedWarehouse || resolvedWarehouse === '__new_warehouse__') {
        const firstProd = products.find((p) => p.id === finalCartItems[0].productId);
        resolvedWarehouse = firstProd?.warehouseName || warehouses[0] || 'Tâm An Mỹ Ngãi';
      }

      try {
        const alloc = allocatePaymentAcrossCartItems(
          finalCartItems,
          paymentMode === 'full' ? Number.MAX_SAFE_INTEGER : Math.max(0, Number(paidAmount) || 0)
        );
        const createdSales = onCreateMultiItemSale({
          customerId: resolvedCustomer.id,
          customerName: resolvedCustomer.name,
          customerPhone: resolvedCustomer.phone,
          warehouseName: resolvedWarehouse,
          dueDate:
            alloc.totalDebt > 0
              ? dueDate || computeDueDateAfterDays(7)
              : computeDueDateAfterDays(0),
          note: note.trim(),
          totalPaidAmount: alloc.totalPaid,
          items: finalCartItems,
        });

        const sharedCode = createdSales[0]?.invoiceCode || 'HD';
        setLastCreatedOrder({
          invoiceCode: sharedCode,
          warehouseName: resolvedWarehouse,
          customerName: resolvedCustomer.name,
          customerPhone: resolvedCustomer.phone,
          customerAddress: resolvedCustomer.address,
          sales: createdSales,
        });

        if (shouldExportPDF && createdSales.length > 0) {
          exportSaleInvoicePDF({
            ...createdSales[0],
            customerAddress: resolvedCustomer.address,
            totalAmount: createdSales.reduce((s, r) => s + r.totalAmount, 0),
            paidAmount: createdSales.reduce((s, r) => s + r.paidAmount, 0),
            debtAmount: createdSales.reduce((s, r) => s + r.debtAmount, 0),
            discountAmount: createdSales.reduce((s, r) => s + (r.discountAmount || 0), 0),
            items: createdSales.map((r) => ({
              productName: r.productName,
              unit: r.unit,
              quantity: r.quantity,
              unitPrice: r.unitPrice,
              discountAmount: r.discountAmount,
              giftProductName: r.giftProductName,
              giftUnit: r.giftUnit,
              giftQuantity: r.giftQuantity,
              dosageGuide: r.dosageGuide,
            })),
            bankQrConfig,
          });
        }

        resetAllSaleFieldsToBlank();
        setFormMessage({
          type: 'success',
          text: shouldExportPDF
            ? `Đã lưu & xuất PDF hóa đơn ${sharedCode} gồm ${createdSales.length} mặt hàng (${resolvedCustomer.name}). Dùng thanh nút nhanh bên dưới để Hiện QR VietQR, In K80 hoặc Gửi Zalo!`
            : `Đã lưu hóa đơn POS ${sharedCode} gồm ${createdSales.length} mặt hàng tại ${resolvedWarehouse}. Dùng thanh nút nhanh bên dưới để Hiện QR VietQR, In K80 hoặc Gửi Zalo!`,
        });
      } catch (err) {
        setFormMessage({
          type: 'error',
          text: err instanceof Error ? err.message : 'Có lỗi khi tạo hóa đơn nhiều mặt hàng.',
        });
      }
      return;
    }

    // Resolve product (either existing or auto-create if inline product box has data)
    let resolvedProduct = products.find((p) => p.id === selectedProductId) || null;
    if (showNewProductBox || selectedProductId === '__new_product__') {
      const createdProd = handleConfirmInlineProduct();
      if (!createdProd) return;
      resolvedProduct = createdProd;
    }
    if (!resolvedProduct) {
      setFormMessage({
        type: 'error',
        text: 'Vui lòng chọn vật tư nông nghiệp hoặc bấm "+ Thêm vật tư mới" để bổ sung.',
      });
      return;
    }

    if (!resolvedWarehouse || resolvedWarehouse === '__new_warehouse__') {
      resolvedWarehouse = resolvedProduct.warehouseName || warehouses[0] || 'Tâm An Mỹ Ngãi';
    }

    if (qtyNum <= 0) {
      setFormMessage({ type: 'error', text: 'Vui lòng nhập Số lượng bán lớn hơn 0.' });
      return;
    }
    if (resolvedProduct.stock < qtyNum) {
      setFormMessage({
        type: 'error',
        text: `Tồn kho không đủ! "${resolvedProduct.name}" hiện chỉ còn ${resolvedProduct.stock} ${resolvedProduct.unit}.`,
      });
      return;
    }

    // Resolve Promotional Gift if gift mode is active
    let resolvedGiftProduct: ProductItem | null = null;
    if (hasGiftActive) {
      if (showNewGiftBox || selectedGiftProductId === '__new_gift__') {
        const createdGift = handleConfirmInlineGiftProduct();
        if (!createdGift) return;
        resolvedGiftProduct = createdGift;
      } else if (selectedGiftProductId) {
        resolvedGiftProduct = products.find((p) => p.id === selectedGiftProductId) || null;
      }
      if (!resolvedGiftProduct) {
        setFormMessage({
          type: 'error',
          text: 'Vui lòng chọn mặt hàng Quà tặng khuyến mãi trong kho hoặc bấm "+ Thêm quà tặng mới".',
        });
        return;
      }
      const requiredGiftStock =
        resolvedGiftProduct.id === resolvedProduct.id ? qtyNum + giftQtyNum : giftQtyNum;
      if (resolvedGiftProduct.stock < requiredGiftStock) {
        setFormMessage({
          type: 'error',
          text: `Tồn kho quà tặng "${resolvedGiftProduct.name}" không đủ! Hiện chỉ còn ${resolvedGiftProduct.stock} ${resolvedGiftProduct.unit}.`,
        });
        return;
      }
    }

    try {
      const effectivePrice = priceNum > 0 ? priceNum : resolvedProduct.sellPrice;
      const effectiveGross = Math.round(qtyNum * effectivePrice);
      const effectiveDiscount = hasDiscountActive
        ? discountMode === 'percent'
          ? Math.round((effectiveGross * Math.min(100, rawDiscountNum)) / 100)
          : Math.min(effectiveGross, Math.round(rawDiscountNum))
        : 0;
      const effectiveNet = Math.max(0, effectiveGross - effectiveDiscount);

      const effectiveSummary = calculateSaleSummary(
        qtyNum,
        effectivePrice,
        paymentMode === 'full' ? effectiveNet : paidNum,
        effectiveDiscount
      );

      const createdSale = onCreateSale({
        customerId: resolvedCustomer.id,
        customerName: resolvedCustomer.name,
        customerPhone: resolvedCustomer.phone,
        productId: resolvedProduct.id,
        quantity: qtyNum,
        unitPrice: effectivePrice,
        paidAmount: effectiveSummary.paidAmount,
        dueDate:
          effectiveSummary.debtAmount > 0
            ? dueDate || computeDueDateAfterDays(7)
            : computeDueDateAfterDays(0),
        note: note.trim(),
        warehouseName: resolvedWarehouse,
        promotionType,
        discountAmount: effectiveSummary.discountAmount,
        discountPercent: computedDiscountPercent,
        giftProductId: resolvedGiftProduct?.id,
        giftProductName: resolvedGiftProduct?.name,
        giftUnit: resolvedGiftProduct?.unit,
        giftQuantity: resolvedGiftProduct ? giftQtyNum : 0,
        giftUnitCost: resolvedGiftProduct?.importPrice || 0,
        dosageGuide: dosageGuide.trim() || undefined,
      });

      if (dosageGuide.trim() && dosageGuide.trim() !== (resolvedProduct.dosageGuide || '').trim()) {
        onBindProductNoteToProduct?.(resolvedProduct.id, dosageGuide.trim());
      }

      setLastCreatedOrder({
        invoiceCode: createdSale.invoiceCode,
        warehouseName: resolvedWarehouse,
        customerName: resolvedCustomer.name,
        customerPhone: resolvedCustomer.phone,
        customerAddress: resolvedCustomer.address,
        sales: [createdSale],
      });

      if (shouldExportPDF) {
        exportSaleInvoicePDF({
          ...createdSale,
          customerAddress: resolvedCustomer.address,
          bankQrConfig,
        });
      }

      // Immediately clear ALL fields to blank so user can enter next order right away
      resetAllSaleFieldsToBlank();

      setFormMessage({
        type: 'success',
        text: shouldExportPDF
          ? `Đã lưu & xuất phiếu PDF hóa đơn ${createdSale.invoiceCode} (${resolvedWarehouse}). Toàn bộ ô nhập đã được làm trống để tạo đơn mới tiếp theo!`
          : `Đã lưu hóa đơn ${createdSale.invoiceCode} tại kho ${resolvedWarehouse} (${resolvedCustomer.name}). Toàn bộ ô nhập đã được làm trống để nhập đơn mới tiếp!`,
      });
    } catch (err) {
      setFormMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Có lỗi khi tạo đơn bán.',
      });
    }
  };

  const filteredSales = sales.filter((s) => {
    const sWh = s.warehouseName || 'Tâm An Mỹ Ngãi';
    if (lockedWarehouse && !areWarehouseNamesEquivalent(sWh, lockedWarehouse)) return false;
    if (
      !lockedWarehouse &&
      warehouseTableFilter !== 'all' &&
      !areWarehouseNamesEquivalent(sWh, warehouseTableFilter)
    ) {
      return false;
    }
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    const q = normalizeVietnameseSearch(searchQuery);
    if (!q) return true;
    return normalizeVietnameseSearch(
      `${s.invoiceCode} ${s.customerName} ${s.productName} ${s.customerPhone} ${sWh} ${s.note || ''}`
    ).includes(q);
  });

  const [salesViewMode, setSalesViewMode] = useState<'grouped' | 'flat'>('grouped');
  const [expandedInvoiceGroups, setExpandedInvoiceGroups] = useState<Record<string, boolean>>({});
  const [salesRowLimit, setSalesRowLimit] = useState<number>(80);

  useEffect(() => {
    setSalesRowLimit(80);
  }, [searchQuery, statusFilter, warehouseTableFilter]);

  const groupedFilteredSales = groupSalesByInvoice(filteredSales);
  const distinctFilteredInvoicesCount = groupedFilteredSales.length;
  const hasMultiItemInvoices = filteredSales.length > distinctFilteredInvoicesCount;

  const displayedFlatSales =
    focusedSaleRecord && filteredSales.findIndex((s) => s.id === focusedSaleRecord.id) >= salesRowLimit
      ? filteredSales
      : filteredSales.slice(0, salesRowLimit);

  const displayedGroupedSales =
    focusedSaleRecord &&
    groupedFilteredSales.findIndex((g) => g.items.some((i) => i.id === focusedSaleRecord.id)) >=
      salesRowLimit
      ? groupedFilteredSales
      : groupedFilteredSales.slice(0, salesRowLimit);

  // Customer Return / Exchange Modal State (TH-...)
  const [returningSale, setReturningSale] = useState<SaleTransaction | null>(null);
  const [returnQtyInput, setReturnQtyInput] = useState<string>('1');
  const [returnGiftQtyInput, setReturnGiftQtyInput] = useState<string>('0');
  const [returnReasonInput, setReturnReasonInput] = useState<string>('Dư sau mùa vụ');

  const openCustomerReturnModal = (s: SaleTransaction) => {
    if (!canPerformRoleAction(role, 'edit_record') || !onProcessCustomerReturn) return;
    setReturningSale(s);
    setReturnQtyInput('1');
    setReturnGiftQtyInput('0');
    setReturnReasonInput('Dư sau mùa vụ');
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Blank-by-Default Fast Sale Form with Inline Warehouse, Customer & Product Creation */}
        <div className="xl:col-span-5 bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/60 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-emerald-700" />
                <span>Ghi Nhật Ký Bán Hàng Nhanh</span>
              </h2>
            </div>
            <button
              type="button"
              onClick={resetAllSaleFieldsToBlank}
              title="Làm trống màn hình nhập"
              className="px-2.5 py-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Làm trống</span>
            </button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitSale(false);
            }}
            className="p-6 space-y-4"
          >
            {formMessage && (
              <div
                className={`p-3 rounded-lg border text-xs font-medium flex items-center gap-2 ${
                  formMessage.type === 'error'
                    ? 'bg-red-50 border-red-200 text-red-700'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                }`}
              >
                {formMessage.type === 'error' ? (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                )}
                <span>{formMessage.text}</span>
              </div>
            )}

            {/* Warehouse Selection when exporting sales invoice + Inline New Warehouse Creation */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="sale-warehouse-select"
                  className="block text-xs font-semibold text-slate-700 flex items-center gap-1.5"
                >
                  <Warehouse className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Chọn kho xuất bán hóa đơn *</span>
                </label>
                {!lockedWarehouse && (
                  <button
                    type="button"
                    onClick={() => {
                      const next = !showNewWarehouseBox;
                      setShowNewWarehouseBox(next);
                      setSelectedWarehouse(next ? '__new_warehouse__' : '');
                    }}
                    className="text-xs font-semibold text-emerald-700 hover:underline flex items-center gap-1 whitespace-nowrap"
                  >
                    <FolderPlus className="w-3.5 h-3.5" />
                    <span>{showNewWarehouseBox ? 'Đóng thêm kho' : '+ Tạo thêm kho mới'}</span>
                  </button>
                )}
              </div>

              {lockedWarehouse ? (
                <div className="px-3 py-2 text-xs font-semibold bg-emerald-50 text-emerald-900 border border-emerald-200 rounded-lg flex items-center justify-between">
                  <span>Kho được phân quyền: {lockedWarehouse}</span>
                  <span className="text-[11px] text-emerald-700">Nhân viên kho riêng</span>
                </div>
              ) : (
                <SearchableSelect
                  id="sale-warehouse-select"
                  value={selectedWarehouse === '__new_warehouse__' ? '' : selectedWarehouse}
                  onChange={(v) => {
                    setSelectedWarehouse(v);
                    setShowNewWarehouseBox(false);
                  }}
                  placeholder="Gõ tên kho (Mỹ Ngãi, Cao Lãnh, Mỹ Trà...) để chọn nhanh"
                  emptyOptionLabel="-- Để trống / Chưa chọn kho --"
                  createActionLabel="+ Tạo thêm kho mới trực tiếp tại đây..."
                  onCreateAction={(kw) => {
                    setSelectedWarehouse('__new_warehouse__');
                    setShowNewWarehouseBox(true);
                    if (kw) setNewWarehouseName(kw);
                  }}
                  options={warehouses.map((w) => ({
                    value: w,
                    label: `Kho: ${w}`,
                    subLabel: 'Kho vật tư nông nghiệp Tâm An',
                    badge: w,
                    keywords: w,
                  }))}
                />
              )}

              {showNewWarehouseBox && !lockedWarehouse && (
                <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-lg space-y-2">
                  <div className="text-xs font-bold text-emerald-900">
                    Bổ sung kho mới trực tiếp
                  </div>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <input
                      type="text"
                      value={newWarehouseName}
                      onChange={(e) => setNewWarehouseName(e.target.value)}
                      placeholder="VD: Tâm An Tháp Mười"
                      className="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
                    />
                    <button
                      type="button"
                      onClick={handleConfirmInlineWarehouseInSale}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md whitespace-nowrap"
                    >
                      Lưu kho & Chọn
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 1. Customer Selection + Inline New Customer Creation */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="sale-customer-select"
                  className="block text-xs font-semibold text-slate-700"
                >
                  1. Chọn khách hàng *
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const nextState = !showNewCustomerBox;
                    setShowNewCustomerBox(nextState);
                    setSelectedCustomerId(nextState ? '__new_customer__' : '');
                  }}
                  className="text-xs font-semibold text-emerald-700 hover:underline flex items-center gap-1 whitespace-nowrap"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>{showNewCustomerBox ? 'Đóng khung tạo mới' : '+ Tạo khách hàng mới'}</span>
                </button>
              </div>

              <SearchableSelect
                id="sale-customer-select"
                value={selectedCustomerId === '__new_customer__' ? '' : selectedCustomerId}
                onChange={(val) => handleCustomerSelectChange(val)}
                placeholder="Gõ tên khách hàng, SĐT (0913...), mã KH hoặc nhóm để tìm nhanh..."
                emptyOptionLabel="-- Chưa chọn khách hàng --"
                createActionLabel="+ Tạo khách hàng mới trực tiếp tại đây..."
                onCreateAction={(kw) => {
                  setSelectedCustomerId('__new_customer__');
                  setShowNewCustomerBox(true);
                  if (kw) setNewCustName(kw);
                }}
                options={customers.map((c) => ({
                  value: c.id,
                  label: `${c.name} (${c.phone}) — ${c.group}`,
                  subLabel: `Mã: ${c.code} · Địa chỉ: ${c.address || 'Chưa cập nhật'} · Công nợ cũ: ${formatVND(c.totalDebt)}`,
                  badge: c.totalDebt > 0 ? `Nợ cũ: ${formatVND(c.totalDebt)}` : c.group,
                  keywords: `${c.name} ${c.phone} ${c.code} ${c.group} ${c.address}`,
                }))}
              />

              {/* Old Customer Debt Reminder Banner right when Customer is selected (Only Total Old Debt) */}
              {customerOldDebt.hasCustomer && (
                <div
                  className={`p-3 rounded-lg border text-xs flex flex-wrap items-center justify-between gap-2 ${
                    customerOldDebt.oldDebtAmount > 0
                      ? 'bg-amber-50/90 border-amber-300 text-amber-950'
                      : 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                  }`}
                >
                  <span className="font-bold flex items-center gap-1.5">
                    <AlertCircle
                      className={`w-3.5 h-3.5 shrink-0 ${
                        customerOldDebt.oldDebtAmount > 0 ? 'text-red-600' : 'text-emerald-700'
                      }`}
                    />
                    <span>Tổng công nợ cũ ({customerOldDebt.customerName}):</span>
                  </span>
                  <span
                    className={`font-mono font-bold text-sm ${
                      customerOldDebt.oldDebtAmount > 0 ? 'text-red-600' : 'text-emerald-700'
                    }`}
                  >
                    {formatVND(customerOldDebt.oldDebtAmount)}
                  </span>
                </div>
              )}

              {showNewCustomerBox && (
                <div className="p-3.5 bg-emerald-50/60 rounded-lg border border-emerald-200 space-y-3">
                  <div className="text-xs font-bold text-emerald-900">
                    Tạo khách hàng mới trực tiếp trong đơn bán
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label
                        htmlFor="inline-cust-name"
                        className="block text-[11px] font-semibold text-slate-700 mb-1"
                      >
                        Họ tên khách hàng *
                      </label>
                      <input
                        id="inline-cust-name"
                        type="text"
                        value={newCustName}
                        onChange={(e) => setNewCustName(e.target.value)}
                        placeholder="VD: Ông Nguyễn Văn Hòa"
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="inline-cust-phone"
                        className="block text-[11px] font-semibold text-slate-700 mb-1"
                      >
                        Số điện thoại *
                      </label>
                      <input
                        id="inline-cust-phone"
                        type="tel"
                        value={newCustPhone}
                        onChange={(e) => setNewCustPhone(e.target.value)}
                        placeholder="VD: 0913456789"
                        className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-md"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label
                        htmlFor="inline-cust-address"
                        className="block text-[11px] font-semibold text-slate-700 mb-1"
                      >
                        Địa chỉ
                      </label>
                      <input
                        id="inline-cust-address"
                        type="text"
                        value={newCustAddress}
                        onChange={(e) => setNewCustAddress(e.target.value)}
                        placeholder="Ấp, Xã, Huyện..."
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label
                        htmlFor="inline-cust-group"
                        className="block text-[11px] font-semibold text-slate-700"
                      >
                        Phân nhóm khách hàng
                      </label>
                      <SearchableSelect
                        id="inline-cust-group"
                        value={newCustGroup === '__new_group__' ? '' : newCustGroup}
                        onChange={(v) => {
                          setNewCustGroup(v as CustomerGroup);
                          setShowInlineCustGroupInput(false);
                        }}
                        placeholder="Gõ tên phân nhóm KH để chọn nhanh..."
                        emptyOptionLabel="-- Chưa chọn nhóm --"
                        createActionLabel="+ Tạo nhóm khách hàng mới trực tiếp..."
                        onCreateAction={(kw) => {
                          setNewCustGroup('__new_group__');
                          setShowInlineCustGroupInput(true);
                          if (kw) setInlineCustGroupText(kw);
                        }}
                        options={customerGroups.map((grp) => ({
                          value: grp,
                          label: grp,
                          keywords: grp,
                        }))}
                      />
                      {showInlineCustGroupInput && (
                        <input
                          type="text"
                          value={inlineCustGroupText}
                          onChange={(e) => setInlineCustGroupText(e.target.value)}
                          placeholder="Nhập tên nhóm KH mới..."
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-emerald-300 rounded-md"
                        />
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleConfirmInlineCustomer}
                    className="w-full py-1.5 px-3 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors"
                  >
                    Lưu khách hàng mới & Chọn ngay vào đơn
                  </button>
                </div>
              )}
            </div>

            {/* 2. Product Selection + Inline New Product Creation */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="sale-product-select"
                  className="block text-xs font-semibold text-slate-700"
                >
                  2. Chọn vật tư nông nghiệp *
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsBarcodeScannerOpen(true)}
                    className="px-2 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md flex items-center gap-1 whitespace-nowrap"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>Quét mã</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (onRequestAddNewProductInImports) {
                        onRequestAddNewProductInImports('');
                        return;
                      }
                      const nextState = !showNewProductBox;
                      setShowNewProductBox(nextState);
                      setSelectedProductId(nextState ? '__new_product__' : '');
                    }}
                    className="text-xs font-semibold text-emerald-700 hover:underline flex items-center gap-1 whitespace-nowrap"
                  >
                    <PackagePlus className="w-3.5 h-3.5" />
                    <span>{showNewProductBox ? 'Đóng khung thêm VT' : '+ Thêm vật tư mới'}</span>
                  </button>
                </div>
              </div>

              <SearchableSelect
                id="sale-product-select"
                value={selectedProductId === '__new_product__' ? '' : selectedProductId}
                onChange={(val) => handleProductSelectChange(val)}
                placeholder="Gõ tên vật tư (NPK, Anvil, GAP...), mã VT hoặc kho để tìm nhanh..."
                emptyOptionLabel="-- Chưa chọn vật tư --"
                createActionLabel="+ Thêm vật tư nông nghiệp mới trực tiếp tại đây..."
                quickQuantities={onCreateMultiItemSale ? quickCartQuantities : undefined}
                quickMaxQuantities={onCreateMultiItemSale ? quickMaxQuantities : undefined}
                onQuickQuantityChange={
                  onCreateMultiItemSale ? handleQuickSetCartProductQuantity : undefined
                }
                quickCartSummaryLabel={
                  posCartItems.length > 0
                    ? `Đã chọn nhanh ${posCartItems.length} mặt hàng vào hóa đơn chung (bấm để chọn thêm)...`
                    : undefined
                }
                onCreateAction={(kw) => {
                  if (onRequestAddNewProductInImports) {
                    onRequestAddNewProductInImports(kw || '');
                    return;
                  }
                  setSelectedProductId('__new_product__');
                  setShowNewProductBox(true);
                  if (kw) setNewProdName(kw);
                }}
                options={products.map((p) => {
                  const expInfo = evaluateProductExpiry(p.expiryDate);
                  return {
                    value: p.id,
                    label: `${p.name} [${p.warehouseName || 'Tâm An Mỹ Ngãi'}] — Tồn: ${p.stock} ${p.unit} (${formatVND(p.sellPrice)})`,
                    subLabel: `Mã: ${p.code} · Nhóm: ${p.category} · NCC: ${p.supplierName}${
                      p.barcode ? ` · Barcode: ${p.barcode}` : ''
                    }${p.batchNumber ? ` · Lô: ${p.batchNumber}` : ''}${
                      p.expiryDate ? ` · HSD: ${p.expiryDate} (${expInfo.badgeLabel})` : ''
                    }`,
                    badge: formatVND(p.sellPrice),
                    keywords: `${p.name} ${p.code} ${p.barcode || ''} ${p.batchNumber || ''} ${p.category} ${p.warehouseName || ''} ${p.supplierName}`,
                  };
                })}
              />

              {posCartItems.length > 0 && (
                <div className="p-2.5 bg-emerald-50/70 rounded-xl border border-emerald-200 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-emerald-900">
                    <span className="flex items-center gap-1.5">
                      <ShoppingCart className="w-3.5 h-3.5 text-emerald-700" />
                      <span>
                        Hóa đơn chung POS ({posCartItems.length} mặt hàng ·{' '}
                        {formatVND(cartAllocation.netTotal)})
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setPosCartItems([])}
                      className="text-[11px] font-semibold text-red-600 hover:underline"
                    >
                      Xóa giỏ
                    </button>
                  </div>
                  <div className="divide-y divide-emerald-100 bg-white rounded-lg border border-emerald-100 px-2.5 max-h-56 overflow-y-auto">
                    {posCartItems.map((item, idx) => {
                      const lineNet = Math.max(
                        0,
                        Math.round(item.quantity * item.unitPrice) - (item.discountAmount || 0)
                      );
                      return (
                        <div key={item.id} className="py-2 flex items-start justify-between gap-2 text-xs">
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-slate-900 truncate">
                              {idx + 1}. {item.productName}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500">
                              {formatVND(item.unitPrice)} / {item.unit}
                              {(item.discountAmount || 0) > 0 && (
                                <span className="text-amber-700 ml-1.5">
                                  (-{formatVND(item.discountAmount || 0)})
                                </span>
                              )}
                            </div>
                            {item.giftProductName && (item.giftQuantity || 0) > 0 && (
                              <div className="text-[10px] text-emerald-700 font-semibold">
                                + Quà: {item.giftQuantity} {item.giftUnit || ''} {item.giftProductName}
                              </div>
                            )}
                            {item.dosageGuide && (
                              <div className="text-[10px] text-teal-800 truncate">
                                Liều lượng: {item.dosageGuide}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleUpdateCartItemQty(item.id, -1)}
                              aria-label={`Giảm số lượng ${item.productName}`}
                              className="w-6 h-6 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 font-bold text-slate-700"
                            >
                              -
                            </button>
                            <span className="w-7 text-center font-mono font-bold text-slate-900">
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleUpdateCartItemQty(item.id, 1)}
                              aria-label={`Tăng số lượng ${item.productName}`}
                              className="w-6 h-6 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 font-bold text-slate-700"
                            >
                              +
                            </button>
                            <span className="font-mono font-bold text-emerald-800 ml-1 min-w-[68px] text-right">
                              {formatVND(lineNet)}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setPosCartItems((prev) => prev.filter((x) => x.id !== item.id))
                              }
                              aria-label={`Bỏ ${item.productName} khỏi giỏ`}
                              className="p-1 text-slate-400 hover:text-red-600"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {currentProduct &&
                currentProduct.expiryDate &&
                (() => {
                  const exp = evaluateProductExpiry(currentProduct.expiryDate);
                  if (exp.status !== 'expired' && exp.status !== 'expiring_30d' && exp.status !== 'expiring_60d') {
                    return null;
                  }
                  return (
                    <div
                      className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 ${
                        exp.status === 'expired'
                          ? 'bg-red-50 border-red-200 text-red-800'
                          : 'bg-amber-50 border-amber-200 text-amber-800'
                      }`}
                    >
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <div>
                        <strong>Cảnh báo FEFO / Hạn sử dụng:</strong>{' '}
                        {currentProduct.batchNumber ? `Lô ${currentProduct.batchNumber} · ` : ''}
                        HSD {currentProduct.expiryDate} ({exp.badgeLabel}) — ưu tiên xuất lô này trước.
                      </div>
                    </div>
                  );
                })()}

              {showNewProductBox && (
                <div className="p-3.5 bg-emerald-50/60 rounded-lg border border-emerald-200 space-y-3">
                  <div className="text-xs font-bold text-emerald-900">
                    Bổ sung vật tư nông nghiệp mới trực tiếp
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div className="sm:col-span-2">
                      <label
                        htmlFor="inline-prod-name"
                        className="block text-[11px] font-semibold text-slate-700 mb-1"
                      >
                        Tên vật tư mới *
                      </label>
                      <input
                        id="inline-prod-name"
                        type="text"
                        value={newProdName}
                        onChange={(e) => setNewProdName(e.target.value)}
                        placeholder="VD: GAP DIỆT MẦM KÍCH RỄ"
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="inline-prod-unit"
                        className="block text-[11px] font-semibold text-slate-700 mb-1"
                      >
                        Đơn vị tính *
                      </label>
                      <input
                        id="inline-prod-unit"
                        type="text"
                        value={newProdUnit}
                        onChange={(e) => setNewProdUnit(e.target.value)}
                        placeholder="CẶP / Bao 50kg"
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label
                        htmlFor="inline-prod-sell"
                        className="block text-[11px] font-semibold text-slate-700 mb-1"
                      >
                        Giá bán (VNĐ) *
                      </label>
                      <input
                        id="inline-prod-sell"
                        type="number"
                        min={0}
                        value={newProdSellPrice}
                        onChange={(e) => setNewProdSellPrice(e.target.value)}
                        placeholder="350000"
                        className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-md"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="inline-prod-import"
                        className="block text-[11px] font-semibold text-slate-700 mb-1"
                      >
                        Giá nhập (VNĐ)
                      </label>
                      <input
                        id="inline-prod-import"
                        type="number"
                        min={0}
                        value={newProdImportPrice}
                        onChange={(e) => setNewProdImportPrice(e.target.value)}
                        placeholder="285000"
                        className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-md"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="inline-prod-stock"
                        className="block text-[11px] font-semibold text-slate-700 mb-1"
                      >
                        Tồn kho hiện có *
                      </label>
                      <input
                        id="inline-prod-stock"
                        type="number"
                        min={1}
                        value={newProdStock}
                        onChange={(e) => setNewProdStock(e.target.value)}
                        placeholder="26"
                        className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-md"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleConfirmInlineProduct}
                    className="w-full py-1.5 px-3 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors"
                  >
                    Lưu vật tư mới & Chọn ngay vào đơn
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 items-end">
              <div>
                <label
                  htmlFor="sale-qty-input"
                  className="block text-xs font-semibold text-slate-700 mb-1 truncate"
                >
                  SL bán ({currentProduct?.unit || 'Đơn vị'}) *
                </label>
                <input
                  id="sale-qty-input"
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="Nhập số lượng..."
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label
                  htmlFor="sale-price-input"
                  className="block text-xs font-semibold text-slate-700 mb-1 truncate"
                >
                  Đơn giá bán (VNĐ) *
                </label>
                <input
                  id="sale-price-input"
                  type="number"
                  min={0}
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                  placeholder="Nhập đơn giá..."
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                />
              </div>
            </div>

            {/* 3. Promotional Gift or Sale Discount Section */}
            <div className="space-y-2.5 p-3.5 bg-emerald-50/40 rounded-xl border border-emerald-200/80">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Gift className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                  <span>3. Chọn quà tặng khuyến mãi hoặc giảm giá bán</span>
                </span>
                {promotionType !== 'none' && (
                  <button
                    type="button"
                    onClick={() => {
                      setPromotionType('none');
                      setDiscountInput('');
                      setSelectedGiftProductId('');
                      setGiftQuantity('1');
                    }}
                    className="text-[11px] font-semibold text-slate-500 hover:text-red-600 underline whitespace-nowrap"
                  >
                    Bỏ ưu đãi
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-white rounded-lg border border-slate-200">
                {[
                  { id: 'none', label: 'Không áp dụng' },
                  { id: 'gift', label: 'Quà tặng KM' },
                  { id: 'discount', label: 'Giảm giá bán' },
                  { id: 'both', label: 'Quà + Giảm giá' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setPromotionType(opt.id as SalePromotionType)}
                    className={`py-1.5 px-2 text-xs font-semibold rounded-md transition-colors text-center ${
                      promotionType === opt.id
                        ? 'bg-emerald-700 text-white shadow-xs'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Gift Item Selector from Warehouse Inventory + Inline Gift Creation */}
              {hasGiftActive && (
                <div className="p-3 bg-white rounded-lg border border-emerald-200 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label
                      htmlFor="sale-gift-select"
                      className="text-xs font-semibold text-emerald-900 flex items-center gap-1.5"
                    >
                      <Gift className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                      <span>Chọn mặt hàng quà tặng khuyến mãi từ kho *</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !showNewGiftBox;
                        setShowNewGiftBox(next);
                        setSelectedGiftProductId(next ? '__new_gift__' : '');
                      }}
                      className="text-xs font-semibold text-emerald-700 hover:underline flex items-center gap-1 whitespace-nowrap"
                    >
                      <PackagePlus className="w-3.5 h-3.5" />
                      <span>{showNewGiftBox ? 'Đóng thêm quà' : '+ Thêm quà tặng mới'}</span>
                    </button>
                  </div>

                  <SearchableSelect
                    id="sale-gift-select"
                    value={selectedGiftProductId === '__new_gift__' ? '' : selectedGiftProductId}
                    onChange={(val) => {
                      if (val === '__new_gift__') {
                        setSelectedGiftProductId('__new_gift__');
                        setShowNewGiftBox(true);
                      } else {
                        setSelectedGiftProductId(val);
                        setShowNewGiftBox(false);
                      }
                    }}
                    placeholder="Gõ tên quà tặng ([QUATANG], áo, nón, phân bón tặng kèm...) để chọn..."
                    emptyOptionLabel="-- Chưa chọn quà tặng khuyến mãi --"
                    createActionLabel="+ Tạo mặt hàng quà tặng khuyến mãi mới tại đây..."
                    onCreateAction={(kw) => {
                      setSelectedGiftProductId('__new_gift__');
                      setShowNewGiftBox(true);
                      if (kw) setNewGiftName(kw);
                    }}
                    options={giftSortedProducts.map((p) => ({
                      value: p.id,
                      label: `[${p.code}] ${p.name} — Tồn: ${p.stock} ${p.unit}`,
                      subLabel: `Kho: ${p.warehouseName || 'Tâm An Mỹ Ngãi'} · NCC: ${p.supplierName} · Giá tặng khách: 0 đ`,
                      badge: `Tồn: ${p.stock} ${p.unit}`,
                      keywords: `${p.code} ${p.name} ${p.category} ${p.supplierName} ${p.warehouseName || ''} QUATANG QUA TANG`,
                    }))}
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-end">
                    <div>
                      <label
                        htmlFor="sale-gift-qty"
                        className="block text-xs font-semibold text-slate-700 mb-1"
                      >
                        Số lượng quà tặng ({selectedGiftProductObj?.unit || 'Đơn vị'}) *
                      </label>
                      <input
                        id="sale-gift-qty"
                        type="number"
                        min={1}
                        value={giftQuantity}
                        onChange={(e) => setGiftQuantity(e.target.value)}
                        placeholder="1"
                        className="w-full px-3 py-1.5 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                      />
                    </div>
                    <div className="px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 font-medium">
                      Giá tính khách: <strong className="font-mono text-emerald-800">0 đ (Tặng KM)</strong>
                    </div>
                  </div>

                  {showNewGiftBox && (
                    <div className="p-3 bg-emerald-50/70 rounded-lg border border-emerald-200 space-y-2.5">
                      <div className="text-xs font-bold text-emerald-900">
                        Thêm mặt hàng Quà tặng khuyến mãi mới vào kho
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                          <label htmlFor="inline-gift-code" className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                            Mã quà tặng
                          </label>
                          <input
                            id="inline-gift-code"
                            type="text"
                            value={newGiftCode}
                            onChange={(e) => setNewGiftCode(e.target.value)}
                            placeholder="QUATANG"
                            className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-md"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label htmlFor="inline-gift-name" className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                            Tên quà tặng khuyến mãi *
                          </label>
                          <input
                            id="inline-gift-name"
                            type="text"
                            value={newGiftName}
                            onChange={(e) => setNewGiftName(e.target.value)}
                            placeholder="VD: QUÀ TẶNG ÁO THUN / XÔ NHỰA"
                            className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                          <label htmlFor="inline-gift-unit" className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                            Đơn vị tính *
                          </label>
                          <input
                            id="inline-gift-unit"
                            type="text"
                            value={newGiftUnit}
                            onChange={(e) => setNewGiftUnit(e.target.value)}
                            placeholder="CÁI"
                            className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
                          />
                        </div>
                        <div>
                          <label htmlFor="inline-gift-cost" className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                            Giá nhập quà (VNĐ)
                          </label>
                          <input
                            id="inline-gift-cost"
                            type="number"
                            min={0}
                            value={newGiftImportPrice}
                            onChange={(e) => setNewGiftImportPrice(e.target.value)}
                            placeholder="0"
                            className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-md"
                          />
                        </div>
                        <div>
                          <label htmlFor="inline-gift-stock" className="block text-[11px] font-semibold text-slate-700 mb-0.5">
                            Số lượng tồn *
                          </label>
                          <input
                            id="inline-gift-stock"
                            type="number"
                            min={1}
                            value={newGiftStock}
                            onChange={(e) => setNewGiftStock(e.target.value)}
                            placeholder="50"
                            className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-md"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleConfirmInlineGiftProduct}
                        className="w-full py-1.5 px-3 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md"
                      >
                        Lưu quà tặng vào kho & Chọn tặng đơn này
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Sale Discount / Price Reduction Controls */}
              {hasDiscountActive && (
                <div className="p-3 bg-white rounded-lg border border-amber-200 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-amber-950 flex items-center gap-1.5">
                      <Tag className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                      <span>Giảm giá bán / Chiết khấu trực tiếp trên đơn</span>
                    </span>
                    <div className="inline-flex p-0.5 bg-slate-100 rounded-md border border-slate-200">
                      <button
                        type="button"
                        onClick={() => {
                          setDiscountMode('amount');
                          setDiscountInput('');
                        }}
                        className={`px-2 py-1 text-[11px] font-semibold rounded ${
                          discountMode === 'amount'
                            ? 'bg-white text-slate-900 shadow-2xs'
                            : 'text-slate-600'
                        }`}
                      >
                        Giảm theo tiền (VNĐ)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDiscountMode('percent');
                          setDiscountInput('');
                        }}
                        className={`px-2 py-1 text-[11px] font-semibold rounded flex items-center gap-0.5 ${
                          discountMode === 'percent'
                            ? 'bg-white text-slate-900 shadow-2xs'
                            : 'text-slate-600'
                        }`}
                      >
                        <Percent className="w-3 h-3" />
                        <span>Giảm theo %</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-end">
                    <div>
                      <label
                        htmlFor="sale-discount-input"
                        className="block text-xs font-semibold text-slate-700 mb-1"
                      >
                        {discountMode === 'percent'
                          ? 'Nhập phần trăm giảm giá (%)'
                          : 'Nhập số tiền giảm giá (VNĐ)'}
                      </label>
                      <input
                        id="sale-discount-input"
                        type="number"
                        min={0}
                        max={discountMode === 'percent' ? 100 : grossTotal || undefined}
                        value={discountInput}
                        onChange={(e) => setDiscountInput(e.target.value)}
                        placeholder={discountMode === 'percent' ? 'VD: 5' : 'VD: 50000'}
                        className="w-full px-3 py-1.5 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                      />
                    </div>
                    <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-950 flex items-center justify-between">
                      <span>Số tiền được giảm:</span>
                      <strong className="font-mono text-red-600">
                        -{formatVND(computedDiscountAmount)}
                      </strong>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-slate-500">Chọn nhanh:</span>
                    {discountMode === 'percent'
                      ? [2, 5, 10, 15, 20].map((pct) => (
                          <button
                            key={pct}
                            type="button"
                            onClick={() => setDiscountInput(String(pct))}
                            className="px-2 py-1 text-[11px] font-semibold bg-slate-100 hover:bg-amber-100 text-slate-800 rounded border border-slate-200"
                          >
                            Giảm {pct}%
                          </button>
                        ))
                      : [20000, 50000, 100000, 200000, 500000].map((amt) => (
                          <button
                            key={amt}
                            type="button"
                            onClick={() => setDiscountInput(String(amt))}
                            className="px-2 py-1 text-[11px] font-mono font-semibold bg-slate-100 hover:bg-amber-100 text-slate-800 rounded border border-slate-200"
                          >
                            -{amt.toLocaleString('vi-VN')}đ
                          </button>
                        ))}
                  </div>
                </div>
              )}
            </div>

            {/* Thêm ghi chú sản phẩm — Searchable Saved Templates & Auto-Remember Binding */}
            {(() => {
              const activeNoteProduct: ProductItem | null =
                currentProduct ||
                products.find((p) => p.id === noteTargetProductId) ||
                (posCartItems.length > 0
                  ? products.find((p) => p.id === posCartItems[posCartItems.length - 1].productId) ||
                    null
                  : null);

              const applyNoteAndRemember = (nextContent: string, matchedTemplateId = '') => {
                setDosageGuide(nextContent);
                setSelectedNoteTemplateId(matchedTemplateId);
                if (activeNoteProduct) {
                  onBindProductNoteToProduct?.(activeNoteProduct.id, nextContent);
                  setPosCartItems((prev) =>
                    prev.map((item) =>
                      item.productId === activeNoteProduct.id
                        ? { ...item, dosageGuide: nextContent.trim() || undefined }
                        : item
                    )
                  );
                  if (nextContent.trim()) {
                    setAutoRememberedBadge(
                      `Đã tự động ghi nhớ cho "${activeNoteProduct.name}" — lần sau chọn sẽ tự gắn sẵn!`
                    );
                  } else {
                    setAutoRememberedBadge(null);
                  }
                }
              };

              const handleSaveTemplateInline = () => {
                if (!tplContentInput.trim()) {
                  setFormMessage({
                    type: 'error',
                    text: 'Vui lòng nhập nội dung ghi chú sản phẩm trước khi lưu mẫu.',
                  });
                  return;
                }
                const saved = onSaveProductNoteTemplate?.(
                  {
                    title: tplTitleInput.trim(),
                    category: tplCategoryInput.trim() || 'Ghi chú sản phẩm',
                    content: tplContentInput.trim(),
                  },
                  editingNoteTemplateId || undefined
                );
                if (saved) {
                  applyNoteAndRemember(saved.content, saved.id);
                } else {
                  applyNoteAndRemember(tplContentInput.trim());
                }
                setShowNoteTemplateEditor(false);
                setEditingNoteTemplateId(null);
                setTplTitleInput('');
                setTplContentInput('');
              };

              const selectedTplObj = productNoteTemplates.find(
                (t) => t.id === selectedNoteTemplateId
              );

              return (
                <div className="space-y-2.5 p-3.5 bg-teal-50/45 rounded-xl border border-teal-200/80">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label
                      htmlFor="sale-product-note-select"
                      className="text-xs font-bold text-teal-950 flex items-center gap-1.5"
                    >
                      <Leaf className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                      <span>Thêm ghi chú sản phẩm</span>
                    </label>
                    <div className="flex items-center gap-1.5">
                      {onSaveProductNoteTemplate && (
                        <button
                          type="button"
                          onClick={() => {
                            if (showNoteTemplateEditor) {
                              setShowNoteTemplateEditor(false);
                              setEditingNoteTemplateId(null);
                            } else {
                              setEditingNoteTemplateId(null);
                              setTplTitleInput('');
                              setTplCategoryInput('Liều lượng & Pha phun');
                              setTplContentInput(dosageGuide.trim());
                              setShowNoteTemplateEditor(true);
                            }
                          }}
                          className="px-2 py-1 text-[11px] font-semibold text-teal-800 bg-white hover:bg-teal-100 border border-teal-300 rounded-md inline-flex items-center gap-1 whitespace-nowrap"
                        >
                          <Plus className="w-3 h-3" />
                          <span>{showNoteTemplateEditor ? 'Đóng tạo mẫu' : 'Tạo mẫu ghi chú'}</span>
                        </button>
                      )}
                      {dosageGuide && (
                        <button
                          type="button"
                          onClick={() => applyNoteAndRemember('', '')}
                          className="text-[11px] text-slate-500 hover:text-red-600 underline shrink-0"
                        >
                          Xóa
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Quick target switcher when user picked multiple items in POS cart */}
                  {posCartItems.length > 0 && !currentProduct && (
                    <div className="flex flex-wrap items-center gap-1 text-[11px]">
                      <span className="text-slate-600 font-medium">Gắn ghi chú cho SP:</span>
                      {posCartItems.map((item) => {
                        const isTarget = activeNoteProduct?.id === item.productId;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              setNoteTargetProductId(item.productId);
                              const targetProd = products.find((p) => p.id === item.productId);
                              const existingNote = item.dosageGuide || targetProd?.dosageGuide || '';
                              setDosageGuide(existingNote);
                              const matched = existingNote
                                ? productNoteTemplates.find(
                                    (t) => t.content.trim() === existingNote.trim()
                                  )
                                : undefined;
                              setSelectedNoteTemplateId(matched?.id || '');
                            }}
                            className={`px-2 py-0.5 rounded-full border font-semibold transition-colors truncate max-w-[180px] ${
                              isTarget
                                ? 'bg-teal-700 text-white border-teal-700'
                                : 'bg-white text-teal-900 border-teal-200 hover:bg-teal-100'
                            }`}
                          >
                            {item.productName}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Searchable Product Note Templates Selector */}
                  <div className="space-y-1.5">
                    <SearchableSelect
                      id="sale-product-note-select"
                      value={selectedNoteTemplateId}
                      onChange={(tplId) => {
                        if (!tplId) {
                          setSelectedNoteTemplateId('');
                          return;
                        }
                        const tpl = productNoteTemplates.find((t) => t.id === tplId);
                        if (tpl) {
                          applyNoteAndRemember(tpl.content, tpl.id);
                        }
                      }}
                      placeholder="Tìm & chọn nhanh ghi chú sản phẩm có sẵn (liều lượng, HDSD, công dụng...)..."
                      emptyOptionLabel="-- Bỏ chọn mẫu --"
                      createActionLabel={
                        onSaveProductNoteTemplate
                          ? '+ Tạo mẫu ghi chú sản phẩm mới tại đây...'
                          : undefined
                      }
                      onCreateAction={
                        onSaveProductNoteTemplate
                          ? (kw) => {
                              setEditingNoteTemplateId(null);
                              setTplTitleInput((kw || '').trim());
                              setTplCategoryInput('Liều lượng & Pha phun');
                              setTplContentInput(dosageGuide.trim() || (kw || '').trim());
                              setShowNoteTemplateEditor(true);
                            }
                          : undefined
                      }
                      options={productNoteTemplates.map((tpl) => ({
                        value: tpl.id,
                        label: tpl.title,
                        subLabel: tpl.content,
                        badge: tpl.category || 'Ghi chú',
                        keywords: `${tpl.title} ${tpl.content} ${tpl.category || ''}`,
                      }))}
                    />

                    {selectedTplObj && onSaveProductNoteTemplate && (
                      <div className="flex items-center justify-end gap-2 text-[11px]">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingNoteTemplateId(selectedTplObj.id);
                            setTplTitleInput(selectedTplObj.title);
                            setTplCategoryInput(selectedTplObj.category || 'Liều lượng & Pha phun');
                            setTplContentInput(selectedTplObj.content);
                            setShowNoteTemplateEditor(true);
                          }}
                          className="text-teal-800 hover:underline font-semibold inline-flex items-center gap-0.5"
                        >
                          <Pencil className="w-3 h-3" />
                          <span>Sửa mẫu đang chọn</span>
                        </button>
                        {onDeleteProductNoteTemplate && (
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteProductNoteTemplate(selectedTplObj.id);
                              setSelectedNoteTemplateId('');
                            }}
                            className="text-rose-600 hover:underline font-semibold inline-flex items-center gap-0.5"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Xóa mẫu</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Inline Create / Edit Reusable Product Note Template Box */}
                  {showNoteTemplateEditor && onSaveProductNoteTemplate && (
                    <div className="p-3 bg-white rounded-lg border border-teal-300 space-y-2 shadow-2xs">
                      <div className="text-xs font-bold text-teal-900">
                        {editingNoteTemplateId
                          ? 'Chỉnh sửa mẫu ghi chú sản phẩm'
                          : 'Tạo mẫu ghi chú sản phẩm mới (dùng lại nhanh cho các đơn sau)'}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={tplTitleInput}
                          onChange={(e) => setTplTitleInput(e.target.value)}
                          placeholder="Tên ngắn để tìm nhanh (VD: Diệt mầm lúa 1-3 NSS)"
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                        />
                        <select
                          value={tplCategoryInput}
                          onChange={(e) => setTplCategoryInput(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                        >
                          <option value="Liều lượng & Pha phun">Liều lượng &amp; Pha phun</option>
                          <option value="Hướng dẫn sử dụng">Hướng dẫn sử dụng</option>
                          <option value="Công dụng sản phẩm">Công dụng sản phẩm</option>
                          <option value="Hướng dẫn bón phân">Hướng dẫn bón phân</option>
                          <option value="Lưu ý & Cách ly">Lưu ý &amp; Cách ly</option>
                        </select>
                      </div>
                      <textarea
                        rows={2}
                        value={tplContentInput}
                        onChange={(e) => setTplContentInput(e.target.value)}
                        placeholder="Nhập đầy đủ thông tin: liều lượng pha, hướng dẫn sử dụng, công dụng sản phẩm, thời gian cách ly..."
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500"
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setShowNoteTemplateEditor(false);
                            setEditingNoteTemplateId(null);
                          }}
                          className="px-2.5 py-1 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md"
                        >
                          Hủy
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveTemplateInline}
                          className="px-3 py-1 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-md"
                        >
                          {editingNoteTemplateId ? 'Cập nhật mẫu' : 'Lưu mẫu & Áp dụng ngay'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Active Product Note Editor */}
                  <textarea
                    id="sale-dosage-guide-input"
                    rows={2}
                    value={dosageGuide}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDosageGuide(val);
                      setSelectedNoteTemplateId('');
                    }}
                    onBlur={() => {
                      if (activeNoteProduct && dosageGuide.trim() !== (activeNoteProduct.dosageGuide || '').trim()) {
                        onBindProductNoteToProduct?.(activeNoteProduct.id, dosageGuide);
                        setPosCartItems((prev) =>
                          prev.map((item) =>
                            item.productId === activeNoteProduct.id
                              ? { ...item, dosageGuide: dosageGuide.trim() || undefined }
                              : item
                          )
                        );
                        if (dosageGuide.trim()) {
                          setAutoRememberedBadge(
                            `Đã tự động ghi nhớ cho "${activeNoteProduct.name}" — lần sau chọn sẽ tự gắn sẵn!`
                          );
                        }
                      }
                    }}
                    placeholder="Ghi hoặc điều chỉnh thông tin, liều lượng, hướng dẫn sử dụng, công dụng sản phẩm (tự in lên Hóa đơn / Zalo)..."
                    className="w-full px-3 py-1.5 text-xs bg-white border border-teal-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />

                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    {autoRememberedBadge ? (
                      <span className="text-[11px] font-semibold text-emerald-800 inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>{autoRememberedBadge}</span>
                      </span>
                    ) : activeNoteProduct ? (
                      <span className="text-[11px] text-teal-800">
                        Khi chọn hoặc nhập ghi chú sẽ tự ghi nhớ cho{' '}
                        <strong>{activeNoteProduct.name}</strong>.
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-500">
                        Chọn sản phẩm để tự động ghi nhớ &amp; gắn sẵn ghi chú cho các lần bán sau.
                      </span>
                    )}

                    {activeNoteProduct && dosageGuide.trim() && (
                      <button
                        type="button"
                        onClick={() => {
                          applyNoteAndRemember(dosageGuide, selectedNoteTemplateId);
                          onNotifyToast?.(
                            `Đã ghi nhớ ghi chú cho sản phẩm "${activeNoteProduct.name}"!`
                          );
                        }}
                        className="px-2 py-0.5 text-[11px] font-semibold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 rounded-md whitespace-nowrap"
                      >
                        Ghi nhớ cho SP này
                      </button>
                    )}
                  </div>

                  {onCreateMultiItemSale && (
                    <button
                      type="button"
                      onClick={handleAddCurrentItemToCart}
                      className="w-full py-2 px-3 text-xs font-bold text-emerald-800 bg-white hover:bg-emerald-50 border-2 border-dashed border-emerald-400 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Plus className="w-4 h-4 shrink-0" />
                      <span>
                        Thêm vật tư kèm ưu đãi / ghi chú vào Giỏ ({posCartItems.length} mặt hàng)
                      </span>
                    </button>
                  )}
                </div>
              );
            })()}

            {lastCreatedOrder && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-bold text-emerald-900">
                    Đơn vừa tạo: <span className="font-mono">{lastCreatedOrder.invoiceCode}</span> (
                    {lastCreatedOrder.sales.length} mặt hàng · {lastCreatedOrder.customerName})
                  </div>
                  <button
                    type="button"
                    onClick={() => setLastCreatedOrder(null)}
                    aria-label="Ẩn thanh thao tác nhanh đơn vừa tạo"
                    className="p-1 text-emerald-700 hover:text-emerald-900"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleOpenSaleVietQr(lastCreatedOrder.sales)}
                    className="px-2.5 py-1.5 text-[11px] font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg inline-flex items-center justify-center gap-1"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>Hiện VietQR</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSendInvoiceZalo(lastCreatedOrder.sales)}
                    className="px-2.5 py-1.5 text-[11px] font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-lg inline-flex items-center justify-center gap-1"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    <span>Gửi Zalo</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportGroupedThermalPdf(lastCreatedOrder.sales[0], 80)}
                    className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg inline-flex items-center justify-center gap-1"
                  >
                    <Printer className="w-3.5 h-3.5 text-emerald-700" />
                    <span>In K80</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportGroupedInvoicePdf(lastCreatedOrder.sales[0])}
                    className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg inline-flex items-center justify-center gap-1"
                  >
                    <FileDown className="w-3.5 h-3.5 text-emerald-700" />
                    <span>PDF A4</span>
                  </button>
                </div>
              </div>
            )}

            {/* Payment Method Toggle */}
            <div>
              <span className="block text-xs font-semibold text-slate-700 mb-1.5">
                4. Hình thức thanh toán
              </span>
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setPaymentMode('full')}
                  className={`py-2 px-3 text-xs font-semibold rounded-md transition-colors ${
                    paymentMode === 'full'
                      ? 'bg-white text-emerald-800 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Thanh toán đủ 100%
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPaymentMode('debt');
                    setPaidAmount('');
                  }}
                  className={`py-2 px-3 text-xs font-semibold rounded-md transition-colors ${
                    paymentMode === 'debt'
                      ? 'bg-white text-amber-800 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Ghi nợ / Trả một phần
                </button>
              </div>
            </div>

            {paymentMode === 'debt' && (
              <div className="space-y-3 p-3.5 bg-amber-50/50 rounded-lg border border-amber-200">
                <div>
                  <label
                    htmlFor="sale-paid-input"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Số tiền khách đưa trước (đ)
                  </label>
                  <input
                    id="sale-paid-input"
                    type="number"
                    min={0}
                    max={netPayableTotal}
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>

                <div className="space-y-2 pt-2 border-t border-amber-200/70">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label
                        htmlFor="sale-debt-days-select"
                        className="block text-xs font-semibold text-slate-700 mb-1"
                      >
                        Chọn ngày nợ (Tự động nhảy ngày)
                      </label>
                      <select
                        id="sale-debt-days-select"
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
                      <label
                        htmlFor="sale-duedate-input"
                        className="block text-xs font-semibold text-slate-700 mb-1"
                      >
                        Hạn hẹn thanh toán nợ *
                      </label>
                      <input
                        id="sale-duedate-input"
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
              </div>
            )}

            {/* Live Summary Box with Discount, Promotional Gift, Old Customer Debt & Cumulative Total Debt */}
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-2 text-xs">
              {(summary.discountAmount > 0 || (hasGiftActive && selectedGiftProductObj)) && (
                <div className="space-y-1.5 pb-2 border-b border-slate-200">
                  <div className="flex items-center justify-between text-slate-600">
                    <span>Tiền hàng gốc ({qtyNum || 0} × {formatVND(priceNum)}):</span>
                    <span className="font-mono tabular-nums font-semibold text-slate-800">
                      {formatVND(summary.grossAmount)}
                    </span>
                  </div>
                  {summary.discountAmount > 0 && (
                    <div className="flex items-center justify-between text-amber-900">
                      <span className="font-medium">
                        Giảm giá bán / Chiết khấu{computedDiscountPercent > 0 ? ` (${computedDiscountPercent}%)` : ''}:
                      </span>
                      <span className="font-mono tabular-nums font-bold text-red-600">
                        -{formatVND(summary.discountAmount)}
                      </span>
                    </div>
                  )}
                  {hasGiftActive && selectedGiftProductObj && (
                    <div className="flex items-center justify-between text-emerald-900 bg-emerald-50 px-2 py-1 rounded border border-emerald-200">
                      <span className="font-semibold flex items-center gap-1">
                        <Gift className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                        <span>
                          Quà tặng KM: {giftQtyNum} {selectedGiftProductObj.unit} {selectedGiftProductObj.name}
                        </span>
                      </span>
                      <span className="font-mono font-bold text-emerald-800">0 đ (Miễn phí)</span>
                    </div>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-slate-600">
                  {summary.discountAmount > 0 ? 'Tổng thành tiền (Sau giảm giá):' : 'Tổng thành tiền:'}
                </span>
                <span className="text-sm font-bold font-mono tabular-nums text-slate-900">
                  {formatVND(summary.totalAmount)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Khách thanh toán:</span>
                <span className="font-mono tabular-nums text-emerald-700 font-semibold">
                  {formatVND(summary.paidAmount)}
                </span>
              </div>
              <div className="flex items-center justify-between pt-1.5 border-t border-slate-200">
                <span className="text-slate-700 font-medium">Ghi vào công nợ khách hàng (đơn này):</span>
                <span
                  className={`font-mono tabular-nums font-bold ${
                    summary.debtAmount > 0 ? 'text-red-600' : 'text-slate-500'
                  }`}
                >
                  {formatVND(summary.debtAmount)}
                </span>
              </div>

              {/* Old Debt & Cumulative Total Debt Section (Only Total Old Debt) */}
              <div className="pt-2 border-t border-dashed border-slate-300 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-700 font-semibold">
                    Tổng công nợ cũ
                    {customerOldDebt.hasCustomer ? ` (${customerOldDebt.customerName})` : ''}:
                  </span>
                  <span
                    className={`font-mono tabular-nums font-bold ${
                      customerOldDebt.oldDebtAmount > 0 ? 'text-amber-700' : 'text-slate-500'
                    }`}
                  >
                    {formatVND(customerOldDebt.oldDebtAmount)}
                  </span>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-slate-200 bg-white px-2.5 py-2 rounded-md border">
                  <span className="text-slate-900 font-bold">
                    Tổng công nợ khách hàng (Tổng nợ cũ + Đơn này):
                  </span>
                  <span
                    className={`text-sm font-mono tabular-nums font-extrabold ${
                      customerOldDebt.cumulativeTotalDebt > 0
                        ? 'text-red-600'
                        : 'text-emerald-700'
                    }`}
                  >
                    {formatVND(customerOldDebt.cumulativeTotalDebt)}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <label
                htmlFor="sale-note-input"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Ghi chú đơn hàng
              </label>
              <input
                id="sale-note-input"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="VD: Giao hàng tận ruộng, hẹn thu hoạch lúa trả..."
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
              <button
                type="submit"
                className="w-full py-2.5 px-3 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors flex items-center justify-center gap-1.5"
              >
                <Plus className="w-4 h-4 shrink-0" />
                <span>
                  {posCartItems.length > 0
                    ? `Lưu đơn (${combinedPreviewItems.length} món)`
                    : 'Lưu đơn bán hàng'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => submitSale(true)}
                className="w-full py-2.5 px-3 text-xs font-semibold text-slate-900 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors flex items-center justify-center gap-1.5"
              >
                <FileDown className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>Lưu &amp; Xuất PDF</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  setVietQrModalTarget({
                    title: 'Mã VietQR thu tiền đơn hàng',
                    subtitle: selectedCustomerObj
                      ? `${selectedCustomerObj.name} · ${combinedPreviewItems.length || 1} mặt hàng`
                      : 'Khách hàng mua lẻ',
                    amount: summary.paidAmount > 0 ? summary.paidAmount : summary.totalAmount,
                    addInfo: `TT DON HANG ${selectedCustomerObj?.name || 'KHACH LE'}`,
                    customerPhone: selectedCustomerObj?.phone,
                  })
                }
                className="w-full py-2.5 px-3 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition-colors flex items-center justify-center gap-1.5"
              >
                <QrCode className="w-4 h-4 shrink-0" />
                <span>Hiện VietQR</span>
              </button>
            </div>
          </form>
        </div>

        {/* Right: Sales Log Table */}
        <div className="xl:col-span-7 bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Nhật Ký Bán Hàng ({distinctFilteredInvoicesCount} hóa đơn
                {hasMultiItemInvoices ? ` · ${filteredSales.length} món` : ''})
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Hỗ trợ gom nhóm Hóa đơn gộp POS, Khách trả hàng (TH-...) và Xuất Phiếu PDF / Zalo
              </p>
            </div>

            <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 w-full sm:w-auto">
              <div className="hidden md:inline-flex items-center p-0.5 bg-slate-100 rounded-lg border border-slate-200">
                <button
                  type="button"
                  onClick={() => setSalesViewMode('grouped')}
                  title="Gom các mặt hàng cùng hóa đơn POS thành 1 dòng gọn gàng"
                  className={`px-2 py-1 text-[11px] font-semibold rounded-md inline-flex items-center gap-1 transition-colors ${
                    salesViewMode === 'grouped'
                      ? 'bg-white text-emerald-800 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Layers className="w-3 h-3" />
                  <span>Gộp HĐ</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSalesViewMode('flat')}
                  title="Hiển thị tách rời từng dòng vật tư"
                  className={`px-2 py-1 text-[11px] font-semibold rounded-md inline-flex items-center gap-1 transition-colors ${
                    salesViewMode === 'flat'
                      ? 'bg-white text-emerald-800 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <List className="w-3 h-3" />
                  <span>Từng món</span>
                </button>
              </div>
              {!lockedWarehouse && (
                <select
                  aria-label="Lọc đơn bán theo kho"
                  value={warehouseTableFilter}
                  onChange={(e) => setWarehouseTableFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs font-semibold bg-white border border-slate-200 rounded-lg text-emerald-800"
                >
                  <option value="all">Tất cả kho ({warehouses.length})</option>
                  {warehouses.map((w) => (
                    <option key={w} value={w}>
                      Kho: {w}
                    </option>
                  ))}
                </select>
              )}

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm mã HĐ, khách, vật tư, kho..."
                  aria-label="Tìm kiếm trong nhật ký bán hàng"
                  className="w-full sm:w-52 pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
                {[
                  { id: 'all', label: 'Tất cả' },
                  { id: 'paid', label: 'Đã thu đủ' },
                  { id: 'partial', label: 'Nợ 1 phần' },
                  { id: 'unpaid', label: 'Ghi nợ' },
                ].map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => setStatusFilter(st.id as 'all' | PaymentStatus)}
                    className={`px-2 py-1 text-xs font-medium rounded-md transition-colors text-center break-words ${
                      statusFilter === st.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Focused Cross-Link Banner */}
          {focusedSaleRecord && onClearFocusedSale && (
            <FocusedLinkBanner
              code={focusedSaleRecord.invoiceCode}
              title={`${focusedSaleRecord.customerName} · ${focusedSaleRecord.productName} (${formatVND(
                focusedSaleRecord.totalAmount
              )})`}
              onClear={onClearFocusedSale}
              actions={
                canPerformRoleAction(role, 'edit_record') ? (
                  <>
                    <button
                      type="button"
                      onClick={() => openEditSaleModal(focusedSaleRecord)}
                      className="px-2.5 py-1 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-100 rounded-md inline-flex items-center gap-1"
                    >
                      <Pencil className="w-3 h-3" />
                      <span>Sửa HĐ</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCancelingSale(focusedSaleRecord)}
                      className="px-2.5 py-1 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 rounded-md inline-flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Hủy HĐ</span>
                    </button>
                  </>
                ) : undefined
              }
            />
          )}

          {/* Mobile Card View (< md): Full-width balanced layout, zero column squishing */}
          <div className="md:hidden divide-y divide-slate-200">
            {filteredSales.length === 0 ? (
              <div className="py-10 px-4 text-center text-xs text-slate-500">
                Không có hóa đơn bán hàng nào khớp với bộ lọc hiện tại.
              </div>
            ) : (
              displayedFlatSales.map((s) => {
                const diag = diagnoseSaleVoucher({
                  sale: s,
                  products,
                  customers,
                  imports,
                  receiptVouchers,
                });
                const isFocused = focusedSaleRecord?.id === s.id;
                return (
                <div
                  key={s.id}
                  className={`p-4 space-y-3 transition-colors ${
                    isFocused
                      ? 'bg-emerald-50/80 ring-2 ring-inset ring-emerald-500'
                      : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono text-xs font-bold text-slate-900">
                        {s.invoiceCode}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                        Ngày: {s.createdAt.slice(0, 10)}
                      </div>
                    </div>
                    <span className="px-2 py-0.5 text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-md whitespace-nowrap">
                      {s.warehouseName || 'Tâm An Mỹ Ngãi'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="p-2.5 bg-slate-50/70 rounded-lg border border-slate-200/70">
                      <div className="text-[11px] text-slate-500">Khách hàng</div>
                      <div className="text-xs font-bold text-slate-900 mt-0.5">
                        {s.customerName}
                      </div>
                      <div className="text-xs font-mono text-slate-500">{s.customerPhone}</div>
                    </div>
                    <div className="p-2.5 bg-slate-50/70 rounded-lg border border-slate-200/70">
                      <div className="text-[11px] text-slate-500">Vật tư & Số lượng</div>
                      <div className="text-xs font-semibold text-slate-900 mt-0.5">
                        {s.productName}
                      </div>
                      <div className="text-xs font-mono text-slate-600">
                        {s.quantity} {s.unit} × {formatVND(s.unitPrice)}
                      </div>
                      {((s.discountAmount || 0) > 0 || (s.giftProductName && (s.giftQuantity || 0) > 0)) && (
                        <div className="mt-1.5 pt-1.5 border-t border-slate-200/80 space-y-1">
                          {(s.discountAmount || 0) > 0 && (
                            <div className="text-[11px] font-semibold text-amber-800 flex items-center gap-1">
                              <Tag className="w-3 h-3 shrink-0" />
                              <span>Giảm giá: -{formatVND(s.discountAmount || 0)}</span>
                            </div>
                          )}
                          {s.giftProductName && (s.giftQuantity || 0) > 0 && (
                            <div className="text-[11px] font-semibold text-emerald-800 flex items-center gap-1">
                              <Gift className="w-3 h-3 shrink-0" />
                              <span>
                                Tặng KM: {s.giftQuantity} {s.giftUnit || ''} {s.giftProductName}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                      {s.dosageGuide && (
                        <div className="mt-1.5 pt-1.5 border-t border-slate-200/80 text-[11px] text-teal-800 flex items-start gap-1">
                          <Leaf className="w-3 h-3 shrink-0 mt-0.5 text-teal-700" />
                          <span>Pha phun: {s.dosageGuide}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-xs">
                    <div>
                      <div className="text-[11px] text-slate-500">Thành tiền</div>
                      <div className="font-mono tabular-nums font-bold text-slate-900 mt-0.5">
                        {formatVND(s.totalAmount)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">Đã thu</div>
                      <div className="font-mono tabular-nums font-semibold text-emerald-700 mt-0.5">
                        {formatVND(s.paidAmount)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] text-slate-500">Còn nợ</div>
                      <div
                        className={`font-mono tabular-nums font-bold mt-0.5 ${
                          s.debtAmount > 0 ? 'text-red-600' : 'text-slate-500'
                        }`}
                      >
                        {formatVND(s.debtAmount)}
                      </div>
                    </div>
                  </div>

                  {onNavigateCrossLink && (
                    <div className="pt-1 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
                      {diag.statusLevel !== 'ok' && (
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                            diag.statusLevel === 'blocked'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}
                        >
                          {diag.statusLabel}
                        </span>
                      )}
                      {diag.linkedCustomer && (
                        <CrossLinkChip
                          tone="slate"
                          label={`KH: ${diag.linkedCustomer.name}`}
                          onClick={() =>
                            onNavigateCrossLink({
                              tab: 'customers',
                              recordId: diag.linkedCustomer!.id,
                              label: `Khách hàng ${diag.linkedCustomer!.name}`,
                            })
                          }
                        />
                      )}
                      {diag.linkedProduct && (
                        <CrossLinkChip
                          tone="indigo"
                          label={`Kho: ${diag.linkedProduct.stock} ${diag.linkedProduct.unit}`}
                          onClick={() =>
                            onNavigateCrossLink({
                              tab: 'inventory',
                              recordId: diag.linkedProduct!.id,
                              label: `Thẻ kho ${diag.linkedProduct!.name}`,
                            })
                          }
                        />
                      )}
                      {s.debtAmount > 0 && (
                        <CrossLinkChip
                          tone="amber"
                          label="Công nợ KH"
                          onClick={() =>
                            onNavigateCrossLink({
                              tab: 'debts',
                              recordId: s.id,
                              subTab: 'customer',
                              label: `Công nợ ${s.invoiceCode}`,
                            })
                          }
                        />
                      )}
                      {diag.linkedReceiptVouchers.map((rv) => (
                        <CrossLinkChip
                          key={rv.id}
                          tone="rose"
                          label={rv.voucherCode}
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
                      {diag.relatedImports[0] && (
                        <CrossLinkChip
                          tone="emerald"
                          label={diag.relatedImports[0].receiptCode}
                          onClick={() =>
                            onNavigateCrossLink({
                              tab: 'imports',
                              recordId: diag.relatedImports[0].id,
                              voucherCode: diag.relatedImports[0].receiptCode,
                              label: `Phiếu nhập ${diag.relatedImports[0].receiptCode}`,
                            })
                          }
                        />
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleExportGroupedInvoicePdf(s)}
                        className="px-2.5 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md whitespace-nowrap"
                      >
                        PDF A4
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExportGroupedThermalPdf(s, 80)}
                        className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap"
                      >
                        K80
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenSaleVietQr(findInvoiceGroupSales(sales, s))}
                        className="px-2.5 py-1.5 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-md inline-flex items-center gap-1 whitespace-nowrap"
                      >
                        <QrCode className="w-3 h-3" />
                        <span>QR</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSendInvoiceZalo(findInvoiceGroupSales(sales, s))}
                        className="px-2.5 py-1.5 text-xs font-semibold text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-md inline-flex items-center gap-1 whitespace-nowrap"
                      >
                        <MessageCircle className="w-3 h-3" />
                        <span>Zalo</span>
                      </button>
                    </div>

                    {canPerformRoleAction(role, 'edit_record') ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {onProcessCustomerReturn && (
                          <button
                            type="button"
                            onClick={() => openCustomerReturnModal(s)}
                            aria-label={`Khách trả hàng hóa đơn ${s.invoiceCode}`}
                            className="px-2.5 py-1.5 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md flex items-center gap-1 whitespace-nowrap"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Khách trả</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openEditSaleModal(s)}
                          aria-label={`Sửa hóa đơn ${s.invoiceCode}`}
                          className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md flex items-center gap-1 whitespace-nowrap"
                        >
                          <Pencil className="w-3 h-3" />
                          <span>Sửa</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setCancelingSale(s)}
                          aria-label={`Hủy hóa đơn ${s.invoiceCode}`}
                          className="px-2.5 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md flex items-center gap-1 whitespace-nowrap"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Hủy HĐ</span>
                        </button>
                      </div>
                    ) : (
                      <span
                        title="Chỉ Quản lý mới có quyền chỉnh sửa hoặc xóa hóa đơn đã lưu"
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
            <table className="w-full min-w-[940px] text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-xs shadow-2xs">
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4 w-[145px] whitespace-nowrap">Mã HĐ & Kho xuất</th>
                  <th className="py-3 px-4 min-w-[180px]">Khách hàng</th>
                  <th className="py-3 px-4 min-w-[220px]">Vật tư & SL</th>
                  <th className="py-3 px-4 w-[120px] text-right whitespace-nowrap">Thành tiền</th>
                  <th className="py-3 px-4 w-[160px] text-right whitespace-nowrap">Đã thu / Còn nợ</th>
                  <th className="py-3 px-4 w-[185px] text-right whitespace-nowrap">
                    PDF / Trả hàng / Sửa &amp; Hủy
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {(salesViewMode === 'grouped' ? displayedGroupedSales.length === 0 : displayedFlatSales.length === 0) ? (
                  <tr>
                    <td colSpan={6} className="py-10 px-4 text-center text-xs text-slate-500">
                      Không có hóa đơn bán hàng nào khớp với bộ lọc hiện tại.
                    </td>
                  </tr>
                ) : (
                  (salesViewMode === 'grouped'
                    ? displayedGroupedSales.flatMap((grp) => {
                        if (grp.items.length === 1) {
                          return [{ kind: 'single' as const, sale: grp.items[0] }];
                        }
                        const isExpanded =
                          Boolean(expandedInvoiceGroups[grp.groupKey]) ||
                          Boolean(focusedSaleRecord && grp.items.some((x) => x.id === focusedSaleRecord.id));
                        const entries: Array<
                          | { kind: 'group'; group: typeof grp; isExpanded: boolean }
                          | { kind: 'single'; sale: SaleTransaction; isSubRow?: boolean }
                        > = [{ kind: 'group', group: grp, isExpanded }];
                        if (isExpanded) {
                          grp.items.forEach((sub) =>
                            entries.push({ kind: 'single', sale: sub, isSubRow: true })
                          );
                        }
                        return entries;
                      })
                    : displayedFlatSales.map((s) => ({ kind: 'single' as const, sale: s, isSubRow: false }))
                  ).map((entry) => {
                    if (entry.kind === 'group') {
                      const { group: grp, isExpanded } = entry;
                      const firstSale = grp.items[0];
                      const matchedCust = customers.find((c) => c.id === grp.customerId);
                      return (
                        <tr
                          key={grp.groupKey}
                          className="bg-emerald-50/45 hover:bg-emerald-50/80 transition-colors"
                        >
                          <td className="py-3 px-4 whitespace-nowrap align-middle">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-xs font-bold text-slate-900">
                                {grp.invoiceCode}
                              </span>
                              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-700 text-white rounded">
                                {grp.items.length} món
                              </span>
                            </div>
                            <div className="text-xs font-semibold text-emerald-800 mt-0.5">
                              {grp.warehouseName}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500">
                              {(grp.createdAt || '').slice(0, 10)}
                            </div>
                          </td>
                          <td className="py-3 px-4 min-w-[180px] align-middle">
                            {onNavigateCrossLink && matchedCust ? (
                              <button
                                type="button"
                                onClick={() =>
                                  onNavigateCrossLink({
                                    tab: 'customers',
                                    recordId: matchedCust.id,
                                    label: `Khách hàng ${matchedCust.name}`,
                                  })
                                }
                                className="font-semibold text-slate-900 hover:text-emerald-800 hover:underline leading-snug text-left"
                              >
                                {grp.customerName}
                              </button>
                            ) : (
                              <div className="font-semibold text-slate-900 leading-snug">
                                {grp.customerName}
                              </div>
                            )}
                            <div className="text-xs font-mono text-slate-500 mt-0.5">
                              {grp.customerPhone}
                            </div>
                          </td>
                          <td className="py-3 px-4 min-w-[220px] align-middle">
                            <div className="space-y-0.5 text-xs text-slate-800">
                              {grp.items.map((line, lIdx) => (
                                <div key={line.id} className="flex items-center justify-between gap-2">
                                  <span className="truncate max-w-[210px]">
                                    <span className="font-mono text-emerald-800 font-semibold mr-1">
                                      {lIdx + 1}.
                                    </span>
                                    {line.productName}
                                  </span>
                                  <span className="font-mono text-[11px] text-slate-600 shrink-0">
                                    {line.quantity} {line.unit}
                                  </span>
                                </div>
                              ))}
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedInvoiceGroups((prev) => ({
                                  ...prev,
                                  [grp.groupKey]: !isExpanded,
                                }))
                              }
                              className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 hover:underline"
                            >
                              {isExpanded ? (
                                <>
                                  <ChevronUp className="w-3 h-3" />
                                  <span>Thu gọn từng dòng vật tư</span>
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="w-3 h-3" />
                                  <span>Mở {grp.items.length} dòng để Sửa / Khách trả lẻ</span>
                                </>
                              )}
                            </button>
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-xs font-extrabold text-slate-900 whitespace-nowrap align-middle">
                            {formatVND(grp.totalAmount)}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap align-middle">
                            <div className="font-mono tabular-nums text-xs font-semibold text-emerald-700">
                              Thu: {formatVND(grp.paidAmount)}
                            </div>
                            {grp.debtAmount > 0 ? (
                              <div className="font-mono tabular-nums text-xs font-bold text-red-600 mt-0.5">
                                Nợ: {formatVND(grp.debtAmount)}
                              </div>
                            ) : (
                              <div className="text-xs text-slate-500 mt-0.5">Đã tất toán</div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap align-middle">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => handleExportGroupedInvoicePdf(firstSale)}
                                title="Xuất Hóa đơn gộp A4"
                                className="px-2 py-1 text-xs font-semibold text-emerald-700 bg-white border border-emerald-200 hover:bg-emerald-100 rounded-md whitespace-nowrap"
                              >
                                PDF
                              </button>
                              <button
                                type="button"
                                onClick={() => handleExportGroupedThermalPdf(firstSale, 80)}
                                title="In Hóa đơn gộp K80"
                                className="px-1.5 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-md whitespace-nowrap"
                              >
                                K80
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenSaleVietQr(grp.items)}
                                title="Hiện mã VietQR cả hóa đơn"
                                className="p-1.5 text-teal-700 bg-white border border-teal-200 hover:bg-teal-100 rounded-md"
                              >
                                <QrCode className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSendInvoiceZalo(grp.items)}
                                title="Gửi Zalo cả hóa đơn gộp"
                                className="p-1.5 text-sky-700 bg-white border border-sky-200 hover:bg-sky-100 rounded-md"
                              >
                                <MessageCircle className="w-3.5 h-3.5" />
                              </button>
                              {canPerformRoleAction(role, 'delete_record') && onDeleteSaleGroup && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        `Xác nhận hủy trọn bộ hóa đơn gộp ${grp.invoiceCode} (${grp.items.length} mặt hàng · ${formatVND(grp.totalAmount)}) và hoàn lại đầy đủ tồn kho?`
                                      )
                                    ) {
                                      onDeleteSaleGroup(grp.items.map((x) => x.id));
                                    }
                                  }}
                                  className="px-2 py-1 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md flex items-center gap-1 whitespace-nowrap"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  <span>Hủy HĐ ({grp.items.length})</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    const s = entry.sale;
                    const isSubRow = Boolean(entry.isSubRow);
                    const diag = diagnoseSaleVoucher({
                      sale: s,
                      products,
                      customers,
                      imports,
                      receiptVouchers,
                    });
                    const isFocused = focusedSaleRecord?.id === s.id;
                    return (
                    <tr
                      key={s.id}
                      className={`transition-colors ${
                        isFocused
                          ? 'bg-emerald-50/80 ring-1 ring-inset ring-emerald-500'
                          : isSubRow
                          ? 'bg-slate-50/75 border-l-4 border-l-emerald-500 hover:bg-slate-100/80'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                    <td className="py-3 px-4 whitespace-nowrap align-middle">
                      <div className="font-mono text-xs font-semibold text-slate-900">
                        {s.invoiceCode}
                      </div>
                      <div className="text-xs font-semibold text-emerald-800 mt-0.5">
                        {s.warehouseName || 'Tâm An Mỹ Ngãi'}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500">
                        {s.createdAt.slice(0, 10)}
                      </div>
                      {diag.statusLevel !== 'ok' && (
                        <div className="mt-1">
                          <span
                            className={`inline-block px-1.5 py-0.5 text-[10px] font-bold rounded border ${
                              diag.statusLevel === 'blocked'
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : 'bg-amber-50 text-amber-800 border-amber-200'
                            }`}
                          >
                            {diag.statusLabel}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 min-w-[180px] align-middle">
                      {onNavigateCrossLink && diag.linkedCustomer ? (
                        <button
                          type="button"
                          onClick={() =>
                            onNavigateCrossLink({
                              tab: 'customers',
                              recordId: diag.linkedCustomer!.id,
                              label: `Khách hàng ${diag.linkedCustomer!.name}`,
                            })
                          }
                          className="font-semibold text-slate-900 hover:text-emerald-800 hover:underline leading-snug text-left"
                          title="Bấm để mở hồ sơ & công nợ khách hàng"
                        >
                          {s.customerName}
                        </button>
                      ) : (
                        <div className="font-semibold text-slate-900 leading-snug">{s.customerName}</div>
                      )}
                      <div className="text-xs font-mono text-slate-500 mt-0.5">{s.customerPhone}</div>
                    </td>
                    <td className="py-3 px-4 min-w-[220px] align-middle">
                      {onNavigateCrossLink && diag.linkedProduct ? (
                        <button
                          type="button"
                          onClick={() =>
                            onNavigateCrossLink({
                              tab: 'inventory',
                              recordId: diag.linkedProduct!.id,
                              label: `Thẻ kho ${diag.linkedProduct!.name}`,
                            })
                          }
                          className="text-xs font-semibold text-slate-900 hover:text-indigo-800 hover:underline leading-snug text-left"
                          title="Bấm để mở Thẻ kho Xuất - Nhập - Tồn"
                        >
                          {s.productName}
                        </button>
                      ) : (
                        <div className="text-xs font-medium text-slate-900 leading-snug">{s.productName}</div>
                      )}
                      <div className="text-xs font-mono text-slate-500 mt-0.5">
                        {s.quantity} {s.unit} × {formatVND(s.unitPrice)}
                      </div>
                      {((s.discountAmount || 0) > 0 || (s.giftProductName && (s.giftQuantity || 0) > 0)) && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          {(s.discountAmount || 0) > 0 && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 rounded">
                              <Tag className="w-3 h-3 shrink-0" />
                              <span>Giảm: -{formatVND(s.discountAmount || 0)}</span>
                            </span>
                          )}
                          {s.giftProductName && (s.giftQuantity || 0) > 0 && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                              <Gift className="w-3 h-3 shrink-0" />
                              <span>
                                Tặng: {s.giftQuantity} {s.giftUnit || ''} {s.giftProductName}
                              </span>
                            </span>
                          )}
                        </div>
                      )}
                      {s.dosageGuide && (
                        <div className="mt-1 text-[11px] text-teal-800 flex items-start gap-1 max-w-[260px]">
                          <Leaf className="w-3 h-3 shrink-0 mt-0.5 text-teal-700" />
                          <span className="truncate" title={s.dosageGuide}>
                            {s.dosageGuide}
                          </span>
                        </div>
                      )}
                      {onNavigateCrossLink && (
                        <div className="flex flex-wrap items-center gap-1 mt-1.5">
                          {diag.linkedProduct && (
                            <CrossLinkChip
                              tone="indigo"
                              label={`Kho: ${diag.linkedProduct.stock} ${diag.linkedProduct.unit}`}
                              onClick={() =>
                                onNavigateCrossLink({
                                  tab: 'inventory',
                                  recordId: diag.linkedProduct!.id,
                                  label: `Thẻ kho ${diag.linkedProduct!.name}`,
                                })
                              }
                            />
                          )}
                          {s.debtAmount > 0 && (
                            <CrossLinkChip
                              tone="amber"
                              label="Công nợ"
                              onClick={() =>
                                onNavigateCrossLink({
                                  tab: 'debts',
                                  recordId: s.id,
                                  subTab: 'customer',
                                  label: `Công nợ ${s.invoiceCode}`,
                                })
                              }
                            />
                          )}
                          {diag.linkedReceiptVouchers.map((rv) => (
                            <CrossLinkChip
                              key={rv.id}
                              tone="rose"
                              label={rv.voucherCode}
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
                          {diag.relatedImports[0] && (
                            <CrossLinkChip
                              tone="emerald"
                              label={diag.relatedImports[0].receiptCode}
                              onClick={() =>
                                onNavigateCrossLink({
                                  tab: 'imports',
                                  recordId: diag.relatedImports[0].id,
                                  voucherCode: diag.relatedImports[0].receiptCode,
                                  label: `Phiếu nhập ${diag.relatedImports[0].receiptCode}`,
                                })
                              }
                            />
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-xs font-bold text-slate-900 whitespace-nowrap align-middle">
                      {formatVND(s.totalAmount)}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap align-middle">
                      <div className="font-mono tabular-nums text-xs text-emerald-700">
                        Thu: {formatVND(s.paidAmount)}
                      </div>
                      {s.debtAmount > 0 ? (
                        <button
                          type="button"
                          onClick={() =>
                            onNavigateCrossLink
                              ? onNavigateCrossLink({
                                  tab: 'debts',
                                  recordId: s.id,
                                  subTab: 'customer',
                                  label: `Công nợ ${s.invoiceCode}`,
                                })
                              : onOpenDebtRecord?.(s.id)
                          }
                          className="font-mono tabular-nums text-xs font-semibold text-red-600 hover:underline mt-0.5"
                          title="Bấm để mở trang Công nợ thu tiền"
                        >
                          Nợ: {formatVND(s.debtAmount)} (Hạn {s.dueDate})
                        </button>
                      ) : (
                        <div className="text-xs text-slate-500 mt-0.5">Đã tất toán</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap align-middle">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => handleExportGroupedInvoicePdf(s)}
                          title="Xuất Hóa đơn A4 (kèm Liều lượng & VietQR)"
                          className="px-2 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md whitespace-nowrap"
                        >
                          PDF
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExportGroupedThermalPdf(s, 80)}
                          title="In Hóa đơn khổ nhiệt K80"
                          className="px-1.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap"
                        >
                          K80
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenSaleVietQr(findInvoiceGroupSales(sales, s))}
                          title="Hiện mã VietQR thanh toán"
                          aria-label={`Hiện mã VietQR hóa đơn ${s.invoiceCode}`}
                          className="p-1.5 text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-md"
                        >
                          <QrCode className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSendInvoiceZalo(findInvoiceGroupSales(sales, s))}
                          title="Gửi hóa đơn & hướng dẫn pha phun qua Zalo"
                          aria-label={`Gửi Zalo hóa đơn ${s.invoiceCode}`}
                          className="p-1.5 text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-md"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                        </button>
                        {canPerformRoleAction(role, 'edit_record') ? (
                          <>
                            {onProcessCustomerReturn && (
                              <button
                                type="button"
                                onClick={() => openCustomerReturnModal(s)}
                                title="Khách trả lại bớt hoặc toàn bộ mặt hàng này (Tự cộng lại kho & trừ nợ)"
                                aria-label={`Khách trả hàng ${s.invoiceCode}`}
                                className="px-2 py-1 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md flex items-center gap-1 whitespace-nowrap"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>Trả</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openEditSaleModal(s)}
                              aria-label={`Sửa hóa đơn ${s.invoiceCode}`}
                              className="px-2 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md flex items-center gap-1 whitespace-nowrap"
                            >
                              <Pencil className="w-3 h-3" />
                              <span>Sửa</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setCancelingSale(s)}
                              aria-label={`Hủy hóa đơn ${s.invoiceCode}`}
                              className="px-2 py-1 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md flex items-center gap-1 whitespace-nowrap"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Hủy</span>
                            </button>
                          </>
                        ) : (
                          <span
                            title="Chỉ Quản lý mới có quyền chỉnh sửa hoặc xóa hóa đơn đã lưu"
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
              {filteredSales.length > 0 && (
                <tfoot className="border-t-2 border-emerald-200 bg-emerald-50/70 text-xs font-semibold text-slate-800">
                  <tr>
                    <td colSpan={3} className="py-3 px-4">
                      Tổng kết bộ lọc: <strong>{distinctFilteredInvoicesCount}</strong> hóa đơn
                      {hasMultiItemInvoices ? ` (${filteredSales.length} mặt hàng)` : ''}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap font-bold text-slate-900">
                      {formatVND(filteredSales.reduce((sum, s) => sum + s.totalAmount, 0))}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                      <div className="text-emerald-800">
                        ∑ Thu: {formatVND(filteredSales.reduce((sum, s) => sum + s.paidAmount, 0))}
                      </div>
                      <div className="text-red-700 font-bold">
                        ∑ Nợ: {formatVND(filteredSales.reduce((sum, s) => sum + s.debtAmount, 0))}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right text-[11px] text-slate-500">
                      Khớp 100% báo cáo doanh thu
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {(salesViewMode === 'grouped'
            ? groupedFilteredSales.length > displayedGroupedSales.length
            : filteredSales.length > displayedFlatSales.length) && (
            <div className="p-3.5 border-t border-slate-200 bg-slate-50/70 text-center">
              <button
                type="button"
                onClick={() => setSalesRowLimit((prev) => prev + 80)}
                className="px-4 py-2 text-xs font-semibold text-emerald-800 bg-white hover:bg-emerald-50 border border-emerald-300 rounded-lg shadow-2xs transition-colors"
              >
                Hiển thị thêm hóa đơn (Đang xem{' '}
                {salesViewMode === 'grouped'
                  ? `${displayedGroupedSales.length} / ${groupedFilteredSales.length} hóa đơn`
                  : `${displayedFlatSales.length} / ${filteredSales.length} dòng`}
                )
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Excel Sample Template Download & Upload Bar (Moved to bottom of page) */}
      <ExcelDataBar
        moduleType="sales"
        moduleTitle="Nhật Ký Bán Hàng"
        onImportRows={onImportSalesFromExcel}
        onExportCurrentData={() =>
          exportModuleDataExcel({
            moduleType: 'sales',
            products,
            customers,
            sales: filteredSales,
            imports: [],
          })
        }
      />

      {/* Manager-Only Edit Saved Sale Invoice Modal */}
      {editingSale && canPerformRoleAction(role, 'edit_record') && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2.5 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Chỉnh sửa hóa đơn ${editingSale.invoiceCode}`}
        >
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-lg max-h-[calc(100dvh-1.25rem)] sm:max-h-[90vh] flex flex-col overflow-hidden shadow-xl">
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/90 shrink-0">
              <div className="min-w-0 pr-2">
                <h3 className="text-sm sm:text-base font-bold text-slate-900 truncate">
                  Chỉnh Sửa Hóa Đơn Bán Hàng ({editingSale.invoiceCode})
                </h3>
                <p className="text-[11px] sm:text-xs text-emerald-800 font-medium mt-0.5">
                  Quyền Quản lý: Cho phép sửa thông tin khách hàng, kho xuất, số lượng, đơn giá và công nợ
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingSale(null)}
                aria-label="Đóng cửa sổ sửa hóa đơn"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const discNum = Math.max(0, Number(editSaleDiscount) || 0);
                const giftQtyVal = Math.max(0, Number(editSaleGiftQty) || 0);
                const hasGiftVal = Boolean(editSaleGiftName.trim() && giftQtyVal > 0);
                const promoVal: SalePromotionType =
                  discNum > 0 && hasGiftVal
                    ? 'both'
                    : discNum > 0
                    ? 'discount'
                    : hasGiftVal
                    ? 'gift'
                    : 'none';
                onUpdateSale(editingSale.id, {
                  invoiceCode: editSaleCode,
                  warehouseName: editSaleWarehouse,
                  customerName: editSaleCustomerName,
                  customerPhone: editSaleCustomerPhone,
                  productName: editSaleProductName,
                  unit: editSaleUnit,
                  quantity: Math.max(1, Number(editSaleQty) || 1),
                  unitPrice: Math.max(0, Number(editSalePrice) || 0),
                  paidAmount: Math.max(0, Number(editSalePaid) || 0),
                  dueDate: editSaleDueDate,
                  note: editSaleNote,
                  promotionType: promoVal,
                  discountAmount: discNum,
                  giftProductName: hasGiftVal ? editSaleGiftName.trim() : undefined,
                  giftUnit: hasGiftVal ? editSaleGiftUnit.trim() || 'CÁI' : undefined,
                  giftQuantity: hasGiftVal ? giftQtyVal : 0,
                  dosageGuide: editSaleDosageGuide.trim() || undefined,
                });
                setEditingSale(null);
              }}
              className="flex flex-col flex-1 min-h-0 overflow-hidden"
            >
              <div className="p-4 sm:p-6 space-y-3.5 sm:space-y-4 overflow-y-auto flex-1 overscroll-contain">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="edit-sale-code" className="block text-xs font-semibold text-slate-700 mb-1">
                    Mã hóa đơn
                  </label>
                  <input
                    id="edit-sale-code"
                    type="text"
                    required
                    value={editSaleCode}
                    onChange={(e) => setEditSaleCode(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="edit-sale-wh" className="block text-xs font-semibold text-slate-700 mb-1">
                    Kho xuất bán
                  </label>
                  <select
                    id="edit-sale-wh"
                    value={editSaleWarehouse}
                    onChange={(e) => setEditSaleWarehouse(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                  >
                    {warehouses.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="edit-sale-cust" className="block text-xs font-semibold text-slate-700 mb-1">
                    Tên khách hàng *
                  </label>
                  <input
                    id="edit-sale-cust"
                    type="text"
                    required
                    value={editSaleCustomerName}
                    onChange={(e) => setEditSaleCustomerName(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="edit-sale-phone" className="block text-xs font-semibold text-slate-700 mb-1">
                    Số điện thoại KH
                  </label>
                  <input
                    id="edit-sale-phone"
                    type="tel"
                    value={editSaleCustomerPhone}
                    onChange={(e) => setEditSaleCustomerPhone(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label htmlFor="edit-sale-prod" className="block text-xs font-semibold text-slate-700 mb-1">
                    Tên vật tư nông nghiệp (Khóa theo ID tồn kho)
                  </label>
                  <input
                    id="edit-sale-prod"
                    type="text"
                    readOnly
                    value={editSaleProductName}
                    className="w-full px-3 py-2 text-sm bg-slate-100 text-slate-600 border border-slate-200 rounded-lg cursor-not-allowed"
                  />
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Cố định mặt hàng để bảo toàn chính xác tồn kho; nếu chọn nhầm sản phẩm hãy xóa lập hóa đơn mới.
                  </p>
                </div>
                <div>
                  <label htmlFor="edit-sale-unit" className="block text-xs font-semibold text-slate-700 mb-1">
                    Đơn vị tính *
                  </label>
                  <input
                    id="edit-sale-unit"
                    type="text"
                    required
                    value={editSaleUnit}
                    onChange={(e) => setEditSaleUnit(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="edit-sale-qty" className="block text-xs font-semibold text-slate-700 mb-1">
                    Số lượng *
                  </label>
                  <input
                    id="edit-sale-qty"
                    type="number"
                    min={1}
                    required
                    value={editSaleQty}
                    onChange={(e) => setEditSaleQty(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="edit-sale-price" className="block text-xs font-semibold text-slate-700 mb-1">
                    Đơn giá bán (VNĐ) *
                  </label>
                  <input
                    id="edit-sale-price"
                    type="number"
                    min={0}
                    required
                    value={editSalePrice}
                    onChange={(e) => setEditSalePrice(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="edit-sale-paid" className="block text-xs font-semibold text-slate-700 mb-1">
                    Khách đã trả (VNĐ)
                  </label>
                  <input
                    id="edit-sale-paid"
                    type="number"
                    min={0}
                    value={editSalePaid}
                    onChange={(e) => setEditSalePaid(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="edit-sale-discount" className="block text-xs font-semibold text-slate-700 mb-1">
                  Chiết khấu / Giảm giá hóa đơn (VNĐ)
                </label>
                <input
                  id="edit-sale-discount"
                  type="number"
                  min={0}
                  value={editSaleDiscount}
                  onChange={(e) => setEditSaleDiscount(e.target.value)}
                  placeholder="0"
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                />
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="edit-sale-debt-days" className="block text-xs font-semibold text-slate-700 mb-1">
                      Chọn ngày nợ (Tự động nhảy ngày)
                    </label>
                    <select
                      id="edit-sale-debt-days"
                      value={matchDebtTermDays(editSaleDueDate)}
                      onChange={(e) => {
                        const days = Number(e.target.value);
                        if (days > 0) {
                          setEditSaleDueDate(computeDueDateAfterDays(days));
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
                    <label htmlFor="edit-sale-due" className="block text-xs font-semibold text-slate-700 mb-1">
                      Hạn hẹn thanh toán nợ
                    </label>
                    <input
                      id="edit-sale-due"
                      type="date"
                      value={editSaleDueDate}
                      onChange={(e) => setEditSaleDueDate(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {DEBT_TERM_DAY_OPTIONS.map((days) => {
                    const targetDate = computeDueDateAfterDays(days);
                    const isSelected = editSaleDueDate === targetDate;
                    return (
                      <button
                        key={days}
                        type="button"
                        onClick={() => setEditSaleDueDate(targetDate)}
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
                  <label htmlFor="edit-sale-note" className="block text-xs font-semibold text-slate-700 mb-1">
                    Ghi chú hóa đơn
                  </label>
                  <input
                    id="edit-sale-note"
                    type="text"
                    value={editSaleNote}
                    onChange={(e) => setEditSaleNote(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="edit-sale-dosage" className="block text-xs font-semibold text-teal-900 mb-1">
                    Hướng dẫn liều lượng &amp; cách pha phun
                  </label>
                  <textarea
                    id="edit-sale-dosage"
                    rows={2}
                    value={editSaleDosageGuide}
                    onChange={(e) => setEditSaleDosageGuide(e.target.value)}
                    placeholder="VD: Pha 25-30ml / bình 25 lít nước..."
                    className="w-full px-3 py-2 text-xs bg-white border border-teal-200 rounded-lg"
                  />
                </div>
              </div>

              </div>

              <div className="px-4 sm:px-6 py-3 border-t border-slate-200 bg-slate-50/90 flex flex-wrap items-center justify-between gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const target = editingSale;
                    setEditingSale(null);
                    setCancelingSale(target);
                  }}
                  className="px-3 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Hủy hóa đơn</span>
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingSale(null)}
                    className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
                  >
                    Đóng
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                  >
                    Lưu thay đổi hóa đơn
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
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

      {/* Customer Return / Partial Return Modal (Phiếu Khách Trả Hàng TH-...) */}
      {returningSale && onProcessCustomerReturn && (() => {
        const retPreview = computeCustomerSaleReturnCalculation({
          sale: returningSale,
          returnQuantity: Number(returnQtyInput) || 1,
          returnGiftQuantity: Number(returnGiftQtyInput) || 0,
        });
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-3 sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-label={`Lập phiếu khách trả hàng từ hóa đơn ${returningSale.invoiceCode}`}
          >
            <div className="bg-white rounded-2xl border border-amber-200 shadow-2xl w-full max-w-md overflow-hidden">
              <div className="px-5 py-4 bg-amber-50/90 border-b border-amber-200 flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                    <RotateCcw className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>Phiếu Khách Trả / Đổi Hàng ({returningSale.invoiceCode})</span>
                  </h3>
                  <p className="text-[11px] text-amber-900 mt-0.5">
                    Tự động cộng lại tồn kho, cấn trừ công nợ KH và tính lại lãi gộp chuẩn
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReturningSale(null)}
                  className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  onProcessCustomerReturn({
                    saleId: returningSale.id,
                    returnQuantity: retPreview.returnQuantity,
                    returnGiftQuantity: retPreview.returnGiftQuantity,
                    reason: returnReasonInput,
                  });
                  setReturningSale(null);
                }}
                className="p-5 space-y-4 text-xs"
              >
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
                  <div className="font-bold text-slate-900">{returningSale.productName}</div>
                  <div className="text-slate-600 font-mono">
                    Khách: <strong>{returningSale.customerName}</strong> · Đã mua:{' '}
                    <strong>
                      {returningSale.quantity} {returningSale.unit}
                    </strong>{' '}
                    × {formatVND(returningSale.unitPrice)} = {formatVND(returningSale.totalAmount)}
                  </div>
                  <div className="text-slate-600 font-mono">
                    Đã thu: <span className="text-emerald-700 font-semibold">{formatVND(returningSale.paidAmount)}</span> · Còn nợ:{' '}
                    <span className="text-red-600 font-semibold">{formatVND(returningSale.debtAmount)}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      SL khách trả lại ({returningSale.unit}) *
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={returningSale.quantity}
                      required
                      value={returnQtyInput}
                      onChange={(e) => setReturnQtyInput(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono font-bold bg-white border border-slate-300 rounded-lg"
                    />
                    <div className="mt-1 flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => setReturnQtyInput('1')}
                        className="px-2 py-0.5 text-[11px] bg-slate-100 hover:bg-slate-200 rounded font-medium"
                      >
                        Trả 1 {returningSale.unit}
                      </button>
                      <button
                        type="button"
                        onClick={() => setReturnQtyInput(String(returningSale.quantity))}
                        className="px-2 py-0.5 text-[11px] bg-amber-100 hover:bg-amber-200 text-amber-900 rounded font-semibold"
                      >
                        Trả hết ({returningSale.quantity})
                      </button>
                    </div>
                  </div>

                  {(returningSale.giftQuantity || 0) > 0 && (
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        SL quà KM trả lại ({returningSale.giftUnit || 'CÁI'})
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={returningSale.giftQuantity || 0}
                        value={returnGiftQtyInput}
                        onChange={(e) => setReturnGiftQtyInput(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                  )}
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Lý do trả / đổi hàng
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    {['Dư sau mùa vụ', 'Đổi sang thuốc khác', 'Lỗi bao bì / NSX'].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setReturnReasonInput(preset)}
                        className={`px-2 py-1 rounded-md border text-[11px] font-medium ${
                          returnReasonInput === preset
                            ? 'bg-emerald-700 text-white border-emerald-700'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={returnReasonInput}
                    onChange={(e) => setReturnReasonInput(e.target.value)}
                    placeholder="Ghi chú lý do khách trả hàng..."
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                  />
                </div>

                <div className="p-3 bg-emerald-50/80 rounded-xl border border-emerald-200 space-y-1.5 font-mono">
                  <div className="flex justify-between">
                    <span className="text-slate-700">Nhập lại tồn kho:</span>
                    <strong className="text-emerald-800">
                      +{retPreview.returnQuantity} {returningSale.unit}
                      {retPreview.returnGiftQuantity > 0
                        ? ` (+${retPreview.returnGiftQuantity} quà)`
                        : ''}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-700">Giá trị hàng trả lại:</span>
                    <strong className="text-slate-900">-{formatVND(retPreview.returnAmount)}</strong>
                  </div>
                  {retPreview.debtReducedAmount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-700">Cấn trừ giảm nợ KH:</span>
                      <strong className="text-emerald-700">
                        -{formatVND(retPreview.debtReducedAmount)}
                      </strong>
                    </div>
                  )}
                  {retPreview.cashRefundAmount > 0 && (
                    <div className="flex justify-between text-rose-700">
                      <span className="font-sans font-semibold">Tiền mặt cần hoàn lại khách:</span>
                      <strong>{formatVND(retPreview.cashRefundAmount)}</strong>
                    </div>
                  )}
                  <div className="flex justify-between pt-1.5 border-t border-emerald-200">
                    <span className="font-sans font-semibold text-slate-800">
                      {retPreview.isFullReturn ? 'Trạng thái sau trả:' : 'HĐ còn lại sau trả:'}
                    </span>
                    <strong className="text-slate-900">
                      {retPreview.isFullReturn
                        ? 'Hủy trọn dòng HĐ (0 đ)'
                        : `${retPreview.remainingQuantity} ${returningSale.unit} · ${formatVND(retPreview.nextTotalAmount)}`}
                    </strong>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setReturningSale(null)}
                    className="px-3.5 py-2 font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                  >
                    Đóng
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg"
                  >
                    Xác nhận nhận hàng trả &amp; Lưu phiếu TH
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      <BarcodeScannerModal
        isOpen={isBarcodeScannerOpen}
        onClose={() => setIsBarcodeScannerOpen(false)}
        title="Quét Mã Vạch Chọn Vật Tư Xuất Bán"
        onDetected={(scanned) => {
          const norm = scanned.trim().toLowerCase();
          const matched = products.find(
            (p) =>
              (p.barcode && p.barcode.trim().toLowerCase() === norm) ||
              p.code.trim().toLowerCase() === norm
          );
          if (matched) {
            handleProductSelectChange(matched.id);
            setFormMessage({
              type: 'success',
              text: `Đã chọn nhanh vật tư "${matched.name}" theo mã "${scanned}".`,
            });
          } else {
            setFormMessage({
              type: 'error',
              text: `Không tìm thấy vật tư có mã vạch / mã VT "${scanned}".`,
            });
          }
        }}
      />

      <VietQrPaymentModal
        isOpen={Boolean(vietQrModalTarget)}
        onClose={() => setVietQrModalTarget(null)}
        title={vietQrModalTarget?.title}
        subtitle={vietQrModalTarget?.subtitle}
        amount={vietQrModalTarget?.amount || 0}
        addInfo={vietQrModalTarget?.addInfo || ''}
        customerPhone={vietQrModalTarget?.customerPhone}
        zaloMessage={vietQrModalTarget?.zaloMessage}
        bankConfig={bankQrConfig}
        onSaveBankConfig={onSaveBankQrConfig}
        onNotifyToast={onNotifyToast}
      />
    </div>
  );
};

interface ImportLogViewProps {
  products: ProductItem[];
  customers: CustomerProfile[];
  sales?: SaleTransaction[];
  imports: ImportTransaction[];
  paymentVouchers?: CashPaymentVoucher[];
  stockAdjustments?: StockAdjustmentRecord[];
  suppliers: SupplierProfile[];
  role: UserRole;
  warehouses: string[];
  onAddWarehouse: (warehouseName: string) => void;
  lockedWarehouse: string | null;
  preselectedProductId: string | null;
  onClearPreselectedProduct: () => void;
  focusedImportId?: string | null;
  onClearFocusedImport?: () => void;
  onNavigateCrossLink?: (req: CrossLinkNavigateRequest) => void;
  onCreateImport: (payload: {
    supplierName: string;
    supplierPhone: string;
    productId: string;
    quantity: number;
    unitCost: number;
    paidAmount: number;
    dueDate: string;
    note: string;
    warehouseName: string;
    batchNumber?: string;
    expiryDate?: string;
  }) => ImportTransaction;
  onCreateMultiItemImport?: (payload: {
    supplierName: string;
    supplierPhone: string;
    warehouseName: string;
    dueDate: string;
    note: string;
    totalPaidAmount: number;
    items: ImportCartDraftItem[];
  }) => ImportTransaction[];
  onCreateProductInline: (
    data: Omit<ProductItem, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
  ) => ProductItem;
  onCreateSupplierInline: (data: Omit<SupplierProfile, 'id' | 'createdAt'>) => SupplierProfile;
  onImportWarehouseFromExcel: (rows: Record<string, unknown>[]) => number;
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
  onOpenDebtRecord?: (recordId: string) => void;
  newProductRedirectTrigger?: { key: number; initialName: string } | null;
  onConsumeNewProductRedirect?: () => void;
}

export const ImportLogView: React.FC<ImportLogViewProps> = ({
  products,
  customers,
  sales = [],
  imports,
  paymentVouchers = [],
  stockAdjustments = [],
  suppliers,
  role,
  warehouses,
  onAddWarehouse,
  lockedWarehouse,
  preselectedProductId,
  onClearPreselectedProduct,
  focusedImportId,
  onClearFocusedImport,
  onNavigateCrossLink,
  onCreateImport,
  onCreateMultiItemImport,
  onCreateProductInline,
  onCreateSupplierInline,
  onImportWarehouseFromExcel,
  onUpdateImport,
  onDeleteImport,
  onOpenDebtRecord,
  newProductRedirectTrigger,
  onConsumeNewProductRedirect,
}) => {
  // Blank-by-default state so fields are empty on open and reset after save/export
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>(lockedWarehouse || '');
  const [showNewWarehouseBox, setShowNewWarehouseBox] = useState<boolean>(false);
  const [newWarehouseName, setNewWarehouseName] = useState<string>('');

  // Manager-only Edit / Cancel Saved Import Receipt State
  const [editingImport, setEditingImport] = useState<ImportTransaction | null>(null);
  const [cancelingImport, setCancelingImport] = useState<ImportTransaction | null>(null);
  const [importSearchQuery, setImportSearchQuery] = useState('');
  const [importStatusFilter, setImportStatusFilter] = useState<'all' | 'debt' | 'paid' | 'issues'>('all');
  const [editImpCode, setEditImpCode] = useState('');

  const openEditImportModal = (imp: ImportTransaction) => {
    if (!canPerformRoleAction(role, 'edit_record')) return;
    setEditingImport(imp);
    setEditImpCode(imp.receiptCode);
    setEditImpWarehouse(imp.warehouseName || warehouses[0] || 'Tâm An Mỹ Ngãi');
    setEditImpSupplierName(imp.supplierName);
    setEditImpSupplierPhone(imp.supplierPhone);
    setEditImpProductName(imp.productName);
    setEditImpUnit(imp.unit);
    setEditImpQty(String(imp.quantity));
    setEditImpCost(String(imp.unitCost));
    setEditImpPaid(String(imp.paidAmount));
    setEditImpDueDate(imp.dueDate);
    setEditImpNote(imp.note);
  };

  const focusedImportRecord = focusedImportId
    ? imports.find((i) => i.id === focusedImportId || i.receiptCode === focusedImportId) || null
    : null;

  useEffect(() => {
    if (focusedImportId) {
      setImportSearchQuery('');
      setImportStatusFilter('all');
    }
  }, [focusedImportId]);
  const [editImpWarehouse, setEditImpWarehouse] = useState('');
  const [editImpSupplierName, setEditImpSupplierName] = useState('');
  const [editImpSupplierPhone, setEditImpSupplierPhone] = useState('');
  const [editImpProductName, setEditImpProductName] = useState('');
  const [editImpUnit, setEditImpUnit] = useState('');
  const [editImpQty, setEditImpQty] = useState('');
  const [editImpCost, setEditImpCost] = useState('');
  const [editImpPaid, setEditImpPaid] = useState('');
  const [editImpDueDate, setEditImpDueDate] = useState('');
  const [editImpNote, setEditImpNote] = useState('');

  const [selectedProductId, setSelectedProductId] = useState<string>(
    preselectedProductId || ''
  );
  const [selectedSupplierName, setSelectedSupplierName] = useState<string>('');
  const [supplierPhone, setSupplierPhone] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('');
  const [unitCost, setUnitCost] = useState<string>('');
  const [paidAmount, setPaidAmount] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>('');
  const [batchNumber, setBatchNumber] = useState<string>('');
  const [expiryDate, setExpiryDate] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [importCartItems, setImportCartItems] = useState<ImportCartDraftItem[]>([]);
  const [importRowLimit, setImportRowLimit] = useState<number>(80);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(
    null
  );
  const [isBarcodeScannerOpen, setIsBarcodeScannerOpen] = useState<boolean>(false);

  useEffect(() => {
    setImportRowLimit(80);
  }, [importSearchQuery, importStatusFilter]);

  // Inline New Product State inside Import Form
  const [showNewProductBox, setShowNewProductBox] = useState<boolean>(false);
  const [newProdCode, setNewProdCode] = useState<string>('');
  const [newProdName, setNewProdName] = useState<string>('');
  const [newProdCategory, setNewProdCategory] = useState<ProductCategory>('Phân bón');
  const [newProdUnit, setNewProdUnit] = useState<string>('');
  const [newProdImportPrice, setNewProdImportPrice] = useState<string>('');
  const [newProdSellPrice, setNewProdSellPrice] = useState<string>('');

  // Inline New Supplier State inside Import Form
  const [showNewSupplierBox, setShowNewSupplierBox] = useState<boolean>(false);
  const [newSupName, setNewSupName] = useState<string>('');
  const [newSupPhone, setNewSupPhone] = useState<string>('');
  const [newSupAddress, setNewSupAddress] = useState<string>('');

  const currentProduct = products.find((p) => p.id === selectedProductId);

  useEffect(() => {
    if (lockedWarehouse) {
      setSelectedWarehouse(lockedWarehouse);
      setShowNewWarehouseBox(false);
    }
  }, [lockedWarehouse]);

  const resetAllImportFieldsToBlank = () => {
    setSelectedWarehouse(lockedWarehouse || '');
    setShowNewWarehouseBox(false);
    setNewWarehouseName('');
    setSelectedProductId('');
    setSelectedSupplierName('');
    setSupplierPhone('');
    setQuantity('');
    setUnitCost('');
    setPaidAmount('');
    setDueDate('');
    setBatchNumber('');
    setExpiryDate('');
    setNote('');
    setImportCartItems([]);
    setShowNewProductBox(false);
    setNewProdCode('');
    setNewProdName('');
    setNewProdUnit('');
    setNewProdImportPrice('');
    setNewProdSellPrice('');
    setShowNewSupplierBox(false);
    setNewSupName('');
    setNewSupPhone('');
    setNewSupAddress('');
  };

  useEffect(() => {
    if (preselectedProductId) {
      setSelectedProductId(preselectedProductId);
      const prod = products.find((p) => p.id === preselectedProductId);
      if (prod) {
        setSelectedSupplierName(prod.supplierName);
        const matchedSup = suppliers.find((s) => s.name === prod.supplierName);
        setSupplierPhone(matchedSup?.phone || '');
        setUnitCost(String(prod.importPrice));
        if (!lockedWarehouse && prod.warehouseName) {
          setSelectedWarehouse(prod.warehouseName);
        }
      }
      onClearPreselectedProduct();
    }
  }, [preselectedProductId, products, suppliers, lockedWarehouse, onClearPreselectedProduct]);

  useEffect(() => {
    if (newProductRedirectTrigger) {
      setSelectedProductId('__new_product__');
      setShowNewProductBox(true);
      if (newProductRedirectTrigger.initialName) {
        setNewProdName(newProductRedirectTrigger.initialName);
      }
      setFeedback({
        type: 'success',
        text: 'Đã mở sẵn khung Thêm vật tư nhập kho mới — Vui lòng điền thông tin vật tư và phiếu nhập hàng bên dưới.',
      });
      onConsumeNewProductRedirect?.();
    }
  }, [newProductRedirectTrigger, onConsumeNewProductRedirect]);

  const handleConfirmInlineWarehouseInImport = (): string | null => {
    const trimmed = newWarehouseName.trim();
    if (!trimmed) {
      setFeedback({
        type: 'error',
        text: 'Vui lòng nhập tên kho mới để tạo thêm kho.',
      });
      return null;
    }
    onAddWarehouse(trimmed);
    setSelectedWarehouse(trimmed);
    setShowNewWarehouseBox(false);
    setNewWarehouseName('');
    setFeedback({
      type: 'success',
      text: `Đã tạo thêm kho "${trimmed}" và chọn vào phiếu nhập kho!`,
    });
    return trimmed;
  };

  const handleSelectProduct = (prodId: string) => {
    if (prodId === '__new_product__') {
      setSelectedProductId('__new_product__');
      setShowNewProductBox(true);
      return;
    }
    setSelectedProductId(prodId);
    setShowNewProductBox(false);
    const prod = products.find((p) => p.id === prodId);
    if (prod) {
      setUnitCost(String(prod.importPrice));
      if (!selectedWarehouse && !lockedWarehouse && prod.warehouseName) {
        setSelectedWarehouse(prod.warehouseName);
      }
      if (!selectedSupplierName && prod.supplierName) {
        setSelectedSupplierName(prod.supplierName);
        const matchedSup = suppliers.find((s) => s.name === prod.supplierName);
        if (matchedSup) setSupplierPhone(matchedSup.phone);
      }
    } else {
      setUnitCost('');
    }
  };

  const handleSelectSupplier = (supName: string) => {
    if (supName === '__new_supplier__') {
      setSelectedSupplierName('__new_supplier__');
      setShowNewSupplierBox(true);
      return;
    }
    setSelectedSupplierName(supName);
    setShowNewSupplierBox(false);
    const matched = suppliers.find((s) => s.name === supName);
    if (matched) {
      setSupplierPhone(matched.phone);
    }
  };

  const handleConfirmInlineProductInImport = () => {
    if (!newProdName.trim() || !newProdUnit.trim() || !newProdImportPrice) {
      setFeedback({
        type: 'error',
        text: 'Vui lòng điền Tên vật tư, Đơn vị tính và Giá nhập để thêm vật tư mới.',
      });
      return null;
    }
    const impPriceNum = Math.max(0, Number(newProdImportPrice) || 0);
    const sellPriceNum = Math.max(
      0,
      Number(newProdSellPrice) || Math.round(impPriceNum * 1.18)
    );
    const resolvedProdWh =
      lockedWarehouse ||
      (selectedWarehouse && selectedWarehouse !== '__new_warehouse__'
        ? selectedWarehouse
        : warehouses[0] || 'Tâm An Mỹ Ngãi');

    const created = onCreateProductInline({
      code: newProdCode.trim() || generateNextUniqueProductCode(products, resolvedProdWh),
      name: newProdName.trim(),
      category: newProdCategory,
      warehouseName: resolvedProdWh,
      unit: newProdUnit.trim(),
      importPrice: impPriceNum,
      sellPrice: sellPriceNum,
      stock: 0,
      minStock: 10,
      supplierName:
        selectedSupplierName && selectedSupplierName !== '__new_supplier__'
          ? selectedSupplierName
          : newSupName.trim() || 'Nhà cung cấp VTNN',
    });
    setSelectedProductId(created.id);
    setUnitCost(String(created.importPrice));
    setShowNewProductBox(false);
    setNewProdCode('');
    setNewProdName('');
    setNewProdUnit('');
    setNewProdImportPrice('');
    setNewProdSellPrice('');
    setFeedback({
      type: 'success',
      text: `Đã thêm vật tư mới "${created.name}" trực tiếp và chọn vào phiếu nhập kho!`,
    });
    return created;
  };

  const handleConfirmInlineSupplierInImport = () => {
    if (!newSupName.trim()) {
      setFeedback({
        type: 'error',
        text: 'Vui lòng nhập Tên nhà cung cấp mới.',
      });
      return null;
    }
    const createdSup = onCreateSupplierInline({
      name: newSupName.trim(),
      phone: newSupPhone.trim(),
      address: newSupAddress.trim(),
      note: 'Thêm trực tiếp khi lập phiếu nhập kho',
    });
    setSelectedSupplierName(createdSup.name);
    setSupplierPhone(createdSup.phone);
    setShowNewSupplierBox(false);
    setNewSupName('');
    setNewSupPhone('');
    setNewSupAddress('');
    setFeedback({
      type: 'success',
      text: `Đã thêm Nhà cung cấp mới "${createdSup.name}" và chọn vào phiếu nhập!`,
    });
    return createdSup;
  };

  const qtyNum = Math.max(0, Number(quantity) || 0);
  const costNum = Math.max(0, Number(unitCost) || 0);
  const paidNum = Math.max(0, Number(paidAmount) || 0);

  const currentImportDraftItem: ImportCartDraftItem | null =
    currentProduct && qtyNum > 0
      ? {
          id: '__imp_draft__',
          productId: currentProduct.id,
          productName: currentProduct.name,
          unit: currentProduct.unit,
          quantity: qtyNum,
          unitCost: costNum > 0 ? costNum : currentProduct.importPrice,
          batchNumber: batchNumber.trim() || undefined,
          expiryDate: expiryDate || undefined,
        }
      : null;

  const combinedImportPreviewItems: ImportCartDraftItem[] =
    importCartItems.length > 0
      ? currentImportDraftItem
        ? [...importCartItems, currentImportDraftItem]
        : importCartItems
      : currentImportDraftItem
      ? [currentImportDraftItem]
      : [];

  const importCartAlloc = allocatePaymentAcrossImportItems(combinedImportPreviewItems, paidNum);
  const summary =
    importCartItems.length > 0
      ? {
          totalCost: importCartAlloc.totalCost,
          paidAmount: importCartAlloc.totalPaid,
          debtAmount: importCartAlloc.totalDebt,
          status: importCartAlloc.status,
        }
      : calculateImportSummary(qtyNum, costNum, paidNum);

  const supplierOldDebt = computeSupplierOldDebtSummary(
    selectedSupplierName,
    imports,
    summary.debtAmount
  );

  const clearCurrentImportLineOnly = () => {
    setSelectedProductId('');
    setQuantity('');
    setUnitCost('');
    setBatchNumber('');
    setExpiryDate('');
  };

  const quickImportQuantities = importCartItems.reduce<Record<string, number>>((acc, item) => {
    acc[item.productId] = (acc[item.productId] || 0) + item.quantity;
    return acc;
  }, {});

  const handleQuickSetImportProductQuantity = (productId: string, nextQty: number) => {
    const prod = products.find((p) => p.id === productId);
    if (!prod) return;
    setFeedback(null);
    const nextItems = upsertQuickImportProductQuantity(importCartItems, prod, nextQty);
    setImportCartItems(nextItems);
    if (selectedProductId === productId) {
      clearCurrentImportLineOnly();
    }
    if (!selectedWarehouse && !lockedWarehouse && prod.warehouseName && nextQty > 0) {
      setSelectedWarehouse(prod.warehouseName);
    }
    if (!selectedSupplierName && prod.supplierName && nextQty > 0) {
      setSelectedSupplierName(prod.supplierName);
      const matchedSup = suppliers.find((s) => s.name === prod.supplierName);
      if (matchedSup) setSupplierPhone(matchedSup.phone);
    }
  };

  const handleAddCurrentImportItemToCart = () => {
    setFeedback(null);
    let resolvedProduct = products.find((p) => p.id === selectedProductId) || null;
    if (showNewProductBox || selectedProductId === '__new_product__') {
      const createdProd = handleConfirmInlineProductInImport();
      if (!createdProd) return;
      resolvedProduct = createdProd;
    }
    if (!resolvedProduct) {
      setFeedback({
        type: 'error',
        text: 'Vui lòng chọn vật tư trước khi thêm vào giỏ phiếu nhập chung.',
      });
      return;
    }
    if (qtyNum <= 0) {
      setFeedback({ type: 'error', text: 'Vui lòng nhập Số lượng nhập lớn hơn 0.' });
      return;
    }
    const effectiveCost = costNum > 0 ? costNum : resolvedProduct.importPrice;
    const newItem: ImportCartDraftItem = {
      id: `imp_cart_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      productId: resolvedProduct.id,
      productName: resolvedProduct.name,
      unit: resolvedProduct.unit,
      quantity: qtyNum,
      unitCost: effectiveCost,
      batchNumber: batchNumber.trim() || undefined,
      expiryDate: expiryDate || undefined,
    };
    const nextCart = [...importCartItems, newItem];
    setImportCartItems(nextCart);
    clearCurrentImportLineOnly();
    setFeedback({
      type: 'success',
      text: `Đã thêm "+${qtyNum} ${resolvedProduct.unit} ${resolvedProduct.name}" vào Giỏ phiếu nhập chung (${nextCart.length} mặt hàng). Chọn tiếp vật tư khác hoặc bấm Lưu phiếu!`,
    });
  };

  const handleExportGroupedImportPdf = (imp: ImportTransaction) => {
    const groupImps = findImportGroupTransactions(imports, imp);
    exportImportReceiptPDF({
      ...imp,
      totalCost: groupImps.reduce((s, r) => s + r.totalCost, 0),
      paidAmount: groupImps.reduce((s, r) => s + r.paidAmount, 0),
      debtAmount: groupImps.reduce((s, r) => s + r.debtAmount, 0),
      items: groupImps.map((r) => ({
        productName: r.productName,
        unit: r.unit,
        quantity: r.quantity,
        unitCost: r.unitCost,
        totalCost: r.totalCost,
        batchNumber: r.batchNumber,
        expiryDate: r.expiryDate,
      })),
    });
  };

  const submitImport = (shouldExportPDF: boolean) => {
    setFeedback(null);

    let resolvedWarehouse = lockedWarehouse || selectedWarehouse;
    if (!lockedWarehouse && (showNewWarehouseBox || selectedWarehouse === '__new_warehouse__')) {
      const createdWh = handleConfirmInlineWarehouseInImport();
      if (!createdWh) return;
      resolvedWarehouse = createdWh;
    }

    let resolvedSupplierName =
      selectedSupplierName && selectedSupplierName !== '__new_supplier__'
        ? selectedSupplierName
        : '';
    let resolvedSupplierPhone = supplierPhone.trim();

    if (showNewSupplierBox || selectedSupplierName === '__new_supplier__') {
      const createdSup = handleConfirmInlineSupplierInImport();
      if (!createdSup) return;
      resolvedSupplierName = createdSup.name;
      resolvedSupplierPhone = createdSup.phone;
    }

    // MULTI-ITEM IMPORT CART CHECKOUT PATH
    if (importCartItems.length > 0 && onCreateMultiItemImport) {
      if (!resolvedSupplierName.trim()) {
        setFeedback({
          type: 'error',
          text: 'Vui lòng chọn Nhà cung cấp trước khi lưu Giỏ phiếu nhập nhiều mặt hàng.',
        });
        return;
      }
      const finalCartItems: ImportCartDraftItem[] = [...importCartItems];
      if (selectedProductId && selectedProductId !== '__new_product__' && qtyNum > 0) {
        const draftProd = products.find((p) => p.id === selectedProductId);
        if (draftProd) {
          finalCartItems.push({
            id: `imp_cart_last_${Date.now()}`,
            productId: draftProd.id,
            productName: draftProd.name,
            unit: draftProd.unit,
            quantity: qtyNum,
            unitCost: costNum > 0 ? costNum : draftProd.importPrice,
            batchNumber: batchNumber.trim() || undefined,
            expiryDate: expiryDate || undefined,
          });
        }
      }
      if (!resolvedWarehouse || resolvedWarehouse === '__new_warehouse__') {
        const firstProd = products.find((p) => p.id === finalCartItems[0]?.productId);
        resolvedWarehouse = firstProd?.warehouseName || warehouses[0] || 'Tâm An Mỹ Ngãi';
      }
      try {
        const alloc = allocatePaymentAcrossImportItems(finalCartItems, paidNum);
        const createdImports = onCreateMultiItemImport({
          supplierName: resolvedSupplierName.trim(),
          supplierPhone: resolvedSupplierPhone,
          warehouseName: resolvedWarehouse,
          dueDate:
            alloc.totalDebt > 0
              ? dueDate || computeDueDateAfterDays(30)
              : computeDueDateAfterDays(0),
          note: note.trim(),
          totalPaidAmount: alloc.totalPaid,
          items: finalCartItems,
        });
        const sharedCode = createdImports[0]?.receiptCode || 'PN';
        if (shouldExportPDF && createdImports.length > 0) {
          exportImportReceiptPDF({
            ...createdImports[0],
            totalCost: createdImports.reduce((s, r) => s + r.totalCost, 0),
            paidAmount: createdImports.reduce((s, r) => s + r.paidAmount, 0),
            debtAmount: createdImports.reduce((s, r) => s + r.debtAmount, 0),
            items: createdImports.map((r) => ({
              productName: r.productName,
              unit: r.unit,
              quantity: r.quantity,
              unitCost: r.unitCost,
              totalCost: r.totalCost,
              batchNumber: r.batchNumber,
              expiryDate: r.expiryDate,
            })),
          });
        }
        resetAllImportFieldsToBlank();
        setFeedback({
          type: 'success',
          text: `Đã lưu phiếu nhập kho gộp ${sharedCode} gồm ${createdImports.length} mặt hàng tại ${resolvedWarehouse}!`,
        });
      } catch (err) {
        setFeedback({
          type: 'error',
          text: err instanceof Error ? err.message : 'Có lỗi khi lập phiếu nhập nhiều mặt hàng.',
        });
      }
      return;
    }

    let resolvedProduct = products.find((p) => p.id === selectedProductId) || null;
    if (showNewProductBox || selectedProductId === '__new_product__') {
      const createdProd = handleConfirmInlineProductInImport();
      if (!createdProd) return;
      resolvedProduct = createdProd;
    }
    if (!resolvedProduct) {
      setFeedback({
        type: 'error',
        text: 'Vui lòng chọn vật tư nhập kho hoặc bấm "+ Thêm vật tư mới" để điền trực tiếp.',
      });
      return;
    }

    if (!resolvedWarehouse || resolvedWarehouse === '__new_warehouse__') {
      resolvedWarehouse = resolvedProduct.warehouseName || warehouses[0] || 'Tâm An Mỹ Ngãi';
    }

    if (!resolvedSupplierName.trim()) {
      setFeedback({
        type: 'error',
        text: 'Vui lòng chọn Nhà cung cấp hoặc bấm "+ Thêm NCC mới" để điền trực tiếp.',
      });
      return;
    }

    if (qtyNum <= 0) {
      setFeedback({
        type: 'error',
        text: 'Vui lòng nhập Số lượng nhập kho lớn hơn 0.',
      });
      return;
    }

    const effectiveCost = costNum > 0 ? costNum : resolvedProduct.importPrice;
    const effectiveSummary = calculateImportSummary(qtyNum, effectiveCost, paidNum);

    const createdImport = onCreateImport({
      supplierName: resolvedSupplierName.trim(),
      supplierPhone: resolvedSupplierPhone,
      productId: resolvedProduct.id,
      quantity: qtyNum,
      unitCost: effectiveCost,
      paidAmount: effectiveSummary.paidAmount,
      dueDate:
        effectiveSummary.debtAmount > 0
          ? dueDate || computeDueDateAfterDays(30)
          : computeDueDateAfterDays(0),
      note: note.trim(),
      warehouseName: resolvedWarehouse,
      batchNumber: batchNumber.trim() || undefined,
      expiryDate: expiryDate || undefined,
    });

    if (shouldExportPDF) {
      exportImportReceiptPDF(createdImport);
    }

    // Reset all fields to blank after saving/exporting
    resetAllImportFieldsToBlank();

    setFeedback({
      type: 'success',
      text: shouldExportPDF
        ? `Đã lưu & xuất phiếu PDF nhập kho ${createdImport.receiptCode} (${resolvedWarehouse}). Toàn bộ ô nhập đã làm trống để tạo phiếu mới!`
        : `Đã lưu phiếu nhập kho ${createdImport.receiptCode} vào ${resolvedWarehouse} (+${qtyNum} ${resolvedProduct.unit} ${resolvedProduct.name}) và làm trống các ô để nhập tiếp!`,
    });
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Create Import Form with Inline Warehouse, Product & Supplier Creation */}
        <div className="xl:col-span-5 bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-3.5 border-b border-slate-200 bg-slate-50/60 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={resetAllImportFieldsToBlank}
              className="px-2.5 py-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Làm trống</span>
            </button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitImport(false);
            }}
            className="p-6 space-y-4"
          >
            {feedback && (
              <div
                className={`p-3 rounded-lg border text-xs font-medium flex items-center gap-2 ${
                  feedback.type === 'error'
                    ? 'bg-red-50 border-red-200 text-red-700'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                }`}
              >
                {feedback.type === 'error' ? (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                )}
                <span>{feedback.text}</span>
              </div>
            )}

            {/* Warehouse Selection + Inline Warehouse Creation */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="import-warehouse-select"
                  className="block text-xs font-semibold text-slate-700 flex items-center gap-1.5"
                >
                  <Warehouse className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Chọn kho nhập hàng *</span>
                </label>
                {!lockedWarehouse && (
                  <button
                    type="button"
                    onClick={() => {
                      const next = !showNewWarehouseBox;
                      setShowNewWarehouseBox(next);
                      setSelectedWarehouse(next ? '__new_warehouse__' : '');
                    }}
                    className="text-xs font-semibold text-emerald-700 hover:underline flex items-center gap-1 whitespace-nowrap"
                  >
                    <FolderPlus className="w-3.5 h-3.5" />
                    <span>{showNewWarehouseBox ? 'Đóng thêm kho' : '+ Tạo thêm kho mới'}</span>
                  </button>
                )}
              </div>

              {lockedWarehouse ? (
                <div className="px-3 py-2 text-xs font-semibold bg-emerald-50 text-emerald-900 border border-emerald-200 rounded-lg flex items-center justify-between">
                  <span>Kho được phân quyền: {lockedWarehouse}</span>
                  <span className="text-[11px] text-emerald-700">Nhân viên kho riêng</span>
                </div>
              ) : (
                <SearchableSelect
                  id="import-warehouse-select"
                  value={selectedWarehouse === '__new_warehouse__' ? '' : selectedWarehouse}
                  onChange={(v) => {
                    setSelectedWarehouse(v);
                    setShowNewWarehouseBox(false);
                  }}
                  placeholder="Gõ tên kho nhập hàng (Mỹ Ngãi, Cao Lãnh, Mỹ Trà...) để chọn nhanh"
                  emptyOptionLabel="-- Chưa chọn kho nhập --"
                  createActionLabel="+ Tạo thêm kho mới trực tiếp tại đây..."
                  onCreateAction={(kw) => {
                    setSelectedWarehouse('__new_warehouse__');
                    setShowNewWarehouseBox(true);
                    if (kw) setNewWarehouseName(kw);
                  }}
                  options={warehouses.map((w) => ({
                    value: w,
                    label: `Kho: ${w}`,
                    subLabel: 'Kho lưu trữ vật tư nông nghiệp Tâm An',
                    badge: w,
                    keywords: w,
                  }))}
                />
              )}

              {showNewWarehouseBox && !lockedWarehouse && (
                <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-lg space-y-2">
                  <div className="text-xs font-bold text-emerald-900">
                    Bổ sung kho mới trực tiếp
                  </div>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <input
                      type="text"
                      value={newWarehouseName}
                      onChange={(e) => setNewWarehouseName(e.target.value)}
                      placeholder="VD: Tâm An Tháp Mười"
                      className="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
                    />
                    <button
                      type="button"
                      onClick={handleConfirmInlineWarehouseInImport}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md whitespace-nowrap"
                    >
                      Lưu kho & Chọn
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 1. Select Product to Import + Inline Product Creation */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="import-product-select"
                  className="block text-xs font-semibold text-slate-700"
                >
                  1. Chọn vật tư nhập kho *
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsBarcodeScannerOpen(true)}
                    className="px-2 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md flex items-center gap-1 whitespace-nowrap"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>Quét mã</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const nextState = !showNewProductBox;
                      setShowNewProductBox(nextState);
                      setSelectedProductId(nextState ? '__new_product__' : '');
                    }}
                    className="text-xs font-semibold text-emerald-700 hover:underline flex items-center gap-1 whitespace-nowrap"
                  >
                    <PackagePlus className="w-3.5 h-3.5" />
                    <span>{showNewProductBox ? 'Đóng khung thêm VT' : '+ Thêm vật tư mới'}</span>
                  </button>
                </div>
              </div>

              <SearchableSelect
                id="import-product-select"
                value={selectedProductId === '__new_product__' ? '' : selectedProductId}
                onChange={(val) => handleSelectProduct(val)}
                placeholder="Gõ tên vật tư, mã VT hoặc kho để tìm nhanh (hoặc bấm +/- chọn nhiều món)..."
                emptyOptionLabel="-- Chưa chọn vật tư nhập --"
                createActionLabel="+ Thêm vật tư nhập kho mới trực tiếp tại đây..."
                onCreateAction={(kw) => {
                  setSelectedProductId('__new_product__');
                  setShowNewProductBox(true);
                  if (kw) setNewProdName(kw);
                }}
                quickQuantities={onCreateMultiItemImport ? quickImportQuantities : undefined}
                onQuickQuantityChange={
                  onCreateMultiItemImport ? handleQuickSetImportProductQuantity : undefined
                }
                quickCartSummaryLabel={
                  importCartItems.length > 0
                    ? `Giỏ nhập: ${importCartItems.length} mặt hàng`
                    : undefined
                }
                options={products.map((p) => ({
                  value: p.id,
                  label: `[${p.code}] ${p.name} (${p.warehouseName || 'Tâm An Mỹ Ngãi'} · Tồn: ${p.stock} ${p.unit})`,
                  subLabel: `Giá nhập: ${formatVND(p.importPrice)} · Giá bán: ${formatVND(p.sellPrice)} · NCC: ${p.supplierName}`,
                  badge: `Tồn: ${p.stock} ${p.unit}`,
                  keywords: `${p.code} ${p.name} ${p.barcode || ''} ${p.batchNumber || ''} ${p.category} ${p.warehouseName || ''} ${p.supplierName}`,
                }))}
              />

              {importCartItems.length > 0 && (
                <div className="p-3 bg-emerald-50/75 rounded-xl border border-emerald-300 space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-bold text-emerald-950 flex items-center gap-1.5">
                      <Truck className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                      <span>
                        Giỏ phiếu nhập chung NCC ({importCartItems.length} mặt hàng ·{' '}
                        {formatVND(
                          importCartItems.reduce((s, i) => s + Math.round(i.quantity * i.unitCost), 0)
                        )}
                        )
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setImportCartItems([])}
                      className="text-[11px] font-semibold text-rose-600 hover:underline"
                    >
                      Xóa giỏ
                    </button>
                  </div>
                  <div className="bg-white rounded-lg border border-emerald-200 divide-y divide-slate-100">
                    {importCartItems.map((item, idx) => (
                      <div
                        key={item.id}
                        className="p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-slate-900 truncate">
                            {idx + 1}. {item.productName}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-[11px] text-slate-600 font-mono">
                            <span>Giá nhập:</span>
                            <input
                              type="number"
                              min={0}
                              value={item.unitCost}
                              onChange={(e) => {
                                const nextCost = Math.max(0, Number(e.target.value) || 0);
                                setImportCartItems((prev) =>
                                  prev.map((x) =>
                                    x.id === item.id ? { ...x, unitCost: nextCost } : x
                                  )
                                );
                              }}
                              aria-label={`Đơn giá nhập ${item.productName}`}
                              className="w-24 px-1.5 py-0.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded"
                            />
                            <span>đ/{item.unit}</span>
                            {item.batchNumber && (
                              <span className="px-1.5 py-0.2 bg-slate-100 rounded text-[10px]">
                                Lô: {item.batchNumber}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              setImportCartItems((prev) =>
                                prev
                                  .map((x) =>
                                    x.id === item.id
                                      ? { ...x, quantity: Math.max(0, x.quantity - 1) }
                                      : x
                                  )
                                  .filter((x) => x.quantity > 0)
                              )
                            }
                            className="w-6 h-6 rounded border border-slate-300 bg-white hover:bg-slate-100 font-bold"
                          >
                            -
                          </button>
                          <span className="w-8 text-center font-mono font-bold text-slate-900">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setImportCartItems((prev) =>
                                prev.map((x) =>
                                  x.id === item.id ? { ...x, quantity: x.quantity + 1 } : x
                                )
                              )
                            }
                            className="w-6 h-6 rounded border border-slate-300 bg-white hover:bg-slate-100 font-bold"
                          >
                            +
                          </button>
                          <span className="font-mono font-bold text-emerald-800 min-w-[82px] text-right">
                            {formatVND(Math.round(item.quantity * item.unitCost))}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setImportCartItems((prev) => prev.filter((x) => x.id !== item.id))
                            }
                            aria-label={`Xóa ${item.productName} khỏi giỏ nhập`}
                            className="p-1 text-slate-400 hover:text-rose-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {showNewProductBox && (
                <div className="p-3.5 bg-emerald-50/60 rounded-lg border border-emerald-200 space-y-3">
                  <div className="text-xs font-bold text-emerald-900">
                    Thêm mới vật tư nhập kho trực tiếp
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div className="sm:col-span-2">
                      <label
                        htmlFor="imp-inline-prod-name"
                        className="block text-[11px] font-semibold text-slate-700 mb-1"
                      >
                        Tên vật tư mới *
                      </label>
                      <input
                        id="imp-inline-prod-name"
                        type="text"
                        value={newProdName}
                        onChange={(e) => setNewProdName(e.target.value)}
                        placeholder="VD: Phân bón hữu cơ vi sinh Tâm An"
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="imp-inline-prod-unit"
                        className="block text-[11px] font-semibold text-slate-700 mb-1"
                      >
                        Đơn vị tính *
                      </label>
                      <input
                        id="imp-inline-prod-unit"
                        type="text"
                        value={newProdUnit}
                        onChange={(e) => setNewProdUnit(e.target.value)}
                        placeholder="Bao 50kg / CẶP"
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label
                        htmlFor="imp-inline-prod-cat"
                        className="block text-[11px] font-semibold text-slate-700 mb-1"
                      >
                        Nhóm vật tư
                      </label>
                      <select
                        id="imp-inline-prod-cat"
                        value={newProdCategory}
                        onChange={(e) => setNewProdCategory(e.target.value as ProductCategory)}
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
                      >
                        <option value="Phân bón">Phân bón</option>
                        <option value="Thuốc BVTV">Thuốc BVTV</option>
                        <option value="Hạt giống">Hạt giống</option>
                        <option value="Chế phẩm sinh học">Chế phẩm sinh học</option>
                        <option value="Vật tư & Dụng cụ">Vật tư & Dụng cụ</option>
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor="imp-inline-prod-cost"
                        className="block text-[11px] font-semibold text-slate-700 mb-1"
                      >
                        Giá nhập (VNĐ) *
                      </label>
                      <input
                        id="imp-inline-prod-cost"
                        type="number"
                        min={0}
                        value={newProdImportPrice}
                        onChange={(e) => setNewProdImportPrice(e.target.value)}
                        placeholder="285000"
                        className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-md"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="imp-inline-prod-sell"
                        className="block text-[11px] font-semibold text-slate-700 mb-1"
                      >
                        Giá bán lẻ (VNĐ)
                      </label>
                      <input
                        id="imp-inline-prod-sell"
                        type="number"
                        min={0}
                        value={newProdSellPrice}
                        onChange={(e) => setNewProdSellPrice(e.target.value)}
                        placeholder="350000"
                        className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-md"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleConfirmInlineProductInImport}
                    className="w-full py-1.5 px-3 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors"
                  >
                    Lưu vật tư mới & Chọn ngay vào phiếu nhập
                  </button>
                </div>
              )}
            </div>

            {/* 2. Select Supplier + Inline Supplier Creation */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="import-supplier-select"
                  className="block text-xs font-semibold text-slate-700"
                >
                  2. Chọn Nhà cung cấp *
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const nextState = !showNewSupplierBox;
                    setShowNewSupplierBox(nextState);
                    setSelectedSupplierName(nextState ? '__new_supplier__' : '');
                  }}
                  className="text-xs font-semibold text-emerald-700 hover:underline flex items-center gap-1 whitespace-nowrap"
                >
                  <Building2 className="w-3.5 h-3.5" />
                  <span>{showNewSupplierBox ? 'Đóng khung thêm NCC' : '+ Thêm NCC mới'}</span>
                </button>
              </div>

              <SearchableSelect
                id="import-supplier-select"
                value={selectedSupplierName === '__new_supplier__' ? '' : selectedSupplierName}
                onChange={(val) => handleSelectSupplier(val)}
                placeholder="Gõ tên Nhà cung cấp, SĐT hoặc địa chỉ để tìm nhanh..."
                emptyOptionLabel="-- Chưa chọn nhà cung cấp --"
                createActionLabel="+ Thêm nhà cung cấp mới trực tiếp tại đây..."
                onCreateAction={(kw) => {
                  setSelectedSupplierName('__new_supplier__');
                  setShowNewSupplierBox(true);
                  if (kw) setNewSupName(kw);
                }}
                options={suppliers.map((sup) => {
                  const supOld = computeSupplierOldDebtSummary(sup.name, imports, 0);
                  return {
                    value: sup.name,
                    label: `${sup.name} (${sup.phone || 'Chưa có SĐT'})`,
                    subLabel: `${sup.address || 'Nhà cung cấp VTNN'} · Công nợ cũ NCC: ${formatVND(
                      supOld.oldDebtAmount
                    )}`,
                    badge:
                      supOld.oldDebtAmount > 0
                        ? `Nợ NCC: ${formatVND(supOld.oldDebtAmount)}`
                        : sup.phone || 'NCC',
                    keywords: `${sup.name} ${sup.phone} ${sup.address}`,
                  };
                })}
              />

              {/* Supplier Old Debt Reminder Banner when Supplier is chosen (Only Total Old Debt) */}
              {supplierOldDebt.hasSupplier && (
                <div
                  className={`p-3 rounded-lg border text-xs flex flex-wrap items-center justify-between gap-2 ${
                    supplierOldDebt.oldDebtAmount > 0
                      ? 'bg-amber-50/90 border-amber-300 text-amber-950'
                      : 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                  }`}
                >
                  <span className="font-bold flex items-center gap-1.5">
                    <AlertCircle
                      className={`w-3.5 h-3.5 shrink-0 ${
                        supplierOldDebt.oldDebtAmount > 0 ? 'text-red-600' : 'text-emerald-700'
                      }`}
                    />
                    <span>Tổng công nợ cũ Nhà cung cấp ({supplierOldDebt.supplierName}):</span>
                  </span>
                  <span
                    className={`font-mono font-bold text-sm ${
                      supplierOldDebt.oldDebtAmount > 0 ? 'text-red-600' : 'text-emerald-700'
                    }`}
                  >
                    {formatVND(supplierOldDebt.oldDebtAmount)}
                  </span>
                </div>
              )}

              {showNewSupplierBox ? (
                <div className="p-3.5 bg-emerald-50/60 rounded-lg border border-emerald-200 space-y-3">
                  <div className="text-xs font-bold text-emerald-900">
                    Bổ sung Nhà cung cấp mới trực tiếp
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label
                        htmlFor="imp-inline-sup-name"
                        className="block text-[11px] font-semibold text-slate-700 mb-1"
                      >
                        Tên Nhà cung cấp mới *
                      </label>
                      <input
                        id="imp-inline-sup-name"
                        type="text"
                        value={newSupName}
                        onChange={(e) => setNewSupName(e.target.value)}
                        placeholder="VD: Công ty CP Phân bón Miền Tây"
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="imp-inline-sup-phone"
                        className="block text-[11px] font-semibold text-slate-700 mb-1"
                      >
                        Số điện thoại NCC *
                      </label>
                      <input
                        id="imp-inline-sup-phone"
                        type="tel"
                        value={newSupPhone}
                        onChange={(e) => setNewSupPhone(e.target.value)}
                        placeholder="VD: 0283..."
                        className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-md"
                      />
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor="imp-inline-sup-addr"
                      className="block text-[11px] font-semibold text-slate-700 mb-1"
                    >
                      Địa chỉ / Ghi chú NCC
                    </label>
                    <input
                      id="imp-inline-sup-addr"
                      type="text"
                      value={newSupAddress}
                      onChange={(e) => setNewSupAddress(e.target.value)}
                      placeholder="Nhập địa chỉ kho hoặc khu công nghiệp..."
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleConfirmInlineSupplierInImport}
                    className="w-full py-1.5 px-3 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors"
                  >
                    Lưu Nhà cung cấp mới & Chọn ngay
                  </button>
                </div>
              ) : (
                <div>
                  <label
                    htmlFor="import-supplier-phone"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    SĐT Nhà cung cấp
                  </label>
                  <input
                    id="import-supplier-phone"
                    type="tel"
                    value={supplierPhone}
                    onChange={(e) => setSupplierPhone(e.target.value)}
                    placeholder="Tự động điền hoặc nhập SĐT NCC..."
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="import-qty-input"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Số lượng nhập ({currentProduct?.unit || 'Đơn vị'}) *
                </label>
                <input
                  id="import-qty-input"
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="Nhập số lượng..."
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label
                  htmlFor="import-cost-input"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Đơn giá nhập (VNĐ) *
                </label>
                <input
                  id="import-cost-input"
                  type="number"
                  min={0}
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                  placeholder="Nhập giá nhập..."
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="import-batch-input"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Số lô nhập (FEFO)
                </label>
                <input
                  id="import-batch-input"
                  type="text"
                  value={batchNumber}
                  onChange={(e) => setBatchNumber(e.target.value)}
                  placeholder="VD: LO-2611-A"
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label
                  htmlFor="import-expiry-input"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Hạn sử dụng lô (HSD)
                </label>
                <input
                  id="import-expiry-input"
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                />
              </div>
            </div>

            {onCreateMultiItemImport && (
              <button
                type="button"
                onClick={handleAddCurrentImportItemToCart}
                className="w-full py-2 px-3 text-xs font-bold text-emerald-800 bg-emerald-50/40 hover:bg-emerald-50 border-2 border-dashed border-emerald-400 rounded-lg transition-colors flex items-center justify-center gap-1.5"
              >
                <Plus className="w-4 h-4 shrink-0" />
                <span>
                  Thêm vật tư này vào Giỏ phiếu nhập chung ({importCartItems.length} mặt hàng)
                </span>
              </button>
            )}

            <div className="space-y-3 p-3.5 bg-amber-50/40 rounded-lg border border-amber-200/80">
              <div>
                <label
                  htmlFor="import-paid-input"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Đã thanh toán cho NCC (VNĐ)
                </label>
                <input
                  id="import-paid-input"
                  type="number"
                  min={0}
                  max={summary.totalCost}
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                  placeholder="0"
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                />
              </div>

              <div className="space-y-2 pt-2 border-t border-amber-200/70">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="import-debt-days-select"
                      className="block text-xs font-semibold text-slate-700 mb-1"
                    >
                      Chọn ngày nợ NCC (Tự động nhảy ngày)
                    </label>
                    <select
                      id="import-debt-days-select"
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
                    <label
                      htmlFor="import-duedate-input"
                      className="block text-xs font-semibold text-slate-700 mb-1"
                    >
                      Hạn hẹn thanh toán nợ NCC *
                    </label>
                    <input
                      id="import-duedate-input"
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
            </div>

            {/* Live Import Summary Box with Supplier Old Debt Reminder & Cumulative Debt */}
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Tổng giá trị lô nhập:</span>
                <span className="text-sm font-bold font-mono tabular-nums text-slate-900">
                  {formatVND(summary.totalCost)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Đã thanh toán cho NCC (lô này):</span>
                <span className="font-mono tabular-nums text-emerald-700 font-semibold">
                  {formatVND(summary.paidAmount)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Tồn kho sau khi nhập:</span>
                <span className="font-mono tabular-nums text-emerald-700 font-bold">
                  {(currentProduct?.stock || 0) + qtyNum} {currentProduct?.unit || ''}
                </span>
              </div>
              <div className="flex items-center justify-between pt-1.5 border-t border-slate-200">
                <span className="text-slate-700 font-medium">Công nợ phải trả NCC (lô này):</span>
                <span
                  className={`font-mono tabular-nums font-bold ${
                    summary.debtAmount > 0 ? 'text-red-600' : 'text-slate-500'
                  }`}
                >
                  {formatVND(summary.debtAmount)}
                </span>
              </div>

              {/* Supplier Old Debt & Cumulative Total Supplier Debt Section (Only Total Old Debt) */}
              <div className="pt-2 border-t border-dashed border-slate-300 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-700 font-semibold">
                    Tổng công nợ cũ Nhà cung cấp
                    {supplierOldDebt.hasSupplier ? ` (${supplierOldDebt.supplierName})` : ''}:
                  </span>
                  <span
                    className={`font-mono tabular-nums font-bold ${
                      supplierOldDebt.oldDebtAmount > 0 ? 'text-amber-700' : 'text-slate-500'
                    }`}
                  >
                    {formatVND(supplierOldDebt.oldDebtAmount)}
                  </span>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-slate-200 bg-white px-2.5 py-2 rounded-md border">
                  <span className="text-slate-900 font-bold">
                    Tổng công nợ Nhà cung cấp (Tổng nợ cũ + Lô này):
                  </span>
                  <span
                    className={`text-sm font-mono tabular-nums font-extrabold ${
                      supplierOldDebt.cumulativeTotalDebt > 0
                        ? 'text-red-600'
                        : 'text-emerald-700'
                    }`}
                  >
                    {formatVND(supplierOldDebt.cumulativeTotalDebt)}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <label
                htmlFor="import-note-input"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Ghi chú lô hàng nhập
              </label>
              <input
                id="import-note-input"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="VD: Nhập bổ sung vụ Đông Xuân, chiết khấu 2%..."
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <button
                type="submit"
                className="w-full py-2.5 px-3 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors flex items-center justify-center gap-1.5"
              >
                <Plus className="w-4 h-4 shrink-0" />
                <span>
                  {importCartItems.length > 0
                    ? `Lưu phiếu nhập (${combinedImportPreviewItems.length} món)`
                    : 'Lưu phiếu nhập kho'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => submitImport(true)}
                className="w-full py-2.5 px-3 text-xs font-semibold text-slate-900 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors flex items-center justify-center gap-1.5"
              >
                <FileDown className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>Lưu & Xuất Phiếu PDF</span>
              </button>
            </div>
          </form>
        </div>

        {/* Right: Import History Table */}
        {(() => {
          const importEntries = imports.map((imp) => ({
            imp,
            diag: diagnoseImportVoucher({
              imp,
              products,
              sales,
              imports,
              paymentVouchers,
              stockAdjustments,
            }),
          }));
          const qNorm = normalizeVietnameseSearch(importSearchQuery);
          const filteredImportEntries = importEntries.filter(({ imp, diag }) => {
            if (importStatusFilter === 'debt' && imp.debtAmount <= 0) return false;
            if (importStatusFilter === 'paid' && imp.debtAmount > 0) return false;
            if (importStatusFilter === 'issues' && diag.statusLevel === 'ok') return false;
            if (!qNorm) return true;
            const hay = normalizeVietnameseSearch(
              `${imp.receiptCode} ${imp.supplierName} ${imp.supplierPhone} ${imp.productName} ${imp.warehouseName || ''} ${diag.statusLabel}`
            );
            return hay.includes(qNorm);
          });
          const issuesCount = importEntries.filter((e) => e.diag.statusLevel !== 'ok').length;
          const distinctReceiptsCount = countDistinctImportReceipts(
            filteredImportEntries.map((e) => e.imp)
          );
          const hasMultiLineReceipts = filteredImportEntries.length > distinctReceiptsCount;
          const displayedImportEntries =
            focusedImportRecord &&
            filteredImportEntries.findIndex((e) => e.imp.id === focusedImportRecord.id) >=
              importRowLimit
              ? filteredImportEntries
              : filteredImportEntries.slice(0, importRowLimit);

          return (
        <div className="xl:col-span-7 bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Nhật Ký Nhập Hàng ({distinctReceiptsCount} phiếu
                {hasMultiLineReceipts ? ` · ${filteredImportEntries.length} dòng VT` : ''})
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Hỗ trợ Sửa / Hủy phiếu mua hàng và liên kết đối soát nhanh Tồn kho, Công nợ &amp; Phiếu chi
              </p>
            </div>
            <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={importSearchQuery}
                  onChange={(e) => setImportSearchQuery(e.target.value)}
                  placeholder="Tìm mã PN, NCC, vật tư..."
                  aria-label="Tìm kiếm phiếu nhập hàng"
                  className="w-full sm:w-48 pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 sm:flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                {(
                  [
                    { id: 'all', label: 'Tất cả' },
                    { id: 'debt', label: 'Còn nợ NCC' },
                    { id: 'paid', label: 'Đã trả đủ' },
                    { id: 'issues', label: `Cảnh báo (${issuesCount})` },
                  ] as const
                ).map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => setImportStatusFilter(st.id)}
                    className={`px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      importStatusFilter === st.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {focusedImportRecord && onClearFocusedImport && (
            <FocusedLinkBanner
              code={focusedImportRecord.receiptCode}
              title={`${focusedImportRecord.supplierName} · ${focusedImportRecord.productName} (+${focusedImportRecord.quantity} ${focusedImportRecord.unit})`}
              onClear={onClearFocusedImport}
              actions={
                canPerformRoleAction(role, 'edit_record') ? (
                  <>
                    <button
                      type="button"
                      onClick={() => openEditImportModal(focusedImportRecord)}
                      className="px-2.5 py-1 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-100 rounded-md inline-flex items-center gap-1"
                    >
                      <Pencil className="w-3 h-3" />
                      <span>Sửa phiếu</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCancelingImport(focusedImportRecord)}
                      className="px-2.5 py-1 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 rounded-md inline-flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Hủy phiếu</span>
                    </button>
                  </>
                ) : undefined
              }
            />
          )}

          {/* Mobile Card View (< md): Full-width balanced layout, zero column squishing */}
          <div className="md:hidden divide-y divide-slate-200">
            {filteredImportEntries.length === 0 ? (
              <div className="py-10 px-4 text-center text-xs text-slate-500">
                Chưa có phiếu nhập kho nào khớp với bộ lọc hiện tại.
              </div>
            ) : (
              displayedImportEntries.map(({ imp, diag }) => {
                const { urgency } = evaluateDebtUrgency(imp.dueDate, imp.debtAmount);
                const isFocused = focusedImportRecord?.id === imp.id;
                return (
                  <div
                    key={imp.id}
                    className={`p-4 space-y-3 transition-colors ${
                      isFocused
                        ? 'bg-emerald-50/80 ring-2 ring-inset ring-emerald-500'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-mono text-xs font-bold text-slate-900">
                          {imp.receiptCode}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                          Ngày: {imp.createdAt.slice(0, 10)}
                        </div>
                      </div>
                      <span className="px-2 py-0.5 text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-md whitespace-nowrap">
                        {imp.warehouseName || 'Tâm An Mỹ Ngãi'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                        <div className="text-xs font-mono text-emerald-700 font-semibold">
                          +{imp.quantity} {imp.unit} ({formatVND(imp.unitCost)})
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-xs">
                      <div>
                        <div className="text-[11px] text-slate-500">Tổng tiền nhập</div>
                        <div className="font-mono tabular-nums font-bold text-slate-900 mt-0.5">
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
                        <div
                          className={`font-mono tabular-nums font-bold mt-0.5 ${
                            imp.debtAmount > 0 ? 'text-red-600' : 'text-emerald-700'
                          }`}
                        >
                          {formatVND(imp.debtAmount)}
                        </div>
                      </div>
                    </div>

                    {/* Cross-Document Links & Diagnostic Strip (Mobile) */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {diag.statusLevel !== 'ok' && (
                        <span
                          className={`px-2 py-0.5 text-[11px] font-bold rounded border ${
                            diag.statusLevel === 'blocked'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}
                        >
                          {diag.statusLabel}
                        </span>
                      )}
                      {onNavigateCrossLink && (
                        <>
                          {diag.linkedProduct && (
                            <CrossLinkChip
                              tone="indigo"
                              label={`Thẻ kho: ${diag.linkedProduct.code} (Tồn ${diag.linkedProduct.stock})`}
                              onClick={() =>
                                onNavigateCrossLink({
                                  tab: 'inventory',
                                  recordId: diag.linkedProduct!.id,
                                  label: `Thẻ kho ${diag.linkedProduct!.name}`,
                                })
                              }
                            />
                          )}
                          {imp.debtAmount > 0 && (
                            <CrossLinkChip
                              tone="amber"
                              label="Công nợ NCC"
                              onClick={() =>
                                onNavigateCrossLink({
                                  tab: 'debts',
                                  recordId: imp.id,
                                  subTab: 'supplier',
                                  label: `Công nợ ${imp.receiptCode}`,
                                })
                              }
                            />
                          )}
                          {diag.linkedPaymentVouchers.map((pv) => (
                            <CrossLinkChip
                              key={pv.id}
                              tone="rose"
                              label={`Phiếu chi ${pv.voucherCode}`}
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
                          {diag.relatedSales.slice(0, 2).map((s) => (
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
                          {diag.relatedSales.length === 0 && (
                            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-600 rounded">
                              0 HĐ bán liên kết
                            </span>
                          )}
                        </>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleExportGroupedImportPdf(imp)}
                          className="px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md whitespace-nowrap"
                        >
                          Xuất PDF
                        </button>
                        {imp.debtAmount > 0 && (
                          <span
                            className={`text-[11px] font-mono ${
                              urgency === 'overdue'
                                ? 'text-red-600 font-semibold'
                                : 'text-amber-700'
                            }`}
                          >
                            Hạn: {imp.dueDate}
                          </span>
                        )}
                      </div>

                      {canPerformRoleAction(role, 'edit_record') ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditImportModal(imp)}
                            aria-label={`Sửa phiếu nhập ${imp.receiptCode}`}
                            className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md flex items-center gap-1 whitespace-nowrap"
                          >
                            <Pencil className="w-3 h-3" />
                            <span>Sửa</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setCancelingImport(imp)}
                            aria-label={`Hủy phiếu mua hàng ${imp.receiptCode}`}
                            className="px-2.5 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-md border border-rose-200 flex items-center gap-1 whitespace-nowrap"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Hủy phiếu</span>
                          </button>
                        </div>
                      ) : (
                        <span
                          title="Chỉ Quản lý mới có quyền sửa hoặc xóa chứng từ nhập kho"
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
            <table className="w-full min-w-[980px] text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-xs shadow-2xs">
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4 w-[155px] whitespace-nowrap">Mã phiếu &amp; Kho nhập</th>
                  <th className="py-3 px-4 min-w-[175px]">Nhà cung cấp</th>
                  <th className="py-3 px-4 min-w-[240px]">Vật tư nhập &amp; Liên kết chứng từ</th>
                  <th className="py-3 px-4 w-[115px] text-right whitespace-nowrap">Tổng tiền nhập</th>
                  <th className="py-3 px-4 w-[145px] text-right whitespace-nowrap">Công nợ NCC &amp; Hạn trả</th>
                  <th className="py-3 px-4 w-[210px] text-right whitespace-nowrap">
                    PDF / Sửa &amp; Hủy Phiếu
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredImportEntries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 px-4 text-center text-xs text-slate-500">
                      Không có phiếu nhập kho nào khớp với bộ lọc hiện tại.
                    </td>
                  </tr>
                ) : (
                  displayedImportEntries.map(({ imp, diag }) => {
                  const { urgency } = evaluateDebtUrgency(imp.dueDate, imp.debtAmount);
                  const isFocused = focusedImportRecord?.id === imp.id;
                  return (
                    <tr
                      key={imp.id}
                      className={`transition-colors ${
                        isFocused
                          ? 'bg-emerald-50/80 ring-1 ring-inset ring-emerald-500'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-3 px-4 whitespace-nowrap align-middle">
                        <div className="font-mono text-xs font-semibold text-slate-900">
                          {imp.receiptCode}
                        </div>
                        <div className="text-xs font-semibold text-emerald-800 mt-0.5">
                          {imp.warehouseName || 'Tâm An Mỹ Ngãi'}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500">
                          {imp.createdAt.slice(0, 10)}
                        </div>
                        {diag.statusLevel !== 'ok' && (
                          <div className="mt-1">
                            <span
                              className={`inline-block px-1.5 py-0.5 text-[10px] font-bold rounded border ${
                                diag.statusLevel === 'blocked'
                                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                                  : 'bg-amber-50 text-amber-800 border-amber-200'
                              }`}
                            >
                              {diag.statusLabel}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 min-w-[175px] align-middle">
                        <div className="font-semibold text-slate-900 leading-snug">{imp.supplierName}</div>
                        <div className="text-xs font-mono text-slate-500 mt-0.5">{imp.supplierPhone}</div>
                      </td>
                      <td className="py-3 px-4 min-w-[240px] align-middle">
                        {onNavigateCrossLink && diag.linkedProduct ? (
                          <button
                            type="button"
                            onClick={() =>
                              onNavigateCrossLink({
                                tab: 'inventory',
                                recordId: diag.linkedProduct!.id,
                                label: `Thẻ kho ${diag.linkedProduct!.name}`,
                              })
                            }
                            className="text-xs font-semibold text-slate-900 hover:text-indigo-800 hover:underline leading-snug text-left"
                            title="Bấm để mở Thẻ kho Xuất - Nhập - Tồn"
                          >
                            {imp.productName}
                          </button>
                        ) : (
                          <div className="text-xs font-medium text-slate-900 leading-snug">{imp.productName}</div>
                        )}
                        <div className="text-xs font-mono text-emerald-700 font-semibold mt-0.5">
                          +{imp.quantity} {imp.unit} (Giá nhập: {formatVND(imp.unitCost)})
                        </div>
                        {onNavigateCrossLink && (
                          <div className="flex flex-wrap items-center gap-1 mt-1.5">
                            {diag.linkedProduct && (
                              <CrossLinkChip
                                tone="indigo"
                                label={`Thẻ kho (Tồn ${diag.linkedProduct.stock})`}
                                onClick={() =>
                                  onNavigateCrossLink({
                                    tab: 'inventory',
                                    recordId: diag.linkedProduct!.id,
                                    label: `Thẻ kho ${diag.linkedProduct!.name}`,
                                  })
                                }
                              />
                            )}
                            {imp.debtAmount > 0 && (
                              <CrossLinkChip
                                tone="amber"
                                label="Công nợ NCC"
                                onClick={() =>
                                  onNavigateCrossLink({
                                    tab: 'debts',
                                    recordId: imp.id,
                                    subTab: 'supplier',
                                    label: `Công nợ ${imp.receiptCode}`,
                                  })
                                }
                              />
                            )}
                            {diag.linkedPaymentVouchers.map((pv) => (
                              <CrossLinkChip
                                key={pv.id}
                                tone="rose"
                                label={pv.voucherCode}
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
                            {diag.relatedSales.slice(0, 2).map((s) => (
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
                            {diag.relatedSales.length > 2 && (
                              <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-sky-50 text-sky-800 rounded">
                                +{diag.relatedSales.length - 2} HĐ
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-xs font-bold text-slate-900 whitespace-nowrap align-middle">
                        {formatVND(imp.totalCost)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap align-middle">
                        {imp.debtAmount > 0 ? (
                          <div>
                            <button
                              type="button"
                              onClick={() =>
                                onNavigateCrossLink
                                  ? onNavigateCrossLink({
                                      tab: 'debts',
                                      recordId: imp.id,
                                      subTab: 'supplier',
                                      label: `Công nợ ${imp.receiptCode}`,
                                    })
                                  : onOpenDebtRecord?.(imp.id)
                              }
                              className="font-mono tabular-nums text-xs font-bold text-red-600 hover:underline"
                              title="Bấm để mở Công nợ NCC của phiếu này"
                            >
                              Nợ: {formatVND(imp.debtAmount)}
                            </button>
                            <div
                              className={`text-xs font-mono mt-0.5 ${
                                urgency === 'overdue'
                                  ? 'text-red-600 font-semibold'
                                  : 'text-amber-700'
                              }`}
                            >
                              Hạn: {imp.dueDate}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-emerald-700 font-medium">
                            Đã tất toán đủ
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap align-middle">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleExportGroupedImportPdf(imp)}
                            className="px-2 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md whitespace-nowrap"
                          >
                            PDF
                          </button>
                          {canPerformRoleAction(role, 'edit_record') ? (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditImportModal(imp)}
                                aria-label={`Sửa phiếu nhập ${imp.receiptCode}`}
                                className="px-2 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md flex items-center gap-1 whitespace-nowrap"
                              >
                                <Pencil className="w-3 h-3" />
                                <span>Sửa</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setCancelingImport(imp)}
                                aria-label={`Hủy phiếu mua hàng ${imp.receiptCode}`}
                                className="px-2 py-1 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md flex items-center gap-1 whitespace-nowrap"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Hủy phiếu</span>
                              </button>
                            </>
                          ) : (
                            <span
                              title="Chỉ Quản lý mới có quyền sửa hoặc xóa chứng từ nhập kho"
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
              {filteredImportEntries.length > 0 && (
                <tfoot className="border-t-2 border-amber-200 bg-amber-50/70 text-xs font-semibold text-slate-800">
                  <tr>
                    <td colSpan={3} className="py-3 px-4">
                      Tổng kết bộ lọc: <strong>{distinctReceiptsCount}</strong> phiếu nhập
                      {hasMultiLineReceipts ? ` (${filteredImportEntries.length} dòng vật tư)` : ''}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap font-bold text-slate-900">
                      {formatVND(filteredImportEntries.reduce((sum, e) => sum + e.imp.totalCost, 0))}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                      <div className="text-emerald-800">
                        ∑ Trả: {formatVND(filteredImportEntries.reduce((sum, e) => sum + e.imp.paidAmount, 0))}
                      </div>
                      <div className="text-red-700 font-bold">
                        ∑ Nợ: {formatVND(filteredImportEntries.reduce((sum, e) => sum + e.imp.debtAmount, 0))}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right text-[11px] text-slate-500">
                      Khớp 100% sổ nhập &amp; công nợ NCC
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {filteredImportEntries.length > displayedImportEntries.length && (
            <div className="p-3.5 border-t border-slate-200 bg-slate-50/70 text-center">
              <button
                type="button"
                onClick={() => setImportRowLimit((prev) => prev + 80)}
                className="px-4 py-2 text-xs font-semibold text-emerald-800 bg-white hover:bg-emerald-50 border border-emerald-300 rounded-lg shadow-2xs transition-colors"
              >
                Hiển thị thêm phiếu nhập (Đang xem {displayedImportEntries.length} / {filteredImportEntries.length} dòng)
              </button>
            </div>
          )}
        </div>
          );
        })()}
      </div>

      {/* Excel Sample Template Download & Upload Bar (Moved to bottom of page) */}
      <ExcelDataBar
        moduleType="imports"
        moduleTitle="Nhật Ký Nhập Hàng & Nhà Cung Cấp"
        onImportRows={onImportWarehouseFromExcel}
        onExportCurrentData={() =>
          exportModuleDataExcel({
            moduleType: 'imports',
            products,
            customers,
            sales: [],
            imports,
          })
        }
      />

      {/* Manager-Only Edit Saved Import Receipt Modal */}
      {editingImport && canPerformRoleAction(role, 'edit_record') && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2.5 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Chỉnh sửa phiếu nhập kho ${editingImport.receiptCode}`}
        >
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-lg max-h-[calc(100dvh-1.25rem)] sm:max-h-[90vh] flex flex-col overflow-hidden shadow-xl">
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/90 shrink-0">
              <div className="min-w-0 pr-2">
                <h3 className="text-sm sm:text-base font-bold text-slate-900 truncate">
                  Chỉnh Sửa Chứng Từ Nhập Kho ({editingImport.receiptCode})
                </h3>
                <p className="text-[11px] sm:text-xs text-emerald-800 font-medium mt-0.5">
                  Quyền Quản lý: Cho phép chỉnh sửa kho nhập, nhà cung cấp, số lượng, giá nhập và công nợ
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingImport(null)}
                aria-label="Đóng cửa sổ sửa phiếu nhập"
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                onUpdateImport(editingImport.id, {
                  receiptCode: editImpCode,
                  warehouseName: editImpWarehouse,
                  supplierName: editImpSupplierName,
                  supplierPhone: editImpSupplierPhone,
                  productName: editImpProductName,
                  unit: editImpUnit,
                  quantity: Math.max(1, Number(editImpQty) || 1),
                  unitCost: Math.max(0, Number(editImpCost) || 0),
                  paidAmount: Math.max(0, Number(editImpPaid) || 0),
                  dueDate: editImpDueDate,
                  note: editImpNote,
                });
                setEditingImport(null);
              }}
              className="flex flex-col flex-1 min-h-0 overflow-hidden"
            >
              <div className="p-4 sm:p-6 space-y-3.5 sm:space-y-4 overflow-y-auto flex-1 overscroll-contain">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="edit-imp-code" className="block text-xs font-semibold text-slate-700 mb-1">
                    Mã phiếu nhập kho
                  </label>
                  <input
                    id="edit-imp-code"
                    type="text"
                    required
                    value={editImpCode}
                    onChange={(e) => setEditImpCode(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="edit-imp-wh" className="block text-xs font-semibold text-slate-700 mb-1">
                    Kho nhập hàng
                  </label>
                  <select
                    id="edit-imp-wh"
                    value={editImpWarehouse}
                    onChange={(e) => setEditImpWarehouse(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                  >
                    {warehouses.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="edit-imp-sup" className="block text-xs font-semibold text-slate-700 mb-1">
                    Nhà cung cấp *
                  </label>
                  <input
                    id="edit-imp-sup"
                    type="text"
                    required
                    value={editImpSupplierName}
                    onChange={(e) => setEditImpSupplierName(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="edit-imp-phone" className="block text-xs font-semibold text-slate-700 mb-1">
                    SĐT Nhà cung cấp
                  </label>
                  <input
                    id="edit-imp-phone"
                    type="tel"
                    value={editImpSupplierPhone}
                    onChange={(e) => setEditImpSupplierPhone(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label htmlFor="edit-imp-prod" className="block text-xs font-semibold text-slate-700 mb-1">
                    Tên vật tư nhập (Khóa theo ID tồn kho)
                  </label>
                  <input
                    id="edit-imp-prod"
                    type="text"
                    readOnly
                    value={editImpProductName}
                    className="w-full px-3 py-2 text-sm bg-slate-100 text-slate-600 border border-slate-200 rounded-lg cursor-not-allowed"
                  />
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Cố định mặt hàng để bảo toàn tồn kho và giá vốn bình quân; nếu sai sản phẩm hãy xóa lập phiếu nhập mới.
                  </p>
                </div>
                <div>
                  <label htmlFor="edit-imp-unit" className="block text-xs font-semibold text-slate-700 mb-1">
                    Đơn vị tính *
                  </label>
                  <input
                    id="edit-imp-unit"
                    type="text"
                    required
                    value={editImpUnit}
                    onChange={(e) => setEditImpUnit(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="edit-imp-qty" className="block text-xs font-semibold text-slate-700 mb-1">
                    Số lượng nhập *
                  </label>
                  <input
                    id="edit-imp-qty"
                    type="number"
                    min={1}
                    required
                    value={editImpQty}
                    onChange={(e) => setEditImpQty(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="edit-imp-cost" className="block text-xs font-semibold text-slate-700 mb-1">
                    Đơn giá nhập (VNĐ) *
                  </label>
                  <input
                    id="edit-imp-cost"
                    type="number"
                    min={0}
                    required
                    value={editImpCost}
                    onChange={(e) => setEditImpCost(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="edit-imp-paid" className="block text-xs font-semibold text-slate-700 mb-1">
                    Đã trả NCC (VNĐ)
                  </label>
                  <input
                    id="edit-imp-paid"
                    type="number"
                    min={0}
                    value={editImpPaid}
                    onChange={(e) => setEditImpPaid(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="edit-imp-debt-days" className="block text-xs font-semibold text-slate-700 mb-1">
                      Chọn ngày nợ NCC (Tự động nhảy ngày)
                    </label>
                    <select
                      id="edit-imp-debt-days"
                      value={matchDebtTermDays(editImpDueDate)}
                      onChange={(e) => {
                        const days = Number(e.target.value);
                        if (days > 0) {
                          setEditImpDueDate(computeDueDateAfterDays(days));
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
                    <label htmlFor="edit-imp-due" className="block text-xs font-semibold text-slate-700 mb-1">
                      Hạn trả nợ NCC
                    </label>
                    <input
                      id="edit-imp-due"
                      type="date"
                      value={editImpDueDate}
                      onChange={(e) => setEditImpDueDate(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {DEBT_TERM_DAY_OPTIONS.map((days) => {
                    const targetDate = computeDueDateAfterDays(days);
                    const isSelected = editImpDueDate === targetDate;
                    return (
                      <button
                        key={days}
                        type="button"
                        onClick={() => setEditImpDueDate(targetDate)}
                        className={`py-1.5 px-1 text-xs font-semibold rounded-lg border transition-colors text-center whitespace-nowrap ${
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
                  <label htmlFor="edit-imp-note" className="block text-xs font-semibold text-slate-700 mb-1">
                    Ghi chú phiếu nhập
                  </label>
                  <input
                    id="edit-imp-note"
                    type="text"
                    value={editImpNote}
                    onChange={(e) => setEditImpNote(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              </div>

              <div className="px-4 sm:px-6 py-3 border-t border-slate-200 bg-slate-50/90 flex flex-wrap items-center justify-between gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const target = editingImport;
                    setEditingImport(null);
                    setCancelingImport(target);
                  }}
                  className="px-3 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Hủy phiếu mua hàng</span>
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingImport(null)}
                    className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
                  >
                    Đóng
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                  >
                    Lưu thay đổi phiếu nhập
                  </button>
                </div>
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

      <BarcodeScannerModal
        isOpen={isBarcodeScannerOpen}
        onClose={() => setIsBarcodeScannerOpen(false)}
        title="Quét Mã Vạch Chọn Vật Tư Nhập Kho"
        onDetected={(scanned) => {
          const norm = scanned.trim().toLowerCase();
          const matched = products.find(
            (p) =>
              (p.barcode && p.barcode.trim().toLowerCase() === norm) ||
              p.code.trim().toLowerCase() === norm
          );
          if (matched) {
            handleSelectProduct(matched.id);
            setFeedback({
              type: 'success',
              text: `Đã chọn nhanh vật tư "${matched.name}" theo mã "${scanned}".`,
            });
          } else {
            setFeedback({
              type: 'error',
              text: `Không tìm thấy vật tư có mã vạch / mã VT "${scanned}".`,
            });
          }
        }}
      />
    </div>
  );
};

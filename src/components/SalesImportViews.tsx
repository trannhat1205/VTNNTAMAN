import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  FileDown,
  FolderPlus,
  Gift,
  Lock,
  PackagePlus,
  Pencil,
  Percent,
  Plus,
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
  CustomerGroup,
  CustomerProfile,
  ImportTransaction,
  PaymentStatus,
  ProductCategory,
  ProductItem,
  SalePromotionType,
  SaleTransaction,
  SupplierProfile,
  UserRole,
} from '../types';
import {
  calculateImportSummary,
  calculateSaleSummary,
  canPerformRoleAction,
  computeCustomerOldDebtSummary,
  computeDueDateAfterDays,
  computeSupplierOldDebtSummary,
  DEBT_TERM_DAY_OPTIONS,
  evaluateDebtUrgency,
  formatVND,
  matchDebtTermDays,
} from '../utils/businessLogic';
import {
  exportImportReceiptPDF,
  exportModuleDataExcel,
  exportSaleInvoicePDF,
} from '../utils/exportReports';
import { ExcelDataBar } from './ExcelDataBar';
import { SearchableSelect } from './SearchableSelect';

interface SalesLogViewProps {
  products: ProductItem[];
  customers: CustomerProfile[];
  sales: SaleTransaction[];
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
  }) => SaleTransaction;
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
    }
  ) => void;
  onDeleteSale: (saleId: string) => void;
  onOpenDebtRecord?: (recordId: string) => void;
}

export const SalesLogView: React.FC<SalesLogViewProps> = ({
  products,
  customers,
  sales,
  role,
  resetKey,
  warehouses,
  onAddWarehouse,
  lockedWarehouse,
  customerGroups,
  onAddCustomerGroup,
  preselectedCustomerId,
  onClearPreselectedCustomer,
  onCreateSale,
  onCreateCustomerInline,
  onCreateProductInline,
  onImportSalesFromExcel,
  onUpdateSale,
  onDeleteSale,
  onOpenDebtRecord,
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
  const [formMessage, setFormMessage] = useState<{
    type: 'error' | 'success';
    text: string;
  } | null>(null);

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
      setSelectedProductId('__new_product__');
      setShowNewProductBox(true);
      return;
    }
    setSelectedProductId(prodId);
    setShowNewProductBox(false);
    const prod = products.find((p) => p.id === prodId);
    if (prod) {
      setUnitPrice(String(prod.sellPrice));
      if (!quantity) setQuantity('1');
      if (!selectedWarehouse && !lockedWarehouse && prod.warehouseName) {
        setSelectedWarehouse(prod.warehouseName);
      }
    } else {
      setUnitPrice('');
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

    const created = onCreateProductInline({
      code: newProdCode.trim() || `VT-0${products.length + 1}`,
      name: newProdName.trim(),
      category: newProdCategory,
      warehouseName:
        lockedWarehouse ||
        (selectedWarehouse && selectedWarehouse !== '__new_warehouse__'
          ? selectedWarehouse
          : warehouses[0] || 'Tâm An Mỹ Ngãi'),
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

  const netPayableTotal = Math.max(0, grossTotal - computedDiscountAmount);
  const paidNum = paymentMode === 'full' ? netPayableTotal : Math.max(0, Number(paidAmount) || 0);
  const summary = calculateSaleSummary(qtyNum, priceNum, paidNum, computedDiscountAmount);

  const selectedGiftProductObj =
    hasGiftActive && selectedGiftProductId && selectedGiftProductId !== '__new_gift__'
      ? products.find((p) => p.id === selectedGiftProductId) || null
      : null;
  const giftQtyNum = hasGiftActive ? Math.max(1, Math.round(Number(giftQuantity) || 1)) : 0;

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
      });

      if (shouldExportPDF) {
        exportSaleInvoicePDF({
          ...createdSale,
          customerAddress: resolvedCustomer.address,
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
    if (lockedWarehouse && sWh !== lockedWarehouse) return false;
    if (!lockedWarehouse && warehouseTableFilter !== 'all' && sWh !== warehouseTableFilter) {
      return false;
    }
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      s.invoiceCode.toLowerCase().includes(q) ||
      s.customerName.toLowerCase().includes(q) ||
      s.productName.toLowerCase().includes(q) ||
      s.customerPhone.toLowerCase().includes(q) ||
      sWh.toLowerCase().includes(q)
    );
  });

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
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newWarehouseName}
                      onChange={(e) => setNewWarehouseName(e.target.value)}
                      placeholder="VD: Tâm An Tháp Mười"
                      className="flex-1 px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
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

              <SearchableSelect
                id="sale-product-select"
                value={selectedProductId === '__new_product__' ? '' : selectedProductId}
                onChange={(val) => handleProductSelectChange(val)}
                placeholder="Gõ tên vật tư (NPK, Anvil, GAP...), mã VT hoặc kho để tìm nhanh..."
                emptyOptionLabel="-- Chưa chọn vật tư --"
                createActionLabel="+ Thêm vật tư nông nghiệp mới trực tiếp tại đây..."
                onCreateAction={(kw) => {
                  setSelectedProductId('__new_product__');
                  setShowNewProductBox(true);
                  if (kw) setNewProdName(kw);
                }}
                options={products.map((p) => ({
                  value: p.id,
                  label: `${p.name} [${p.warehouseName || 'Tâm An Mỹ Ngãi'}] — Tồn: ${p.stock} ${p.unit} (${formatVND(p.sellPrice)})`,
                  subLabel: `Mã: ${p.code} · Nhóm: ${p.category} · NCC: ${p.supplierName}`,
                  badge: formatVND(p.sellPrice),
                  keywords: `${p.name} ${p.code} ${p.category} ${p.warehouseName || ''} ${p.supplierName}`,
                }))}
              />

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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <button
                type="submit"
                className="w-full py-2.5 px-3 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors flex items-center justify-center gap-1.5"
              >
                <Plus className="w-4 h-4 shrink-0" />
                <span>Lưu đơn bán hàng</span>
              </button>
              <button
                type="button"
                onClick={() => submitSale(true)}
                className="w-full py-2.5 px-3 text-xs font-semibold text-slate-900 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors flex items-center justify-center gap-1.5"
              >
                <FileDown className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>Lưu & Xuất Phiếu PDF</span>
              </button>
            </div>
          </form>
        </div>

        {/* Right: Sales Log Table */}
        <div className="xl:col-span-7 bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Nhật Ký Bán Hàng ({filteredSales.length} đơn)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Lưu thông tin kho xuất bán và hỗ trợ Xuất Phiếu PDF gửi khách hàng
              </p>
            </div>

            <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 w-full sm:w-auto">
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

          {/* Mobile Card View (< md): Full-width balanced layout, zero column squishing */}
          <div className="md:hidden divide-y divide-slate-200">
            {filteredSales.length === 0 ? (
              <div className="py-10 px-4 text-center text-xs text-slate-500">
                Không có hóa đơn bán hàng nào khớp với bộ lọc hiện tại.
              </div>
            ) : (
              filteredSales.map((s) => (
                <div key={s.id} className="p-4 space-y-3 hover:bg-slate-50">
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

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => exportSaleInvoicePDF(s)}
                      className="px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md whitespace-nowrap"
                    >
                      Xuất PDF
                    </button>

                    {canPerformRoleAction(role, 'edit_record') ? (
                      <div className="flex items-center gap-1.5">
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
                          onClick={() => onDeleteSale(s.id)}
                          aria-label={`Xóa hóa đơn ${s.invoiceCode}`}
                          className="p-1.5 text-slate-400 hover:text-red-600 rounded-md border border-slate-200"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
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
              ))
            )}
          </div>

          {/* Desktop Balanced Table (>= md) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full min-w-[940px] text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4 w-[145px] whitespace-nowrap">Mã HĐ & Kho xuất</th>
                  <th className="py-3 px-4 min-w-[180px]">Khách hàng</th>
                  <th className="py-3 px-4 min-w-[220px]">Vật tư & SL</th>
                  <th className="py-3 px-4 w-[120px] text-right whitespace-nowrap">Thành tiền</th>
                  <th className="py-3 px-4 w-[160px] text-right whitespace-nowrap">Đã thu / Còn nợ</th>
                  <th className="py-3 px-4 w-[165px] text-right whitespace-nowrap">
                    Phiếu PDF / Sửa & Xóa (Quản lý)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredSales.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
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
                    </td>
                    <td className="py-3 px-4 min-w-[180px] align-middle">
                      <div className="font-semibold text-slate-900 leading-snug">{s.customerName}</div>
                      <div className="text-xs font-mono text-slate-500 mt-0.5">{s.customerPhone}</div>
                    </td>
                    <td className="py-3 px-4 min-w-[220px] align-middle">
                      <div className="text-xs font-medium text-slate-900 leading-snug">{s.productName}</div>
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
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-xs font-bold text-slate-900 whitespace-nowrap align-middle">
                      {formatVND(s.totalAmount)}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap align-middle">
                      <div className="font-mono tabular-nums text-xs text-emerald-700">
                        Thu: {formatVND(s.paidAmount)}
                      </div>
                      {s.debtAmount > 0 ? (
                        <div className="font-mono tabular-nums text-xs font-semibold text-red-600 mt-0.5">
                          Nợ: {formatVND(s.debtAmount)} (Hạn {s.dueDate})
                        </div>
                      ) : (
                        <div className="text-xs text-slate-500 mt-0.5">Đã tất toán</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap align-middle">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => exportSaleInvoicePDF(s)}
                          className="px-2.5 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md whitespace-nowrap"
                        >
                          Xuất PDF
                        </button>
                        {canPerformRoleAction(role, 'edit_record') ? (
                          <>
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
                              onClick={() => onDeleteSale(s.id)}
                              aria-label={`Xóa hóa đơn ${s.invoiceCode}`}
                              className="p-1.5 text-slate-400 hover:text-red-600 rounded-md"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
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
                ))}
              </tbody>
            </table>
          </div>
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
                    Tên vật tư nông nghiệp *
                  </label>
                  <input
                    id="edit-sale-prod"
                    type="text"
                    required
                    value={editSaleProductName}
                    onChange={(e) => setEditSaleProductName(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                  />
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
              </div>

              </div>

              <div className="px-4 sm:px-6 py-3 border-t border-slate-200 bg-slate-50/90 flex items-center justify-end gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setEditingSale(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                >
                  Lưu thay đổi hóa đơn
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

interface ImportLogViewProps {
  products: ProductItem[];
  customers: CustomerProfile[];
  imports: ImportTransaction[];
  suppliers: SupplierProfile[];
  role: UserRole;
  warehouses: string[];
  onAddWarehouse: (warehouseName: string) => void;
  lockedWarehouse: string | null;
  preselectedProductId: string | null;
  onClearPreselectedProduct: () => void;
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
  }) => ImportTransaction;
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
}

export const ImportLogView: React.FC<ImportLogViewProps> = ({
  products,
  customers,
  imports,
  suppliers,
  role,
  warehouses,
  onAddWarehouse,
  lockedWarehouse,
  preselectedProductId,
  onClearPreselectedProduct,
  onCreateImport,
  onCreateProductInline,
  onCreateSupplierInline,
  onImportWarehouseFromExcel,
  onUpdateImport,
  onDeleteImport,
  onOpenDebtRecord,
}) => {
  // Blank-by-default state so fields are empty on open and reset after save/export
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>(lockedWarehouse || '');
  const [showNewWarehouseBox, setShowNewWarehouseBox] = useState<boolean>(false);
  const [newWarehouseName, setNewWarehouseName] = useState<string>('');

  // Manager-only Edit Saved Import Receipt State
  const [editingImport, setEditingImport] = useState<ImportTransaction | null>(null);
  const [editImpCode, setEditImpCode] = useState('');
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
  const [note, setNote] = useState<string>('');
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(
    null
  );

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
    setNote('');
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
    const created = onCreateProductInline({
      code: newProdCode.trim() || `VT-0${products.length + 1}`,
      name: newProdName.trim(),
      category: newProdCategory,
      warehouseName:
        lockedWarehouse ||
        (selectedWarehouse && selectedWarehouse !== '__new_warehouse__'
          ? selectedWarehouse
          : warehouses[0] || 'Tâm An Mỹ Ngãi'),
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
  const summary = calculateImportSummary(qtyNum, costNum, paidNum);
  const supplierOldDebt = computeSupplierOldDebtSummary(
    selectedSupplierName,
    imports,
    summary.debtAmount
  );

  const submitImport = (shouldExportPDF: boolean) => {
    setFeedback(null);

    let resolvedWarehouse = lockedWarehouse || selectedWarehouse;
    if (!lockedWarehouse && (showNewWarehouseBox || selectedWarehouse === '__new_warehouse__')) {
      const createdWh = handleConfirmInlineWarehouseInImport();
      if (!createdWh) return;
      resolvedWarehouse = createdWh;
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
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newWarehouseName}
                      onChange={(e) => setNewWarehouseName(e.target.value)}
                      placeholder="VD: Tâm An Tháp Mười"
                      className="flex-1 px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
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

              <SearchableSelect
                id="import-product-select"
                value={selectedProductId === '__new_product__' ? '' : selectedProductId}
                onChange={(val) => handleSelectProduct(val)}
                placeholder="Gõ tên vật tư, mã VT hoặc kho để tìm nhanh vật tư nhập kho..."
                emptyOptionLabel="-- Chưa chọn vật tư nhập --"
                createActionLabel="+ Thêm vật tư nhập kho mới trực tiếp tại đây..."
                onCreateAction={(kw) => {
                  setSelectedProductId('__new_product__');
                  setShowNewProductBox(true);
                  if (kw) setNewProdName(kw);
                }}
                options={products.map((p) => ({
                  value: p.id,
                  label: `[${p.code}] ${p.name} (${p.warehouseName || 'Tâm An Mỹ Ngãi'} · Tồn: ${p.stock} ${p.unit})`,
                  subLabel: `Giá nhập: ${formatVND(p.importPrice)} · Giá bán: ${formatVND(p.sellPrice)} · NCC: ${p.supplierName}`,
                  badge: `Tồn: ${p.stock} ${p.unit}`,
                  keywords: `${p.code} ${p.name} ${p.category} ${p.warehouseName || ''} ${p.supplierName}`,
                }))}
              />

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
                <span>Lưu phiếu nhập kho</span>
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
        <div className="xl:col-span-7 bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="p-5 border-b border-slate-200">
            <h3 className="text-base font-bold text-slate-900">
              Nhật Ký Nhập Hàng
            </h3>
          </div>

          {/* Mobile Card View (< md): Full-width balanced layout, zero column squishing */}
          <div className="md:hidden divide-y divide-slate-200">
            {imports.length === 0 ? (
              <div className="py-10 px-4 text-center text-xs text-slate-500">
                Chưa có phiếu nhập kho nào trong danh sách.
              </div>
            ) : (
              imports.map((imp) => {
                const { urgency } = evaluateDebtUrgency(imp.dueDate, imp.debtAmount);
                return (
                  <div key={imp.id} className="p-4 space-y-3 hover:bg-slate-50">
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

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => exportImportReceiptPDF(imp)}
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
                            onClick={() => {
                              setEditingImport(imp);
                              setEditImpCode(imp.receiptCode);
                              setEditImpWarehouse(
                                imp.warehouseName || warehouses[0] || 'Tâm An Mỹ Ngãi'
                              );
                              setEditImpSupplierName(imp.supplierName);
                              setEditImpSupplierPhone(imp.supplierPhone);
                              setEditImpProductName(imp.productName);
                              setEditImpUnit(imp.unit);
                              setEditImpQty(String(imp.quantity));
                              setEditImpCost(String(imp.unitCost));
                              setEditImpPaid(String(imp.paidAmount));
                              setEditImpDueDate(imp.dueDate);
                              setEditImpNote(imp.note);
                            }}
                            aria-label={`Sửa phiếu nhập ${imp.receiptCode}`}
                            className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md flex items-center gap-1 whitespace-nowrap"
                          >
                            <Pencil className="w-3 h-3" />
                            <span>Sửa</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteImport(imp.id)}
                            aria-label={`Xóa phiếu nhập ${imp.receiptCode}`}
                            className="p-1.5 text-slate-400 hover:text-red-600 rounded-md border border-slate-200"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full min-w-[940px] text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4 w-[145px] whitespace-nowrap">Mã phiếu & Kho nhập</th>
                  <th className="py-3 px-4 min-w-[185px]">Nhà cung cấp</th>
                  <th className="py-3 px-4 min-w-[220px]">Vật tư nhập</th>
                  <th className="py-3 px-4 w-[125px] text-right whitespace-nowrap">Tổng tiền nhập</th>
                  <th className="py-3 px-4 w-[150px] text-right whitespace-nowrap">Công nợ NCC & Hạn trả</th>
                  <th className="py-3 px-4 w-[165px] text-right whitespace-nowrap">
                    Phiếu PDF / Sửa & Xóa (Quản lý)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {imports.map((imp) => {
                  const { urgency } = evaluateDebtUrgency(imp.dueDate, imp.debtAmount);
                  return (
                    <tr key={imp.id} className="hover:bg-slate-50">
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
                      </td>
                      <td className="py-3 px-4 min-w-[185px] align-middle">
                        <div className="font-semibold text-slate-900 leading-snug">{imp.supplierName}</div>
                        <div className="text-xs font-mono text-slate-500 mt-0.5">{imp.supplierPhone}</div>
                      </td>
                      <td className="py-3 px-4 min-w-[220px] align-middle">
                        <div className="text-xs font-medium text-slate-900 leading-snug">{imp.productName}</div>
                        <div className="text-xs font-mono text-emerald-700 font-semibold mt-0.5">
                          +{imp.quantity} {imp.unit} (Giá nhập: {formatVND(imp.unitCost)})
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-xs font-bold text-slate-900 whitespace-nowrap align-middle">
                        {formatVND(imp.totalCost)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap align-middle">
                        {imp.debtAmount > 0 ? (
                          <div>
                            <div className="font-mono tabular-nums text-xs font-bold text-red-600">
                              Nợ: {formatVND(imp.debtAmount)}
                            </div>
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
                            onClick={() => exportImportReceiptPDF(imp)}
                            className="px-2.5 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md whitespace-nowrap"
                          >
                            Xuất PDF
                          </button>
                          {canPerformRoleAction(role, 'edit_record') ? (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingImport(imp);
                                  setEditImpCode(imp.receiptCode);
                                  setEditImpWarehouse(
                                    imp.warehouseName || warehouses[0] || 'Tâm An Mỹ Ngãi'
                                  );
                                  setEditImpSupplierName(imp.supplierName);
                                  setEditImpSupplierPhone(imp.supplierPhone);
                                  setEditImpProductName(imp.productName);
                                  setEditImpUnit(imp.unit);
                                  setEditImpQty(String(imp.quantity));
                                  setEditImpCost(String(imp.unitCost));
                                  setEditImpPaid(String(imp.paidAmount));
                                  setEditImpDueDate(imp.dueDate);
                                  setEditImpNote(imp.note);
                                }}
                                aria-label={`Sửa phiếu nhập ${imp.receiptCode}`}
                                className="px-2 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md flex items-center gap-1 whitespace-nowrap"
                              >
                                <Pencil className="w-3 h-3" />
                                <span>Sửa</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => onDeleteImport(imp.id)}
                                aria-label={`Xóa phiếu nhập ${imp.receiptCode}`}
                                className="p-1.5 text-slate-400 hover:text-red-600 rounded-md"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
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
                })}
              </tbody>
            </table>
          </div>
        </div>
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
                    Tên vật tư nhập *
                  </label>
                  <input
                    id="edit-imp-prod"
                    type="text"
                    required
                    value={editImpProductName}
                    onChange={(e) => setEditImpProductName(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                  />
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

              <div className="px-4 sm:px-6 py-3 border-t border-slate-200 bg-slate-50/90 flex items-center justify-end gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setEditingImport(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                >
                  Lưu thay đổi phiếu nhập
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

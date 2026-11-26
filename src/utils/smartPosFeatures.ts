import {
  ProductItem,
  SalePromotionType,
  SaleTransaction,
  VietQrBankConfig,
} from '../types';
import { calculateSaleSummary, formatVND } from './businessLogic';

export interface VietnamBankOption {
  code: string;
  bin: string;
  shortName: string;
  name: string;
}

export const VIETNAM_BANKS: VietnamBankOption[] = [
  { code: 'AGRIBANK', bin: '970405', shortName: 'Agribank', name: 'Agribank - NN&PTNT Việt Nam' },
  { code: 'VCB', bin: '970436', shortName: 'Vietcombank', name: 'Vietcombank - Ngoại thương VN' },
  { code: 'BIDV', bin: '970418', shortName: 'BIDV', name: 'BIDV - Đầu tư & Phát triển VN' },
  { code: 'ICB', bin: '970415', shortName: 'VietinBank', name: 'VietinBank - Công thương VN' },
  { code: 'MB', bin: '970422', shortName: 'MB Bank', name: 'MB Bank - Quân đội' },
  { code: 'TCB', bin: '970407', shortName: 'Techcombank', name: 'Techcombank - Kỹ thương VN' },
  { code: 'ACB', bin: '970416', shortName: 'ACB', name: 'ACB - Á Châu' },
  { code: 'VPB', bin: '970432', shortName: 'VPBank', name: 'VPBank - Việt Nam Thịnh Vượng' },
  { code: 'STB', bin: '970403', shortName: 'Sacombank', name: 'Sacombank - Sài Gòn Thương Tín' },
  { code: 'TPB', bin: '970423', shortName: 'TPBank', name: 'TPBank - Tiên Phong' },
  { code: 'VIB', bin: '970441', shortName: 'VIB', name: 'VIB - Quốc tế' },
  { code: 'HDB', bin: '970437', shortName: 'HDBank', name: 'HDBank - Phát triển TP.HCM' },
  { code: 'SHB', bin: '970443', shortName: 'SHB', name: 'SHB - Sài Gòn Hà Nội' },
  { code: 'OCB', bin: '970448', shortName: 'OCB', name: 'OCB - Phương Đông' },
  { code: 'MSB', bin: '970426', shortName: 'MSB', name: 'MSB - Hàng Hải' },
  { code: 'LPB', bin: '970449', shortName: 'LPBank', name: 'LPBank - Lộc Phát VN' },
  { code: 'SEAB', bin: '970440', shortName: 'SeABank', name: 'SeABank - Đông Nam Á' },
  { code: 'EIB', bin: '970431', shortName: 'Eximbank', name: 'Eximbank - Xuất Nhập Khẩu' },
  { code: 'NAB', bin: '970428', shortName: 'Nam A Bank', name: 'Nam A Bank - Nam Á' },
  { code: 'CAKE', bin: '546034', shortName: 'CAKE by VPBank', name: 'Ngân hàng số CAKE' },
];

export const DOSAGE_GUIDE_PRESETS: string[] = [
  'Pha 25-30ml / bình 25 lít nước, phun đều tán lá lúc sáng sớm hoặc chiều mát.',
  'Pha 1 gói / bình 25 lít nước (2 bình / công 1.000m²), phun ướt đều thân lá.',
  'Pha 1 chai 480ml cho 2 phuy 200 lít nước (hoặc 16-20 bình 25 lít).',
  'Rải gốc 15-25 kg / công (1.000m²), tưới đủ ẩm sau khi bón.',
  'Pha 50ml / bình 25 lít, phun phòng định kỳ 7-10 ngày/lần. Cách ly 7 ngày trước thu hoạch.',
  'Không pha chung với thuốc có tính kiềm mạnh. Đeo đồ bảo hộ khi phun.',
];

export interface PosCartDraftItem {
  id: string;
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  promotionType?: SalePromotionType;
  discountAmount?: number;
  discountPercent?: number;
  giftProductId?: string;
  giftProductName?: string;
  giftUnit?: string;
  giftQuantity?: number;
  dosageGuide?: string;
  note?: string;
}

export interface AllocatedPosCartItem extends PosCartDraftItem {
  grossAmount: number;
  discountAmount: number;
  totalAmount: number;
  paidAmount: number;
  debtAmount: number;
  status: 'paid' | 'partial' | 'unpaid';
}

export interface PosCartAllocationSummary {
  items: AllocatedPosCartItem[];
  grossTotal: number;
  totalDiscount: number;
  netTotal: number;
  totalPaid: number;
  totalDebt: number;
  status: 'paid' | 'partial' | 'unpaid';
}

/**
 * Allocates a single combined payment amount cleanly across multiple POS cart items
 * so that sum(item.paidAmount) === totalPaid and sum(item.debtAmount) === totalDebt
 * with zero rounding drift.
 */
export function allocatePaymentAcrossCartItems(
  items: PosCartDraftItem[],
  totalPaidInput: number
): PosCartAllocationSummary {
  const sanitizedItems = items
    .filter((item) => item.productId && (Number(item.quantity) || 0) > 0)
    .map((item) => {
      const qty = Math.max(0, Number(item.quantity) || 0);
      const price = Math.max(0, Number(item.unitPrice) || 0);
      const grossAmount = Math.round(qty * price);
      const discountAmount = Math.min(
        grossAmount,
        Math.max(0, Math.round(Number(item.discountAmount) || 0))
      );
      const totalAmount = Math.max(0, grossAmount - discountAmount);
      return {
        ...item,
        quantity: qty,
        unitPrice: price,
        grossAmount,
        discountAmount,
        totalAmount,
      };
    });

  const grossTotal = sanitizedItems.reduce((sum, item) => sum + item.grossAmount, 0);
  const totalDiscount = sanitizedItems.reduce((sum, item) => sum + item.discountAmount, 0);
  const netTotal = sanitizedItems.reduce((sum, item) => sum + item.totalAmount, 0);
  const clampedTotalPaid = Math.min(
    netTotal,
    Math.max(0, Math.round(Number(totalPaidInput) || 0))
  );

  let remainingPaid = clampedTotalPaid;
  const allocated: AllocatedPosCartItem[] = sanitizedItems.map((item) => {
    const paidForLine = Math.min(item.totalAmount, remainingPaid);
    remainingPaid = Math.max(0, remainingPaid - paidForLine);
    const lineSummary = calculateSaleSummary(
      item.quantity,
      item.unitPrice,
      paidForLine,
      item.discountAmount
    );
    return {
      ...item,
      paidAmount: lineSummary.paidAmount,
      debtAmount: lineSummary.debtAmount,
      status: lineSummary.status,
    };
  });

  const totalDebt = Math.max(0, netTotal - clampedTotalPaid);
  const status: 'paid' | 'partial' | 'unpaid' =
    totalDebt === 0 ? 'paid' : clampedTotalPaid > 0 ? 'partial' : 'unpaid';

  return {
    items: allocated,
    grossTotal,
    totalDiscount,
    netTotal,
    totalPaid: clampedTotalPaid,
    totalDebt,
    status,
  };
}

export interface CartInventoryValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates combined stock requirements across all cart lines (both main products and promotional gifts)
 * so duplicate products or gifts sharing the same SKU never oversell stock.
 */
export function validateCartInventory(
  products: ProductItem[],
  cartItems: PosCartDraftItem[]
): CartInventoryValidationResult {
  if (!cartItems || cartItems.length === 0) {
    return { valid: false, error: 'Giỏ hàng chưa có vật tư nào.' };
  }

  const requiredByProductId = new Map<string, number>();
  for (const item of cartItems) {
    const qty = Number(item.quantity) || 0;
    if (!item.productId || qty <= 0) {
      return {
        valid: false,
        error: `Số lượng của "${item.productName || 'vật tư'}" phải lớn hơn 0.`,
      };
    }
    requiredByProductId.set(item.productId, (requiredByProductId.get(item.productId) || 0) + qty);

    const giftQty = Number(item.giftQuantity) || 0;
    if (item.giftProductId && giftQty > 0) {
      requiredByProductId.set(
        item.giftProductId,
        (requiredByProductId.get(item.giftProductId) || 0) + giftQty
      );
    }
  }

  for (const [productId, requiredQty] of requiredByProductId.entries()) {
    const prod = products.find((p) => p.id === productId);
    if (!prod) {
      return { valid: false, error: 'Không tìm thấy vật tư trong kho hàng hiện tại.' };
    }
    if (requiredQty > prod.stock) {
      return {
        valid: false,
        error: `Tồn kho "${prod.name}" chỉ còn ${prod.stock} ${prod.unit}, không đủ xuất tổng cộng ${requiredQty} ${prod.unit} trong giỏ hàng!`,
      };
    }
  }

  return { valid: true };
}

/**
 * Strips Vietnamese diacritics and unsafe characters for banking transfer descriptions & VietQR `addInfo`.
 */
export function sanitizeVietQrText(text: string, maxLength = 50): string {
  const cleaned = String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9\s\-_./]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, maxLength).trim();
}

export function isValidVietQrConfig(
  config: VietQrBankConfig | null | undefined
): config is VietQrBankConfig {
  if (!config) return false;
  const bankCode = String(config.bankCode || '').trim();
  const accNum = String(config.accountNumber || '').replace(/\s+/g, '');
  return bankCode.length >= 2 && accNum.length >= 4;
}

export function resolveVietnamBankLabel(bankCodeOrBin: string): string {
  const normalized = String(bankCodeOrBin || '').trim().toUpperCase();
  const matched = VIETNAM_BANKS.find(
    (b) => b.code.toUpperCase() === normalized || b.bin === normalized
  );
  return matched ? matched.shortName : bankCodeOrBin || 'Ngân hàng';
}

export function buildVietQrImageUrl(
  config: VietQrBankConfig,
  params: {
    amount: number;
    addInfo: string;
  }
): string {
  const bankId = encodeURIComponent(String(config.bankBin || config.bankCode || '').trim());
  const accountNo = encodeURIComponent(
    String(config.accountNumber || '').replace(/[^a-zA-Z0-9]/g, '')
  );
  const template = config.template || 'compact2';
  const safeAmount = Math.max(0, Math.round(Number(params.amount) || 0));
  const safeAddInfo = sanitizeVietQrText(params.addInfo, 50);
  const safeAccountName = sanitizeVietQrText(config.accountName || '', 50).toUpperCase();

  const query = new URLSearchParams();
  if (safeAmount > 0) {
    query.set('amount', String(safeAmount));
  }
  if (safeAddInfo) {
    query.set('addInfo', safeAddInfo);
  }
  if (safeAccountName) {
    query.set('accountName', safeAccountName);
  }
  const qs = query.toString();
  return `https://img.vietqr.io/image/${bankId}-${accountNo}-${template}.png${qs ? `?${qs}` : ''}`;
}

export function buildZaloInvoiceAndDosageMessage(params: {
  storeName: string;
  invoiceCode: string;
  customerName: string;
  customerPhone?: string;
  dateStr?: string;
  items: Array<{
    productName: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    totalAmount: number;
    discountAmount?: number;
    giftProductName?: string;
    giftQuantity?: number;
    giftUnit?: string;
    dosageGuide?: string;
  }>;
  totalAmount: number;
  paidAmount: number;
  debtAmount: number;
  dueDate?: string;
  bankConfig?: VietQrBankConfig | null;
}): { message: string; zaloUrl: string | null } {
  const lines: string[] = [
    `HÓA ĐƠN & HƯỚNG DẪN SỬ DỤNG - ${params.storeName.toUpperCase()}`,
    `Mã HĐ: ${params.invoiceCode}${params.dateStr ? ` · Ngày: ${params.dateStr.slice(0, 10)}` : ''}`,
    `Khách hàng: ${params.customerName}`,
    '',
    '1. CHI TIẾT VẬT TƯ:',
  ];

  params.items.forEach((item, idx) => {
    lines.push(
      `${idx + 1}. ${item.productName}: ${item.quantity} ${item.unit} x ${formatVND(item.unitPrice)} = ${formatVND(item.totalAmount)}`
    );
    if ((item.discountAmount || 0) > 0) {
      lines.push(`   - Giảm giá KM: -${formatVND(item.discountAmount || 0)}`);
    }
    if (item.giftProductName && (item.giftQuantity || 0) > 0) {
      lines.push(`   - Quà tặng KM: ${item.giftQuantity} ${item.giftUnit || ''} ${item.giftProductName}`);
    }
  });

  lines.push('');
  lines.push(`Tổng thanh toán: ${formatVND(params.totalAmount)}`);
  lines.push(`Đã thanh toán: ${formatVND(params.paidAmount)}`);
  if (params.debtAmount > 0) {
    lines.push(
      `Còn ghi nợ: ${formatVND(params.debtAmount)}${params.dueDate ? ` (Hạn: ${params.dueDate})` : ''}`
    );
  } else {
    lines.push('Trạng thái: Đã thanh toán đủ.');
  }

  const dosageLines = params.items.filter((i) => (i.dosageGuide || '').trim().length > 0);
  if (dosageLines.length > 0) {
    lines.push('');
    lines.push('2. HƯỚNG DẪN LIỀU LƯỢNG & CÁCH PHA PHUN:');
    dosageLines.forEach((item) => {
      lines.push(`• ${item.productName}: ${(item.dosageGuide || '').trim()}`);
    });
  }

  if (isValidVietQrConfig(params.bankConfig)) {
    const payable = params.debtAmount > 0 ? params.debtAmount : params.totalAmount;
    const bankLabel = resolveVietnamBankLabel(params.bankConfig.bankCode);
    const transferContent = sanitizeVietQrText(
      `TT ${params.invoiceCode} ${params.customerName}`,
      48
    );
    lines.push('');
    lines.push('3. THÔNG TIN CHUYỂN KHOẢN VIETQR:');
    lines.push(`• Ngân hàng: ${bankLabel}`);
    lines.push(`• Số TK: ${params.bankConfig.accountNumber}`);
    if (params.bankConfig.accountName) {
      lines.push(`• Chủ TK: ${params.bankConfig.accountName.toUpperCase()}`);
    }
    if (payable > 0) {
      lines.push(`• Số tiền: ${formatVND(payable)}`);
    }
    lines.push(`• Nội dung CK: ${transferContent}`);
  }

  lines.push('');
  lines.push('Cảm ơn Quý bà con đã tin tưởng VTNN Tâm An!');

  const digits = String(params.customerPhone || '').replace(/\D/g, '');
  const normalizedPhone = digits.startsWith('84')
    ? `0${digits.slice(2)}`
    : digits.length >= 9
    ? digits
    : '';
  const zaloUrl = normalizedPhone ? `https://zalo.me/${normalizedPhone}` : null;
  return { message: lines.join('\n'), zaloUrl };
}

/**
 * Groups sales sharing the same `invoiceCode` (for multi-item POS orders).
 */
export function findInvoiceGroupSales(
  allSales: SaleTransaction[],
  targetSale: SaleTransaction
): SaleTransaction[] {
  const matched = allSales.filter((s) => {
    if (targetSale.invoiceGroupId && s.invoiceGroupId) {
      return s.invoiceGroupId === targetSale.invoiceGroupId;
    }
    return s.invoiceCode === targetSale.invoiceCode;
  });
  return matched.length > 0 ? matched : [targetSale];
}

// --- OFFLINE QUEUE PERSISTENCE (Priority 4) ---

export const OFFLINE_QUEUE_STORAGE_KEY = 'vtnn_taman_offline_queue_v1';

export interface OfflineQueueItem {
  id: string;
  actionType:
    | 'sale'
    | 'multi_sale'
    | 'import'
    | 'debt_collect'
    | 'debt_pay'
    | 'voucher'
    | 'inventory'
    | 'customer'
    | 'settings';
  label: string;
  warehouseName?: string;
  createdAt: string;
}

export function loadOfflineQueue(storage?: Pick<Storage, 'getItem'>): OfflineQueueItem[] {
  try {
    const store = storage || (typeof window !== 'undefined' ? window.localStorage : undefined);
    if (!store) return [];
    const raw = store.getItem(OFFLINE_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is OfflineQueueItem =>
        Boolean(item) && typeof item === 'object' && typeof item.id === 'string'
    );
  } catch {
    return [];
  }
}

export function saveOfflineQueue(
  items: OfflineQueueItem[],
  storage?: Pick<Storage, 'setItem'>
): void {
  try {
    const store = storage || (typeof window !== 'undefined' ? window.localStorage : undefined);
    if (!store) return;
    store.setItem(OFFLINE_QUEUE_STORAGE_KEY, JSON.stringify(items.slice(0, 200)));
  } catch {
    // Ignore storage quota errors
  }
}

export function enqueueOfflineQueueItem(
  current: OfflineQueueItem[],
  entry: Omit<OfflineQueueItem, 'id' | 'createdAt'>,
  storage?: Pick<Storage, 'setItem'>
): OfflineQueueItem[] {
  const nextItem: OfflineQueueItem = {
    id: `offq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ...entry,
    createdAt: new Date().toISOString(),
  };
  const next = [nextItem, ...current].slice(0, 200);
  saveOfflineQueue(next, storage);
  return next;
}

export function clearOfflineQueueStorage(storage?: Pick<Storage, 'removeItem'>): void {
  try {
    const store = storage || (typeof window !== 'undefined' ? window.localStorage : undefined);
    if (!store) return;
    store.removeItem(OFFLINE_QUEUE_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

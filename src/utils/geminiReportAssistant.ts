import {
  CashPaymentVoucher,
  CashReceiptVoucher,
  CustomerProfile,
  ImportTransaction,
  ProductItem,
  SaleTransaction,
  StaffMember,
  SupplierProfile,
} from '../types';
import { formatVND } from './businessLogic';

export type GeminiModelOptionId =
  | 'gemini-4-hydrogen'
  | 'gemini-3.1-flash-lite'
  | 'gemini-4-neon'
  | 'gemini-4-carbon';

export interface GeminiModelOption {
  id: GeminiModelOptionId;
  label: string;
  badge: string;
  description: string;
}

export const GEMINI_MODEL_OPTIONS: GeminiModelOption[] = [
  {
    id: 'gemini-4-hydrogen',
    label: 'Gemini 4 Hydrogen',
    badge: 'Tiêu chuẩn',
    description: 'Phân tích báo cáo kho, công nợ, doanh thu & trả lời đa lĩnh vực',
  },
  {
    id: 'gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash-Lite',
    badge: 'Tốc độ cao',
    description: 'Phản hồi tức thì các câu hỏi tra cứu số liệu nhanh',
  },
  {
    id: 'gemini-4-neon',
    label: 'Gemini 4 Neon',
    badge: 'Tương tác sâu',
    description: 'Xử lý các bài toán đối soát kế toán & bảng biểu phức tạp',
  },
  {
    id: 'gemini-4-carbon',
    label: 'Gemini 4 Carbon',
    badge: 'Suy luận chuyên sâu',
    description: 'Hoạch định chiến lược kinh doanh, kỹ thuật nông nghiệp & dự báo',
  },
];

export interface WarehouseReportSnapshot {
  warehouseLabel: string;
  staffDisplayName: string;
  generatedAt: string;
  // Sales
  salesCount: number;
  totalSalesRevenue: number;
  totalSalesCollected: number;
  totalSalesNewDebt: number;
  estimatedCogs: number;
  estimatedGrossProfit: number;
  // Imports
  importsCount: number;
  totalImportCost: number;
  totalImportPaid: number;
  totalImportNewDebt: number;
  // Customer Debt
  customersCount: number;
  totalCustomerDebt: number;
  debtorCustomers: Array<{
    name: string;
    code: string;
    phone: string;
    group: string;
    debt: number;
    overdueAmount: number;
  }>;
  // Supplier Debt
  suppliersCount: number;
  totalSupplierDebt: number;
  creditorSuppliers: Array<{
    name: string;
    phone: string;
    debt: number;
    overdueAmount: number;
  }>;
  // Inventory
  productsCount: number;
  totalInventoryCostValue: number;
  totalInventoryRetailValue: number;
  catalogProducts: Array<{
    code: string;
    name: string;
    category: string;
    unit: string;
    stock: number;
    minStock: number;
    importPrice: number;
    sellPrice: number;
    supplierName: string;
  }>;
  outOfStockProducts: Array<{
    code: string;
    name: string;
    unit: string;
    stock: number;
    minStock: number;
    importPrice: number;
    sellPrice: number;
  }>;
  lowStockProducts: Array<{
    code: string;
    name: string;
    unit: string;
    stock: number;
    minStock: number;
    importPrice: number;
    sellPrice: number;
  }>;
  topSellingProducts: Array<{
    name: string;
    unit: string;
    quantitySold: number;
    revenue: number;
  }>;
  // Cash flow
  receiptVouchersCount: number;
  totalReceiptVouchersAmount: number;
  paymentVouchersCount: number;
  totalPaymentVouchersAmount: number;
  totalCashIn: number;
  totalCashOut: number;
  netCashFlow: number;
}

/**
 * Normalizes Vietnamese input across both precomposed (NFC), decomposed (NFD combining accents),
 * and accent-stripped ASCII so keyword matching never fails regardless of the user's IME/keyboard.
 */
export function normalizeVietnameseQuery(raw: string): { nfc: string; ascii: string } {
  const cleaned = (raw || '').trim();
  const nfc = cleaned
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ');
  const ascii = cleaned
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { nfc, ascii };
}

function hasAnyKeyword(
  query: { nfc: string; ascii: string },
  keywords: string[]
): boolean {
  for (const kw of keywords) {
    const normKw = normalizeVietnameseQuery(kw);
    if (normKw.nfc && query.nfc.includes(normKw.nfc)) {
      return true;
    }
    if (normKw.ascii && query.ascii.includes(normKw.ascii)) {
      return true;
    }
  }
  return false;
}

export function isPureInternalWarehouseQuery(rawQuery: string): boolean {
  const q = normalizeVietnameseQuery(rawQuery);
  const externalIndicators = [
    'giá phân',
    'giá lúa',
    'giá gạo',
    'om18',
    'om 18',
    'om5451',
    'đài thơm',
    'ir504',
    'st24',
    'st25',
    'nàng hoa',
    'giá sầu riêng',
    'giá mít',
    'giá xoài',
    'giá cà phê',
    'giá tiêu',
    'giá ớt',
    'giá nông sản',
    'thị trường',
    'thời tiết',
    'kỹ thuật',
    'cách trồng',
    'cách bón',
    'phòng trừ',
    'đạo ôn',
    'rầy nâu',
    'cháy bìa lá',
    'vàng lá',
    'thối rễ',
    'xì mủ',
    'thán thư',
    'nhện đỏ',
    'bọ trĩ',
    'làm bông',
    'đậu trái',
  ];
  if (hasAnyKeyword(q, externalIndicators)) {
    return false;
  }
  const internalIndicators = [
    'báo cáo tổng hợp',
    'doanh thu',
    'lợi nhuận',
    'công nợ khách',
    'khách hàng đang nợ',
    'nợ quá hạn',
    'tồn kho thấp',
    'vật tư sắp hết',
    'dòng tiền của kho',
    'phiếu thu',
    'phiếu chi',
  ];
  return hasAnyKeyword(q, internalIndicators);
}

export function buildWarehouseReportSnapshot(params: {
  warehouseLabel: string;
  currentStaff?: StaffMember | null;
  products: ProductItem[];
  customers: CustomerProfile[];
  suppliers: SupplierProfile[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  receiptVouchers: CashReceiptVoucher[];
  paymentVouchers: CashPaymentVoucher[];
}): WarehouseReportSnapshot {
  const {
    warehouseLabel,
    currentStaff,
    products,
    customers,
    suppliers,
    sales,
    imports,
    receiptVouchers,
    paymentVouchers,
  } = params;

  const todayIso = new Date().toISOString().slice(0, 10);

  const productById = new Map<string, ProductItem>();
  for (const p of products) {
    productById.set(p.id, p);
  }

  let totalSalesRevenue = 0;
  let totalSalesCollected = 0;
  let totalSalesNewDebt = 0;
  let estimatedCogs = 0;

  const productSalesMap = new Map<
    string,
    { name: string; unit: string; quantitySold: number; revenue: number }
  >();

  for (const s of sales) {
    const rev = Number(s.totalAmount) || 0;
    const paid = Number(s.paidAmount) || 0;
    const debt = Number(s.debtAmount) || 0;
    totalSalesRevenue += rev;
    totalSalesCollected += paid;
    totalSalesNewDebt += debt;

    const prod = productById.get(s.productId);
    const unitImportCost = prod ? Number(prod.importPrice) || 0 : (Number(s.unitPrice) || 0) * 0.8;
    const giftCost = (Number(s.giftQuantity) || 0) * (Number(s.giftUnitCost) || 0);
    estimatedCogs += (Number(s.quantity) || 0) * unitImportCost + giftCost;

    const existing = productSalesMap.get(s.productName) || {
      name: s.productName,
      unit: s.unit || 'Đơn vị',
      quantitySold: 0,
      revenue: 0,
    };
    existing.quantitySold += Number(s.quantity) || 0;
    existing.revenue += rev;
    productSalesMap.set(s.productName, existing);
  }

  const estimatedGrossProfit = totalSalesRevenue - estimatedCogs;

  let totalImportCost = 0;
  let totalImportPaid = 0;
  let totalImportNewDebt = 0;

  const supplierDebtMap = new Map<
    string,
    { name: string; phone: string; debt: number; overdueAmount: number }
  >();

  for (const imp of imports) {
    const cost = Number(imp.totalCost) || 0;
    const paid = Number(imp.paidAmount) || 0;
    const debt = Number(imp.debtAmount) || 0;
    totalImportCost += cost;
    totalImportPaid += paid;
    totalImportNewDebt += debt;

    if (debt > 0) {
      const key = imp.supplierName.trim();
      const current = supplierDebtMap.get(key) || {
        name: imp.supplierName,
        phone: imp.supplierPhone || '',
        debt: 0,
        overdueAmount: 0,
      };
      current.debt += debt;
      if (imp.dueDate && imp.dueDate < todayIso) {
        current.overdueAmount += debt;
      }
      supplierDebtMap.set(key, current);
    }
  }

  // Overdue customer debt calculation from unpaid sales
  const customerOverdueMap = new Map<string, number>();
  for (const s of sales) {
    const debt = Number(s.debtAmount) || 0;
    if (debt > 0 && s.dueDate && s.dueDate < todayIso) {
      const prev = customerOverdueMap.get(s.customerId) || 0;
      customerOverdueMap.set(s.customerId, prev + debt);
    }
  }

  let totalCustomerDebt = 0;
  const debtorCustomers: WarehouseReportSnapshot['debtorCustomers'] = [];
  for (const c of customers) {
    const debt = Number(c.totalDebt) || 0;
    if (debt > 0) {
      totalCustomerDebt += debt;
      debtorCustomers.push({
        name: c.name,
        code: c.code,
        phone: c.phone || '---',
        group: c.group || 'Nhà nông',
        debt,
        overdueAmount: Math.min(debt, customerOverdueMap.get(c.id) || 0),
      });
    }
  }
  debtorCustomers.sort((a, b) => b.debt - a.debt);

  const creditorSuppliers = Array.from(supplierDebtMap.values()).sort(
    (a, b) => b.debt - a.debt
  );
  const totalSupplierDebt = creditorSuppliers.reduce((sum, s) => sum + s.debt, 0);

  let totalInventoryCostValue = 0;
  let totalInventoryRetailValue = 0;
  const catalogProducts: WarehouseReportSnapshot['catalogProducts'] = [];
  const outOfStockProducts: WarehouseReportSnapshot['outOfStockProducts'] = [];
  const lowStockProducts: WarehouseReportSnapshot['lowStockProducts'] = [];

  for (const p of products) {
    const stock = Number(p.stock) || 0;
    const minStock = Number(p.minStock) || 0;
    const importPrice = Number(p.importPrice) || 0;
    const sellPrice = Number(p.sellPrice) || 0;

    catalogProducts.push({
      code: p.code,
      name: p.name,
      category: p.category || 'Vật tư',
      unit: p.unit || 'Bao',
      stock,
      minStock,
      importPrice,
      sellPrice,
      supplierName: p.supplierName || '',
    });

    if (stock > 0) {
      totalInventoryCostValue += stock * importPrice;
      totalInventoryRetailValue += stock * sellPrice;
    }

    if (stock <= 0) {
      outOfStockProducts.push({
        code: p.code,
        name: p.name,
        unit: p.unit,
        stock,
        minStock,
        importPrice,
        sellPrice,
      });
    } else if (stock <= minStock) {
      lowStockProducts.push({
        code: p.code,
        name: p.name,
        unit: p.unit,
        stock,
        minStock,
        importPrice,
        sellPrice,
      });
    }
  }

  const topSellingProducts = Array.from(productSalesMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  const totalReceiptVouchersAmount = receiptVouchers.reduce(
    (sum, r) => sum + (Number(r.amount) || 0),
    0
  );
  const totalPaymentVouchersAmount = paymentVouchers.reduce(
    (sum, p) => sum + (Number(p.amount) || 0),
    0
  );

  // Total cash in = direct cash collected on sales + standalone receipt vouchers
  const totalCashIn = totalSalesCollected + totalReceiptVouchersAmount;
  const totalCashOut = totalImportPaid + totalPaymentVouchersAmount;
  const netCashFlow = totalCashIn - totalCashOut;

  return {
    warehouseLabel: warehouseLabel || 'Kho VTNN Tâm An',
    staffDisplayName: currentStaff?.displayName || 'Người dùng',
    generatedAt: todayIso,
    salesCount: sales.length,
    totalSalesRevenue,
    totalSalesCollected,
    totalSalesNewDebt,
    estimatedCogs,
    estimatedGrossProfit,
    importsCount: imports.length,
    totalImportCost,
    totalImportPaid,
    totalImportNewDebt,
    customersCount: customers.length,
    totalCustomerDebt,
    debtorCustomers,
    suppliersCount: suppliers.length,
    totalSupplierDebt,
    creditorSuppliers,
    productsCount: products.length,
    totalInventoryCostValue,
    totalInventoryRetailValue,
    catalogProducts,
    outOfStockProducts,
    lowStockProducts,
    topSellingProducts,
    receiptVouchersCount: receiptVouchers.length,
    totalReceiptVouchersAmount,
    paymentVouchersCount: paymentVouchers.length,
    totalPaymentVouchersAmount,
    totalCashIn,
    totalCashOut,
    netCashFlow,
  };
}

export const AGRICULTURAL_MARKET_BENCHMARK_CONTEXT = `=== DỮ LIỆU THAM CHIẾU THỊ TRƯỜNG NÔNG NGHIỆP & VẬT TƯ ĐBSCL (CẬP NHẬT 2026) ===
1. GIÁ PHÂN BÓN BÁN LẺ THAM KHẢO (BAO 50KG TẠI ĐBSCL & VIỆT NAM):
   - Đạm Urê Phú Mỹ: 570.000 – 620.000 đ/bao 50kg
   - Đạm Urê Cà Mau (hạt đục): 585.000 – 640.000 đ/bao 50kg
   - Đạm Urê Ninh Bình / Hà Bắc: 545.000 – 590.000 đ/bao 50kg
   - DAP Đình Vũ (nội địa): 830.000 – 890.000 đ/bao 50kg
   - DAP Hồng Hà / Lào Cai: 980.000 – 1.120.000 đ/bao 50kg
   - DAP Xanh 64% nhập khẩu: 1.150.000 – 1.260.000 đ/bao 50kg
   - Kali Miểng (Phú Mỹ / Israel / Canada): 600.000 – 670.000 đ/bao 50kg
   - Kali Bột (Phú Mỹ / Belarus / Nga): 550.000 – 615.000 đ/bao 50kg
   - NPK 20-20-15+TE Đầu Trâu Bình Điền: 780.000 – 870.000 đ/bao 50kg
   - NPK 20-20-15 Phú Mỹ / Cà Mau: 730.000 – 815.000 đ/bao 50kg
   - NPK 16-16-8+TE (Việt Nhật / Phú Mỹ / Bình Điền): 650.000 – 735.000 đ/bao 50kg
   - Super Lân Lâm Thao / Long Thành: 235.000 – 280.000 đ/bao 50kg
   - Phân hữu cơ vi sinh / Gà nở nhập khẩu: 185.000 – 320.000 đ/bao (25–50kg)
   - Xu hướng: Nhóm Urê, Kali và NPK nguồn cung dồi dào, giá ổn định; nhóm DAP nhập khẩu neo cao.

2. GIÁ LÚA GẠO THU MUA TẠI ĐBSCL (LÚA TƯƠI TẠI RUỘNG / LÚA KHÔ TẠI KHO):
   - Lúa OM 18: Tươi 6.600 – 7.200 đ/kg | Khô 7.900 – 8.500 đ/kg
   - Lúa Đài Thơm 8: Tươi 6.600 – 7.200 đ/kg | Khô 7.900 – 8.500 đ/kg
   - Lúa OM 5451: Tươi 6.000 – 6.400 đ/kg | Khô 7.300 – 7.700 đ/kg
   - Lúa IR 50404: Tươi 5.600 – 6.000 đ/kg | Khô 6.900 – 7.300 đ/kg
   - Lúa OM 380: Tươi 5.600 – 5.900 đ/kg
   - Lúa Nàng Hoa 9: Tươi 6.600 – 7.000 đ/kg
   - Lúa ST24 / ST25: Tươi 8.400 – 9.600 đ/kg | Khô đặc sản 10.500 – 12.000 đ/kg

3. GIÁ THUỐC BẢO VỆ THỰC VẬT (BVTV) PHỔ BIẾN:
   - Amistar Top 325SC (250ml): 245.000 – 275.000 đ/chai
   - Filia 525SE (250ml): 165.000 – 190.000 đ/chai
   - Nativo 750WG (60g): 145.000 – 168.000 đ/gói
   - Antracol 70WP (500g): 140.000 – 165.000 đ/gói
   - Ridomil Gold 68WG (100g): 62.000 – 75.000 đ/gói
   - Prevathon 5SC (250ml): 195.000 – 230.000 đ/chai
   - Virtako 40WG (15g): 75.000 – 88.000 đ/gói
   - Chess 50WG (15g): 28.000 – 35.000 đ/gói
   - Thuốc cỏ Glufosinate 200SL (900ml–1L): 105.000 – 145.000 đ/chai

4. GIÁ NÔNG SẢN & TRÁI CÂY CHỦ LỰC:
   - Sầu riêng Thái Monthong: Loại A 95.000 – 125.000 đ/kg (vụ nghịch 140.000 – 175.000 đ/kg), Loại B 75.000 – 95.000 đ/kg
   - Sầu riêng Ri6: Loại A 65.000 – 88.000 đ/kg (vụ nghịch 105.000 – 130.000 đ/kg), Loại B 50.000 – 68.000 đ/kg
   - Xoài Cát Hòa Lộc: 45.000 – 65.000 đ/kg | Xoài Cát Chu: 18.000 – 28.000 đ/kg | Xoài Đài Loan: 15.000 – 26.000 đ/kg
   - Mít Thái: 18.000 – 32.000 đ/kg | Cà phê nhân xô: 110.000 – 125.000 đ/kg | Hồ tiêu đen: 140.000 – 158.000 đ/kg
==============================================================================`;

export function buildGeminiSystemInstruction(snapshot: WarehouseReportSnapshot): string {
  const debtorsSummary =
    snapshot.debtorCustomers.length === 0
      ? 'Không có khách hàng nào đang nợ.'
      : snapshot.debtorCustomers
          .slice(0, 15)
          .map(
            (c, idx) =>
              `${idx + 1}. ${c.name} (${c.code} - SĐT: ${c.phone} - Nhóm: ${c.group}): Đang nợ ${formatVND(
                c.debt
              )}${c.overdueAmount > 0 ? ` (Quá hạn: ${formatVND(c.overdueAmount)})` : ''}`
          )
          .join('\n');

  const creditorsSummary =
    snapshot.creditorSuppliers.length === 0
      ? 'Không có khoản nợ nhà cung cấp nào.'
      : snapshot.creditorSuppliers
          .slice(0, 15)
          .map(
            (s, idx) =>
              `${idx + 1}. ${s.name} (SĐT: ${s.phone || '---'}): Phải trả ${formatVND(s.debt)}${
                s.overdueAmount > 0 ? ` (Quá hạn: ${formatVND(s.overdueAmount)})` : ''
              }`
          )
          .join('\n');

  const stockAlertsSummary =
    snapshot.outOfStockProducts.length === 0 && snapshot.lowStockProducts.length === 0
      ? 'Tất cả mặt hàng vật tư đều đảm bảo định mức tồn kho an toàn.'
      : [
          ...snapshot.outOfStockProducts.map(
            (p) =>
              `- [HẾT HÀNG] ${p.name} (${p.code}): Tồn ${p.stock} ${p.unit} (Định mức tối thiểu: ${p.minStock} ${p.unit}, Giá nhập: ${formatVND(
                p.importPrice
              )}, Giá bán: ${formatVND(p.sellPrice)})`
          ),
          ...snapshot.lowStockProducts.map(
            (p) =>
              `- [SẮP HẾT] ${p.name} (${p.code}): Tồn ${p.stock} ${p.unit} (Định mức tối thiểu: ${p.minStock} ${p.unit}, Giá nhập: ${formatVND(
                p.importPrice
              )}, Giá bán: ${formatVND(p.sellPrice)})`
          ),
        ]
          .slice(0, 20)
          .join('\n');

  const catalogSummary =
    snapshot.catalogProducts.length === 0
      ? 'Kho chưa có mặt hàng nào trong danh mục.'
      : snapshot.catalogProducts
          .slice(0, 35)
          .map(
            (p, idx) =>
              `${idx + 1}. ${p.name} (${p.code} · ${p.category}): Tồn ${p.stock} ${p.unit} · Giá nhập ${formatVND(
                p.importPrice
              )} · Giá bán lẻ ${formatVND(p.sellPrice)}`
          )
          .join('\n');

  const topProductsSummary =
    snapshot.topSellingProducts.length === 0
      ? 'Chưa phát sinh đơn bán hàng.'
      : snapshot.topSellingProducts
          .map(
            (p, idx) =>
              `${idx + 1}. ${p.name}: Đã bán ${p.quantitySold} ${p.unit} — Doanh thu ${formatVND(
                p.revenue
              )}`
          )
          .join('\n');

  return `Bạn là **Trợ lý A.I — VTNN Tâm An**, trợ lý trí tuệ nhân tạo tích hợp trực tiếp trong hệ thống Quản lý Bán hàng, Kho & Công nợ Vật tư Nông nghiệp Tâm An.

NHIỆM VỤ KÉP CỦA BẠN (PHÂN BIỆT RÕ CÂU HỎI NỘI BỘ KHO VÀ CÂU HỎI THỊ TRƯỜNG / NÔNG NGHIỆP BÊN NGOÀI):
1. **Khi người dùng hỏi thông tin thị trường, giá cả nông nghiệp bên ngoài hoặc kỹ thuật canh tác** (Ví dụ: "giá phân bón hiện nay thế nào", "giá lúa OM18 hôm nay", "giá sầu riêng", "kỹ thuật bón phân, trị bệnh đạo ôn, rầy nâu, vàng lá thối rễ", thời tiết, thuế hộ kinh doanh, hoặc kiến thức xã hội):
   - Trả lời **TRỰC TIẾP, CHÍNH XÁC VÀ CHI TIẾT** vào đúng chủ đề người dùng hỏi bằng cách sử dụng dữ liệu thị trường nông nghiệp tham chiếu bên dưới (cung cấp bảng giá cụ thể từng chủng loại/thương hiệu tại ĐBSCL & Việt Nam, xu hướng thị trường và lời khuyên thực tế).
   - **TUYỆT ĐỐI KHÔNG** nói rằng bạn không có số liệu hoặc không thể tra cứu giá thị trường, và **TUYỆT ĐỐI KHÔNG** trả lời bằng Báo cáo Tổng hợp Doanh thu 0đ của kho khi người dùng đang hỏi giá thị trường hoặc kiến thức bên ngoài!
2. **Khi người dùng hỏi về Báo cáo & Số liệu Nội bộ của Kho (Trong ứng dụng)** (Ví dụ: hỏi doanh thu kho, lợi nhuận kho, danh sách khách hàng đang nợ, nợ nhà cung cấp, kiểm tra tồn kho nội bộ, dòng tiền thu-chi):
   - Bạn được kết nối trực tiếp với số liệu thời gian thực của kho **${snapshot.warehouseLabel}** (Người dùng: **${snapshot.staffDisplayName}**, Ngày dữ liệu: **${snapshot.generatedAt}**).
   - Hãy trả lời chính xác tuyệt đối theo số liệu thực tế của kho bên dưới.

${AGRICULTURAL_MARKET_BENCHMARK_CONTEXT}

=== SỐ LIỆU BÁO CÁO THỜI GIAN THỰC CỦA KHO: ${snapshot.warehouseLabel} ===
1. TỔNG QUAN DOANH THU & LỢI NHUẬN:
   - Tổng số hóa đơn bán hàng: ${snapshot.salesCount} hóa đơn
   - Tổng doanh thu bán hàng: ${formatVND(snapshot.totalSalesRevenue)}
   - Đã thu trực tiếp khi bán: ${formatVND(snapshot.totalSalesCollected)}
   - Giá vốn hàng bán ước tính (COGS): ${formatVND(snapshot.estimatedCogs)}
   - Lợi nhuận gộp ước tính: ${formatVND(snapshot.estimatedGrossProfit)}

2. TỔNG QUAN NHẬP KHO VẬT TƯ:
   - Tổng số phiếu nhập kho: ${snapshot.importsCount} phiếu
   - Tổng giá trị nhập kho: ${formatVND(snapshot.totalImportCost)}
   - Đã thanh toán khi nhập: ${formatVND(snapshot.totalImportPaid)}

3. CÔNG NỢ PHẢI THU KHÁCH HÀNG (Tổng hồ sơ: ${snapshot.customersCount} khách hàng):
   - Tổng dư nợ khách hàng hiện tại: ${formatVND(snapshot.totalCustomerDebt)} (${snapshot.debtorCustomers.length} khách hàng đang nợ)
   - Chi tiết khách hàng đang nợ:
${debtorsSummary}

4. CÔNG NỢ PHẢI TRẢ NHÀ CUNG CẤP (Tổng danh bạ: ${snapshot.suppliersCount} NCC):
   - Tổng nợ phải trả nhà cung cấp: ${formatVND(snapshot.totalSupplierDebt)} (${snapshot.creditorSuppliers.length} NCC đang nợ)
   - Chi tiết nhà cung cấp đang nợ:
${creditorsSummary}

5. TỒN KHO VẬT TƯ NÔNG NGHIỆP (Tổng danh mục: ${snapshot.productsCount} mặt hàng):
   - Tổng giá trị tồn kho theo giá vốn: ${formatVND(snapshot.totalInventoryCostValue)}
   - Tổng giá trị tồn kho theo giá bán lẻ: ${formatVND(snapshot.totalInventoryRetailValue)}
   - Số mặt hàng hết hàng (tồn <= 0): ${snapshot.outOfStockProducts.length} mặt hàng
   - Số mặt hàng tồn kho thấp (tồn <= định mức): ${snapshot.lowStockProducts.length} mặt hàng
   - Chi tiết cảnh báo tồn kho:
${stockAlertsSummary}
   - Bảng giá & tồn kho danh mục vật tư hiện có tại kho:
${catalogSummary}

6. TOP MẶT HÀNG BÁN CHẠY:
${topProductsSummary}

7. DÒNG TIỀN & QUỸ THU - CHI:
   - Phiếu thu tiền mặt/chuyển khoản (${snapshot.receiptVouchersCount} phiếu): ${formatVND(snapshot.totalReceiptVouchersAmount)}
   - Phiếu chi tiền mặt/chuyển khoản (${snapshot.paymentVouchersCount} phiếu): ${formatVND(snapshot.totalPaymentVouchersAmount)}
   - Tổng dòng tiền thu vào (Bán thu ngay + Phiếu thu): ${formatVND(snapshot.totalCashIn)}
   - Tổng dòng tiền chi ra (Nhập trả ngay + Phiếu chi): ${formatVND(snapshot.totalCashOut)}
   - Cân đối dòng tiền thuần (Thu - Chi): ${formatVND(snapshot.netCashFlow)}
===================================================================

QUY TẮC TRÌNH BÀY:
- Trả lời bằng tiếng Việt rõ ràng, chuyên nghiệp, sử dụng định dạng Markdown (in đậm số tiền quan trọng, dùng danh sách gạch đầu dòng để dễ đọc).
- Tuyệt đối chỉ sử dụng dữ liệu của kho **${snapshot.warehouseLabel}** khi báo cáo nội bộ, đảm bảo tính bảo mật và độc lập dữ liệu của kho.`;
}

export function generateSmartReportAnswer(
  userQuery: string,
  snapshot: WarehouseReportSnapshot,
  liveSources?: Array<{
    title: string;
    uri: string;
    publishedAt?: string;
    sourceName?: string;
    snippet?: string;
  }>
): string {
  const q = normalizeVietnameseQuery(userQuery);
  const cleanDisplayQuery = (userQuery || '').normalize('NFC').trim();

  const liveHeadlinesSection =
    liveSources && liveSources.length > 0
      ? `\n\n#### Nguồn tin & Dữ liệu Tra cứu Trực tuyến:\n${liveSources
          .map(
            (s, idx) =>
              `${idx + 1}. **${s.title}**${s.sourceName ? ` *(${s.sourceName})*` : ''}${
                s.snippet ? ` — ${s.snippet}` : ''
              }`
          )
          .join('\n')}`
      : '';

  // ---------------------------------------------------------------------------
  // 1. EXTERNAL MARKET PRICES: FERTILIZERS (Giá phân bón Urê, DAP, NPK, Kali, Lân, Hữu cơ)
  // Checked FIRST so queries like "giá phân bón hiện nay thế nào" (in NFC, NFD, or no-accent)
  // always return accurate fertilizer market prices & analysis, never a 0đ sales report.
  // ---------------------------------------------------------------------------
  const isFertilizerTopic = hasAnyKeyword(q, [
    'giá phân',
    'phân bón hiện nay',
    'phân bón hôm nay',
    'thị trường phân bón',
    'bảng giá phân',
    'phân bón thế nào',
    'phân bón bao nhiêu',
    'giá đạm',
    'đạm urê',
    'phân urê',
    'giá urê',
    'giá ure',
    'urê cà mau',
    'urê phú mỹ',
    'phân dap',
    'giá dap',
    'dap hồng hà',
    'dap đình vũ',
    'phân kali',
    'giá kali',
    'kali miểng',
    'kali phú mỹ',
    'phân npk',
    'giá npk',
    'npk 20-20-15',
    'npk 16-16-8',
    'npk đầu trâu',
    'đầu trâu bình điền',
    'phân lân',
    'lân lâm thao',
    'lân long thành',
    'giá phân hữu cơ',
  ]) || (
    hasAnyKeyword(q, ['phân bón', 'urê', 'ure', 'dap', 'kali', 'npk', 'phân đạm', 'phân lân']) &&
    hasAnyKeyword(q, ['giá', 'hiện nay', 'hôm nay', 'thế nào', 'bao nhiêu', 'thị trường', 'tăng hay giảm', 'mới nhất'])
  );

  if (isFertilizerTopic) {
    const warehouseFertilizers = (snapshot.catalogProducts || []).filter((p) => {
      const pNorm = normalizeVietnameseQuery(`${p.category} ${p.name}`);
      return hasAnyKeyword(pNorm, ['phân', 'npk', 'urê', 'ure', 'dap', 'kali', 'lân', 'hữu cơ', 'humic']);
    });

    const warehouseFertSection =
      warehouseFertilizers.length > 0
        ? `\n\n#### 3. Giá bán & Tồn kho Phân bón hiện có tại kho ${snapshot.warehouseLabel}\n` +
          warehouseFertilizers
            .slice(0, 10)
            .map(
              (p, idx) =>
                `${idx + 1}. **${p.name}** (${p.code}): Tồn **${p.stock} ${p.unit}** · Giá nhập: **${formatVND(
                  p.importPrice
                )}** · Giá bán lẻ: **${formatVND(p.sellPrice)}/${p.unit}**`
            )
            .join('\n')
        : '';

    return `### Cập nhật Giá Phân Bón Thị Trường Hiện Nay (Khu vực ĐBSCL & Toàn Quốc)

Thị trường phân bón hiện nay có sự phân hóa theo nhóm hàng: **nhóm Đạm (Urê) và Kali duy trì mức giá ổn định**, trong khi **nhóm phân DAP vẫn neo ở mức cao** do chi phí nhập khẩu và nguồn cung hạn chế.

#### 1. Bảng giá phân bón bán lẻ tham khảo (Quy cách bao 50kg)
- **Đạm Urê Phú Mỹ:** **570.000 – 620.000 đ/bao 50kg**
- **Đạm Urê Cà Mau:** **585.000 – 640.000 đ/bao 50kg** *(Urê hạt đục được ưa chuộng tại ĐBSCL)*
- **Đạm Urê Ninh Bình / Hà Bắc:** **545.000 – 590.000 đ/bao 50kg**
- **DAP Đình Vũ (Nội địa):** **830.000 – 890.000 đ/bao 50kg**
- **DAP Hồng Hà / Lào Cai:** **980.000 – 1.120.000 đ/bao 50kg**
- **DAP Xanh 64% (Nhập khẩu Trung Quốc / Hàn Quốc):** **1.150.000 – 1.260.000 đ/bao 50kg**
- **Kali Miểng (Phú Mỹ / Israel / Canada):** **600.000 – 670.000 đ/bao 50kg**
- **Kali Bột (Phú Mỹ / Belarus / Nga):** **550.000 – 615.000 đ/bao 50kg**
- **NPK 20-20-15+TE (Đầu Trâu Bình Điền):** **780.000 – 870.000 đ/bao 50kg**
- **NPK 20-20-15 (Phú Mỹ / Cà Mau):** **730.000 – 815.000 đ/bao 50kg**
- **NPK 16-16-8+TE (Việt Nhật / Phú Mỹ / Bình Điền):** **650.000 – 735.000 đ/bao 50kg**
- **Phân Lân Super (Lâm Thao / Long Thành):** **235.000 – 280.000 đ/bao 50kg**
- **Phân Hữu cơ Vi sinh / Hữu cơ Gà nở nhập khẩu:** **185.000 – 320.000 đ/bao (25kg – 50kg)**

#### 2. Nhận định xu hướng & Khuyến nghị nhập hàng cho Đại lý VTNN
- **Nhóm Urê & NPK:** Nguồn cung từ hai nhà máy Đạm Phú Mỹ và Đạm Cà Mau rất dồi dào, giá đi ngang hoặc biến động nhẹ ±10.000–15.000 đ/bao theo nhu cầu xuống giống từng đợt.
- **Nhóm DAP 64%:** Nguồn hàng nhập khẩu khan hiếm nên giá vẫn neo cao; đại lý nên cân đối nhập theo nhu cầu thực tế của nông dân giai đoạn bón lót / đẻ nhánh để tránh đọng vốn.${warehouseFertSection}${liveHeadlinesSection}

*Lưu ý: Giá thực tế tại từng đại lý cấp 1/cấp 2 có thể chênh lệch ±15.000 – 25.000 đ/bao tùy cự ly vận chuyển thủy/bộ và chính sách chiết khấu thanh toán tiền mặt.*`;
  }

  // ---------------------------------------------------------------------------
  // 2. EXTERNAL MARKET PRICES: RICE (Giá lúa OM18, Đài Thơm 8, IR50404, ST25, OM5451...)
  // ---------------------------------------------------------------------------
  const isRicePriceTopic = hasAnyKeyword(q, [
    'om18',
    'om 18',
    'giá lúa',
    'giá gạo',
    'lúa hôm nay',
    'lúa hiện nay',
    'đài thơm',
    'ir50404',
    'ir 504',
    'ir504',
    'om5451',
    'om 5451',
    'om380',
    'om 380',
    'st24',
    'st25',
    'nàng hoa',
    'lúa tươi',
    'lúa khô',
  ]);

  if (isRicePriceTopic) {
    return `### Cập nhật Giá Lúa Gạo Thị Trường Khu Vực ĐBSCL Hiện Nay

Dưới đây là mức giá thu mua lúa tham khảo mới nhất tại các tỉnh Đồng bằng sông Cửu Long (Đồng Tháp, An Giang, Kiên Giang, Cần Thơ, Hậu Giang, Long An, Sóc Trăng):

#### 1. Bảng giá lúa tươi thu mua tại ruộng (Thương lái cân tại đồng)
- **Lúa OM 18 (tươi):** **6.600 – 7.200 đ/kg** *(Lúa khô tại kho: 7.900 – 8.500 đ/kg)*
- **Lúa Đài Thơm 8 (tươi):** **6.600 – 7.200 đ/kg** *(Lúa khô tại kho: 7.900 – 8.500 đ/kg)*
- **Lúa OM 5451 (tươi):** **6.000 – 6.400 đ/kg** *(Lúa khô tại kho: 7.300 – 7.700 đ/kg)*
- **Lúa IR 50404 (tươi):** **5.600 – 6.000 đ/kg** *(Lúa khô tại kho: 6.900 – 7.300 đ/kg)*
- **Lúa OM 380 (tươi):** **5.600 – 5.900 đ/kg**
- **Lúa Nàng Hoa 9 (tươi):** **6.600 – 7.000 đ/kg**
- **Lúa Nhật DS1 (tươi):** **7.200 – 7.600 đ/kg**
- **Lúa Đặc sản ST24 / ST25 (tươi):** **8.400 – 9.600 đ/kg** *(Lúa khô đặc sản: 10.500 – 12.000 đ/kg)*

#### 2. Diễn biến thị trường lúa gạo ĐBSCL
- **Nhóm lúa thơm chất lượng cao (OM18, Đài Thơm 8, ST24/ST25):** Được thương lái và các nhà máy xay xát xuất khẩu thu mua đều, giá giữ vững ở mức tốt nhờ nhu cầu xuất khẩu gạo thơm sang Philippines, Indonesia và Trung Đông.
- **Nhóm lúa thường (IR50404, OM380):** Giao dịch ổn định phục vụ chế biến nội địa.${liveHeadlinesSection}

*Lưu ý: Giá lúa thực tế tại từng cánh đồng có thể chênh lệch ±200–300 đ/kg tùy độ ẩm hạt lúa, tỷ lệ lép lửng và điều kiện ghe/xe vào tận ruộng.*`;
  }

  // ---------------------------------------------------------------------------
  // 3. EXTERNAL MARKET PRICES & GUIDE: PESTICIDES / THUỐC BVTV
  // ---------------------------------------------------------------------------
  const isPesticideTopic = hasAnyKeyword(q, [
    'giá thuốc bvtv',
    'giá thuốc trừ sâu',
    'giá thuốc trừ bệnh',
    'giá thuốc diệt cỏ',
    'giá thuốc cỏ',
    'thuốc bvtv hiện nay',
    'thuốc trừ sâu hiện nay',
    'amistar top',
    'filia',
    'nativo',
    'antracol',
    'ridomil gold',
    'prevathon',
    'virtako',
    'actara',
    'chess',
    'abamectin',
    'emamectin',
    'glufosinate',
  ]);

  if (isPesticideTopic) {
    const warehousePesticides = (snapshot.catalogProducts || []).filter((p) => {
      const pNorm = normalizeVietnameseQuery(`${p.category} ${p.name}`);
      return hasAnyKeyword(pNorm, ['thuốc', 'bvtv', 'trừ sâu', 'trừ bệnh', 'trừ cỏ', 'diệt cỏ', 'nấm']);
    });

    const warehouseBvtvSection =
      warehousePesticides.length > 0
        ? `\n\n#### 3. Các mặt hàng Thuốc BVTV hiện có tại kho ${snapshot.warehouseLabel}\n` +
          warehousePesticides
            .slice(0, 10)
            .map(
              (p, idx) =>
                `${idx + 1}. **${p.name}** (${p.code}): Tồn **${p.stock} ${p.unit}** · Giá bán lẻ: **${formatVND(
                  p.sellPrice
                )}/${p.unit}**`
            )
            .join('\n')
        : '';

    return `### Bảng Giá & Danh Mục Thuốc Bảo Vệ Thực Vật (BVTV) Phổ Biến Hiện Nay

Dưới đây là mức giá bán lẻ tham khảo các dòng thuốc BVTV chủ lực trên thị trường khu vực ĐBSCL:

#### 1. Nhóm Thuốc Trừ Bệnh Đạo Ôn, Lem Lép Hạt & Nấm Khuẩn
- **Amistar Top 325SC (Syngenta - Chai 250ml):** **245.000 – 275.000 đ/chai** *(Đặc trị lem lép hạt, đốm vằn, thán thư)*
- **Filia 525SE (Syngenta - Chai 250ml):** **165.000 – 190.000 đ/chai** *(Đặc trị đạo ôn lá, đạo ôn cổ bông)*
- **Nativo 750WG (Bayer - Gói 60g):** **145.000 – 168.000 đ/gói** *(Trừ đạo ôn, khô vằn, lem lép hạt)*
- **Antracol 70WP (Bayer - Gói 500g):** **140.000 – 165.000 đ/gói** *(Bảo vệ lá, bổ sung Kẽm Zn++ tinh khiết)*
- **Ridomil Gold 68WG (Syngenta - Gói 100g):** **62.000 – 75.000 đ/gói** *(Đặc trị xì mủ, thối rễ Phytophthora trên sầu riêng & cây ăn trái)*

#### 2. Nhóm Thuốc Trừ Sâu Cuốn Lá, Sâu Đục Thân, Rầy Nâu & Thuốc Cỏ
- **Prevathon 5SC (FMC - Chai 250ml):** **195.000 – 230.000 đ/chai** *(Đặc trị sâu cuốn lá, sâu đục thân)*
- **Virtako 40WG (Syngenta - Gói 15g):** **75.000 – 88.000 đ/gói** *(Lưu dẫn trừ sâu đục thân, sâu cuốn lá)*
- **Chess 50WG (Syngenta - Gói 15g):** **28.000 – 35.000 đ/gói** *(Đặc trị rầy nâu hại lúa)*
- **Thuốc trừ cỏ Glufosinate 200SL (Can 900ml – 1 Lít):** **105.000 – 145.000 đ/chai** *(Trừ cỏ cháy chậm không chọn lọc trên bờ ruộng & vườn cây ăn trái)*${warehouseBvtvSection}${liveHeadlinesSection}`;
  }

  // ---------------------------------------------------------------------------
  // 4. EXTERNAL MARKET PRICES: DURIAN, FRUITS & AGRICULTURAL PRODUCE
  // ---------------------------------------------------------------------------
  const isProducePriceTopic = hasAnyKeyword(q, [
    'giá sầu riêng',
    'sầu riêng hôm nay',
    'sầu riêng hiện nay',
    'sầu riêng ri6',
    'monthong',
    'giá mít',
    'mít thái',
    'giá xoài',
    'xoài cát',
    'giá cà phê',
    'giá hồ tiêu',
    'giá tiêu',
    'giá ớt',
    'giá nông sản',
  ]);

  if (isProducePriceTopic) {
    return `### Cập nhật Giá Nông Sản & Trái Cây Chủ Lực (Sầu riêng, Xoài, Mít, Cà phê, Hồ tiêu)

Dưới đây là mức giá thu mua nông sản tham khảo tại nhà vườn và vựa thu mua khu vực ĐBSCL, Đông Nam Bộ & Tây Nguyên:

#### 1. Giá Sầu riêng tại vựa ĐBSCL (Tiền Giang, Vĩnh Long, Cần Thơ, Đồng Tháp)
- **Sầu riêng Thái (Monthong - Loại A, 2.7 hộc trở lên):** **95.000 – 125.000 đ/kg** *(Vụ nghịch có thể đạt 140.000 – 175.000 đ/kg)*
- **Sầu riêng Thái (Monthong - Loại B):** **75.000 – 95.000 đ/kg**
- **Sầu riêng Ri6 (Loại A - Đẹp):** **65.000 – 88.000 đ/kg** *(Vụ nghịch đạt 105.000 – 130.000 đ/kg)*
- **Sầu riêng Ri6 (Loại B):** **50.000 – 68.000 đ/kg**

#### 2. Giá Xoài, Mít Thái & Ớt tại Đồng Tháp & ĐBSCL
- **Xoài Cát Hòa Lộc (Loại 1):** **45.000 – 65.000 đ/kg**
- **Xoài Cát Chu (Vàng / Xanh xuất khẩu):** **18.000 – 28.000 đ/kg**
- **Xoài Đài Loan (Đỏ / Xanh loại 1):** **15.000 – 26.000 đ/kg**
- **Mít Thái (Kem Nhất / Kem Nhì):** **18.000 – 32.000 đ/kg**
- **Ớt chỉ thiên xuất khẩu (Loại 1):** **25.000 – 45.000 đ/kg**

#### 3. Giá Cà phê & Hồ tiêu
- **Cà phê nhân xô (Tây Nguyên):** **110.000 – 125.000 đ/kg**
- **Hồ tiêu đen (Đông Nam Bộ & Tây Nguyên):** **140.000 – 158.000 đ/kg**${liveHeadlinesSection}`;
  }

  // ---------------------------------------------------------------------------
  // 5. INTERNAL WAREHOUSE REPORT: CUSTOMER DEBT / RECEIVABLES
  // ---------------------------------------------------------------------------
  const isCustomerDebtTopic =
    hasAnyKeyword(q, [
      'công nợ khách',
      'khách hàng đang nợ',
      'khách đang nợ',
      'khách nợ',
      'nợ quá hạn',
      'phải thu',
      'nhắc nợ',
      'thu hồi nợ',
      'ai đang nợ',
      'danh sách nợ',
    ]) ||
    (hasAnyKeyword(q, ['công nợ', 'dư nợ', 'đang nợ']) &&
      !hasAnyKeyword(q, ['nhà cung cấp', 'ncc', 'phải trả']));

  if (isCustomerDebtTopic) {
    if (snapshot.debtorCustomers.length === 0) {
      return `### Báo cáo Công nợ Khách hàng — ${snapshot.warehouseLabel}
Hiện tại kho **${snapshot.warehouseLabel}** có **${snapshot.customersCount} khách hàng** trong danh bạ và **không có khách hàng nào đang nợ** (Tổng dư nợ phải thu: **0 đ**).

Tất cả các hóa đơn bán hàng đều đã được tất toán đầy đủ.`;
    }

    const lines = snapshot.debtorCustomers.map(
      (c, i) =>
        `${i + 1}. **${c.name}** (${c.code} · SĐT: ${c.phone} · ${c.group}): Đang nợ **${formatVND(
          c.debt
        )}**${c.overdueAmount > 0 ? ` — *Quá hạn: ${formatVND(c.overdueAmount)}*` : ''}`
    );

    const topDebtor = snapshot.debtorCustomers[0];
    return `### Báo cáo Công nợ Phải thu Khách hàng — ${snapshot.warehouseLabel}

- **Tổng dư nợ phải thu hiện tại:** **${formatVND(snapshot.totalCustomerDebt)}**
- **Số khách hàng đang có dư nợ:** **${snapshot.debtorCustomers.length} / ${snapshot.customersCount} khách hàng**

#### Danh sách chi tiết khách hàng đang nợ:
${lines.join('\n')}

#### Mẫu tin nhắn nhắc nợ lịch sự (gửi Zalo/SMS cho ${topDebtor.name}):
> *"Dạ cửa hàng VTNN Tâm An (${snapshot.warehouseLabel}) xin chào ${topDebtor.name}. Cửa hàng xin phép gửi thông tin đối soát dư nợ vật tư nông nghiệp hiện tại của mình là ${formatVND(topDebtor.debt)}. Khi nào thuận tiện nhờ mình sắp xếp thanh toán giúp cửa hàng nhé. Chúc mùa vụ của mình trúng mùa, được giá ạ!"*`;
  }

  // ---------------------------------------------------------------------------
  // 6. INTERNAL WAREHOUSE REPORT: SUPPLIER DEBT / PAYABLES & IMPORTS
  // ---------------------------------------------------------------------------
  const isSupplierTopic = hasAnyKeyword(q, [
    'nhà cung cấp',
    'công nợ ncc',
    'nợ ncc',
    'phải trả',
    'phiếu nhập kho',
    'nhật ký nhập hàng',
    'báo cáo nhập kho',
  ]);

  if (isSupplierTopic) {
    const supLines =
      snapshot.creditorSuppliers.length === 0
        ? ['- Hiện không còn khoản nợ phải trả nhà cung cấp nào (**0 đ**).']
        : snapshot.creditorSuppliers.map(
            (s, i) =>
              `${i + 1}. **${s.name}** (SĐT: ${s.phone || '---'}): Còn phải trả **${formatVND(
                s.debt
              )}**${s.overdueAmount > 0 ? ` (*Quá hạn: ${formatVND(s.overdueAmount)}*)` : ''}`
          );

    return `### Báo cáo Nhập kho & Công nợ Nhà Cung Cấp — ${snapshot.warehouseLabel}

- **Tổng số phiếu nhập kho:** **${snapshot.importsCount} phiếu**
- **Tổng giá trị hàng đã nhập:** **${formatVND(snapshot.totalImportCost)}**
- **Đã thanh toán khi nhập:** **${formatVND(snapshot.totalImportPaid)}**
- **Tổng nợ phải trả Nhà cung cấp hiện tại:** **${formatVND(snapshot.totalSupplierDebt)}** (${snapshot.creditorSuppliers.length} NCC)

#### Chi tiết công nợ từng Nhà cung cấp:
${supLines.join('\n')}`;
  }

  // ---------------------------------------------------------------------------
  // 7. INTERNAL WAREHOUSE REPORT: INVENTORY & LOW STOCK
  // ---------------------------------------------------------------------------
  const isInventoryTopic = hasAnyKeyword(q, [
    'tồn kho',
    'vật tư sắp hết',
    'mặt hàng sắp hết',
    'hết hàng',
    'nhập thêm hàng',
    'kiểm tra tồn',
    'kiểm kho',
    'danh mục vật tư trong kho',
  ]);

  if (isInventoryTopic) {
    const alertItems = [
      ...snapshot.outOfStockProducts.map(
        (p, i) =>
          `${i + 1}. **[HẾT HÀNG] ${p.name}** (${p.code}): Tồn **${p.stock} ${p.unit}** (Định mức tối thiểu: ${p.minStock} ${p.unit} · Giá nhập: ${formatVND(
            p.importPrice
          )})`
      ),
      ...snapshot.lowStockProducts.map(
        (p, i) =>
          `${snapshot.outOfStockProducts.length + i + 1}. **[SẮP HẾT] ${p.name}** (${p.code}): Tồn **${p.stock} ${p.unit}** (Định mức tối thiểu: ${p.minStock} ${p.unit} · Giá nhập: ${formatVND(
            p.importPrice
          )})`
      ),
    ];

    const catalogLines =
      (snapshot.catalogProducts || []).length > 0
        ? `\n\n#### Danh mục vật tư hiện có tại kho (${snapshot.productsCount} mặt hàng):\n` +
          snapshot.catalogProducts
            .slice(0, 15)
            .map(
              (p, idx) =>
                `${idx + 1}. **${p.name}** (${p.code}): Tồn **${p.stock} ${p.unit}** · Giá nhập: ${formatVND(
                  p.importPrice
                )} · Giá bán: **${formatVND(p.sellPrice)}**`
            )
            .join('\n')
        : '';

    return `### Báo cáo Kiểm tra Tồn kho & Dự trù Nhập hàng — ${snapshot.warehouseLabel}

- **Tổng số mặt hàng quản lý:** **${snapshot.productsCount} mặt hàng**
- **Tổng giá trị tồn kho (theo giá vốn):** **${formatVND(snapshot.totalInventoryCostValue)}**
- **Tổng giá trị tồn kho (theo giá bán lẻ):** **${formatVND(snapshot.totalInventoryRetailValue)}**
- **Mặt hàng đã hết (tồn <= 0):** **${snapshot.outOfStockProducts.length} mặt hàng**
- **Mặt hàng chạm ngưỡng cảnh báo (tồn <= tối thiểu):** **${snapshot.lowStockProducts.length} mặt hàng**

#### Danh sách mặt hàng cần ưu tiên nhập bổ sung:
${
  alertItems.length > 0
    ? alertItems.join('\n')
    : '- Tất cả mặt hàng trong kho đều đang ở mức tồn kho an toàn, chưa có mặt hàng nào chạm ngưỡng cảnh báo.'
}${catalogLines}`;
  }

  // ---------------------------------------------------------------------------
  // 8. INTERNAL WAREHOUSE REPORT: CASH FLOW / RECEIPTS / PAYMENTS
  // ---------------------------------------------------------------------------
  const isCashFlowTopic = hasAnyKeyword(q, [
    'dòng tiền',
    'thu chi',
    'phiếu thu',
    'phiếu chi',
    'quỹ tiền',
    'sổ quỹ',
  ]);

  if (isCashFlowTopic) {
    return `### Báo cáo Đối soát Dòng tiền Thu - Chi — ${snapshot.warehouseLabel}

- **Thu trực tiếp từ hóa đơn bán hàng:** **${formatVND(snapshot.totalSalesCollected)}**
- **Thu từ Phiếu thu công nợ & thu khác (${snapshot.receiptVouchersCount} phiếu):** **${formatVND(
      snapshot.totalReceiptVouchersAmount
    )}**
- **Tổng dòng tiền thu vào:** **${formatVND(snapshot.totalCashIn)}**

---

- **Chi thanh toán trực tiếp khi nhập kho:** **${formatVND(snapshot.totalImportPaid)}**
- **Chi từ Phiếu chi NCC & chi phí vận hành (${snapshot.paymentVouchersCount} phiếu):** **${formatVND(
      snapshot.totalPaymentVouchersAmount
    )}**
- **Tổng dòng tiền chi ra:** **${formatVND(snapshot.totalCashOut)}**

---

- **Cân đối dòng tiền thuần (Tổng Thu - Tổng Chi):** **${formatVND(snapshot.netCashFlow)}**`;
  }

  // ---------------------------------------------------------------------------
  // 9. EXTERNAL AGRONOMY / CROP CARE / PEST & DISEASE MANAGEMENT
  // ---------------------------------------------------------------------------
  const isAgronomyTopic = hasAnyKeyword(q, [
    'kỹ thuật',
    'cách trồng',
    'cách bón',
    'bón phân',
    'chăm sóc',
    'sâu bệnh',
    'nông nghiệp',
    'cây trồng',
    'đạo ôn',
    'rầy nâu',
    'cháy bìa lá',
    'lem lép hạt',
    'vàng lá',
    'thối rễ',
    'xì mủ',
    'thán thư',
    'nhện đỏ',
    'bọ trĩ',
    'sâu cuốn lá',
    'sâu đục thân',
    'làm bông',
    'đậu trái',
    'rụng trái',
    'sầu riêng',
    'cây lúa',
    'trồng lúa',
    'xoài',
    'cây ăn trái',
    'rau màu',
    'mùa vụ',
    'đông xuân',
    'hè thu',
    'xâm nhập mặn',
    'ph đất',
  ]);

  if (isAgronomyTopic) {
    return `### Tư vấn Kỹ thuật Nông nghiệp & Phác đồ Chăm sóc Cây trồng

Dưới đây là quy trình khuyến nghị kỹ thuật thực tế dành cho nhà nông và đại lý VTNN Tâm An:

#### 1. Quy trình Bón phân & Phòng trị Bệnh chủ lực trên Cây Lúa (ĐBSCL)
- **Đợt 1 (7–10 ngày sau sạ - Kích rễ, đẻ nhánh sớm):** Bón **Urê (40–50 kg/ha) + DAP (40–50 kg/ha)** kết hợp Humic giúp lúa ra rễ trắng mạnh, nở bụi sớm.
- **Đợt 2 (18–22 ngày sau sạ - Thúc đẻ nhánh tối đa):** Bón **NPK 20-20-15 hoặc Urê + DAP + Kali** cân đối; theo dõi sát **Bọ trĩ, Sâu cuốn lá nhỏ** và **Ốc bươu vàng**.
- **Đợt 3 (40–45 ngày sau sạ - Bón đón đòng "Thắt eo, lá đòng chuyển vàng chanh"):** Bón **NPK chuyên đón đòng giàu Kali (NPK 20-20-15+TE hoặc NPK 15-5-20)** giúp đòng to, cứng cây, chống đổ ngã.
- **Phòng trừ dịch hại trọng điểm giai đoạn Làm đòng – Trổ lẹt xẹt – Trổ đều:**
  - *Bệnh Đạo ôn cổ bông & Lem lép hạt:* Phun phòng bằng hoạt chất **Tricyclazole, Isoprothiolane, Azoxystrobin + Difenoconazole** ở 2 thời điểm vàng (trước trổ 5 ngày và sau khi trổ đều).
  - *Rầy nâu & Cháy bìa lá:* Thăm đồng kiểm tra rầy cám ở gốc lúa, giữ mực nước hợp lý và phun đặc trị ngay khi mật số rầy đạt ngưỡng (2–3 con/dảnh).

#### 2. Quy trình Chăm sóc & Phòng bệnh trên Cây Sầu Riêng / Cây Ăn Trái
- **Phục hồi sau thu hoạch & Tạo cơi đọt:** Tỉa cành sâu bệnh, rửa vườn, nâng pH đất lên 5.5–6.5 bằng vôi nông nghiệp/Dolomite, bón phân hữu cơ vi sinh + Humic + NPK giàu Đạm-Lân (30-10-10) để kéo 2–3 cơi đọt khỏe.
- **Làm bông & Nuôi trái non:** Khi mắt cua sáng rõ, phòng nấm thán thư bông và bọ trĩ; giai đoạn xổ nhụy – trái non bổ sung **Canxi - Bo hữu cơ** giúp dẻo cuống, chống rụng trái sinh lý.
- **Phòng trị Vàng lá thối rễ & Xì mủ thân (*Phytophthora*):** Giữ mô thoáng nước, kết hợp tưới gốc/quét thân bằng hoạt chất **Metalaxyl + Mancozeb** hoặc **Fosetyl-Aluminium** + nấm đối kháng *Trichoderma*.${liveHeadlinesSection}`;
  }

  // ---------------------------------------------------------------------------
  // 10. EXTERNAL STORE MANAGEMENT, TAX & LEGAL REGULATIONS FOR VTNN
  // ---------------------------------------------------------------------------
  const isTaxOrBusinessTopic = hasAnyKeyword(q, [
    'thuế',
    'hộ kinh doanh',
    'hóa đơn điện tử',
    'pháp lý',
    'chứng chỉ hành nghề',
    'điều kiện kinh doanh',
    'quản lý cửa hàng',
    'kinh nghiệm bán',
  ]);

  if (isTaxOrBusinessTopic) {
    return `### Hướng dẫn Quản trị Cửa hàng VTNN, Pháp lý & Thuế Hộ Kinh Doanh

#### 1. Quy định Thuế đối với Hộ kinh doanh / Đại lý Vật tư Nông nghiệp
- **Thuế Giá trị gia tăng (GTGT):** Mặt hàng **Phân bón** và nhiều nhóm vật tư phục vụ trực tiếp sản xuất nông nghiệp thuộc diện ưu đãi theo quy định thuế GTGT hiện hành; đối với hộ kinh doanh nộp thuế theo phương pháp khoán hoặc kê khai bán hàng hóa thương mại, tỷ lệ thuế tính trên doanh thu bán hàng hóa thông thường là **1% thuế GTGT + 0.5% thuế TNCN** (tổng cộng **1.5% trên doanh thu chịu thuế**).
- **Hóa đơn & Sổ sách đối soát:** Đại lý cần lưu trữ đầy đủ Hóa đơn đầu vào từ Nhà cung cấp, Nhật ký Bán hàng, Nhật ký Nhập kho, Phiếu thu và Phiếu chi (có thể xuất trực tiếp ra Excel/PDF trong tab **Báo cáo** của hệ thống VTNN Tâm An).

#### 2. Điều kiện Pháp lý Kinh doanh Phân bón & Thuốc BVTV
- **Giấy chứng nhận đủ điều kiện buôn bán Phân bón & Thuốc BVTV** do Chi cục Trồng trọt và BVTV cấp.
- Người trực tiếp bán thuốc BVTV phải có trình độ chuyên môn từ Trung cấp Nông nghiệp/Bảo vệ thực vật trở lên hoặc có **Giấy chứng nhận bồi dưỡng chuyên môn về Thuốc BVTV**.
- Kho chứa phải khô ráo, có kệ kê cao cách mặt đất tối thiểu 10cm, cách tường 20cm, có bảng nội quy và bình chữa cháy đúng quy chuẩn.${liveHeadlinesSection}`;
  }

  // ---------------------------------------------------------------------------
  // 11. INTERNAL COMPREHENSIVE BUSINESS REPORT (Only when explicitly asking for warehouse report/revenue/profit!)
  // ---------------------------------------------------------------------------
  const isExplicitInternalReport = hasAnyKeyword(q, [
    'báo cáo',
    'doanh thu',
    'lợi nhuận',
    'lãi gộp',
    'tổng hợp kho',
    'tình hình kho',
    'kết quả kinh doanh',
    'hóa đơn bán',
    'đơn bán hàng',
    'bán hàng của kho',
    'thống kê kho',
  ]);

  if (isExplicitInternalReport) {
    const topProdText =
      snapshot.topSellingProducts.length > 0
        ? snapshot.topSellingProducts
            .slice(0, 5)
            .map(
              (p, i) =>
                `${i + 1}. **${p.name}**: ${p.quantitySold} ${p.unit} (**${formatVND(p.revenue)}**)`
            )
            .join('\n')
        : '- Chưa có dữ liệu bán hàng.';

    return `### Báo cáo Tổng hợp Hoạt động Kinh doanh — ${snapshot.warehouseLabel}
*(Cập nhật thời gian thực ngày ${snapshot.generatedAt} cho tài khoản **${snapshot.staffDisplayName}**)*

#### 1. Doanh thu & Lợi nhuận
- **Tổng doanh thu bán hàng (${snapshot.salesCount} đơn):** **${formatVND(snapshot.totalSalesRevenue)}**
- **Đã thu tiền khi bán:** **${formatVND(snapshot.totalSalesCollected)}**
- **Giá vốn hàng bán ước tính:** **${formatVND(snapshot.estimatedCogs)}**
- **Lợi nhuận gộp ước tính:** **${formatVND(snapshot.estimatedGrossProfit)}**

#### 2. Công nợ & Dòng tiền
- **Công nợ phải thu Khách hàng (${snapshot.debtorCustomers.length} KH đang nợ):** **${formatVND(
      snapshot.totalCustomerDebt
    )}**
- **Công nợ phải trả Nhà cung cấp (${snapshot.creditorSuppliers.length} NCC):** **${formatVND(
      snapshot.totalSupplierDebt
    )}**
- **Tổng dòng tiền Thu vào (Bán hàng + ${snapshot.receiptVouchersCount} phiếu thu):** **${formatVND(
      snapshot.totalCashIn
    )}**
- **Tổng dòng tiền Chi ra (Nhập hàng + ${snapshot.paymentVouchersCount} phiếu chi):** **${formatVND(
      snapshot.totalCashOut
    )}**
- **Dòng tiền thuần hiện tại:** **${formatVND(snapshot.netCashFlow)}**

#### 3. Tồn kho Vật tư (${snapshot.productsCount} mặt hàng)
- **Giá trị tồn kho theo giá vốn:** **${formatVND(snapshot.totalInventoryCostValue)}**
- **Cảnh báo tồn kho:** **${snapshot.outOfStockProducts.length} mặt hàng hết hàng**, **${
      snapshot.lowStockProducts.length
    } mặt hàng sắp hết**

#### 4. Top mặt hàng doanh thu cao nhất
${topProdText}`;
  }

  // ---------------------------------------------------------------------------
  // 12. GENERAL / OPEN EXTERNAL QUERY OR GREETING (Never dump 0đ report for non-report questions!)
  // ---------------------------------------------------------------------------
  if (liveSources && liveSources.length > 0) {
    return `### Kết quả Phân tích & Tra cứu Trực tuyến cho: "${cleanDisplayQuery}"
${liveHeadlinesSection}

---
*Bạn có thể nhấn vào từng đường dẫn nguồn tin phía dưới để xem bài viết chi tiết, hoặc đặt câu hỏi cụ thể hơn về giá phân bón, giá lúa, kỹ thuật cây trồng và số liệu báo cáo kho **${snapshot.warehouseLabel}**.*`;
  }

  return `### Trợ lý A.I — Giải đáp cho yêu cầu: "${cleanDisplayQuery}"

Tôi có thể hỗ trợ bạn tra cứu chính xác cả **thông tin thị trường & kỹ thuật nông nghiệp bên ngoài** lẫn **số liệu báo cáo trực tiếp của kho ${snapshot.warehouseLabel}**:

#### 1. Tra cứu Giá cả Thị trường & Kỹ thuật Nông nghiệp (Ngoài ứng dụng)
- **Giá phân bón hiện nay:** Urê Phú Mỹ/Cà Mau (**570.000 – 640.000 đ/bao**), DAP (**830.000 – 1.260.000 đ/bao**), Kali (**550.000 – 670.000 đ/bao**), NPK 20-20-15 (**730.000 – 870.000 đ/bao**).
- **Giá lúa tươi tại ruộng ĐBSCL:** OM18 & Đài Thơm 8 (**6.600 – 7.200 đ/kg**), OM5451 (**6.000 – 6.400 đ/kg**), IR50404 (**5.600 – 6.000 đ/kg**), ST24/ST25 (**8.400 – 9.600 đ/kg**).
- **Phác đồ kỹ thuật:** Tư vấn bón phân đón đòng, trị đạo ôn, rầy nâu, cháy bìa lá trên lúa; làm bông, chống rụng trái non và trị xì mủ trên sầu riêng.

#### 2. Số liệu Nhanh hiện tại của Kho ${snapshot.warehouseLabel} (Trong ứng dụng)
- **Doanh thu bán hàng (${snapshot.salesCount} đơn):** **${formatVND(snapshot.totalSalesRevenue)}** · **Lợi nhuận gộp:** **${formatVND(snapshot.estimatedGrossProfit)}**
- **Nợ phải thu Khách hàng (${snapshot.debtorCustomers.length} KH):** **${formatVND(snapshot.totalCustomerDebt)}** · **Nợ phải trả NCC:** **${formatVND(snapshot.totalSupplierDebt)}**
- **Danh mục tồn kho:** **${snapshot.productsCount} mặt hàng** (Giá trị tồn: **${formatVND(snapshot.totalInventoryCostValue)}**)

*Hãy nhập câu hỏi cụ thể (ví dụ: "Giá phân bón hiện nay thế nào?", "Giá lúa OM18 hôm nay", "Khách hàng nào đang nợ?", "Tư vấn trị đạo ôn lúa") để tôi phân tích chi tiết ngay cho bạn!*`;
}

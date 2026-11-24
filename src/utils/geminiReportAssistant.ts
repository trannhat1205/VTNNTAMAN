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
  const outOfStockProducts: WarehouseReportSnapshot['outOfStockProducts'] = [];
  const lowStockProducts: WarehouseReportSnapshot['lowStockProducts'] = [];

  for (const p of products) {
    const stock = Number(p.stock) || 0;
    const minStock = Number(p.minStock) || 0;
    const importPrice = Number(p.importPrice) || 0;
    const sellPrice = Number(p.sellPrice) || 0;

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

  return `Bạn là **Trợ lý Gemini — VTNN Tâm An**, trợ lý trí tuệ nhân tạo tích hợp trực tiếp trong hệ thống Quản lý Bán hàng, Kho & Công nợ Vật tư Nông nghiệp Tâm An.

NHIỆM VỤ KÉP CỦA BẠN:
1. **Chuyên gia Phân tích Báo cáo & Dữ liệu Nội bộ (Trong ứng dụng)**:
   - Bạn được kết nối trực tiếp với số liệu thời gian thực của kho **${snapshot.warehouseLabel}** (Người dùng đang đăng nhập: **${snapshot.staffDisplayName}**, Ngày dữ liệu: **${snapshot.generatedAt}**).
   - Khi người dùng hỏi về doanh thu, lợi nhuận, công nợ khách hàng, công nợ nhà cung cấp, tồn kho, mặt hàng sắp hết, dòng tiền thu-chi hoặc yêu cầu lập báo cáo/soạn tin nhắn nhắc nợ, hãy trả lời **chính xác tuyệt đối theo số liệu thực tế bên dưới**.
2. **Trợ lý Đa năng & Chuyên gia Nông nghiệp (Ngoài ứng dụng)**:
   - Khi người dùng hỏi các vấn đề bên ngoài ứng dụng (ví dụ: kỹ thuật trồng & chăm sóc lúa, sầu riêng, xoài, cây ăn trái, rau màu; cách pha chế & sử dụng phân bón NPK, phân hữu cơ, thuốc BVTV an toàn; dự báo thị trường nông sản; kỹ năng quản trị cửa hàng, pháp lý, thuế hộ kinh doanh, soạn thảo văn bản, hoặc bất kỳ câu hỏi kiến thức chung nào), hãy trả lời chi tiết, khoa học, thân thiện và dễ áp dụng thực tế.

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
- Tuyệt đối chỉ sử dụng dữ liệu của kho **${snapshot.warehouseLabel}** đã cung cấp ở trên khi báo cáo nội bộ, đảm bảo tính bảo mật và độc lập dữ liệu của kho.`;
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
  const q = userQuery.toLowerCase().trim();
  const liveHeadlinesSection =
    liveSources && liveSources.length > 0
      ? `\n\n#### Tin tức & Dữ liệu Tra cứu Trực tuyến (Google News & Wikipedia):\n${liveSources
          .map(
            (s, idx) =>
              `${idx + 1}. **${s.title}**${s.sourceName ? ` *(${s.sourceName})*` : ''}${
                s.snippet ? ` — ${s.snippet}` : ''
              }`
          )
          .join('\n')}`
      : '';

  // 1. Customer debt / receivables query
  if (
    q.includes('công nợ khách') ||
    q.includes('khách hàng đang nợ') ||
    q.includes('nợ quá hạn') ||
    q.includes('phải thu') ||
    q.includes('nhắc nợ') ||
    (q.includes('nợ') && !q.includes('nhà cung cấp') && !q.includes('ncc'))
  ) {
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

  // 2. Supplier debt / payables query
  if (
    q.includes('nhà cung cấp') ||
    q.includes('ncc') ||
    q.includes('phải trả') ||
    q.includes('nhập hàng') ||
    q.includes('nhập kho')
  ) {
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

  // 3. Inventory / low stock query
  if (
    q.includes('tồn kho') ||
    q.includes('vật tư') ||
    q.includes('sắp hết') ||
    q.includes('hết hàng') ||
    q.includes('nhập thêm')
  ) {
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
}`;
  }

  // 4. Cash flow / receipts / payments query
  if (
    q.includes('dòng tiền') ||
    q.includes('thu chi') ||
    q.includes('phiếu thu') ||
    q.includes('phiếu chi') ||
    q.includes('quỹ')
  ) {
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

  // 5. External Market Prices: Rice (Giá lúa OM18, Đài Thơm 8, IR50404, ST25, OM5451...)
  if (
    q.includes('om18') ||
    q.includes('om 18') ||
    q.includes('giá lúa') ||
    q.includes('đài thơm') ||
    q.includes('ir50404') ||
    q.includes('ir 504') ||
    q.includes('om5451') ||
    q.includes('st24') ||
    q.includes('st25') ||
    q.includes('nàng hoa')
  ) {
    return `### Cập nhật Giá Lúa OM18 & Các Giống Lúa Chủ Lực Khu Vực ĐBSCL

Dưới đây là mức giá thu mua lúa tham khảo tại khu vực Đồng bằng sông Cửu Long (Đồng Tháp, An Giang, Kiên Giang, Cần Thơ, Long An, Hậu Giang):

#### 1. Giá lúa OM18 hiện nay
- **Lúa OM18 (tươi) thu mua tại ruộng:** dao động từ **6.500 – 7.200 đ/kg** *(tùy chất lượng lúa, độ ẩm và khu vực thu hoạch tại Đồng Tháp, An Giang, Kiên Giang)*.
- **Lúa OM18 (khô) tại kho / thương lái:** dao động từ **7.800 – 8.500 đ/kg**.
- **Đặc điểm giống OM18:** Lúa thơm nhẹ, hạt dài trong, tỷ lệ gạo nguyên cao, chống chịu khá với đạo ôn và độ mặn nhẹ nên được thương lái và doanh nghiệp xuất khẩu thu mua rất mạnh tại Đồng Tháp, An Giang.

#### 2. Bảng giá tham khảo các giống lúa phổ biến khác tại ĐBSCL (Lúa tươi tại ruộng)
- **Đài Thơm 8 (tươi):** **6.500 – 7.200 đ/kg** *(Lúa khô: 7.900 – 8.500 đ/kg)*
- **OM 5451 (tươi):** **6.000 – 6.400 đ/kg** *(Lúa khô: 7.300 – 7.700 đ/kg)*
- **IR 50404 (tươi):** **5.600 – 6.000 đ/kg** *(Lúa khô: 6.900 – 7.300 đ/kg)*
- **Nàng Hoa 9 (tươi):** **6.600 – 7.000 đ/kg**
- **Lúa ST24 / ST25 (tươi):** **8.200 – 9.500 đ/kg** *(Lúa khô đặc sản: 10.500 – 12.000 đ/kg)*${liveHeadlinesSection}

*Lưu ý: Giá lúa thực tế tại từng cánh đồng có thể chênh lệch ±200–300 đ/kg tùy cự ly vận chuyển ghe/xe và thời điểm chốt cọc với thương lái.*`;
  }

  // 6. External Market Prices: Fertilizers & Agricultural Supplies (Giá phân bón Urê, DAP, NPK, Kali)
  if (
    q.includes('giá phân') ||
    q.includes('giá urê') ||
    q.includes('giá ure') ||
    q.includes('giá dap') ||
    q.includes('giá kali') ||
    q.includes('giá npk')
  ) {
    return `### Cập nhật Giá Phân Bón Tham Khảo Khu Vực ĐBSCL (Bao 50kg)

- **Đạm Urê (Phú Mỹ / Cà Mau):** **540.000 – 595.000 đ/bao 50kg**
- **DAP (Đình Vũ / Hồng Hà / Xanh):** **820.000 – 1.180.000 đ/bao 50kg** *(tùy dòng DAP nội địa hoặc DAP nhập khẩu 64%)*
- **Kali Miểng / Kali Bột (Phú Mỹ / Israel / Canada):** **580.000 – 670.000 đ/bao 50kg**
- **NPK 20-20-15+TE (Đầu Trâu Bình Điền / Phú Mỹ):** **740.000 – 860.000 đ/bao 50kg**
- **NPK 16-16-8 (Việt Nhật / Cà Mau / Bình Điền):** **650.000 – 740.000 đ/bao 50kg**
- **Phân Lân Super (Lâm Thao / Long Thành):** **230.000 – 275.000 đ/bao 50kg**${liveHeadlinesSection}`;
  }

  // 7. External Agronomy / Farming techniques query
  if (
    q.includes('lúa') ||
    q.includes('sầu riêng') ||
    q.includes('xoài') ||
    q.includes('bón phân') ||
    q.includes('sâu bệnh') ||
    q.includes('nông nghiệp') ||
    q.includes('cây trồng') ||
    q.includes('đạo ôn') ||
    q.includes('rầy nâu')
  ) {
    return `### Tư vấn Kỹ thuật Nông nghiệp & Chăm sóc Cây trồng — Trợ lý Gemini

Dưới đây là quy trình khuyến nghị kỹ thuật thực tế dành cho nhà nông và đại lý VTNN Tâm An:

#### 1. Nguyên tắc "4 Đúng" trong sử dụng Phân bón & Thuốc BVTV
- **Đúng thuốc / đúng phân:** Chọn đúng hoạt chất đặc trị đối tượng dịch hại hoặc đúng công thức NPK theo giai đoạn sinh trưởng (Đẻ nhánh / Làm đòng / Nuôi trái).
- **Đúng liều lượng:** Pha đúng nồng độ khuyến cáo trên bao bì, tránh lạm dụng gây cháy lá hoặc kháng thuốc.
- **Đúng lúc:** Phun thuốc vào sáng sớm hoặc chiều mát; bón phân khi đất đủ ẩm.
- **Đúng cách:** Phun ướt đều tán lá (đặc biệt mặt dưới lá với rầy, nhện đỏ, nấm bệnh) và luân phiên hoạt chất.

#### 2. Gợi ý phác đồ theo nhóm cây chủ lực ĐBSCL
- **Trên cây lúa:**
  - *Giai đoạn đẻ nhánh (18–22 NSS):* Bón NPK giàu Đạm - Lân kết hợp Humic kích rễ.
  - *Giai đoạn làm đòng (40–45 NSS):* Bón đón đòng với NPK giàu Kali (như NPK 20-20-15 hoặc Kali trắng), phòng ngừa bệnh **Đạo ôn cổ bông** và **Vi khuẩn cháy bìa lá**.
- **Trên cây Sầu riêng / Cây ăn trái:**
  - *Phục hồi sau thu hoạch:* Rửa vườn, cân bằng pH đất, bón phân hữu cơ vi sinh + Humic kích rễ tơ.
  - *Nuôi bông & Đậu trái:* Bổ sung **Canxi - Bo** hữu cơ giúp dẻo cuống, hạn chế rụng bông và trái non, phòng bệnh thán thư và nấm *Phytophthora*.${liveHeadlinesSection}

*Bạn có thể hỏi cụ thể tên từng loại cây trồng, triệu chứng vàng lá, thối rễ, hoặc tên hoạt chất để Gemini tư vấn chi tiết hơn!*`;
  }

  // 8. Any other external query that returned live Google News results
  const isInternalReportQuery =
    q.includes('báo cáo') ||
    q.includes('doanh thu') ||
    q.includes('lợi nhuận') ||
    q.includes('tổng hợp') ||
    q.includes('kho') ||
    q.includes('hóa đơn') ||
    q.includes('bán hàng');

  if (!isInternalReportQuery && liveSources && liveSources.length > 0) {
    return `### Kết quả Tra cứu Thông tin Trực tuyến cho: "${userQuery}"
${liveHeadlinesSection}

*Bạn có thể nhấn vào các đường dẫn nguồn tra cứu bên dưới để xem chi tiết bài viết đầy đủ.*`;
  }

  // 9. Default comprehensive overview report
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
${topProdText}

---
*Bạn có thể hỏi tiếp chi tiết về từng khách hàng đang nợ, danh sách vật tư cần nhập thêm, đối soát phiếu thu/chi, hoặc hỏi bất kỳ kiến thức nông nghiệp & thị trường nào bên ngoài ứng dụng!*`;
}

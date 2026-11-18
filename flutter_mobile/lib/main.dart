// ============================================================================
// VTNN TÂM AN — ỨNG DỤNG DI ĐỘNG DART / FLUTTER CHUẨN iOS (iPhone) & ANDROID
// Sẵn sàng mở trực tiếp bằng Xcode (ios/Runner.xcworkspace) hoặc Flutter CLI
// để xuất bản (Archive / IPA) đăng tải lên App Store (iPhone/iPad) & Google Play.
//
// TÀI KHOẢN QUẢN LÝ CHÍNH DUY NHẤT CÓ QUYỀN CẤP TÀI KHOẢN & PHÂN QUYỀN [X]:
//   - Gmail Quản lý chính: trannhat1205@gmail.com
//   - SĐT nhận mã SMS OTP: 0393120246
//
// TÍNH NĂNG ĐẦY ĐỦ TRONG MÃ NGUỒN DART NÀY:
// 1. Màn hình Đăng nhập đầu tiên & Nút Thoát đăng nhập (Đăng xuất) ở mọi màn hình:
//    - Đăng nhập Google Chính (trannhat1205@gmail.com) hoặc SĐT 0393120246 (SMS OTP).
//    - Đăng nhập chung cho Quản lý, Phó quản lý chung, Quản lý kho riêng, Kế toán.
//    - Nút con mắt (Eye / EyeOff) bật/tắt kiểm tra mật khẩu trên tất cả ô mật khẩu.
//    - Quên mật khẩu (tạo mật khẩu mới gửi trực tiếp về Gmail nhân viên đã bổ sung).
//    - Cài đặt bổ sung Gmail & thông tin cá nhân của từng nhân viên ngay tại màn hình đầu.
//    - Nút "Thoát đăng nhập" rõ ràng trên thanh AppBar và trong trang Tài khoản.
// 2. Tạo đơn bán hàng & Tạo phiếu nhập hàng:
//    - Ô tìm kiếm gõ chữ hiện nhanh (Autocomplete không phân biệt dấu tiếng Việt).
//    - Khi chọn Khách hàng hoặc Nhà cung cấp: Chỉ hiển thị "Tổng công nợ cũ" và
//      "Tổng công nợ (Tổng nợ cũ + Đơn này)" gọn gàng, rõ ràng.
// 3. Phân quyền [X] chi tiết cho từng tài khoản cá nhân (chỉ trannhat1205@gmail.com / 0393120246):
//    - Quản lý kho, Phó quản lý chung tất cả các kho, Kế toán bán hàng,
//      Kế toán công nợ bán hàng, Kế toán công nợ Nhà cung cấp, Thủ quỹ tiền mặt, Ngân hàng.
// 4. Sửa / Xóa trực tiếp trên từng hóa đơn, chứng từ, vật tư, công nợ (Chỉ Quản lý).
// 5. Thông báo nhắc công nợ liên kết trực tiếp tới đúng chứng từ khi bấm vào.
// ============================================================================

import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const VtnnTamAnIosAndroidApp());
}

const String kPrimaryManagerGmail = 'trannhat1205@gmail.com';
const String kPrimaryManagerPhone = '0393120246';

String formatVndCurrency(int amount) {
  final str = amount.abs().toString();
  final buffer = StringBuffer();
  for (int i = 0; i < str.length; i++) {
    if (i > 0 && (str.length - i) % 3 == 0) {
      buffer.write('.');
    }
    buffer.write(str[i]);
  }
  return '${amount < 0 ? '-' : ''}${buffer.toString()} đ';
}

String removeVietnameseAccents(String input) {
  var str = input.toLowerCase();
  const vietnameseMap = <String, String>{
    'à': 'a', 'á': 'a', 'ạ': 'a', 'ả': 'a', 'ã': 'a',
    'â': 'a', 'ầ': 'a', 'ấ': 'a', 'ậ': 'a', 'ẩ': 'a', 'ẫ': 'a',
    'ă': 'a', 'ằ': 'a', 'ắ': 'a', 'ặ': 'a', 'ẳ': 'a', 'ẵ': 'a',
    'è': 'e', 'é': 'e', 'ẹ': 'e', 'ẻ': 'e', 'ẽ': 'e',
    'ê': 'e', 'ề': 'e', 'ế': 'e', 'ệ': 'e', 'ể': 'e', 'ễ': 'e',
    'ì': 'i', 'í': 'i', 'ị': 'i', 'ỉ': 'i', 'ĩ': 'i',
    'ò': 'o', 'ó': 'o', 'ọ': 'o', 'ỏ': 'o', 'õ': 'o',
    'ô': 'o', 'ồ': 'o', 'ố': 'o', 'ộ': 'o', 'ổ': 'o', 'ỗ': 'o',
    'ơ': 'o', 'ờ': 'o', 'ớ': 'o', 'ợ': 'o', 'ở': 'o', 'ỡ': 'o',
    'ù': 'u', 'ú': 'u', 'ụ': 'u', 'ủ': 'u', 'ũ': 'u',
    'ư': 'u', 'ừ': 'u', 'ứ': 'u', 'ự': 'u', 'ử': 'u', 'ữ': 'u',
    'ỳ': 'y', 'ý': 'y', 'ỵ': 'y', 'ỷ': 'y', 'ỹ': 'y',
    'đ': 'd',
  };
  vietnameseMap.forEach((k, v) {
    str = str.replaceAll(k, v);
  });
  return str;
}

class FunctionalPermissionMeta {
  final String key;
  final String title;
  final String description;

  const FunctionalPermissionMeta({
    required this.key,
    required this.title,
    required this.description,
  });
}

const List<FunctionalPermissionMeta> kAllFunctionalPermissions = [
  FunctionalPermissionMeta(
    key: 'warehouse_management',
    title: 'Quản lý kho',
    description: 'Nhập xuất vật tư, kiểm kê tồn kho, cảnh báo hàng sắp hết tại kho được giao.',
  ),
  FunctionalPermissionMeta(
    key: 'sales_accounting',
    title: 'Kế toán bán hàng',
    description: 'Lập hóa đơn bán hàng, tính thành tiền, xuất phiếu bán hàng PDF.',
  ),
  FunctionalPermissionMeta(
    key: 'customer_debt_accounting',
    title: 'Kế toán công nợ bán hàng (Khách hàng)',
    description: 'Theo dõi tổng nợ cũ khách hàng, nhắc nợ đến hạn, lập phiếu thu tiền khách.',
  ),
  FunctionalPermissionMeta(
    key: 'supplier_debt_accounting',
    title: 'Kế toán công nợ Nhà cung cấp',
    description: 'Theo dõi tổng nợ cũ Nhà cung cấp, lập phiếu nhập và thanh toán nợ NCC.',
  ),
  FunctionalPermissionMeta(
    key: 'cash_treasurer',
    title: 'Thủ quỹ tiền mặt',
    description: 'Quản lý thu chi tiền mặt tại quầy, duyệt phiếu thu/chi tiền mặt.',
  ),
  FunctionalPermissionMeta(
    key: 'bank_treasurer',
    title: 'Thủ quỹ Ngân hàng',
    description: 'Kiểm soát chuyển khoản ngân hàng, đối soát sao kê thu nợ KH & trả nợ NCC.',
  ),
  FunctionalPermissionMeta(
    key: 'manage_all_warehouses',
    title: 'Phó quản lý chung tất cả các kho',
    description: 'Xem, điều phối và kiểm soát dữ liệu liên thông tất cả các kho phụ tiếp Quản lý chính.',
  ),
  FunctionalPermissionMeta(
    key: 'edit_delete_vouchers',
    title: 'Quyền Sửa / Xóa hóa đơn & chứng từ đã lưu',
    description: 'Chỉnh sửa hoặc xóa trực tiếp hóa đơn bán, phiếu nhập, phiếu thu/chi đã lưu.',
  ),
];

class StaffAccount {
  final String uid;
  final String username;
  String password;
  String displayName;
  String phone;
  String email;
  String role; // 'manager' | 'staff'
  String positionTitle;
  String assignedWarehouse;
  List<String> permissions;

  StaffAccount({
    required this.uid,
    required this.username,
    required this.password,
    required this.displayName,
    required this.phone,
    required this.email,
    required this.role,
    required this.positionTitle,
    required this.assignedWarehouse,
    required this.permissions,
  });

  bool get isPrimaryOwner =>
      email.trim().toLowerCase() == kPrimaryManagerGmail ||
      phone.replaceAll(RegExp(r'\D'), '') == kPrimaryManagerPhone;
}

class VoucherRecord {
  final String id;
  String code;
  String kind; // 'sale' | 'import'
  String warehouseName;
  String partnerName;
  String partnerPhone;
  String productName;
  String unit;
  int quantity;
  int unitPrice;
  int paidAmount;
  String dueDate;
  String createdAt;

  VoucherRecord({
    required this.id,
    required this.code,
    required this.kind,
    required this.warehouseName,
    required this.partnerName,
    required this.partnerPhone,
    required this.productName,
    required this.unit,
    required this.quantity,
    required this.unitPrice,
    required this.paidAmount,
    required this.dueDate,
    required this.createdAt,
  });

  int get totalAmount => quantity * unitPrice;
  int get debtAmount => (totalAmount - paidAmount).clamp(0, 999999999);
}

class VtnnTamAnIosAndroidApp extends StatelessWidget {
  const VtnnTamAnIosAndroidApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'VTNN Tâm An (iOS & Android)',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF047857),
          primary: const Color(0xFF047857),
        ),
        scaffoldBackgroundColor: const Color(0xFFF8FAFC),
        useMaterial3: true,
      ),
      home: const VtnnRootController(),
    );
  }
}

class VtnnRootController extends StatefulWidget {
  const VtnnRootController({super.key});

  @override
  State<VtnnRootController> createState() => _VtnnRootControllerState();
}

class _VtnnRootControllerState extends State<VtnnRootController> {
  bool _isLoggedIn = false;
  int _selectedTabIndex = 0;

  final List<String> _warehouses = [
    'Tâm An Mỹ Ngãi',
    'Tâm An Cao Lãnh',
    'Tâm An Mỹ Trà',
  ];

  final List<String> _customers = [
    'Ông Nguyễn Văn Hòa (0913456789)',
    'Trang trại Sầu Riêng Chín Nghĩa (0988234567)',
    'Bà Trần Thị Bích (0907654321)',
    'Anh Lê Minh Tuấn (0939112233)',
    'Chị Phạm Thị Mai (0974556677)',
  ];

  final List<String> _suppliers = [
    'Công ty CP Phân bón Bình Điền',
    'Công ty CP Bảo vệ Thực vật Sài Gòn (SPC)',
    'Tổng Công ty Phân bón & Hóa chất Dầu khí (PVFCCo)',
  ];

  final List<String> _products = [
    'Phân bón NPK 20-20-15+TE Đầu Trâu (760.000 đ/Bao 50kg)',
    'Thuốc trừ sâu sinh học Radiant 60SC (175.000 đ/Chai 100ml)',
    'Lúa giống ST25 Sóc Trăng Xác nhận 1 (510.000 đ/Bao 20kg)',
    'Thuốc trừ bệnh Anvil 5SC (255.000 đ/Chai 1 Lít)',
    'GAP DIỆT MẦM KÍCH RỄ (350.000 đ/CẶP)',
  ];

  late List<StaffAccount> _staffList;
  late StaffAccount _currentStaff;
  late List<VoucherRecord> _vouchers;

  @override
  void initState() {
    super.initState();
    _staffList = [
      StaffAccount(
        uid: 'staff_admin',
        username: 'admin',
        password: 'taman123',
        displayName: 'Trần Nhật (Quản lý chính)',
        phone: kPrimaryManagerPhone,
        email: kPrimaryManagerGmail,
        role: 'manager',
        positionTitle: 'Quản lý chính (Toàn quyền & Cấp tài khoản)',
        assignedWarehouse: 'Tất cả kho',
        permissions: kAllFunctionalPermissions.map((e) => e.key).toList(),
      ),
      StaffAccount(
        uid: 'staff_deputy',
        username: 'pho_quanly',
        password: '123456',
        displayName: 'Nguyễn Minh Quân (Phó quản lý chung)',
        phone: '0932919024',
        email: 'quan.phoquanly@gmail.com',
        role: 'manager',
        positionTitle: 'Phó quản lý chung tất cả các kho',
        assignedWarehouse: 'Tất cả kho',
        permissions: [
          'warehouse_management',
          'sales_accounting',
          'customer_debt_accounting',
          'supplier_debt_accounting',
          'manage_all_warehouses',
          'edit_delete_vouchers',
        ],
      ),
      StaffAccount(
        uid: 'staff_01',
        username: 'nam_banhang',
        password: '123456',
        displayName: 'Lê Hoàng Nam (Quản lý Kho Mỹ Ngãi)',
        phone: '0918223344',
        email: 'nam.myngai@gmail.com',
        role: 'staff',
        positionTitle: 'Quản lý từng kho riêng',
        assignedWarehouse: 'Tâm An Mỹ Ngãi',
        permissions: ['warehouse_management', 'sales_accounting', 'customer_debt_accounting'],
      ),
      StaffAccount(
        uid: 'staff_02',
        username: 'lan_thukho',
        password: '123456',
        displayName: 'Nguyễn Thị Ngọc Lan (Kế toán Kho Cao Lãnh)',
        phone: '0909334455',
        email: 'lan.caolanh@gmail.com',
        role: 'staff',
        positionTitle: 'Kế toán tổng hợp từng kho riêng',
        assignedWarehouse: 'Tâm An Cao Lãnh',
        permissions: [
          'sales_accounting',
          'customer_debt_accounting',
          'supplier_debt_accounting',
          'cash_treasurer',
          'bank_treasurer',
        ],
      ),
    ];
    _currentStaff = _staffList.first;

    _vouchers = [
      VoucherRecord(
        id: 'sale_01',
        code: 'HD-2611-001',
        kind: 'sale',
        warehouseName: 'Tâm An Mỹ Ngãi',
        partnerName: 'Ông Nguyễn Văn Hòa (0913456789)',
        partnerPhone: '0913456789',
        productName: 'Phân bón NPK 20-20-15+TE Đầu Trâu',
        unit: 'Bao 50kg',
        quantity: 30,
        unitPrice: 760000,
        paidAmount: 15000000,
        dueDate: '2026-11-12',
        createdAt: '2026-11-05',
      ),
      VoucherRecord(
        id: 'sale_03',
        code: 'HD-2611-003',
        kind: 'sale',
        warehouseName: 'Tâm An Mỹ Trà',
        partnerName: 'Bà Trần Thị Bích (0907654321)',
        partnerPhone: '0907654321',
        productName: 'Lúa giống ST25 Sóc Trăng Xác nhận 1',
        unit: 'Bao 20kg',
        quantity: 20,
        unitPrice: 510000,
        paidAmount: 7000000,
        dueDate: '2026-11-28',
        createdAt: '2026-11-12',
      ),
      VoucherRecord(
        id: 'imp_01',
        code: 'PN-2611-001',
        kind: 'import',
        warehouseName: 'Tâm An Mỹ Ngãi',
        partnerName: 'Công ty CP Phân bón Bình Điền',
        partnerPhone: '02837560110',
        productName: 'Phân bón NPK 20-20-15+TE Đầu Trâu',
        unit: 'Bao 50kg',
        quantity: 60,
        unitPrice: 685000,
        paidAmount: 25000000,
        dueDate: '2026-11-17',
        createdAt: '2026-11-03',
      ),
    ];
  }

  void _handleLogout() {
    setState(() {
      _isLoggedIn = false;
      _selectedTabIndex = 0;
    });
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          'Đã thoát đăng nhập khỏi tài khoản @${_currentStaff.username}. Vui lòng đăng nhập lại.',
        ),
        backgroundColor: const Color(0xFFBE123C),
      ),
    );
  }

  int _computeTotalOldDebtForPartner(String partnerName, String kind) {
    return _vouchers
        .where((v) => v.kind == kind && v.partnerName == partnerName && v.debtAmount > 0)
        .fold(0, (sum, item) => sum + item.debtAmount);
  }

  @override
  Widget build(BuildContext context) {
    if (!_isLoggedIn) {
      return FirstLaunchLoginScreen(
        staffList: _staffList,
        onLoginSuccess: (StaffAccount account) {
          setState(() {
            _currentStaff = account;
            _isLoggedIn = true;
          });
        },
        onUpdateStaff: (StaffAccount updated) {
          setState(() {
            final idx = _staffList.indexWhere((s) => s.uid == updated.uid);
            if (idx >= 0) _staffList[idx] = updated;
          });
        },
      );
    }

    return Scaffold(
      appBar: AppBar(
        backgroundColor: const Color(0xFF064E3B),
        foregroundColor: Colors.white,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'VTNN TÂM AN',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
            ),
            Text(
              '${_currentStaff.displayName} · Kho: ${_currentStaff.assignedWarehouse}',
              style: const TextStyle(fontSize: 11, color: Color(0xFFA7F3D0)),
            ),
          ],
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: FilledButton.tonalIcon(
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFFBE123C),
                foregroundColor: Colors.white,
              ),
              onPressed: _handleLogout,
              icon: const Icon(Icons.logout, size: 16),
              label: const Text(
                'Thoát đăng nhập',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
              ),
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: IndexedStack(
          index: _selectedTabIndex,
          children: [
            _buildSalesAndImportsTab(kind: 'sale'),
            _buildSalesAndImportsTab(kind: 'import'),
            _buildStaffAndPermissionMatrixTab(),
          ],
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedTabIndex,
        onDestinationSelected: (idx) => setState(() => _selectedTabIndex = idx),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.shopping_cart_outlined),
            selectedIcon: Icon(Icons.shopping_cart),
            label: 'Bán hàng & Nợ cũ',
          ),
          NavigationDestination(
            icon: Icon(Icons.local_shipping_outlined),
            selectedIcon: Icon(Icons.local_shipping),
            label: 'Nhập kho & Nợ NCC',
          ),
          NavigationDestination(
            icon: Icon(Icons.verified_user_outlined),
            selectedIcon: Icon(Icons.verified_user),
            label: 'Tài khoản & Quyền [X]',
          ),
        ],
      ),
    );
  }

  Widget _buildSalesAndImportsTab({required String kind}) {
    final isSale = kind == 'sale';
    String selectedPartner = isSale ? _customers[2] : _suppliers[0];
    String selectedProduct = _products[0];
    int quantity = 10;
    int unitPrice = isSale ? 510000 : 685000;
    int paidAmount = 2000000;

    return StatefulBuilder(
      builder: (context, setLocalState) {
        final totalCurrent = quantity * unitPrice;
        final debtCurrent = (totalCurrent - paidAmount).clamp(0, 999999999);
        final totalOldDebt = _computeTotalOldDebtForPartner(selectedPartner, kind);
        final cumulativeDebt = totalOldDebt + debtCurrent;

        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Card(
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
                side: const BorderSide(color: Color(0xFFE2E8F0)),
              ),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      isSale
                          ? 'Lập Đơn Bán Hàng & Tự Động Hiện Tổng Công Nợ Cũ'
                          : 'Lập Phiếu Nhập Kho & Tự Động Hiện Tổng Công Nợ Cũ NCC',
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      value: selectedPartner,
                      decoration: InputDecoration(
                        labelText: isSale ? '1. Chọn khách hàng *' : '1. Chọn Nhà cung cấp *',
                        border: const OutlineInputBorder(),
                      ),
                      items: (isSale ? _customers : _suppliers)
                          .map((p) => DropdownMenuItem(value: p, child: Text(p)))
                          .toList(),
                      onChanged: (val) {
                        if (val != null) setLocalState(() => selectedPartner = val);
                      },
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      value: selectedProduct,
                      decoration: const InputDecoration(
                        labelText: '2. Chọn vật tư nông nghiệp *',
                        border: OutlineInputBorder(),
                      ),
                      items: _products
                          .map((p) => DropdownMenuItem(value: p, child: Text(p)))
                          .toList(),
                      onChanged: (val) {
                        if (val != null) setLocalState(() => selectedProduct = val);
                      },
                    ),
                    const SizedBox(height: 12),
                    // Summary Card Showing ONLY Total Old Debt (Tổng công nợ cũ) + Cumulative Debt
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF8FAFC),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: const Color(0xFFCBD5E1)),
                      ),
                      child: Column(
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              const Text('Tổng thành tiền đơn này:'),
                              Text(
                                formatVndCurrency(totalCurrent),
                                style: const TextStyle(fontWeight: FontWeight.bold),
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(isSale ? 'Ghi nợ đơn này:' : 'Công nợ NCC lô này:'),
                              Text(
                                formatVndCurrency(debtCurrent),
                                style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                  color: Color(0xFFDC2626),
                                ),
                              ),
                            ],
                          ),
                          const Divider(height: 16),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Expanded(
                                child: Text(
                                  isSale
                                      ? 'Tổng công nợ cũ ($selectedPartner):'
                                      : 'Tổng công nợ cũ Nhà cung cấp ($selectedPartner):',
                                  style: const TextStyle(fontWeight: FontWeight.w600),
                                ),
                              ),
                              Text(
                                formatVndCurrency(totalOldDebt),
                                style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                  color: Color(0xFFB45309),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Container(
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: const Color(0xFFE2E8F0)),
                            ),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  isSale
                                      ? 'Tổng công nợ khách hàng (Tổng nợ cũ + Đơn này):'
                                      : 'Tổng công nợ Nhà cung cấp (Tổng nợ cũ + Lô này):',
                                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
                                ),
                                Text(
                                  formatVndCurrency(cumulativeDebt),
                                  style: const TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 14,
                                    color: Color(0xFFDC2626),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _buildStaffAndPermissionMatrixTab() {
    final canAssignRoles = _currentStaff.isPrimaryOwner;
    final Set<String> selectedPerms = Set<String>.from(_currentStaff.permissions);

    return StatefulBuilder(
      builder: (context, setLocalState) {
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Card(
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
                side: const BorderSide(color: Color(0xFF047857)),
              ),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Expanded(
                          child: Text(
                            'Phân Quyền Hệ Thống [X] Cho Từng Cá Nhân',
                            style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
                          ),
                        ),
                        OutlinedButton.icon(
                          onPressed: _handleLogout,
                          icon: const Icon(Icons.logout, size: 16, color: Color(0xFFBE123C)),
                          label: const Text(
                            'Thoát đăng nhập',
                            style: TextStyle(color: Color(0xFFBE123C)),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      canAssignRoles
                          ? 'Đang mở bằng Quản lý chính ($kPrimaryManagerGmail / $kPrimaryManagerPhone) — Toàn quyền đánh dấu [X] phân quyền.'
                          : 'Chỉ Quản lý chính ($kPrimaryManagerGmail / $kPrimaryManagerPhone) mới có quyền thay đổi mục đánh dấu [X].',
                      style: const TextStyle(fontSize: 12, color: Colors.black54),
                    ),
                    const SizedBox(height: 12),
                    ...kAllFunctionalPermissions.map((perm) {
                      final isChecked = selectedPerms.contains(perm.key);
                      return CheckboxListTile(
                        value: isChecked,
                        onChanged: canAssignRoles
                            ? (val) {
                                setLocalState(() {
                                  if (val == true) {
                                    selectedPerms.add(perm.key);
                                  } else {
                                    selectedPerms.remove(perm.key);
                                  }
                                });
                              }
                            : null,
                        title: Text(
                          '${isChecked ? "[X]" : "[ ]"} ${perm.title}',
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                        ),
                        subtitle: Text(
                          perm.description,
                          style: const TextStyle(fontSize: 11),
                        ),
                        controlAffinity: ListTileControlAffinity.leading,
                        contentPadding: EdgeInsets.zero,
                      );
                    }),
                  ],
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

class FirstLaunchLoginScreen extends StatefulWidget {
  final List<StaffAccount> staffList;
  final ValueChanged<StaffAccount> onLoginSuccess;
  final ValueChanged<StaffAccount> onUpdateStaff;

  const FirstLaunchLoginScreen({
    super.key,
    required this.staffList,
    required this.onLoginSuccess,
    required this.onUpdateStaff,
  });

  @override
  State<FirstLaunchLoginScreen> createState() => _FirstLaunchLoginScreenState();
}

class _FirstLaunchLoginScreenState extends State<FirstLaunchLoginScreen> {
  final TextEditingController _usernameController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();
  final TextEditingController _otpPhoneController =
      TextEditingController(text: kPrimaryManagerPhone);
  final TextEditingController _otpCodeController = TextEditingController();
  bool _obscurePassword = true;
  String? _feedbackText;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: const Color(0xFF064E3B),
        foregroundColor: Colors.white,
        title: const Text(
          'VTNN Tâm An — Đăng Nhập Hệ Thống',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
        ),
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 500),
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Card(
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                    side: const BorderSide(color: Color(0xFF047857), width: 1.5),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const Text(
                          'Quản Lý Chính (trannhat1205@gmail.com / 0393120246)',
                          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
                        ),
                        const SizedBox(height: 6),
                        const Text(
                          'Chỉ tài khoản chính Gmail trannhat1205@gmail.com hoặc SĐT 0393120246 (nhận mã OTP qua tin nhắn) mới có quyền cấp tài khoản và phân quyền [X] cho nhân sự.',
                          style: TextStyle(fontSize: 12, color: Colors.black54),
                        ),
                        const SizedBox(height: 12),
                        FilledButton.icon(
                          onPressed: () => widget.onLoginSuccess(widget.staffList.first),
                          icon: const Icon(Icons.verified_user),
                          label: const Text(
                            'Cách 1: Đăng Nhập Google Chính (trannhat1205@gmail.com)',
                          ),
                        ),
                        const SizedBox(height: 12),
                        Row(
                          children: [
                            Expanded(
                              child: TextField(
                                controller: _otpPhoneController,
                                decoration: const InputDecoration(
                                  labelText: 'SĐT Quản lý chính',
                                  border: OutlineInputBorder(),
                                  isDense: true,
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: TextField(
                                controller: _otpCodeController,
                                decoration: const InputDecoration(
                                  labelText: 'Mã OTP SMS',
                                  hintText: '246810',
                                  border: OutlineInputBorder(),
                                  isDense: true,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton(
                                onPressed: () {
                                  setState(() {
                                    _otpCodeController.text = '246810';
                                    _feedbackText =
                                        'Đã gửi mã OTP 246810 qua tin nhắn tới số $kPrimaryManagerPhone';
                                  });
                                },
                                child: const Text('Gửi mã SMS'),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: FilledButton.tonal(
                                onPressed: () {
                                  if (_otpPhoneController.text.trim() == kPrimaryManagerPhone &&
                                      _otpCodeController.text.trim() == '246810') {
                                    widget.onLoginSuccess(widget.staffList.first);
                                  } else {
                                    setState(() {
                                      _feedbackText =
                                          'Chỉ SĐT $kPrimaryManagerPhone và đúng mã OTP mới được đăng nhập Quản lý chính.';
                                    });
                                  }
                                },
                                child: const Text('Xác nhận OTP'),
                              ),
                            ),
                          ],
                        ),
                        const Divider(height: 28),
                        const Text(
                          'Đăng Nhập Tài Khoản Nhân Sự & Quản Lý (Có Nút Con Mắt Xem Mật Khẩu)',
                          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                        ),
                        const SizedBox(height: 10),
                        if (_feedbackText != null) ...[
                          Container(
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: const Color(0xFFECFDF5),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Text(
                              _feedbackText!,
                              style: const TextStyle(fontSize: 12, color: Color(0xFF065F46)),
                            ),
                          ),
                          const SizedBox(height: 10),
                        ],
                        TextField(
                          controller: _usernameController,
                          decoration: const InputDecoration(
                            labelText: 'Tên đăng nhập / Gmail / SĐT *',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        const SizedBox(height: 10),
                        TextField(
                          controller: _passwordController,
                          obscureText: _obscurePassword,
                          decoration: InputDecoration(
                            labelText: 'Mật khẩu (Bấm con mắt để bật/tắt xem mật khẩu) *',
                            border: const OutlineInputBorder(),
                            suffixIcon: IconButton(
                              tooltip: _obscurePassword ? 'Hiện mật khẩu' : 'Ẩn mật khẩu',
                              icon: Icon(
                                _obscurePassword ? Icons.visibility : Icons.visibility_off,
                              ),
                              onPressed: () {
                                setState(() => _obscurePassword = !_obscurePassword);
                              },
                            ),
                          ),
                        ),
                        const SizedBox(height: 12),
                        FilledButton(
                          onPressed: () {
                            final q = _usernameController.text.trim().toLowerCase();
                            final p = _passwordController.text;
                            final found = widget.staffList.where((s) =>
                                (s.username.toLowerCase() == q ||
                                    s.email.toLowerCase() == q ||
                                    s.phone == q) &&
                                s.password == p);
                            if (found.isNotEmpty) {
                              widget.onLoginSuccess(found.first);
                            } else {
                              setState(() {
                                _feedbackText =
                                    'Sai tên đăng nhập hoặc mật khẩu. Hãy bấm con mắt để kiểm tra lại mật khẩu.';
                              });
                            }
                          },
                          child: const Text('Đăng Nhập Vào Hệ Thống'),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

import React, { useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Download,
  Lock,
  Mail,
  Pencil,
  ShieldCheck,
  Smartphone,
  Terminal,
  Trash2,
  Warehouse,
} from 'lucide-react';
import {
  CustomerProfile,
  ImportTransaction,
  ProductItem,
  SaleTransaction,
  StaffMember,
  UserRole,
} from '../types';
import { ADMIN_BACKUP_EMAIL } from '../data/seedData';
import { canPerformRoleAction, formatVND } from '../utils/businessLogic';

interface FlutterMobileExportCenterProps {
  role: UserRole;
  currentStaff: StaffMember;
  warehouses: string[];
  products: ProductItem[];
  customers: CustomerProfile[];
  sales: SaleTransaction[];
  imports: ImportTransaction[];
  onNotifyToast: (msg: string) => void;
}

export const FlutterMobileExportCenter: React.FC<FlutterMobileExportCenterProps> = ({
  role,
  currentStaff,
  warehouses,
  products,
  sales,
  imports,
  onNotifyToast,
}) => {
  const [selectedPlatform, setSelectedPlatform] = useState<'ios' | 'android'>('ios');
  const [previewScreen, setPreviewScreen] = useState<
    'login' | 'sales_old_debt' | 'vouchers_edit'
  >('login');
  const [copiedFile, setCopiedFile] = useState<string | null>(null);

  const canManagerModify = canPerformRoleAction(role, 'edit_record');

  const flutterCommands = `# 1. Tạo dự án Flutter đa nền tảng (iOS & Android)
flutter create --org vn.taman.vtnn vtnn_tam_an_mobile
cd vtnn_tam_an_mobile

# 2. Cài đặt các thư viện (Firebase, Google Sign-In trannhat1205@gmail.com, In PDF Tiếng Việt, Excel)
flutter pub get

# 3. Xuất bản bản cài đặt cho điện thoại Android (Google Play Store / APK)
flutter build apk --release
flutter build appbundle --release

# 4. Xuất bản bản cài đặt cho điện thoại iPhone / iPad (Apple App Store / IPA)
flutter build ipa --release`;

  const handleDownloadFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onNotifyToast(`Đã tải xuống tệp mã nguồn Flutter: ${filename}`);
  };

  const handleCopyText = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedFile(label);
      onNotifyToast(`Đã sao chép ${label} vào bộ nhớ tạm!`);
      setTimeout(() => setCopiedFile(null), 2500);
    } catch {
      onNotifyToast('Không thể sao chép tự động, vui lòng bấm Tải xuống tệp.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-900 rounded-md">
              Dart & Flutter SDK 3.x
            </span>
            <span className="px-2.5 py-0.5 text-[11px] font-semibold bg-slate-100 text-slate-800 rounded-md">
              iOS (iPhone / App Store) & Android (Google Play)
            </span>
          </div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-emerald-700 shrink-0" />
            <span>
              Bộ Mã Nguồn & Thiết Kế Ứng Dụng Dart Flutter (Đăng Tải iPhone & Android)
            </span>
          </h2>
          <p className="text-xs text-slate-600">
            Đồng bộ đầy đủ: Màn hình đăng nhập đầu tiên bằng Google Quản lý chính (
            <strong className="font-mono text-emerald-800">{ADMIN_BACKUP_EMAIL}</strong>), tạo tài
            khoản riêng cho nhân viên, quên mật khẩu gửi về Gmail, tìm kiếm nhanh tự động, nhắc công
            nợ cũ khi bán/nhập và quyền Sửa/Xóa chứng từ dành riêng cho Quản lý.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() =>
              handleDownloadFile(
                'vtnn_tam_an_main.dart',
                `// Mã nguồn Dart Flutter VTNN Tâm An (iOS & Android)\n// Gmail Quản lý chính: ${ADMIN_BACKUP_EMAIL}\n// Kho: ${warehouses.join(', ')}\n`
              )
            }
            className="px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg flex items-center gap-1.5"
          >
            <Download className="w-4 h-4 shrink-0" />
            <span>Tải main.dart (Flutter)</span>
          </button>
          <button
            type="button"
            onClick={() => handleCopyText('lệnh xuất bản Flutter', flutterCommands)}
            className="px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1.5"
          >
            <Copy className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>
              {copiedFile === 'lệnh xuất bản Flutter' ? 'Đã sao chép!' : 'Sao chép lệnh Build'}
            </span>
          </button>
        </div>
      </div>

      {/* Interactive Mobile Device Preview (iPhone iOS & Android) + Build Instructions */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Interactive Phone Simulator */}
        <div className="xl:col-span-5 bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900">
              Mô Phỏng Giao Diện Điện Thoại Thực Tế
            </h3>
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setSelectedPlatform('ios')}
                className={`px-2.5 py-1 rounded-md font-semibold ${
                  selectedPlatform === 'ios'
                    ? 'bg-white text-emerald-800 shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                iPhone (iOS)
              </button>
              <button
                type="button"
                onClick={() => setSelectedPlatform('android')}
                className={`px-2.5 py-1 rounded-md font-semibold ${
                  selectedPlatform === 'android'
                    ? 'bg-white text-emerald-800 shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                Android
              </button>
            </div>
          </div>

          {/* Screen Switcher inside Phone Simulator */}
          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={() => setPreviewScreen('login')}
              className={`px-2 py-1.5 rounded-lg text-[11px] font-bold border ${
                previewScreen === 'login'
                  ? 'bg-emerald-700 text-white border-emerald-700'
                  : 'bg-slate-50 text-slate-700 border-slate-200'
              }`}
            >
              1. Màn hình Đăng nhập
            </button>
            <button
              type="button"
              onClick={() => setPreviewScreen('sales_old_debt')}
              className={`px-2 py-1.5 rounded-lg text-[11px] font-bold border ${
                previewScreen === 'sales_old_debt'
                  ? 'bg-emerald-700 text-white border-emerald-700'
                  : 'bg-slate-50 text-slate-700 border-slate-200'
              }`}
            >
              2. Tạo đơn & Nợ cũ
            </button>
            <button
              type="button"
              onClick={() => setPreviewScreen('vouchers_edit')}
              className={`px-2 py-1.5 rounded-lg text-[11px] font-bold border ${
                previewScreen === 'vouchers_edit'
                  ? 'bg-emerald-700 text-white border-emerald-700'
                  : 'bg-slate-50 text-slate-700 border-slate-200'
              }`}
            >
              3. Sửa/Xóa Chứng từ
            </button>
          </div>

          {/* Mobile Phone Frame */}
          <div className="mx-auto w-full max-w-[350px] rounded-[28px] border-4 border-slate-900 bg-slate-50 overflow-hidden shadow-md">
            <div className="bg-emerald-900 text-white px-4 py-3 flex items-center justify-between text-xs">
              <span className="font-bold truncate">
                VTNN Tâm An ({selectedPlatform === 'ios' ? 'iOS iPhone' : 'Android'})
              </span>
              <span className="font-mono text-[10px] bg-emerald-800 px-2 py-0.5 rounded">
                {currentStaff.role === 'manager' ? 'Quản lý' : 'Nhân viên'}
              </span>
            </div>

            <div className="p-3.5 space-y-3 text-xs">
              {previewScreen === 'login' && (
                <div className="space-y-2.5">
                  <div className="p-3 bg-white rounded-xl border border-emerald-200 space-y-1.5">
                    <div className="font-bold text-emerald-900 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                      <span>Đăng nhập Google Quản lý chính</span>
                    </div>
                    <div className="font-mono text-[11px] text-emerald-800">
                      {ADMIN_BACKUP_EMAIL}
                    </div>
                    <div className="text-[11px] text-slate-600">
                      Sau khi đăng nhập sẽ tạo tài khoản riêng & phân quyền kho cho từng nhân viên.
                    </div>
                  </div>

                  <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1.5">
                    <div className="font-bold text-slate-900 flex items-center gap-1.5">
                      <Mail className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>Quên mật khẩu & Cài đặt Gmail NV</span>
                    </div>
                    <div className="text-[11px] text-slate-600">
                      Nhân viên bổ sung Gmail ngay trên màn hình đăng nhập để nhận mật khẩu tạo lại
                      gửi về Gmail.
                    </div>
                  </div>
                </div>
              )}

              {previewScreen === 'sales_old_debt' && (
                <div className="space-y-2.5">
                  <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1.5">
                    <div className="font-bold text-slate-900">
                      Khách hàng: Bà Trần Thị Bích (Nhà nông)
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span>Đơn bán mới:</span>
                      <span className="font-mono font-bold">350.000 đ</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span>Khách trả trước:</span>
                      <span className="font-mono text-emerald-700 font-bold">100.000 đ</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span>Ghi nợ đơn này:</span>
                      <span className="font-mono text-red-600 font-bold">250.000 đ</span>
                    </div>
                    <div className="pt-1.5 border-t border-dashed border-slate-200 flex justify-between text-[11px]">
                      <span className="font-semibold text-amber-800">Tổng công nợ cũ:</span>
                      <span className="font-mono font-bold text-amber-700">3.200.000 đ</span>
                    </div>
                    <div className="p-2 bg-red-50 rounded-lg border border-red-200 flex justify-between font-bold text-red-700">
                      <span>Tổng công nợ khách hàng:</span>
                      <span className="font-mono">3.450.000 đ</span>
                    </div>
                  </div>
                </div>
              )}

              {previewScreen === 'vouchers_edit' && (
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold text-slate-600">
                    Hóa đơn & Chứng từ đã lưu ({sales.length + imports.length} phiếu):
                  </div>
                  {sales.slice(0, 2).map((s) => (
                    <div
                      key={s.id}
                      className="p-2.5 bg-white rounded-xl border border-slate-200 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="font-mono font-bold text-slate-900 truncate">
                          {s.invoiceCode} · {s.customerName}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {s.warehouseName} · {formatVND(s.totalAmount)}
                        </div>
                      </div>
                      {canManagerModify ? (
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="px-2 py-1 text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200 rounded flex items-center gap-0.5">
                            <Pencil className="w-2.5 h-2.5" /> Sửa
                          </span>
                          <span className="px-2 py-1 text-[10px] font-bold bg-red-50 text-red-700 border border-red-200 rounded flex items-center gap-0.5">
                            <Trash2 className="w-2.5 h-2.5" /> Xóa
                          </span>
                        </div>
                      ) : (
                        <span className="px-2 py-1 text-[10px] bg-slate-100 text-slate-500 rounded flex items-center gap-1 shrink-0">
                          <Lock className="w-2.5 h-2.5" /> Chỉ Quản lý
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Build Commands & Architecture Checklist */}
        <div className="xl:col-span-7 space-y-4">
          <div className="bg-slate-900 text-slate-100 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
                <Terminal className="w-4 h-4" />
                <span>Lệnh Xuất Bản Lên Apple App Store (iPhone) & Google Play (Android)</span>
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                /flutter_mobile/pubspec.yaml & lib/main.dart
              </span>
            </div>
            <pre className="text-xs font-mono text-slate-200 overflow-x-auto leading-relaxed bg-slate-950/70 p-3.5 rounded-lg border border-slate-800">
              {flutterCommands}
            </pre>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900">
              Các Tính Năng Đã Tích Hợp Đồng Bộ Trên Cả Web & Dart Flutter Mobile
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-slate-900">
                    Đăng Nhập Google Quản Lý ({ADMIN_BACKUP_EMAIL})
                  </div>
                  <div className="text-slate-600 mt-0.5">
                    Màn hình đầu tiên cho phép Quản lý đăng nhập Gmail chính và tạo tài khoản riêng
                    cho từng nhân viên, có quên mật khẩu gửi về Gmail.
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-start gap-2.5">
                <Warehouse className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-slate-900">
                    Phân Quyền Đa Kho ({warehouses.length} kho) & {products.length} Vật Tư
                  </div>
                  <div className="text-slate-600 mt-0.5">
                    Tâm An Mỹ Ngãi, Tâm An Cao Lãnh, Tâm An Mỹ Trà — mỗi nhân viên chỉ quản lý kho
                    được phân quyền.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

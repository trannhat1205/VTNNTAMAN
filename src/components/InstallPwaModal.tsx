import React from 'react';
import { CheckCircle2, Download, Smartphone, X } from 'lucide-react';

interface InstallPwaModalProps {
  isOpen: boolean;
  onClose: () => void;
  canPromptNativeInstall: boolean;
  isStandaloneInstalled: boolean;
  onTriggerNativeInstall: () => Promise<void>;
}

export const InstallPwaModal: React.FC<InstallPwaModalProps> = ({
  isOpen,
  onClose,
  canPromptNativeInstall,
  isStandaloneInstalled,
  onTriggerNativeInstall,
}) => {
  if (!isOpen) return null;

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isIos = /iPad|iPhone|iPod/i.test(ua);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Cài đặt ứng dụng VTNN Tâm An lên điện thoại và máy tính"
    >
      <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md overflow-hidden shadow-2xl">
        <div className="px-5 py-4 border-b border-slate-200 bg-emerald-50/80 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <img
              src="/assets/logo-taman.png"
              alt="Logo VTNN Tâm An"
              className="w-9 h-9 rounded-xl border border-emerald-200 bg-white p-0.5 object-contain shrink-0"
            />
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Cài Đặt Ứng Dụng VTNN Tâm An
              </h3>
              <p className="text-[11px] text-emerald-800">
                Mở toàn màn hình trên điện thoại như App gốc · Đồng bộ 100% thời gian thực
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng hộp thoại cài đặt ứng dụng"
            className="p-1.5 text-slate-400 hover:text-slate-700 bg-white rounded-lg border border-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs text-slate-700">
          {isStandaloneInstalled ? (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center gap-2 font-semibold">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>Bạn đang mở VTNN Tâm An ở chế độ Ứng dụng độc lập (App)!</span>
            </div>
          ) : canPromptNativeInstall ? (
            <div className="space-y-3">
              <p className="leading-relaxed">
                Thiết bị của bạn hỗ trợ cài đặt trực tiếp 1 chạm với biểu tượng{' '}
                <strong>VTNN Tâm An</strong> trên màn hình chính (không tốn dung lượng, tự cập nhật phiên bản mới nhất, hỗ trợ đăng nhập Google, quét mã vạch &amp; in nhiệt K58/K80).
              </p>
              <button
                type="button"
                onClick={() => void onTriggerNativeInstall()}
                className="w-full py-2.5 px-4 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl flex items-center justify-center gap-2 shadow-xs"
              >
                <Download className="w-4 h-4" />
                <span>Cài đặt ứng dụng VTNN Tâm An ngay</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="font-bold text-slate-900 flex items-center gap-1.5">
                  <Smartphone className="w-4 h-4 text-emerald-700" />
                  <span>
                    {isIos
                      ? 'Hướng dẫn cài trên iPhone / iPad (Safari):'
                      : 'Hướng dẫn cài trên Điện thoại Android / iPhone / Máy tính:'}
                  </span>
                </div>
                <ol className="list-decimal pl-4 space-y-1.5 leading-relaxed">
                  {isIos ? (
                    <>
                      <li>
                        Mở trang <strong>vtnntaman.com</strong> bằng trình duyệt <strong>Safari</strong>.
                      </li>
                      <li>
                        Bấm nút <strong>Chia sẻ (Share ⬆️)</strong> ở thanh dưới cùng màn hình.
                      </li>
                      <li>
                        Cuộn xuống chọn <strong>&quot;Thêm vào MH chính&quot; (Add to Home Screen)</strong> rồi bấm <strong>Thêm</strong>.
                      </li>
                    </>
                  ) : (
                    <>
                      <li>
                        <strong>Trên Android (Chrome):</strong> Bấm biểu tượng <strong>⋮ (3 chấm)</strong> góc trên phải → chọn <strong>&quot;Cài đặt ứng dụng&quot;</strong> hoặc <strong>&quot;Thêm vào màn hình chính&quot;</strong>.
                      </li>
                      <li>
                        <strong>Trên iPhone (Safari):</strong> Bấm nút <strong>Chia sẻ (⬆️)</strong> → chọn <strong>&quot;Thêm vào MH chính&quot;</strong>.
                      </li>
                      <li>
                        <strong>Trên Máy tính (Chrome / Edge):</strong> Bấm biểu tượng <strong>Cài đặt (🖥️↓)</strong> ở góc phải thanh địa chỉ.
                      </li>
                    </>
                  )}
                </ol>
              </div>
              <p className="text-[11px] text-slate-500">
                Ưu điểm: Đăng nhập Google, đồng bộ Realtime Database, quét mã vạch Camera và nhận cập nhật mới nhất hoàn toàn tự động.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

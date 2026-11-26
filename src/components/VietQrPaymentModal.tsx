import React, { useEffect, useState } from 'react';
import {
  Building2,
  Check,
  Copy,
  Download,
  MessageCircle,
  QrCode,
  Save,
  Settings,
  WifiOff,
  X,
} from 'lucide-react';
import { VietQrBankConfig } from '../types';
import { formatVND } from '../utils/businessLogic';
import {
  buildVietQrImageUrl,
  isValidVietQrConfig,
  resolveVietnamBankLabel,
  sanitizeVietQrText,
  VIETNAM_BANKS,
} from '../utils/smartPosFeatures';

export interface VietQrPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  amount: number;
  addInfo: string;
  customerPhone?: string;
  zaloMessage?: string;
  bankConfig?: VietQrBankConfig | null;
  onSaveBankConfig?: (config: VietQrBankConfig) => void;
  onNotifyToast?: (msg: string) => void;
}

export const VietQrPaymentModal: React.FC<VietQrPaymentModalProps> = ({
  isOpen,
  onClose,
  title = 'Quét mã VietQR thanh toán',
  subtitle,
  amount,
  addInfo,
  customerPhone,
  zaloMessage,
  bankConfig,
  onSaveBankConfig,
  onNotifyToast,
}) => {
  const hasValidConfig = isValidVietQrConfig(bankConfig);
  const [isEditingBank, setIsEditingBank] = useState(!hasValidConfig);
  const [bankCode, setBankCode] = useState(bankConfig?.bankCode || 'AGRIBANK');
  const [accountNumber, setAccountNumber] = useState(bankConfig?.accountNumber || '');
  const [accountName, setAccountName] = useState(bankConfig?.accountName || '');
  const [qrLoadError, setQrLoadError] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setQrLoadError(false);
    setCopiedField(null);
    const valid = isValidVietQrConfig(bankConfig);
    setIsEditingBank(!valid);
    if (bankConfig) {
      setBankCode(bankConfig.bankCode || 'AGRIBANK');
      setAccountNumber(bankConfig.accountNumber || '');
      setAccountName(bankConfig.accountName || '');
    }
  }, [isOpen, bankConfig]);

  if (!isOpen) return null;

  const safeAddInfo = sanitizeVietQrText(addInfo, 50);
  const safeAmount = Math.max(0, Math.round(Number(amount) || 0));
  const activeConfig: VietQrBankConfig | null = hasValidConfig ? bankConfig : null;
  const qrUrl = activeConfig
    ? buildVietQrImageUrl(activeConfig, { amount: safeAmount, addInfo: safeAddInfo })
    : '';

  const copyText = (text: string, label: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).catch(() => undefined);
    }
    setCopiedField(label);
    onNotifyToast?.(`Đã sao chép ${label}!`);
    window.setTimeout(() => setCopiedField(null), 2000);
  };

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedAcc = accountNumber.replace(/\s+/g, '').trim();
    if (cleanedAcc.length < 4) {
      onNotifyToast?.('Vui lòng nhập số tài khoản ngân hàng hợp lệ (tối thiểu 4 số).');
      return;
    }
    const matchedBank = VIETNAM_BANKS.find((b) => b.code === bankCode);
    const nextConfig: VietQrBankConfig = {
      bankCode,
      bankBin: matchedBank?.bin || bankCode,
      accountNumber: cleanedAcc,
      accountName: accountName.trim().toUpperCase(),
      template: 'compact2',
      updatedAt: new Date().toISOString(),
    };
    onSaveBankConfig?.(nextConfig);
    setIsEditingBank(false);
    setQrLoadError(false);
    onNotifyToast?.(
      `Đã lưu tài khoản nhận tiền VietQR (${resolveVietnamBankLabel(bankCode)} - ${cleanedAcc}) và đồng bộ!`
    );
  };

  const handleSendZalo = () => {
    const bankLines = activeConfig
      ? [
          '',
          'THÔNG TIN CHUYỂN KHOẢN VIETQR:',
          `• Ngân hàng: ${resolveVietnamBankLabel(activeConfig.bankCode)}`,
          `• Số TK: ${activeConfig.accountNumber}`,
          ...(activeConfig.accountName ? [`• Chủ TK: ${activeConfig.accountName}`] : []),
          ...(safeAmount > 0 ? [`• Số tiền: ${formatVND(safeAmount)}`] : []),
          `• Nội dung: ${safeAddInfo}`,
          ...(qrUrl ? [`• Ảnh mã QR: ${qrUrl}`] : []),
        ].join('\n')
      : '';

    const fullMsg = zaloMessage
      ? zaloMessage.includes('VIETQR')
        ? `${zaloMessage}${qrUrl ? `\n• Link ảnh QR: ${qrUrl}` : ''}`
        : `${zaloMessage}${bankLines}`
      : `${title}\nSố tiền: ${formatVND(safeAmount)}\nNội dung: ${safeAddInfo}${bankLines}`;

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(fullMsg).catch(() => undefined);
    }
    const digits = String(customerPhone || '').replace(/\D/g, '');
    const normalizedPhone = digits.startsWith('84')
      ? `0${digits.slice(2)}`
      : digits.length >= 9
      ? digits
      : '';
    if (normalizedPhone && typeof window !== 'undefined') {
      window.open(`https://zalo.me/${normalizedPhone}`, '_blank', 'noopener,noreferrer');
      onNotifyToast?.('Đã sao chép thông tin chuyển khoản VietQR & mở Zalo!');
    } else {
      onNotifyToast?.('Đã sao chép thông tin chuyển khoản VietQR vào bộ nhớ tạm!');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden my-auto">
        {/* Header */}
        <div className="px-4 py-3.5 bg-gradient-to-r from-emerald-700 to-teal-700 text-white flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
              <QrCode className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold truncate">{title}</h3>
              {subtitle && <p className="text-[11px] text-emerald-100 truncate">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onSaveBankConfig && hasValidConfig && (
              <button
                type="button"
                onClick={() => setIsEditingBank((v) => !v)}
                title="Đổi tài khoản ngân hàng nhận tiền"
                className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white transition-colors"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng cửa sổ VietQR"
              className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* Amount & AddInfo Banner */}
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-emerald-800">Số tiền thanh toán</div>
              <div className="text-xl font-extrabold font-mono text-emerald-900 tabular-nums">
                {formatVND(safeAmount)}
              </div>
            </div>
            <div className="text-right min-w-0">
              <div className="text-[11px] text-slate-500">Nội dung CK</div>
              <div className="text-xs font-mono font-bold text-slate-800 truncate max-w-[165px]">
                {safeAddInfo}
              </div>
            </div>
          </div>

          {isEditingBank || !activeConfig ? (
            <form onSubmit={handleSaveConfig} className="space-y-3">
              <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
                <Building2 className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
                <span>
                  Cấu hình <strong>1 lần duy nhất</strong> tài khoản ngân hàng cửa hàng để tạo mã
                  VietQR tự động trên Điện thoại, Web và tự in kèm Hóa đơn PDF/K80.
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Ngân hàng nhận tiền *
                </label>
                <select
                  value={bankCode}
                  onChange={(e) => setBankCode(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-medium bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {VIETNAM_BANKS.map((bank) => (
                    <option key={bank.code} value={bank.code}>
                      {bank.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Số tài khoản *
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  placeholder="VD: 6501234567890"
                  required
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tên chủ tài khoản (không dấu)
                </label>
                <input
                  type="text"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder="VD: CUA HANG VTNN TAM AN"
                  className="w-full px-3 py-2 text-xs uppercase bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                {hasValidConfig && (
                  <button
                    type="button"
                    onClick={() => setIsEditingBank(false)}
                    className="px-3 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
                  >
                    Hủy
                  </button>
                )}
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg inline-flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Lưu & Tạo mã VietQR</span>
                </button>
              </div>
            </form>
          ) : (
            <>
              {/* Live QR Image or Offline Fallback */}
              <div className="flex flex-col items-center justify-center p-3 rounded-xl bg-slate-50 border border-slate-200">
                {!qrLoadError ? (
                  <img
                    src={qrUrl}
                    alt={`Mã VietQR ${resolveVietnamBankLabel(activeConfig.bankCode)}`}
                    onError={() => setQrLoadError(true)}
                    className="w-full max-w-[270px] rounded-xl shadow-xs bg-white border border-slate-100 object-contain"
                  />
                ) : (
                  <div className="py-6 px-4 text-center space-y-2">
                    <WifiOff className="w-8 h-8 text-amber-500 mx-auto" />
                    <div className="text-xs font-bold text-slate-800">
                      Không tải được ảnh QR (đang ngoại tuyến)
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Khách hàng vẫn có thể chuyển khoản thủ công theo số tài khoản bên dưới:
                    </p>
                  </div>
                )}

                <div className="w-full mt-3 pt-3 border-t border-slate-200 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">Ngân hàng:</span>
                    <span className="font-bold text-slate-900">
                      {resolveVietnamBankLabel(activeConfig.bankCode)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">Số tài khoản:</span>
                    <button
                      type="button"
                      onClick={() => copyText(activeConfig.accountNumber, 'số tài khoản')}
                      className="inline-flex items-center gap-1 font-mono font-bold text-emerald-700 hover:text-emerald-800"
                    >
                      <span>{activeConfig.accountNumber}</span>
                      {copiedField === 'số tài khoản' ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                  {activeConfig.accountName && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500">Chủ tài khoản:</span>
                      <span className="font-semibold text-slate-800">
                        {activeConfig.accountName}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      `${resolveVietnamBankLabel(activeConfig.bankCode)} - STK: ${activeConfig.accountNumber}${
                        activeConfig.accountName ? ` - ${activeConfig.accountName}` : ''
                      } - So tien: ${formatVND(safeAmount)} - ND: ${safeAddInfo}`,
                      'thông tin chuyển khoản'
                    )
                  }
                  className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center justify-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Sao chép CK</span>
                </button>
                <button
                  type="button"
                  onClick={handleSendZalo}
                  className="px-3 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-lg inline-flex items-center justify-center gap-1.5"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>Gửi qua Zalo</span>
                </button>
              </div>

              {!qrLoadError && qrUrl && (
                <a
                  href={qrUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={`VietQR_${safeAddInfo.replace(/\s+/g, '_')}.png`}
                  className="w-full py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg inline-flex items-center justify-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Mở / Tải ảnh mã VietQR</span>
                </a>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

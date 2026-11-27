import React, { useState } from 'react';
import { Activity, CheckCircle2, Cloud, RefreshCw, Users, WifiOff, X } from 'lucide-react';

export const SYNC_COLLECTION_LABELS: Array<{ key: string; label: string }> = [
  { key: 'products', label: 'Vật tư' },
  { key: 'customers', label: 'Khách hàng' },
  { key: 'suppliers', label: 'Nhà cung cấp' },
  { key: 'sales', label: 'Hóa đơn bán' },
  { key: 'imports', label: 'Phiếu nhập' },
  { key: 'receiptVouchers', label: 'Phiếu thu' },
  { key: 'paymentVouchers', label: 'Phiếu chi' },
  { key: 'stockAdjustments', label: 'Kiểm kê' },
  { key: 'savedVouchers', label: 'Chứng từ in' },
];

export interface OnlineUserInfo {
  uid: string;
  displayName: string;
  warehouse: string;
}

interface CloudSyncStatusPanelProps {
  variant: 'modal' | 'inline';
  isOpen?: boolean;
  onClose?: () => void;
  rtdbSyncState: 'connecting' | 'live' | 'offline';
  isOnline: boolean;
  offlineQueueCount: number;
  lastPeerSyncLabel: string;
  lastCloudWriteAt: string | null;
  dataWipedAt: string;
  localCounts: Record<string, number>;
  onSyncNow: () => void;
  onVerifyWithCloud: () => Promise<Record<string, number>>;
  onlineUsers?: OnlineUserInfo[];
  presenceStatus?: 'pending' | 'ok' | 'blocked';
}

const formatTime = (iso: string | null): string => {
  if (!iso) return 'Chưa ghi trong phiên này';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('vi-VN');
};

export const CloudSyncStatusPanel: React.FC<CloudSyncStatusPanelProps> = ({
  variant,
  isOpen = true,
  onClose,
  rtdbSyncState,
  isOnline,
  offlineQueueCount,
  lastPeerSyncLabel,
  lastCloudWriteAt,
  dataWipedAt,
  localCounts,
  onSyncNow,
  onVerifyWithCloud,
  onlineUsers,
  presenceStatus,
}) => {
  const [cloudCounts, setCloudCounts] = useState<Record<string, number> | null>(null);
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  if (variant === 'modal' && !isOpen) return null;

  const handleVerify = async () => {
    setIsVerifying(true);
    try {
      const counts = await onVerifyWithCloud();
      setCloudCounts(counts);
      setVerifiedAt(new Date().toISOString());
    } finally {
      setIsVerifying(false);
    }
  };

  const mismatchTotal = cloudCounts
    ? SYNC_COLLECTION_LABELS.reduce(
        (sum, c) => sum + (cloudCounts[c.key] !== (localCounts[c.key] || 0) ? 1 : 0),
        0
      )
    : 0;

  const stateLabel =
    !isOnline || rtdbSyncState === 'offline'
      ? 'Ngoại tuyến'
      : rtdbSyncState === 'live'
      ? 'Đang kết nối trực tiếp (thời gian thực)'
      : 'Đang kết nối...';

  const body = (
    <div className="space-y-3.5 text-xs text-slate-700">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-900 font-bold">
          <Cloud className="w-3.5 h-3.5" />
          Nguồn dữ liệu chuẩn: Firebase Realtime Database (thời gian thực)
        </span>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-700 font-semibold">
          Firestore: đã ngừng lưu dữ liệu bán hàng
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/70">
          <div className="text-[11px] text-slate-500">Trạng thái kết nối</div>
          <div
            className={`font-bold flex items-center gap-1.5 ${
              rtdbSyncState === 'live' && isOnline ? 'text-emerald-800' : 'text-amber-800'
            }`}
          >
            {rtdbSyncState === 'live' && isOnline ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : (
              <WifiOff className="w-3.5 h-3.5" />
            )}
            {stateLabel}
          </div>
        </div>
        <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/70">
          <div className="text-[11px] text-slate-500">Lần ghi lên Cloud gần nhất (máy này)</div>
          <div className="font-bold text-slate-900">{formatTime(lastCloudWriteAt)}</div>
        </div>
        <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/70">
          <div className="text-[11px] text-slate-500">Thao tác đang chờ đồng bộ</div>
          <div className={`font-bold ${offlineQueueCount > 0 ? 'text-amber-800' : 'text-emerald-800'}`}>
            {offlineQueueCount} thao tác
          </div>
        </div>
        <div className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/70">
          <div className="text-[11px] text-slate-500">Người cập nhật gần nhất</div>
          <div className="font-bold text-slate-900">{lastPeerSyncLabel || 'Chưa có cập nhật từ máy khác'}</div>
        </div>
      </div>

      {dataWipedAt && (
        <div className="p-2.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-900">
          Dữ liệu kinh doanh được làm mới (xóa để nhập lại) lúc{' '}
          <strong>{formatTime(dataWipedAt)}</strong>. Mọi bản ghi cũ hơn mốc này không được nạp lại.
        </div>
      )}

      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 text-[11px] font-semibold text-slate-600 border-b border-slate-200">
              <th className="py-2 px-3">Loại dữ liệu</th>
              <th className="py-2 px-3 text-right">Máy này</th>
              <th className="py-2 px-3 text-right">Realtime DB</th>
              <th className="py-2 px-3">Trạng thái</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {SYNC_COLLECTION_LABELS.map((c) => {
              const local = localCounts[c.key] || 0;
              const cloud = cloudCounts ? cloudCounts[c.key] || 0 : null;
              const match = cloud === null ? null : cloud === local;
              return (
                <tr key={c.key}>
                  <td className="py-1.5 px-3 font-medium text-slate-800">{c.label}</td>
                  <td className="py-1.5 px-3 text-right font-mono">{local}</td>
                  <td className="py-1.5 px-3 text-right font-mono">{cloud === null ? '—' : cloud}</td>
                  <td className="py-1.5 px-3">
                    {match === null ? (
                      <span className="text-slate-400">Chưa kiểm tra</span>
                    ) : match ? (
                      <span className="text-emerald-700 font-semibold">✓ Khớp</span>
                    ) : (
                      <span className="text-rose-700 font-bold">
                        ⚠ Lệch {Math.abs((cloud || 0) - local)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {cloudCounts && (
        <div
          className={`p-2.5 rounded-lg border font-semibold ${
            mismatchTotal === 0
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          {mismatchTotal === 0
            ? `Máy này đang khớp 100% với Realtime Database (kiểm tra lúc ${formatTime(verifiedAt)}).`
            : `Có ${mismatchTotal} loại dữ liệu lệch với Cloud. Bấm “Đồng bộ ngay” rồi kiểm tra lại.`}
        </div>
      )}

      {presenceStatus === 'blocked' && (!onlineUsers || onlineUsers.length === 0) && (
        <div className="p-2.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-900">
          Chưa ghi được trạng thái “đang trực tuyến” (quy tắc Realtime Database chưa cho phép). Dữ liệu bán hàng
          vẫn đồng bộ bình thường.
        </div>
      )}
      {presenceStatus === 'ok' && (!onlineUsers || onlineUsers.length === 0) && (
        <div className="p-2.5 rounded-lg border border-sky-200 bg-sky-50/70 text-sky-900">
          Chưa có tài khoản nào đang trực tuyến.
        </div>
      )}

      {onlineUsers && onlineUsers.length > 0 && (
        <div className="p-2.5 rounded-lg border border-sky-200 bg-sky-50/70">
          <div className="font-bold text-sky-950 flex items-center gap-1.5 mb-1">
            <Users className="w-3.5 h-3.5" />
            Đang trực tuyến ({onlineUsers.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {onlineUsers.map((u) => (
              <span
                key={u.uid}
                className="px-2 py-0.5 rounded-full bg-white border border-sky-200 text-[11px] font-medium text-sky-900"
              >
                {u.displayName}
                {u.warehouse ? ` · ${u.warehouse}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onSyncNow}
          className="px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg inline-flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Đồng bộ ngay</span>
        </button>
        <button
          type="button"
          disabled={isVerifying}
          onClick={() => void handleVerify()}
          className="px-3.5 py-2 text-xs font-bold text-emerald-900 bg-white hover:bg-emerald-50 disabled:opacity-60 border border-emerald-300 rounded-lg inline-flex items-center gap-1.5"
        >
          <Activity className="w-3.5 h-3.5" />
          <span>{isVerifying ? 'Đang kiểm tra...' : 'Kiểm tra với Cloud'}</span>
        </button>
      </div>
    </div>
  );

  if (variant === 'inline') {
    return (
      <section
        aria-label="Trạng thái đồng bộ Cloud"
        className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-3"
      >
        <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>Trạng thái đồng bộ Cloud</span>
        </h2>
        {body}
      </section>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/55 p-2.5 sm:p-6 pt-10 sm:pt-14"
      role="dialog"
      aria-modal="true"
      aria-label="Trạng thái đồng bộ Cloud"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl max-h-[88dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 sm:px-5 py-3 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between sticky top-0">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>Trạng thái đồng bộ Cloud</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng bảng trạng thái đồng bộ"
            className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 sm:p-5">{body}</div>
      </div>
    </div>
  );
};

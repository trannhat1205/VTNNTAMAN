import React, { useEffect, useState } from 'react';
import { Check, HardDrive, AlignJustify, Rows3, RefreshCw, WifiOff } from 'lucide-react';
import {
  CloudSyncMeta,
  loadTableDensity,
  resolveRecordCloudSyncStatus,
  saveTableDensity,
  TableDensityMode,
} from '../utils/smartInsights';

interface CloudRecordSyncBadgeProps {
  recordId: string | readonly string[];
  syncMeta?: CloudSyncMeta;
}

export const CloudRecordSyncBadge: React.FC<CloudRecordSyncBadgeProps> = ({
  recordId,
  syncMeta,
}) => {
  const status = resolveRecordCloudSyncStatus(recordId, syncMeta);
  if (!status) return null;

  if (status === 'syncing') {
    return (
      <span
        title="Đang đẩy chứng từ lên đám mây Firebase thời gian thực..."
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200 whitespace-nowrap"
      >
        <RefreshCw className="w-2.5 h-2.5 shrink-0 animate-spin" />
        <span>Đang đồng bộ...</span>
      </span>
    );
  }

  if (status === 'offline_pending') {
    return (
      <span
        title="Đã lưu an toàn trên thiết bị — sẽ tự động đồng bộ lên Cloud ngay khi có mạng"
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 whitespace-nowrap"
      >
        <WifiOff className="w-2.5 h-2.5 shrink-0" />
        <span>Chờ mạng</span>
      </span>
    );
  }

  if (status === 'local_only') {
    return (
      <span
        title="Chứng từ đang lưu trên thiết bị này (đăng nhập Google để đồng bộ Cloud)"
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200 whitespace-nowrap"
      >
        <HardDrive className="w-2.5 h-2.5 shrink-0" />
        <span>Đã lưu máy</span>
      </span>
    );
  }

  return (
    <span
      title="Chứng từ đã được lưu & đồng bộ an toàn trên đám mây"
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80 whitespace-nowrap"
    >
      <Check className="w-2.5 h-2.5 shrink-0" />
      <span>Đã lưu Cloud ✓</span>
    </span>
  );
};

const DENSITY_EVENT_NAME = 'vtnn-table-density-change';

export function useTableDensity(): [TableDensityMode, (next: TableDensityMode) => void] {
  const [density, setDensityState] = useState<TableDensityMode>(() => loadTableDensity());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleSync = (e: Event) => {
      const detail = (e as CustomEvent<TableDensityMode>).detail;
      if (detail === 'compact' || detail === 'comfortable') {
        setDensityState(detail);
      } else {
        setDensityState(loadTableDensity());
      }
    };
    window.addEventListener(DENSITY_EVENT_NAME, handleSync);
    return () => window.removeEventListener(DENSITY_EVENT_NAME, handleSync);
  }, []);

  const setDensity = (next: TableDensityMode) => {
    setDensityState(next);
    saveTableDensity(next);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent<TableDensityMode>(DENSITY_EVENT_NAME, { detail: next }));
    }
  };

  return [density, setDensity];
}

interface TableDensityToggleProps {
  density: TableDensityMode;
  onChange: (next: TableDensityMode) => void;
}

export const TableDensityToggle: React.FC<TableDensityToggleProps> = ({ density, onChange }) => {
  return (
    <div
      role="group"
      aria-label="Chế độ hiển thị bảng Gọn hoặc Chi tiết"
      className="inline-flex items-center p-0.5 bg-slate-100 rounded-lg border border-slate-200 shrink-0"
    >
      <button
        type="button"
        onClick={() => onChange('comfortable')}
        title="Chế độ Chi tiết: hiển thị đầy đủ ghi chú, liên kết chứng từ"
        className={`px-2 py-1 text-[11px] font-semibold rounded-md inline-flex items-center gap-1 transition-colors whitespace-nowrap ${
          density === 'comfortable'
            ? 'bg-white text-emerald-800 shadow-2xs'
            : 'text-slate-600 hover:text-slate-900'
        }`}
      >
        <Rows3 className="w-3 h-3 shrink-0" />
        <span>Chi tiết</span>
      </button>
      <button
        type="button"
        onClick={() => onChange('compact')}
        title="Chế độ Gọn: thu gọn khoảng cách dòng để xem được nhiều dòng gấp đôi"
        className={`px-2 py-1 text-[11px] font-semibold rounded-md inline-flex items-center gap-1 transition-colors whitespace-nowrap ${
          density === 'compact'
            ? 'bg-white text-emerald-800 shadow-2xs'
            : 'text-slate-600 hover:text-slate-900'
        }`}
      >
        <AlignJustify className="w-3 h-3 shrink-0" />
        <span>Gọn</span>
      </button>
    </div>
  );
};

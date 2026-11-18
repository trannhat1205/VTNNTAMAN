import React, { useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellRing,
  CheckCheck,
  Clock,
  FileSpreadsheet,
  Package,
  Settings,
  X,
} from 'lucide-react';
import { AppNotification, NotificationCategory, NotificationPrefs } from '../types';

interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: AppNotification[];
  readIds: Set<string>;
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  prefs: NotificationPrefs;
  onUpdatePrefs: (newPrefs: NotificationPrefs) => void;
  onNavigateTab: (
    tab:
      | 'sales'
      | 'imports'
      | 'inventory'
      | 'debts'
      | 'customers'
      | 'reports'
      | 'vouchers'
      | 'staff_accounts'
  ) => void;
  onNavigateNotification?: (notification: AppNotification) => void;
  onSendTestPush: () => void;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  isOpen,
  onClose,
  notifications,
  readIds,
  onMarkAsRead,
  onMarkAllAsRead,
  prefs,
  onUpdatePrefs,
  onNavigateTab,
  onNavigateNotification,
  onSendTestPush,
}) => {
  const [activeFilter, setActiveFilter] = useState<'all' | NotificationCategory>('all');
  const [showSettings, setShowSettings] = useState(false);

  if (!isOpen) return null;

  const filtered = notifications.filter(
    (n) => activeFilter === 'all' || n.category === activeFilter
  );

  const unreadCount = notifications.filter((n) => !readIds.has(n.id)).length;

  const handleTogglePref = (key: keyof NotificationPrefs) => {
    if (typeof prefs[key] === 'boolean') {
      const nextValue = !prefs[key];
      if (key === 'browserPushEnabled' && nextValue && 'Notification' in window) {
        Notification.requestPermission();
      }
      onUpdatePrefs({
        ...prefs,
        [key]: nextValue,
        updatedAt: new Date().toISOString(),
      });
    }
  };

  const getCategoryIcon = (category: NotificationCategory, severity: AppNotification['severity']) => {
    const colorClass =
      severity === 'critical'
        ? 'text-red-600'
        : severity === 'warning'
        ? 'text-amber-600'
        : 'text-emerald-700';

    switch (category) {
      case 'supplier_debt':
      case 'customer_debt':
        return <Clock className={`w-4 h-4 shrink-0 ${colorClass}`} />;
      case 'low_stock':
        return <Package className={`w-4 h-4 shrink-0 ${colorClass}`} />;
      case 'periodic_report':
        return <FileSpreadsheet className={`w-4 h-4 shrink-0 ${colorClass}`} />;
    }
  };

  const getCategoryLabel = (category: NotificationCategory) => {
    switch (category) {
      case 'customer_debt':
        return 'Công nợ khách hàng';
      case 'supplier_debt':
        return 'Công nợ nhà cung cấp';
      case 'low_stock':
        return 'Cảnh báo tồn kho';
      case 'periodic_report':
        return 'Báo cáo định kỳ';
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label="Trung tâm thông báo đẩy và nhắc việc"
    >
      <div className="w-full max-w-lg bg-white h-full border-l border-slate-200 flex flex-col justify-between overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 whitespace-nowrap">
              <BellRing className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>Thông báo đẩy & Nhắc hẹn</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              <span>{unreadCount} thông báo chưa đọc</span>
              <span className="mx-1.5" aria-hidden="true">·</span>
              <span>Nhắc trước {prefs.leadDays} ngày</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSettings((prev) => !prev)}
              aria-label="Tùy chỉnh loại thông báo muốn nhận"
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                showSettings
                  ? 'bg-emerald-700 text-white border-emerald-700'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Tùy chỉnh nhận</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng bảng thông báo"
              className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Customizable Notification Preferences Panel */}
        {showSettings && (
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-900">
                Cấu hình các loại thông báo muốn nhận
              </h3>
              <button
                type="button"
                onClick={onSendTestPush}
                className="px-2.5 py-1 text-xs font-medium text-emerald-700 bg-white border border-emerald-200 rounded-md hover:bg-emerald-50 transition-colors whitespace-nowrap"
              >
                Gửi thử thông báo đẩy
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <label className="flex items-center justify-between p-2.5 bg-white border border-slate-200 rounded-lg cursor-pointer">
                <span className="text-xs font-medium text-slate-800">Nhắc nợ Khách hàng</span>
                <input
                  type="checkbox"
                  checked={prefs.debtCustomerEnabled}
                  onChange={() => handleTogglePref('debtCustomerEnabled')}
                  aria-label="Bật thông báo nhắc nợ khách hàng"
                  className="w-4 h-4 accent-emerald-700 rounded cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-2.5 bg-white border border-slate-200 rounded-lg cursor-pointer">
                <span className="text-xs font-medium text-slate-800">Nhắc nợ Nhà cung cấp</span>
                <input
                  type="checkbox"
                  checked={prefs.debtSupplierEnabled}
                  onChange={() => handleTogglePref('debtSupplierEnabled')}
                  aria-label="Bật thông báo nhắc nợ nhà cung cấp"
                  className="w-4 h-4 accent-emerald-700 rounded cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-2.5 bg-white border border-slate-200 rounded-lg cursor-pointer">
                <span className="text-xs font-medium text-slate-800">Cảnh báo tồn kho sắp hết</span>
                <input
                  type="checkbox"
                  checked={prefs.lowStockEnabled}
                  onChange={() => handleTogglePref('lowStockEnabled')}
                  aria-label="Bật thông báo cảnh báo tồn kho sắp hết"
                  className="w-4 h-4 accent-emerald-700 rounded cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-2.5 bg-white border border-slate-200 rounded-lg cursor-pointer">
                <span className="text-xs font-medium text-slate-800">Báo cáo định kỳ sẵn sàng</span>
                <input
                  type="checkbox"
                  checked={prefs.periodicReportEnabled}
                  onChange={() => handleTogglePref('periodicReportEnabled')}
                  aria-label="Bật thông báo báo cáo định kỳ đã sẵn sàng"
                  className="w-4 h-4 accent-emerald-700 rounded cursor-pointer"
                />
              </label>
            </div>

            <div className="flex items-center justify-between gap-4 pt-1">
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.browserPushEnabled}
                  onChange={() => handleTogglePref('browserPushEnabled')}
                  aria-label="Bật Web Push Notification trên trình duyệt"
                  className="w-4 h-4 accent-emerald-700 rounded cursor-pointer"
                />
                <span>Hiển thị thông báo đẩy trình duyệt (Web Push)</span>
              </label>

              <div className="flex items-center gap-2">
                <label htmlFor="notif-lead-days" className="text-xs text-slate-600 whitespace-nowrap">
                  Báo trước hạn nợ:
                </label>
                <select
                  id="notif-lead-days"
                  value={prefs.leadDays}
                  onChange={(e) =>
                    onUpdatePrefs({
                      ...prefs,
                      leadDays: Number(e.target.value),
                      updatedAt: new Date().toISOString(),
                    })
                  }
                  className="px-2 py-1 text-xs font-mono bg-white border border-slate-200 rounded-md text-slate-900"
                >
                  <option value={3}>3 ngày</option>
                  <option value={5}>5 ngày</option>
                  <option value={7}>7 ngày</option>
                  <option value={14}>14 ngày</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Filter Bar */}
        <div className="px-6 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2 overflow-x-auto">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {[
              { id: 'all', label: 'Tất cả' },
              { id: 'supplier_debt', label: 'Nợ NCC' },
              { id: 'customer_debt', label: 'Nợ Khách' },
              { id: 'low_stock', label: 'Tồn kho' },
              { id: 'periodic_report', label: 'Báo cáo' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveFilter(tab.id as 'all' | NotificationCategory)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  activeFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {unreadCount > 0 && (
            <button
              type="button"
              onClick={onMarkAllAsRead}
              className="text-xs font-medium text-emerald-700 hover:text-emerald-800 flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Đọc tất cả</span>
            </button>
          )}
        </div>

        {/* Notification List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-200">
          {filtered.length === 0 ? (
            <div className="py-16 px-6 text-center">
              <Bell className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-medium text-slate-800">Không có thông báo nào trong mục này</p>
              <p className="text-xs text-slate-500 mt-1">
                Bạn có thể bật/tắt các loại cảnh báo trong nút &ldquo;Tùy chỉnh nhận&rdquo; phía trên.
              </p>
            </div>
          ) : (
            filtered.map((item) => {
              const isRead = readIds.has(item.id);
              const handleOpenLinkedVoucher = () => {
                onMarkAsRead(item.id);
                if (onNavigateNotification) {
                  onNavigateNotification(item);
                } else if (item.actionTab) {
                  onNavigateTab(item.actionTab);
                }
                onClose();
              };
              return (
                <div
                  key={item.id}
                  className={`px-4 sm:px-6 py-4 transition-colors ${
                    isRead ? 'bg-white hover:bg-slate-50' : 'bg-emerald-50/40 hover:bg-emerald-50/70'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">{getCategoryIcon(item.category, item.severity)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 mb-1">
                        <span>
                          {getCategoryLabel(item.category)}
                          <span className="mx-1.5" aria-hidden="true">·</span>
                          <span
                            className={
                              item.severity === 'critical'
                                ? 'text-red-600 font-semibold'
                                : item.severity === 'warning'
                                ? 'text-amber-700 font-medium'
                                : 'text-emerald-700 font-medium'
                            }
                          >
                            {item.severity === 'critical'
                              ? 'Khẩn cấp'
                              : item.severity === 'warning'
                              ? 'Cần lưu ý'
                              : 'Định kỳ'}
                          </span>
                        </span>
                        <span className="font-mono tabular-nums">{item.timestamp.slice(0, 10)}</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleOpenLinkedVoucher}
                        className="text-left w-full group"
                      >
                        <h4 className="text-sm font-semibold text-slate-900 group-hover:text-emerald-800 group-hover:underline break-words">
                          {item.title}
                        </h4>
                        <p className="text-xs text-slate-600 mt-1 leading-relaxed break-words">
                          {item.message}
                        </p>
                      </button>

                      <div className="mt-2.5 flex flex-wrap items-center gap-3">
                        {item.actionTab && (
                          <button
                            type="button"
                            onClick={handleOpenLinkedVoucher}
                            className="px-2.5 py-1 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors"
                          >
                            {item.category === 'supplier_debt'
                              ? 'Mở phiếu nhập & Trả nợ NCC →'
                              : item.category === 'customer_debt'
                              ? 'Mở hóa đơn & Thu nợ KH →'
                              : item.category === 'low_stock'
                              ? 'Mở vật tư & Nhập kho ngay →'
                              : 'Mở báo cáo & Đối soát →'}
                          </button>
                        )}
                        {!isRead && (
                          <button
                            type="button"
                            onClick={() => onMarkAsRead(item.id)}
                            className="text-xs text-slate-500 hover:text-slate-800"
                          >
                            Đánh dấu đã đọc
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>Hệ thống tự động kiểm tra hạn công nợ & tồn kho mỗi phiên</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Boxes,
  CloudCheck,
  FileSpreadsheet,
  History,
  KeyRound,
  LayoutDashboard,
  LogIn,
  LogOut,
  Menu,
  Printer,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
  Warehouse,
  X,
} from 'lucide-react';
import {
  AppNotification,
  AuditActionCategory,
  AuditLogEntry,
  AuditTargetEntity,
  BackupEntry,
  BackupSnapshotPayload,
  CustomerProfile,
  ImportTransaction,
  NotificationPrefs,
  ProductItem,
  SaleTransaction,
  SavedVoucherRecord,
  StaffFunctionalPermission,
  StaffMember,
  StaffPositionRole,
  SupplierProfile,
  UserRole,
} from './types';
import {
  ADMIN_BACKUP_EMAIL,
  ADMIN_PRIMARY_PHONE,
  DEFAULT_NOTIFICATION_PREFS,
  DEFAULT_REFERENCE_DATE,
  INITIAL_AUDIT_LOGS,
  INITIAL_BACKUPS,
  INITIAL_CUSTOMER_GROUPS,
  INITIAL_CUSTOMERS,
  INITIAL_IMPORTS,
  INITIAL_PRODUCT_CATEGORIES,
  INITIAL_PRODUCTS,
  INITIAL_SALES,
  INITIAL_SAVED_VOUCHERS,
  INITIAL_STAFF,
  INITIAL_SUPPLIERS,
  INITIAL_WAREHOUSES,
} from './data/seedData';
import {
  applyDebtPayment,
  applyImportToInventory,
  applySaleToInventory,
  authenticateStaffByGoogleEmail,
  buildBackupSnapshotPayload,
  calculateImportSummary,
  calculateSaleSummary,
  canAccountCreateStaff,
  canPerformRoleAction,
  canViewAuditHistory,
  createAuditLogEntry,
  evaluateDebtUrgency,
  evaluateStaffAccessScope,
  evaluateStockAlert,
  formatVND,
  generateSmartNotifications,
  getPositionRoleLabel,
  updateImportRecord,
  updateSaleRecord,
} from './utils/businessLogic';
import {
  deleteBackupFileFromDrive,
  fetchUserFirestoreData,
  googleSignInWithRole,
  initAuth,
  logoutUser,
  syncCustomerToFirestore,
  syncImportToFirestore,
  syncNotificationPrefsToFirestore,
  syncProductToFirestore,
  syncSaleToFirestore,
  uploadBackupToGoogleDrive,
} from './services/firebaseService';
import { NotificationCenter } from './components/NotificationCenter';
import { CustomerModule } from './components/CustomerModule';
import { DebtModule } from './components/DebtModule';
import { ReportsAndBackupModule } from './components/ReportsAndBackupModule';
import { ImportLogView, SalesLogView } from './components/SalesImportViews';
import { InventoryView } from './components/InventoryView';
import { VoucherPrintCenter } from './components/VoucherPrintCenter';
import {
  GmailRecoveryLog,
  InitialLoginScreenPortal,
  StaffAccountManager,
} from './components/StaffAccountManager';
import { exportPeriodicReportExcel, exportPeriodicReportPDF } from './utils/exportReports';

type ActiveTab =
  | 'dashboard'
  | 'sales'
  | 'imports'
  | 'inventory'
  | 'customers'
  | 'debts'
  | 'vouchers'
  | 'staff_accounts'
  | 'reports'
  | 'backup_history';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isSessionLoggedIn, setIsSessionLoggedIn] = useState<boolean>(true);

  // Core Data State
  const [products, setProducts] = useState<ProductItem[]>(INITIAL_PRODUCTS);
  const [customers, setCustomers] = useState<CustomerProfile[]>(INITIAL_CUSTOMERS);
  const [sales, setSales] = useState<SaleTransaction[]>(INITIAL_SALES);
  const [imports, setImports] = useState<ImportTransaction[]>(INITIAL_IMPORTS);
  const [savedVouchers, setSavedVouchers] =
    useState<SavedVoucherRecord[]>(INITIAL_SAVED_VOUCHERS);
  const [backups, setBackups] = useState<BackupEntry[]>(INITIAL_BACKUPS);
  const [suppliers, setSuppliers] = useState<SupplierProfile[]>(INITIAL_SUPPLIERS);
  const [warehouses, setWarehouses] = useState<string[]>(INITIAL_WAREHOUSES);
  const [customerGroups, setCustomerGroups] = useState<string[]>(INITIAL_CUSTOMER_GROUPS);
  const [productCategories, setProductCategories] = useState<string[]>(
    INITIAL_PRODUCT_CATEGORIES
  );
  const [staffList, setStaffList] = useState<StaffMember[]>(() => {
    try {
      const saved = localStorage.getItem('vtnn_taman_staff_realtime_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((st: StaffMember) => {
            if (st.uid === 'staff_manager_01' || st.username === 'admin') {
              return {
                ...st,
                username: 'admin',
                displayName:
                  !st.displayName || st.displayName.startsWith('Trần Nhật')
                    ? 'Trần Đình Nhất'
                    : st.displayName,
                password:
                  !st.password || st.password === 'taman123' || st.password === '123456'
                    ? '885300'
                    : st.password,
                email: ADMIN_BACKUP_EMAIL,
                phone: '0393120246',
                role: 'manager',
                positionRole: 'primary_manager',
                assignedWarehouse: 'Tất cả kho',
                permissions: INITIAL_STAFF[0].permissions,
                active: true,
              };
            }
            const existingPerms = Array.isArray(st.permissions) ? st.permissions : [];
            const nextPerms: StaffFunctionalPermission[] = existingPerms.includes('view_assigned_reports')
              ? existingPerms
              : [...existingPerms, 'view_assigned_reports'];
            return {
              ...st,
              permissions: nextPerms,
            };
          });
        }
      }
    } catch {
      // Fallback to INITIAL_STAFF
    }
    return INITIAL_STAFF;
  });
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(() => {
    try {
      const saved = localStorage.getItem('vtnn_taman_audit_logs_v1');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // Fallback to INITIAL_AUDIT_LOGS
    }
    return INITIAL_AUDIT_LOGS;
  });
  const [currentStaffId, setCurrentStaffId] = useState<string>(INITIAL_STAFF[0].uid);
  const [saleFormResetKey, setSaleFormResetKey] = useState<number>(0);

  // Auth & Role State
  const [role, setRole] = useState<UserRole>('manager');
  const [isGoogleAuthenticated, setIsGoogleAuthenticated] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(ADMIN_BACKUP_EMAIL);

  const currentStaff = useMemo(
    () => staffList.find((s) => s.uid === currentStaffId) || staffList[0],
    [staffList, currentStaffId]
  );

  // Evaluate real-time functional permission scope for the active staff account
  const accessScope = useMemo(
    () => evaluateStaffAccessScope(currentStaff),
    [currentStaff]
  );

  // Keep role and activeTab synchronized in real time when permissions change
  useEffect(() => {
    const resolvedRole: UserRole = accessScope.canEditDeleteVouchers ? 'manager' : 'staff';
    if (role !== resolvedRole) {
      setRole(resolvedRole);
    }
    if (!accessScope.allowedTabs.includes(activeTab)) {
      setActiveTab((accessScope.allowedTabs[0] as ActiveTab) || 'dashboard');
    }
  }, [accessScope, activeTab, role]);

  // Real-time cross-tab synchronization of staff permissions via localStorage + BroadcastChannel
  useEffect(() => {
    try {
      localStorage.setItem('vtnn_taman_staff_realtime_v1', JSON.stringify(staffList));
    } catch {
      // ignore storage quota errors
    }
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        const bc = new BroadcastChannel('vtnn_taman_staff_channel');
        bc.postMessage({ type: 'STAFF_UPDATED', staffList });
        bc.close();
      } catch {
        // ignore BroadcastChannel errors
      }
    }
  }, [staffList]);

  // Real-time persistence & sync of operation audit history
  useEffect(() => {
    try {
      localStorage.setItem('vtnn_taman_audit_logs_v1', JSON.stringify(auditLogs));
    } catch {
      // ignore storage quota errors
    }
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        const bc = new BroadcastChannel('vtnn_taman_staff_channel');
        bc.postMessage({ type: 'AUDIT_LOGS_UPDATED', auditLogs });
        bc.close();
      } catch {
        // ignore BroadcastChannel errors
      }
    }
  }, [auditLogs]);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'vtnn_taman_staff_realtime_v1' && e.newValue) {
        try {
          const updated = JSON.parse(e.newValue);
          if (Array.isArray(updated) && updated.length > 0) {
            setStaffList(updated);
          }
        } catch {
          // ignore
        }
      }
      if (e.key === 'vtnn_taman_audit_logs_v1' && e.newValue) {
        try {
          const updatedLogs = JSON.parse(e.newValue);
          if (Array.isArray(updatedLogs) && updatedLogs.length > 0) {
            setAuditLogs(updatedLogs);
          }
        } catch {
          // ignore
        }
      }
    };
    window.addEventListener('storage', handleStorage);

    let bc: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        bc = new BroadcastChannel('vtnn_taman_staff_channel');
        bc.onmessage = (ev) => {
          if (ev.data?.type === 'STAFF_UPDATED' && Array.isArray(ev.data.staffList)) {
            setStaffList(ev.data.staffList);
          }
          if (ev.data?.type === 'AUDIT_LOGS_UPDATED' && Array.isArray(ev.data.auditLogs)) {
            setAuditLogs(ev.data.auditLogs);
          }
        };
      } catch {
        // ignore
      }
    }

    return () => {
      window.removeEventListener('storage', handleStorage);
      if (bc) bc.close();
    };
  }, []);

  // Determine warehouse lock:
  // Primary Manager ('primary_manager'), Deputy General Manager ('deputy_general_manager'),
  // or anyone with 'manage_all_warehouses' or assignedWarehouse === 'Tất cả kho' can view all warehouses.
  const lockedWarehouse = useMemo<string | null>(() => {
    if (
      currentStaff.positionRole === 'primary_manager' ||
      currentStaff.positionRole === 'deputy_general_manager' ||
      currentStaff.permissions?.includes('manage_all_warehouses') ||
      currentStaff.assignedWarehouse === 'Tất cả kho'
    ) {
      return null;
    }
    return currentStaff.assignedWarehouse || warehouses[0] || 'Tâm An Mỹ Ngãi';
  }, [currentStaff, warehouses]);

  // Visible data scoped by per-staff warehouse permission
  const visibleProducts = useMemo(() => {
    if (!lockedWarehouse) return products;
    return products.filter((p) => (p.warehouseName || 'Tâm An Mỹ Ngãi') === lockedWarehouse);
  }, [products, lockedWarehouse]);

  const visibleSales = useMemo(() => {
    if (!lockedWarehouse) return sales;
    return sales.filter((s) => (s.warehouseName || 'Tâm An Mỹ Ngãi') === lockedWarehouse);
  }, [sales, lockedWarehouse]);

  const visibleImports = useMemo(() => {
    if (!lockedWarehouse) return imports;
    return imports.filter((i) => (i.warehouseName || 'Tâm An Mỹ Ngãi') === lockedWarehouse);
  }, [imports, lockedWarehouse]);

  // Notification State
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPrefs>(
    DEFAULT_NOTIFICATION_PREFS
  );
  const [isNotifDrawerOpen, setIsNotifDrawerOpen] = useState(false);
  const [readNotifIds, setReadNotifIds] = useState<Set<string>>(new Set());
  const [toastBanner, setToastBanner] = useState<string | null>(null);
  const [autoDailyBackupEnabled, setAutoDailyBackupEnabled] = useState(true);

  // Cross-module navigation & deep-linked voucher state
  const [preselectedCustomerId, setPreselectedCustomerId] = useState<string | null>(null);
  const [preselectedProductId, setPreselectedProductId] = useState<string | null>(null);
  const [focusedDebtRecordId, setFocusedDebtRecordId] = useState<string | null>(null);
  const [focusedProductId, setFocusedProductId] = useState<string | null>(null);

  const scrollToTopOfPage = () => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
  };

  useEffect(() => {
    scrollToTopOfPage();
  }, [activeTab, saleFormResetKey]);

  useEffect(() => {
    const unsubscribe = initAuth(
      async (user) => {
        setIsGoogleAuthenticated(true);
        setCurrentUserEmail(user.email || ADMIN_BACKUP_EMAIL);
        try {
          const remote = await fetchUserFirestoreData(user.uid);
          if (remote) {
            if (remote.products.length > 0) setProducts(remote.products);
            if (remote.sales.length > 0) setSales(remote.sales);
            if (remote.imports.length > 0) setImports(remote.imports);
          }
        } catch (err) {
          console.error('Firestore initial sync error:', err);
        }
      },
      () => {
        setIsGoogleAuthenticated(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const showToast = (msg: string) => {
    setToastBanner(msg);
    setTimeout(() => {
      setToastBanner((prev) => (prev === msg ? null : prev));
    }, 4500);
  };

  // Generate live notifications based on user preferences
  const notifications = useMemo(
    () =>
      generateSmartNotifications(
        visibleProducts,
        visibleSales,
        visibleImports,
        backups,
        notificationPrefs,
        DEFAULT_REFERENCE_DATE
      ),
    [visibleProducts, visibleSales, visibleImports, backups, notificationPrefs]
  );

  const unreadNotifCount = useMemo(
    () => notifications.filter((n) => !readNotifIds.has(n.id)).length,
    [notifications, readNotifIds]
  );

  // Push Notification Helper (Web Notification API + In-App Toast)
  const triggerPushNotification = (title: string, body: string) => {
    showToast(`${title}: ${body}`);
    if (
      notificationPrefs.browserPushEnabled &&
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      try {
        new Notification(title, {
          body,
          icon: '/assets/aistudio/Logo_n_ng_nghi_p_T_m_An_a19723bb.png',
        });
      } catch {
        // Fallback already shown via toastBanner
      }
    }
  };

  // Deep-link navigation handler for Notifications & Debt Reminders
  const handleNavigateNotification = (notif: AppNotification) => {
    if (notif.category === 'supplier_debt' || notif.category === 'customer_debt') {
      if (notif.relatedId) {
        setFocusedDebtRecordId(notif.relatedId);
      }
      setActiveTab('debts');
      setIsNotifDrawerOpen(false);
      return;
    }
    if (notif.category === 'low_stock') {
      if (notif.relatedId) {
        setFocusedProductId(notif.relatedId);
      }
      setActiveTab('inventory');
      setIsNotifDrawerOpen(false);
      return;
    }
    if (notif.actionTab) {
      setActiveTab(notif.actionTab);
    }
    setIsNotifDrawerOpen(false);
  };

  // Dynamic Group, Category & Warehouse Handlers
  const handleAddWarehouse = (warehouseName: string) => {
    const trimmed = warehouseName.trim();
    if (!trimmed) return;
    setWarehouses((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    showToast(`Đã bổ sung kho mới: ${trimmed}`);
  };

  const handleAddCustomerGroup = (groupName: string) => {
    const trimmed = groupName.trim();
    if (!trimmed) return;
    setCustomerGroups((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    showToast(`Đã tạo nhóm khách hàng mới: ${trimmed}`);
  };

  const handleAddProductCategory = (catName: string) => {
    const trimmed = catName.trim();
    if (!trimmed) return;
    setProductCategories((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    showToast(`Đã tạo nhóm vật tư mới: ${trimmed}`);
  };

  const recordAuditLog = (params: {
    actionCategory:
      | 'create'
      | 'update'
      | 'delete'
      | 'debt_payment'
      | 'permission'
      | 'backup'
      | 'restore';
    targetEntity: AuditTargetEntity | 'debt';
    targetCode: string;
    warehouseName?: string;
    summary: string;
    details?: string;
    snapshotData?: string;
  }) => {
    const categoryMap: Record<typeof params.actionCategory, AuditActionCategory> = {
      create: 'create_record',
      update: 'edit_record',
      delete: 'delete_record',
      debt_payment: 'debt_settlement',
      permission: 'permission_change',
      backup: 'backup_restore',
      restore: 'backup_restore',
    };
    const resolvedEntity: AuditTargetEntity =
      params.targetEntity === 'debt' ? 'sale' : params.targetEntity;

    let snapshotObject: unknown = undefined;
    if (params.snapshotData) {
      try {
        snapshotObject = JSON.parse(params.snapshotData);
      } catch {
        snapshotObject = params.snapshotData;
      }
    }

    const entry = createAuditLogEntry({
      actor: currentStaff,
      category: categoryMap[params.actionCategory],
      targetEntity: resolvedEntity,
      targetCode: params.targetCode,
      actionTitle: params.summary,
      details: params.details || params.summary,
      warehouseName:
        params.warehouseName ||
        lockedWarehouse ||
        currentStaff.assignedWarehouse ||
        'Tất cả kho',
      snapshotObject,
    });
    setAuditLogs((prev) => [entry, ...prev]);
  };

  // Handlers
  const handleCreateSale = (payload: {
    customerId: string;
    customerName: string;
    customerPhone: string;
    productId: string;
    quantity: number;
    unitPrice: number;
    paidAmount: number;
    dueDate: string;
    note: string;
    warehouseName: string;
  }): SaleTransaction => {
    const nowIso = new Date().toISOString();
    const { updatedProducts, updatedProduct } = applySaleToInventory(
      products,
      payload.productId,
      payload.quantity,
      nowIso
    );
    const summary = calculateSaleSummary(
      payload.quantity,
      payload.unitPrice,
      payload.paidAmount
    );

    const newSale: SaleTransaction = {
      id: `sale_${Date.now()}`,
      invoiceCode: `HD-2611-00${sales.length + 1}`,
      customerId: payload.customerId,
      customerName: payload.customerName,
      customerPhone: payload.customerPhone,
      productId: updatedProduct.id,
      productName: updatedProduct.name,
      unit: updatedProduct.unit,
      quantity: payload.quantity,
      unitPrice: payload.unitPrice,
      totalAmount: summary.totalAmount,
      paidAmount: summary.paidAmount,
      debtAmount: summary.debtAmount,
      dueDate: payload.dueDate,
      status: summary.status,
      note: payload.note,
      warehouseName:
        lockedWarehouse ||
        payload.warehouseName ||
        updatedProduct.warehouseName ||
        'Tâm An Mỹ Ngãi',
      staffName: currentStaff.displayName,
      ownerId: 'demo_owner',
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    setProducts(updatedProducts);
    setSales((prev) => [newSale, ...prev]);

    recordAuditLog({
      actionCategory: 'create',
      targetEntity: 'sale',
      targetCode: newSale.invoiceCode,
      warehouseName: newSale.warehouseName,
      summary: `Tạo hóa đơn bán hàng ${newSale.invoiceCode} cho ${newSale.customerName} (${formatVND(
        newSale.totalAmount
      )})`,
      details: `Vật tư: ${newSale.quantity} ${newSale.unit} ${newSale.productName} · Đã thu: ${formatVND(
        newSale.paidAmount
      )} · Ghi nợ: ${formatVND(newSale.debtAmount)}`,
      snapshotData: JSON.stringify(newSale),
    });

    setCustomers((prev) =>
      prev.map((c) =>
        c.id === payload.customerId
          ? {
              ...c,
              totalPurchased: c.totalPurchased + summary.totalAmount,
              totalDebt: c.totalDebt + summary.debtAmount,
              updatedAt: nowIso,
            }
          : c
      )
    );

    const stockAlert = evaluateStockAlert(updatedProduct);
    if (stockAlert !== 'normal' && notificationPrefs.lowStockEnabled) {
      triggerPushNotification(
        `Cảnh báo tồn kho: ${updatedProduct.name}`,
        `Chỉ còn ${updatedProduct.stock} ${updatedProduct.unit} tại ${newSale.warehouseName}.`
      );
    } else {
      showToast(
        `Đã lưu hóa đơn ${newSale.invoiceCode} tại ${newSale.warehouseName} (${formatVND(
          newSale.totalAmount
        )})`
      );
    }

    if (isGoogleAuthenticated) {
      syncProductToFirestore(updatedProduct, false).catch(console.error);
      syncSaleToFirestore(newSale, true).catch(console.error);
    }
    return newSale;
  };

  const handleUpdateSale = (
    saleId: string,
    changes: {
      invoiceCode?: string;
      warehouseName?: string;
      customerName?: string;
      customerPhone?: string;
      productName?: string;
      unit?: string;
      quantity: number;
      unitPrice: number;
      paidAmount: number;
      dueDate: string;
      note: string;
    }
  ) => {
    if (!canPerformRoleAction(role, 'edit_record')) {
      showToast('Chỉ Quản lý mới có quyền chỉnh sửa hóa đơn chứng từ đã lưu.');
      return;
    }
    const existing = sales.find((s) => s.id === saleId);
    const nowIso = new Date().toISOString();
    setSales((prev) =>
      prev.map((s) => (s.id === saleId ? updateSaleRecord(s, changes, nowIso) : s))
    );
    if (existing) {
      const updated = updateSaleRecord(existing, changes, nowIso);
      recordAuditLog({
        actionCategory: 'update',
        targetEntity: 'sale',
        targetCode: updated.invoiceCode,
        warehouseName: updated.warehouseName,
        summary: `Chỉnh sửa hóa đơn bán hàng ${updated.invoiceCode} (${updated.customerName})`,
        details: `Trước khi sửa: SL ${existing.quantity} · Tổng ${formatVND(
          existing.totalAmount
        )} · Nợ ${formatVND(existing.debtAmount)} -> Sau khi sửa: SL ${
          updated.quantity
        } · Tổng ${formatVND(updated.totalAmount)} · Nợ ${formatVND(updated.debtAmount)}`,
        snapshotData: JSON.stringify(existing),
      });
    }
    showToast('Quản lý đã cập nhật chỉnh sửa hóa đơn bán hàng thành công.');
  };

  const handleDeleteSale = (saleId: string) => {
    if (!canPerformRoleAction(role, 'delete_record')) return;
    const target = sales.find((s) => s.id === saleId);
    setSales((prev) => prev.filter((s) => s.id !== saleId));
    if (target) {
      recordAuditLog({
        actionCategory: 'delete',
        targetEntity: 'sale',
        targetCode: target.invoiceCode,
        warehouseName: target.warehouseName,
        summary: `Xóa hóa đơn bán hàng ${target.invoiceCode} của khách ${target.customerName} (${formatVND(
          target.totalAmount
        )})`,
        details: `Hóa đơn bị xóa: ${target.invoiceCode} · Vật tư: ${target.quantity} ${
          target.unit
        } ${target.productName} · Đã thu: ${formatVND(target.paidAmount)} · Còn nợ: ${formatVND(
          target.debtAmount
        )}. Đã lưu bản chụp dữ liệu gốc để Quản lý chính (${ADMIN_BACKUP_EMAIL}) kiểm tra & khôi phục.`,
        snapshotData: JSON.stringify(target),
      });
    }
    showToast('Đã xóa hóa đơn khỏi nhật ký bán hàng (Đã ghi vào Lịch sử thao tác).');
  };

  const handleCreateImport = (payload: {
    supplierName: string;
    supplierPhone: string;
    productId: string;
    quantity: number;
    unitCost: number;
    paidAmount: number;
    dueDate: string;
    note: string;
    warehouseName: string;
  }): ImportTransaction => {
    const nowIso = new Date().toISOString();
    const { updatedProducts, updatedProduct } = applyImportToInventory(
      products,
      payload.productId,
      payload.quantity,
      payload.unitCost,
      nowIso
    );
    const summary = calculateImportSummary(
      payload.quantity,
      payload.unitCost,
      payload.paidAmount
    );

    const newImport: ImportTransaction = {
      id: `imp_${Date.now()}`,
      receiptCode: `PN-2611-00${imports.length + 1}`,
      supplierName: payload.supplierName,
      supplierPhone: payload.supplierPhone,
      productId: updatedProduct.id,
      productName: updatedProduct.name,
      unit: updatedProduct.unit,
      quantity: payload.quantity,
      unitCost: payload.unitCost,
      totalCost: summary.totalCost,
      paidAmount: summary.paidAmount,
      debtAmount: summary.debtAmount,
      dueDate: payload.dueDate,
      status: summary.status,
      note: payload.note,
      warehouseName:
        lockedWarehouse ||
        payload.warehouseName ||
        updatedProduct.warehouseName ||
        'Tâm An Mỹ Ngãi',
      staffName: currentStaff.displayName,
      ownerId: 'demo_owner',
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    setProducts(updatedProducts);
    setImports((prev) => [newImport, ...prev]);

    recordAuditLog({
      actionCategory: 'create',
      targetEntity: 'import',
      targetCode: newImport.receiptCode,
      warehouseName: newImport.warehouseName,
      summary: `Tạo phiếu nhập kho ${newImport.receiptCode} từ ${newImport.supplierName} (${formatVND(
        newImport.totalCost
      )})`,
      details: `Vật tư nhập: +${newImport.quantity} ${newImport.unit} ${
        newImport.productName
      } · Đã trả NCC: ${formatVND(newImport.paidAmount)} · Nợ NCC: ${formatVND(
        newImport.debtAmount
      )}`,
      snapshotData: JSON.stringify(newImport),
    });

    showToast(
      `Đã nhập kho ${newImport.warehouseName}: +${payload.quantity} ${updatedProduct.unit} ${updatedProduct.name} (${newImport.receiptCode})`
    );

    if (isGoogleAuthenticated) {
      syncProductToFirestore(updatedProduct, false).catch(console.error);
      syncImportToFirestore(newImport, true).catch(console.error);
    }
    return newImport;
  };

  const handleUpdateImport = (
    importId: string,
    changes: {
      receiptCode?: string;
      warehouseName?: string;
      supplierName?: string;
      supplierPhone?: string;
      productName?: string;
      unit?: string;
      quantity: number;
      unitCost: number;
      paidAmount: number;
      dueDate: string;
      note: string;
    }
  ) => {
    if (!canPerformRoleAction(role, 'edit_record')) {
      showToast('Chỉ Quản lý mới có quyền chỉnh sửa phiếu nhập kho đã lưu.');
      return;
    }
    const existing = imports.find((imp) => imp.id === importId);
    const nowIso = new Date().toISOString();
    setImports((prev) =>
      prev.map((imp) => (imp.id === importId ? updateImportRecord(imp, changes, nowIso) : imp))
    );
    if (existing) {
      const updated = updateImportRecord(existing, changes, nowIso);
      recordAuditLog({
        actionCategory: 'update',
        targetEntity: 'import',
        targetCode: updated.receiptCode,
        warehouseName: updated.warehouseName,
        summary: `Chỉnh sửa phiếu nhập kho ${updated.receiptCode} (${updated.supplierName})`,
        details: `Trước khi sửa: SL ${existing.quantity} · Tổng ${formatVND(
          existing.totalCost
        )} · Nợ NCC ${formatVND(existing.debtAmount)} -> Sau khi sửa: SL ${
          updated.quantity
        } · Tổng ${formatVND(updated.totalCost)} · Nợ NCC ${formatVND(updated.debtAmount)}`,
        snapshotData: JSON.stringify(existing),
      });
    }
    showToast('Quản lý đã cập nhật chỉnh sửa phiếu nhập kho thành công.');
  };

  const handleDeleteImport = (importId: string) => {
    if (!canPerformRoleAction(role, 'delete_record')) return;
    const target = imports.find((imp) => imp.id === importId);
    setImports((prev) => prev.filter((imp) => imp.id !== importId));
    if (target) {
      recordAuditLog({
        actionCategory: 'delete',
        targetEntity: 'import',
        targetCode: target.receiptCode,
        warehouseName: target.warehouseName,
        summary: `Xóa phiếu nhập kho ${target.receiptCode} của NCC ${target.supplierName} (${formatVND(
          target.totalCost
        )})`,
        details: `Phiếu nhập bị xóa: ${target.receiptCode} · Vật tư: ${target.quantity} ${
          target.unit
        } ${target.productName} · Còn nợ NCC: ${formatVND(
          target.debtAmount
        )}. Đã lưu bản chụp dữ liệu gốc để Quản lý chính khôi phục khi cần.`,
        snapshotData: JSON.stringify(target),
      });
    }
    showToast('Đã xóa phiếu nhập kho khỏi hệ thống (Đã ghi vào Lịch sử thao tác).');
  };

  const handleCreateSupplierInline = (
    data: Omit<SupplierProfile, 'id' | 'createdAt'>
  ): SupplierProfile => {
    const created: SupplierProfile = {
      ...data,
      id: `sup_${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    setSuppliers((prev) => [created, ...prev]);
    showToast(`Đã thêm Nhà cung cấp mới: ${created.name}`);
    return created;
  };

  const handleSaveProduct = (
    data: Omit<ProductItem, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>,
    editingId?: string
  ): ProductItem => {
    const nowIso = new Date().toISOString();
    const resolvedWh = lockedWarehouse || data.warehouseName || warehouses[0] || 'Tâm An Mỹ Ngãi';
    if (editingId) {
      const existing = products.find((p) => p.id === editingId);
      let updatedRef: ProductItem | null = null;
      setProducts((prev) =>
        prev.map((p) => {
          if (p.id !== editingId) return p;
          const updated = { ...p, ...data, warehouseName: resolvedWh, updatedAt: nowIso };
          updatedRef = updated;
          if (isGoogleAuthenticated) {
            syncProductToFirestore(updated, false).catch(console.error);
          }
          return updated;
        })
      );
      if (existing) {
        recordAuditLog({
          actionCategory: 'update',
          targetEntity: 'product',
          targetCode: data.code || existing.code,
          warehouseName: resolvedWh,
          summary: `Cập nhật vật tư ${data.name} (${data.code || existing.code}) tại ${resolvedWh}`,
          details: `Tồn kho: ${existing.stock} -> ${data.stock} ${data.unit} · Giá bán: ${formatVND(
            existing.sellPrice
          )} -> ${formatVND(data.sellPrice)}`,
          snapshotData: JSON.stringify(existing),
        });
      }
      showToast(`Đã cập nhật thông tin vật tư: ${data.name} (${resolvedWh})`);
      return (
        updatedRef || {
          ...data,
          warehouseName: resolvedWh,
          id: editingId,
          ownerId: 'demo_owner',
          createdAt: nowIso,
          updatedAt: nowIso,
        }
      );
    } else {
      const created: ProductItem = {
        ...data,
        warehouseName: resolvedWh,
        id: `prod_${Date.now()}`,
        ownerId: 'demo_owner',
        createdAt: nowIso,
        createdAt_unused: undefined,
        updatedAt: nowIso,
      } as ProductItem;
      setProducts((prev) => [created, ...prev]);
      recordAuditLog({
        actionCategory: 'create',
        targetEntity: 'product',
        targetCode: created.code,
        warehouseName: resolvedWh,
        summary: `Thêm vật tư mới ${created.name} (${created.code}) tại ${resolvedWh}`,
        details: `Tồn đầu: ${created.stock} ${created.unit} · Giá nhập: ${formatVND(
          created.importPrice
        )} · Giá bán: ${formatVND(created.sellPrice)}`,
        snapshotData: JSON.stringify(created),
      });
      showToast(`Đã thêm vật tư mới: ${created.name} (${resolvedWh})`);
      if (isGoogleAuthenticated) {
        syncProductToFirestore(created, true).catch(console.error);
      }
      return created;
    }
  };

  const handleDeleteProduct = (productId: string) => {
    if (!canPerformRoleAction(role, 'delete_record')) return;
    const target = products.find((p) => p.id === productId);
    setProducts((prev) => prev.filter((p) => p.id !== productId));
    if (target) {
      recordAuditLog({
        actionCategory: 'delete',
        targetEntity: 'product',
        targetCode: target.code,
        warehouseName: target.warehouseName,
        summary: `Xóa mặt hàng vật tư ${target.name} (${target.code}) khỏi kho ${target.warehouseName}`,
        details: `Tồn kho lúc xóa: ${target.stock} ${target.unit} · Giá bán: ${formatVND(
          target.sellPrice
        )}. Đã lưu dữ liệu gốc để khôi phục khi cần.`,
        snapshotData: JSON.stringify(target),
      });
    }
    showToast('Quản lý đã xóa mặt hàng vật tư khỏi danh mục kho (Đã lưu Lịch sử thao tác).');
  };

  const handleSaveCustomer = (
    data: Omit<CustomerProfile, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>,
    editingId?: string
  ): CustomerProfile => {
    const nowIso = new Date().toISOString();
    if (editingId) {
      const existing = customers.find((c) => c.id === editingId);
      let updatedRef: CustomerProfile | null = null;
      setCustomers((prev) =>
        prev.map((c) => {
          if (c.id !== editingId) return c;
          const updated = { ...c, ...data, updatedAt: nowIso };
          updatedRef = updated;
          if (isGoogleAuthenticated) {
            syncCustomerToFirestore(updated, false).catch(console.error);
          }
          return updated;
        })
      );
      if (existing) {
        recordAuditLog({
          actionCategory: 'update',
          targetEntity: 'customer',
          targetCode: data.code || existing.code,
          summary: `Cập nhật hồ sơ khách hàng ${data.name} (${data.phone})`,
          details: `Nhóm KH: ${data.group} · Địa chỉ: ${data.address}`,
          snapshotData: JSON.stringify(existing),
        });
      }
      showToast(`Đã cập nhật hồ sơ khách hàng: ${data.name}`);
      return (
        updatedRef || {
          ...data,
          id: editingId,
          ownerId: 'demo_owner',
          createdAt: nowIso,
          updatedAt: nowIso,
        }
      );
    } else {
      const created: CustomerProfile = {
        ...data,
        id: `cust_${Date.now()}`,
        ownerId: 'demo_owner',
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      setCustomers((prev) => [created, ...prev]);
      recordAuditLog({
        actionCategory: 'create',
        targetEntity: 'customer',
        targetCode: created.code,
        summary: `Thêm hồ sơ khách hàng mới ${created.name} (${created.phone})`,
        details: `Nhóm KH: ${created.group} · Địa chỉ: ${created.address}`,
        snapshotData: JSON.stringify(created),
      });
      showToast(`Đã thêm khách hàng mới: ${created.name}`);
      if (isGoogleAuthenticated) {
        syncCustomerToFirestore(created, true).catch(console.error);
      }
      return created;
    }
  };

  const handleDeleteCustomer = (customerId: string) => {
    if (!canPerformRoleAction(role, 'delete_record')) return;
    const target = customers.find((c) => c.id === customerId);
    setCustomers((prev) => prev.filter((c) => c.id !== customerId));
    if (target) {
      recordAuditLog({
        actionCategory: 'delete',
        targetEntity: 'customer',
        targetCode: target.code,
        summary: `Xóa hồ sơ khách hàng ${target.name} (${target.phone})`,
        details: `Tổng mua: ${formatVND(target.totalPurchased)} · Dư nợ: ${formatVND(
          target.totalDebt
        )}. Đã lưu dữ liệu gốc để khôi phục khi cần.`,
        snapshotData: JSON.stringify(target),
      });
    }
    showToast('Quản lý đã xóa hồ sơ khách hàng (Đã ghi vào Lịch sử thao tác).');
  };

  const handleSaveVoucher = (
    voucherData: Omit<SavedVoucherRecord, 'id' | 'createdAt' | 'updatedAt'>,
    editingId?: string
  ): SavedVoucherRecord => {
    const nowIso = new Date().toISOString();
    if (editingId) {
      const existing = savedVouchers.find((v) => v.id === editingId);
      const updatedRecord: SavedVoucherRecord = {
        ...voucherData,
        id: editingId,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      if (!canPerformRoleAction(role, 'edit_record')) {
        showToast('Chỉ Quản lý mới có quyền sửa chứng từ đã lưu.');
        return updatedRecord;
      }
      setSavedVouchers((prev) =>
        prev.map((v) =>
          v.id === editingId ? { ...v, ...voucherData, updatedAt: nowIso } : v
        )
      );
      if (existing) {
        recordAuditLog({
          actionCategory: 'update',
          targetEntity: 'voucher',
          targetCode: voucherData.voucherCode,
          summary: `Chỉnh sửa chứng từ in ${voucherData.voucherCode} (${voucherData.partnerName})`,
          details: `Tổng thanh toán: ${formatVND(voucherData.totalOrPrevDebt)} · Đã trả: ${formatVND(
            voucherData.paidOrCollected
          )}`,
          snapshotData: JSON.stringify(existing),
        });
      }
      showToast(`Quản lý đã cập nhật chứng từ ${voucherData.voucherCode}`);
      return updatedRecord;
    } else {
      const created: SavedVoucherRecord = {
        ...voucherData,
        id: `vc_${Date.now()}`,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      setSavedVouchers((prev) => [created, ...prev]);
      recordAuditLog({
        actionCategory: 'create',
        targetEntity: 'voucher',
        targetCode: created.voucherCode,
        summary: `Lưu chứng từ in ${created.voucherCode} (${created.partnerName})`,
        details: `Loại phiếu: ${created.voucherType} · Tổng tiền: ${formatVND(
          created.totalOrPrevDebt
        )}`,
        snapshotData: JSON.stringify(created),
      });
      return created;
    }
  };

  const handleDeleteVoucher = (voucherId: string) => {
    if (!canPerformRoleAction(role, 'delete_record')) return;
    const target = savedVouchers.find((v) => v.id === voucherId);
    setSavedVouchers((prev) => prev.filter((v) => v.id !== voucherId));
    if (target) {
      recordAuditLog({
        actionCategory: 'delete',
        targetEntity: 'voucher',
        targetCode: target.voucherCode,
        summary: `Xóa chứng từ đã lưu ${target.voucherCode} (${target.partnerName})`,
        details: `Chứng từ bị xóa: ${target.voucherCode} · Tổng tiền: ${formatVND(
          target.totalOrPrevDebt
        )}. Đã lưu bản chụp dữ liệu gốc để khôi phục.`,
        snapshotData: JSON.stringify(target),
      });
    }
    showToast('Quản lý đã xóa chứng từ khỏi danh sách lưu trữ (Đã ghi Lịch sử thao tác).');
  };

  const handleCollectCustomerDebt = (saleId: string, amount: number, note: string) => {
    const existing = sales.find((s) => s.id === saleId);
    const nowIso = new Date().toISOString();
    setSales((prev) =>
      prev.map((s) => {
        if (s.id !== saleId) return s;
        const updated = applyDebtPayment(
          { ...s, note: note || s.note },
          amount,
          nowIso
        );
        if (isGoogleAuthenticated) {
          syncSaleToFirestore(updated, false).catch(console.error);
        }
        return updated;
      })
    );
    if (existing) {
      recordAuditLog({
        actionCategory: 'debt_payment',
        targetEntity: 'debt',
        targetCode: existing.invoiceCode,
        warehouseName: existing.warehouseName,
        summary: `Thu nợ khách hàng ${existing.customerName} (+${formatVND(amount)}) cho HĐ ${
          existing.invoiceCode
        }`,
        details: `Nợ trước khi thu: ${formatVND(existing.debtAmount)} · Số tiền thu: ${formatVND(
          amount
        )} · Ghi chú: ${note || 'Thu nợ trực tiếp'}`,
        snapshotData: JSON.stringify(existing),
      });
    }
    showToast(`Đã ghi nhận thu nợ khách hàng: +${formatVND(amount)}`);
  };

  const handlePaySupplierDebt = (importId: string, amount: number, note: string) => {
    const existing = imports.find((imp) => imp.id === importId);
    const nowIso = new Date().toISOString();
    setImports((prev) =>
      prev.map((imp) => {
        if (imp.id !== importId) return imp;
        const updated = applyDebtPayment(
          { ...imp, note: note || imp.note },
          amount,
          nowIso
        );
        if (isGoogleAuthenticated) {
          syncImportToFirestore(updated, false).catch(console.error);
        }
        return updated;
      })
    );
    if (existing) {
      recordAuditLog({
        actionCategory: 'debt_payment',
        targetEntity: 'debt',
        targetCode: existing.receiptCode,
        warehouseName: existing.warehouseName,
        summary: `Thanh toán nợ NCC ${existing.supplierName} (${formatVND(amount)}) cho phiếu ${
          existing.receiptCode
        }`,
        details: `Nợ NCC trước khi trả: ${formatVND(
          existing.debtAmount
        )} · Số tiền trả: ${formatVND(amount)} · Ghi chú: ${note || 'Thanh toán nợ NCC'}`,
        snapshotData: JSON.stringify(existing),
      });
    }
    showToast(`Đã thanh toán công nợ Nhà cung cấp: ${formatVND(amount)}`);
  };

  // Excel Direct Import Handlers across all 5 modules
  const handleImportProductsFromExcel = (rows: Record<string, unknown>[]): number => {
    const nowIso = new Date().toISOString();
    const added: ProductItem[] = [];
    rows.forEach((r, idx) => {
      const name = String(
        r['Tên Vật Tư Nông Nghiệp'] || r['Tên Vật Tư'] || r['name'] || ''
      ).trim();
      if (!name) return;
      const cat = String(r['Nhóm Vật Tư'] || r['Nhóm Hàng'] || 'Phân bón').trim();
      if (cat && !productCategories.includes(cat)) {
        setProductCategories((prev) => (prev.includes(cat) ? prev : [...prev, cat]));
      }
      const wh =
        lockedWarehouse ||
        String(r['Kho Lưu Trữ'] || r['Kho'] || warehouses[0] || 'Tâm An Mỹ Ngãi').trim();
      if (wh && !warehouses.includes(wh)) {
        setWarehouses((prev) => (prev.includes(wh) ? prev : [...prev, wh]));
      }
      added.push({
        id: `prod_xl_${Date.now()}_${idx}`,
        code: String(r['Mã VT'] || r['Mã Vật Tư'] || `VT-XL${products.length + idx + 1}`).trim(),
        name,
        category: cat || 'Phân bón',
        warehouseName: wh,
        unit: String(r['Đơn Vị Tính'] || r['Đơn Vị'] || 'Bao').trim(),
        importPrice: Math.max(0, Number(r['Giá Nhập (VNĐ)'] || r['Giá Nhập (đ)'] || 0)),
        sellPrice: Math.max(0, Number(r['Giá Bán Lẻ (VNĐ)'] || r['Giá Bán (đ)'] || 0)),
        stock: Math.max(0, Number(r['Tồn Kho Ban Đầu'] || r['Tồn Kho Hiện Tại'] || 10)),
        minStock: Math.max(0, Number(r['Mức Cảnh Báo Tối Thiểu'] || r['Mức Tối Thiểu'] || 5)),
        supplierName: String(r['Nhà Cung Cấp Chính'] || 'Nhà cung cấp VTNN').trim(),
        ownerId: 'demo_owner',
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    });
    if (added.length > 0) {
      setProducts((prev) => [...added, ...prev]);
      showToast(`Đã tải lên ${added.length} mặt hàng vật tư từ tệp Excel!`);
    }
    return added.length;
  };

  const handleImportCustomersFromExcel = (rows: Record<string, unknown>[]): number => {
    const nowIso = new Date().toISOString();
    const added: CustomerProfile[] = [];
    rows.forEach((r, idx) => {
      const name = String(r['Họ Tên Khách Hàng'] || r['Tên Khách Hàng'] || '').trim();
      const phone = String(r['Số Điện Thoại'] || r['Số Điện Thoại KH'] || '').trim();
      if (!name) return;
      const grp = String(r['Nhóm Khách Hàng'] || r['Nhóm KH'] || 'Nhà nông').trim();
      if (grp && !customerGroups.includes(grp)) {
        setCustomerGroups((prev) => (prev.includes(grp) ? prev : [...prev, grp]));
      }
      added.push({
        id: `cust_xl_${Date.now()}_${idx}`,
        code: String(r['Mã KH'] || `KH-XL${customers.length + idx + 1}`).trim(),
        name,
        phone: phone || '0900000000',
        email: String(r['Email'] || '').trim(),
        address: String(r['Địa Chỉ'] || '').trim(),
        group: grp || 'Nhà nông',
        note: String(r['Ghi Chú'] || 'Nhập từ biểu mẫu Excel').trim(),
        totalPurchased: Math.max(0, Number(r['Tổng Mua (VNĐ)'] || 0)),
        totalDebt: Math.max(0, Number(r['Dư Nợ Hiện Tại (VNĐ)'] || 0)),
        ownerId: 'demo_owner',
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    });
    if (added.length > 0) {
      setCustomers((prev) => [...added, ...prev]);
      showToast(`Đã tải lên ${added.length} hồ sơ khách hàng từ tệp Excel!`);
    }
    return added.length;
  };

  const handleImportSalesFromExcel = (rows: Record<string, unknown>[]): number => {
    const nowIso = new Date().toISOString();
    const addedSales: SaleTransaction[] = [];
    rows.forEach((r, idx) => {
      const custName = String(r['Tên Khách Hàng'] || '').trim();
      const prodName = String(r['Tên Vật Tư Nông Nghiệp'] || r['Sản Phẩm'] || '').trim();
      const qty = Math.max(1, Number(r['Số Lượng Bán'] || r['Số Lượng'] || 1));
      const price = Math.max(0, Number(r['Đơn Giá Bán (VNĐ)'] || r['Đơn Giá (đ)'] || 0));
      if (!custName || !prodName) return;
      const paid = Math.max(0, Number(r['Khách Đã Trả (VNĐ)'] || r['Đã Thu (đ)'] || qty * price));
      const sum = calculateSaleSummary(qty, price, paid);
      addedSales.push({
        id: `sale_xl_${Date.now()}_${idx}`,
        invoiceCode: `HD-XL-${sales.length + idx + 1}`,
        customerId: `cust_xl_${idx}`,
        customerName: custName,
        customerPhone: String(r['Số Điện Thoại KH'] || r['Số Điện Thoại'] || '').trim(),
        productId: `prod_xl_${idx}`,
        productName: prodName,
        unit: String(r['Đơn Vị'] || 'Bao').trim(),
        quantity: qty,
        unitPrice: price,
        totalAmount: sum.totalAmount,
        paidAmount: sum.paidAmount,
        debtAmount: sum.debtAmount,
        dueDate: String(r['Hạn Thanh Toán Nợ (YYYY-MM-DD)'] || '2026-11-30').trim(),
        status: sum.status,
        note: String(r['Ghi Chú Đơn Hàng'] || 'Nhập từ Excel').trim(),
        warehouseName:
          lockedWarehouse ||
          String(r['Kho Xuất Bán'] || warehouses[0] || 'Tâm An Mỹ Ngãi').trim(),
        staffName: currentStaff.displayName,
        ownerId: 'demo_owner',
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    });
    if (addedSales.length > 0) {
      setSales((prev) => [...addedSales, ...prev]);
      showToast(`Đã tải lên ${addedSales.length} hóa đơn bán hàng từ tệp Excel!`);
    }
    return addedSales.length;
  };

  const handleImportWarehouseFromExcel = (rows: Record<string, unknown>[]): number => {
    const nowIso = new Date().toISOString();
    const addedImports: ImportTransaction[] = [];
    rows.forEach((r, idx) => {
      const prodName = String(r['Tên Vật Tư Nhập Kho'] || r['Sản Phẩm'] || '').trim();
      const supName = String(r['Nhà Cung Cấp'] || '').trim();
      const qty = Math.max(1, Number(r['Số Lượng Nhập'] || 1));
      const cost = Math.max(0, Number(r['Đơn Giá Nhập (VNĐ)'] || r['Giá Nhập (đ)'] || 0));
      if (!prodName || !supName) return;
      const paid = Math.max(
        0,
        Number(r['Đã Thanh Toán NCC (VNĐ)'] || r['Đã Trả NCC (đ)'] || qty * cost)
      );
      const sum = calculateImportSummary(qty, cost, paid);
      addedImports.push({
        id: `imp_xl_${Date.now()}_${idx}`,
        receiptCode: `PN-XL-${imports.length + idx + 1}`,
        supplierName: supName,
        supplierPhone: String(r['SĐT Nhà Cung Cấp'] || r['SĐT NCC'] || '').trim(),
        productId: `prod_xl_${idx}`,
        productName: prodName,
        unit: String(r['Đơn Vị Tính'] || r['Đơn Vị'] || 'Bao').trim(),
        quantity: qty,
        unitCost: cost,
        totalCost: sum.totalCost,
        paidAmount: sum.paidAmount,
        debtAmount: sum.debtAmount,
        dueDate: String(r['Hạn Trả Nợ NCC (YYYY-MM-DD)'] || '2026-11-30').trim(),
        status: sum.status,
        note: String(r['Ghi Chú Lô Nhập'] || 'Nhập từ Excel').trim(),
        warehouseName:
          lockedWarehouse ||
          String(r['Kho Nhập Hàng'] || warehouses[0] || 'Tâm An Mỹ Ngãi').trim(),
        staffName: currentStaff.displayName,
        ownerId: 'demo_owner',
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    });
    if (addedImports.length > 0) {
      setImports((prev) => [...addedImports, ...prev]);
      showToast(`Đã tải lên ${addedImports.length} phiếu nhập kho từ tệp Excel!`);
    }
    return addedImports.length;
  };

  const handleImportDebtPaymentsFromExcel = (rows: Record<string, unknown>[]): number => {
    let updatedCount = 0;
    const nowIso = new Date().toISOString();
    rows.forEach((r) => {
      const code = String(r['Mã Hóa Đơn / Mã Phiếu Nhập'] || '').trim();
      const amount = Math.max(0, Number(r['Số Tiền Thanh Toán Đợt Này (VNĐ)'] || 0));
      const note = String(r['Ghi Chú Thanh Toán'] || 'Cập nhật từ Excel').trim();
      if (!code || amount <= 0) return;

      if (code.startsWith('HD-')) {
        setSales((prev) =>
          prev.map((s) =>
            s.invoiceCode === code
              ? applyDebtPayment({ ...s, note: note || s.note }, amount, nowIso)
              : s
          )
        );
        updatedCount += 1;
      } else if (code.startsWith('PN-')) {
        setImports((prev) =>
          prev.map((i) =>
            i.receiptCode === code
              ? applyDebtPayment({ ...i, note: note || i.note }, amount, nowIso)
              : i
          )
        );
        updatedCount += 1;
      }
    });
    if (updatedCount > 0) {
      showToast(`Đã cập nhật thanh toán cho ${updatedCount} chứng từ công nợ từ Excel!`);
    }
    return updatedCount;
  };

  // Staff Account Login, Password Change, Gmail Recovery & Per-Staff [X] Permission Handlers
  const handleLoginStaff = (usernameOrEmail: string, password: string) => {
    const query = usernameOrEmail.trim().toLowerCase();
    const matched = staffList.find(
      (s) =>
        s.username.toLowerCase() === query ||
        (s.email && s.email.toLowerCase() === query) ||
        (s.phone && s.phone.replace(/\D+/g, '') === query.replace(/\D+/g, '') && query.length >= 9)
    );
    if (!matched) {
      return {
        ok: false,
        message: `Không tìm thấy tài khoản hoặc Gmail "${usernameOrEmail}".`,
      };
    }
    if (!matched.active) {
      return {
        ok: false,
        message: `Tài khoản "${matched.username}" đã bị khóa bởi Quản lý chính.`,
      };
    }
    if (matched.password !== password) {
      return { ok: false, message: 'Mật khẩu không chính xác. Vui lòng kiểm tra lại.' };
    }
    setCurrentStaffId(matched.uid);
    setRole(matched.role);
    setCurrentUserEmail(matched.email || ADMIN_BACKUP_EMAIL);
    setIsSessionLoggedIn(true);
    showToast(
      `Đã đăng nhập: ${matched.displayName} — Kho làm việc: ${matched.assignedWarehouse}`
    );
    return {
      ok: true,
      message: `Đăng nhập thành công (${matched.displayName})! Kho làm việc: ${matched.assignedWarehouse}.`,
    };
  };

  const handleGoogleLoginByEmail = (email: string) => {
    const authRes = authenticateStaffByGoogleEmail(staffList, email);
    if (!authRes.ok || !authRes.staff) {
      return {
        ok: false,
        message: authRes.message,
      };
    }
    const matched = authRes.staff;
    setCurrentStaffId(matched.uid);
    setRole(matched.role);
    setCurrentUserEmail(matched.email || ADMIN_BACKUP_EMAIL);
    setIsGoogleAuthenticated(true);
    setIsSessionLoggedIn(true);
    showToast(
      `Đã đăng nhập bằng Google (${matched.email}): ${matched.displayName} — Kho: ${matched.assignedWarehouse}`
    );
    return {
      ok: true,
      message: authRes.message,
    };
  };

  const handlePrimaryPhoneOtpLogin = (phone: string, otpCode: string) => {
    const primaryOwner =
      staffList.find(
        (s) =>
          s.email.toLowerCase() === ADMIN_BACKUP_EMAIL ||
          s.phone.replace(/\D+/g, '') === ADMIN_PRIMARY_PHONE
      ) || staffList[0];
    setCurrentStaffId(primaryOwner.uid);
    setRole('manager');
    setCurrentUserEmail(ADMIN_BACKUP_EMAIL);
    setIsSessionLoggedIn(true);
    showToast(
      `Đã xác thực mã OTP (${otpCode}) từ SĐT chính ${phone} — Đăng nhập Quản lý chính (${ADMIN_BACKUP_EMAIL})!`
    );
    return {
      ok: true,
      message: `Xác thực mã OTP thành công! Đã đăng nhập Quản lý chính (${ADMIN_BACKUP_EMAIL} / ${ADMIN_PRIMARY_PHONE}).`,
    };
  };

  const handleLogoutApp = () => {
    if (isGoogleAuthenticated) {
      logoutUser().catch(() => {});
    }
    setIsGoogleAuthenticated(false);
    setIsSessionLoggedIn(false);
    setMobileMenuOpen(false);
    showToast(
      `Đã thoát đăng nhập khỏi tài khoản @${currentStaff.username} (${currentStaff.displayName}). Vui lòng đăng nhập lại để tiếp tục.`
    );
  };

  const handleResetPasswordViaGmail = (payload: {
    uid: string;
    gmail: string;
    newPassword: string;
  }): { ok: boolean; message: string; log?: GmailRecoveryLog } => {
    const target = staffList.find((s) => s.uid === payload.uid);
    if (!target) {
      return { ok: false, message: 'Không tìm thấy tài khoản nhân viên.' };
    }
    if (!payload.gmail || !payload.gmail.includes('@')) {
      return {
        ok: false,
        message: 'Vui lòng nhập địa chỉ Gmail hợp lệ để nhận mật khẩu khôi phục.',
      };
    }
    if (payload.newPassword.length < 4) {
      return { ok: false, message: 'Mật khẩu tạo lại phải có tối thiểu 4 ký tự.' };
    }

    const nowIso = new Date().toISOString();
    setStaffList((prev) =>
      prev.map((s) =>
        s.uid === payload.uid
          ? {
              ...s,
              email: payload.gmail,
              password: payload.newPassword,
              updatedAt: nowIso,
            }
          : s
      )
    );

    const log: GmailRecoveryLog = {
      id: `rec_${Date.now()}`,
      username: target.username,
      displayName: target.displayName,
      recipientGmail: payload.gmail,
      newPasswordIssued: payload.newPassword,
      sentAt: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
    };

    showToast(
      `Đã tạo lại mật khẩu mới cho @${target.username} và gửi về Gmail: ${payload.gmail}`
    );

    return {
      ok: true,
      message: `Đã gửi mật khẩu mới (${payload.newPassword}) của tài khoản @${target.username} về địa chỉ Gmail: ${payload.gmail}!`,
      log,
    };
  };

  const handleUpdateStaffProfile = (payload: {
    uid: string;
    displayName: string;
    phone: string;
    email: string;
    newPassword?: string;
  }) => {
    const target = staffList.find((s) => s.uid === payload.uid);
    if (!target) {
      return { ok: false, message: 'Không tìm thấy tài khoản cần cập nhật.' };
    }
    const nowIso = new Date().toISOString();
    setStaffList((prev) =>
      prev.map((s) =>
        s.uid === payload.uid
          ? {
              ...s,
              displayName: payload.displayName || s.displayName,
              phone: payload.phone || s.phone,
              email: payload.email || s.email,
              password: payload.newPassword ? payload.newPassword : s.password,
              updatedAt: nowIso,
            }
          : s
      )
    );
    recordAuditLog({
      actionCategory: 'update',
      targetEntity: 'staff',
      targetCode: `@${target.username}`,
      warehouseName: target.assignedWarehouse,
      summary: `Bổ sung Gmail cá nhân (${payload.email}) & cập nhật thông tin nhân viên @${target.username}`,
      details: `Họ tên: ${payload.displayName || target.displayName} · Gmail: ${
        payload.email || target.email
      } · SĐT: ${payload.phone || target.phone}${
        payload.newPassword ? ' · Đã cập nhật mật khẩu mới' : ''
      }`,
    });
    showToast(
      `Đã lưu bổ sung Gmail (${payload.email}) & thông tin cá nhân cho @${target.username}!`
    );
    return {
      ok: true,
      message: `Đã cập nhật thông tin cá nhân & bổ sung Gmail (${payload.email}) cho tài khoản @${target.username} thành công!`,
    };
  };

  const handleChangeStaffPassword = (
    uid: string,
    currentPass: string,
    newPass: string
  ) => {
    const target = staffList.find((s) => s.uid === uid);
    if (!target) return { ok: false, message: 'Không tìm thấy tài khoản.' };
    if (target.password !== currentPass) {
      return { ok: false, message: 'Mật khẩu hiện tại không đúng.' };
    }
    const nowIso = new Date().toISOString();
    setStaffList((prev) =>
      prev.map((s) => (s.uid === uid ? { ...s, password: newPass, updatedAt: nowIso } : s))
    );
    showToast(`Đã đổi mật khẩu mới thành công cho tài khoản @${target.username}!`);
    return {
      ok: true,
      message: `Đã cập nhật mật khẩu mới thành công cho tài khoản @${target.username}!`,
    };
  };

  const handleCreateStaffAccount = (payload: {
    username: string;
    password: string;
    displayName: string;
    phone: string;
    email: string;
    role: UserRole;
    positionRole: StaffPositionRole;
    permissions: StaffFunctionalPermission[];
    assignedWarehouse: string;
  }) => {
    if (!canAccountCreateStaff(currentStaff)) {
      return {
        ok: false,
        message: `Chỉ tài khoản Quản lý chính (${ADMIN_BACKUP_EMAIL} hoặc SĐT ${ADMIN_PRIMARY_PHONE}) mới có quyền tạo tài khoản và phân quyền cho nhân sự.`,
      };
    }
    if (!payload.username || !payload.password || !payload.displayName) {
      return {
        ok: false,
        message: 'Vui lòng điền đầy đủ Họ tên, Tên đăng nhập và Mật khẩu ban đầu.',
      };
    }
    const exists = staffList.some(
      (s) => s.username.toLowerCase() === payload.username.toLowerCase()
    );
    if (exists) {
      return {
        ok: false,
        message: `Tên đăng nhập "${payload.username}" đã tồn tại. Vui lòng chọn tên khác.`,
      };
    }
    const nowIso = new Date().toISOString();
    const created: StaffMember = {
      uid: `staff_${Date.now()}`,
      username: payload.username,
      password: payload.password,
      displayName: payload.displayName,
      phone: payload.phone,
      email: payload.email || `${payload.username}@vtnntaman.vn`,
      role: payload.role,
      positionRole: payload.positionRole,
      permissions: payload.permissions,
      assignedWarehouse: payload.assignedWarehouse || warehouses[0] || 'Tâm An Mỹ Ngãi',
      active: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    setStaffList((prev) => [...prev, created]);
    recordAuditLog({
      actionCategory: 'permission',
      targetEntity: 'staff',
      targetCode: `@${created.username}`,
      warehouseName: created.assignedWarehouse,
      summary: `Cấp tài khoản nhân sự mới @${created.username} (${created.displayName})`,
      details: `Vai trò: ${getPositionRoleLabel(created.positionRole)} · Kho: ${
        created.assignedWarehouse
      } · Quyền [X]: ${(created.permissions || []).join(', ')}`,
      snapshotData: JSON.stringify(created),
    });
    showToast(
      `Đã tạo tài khoản @${created.username} (${getPositionRoleLabel(
        created.positionRole
      )}) — Kho: ${created.assignedWarehouse}`
    );
    return {
      ok: true,
      message: `Đã cấp tài khoản @${created.username} (Mật khẩu: ${created.password}) · Vai trò: ${getPositionRoleLabel(
        created.positionRole
      )} · Kho quản lý: ${created.assignedWarehouse}`,
    };
  };

  const handleUpdateStaffWarehouse = (uid: string, warehouseName: string) => {
    if (!canAccountCreateStaff(currentStaff)) {
      showToast(`Chỉ Quản lý chính (${ADMIN_BACKUP_EMAIL}) mới có quyền đổi phân quyền kho.`);
      return;
    }
    const target = staffList.find((s) => s.uid === uid);
    const nowIso = new Date().toISOString();
    setStaffList((prev) =>
      prev.map((s) =>
        s.uid === uid ? { ...s, assignedWarehouse: warehouseName, updatedAt: nowIso } : s
      )
    );
    if (target) {
      recordAuditLog({
        actionCategory: 'permission',
        targetEntity: 'staff',
        targetCode: `@${target.username}`,
        warehouseName,
        summary: `Đổi phân quyền kho của @${target.username} sang "${warehouseName}"`,
        details: `Kho trước đó: ${target.assignedWarehouse} -> Kho mới: ${warehouseName}`,
        snapshotData: JSON.stringify(target),
      });
    }
    showToast(`Đã cập nhật phân quyền kho "${warehouseName}" cho nhân sự.`);
  };

  const handleUpdateStaffPermissions = (
    uid: string,
    positionRole: StaffPositionRole,
    permissions: StaffFunctionalPermission[],
    assignedWarehouse: string
  ) => {
    if (!canAccountCreateStaff(currentStaff)) {
      showToast(`Chỉ Quản lý chính (${ADMIN_BACKUP_EMAIL}) mới có quyền phân quyền cho tài khoản.`);
      return;
    }
    const target = staffList.find((s) => s.uid === uid);
    const nowIso = new Date().toISOString();
    const resolvedRole: UserRole =
      positionRole === 'primary_manager' ||
      positionRole === 'deputy_general_manager' ||
      permissions.includes('edit_delete_vouchers') ||
      permissions.includes('manage_all_warehouses')
        ? 'manager'
        : 'staff';

    setStaffList((prev) =>
      prev.map((s) =>
        s.uid === uid
          ? {
              ...s,
              role: resolvedRole,
              positionRole,
              permissions,
              assignedWarehouse,
              updatedAt: nowIso,
            }
          : s
      )
    );
    if (uid === currentStaff.uid) {
      setRole(resolvedRole);
    }
    if (target) {
      recordAuditLog({
        actionCategory: 'permission',
        targetEntity: 'staff',
        targetCode: `@${target.username}`,
        warehouseName: assignedWarehouse,
        summary: `Cập nhật phân quyền [X] cho @${target.username} (${target.displayName})`,
        details: `Vai trò: ${getPositionRoleLabel(
          positionRole
        )} · Kho: ${assignedWarehouse} · Quyền [X] được cấp (${
          permissions.length
        }): ${permissions.join(', ')}`,
        snapshotData: JSON.stringify(target),
      });
    }
    showToast('Quản lý chính đã lưu phân quyền [X] vai trò & chức năng cho tài khoản!');
  };

  const handleResetStaffPasswordByManager = (uid: string, newPass: string) => {
    if (!canAccountCreateStaff(currentStaff)) return;
    const nowIso = new Date().toISOString();
    setStaffList((prev) =>
      prev.map((s) => (s.uid === uid ? { ...s, password: newPass, updatedAt: nowIso } : s))
    );
    showToast('Đã cấp lại mật khẩu mới cho nhân sự.');
  };

  const handleToggleStaffActive = (uid: string) => {
    if (!canAccountCreateStaff(currentStaff)) return;
    const target = staffList.find((s) => s.uid === uid);
    setStaffList((prev) =>
      prev.map((s) => (s.uid === uid ? { ...s, active: !s.active } : s))
    );
    if (target) {
      recordAuditLog({
        actionCategory: 'permission',
        targetEntity: 'staff',
        targetCode: `@${target.username}`,
        warehouseName: target.assignedWarehouse,
        summary: `${target.active ? 'Khóa tạm thời' : 'Mở khóa'} tài khoản nhân sự @${
          target.username
        }`,
        details: `Tài khoản: ${target.displayName} (@${target.username})`,
      });
    }
    showToast('Đã cập nhật trạng thái hoạt động tài khoản nhân sự.');
  };

  const buildCurrentBackupPayload = (customFileName?: string): BackupSnapshotPayload => {
    const nowIso = new Date().toISOString();
    const defaultName =
      customFileName || `VTNN_TamAn_Backup_${nowIso.slice(0, 10)}_FullAudit.json`;
    return buildBackupSnapshotPayload({
      fileName: defaultName,
      exportedByEmail: ADMIN_BACKUP_EMAIL,
      exportedAt: nowIso.slice(0, 16).replace('T', ' '),
      warehouses,
      customerGroups,
      productCategories,
      products,
      customers,
      suppliers,
      sales,
      imports,
      savedVouchers,
      staffList,
      auditLogs,
    });
  };

  const handleTriggerDriveBackup = async () => {
    const snapshotPayload = buildCurrentBackupPayload();
    try {
      const entry = await uploadBackupToGoogleDrive({
        products,
        customers,
        sales,
        imports,
        triggerType: 'manual',
      });
      const enrichedEntry: BackupEntry = {
        ...entry,
        auditLogCount: auditLogs.length,
        snapshotPayload,
      };
      setBackups((prev) => [enrichedEntry, ...prev]);
      recordAuditLog({
        actionCategory: 'backup',
        targetEntity: 'backup',
        targetCode: enrichedEntry.fileName,
        summary: `Sao lưu dữ liệu & ${auditLogs.length} bản ghi lịch sử thao tác lên Google Drive (${enrichedEntry.fileName})`,
        details: `Tổng bản ghi kinh doanh: ${enrichedEntry.recordCount} · Lịch sử thao tác đính kèm: ${auditLogs.length} thao tác · Tài khoản nhận: ${ADMIN_BACKUP_EMAIL}`,
      });
      triggerPushNotification(
        'Sao lưu Google Drive thành công',
        `Đã lưu tệp ${enrichedEntry.fileName} (kèm ${auditLogs.length} lịch sử thao tác) tới ${ADMIN_BACKUP_EMAIL}`
      );
    } catch (err) {
      const nowStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const fallbackEntry: BackupEntry = {
        id: `bk_local_${Date.now()}`,
        fileName: `VTNN_TamAn_Backup_${new Date().toISOString().slice(0, 10)}.json`,
        driveFileId: `local_${Date.now()}`,
        targetEmail: ADMIN_BACKUP_EMAIL,
        triggerType: 'manual',
        recordCount: products.length + customers.length + sales.length + imports.length,
        auditLogCount: auditLogs.length,
        ownerId: 'demo_owner',
        createdAt: nowStr,
        status: 'completed',
        snapshotPayload,
      };
      setBackups((prev) => [fallbackEntry, ...prev]);
      recordAuditLog({
        actionCategory: 'backup',
        targetEntity: 'backup',
        targetCode: fallbackEntry.fileName,
        summary: `Tạo bản sao lưu đầy đủ ${fallbackEntry.fileName} (kèm ${auditLogs.length} lịch sử thao tác)`,
        details: `Tổng bản ghi kinh doanh: ${fallbackEntry.recordCount} · Lịch sử thao tác: ${auditLogs.length} thao tác.`,
      });
      showToast(
        err instanceof Error
          ? err.message
          : `Đã tạo bản sao lưu ${fallbackEntry.fileName} (kèm ${auditLogs.length} lịch sử thao tác).`
      );
    }
  };

  const handleDeleteBackupRecord = async (backup: BackupEntry) => {
    try {
      await deleteBackupFileFromDrive(backup.driveFileId);
      setBackups((prev) => prev.filter((b) => b.id !== backup.id));
      recordAuditLog({
        actionCategory: 'delete',
        targetEntity: 'backup',
        targetCode: backup.fileName,
        summary: `Xóa tệp sao lưu ${backup.fileName}`,
        details: `Tệp sao lưu tạo lúc ${backup.createdAt} (${backup.recordCount} bản ghi)`,
      });
      showToast(`Đã xóa bản sao lưu ${backup.fileName}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lỗi khi xóa tệp sao lưu');
    }
  };

  const handleDownloadBackupFile = (backup?: BackupEntry) => {
    if (!canViewAuditHistory(currentStaff)) {
      showToast(
        `Chỉ tài khoản Quản lý chính (${ADMIN_BACKUP_EMAIL}) mới có quyền tải tệp sao lưu về máy tính.`
      );
      return;
    }
    const fileName =
      backup?.fileName ||
      `VTNN_TamAn_Backup_${new Date().toISOString().slice(0, 10)}_FullAudit.json`;

    const payload: BackupSnapshotPayload =
      backup?.snapshotPayload || buildCurrentBackupPayload(fileName);

    try {
      const jsonString = JSON.stringify(payload, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName.endsWith('.json') ? fileName : `${fileName}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      recordAuditLog({
        actionCategory: 'backup',
        targetEntity: 'backup',
        targetCode: fileName,
        summary: `Tải tệp sao lưu ${fileName} về máy tính (Bao gồm ${payload.auditLogs.length} lịch sử thao tác)`,
        details: `Vật tư: ${payload.products.length} · Khách hàng: ${payload.customers.length} · Đơn bán: ${payload.sales.length} · Phiếu nhập: ${payload.imports.length} · Lịch sử thao tác: ${payload.auditLogs.length}`,
      });
      showToast(
        `Đã tải tệp sao lưu "${fileName}" (gồm đầy đủ dữ liệu & ${payload.auditLogs.length} lịch sử thao tác) về máy tính!`
      );
    } catch {
      showToast('Không thể tải tệp sao lưu về máy tính. Vui lòng thử lại.');
    }
  };

  const handleRestoreBackupPayload = (payload: BackupSnapshotPayload) => {
    if (!canViewAuditHistory(currentStaff)) {
      showToast(
        `Chỉ tài khoản Quản lý chính (${ADMIN_BACKUP_EMAIL}) mới có quyền khôi phục dữ liệu từ tệp sao lưu.`
      );
      return;
    }
    if (Array.isArray(payload.products) && payload.products.length > 0) {
      setProducts(payload.products);
    }
    if (Array.isArray(payload.customers) && payload.customers.length > 0) {
      setCustomers(payload.customers);
    }
    if (Array.isArray(payload.suppliers) && payload.suppliers.length > 0) {
      setSuppliers(payload.suppliers);
    }
    if (Array.isArray(payload.sales)) {
      setSales(payload.sales);
    }
    if (Array.isArray(payload.imports)) {
      setImports(payload.imports);
    }
    if (Array.isArray(payload.savedVouchers) && payload.savedVouchers.length > 0) {
      setSavedVouchers(payload.savedVouchers);
    }
    if (Array.isArray(payload.staffList) && payload.staffList.length > 0) {
      setStaffList(payload.staffList);
    }

    const restoreAuditEntry = createAuditLogEntry({
      actor: currentStaff,
      category: 'backup_restore',
      targetEntity: 'backup',
      targetCode: `Backup_${payload.exportedAt.slice(0, 10)}`,
      warehouseName: 'Tất cả kho',
      actionTitle: `Khôi phục toàn bộ dữ liệu ứng dụng từ tệp sao lưu (${payload.exportedAt})`,
      details: `Đã phục hồi: ${payload.products.length} vật tư, ${payload.customers.length} khách hàng, ${payload.sales.length} đơn bán, ${payload.imports.length} phiếu nhập và ${payload.auditLogs.length} bản ghi lịch sử thao tác.`,
    });

    const mergedLogs = [
      restoreAuditEntry,
      ...(Array.isArray(payload.auditLogs) ? payload.auditLogs : []),
    ];
    setAuditLogs(mergedLogs);
    showToast(
      `Đã khôi phục thành công dữ liệu (${payload.sales.length} đơn bán, ${payload.imports.length} phiếu nhập, ${payload.auditLogs.length} lịch sử thao tác)!`
    );
  };

  const handleRestoreDeletedRecordFromAudit = (audit: AuditLogEntry) => {
    if (!canViewAuditHistory(currentStaff)) {
      showToast(
        `Chỉ tài khoản Quản lý chính (${ADMIN_BACKUP_EMAIL}) mới có quyền khôi phục dữ liệu từ lịch sử thao tác.`
      );
      return;
    }
    if (!audit.snapshotData) {
      showToast('Bản ghi lịch sử này không có dữ liệu gốc để khôi phục.');
      return;
    }
    try {
      const parsed = JSON.parse(audit.snapshotData);
      if (audit.targetEntity === 'sale') {
        const restoredSale = parsed as SaleTransaction;
        setSales((prev) => {
          const filtered = prev.filter((s) => s.id !== restoredSale.id);
          return [restoredSale, ...filtered];
        });
      } else if (audit.targetEntity === 'import') {
        const restoredImp = parsed as ImportTransaction;
        setImports((prev) => {
          const filtered = prev.filter((i) => i.id !== restoredImp.id);
          return [restoredImp, ...filtered];
        });
      } else if (audit.targetEntity === 'product') {
        const restoredProd = parsed as ProductItem;
        setProducts((prev) => {
          const filtered = prev.filter((p) => p.id !== restoredProd.id);
          return [restoredProd, ...filtered];
        });
      } else if (audit.targetEntity === 'customer') {
        const restoredCust = parsed as CustomerProfile;
        setCustomers((prev) => {
          const filtered = prev.filter((c) => c.id !== restoredCust.id);
          return [restoredCust, ...filtered];
        });
      } else if (audit.targetEntity === 'voucher') {
        const restoredVc = parsed as SavedVoucherRecord;
        setSavedVouchers((prev) => {
          const filtered = prev.filter((v) => v.id !== restoredVc.id);
          return [restoredVc, ...filtered];
        });
      }

      const restoredAtStamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const restoreEntry = createAuditLogEntry({
        actor: currentStaff,
        category: 'backup_restore',
        targetEntity: audit.targetEntity,
        targetCode: audit.targetCode,
        warehouseName: audit.warehouseName,
        actionTitle: `Khôi phục lại dữ liệu đã xóa/sửa: ${audit.targetCode} (từ thao tác của @${audit.actorUsername})`,
        details: `Đã phục hồi nguyên trạng chứng từ/dữ liệu ${audit.targetCode} từ bản chụp bằng chứng lúc ${audit.timestamp}.`,
        snapshotObject: parsed,
      });

      setAuditLogs((prev) => [
        restoreEntry,
        ...prev.map((item) =>
          item.id === audit.id ? { ...item, restoredAt: restoredAtStamp } : item
        ),
      ]);
      showToast(
        `Đã khôi phục thành công dữ liệu "${audit.targetCode}" về trạng thái ban đầu!`
      );
    } catch {
      showToast('Không thể đọc dữ liệu gốc để khôi phục.');
    }
  };

  const handleGoogleLogin = async (requestedRole: UserRole) => {
    // Immediately switch active session to the Primary Manager account (trannhat1205@gmail.com)
    if (requestedRole === 'manager') {
      const adminStaff =
        staffList.find((s) => s.email.toLowerCase() === ADMIN_BACKUP_EMAIL) || staffList[0];
      if (adminStaff) {
        setCurrentStaffId(adminStaff.uid);
        setRole('manager');
        setCurrentUserEmail(ADMIN_BACKUP_EMAIL);
      }
    }
    setIsSessionLoggedIn(true);
    try {
      const result = await googleSignInWithRole(requestedRole);
      if (result) {
        setIsGoogleAuthenticated(true);
        const signedInEmail = result.user.email || ADMIN_BACKUP_EMAIL;
        const staffMatch = authenticateStaffByGoogleEmail(staffList, signedInEmail);
        if (staffMatch.ok && staffMatch.staff) {
          setCurrentStaffId(staffMatch.staff.uid);
          setRole(staffMatch.staff.role);
          setCurrentUserEmail(staffMatch.staff.email || signedInEmail);
          showToast(
            `Đăng nhập bằng Google thành công (${staffMatch.staff.displayName} — Kho: ${staffMatch.staff.assignedWarehouse})`
          );
        } else {
          setCurrentUserEmail(signedInEmail);
          setRole(result.resolvedRole);
          showToast(
            `Đăng nhập thành công (${signedInEmail}) với quyền ${
              result.resolvedRole === 'manager' ? 'Quản lý chính' : 'Nhân viên'
            }`
          );
        }
      }
    } catch {
      showToast(
        `Đã kích hoạt phiên Quản lý chính (${ADMIN_BACKUP_EMAIL} / ${ADMIN_PRIMARY_PHONE}) — Toàn quyền quản lý tất cả kho & tạo tài khoản nhân sự!`
      );
    }
  };

  // Dashboard Metrics (Scoped to visible warehouse if staff is logged in)
  const totalRevenue = visibleSales.reduce((sum, s) => sum + s.totalAmount, 0);
  const totalCustomerDebt = visibleSales.reduce((sum, s) => sum + s.debtAmount, 0);
  const totalSupplierDebt = visibleImports.reduce((sum, i) => sum + i.debtAmount, 0);
  const lowStockProducts = visibleProducts.filter((p) => evaluateStockAlert(p) !== 'normal');
  const urgentSupplierDebts = visibleImports.filter((i) => {
    if (i.debtAmount <= 0) return false;
    const { urgency } = evaluateDebtUrgency(
      i.dueDate,
      i.debtAmount,
      DEFAULT_REFERENCE_DATE,
      notificationPrefs.leadDays
    );
    return urgency === 'overdue' || urgency === 'due_soon';
  });

  const allNavItems: { id: ActiveTab; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: 'Tổng quan', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'sales', label: 'Nhật ký Bán hàng', icon: <ShoppingCart className="w-4 h-4" /> },
    { id: 'imports', label: 'Nhật ký Nhập hàng', icon: <Truck className="w-4 h-4" /> },
    { id: 'inventory', label: 'Quản lý Tồn kho', icon: <Boxes className="w-4 h-4" /> },
    { id: 'customers', label: 'Quản lý Khách hàng', icon: <Users className="w-4 h-4" /> },
    { id: 'debts', label: 'Quản lý Công nợ', icon: <Wallet className="w-4 h-4" /> },
    { id: 'vouchers', label: 'Phiếu In & Xuất PDF', icon: <Printer className="w-4 h-4" /> },
    {
      id: 'staff_accounts',
      label: canAccountCreateStaff(currentStaff)
        ? 'Tài khoản & Phân quyền Kho'
        : 'Tài khoản cá nhân',
      icon: <ShieldCheck className="w-4 h-4" />,
    },
    {
      id: 'reports',
      label: 'Báo cáo',
      icon: <FileSpreadsheet className="w-4 h-4" />,
    },
    {
      id: 'backup_history',
      label: 'Sao lưu & Lịch sử',
      icon: <History className="w-4 h-4" />,
    },
  ];

  // Filter navigation tabs strictly by the logged-in account's real-time [X] permissions
  const navItems = useMemo(
    () => allNavItems.filter((item) => accessScope.allowedTabs.includes(item.id)),
    [accessScope, currentStaff]
  );

  const activeNavLabel = navItems.find((n) => n.id === activeTab)?.label || 'Tổng quan';

  // When not logged in, render ONLY the clean, centered outer login screen (no sidebar, no top bar)
  if (!isSessionLoggedIn) {
    return (
      <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col items-center justify-center p-4">
        <InitialLoginScreenPortal
          staffList={staffList}
          currentStaff={currentStaff}
          isGoogleAuthenticated={isGoogleAuthenticated}
          currentUserEmail={currentUserEmail}
          onGoogleManagerLogin={() => handleGoogleLogin('manager')}
          onGoogleLoginByEmail={handleGoogleLoginByEmail}
          onPrimaryPhoneOtpLogin={handlePrimaryPhoneOtpLogin}
          onLoginStaff={handleLoginStaff}
          onResetPasswordViaGmail={handleResetPasswordViaGmail}
          onUpdateStaffProfile={handleUpdateStaffProfile}
          isSessionLoggedIn={isSessionLoggedIn}
          onLogout={handleLogoutApp}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col lg:flex-row">
      {/* Desktop Sidebar (264px width) — Sticky on vertical scroll */}
      <aside className="hidden lg:flex lg:flex-col lg:w-[264px] lg:shrink-0 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto bg-white border-r border-slate-200 justify-between">
        <div>
          {/* Brand Lockup with Attached VTNN Tâm An Logo */}
          <div className="p-5 border-b border-slate-200 flex items-center gap-3">
            <img
              src="/assets/aistudio/Logo_n_ng_nghi_p_T_m_An_a19723bb.png"
              alt="Logo VTNN Tâm An"
              referrerPolicy="no-referrer"
              className="w-11 h-11 rounded-lg object-contain bg-white border border-slate-200 shrink-0 p-0.5"
            />
            <div className="min-w-0">
              <div className="text-sm font-bold tracking-tight text-emerald-800 truncate">
                VTNN TÂM AN
              </div>
              <div className="text-xs text-slate-500 truncate">
                Vật tư Tâm An · Nhà Nông an tâm
              </div>
            </div>
          </div>

          {/* Active Staff & Assigned Warehouse Status Card */}
          <div className="mx-3 mt-3 p-3 rounded-lg bg-emerald-50/70 border border-emerald-200 text-xs space-y-1.5">
            <div className="font-semibold text-slate-900 truncate">
              {isSessionLoggedIn ? currentStaff.displayName : 'Chưa đăng nhập'}
            </div>
            <div className="text-[11px] text-emerald-700 font-medium truncate">
              {isSessionLoggedIn
                ? getPositionRoleLabel(currentStaff.positionRole)
                : 'Vui lòng đăng nhập tài khoản'}
            </div>
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <div className="flex items-center gap-1 text-emerald-800 font-semibold min-w-0">
                <Warehouse className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  Kho: {lockedWarehouse || 'Tất cả kho (' + warehouses.length + ')'}
                </span>
              </div>
              {isSessionLoggedIn && (
                <button
                  type="button"
                  onClick={handleLogoutApp}
                  className="px-2 py-0.5 text-[11px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded flex items-center gap-1 shrink-0 transition-colors"
                >
                  <LogOut className="w-3 h-3 shrink-0" />
                  <span>Thoát</span>
                </button>
              )}
            </div>
          </div>

          {/* Primary Navigation */}
          <nav className="p-3 space-y-1" aria-label="Điều hướng chính">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (item.id === 'sales') {
                      setSaleFormResetKey((prev) => prev + 1);
                    }
                    setActiveTab(item.id);
                    scrollToTopOfPage();
                  }}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-emerald-700 text-white'
                      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0 truncate">
                    {item.icon}
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.id === 'inventory' && lowStockProducts.length > 0 && (
                    <span
                      className={`font-mono text-xs ${
                        isActive ? 'text-emerald-100' : 'text-amber-700 font-bold'
                      }`}
                    >
                      {lowStockProducts.length}
                    </span>
                  )}
                  {item.id === 'debts' && urgentSupplierDebts.length > 0 && (
                    <span
                      className={`font-mono text-xs ${
                        isActive ? 'text-emerald-100' : 'text-red-600 font-bold'
                      }`}
                    >
                      {urgentSupplierDebts.length}
                    </span>
                  )}
                  {item.id === 'backup_history' && canViewAuditHistory(currentStaff) && (
                    <span
                      className={`font-mono text-xs ${
                        isActive ? 'text-emerald-100' : 'text-emerald-700 font-bold'
                      }`}
                    >
                      {auditLogs.length}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Auto-Backup & Account Role Footer */}
        <div className="p-4 border-t border-slate-200 space-y-3 bg-slate-50/60">
          {canViewAuditHistory(currentStaff) && (
            <div className="text-xs text-slate-600 space-y-1 pb-2 border-b border-slate-200">
              <div className="flex items-center gap-1.5 font-semibold text-emerald-800">
                <CloudCheck className="w-3.5 h-3.5 shrink-0" />
                <span>Sao lưu Google Drive</span>
              </div>
              <div className="font-mono text-[11px] text-slate-500 truncate">
                {ADMIN_BACKUP_EMAIL}
              </div>
              <div className="text-[11px] text-slate-500">
                Trạng thái: {autoDailyBackupEnabled ? 'Tự động 06:00 mỗi ngày' : 'Thủ công'}
              </div>
            </div>
          )}

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Tài khoản:</span>
              <button
                type="button"
                onClick={() => setActiveTab('staff_accounts')}
                className="font-semibold text-emerald-700 hover:underline flex items-center gap-1"
              >
                <KeyRound className="w-3 h-3" />
                <span>
                  @{currentStaff.username}
                  {canAccountCreateStaff(currentStaff) ? ' (Phân quyền)' : ''}
                </span>
              </button>
            </div>
            <button
              type="button"
              onClick={handleLogoutApp}
              className="w-full py-1.5 px-3 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg flex items-center justify-center gap-1.5 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" />
              <span>Thoát đăng nhập</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract: Always pinned at top when scrolling vertically down */}
        <header className="bg-white/95 backdrop-blur-xs border-b border-slate-200 sticky top-0 z-40 shadow-2xs">
          <div className="px-2.5 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between gap-1.5 sm:gap-3">
            <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 shrink-0">
              <button
                type="button"
                onClick={() => setMobileMenuOpen((prev) => !prev)}
                aria-label="Mở menu điều hướng"
                className="lg:hidden p-1.5 sm:p-2 text-slate-600 hover:text-slate-900 rounded-lg border border-slate-200 shrink-0"
              >
                {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
              </button>

              <div className="flex items-center gap-1.5 text-xs sm:text-sm min-w-0">
                <span className="font-bold text-emerald-800 whitespace-nowrap shrink-0">
                  VTNN Tâm An
                </span>
                <span className="hidden md:inline text-slate-300 shrink-0" aria-hidden="true">
                  /
                </span>
                <span className="hidden md:inline font-semibold text-slate-900 whitespace-nowrap truncate max-w-[220px] xl:max-w-none">
                  {activeNavLabel}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              {/* Staff / Warehouse Quick Switcher — ONLY for Primary Manager */}
              {canAccountCreateStaff(currentStaff) && (
                <select
                  aria-label="Chuyển đổi tài khoản nhân viên hoặc quản lý"
                  value={currentStaff.uid}
                  onChange={(e) => {
                    const chosen = staffList.find((s) => s.uid === e.target.value);
                    if (chosen) {
                      setCurrentStaffId(chosen.uid);
                      setRole(chosen.role);
                      setCurrentUserEmail(chosen.email || ADMIN_BACKUP_EMAIL);
                      setIsSessionLoggedIn(true);
                      showToast(
                        `Đang làm việc với tài khoản: ${chosen.displayName} (${chosen.assignedWarehouse})`
                      );
                    }
                  }}
                  className="hidden xl:block px-2 py-1.5 text-xs font-semibold bg-slate-100 border border-slate-200 rounded-lg text-slate-800 max-w-[200px] truncate"
                >
                  {staffList.map((st) => (
                    <option key={st.uid} value={st.uid}>
                      @{st.username} — {st.displayName} ({st.assignedWarehouse})
                    </option>
                  ))}
                </select>
              )}

              {/* Prominent Logout ("Thoát đăng nhập") Button */}
              <button
                type="button"
                onClick={handleLogoutApp}
                className="px-2 py-1.5 sm:px-3 sm:py-2 text-[11px] sm:text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 rounded-lg transition-colors flex items-center gap-1 sm:gap-1.5 whitespace-nowrap shrink-0"
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden md:inline">Thoát đăng nhập</span>
                <span className="md:hidden">Thoát</span>
              </button>

              {/* Push Notification Center Trigger */}
              <button
                type="button"
                onClick={() => setIsNotifDrawerOpen(true)}
                aria-label={`Thông báo đẩy (${unreadNotifCount} chưa đọc)`}
                className="px-2 py-1.5 sm:px-3 sm:py-2 text-[11px] sm:text-xs font-semibold text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors flex items-center gap-1 sm:gap-1.5 whitespace-nowrap shrink-0"
              >
                <Bell className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                <span className="hidden sm:inline">Thông báo</span>
                <span className="font-mono font-bold text-red-600">({unreadNotifCount})</span>
              </button>

              {/* Primary CTA Button — Shown if account has sales permission */}
              {accessScope.canAccessSales && (
                <button
                  type="button"
                  onClick={() => {
                    setPreselectedCustomerId(null);
                    setSaleFormResetKey((prev) => prev + 1);
                    setActiveTab('sales');
                    setMobileMenuOpen(false);
                    scrollToTopOfPage();
                  }}
                  className="px-2 py-1.5 sm:px-3.5 sm:py-2 text-[11px] sm:text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <span className="sm:hidden">+ Đơn bán</span>
                  <span className="hidden sm:inline">+ Tạo đơn bán</span>
                </button>
              )}
            </div>
          </div>

          {/* Mobile Sub-Bar showing current screen & warehouse clearly */}
          <div className="md:hidden px-3 py-1.5 bg-slate-50 border-t border-slate-200/80 flex items-center justify-between gap-2 text-[11px]">
            <span className="font-semibold text-slate-800 truncate">{activeNavLabel}</span>
            <span className="text-emerald-800 font-semibold whitespace-nowrap shrink-0 flex items-center gap-1">
              <Warehouse className="w-3 h-3 shrink-0" />
              <span>{lockedWarehouse || `Tất cả kho (${warehouses.length})`}</span>
            </span>
          </div>

          {/* Mobile Navigation Drawer — Kept inside sticky header so it opens at top even when scrolled down */}
          {mobileMenuOpen && (
            <div className="lg:hidden bg-white border-t border-slate-200 px-4 py-3 space-y-1 max-h-[calc(100vh-88px)] overflow-y-auto shadow-lg">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (item.id === 'sales') {
                      setSaleFormResetKey((prev) => prev + 1);
                    }
                    setActiveTab(item.id);
                    setMobileMenuOpen(false);
                    scrollToTopOfPage();
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold ${
                    activeTab === item.id
                      ? 'bg-emerald-700 text-white'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
              {isSessionLoggedIn && (
                <button
                  type="button"
                  onClick={handleLogoutApp}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 mt-1"
                >
                  <LogOut className="w-4 h-4 shrink-0" />
                  <span>Thoát đăng nhập (@{currentStaff.username})</span>
                </button>
              )}
            </div>
          )}
        </header>

        {/* Toast Notification Banner */}
        {toastBanner && (
          <div
            role="status"
            className="mx-4 sm:mx-6 mt-4 px-4 py-3 bg-slate-900 text-white text-xs font-medium rounded-lg flex items-center justify-between gap-4"
          >
            <span>{toastBanner}</span>
            <button
              type="button"
              onClick={() => setToastBanner(null)}
              aria-label="Đóng thông báo nhanh"
              className="text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Main Workspace Content Viewport */}
        <main className="flex-1 p-3.5 sm:p-6 max-w-[1400px] w-full mx-auto space-y-6 overflow-x-hidden">
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              {/* Brand Hero Banner */}
              <div className="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
                <div className="flex items-start sm:items-center gap-3.5 sm:gap-4">
                  <img
                    src="/assets/aistudio/Logo_n_ng_nghi_p_T_m_An_a19723bb.png"
                    alt="Logo Vật tư Nông nghiệp Tâm An"
                    referrerPolicy="no-referrer"
                    className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl object-contain border border-slate-200 p-1 shrink-0 bg-white"
                  />
                  <div className="min-w-0">
                    <h1 className="text-lg sm:text-2xl font-bold text-slate-900">
                      VTNN Tâm An — Vật tư Tâm An, Nhà Nông an tâm
                    </h1>
                  </div>
                </div>
              </div>

              {/* 4 KPI Strip */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200">
                  <div className="text-xs text-slate-500">Tổng Doanh Thu Bán Hàng</div>
                  <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1.5">
                    {formatVND(totalRevenue)}
                  </div>
                  <div className="text-xs text-slate-500 mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <span>{visibleSales.length} hóa đơn</span>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={() => setActiveTab('sales')}
                      className="text-emerald-700 font-semibold hover:underline"
                    >
                      Mở nhật ký →
                    </button>
                  </div>
                </div>

                <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200">
                  <div className="text-xs text-slate-500">Công Nợ Phải Thu Khách Hàng</div>
                  <div className="text-xl font-bold font-mono tabular-nums text-red-600 mt-1.5">
                    {formatVND(totalCustomerDebt)}
                  </div>
                  <div className="text-xs text-slate-500 mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <span>{customers.length} hồ sơ khách hàng</span>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={() => setActiveTab('debts')}
                      className="text-emerald-700 font-semibold hover:underline"
                    >
                      Đối soát nợ KH →
                    </button>
                  </div>
                </div>

                <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200">
                  <div className="text-xs text-slate-500">Công Nợ Phải Trả Nhà Cung Cấp</div>
                  <div className="text-xl font-bold font-mono tabular-nums text-amber-700 mt-1.5">
                    {formatVND(totalSupplierDebt)}
                  </div>
                  <div className="text-xs text-slate-500 mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (urgentSupplierDebts[0]) {
                          setFocusedDebtRecordId(urgentSupplierDebts[0].id);
                        }
                        setActiveTab('debts');
                      }}
                      className="text-red-600 font-semibold hover:underline"
                    >
                      {urgentSupplierDebts.length} phiếu đến hạn/quá hạn
                    </button>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={() => setActiveTab('debts')}
                      className="text-emerald-700 font-semibold hover:underline"
                    >
                      Trả nợ NCC →
                    </button>
                  </div>
                </div>

                <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200">
                  <div className="text-xs text-slate-500">Cảnh Báo Tồn Kho Sắp Hết</div>
                  <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1.5">
                    {lowStockProducts.length} / {visibleProducts.length} mặt hàng
                  </div>
                  <div className="text-xs text-slate-500 mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (lowStockProducts[0]) {
                          setFocusedProductId(lowStockProducts[0].id);
                        }
                        setActiveTab('inventory');
                      }}
                      className="text-amber-700 font-medium hover:underline"
                    >
                      Cần nhập thêm kịp thời
                    </button>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={() => setActiveTab('inventory')}
                      className="text-emerald-700 font-semibold hover:underline"
                    >
                      Kiểm kho →
                    </button>
                  </div>
                </div>
              </div>

              {/* Two-Column Actionable Panels: Supplier Debt Reminders & Low Stock Alerts (Direct Deep-Links) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Panel 1: Supplier Debt Due / Overdue Reminders */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-4 sm:px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-sm font-bold text-slate-900">
                        Nhắc Hẹn Công Nợ Nhà Cung Cấp Đến Hạn (Bấm để mở chứng từ)
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Bấm trực tiếp vào từng thông báo nhắc nợ để mở ngay phiếu nhập chứng từ đó
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('debts')}
                      className="text-xs font-semibold text-emerald-700 hover:underline whitespace-nowrap shrink-0"
                    >
                      Xem tất cả
                    </button>
                  </div>

                  <div className="divide-y divide-slate-200">
                    {urgentSupplierDebts.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500">
                        Tất cả công nợ nhà cung cấp đều đang trong hạn an toàn.
                      </div>
                    ) : (
                      urgentSupplierDebts.map((imp) => {
                        const { urgency, daysRemaining } = evaluateDebtUrgency(
                          imp.dueDate,
                          imp.debtAmount,
                          DEFAULT_REFERENCE_DATE,
                          notificationPrefs.leadDays
                        );
                        return (
                          <div
                            key={imp.id}
                            onClick={() => {
                              setFocusedDebtRecordId(imp.id);
                              setActiveTab('debts');
                            }}
                            className="px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 hover:bg-emerald-50/60 cursor-pointer transition-colors"
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-slate-900">
                                {imp.supplierName}
                              </div>
                              <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5">
                                <span className="font-mono font-bold text-emerald-800 underline">
                                  {imp.receiptCode}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span>{imp.warehouseName || 'Tâm An Mỹ Ngãi'}</span>
                              </div>
                            </div>
                            <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 shrink-0 pt-1 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                              <div className="text-xs font-bold font-mono tabular-nums text-red-600">
                                {formatVND(imp.debtAmount)}
                              </div>
                              <div
                                className={`text-xs sm:mt-0.5 ${
                                  urgency === 'overdue'
                                    ? 'text-red-600 font-semibold'
                                    : 'text-amber-700 font-medium'
                                }`}
                              >
                                {urgency === 'overdue'
                                  ? `Quá hạn ${Math.abs(daysRemaining)} ngày (${imp.dueDate})`
                                  : `Còn ${daysRemaining} ngày (${imp.dueDate})`}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Panel 2: Low Stock Inventory Warnings */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-4 sm:px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-sm font-bold text-slate-900">
                        Cảnh Báo Hàng Sắp Hết Trong Kho (Bấm để mở vật tư)
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Các mặt hàng có số lượng tồn kho thấp hơn hoặc bằng định mức tối thiểu
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('inventory')}
                      className="text-xs font-semibold text-emerald-700 hover:underline whitespace-nowrap shrink-0"
                    >
                      Quản lý kho
                    </button>
                  </div>

                  <div className="divide-y divide-slate-200">
                    {lowStockProducts.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500">
                        Tất cả vật tư nông nghiệp trong kho đều đảm bảo định mức an toàn.
                      </div>
                    ) : (
                      lowStockProducts.map((p) => {
                        const alert = evaluateStockAlert(p);
                        return (
                          <div
                            key={p.id}
                            className="px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4 hover:bg-slate-50"
                          >
                            <div
                              onClick={() => {
                                setFocusedProductId(p.id);
                                setActiveTab('inventory');
                              }}
                              className="cursor-pointer min-w-0"
                            >
                              <div className="text-xs font-semibold text-slate-900 hover:text-emerald-800 underline">
                                [{p.code}] {p.name}
                              </div>
                              <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                                <span className="font-semibold text-emerald-800">
                                  {p.warehouseName || 'Tâm An Mỹ Ngãi'}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span>
                                  Tồn hiện tại:{' '}
                                  <strong
                                    className={`font-mono ${
                                      alert === 'out_of_stock' ? 'text-red-600' : 'text-amber-700'
                                    }`}
                                  >
                                    {p.stock} {p.unit}
                                  </strong>{' '}
                                  (Tối thiểu: {p.minStock})
                                </span>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                setPreselectedProductId(p.id);
                                setActiveTab('imports');
                              }}
                              className="w-full sm:w-auto px-3 py-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg whitespace-nowrap shrink-0 text-center"
                            >
                              Nhập thêm ngay
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* Bottom Export & Print Quick Actions Bar */}
              <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs font-semibold text-slate-700">
                  Xuất báo cáo tổng quan & In phiếu nhanh:
                </div>
                <div className="grid grid-cols-3 sm:flex sm:flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      const file = exportPeriodicReportExcel({
                        periodLabel: 'Tháng 11/2026',
                        products: visibleProducts,
                        customers,
                        sales: visibleSales,
                        imports: visibleImports,
                      });
                      showToast(`Đã tải xuống báo cáo Excel: ${file}`);
                    }}
                    className="px-2.5 sm:px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors text-center whitespace-nowrap"
                  >
                    Xuất Excel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const file = exportPeriodicReportPDF({
                        periodLabel: 'Tháng 11/2026',
                        products: visibleProducts,
                        customers,
                        sales: visibleSales,
                        imports: visibleImports,
                      });
                      showToast(`Đã tải xuống báo cáo PDF: ${file}`);
                    }}
                    className="px-2.5 sm:px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors text-center whitespace-nowrap"
                  >
                    Xuất PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('vouchers')}
                    className="px-2.5 sm:px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors text-center whitespace-nowrap"
                  >
                    In Phiếu PDF
                  </button>
                </div>
              </div>
            </div>
          )}

          {isSessionLoggedIn && activeTab === 'sales' && (
            <SalesLogView
              products={visibleProducts}
              customers={customers}
              sales={visibleSales}
              role={role}
              resetKey={saleFormResetKey}
              warehouses={warehouses}
              onAddWarehouse={handleAddWarehouse}
              lockedWarehouse={lockedWarehouse}
              customerGroups={customerGroups}
              onAddCustomerGroup={handleAddCustomerGroup}
              productCategories={productCategories}
              onAddProductCategory={handleAddProductCategory}
              preselectedCustomerId={preselectedCustomerId}
              onClearPreselectedCustomer={() => setPreselectedCustomerId(null)}
              onCreateSale={handleCreateSale}
              onCreateCustomerInline={(data) => handleSaveCustomer(data)}
              onCreateProductInline={(data) => handleSaveProduct(data)}
              onImportSalesFromExcel={handleImportSalesFromExcel}
              onUpdateSale={handleUpdateSale}
              onDeleteSale={handleDeleteSale}
              onOpenDebtRecord={(recId) => {
                setFocusedDebtRecordId(recId);
                setActiveTab('debts');
              }}
            />
          )}

          {isSessionLoggedIn && activeTab === 'imports' && (
            <ImportLogView
              products={visibleProducts}
              customers={customers}
              imports={visibleImports}
              suppliers={suppliers}
              role={role}
              warehouses={warehouses}
              onAddWarehouse={handleAddWarehouse}
              lockedWarehouse={lockedWarehouse}
              preselectedProductId={preselectedProductId}
              onClearPreselectedProduct={() => setPreselectedProductId(null)}
              onCreateImport={handleCreateImport}
              onCreateProductInline={(data) => handleSaveProduct(data)}
              onCreateSupplierInline={handleCreateSupplierInline}
              onImportWarehouseFromExcel={handleImportWarehouseFromExcel}
              onUpdateImport={handleUpdateImport}
              onDeleteImport={handleDeleteImport}
              onOpenDebtRecord={(recId) => {
                setFocusedDebtRecordId(recId);
                setActiveTab('debts');
              }}
            />
          )}

          {isSessionLoggedIn && activeTab === 'inventory' && (
            <InventoryView
              products={visibleProducts}
              customers={customers}
              sales={visibleSales}
              imports={visibleImports}
              role={role}
              warehouses={warehouses}
              onAddWarehouse={handleAddWarehouse}
              lockedWarehouse={lockedWarehouse}
              productCategories={productCategories}
              onAddProductCategory={handleAddProductCategory}
              onSaveProduct={handleSaveProduct}
              onDeleteProduct={handleDeleteProduct}
              onImportProductsFromExcel={handleImportProductsFromExcel}
              onQuickRestock={(prodId) => {
                setPreselectedProductId(prodId);
                setActiveTab('imports');
              }}
              focusedProductId={focusedProductId}
              onClearFocusedProduct={() => setFocusedProductId(null)}
            />
          )}

          {isSessionLoggedIn && activeTab === 'customers' && (
            <CustomerModule
              customers={customers}
              sales={visibleSales}
              products={visibleProducts}
              imports={visibleImports}
              role={role}
              customerGroups={customerGroups}
              onAddCustomerGroup={handleAddCustomerGroup}
              onSaveCustomer={handleSaveCustomer}
              onDeleteCustomer={handleDeleteCustomer}
              onImportCustomersFromExcel={handleImportCustomersFromExcel}
              onCollectCustomerDebt={handleCollectCustomerDebt}
              onCreateSaleForCustomer={(custId) => {
                setPreselectedCustomerId(custId);
                setActiveTab('sales');
                scrollToTopOfPage();
              }}
              leadDays={notificationPrefs.leadDays}
            />
          )}

          {isSessionLoggedIn && activeTab === 'debts' && (
            <DebtModule
              sales={visibleSales}
              imports={visibleImports}
              products={visibleProducts}
              customers={customers}
              role={role}
              canAccessCustomerDebts={accessScope.canAccessCustomerDebts}
              canAccessSupplierDebts={accessScope.canAccessSupplierDebts}
              leadDays={notificationPrefs.leadDays}
              focusedRecordId={focusedDebtRecordId}
              onClearFocusedRecord={() => setFocusedDebtRecordId(null)}
              onCollectCustomerDebt={handleCollectCustomerDebt}
              onPaySupplierDebt={handlePaySupplierDebt}
              onImportDebtPaymentsFromExcel={handleImportDebtPaymentsFromExcel}
              onUpdateSale={handleUpdateSale}
              onDeleteSale={handleDeleteSale}
              onUpdateImport={handleUpdateImport}
              onDeleteImport={handleDeleteImport}
            />
          )}

          {isSessionLoggedIn && activeTab === 'vouchers' && (
            <VoucherPrintCenter
              sales={visibleSales}
              imports={visibleImports}
              customers={customers}
              products={visibleProducts}
              role={role}
              savedVouchers={savedVouchers}
              onSaveVoucher={handleSaveVoucher}
              onDeleteVoucher={handleDeleteVoucher}
              currentStaffName={currentStaff.displayName}
              onNotifyToast={showToast}
            />
          )}

          {isSessionLoggedIn && activeTab === 'staff_accounts' && (
            <StaffAccountManager
              staffList={staffList}
              currentStaff={currentStaff}
              warehouses={warehouses}
              isGoogleAuthenticated={isGoogleAuthenticated}
              currentUserEmail={currentUserEmail}
              onGoogleManagerLogin={() => handleGoogleLogin('manager')}
              onGoogleLoginByEmail={handleGoogleLoginByEmail}
              onPrimaryPhoneOtpLogin={handlePrimaryPhoneOtpLogin}
              onAddWarehouse={handleAddWarehouse}
              onLoginStaff={handleLoginStaff}
              onChangePassword={handleChangeStaffPassword}
              onCreateStaffAccount={handleCreateStaffAccount}
              onUpdateStaffWarehouse={handleUpdateStaffWarehouse}
              onUpdateStaffPermissions={handleUpdateStaffPermissions}
              onResetStaffPasswordByManager={handleResetStaffPasswordByManager}
              onToggleStaffActive={handleToggleStaffActive}
              onResetPasswordViaGmail={handleResetPasswordViaGmail}
              onUpdateStaffProfile={handleUpdateStaffProfile}
              isSessionLoggedIn={isSessionLoggedIn}
              onLogout={handleLogoutApp}
            />
          )}

          {isSessionLoggedIn && (activeTab === 'reports' || activeTab === 'backup_history') && (
            <ReportsAndBackupModule
              mode={activeTab === 'backup_history' ? 'backup_history' : 'reports'}
              products={visibleProducts}
              customers={customers}
              sales={visibleSales}
              imports={visibleImports}
              savedVouchers={savedVouchers}
              backups={backups}
              staffList={staffList}
              currentStaff={currentStaff}
              auditLogs={auditLogs}
              role={role}
              isGoogleAuthenticated={isGoogleAuthenticated}
              currentUserEmail={currentUserEmail}
              autoDailyBackupEnabled={autoDailyBackupEnabled}
              onToggleAutoDailyBackup={setAutoDailyBackupEnabled}
              onTriggerDriveBackup={handleTriggerDriveBackup}
              onDeleteBackupRecord={handleDeleteBackupRecord}
              onDownloadBackupFile={handleDownloadBackupFile}
              onRestoreBackupPayload={handleRestoreBackupPayload}
              onRestoreDeletedRecordFromAudit={handleRestoreDeletedRecordFromAudit}
              onGoogleLogin={handleGoogleLogin}
              onSwitchRolePreview={setRole}
              onCollectCustomerDebt={handleCollectCustomerDebt}
              onNavigateToModule={(tab, recordId) => {
                if (tab === 'debts' && recordId) {
                  setFocusedDebtRecordId(recordId);
                } else if (tab === 'inventory' && recordId) {
                  setFocusedProductId(recordId);
                } else if (tab === 'customers' && recordId) {
                  setPreselectedCustomerId(recordId);
                }
                setActiveTab(tab);
              }}
              onNotifyToast={showToast}
            />
          )}
        </main>
      </div>

      {/* Push Notification & Preference Drawer */}
      <NotificationCenter
        isOpen={isNotifDrawerOpen}
        onClose={() => setIsNotifDrawerOpen(false)}
        notifications={notifications}
        readIds={readNotifIds}
        onMarkAsRead={(id) => {
          setReadNotifIds((prev) => {
            const next = new Set(prev);
            next.add(id);
            return next;
          });
        }}
        onMarkAllAsRead={() => {
          setReadNotifIds(new Set(notifications.map((n) => n.id)));
        }}
        prefs={notificationPrefs}
        onUpdatePrefs={(newPrefs) => {
          setNotificationPrefs(newPrefs);
          if (isGoogleAuthenticated) {
            syncNotificationPrefsToFirestore(newPrefs, true).catch(console.error);
          }
          showToast('Đã lưu cài đặt tùy chỉnh thông báo đẩy.');
        }}
        onNavigateTab={(tab) => {
          setActiveTab(tab);
          setIsNotifDrawerOpen(false);
        }}
        onNavigateNotification={handleNavigateNotification}
        onSendTestPush={() => {
          triggerPushNotification(
            'VTNN Tâm An — Kiểm tra thông báo đẩy',
            'Hệ thống nhắc nợ đến hạn, cảnh báo tồn kho và báo cáo định kỳ đang hoạt động ổn định!'
          );
        }}
      />
    </div>
  );
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Bell,
  Boxes,
  CloudCheck,
  FileSpreadsheet,
  History,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Printer,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Truck,
  Users,
  Wallet,
  Warehouse,
  WifiOff,
  X,
} from 'lucide-react';
import {
  AppNotification,
  AuditActionCategory,
  AuditLogEntry,
  AuditTargetEntity,
  BackupEntry,
  BackupSnapshotPayload,
  CashPaymentVoucher,
  CashReceiptVoucher,
  CustomerProfile,
  DeletedRecordTombstone,
  ImportTransaction,
  NotificationPrefs,
  ProductItem,
  ProductNoteTemplate,
  SalePromotionType,
  SaleTransaction,
  SavedVoucherRecord,
  StaffFunctionalPermission,
  StaffMember,
  StaffPositionRole,
  StockAdjustmentRecord,
  SupplierProfile,
  UserRole,
  VietQrBankConfig,
} from './types';
import {
  allocatePaymentAcrossCartItems,
  bindProductNoteToProduct,
  clearOfflineQueueStorage,
  deleteProductNoteTemplate,
  enqueueOfflineQueueItem,
  loadOfflineQueue,
  OfflineQueueItem,
  PosCartDraftItem,
  resolveProductNoteTemplates,
  upsertProductNoteTemplate,
  validateCartInventory,
} from './utils/smartPosFeatures';
import {
  ADMIN_BACKUP_EMAIL,
  ADMIN_PRIMARY_PHONE,
  PRIMARY_ADMIN_UID,
  PRODUCTION_PRIMARY_ADMIN,
} from './data/seedData';
import {
  applyCustomerFifoDebtSettlement,
  applyDebtPayment,
  applyImportToInventory,
  applySaleToInventory,
  applySupplierFifoDebtSettlement,
  authenticateStaffByGoogleEmail,
  buildBackupSnapshotPayload,
  calculateImportSummary,
  calculateSaleSummary,
  canAccountCreateStaff,
  canPerformRoleAction,
  canStaffFilterMultiWarehouses,
  canViewAuditHistory,
  computeDueDateAfterDays,
  computeSaleEditStockDeltas,
  computeSmartDashboardAnalytics,
  computeWeightedAverageImportPrice,
  createAuditLogEntry,
  dedupeWarehouseNames,
  evaluateDebtUrgency,
  evaluateStaffAccessScope,
  evaluateStockAlert,
  executeFiscalYearCloseAndCleanup,
  executeFullApplicationDataWipe,
  extractCustomWarehouseSuffix,
  filterRecordsBySelectedWarehouses,
  findLinkedPaymentVouchersForImport,
  findLinkedReceiptVouchersForSale,
  formatDefaultWarehouseNameFromGmail,
  formatSelectedWarehousesBadge,
  formatVND,
  generateSequentialVoucherCode,
  generateSmartNotifications,
  getCurrentMonthRangeVietnam,
  getDefaultPermissionsForPosition,
  getIndependentWarehouseFullPermissions,
  getPositionRoleLabel,
  getStaffAllowedWarehouses,
  getTodayVietnamDateStr,
  hasMultiWarehouseManagementGrant,
  MANDATORY_WAREHOUSE_PREFIX,
  normalizeCustomTamAnWarehouseName,
  normalizeVietnameseSearch,
  normalizeWarehouseKey,
  pickEarlierFefoBatch,
  readExcelNumber,
  recalculateImportPriceOnImportMutation,
  reconcileCustomersFromSales,
  resolveActiveWarehouses,
  reverseCustomerReceiptVoucherAllocations,
  reverseSupplierPaymentVoucherAllocations,
  updateImportRecord,
  updateSaleRecord,
} from './utils/businessLogic';
import { hashPassword, isHashedPassword, verifyPassword } from './utils/authSecurity';
import {
  auth,
  canWriteToFirestore,
  deleteBackupFileFromDrive,
  deleteFirestoreDocIfAdmin,
  fetchUserFirestoreData,
  firebaseSignInWithEmailPassword,
  firebaseSignUpWithEmailPassword,
  googleSignInWithRole,
  initAuth,
  isCurrentUserAdmin,
  isRealtimeWorkspaceLegacyLayout,
  logoutUser,
  resendVerificationEmail,
  seedExistingStaffToChatDirectoryIfAdmin,
  seedExistingStaffToRealtimeDirectoryIfAdmin,
  subscribeToAiTokenGrant,
  subscribeToAllRealtimeWorkspacesForAdmin,
  subscribeToDesignatedRealtimeWorkspaces,
  subscribeToRealtimeUsersDirectory,
  subscribeToRealtimeWorkspace,
  subscribeToRtdbConnectionState,
  subscribeToUserChatRooms,
  syncCustomerToFirestore,
  syncImportToFirestore,
  syncNotificationPrefsToFirestore,
  syncProductToFirestore,
  syncSaleToFirestore,
  uploadBackupToGoogleDrive,
  upsertChatUserDirectoryProfile,
  upsertRealtimeUserDirectoryProfile,
  writeAdminWorkspacesIndexToFirebaseStorage,
  writeRealtimeWorkspace,
  writeWorkspaceToFirebaseStorage,
  readAdminWorkspacesIndexFromFirebaseStorage,
  readDesignatedWorkspacesFromFirebaseStorage,
  readRealtimeWorkspacesOnce,
  readWorkspaceFromFirebaseStorage,
} from './services/firebaseService';
import { AiTokenGrantRecord } from './utils/geminiReportAssistant';
import { buildDirectChatRoomId } from './utils/internalChatLogic';
import {
  AdminWarehouseAccountSummary,
  aggregateAdminWorkspacesFromRtdb,
  computeWorkspaceFingerprint,
  countWorkspaceBusinessRecords,
  dedupeRecordsById,
  filterOutDeletedRecords,
  isDestructiveEmptyWorkspaceOverwrite,
  mergeDeletionTombstones,
  mergeDirectoryIntoStaffList,
  mergeWorkspacePayloads,
  normalizeIndependentWarehouseStaffMember,
  normalizeWorkspaceFromRtdb,
  partitionAdminStateByWorkspace,
  resolveDesignatedOwnerUidsForWarehouses,
  RtdbUserDirectoryProfile,
  RtdbWorkspaceMeta,
  RtdbWorkspacePayload,
} from './utils/rtdbSyncLogic';
import {
  loadWorkspaceFromStorage,
  mergeRecordsById,
  saveWorkspaceToStorage,
  sanitizeStaffListForStorage,
  WORKSPACE_STORAGE_KEY,
} from './services/localPersistence';
import { NotificationCenter } from './components/NotificationCenter';
import { MultiWarehouseFilterPopover } from './components/MultiWarehouseFilterPopover';
import { InitialLoginScreenPortal } from './components/InitialLoginScreenPortal';
import { InstallPwaModal } from './components/InstallPwaModal';

const CustomerModule = lazy(() =>
  import('./components/CustomerModule').then((m) => ({ default: m.CustomerModule }))
);
const DebtModule = lazy(() =>
  import('./components/DebtModule').then((m) => ({ default: m.DebtModule }))
);
const ReportsAndBackupModule = lazy(() =>
  import('./components/ReportsAndBackupModule').then((m) => ({
    default: m.ReportsAndBackupModule,
  }))
);
const SalesLogView = lazy(() =>
  import('./components/SalesImportViews').then((m) => ({ default: m.SalesLogView }))
);
const ImportLogView = lazy(() =>
  import('./components/SalesImportViews').then((m) => ({ default: m.ImportLogView }))
);
const InventoryView = lazy(() =>
  import('./components/InventoryView').then((m) => ({ default: m.InventoryView }))
);
const VoucherPrintCenter = lazy(() =>
  import('./components/VoucherPrintCenter').then((m) => ({ default: m.VoucherPrintCenter }))
);
const ReceiptVoucherLogView = lazy(() =>
  import('./components/CashFlowVouchersView').then((m) => ({
    default: m.ReceiptVoucherLogView,
  }))
);
const PaymentVoucherLogView = lazy(() =>
  import('./components/CashFlowVouchersView').then((m) => ({
    default: m.PaymentVoucherLogView,
  }))
);
const StaffAccountManager = lazy(() =>
  import('./components/StaffAccountManager').then((m) => ({ default: m.StaffAccountManager }))
);
const GeminiChatbotView = lazy(() =>
  import('./components/GeminiChatbotView').then((m) => ({ default: m.GeminiChatbotView }))
);
const InternalChatView = lazy(() =>
  import('./components/InternalChatView').then((m) => ({ default: m.InternalChatView }))
);

type ActiveTab =
  | 'dashboard'
  | 'sales'
  | 'imports'
  | 'inventory'
  | 'customers'
  | 'debts'
  | 'receipt_vouchers'
  | 'payment_vouchers'
  | 'vouchers'
  | 'staff_accounts'
  | 'reports'
  | 'gemini_chat'
  | 'internal_chat'
  | 'backup_history';

export default function App() {
  const [initialWorkspace] = useState(() => loadWorkspaceFromStorage());
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const activeTabRef = useRef<ActiveTab>(activeTab);
  activeTabRef.current = activeTab;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isSessionLoggedIn, setIsSessionLoggedIn] = useState<boolean>(false);
  const [isAuthChecking, setIsAuthChecking] = useState<boolean>(true);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<'local' | 'synced' | 'unverified'>('local');

  // Core Data State (Empty by default for production; persisted in localStorage + Firestore)
  const [products, setProducts] = useState<ProductItem[]>(initialWorkspace.products);
  const productsRef = useRef<ProductItem[]>(products);
  productsRef.current = products;
  const [customers, setCustomers] = useState<CustomerProfile[]>(initialWorkspace.customers);
  const [sales, setSales] = useState<SaleTransaction[]>(initialWorkspace.sales);
  const [imports, setImports] = useState<ImportTransaction[]>(initialWorkspace.imports);
  const [savedVouchers, setSavedVouchers] = useState<SavedVoucherRecord[]>(
    initialWorkspace.savedVouchers
  );
  const [stockAdjustments, setStockAdjustments] = useState<StockAdjustmentRecord[]>(
    initialWorkspace.stockAdjustments || []
  );
  const [backups, setBackups] = useState<BackupEntry[]>(initialWorkspace.backups);
  const [suppliers, setSuppliers] = useState<SupplierProfile[]>(initialWorkspace.suppliers);
  const [warehouses, setWarehouses] = useState<string[]>(initialWorkspace.warehouses);
  const [customerGroups, setCustomerGroups] = useState<string[]>(
    initialWorkspace.customerGroups
  );
  const [productCategories, setProductCategories] = useState<string[]>(
    initialWorkspace.productCategories
  );
  const [receiptGroups, setReceiptGroups] = useState<string[]>(initialWorkspace.receiptGroups);
  const [paymentGroups, setPaymentGroups] = useState<string[]>(initialWorkspace.paymentGroups);
  const [receiptVouchers, setReceiptVouchers] = useState<CashReceiptVoucher[]>(
    initialWorkspace.receiptVouchers
  );
  const [paymentVouchers, setPaymentVouchers] = useState<CashPaymentVoucher[]>(
    initialWorkspace.paymentVouchers
  );
  const [staffList, setStaffList] = useState<StaffMember[]>(initialWorkspace.staffList);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(initialWorkspace.auditLogs);
  const [currentStaffId, setCurrentStaffId] = useState<string>(
    initialWorkspace.staffList[0]?.uid || PRIMARY_ADMIN_UID
  );
  const [saleFormResetKey, setSaleFormResetKey] = useState<number>(0);
  const [activeAiTokenGrant, setActiveAiTokenGrant] = useState<AiTokenGrantRecord | null>(null);
  const [chatTargetRoomId, setChatTargetRoomId] = useState<string | null>(null);
  const [unreadChatCount, setUnreadChatCount] = useState<number>(0);
  const lastGrantBonusRef = useRef<number | null>(null);

  // Firebase Realtime Database (gapgold-e6b62-default-rtdb) Sync State & Guards
  const [rtdbSyncState, setRtdbSyncState] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const [adminWorkspaceSummaries, setAdminWorkspaceSummaries] = useState<
    AdminWarehouseAccountSummary[]
  >([]);
  const rtdbHydratedKeyRef = useRef<string | null>(null);
  const rtdbSuppressNextWriteRef = useRef<boolean>(false);
  const rtdbLastFingerprintsRef = useRef<Record<string, string>>({});
  const rtdbLastPayloadRef = useRef<Record<string, RtdbWorkspacePayload>>({});
  const rtdbKnownOwnerUidsRef = useRef<Set<string>>(new Set([PRIMARY_ADMIN_UID]));
  const adminWorkspacesMapRef = useRef<Record<string, unknown>>({});
  const rtdbUsersDirMapRef = useRef<Record<string, RtdbUserDirectoryProfile>>({});
  const prevAuthenticatedUidRef = useRef<string | null>(null);
  const allowEmptyWorkspaceWriteRef = useRef<boolean>(false);
  const forceStorageSyncRef = useRef<boolean>(false);
  const storageCachedWorkspaceRef = useRef<Record<string, RtdbWorkspacePayload>>({});
  const reconciledOwnerUidsFpRef = useRef<Record<string, string>>({});
  const [isManualCloudSyncing, setIsManualCloudSyncing] = useState<boolean>(false);
  const [rtdbWriteTrigger, setRtdbWriteTrigger] = useState<number>(0);

  // Auth & Role State
  const [role, setRole] = useState<UserRole>('staff');
  const [isGoogleAuthenticated, setIsGoogleAuthenticated] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  const currentStaff = useMemo(
    () => staffList.find((s) => s.uid === currentStaffId) || staffList[0] || PRODUCTION_PRIMARY_ADMIN,
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

  // Notification State (declared before workspace persistence effect)
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPrefs>(
    initialWorkspace.notificationPrefs
  );
  const [bankQrConfig, setBankQrConfig] = useState<VietQrBankConfig | undefined>(
    initialWorkspace.bankQrConfig
  );
  const [productNoteTemplates, setProductNoteTemplates] = useState<ProductNoteTemplate[]>(() =>
    resolveProductNoteTemplates(initialWorkspace.productNoteTemplates)
  );
  const [deletedRecords, setDeletedRecords] = useState<DeletedRecordTombstone[]>(
    () => initialWorkspace.deletedRecords || []
  );
  const markRecordsDeleted = (ids: string | string[], nowIso = new Date().toISOString()) => {
    const idArr = Array.isArray(ids) ? ids : [ids];
    const tombstones: DeletedRecordTombstone[] = idArr
      .filter((id) => Boolean(id && id.trim()))
      .map((id) => ({ id: id.trim(), deletedAt: nowIso }));
    if (tombstones.length === 0) return;
    allowEmptyWorkspaceWriteRef.current = true;
    forceStorageSyncRef.current = true;
    setDeletedRecords((prev) => mergeDeletionTombstones(prev, tombstones));
  };
  const unmarkDeletedRecord = (id: string) => {
    if (!id) return;
    forceStorageSyncRef.current = true;
    setDeletedRecords((prev) => prev.filter((t) => t.id !== id));
  };
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [offlineQueue, setOfflineQueue] = useState<OfflineQueueItem[]>(() => loadOfflineQueue());
  const [isFlushingOfflineQueue, setIsFlushingOfflineQueue] = useState(false);
  const [isNotifDrawerOpen, setIsNotifDrawerOpen] = useState(false);
  const [readNotifIds, setReadNotifIds] = useState<Set<string>>(new Set());
  const [toastBanner, setToastBanner] = useState<string | null>(null);
  const [toastUndoAction, setToastUndoAction] = useState<{
    label: string;
    onUndo: () => void;
  } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const [isPwaInstallModalOpen, setIsPwaInstallModalOpen] = useState(false);
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<{
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  } | null>(null);
  const [isStandaloneInstalled, setIsStandaloneInstalled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const nav = window.navigator as Navigator & { standalone?: boolean };
    return (
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      nav.standalone === true
    );
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredInstallPrompt(
        e as unknown as {
          prompt: () => Promise<void>;
          userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
        }
      );
    };
    const handleInstalled = () => {
      setIsStandaloneInstalled(true);
      setDeferredInstallPrompt(null);
      setIsPwaInstallModalOpen(false);
      showToast('Đã cài đặt ứng dụng VTNN Tâm An lên thiết bị thành công!');
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);

    // Support PWA manifest shortcut deep-links (?tab=sales|inventory|debts|imports)
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab') as ActiveTab | null;
    if (tabParam && ['sales', 'imports', 'inventory', 'debts', 'customers', 'reports'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const [autoDailyBackupEnabled, setAutoDailyBackupEnabled] = useState(
    initialWorkspace.autoDailyBackupEnabled
  );

  // Full 2-layer localStorage persistence across F5 reloads
  useEffect(() => {
    saveWorkspaceToStorage({
      version: 2,
      products,
      customers,
      suppliers,
      sales,
      imports,
      receiptVouchers,
      paymentVouchers,
      savedVouchers,
      stockAdjustments,
      backups,
      auditLogs,
      warehouses,
      customerGroups,
      productCategories,
      receiptGroups,
      paymentGroups,
      staffList,
      notificationPrefs,
      bankQrConfig,
      productNoteTemplates,
      deletedRecords,
      autoDailyBackupEnabled,
    });
  }, [
    products,
    customers,
    suppliers,
    sales,
    imports,
    receiptVouchers,
    paymentVouchers,
    savedVouchers,
    stockAdjustments,
    backups,
    auditLogs,
    warehouses,
    customerGroups,
    productCategories,
    receiptGroups,
    paymentGroups,
    staffList,
    notificationPrefs,
    bankQrConfig,
    productNoteTemplates,
    deletedRecords,
    autoDailyBackupEnabled,
  ]);

  // Cross-tab synchronization via storage event
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== WORKSPACE_STORAGE_KEY || !e.newValue) return;
      try {
        const parsed = loadWorkspaceFromStorage();
        setProducts(parsed.products);
        setCustomers(parsed.customers);
        setSuppliers(parsed.suppliers);
        setSales(parsed.sales);
        setImports(parsed.imports);
        setReceiptVouchers(parsed.receiptVouchers);
        setPaymentVouchers(parsed.paymentVouchers);
        setSavedVouchers(parsed.savedVouchers);
        setStockAdjustments(parsed.stockAdjustments || []);
        setBackups(parsed.backups);
        setAuditLogs(parsed.auditLogs);
        setWarehouses(parsed.warehouses);
        setCustomerGroups(parsed.customerGroups);
        setProductCategories(parsed.productCategories);
        setReceiptGroups(parsed.receiptGroups);
        setPaymentGroups(parsed.paymentGroups);
        setStaffList(sanitizeStaffListForStorage(parsed.staffList));
        setNotificationPrefs(parsed.notificationPrefs);
        if (parsed.bankQrConfig) {
          setBankQrConfig(parsed.bankQrConfig);
        }
        if (parsed.productNoteTemplates && parsed.productNoteTemplates.length > 0) {
          setProductNoteTemplates(parsed.productNoteTemplates);
        }
        if (parsed.deletedRecords) {
          setDeletedRecords(parsed.deletedRecords);
        }
      } catch {
        // ignore invalid storage payload
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // Global Multi-Warehouse Filter state for Primary Manager & Deputy General Manager
  const [selectedFilterWarehouses, setSelectedFilterWarehouses] = useState<string[]>([]);

  const canFilterMultiWarehouses = useMemo(
    () => canStaffFilterMultiWarehouses(currentStaff),
    [currentStaff]
  );

  const allowedWarehouses = useMemo(
    () => getStaffAllowedWarehouses(currentStaff, warehouses),
    [currentStaff, warehouses]
  );

  // Determine warehouse lock:
  // If staff cannot filter multi-warehouses, they are locked to their single assigned warehouse.
  // If they CAN filter multi-warehouses and picked exactly 1 warehouse, lock forms/views to that 1 warehouse.
  const lockedWarehouse = useMemo<string | null>(() => {
    if (!canFilterMultiWarehouses) {
      return currentStaff.assignedWarehouse || allowedWarehouses[0] || warehouses[0] || 'Tâm An Mỹ Ngãi';
    }
    const active = resolveActiveWarehouses(currentStaff, warehouses, selectedFilterWarehouses);
    if (active.length === 1 && allowedWarehouses.length > 1) {
      return active[0];
    }
    return null;
  }, [canFilterMultiWarehouses, currentStaff, allowedWarehouses, warehouses, selectedFilterWarehouses]);

  const activeWarehouseLabel = useMemo(
    () =>
      formatSelectedWarehousesBadge(currentStaff, warehouses, selectedFilterWarehouses, false),
    [currentStaff, warehouses, selectedFilterWarehouses]
  );

  const detailedWarehouseLabel = useMemo(
    () =>
      formatSelectedWarehousesBadge(currentStaff, warehouses, selectedFilterWarehouses, true),
    [currentStaff, warehouses, selectedFilterWarehouses]
  );

  // Visible data scoped by per-staff warehouse permission OR manager's selected warehouse filter
  const visibleProducts = useMemo(
    () =>
      filterRecordsBySelectedWarehouses(
        products,
        currentStaff,
        warehouses,
        selectedFilterWarehouses
      ),
    [products, currentStaff, warehouses, selectedFilterWarehouses]
  );

  const visibleSales = useMemo(
    () =>
      filterRecordsBySelectedWarehouses(
        sales,
        currentStaff,
        warehouses,
        selectedFilterWarehouses
      ),
    [sales, currentStaff, warehouses, selectedFilterWarehouses]
  );

  const visibleImports = useMemo(
    () =>
      filterRecordsBySelectedWarehouses(
        imports,
        currentStaff,
        warehouses,
        selectedFilterWarehouses
      ),
    [imports, currentStaff, warehouses, selectedFilterWarehouses]
  );

  const visibleReceiptVouchers = useMemo(
    () =>
      filterRecordsBySelectedWarehouses(
        receiptVouchers,
        currentStaff,
        warehouses,
        selectedFilterWarehouses
      ),
    [receiptVouchers, currentStaff, warehouses, selectedFilterWarehouses]
  );

  const visiblePaymentVouchers = useMemo(
    () =>
      filterRecordsBySelectedWarehouses(
        paymentVouchers,
        currentStaff,
        warehouses,
        selectedFilterWarehouses
      ),
    [paymentVouchers, currentStaff, warehouses, selectedFilterWarehouses]
  );

  const visibleCustomers = useMemo(
    () =>
      filterRecordsBySelectedWarehouses(
        customers,
        currentStaff,
        warehouses,
        selectedFilterWarehouses
      ),
    [customers, currentStaff, warehouses, selectedFilterWarehouses]
  );

  const visibleSuppliers = useMemo(
    () =>
      filterRecordsBySelectedWarehouses(
        suppliers,
        currentStaff,
        warehouses,
        selectedFilterWarehouses
      ),
    [suppliers, currentStaff, warehouses, selectedFilterWarehouses]
  );

  const visibleSavedVouchers = useMemo(
    () =>
      filterRecordsBySelectedWarehouses(
        savedVouchers,
        currentStaff,
        warehouses,
        selectedFilterWarehouses
      ),
    [savedVouchers, currentStaff, warehouses, selectedFilterWarehouses]
  );

  const visibleStockAdjustments = useMemo(
    () =>
      filterRecordsBySelectedWarehouses(
        stockAdjustments,
        currentStaff,
        warehouses,
        selectedFilterWarehouses
      ),
    [stockAdjustments, currentStaff, warehouses, selectedFilterWarehouses]
  );

  const isAdminAccount = useMemo(
    () => canAccountCreateStaff(currentStaff),
    [currentStaff]
  );

  const visibleAuditLogs = useMemo(() => {
    if (canFilterMultiWarehouses) {
      if (selectedFilterWarehouses.length === 0) return auditLogs;
      return auditLogs.filter(
        (log) =>
          selectedFilterWarehouses.includes(log.warehouseName) ||
          log.warehouseName === 'Tất cả kho'
      );
    }
    const targetWh = currentStaff.assignedWarehouse;
    return auditLogs.filter(
      (log) => log.warehouseName === targetWh || log.actorUid === currentStaff.uid
    );
  }, [auditLogs, canFilterMultiWarehouses, selectedFilterWarehouses, currentStaff]);

  // Cross-module navigation & deep-linked voucher state
  const [preselectedCustomerId, setPreselectedCustomerId] = useState<string | null>(null);
  const [preselectedProductId, setPreselectedProductId] = useState<string | null>(null);
  const [focusedDebtRecordId, setFocusedDebtRecordId] = useState<string | null>(null);
  const [focusedProductId, setFocusedProductId] = useState<string | null>(null);
  const [importNewProductTrigger, setImportNewProductTrigger] = useState<{
    key: number;
    initialName: string;
  } | null>(null);
  const [quickRenameWarehouseOpen, setQuickRenameWarehouseOpen] = useState<boolean>(false);
  const [quickRenameSuffix, setQuickRenameSuffix] = useState<string>('');
  const pendingRegistrationRef = useRef<{
    email: string;
    displayName: string;
    customWarehouseName?: string;
  } | null>(null);

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

  const syncUserSessionFromFirebase = (user: {
    uid: string;
    email: string | null;
    displayName: string | null;
    emailVerified: boolean;
  }) => {
    const emailLower = (user.email || '').trim().toLowerCase();
    const isRemoteAdmin = isCurrentUserAdmin(user as Parameters<typeof isCurrentUserAdmin>[0]);
    const nextActiveUid = isRemoteAdmin ? PRIMARY_ADMIN_UID : user.uid;

    // If switching from a different authenticated user on this device, pause sync & clear previous user's records
    if (
      prevAuthenticatedUidRef.current &&
      prevAuthenticatedUidRef.current !== nextActiveUid &&
      !isRemoteAdmin
    ) {
      rtdbHydratedKeyRef.current = null;
      rtdbSuppressNextWriteRef.current = true;
      setProducts([]);
      setCustomers([]);
      setSuppliers([]);
      setSales([]);
      setImports([]);
      setReceiptVouchers([]);
      setPaymentVouchers([]);
      setSavedVouchers([]);
      setStockAdjustments([]);
      setAuditLogs([]);
    }
    prevAuthenticatedUidRef.current = nextActiveUid;

    setIsGoogleAuthenticated(true);
    setCurrentUserEmail(user.email || ADMIN_BACKUP_EMAIL);
    setCloudSyncStatus(
      canWriteToFirestore(user as Parameters<typeof canWriteToFirestore>[0]) ? 'synced' : 'unverified'
    );

    const curStaffList = latestWorkspaceRef.current.staffList;
    const matchedExisting = curStaffList.find(
      (s) =>
        s.uid === user.uid ||
        (emailLower && s.email && s.email.toLowerCase() === emailLower)
    );

    const pendingReg =
      pendingRegistrationRef.current &&
      pendingRegistrationRef.current.email.toLowerCase() === emailLower
        ? pendingRegistrationRef.current
        : null;
    if (pendingReg) {
      pendingRegistrationRef.current = null;
    }

    let resolvedStaff: StaffMember;
    const nowIso = new Date().toISOString();

    if (matchedExisting) {
      const targetUid = isRemoteAdmin ? PRIMARY_ADMIN_UID : user.uid;
      const migrated = normalizeIndependentWarehouseStaffMember({
        ...matchedExisting,
        uid: targetUid,
        displayName:
          pendingReg?.displayName || matchedExisting.displayName || user.displayName || matchedExisting.username,
        assignedWarehouse:
          pendingReg?.customWarehouseName || matchedExisting.assignedWarehouse,
        updatedAt: nowIso,
      });
      resolvedStaff = migrated;

      // Heal legacy records previously created under 'Kho VTNN Tâm An'
      if (
        !isRemoteAdmin &&
        matchedExisting.assignedWarehouse === 'Kho VTNN Tâm An' &&
        migrated.assignedWarehouse !== 'Kho VTNN Tâm An'
      ) {
        const healedWh = migrated.assignedWarehouse;
        setProducts((p) =>
          p.map((x) => (x.warehouseName === 'Kho VTNN Tâm An' ? { ...x, warehouseName: healedWh } : x))
        );
        setSales((p) =>
          p.map((x) => (x.warehouseName === 'Kho VTNN Tâm An' ? { ...x, warehouseName: healedWh } : x))
        );
        setImports((p) =>
          p.map((x) => (x.warehouseName === 'Kho VTNN Tâm An' ? { ...x, warehouseName: healedWh } : x))
        );
        setCustomers((p) =>
          p.map((x) => (x.warehouseName === 'Kho VTNN Tâm An' ? { ...x, warehouseName: healedWh } : x))
        );
      }

      setStaffList((prev) => {
        const filtered = prev.filter(
          (s) => s.uid !== matchedExisting.uid && s.uid !== resolvedStaff.uid
        );
        return [...filtered, resolvedStaff];
      });
    } else {
      const baseUser =
        emailLower.split('@')[0]?.replace(/[^a-zA-Z0-9._-]/g, '') ||
        `user_${user.uid.slice(0, 6)}`;
      const autoWarehouseName = isRemoteAdmin
        ? 'Tất cả kho'
        : pendingReg?.customWarehouseName
        ? normalizeCustomTamAnWarehouseName(pendingReg.customWarehouseName, emailLower)
        : formatDefaultWarehouseNameFromGmail(emailLower || `${baseUser}@gmail.com`);

      resolvedStaff = {
        uid: isRemoteAdmin ? PRIMARY_ADMIN_UID : user.uid,
        username: isRemoteAdmin ? 'admin' : baseUser,
        password: '',
        displayName:
          pendingReg?.displayName ||
          (user.displayName && user.displayName.trim()) ||
          baseUser,
        phone: isRemoteAdmin ? ADMIN_PRIMARY_PHONE : '',
        email: emailLower || ADMIN_BACKUP_EMAIL,
        role: 'manager',
        positionRole: isRemoteAdmin ? 'primary_manager' : 'warehouse_manager',
        permissions: isRemoteAdmin
          ? getDefaultPermissionsForPosition('primary_manager')
          : getIndependentWarehouseFullPermissions(),
        assignedWarehouse: autoWarehouseName,
        active: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      setStaffList((prev) =>
        prev.some((s) => s.uid === resolvedStaff.uid)
          ? prev.map((s) => (s.uid === resolvedStaff.uid ? resolvedStaff : s))
          : [...prev, resolvedStaff]
      );
    }

    if (!isRemoteAdmin && resolvedStaff.assignedWarehouse) {
      const ownWh = resolvedStaff.assignedWarehouse;
      setWarehouses((wh) => {
        const cleaned = wh.filter((w) => w !== 'Kho VTNN Tâm An');
        return cleaned.includes(ownWh) ? cleaned : [...cleaned, ownWh];
      });
    }

    setCurrentStaffId(resolvedStaff.uid);
    setRole(resolvedStaff.role);
    setIsSessionLoggedIn(true);
  };

  useEffect(() => {
    const fallbackTimer = window.setTimeout(() => {
      setIsAuthChecking(false);
    }, 1200);

    const unsubscribe = initAuth(
      async (user) => {
        window.clearTimeout(fallbackTimer);
        syncUserSessionFromFirebase(user);
        setIsAuthChecking(false);
        try {
          const isRemoteAdmin = isCurrentUserAdmin(user);
          const remote = await fetchUserFirestoreData(user.uid, isRemoteAdmin);
          // Only pull legacy Firestore docs if RTDB has NOT already hydrated authoritative cloud state,
          // and ALWAYS filter out deleted record tombstones so deleted items can NEVER resurrect!
          if (remote && !rtdbHydratedKeyRef.current) {
            const curTombstones = latestWorkspaceRef.current.deletedRecords;
            if (remote.products.length > 0) {
              const safeProds = filterOutDeletedRecords(remote.products, curTombstones);
              if (safeProds.length > 0) {
                setProducts((prev) => mergeRecordsById(prev, safeProds));
              }
            }
            if (remote.customers.length > 0) {
              const safeCusts = filterOutDeletedRecords(remote.customers, curTombstones);
              if (safeCusts.length > 0) {
                setCustomers((prev) => mergeRecordsById(prev, safeCusts));
              }
            }
            if (remote.sales.length > 0) {
              const safeSales = filterOutDeletedRecords(remote.sales, curTombstones);
              if (safeSales.length > 0) {
                setSales((prev) => mergeRecordsById(prev, safeSales));
              }
            }
            if (remote.imports.length > 0) {
              const safeImps = filterOutDeletedRecords(remote.imports, curTombstones);
              if (safeImps.length > 0) {
                setImports((prev) => mergeRecordsById(prev, safeImps));
              }
            }
            if (remote.backups.length > 0) {
              setBackups((prev) => {
                const map = new Map<string, BackupEntry>();
                prev.forEach((b) => map.set(b.id, b));
                remote.backups.forEach((b) => {
                  if (!map.has(b.id)) map.set(b.id, b);
                });
                return Array.from(map.values());
              });
            }
            if (remote.notificationPrefs) {
              setNotificationPrefs(remote.notificationPrefs);
            }
          }
        } catch (err) {
          console.warn('Firestore initial sync notice:', err);
        }
      },
      () => {
        window.clearTimeout(fallbackTimer);
        setIsGoogleAuthenticated(false);
        setCloudSyncStatus('local');
        setIsAuthChecking(false);
      }
    );
    return () => {
      window.clearTimeout(fallbackTimer);
      unsubscribe();
    };
  }, []);

  const showToast = (msg: string, undo?: { label?: string; onUndo: () => void }) => {
    if (toastTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToastBanner(msg);
    setToastUndoAction(undo ? { label: undo.label || 'Hoàn tác', onUndo: undo.onUndo } : null);
    if (typeof window !== 'undefined') {
      toastTimerRef.current = window.setTimeout(
        () => {
          setToastBanner((prev) => (prev === msg ? null : prev));
          setToastUndoAction(null);
          toastTimerRef.current = null;
        },
        undo ? 10000 : 4500
      );
    }
  };

  // Realtime subscription to Admin AI Token Grants & Zalo-like Internal Chat directory
  useEffect(() => {
    if (!isSessionLoggedIn) {
      setActiveAiTokenGrant(null);
      lastGrantBonusRef.current = null;
      return;
    }

    const isPrimary = canAccountCreateStaff(currentStaff);
    const activeUid =
      (isPrimary ? PRIMARY_ADMIN_UID : auth.currentUser?.uid || currentStaff.uid) ||
      currentStaff.uid;
    const activeEmail = currentStaff.email || currentUserEmail || '';
    const grantLookupKey = activeUid || activeEmail || 'guest';

    const unsubGrant = subscribeToAiTokenGrant(grantLookupKey, (grant) => {
      setActiveAiTokenGrant(grant);
      const nextBonus = grant?.bonusTokens || 0;
      if (lastGrantBonusRef.current !== null && nextBonus > lastGrantBonusRef.current && grant) {
        const diff = nextBonus - lastGrantBonusRef.current;
        showToast(
          `Admin vừa cấp thêm +${diff.toLocaleString('vi-VN')} token Trợ lý A.I cho tài khoản của bạn!`
        );
      }
      lastGrantBonusRef.current = nextBonus;
    });

    let unsubRooms = () => {};
    if (isGoogleAuthenticated && auth.currentUser) {
      const fbUser = auth.currentUser;
      const isAuthAdmin = isCurrentUserAdmin(fbUser);
      if (!isAuthAdmin || currentStaff.uid === PRIMARY_ADMIN_UID) {
        void upsertChatUserDirectoryProfile({
          uid: isAuthAdmin ? PRIMARY_ADMIN_UID : activeUid,
          displayName: currentStaff.displayName,
          warehouseName: currentStaff.assignedWarehouse || 'VTNN Tâm An',
          isPrimaryAdmin: isAuthAdmin || isPrimary,
          roleLabel: getPositionRoleLabel(currentStaff.positionRole),
        });
      }
      if (isPrimary) {
        void seedExistingStaffToChatDirectoryIfAdmin();
      }

      unsubRooms = subscribeToUserChatRooms(activeUid, isPrimary, (roomsList) => {
        if (activeTabRef.current === 'internal_chat') return;
        try {
          const rawRead = localStorage.getItem(`vtnn_taman_chat_last_read_v1_${activeUid}`);
          const lastReadMap = rawRead ? (JSON.parse(rawRead) as Record<string, number>) : {};
          const unread = roomsList.filter(
            (r) =>
              r.lastSenderUid &&
              r.lastSenderUid !== activeUid &&
              r.lastMessageAtMs > (lastReadMap[r.roomId] || 0)
          ).length;
          setUnreadChatCount(unread);
        } catch {
          // ignore
        }
      });
    }

    return () => {
      unsubGrant();
      unsubRooms();
    };
  }, [
    isSessionLoggedIn,
    isGoogleAuthenticated,
    currentStaff.uid,
    currentStaff.displayName,
    currentStaff.assignedWarehouse,
    currentStaff.positionRole,
    currentStaff.email,
    currentUserEmail,
  ]);

  // Keep a live reference to latest state so RTDB hydration callbacks never read stale closures
  const latestWorkspaceRef = useRef({
    products,
    customers,
    suppliers,
    sales,
    imports,
    receiptVouchers,
    paymentVouchers,
    savedVouchers,
    stockAdjustments,
    auditLogs,
    backups,
    warehouses,
    customerGroups,
    productCategories,
    receiptGroups,
    paymentGroups,
    staffList,
    notificationPrefs,
    bankQrConfig,
    productNoteTemplates,
    deletedRecords,
    autoDailyBackupEnabled,
  });
  latestWorkspaceRef.current = {
    products,
    customers,
    suppliers,
    sales,
    imports,
    receiptVouchers,
    paymentVouchers,
    savedVouchers,
    stockAdjustments,
    auditLogs,
    backups,
    warehouses,
    customerGroups,
    productCategories,
    receiptGroups,
    paymentGroups,
    staffList,
    notificationPrefs,
    bankQrConfig,
    productNoteTemplates,
    deletedRecords,
    autoDailyBackupEnabled,
  };

  // Offline Queue: Monitor browser online/offline transitions
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => {
      setIsOnline(false);
      showToast(
        'Đang ở chế độ Ngoại tuyến — Mọi đơn bán & giao dịch vẫn được lưu an toàn trên thiết bị và sẽ tự đồng bộ khi có mạng!'
      );
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const trackOfflineOperation = (
    actionType: OfflineQueueItem['actionType'],
    label: string,
    warehouseName?: string
  ) => {
    if (!isOnline || rtdbSyncState === 'offline') {
      setOfflineQueue((prev) =>
        enqueueOfflineQueueItem(prev, {
          actionType,
          label,
          warehouseName,
        })
      );
    }
  };

  const handleFlushOfflineQueueNow = () => {
    if (isFlushingOfflineQueue) return;
    if (!isOnline) {
      showToast('Thiết bị vẫn đang mất kết nối mạng. Vui lòng bật 4G/Wi-Fi để đồng bộ.');
      return;
    }
    const pendingCount = offlineQueue.length;
    setIsFlushingOfflineQueue(true);
    try {
      // Force fresh RTDB + Firebase Storage upload for current account
      rtdbLastFingerprintsRef.current = {};
      rtdbSuppressNextWriteRef.current = false;
      setRtdbWriteTrigger((n) => n + 1);
      clearOfflineQueueStorage();
      setOfflineQueue([]);
      showToast(
        pendingCount > 0
          ? `Đã đồng bộ thành công ${pendingCount} thao tác ngoại tuyến lên Firebase Realtime DB & Storage!`
          : 'Đã kích hoạt đồng bộ đám mây thành công!'
      );
    } finally {
      window.setTimeout(() => setIsFlushingOfflineQueue(false), 1200);
    }
  };

  // Automatically flush queued offline operations once connectivity + Realtime DB live return
  useEffect(() => {
    if (
      !isOnline ||
      rtdbSyncState !== 'live' ||
      !isSessionLoggedIn ||
      !isGoogleAuthenticated ||
      offlineQueue.length === 0 ||
      isFlushingOfflineQueue
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      handleFlushOfflineQueueNow();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [
    isOnline,
    rtdbSyncState,
    isSessionLoggedIn,
    isGoogleAuthenticated,
    offlineQueue.length,
    isFlushingOfflineQueue,
  ]);

  // Monitor Firebase RTDB connection state (.info/connected)
  useEffect(() => {
    if (!isGoogleAuthenticated || !auth.currentUser) {
      setRtdbSyncState('offline');
      return;
    }
    setRtdbSyncState('connecting');
    const unsubConn = subscribeToRtdbConnectionState((connected) => {
      setRtdbSyncState(connected ? 'live' : 'offline');
    });
    return () => {
      unsubConn();
    };
  }, [isGoogleAuthenticated]);

  // Real-time bidirectional sync with Firebase Realtime Database (gapgold-e6b62-default-rtdb)
  // AND Firebase Storage (gapgold-e6b62.firebasestorage.app/files -> /documents/workspaces/ & /backups/)
  const designatedMultiWhOwnerUidsKey = useMemo(() => {
    if (canAccountCreateStaff(currentStaff) || !hasMultiWarehouseManagementGrant(currentStaff)) {
      return '';
    }
    if (
      currentStaff.assignedWarehouse === 'Tất cả kho' ||
      currentStaff.positionRole === 'deputy_general_manager' ||
      Boolean(currentStaff.permissions?.includes('manage_all_warehouses'))
    ) {
      return '__ALL__';
    }
    const uids = Array.from(
      new Set(
        [
          currentStaff.uid,
          ...Object.entries(currentStaff.assignedOwnerUids || {})
            .filter(([, allowed]) => Boolean(allowed))
            .map(([uid]) => uid),
        ].filter(Boolean)
      )
    ).sort();
    const whKeys = dedupeWarehouseNames(currentStaff.assignedWarehouses || [])
      .map((w) => normalizeWarehouseKey(w))
      .filter(Boolean)
      .sort()
      .join('|');
    return `${uids.join(',')}::${whKeys}`;
  }, [currentStaff]);

  const buildExistingMetaByUid = (): Record<string, RtdbWorkspaceMeta> => {
    const out: Record<string, RtdbWorkspaceMeta> = {};
    for (const [uid, payload] of Object.entries(rtdbLastPayloadRef.current)) {
      if (payload?.meta) {
        out[uid] = payload.meta;
      }
    }
    return out;
  };

  useEffect(() => {
    const fbUser = auth.currentUser;
    if (!isSessionLoggedIn || !isGoogleAuthenticated || !fbUser) {
      rtdbHydratedKeyRef.current = null;
      return;
    }

    const isPrimary = isCurrentUserAdmin(fbUser);
    const isDesignatedMultiWh = !isPrimary && Boolean(designatedMultiWhOwnerUidsKey);
    const isDesignatedAllWh = isDesignatedMultiWh && designatedMultiWhOwnerUidsKey === '__ALL__';
    const designatedOwnerUidList =
      isDesignatedMultiWh && !isDesignatedAllWh
        ? designatedMultiWhOwnerUidsKey.split('::')[0].split(',').filter(Boolean)
        : [];
    const activeUid = isPrimary ? PRIMARY_ADMIN_UID : fbUser.uid;
    const sessionKey = isPrimary
      ? `admin:${PRIMARY_ADMIN_UID}`
      : isDesignatedMultiWh
      ? `multi:${activeUid}:${designatedMultiWhOwnerUidsKey}`
      : `user:${activeUid}`;
    let cancelled = false;

    rtdbHydratedKeyRef.current = null;

    if (isPrimary || isDesignatedMultiWh) {
      if (isPrimary) {
        void upsertRealtimeUserDirectoryProfile(PRODUCTION_PRIMARY_ADMIN);
        void seedExistingStaffToRealtimeDirectoryIfAdmin(latestWorkspaceRef.current.staffList);
      }

      const discoveredStorageUidSet = new Set<string>(designatedOwnerUidList);

      const applyAdminAggregate = () => {
        if (cancelled) return;
        const rtdbMap = adminWorkspacesMapRef.current;
        const storageMap = storageCachedWorkspaceRef.current;
        const dirMap = rtdbUsersDirMapRef.current;

        // Combine RTDB + Firebase Storage snapshots per UID safely with tombstone-aware merge
        const combinedUids = new Set<string>(Object.keys(rtdbMap || {}));
        if (isPrimary || isDesignatedAllWh) {
          Object.keys(storageMap || {}).forEach((uid) => combinedUids.add(uid));
        } else {
          discoveredStorageUidSet.forEach((uid) => {
            if (storageMap[uid] || rtdbMap[uid]) combinedUids.add(uid);
          });
        }

        const effectiveWsMap: Record<string, unknown> = {};
        combinedUids.forEach((uid) => {
          const rawRtdb = rtdbMap[uid];
          const cachedStorage = storageMap[uid] || null;
          if (rawRtdb && cachedStorage) {
            const normRtdb = normalizeWorkspaceFromRtdb(rawRtdb, uid);
            const merged = mergeWorkspacePayloads(normRtdb, cachedStorage, uid);
            effectiveWsMap[uid] = merged || rawRtdb;
          } else if (rawRtdb) {
            effectiveWsMap[uid] = rawRtdb;
          } else if (cachedStorage) {
            effectiveWsMap[uid] = cachedStorage;
          }
        });

        const agg = aggregateAdminWorkspacesFromRtdb(effectiveWsMap, dirMap);

        if (isPrimary) {
          setAdminWorkspaceSummaries((prev) =>
            JSON.stringify(prev) === JSON.stringify(agg.adminSummaries) ? prev : agg.adminSummaries
          );
          void writeAdminWorkspacesIndexToFirebaseStorage(agg.adminSummaries);
        }

        const dirProfiles = Object.values(dirMap);
        let mergedStaffSnapshot = latestWorkspaceRef.current.staffList;
        if (dirProfiles.length > 0) {
          mergedStaffSnapshot = mergeDirectoryIntoStaffList(mergedStaffSnapshot, dirProfiles);
          setStaffList((prev) => {
            const merged = mergeDirectoryIntoStaffList(prev, dirProfiles);
            return JSON.stringify(prev) === JSON.stringify(merged) ? prev : merged;
          });
        }

        // Primary Admin auto-reconcile: ensure every multi-warehouse account's assignedOwnerUids stays complete
        // even if a granted warehouse had different casing ("Tâm An Mỹ Ngãi" vs "TÂM AN MỸ NGÃI") or a new owner joined!
        if (isPrimary && Object.keys(effectiveWsMap).length > 0) {
          for (const st of mergedStaffSnapshot) {
            if (
              !st?.uid ||
              canAccountCreateStaff(st) ||
              !st.multiWarehouseGrantedByAdmin ||
              st.assignedWarehouse === 'Tất cả kho' ||
              !st.assignedWarehouses ||
              st.assignedWarehouses.length < 2
            ) {
              continue;
            }
            const expectedOwnerUids = resolveDesignatedOwnerUidsForWarehouses({
              targetUid: st.uid,
              selectedWarehouses: st.assignedWarehouses,
              staffList: mergedStaffSnapshot,
              workspacesMap: effectiveWsMap,
              adminSummaries: agg.adminSummaries,
            });
            const curKeys = Object.entries(st.assignedOwnerUids || {})
              .filter(([, allowed]) => Boolean(allowed))
              .map(([k]) => k)
              .sort()
              .join(',');
            const nextKeys = Object.keys(expectedOwnerUids).sort().join(',');
            if (nextKeys && nextKeys !== curKeys && reconciledOwnerUidsFpRef.current[st.uid] !== nextKeys) {
              reconciledOwnerUidsFpRef.current[st.uid] = nextKeys;
              const reconciledStaff: StaffMember = {
                ...st,
                assignedOwnerUids: expectedOwnerUids,
                updatedAt: new Date().toISOString(),
              };
              setStaffList((prev) => prev.map((s) => (s.uid === st.uid ? reconciledStaff : s)));
              void upsertRealtimeUserDirectoryProfile(reconciledStaff);
            }
          }
        }

        const wsKeys = Object.keys(effectiveWsMap);
        wsKeys.forEach((uid) => rtdbKnownOwnerUidsRef.current.add(uid));

        if (wsKeys.length === 0) {
          if (isPrimary && rtdbHydratedKeyRef.current !== sessionKey) {
            rtdbHydratedKeyRef.current = sessionKey;
            setRtdbWriteTrigger((n) => n + 1);
          }
          return;
        }

        // Check if any remote workspace bucket changed compared to our last known fingerprint
        let hasRemoteChanges = rtdbHydratedKeyRef.current !== sessionKey;
        let hasLegacyBucket = false;
        for (const [uid, normPayload] of Object.entries(agg.normalizedWorkspaces)) {
          rtdbLastPayloadRef.current[uid] = normPayload;
          if (isRealtimeWorkspaceLegacyLayout(uid)) {
            rtdbLastFingerprintsRef.current[uid] = '';
            hasLegacyBucket = true;
            hasRemoteChanges = true;
          } else {
            const remoteFp = computeWorkspaceFingerprint(normPayload);
            if (rtdbLastFingerprintsRef.current[uid] !== remoteFp) {
              rtdbLastFingerprintsRef.current[uid] = remoteFp;
              hasRemoteChanges = true;
            }
          }
        }

        if (hasRemoteChanges) {
          rtdbHydratedKeyRef.current = sessionKey;
          rtdbSuppressNextWriteRef.current = true;

          const cur = latestWorkspaceRef.current;
          const mergedTombstones = mergeDeletionTombstones(cur.deletedRecords, agg.deletedRecords);

          // Cloud RTDB + Storage is authoritative for deletions — NEVER union stale localStorage deleted records back!
          const nextProds = filterOutDeletedRecords(agg.products, mergedTombstones);
          const nextCusts = filterOutDeletedRecords(agg.customers, mergedTombstones);
          const nextSups = filterOutDeletedRecords(agg.suppliers, mergedTombstones);
          const nextSales = filterOutDeletedRecords(agg.sales, mergedTombstones);
          const nextImps = filterOutDeletedRecords(agg.imports, mergedTombstones);
          const nextRvs = filterOutDeletedRecords(agg.receiptVouchers, mergedTombstones);
          const nextPvs = filterOutDeletedRecords(agg.paymentVouchers, mergedTombstones);
          const nextSvs = filterOutDeletedRecords(agg.savedVouchers, mergedTombstones);
          const nextAdjs = filterOutDeletedRecords(agg.stockAdjustments, mergedTombstones);
          const nextLogs = dedupeRecordsById([...agg.auditLogs]).slice(0, 500);
          const nextBks = dedupeRecordsById([...agg.backups]);
          const ownMultiWhs =
            isDesignatedMultiWh && currentStaff.assignedWarehouses
              ? currentStaff.assignedWarehouses
              : [];
          const nextWhs = dedupeWarehouseNames([
            ...cur.warehouses,
            ...agg.warehouses,
            ...ownMultiWhs,
          ]);
          const nextCGs = Array.from(new Set([...cur.customerGroups, ...agg.customerGroups]));
          const nextPCs = Array.from(
            new Set([...cur.productCategories, ...agg.productCategories])
          );
          const nextRGs = Array.from(new Set([...cur.receiptGroups, ...agg.receiptGroups]));
          const nextPGs = Array.from(new Set([...cur.paymentGroups, ...agg.paymentGroups]));

          // Baseline the partitioned fingerprints so hydrating from RTDB/Storage never triggers an echo write loop
          const baselinePartitioned = partitionAdminStateByWorkspace({
            products: nextProds,
            customers: nextCusts,
            suppliers: nextSups,
            sales: nextSales,
            imports: nextImps,
            receiptVouchers: nextRvs,
            paymentVouchers: nextPvs,
            savedVouchers: nextSvs,
            stockAdjustments: nextAdjs,
            auditLogs: nextLogs,
            backups: nextBks,
            settings: {
              warehouses: nextWhs,
              customerGroups: nextCGs,
              productCategories: nextPCs,
              receiptGroups: nextRGs,
              paymentGroups: nextPGs,
              notificationPrefs: cur.notificationPrefs,
              ...(cur.bankQrConfig ? { bankQrConfig: cur.bankQrConfig } : {}),
              productNoteTemplates: cur.productNoteTemplates,
              ...(mergedTombstones.length > 0 ? { deletedRecords: mergedTombstones } : {}),
              autoDailyBackupEnabled: cur.autoDailyBackupEnabled,
            },
            staffList: mergedStaffSnapshot,
            knownOwnerUids: Array.from(rtdbKnownOwnerUidsRef.current),
            adminUid: isPrimary ? PRIMARY_ADMIN_UID : activeUid,
            nowIso: new Date().toISOString(),
            existingMetaByUid: buildExistingMetaByUid(),
          });
          for (const [bUid, bPayload] of Object.entries(baselinePartitioned)) {
            if (!isRealtimeWorkspaceLegacyLayout(bUid)) {
              rtdbLastFingerprintsRef.current[bUid] = computeWorkspaceFingerprint(bPayload);
            }
          }

          productsRef.current = nextProds;
          setProducts(nextProds);
          setCustomers(nextCusts);
          setSuppliers(nextSups);
          setSales(nextSales);
          setImports(nextImps);
          setReceiptVouchers(nextRvs);
          setPaymentVouchers(nextPvs);
          setSavedVouchers(nextSvs);
          setStockAdjustments(nextAdjs);
          setAuditLogs(nextLogs);
          setBackups(nextBks);
          setDeletedRecords((prev) =>
            JSON.stringify(prev) === JSON.stringify(mergedTombstones) ? prev : mergedTombstones
          );
          setWarehouses((prev) =>
            JSON.stringify(prev) === JSON.stringify(nextWhs) ? prev : nextWhs
          );
          setCustomerGroups((prev) =>
            JSON.stringify(prev) === JSON.stringify(nextCGs) ? prev : nextCGs
          );
          setProductCategories((prev) =>
            JSON.stringify(prev) === JSON.stringify(nextPCs) ? prev : nextPCs
          );
          setReceiptGroups((prev) =>
            JSON.stringify(prev) === JSON.stringify(nextRGs) ? prev : nextRGs
          );
          setPaymentGroups((prev) =>
            JSON.stringify(prev) === JSON.stringify(nextPGs) ? prev : nextPGs
          );

          if (hasLegacyBucket && isPrimary) {
            rtdbSuppressNextWriteRef.current = false;
            setRtdbWriteTrigger((n) => n + 1);
          }
        }
      };

      // Pull Firebase Storage snapshots for designated multi-warehouse managers on Web & Phone!
      // Reads /documents/workspaces/all_warehouses_summary.json + every matching uid_{ownerUid}.json
      if (isDesignatedMultiWh) {
        void (async () => {
          try {
            const summaries = await readAdminWorkspacesIndexFromFirebaseStorage();
            if (cancelled) return;
            const grantedWhKeys = new Set(
              dedupeWarehouseNames(currentStaff.assignedWarehouses || [])
                .map((w) => normalizeWarehouseKey(w))
                .filter(Boolean)
            );
            const storageTargets: Array<{
              uid: string;
              email?: string | null;
              assignedWarehouse?: string | null;
            }> = designatedOwnerUidList.map((u) => ({
              uid: u,
              email: u === activeUid ? fbUser.email || currentStaff.email : undefined,
              assignedWarehouse: u === activeUid ? currentStaff.assignedWarehouse : undefined,
            }));

            for (const sum of summaries) {
              if (!sum?.uid) continue;
              const sumWhKey = normalizeWarehouseKey(sum.assignedWarehouse);
              const matches =
                isDesignatedAllWh ||
                discoveredStorageUidSet.has(sum.uid) ||
                (Boolean(sumWhKey) && grantedWhKeys.has(sumWhKey));
              if (matches) {
                discoveredStorageUidSet.add(sum.uid);
                storageTargets.push({
                  uid: sum.uid,
                  email: sum.email,
                  assignedWarehouse: sum.assignedWarehouse,
                });
              }
            }

            const downloaded = await readDesignatedWorkspacesFromFirebaseStorage(storageTargets);
            if (cancelled) return;
            let loadedAny = false;
            for (const [uid, ws] of Object.entries(downloaded)) {
              storageCachedWorkspaceRef.current[uid] = ws;
              discoveredStorageUidSet.add(uid);
              loadedAny = true;
            }
            if (loadedAny) {
              applyAdminAggregate();
            }
          } catch (err) {
            console.warn('Multi-warehouse Firebase Storage hydration warning:', err);
          }
        })();
      }

      const unsubAllWs =
        isPrimary || isDesignatedAllWh
          ? subscribeToAllRealtimeWorkspacesForAdmin(
              (wsMap) => {
                adminWorkspacesMapRef.current = wsMap;
                applyAdminAggregate();
              },
              undefined,
              isDesignatedAllWh
            )
          : subscribeToDesignatedRealtimeWorkspaces(designatedOwnerUidList, (wsMap) => {
              adminWorkspacesMapRef.current = wsMap;
              applyAdminAggregate();
            });
      const unsubDir = subscribeToRealtimeUsersDirectory(activeUid, isPrimary, (dirMap) => {
        rtdbUsersDirMapRef.current = dirMap;
        applyAdminAggregate();
      });

      return () => {
        cancelled = true;
        unsubAllWs();
        unsubDir();
      };
    }

    // Helper to apply merged cloud workspace (from RTDB + Firebase Storage) for a single-warehouse user
    const applySingleUserCloudWorkspace = (
      rtdbWs: RtdbWorkspacePayload | null,
      storageWs: RtdbWorkspacePayload | null
    ) => {
      if (cancelled) return;
      const mergedWs = mergeWorkspacePayloads(rtdbWs, storageWs, activeUid);

      if (!mergedWs) {
        // First time this warehouse user connects to both RTDB & Storage -> push local workspace
        delete rtdbLastPayloadRef.current[activeUid];
        rtdbHydratedKeyRef.current = sessionKey;
        const realAuthStaff =
          latestWorkspaceRef.current.staffList.find((s) => s.uid === activeUid) ||
          normalizeIndependentWarehouseStaffMember({
            ...currentStaff,
            uid: activeUid,
            email: fbUser.email || currentStaff.email || '',
          });
        void upsertRealtimeUserDirectoryProfile(realAuthStaff);
        setRtdbWriteTrigger((n) => n + 1);
        return;
      }

      const resolvedWh =
        mergedWs.meta?.assignedWarehouse &&
        mergedWs.meta.assignedWarehouse !== 'Kho VTNN Tâm An' &&
        mergedWs.meta.assignedWarehouse !== 'Tất cả kho'
          ? mergedWs.meta.assignedWarehouse
          : latestWorkspaceRef.current.staffList.find((s) => s.uid === activeUid)
              ?.assignedWarehouse ||
            formatDefaultWarehouseNameFromGmail(fbUser.email || '');

      // Ensure user's own profile in staffList reflects the authoritative cloud assignedWarehouse
      setStaffList((prev) =>
        prev.map((s) => {
          if (s.uid !== activeUid) return s;
          const nextDisplay = mergedWs?.meta?.ownerDisplayName || s.displayName;
          const nextWh = resolvedWh || s.assignedWarehouse;
          if (s.assignedWarehouse === nextWh && s.displayName === nextDisplay) return s;
          return {
            ...s,
            displayName: nextDisplay,
            assignedWarehouse: nextWh,
          };
        })
      );

      // Unify warehouseName on this single-warehouse owner's records so Web & Phone never diverge
      const unifyWh = <T extends { warehouseName?: string }>(items: T[]): T[] =>
        resolvedWh
          ? items.map((item) => {
              const recOwner = (item as { ownerId?: string }).ownerId;
              return (!recOwner || recOwner === activeUid) && item.warehouseName !== resolvedWh
                ? { ...item, warehouseName: resolvedWh }
                : item;
            })
          : items;

      const cur = latestWorkspaceRef.current;
      const mergedTombstones = mergeDeletionTombstones(
        cur.deletedRecords,
        mergedWs.settings.deletedRecords
      );

      const unifiedWs: RtdbWorkspacePayload = {
        ...mergedWs,
        meta: {
          ...mergedWs.meta,
          assignedWarehouse: resolvedWh || mergedWs.meta.assignedWarehouse,
        },
        products: filterOutDeletedRecords(unifyWh(mergedWs.products), mergedTombstones),
        customers: filterOutDeletedRecords(unifyWh(mergedWs.customers), mergedTombstones),
        suppliers: filterOutDeletedRecords(unifyWh(mergedWs.suppliers), mergedTombstones),
        sales: filterOutDeletedRecords(unifyWh(mergedWs.sales), mergedTombstones),
        imports: filterOutDeletedRecords(unifyWh(mergedWs.imports), mergedTombstones),
        receiptVouchers: filterOutDeletedRecords(
          unifyWh(mergedWs.receiptVouchers),
          mergedTombstones
        ),
        paymentVouchers: filterOutDeletedRecords(
          unifyWh(mergedWs.paymentVouchers),
          mergedTombstones
        ),
        savedVouchers: filterOutDeletedRecords(unifyWh(mergedWs.savedVouchers), mergedTombstones),
        stockAdjustments: filterOutDeletedRecords(
          unifyWh(mergedWs.stockAdjustments || []),
          mergedTombstones
        ),
        settings: {
          ...mergedWs.settings,
          ...(mergedTombstones.length > 0 ? { deletedRecords: mergedTombstones } : {}),
        },
      };

      rtdbLastPayloadRef.current[activeUid] = unifiedWs;
      const isLegacy = isRealtimeWorkspaceLegacyLayout(activeUid);
      const rtdbNeedsHeal =
        !rtdbWs ||
        (countWorkspaceBusinessRecords(rtdbWs) === 0 &&
          countWorkspaceBusinessRecords(unifiedWs) > 0 &&
          mergedTombstones.length === 0);
      const incomingFp = computeWorkspaceFingerprint(unifiedWs);
      if (
        !isLegacy &&
        !rtdbNeedsHeal &&
        rtdbHydratedKeyRef.current === sessionKey &&
        rtdbLastFingerprintsRef.current[activeUid] === incomingFp
      ) {
        return;
      }

      rtdbHydratedKeyRef.current = sessionKey;
      rtdbLastFingerprintsRef.current[activeUid] = isLegacy || rtdbNeedsHeal ? '' : incomingFp;
      rtdbSuppressNextWriteRef.current = !(isLegacy || rtdbNeedsHeal);

      productsRef.current = unifiedWs.products;
      setProducts(unifiedWs.products);
      setCustomers(unifiedWs.customers);
      setSuppliers(unifiedWs.suppliers);
      setSales(unifiedWs.sales);
      setImports(unifiedWs.imports);
      setReceiptVouchers(unifiedWs.receiptVouchers);
      setPaymentVouchers(unifiedWs.paymentVouchers);
      setSavedVouchers(unifiedWs.savedVouchers);
      setStockAdjustments(unifiedWs.stockAdjustments || []);
      setAuditLogs(unifiedWs.auditLogs);
      setBackups(unifiedWs.backups);
      setDeletedRecords((prev) =>
        JSON.stringify(prev) === JSON.stringify(mergedTombstones) ? prev : mergedTombstones
      );
      setWarehouses((prev) => {
        const next = Array.from(
          new Set([
            ...prev.filter((w) => w !== 'Kho VTNN Tâm An'),
            ...(unifiedWs.settings.warehouses || []),
            ...(resolvedWh ? [resolvedWh] : []),
          ])
        );
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
      if (unifiedWs.settings.customerGroups.length > 0) {
        setCustomerGroups((prev) => {
          const next = Array.from(new Set([...prev, ...unifiedWs.settings.customerGroups]));
          return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
        });
      }
      if (unifiedWs.settings.productCategories.length > 0) {
        setProductCategories((prev) => {
          const next = Array.from(new Set([...prev, ...unifiedWs.settings.productCategories]));
          return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
        });
      }
      if (unifiedWs.settings.receiptGroups.length > 0) {
        setReceiptGroups((prev) => {
          const next = Array.from(new Set([...prev, ...unifiedWs.settings.receiptGroups]));
          return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
        });
      }
      if (unifiedWs.settings.paymentGroups.length > 0) {
        setPaymentGroups((prev) => {
          const next = Array.from(new Set([...prev, ...unifiedWs.settings.paymentGroups]));
          return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
        });
      }
      if (unifiedWs.settings.notificationPrefs) {
        setNotificationPrefs((prev) =>
          JSON.stringify(prev) === JSON.stringify(unifiedWs.settings.notificationPrefs)
            ? prev
            : unifiedWs.settings.notificationPrefs
        );
      }
      if (unifiedWs.settings.bankQrConfig) {
        setBankQrConfig((prev) =>
          JSON.stringify(prev) === JSON.stringify(unifiedWs.settings.bankQrConfig)
            ? prev
            : unifiedWs.settings.bankQrConfig
        );
      }
      if (
        unifiedWs.settings.productNoteTemplates &&
        unifiedWs.settings.productNoteTemplates.length > 0
      ) {
        setProductNoteTemplates((prev) =>
          JSON.stringify(prev) === JSON.stringify(unifiedWs.settings.productNoteTemplates)
            ? prev
            : unifiedWs.settings.productNoteTemplates!
        );
      }

      if (isLegacy || rtdbNeedsHeal) {
        setRtdbWriteTrigger((n) => n + 1);
      }
    };

    // Pull latest workspace snapshot from Firebase Storage (/documents/workspaces/ & /backups/{uid}/)
    const activeStaffForStorage = latestWorkspaceRef.current.staffList.find(
      (s) => s.uid === activeUid
    );
    void readWorkspaceFromFirebaseStorage({
      uid: activeUid,
      email: fbUser.email || activeStaffForStorage?.email,
      assignedWarehouse: activeStaffForStorage?.assignedWarehouse,
    }).then((storageWs) => {
      if (cancelled || !storageWs) return;
      storageCachedWorkspaceRef.current[activeUid] = storageWs;
      applySingleUserCloudWorkspace(rtdbLastPayloadRef.current[activeUid] || null, storageWs);
    });

    // Standard single-warehouse user subscription (/workspaces/{uid} + /users_directory/{uid})
    const unsubUserWs = subscribeToRealtimeWorkspace(activeUid, (remoteWs) => {
      applySingleUserCloudWorkspace(
        remoteWs,
        storageCachedWorkspaceRef.current[activeUid] || null
      );
    });

    const unsubUserDir = subscribeToRealtimeUsersDirectory(activeUid, false, (dirMap) => {
      const profiles = Object.values(dirMap);
      if (profiles.length > 0) {
        setStaffList((prev) => {
          const merged = mergeDirectoryIntoStaffList(prev, profiles);
          return JSON.stringify(prev) === JSON.stringify(merged) ? prev : merged;
        });
        const ownDir = dirMap[activeUid];
        if (ownDir?.assignedWarehouse && ownDir.assignedWarehouse !== 'Kho VTNN Tâm An') {
          setWarehouses((prev) =>
            prev.includes(ownDir.assignedWarehouse)
              ? prev
              : [...prev, ownDir.assignedWarehouse]
          );
        }
      } else {
        // Only publish local profile to /users_directory/{uid} when directory entry doesn't exist yet
        const ownStaff = latestWorkspaceRef.current.staffList.find((s) => s.uid === activeUid);
        if (ownStaff) {
          void upsertRealtimeUserDirectoryProfile(ownStaff);
        }
      }
    });

    return () => {
      cancelled = true;
      unsubUserWs();
      unsubUserDir();
    };
  }, [isSessionLoggedIn, isGoogleAuthenticated, currentUserEmail, designatedMultiWhOwnerUidsKey]);

  // Debounced auto-sync to Firebase Realtime Database & Firebase Storage on every state mutation
  useEffect(() => {
    const fbUser = auth.currentUser;
    if (!isSessionLoggedIn || !isGoogleAuthenticated || !fbUser) return;

    const isPrimary = isCurrentUserAdmin(fbUser);
    const isDesignatedMultiWh = !isPrimary && Boolean(designatedMultiWhOwnerUidsKey);
    const activeUid = isPrimary ? PRIMARY_ADMIN_UID : fbUser.uid;
    const expectedKey = isPrimary
      ? `admin:${PRIMARY_ADMIN_UID}`
      : isDesignatedMultiWh
      ? `multi:${activeUid}:${designatedMultiWhOwnerUidsKey}`
      : `user:${activeUid}`;

    if (rtdbHydratedKeyRef.current !== expectedKey) return;
    if (rtdbSuppressNextWriteRef.current) {
      rtdbSuppressNextWriteRef.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      const nowIso = new Date().toISOString();
      const allowWipe = allowEmptyWorkspaceWriteRef.current;
      allowEmptyWorkspaceWriteRef.current = false;
      const forceStorage = forceStorageSyncRef.current;
      forceStorageSyncRef.current = false;
      const settingsObj = {
        warehouses,
        customerGroups,
        productCategories,
        receiptGroups,
        paymentGroups,
        notificationPrefs,
        ...(bankQrConfig ? { bankQrConfig } : {}),
        productNoteTemplates,
        ...(deletedRecords.length > 0 ? { deletedRecords } : {}),
        autoDailyBackupEnabled,
      };

      if (isPrimary || isDesignatedMultiWh) {
        const isDesignatedAllWh = isDesignatedMultiWh && designatedMultiWhOwnerUidsKey === '__ALL__';
        const writableDesignatedUidSet =
          isDesignatedMultiWh && !isDesignatedAllWh
            ? new Set(designatedMultiWhOwnerUidsKey.split('::')[0].split(',').filter(Boolean))
            : null;
        const partitioned = partitionAdminStateByWorkspace({
          products,
          customers,
          suppliers,
          sales,
          imports,
          receiptVouchers,
          paymentVouchers,
          savedVouchers,
          stockAdjustments,
          auditLogs,
          backups,
          settings: settingsObj,
          staffList,
          knownOwnerUids: Array.from(rtdbKnownOwnerUidsRef.current),
          adminUid: isPrimary ? PRIMARY_ADMIN_UID : activeUid,
          nowIso,
          existingMetaByUid: buildExistingMetaByUid(),
        });

        Object.entries(partitioned).forEach(([bucketUid, bucketPayload]) => {
          if (writableDesignatedUidSet && !writableDesignatedUidSet.has(bucketUid)) {
            return;
          }
          const prevSnapshot = rtdbLastPayloadRef.current[bucketUid] ?? null;
          if (isDestructiveEmptyWorkspaceOverwrite(prevSnapshot, bucketPayload, allowWipe)) {
            return;
          }
          const nextFp = computeWorkspaceFingerprint(bucketPayload);
          if (forceStorage || rtdbLastFingerprintsRef.current[bucketUid] !== nextFp) {
            rtdbLastFingerprintsRef.current[bucketUid] = nextFp;
            rtdbKnownOwnerUidsRef.current.add(bucketUid);
            void writeRealtimeWorkspace(bucketUid, bucketPayload, prevSnapshot, allowWipe, {
              forceStorage,
              allowMultiWarehouseManager: isDesignatedMultiWh,
            }).then((ok) => {
              if (ok) {
                rtdbLastPayloadRef.current[bucketUid] = bucketPayload;
              }
            });
          }
        });
      } else {
        const payload: RtdbWorkspacePayload = {
          meta: {
            ownerUid: activeUid,
            ownerEmail: currentStaff.email || fbUser.email || '',
            ownerDisplayName: currentStaff.displayName || fbUser.displayName || '',
            assignedWarehouse: currentStaff.assignedWarehouse || 'Tâm An Mỹ Ngãi',
            updatedAt: nowIso,
            updatedByUid: activeUid,
            schemaVersion: 1,
          },
          products,
          customers,
          suppliers,
          sales,
          imports,
          receiptVouchers,
          paymentVouchers,
          savedVouchers,
          stockAdjustments,
          auditLogs: auditLogs.slice(0, 500),
          backups: backups.map((b) => ({ ...b, snapshotPayload: undefined })),
          settings: settingsObj,
        };
        const prevSnapshot = rtdbLastPayloadRef.current[activeUid] ?? null;
        if (isDestructiveEmptyWorkspaceOverwrite(prevSnapshot, payload, allowWipe)) {
          return;
        }
        const nextFp = computeWorkspaceFingerprint(payload);
        if (forceStorage || rtdbLastFingerprintsRef.current[activeUid] !== nextFp) {
          rtdbLastFingerprintsRef.current[activeUid] = nextFp;
          void writeRealtimeWorkspace(activeUid, payload, prevSnapshot, allowWipe, {
            forceStorage,
          }).then((ok) => {
            if (ok) {
              rtdbLastPayloadRef.current[activeUid] = payload;
            }
          });
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    isSessionLoggedIn,
    isGoogleAuthenticated,
    designatedMultiWhOwnerUidsKey,
    currentStaff.uid,
    currentStaff.email,
    currentStaff.displayName,
    currentStaff.assignedWarehouse,
    products,
    customers,
    suppliers,
    sales,
    imports,
    receiptVouchers,
    paymentVouchers,
    savedVouchers,
    stockAdjustments,
    auditLogs,
    backups,
    warehouses,
    customerGroups,
    productCategories,
    receiptGroups,
    paymentGroups,
    staffList,
    notificationPrefs,
    bankQrConfig,
    productNoteTemplates,
    deletedRecords,
    autoDailyBackupEnabled,
    rtdbWriteTrigger,
  ]);

  // Generate live notifications based on user preferences using real Vietnam date
  const todayVietnamDate = getTodayVietnamDateStr();
  const notifications = useMemo(
    () =>
      generateSmartNotifications(
        visibleProducts,
        visibleSales,
        visibleImports,
        backups,
        notificationPrefs,
        todayVietnamDate
      ),
    [visibleProducts, visibleSales, visibleImports, backups, notificationPrefs, todayVietnamDate]
  );

  const unreadNotifCount = useMemo(
    () => notifications.filter((n) => !readNotifIds.has(n.id)).length,
    [notifications, readNotifIds]
  );

  const dashboardAnalytics = useMemo(
    () =>
      computeSmartDashboardAnalytics({
        sales: visibleSales,
        products: visibleProducts,
        days: 7,
        todayStr: todayVietnamDate,
      }),
    [visibleSales, visibleProducts, todayVietnamDate]
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
          icon: '/assets/logo-taman.png?v=3',
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

  const handleAddReceiptGroup = (groupName: string) => {
    const trimmed = groupName.trim();
    if (!trimmed) return;
    setReceiptGroups((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    showToast(`Đã tạo nhóm phiếu thu mới: ${trimmed}`);
  };

  const handleAddPaymentGroup = (groupName: string) => {
    const trimmed = groupName.trim();
    if (!trimmed) return;
    setPaymentGroups((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    showToast(`Đã tạo nhóm phiếu chi mới: ${trimmed}`);
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

  const resolveOwnerUidForWarehouse = (warehouseName?: string): string => {
    const fallbackUid = auth.currentUser?.uid || currentStaff.uid;
    const whKey = normalizeWarehouseKey(warehouseName);
    if (!whKey || warehouseName === 'Tất cả kho') return fallbackUid;
    const matchedStaff = staffList.find(
      (s) =>
        s.uid &&
        s.assignedWarehouse !== 'Tất cả kho' &&
        normalizeWarehouseKey(s.assignedWarehouse) === whKey
    );
    if (matchedStaff?.uid) return matchedStaff.uid;
    for (const [uid, ws] of Object.entries(rtdbLastPayloadRef.current)) {
      if (
        ws?.meta?.assignedWarehouse &&
        ws.meta.assignedWarehouse !== 'Tất cả kho' &&
        normalizeWarehouseKey(ws.meta.assignedWarehouse) === whKey
      ) {
        return uid;
      }
    }
    const existingProd = productsRef.current.find(
      (p) => p.ownerId && normalizeWarehouseKey(p.warehouseName) === whKey
    );
    if (existingProd?.ownerId) return existingProd.ownerId;
    return fallbackUid;
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
    promotionType?: SalePromotionType;
    discountAmount?: number;
    discountPercent?: number;
    giftProductId?: string;
    giftProductName?: string;
    giftUnit?: string;
    giftQuantity?: number;
    giftUnitCost?: number;
    dosageGuide?: string;
  }): SaleTransaction => {
    const nowIso = new Date().toISOString();
    const { updatedProducts, updatedProduct, updatedGiftProduct } = applySaleToInventory(
      productsRef.current,
      payload.productId,
      payload.quantity,
      nowIso,
      payload.giftProductId,
      payload.giftQuantity || 0
    );
    const summary = calculateSaleSummary(
      payload.quantity,
      payload.unitPrice,
      payload.paidAmount,
      payload.discountAmount || 0
    );

    const promoNotes: string[] = [];
    if (summary.discountAmount > 0) {
      promoNotes.push(`Giảm giá: -${formatVND(summary.discountAmount)}`);
    }
    if (payload.giftProductName && (payload.giftQuantity || 0) > 0) {
      promoNotes.push(
        `Quà tặng KM: ${payload.giftQuantity} ${payload.giftUnit || ''} ${payload.giftProductName}`
      );
    }

    const resolvedSaleWh =
      lockedWarehouse ||
      payload.warehouseName ||
      updatedProduct.warehouseName ||
      'Tâm An Mỹ Ngãi';
    const saleOwnerUid =
      updatedProduct.ownerId || resolveOwnerUidForWarehouse(resolvedSaleWh);
    const newSale: SaleTransaction = {
      id: `sale_${Date.now()}`,
      invoiceCode: generateSequentialVoucherCode(
        'HD',
        sales.map((s) => s.invoiceCode)
      ),
      customerId: payload.customerId,
      customerName: payload.customerName,
      customerPhone: payload.customerPhone,
      productId: updatedProduct.id,
      productName: updatedProduct.name,
      unit: updatedProduct.unit,
      quantity: payload.quantity,
      unitPrice: payload.unitPrice,
      unitCost: Math.max(0, Math.round(updatedProduct.importPrice || 0)),
      totalAmount: summary.totalAmount,
      paidAmount: summary.paidAmount,
      debtAmount: summary.debtAmount,
      dueDate: payload.dueDate,
      status: summary.status,
      promotionType: payload.promotionType || 'none',
      discountAmount: summary.discountAmount,
      discountPercent: payload.discountPercent || 0,
      giftProductId: payload.giftProductId,
      giftProductName: payload.giftProductName,
      giftUnit: payload.giftUnit,
      giftQuantity: payload.giftQuantity || 0,
      giftUnitCost:
        payload.giftUnitCost ??
        (updatedGiftProduct ? updatedGiftProduct.importPrice : 0),
      dosageGuide: payload.dosageGuide?.trim() || undefined,
      note: payload.note,
      warehouseName: resolvedSaleWh,
      staffName: currentStaff.displayName,
      ownerId: saleOwnerUid,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    productsRef.current = updatedProducts;
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
      details: `Vật tư: ${newSale.quantity} ${newSale.unit} ${newSale.productName}${
        promoNotes.length > 0 ? ' · ' + promoNotes.join(' · ') : ''
      } · Đã thu: ${formatVND(newSale.paidAmount)} · Ghi nợ: ${formatVND(newSale.debtAmount)}`,
      snapshotData: JSON.stringify(newSale),
    });

    let updatedCustomerRef: CustomerProfile | undefined;
    setCustomers((prev) =>
      prev.map((c) => {
        if (c.id !== payload.customerId) return c;
        const nextCust = {
          ...c,
          totalPurchased: c.totalPurchased + summary.totalAmount,
          totalDebt: c.totalDebt + summary.debtAmount,
          updatedAt: nowIso,
        };
        updatedCustomerRef = nextCust;
        return nextCust;
      })
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
      void syncProductToFirestore(updatedProduct, false);
      if (updatedGiftProduct && updatedGiftProduct.id !== updatedProduct.id) {
        void syncProductToFirestore(updatedGiftProduct, false);
      }
      if (updatedCustomerRef) {
        void syncCustomerToFirestore(updatedCustomerRef, false);
      }
      void syncSaleToFirestore(newSale, true, updatedProduct);
    }
    trackOfflineOperation(
      'sale',
      `Hóa đơn ${newSale.invoiceCode} · ${newSale.customerName} (${formatVND(newSale.totalAmount)})`,
      newSale.warehouseName
    );
    return newSale;
  };

  const handleSaveBankQrConfig = (nextConfig: VietQrBankConfig) => {
    setBankQrConfig(nextConfig);
    trackOfflineOperation(
      'settings',
      `Cấu hình VietQR ${nextConfig.bankCode} - ${nextConfig.accountNumber}`,
      lockedWarehouse || currentStaff.assignedWarehouse
    );
  };

  const handleSaveProductNoteTemplate = (
    draft: { title: string; content: string; category?: string },
    editingId?: string
  ): ProductNoteTemplate => {
    const res = upsertProductNoteTemplate(productNoteTemplates, draft, editingId);
    setProductNoteTemplates(res.templates);
    trackOfflineOperation(
      'settings',
      `${editingId ? 'Cập nhật' : 'Tạo'} mẫu ghi chú sản phẩm "${res.savedTemplate.title}"`,
      lockedWarehouse || currentStaff.assignedWarehouse
    );
    showToast(
      editingId
        ? `Đã cập nhật mẫu ghi chú sản phẩm "${res.savedTemplate.title}"!`
        : `Đã lưu mẫu ghi chú sản phẩm "${res.savedTemplate.title}" để tìm chọn nhanh!`
    );
    return res.savedTemplate;
  };

  const handleDeleteProductNoteTemplate = (templateId: string) => {
    setProductNoteTemplates((prev) => deleteProductNoteTemplate(prev, templateId));
    showToast('Đã xóa mẫu ghi chú sản phẩm.');
  };

  const handleBindProductNoteToProduct = (productId: string, noteContent: string) => {
    const nowIso = new Date().toISOString();
    const { updatedProducts, updatedProduct } = bindProductNoteToProduct(
      productsRef.current,
      productId,
      noteContent,
      nowIso
    );
    if (!updatedProduct) return;
    productsRef.current = updatedProducts;
    setProducts(updatedProducts);
    if (isGoogleAuthenticated) {
      void syncProductToFirestore(updatedProduct, false);
    }
    trackOfflineOperation(
      'inventory',
      `Ghi nhớ ghi chú cho sản phẩm ${updatedProduct.name}`,
      updatedProduct.warehouseName
    );
  };

  const handleCreateMultiItemSale = (payload: {
    customerId: string;
    customerName: string;
    customerPhone: string;
    warehouseName: string;
    dueDate: string;
    note: string;
    totalPaidAmount: number;
    items: PosCartDraftItem[];
  }): SaleTransaction[] => {
    const invCheck = validateCartInventory(productsRef.current, payload.items);
    if (!invCheck.valid) {
      throw new Error(invCheck.error || 'Tồn kho không đủ cho giỏ hàng POS.');
    }

    const nowIso = new Date().toISOString();
    const sharedInvoiceCode = generateSequentialVoucherCode(
      'HD',
      sales.map((s) => s.invoiceCode)
    );
    const sharedGroupId = `invgrp_${Date.now()}`;
    const allocation = allocatePaymentAcrossCartItems(payload.items, payload.totalPaidAmount);
    const activeUid = auth.currentUser?.uid || currentStaff.uid;
    const resolvedWh = lockedWarehouse || payload.warehouseName || 'Tâm An Mỹ Ngãi';

    let workingProducts = productsRef.current;
    const createdSales: SaleTransaction[] = [];
    const touchedProductsMap = new Map<string, ProductItem>();

    allocation.items.forEach((line, idx) => {
      const { updatedProducts, updatedProduct, updatedGiftProduct } = applySaleToInventory(
        workingProducts,
        line.productId,
        line.quantity,
        nowIso,
        line.giftProductId,
        line.giftQuantity || 0
      );
      workingProducts = updatedProducts;
      touchedProductsMap.set(updatedProduct.id, updatedProduct);
      if (updatedGiftProduct) {
        touchedProductsMap.set(updatedGiftProduct.id, updatedGiftProduct);
      }

      const saleRow: SaleTransaction = {
        id: `sale_${Date.now()}_${idx}`,
        invoiceCode: sharedInvoiceCode,
        invoiceGroupId: sharedGroupId,
        customerId: payload.customerId,
        customerName: payload.customerName,
        customerPhone: payload.customerPhone,
        productId: updatedProduct.id,
        productName: updatedProduct.name,
        unit: updatedProduct.unit,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        unitCost: Math.max(0, Math.round(updatedProduct.importPrice || 0)),
        totalAmount: line.totalAmount,
        paidAmount: line.paidAmount,
        debtAmount: line.debtAmount,
        dueDate: payload.dueDate,
        status: line.status,
        promotionType: line.promotionType || 'none',
        discountAmount: line.discountAmount,
        discountPercent: line.discountPercent || 0,
        giftProductId: line.giftProductId,
        giftProductName: line.giftProductName,
        giftUnit: line.giftUnit,
        giftQuantity: line.giftQuantity || 0,
        giftUnitCost: updatedGiftProduct ? updatedGiftProduct.importPrice : 0,
        dosageGuide: line.dosageGuide?.trim() || undefined,
        note: payload.note,
        warehouseName: resolvedWh,
        staffName: currentStaff.displayName,
        ownerId: updatedProduct.ownerId || resolveOwnerUidForWarehouse(resolvedWh),
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      createdSales.push(saleRow);
    });

    productsRef.current = workingProducts;
    setProducts(workingProducts);
    setSales((prev) => [...createdSales, ...prev]);

    recordAuditLog({
      actionCategory: 'create',
      targetEntity: 'sale',
      targetCode: sharedInvoiceCode,
      warehouseName: resolvedWh,
      summary: `Tạo hóa đơn POS ${sharedInvoiceCode} (${createdSales.length} mặt hàng) cho ${payload.customerName} (${formatVND(
        allocation.netTotal
      )})`,
      details: `${createdSales
        .map((s) => `${s.quantity} ${s.unit} ${s.productName}`)
        .join(' + ')} · Đã thu: ${formatVND(allocation.totalPaid)} · Ghi nợ: ${formatVND(
        allocation.totalDebt
      )}`,
      snapshotData: JSON.stringify(createdSales),
    });

    let updatedCustomerRef: CustomerProfile | undefined;
    setCustomers((prev) =>
      prev.map((c) => {
        if (c.id !== payload.customerId) return c;
        const nextCust = {
          ...c,
          totalPurchased: c.totalPurchased + allocation.netTotal,
          totalDebt: c.totalDebt + allocation.totalDebt,
          updatedAt: nowIso,
        };
        updatedCustomerRef = nextCust;
        return nextCust;
      })
    );

    showToast(
      `Đã lưu hóa đơn POS ${sharedInvoiceCode} gồm ${createdSales.length} mặt hàng tại ${resolvedWh} (${formatVND(
        allocation.netTotal
      )})`
    );

    if (isGoogleAuthenticated) {
      touchedProductsMap.forEach((prod) => {
        void syncProductToFirestore(prod, false);
      });
      if (updatedCustomerRef) {
        void syncCustomerToFirestore(updatedCustomerRef, false);
      }
      createdSales.forEach((s) => {
        const prod = touchedProductsMap.get(s.productId);
        void syncSaleToFirestore(s, true, prod);
      });
    }

    trackOfflineOperation(
      'multi_sale',
      `Hóa đơn POS ${sharedInvoiceCode} (${createdSales.length} mặt hàng) · ${payload.customerName} (${formatVND(
        allocation.netTotal
      )})`,
      resolvedWh
    );

    return createdSales;
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
      promotionType?: SalePromotionType;
      discountAmount?: number;
      discountPercent?: number;
      giftProductId?: string;
      giftProductName?: string;
      giftUnit?: string;
      giftQuantity?: number;
      giftUnitCost?: number;
      dosageGuide?: string;
    }
  ) => {
    if (!canPerformRoleAction(role, 'edit_record')) {
      showToast('Chỉ Quản lý mới có quyền chỉnh sửa hóa đơn chứng từ đã lưu.');
      return;
    }
    const existing = sales.find((s) => s.id === saleId);
    const nowIso = new Date().toISOString();
    if (!existing) return;

    const linkedReceipts = findLinkedReceiptVouchersForSale(existing, receiptVouchers);
    if (linkedReceipts.length > 0) {
      const codes = linkedReceipts.map((r) => r.voucherCode).join(', ');
      showToast(
        `Đơn bán ${existing.invoiceCode} đã có phiếu thu nợ (${codes}). Vui lòng hủy/xóa phiếu thu trước khi sửa hoặc xóa đơn!`
      );
      return;
    }

    const updated = updateSaleRecord(existing, changes, nowIso);

    // Validate stock availability BEFORE committing sale edit or clamping stock
    const stockDeltas = computeSaleEditStockDeltas(existing, updated);
    for (const [prodId, delta] of Object.entries(stockDeltas)) {
      if (!delta || delta >= 0) continue;
      const targetProd = productsRef.current.find((p) => p.id === prodId);
      if (targetProd && targetProd.stock + delta < 0) {
        showToast(
          `Không đủ tồn kho để sửa hóa đơn: "${targetProd.name}" hiện còn ${targetProd.stock} ${targetProd.unit}.`
        );
        return;
      }
    }

    const nextSales = sales.map((s) => (s.id === saleId ? updated : s));
    setSales(nextSales);

    // Reconcile inventory stock delta for both main product and promotional gift product
    if (Object.keys(stockDeltas).length > 0) {
      setProducts((prev) => {
        const nextList = prev.map((p) => {
          const delta = stockDeltas[p.id];
          if (!delta) return p;
          const nextProd = {
            ...p,
            stock: p.stock + delta,
            updatedAt: nowIso,
          };
          if (isGoogleAuthenticated) void syncProductToFirestore(nextProd, false);
          return nextProd;
        });
        productsRef.current = nextList;
        return nextList;
      });
    }

    // Reconcile customer purchase & debt totals directly from linked sales
    setCustomers((prev) => {
      const reconciled = reconcileCustomersFromSales(prev, nextSales, nowIso);
      if (isGoogleAuthenticated) {
        reconciled.changedCustomers.forEach((c) => void syncCustomerToFirestore(c, false));
      }
      return reconciled.customers;
    });

    if (isGoogleAuthenticated) {
      void syncSaleToFirestore(updated, false);
    }

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
    showToast('Quản lý đã cập nhật chỉnh sửa hóa đơn bán hàng thành công.');
  };

  const handleDeleteSale = (saleId: string) => {
    if (!canPerformRoleAction(role, 'delete_record')) return;
    const target = sales.find((s) => s.id === saleId);
    if (target) {
      const linkedReceipts = findLinkedReceiptVouchersForSale(target, receiptVouchers);
      if (linkedReceipts.length > 0) {
        const codes = linkedReceipts.map((r) => r.voucherCode).join(', ');
        showToast(
          `Đơn bán ${target.invoiceCode} đã có phiếu thu nợ (${codes}). Vui lòng hủy/xóa phiếu thu trước khi sửa hoặc xóa đơn!`
        );
        return;
      }
    }
    const nowIso = new Date().toISOString();
    markRecordsDeleted(saleId, nowIso);
    setSales((prev) => prev.filter((s) => s.id !== saleId));
    if (target) {
      // Restore sold & gift inventory stock
      setProducts((prev) => {
        const nextList = prev.map((p) => {
          let restoreQty = 0;
          if (p.id === target.productId) restoreQty += target.quantity;
          if (target.giftProductId && p.id === target.giftProductId) {
            restoreQty += target.giftQuantity || 0;
          }
          if (restoreQty <= 0) return p;
          const restored = { ...p, stock: p.stock + restoreQty, updatedAt: nowIso };
          if (isGoogleAuthenticated) void syncProductToFirestore(restored, false);
          return restored;
        });
        productsRef.current = nextList;
        return nextList;
      });

      // Reconcile customer purchase & debt totals
      const nextSales = sales.filter((s) => s.id !== saleId);
      setCustomers((prev) => {
        const custHasRemainingSales = nextSales.some((s) => s.customerId === target.customerId);
        if (custHasRemainingSales) {
          const reconciled = reconcileCustomersFromSales(prev, nextSales, nowIso);
          if (isGoogleAuthenticated) {
            reconciled.changedCustomers.forEach((c) => void syncCustomerToFirestore(c, false));
          }
          return reconciled.customers;
        }
        return prev.map((c) => {
          if (c.id !== target.customerId) return c;
          const nextCust = {
            ...c,
            totalPurchased: Math.max(0, c.totalPurchased - target.totalAmount),
            totalDebt: Math.max(0, c.totalDebt - target.debtAmount),
            updatedAt: nowIso,
          };
          if (isGoogleAuthenticated) void syncCustomerToFirestore(nextCust, false);
          return nextCust;
        });
      });

      if (isGoogleAuthenticated) {
        void deleteFirestoreDocIfAdmin('sales', saleId);
      }

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
        )}. Đã hoàn lại tồn kho & lưu bản chụp dữ liệu gốc để khôi phục.`,
        snapshotData: JSON.stringify(target),
      });
    }
    showToast('Đã xóa hóa đơn khỏi nhật ký bán hàng & hoàn lại tồn kho.');
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
    batchNumber?: string;
    expiryDate?: string;
  }): ImportTransaction => {
    const nowIso = new Date().toISOString();
    const { updatedProducts: baseUpdatedProducts, updatedProduct: baseUpdatedProduct } =
      applyImportToInventory(
        productsRef.current,
        payload.productId,
        payload.quantity,
        payload.unitCost,
        nowIso
      );
    const prevStock = Math.max(0, (Number(baseUpdatedProduct.stock) || 0) - payload.quantity);
    const fefo = pickEarlierFefoBatch(
      baseUpdatedProduct.batchNumber,
      baseUpdatedProduct.expiryDate,
      payload.batchNumber,
      payload.expiryDate,
      prevStock
    );
    const updatedProduct: ProductItem = {
      ...baseUpdatedProduct,
      batchNumber: fefo.batchNumber,
      expiryDate: fefo.expiryDate,
    };
    const updatedProducts = baseUpdatedProducts.map((p) =>
      p.id === updatedProduct.id ? updatedProduct : p
    );
    const summary = calculateImportSummary(
      payload.quantity,
      payload.unitCost,
      payload.paidAmount
    );

    const resolvedImpWh =
      lockedWarehouse ||
      payload.warehouseName ||
      updatedProduct.warehouseName ||
      'Tâm An Mỹ Ngãi';
    const impOwnerUid =
      updatedProduct.ownerId || resolveOwnerUidForWarehouse(resolvedImpWh);
    const newImport: ImportTransaction = {
      id: `imp_${Date.now()}`,
      receiptCode: generateSequentialVoucherCode(
        'PN',
        imports.map((i) => i.receiptCode)
      ),
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
      batchNumber: payload.batchNumber?.trim() || undefined,
      expiryDate: payload.expiryDate?.trim() || undefined,
      note: payload.note,
      warehouseName: resolvedImpWh,
      staffName: currentStaff.displayName,
      ownerId: impOwnerUid,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    productsRef.current = updatedProducts;
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
      void syncProductToFirestore(updatedProduct, false);
      void syncImportToFirestore(newImport, true, updatedProduct);
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
    if (!existing) return;

    const linkedPayments = findLinkedPaymentVouchersForImport(existing, paymentVouchers);
    if (linkedPayments.length > 0) {
      const codes = linkedPayments.map((p) => p.voucherCode).join(', ');
      showToast(
        `Phiếu nhập ${existing.receiptCode} đã có phiếu chi trả nợ (${codes}). Vui lòng hủy/xóa phiếu chi trước khi sửa hoặc xóa phiếu nhập!`
      );
      return;
    }

    const updated = updateImportRecord(existing, changes, nowIso);
    const qtyDelta = updated.quantity - existing.quantity;
    if (qtyDelta < 0) {
      const targetProd = productsRef.current.find((p) => p.id === existing.productId);
      if (targetProd && targetProd.stock + qtyDelta < 0) {
        const soldFromBatch = Math.abs(qtyDelta) - targetProd.stock;
        showToast(
          `Đã bán ${soldFromBatch} ${targetProd.unit} "${targetProd.name}", tồn còn ${targetProd.stock}, không thể giảm phiếu nhập này.`
        );
        return;
      }
    }

    const nextImports = imports.map((imp) => (imp.id === importId ? updated : imp));
    setImports(nextImports);

    if (qtyDelta !== 0 || updated.unitCost !== existing.unitCost) {
      setProducts((prev) => {
        const nextList = prev.map((p) => {
          if (p.id !== existing.productId) return p;
          const nextAvgPrice = recalculateImportPriceOnImportMutation({
            product: p,
            oldQty: existing.quantity,
            oldUnitCost: existing.unitCost,
            newQty: updated.quantity,
            newUnitCost: updated.unitCost,
            remainingImports: nextImports,
          });
          const nextProd = {
            ...p,
            stock: p.stock + qtyDelta,
            importPrice: nextAvgPrice,
            updatedAt: nowIso,
          };
          if (isGoogleAuthenticated) void syncProductToFirestore(nextProd, false);
          return nextProd;
        });
        productsRef.current = nextList;
        return nextList;
      });
    }

    if (isGoogleAuthenticated) {
      void syncImportToFirestore(updated, false);
    }

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
    showToast('Quản lý đã cập nhật chỉnh sửa phiếu nhập kho thành công.');
  };

  const handleDeleteImport = (importId: string) => {
    if (!canPerformRoleAction(role, 'delete_record')) return;
    const target = imports.find((imp) => imp.id === importId);
    const nowIso = new Date().toISOString();
    if (target) {
      const linkedPayments = findLinkedPaymentVouchersForImport(target, paymentVouchers);
      if (linkedPayments.length > 0) {
        const codes = linkedPayments.map((p) => p.voucherCode).join(', ');
        showToast(
          `Phiếu nhập ${target.receiptCode} đã có phiếu chi trả nợ (${codes}). Vui lòng hủy/xóa phiếu chi trước khi sửa hoặc xóa phiếu nhập!`
        );
        return;
      }
      const targetProd = productsRef.current.find((p) => p.id === target.productId);
      if (targetProd && targetProd.stock < target.quantity) {
        const alreadySold = target.quantity - targetProd.stock;
        showToast(
          `Đã bán ${alreadySold} ${targetProd.unit} "${targetProd.name}", tồn còn ${targetProd.stock}, không thể xóa phiếu nhập này.`
        );
        return;
      }
    }
    markRecordsDeleted(importId, nowIso);
    const nextImports = imports.filter((imp) => imp.id !== importId);
    setImports(nextImports);
    if (target) {
      setProducts((prev) => {
        const nextList = prev.map((p) => {
          if (p.id !== target.productId) return p;
          const nextAvgPrice = recalculateImportPriceOnImportMutation({
            product: p,
            oldQty: target.quantity,
            oldUnitCost: target.unitCost,
            newQty: 0,
            newUnitCost: 0,
            remainingImports: nextImports,
          });
          const adjusted = {
            ...p,
            stock: p.stock - target.quantity,
            importPrice: nextAvgPrice,
            updatedAt: nowIso,
          };
          if (isGoogleAuthenticated) void syncProductToFirestore(adjusted, false);
          return adjusted;
        });
        productsRef.current = nextList;
        return nextList;
      });
      if (isGoogleAuthenticated) {
        void deleteFirestoreDocIfAdmin('imports', importId);
      }
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
        )}. Đã điều chỉnh lại tồn kho & lưu bản chụp dữ liệu gốc để khôi phục.`,
        snapshotData: JSON.stringify(target),
      });
    }
    showToast('Đã xóa phiếu nhập kho khỏi hệ thống & cập nhật lại tồn kho.');
  };

  const handleCreateSupplierInline = (
    data: Omit<SupplierProfile, 'id' | 'createdAt'>
  ): SupplierProfile => {
    const resolvedWh =
      lockedWarehouse ||
      data.warehouseName ||
      (currentStaff.assignedWarehouse !== 'Tất cả kho'
        ? currentStaff.assignedWarehouse
        : warehouses[0] || 'Tâm An Mỹ Ngãi');
    const created: SupplierProfile = {
      ...data,
      warehouseName: resolvedWh,
      id: `sup_${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    setSuppliers((prev) => [created, ...prev]);
    showToast(`Đã thêm Nhà cung cấp mới: ${created.name} (${resolvedWh})`);
    return created;
  };

  const handleSaveProduct = (
    data: Omit<ProductItem, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>,
    editingId?: string
  ): ProductItem => {
    const nowIso = new Date().toISOString();
    const activeUid = auth.currentUser?.uid || currentStaff.uid;
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
            void syncProductToFirestore(updated, false);
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
          ownerId: activeUid,
          createdAt: nowIso,
          updatedAt: nowIso,
        }
      );
    } else {
      const created: ProductItem = {
        ...data,
        warehouseName: resolvedWh,
        id: `prod_${Date.now()}`,
        ownerId: activeUid,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      productsRef.current = [created, ...productsRef.current];
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
        void syncProductToFirestore(created, true);
      }
      return created;
    }
  };

  const handleExecuteStocktake = (params: {
    productId: string;
    actualQty: number;
    reason: string;
    note?: string;
  }): StockAdjustmentRecord | null => {
    const target = productsRef.current.find((p) => p.id === params.productId);
    if (!target) {
      showToast('Không tìm thấy vật tư để kiểm kê.');
      return null;
    }
    const systemQty = Math.max(0, Number(target.stock) || 0);
    const actualQty = Math.max(0, Number(params.actualQty) || 0);
    const diffQty = actualQty - systemQty;
    const nowIso = new Date().toISOString();
    const activeUid = auth.currentUser?.uid || currentStaff.uid;
    const resolvedWh = lockedWarehouse || target.warehouseName || warehouses[0] || 'Tâm An Mỹ Ngãi';
    const adjustmentCode = generateSequentialVoucherCode(
      'KK',
      stockAdjustments.map((s) => s.adjustmentCode)
    );
    const unitCost = Math.max(0, Number(target.importPrice) || 0);
    const record: StockAdjustmentRecord = {
      id: `kk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      adjustmentCode,
      productId: target.id,
      productCode: target.code,
      productName: target.name,
      unit: target.unit,
      warehouseName: resolvedWh,
      systemStockBefore: systemQty,
      actualCountedStock: actualQty,
      diffQty,
      unitCost,
      diffValue: diffQty * unitCost,
      reason: params.reason.trim() || 'Kiểm kê định kỳ',
      note: params.note?.trim() || '',
      staffName: currentStaff.displayName,
      ownerId: target.ownerId || activeUid,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const updatedProduct: ProductItem = {
      ...target,
      stock: actualQty,
      updatedAt: nowIso,
    };
    const nextProducts = productsRef.current.map((p) =>
      p.id === target.id ? updatedProduct : p
    );
    productsRef.current = nextProducts;
    setProducts(nextProducts);
    setStockAdjustments((prev) => [record, ...prev]);

    const signStr = diffQty > 0 ? `+${diffQty}` : `${diffQty}`;
    recordAuditLog({
      actionCategory: 'update',
      targetEntity: 'product',
      targetCode: adjustmentCode,
      warehouseName: resolvedWh,
      summary: `Kiểm kê kho ${adjustmentCode}: ${target.name} (${systemQty} → ${actualQty} ${target.unit}, lệch ${signStr})`,
      details: `Lý do: ${record.reason}${record.note ? ` · Ghi chú: ${record.note}` : ''} · Giá trị lệch: ${formatVND(
        record.diffValue
      )}`,
      snapshotData: JSON.stringify(record),
    });
    showToast(
      `Đã lưu phiếu kiểm kê ${adjustmentCode}: ${target.name} (${signStr} ${target.unit}).`
    );
    if (isGoogleAuthenticated) {
      void syncProductToFirestore(updatedProduct, false);
    }
    return record;
  };

  const handleDeleteProduct = (productId: string) => {
    if (!canPerformRoleAction(role, 'delete_record')) return;
    const target = products.find((p) => p.id === productId);
    markRecordsDeleted(productId);
    const nextList = productsRef.current.filter((p) => p.id !== productId);
    productsRef.current = nextList;
    setProducts(nextList);
    if (isGoogleAuthenticated) {
      void deleteFirestoreDocIfAdmin('products', productId);
    }
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
      showToast(`Đã xóa vật tư "${target.name}" (${target.code}).`, {
        label: 'Hoàn tác (10s)',
        onUndo: () => {
          unmarkDeletedRecord(target.id);
          const restoredItem = { ...target, updatedAt: new Date().toISOString() };
          const restored = [restoredItem, ...productsRef.current.filter((p) => p.id !== target.id)];
          productsRef.current = restored;
          setProducts(restored);
          if (isGoogleAuthenticated) {
            void syncProductToFirestore(restoredItem, true);
          }
          recordAuditLog({
            actionCategory: 'create',
            targetEntity: 'product',
            targetCode: target.code,
            warehouseName: target.warehouseName,
            summary: `Hoàn tác khôi phục vật tư ${target.name} (${target.code})`,
          });
        },
      });
    } else {
      showToast('Quản lý đã xóa mặt hàng vật tư khỏi danh mục kho.');
    }
  };

  const handleSaveCustomer = (
    data: Omit<CustomerProfile, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>,
    editingId?: string
  ): CustomerProfile => {
    const nowIso = new Date().toISOString();
    const activeUid = auth.currentUser?.uid || currentStaff.uid;
    const resolvedWh =
      lockedWarehouse ||
      data.warehouseName ||
      (currentStaff.assignedWarehouse !== 'Tất cả kho'
        ? currentStaff.assignedWarehouse
        : warehouses[0] || 'Tâm An Mỹ Ngãi');
    if (editingId) {
      const existing = customers.find((c) => c.id === editingId);
      let updatedRef: CustomerProfile | null = null;
      setCustomers((prev) =>
        prev.map((c) => {
          if (c.id !== editingId) return c;
          const updated = {
            ...c,
            ...data,
            warehouseName: c.warehouseName || resolvedWh,
            updatedAt: nowIso,
          };
          updatedRef = updated;
          if (isGoogleAuthenticated) {
            void syncCustomerToFirestore(updated, false);
          }
          return updated;
        })
      );
      if (existing) {
        recordAuditLog({
          actionCategory: 'update',
          targetEntity: 'customer',
          targetCode: data.code || existing.code,
          warehouseName: existing.warehouseName || resolvedWh,
          summary: `Cập nhật hồ sơ khách hàng ${data.name} (${data.phone})`,
          details: `Nhóm KH: ${data.group} · Địa chỉ: ${data.address}`,
          snapshotData: JSON.stringify(existing),
        });
      }
      showToast(`Đã cập nhật hồ sơ khách hàng: ${data.name}`);
      return (
        updatedRef || {
          ...data,
          warehouseName: resolvedWh,
          id: editingId,
          ownerId: activeUid,
          createdAt: nowIso,
          updatedAt: nowIso,
        }
      );
    } else {
      const created: CustomerProfile = {
        ...data,
        warehouseName: resolvedWh,
        id: `cust_${Date.now()}`,
        ownerId: activeUid,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      setCustomers((prev) => [created, ...prev]);
      recordAuditLog({
        actionCategory: 'create',
        targetEntity: 'customer',
        targetCode: created.code,
        warehouseName: resolvedWh,
        summary: `Thêm hồ sơ khách hàng mới ${created.name} (${created.phone})`,
        details: `Nhóm KH: ${created.group} · Địa chỉ: ${created.address}`,
        snapshotData: JSON.stringify(created),
      });
      showToast(`Đã thêm khách hàng mới: ${created.name} (${resolvedWh})`);
      if (isGoogleAuthenticated) {
        void syncCustomerToFirestore(created, true);
      }
      return created;
    }
  };

  const handleDeleteCustomer = (customerId: string) => {
    if (!canPerformRoleAction(role, 'delete_record')) return;
    const target = customers.find((c) => c.id === customerId);
    markRecordsDeleted(customerId);
    setCustomers((prev) => prev.filter((c) => c.id !== customerId));
    if (isGoogleAuthenticated) {
      void deleteFirestoreDocIfAdmin('customers', customerId);
      void deleteFirestoreDocIfAdmin('customers_private', customerId);
    }
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
      showToast(`Đã xóa khách hàng "${target.name}".`, {
        label: 'Hoàn tác (10s)',
        onUndo: () => {
          unmarkDeletedRecord(target.id);
          const restoredCust = { ...target, updatedAt: new Date().toISOString() };
          setCustomers((prev) => [restoredCust, ...prev.filter((c) => c.id !== target.id)]);
          if (isGoogleAuthenticated) {
            void syncCustomerToFirestore(restoredCust, true);
          }
          recordAuditLog({
            actionCategory: 'create',
            targetEntity: 'customer',
            targetCode: target.code,
            warehouseName: target.warehouseName,
            summary: `Hoàn tác khôi phục khách hàng ${target.name} (${target.code})`,
          });
        },
      });
    } else {
      showToast('Quản lý đã xóa hồ sơ khách hàng.');
    }
  };

  const handleSaveVoucher = (
    voucherData: Omit<SavedVoucherRecord, 'id' | 'createdAt' | 'updatedAt'>,
    editingId?: string
  ): SavedVoucherRecord => {
    const nowIso = new Date().toISOString();
    const resolvedWh =
      lockedWarehouse ||
      voucherData.warehouseName ||
      (currentStaff.assignedWarehouse !== 'Tất cả kho'
        ? currentStaff.assignedWarehouse
        : warehouses[0] || 'Tâm An Mỹ Ngãi');
    if (editingId) {
      const existing = savedVouchers.find((v) => v.id === editingId);
      const updatedRecord: SavedVoucherRecord = {
        ...voucherData,
        warehouseName: resolvedWh,
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
          v.id === editingId
            ? { ...v, ...voucherData, warehouseName: resolvedWh, updatedAt: nowIso }
            : v
        )
      );
      if (existing) {
        recordAuditLog({
          actionCategory: 'update',
          targetEntity: 'voucher',
          targetCode: voucherData.voucherCode,
          warehouseName: resolvedWh,
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
        warehouseName: resolvedWh,
        id: `vc_${Date.now()}`,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      setSavedVouchers((prev) => [created, ...prev]);
      recordAuditLog({
        actionCategory: 'create',
        targetEntity: 'voucher',
        targetCode: created.voucherCode,
        warehouseName: resolvedWh,
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
    markRecordsDeleted(voucherId);
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
    if (!existing) return;
    const actualCollected = Math.min(
      Math.max(0, Number(existing.debtAmount) || 0),
      Math.max(0, Math.round(Number(amount) || 0))
    );
    if (actualCollected <= 0) {
      showToast('Hóa đơn này đã thanh toán đủ hoặc số tiền thu phải lớn hơn 0.');
      return;
    }
    const nowIso = new Date().toISOString();
    const activeUid = auth.currentUser?.uid || currentStaff.uid;
    const cleanNote = (note || '').trim();
    const noteSuffix = cleanNote
      ? `[Thu nợ HĐ ${existing.invoiceCode}: +${actualCollected.toLocaleString('vi-VN')}đ - ${cleanNote}]`
      : `[Thu nợ HĐ ${existing.invoiceCode}: +${actualCollected.toLocaleString('vi-VN')}đ]`;
    const mergedNote = existing.note ? `${existing.note} | ${noteSuffix}` : noteSuffix;

    const updatedSale = applyDebtPayment(
      { ...existing, note: mergedNote },
      actualCollected,
      nowIso
    );
    const nextSales = sales.map((s) => (s.id === saleId ? updatedSale : s));
    setSales(nextSales);
    if (isGoogleAuthenticated) {
      void syncSaleToFirestore(updatedSale, false);
    }

    setCustomers((prev) => {
      const reconciled = reconcileCustomersFromSales(prev, nextSales, nowIso);
      if (isGoogleAuthenticated) {
        reconciled.changedCustomers.forEach((c) => void syncCustomerToFirestore(c, false));
      }
      return reconciled.customers;
    });

    const voucherCode = generateSequentialVoucherCode(
      'PT',
      receiptVouchers.map((r) => r.voucherCode)
    );
    const linkedReceiptVoucher: CashReceiptVoucher = {
      id: `rv_direct_${Date.now()}`,
      voucherCode,
      groupName: 'Thu nợ bán hàng khách hàng',
      warehouseName: existing.warehouseName || lockedWarehouse || warehouses[0] || 'Tâm An Mỹ Ngãi',
      partnerId: existing.customerId,
      partnerName: existing.customerName,
      partnerPhone: existing.customerPhone || '',
      amount: actualCollected,
      paymentMethod: 'Tiền mặt / Chuyển khoản',
      isDebtSettlement: true,
      settledAllocations: [
        {
          recordId: existing.id,
          code: existing.invoiceCode,
          date: (existing.createdAt || '').slice(0, 10),
          dueDate: existing.dueDate || '',
          productName: existing.productName,
          previousDebt: existing.debtAmount,
          allocatedAmount: actualCollected,
          remainingDebt: updatedSale.debtAmount,
        },
      ],
      totalPreviousDebt: existing.debtAmount,
      totalRemainingDebt: updatedSale.debtAmount,
      countsTowardOtherIncome: false,
      note:
        cleanNote ||
        `Thu nợ trực tiếp hóa đơn ${existing.invoiceCode} (${existing.customerName})`,
      staffName: currentStaff.displayName,
      ownerId: existing.ownerId || activeUid,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    setReceiptVouchers((prev) => [linkedReceiptVoucher, ...prev]);

    recordAuditLog({
      actionCategory: 'debt_payment',
      targetEntity: 'debt',
      targetCode: existing.invoiceCode,
      warehouseName: existing.warehouseName,
      summary: `Thu nợ khách hàng ${existing.customerName} (+${formatVND(
        actualCollected
      )}) cho HĐ ${existing.invoiceCode} -> Lập phiếu ${voucherCode}`,
      details: `Nợ trước khi thu: ${formatVND(existing.debtAmount)} · Số tiền thu: ${formatVND(
        actualCollected
      )} · Nợ còn lại: ${formatVND(updatedSale.debtAmount)} · Ghi chú: ${
        cleanNote || 'Thu nợ trực tiếp'
      }`,
      snapshotData: JSON.stringify(existing),
    });
    showToast(
      `Đã ghi nhận thu nợ +${formatVND(actualCollected)} & tự động lưu Phiếu thu ${voucherCode}!`
    );
  };

  const handleCollectCustomerDebtBatch = (
    items: Array<{ saleId: string; amount: number }>,
    note: string
  ) => {
    if (!items || items.length === 0) return;
    const nowIso = new Date().toISOString();
    const activeUid = auth.currentUser?.uid || currentStaff.uid;
    const cleanNote = (note || '').trim();
    let workingSales = [...sales];
    let existingCodes = receiptVouchers.map((r) => r.voucherCode);
    const updatedSalesForFirestore: SaleTransaction[] = [];
    const createdVouchers: CashReceiptVoucher[] = [];
    let totalBatchCollected = 0;

    items.forEach((item, idx) => {
      const existing = workingSales.find((s) => s.id === item.saleId);
      if (!existing) return;
      const actualCollected = Math.min(
        Math.max(0, Number(existing.debtAmount) || 0),
        Math.max(0, Math.round(Number(item.amount) || 0))
      );
      if (actualCollected <= 0) return;

      const noteSuffix = cleanNote
        ? `[Thu nợ HĐ ${existing.invoiceCode}: +${actualCollected.toLocaleString('vi-VN')}đ - ${cleanNote}]`
        : `[Thu nợ HĐ ${existing.invoiceCode}: +${actualCollected.toLocaleString('vi-VN')}đ]`;
      const mergedNote = existing.note ? `${existing.note} | ${noteSuffix}` : noteSuffix;

      const updatedSale = applyDebtPayment(
        { ...existing, note: mergedNote },
        actualCollected,
        nowIso
      );
      workingSales = workingSales.map((s) => (s.id === existing.id ? updatedSale : s));
      updatedSalesForFirestore.push(updatedSale);
      totalBatchCollected += actualCollected;

      const voucherCode = generateSequentialVoucherCode('PT', existingCodes);
      existingCodes = [voucherCode, ...existingCodes];

      createdVouchers.push({
        id: `rv_direct_${Date.now()}_${idx}`,
        voucherCode,
        groupName: 'Thu nợ bán hàng khách hàng',
        warehouseName:
          existing.warehouseName || lockedWarehouse || warehouses[0] || 'Tâm An Mỹ Ngãi',
        partnerId: existing.customerId,
        partnerName: existing.customerName,
        partnerPhone: existing.customerPhone || '',
        amount: actualCollected,
        paymentMethod: 'Tiền mặt / Chuyển khoản',
        isDebtSettlement: true,
        settledAllocations: [
          {
            recordId: existing.id,
            code: existing.invoiceCode,
            date: (existing.createdAt || '').slice(0, 10),
            dueDate: existing.dueDate || '',
            productName: existing.productName,
            previousDebt: existing.debtAmount,
            allocatedAmount: actualCollected,
            remainingDebt: updatedSale.debtAmount,
          },
        ],
        totalPreviousDebt: existing.debtAmount,
        totalRemainingDebt: updatedSale.debtAmount,
        countsTowardOtherIncome: false,
        note:
          cleanNote ||
          `Thu nợ tổng hợp hóa đơn ${existing.invoiceCode} (${existing.customerName})`,
        staffName: currentStaff.displayName,
        ownerId: existing.ownerId || activeUid,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    });

    if (createdVouchers.length === 0) {
      showToast('Không có hóa đơn công nợ hợp lệ để thu nợ.');
      return;
    }

    setSales(workingSales);
    if (isGoogleAuthenticated) {
      updatedSalesForFirestore.forEach((s) => void syncSaleToFirestore(s, false));
    }

    setCustomers((prev) => {
      const reconciled = reconcileCustomersFromSales(prev, workingSales, nowIso);
      if (isGoogleAuthenticated) {
        reconciled.changedCustomers.forEach((c) => void syncCustomerToFirestore(c, false));
      }
      return reconciled.customers;
    });

    setReceiptVouchers((prev) => [...createdVouchers, ...prev]);

    recordAuditLog({
      actionCategory: 'debt_payment',
      targetEntity: 'debt',
      targetCode: createdVouchers.map((v) => v.voucherCode).join(', '),
      warehouseName: lockedWarehouse || currentStaff.assignedWarehouse || 'Tất cả kho',
      summary: `Thu nợ tổng hợp ${createdVouchers.length} hóa đơn (+${formatVND(
        totalBatchCollected
      )})`,
      details: `Số phiếu thu lập mới: ${createdVouchers
        .map((v) => `${v.voucherCode} (+${formatVND(v.amount)})`)
        .join(' · ')}`,
    });
    showToast(
      `Đã thu nợ tổng hợp +${formatVND(totalBatchCollected)} cho ${createdVouchers.length} hóa đơn!`
    );
  };

  const handlePaySupplierDebt = (importId: string, amount: number, note: string) => {
    const existing = imports.find((imp) => imp.id === importId);
    if (!existing) return;
    const actualPaid = Math.min(
      Math.max(0, Number(existing.debtAmount) || 0),
      Math.max(0, Math.round(Number(amount) || 0))
    );
    if (actualPaid <= 0) {
      showToast('Phiếu nhập này đã thanh toán đủ hoặc số tiền trả phải lớn hơn 0.');
      return;
    }
    const nowIso = new Date().toISOString();
    const activeUid = auth.currentUser?.uid || currentStaff.uid;
    const cleanNote = (note || '').trim();
    const noteSuffix = cleanNote
      ? `[Trả nợ NCC ${existing.receiptCode}: -${actualPaid.toLocaleString('vi-VN')}đ - ${cleanNote}]`
      : `[Trả nợ NCC ${existing.receiptCode}: -${actualPaid.toLocaleString('vi-VN')}đ]`;
    const mergedNote = existing.note ? `${existing.note} | ${noteSuffix}` : noteSuffix;

    const updatedImport = applyDebtPayment(
      { ...existing, note: mergedNote },
      actualPaid,
      nowIso
    );
    setImports((prev) => prev.map((imp) => (imp.id === importId ? updatedImport : imp)));
    if (isGoogleAuthenticated) {
      void syncImportToFirestore(updatedImport, false);
    }

    const voucherCode = generateSequentialVoucherCode(
      'PC',
      paymentVouchers.map((p) => p.voucherCode)
    );
    const linkedPaymentVoucher: CashPaymentVoucher = {
      id: `pv_direct_${Date.now()}`,
      voucherCode,
      groupName: 'Chi trả nợ Nhà cung cấp',
      warehouseName: existing.warehouseName || lockedWarehouse || warehouses[0] || 'Tâm An Mỹ Ngãi',
      partnerName: existing.supplierName,
      partnerPhone: existing.supplierPhone || '',
      amount: actualPaid,
      paymentMethod: 'Chuyển khoản ngân hàng',
      isDebtSettlement: true,
      settledAllocations: [
        {
          recordId: existing.id,
          code: existing.receiptCode,
          date: (existing.createdAt || '').slice(0, 10),
          dueDate: existing.dueDate || '',
          productName: existing.productName,
          previousDebt: existing.debtAmount,
          allocatedAmount: actualPaid,
          remainingDebt: updatedImport.debtAmount,
        },
      ],
      totalPreviousDebt: existing.debtAmount,
      totalRemainingDebt: updatedImport.debtAmount,
      countsTowardOperatingExpense: false,
      note:
        cleanNote ||
        `Thanh toán trực tiếp phiếu nhập ${existing.receiptCode} (${existing.supplierName})`,
      staffName: currentStaff.displayName,
      ownerId: existing.ownerId || activeUid,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    setPaymentVouchers((prev) => [linkedPaymentVoucher, ...prev]);

    recordAuditLog({
      actionCategory: 'debt_payment',
      targetEntity: 'debt',
      targetCode: existing.receiptCode,
      warehouseName: existing.warehouseName,
      summary: `Thanh toán nợ NCC ${existing.supplierName} (${formatVND(
        actualPaid
      )}) cho phiếu ${existing.receiptCode} -> Lập phiếu ${voucherCode}`,
      details: `Nợ NCC trước khi trả: ${formatVND(
        existing.debtAmount
      )} · Số tiền trả: ${formatVND(actualPaid)} · Nợ còn lại: ${formatVND(
        updatedImport.debtAmount
      )} · Ghi chú: ${cleanNote || 'Thanh toán nợ NCC'}`,
      snapshotData: JSON.stringify(existing),
    });
    showToast(
      `Đã thanh toán nợ NCC ${formatVND(actualPaid)} & tự động lưu Phiếu chi ${voucherCode}!`
    );
  };

  // Automatic FIFO Debt Settlement for Customer (ordered by oldest debt date first)
  const handleSettleCustomerTotalDebtFifo = (params: {
    customerId?: string;
    customerName: string;
    customerPhone: string;
    totalAmount: number;
    groupName: string;
    paymentMethod: string;
    note: string;
    warehouseName?: string;
  }) => {
    if (params.totalAmount <= 0) return;
    const nowIso = new Date().toISOString();
    const activeUid = auth.currentUser?.uid || currentStaff.uid;
    try {
      const fifoResult = applyCustomerFifoDebtSettlement(
        visibleSales,
        {
          customerId: params.customerId,
          customerName: params.customerName,
          customerPhone: params.customerPhone,
        },
        params.totalAmount,
        params.note,
        nowIso
      );

      if (fifoResult.settledAllocations.length === 0) {
        showToast('Khách hàng này hiện không còn hóa đơn nợ nào cần quyết toán.');
        return;
      }

      const settledIds = new Set(fifoResult.settledAllocations.map((a) => a.recordId));
      const updatedSaleMap = new Map(fifoResult.updatedSales.map((s) => [s.id, s]));
      setSales((prev) => prev.map((s) => updatedSaleMap.get(s.id) || s));
      if (isGoogleAuthenticated) {
        fifoResult.updatedSales
          .filter((s) => settledIds.has(s.id))
          .forEach((s) => {
            void syncSaleToFirestore(s, false);
          });
      }

      // Update customer's totalDebt in customers state (scoped to visible warehouse customers)
      const visibleCustIds = new Set(visibleCustomers.map((c) => c.id));
      setCustomers((prev) =>
        prev.map((c) => {
          if (!visibleCustIds.has(c.id)) return c;
          const cleanPhone = (params.customerPhone || '').trim();
          const isMatched =
            (params.customerId && c.id === params.customerId) ||
            (Boolean(cleanPhone) && (c.phone || '').trim() === cleanPhone) ||
            c.name.trim().toLowerCase() === params.customerName.trim().toLowerCase();
          if (!isMatched) return c;
          const updatedCust = {
            ...c,
            totalDebt: fifoResult.totalRemainingDebt,
            updatedAt: nowIso,
          };
          if (isGoogleAuthenticated) void syncCustomerToFirestore(updatedCust, false);
          return updatedCust;
        })
      );

      const resolvedWarehouse =
        lockedWarehouse ||
        params.warehouseName ||
        fifoResult.unpaidInvoicesOrdered[0]?.warehouseName ||
        'Tâm An Mỹ Ngãi';

      const voucherCode = generateSequentialVoucherCode(
        'PT',
        receiptVouchers.map((r) => r.voucherCode)
      );
      const allocDesc = fifoResult.settledAllocations
        .map((a) => `${a.code} (${a.date}: -${formatVND(a.allocatedAmount)})`)
        .join(' · ');

      const newReceiptVoucher: CashReceiptVoucher = {
        id: `rv_${Date.now()}`,
        voucherCode,
        groupName: params.groupName || 'Thu nợ bán hàng khách hàng',
        warehouseName: resolvedWarehouse,
        partnerId: params.customerId,
        partnerName: params.customerName,
        partnerPhone: params.customerPhone || '',
        amount: fifoResult.totalAllocated,
        paymentMethod: params.paymentMethod || 'Chuyển khoản ngân hàng',
        isDebtSettlement: true,
        settledAllocations: fifoResult.settledAllocations,
        totalPreviousDebt: fifoResult.totalPreviousDebt,
        totalRemainingDebt: fifoResult.totalRemainingDebt,
        countsTowardOtherIncome: false,
        note:
          params.note.trim() ||
          `Quyết toán tổng công nợ phải thu theo thứ tự ngày nợ (${fifoResult.settledAllocations.length} HĐ)`,
        staffName: currentStaff.displayName,
        ownerId: activeUid,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      setReceiptVouchers((prev) => [newReceiptVoucher, ...prev]);

      recordAuditLog({
        actionCategory: 'debt_payment',
        targetEntity: 'debt',
        targetCode: voucherCode,
        warehouseName: resolvedWarehouse,
        summary: `Thu quyết toán tổng công nợ KH ${newReceiptVoucher.partnerName} (+${formatVND(
          fifoResult.totalAllocated
        )}) tự động trừ vào ${fifoResult.settledAllocations.length} HĐ theo thứ tự ngày nợ`,
        details: `Thứ tự trừ nợ theo ngày: ${allocDesc} · Tổng nợ trước thu: ${formatVND(
          fifoResult.totalPreviousDebt
        )} -> Còn nợ: ${formatVND(fifoResult.totalRemainingDebt)}`,
        snapshotData: JSON.stringify(newReceiptVoucher),
      });

      showToast(
        `Đã thu tổng nợ +${formatVND(fifoResult.totalAllocated)} (${
          newReceiptVoucher.partnerName
        }) và tự động trừ quyết toán vào ${fifoResult.settledAllocations.length} hóa đơn theo thứ tự ngày nợ!`
      );
    } catch (err) {
      showToast(
        err instanceof Error
          ? err.message
          : 'Không thể quyết toán tổng công nợ khách hàng.'
      );
    }
  };

  // Automatic FIFO Debt Settlement for Supplier (ordered by oldest debt date first)
  const handleSettleSupplierTotalDebtFifo = (params: {
    supplierName: string;
    supplierPhone: string;
    totalAmount: number;
    groupName: string;
    paymentMethod: string;
    note: string;
    warehouseName?: string;
  }) => {
    if (params.totalAmount <= 0) return;
    const nowIso = new Date().toISOString();
    const activeUid = auth.currentUser?.uid || currentStaff.uid;
    try {
      const fifoResult = applySupplierFifoDebtSettlement(
        visibleImports,
        {
          supplierName: params.supplierName,
          supplierPhone: params.supplierPhone,
        },
        params.totalAmount,
        params.note,
        nowIso
      );

      if (fifoResult.settledAllocations.length === 0) {
        showToast('Nhà cung cấp này hiện không còn phiếu nhập nợ nào cần quyết toán.');
        return;
      }

      const settledIds = new Set(fifoResult.settledAllocations.map((a) => a.recordId));
      const updatedImpMap = new Map(fifoResult.updatedImports.map((i) => [i.id, i]));
      setImports((prev) => prev.map((imp) => updatedImpMap.get(imp.id) || imp));
      if (isGoogleAuthenticated) {
        fifoResult.updatedImports
          .filter((imp) => settledIds.has(imp.id))
          .forEach((imp) => {
            void syncImportToFirestore(imp, false);
          });
      }

      const resolvedWarehouse =
        lockedWarehouse ||
        params.warehouseName ||
        fifoResult.unpaidReceiptsOrdered[0]?.warehouseName ||
        'Tâm An Mỹ Ngãi';

      const voucherCode = generateSequentialVoucherCode(
        'PC',
        paymentVouchers.map((p) => p.voucherCode)
      );
      const allocDesc = fifoResult.settledAllocations
        .map((a) => `${a.code} (${a.date}: -${formatVND(a.allocatedAmount)})`)
        .join(' · ');

      const newPaymentVoucher: CashPaymentVoucher = {
        id: `pv_${Date.now()}`,
        voucherCode,
        groupName: params.groupName || 'Chi trả nợ Nhà cung cấp',
        warehouseName: resolvedWarehouse,
        partnerName: params.supplierName,
        partnerPhone: params.supplierPhone || '',
        amount: fifoResult.totalAllocated,
        paymentMethod: params.paymentMethod || 'Chuyển khoản ngân hàng',
        isDebtSettlement: true,
        settledAllocations: fifoResult.settledAllocations,
        totalPreviousDebt: fifoResult.totalPreviousDebt,
        totalRemainingDebt: fifoResult.totalRemainingDebt,
        countsTowardOperatingExpense: false,
        note:
          params.note.trim() ||
          `Quyết toán tổng công nợ phải trả NCC theo thứ tự ngày nợ (${fifoResult.settledAllocations.length} phiếu nhập)`,
        staffName: currentStaff.displayName,
        ownerId: activeUid,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      setPaymentVouchers((prev) => [newPaymentVoucher, ...prev]);

      recordAuditLog({
        actionCategory: 'debt_payment',
        targetEntity: 'debt',
        targetCode: voucherCode,
        warehouseName: resolvedWarehouse,
        summary: `Chi quyết toán tổng công nợ NCC ${params.supplierName} (-${formatVND(
          fifoResult.totalAllocated
        )}) tự động trừ vào ${fifoResult.settledAllocations.length} phiếu nhập theo thứ tự ngày nợ`,
        details: `Thứ tự trừ nợ theo ngày: ${allocDesc} · Tổng nợ trước trả: ${formatVND(
          fifoResult.totalPreviousDebt
        )} -> Còn nợ: ${formatVND(fifoResult.totalRemainingDebt)}`,
        snapshotData: JSON.stringify(newPaymentVoucher),
      });

      showToast(
        `Đã chi trả tổng nợ -${formatVND(fifoResult.totalAllocated)} (${params.supplierName}) và tự động trừ quyết toán vào ${fifoResult.settledAllocations.length} phiếu nhập theo thứ tự ngày nợ!`
      );
    } catch (err) {
      showToast(
        err instanceof Error
          ? err.message
          : 'Không thể quyết toán tổng công nợ Nhà cung cấp.'
      );
    }
  };

  // Receipt Voucher CRUD Handlers
  const handleCreateReceiptVoucher = (payload: {
    groupName: string;
    warehouseName: string;
    customerId?: string;
    partnerName: string;
    partnerPhone: string;
    amount: number;
    paymentMethod: string;
    isDebtSettlement: boolean;
    countsTowardOtherIncome?: boolean;
    note: string;
  }) => {
    if (payload.isDebtSettlement && (payload.customerId || payload.partnerName)) {
      handleSettleCustomerTotalDebtFifo({
        customerId: payload.customerId,
        customerName: payload.partnerName,
        customerPhone: payload.partnerPhone,
        totalAmount: payload.amount,
        groupName: payload.groupName,
        paymentMethod: payload.paymentMethod,
        note: payload.note,
        warehouseName: payload.warehouseName,
      });
      return;
    }
    const nowIso = new Date().toISOString();
    const activeUid = auth.currentUser?.uid || currentStaff.uid;
    const resolvedWh =
      lockedWarehouse || payload.warehouseName || warehouses[0] || 'Tâm An Mỹ Ngãi';
    const created: CashReceiptVoucher = {
      id: `rv_${Date.now()}`,
      voucherCode: generateSequentialVoucherCode(
        'PT',
        receiptVouchers.map((r) => r.voucherCode)
      ),
      groupName: payload.groupName || 'Thu khác',
      warehouseName: resolvedWh,
      partnerId: payload.customerId,
      partnerName: payload.partnerName,
      partnerPhone: payload.partnerPhone,
      amount: payload.amount,
      paymentMethod: payload.paymentMethod || 'Chuyển khoản ngân hàng',
      isDebtSettlement: false,
      settledAllocations: [],
      countsTowardOtherIncome: payload.countsTowardOtherIncome !== false,
      note: payload.note || `Phiếu thu nhóm ${payload.groupName}`,
      staffName: currentStaff.displayName,
      ownerId: activeUid,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    setReceiptVouchers((prev) => [created, ...prev]);
    recordAuditLog({
      actionCategory: 'create',
      targetEntity: 'voucher',
      targetCode: created.voucherCode,
      warehouseName: resolvedWh,
      summary: `Lập phiếu thu tiền ${created.voucherCode} (${created.groupName}) — +${formatVND(
        created.amount
      )}`,
      details: `Người nộp: ${created.partnerName} (${created.partnerPhone || 'Không SĐT'}) · Diễn giải: ${
        created.note
      }`,
      snapshotData: JSON.stringify(created),
    });
    showToast(
      `Đã lưu phiếu thu tiền ${created.voucherCode} (+${formatVND(created.amount)}) vào Nhật ký Phiếu thu & Báo cáo tài chính!`
    );
  };

  const handleUpdateReceiptVoucher = (
    id: string,
    changes: {
      voucherCode: string;
      groupName: string;
      warehouseName: string;
      partnerName: string;
      partnerPhone: string;
      amount: number;
      paymentMethod: string;
      note: string;
    }
  ) => {
    if (!canPerformRoleAction(role, 'edit_record')) {
      showToast('Chỉ Quản lý mới có quyền sửa phiếu thu tiền đã lưu.');
      return;
    }
    const existingVoucher = receiptVouchers.find((rv) => rv.id === id);
    if (!existingVoucher) return;
    const nowIso = new Date().toISOString();
    const roundedNewAmount = Math.max(0, Math.round(Number(changes.amount) || 0));

    if (
      existingVoucher.isDebtSettlement &&
      existingVoucher.settledAllocations &&
      existingVoucher.settledAllocations.length > 0 &&
      roundedNewAmount !== existingVoucher.amount
    ) {
      const reversed = reverseCustomerReceiptVoucherAllocations(sales, existingVoucher, nowIso);
      let nextSales = reversed.updatedSales;
      let nextAllocations = existingVoucher.settledAllocations;
      let nextAmount = 0;
      let nextPrevDebt = 0;
      let nextRemDebt = 0;

      if (roundedNewAmount > 0) {
        try {
          const reFifo = applyCustomerFifoDebtSettlement(
            reversed.updatedSales,
            {
              customerId: existingVoucher.partnerId,
              customerName: changes.partnerName || existingVoucher.partnerName,
              customerPhone: changes.partnerPhone || existingVoucher.partnerPhone,
            },
            roundedNewAmount,
            changes.note || existingVoucher.note,
            nowIso
          );
          nextSales = reFifo.updatedSales;
          nextAllocations = reFifo.settledAllocations;
          nextAmount = reFifo.totalAllocated;
          nextPrevDebt = reFifo.totalPreviousDebt;
          nextRemDebt = reFifo.totalRemainingDebt;
        } catch {
          nextAllocations = [];
          nextAmount = 0;
        }
      } else {
        nextAllocations = [];
      }

      setSales(nextSales);
      if (isGoogleAuthenticated) {
        const affectedIds = new Set([
          ...reversed.reversedSaleIds,
          ...nextAllocations.map((a) => a.recordId),
        ]);
        nextSales
          .filter((s) => affectedIds.has(s.id))
          .forEach((s) => void syncSaleToFirestore(s, false));
      }
      setCustomers((prev) => {
        const reconciled = reconcileCustomersFromSales(prev, nextSales, nowIso);
        if (isGoogleAuthenticated) {
          reconciled.changedCustomers.forEach((c) => void syncCustomerToFirestore(c, false));
        }
        return reconciled.customers;
      });

      setReceiptVouchers((prev) =>
        prev.map((rv) =>
          rv.id === id
            ? {
                ...rv,
                ...changes,
                amount: nextAmount,
                settledAllocations: nextAllocations,
                totalPreviousDebt: nextPrevDebt,
                totalRemainingDebt: nextRemDebt,
                updatedAt: nowIso,
              }
            : rv
        )
      );
      showToast(
        `Đã cập nhật phiếu thu ${changes.voucherCode} & đối soát lại ${nextAllocations.length} hóa đơn công nợ.`
      );
      return;
    }

    setReceiptVouchers((prev) =>
      prev.map((rv) => (rv.id === id ? { ...rv, ...changes, updatedAt: nowIso } : rv))
    );
    showToast(`Đã cập nhật phiếu thu tiền ${changes.voucherCode}.`);
  };

  const handleDeleteReceiptVoucher = (id: string) => {
    if (!canPerformRoleAction(role, 'delete_record')) return;
    const target = receiptVouchers.find((rv) => rv.id === id);
    const nowIso = new Date().toISOString();
    markRecordsDeleted(id, nowIso);
    setReceiptVouchers((prev) => prev.filter((rv) => rv.id !== id));
    if (target) {
      if (target.isDebtSettlement && target.settledAllocations?.length) {
        const reversed = reverseCustomerReceiptVoucherAllocations(sales, target, nowIso);
        if (reversed.reversedSaleIds.length > 0) {
          setSales(reversed.updatedSales);
          if (isGoogleAuthenticated) {
            const idSet = new Set(reversed.reversedSaleIds);
            reversed.updatedSales
              .filter((s) => idSet.has(s.id))
              .forEach((s) => void syncSaleToFirestore(s, false));
          }
          setCustomers((prev) => {
            const reconciled = reconcileCustomersFromSales(prev, reversed.updatedSales, nowIso);
            if (isGoogleAuthenticated) {
              reconciled.changedCustomers.forEach((c) => void syncCustomerToFirestore(c, false));
            }
            return reconciled.customers;
          });
        }
      }
      recordAuditLog({
        actionCategory: 'delete',
        targetEntity: 'voucher',
        targetCode: target.voucherCode,
        warehouseName: target.warehouseName,
        summary: `Xóa phiếu thu tiền ${target.voucherCode} (+${formatVND(target.amount)})`,
        details: `Nhóm phiếu thu: ${target.groupName} · Đối tác: ${target.partnerName}${
          target.isDebtSettlement ? ' · Đã hoàn lại dư nợ trên hóa đơn liên kết' : ''
        }`,
        snapshotData: JSON.stringify(target),
      });
    }
    showToast(
      target?.isDebtSettlement
        ? 'Đã xóa phiếu thu & tự động hoàn lại công nợ khách hàng trên các hóa đơn liên kết.'
        : 'Đã xóa phiếu thu tiền khỏi nhật ký.'
    );
  };

  // Payment Voucher CRUD Handlers
  const handleCreatePaymentVoucher = (payload: {
    groupName: string;
    warehouseName: string;
    partnerName: string;
    partnerPhone: string;
    amount: number;
    paymentMethod: string;
    isDebtSettlement: boolean;
    countsTowardOperatingExpense?: boolean;
    note: string;
  }) => {
    if (payload.isDebtSettlement && payload.partnerName) {
      handleSettleSupplierTotalDebtFifo({
        supplierName: payload.partnerName,
        supplierPhone: payload.partnerPhone,
        totalAmount: payload.amount,
        groupName: payload.groupName,
        paymentMethod: payload.paymentMethod,
        note: payload.note,
        warehouseName: payload.warehouseName,
      });
      return;
    }
    const nowIso = new Date().toISOString();
    const activeUid = auth.currentUser?.uid || currentStaff.uid;
    const resolvedWh =
      lockedWarehouse || payload.warehouseName || warehouses[0] || 'Tâm An Mỹ Ngãi';
    const created: CashPaymentVoucher = {
      id: `pv_${Date.now()}`,
      voucherCode: generateSequentialVoucherCode(
        'PC',
        paymentVouchers.map((p) => p.voucherCode)
      ),
      groupName: payload.groupName || 'Chi phí vận hành khác',
      warehouseName: resolvedWh,
      partnerName: payload.partnerName,
      partnerPhone: payload.partnerPhone,
      amount: payload.amount,
      paymentMethod: payload.paymentMethod || 'Chuyển khoản ngân hàng',
      isDebtSettlement: false,
      settledAllocations: [],
      countsTowardOperatingExpense: payload.countsTowardOperatingExpense !== false,
      note: payload.note || `Phiếu chi nhóm ${payload.groupName}`,
      staffName: currentStaff.displayName,
      ownerId: activeUid,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    setPaymentVouchers((prev) => [created, ...prev]);
    recordAuditLog({
      actionCategory: 'create',
      targetEntity: 'voucher',
      targetCode: created.voucherCode,
      warehouseName: resolvedWh,
      summary: `Lập phiếu chi tiền ${created.voucherCode} (${created.groupName}) — -${formatVND(
        created.amount
      )}`,
      details: `Người nhận: ${created.partnerName} (${created.partnerPhone || 'Không SĐT'}) · Diễn giải: ${
        created.note
      }`,
      snapshotData: JSON.stringify(created),
    });
    showToast(
      `Đã lưu phiếu chi tiền ${created.voucherCode} (-${formatVND(created.amount)}) vào Nhật ký Phiếu chi & Báo cáo tài chính!`
    );
  };

  const handleUpdatePaymentVoucher = (
    id: string,
    changes: {
      voucherCode: string;
      groupName: string;
      warehouseName: string;
      partnerName: string;
      partnerPhone: string;
      amount: number;
      paymentMethod: string;
      note: string;
    }
  ) => {
    if (!canPerformRoleAction(role, 'edit_record')) {
      showToast('Chỉ Quản lý mới có quyền sửa phiếu chi tiền đã lưu.');
      return;
    }
    const existingVoucher = paymentVouchers.find((pv) => pv.id === id);
    if (!existingVoucher) return;
    const nowIso = new Date().toISOString();
    const roundedNewAmount = Math.max(0, Math.round(Number(changes.amount) || 0));

    if (
      existingVoucher.isDebtSettlement &&
      existingVoucher.settledAllocations &&
      existingVoucher.settledAllocations.length > 0 &&
      roundedNewAmount !== existingVoucher.amount
    ) {
      const reversed = reverseSupplierPaymentVoucherAllocations(imports, existingVoucher, nowIso);
      let nextImports = reversed.updatedImports;
      let nextAllocations = existingVoucher.settledAllocations;
      let nextAmount = 0;
      let nextPrevDebt = 0;
      let nextRemDebt = 0;

      if (roundedNewAmount > 0) {
        try {
          const reFifo = applySupplierFifoDebtSettlement(
            reversed.updatedImports,
            {
              supplierName: changes.partnerName || existingVoucher.partnerName,
              supplierPhone: changes.partnerPhone || existingVoucher.partnerPhone,
            },
            roundedNewAmount,
            changes.note || existingVoucher.note,
            nowIso
          );
          nextImports = reFifo.updatedImports;
          nextAllocations = reFifo.settledAllocations;
          nextAmount = reFifo.totalAllocated;
          nextPrevDebt = reFifo.totalPreviousDebt;
          nextRemDebt = reFifo.totalRemainingDebt;
        } catch {
          nextAllocations = [];
          nextAmount = 0;
        }
      } else {
        nextAllocations = [];
      }

      setImports(nextImports);
      if (isGoogleAuthenticated) {
        const affectedIds = new Set([
          ...reversed.reversedImportIds,
          ...nextAllocations.map((a) => a.recordId),
        ]);
        nextImports
          .filter((imp) => affectedIds.has(imp.id))
          .forEach((imp) => void syncImportToFirestore(imp, false));
      }

      setPaymentVouchers((prev) =>
        prev.map((pv) =>
          pv.id === id
            ? {
                ...pv,
                ...changes,
                amount: nextAmount,
                settledAllocations: nextAllocations,
                totalPreviousDebt: nextPrevDebt,
                totalRemainingDebt: nextRemDebt,
                updatedAt: nowIso,
              }
            : pv
        )
      );
      showToast(
        `Đã cập nhật phiếu chi ${changes.voucherCode} & đối soát lại ${nextAllocations.length} phiếu nhập NCC.`
      );
      return;
    }

    setPaymentVouchers((prev) =>
      prev.map((pv) => (pv.id === id ? { ...pv, ...changes, updatedAt: nowIso } : pv))
    );
    showToast(`Đã cập nhật phiếu chi tiền ${changes.voucherCode}.`);
  };

  const handleDeletePaymentVoucher = (id: string) => {
    if (!canPerformRoleAction(role, 'delete_record')) return;
    const target = paymentVouchers.find((pv) => pv.id === id);
    const nowIso = new Date().toISOString();
    markRecordsDeleted(id, nowIso);
    setPaymentVouchers((prev) => prev.filter((pv) => pv.id !== id));
    if (target) {
      if (target.isDebtSettlement && target.settledAllocations?.length) {
        const reversed = reverseSupplierPaymentVoucherAllocations(imports, target, nowIso);
        if (reversed.reversedImportIds.length > 0) {
          setImports(reversed.updatedImports);
          if (isGoogleAuthenticated) {
            const idSet = new Set(reversed.reversedImportIds);
            reversed.updatedImports
              .filter((imp) => idSet.has(imp.id))
              .forEach((imp) => void syncImportToFirestore(imp, false));
          }
        }
      }
      recordAuditLog({
        actionCategory: 'delete',
        targetEntity: 'voucher',
        targetCode: target.voucherCode,
        warehouseName: target.warehouseName,
        summary: `Xóa phiếu chi tiền ${target.voucherCode} (-${formatVND(target.amount)})`,
        details: `Nhóm phiếu chi: ${target.groupName} · Đối tác: ${target.partnerName}${
          target.isDebtSettlement ? ' · Đã hoàn lại dư nợ NCC trên các phiếu nhập liên kết' : ''
        }`,
        snapshotData: JSON.stringify(target),
      });
    }
    showToast(
      target?.isDebtSettlement
        ? 'Đã xóa phiếu chi & tự động hoàn lại công nợ NCC trên các phiếu nhập liên kết.'
        : 'Đã xóa phiếu chi tiền khỏi nhật ký.'
    );
  };

  // Excel Direct Import Handlers across all 5 modules
  const handleImportProductsFromExcel = (rows: Record<string, unknown>[]): number => {
    const nowIso = new Date().toISOString();
    const activeUid = auth.currentUser?.uid || currentStaff.uid;
    const added: ProductItem[] = [];
    let skippedCount = 0;
    rows.forEach((r, idx) => {
      const name = String(
        r['Tên Vật Tư Nông Nghiệp'] || r['Tên Vật Tư'] || r['name'] || ''
      ).trim();
      if (!name) return;

      const importPrice = readExcelNumber(r, ['Giá Nhập (VNĐ)', 'Giá Nhập (đ)'], 0);
      const sellPrice = readExcelNumber(r, ['Giá Bán Lẻ (VNĐ)', 'Giá Bán (đ)'], 0);
      const stock = readExcelNumber(r, ['Tồn Kho Ban Đầu', 'Tồn Kho Hiện Tại'], 10);
      const minStock = readExcelNumber(r, ['Mức Cảnh Báo Tối Thiểu', 'Mức Tối Thiểu'], 5);
      if (
        !Number.isFinite(importPrice) ||
        importPrice < 0 ||
        !Number.isFinite(sellPrice) ||
        sellPrice < 0 ||
        !Number.isFinite(stock) ||
        stock < 0 ||
        !Number.isFinite(minStock) ||
        minStock < 0
      ) {
        skippedCount += 1;
        return;
      }

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
        importPrice: Math.round(importPrice),
        sellPrice: Math.round(sellPrice),
        stock: Math.round(stock),
        minStock: Math.round(minStock),
        supplierName: String(r['Nhà Cung Cấp Chính'] || 'Nhà cung cấp VTNN').trim(),
        ownerId: activeUid,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    });
    if (added.length > 0) {
      setProducts((prev) => {
        const nextList = [...added, ...prev];
        productsRef.current = nextList;
        return nextList;
      });
      if (isGoogleAuthenticated) {
        added.forEach((p) => void syncProductToFirestore(p, true));
      }
      showToast(
        `Đã tải lên ${added.length} mặt hàng vật tư từ tệp Excel!${
          skippedCount > 0 ? ` (Bỏ qua ${skippedCount} dòng lỗi số liệu)` : ''
        }`
      );
    } else if (skippedCount > 0) {
      showToast(`Bỏ qua ${skippedCount} dòng lỗi / số liệu âm trong tệp Excel.`);
    }
    return added.length;
  };

  const handleImportCustomersFromExcel = (rows: Record<string, unknown>[]): number => {
    const nowIso = new Date().toISOString();
    const activeUid = auth.currentUser?.uid || currentStaff.uid;
    const added: CustomerProfile[] = [];
    let skippedCount = 0;
    const defaultWh =
      lockedWarehouse ||
      (currentStaff.assignedWarehouse !== 'Tất cả kho'
        ? currentStaff.assignedWarehouse
        : warehouses[0] || 'Tâm An Mỹ Ngãi');
    rows.forEach((r, idx) => {
      const name = String(r['Họ Tên Khách Hàng'] || r['Tên Khách Hàng'] || '').trim();
      const phone = String(r['Số Điện Thoại'] || r['Số Điện Thoại KH'] || '').trim();
      if (!name) return;

      const totalPurchased = readExcelNumber(r, ['Tổng Mua (VNĐ)'], 0);
      const totalDebt = readExcelNumber(r, ['Dư Nợ Hiện Tại (VNĐ)'], 0);
      if (
        !Number.isFinite(totalPurchased) ||
        totalPurchased < 0 ||
        !Number.isFinite(totalDebt) ||
        totalDebt < 0
      ) {
        skippedCount += 1;
        return;
      }

      const grp = String(r['Nhóm Khách Hàng'] || r['Nhóm KH'] || 'Nhà nông').trim();
      if (grp && !customerGroups.includes(grp)) {
        setCustomerGroups((prev) => (prev.includes(grp) ? prev : [...prev, grp]));
      }
      const wh = lockedWarehouse || String(r['Kho'] || defaultWh).trim();
      added.push({
        id: `cust_xl_${Date.now()}_${idx}`,
        code: String(r['Mã KH'] || `KH-XL${customers.length + idx + 1}`).trim(),
        name,
        phone: phone || '',
        email: String(r['Email'] || '').trim(),
        address: String(r['Địa Chỉ'] || '').trim(),
        group: grp || 'Nhà nông',
        note: String(r['Ghi Chú'] || 'Nhập từ biểu mẫu Excel').trim(),
        totalPurchased: Math.round(totalPurchased),
        totalDebt: Math.round(totalDebt),
        warehouseName: wh,
        ownerId: activeUid,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    });
    if (added.length > 0) {
      setCustomers((prev) => [...added, ...prev]);
      if (isGoogleAuthenticated) {
        added.forEach((c) => void syncCustomerToFirestore(c, true));
      }
      showToast(
        `Đã tải lên ${added.length} hồ sơ khách hàng từ tệp Excel!${
          skippedCount > 0 ? ` (Bỏ qua ${skippedCount} dòng lỗi số liệu)` : ''
        }`
      );
    } else if (skippedCount > 0) {
      showToast(`Bỏ qua ${skippedCount} dòng lỗi / số liệu âm trong tệp Excel.`);
    }
    return added.length;
  };

  const handleImportSalesFromExcel = (rows: Record<string, unknown>[]): number => {
    const nowIso = new Date().toISOString();
    const activeUid = auth.currentUser?.uid || currentStaff.uid;
    const defaultDueDate = computeDueDateAfterDays(7, getTodayVietnamDateStr());
    const addedSales: SaleTransaction[] = [];
    const prodDeltaById = new Map<string, number>();
    let skippedCount = 0;

    rows.forEach((r, idx) => {
      const custName = String(r['Tên Khách Hàng'] || '').trim();
      const prodName = String(r['Tên Vật Tư Nông Nghiệp'] || r['Sản Phẩm'] || '').trim();
      if (!custName || !prodName) return;

      const qty = readExcelNumber(r, ['Số Lượng Bán', 'Số Lượng'], 1);
      const price = readExcelNumber(r, ['Đơn Giá Bán (VNĐ)', 'Đơn Giá (đ)'], 0);
      if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price < 0) {
        skippedCount += 1;
        return;
      }

      const paidRaw = readExcelNumber(r, ['Khách Đã Trả (VNĐ)', 'Đã Thu (đ)'], qty * price);
      if (!Number.isFinite(paidRaw) || paidRaw < 0) {
        skippedCount += 1;
        return;
      }

      const wh =
        lockedWarehouse ||
        String(r['Kho Xuất Bán'] || warehouses[0] || 'Tâm An Mỹ Ngãi').trim();
      const custPhone = String(r['Số Điện Thoại KH'] || r['Số Điện Thoại'] || '').trim();
      const matchedCust = customers.find(
        (c) =>
          (!c.warehouseName || !wh || c.warehouseName === wh) &&
          ((custPhone && c.phone && c.phone.trim() === custPhone) ||
            normalizeVietnameseSearch(c.name) === normalizeVietnameseSearch(custName))
      );
      const matchedProd = productsRef.current.find(
        (p) =>
          (!p.warehouseName || !wh || p.warehouseName === wh) &&
          normalizeVietnameseSearch(p.name) === normalizeVietnameseSearch(prodName)
      );
      if (matchedProd) {
        const projectedOut = Math.abs(prodDeltaById.get(matchedProd.id) || 0) + qty;
        if (matchedProd.stock < projectedOut) {
          skippedCount += 1;
          return;
        }
        prodDeltaById.set(matchedProd.id, (prodDeltaById.get(matchedProd.id) || 0) - qty);
      }

      const batchTs = Date.now();
      const sum = calculateSaleSummary(qty, price, paidRaw);
      addedSales.push({
        id: `sale_xl_${batchTs}_${idx}`,
        invoiceCode: `HD-XL-${sales.length + idx + 1}`,
        customerId: matchedCust?.id || `cust_xl_${batchTs}_${idx}`,
        customerName: matchedCust?.name || custName,
        customerPhone: matchedCust?.phone || custPhone,
        productId: matchedProd?.id || `prod_xl_${batchTs}_${idx}`,
        productName: matchedProd?.name || prodName,
        unit: matchedProd?.unit || String(r['Đơn Vị'] || 'Bao').trim(),
        quantity: qty,
        unitPrice: price,
        unitCost: matchedProd ? Math.max(0, Math.round(matchedProd.importPrice || 0)) : Math.round(price * 0.85),
        totalAmount: sum.totalAmount,
        paidAmount: sum.paidAmount,
        debtAmount: sum.debtAmount,
        dueDate: String(r['Hạn Thanh Toán Nợ (YYYY-MM-DD)'] || defaultDueDate).trim(),
        status: sum.status,
        note: String(r['Ghi Chú Đơn Hàng'] || 'Nhập từ Excel').trim(),
        warehouseName: wh,
        staffName: currentStaff.displayName,
        ownerId: activeUid,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    });
    if (addedSales.length > 0) {
      const nextSales = [...addedSales, ...sales];
      setSales(nextSales);
      if (prodDeltaById.size > 0) {
        setProducts((prev) => {
          const nextList = prev.map((p) => {
            const delta = prodDeltaById.get(p.id);
            return delta ? { ...p, stock: p.stock + delta, updatedAt: nowIso } : p;
          });
          productsRef.current = nextList;
          return nextList;
        });
      }
      setCustomers((prev) => reconcileCustomersFromSales(prev, nextSales, nowIso).customers);
      showToast(
        `Đã tải lên ${addedSales.length} hóa đơn bán hàng từ tệp Excel!${
          skippedCount > 0 ? ` (Bỏ qua ${skippedCount} dòng lỗi / vượt tồn)` : ''
        }`
      );
    } else if (skippedCount > 0) {
      showToast(`Bỏ qua ${skippedCount} dòng lỗi hoặc vượt tồn kho trong tệp Excel.`);
    }
    return addedSales.length;
  };

  const handleImportWarehouseFromExcel = (rows: Record<string, unknown>[]): number => {
    const nowIso = new Date().toISOString();
    const activeUid = auth.currentUser?.uid || currentStaff.uid;
    const defaultDueDate = computeDueDateAfterDays(7, getTodayVietnamDateStr());
    const addedImports: ImportTransaction[] = [];
    const prodDeltaById = new Map<string, { qty: number; avgCost: number }>();
    let skippedCount = 0;

    rows.forEach((r, idx) => {
      const prodName = String(r['Tên Vật Tư Nhập Kho'] || r['Sản Phẩm'] || '').trim();
      const supName = String(r['Nhà Cung Cấp'] || '').trim();
      if (!prodName || !supName) return;

      const qty = readExcelNumber(r, ['Số Lượng Nhập'], 1);
      const cost = readExcelNumber(r, ['Đơn Giá Nhập (VNĐ)', 'Giá Nhập (đ)'], 0);
      if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(cost) || cost < 0) {
        skippedCount += 1;
        return;
      }

      const paidRaw = readExcelNumber(
        r,
        ['Đã Thanh Toán NCC (VNĐ)', 'Đã Trả NCC (đ)'],
        qty * cost
      );
      if (!Number.isFinite(paidRaw) || paidRaw < 0) {
        skippedCount += 1;
        return;
      }

      const wh =
        lockedWarehouse ||
        String(r['Kho Nhập Hàng'] || warehouses[0] || 'Tâm An Mỹ Ngãi').trim();
      const matchedProd = productsRef.current.find(
        (p) =>
          (!p.warehouseName || !wh || p.warehouseName === wh) &&
          normalizeVietnameseSearch(p.name) === normalizeVietnameseSearch(prodName)
      );
      if (matchedProd) {
        const prevD = prodDeltaById.get(matchedProd.id) || {
          qty: 0,
          avgCost: Math.max(0, Math.round(matchedProd.importPrice || 0)),
        };
        const currentRunningStock = Math.max(0, matchedProd.stock + prevD.qty);
        const nextAvgCost = computeWeightedAverageImportPrice(
          currentRunningStock,
          prevD.avgCost,
          qty,
          cost
        );
        prodDeltaById.set(matchedProd.id, {
          qty: prevD.qty + qty,
          avgCost: nextAvgCost,
        });
      }

      const batchTs = Date.now();
      const sum = calculateImportSummary(qty, cost, paidRaw);
      addedImports.push({
        id: `imp_xl_${batchTs}_${idx}`,
        receiptCode: `PN-XL-${imports.length + idx + 1}`,
        supplierName: supName,
        supplierPhone: String(r['SĐT Nhà Cung Cấp'] || r['SĐT NCC'] || '').trim(),
        productId: matchedProd?.id || `prod_xl_${batchTs}_${idx}`,
        productName: matchedProd?.name || prodName,
        unit: matchedProd?.unit || String(r['Đơn Vị Tính'] || r['Đơn Vị'] || 'Bao').trim(),
        quantity: qty,
        unitCost: cost,
        totalCost: sum.totalCost,
        paidAmount: sum.paidAmount,
        debtAmount: sum.debtAmount,
        dueDate: String(r['Hạn Trả Nợ NCC (YYYY-MM-DD)'] || defaultDueDate).trim(),
        status: sum.status,
        note: String(r['Ghi Chú Lô Nhập'] || 'Nhập từ Excel').trim(),
        warehouseName: wh,
        staffName: currentStaff.displayName,
        ownerId: activeUid,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    });
    if (addedImports.length > 0) {
      setImports((prev) => [...addedImports, ...prev]);
      if (prodDeltaById.size > 0) {
        setProducts((prev) => {
          const nextList = prev.map((p) => {
            const delta = prodDeltaById.get(p.id);
            return delta
              ? {
                  ...p,
                  stock: p.stock + delta.qty,
                  importPrice: delta.avgCost > 0 ? delta.avgCost : p.importPrice,
                  updatedAt: nowIso,
                }
              : p;
          });
          productsRef.current = nextList;
          return nextList;
        });
      }
      showToast(
        `Đã tải lên ${addedImports.length} phiếu nhập kho từ tệp Excel!${
          skippedCount > 0 ? ` (Bỏ qua ${skippedCount} dòng lỗi số liệu)` : ''
        }`
      );
    } else if (skippedCount > 0) {
      showToast(`Bỏ qua ${skippedCount} dòng lỗi / số liệu âm trong tệp Excel.`);
    }
    return addedImports.length;
  };

  const handleImportDebtPaymentsFromExcel = (rows: Record<string, unknown>[]): number => {
    let updatedCount = 0;
    let skippedCount = 0;
    const nowIso = new Date().toISOString();
    const activeUid = auth.currentUser?.uid || currentStaff.uid;
    const allowedSaleIds = new Set(visibleSales.map((s) => s.id));
    const allowedImportIds = new Set(visibleImports.map((i) => i.id));
    let workingSales = [...sales];
    let workingImports = [...imports];
    const addedReceipts: CashReceiptVoucher[] = [];
    const addedPayments: CashPaymentVoucher[] = [];
    let salesChanged = false;
    let importsChanged = false;

    rows.forEach((r, rowIdx) => {
      const code = String(r['Mã Hóa Đơn / Mã Phiếu Nhập'] || '').trim();
      const amount = readExcelNumber(r, ['Số Tiền Thanh Toán Đợt Này (VNĐ)'], 0);
      const note = String(r['Ghi Chú Thanh Toán'] || 'Cập nhật từ Excel').trim();
      if (!code) return;
      if (!Number.isFinite(amount) || amount <= 0) {
        skippedCount += 1;
        return;
      }

      if (code.startsWith('HD-')) {
        workingSales = workingSales.map((s) => {
          if (!allowedSaleIds.has(s.id) || s.invoiceCode !== code || s.debtAmount <= 0) return s;
          salesChanged = true;
          updatedCount += 1;
          const actualCollected = Math.min(s.debtAmount, Math.round(amount));
          const noteSuffix = `[Thu nợ Excel: +${actualCollected.toLocaleString('vi-VN')}đ${note ? ' - ' + note : ''}]`;
          const updated = applyDebtPayment(
            { ...s, note: s.note ? `${s.note} | ${noteSuffix}` : noteSuffix },
            actualCollected,
            nowIso
          );
          const vCode = generateSequentialVoucherCode('PT', [
            ...receiptVouchers.map((rv) => rv.voucherCode),
            ...addedReceipts.map((rv) => rv.voucherCode),
          ]);
          addedReceipts.push({
            id: `rv_xl_${Date.now()}_${rowIdx}`,
            voucherCode: vCode,
            groupName: receiptGroups[0] || 'Thu nợ bán hàng khách hàng',
            warehouseName: s.warehouseName || lockedWarehouse || 'Tâm An Mỹ Ngãi',
            partnerId: s.customerId,
            partnerName: s.customerName,
            partnerPhone: s.customerPhone,
            amount: actualCollected,
            paymentMethod: 'Tiền mặt / Chuyển khoản',
            isDebtSettlement: true,
            settledAllocations: [
              {
                recordId: s.id,
                code: s.invoiceCode,
                date: (s.createdAt || '').slice(0, 10),
                dueDate: s.dueDate,
                productName: s.productName,
                previousDebt: s.debtAmount,
                allocatedAmount: actualCollected,
                remainingDebt: updated.debtAmount,
              },
            ],
            totalPreviousDebt: s.debtAmount,
            totalRemainingDebt: updated.debtAmount,
            countsTowardOtherIncome: false,
            note: note || `Thu nợ Excel cho HĐ ${s.invoiceCode}`,
            staffName: currentStaff.displayName,
            ownerId: activeUid,
            createdAt: nowIso,
            updatedAt: nowIso,
          });
          return updated;
        });
      } else if (code.startsWith('PN-')) {
        workingImports = workingImports.map((i) => {
          if (!allowedImportIds.has(i.id) || i.receiptCode !== code || i.debtAmount <= 0) return i;
          importsChanged = true;
          updatedCount += 1;
          const actualPaid = Math.min(i.debtAmount, Math.round(amount));
          const noteSuffix = `[Trả nợ Excel: -${actualPaid.toLocaleString('vi-VN')}đ${note ? ' - ' + note : ''}]`;
          const updated = applyDebtPayment(
            { ...i, note: i.note ? `${i.note} | ${noteSuffix}` : noteSuffix },
            actualPaid,
            nowIso
          );
          const vCode = generateSequentialVoucherCode('PC', [
            ...paymentVouchers.map((pv) => pv.voucherCode),
            ...addedPayments.map((pv) => pv.voucherCode),
          ]);
          addedPayments.push({
            id: `pv_xl_${Date.now()}_${rowIdx}`,
            voucherCode: vCode,
            groupName: paymentGroups[0] || 'Chi trả nợ Nhà cung cấp',
            warehouseName: i.warehouseName || lockedWarehouse || 'Tâm An Mỹ Ngãi',
            partnerName: i.supplierName,
            partnerPhone: i.supplierPhone,
            amount: actualPaid,
            paymentMethod: 'Chuyển khoản ngân hàng',
            isDebtSettlement: true,
            settledAllocations: [
              {
                recordId: i.id,
                code: i.receiptCode,
                date: (i.createdAt || '').slice(0, 10),
                dueDate: i.dueDate,
                productName: i.productName,
                previousDebt: i.debtAmount,
                allocatedAmount: actualPaid,
                remainingDebt: updated.debtAmount,
              },
            ],
            totalPreviousDebt: i.debtAmount,
            totalRemainingDebt: updated.debtAmount,
            countsTowardOperatingExpense: false,
            note: note || `Trả nợ NCC Excel cho phiếu ${i.receiptCode}`,
            staffName: currentStaff.displayName,
            ownerId: activeUid,
            createdAt: nowIso,
            updatedAt: nowIso,
          });
          return updated;
        });
      }
    });

    if (salesChanged) {
      setSales(workingSales);
      setCustomers((prev) => reconcileCustomersFromSales(prev, workingSales, nowIso).customers);
    }
    if (importsChanged) {
      setImports(workingImports);
    }
    if (addedReceipts.length > 0) {
      setReceiptVouchers((prev) => [...addedReceipts, ...prev]);
    }
    if (addedPayments.length > 0) {
      setPaymentVouchers((prev) => [...addedPayments, ...prev]);
    }
    if (updatedCount > 0) {
      showToast(
        `Đã cập nhật thanh toán cho ${updatedCount} chứng từ công nợ từ Excel!${
          skippedCount > 0 ? ` (Bỏ qua ${skippedCount} dòng lỗi số tiền)` : ''
        }`
      );
    } else if (skippedCount > 0) {
      showToast(`Bỏ qua ${skippedCount} dòng có số tiền không hợp lệ trong tệp Excel.`);
    }
    return updatedCount;
  };

  // Staff Account Login, Password Change & Per-Staff [X] Permission Handlers (Production-hardened)
  const handleLoginStaff = async (
    usernameOrEmail: string,
    password: string
  ): Promise<{ ok: boolean; message: string }> => {
    const trimmedInput = usernameOrEmail.trim();
    const query = trimmedInput.toLowerCase();
    if (!query || !password) {
      return { ok: false, message: 'Vui lòng nhập đầy đủ Email/Tên đăng nhập và Mật khẩu.' };
    }

    const curStaffList = latestWorkspaceRef.current.staffList;
    const digitsQuery = query.replace(/\D+/g, '');
    const matchedByUsernameOrPhone = !query.includes('@')
      ? curStaffList.find(
          (s) =>
            s.username.toLowerCase() === query ||
            (s.phone && digitsQuery.length >= 9 && s.phone.replace(/\D+/g, '') === digitsQuery)
        )
      : undefined;

    // Resolve email for Firebase Authentication even when user types username (e.g. "vtnntaman99" or "admin")
    const candidateEmail = query.includes('@')
      ? query
      : query === 'admin'
      ? ADMIN_BACKUP_EMAIL.toLowerCase()
      : matchedByUsernameOrPhone?.email && matchedByUsernameOrPhone.email.includes('@')
      ? matchedByUsernameOrPhone.email.toLowerCase()
      : /^[a-z0-9._-]+$/.test(query)
      ? `${query}@gmail.com`
      : '';

    // 1. Always try Firebase Authentication first so Phone & Web share the exact same Cloud session
    if (candidateEmail) {
      try {
        const fbRes = await firebaseSignInWithEmailPassword(candidateEmail, password);
        syncUserSessionFromFirebase(fbRes.user);
        showToast(
          `Đăng nhập & đồng bộ Cloud thành công (${fbRes.user.email || candidateEmail})!`
        );
        return {
          ok: true,
          message: `Đăng nhập & đồng bộ dữ liệu Cloud thành công (${fbRes.user.email || candidateEmail})!`,
        };
      } catch (err) {
        const code = (err as { code?: string })?.code || '';
        if (code === 'auth/too-many-requests') {
          return {
            ok: false,
            message: 'Tài khoản tạm thời bị giới hạn do nhập sai nhiều lần. Vui lòng thử lại sau ít phút.',
          };
        }
        // Fall through to local hashed staff account check below if offline or internal-only account
      }
    }

    // 2. Fallback to local hashed staff account only if an internal hashed password is stored
    const matchedLocal =
      matchedByUsernameOrPhone ||
      curStaffList.find(
        (s) => s.email && s.email.toLowerCase() === query && isHashedPassword(s.password)
      );
    if (!matchedLocal) {
      return {
        ok: false,
        message:
          'Email/Tên đăng nhập hoặc mật khẩu không đúng (nếu tài khoản này đăng ký bằng Google, vui lòng bấm nút "Đăng nhập bằng Google" bên dưới).',
      };
    }
    if (!matchedLocal.active) {
      return {
        ok: false,
        message: `Tài khoản "${matchedLocal.username}" đã bị khóa bởi Quản lý chính.`,
      };
    }
    const isPasswordValid = await verifyPassword(password, matchedLocal.password, matchedLocal.uid);
    if (!isPasswordValid) {
      return {
        ok: false,
        message:
          'Mật khẩu không chính xác (hoặc tài khoản này cần đăng nhập bằng nút "Đăng nhập bằng Google").',
      };
    }
    setCurrentStaffId(matchedLocal.uid);
    setRole(matchedLocal.role);
    setCurrentUserEmail(matchedLocal.email || ADMIN_BACKUP_EMAIL);
    setIsSessionLoggedIn(true);
    showToast(
      `Đã đăng nhập: ${matchedLocal.displayName} — Kho làm việc: ${matchedLocal.assignedWarehouse}`
    );
    return {
      ok: true,
      message: `Đăng nhập thành công (${matchedLocal.displayName})! Kho làm việc: ${matchedLocal.assignedWarehouse}.`,
    };
  };

  const handleGoogleLoginByEmail = (
    email: string,
    googleDisplayName?: string,
    googleUid?: string,
    preferredWarehouseName?: string
  ) => {
    const trimmedEmail = email.trim().toLowerCase();
    const isAdminEmail =
      trimmedEmail === ADMIN_BACKUP_EMAIL.toLowerCase() ||
      googleUid === PRIMARY_ADMIN_UID;
    const nowIso = new Date().toISOString();
    // Always read from latestWorkspaceRef.current.staffList to avoid stale closure after onAuthStateChanged
    const liveStaffList = latestWorkspaceRef.current.staffList;
    const authRes = authenticateStaffByGoogleEmail(liveStaffList, trimmedEmail);

    if (authRes.ok && authRes.staff) {
      const matchedRaw = authRes.staff;
      const targetUid = isAdminEmail ? PRIMARY_ADMIN_UID : googleUid || matchedRaw.uid;
      const matched = normalizeIndependentWarehouseStaffMember({
        ...matchedRaw,
        uid: targetUid,
        assignedWarehouse:
          !isAdminEmail && preferredWarehouseName
            ? normalizeCustomTamAnWarehouseName(preferredWarehouseName, trimmedEmail)
            : matchedRaw.assignedWarehouse,
        updatedAt: nowIso,
      });

      if (
        matched.uid !== matchedRaw.uid ||
        matched.assignedWarehouse !== matchedRaw.assignedWarehouse
      ) {
        setStaffList((prev) => [
          ...prev.filter((s) => s.uid !== matchedRaw.uid && s.uid !== matched.uid),
          matched,
        ]);
      }
      if (!isAdminEmail && matched.assignedWarehouse) {
        setWarehouses((prev) =>
          prev.includes(matched.assignedWarehouse) ? prev : [...prev, matched.assignedWarehouse]
        );
      }

      setCurrentStaffId(matched.uid);
      setRole(matched.role);
      setCurrentUserEmail(matched.email || ADMIN_BACKUP_EMAIL);
      setIsGoogleAuthenticated(true);
      setIsSessionLoggedIn(true);
      showToast(
        `Đã đăng nhập bằng Google (${matched.email}) — Đang đồng bộ dữ liệu kho: ${matched.assignedWarehouse}`
      );
      return {
        ok: true,
        message: authRes.message,
      };
    }

    // Account not in local staffList yet -> register profile in staffList WITHOUT wiping hydrated cloud records
    const baseUser =
      trimmedEmail.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '') ||
      `user_${Date.now().toString().slice(-4)}`;
    const autoWarehouseName = isAdminEmail
      ? 'Tất cả kho'
      : preferredWarehouseName
      ? normalizeCustomTamAnWarehouseName(preferredWarehouseName, trimmedEmail)
      : formatDefaultWarehouseNameFromGmail(trimmedEmail);

    const newStaff: StaffMember = {
      uid: isAdminEmail ? PRIMARY_ADMIN_UID : googleUid || `staff_google_${Date.now()}`,
      username: isAdminEmail ? 'admin' : baseUser,
      password: '',
      displayName: (googleDisplayName && googleDisplayName.trim()) || baseUser,
      phone: isAdminEmail ? ADMIN_PRIMARY_PHONE : '',
      email: trimmedEmail,
      role: 'manager',
      positionRole: isAdminEmail ? 'primary_manager' : 'warehouse_manager',
      permissions: isAdminEmail
        ? getDefaultPermissionsForPosition('primary_manager')
        : getIndependentWarehouseFullPermissions(),
      assignedWarehouse: autoWarehouseName,
      active: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    setStaffList((prev) => [
      ...prev.filter((s) => s.uid !== newStaff.uid),
      newStaff,
    ]);
    setWarehouses((prev) =>
      prev.includes(autoWarehouseName) ? prev : [...prev, autoWarehouseName]
    );
    setCurrentStaffId(newStaff.uid);
    setRole(newStaff.role);
    setCurrentUserEmail(newStaff.email);
    setIsGoogleAuthenticated(true);
    setIsSessionLoggedIn(true);
    showToast(
      `Đã đăng nhập Gmail (${newStaff.email}) — Đang đồng bộ dữ liệu Cloud cho kho: ${newStaff.assignedWarehouse}`
    );
    return {
      ok: true,
      message: `Đăng nhập Gmail thành công (${newStaff.email}) · Kho quản lý: ${newStaff.assignedWarehouse}!`,
    };
  };

  const handleSignUpStaff = async (payload: {
    displayName: string;
    emailOrPhone: string;
    username?: string;
    password: string;
    provider: 'email_password' | 'phone' | 'google';
    customWarehouseName?: string;
  }): Promise<{ ok: boolean; message: string }> => {
    const query = payload.emailOrPhone.trim().toLowerCase();
    if (!query || !query.endsWith('@gmail.com')) {
      return {
        ok: false,
        message: 'Chỉ cho phép đăng ký tài khoản mới bằng địa chỉ Gmail (@gmail.com).',
      };
    }

    pendingRegistrationRef.current = {
      email: query,
      displayName: payload.displayName.trim(),
      customWarehouseName: payload.customWarehouseName,
    };

    try {
      const fbSignUp = await firebaseSignUpWithEmailPassword({
        email: query,
        password: payload.password,
        displayName: payload.displayName.trim(),
      });

      const nowIso = new Date().toISOString();
      const isPrimary = isCurrentUserAdmin(fbSignUp.user);
      const baseUsername =
        (payload.username || query.split('@')[0] || `nv_${Date.now().toString().slice(-4)}`)
          .replace(/[^a-zA-Z0-9._-]/g, '')
          .toLowerCase() || `nv_${Date.now().toString().slice(-4)}`;
      const uniqueUsername = latestWorkspaceRef.current.staffList.some(
        (s) => s.username.toLowerCase() === baseUsername
      )
        ? `${baseUsername}_${Date.now().toString().slice(-3)}`
        : baseUsername;
      const posRole: StaffPositionRole = isPrimary ? 'primary_manager' : 'warehouse_manager';
      const autoWarehouseName = isPrimary
        ? 'Tất cả kho'
        : payload.customWarehouseName
        ? normalizeCustomTamAnWarehouseName(payload.customWarehouseName, query)
        : formatDefaultWarehouseNameFromGmail(query);

      const newUid = isPrimary ? PRIMARY_ADMIN_UID : fbSignUp.user.uid;
      const hashedPass = await hashPassword(payload.password, newUid);

      const created: StaffMember = {
        uid: newUid,
        username: isPrimary ? 'admin' : uniqueUsername,
        password: hashedPass,
        displayName: payload.displayName.trim() || uniqueUsername,
        phone: isPrimary ? ADMIN_PRIMARY_PHONE : '',
        email: query,
        role: 'manager',
        positionRole: posRole,
        permissions: isPrimary
          ? getDefaultPermissionsForPosition('primary_manager')
          : getIndependentWarehouseFullPermissions(),
        assignedWarehouse: autoWarehouseName,
        active: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      pendingRegistrationRef.current = null;
      setStaffList((prev) => [...prev.filter((s) => s.uid !== created.uid), created]);
      setCurrentStaffId(created.uid);
      setRole(created.role);
      setCurrentUserEmail(created.email);
      setIsGoogleAuthenticated(true);
      setCloudSyncStatus(fbSignUp.user.emailVerified ? 'synced' : 'unverified');
      setIsSessionLoggedIn(true);

      // Check if Firebase Storage already has existing workspace data for this Gmail or warehouse
      const existingStorageWs = await readWorkspaceFromFirebaseStorage({
        uid: created.uid,
        email: created.email,
        assignedWarehouse: created.assignedWarehouse,
      });

      void upsertRealtimeUserDirectoryProfile(created);
      if (!existingStorageWs || countWorkspaceBusinessRecords(existingStorageWs) === 0) {
        void writeRealtimeWorkspace(
          created.uid,
          {
            meta: {
              ownerUid: created.uid,
              ownerEmail: created.email,
              ownerDisplayName: created.displayName,
              assignedWarehouse: created.assignedWarehouse,
              updatedAt: nowIso,
              updatedByUid: created.uid,
              schemaVersion: 1,
            },
            products: [],
            customers: [],
            suppliers: [],
            sales: [],
            imports: [],
            receiptVouchers: [],
            paymentVouchers: [],
            savedVouchers: [],
            auditLogs: [],
            backups: [],
            settings: {
              warehouses: [created.assignedWarehouse],
              customerGroups,
              productCategories,
              receiptGroups,
              paymentGroups,
              notificationPrefs,
              autoDailyBackupEnabled,
            },
          },
          null
        );
      }
      setRtdbWriteTrigger((n) => n + 1);

      showToast(
        `Đã đăng ký Gmail @${created.username} — Tự động tạo kho: ${created.assignedWarehouse} & đồng bộ Cloud!`
      );
      return {
        ok: true,
        message: `Đăng ký tài khoản mới thành công (@${created.username})! Đã tạo kho riêng "${created.assignedWarehouse}" và đồng bộ trực tiếp lên Firebase Storage & Realtime DB.${
          fbSignUp.verificationSent
            ? ' Vui lòng kiểm tra hộp thư Gmail để xác minh email.'
            : ''
        }`,
      };
    } catch (err) {
      pendingRegistrationRef.current = null;
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/email-already-in-use') {
        // If user already registered on Web and accidentally used Sign-Up tab on Phone, sign them in automatically!
        try {
          const signInRes = await firebaseSignInWithEmailPassword(query, payload.password);
          syncUserSessionFromFirebase(signInRes.user);
          showToast(
            `Đã đăng nhập vào tài khoản có sẵn (${query}) & đang đồng bộ dữ liệu từ trang web!`
          );
          return {
            ok: true,
            message: `Tài khoản "${query}" đã có sẵn — hệ thống đã tự động đăng nhập và đồng bộ toàn bộ dữ liệu kho của bạn từ Cloud!`,
          };
        } catch {
          return {
            ok: false,
            message: `Gmail "${query}" đã được đăng ký trước đó. Vui lòng chuyển sang tab "Đăng nhập" (hoặc bấm "Đăng nhập bằng Google" nếu tài khoản tạo bằng Google).`,
          };
        }
      }
      if (code === 'auth/weak-password') {
        return {
          ok: false,
          message: 'Mật khẩu quá yếu. Vui lòng chọn mật khẩu tối thiểu 6 ký tự.',
        };
      }
      return {
        ok: false,
        message:
          err instanceof Error
            ? `Không thể đăng ký tài khoản: ${err.message}`
            : 'Không thể đăng ký tài khoản mới. Vui lòng thử lại.',
      };
    }
  };

  const handleLogoutApp = () => {
    logoutUser().catch(() => {});
    setIsGoogleAuthenticated(false);
    setCloudSyncStatus('local');
    setIsSessionLoggedIn(false);
    setCurrentUserEmail(null);
    setMobileMenuOpen(false);
    showToast(
      `Đã thoát đăng nhập khỏi tài khoản @${currentStaff.username} (${currentStaff.displayName}). Vui lòng đăng nhập lại để tiếp tục.`
    );
  };

  const handleUpdateStaffProfile = async (payload: {
    uid: string;
    displayName: string;
    phone: string;
    email: string;
    newPassword?: string;
    customWarehouseName?: string;
  }): Promise<{ ok: boolean; message: string }> => {
    const target = staffList.find((s) => s.uid === payload.uid);
    if (!target) {
      return { ok: false, message: 'Không tìm thấy tài khoản cần cập nhật.' };
    }
    const cleanNextEmail = (payload.email || '').trim().toLowerCase();
    const cleanNextPhone = (payload.phone || '').replace(/\D+/g, '');
    if (
      !canAccountCreateStaff(target) &&
      (cleanNextEmail === ADMIN_BACKUP_EMAIL.toLowerCase() || cleanNextPhone === ADMIN_PRIMARY_PHONE)
    ) {
      return {
        ok: false,
        message: 'Email hoặc SĐT này thuộc quyền Quản trị chính, không thể gán cho tài khoản khác.',
      };
    }
    const nowIso = new Date().toISOString();
    const oldWarehouse = target.assignedWarehouse;
    const isSingleWhAccount =
      oldWarehouse !== 'Tất cả kho' &&
      !canAccountCreateStaff(target) &&
      !hasMultiWarehouseManagementGrant(target);

    const nextWarehouse =
      isSingleWhAccount && payload.customWarehouseName
        ? normalizeCustomTamAnWarehouseName(
            payload.customWarehouseName,
            payload.email || target.email
          )
        : oldWarehouse;

    if (isSingleWhAccount && nextWarehouse && nextWarehouse !== oldWarehouse) {
      setWarehouses((prev) => {
        const replaced = prev.map((w) => (w === oldWarehouse ? nextWarehouse : w));
        return replaced.includes(nextWarehouse) ? replaced : [...replaced, nextWarehouse];
      });
      setProducts((prev) =>
        prev.map((p) =>
          p.warehouseName === oldWarehouse
            ? { ...p, warehouseName: nextWarehouse, updatedAt: nowIso }
            : p
        )
      );
      setSales((prev) =>
        prev.map((s) =>
          s.warehouseName === oldWarehouse
            ? { ...s, warehouseName: nextWarehouse, updatedAt: nowIso }
            : s
        )
      );
      setImports((prev) =>
        prev.map((i) =>
          i.warehouseName === oldWarehouse
            ? { ...i, warehouseName: nextWarehouse, updatedAt: nowIso }
            : i
        )
      );
      setReceiptVouchers((prev) =>
        prev.map((rv) =>
          rv.warehouseName === oldWarehouse
            ? { ...rv, warehouseName: nextWarehouse, updatedAt: nowIso }
            : rv
        )
      );
      setPaymentVouchers((prev) =>
        prev.map((pv) =>
          pv.warehouseName === oldWarehouse
            ? { ...pv, warehouseName: nextWarehouse, updatedAt: nowIso }
            : pv
        )
      );
      setCustomers((prev) =>
        prev.map((c) =>
          c.warehouseName === oldWarehouse
            ? { ...c, warehouseName: nextWarehouse, updatedAt: nowIso }
            : c
        )
      );
      setSuppliers((prev) =>
        prev.map((sp) =>
          sp.warehouseName === oldWarehouse
            ? { ...sp, warehouseName: nextWarehouse }
            : sp
        )
      );
      setSavedVouchers((prev) =>
        prev.map((vc) =>
          vc.warehouseName === oldWarehouse
            ? { ...vc, warehouseName: nextWarehouse, updatedAt: nowIso }
            : vc
        )
      );
      setAuditLogs((prev) =>
        prev.map((log) =>
          log.warehouseName === oldWarehouse
            ? { ...log, warehouseName: nextWarehouse }
            : log
        )
      );
    }

    const nextPasswordHash = payload.newPassword
      ? await hashPassword(payload.newPassword, target.uid)
      : target.password;

    const updatedProfileTarget: StaffMember = {
      ...target,
      displayName: payload.displayName || target.displayName,
      phone: payload.phone || target.phone,
      email: payload.email || target.email,
      password: nextPasswordHash,
      assignedWarehouse: nextWarehouse,
      updatedAt: nowIso,
    };
    setStaffList((prev) =>
      prev.map((s) =>
        s.uid === payload.uid
          ? updatedProfileTarget
          : isSingleWhAccount && nextWarehouse !== oldWarehouse && s.assignedWarehouse === oldWarehouse
          ? { ...s, assignedWarehouse: nextWarehouse, updatedAt: nowIso }
          : s
      )
    );
    if (isGoogleAuthenticated) {
      void upsertRealtimeUserDirectoryProfile(updatedProfileTarget);
    }
    recordAuditLog({
      actionCategory: 'update',
      targetEntity: 'staff',
      targetCode: `@${target.username}`,
      warehouseName: nextWarehouse,
      summary: `Cập nhật hồ sơ cá nhân @${target.username}${
        nextWarehouse !== oldWarehouse
          ? ` & Đổi tên hiển thị kho: "${oldWarehouse}" → "${nextWarehouse}"`
          : ''
      }`,
      details: `Họ tên: ${payload.displayName || target.displayName} · Gmail: ${
        payload.email || target.email
      } · Kho quản lý: ${nextWarehouse}${
        payload.newPassword ? ' · Đã cập nhật mật khẩu mới' : ''
      }`,
    });
    showToast(
      `Đã lưu hồ sơ cá nhân cho @${target.username} · Kho hiển thị: ${nextWarehouse}!`
    );
    return {
      ok: true,
      message: `Đã cập nhật hồ sơ cá nhân & tên hiển thị kho (${nextWarehouse}) cho tài khoản @${target.username} thành công!`,
    };
  };

  const handleChangeStaffPassword = async (
    uid: string,
    currentPass: string,
    newPass: string
  ): Promise<{ ok: boolean; message: string }> => {
    const target = staffList.find((s) => s.uid === uid);
    if (!target) return { ok: false, message: 'Không tìm thấy tài khoản.' };
    if (isHashedPassword(target.password)) {
      const okOld = await verifyPassword(currentPass, target.password, target.uid);
      if (!okOld) {
        return { ok: false, message: 'Mật khẩu hiện tại không đúng.' };
      }
    } else if (!currentPass) {
      return { ok: false, message: 'Vui lòng nhập mật khẩu hiện tại.' };
    }
    const nowIso = new Date().toISOString();
    const hashed = await hashPassword(newPass, target.uid);
    setStaffList((prev) =>
      prev.map((s) => (s.uid === uid ? { ...s, password: hashed, updatedAt: nowIso } : s))
    );
    showToast(`Đã đổi mật khẩu mới thành công cho tài khoản @${target.username}!`);
    return {
      ok: true,
      message: `Đã cập nhật mật khẩu mới thành công cho tài khoản @${target.username}!`,
    };
  };

  const handleCreateStaffAccount = async (payload: {
    username: string;
    password: string;
    displayName: string;
    phone: string;
    email: string;
    role: UserRole;
    positionRole: StaffPositionRole;
    permissions: StaffFunctionalPermission[];
    assignedWarehouse: string;
  }): Promise<{ ok: boolean; message: string }> => {
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
    const newUid = `staff_${Date.now()}`;
    const hashedPassword = await hashPassword(payload.password, newUid);
    const created: StaffMember = {
      uid: newUid,
      username: payload.username,
      password: hashedPassword,
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
    if (isGoogleAuthenticated) {
      void upsertRealtimeUserDirectoryProfile(created);
    }
    recordAuditLog({
      actionCategory: 'permission',
      targetEntity: 'staff',
      targetCode: `@${created.username}`,
      warehouseName: created.assignedWarehouse,
      summary: `Cấp tài khoản nhân sự mới @${created.username} (${created.displayName})`,
      details: `Vai trò: ${getPositionRoleLabel(created.positionRole)} · Kho: ${
        created.assignedWarehouse
      } · Quyền [X]: ${(created.permissions || []).join(', ')}`,
      snapshotData: JSON.stringify({ ...created, password: '' }),
    });
    showToast(
      `Đã tạo tài khoản @${created.username} (${getPositionRoleLabel(
        created.positionRole
      )}) — Kho: ${created.assignedWarehouse}`
    );
    return {
      ok: true,
      message: `Đã cấp tài khoản @${created.username} · Vai trò: ${getPositionRoleLabel(
        created.positionRole
      )} · Kho quản lý: ${created.assignedWarehouse}`,
    };
  };

  const handleUpdateStaffWarehouse = (uid: string, warehouseName: string) => {
    if (!canAccountCreateStaff(currentStaff)) {
      showToast(`Chỉ Quản lý chính (${ADMIN_BACKUP_EMAIL}) mới có quyền đổi phân quyền kho.`);
      return;
    }
    if (warehouseName === 'Tất cả kho') {
      handleUpdateStaffMultiWarehouses(uid, [], true);
      return;
    }
    handleUpdateStaffMultiWarehouses(uid, [warehouseName], false);
  };

  const handleUpdateStaffMultiWarehouses = (
    uid: string,
    selectedWarehouses: string[],
    grantAllWarehouses: boolean
  ) => {
    if (!canAccountCreateStaff(currentStaff)) {
      showToast(
        `Chỉ Quản lý chính (${ADMIN_BACKUP_EMAIL}) mới có quyền cấp quyền quản lý nhiều kho.`
      );
      return;
    }
    const target = staffList.find((s) => s.uid === uid);
    if (!target || canAccountCreateStaff(target)) return;

    const nowIso = new Date().toISOString();
    const cleanedWhs = dedupeWarehouseNames(selectedWarehouses);
    const isMultiGrant = grantAllWarehouses || cleanedWhs.length >= 2;
    const primaryWarehouseName = grantAllWarehouses
      ? 'Tất cả kho'
      : cleanedWhs[0] || target.assignedWarehouse || warehouses[0] || 'Tâm An Mỹ Ngãi';

    // Map each granted warehouse (accent- & case-insensitively!) to ALL its workspace owner UID(s)
    // so RTDB rules & Firebase Storage hydration grant exact read/write scope
    const ownerUidsMap: Record<string, boolean> =
      isMultiGrant && !grantAllWarehouses
        ? resolveDesignatedOwnerUidsForWarehouses({
            targetUid: uid,
            selectedWarehouses: cleanedWhs,
            staffList,
            workspacesMap: adminWorkspacesMapRef.current,
            adminSummaries: adminWorkspaceSummaries,
            records: [
              ...products,
              ...customers,
              ...suppliers,
              ...sales,
              ...imports,
              ...receiptVouchers,
              ...paymentVouchers,
              ...savedVouchers,
              ...stockAdjustments,
            ],
          })
        : {};

    const basePerms =
      target.permissions && target.permissions.length > 0
        ? [...target.permissions]
        : getIndependentWarehouseFullPermissions();

    let nextPerms: StaffFunctionalPermission[];
    let nextPositionRole: StaffPositionRole = target.positionRole || 'warehouse_manager';
    if (grantAllWarehouses) {
      nextPositionRole = 'deputy_general_manager';
      nextPerms = Array.from(
        new Set<StaffFunctionalPermission>([
          ...basePerms,
          'manage_all_warehouses',
          'edit_delete_vouchers',
        ])
      );
    } else if (cleanedWhs.length >= 2) {
      nextPositionRole = 'warehouse_manager';
      nextPerms = Array.from(
        new Set<StaffFunctionalPermission>([
          ...basePerms.filter((p) => p !== 'manage_all_warehouses'),
          'manage_single_warehouse',
          'edit_delete_vouchers',
        ])
      );
    } else {
      nextPositionRole =
        target.positionRole === 'deputy_general_manager'
          ? 'warehouse_manager'
          : target.positionRole || 'warehouse_manager';
      // STRICT RULE: Single-warehouse accounts CANNOT edit or delete saved invoices/vouchers
      nextPerms = basePerms.filter(
        (p) => p !== 'edit_delete_vouchers' && p !== 'manage_all_warehouses'
      );
    }

    const resolvedRole: UserRole =
      isMultiGrant && nextPerms.includes('edit_delete_vouchers') ? 'manager' : 'staff';

    const updatedStaff: StaffMember = {
      ...target,
      role: resolvedRole,
      positionRole: nextPositionRole,
      permissions: nextPerms,
      assignedWarehouse: primaryWarehouseName,
      assignedWarehouses: !grantAllWarehouses && cleanedWhs.length >= 2 ? cleanedWhs : undefined,
      multiWarehouseGrantedByAdmin: isMultiGrant,
      assignedOwnerUids:
        !grantAllWarehouses && cleanedWhs.length >= 2 ? ownerUidsMap : undefined,
      updatedAt: nowIso,
    };

    setStaffList((prev) => prev.map((s) => (s.uid === uid ? updatedStaff : s)));
    if (uid === currentStaff.uid) {
      setRole(resolvedRole);
    }
    if (isGoogleAuthenticated) {
      void upsertRealtimeUserDirectoryProfile(updatedStaff);
    }

    const whSummaryLabel = grantAllWarehouses
      ? 'Tất cả kho (Phó quản lý tổng)'
      : cleanedWhs.length >= 2
      ? `${cleanedWhs.length} kho: ${cleanedWhs.join(', ')}`
      : primaryWarehouseName;

    recordAuditLog({
      actionCategory: 'permission',
      targetEntity: 'staff',
      targetCode: `@${target.username}`,
      warehouseName: primaryWarehouseName,
      summary: isMultiGrant
        ? `Cấp quyền quản lý nhiều kho & Sửa/Xóa cho @${target.username} (${whSummaryLabel})`
        : `Đổi phân quyền kho đơn cho @${target.username} sang "${primaryWarehouseName}" (Khóa Sửa/Xóa phiếu)`,
      details: `Phạm vi kho mới: ${whSummaryLabel} · Quyền Sửa/Xóa phiếu: ${
        isMultiGrant ? 'ĐƯỢC CẤP' : 'ĐÃ KHÓA (chỉ cấp cho TK quản lý nhiều kho)'
      }`,
      snapshotData: JSON.stringify(target),
    });

    showToast(
      isMultiGrant
        ? `Đã cấp quyền quản lý nhiều kho (${whSummaryLabel}) & mở quyền Sửa/Xóa phiếu cho @${target.username}!`
        : `Đã đặt @${target.username} quản lý 1 kho "${primaryWarehouseName}" (khóa quyền Sửa/Xóa phiếu).`
    );
  };

  const handleUpdateStaffPermissions = (
    uid: string,
    positionRole: StaffPositionRole,
    permissions: StaffFunctionalPermission[],
    assignedWarehouse: string,
    assignedWarehouses?: string[]
  ) => {
    if (!canAccountCreateStaff(currentStaff)) {
      showToast(`Chỉ Quản lý chính (${ADMIN_BACKUP_EMAIL}) mới có quyền phân quyền cho tài khoản.`);
      return;
    }
    const target = staffList.find((s) => s.uid === uid);
    const nowIso = new Date().toISOString();

    const effectiveMultiWhs =
      assignedWarehouses !== undefined ? assignedWarehouses : target?.assignedWarehouses;
    const cleanedMultiWhs = dedupeWarehouseNames(effectiveMultiWhs || []);
    const isAllWhs =
      positionRole === 'primary_manager' ||
      positionRole === 'deputy_general_manager' ||
      assignedWarehouse === 'Tất cả kho' ||
      permissions.includes('manage_all_warehouses');
    const hasMultiWhGrant = isAllWhs || cleanedMultiWhs.length >= 2;

    // STRICT RULE: Only Primary Admin & accounts granted Multi-Warehouse Management can hold edit_delete_vouchers
    const sanitizedPermissions = hasMultiWhGrant
      ? permissions
      : permissions.filter((p) => p !== 'edit_delete_vouchers' && p !== 'manage_all_warehouses');

    const resolvedRole: UserRole =
      positionRole === 'primary_manager' ||
      (hasMultiWhGrant &&
        (isAllWhs || sanitizedPermissions.includes('edit_delete_vouchers')))
        ? 'manager'
        : 'staff';

    const ownerUidsMap: Record<string, boolean> | undefined =
      !isAllWhs && cleanedMultiWhs.length >= 2
        ? resolveDesignatedOwnerUidsForWarehouses({
            targetUid: uid,
            selectedWarehouses: cleanedMultiWhs,
            staffList,
            workspacesMap: adminWorkspacesMapRef.current,
            adminSummaries: adminWorkspaceSummaries,
            records: [
              ...products,
              ...customers,
              ...suppliers,
              ...sales,
              ...imports,
              ...receiptVouchers,
              ...paymentVouchers,
              ...savedVouchers,
              ...stockAdjustments,
            ],
          })
        : undefined;

    const finalAssignedWh = isAllWhs ? 'Tất cả kho' : cleanedMultiWhs[0] || assignedWarehouse;

    setStaffList((prev) =>
      prev.map((s) =>
        s.uid === uid
          ? {
              ...s,
              role: resolvedRole,
              positionRole,
              permissions: sanitizedPermissions,
              assignedWarehouse: finalAssignedWh,
              assignedWarehouses: !isAllWhs && cleanedMultiWhs.length >= 2 ? cleanedMultiWhs : undefined,
              multiWarehouseGrantedByAdmin: hasMultiWhGrant,
              assignedOwnerUids: ownerUidsMap,
              updatedAt: nowIso,
            }
          : s
      )
    );
    if (uid === currentStaff.uid) {
      setRole(resolvedRole);
    }
    if (target) {
      if (isGoogleAuthenticated) {
        void upsertRealtimeUserDirectoryProfile({
          ...target,
          role: resolvedRole,
          positionRole,
          permissions: sanitizedPermissions,
          assignedWarehouse: finalAssignedWh,
          assignedWarehouses: !isAllWhs && cleanedMultiWhs.length >= 2 ? cleanedMultiWhs : undefined,
          multiWarehouseGrantedByAdmin: hasMultiWhGrant,
          assignedOwnerUids: ownerUidsMap,
          updatedAt: nowIso,
        });
      }
      recordAuditLog({
        actionCategory: 'permission',
        targetEntity: 'staff',
        targetCode: `@${target.username}`,
        warehouseName: finalAssignedWh,
        summary: `Cập nhật phân quyền [X] cho @${target.username} (${target.displayName})`,
        details: `Vai trò: ${getPositionRoleLabel(
          positionRole
        )} · Kho: ${
          !isAllWhs && cleanedMultiWhs.length >= 2 ? cleanedMultiWhs.join(', ') : finalAssignedWh
        } · Quyền [X] được cấp (${sanitizedPermissions.length}): ${sanitizedPermissions.join(', ')}`,
        snapshotData: JSON.stringify(target),
      });
    }
    showToast(
      !hasMultiWhGrant && permissions.includes('edit_delete_vouchers')
        ? 'Đã lưu phân quyền! Lưu ý: Quyền Sửa/Xóa chỉ cấp cho tài khoản được phân quyền quản lý nhiều kho.'
        : 'Quản lý chính đã lưu phân quyền [X] vai trò & chức năng cho tài khoản!'
    );
  };

  const handleResetStaffPasswordByManager = async (uid: string, newPass: string) => {
    if (!canAccountCreateStaff(currentStaff)) return;
    const nowIso = new Date().toISOString();
    const hashed = await hashPassword(newPass, uid);
    setStaffList((prev) =>
      prev.map((s) => (s.uid === uid ? { ...s, password: hashed, updatedAt: nowIso } : s))
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
      if (isGoogleAuthenticated) {
        void upsertRealtimeUserDirectoryProfile({
          ...target,
          active: !target.active,
          updatedAt: new Date().toISOString(),
        });
      }
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
    const isScopedWarehouseUser = !canFilterMultiWarehouses;
    return buildBackupSnapshotPayload({
      fileName: defaultName,
      exportedByEmail: currentStaff.email || ADMIN_BACKUP_EMAIL,
      exportedAt: nowIso.slice(0, 16).replace('T', ' '),
      warehouses: isScopedWarehouseUser ? [currentStaff.assignedWarehouse] : warehouses,
      customerGroups,
      productCategories,
      receiptGroups,
      paymentGroups,
      products: isScopedWarehouseUser ? visibleProducts : products,
      customers: isScopedWarehouseUser ? visibleCustomers : customers,
      suppliers: isScopedWarehouseUser ? visibleSuppliers : suppliers,
      sales: isScopedWarehouseUser ? visibleSales : sales,
      imports: isScopedWarehouseUser ? visibleImports : imports,
      receiptVouchers: isScopedWarehouseUser ? visibleReceiptVouchers : receiptVouchers,
      paymentVouchers: isScopedWarehouseUser ? visiblePaymentVouchers : paymentVouchers,
      savedVouchers: isScopedWarehouseUser ? visibleSavedVouchers : savedVouchers,
      stockAdjustments: isScopedWarehouseUser ? visibleStockAdjustments : stockAdjustments,
      staffList: isScopedWarehouseUser ? [currentStaff] : staffList,
      auditLogs: isScopedWarehouseUser ? visibleAuditLogs : auditLogs,
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
      const activeUid = auth.currentUser?.uid || currentStaff.uid;
      const fallbackEntry: BackupEntry = {
        id: `bk_local_${Date.now()}`,
        fileName: `VTNN_TamAn_Backup_${new Date().toISOString().slice(0, 10)}.json`,
        driveFileId: `local_${Date.now()}`,
        targetEmail: ADMIN_BACKUP_EMAIL,
        triggerType: 'manual',
        recordCount: products.length + customers.length + sales.length + imports.length,
        auditLogCount: auditLogs.length,
        ownerId: activeUid,
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
      await deleteBackupFileFromDrive(backup.driveFileId, backup.id);
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
    if (!canViewAuditHistory(currentStaff) && !accessScope.canAccessBackupHistory) {
      showToast('Tài khoản của bạn không có quyền tải tệp sao lưu về máy tính.');
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
    if (!canViewAuditHistory(currentStaff) && !accessScope.canAccessBackupHistory) {
      showToast('Tài khoản của bạn không có quyền khôi phục dữ liệu từ tệp sao lưu.');
      return;
    }
    if (Array.isArray(payload.warehouses) && payload.warehouses.length > 0) {
      setWarehouses(payload.warehouses);
    }
    if (Array.isArray(payload.customerGroups) && payload.customerGroups.length > 0) {
      setCustomerGroups(payload.customerGroups);
    }
    if (Array.isArray(payload.productCategories) && payload.productCategories.length > 0) {
      setProductCategories(payload.productCategories);
    }
    if (Array.isArray(payload.products)) {
      setProducts(payload.products);
      payload.products.forEach((p) => {
        void syncProductToFirestore(p, true);
      });
    }
    if (Array.isArray(payload.customers)) {
      setCustomers(payload.customers);
      payload.customers.forEach((c) => {
        void syncCustomerToFirestore(c, true);
      });
    }
    const missingSet = new Set(payload.missingCollections || []);
    if (Array.isArray(payload.suppliers) && !missingSet.has('suppliers')) {
      setSuppliers(payload.suppliers);
    }
    if (Array.isArray(payload.sales)) {
      setSales(payload.sales);
      payload.sales.forEach((s) => {
        void syncSaleToFirestore(s, true);
      });
    }
    if (Array.isArray(payload.imports)) {
      setImports(payload.imports);
      payload.imports.forEach((imp) => {
        void syncImportToFirestore(imp, true);
      });
    }
    if (Array.isArray(payload.receiptGroups) && payload.receiptGroups.length > 0) {
      setReceiptGroups(payload.receiptGroups);
    }
    if (Array.isArray(payload.paymentGroups) && payload.paymentGroups.length > 0) {
      setPaymentGroups(payload.paymentGroups);
    }
    if (Array.isArray(payload.receiptVouchers) && !missingSet.has('receiptVouchers')) {
      setReceiptVouchers(payload.receiptVouchers);
    }
    if (Array.isArray(payload.paymentVouchers) && !missingSet.has('paymentVouchers')) {
      setPaymentVouchers(payload.paymentVouchers);
    }
    if (Array.isArray(payload.savedVouchers) && !missingSet.has('savedVouchers')) {
      setSavedVouchers(payload.savedVouchers);
    }
    if (Array.isArray(payload.stockAdjustments) && !missingSet.has('stockAdjustments')) {
      setStockAdjustments(payload.stockAdjustments);
    }
    if (isAdminAccount && Array.isArray(payload.staffList) && payload.staffList.length > 0) {
      setStaffList(payload.staffList);
    }

    const restoreAuditEntry = createAuditLogEntry({
      actor: currentStaff,
      category: 'backup_restore',
      targetEntity: 'backup',
      targetCode: `Backup_${payload.exportedAt.slice(0, 10)}`,
      warehouseName: currentStaff.assignedWarehouse,
      actionTitle: `Khôi phục & Đăng tải dữ liệu từ tệp sao lưu (${payload.exportedAt})`,
      details: `Đã phục hồi: ${payload.warehouses?.length || warehouses.length} kho, ${payload.products.length} vật tư, ${payload.customers.length} khách hàng, ${payload.sales.length} đơn bán, ${payload.imports.length} phiếu nhập và ${payload.auditLogs.length} bản ghi lịch sử thao tác.`,
    });

    const mergedLogs = [
      restoreAuditEntry,
      ...(Array.isArray(payload.auditLogs) ? payload.auditLogs : []),
    ];
    setAuditLogs(mergedLogs);
    showToast(
      `Đã đăng tải và khôi phục thành công toàn bộ dữ liệu (${payload.warehouses?.length || warehouses.length} kho, ${payload.products.length} vật tư, ${payload.customers.length} khách hàng, ${payload.sales.length} đơn bán, ${payload.imports.length} phiếu nhập)!`
    );
  };

  const handleRestoreDeletedRecordFromAudit = (audit: AuditLogEntry) => {
    if (!canViewAuditHistory(currentStaff) && !accessScope.canAccessBackupHistory) {
      showToast('Tài khoản của bạn không có quyền khôi phục dữ liệu từ lịch sử thao tác.');
      return;
    }
    if (!audit.snapshotData) {
      showToast('Bản ghi lịch sử này không có dữ liệu gốc để khôi phục.');
      return;
    }
    try {
      const nowIso = new Date().toISOString();
      const parsed = JSON.parse(audit.snapshotData);
      if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string') {
        unmarkDeletedRecord(parsed.id);
      }
      if (audit.targetEntity === 'sale') {
        const restoredSale = { ...(parsed as SaleTransaction), updatedAt: nowIso };
        const existingSale = sales.find((s) => s.id === restoredSale.id);
        const nextSales = [restoredSale, ...sales.filter((s) => s.id !== restoredSale.id)];
        setSales(nextSales);
        const deltas = computeSaleEditStockDeltas(
          existingSale || { productId: restoredSale.productId, quantity: 0, giftQuantity: 0 },
          restoredSale
        );
        if (Object.keys(deltas).length > 0) {
          setProducts((prev) =>
            prev.map((p) => {
              const delta = deltas[p.id];
              return delta
                ? { ...p, stock: Math.max(0, p.stock + delta), updatedAt: nowIso }
                : p;
            })
          );
        }
        setCustomers((prev) => reconcileCustomersFromSales(prev, nextSales, nowIso).customers);
      } else if (audit.targetEntity === 'import') {
        const restoredImp = { ...(parsed as ImportTransaction), updatedAt: nowIso };
        const existingImp = imports.find((i) => i.id === restoredImp.id);
        setImports((prev) => [restoredImp, ...prev.filter((i) => i.id !== restoredImp.id)]);
        const qtyDelta = restoredImp.quantity - (existingImp?.quantity || 0);
        if (qtyDelta !== 0) {
          setProducts((prev) =>
            prev.map((p) =>
              p.id === restoredImp.productId
                ? { ...p, stock: Math.max(0, p.stock + qtyDelta), updatedAt: nowIso }
                : p
            )
          );
        }
      } else if (audit.targetEntity === 'product') {
        const restoredProd = { ...(parsed as ProductItem), updatedAt: nowIso };
        setProducts((prev) => {
          const filtered = prev.filter((p) => p.id !== restoredProd.id);
          return [restoredProd, ...filtered];
        });
      } else if (audit.targetEntity === 'customer') {
        const restoredCust = { ...(parsed as CustomerProfile), updatedAt: nowIso };
        setCustomers((prev) => {
          const filtered = prev.filter((c) => c.id !== restoredCust.id);
          return [restoredCust, ...filtered];
        });
      } else if (audit.targetEntity === 'voucher') {
        const rec = parsed as Record<string, unknown>;
        if (typeof rec.voucherType === 'string') {
          const restoredVc = { ...(parsed as SavedVoucherRecord), updatedAt: nowIso };
          setSavedVouchers((prev) => [restoredVc, ...prev.filter((v) => v.id !== restoredVc.id)]);
        } else if (
          String(rec.id || '').startsWith('rv_') ||
          String(rec.voucherCode || '').startsWith('PT')
        ) {
          const restoredRv = { ...(parsed as CashReceiptVoucher), updatedAt: nowIso };
          setReceiptVouchers((prev) => [restoredRv, ...prev.filter((r) => r.id !== restoredRv.id)]);
        } else if (
          String(rec.id || '').startsWith('pv_') ||
          String(rec.voucherCode || '').startsWith('PC')
        ) {
          const restoredPv = { ...(parsed as CashPaymentVoucher), updatedAt: nowIso };
          setPaymentVouchers((prev) => [restoredPv, ...prev.filter((p) => p.id !== restoredPv.id)]);
        } else {
          const restoredVc = { ...(parsed as SavedVoucherRecord), updatedAt: nowIso };
          setSavedVouchers((prev) => [restoredVc, ...prev.filter((v) => v.id !== restoredVc.id)]);
        }
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

  const handleExecuteFiscalYearCloseAndCleanup = (
    fiscalYear: number,
    autoDownloadBackup: boolean
  ) => {
    if (!canViewAuditHistory(currentStaff) && !accessScope.canAccessBackupHistory) {
      showToast('Tài khoản của bạn không có quyền chốt sổ năm báo cáo tài chính.');
      return;
    }

    const nowIso = new Date().toISOString();
    const backupFileName = `VTNN_TamAn_ChotSoNam_${fiscalYear}_BeforeCleanup_${nowIso.slice(0, 10)}.json`;
    const preCleanupPayload = buildCurrentBackupPayload(backupFileName);

    const backupEntry: BackupEntry = {
      id: `bk_fiscal_${fiscalYear}_${Date.now()}`,
      fileName: backupFileName,
      driveFileId: `local_fiscal_${fiscalYear}_${Date.now()}`,
      targetEmail: currentStaff.email || ADMIN_BACKUP_EMAIL,
      triggerType: 'manual',
      recordCount: preCleanupPayload.recordCount,
      auditLogCount: visibleAuditLogs.length,
      ownerId: currentStaff.uid,
      createdAt: nowIso.slice(0, 16).replace('T', ' '),
      status: 'completed',
      snapshotPayload: preCleanupPayload,
    };
    setBackups((prev) => [backupEntry, ...prev]);

    if (autoDownloadBackup) {
      handleDownloadBackupFile(backupEntry);
    }

    const isScopedSingleWh = !canFilterMultiWarehouses && lockedWarehouse;

    if (isScopedSingleWh) {
      // Scope fiscal year close strictly to this user's independent warehouse
      const otherWhProducts = products.filter((p) => p.warehouseName !== lockedWarehouse);
      const otherWhCustomers = customers.filter((c) => c.warehouseName !== lockedWarehouse);
      const otherWhSuppliers = suppliers.filter((sp) => sp.warehouseName !== lockedWarehouse);
      const otherWhSales = sales.filter((s) => s.warehouseName !== lockedWarehouse);
      const otherWhImports = imports.filter((i) => i.warehouseName !== lockedWarehouse);
      const otherWhReceipts = receiptVouchers.filter((r) => r.warehouseName !== lockedWarehouse);
      const otherWhPayments = paymentVouchers.filter((p) => p.warehouseName !== lockedWarehouse);
      const otherWhSavedVouchers = savedVouchers.filter((v) => v.warehouseName !== lockedWarehouse);

      const result = executeFiscalYearCloseAndCleanup({
        fiscalYear,
        products: visibleProducts,
        customers: visibleCustomers,
        suppliers: visibleSuppliers,
        sales: visibleSales,
        imports: visibleImports,
        receiptVouchers: visibleReceiptVouchers,
        paymentVouchers: visiblePaymentVouchers,
        savedVouchers: visibleSavedVouchers,
        nowIso,
      });

      setProducts([...result.remainingProducts, ...otherWhProducts]);
      setCustomers([...result.updatedCustomers, ...otherWhCustomers]);
      setSuppliers([...result.updatedSuppliers, ...otherWhSuppliers]);
      setSales([...result.remainingSales, ...otherWhSales]);
      setImports([...result.remainingImports, ...otherWhImports]);
      setReceiptVouchers([...result.remainingReceiptVouchers, ...otherWhReceipts]);
      setPaymentVouchers([...result.remainingPaymentVouchers, ...otherWhPayments]);
      setSavedVouchers([...result.remainingSavedVouchers, ...otherWhSavedVouchers]);

      recordAuditLog({
        actionCategory: 'delete',
        targetEntity: 'backup',
        targetCode: `ChotSo_Nam_${fiscalYear}_Sang_${result.preview.newFiscalYear}`,
        warehouseName: lockedWarehouse,
        summary: `Chốt sổ năm ${fiscalYear} tại kho ${lockedWarehouse}: Đã xóa ${result.preview.totalRecordsToDelete} chứng từ cũ đã tất toán & chuyển tồn lưu sang năm ${result.preview.newFiscalYear}`,
      });

      showToast(
        `Đã chốt sổ năm ${fiscalYear} cho kho ${lockedWarehouse}: Xóa ${result.preview.totalRecordsToDelete} chứng từ cũ đã tất toán và đưa Tồn kho + Công nợ còn lại sang năm ${result.preview.newFiscalYear}!`
      );
      return;
    }

    const result = executeFiscalYearCloseAndCleanup({
      fiscalYear,
      products,
      customers,
      suppliers,
      sales,
      imports,
      receiptVouchers,
      paymentVouchers,
      savedVouchers,
      nowIso,
    });

    setProducts(result.remainingProducts);
    setCustomers(result.updatedCustomers);
    setSuppliers(result.updatedSuppliers);
    setSales(result.remainingSales);
    setImports(result.remainingImports);
    setReceiptVouchers(result.remainingReceiptVouchers);
    setPaymentVouchers(result.remainingPaymentVouchers);
    setSavedVouchers(result.remainingSavedVouchers);

    recordAuditLog({
      actionCategory: 'delete',
      targetEntity: 'backup',
      targetCode: `ChotSo_Nam_${fiscalYear}_Sang_${result.preview.newFiscalYear}`,
      warehouseName: 'Tất cả kho',
      summary: `Chốt sổ năm báo cáo tài chính ${fiscalYear}: Đã xóa ${result.preview.totalRecordsToDelete} chứng từ cũ đã tất toán & chuyển tồn lưu sang năm tài chính mới ${result.preview.newFiscalYear}`,
      details: `Đã xóa: ${result.preview.settledSalesToDelete.length} HĐ bán đã hết nợ, ${result.preview.settledImportsToDelete.length} phiếu nhập đã hết nợ NCC, ${result.preview.receiptVouchersToDelete.length} phiếu thu, ${result.preview.paymentVouchersToDelete.length} phiếu chi, ${result.preview.savedVouchersToDelete.length} chứng từ in. Đã chuyển tồn lưu qua năm ${result.preview.newFiscalYear}: ${result.preview.carriedInventoryCount} vật tư tồn kho (${formatVND(result.preview.carriedInventoryTotalValue)}), nợ KH còn lại ${formatVND(result.preview.carriedCustomerDebtTotal)} (${result.preview.carriedCustomerDebtCount} HĐ), nợ NCC còn lại ${formatVND(result.preview.carriedSupplierDebtTotal)} (${result.preview.carriedSupplierDebtCount} phiếu).`,
    });

    showToast(
      `Đã chốt sổ năm ${fiscalYear}: Xóa ${result.preview.totalRecordsToDelete} chứng từ cũ đã tất toán và đưa toàn bộ Tồn kho + Công nợ còn lại sang năm tài chính mới ${result.preview.newFiscalYear}!`
    );
  };

  const handleExecuteFullApplicationDataWipe = (autoDownloadBackup: boolean) => {
    if (!canViewAuditHistory(currentStaff) && !accessScope.canAccessBackupHistory) {
      showToast('Tài khoản của bạn không có quyền xóa dữ liệu.');
      return;
    }

    const nowIso = new Date().toISOString();
    const backupFileName = `VTNN_TamAn_FullBackup_BeforeWipe_${nowIso.slice(0, 10)}.json`;
    const preWipePayload = buildCurrentBackupPayload(backupFileName);

    const backupEntry: BackupEntry = {
      id: `bk_fullwipe_${Date.now()}`,
      fileName: backupFileName,
      driveFileId: `local_fullwipe_${Date.now()}`,
      targetEmail: currentStaff.email || ADMIN_BACKUP_EMAIL,
      triggerType: 'manual',
      recordCount: preWipePayload.recordCount,
      auditLogCount: visibleAuditLogs.length,
      ownerId: currentStaff.uid,
      createdAt: nowIso.slice(0, 16).replace('T', ' '),
      status: 'completed',
      snapshotPayload: preWipePayload,
    };
    setBackups((prev) => [backupEntry, ...prev]);

    if (autoDownloadBackup) {
      handleDownloadBackupFile(backupEntry);
    }

    const isScopedSingleWh = !canFilterMultiWarehouses && lockedWarehouse;
    allowEmptyWorkspaceWriteRef.current = true;
    forceStorageSyncRef.current = true;
    const nowWipeIso = new Date().toISOString();
    if (isScopedSingleWh) {
      const idsToTombstone = [
        ...products.filter((p) => p.warehouseName === lockedWarehouse).map((x) => x.id),
        ...customers.filter((c) => c.warehouseName === lockedWarehouse).map((x) => x.id),
        ...suppliers.filter((sp) => sp.warehouseName === lockedWarehouse).map((x) => x.id),
        ...sales.filter((s) => s.warehouseName === lockedWarehouse).map((x) => x.id),
        ...imports.filter((i) => i.warehouseName === lockedWarehouse).map((x) => x.id),
        ...receiptVouchers.filter((r) => r.warehouseName === lockedWarehouse).map((x) => x.id),
        ...paymentVouchers.filter((p) => p.warehouseName === lockedWarehouse).map((x) => x.id),
        ...savedVouchers.filter((v) => v.warehouseName === lockedWarehouse).map((x) => x.id),
        ...stockAdjustments.filter((a) => a.warehouseName === lockedWarehouse).map((x) => x.id),
      ];
      markRecordsDeleted(idsToTombstone, nowWipeIso);
      // Wipe only the current user's independent warehouse data, keeping other warehouses completely intact
      setProducts((prev) => prev.filter((p) => p.warehouseName !== lockedWarehouse));
      setCustomers((prev) => prev.filter((c) => c.warehouseName !== lockedWarehouse));
      setSuppliers((prev) => prev.filter((sp) => sp.warehouseName !== lockedWarehouse));
      setSales((prev) => prev.filter((s) => s.warehouseName !== lockedWarehouse));
      setImports((prev) => prev.filter((i) => i.warehouseName !== lockedWarehouse));
      setReceiptVouchers((prev) => prev.filter((r) => r.warehouseName !== lockedWarehouse));
      setPaymentVouchers((prev) => prev.filter((p) => p.warehouseName !== lockedWarehouse));
      setSavedVouchers((prev) => prev.filter((v) => v.warehouseName !== lockedWarehouse));
      setStockAdjustments((prev) => prev.filter((a) => a.warehouseName !== lockedWarehouse));
      recordAuditLog({
        actionCategory: 'delete',
        targetEntity: 'backup',
        targetCode: `XOA_DU_LIEU_KHO_${lockedWarehouse}`,
        warehouseName: lockedWarehouse,
        summary: `Xóa làm sạch toàn bộ dữ liệu kho độc lập "${lockedWarehouse}" (Đã lưu bản sao lưu ${backupFileName})`,
      });
      showToast(
        `Đã xóa làm sạch toàn bộ dữ liệu của kho "${lockedWarehouse}"! Các kho khác không bị ảnh hưởng.`
      );
      return;
    }

    const allWipedIds = [
      ...products.map((x) => x.id),
      ...customers.map((x) => x.id),
      ...suppliers.map((x) => x.id),
      ...sales.map((x) => x.id),
      ...imports.map((x) => x.id),
      ...receiptVouchers.map((x) => x.id),
      ...paymentVouchers.map((x) => x.id),
      ...savedVouchers.map((x) => x.id),
      ...stockAdjustments.map((x) => x.id),
    ];
    markRecordsDeleted(allWipedIds, nowWipeIso);
    const wiped = executeFullApplicationDataWipe({ staffList });
    setProducts(wiped.products);
    setCustomers(wiped.customers);
    setSuppliers(wiped.suppliers);
    setSales(wiped.sales);
    setImports(wiped.imports);
    setReceiptVouchers(wiped.receiptVouchers);
    setPaymentVouchers(wiped.paymentVouchers);
    setSavedVouchers(wiped.savedVouchers);
    setStockAdjustments([]);
    setStaffList(wiped.preservedStaffList);

    recordAuditLog({
      actionCategory: 'delete',
      targetEntity: 'backup',
      targetCode: 'XOA_TOAN_BO_DU_LIEU',
      warehouseName: 'Tất cả kho',
      summary: `Quản lý chính (${ADMIN_BACKUP_EMAIL}) đã xóa làm sạch toàn bộ dữ liệu ứng dụng (Đã lưu bản sao lưu ${backupFileName} trước khi xóa)`,
      details: `Đã xóa toàn bộ dữ liệu vật tư, khách hàng, nhà cung cấp, hóa đơn xuất/nhập và phiếu thu/chi. Có thể khôi phục nguyên trạng từ tệp ${backupFileName}.`,
    });

    showToast(
      `Đã xóa làm sạch toàn bộ dữ liệu ứng dụng! Bản sao lưu trước khi xóa (${backupFileName}) đã được lưu trong danh sách Sao lưu.`
    );
  };

  const handleGoogleLogin = async (
    requestedRole: UserRole,
    preferredWarehouseName?: string
  ): Promise<{ ok: boolean; message: string }> => {
    if (preferredWarehouseName) {
      pendingRegistrationRef.current = {
        email: '',
        displayName: '',
        customWarehouseName: preferredWarehouseName,
      };
    }
    try {
      const result = await googleSignInWithRole(requestedRole);
      if (result && result.user && result.user.email) {
        setIsGoogleAuthenticated(true);
        setCloudSyncStatus(canWriteToFirestore(result.user) ? 'synced' : 'unverified');
        return handleGoogleLoginByEmail(
          result.user.email,
          result.user.displayName || undefined,
          result.user.uid,
          preferredWarehouseName
        );
      }
      pendingRegistrationRef.current = null;
      return {
        ok: false,
        message:
          'Không nhận được địa chỉ Gmail từ tài khoản Google đã chọn. Vui lòng chọn một tài khoản Gmail hợp lệ.',
      };
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/unauthorized-domain') {
        const host = typeof window !== 'undefined' ? window.location.hostname : 'vtnntaman.com';
        return {
          ok: false,
          message: `Tên miền "${host}" chưa được cấp phép trong Firebase Console -> Authentication -> Settings -> Authorized domains. Vui lòng thêm "${host}" vào Firebase hoặc đăng nhập bằng Email/Tên đăng nhập.`,
        };
      }
      if (code === 'auth/popup-blocked') {
        return {
          ok: false,
          message:
            'Trình duyệt đang chặn cửa sổ bật lên (Pop-up) của Google Sign-In. Vui lòng cho phép Pop-up và thử lại.',
        };
      }
      return {
        ok: false,
        message:
          'Chưa hoàn tất chọn tài khoản Google hoặc cửa sổ đăng nhập đã đóng. Vui lòng chọn một tài khoản Google trong cửa sổ bật lên để đăng nhập.',
      };
    }
  };

  const handleManualCloudSync = async () => {
    const fbUser = auth.currentUser;
    if (!fbUser || isManualCloudSyncing) return;
    setIsManualCloudSyncing(true);
    try {
      const isPrimary = isCurrentUserAdmin(fbUser);
      const isDesignatedMultiWh = !isPrimary && Boolean(designatedMultiWhOwnerUidsKey);
      const isDesignatedAllWh = isDesignatedMultiWh && designatedMultiWhOwnerUidsKey === '__ALL__';
      const designatedOwnerUidList =
        isDesignatedMultiWh && !isDesignatedAllWh
          ? designatedMultiWhOwnerUidsKey.split('::')[0].split(',').filter(Boolean)
          : [];
      const activeUid = isPrimary ? PRIMARY_ADMIN_UID : fbUser.uid;
      const nowIso = new Date().toISOString();
      const cur = latestWorkspaceRef.current;
      const settingsObj = {
        warehouses: cur.warehouses,
        customerGroups: cur.customerGroups,
        productCategories: cur.productCategories,
        receiptGroups: cur.receiptGroups,
        paymentGroups: cur.paymentGroups,
        notificationPrefs: cur.notificationPrefs,
        ...(cur.bankQrConfig ? { bankQrConfig: cur.bankQrConfig } : {}),
        productNoteTemplates: cur.productNoteTemplates,
        ...(cur.deletedRecords.length > 0 ? { deletedRecords: cur.deletedRecords } : {}),
        autoDailyBackupEnabled: cur.autoDailyBackupEnabled,
      };

      let finalVisibleProducts = visibleProducts;
      let finalVisibleSales = visibleSales;
      let finalVisibleCustomers = visibleCustomers;

      if (isPrimary || isDesignatedMultiWh) {
        // 1. PULL fresh data from BOTH RTDB AND Firebase Storage first (tombstone-safe: deleted records NEVER resurrect!)
        const summaries = await readAdminWorkspacesIndexFromFirebaseStorage();
        const grantedWhKeys = new Set(
          dedupeWarehouseNames(currentStaff.assignedWarehouses || [])
            .map((w) => normalizeWarehouseKey(w))
            .filter(Boolean)
        );
        const pullOwnerUidSet = new Set<string>(
          isPrimary || isDesignatedAllWh
            ? [...Array.from(rtdbKnownOwnerUidsRef.current), ...summaries.map((s) => s.uid)]
            : designatedOwnerUidList
        );
        const storageTargets: Array<{
          uid: string;
          email?: string | null;
          assignedWarehouse?: string | null;
        }> = Array.from(pullOwnerUidSet).map((u) => ({
          uid: u,
          email: u === activeUid ? fbUser.email || currentStaff.email : undefined,
          assignedWarehouse: u === activeUid ? currentStaff.assignedWarehouse : undefined,
        }));

        for (const sum of summaries) {
          if (!sum?.uid) continue;
          const sumWhKey = normalizeWarehouseKey(sum.assignedWarehouse);
          if (
            isPrimary ||
            isDesignatedAllWh ||
            pullOwnerUidSet.has(sum.uid) ||
            (Boolean(sumWhKey) && grantedWhKeys.has(sumWhKey))
          ) {
            pullOwnerUidSet.add(sum.uid);
            storageTargets.push({
              uid: sum.uid,
              email: sum.email,
              assignedWarehouse: sum.assignedWarehouse,
            });
          }
        }

        const [freshRtdbMap, freshStorageMap] = await Promise.all([
          readRealtimeWorkspacesOnce(
            isPrimary || isDesignatedAllWh ? '__ALL__' : Array.from(pullOwnerUidSet),
            isDesignatedAllWh
          ),
          readDesignatedWorkspacesFromFirebaseStorage(storageTargets),
        ]);

        // Update caches & combine RTDB + Storage per UID using tombstone-safe mergeWorkspacePayloads
        Object.entries(freshRtdbMap).forEach(([uid, val]) => {
          adminWorkspacesMapRef.current[uid] = val;
        });
        Object.entries(freshStorageMap).forEach(([uid, ws]) => {
          storageCachedWorkspaceRef.current[uid] = ws;
        });

        const combinedMap: Record<string, unknown> = {};
        const allPulledUids = new Set<string>([
          ...Object.keys(adminWorkspacesMapRef.current),
          ...Object.keys(freshStorageMap),
        ]);
        allPulledUids.forEach((uid) => {
          if (!isPrimary && !isDesignatedAllWh && !pullOwnerUidSet.has(uid)) return;
          const rtdbRaw = adminWorkspacesMapRef.current[uid];
          const storageWs = storageCachedWorkspaceRef.current[uid] || null;
          if (rtdbRaw && storageWs) {
            const normRtdb = normalizeWorkspaceFromRtdb(rtdbRaw, uid);
            combinedMap[uid] = mergeWorkspacePayloads(normRtdb, storageWs, uid) || rtdbRaw;
          } else if (rtdbRaw) {
            combinedMap[uid] = rtdbRaw;
          } else if (storageWs) {
            combinedMap[uid] = storageWs;
          }
        });

        let workingProducts = cur.products;
        let workingCustomers = cur.customers;
        let workingSuppliers = cur.suppliers;
        let workingSales = cur.sales;
        let workingImports = cur.imports;
        let workingRvs = cur.receiptVouchers;
        let workingPvs = cur.paymentVouchers;
        let workingSvs = cur.savedVouchers;
        let workingAdjs = cur.stockAdjustments;
        let workingLogs = cur.auditLogs;
        let workingBks = cur.backups;
        let workingWhs = cur.warehouses;
        let workingTombstones = cur.deletedRecords;

        if (Object.keys(combinedMap).length > 0) {
          const agg = aggregateAdminWorkspacesFromRtdb(combinedMap, rtdbUsersDirMapRef.current);
          workingTombstones = mergeDeletionTombstones(cur.deletedRecords, agg.deletedRecords);
          workingProducts = filterOutDeletedRecords(agg.products, workingTombstones);
          workingCustomers = filterOutDeletedRecords(agg.customers, workingTombstones);
          workingSuppliers = filterOutDeletedRecords(agg.suppliers, workingTombstones);
          workingSales = filterOutDeletedRecords(agg.sales, workingTombstones);
          workingImports = filterOutDeletedRecords(agg.imports, workingTombstones);
          workingRvs = filterOutDeletedRecords(agg.receiptVouchers, workingTombstones);
          workingPvs = filterOutDeletedRecords(agg.paymentVouchers, workingTombstones);
          workingSvs = filterOutDeletedRecords(agg.savedVouchers, workingTombstones);
          workingAdjs = filterOutDeletedRecords(agg.stockAdjustments, workingTombstones);
          workingLogs = dedupeRecordsById([...agg.auditLogs]).slice(0, 500);
          workingBks = dedupeRecordsById([...agg.backups]);
          workingWhs = dedupeWarehouseNames([
            ...cur.warehouses,
            ...agg.warehouses,
            ...(currentStaff.assignedWarehouses || []),
          ]);

          Object.entries(agg.normalizedWorkspaces).forEach(([uid, normWs]) => {
            rtdbLastPayloadRef.current[uid] = normWs;
            rtdbKnownOwnerUidsRef.current.add(uid);
          });

          rtdbSuppressNextWriteRef.current = true;
          productsRef.current = workingProducts;
          setProducts(workingProducts);
          setCustomers(workingCustomers);
          setSuppliers(workingSuppliers);
          setSales(workingSales);
          setImports(workingImports);
          setReceiptVouchers(workingRvs);
          setPaymentVouchers(workingPvs);
          setSavedVouchers(workingSvs);
          setStockAdjustments(workingAdjs);
          setAuditLogs(workingLogs);
          setBackups(workingBks);
          setDeletedRecords(workingTombstones);
          setWarehouses(workingWhs);

          finalVisibleProducts = filterRecordsBySelectedWarehouses(
            workingProducts,
            currentStaff,
            workingWhs,
            selectedFilterWarehouses
          );
          finalVisibleSales = filterRecordsBySelectedWarehouses(
            workingSales,
            currentStaff,
            workingWhs,
            selectedFilterWarehouses
          );
          finalVisibleCustomers = filterRecordsBySelectedWarehouses(
            workingCustomers,
            currentStaff,
            workingWhs,
            selectedFilterWarehouses
          );
        }

        // 2. PUSH authoritative merged state (including any deletions) back ONLY to permitted writable buckets
        const writableUidSet =
          isPrimary || isDesignatedAllWh ? null : new Set(designatedOwnerUidList);
        const allowDeletionWipe =
          allowEmptyWorkspaceWriteRef.current || workingTombstones.length > 0;
        const partitioned = partitionAdminStateByWorkspace({
          products: workingProducts,
          customers: workingCustomers,
          suppliers: workingSuppliers,
          sales: workingSales,
          imports: workingImports,
          receiptVouchers: workingRvs,
          paymentVouchers: workingPvs,
          savedVouchers: workingSvs,
          stockAdjustments: workingAdjs,
          auditLogs: workingLogs,
          backups: workingBks,
          settings: {
            ...settingsObj,
            warehouses: workingWhs,
            ...(workingTombstones.length > 0 ? { deletedRecords: workingTombstones } : {}),
          },
          staffList: cur.staffList,
          knownOwnerUids: Array.from(rtdbKnownOwnerUidsRef.current),
          adminUid: isPrimary ? PRIMARY_ADMIN_UID : activeUid,
          nowIso,
          existingMetaByUid: buildExistingMetaByUid(),
        });
        await Promise.allSettled(
          Object.entries(partitioned).map(async ([bucketUid, bucketPayload]) => {
            if (writableUidSet && !writableUidSet.has(bucketUid)) return;
            const prevSnapshot = rtdbLastPayloadRef.current[bucketUid] ?? null;
            if (isDestructiveEmptyWorkspaceOverwrite(prevSnapshot, bucketPayload, allowDeletionWipe)) {
              return;
            }
            const ok = await writeRealtimeWorkspace(
              bucketUid,
              bucketPayload,
              prevSnapshot,
              allowDeletionWipe,
              {
                forceStorage: true,
                allowMultiWarehouseManager: isDesignatedMultiWh,
              }
            );
            if (ok) {
              rtdbLastPayloadRef.current[bucketUid] = bucketPayload;
              rtdbLastFingerprintsRef.current[bucketUid] = computeWorkspaceFingerprint(bucketPayload);
            }
          })
        );
        if (isPrimary && adminWorkspaceSummaries.length > 0) {
          await writeAdminWorkspacesIndexToFirebaseStorage(adminWorkspaceSummaries, true);
        }
      } else {
        // Single-warehouse user: pull freshest RTDB + Storage first (tombstone-safe), then mirror back
        const [freshRtdbMap, storageWs] = await Promise.all([
          readRealtimeWorkspacesOnce([activeUid]),
          readWorkspaceFromFirebaseStorage({
            uid: activeUid,
            email: fbUser.email || currentStaff.email,
            assignedWarehouse: currentStaff.assignedWarehouse,
          }),
        ]);
        const rtdbWs = freshRtdbMap[activeUid]
          ? normalizeWorkspaceFromRtdb(freshRtdbMap[activeUid], activeUid)
          : null;
        if (storageWs) {
          storageCachedWorkspaceRef.current[activeUid] = storageWs;
        }
        const localPayload: RtdbWorkspacePayload = {
          meta: {
            ownerUid: activeUid,
            ownerEmail: currentStaff.email || fbUser.email || '',
            ownerDisplayName: currentStaff.displayName || fbUser.displayName || '',
            assignedWarehouse: currentStaff.assignedWarehouse || 'Tâm An Mỹ Ngãi',
            updatedAt: nowIso,
            updatedByUid: activeUid,
            schemaVersion: 1,
          },
          products: cur.products,
          customers: cur.customers,
          suppliers: cur.suppliers,
          sales: cur.sales,
          imports: cur.imports,
          receiptVouchers: cur.receiptVouchers,
          paymentVouchers: cur.paymentVouchers,
          savedVouchers: cur.savedVouchers,
          stockAdjustments: cur.stockAdjustments,
          auditLogs: cur.auditLogs.slice(0, 500),
          backups: cur.backups.map((b) => ({ ...b, snapshotPayload: undefined })),
          settings: settingsObj,
        };
        const cloudMerged = mergeWorkspacePayloads(rtdbWs, storageWs, activeUid);
        const currentCount = countWorkspaceBusinessRecords(localPayload);
        const finalPayload =
          currentCount === 0 &&
          cur.deletedRecords.length === 0 &&
          cloudMerged &&
          countWorkspaceBusinessRecords(cloudMerged) > 0
            ? cloudMerged
            : localPayload;

        if (finalPayload !== localPayload) {
          rtdbSuppressNextWriteRef.current = true;
          productsRef.current = finalPayload.products;
          setProducts(finalPayload.products);
          setCustomers(finalPayload.customers);
          setSuppliers(finalPayload.suppliers);
          setSales(finalPayload.sales);
          setImports(finalPayload.imports);
          setReceiptVouchers(finalPayload.receiptVouchers);
          setPaymentVouchers(finalPayload.paymentVouchers);
          setSavedVouchers(finalPayload.savedVouchers);
          setStockAdjustments(finalPayload.stockAdjustments || []);
          if (finalPayload.settings?.deletedRecords?.length) {
            setDeletedRecords(finalPayload.settings.deletedRecords);
          }
          finalVisibleProducts = finalPayload.products;
          finalVisibleSales = finalPayload.sales;
          finalVisibleCustomers = finalPayload.customers;
        }

        const prevSnapshot = rtdbLastPayloadRef.current[activeUid] ?? null;
        const allowSingleWipe =
          allowEmptyWorkspaceWriteRef.current || cur.deletedRecords.length > 0;
        const ok = await writeRealtimeWorkspace(
          activeUid,
          finalPayload,
          prevSnapshot,
          allowSingleWipe,
          {
            forceStorage: true,
          }
        );
        if (ok) {
          rtdbLastPayloadRef.current[activeUid] = finalPayload;
          rtdbLastFingerprintsRef.current[activeUid] = computeWorkspaceFingerprint(finalPayload);
        }
      }

      showToast(
        `Đã đồng bộ tức thì với Firebase Realtime DB & Firebase Storage (${finalVisibleProducts.length} vật tư, ${finalVisibleSales.length} đơn bán, ${finalVisibleCustomers.length} khách hàng)!`
      );
    } finally {
      setIsManualCloudSyncing(false);
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
      todayVietnamDate,
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
    {
      id: 'receipt_vouchers',
      label: 'Nhật ký Phiếu thu',
      icon: <ArrowDownCircle className="w-4 h-4" />,
    },
    {
      id: 'payment_vouchers',
      label: 'Nhật ký Phiếu chi',
      icon: <ArrowUpCircle className="w-4 h-4" />,
    },
    { id: 'vouchers', label: 'Phiếu In & Xuất PDF', icon: <Printer className="w-4 h-4" /> },
    {
      id: 'staff_accounts',
      label: canAccountCreateStaff(currentStaff)
        ? 'Quản trị & Phân quyền Kho'
        : 'Hồ sơ & Tên Kho cá nhân',
      icon: <ShieldCheck className="w-4 h-4" />,
    },
    {
      id: 'reports',
      label: 'Báo cáo',
      icon: <FileSpreadsheet className="w-4 h-4" />,
    },
    {
      id: 'gemini_chat',
      label: 'Trợ lý A.I',
      icon: <Sparkles className="w-4 h-4" />,
    },
    {
      id: 'internal_chat',
      label: 'Chat nội bộ',
      icon: <MessageCircle className="w-4 h-4" />,
    },
    {
      id: 'backup_history',
      label: 'Sao lưu & Lịch sử',
      icon: <History className="w-4 h-4" />,
    },
  ];

  // Filter navigation tabs strictly by the logged-in account's real-time [X] permissions
  // STRICT RULE: "Sao lưu & Lịch sử" (backup_history) is ONLY visible to the 1 primary admin account (trannhat1205@gmail.com / Gu6OYdsdiWbRvbEINqaWZXj3LV83)
  const navItems = useMemo(
    () =>
      allNavItems.filter((item) => {
        if (item.id === 'backup_history' && !canAccountCreateStaff(currentStaff)) {
          return false;
        }
        return accessScope.allowedTabs.includes(item.id);
      }),
    [accessScope, currentStaff]
  );

  const activeNavLabel = navItems.find((n) => n.id === activeTab)?.label || 'Tổng quan';

  if (isAuthChecking) {
    return (
      <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-8 py-7 flex flex-col items-center gap-3 text-center">
          <img
            src="/assets/logo-taman.png?v=3"
            alt="Logo VTNN Tâm An"
            className="w-14 h-14 object-contain rounded-xl border border-emerald-200 p-1.5 bg-emerald-50"
          />
          <div className="text-sm font-bold text-slate-900">VTNN Tâm An</div>
          <div className="text-xs text-slate-500">Đang kiểm tra phiên đăng nhập an toàn...</div>
        </div>
      </div>
    );
  }

  // When not logged in, render ONLY the clean, centered outer login screen (no sidebar, no top bar)
  if (!isSessionLoggedIn) {
    return (
      <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col items-center justify-center p-4">
        <InitialLoginScreenPortal
          staffList={staffList}
          currentStaff={currentStaff}
          isGoogleAuthenticated={isGoogleAuthenticated}
          currentUserEmail={currentUserEmail}
          onGoogleManagerLogin={(customWh) => handleGoogleLogin('manager', customWh)}
          onGoogleLoginByEmail={handleGoogleLoginByEmail}
          onLoginStaff={handleLoginStaff}
          onSignUpStaff={handleSignUpStaff}
          onUpdateStaffProfile={handleUpdateStaffProfile}
          isSessionLoggedIn={isSessionLoggedIn}
          onLogout={handleLogoutApp}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-slate-50 text-slate-900 flex flex-col lg:flex-row">
      {/* Desktop Sidebar (264px width) — Sticky on vertical scroll */}
      <aside className="hidden lg:flex lg:flex-col lg:w-[264px] lg:shrink-0 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto bg-white border-r border-slate-200 justify-between">
        <div>
          {/* Brand Lockup with Attached VTNN Tâm An Logo */}
          <div className="p-5 border-b border-slate-200 flex items-center gap-3">
            <img
              src="/assets/logo-taman.png?v=3"
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
            <div className="flex items-center justify-between gap-1.5">
              <div className="font-semibold text-slate-900 truncate">
                {isSessionLoggedIn ? currentStaff.displayName : 'Chưa đăng nhập'}
              </div>
              {isAdminAccount ? (
                <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-700 text-white rounded shrink-0">
                  Tất cả kho
                </span>
              ) : canFilterMultiWarehouses ? (
                <span className="px-1.5 py-0.5 text-[10px] font-bold bg-teal-700 text-white rounded shrink-0">
                  {currentStaff.assignedWarehouse === 'Tất cả kho' ||
                  currentStaff.permissions?.includes('manage_all_warehouses')
                    ? 'Tất cả kho'
                    : `${allowedWarehouses.length} Kho`}
                </span>
              ) : (
                <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-700 text-white rounded shrink-0">
                  1 Kho
                </span>
              )}
            </div>
            <div className="text-[11px] text-emerald-700 font-medium truncate">
              {isSessionLoggedIn
                ? isAdminAccount
                  ? 'Quản lý tất cả các kho · Đầy đủ chức năng'
                  : canFilterMultiWarehouses
                  ? `Quản lý ${allowedWarehouses.length} kho · Quyền Sửa/Xóa`
                  : 'Quản lý 1 kho độc lập · Đầy đủ chức năng'
                : 'Vui lòng đăng nhập tài khoản'}
            </div>
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <div className="flex items-center gap-1 text-emerald-800 font-semibold min-w-0">
                <Warehouse className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  {isAdminAccount || canFilterMultiWarehouses
                    ? `Kho: ${activeWarehouseLabel}`
                    : `Quản lý 1 kho: ${activeWarehouseLabel}`}
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
                  {item.id === 'internal_chat' && unreadChatCount > 0 && (
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                        isActive ? 'bg-white text-emerald-800' : 'bg-rose-600 text-white'
                      }`}
                    >
                      {unreadChatCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Auto-Storage & Account Role Footer */}
        <div className="p-4 border-t border-slate-200 space-y-3 bg-slate-50/60">
          {canViewAuditHistory(currentStaff) && (
            <div className="text-xs text-slate-600 space-y-1 pb-2 border-b border-slate-200">
              <div className="flex items-center gap-1.5 font-semibold text-emerald-800">
                <CloudCheck className="w-3.5 h-3.5 shrink-0" />
                <span>Lưu trữ tự động Firebase Storage</span>
              </div>
              <div className="font-mono text-[11px] text-slate-500 truncate">
                {ADMIN_BACKUP_EMAIL}
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
      <div className="flex-1 flex flex-col min-w-0 max-w-full">
        {/* Top Bar Contract: Always pinned at top & automatically balanced across Desktop, Tablet, and all Smartphones */}
        <header className="bg-white/95 backdrop-blur-xs border-b border-slate-200 sticky top-0 z-40 shadow-2xs w-full max-w-full">
          {/* Primary Row: Hamburger + Brand/Title on Left, Core Actions on Right */}
          <div className="px-2.5 sm:px-4 lg:px-6 py-2 sm:py-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1">
              <button
                type="button"
                onClick={() => setMobileMenuOpen((prev) => !prev)}
                aria-label="Mở menu điều hướng"
                className="lg:hidden p-1.5 text-slate-700 hover:text-slate-950 hover:bg-slate-100 rounded-lg border border-slate-200 shrink-0 transition-colors"
              >
                {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
              </button>

              <div className="flex items-center gap-1.5 text-xs sm:text-sm min-w-0">
                <span className="font-bold text-emerald-800 whitespace-nowrap shrink-0">
                  VTNN Tâm An
                </span>
                <span className="hidden xs:inline sm:inline text-slate-300 shrink-0" aria-hidden="true">
                  /
                </span>
                <span className="hidden xs:inline sm:inline font-semibold text-slate-900 truncate">
                  {activeNavLabel}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {/* Desktop/Tablet Live Firebase Storage & Realtime Database 1-Click Cloud Sync Button */}
              {isGoogleAuthenticated && (
                <button
                  type="button"
                  disabled={isManualCloudSyncing}
                  onClick={() => void handleManualCloudSync()}
                  title="Bấm để đồng bộ tức thì dữ liệu (kể cả dữ liệu đã xóa) lên Firebase Storage & Realtime Database"
                  className={`hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-semibold border whitespace-nowrap transition-colors shrink-0 ${
                    rtdbSyncState === 'live'
                      ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200'
                      : rtdbSyncState === 'connecting'
                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                      : 'bg-slate-100 text-slate-600 border-slate-200'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      rtdbSyncState === 'live'
                        ? 'bg-emerald-500'
                        : rtdbSyncState === 'connecting'
                        ? 'bg-amber-500'
                        : 'bg-slate-400'
                    }`}
                  />
                  <span>
                    {isManualCloudSyncing
                      ? 'Đang đồng bộ...'
                      : rtdbSyncState === 'live'
                      ? 'Realtime DB'
                      : rtdbSyncState === 'connecting'
                      ? 'Đang kết nối...'
                      : 'Ngoại tuyến'}
                  </span>
                </button>
              )}

              {/* Desktop/Tablet Multi-Warehouse Selector */}
              <div className="hidden md:block shrink-0">
                <MultiWarehouseFilterPopover
                  triggerId="desktop-multi-warehouse-filter"
                  allWarehouses={getStaffAllowedWarehouses(currentStaff, warehouses)}
                  selectedWarehouses={selectedFilterWarehouses}
                  onChangeSelectedWarehouses={(next) => {
                    setSelectedFilterWarehouses(next);
                  }}
                  canFilterMultiWarehouses={canFilterMultiWarehouses}
                  lockedWarehouseLabel={activeWarehouseLabel}
                />
              </div>

              {/* Staff / Warehouse Quick Switcher — ONLY for Primary Manager on XL Desktop */}
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
                  className="hidden 2xl:block px-2 py-1.5 text-xs font-semibold bg-slate-100 border border-slate-200 rounded-lg text-slate-800 max-w-[190px] truncate shrink-0"
                >
                  {staffList.map((st) => (
                    <option key={st.uid} value={st.uid}>
                      @{st.username} — {st.displayName} ({st.assignedWarehouse})
                    </option>
                  ))}
                </select>
              )}

              {/* Desktop/Tablet Install App (PWA) Trigger */}
              {!isStandaloneInstalled && (
                <button
                  type="button"
                  onClick={() => setIsPwaInstallModalOpen(true)}
                  title="Cài đặt VTNN Tâm An thành ứng dụng trên Điện thoại & Máy tính"
                  className="hidden md:flex px-2.5 py-1.5 lg:px-3 lg:py-2 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg transition-colors items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Smartphone className="w-3.5 h-3.5 shrink-0" />
                  <span>Cài App</span>
                </button>
              )}

              {/* Prominent Logout ("Thoát đăng nhập") Button */}
              <button
                type="button"
                onClick={handleLogoutApp}
                className="px-2 py-1.5 lg:px-3 lg:py-2 text-[11px] sm:text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 rounded-lg transition-colors flex items-center gap-1 sm:gap-1.5 whitespace-nowrap shrink-0"
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden xl:inline">Thoát đăng nhập</span>
                <span className="xl:hidden">Thoát</span>
              </button>

              {/* Push Notification Center Trigger */}
              <button
                type="button"
                onClick={() => setIsNotifDrawerOpen(true)}
                aria-label={`Thông báo đẩy (${unreadNotifCount} chưa đọc)`}
                className="px-2 py-1.5 lg:px-3 lg:py-2 text-[11px] sm:text-xs font-semibold text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors flex items-center gap-1 sm:gap-1.5 whitespace-nowrap shrink-0"
              >
                <Bell className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                <span className="hidden lg:inline">Thông báo</span>
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
                  className="px-2.5 py-1.5 lg:px-3.5 lg:py-2 text-[11px] sm:text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-2xs"
                >
                  <span className="sm:hidden">+ Đơn bán</span>
                  <span className="hidden sm:inline">+ Tạo đơn bán</span>
                </button>
              )}
            </div>
          </div>

          {/* Mobile Smart Sub-Bar (< md): Balances Cloud Sync, Install App, Screen Label & Active Warehouse Filter across all smartphone widths */}
          <div className="md:hidden px-2.5 py-1.5 bg-slate-50/95 border-t border-slate-200/80 flex items-center justify-between gap-1.5 text-[11px]">
            <div className="flex items-center gap-1.5 min-w-0 shrink-0">
              {isGoogleAuthenticated ? (
                <button
                  type="button"
                  disabled={isManualCloudSyncing}
                  onClick={() => void handleManualCloudSync()}
                  title="Bấm để đồng bộ tức thì dữ liệu (kể cả dữ liệu đã xóa) lên Firebase Storage & Realtime Database"
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold border whitespace-nowrap transition-colors shrink-0 ${
                    rtdbSyncState === 'live'
                      ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200'
                      : rtdbSyncState === 'connecting'
                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                      : 'bg-slate-100 text-slate-600 border-slate-200'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      rtdbSyncState === 'live'
                        ? 'bg-emerald-500'
                        : rtdbSyncState === 'connecting'
                        ? 'bg-amber-500'
                        : 'bg-slate-400'
                    }`}
                  />
                  <span>
                    {isManualCloudSyncing
                      ? 'Đồng bộ...'
                      : rtdbSyncState === 'live'
                      ? 'Realtime DB'
                      : rtdbSyncState === 'connecting'
                      ? 'Kết nối...'
                      : 'Ngoại tuyến'}
                  </span>
                </button>
              ) : (
                <span className="font-semibold text-slate-800 truncate">{activeNavLabel}</span>
              )}

              {!isStandaloneInstalled && (
                <button
                  type="button"
                  onClick={() => setIsPwaInstallModalOpen(true)}
                  title="Cài đặt VTNN Tâm An thành ứng dụng trên Điện thoại & Máy tính"
                  className="px-2 py-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg transition-colors inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                >
                  <Smartphone className="w-3 h-3 shrink-0" />
                  <span>Cài App</span>
                </button>
              )}
            </div>

            <div className="min-w-0 flex items-center justify-end">
              <MultiWarehouseFilterPopover
                triggerId="mobile-multi-warehouse-filter"
                allWarehouses={getStaffAllowedWarehouses(currentStaff, warehouses)}
                selectedWarehouses={selectedFilterWarehouses}
                onChangeSelectedWarehouses={(next) => {
                  setSelectedFilterWarehouses(next);
                }}
                canFilterMultiWarehouses={canFilterMultiWarehouses}
                lockedWarehouseLabel={activeWarehouseLabel}
                compact
              />
            </div>
          </div>

          {/* Offline Queue Status & Auto-Sync Banner (Desktop & Mobile) */}
          {(!isOnline || offlineQueue.length > 0) && (
            <div
              className={`px-3 sm:px-5 py-2 border-t flex flex-wrap items-center justify-between gap-2 text-xs ${
                !isOnline
                  ? 'bg-amber-50 border-amber-200 text-amber-950'
                  : 'bg-sky-50 border-sky-200 text-sky-950'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <WifiOff className="w-4 h-4 shrink-0 text-amber-700" />
                <span className="font-semibold">
                  {!isOnline
                    ? `Đang ở chế độ Ngoại tuyến — Hàng đợi an toàn trên máy (${offlineQueue.length} thao tác chờ đồng bộ khi có mạng)`
                    : `Có ${offlineQueue.length} thao tác ngoại tuyến đang chờ đồng bộ lên Firebase`}
                </span>
                {offlineQueue[0] && (
                  <span className="hidden lg:inline text-[11px] opacity-80 truncate max-w-[340px]">
                    · Gần nhất: {offlineQueue[0].label}
                  </span>
                )}
              </div>
              <button
                type="button"
                disabled={!isOnline || isFlushingOfflineQueue}
                onClick={handleFlushOfflineQueueNow}
                className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 text-white inline-flex items-center gap-1 whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`w-3 h-3 ${isFlushingOfflineQueue ? 'animate-spin' : ''}`} />
                <span>{isFlushingOfflineQueue ? 'Đang đồng bộ...' : 'Đồng bộ ngay'}</span>
              </button>
            </div>
          )}

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
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.id === 'internal_chat' && unreadChatCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-bold">
                      {unreadChatCount}
                    </span>
                  )}
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

        {/* Cloud Sync / Email Verification Notice Banner */}
        {cloudSyncStatus === 'unverified' && (
          <div className="mx-4 sm:mx-6 mt-3 px-4 py-2.5 bg-amber-50 border border-amber-300 text-amber-900 text-xs rounded-lg flex flex-wrap items-center justify-between gap-2">
            <span>
              Dữ liệu đang được lưu an toàn tại máy. Vui lòng xác minh hộp thư Gmail để bật đồng bộ Cloud Firestore.
            </span>
            <button
              type="button"
              onClick={async () => {
                const res = await resendVerificationEmail();
                showToast(res.message);
              }}
              className="px-3 py-1 font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-md whitespace-nowrap"
            >
              Gửi lại email xác minh
            </button>
          </div>
        )}

        {/* Toast Notification Banner with 10s Undo Action */}
        <InstallPwaModal
          isOpen={isPwaInstallModalOpen}
          onClose={() => setIsPwaInstallModalOpen(false)}
          canPromptNativeInstall={Boolean(deferredInstallPrompt)}
          isStandaloneInstalled={isStandaloneInstalled}
          onTriggerNativeInstall={async () => {
            if (!deferredInstallPrompt) return;
            await deferredInstallPrompt.prompt();
            const choice = await deferredInstallPrompt.userChoice;
            if (choice.outcome === 'accepted') {
              setDeferredInstallPrompt(null);
              setIsPwaInstallModalOpen(false);
            }
          }}
        />
        {toastBanner && (
          <div
            role="status"
            className="fixed bottom-4 right-4 left-4 sm:left-auto sm:max-w-lg z-50 px-4 py-3 bg-slate-900 text-white text-xs font-medium rounded-xl shadow-xl border border-slate-700 flex items-center justify-between gap-3"
          >
            <span className="flex-1">{toastBanner}</span>
            {toastUndoAction && (
              <button
                type="button"
                onClick={() => {
                  const fn = toastUndoAction.onUndo;
                  setToastUndoAction(null);
                  fn();
                  showToast('Đã hoàn tác thao tác vừa rồi!');
                }}
                className="px-2.5 py-1 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-md shrink-0 transition-colors"
              >
                {toastUndoAction.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setToastBanner(null);
                setToastUndoAction(null);
              }}
              aria-label="Đóng thông báo nhanh"
              className="text-slate-400 hover:text-white shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Main Workspace Content Viewport */}
        <main className="flex-1 p-3 sm:p-6 max-w-[1400px] w-full mx-auto space-y-5 sm:space-y-6 overflow-x-hidden">
          {activeTab === 'dashboard' && (
            <div className="space-y-5 sm:space-y-6">
              {/* Brand Hero Banner + Admin / Single-Warehouse Status Indicator */}
              <div className="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3.5 sm:gap-4">
                <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                  <img
                    src="/assets/logo-taman.png?v=3"
                    alt="Logo Vật tư Nông nghiệp Tâm An"
                    referrerPolicy="no-referrer"
                    className="w-13 h-13 sm:w-16 sm:h-16 rounded-xl object-contain border border-slate-200 p-1 shrink-0 bg-white"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {isAdminAccount ? (
                        <span className="px-2.5 py-1 text-xs font-bold bg-emerald-700 text-white rounded-lg inline-flex items-center gap-1.5 leading-snug">
                          <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                          <span>Quản lý chính · Toàn bộ các kho</span>
                        </span>
                      ) : canFilterMultiWarehouses ? (
                        <span className="px-2.5 py-1 text-xs font-bold bg-teal-700 text-white rounded-lg inline-flex items-center gap-1.5 leading-snug break-words">
                          <Warehouse className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            Quản lý {allowedWarehouses.length} kho ({allowedWarehouses.join(', ')}) · Quyền Sửa/Xóa
                          </span>
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 text-xs font-bold bg-emerald-700 text-white rounded-lg inline-flex items-center gap-1.5 leading-snug break-words">
                          <Warehouse className="w-3.5 h-3.5 shrink-0" />
                          <span>Quản lý 1 kho: {currentStaff.assignedWarehouse}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (isAdminAccount || canFilterMultiWarehouses) {
                        setActiveTab('staff_accounts');
                      } else {
                        setQuickRenameSuffix(
                          extractCustomWarehouseSuffix(currentStaff.assignedWarehouse)
                        );
                        setQuickRenameWarehouseOpen(true);
                      }
                    }}
                    className="w-full sm:w-auto justify-center px-3.5 py-2 text-xs font-bold rounded-lg border transition-colors flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border-emerald-300"
                  >
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    <span className="truncate">
                      {isAdminAccount
                        ? 'Mở Bảng Phân Quyền Kho'
                        : canFilterMultiWarehouses
                        ? `Hồ sơ & Phạm vi ${allowedWarehouses.length} kho`
                        : `Đổi tên hiển thị kho (${currentStaff.assignedWarehouse})`}
                    </span>
                  </button>
                </div>
              </div>

              {/* Quick Warehouse Assignment Dashboard (Visible when Primary Manager Gu6OYdsdiWbRvbEINqaWZXj3LV83 is logged in) */}
              {isAdminAccount && (
                <div className="bg-white rounded-xl border border-emerald-200 overflow-hidden shadow-2xs">
                  <div className="px-3.5 sm:px-5 py-3 bg-emerald-50/80 border-b border-emerald-200 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                      <h2 className="text-xs sm:text-sm font-bold text-slate-900">
                        Bảng Phân Quyền Quản Lý Kho Cho Người Dùng
                      </h2>
                    </div>
                    <span className="text-[11px] font-mono text-emerald-900 bg-white px-2 py-0.5 rounded border border-emerald-200 font-semibold break-all">
                      UID: {PRIMARY_ADMIN_UID}
                    </span>
                  </div>
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                    {staffList.map((st) => {
                      const isRowAdmin = canAccountCreateStaff(st);
                      const rowMultiList = dedupeWarehouseNames(st.assignedWarehouses || []);
                      const isRowAllWh =
                        isRowAdmin ||
                        st.assignedWarehouse === 'Tất cả kho' ||
                        Boolean(st.permissions?.includes('manage_all_warehouses'));
                      return (
                        <div
                          key={`dash-admin-${st.uid}`}
                          className={`p-3 rounded-xl border flex flex-col justify-between gap-2 text-xs ${
                            isRowAdmin
                              ? 'bg-emerald-50/50 border-emerald-300'
                              : isRowAllWh || rowMultiList.length >= 2
                              ? 'bg-teal-50/40 border-teal-300'
                              : 'bg-slate-50/70 border-slate-200'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="font-bold text-slate-900 truncate">
                                {st.displayName}
                              </span>
                              <span
                                className={`px-1.5 py-0.5 text-[10px] font-bold rounded shrink-0 ${
                                  isRowAdmin
                                    ? 'bg-emerald-700 text-white'
                                    : isRowAllWh || rowMultiList.length >= 2
                                    ? 'bg-teal-700 text-white'
                                    : 'bg-emerald-100 text-emerald-900'
                                }`}
                              >
                                {isRowAdmin
                                  ? 'Tất cả kho'
                                  : isRowAllWh
                                  ? 'Tất cả · Sửa/Xóa'
                                  : rowMultiList.length >= 2
                                  ? `${rowMultiList.length} Kho · Sửa/Xóa`
                                  : '1 Kho'}
                              </span>
                            </div>
                            <div className="text-[11px] font-mono text-slate-500 truncate mt-0.5">
                              @{st.username} · {st.email}
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-200/80">
                            <span className="text-[11px] font-semibold text-slate-600 shrink-0">
                              Kho:
                            </span>
                            {isRowAdmin ? (
                              <span className="font-bold text-emerald-900">Tất cả kho</span>
                            ) : (
                              <select
                                aria-label={`Phân quyền kho cho ${st.username}`}
                                value={st.assignedWarehouse}
                                onChange={(e) => handleUpdateStaffWarehouse(st.uid, e.target.value)}
                                className="flex-1 min-w-0 px-2 py-1 text-xs font-bold bg-white border border-emerald-300 rounded-md text-emerald-950"
                              >
                                {warehouses.map((w) => (
                                  <option key={w} value={w}>
                                    {w}
                                  </option>
                                ))}
                                <option value="Tất cả kho">Tất cả kho</option>
                              </select>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

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
                    <span>{visibleCustomers.length} hồ sơ khách hàng</span>
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

              {/* Smart Business Analytics Panel (7-Day Revenue vs Gross Profit + Top 30d Products & Customers) */}
              <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <LayoutDashboard className="w-4 h-4 text-emerald-700 shrink-0" />
                      <span>Phân Tích Kinh Doanh Thông Minh (7 Ngày Qua &amp; Top 30 Ngày)</span>
                    </h2>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Doanh thu 7 ngày:{' '}
                      <strong className="font-mono text-slate-900">
                        {formatVND(dashboardAnalytics.totalRevenue)}
                      </strong>{' '}
                      · Lãi gộp 7 ngày:{' '}
                      <strong className="font-mono text-emerald-700">
                        {formatVND(dashboardAnalytics.totalGrossProfit)} ({dashboardAnalytics.grossMarginPct}%)
                      </strong>{' '}
                      · {dashboardAnalytics.totalOrders} đơn
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('reports')}
                    className="text-xs font-semibold text-emerald-700 hover:underline self-start sm:self-auto"
                  >
                    Mở Báo cáo &amp; BCTC chi tiết →
                  </button>
                </div>

                {/* 7-Day Revenue vs Gross Profit CSS Bar Chart */}
                {(() => {
                  const maxRev = Math.max(
                    1,
                    ...dashboardAnalytics.dailyPoints.map((d) =>
                      Math.max(d.revenue, d.grossProfit, 0)
                    )
                  );
                  return (
                    <div className="grid grid-cols-7 gap-2 items-end h-36 pt-4 px-2 pb-2 bg-slate-50/70 rounded-xl border border-slate-200/80">
                      {dashboardAnalytics.dailyPoints.map((pt) => {
                        const revPct = Math.max(
                          pt.revenue > 0 ? 8 : 2,
                          Math.round((pt.revenue / maxRev) * 100)
                        );
                        const profitPct = Math.max(
                          pt.grossProfit > 0 ? 8 : 2,
                          Math.round((Math.max(0, pt.grossProfit) / maxRev) * 100)
                        );
                        return (
                          <div
                            key={pt.dateStr}
                            title={`${pt.dateStr}: Doanh thu ${formatVND(pt.revenue)} | Lãi gộp ${formatVND(pt.grossProfit)} (${pt.orderCount} đơn)`}
                            className="flex flex-col items-center justify-end h-full gap-1"
                          >
                            <div className="flex items-end justify-center gap-1 w-full flex-1">
                              <div
                                style={{ height: `${revPct}%` }}
                                className="w-2.5 sm:w-4 bg-emerald-600 rounded-t-sm transition-all"
                              />
                              <div
                                style={{ height: `${profitPct}%` }}
                                className="w-2.5 sm:w-4 bg-amber-500 rounded-t-sm transition-all"
                              />
                            </div>
                            <span className="text-[10px] font-mono text-slate-600 whitespace-nowrap">
                              {pt.shortLabel}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 font-bold text-slate-800">
                      Top 5 Vật Tư Bán Chạy (30 ngày)
                    </div>
                    <div className="divide-y divide-slate-100">
                      {dashboardAnalytics.topProducts.length === 0 ? (
                        <div className="p-3 text-slate-500 text-center">
                          Chưa có giao dịch bán hàng trong 30 ngày gần nhất.
                        </div>
                      ) : (
                        dashboardAnalytics.topProducts.map((tp, idx) => (
                          <div key={`${tp.productId}-${idx}`} className="px-3.5 py-2 flex items-center justify-between gap-2">
                            <div className="min-w-0 truncate font-medium text-slate-900">
                              <span className="font-mono text-emerald-700 font-bold mr-1.5">#{idx + 1}</span>
                              {tp.productName}
                            </div>
                            <div className="text-right font-mono shrink-0">
                              <span className="font-bold text-slate-900">{formatVND(tp.revenue)}</span>
                              <span className="text-[10px] text-slate-500 ml-1.5">
                                ({tp.qtySold} {tp.unit})
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 font-bold text-slate-800">
                      Top 5 Khách Hàng Doanh Số Cao (30 ngày)
                    </div>
                    <div className="divide-y divide-slate-100">
                      {dashboardAnalytics.topCustomers.length === 0 ? (
                        <div className="p-3 text-slate-500 text-center">
                          Chưa có dữ liệu khách hàng trong 30 ngày gần nhất.
                        </div>
                      ) : (
                        dashboardAnalytics.topCustomers.map((tc, idx) => (
                          <div key={`${tc.customerName}-${idx}`} className="px-3.5 py-2 flex items-center justify-between gap-2">
                            <div className="min-w-0 truncate font-medium text-slate-900">
                              <span className="font-mono text-emerald-700 font-bold mr-1.5">#{idx + 1}</span>
                              {tc.customerName}
                            </div>
                            <div className="text-right font-mono shrink-0">
                              <span className="font-bold text-slate-900">{formatVND(tc.totalSpent)}</span>
                              <span className="text-[10px] text-slate-500 ml-1.5">({tc.orderCount} đơn)</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
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
                        Nhắc Hẹn Công Nợ Nhà Cung Cấp Đến Hạn
                      </h2>
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
                          todayVietnamDate,
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
                        Cảnh Báo Hàng Sắp Hết Trong Kho
                      </h2>
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
                    onClick={async () => {
                      const { exportPeriodicReportExcel } = await import('./utils/exportReports');
                      const file = exportPeriodicReportExcel({
                        periodLabel: getCurrentMonthRangeVietnam().label,
                        products: visibleProducts,
                        customers: visibleCustomers,
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
                    onClick={async () => {
                      const { exportPeriodicReportPDF } = await import('./utils/exportReports');
                      const file = exportPeriodicReportPDF({
                        periodLabel: getCurrentMonthRangeVietnam().label,
                        products: visibleProducts,
                        customers: visibleCustomers,
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

          <Suspense
            fallback={
              <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-xs text-slate-500">
                Đang tải mô-đun làm việc...
              </div>
            }
          >
          {isSessionLoggedIn && activeTab === 'sales' && (
            <SalesLogView
              products={visibleProducts}
              customers={visibleCustomers}
              sales={visibleSales}
              role={role}
              resetKey={saleFormResetKey}
              warehouses={allowedWarehouses}
              onAddWarehouse={handleAddWarehouse}
              lockedWarehouse={lockedWarehouse}
              customerGroups={customerGroups}
              onAddCustomerGroup={handleAddCustomerGroup}
              productCategories={productCategories}
              onAddProductCategory={handleAddProductCategory}
              preselectedCustomerId={preselectedCustomerId}
              onClearPreselectedCustomer={() => setPreselectedCustomerId(null)}
              onCreateSale={handleCreateSale}
              onCreateMultiItemSale={handleCreateMultiItemSale}
              bankQrConfig={bankQrConfig}
              onSaveBankQrConfig={handleSaveBankQrConfig}
              productNoteTemplates={productNoteTemplates}
              onSaveProductNoteTemplate={handleSaveProductNoteTemplate}
              onDeleteProductNoteTemplate={handleDeleteProductNoteTemplate}
              onBindProductNoteToProduct={handleBindProductNoteToProduct}
              onNotifyToast={showToast}
              onCreateCustomerInline={(data) => handleSaveCustomer(data)}
              onCreateProductInline={(data) => handleSaveProduct(data)}
              onImportSalesFromExcel={handleImportSalesFromExcel}
              onUpdateSale={handleUpdateSale}
              onDeleteSale={handleDeleteSale}
              onOpenDebtRecord={(recId) => {
                setFocusedDebtRecordId(recId);
                setActiveTab('debts');
              }}
              onRequestAddNewProductInImports={(keyword) => {
                setImportNewProductTrigger({
                  key: Date.now(),
                  initialName: (keyword || '').trim(),
                });
                setActiveTab('imports');
                scrollToTopOfPage();
                showToast('Đã chuyển sang Nhật ký Nhập hàng để thêm vật tư & lập phiếu nhập!');
              }}
            />
          )}

          {isSessionLoggedIn && activeTab === 'imports' && (
            <ImportLogView
              products={visibleProducts}
              customers={visibleCustomers}
              imports={visibleImports}
              suppliers={visibleSuppliers}
              role={role}
              warehouses={allowedWarehouses}
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
              newProductRedirectTrigger={importNewProductTrigger}
              onConsumeNewProductRedirect={() => setImportNewProductTrigger(null)}
            />
          )}

          {isSessionLoggedIn && activeTab === 'inventory' && (
            <InventoryView
              products={visibleProducts}
              customers={visibleCustomers}
              sales={visibleSales}
              imports={visibleImports}
              stockAdjustments={visibleStockAdjustments}
              role={role}
              warehouses={allowedWarehouses}
              onAddWarehouse={handleAddWarehouse}
              lockedWarehouse={lockedWarehouse}
              productCategories={productCategories}
              onAddProductCategory={handleAddProductCategory}
              onSaveProduct={handleSaveProduct}
              onDeleteProduct={handleDeleteProduct}
              onExecuteStocktake={handleExecuteStocktake}
              onImportProductsFromExcel={handleImportProductsFromExcel}
              onQuickRestock={(prodId) => {
                setPreselectedProductId(prodId);
                setActiveTab('imports');
              }}
              onRequestAddNewProductInImports={() => {
                setImportNewProductTrigger({ key: Date.now(), initialName: '' });
                setActiveTab('imports');
                scrollToTopOfPage();
              }}
              focusedProductId={focusedProductId}
              onClearFocusedProduct={() => setFocusedProductId(null)}
            />
          )}

          {isSessionLoggedIn && activeTab === 'customers' && (
            <CustomerModule
              customers={visibleCustomers}
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
              onSettleCustomerTotalDebtFifo={handleSettleCustomerTotalDebtFifo}
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
              customers={visibleCustomers}
              role={role}
              canAccessCustomerDebts={accessScope.canAccessCustomerDebts}
              canAccessSupplierDebts={accessScope.canAccessSupplierDebts}
              leadDays={notificationPrefs.leadDays}
              focusedRecordId={focusedDebtRecordId}
              onClearFocusedRecord={() => setFocusedDebtRecordId(null)}
              onCollectCustomerDebt={handleCollectCustomerDebt}
              onPaySupplierDebt={handlePaySupplierDebt}
              receiptGroups={receiptGroups}
              paymentGroups={paymentGroups}
              onSettleCustomerTotalDebtFifo={handleSettleCustomerTotalDebtFifo}
              onSettleSupplierTotalDebtFifo={handleSettleSupplierTotalDebtFifo}
              onImportDebtPaymentsFromExcel={handleImportDebtPaymentsFromExcel}
              onUpdateSale={handleUpdateSale}
              onDeleteSale={handleDeleteSale}
              onUpdateImport={handleUpdateImport}
              onDeleteImport={handleDeleteImport}
              storeName={lockedWarehouse || (selectedFilterWarehouses.length === 1 ? selectedFilterWarehouses[0] : 'VTNN Tâm An')}
              bankQrConfig={bankQrConfig}
              onSaveBankQrConfig={handleSaveBankQrConfig}
              onShowToast={showToast}
            />
          )}

          {isSessionLoggedIn && activeTab === 'receipt_vouchers' && (
            <ReceiptVoucherLogView
              receiptVouchers={visibleReceiptVouchers}
              receiptGroups={receiptGroups}
              onAddReceiptGroup={handleAddReceiptGroup}
              customers={visibleCustomers}
              customerGroups={customerGroups}
              onAddCustomerGroup={handleAddCustomerGroup}
              onAddCustomer={(input) =>
                handleSaveCustomer({
                  ...input,
                  code: `KH-00${customers.length + 1}`,
                  totalPurchased: 0,
                  totalDebt: 0,
                })
              }
              sales={visibleSales}
              warehouses={allowedWarehouses}
              selectedWarehouse={lockedWarehouse}
              onAddWarehouse={handleAddWarehouse}
              role={role}
              canEditDelete={accessScope.canEditDeleteVouchers}
              onCreateReceiptVoucher={handleCreateReceiptVoucher}
              onUpdateReceiptVoucher={handleUpdateReceiptVoucher}
              onDeleteReceiptVoucher={handleDeleteReceiptVoucher}
            />
          )}

          {isSessionLoggedIn && activeTab === 'payment_vouchers' && (
            <PaymentVoucherLogView
              paymentVouchers={visiblePaymentVouchers}
              paymentGroups={paymentGroups}
              onAddPaymentGroup={handleAddPaymentGroup}
              suppliers={visibleSuppliers}
              onAddSupplier={handleCreateSupplierInline}
              imports={visibleImports}
              warehouses={allowedWarehouses}
              selectedWarehouse={lockedWarehouse}
              onAddWarehouse={handleAddWarehouse}
              role={role}
              canEditDelete={accessScope.canEditDeleteVouchers}
              onCreatePaymentVoucher={handleCreatePaymentVoucher}
              onUpdatePaymentVoucher={handleUpdatePaymentVoucher}
              onDeletePaymentVoucher={handleDeletePaymentVoucher}
            />
          )}

          {isSessionLoggedIn && activeTab === 'vouchers' && (
            <VoucherPrintCenter
              sales={visibleSales}
              imports={visibleImports}
              customers={visibleCustomers}
              products={visibleProducts}
              role={role}
              savedVouchers={visibleSavedVouchers}
              onSaveVoucher={handleSaveVoucher}
              onDeleteVoucher={handleDeleteVoucher}
              currentStaffName={currentStaff.displayName}
              lockedWarehouse={lockedWarehouse}
              bankQrConfig={bankQrConfig}
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
              onAddWarehouse={handleAddWarehouse}
              onChangePassword={handleChangeStaffPassword}
              onCreateStaffAccount={handleCreateStaffAccount}
              onUpdateStaffWarehouse={handleUpdateStaffWarehouse}
              onUpdateStaffMultiWarehouses={handleUpdateStaffMultiWarehouses}
              onUpdateStaffPermissions={handleUpdateStaffPermissions}
              onResetStaffPasswordByManager={handleResetStaffPasswordByManager}
              onToggleStaffActive={handleToggleStaffActive}
              onUpdateStaffProfile={handleUpdateStaffProfile}
              isSessionLoggedIn={isSessionLoggedIn}
              onLogout={handleLogoutApp}
              rtdbSyncState={rtdbSyncState}
              adminWorkspaceSummaries={adminWorkspaceSummaries}
              onInspectWarehouse={(whName) => {
                if (whName === 'Tất cả kho' || !whName || whName === 'Chưa phân kho') {
                  setSelectedFilterWarehouses([]);
                } else {
                  setSelectedFilterWarehouses([whName]);
                }
                setActiveTab('dashboard');
                scrollToTopOfPage();
                showToast(`Đang xem dữ liệu thời gian thực của: ${whName}`);
              }}
            />
          )}

          {isSessionLoggedIn && (activeTab === 'reports' || activeTab === 'backup_history') && (
            <ReportsAndBackupModule
              mode={activeTab === 'backup_history' ? 'backup_history' : 'reports'}
              activeWarehouseLabel={detailedWarehouseLabel}
              products={visibleProducts}
              customers={visibleCustomers}
              sales={visibleSales}
              imports={visibleImports}
              receiptVouchers={visibleReceiptVouchers}
              paymentVouchers={visiblePaymentVouchers}
              savedVouchers={visibleSavedVouchers}
              backups={backups}
              staffList={staffList}
              currentStaff={currentStaff}
              auditLogs={visibleAuditLogs}
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
              onCollectCustomerDebtBatch={handleCollectCustomerDebtBatch}
              onSettleCustomerTotalDebtFifo={handleSettleCustomerTotalDebtFifo}
              onExecuteFiscalYearCloseAndCleanup={handleExecuteFiscalYearCloseAndCleanup}
              onExecuteFullApplicationDataWipe={handleExecuteFullApplicationDataWipe}
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

          {isSessionLoggedIn && activeTab === 'gemini_chat' && (
            <GeminiChatbotView
              currentStaff={currentStaff}
              activeWarehouseLabel={detailedWarehouseLabel}
              products={visibleProducts}
              customers={visibleCustomers}
              suppliers={visibleSuppliers}
              sales={visibleSales}
              imports={visibleImports}
              receiptVouchers={visibleReceiptVouchers}
              paymentVouchers={visiblePaymentVouchers}
              adminTokenGrant={activeAiTokenGrant}
              onOpenAdminTokenRequestChat={() => {
                const callerUid = auth.currentUser?.uid || currentStaff.uid;
                const adminDmId = buildDirectChatRoomId(callerUid, PRIMARY_ADMIN_UID);
                setChatTargetRoomId(adminDmId || null);
                setActiveTab('internal_chat');
                scrollToTopOfPage();
              }}
            />
          )}

          {isSessionLoggedIn && activeTab === 'internal_chat' && (
            <InternalChatView
              currentStaff={currentStaff}
              staffList={staffList}
              initialSelectedRoomId={chatTargetRoomId}
              onConsumeInitialRoomId={() => setChatTargetRoomId(null)}
              onUnreadCountChange={setUnreadChatCount}
              onOpenGeminiChat={() => {
                setActiveTab('gemini_chat');
                scrollToTopOfPage();
              }}
              onNotifyToast={showToast}
            />
          )}
          </Suspense>
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
            void syncNotificationPrefsToFirestore(newPrefs, true);
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

      {/* Quick Self-Service Warehouse Naming Modal for Independent Warehouse Owners */}
      {quickRenameWarehouseOpen && !isAdminAccount && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Tự đặt tên kho hiển thị riêng"
        >
          <div className="bg-white rounded-2xl border border-emerald-200 shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 bg-emerald-50/80 border-b border-emerald-200 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Warehouse className="w-4 h-4 text-emerald-700 shrink-0" />
                <h3 className="text-sm font-bold text-slate-900">
                  Đặt Tên Kho Riêng Của Bạn ({MANDATORY_WAREHOUSE_PREFIX} + TÊN SỬA ĐỔI)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setQuickRenameWarehouseOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
                aria-label="Đóng"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const fullWh = normalizeCustomTamAnWarehouseName(
                  quickRenameSuffix,
                  currentStaff.email
                );
                await handleUpdateStaffProfile({
                  uid: currentStaff.uid,
                  displayName: currentStaff.displayName,
                  phone: currentStaff.phone || '',
                  email: currentStaff.email || '',
                  customWarehouseName: fullWh,
                });
                setQuickRenameWarehouseOpen(false);
              }}
              className="p-5 space-y-4"
            >
              <p className="text-xs text-slate-600 leading-relaxed">
                Tài khoản đăng ký mới tự động có kho độc lập và tự đổi tên kho không cần Admin cấp. Hệ thống giữ nguyên tiền tố mặc định <strong>{MANDATORY_WAREHOUSE_PREFIX}</strong> ở phía trước:
              </p>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Tên kho hiển thị (gõ phần tên sửa đổi bên phải) *
                </label>
                <div className="flex items-stretch rounded-xl overflow-hidden border border-emerald-400 bg-white">
                  <span className="px-3.5 py-2.5 text-xs font-mono font-extrabold bg-emerald-800 text-white flex items-center select-none shrink-0">
                    {MANDATORY_WAREHOUSE_PREFIX}
                  </span>
                  <input
                    type="text"
                    required
                    value={quickRenameSuffix}
                    onChange={(e) => setQuickRenameSuffix(e.target.value)}
                    placeholder="VD: BA SAO, MỸ AN..."
                    className="flex-1 min-w-0 px-3 py-2.5 text-xs font-mono font-bold text-slate-900 bg-white focus:outline-none uppercase"
                  />
                </div>
                <div className="text-[11px] text-emerald-800 mt-1.5">
                  Tên kho sẽ lưu &amp; đồng bộ:{' '}
                  <strong>
                    {normalizeCustomTamAnWarehouseName(quickRenameSuffix, currentStaff.email)}
                  </strong>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setQuickRenameWarehouseOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  Giữ nguyên hiện tại
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                >
                  Lưu &amp; Đồng bộ tên kho
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

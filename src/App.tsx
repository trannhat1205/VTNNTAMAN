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
  ShieldCheck,
  ShoppingCart,
  Sparkles,
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
  CashPaymentVoucher,
  CashReceiptVoucher,
  CustomerProfile,
  ImportTransaction,
  NotificationPrefs,
  ProductItem,
  SalePromotionType,
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
  createAuditLogEntry,
  evaluateDebtUrgency,
  evaluateStaffAccessScope,
  evaluateStockAlert,
  executeFiscalYearCloseAndCleanup,
  executeFullApplicationDataWipe,
  extractCustomWarehouseSuffix,
  filterRecordsBySelectedWarehouses,
  formatDefaultWarehouseNameFromGmail,
  formatSelectedWarehousesBadge,
  formatVND,
  generateSequentialVoucherCode,
  generateSmartNotifications,
  getCurrentMonthRangeVietnam,
  getDefaultPermissionsForPosition,
  getIndependentWarehouseFullPermissions,
  getPositionRoleLabel,
  getTodayVietnamDateStr,
  MANDATORY_WAREHOUSE_PREFIX,
  normalizeCustomTamAnWarehouseName,
  normalizeVietnameseSearch,
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
  logoutUser,
  resendVerificationEmail,
  seedExistingStaffToChatDirectoryIfAdmin,
  seedExistingStaffToRealtimeDirectoryIfAdmin,
  subscribeToAiTokenGrant,
  subscribeToAllRealtimeWorkspacesForAdmin,
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
  writeRealtimeWorkspace,
} from './services/firebaseService';
import { AiTokenGrantRecord } from './utils/geminiReportAssistant';
import { buildDirectChatRoomId } from './utils/internalChatLogic';
import {
  AdminWarehouseAccountSummary,
  aggregateAdminWorkspacesFromRtdb,
  computeWorkspaceFingerprint,
  dedupeRecordsById,
  mergeDirectoryIntoStaffList,
  normalizeIndependentWarehouseStaffMember,
  partitionAdminStateByWorkspace,
  RtdbUserDirectoryProfile,
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
import { InitialLoginScreenPortal } from './components/StaffAccountManager';

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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isSessionLoggedIn, setIsSessionLoggedIn] = useState<boolean>(false);
  const [isAuthChecking, setIsAuthChecking] = useState<boolean>(true);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<'local' | 'synced' | 'unverified'>('local');

  // Core Data State (Empty by default for production; persisted in localStorage + Firestore)
  const [products, setProducts] = useState<ProductItem[]>(initialWorkspace.products);
  const [customers, setCustomers] = useState<CustomerProfile[]>(initialWorkspace.customers);
  const [sales, setSales] = useState<SaleTransaction[]>(initialWorkspace.sales);
  const [imports, setImports] = useState<ImportTransaction[]>(initialWorkspace.imports);
  const [savedVouchers, setSavedVouchers] = useState<SavedVoucherRecord[]>(
    initialWorkspace.savedVouchers
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
  const rtdbKnownOwnerUidsRef = useRef<Set<string>>(new Set([PRIMARY_ADMIN_UID]));
  const adminWorkspacesMapRef = useRef<Record<string, unknown>>({});
  const rtdbUsersDirMapRef = useRef<Record<string, RtdbUserDirectoryProfile>>({});
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
  const [isNotifDrawerOpen, setIsNotifDrawerOpen] = useState(false);
  const [readNotifIds, setReadNotifIds] = useState<Set<string>>(new Set());
  const [toastBanner, setToastBanner] = useState<string | null>(null);
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
      backups,
      auditLogs,
      warehouses,
      customerGroups,
      productCategories,
      receiptGroups,
      paymentGroups,
      staffList,
      notificationPrefs,
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
    backups,
    auditLogs,
    warehouses,
    customerGroups,
    productCategories,
    receiptGroups,
    paymentGroups,
    staffList,
    notificationPrefs,
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
        setBackups(parsed.backups);
        setAuditLogs(parsed.auditLogs);
        setWarehouses(parsed.warehouses);
        setCustomerGroups(parsed.customerGroups);
        setProductCategories(parsed.productCategories);
        setReceiptGroups(parsed.receiptGroups);
        setPaymentGroups(parsed.paymentGroups);
        setStaffList(sanitizeStaffListForStorage(parsed.staffList));
        setNotificationPrefs(parsed.notificationPrefs);
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

  // Determine warehouse lock:
  // If staff cannot filter multi-warehouses, they are locked to their single assigned warehouse.
  // If they CAN filter multi-warehouses and picked exactly 1 warehouse, lock forms/views to that 1 warehouse.
  const lockedWarehouse = useMemo<string | null>(() => {
    if (!canFilterMultiWarehouses) {
      return currentStaff.assignedWarehouse || warehouses[0] || 'Tâm An Mỹ Ngãi';
    }
    const active = resolveActiveWarehouses(currentStaff, warehouses, selectedFilterWarehouses);
    if (active.length === 1 && warehouses.length > 1) {
      return active[0];
    }
    return null;
  }, [canFilterMultiWarehouses, currentStaff, warehouses, selectedFilterWarehouses]);

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
          if (remote) {
            if (remote.products.length > 0) {
              setProducts((prev) => mergeRecordsById(prev, remote.products));
            }
            if (remote.customers.length > 0) {
              setCustomers((prev) => mergeRecordsById(prev, remote.customers));
            }
            if (remote.sales.length > 0) {
              setSales((prev) => mergeRecordsById(prev, remote.sales));
            }
            if (remote.imports.length > 0) {
              setImports((prev) => mergeRecordsById(prev, remote.imports));
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

  const showToast = (msg: string) => {
    setToastBanner(msg);
    setTimeout(() => {
      setToastBanner((prev) => (prev === msg ? null : prev));
    }, 4500);
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
      void upsertChatUserDirectoryProfile({
        uid: activeUid,
        displayName: currentStaff.displayName,
        warehouseName: currentStaff.assignedWarehouse || 'VTNN Tâm An',
        isPrimaryAdmin: isPrimary,
        roleLabel: getPositionRoleLabel(currentStaff.positionRole),
      });
      if (isPrimary) {
        void seedExistingStaffToChatDirectoryIfAdmin();
      }

      unsubRooms = subscribeToUserChatRooms(activeUid, isPrimary, (roomsList) => {
        if (activeTab === 'internal_chat') return;
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
    activeTab,
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
    auditLogs,
    backups,
    warehouses,
    customerGroups,
    productCategories,
    receiptGroups,
    paymentGroups,
    staffList,
    notificationPrefs,
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
    auditLogs,
    backups,
    warehouses,
    customerGroups,
    productCategories,
    receiptGroups,
    paymentGroups,
    staffList,
    notificationPrefs,
    autoDailyBackupEnabled,
  };

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
  useEffect(() => {
    const fbUser = auth.currentUser;
    if (!isSessionLoggedIn || !isGoogleAuthenticated || !fbUser) {
      rtdbHydratedKeyRef.current = null;
      return;
    }

    const isPrimary = isCurrentUserAdmin(fbUser) || canAccountCreateStaff(currentStaff);
    const activeUid = isPrimary ? PRIMARY_ADMIN_UID : fbUser.uid;
    const sessionKey = isPrimary ? `admin:${PRIMARY_ADMIN_UID}` : `user:${activeUid}`;

    rtdbHydratedKeyRef.current = null;

    // Publish user directory profile to RTDB /users_directory/{uid}
    void upsertRealtimeUserDirectoryProfile({
      ...currentStaff,
      uid: activeUid,
      email: currentStaff.email || fbUser.email || '',
    });

    if (isPrimary) {
      void seedExistingStaffToRealtimeDirectoryIfAdmin(latestWorkspaceRef.current.staffList);

      const applyAdminAggregate = () => {
        const wsMap = adminWorkspacesMapRef.current;
        const dirMap = rtdbUsersDirMapRef.current;
        const agg = aggregateAdminWorkspacesFromRtdb(wsMap, dirMap);
        setAdminWorkspaceSummaries(agg.adminSummaries);

        const dirProfiles = Object.values(dirMap);
        if (dirProfiles.length > 0) {
          setStaffList((prev) => mergeDirectoryIntoStaffList(prev, dirProfiles));
        }

        const wsKeys = Object.keys(wsMap);
        wsKeys.forEach((uid) => rtdbKnownOwnerUidsRef.current.add(uid));

        if (wsKeys.length === 0) {
          // RTDB is currently empty -> seed existing local state up partitioned by ownerId
          if (rtdbHydratedKeyRef.current !== sessionKey) {
            rtdbHydratedKeyRef.current = sessionKey;
            setRtdbWriteTrigger((n) => n + 1);
          }
          return;
        }

        // Check if any remote workspace bucket changed compared to our last known fingerprint
        let hasRemoteChanges = rtdbHydratedKeyRef.current !== sessionKey;
        for (const [uid, normPayload] of Object.entries(agg.normalizedWorkspaces)) {
          const remoteFp = computeWorkspaceFingerprint(normPayload);
          if (rtdbLastFingerprintsRef.current[uid] !== remoteFp) {
            rtdbLastFingerprintsRef.current[uid] = remoteFp;
            hasRemoteChanges = true;
          }
        }

        if (hasRemoteChanges) {
          const firstHydration = rtdbHydratedKeyRef.current !== sessionKey;
          rtdbHydratedKeyRef.current = sessionKey;
          rtdbSuppressNextWriteRef.current = true;

          const cur = latestWorkspaceRef.current;
          setProducts(
            firstHydration ? dedupeRecordsById([...cur.products, ...agg.products]) : agg.products
          );
          setCustomers(
            firstHydration
              ? dedupeRecordsById([...cur.customers, ...agg.customers])
              : agg.customers
          );
          setSuppliers(
            firstHydration
              ? dedupeRecordsById([...cur.suppliers, ...agg.suppliers])
              : agg.suppliers
          );
          setSales(
            firstHydration ? dedupeRecordsById([...cur.sales, ...agg.sales]) : agg.sales
          );
          setImports(
            firstHydration ? dedupeRecordsById([...cur.imports, ...agg.imports]) : agg.imports
          );
          setReceiptVouchers(
            firstHydration
              ? dedupeRecordsById([...cur.receiptVouchers, ...agg.receiptVouchers])
              : agg.receiptVouchers
          );
          setPaymentVouchers(
            firstHydration
              ? dedupeRecordsById([...cur.paymentVouchers, ...agg.paymentVouchers])
              : agg.paymentVouchers
          );
          setSavedVouchers(
            firstHydration
              ? dedupeRecordsById([...cur.savedVouchers, ...agg.savedVouchers])
              : agg.savedVouchers
          );
          setAuditLogs(
            firstHydration
              ? dedupeRecordsById([...cur.auditLogs, ...agg.auditLogs])
              : agg.auditLogs
          );
          setBackups(
            firstHydration ? dedupeRecordsById([...cur.backups, ...agg.backups]) : agg.backups
          );
          setWarehouses(Array.from(new Set([...cur.warehouses, ...agg.warehouses])));
          setCustomerGroups(
            Array.from(new Set([...cur.customerGroups, ...agg.customerGroups]))
          );
          setProductCategories(
            Array.from(new Set([...cur.productCategories, ...agg.productCategories]))
          );
          setReceiptGroups(Array.from(new Set([...cur.receiptGroups, ...agg.receiptGroups])));
          setPaymentGroups(Array.from(new Set([...cur.paymentGroups, ...agg.paymentGroups])));

          if (firstHydration) {
            setRtdbWriteTrigger((n) => n + 1);
          }
        }
      };

      const unsubAllWs = subscribeToAllRealtimeWorkspacesForAdmin((wsMap) => {
        adminWorkspacesMapRef.current = wsMap;
        applyAdminAggregate();
      });
      const unsubDir = subscribeToRealtimeUsersDirectory(PRIMARY_ADMIN_UID, true, (dirMap) => {
        rtdbUsersDirMapRef.current = dirMap;
        applyAdminAggregate();
      });

      return () => {
        unsubAllWs();
        unsubDir();
      };
    }

    // Standard single-warehouse user subscription (/workspaces/{uid} + /users_directory/{uid})
    const unsubUserWs = subscribeToRealtimeWorkspace(activeUid, (remoteWs) => {
      if (!remoteWs) {
        // First time this warehouse user connects to RTDB -> push local workspace immediately
        rtdbHydratedKeyRef.current = sessionKey;
        setRtdbWriteTrigger((n) => n + 1);
        return;
      }

      const incomingFp = computeWorkspaceFingerprint(remoteWs);
      if (
        rtdbHydratedKeyRef.current === sessionKey &&
        rtdbLastFingerprintsRef.current[activeUid] === incomingFp
      ) {
        return;
      }

      const firstHydration = rtdbHydratedKeyRef.current !== sessionKey;
      rtdbHydratedKeyRef.current = sessionKey;
      rtdbLastFingerprintsRef.current[activeUid] = incomingFp;
      rtdbSuppressNextWriteRef.current = true;

      const cur = latestWorkspaceRef.current;
      setProducts(
        firstHydration
          ? dedupeRecordsById([...cur.products, ...remoteWs.products])
          : remoteWs.products
      );
      setCustomers(
        firstHydration
          ? dedupeRecordsById([...cur.customers, ...remoteWs.customers])
          : remoteWs.customers
      );
      setSuppliers(
        firstHydration
          ? dedupeRecordsById([...cur.suppliers, ...remoteWs.suppliers])
          : remoteWs.suppliers
      );
      setSales(
        firstHydration ? dedupeRecordsById([...cur.sales, ...remoteWs.sales]) : remoteWs.sales
      );
      setImports(
        firstHydration
          ? dedupeRecordsById([...cur.imports, ...remoteWs.imports])
          : remoteWs.imports
      );
      setReceiptVouchers(
        firstHydration
          ? dedupeRecordsById([...cur.receiptVouchers, ...remoteWs.receiptVouchers])
          : remoteWs.receiptVouchers
      );
      setPaymentVouchers(
        firstHydration
          ? dedupeRecordsById([...cur.paymentVouchers, ...remoteWs.paymentVouchers])
          : remoteWs.paymentVouchers
      );
      setSavedVouchers(
        firstHydration
          ? dedupeRecordsById([...cur.savedVouchers, ...remoteWs.savedVouchers])
          : remoteWs.savedVouchers
      );
      setAuditLogs(
        firstHydration
          ? dedupeRecordsById([...cur.auditLogs, ...remoteWs.auditLogs]).slice(0, 500)
          : remoteWs.auditLogs
      );
      setBackups(
        firstHydration
          ? dedupeRecordsById([...cur.backups, ...remoteWs.backups])
          : remoteWs.backups
      );
      if (remoteWs.settings.warehouses.length > 0) {
        setWarehouses((prev) => Array.from(new Set([...prev, ...remoteWs.settings.warehouses])));
      }
      if (remoteWs.settings.customerGroups.length > 0) {
        setCustomerGroups((prev) =>
          Array.from(new Set([...prev, ...remoteWs.settings.customerGroups]))
        );
      }
      if (remoteWs.settings.productCategories.length > 0) {
        setProductCategories((prev) =>
          Array.from(new Set([...prev, ...remoteWs.settings.productCategories]))
        );
      }
      if (remoteWs.settings.receiptGroups.length > 0) {
        setReceiptGroups((prev) =>
          Array.from(new Set([...prev, ...remoteWs.settings.receiptGroups]))
        );
      }
      if (remoteWs.settings.paymentGroups.length > 0) {
        setPaymentGroups((prev) =>
          Array.from(new Set([...prev, ...remoteWs.settings.paymentGroups]))
        );
      }
      if (remoteWs.settings.notificationPrefs) {
        setNotificationPrefs(remoteWs.settings.notificationPrefs);
      }

      if (firstHydration) {
        setRtdbWriteTrigger((n) => n + 1);
      }
    });

    const unsubUserDir = subscribeToRealtimeUsersDirectory(activeUid, false, (dirMap) => {
      const profiles = Object.values(dirMap);
      if (profiles.length > 0) {
        setStaffList((prev) => mergeDirectoryIntoStaffList(prev, profiles));
      }
    });

    return () => {
      unsubUserWs();
      unsubUserDir();
    };
  }, [isSessionLoggedIn, isGoogleAuthenticated, currentStaff.uid]);

  // Debounced auto-sync to Firebase Realtime Database on every state mutation
  useEffect(() => {
    const fbUser = auth.currentUser;
    if (!isSessionLoggedIn || !isGoogleAuthenticated || !fbUser) return;

    const isPrimary = isCurrentUserAdmin(fbUser) || canAccountCreateStaff(currentStaff);
    const activeUid = isPrimary ? PRIMARY_ADMIN_UID : fbUser.uid;
    const expectedKey = isPrimary ? `admin:${PRIMARY_ADMIN_UID}` : `user:${activeUid}`;

    if (rtdbHydratedKeyRef.current !== expectedKey) return;
    if (rtdbSuppressNextWriteRef.current) {
      rtdbSuppressNextWriteRef.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      const nowIso = new Date().toISOString();
      const settingsObj = {
        warehouses,
        customerGroups,
        productCategories,
        receiptGroups,
        paymentGroups,
        notificationPrefs,
        autoDailyBackupEnabled,
      };

      if (isPrimary) {
        const partitioned = partitionAdminStateByWorkspace({
          products,
          customers,
          suppliers,
          sales,
          imports,
          receiptVouchers,
          paymentVouchers,
          savedVouchers,
          auditLogs,
          backups,
          settings: settingsObj,
          staffList,
          knownOwnerUids: Array.from(rtdbKnownOwnerUidsRef.current),
          adminUid: PRIMARY_ADMIN_UID,
          nowIso,
        });

        Object.entries(partitioned).forEach(([bucketUid, bucketPayload]) => {
          const nextFp = computeWorkspaceFingerprint(bucketPayload);
          if (rtdbLastFingerprintsRef.current[bucketUid] !== nextFp) {
            rtdbLastFingerprintsRef.current[bucketUid] = nextFp;
            rtdbKnownOwnerUidsRef.current.add(bucketUid);
            void writeRealtimeWorkspace(bucketUid, bucketPayload);
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
          auditLogs: auditLogs.slice(0, 500),
          backups: backups.map((b) => ({ ...b, snapshotPayload: undefined })),
          settings: settingsObj,
        };
        const nextFp = computeWorkspaceFingerprint(payload);
        if (rtdbLastFingerprintsRef.current[activeUid] !== nextFp) {
          rtdbLastFingerprintsRef.current[activeUid] = nextFp;
          void writeRealtimeWorkspace(activeUid, payload);
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    isSessionLoggedIn,
    isGoogleAuthenticated,
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
    auditLogs,
    backups,
    warehouses,
    customerGroups,
    productCategories,
    receiptGroups,
    paymentGroups,
    staffList,
    notificationPrefs,
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
          icon: '/assets/logo-taman.png',
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
  }): SaleTransaction => {
    const nowIso = new Date().toISOString();
    const { updatedProducts, updatedProduct, updatedGiftProduct } = applySaleToInventory(
      products,
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

    const activeUid = auth.currentUser?.uid || currentStaff.uid;
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
      note: payload.note,
      warehouseName:
        lockedWarehouse ||
        payload.warehouseName ||
        updatedProduct.warehouseName ||
        'Tâm An Mỹ Ngãi',
      staffName: currentStaff.displayName,
      ownerId: activeUid,
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
      promotionType?: SalePromotionType;
      discountAmount?: number;
      discountPercent?: number;
      giftProductId?: string;
      giftProductName?: string;
      giftUnit?: string;
      giftQuantity?: number;
      giftUnitCost?: number;
    }
  ) => {
    if (!canPerformRoleAction(role, 'edit_record')) {
      showToast('Chỉ Quản lý mới có quyền chỉnh sửa hóa đơn chứng từ đã lưu.');
      return;
    }
    const existing = sales.find((s) => s.id === saleId);
    const nowIso = new Date().toISOString();
    if (!existing) return;

    const updated = updateSaleRecord(existing, changes, nowIso);
    const nextSales = sales.map((s) => (s.id === saleId ? updated : s));
    setSales(nextSales);

    // Reconcile inventory stock delta for both main product and promotional gift product
    const stockDeltas = computeSaleEditStockDeltas(existing, updated);
    if (Object.keys(stockDeltas).length > 0) {
      setProducts((prev) =>
        prev.map((p) => {
          const delta = stockDeltas[p.id];
          if (!delta) return p;
          const nextProd = {
            ...p,
            stock: Math.max(0, p.stock + delta),
            updatedAt: nowIso,
          };
          if (isGoogleAuthenticated) void syncProductToFirestore(nextProd, false);
          return nextProd;
        })
      );
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
    const nowIso = new Date().toISOString();
    setSales((prev) => prev.filter((s) => s.id !== saleId));
    if (target) {
      // Restore sold & gift inventory stock
      setProducts((prev) =>
        prev.map((p) => {
          let restoreQty = 0;
          if (p.id === target.productId) restoreQty += target.quantity;
          if (target.giftProductId && p.id === target.giftProductId) {
            restoreQty += target.giftQuantity || 0;
          }
          if (restoreQty <= 0) return p;
          const restored = { ...p, stock: p.stock + restoreQty, updatedAt: nowIso };
          if (isGoogleAuthenticated) void syncProductToFirestore(restored, false);
          return restored;
        })
      );

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

    const activeUid = auth.currentUser?.uid || currentStaff.uid;
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
      note: payload.note,
      warehouseName:
        lockedWarehouse ||
        payload.warehouseName ||
        updatedProduct.warehouseName ||
        'Tâm An Mỹ Ngãi',
      staffName: currentStaff.displayName,
      ownerId: activeUid,
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

    const updated = updateImportRecord(existing, changes, nowIso);
    setImports((prev) => prev.map((imp) => (imp.id === importId ? updated : imp)));

    const qtyDelta = updated.quantity - existing.quantity;
    if (qtyDelta !== 0 || updated.unitCost !== existing.unitCost) {
      setProducts((prev) =>
        prev.map((p) => {
          if (p.id !== existing.productId) return p;
          const nextProd = {
            ...p,
            stock: Math.max(0, p.stock + qtyDelta),
            importPrice: updated.unitCost > 0 ? updated.unitCost : p.importPrice,
            updatedAt: nowIso,
          };
          if (isGoogleAuthenticated) void syncProductToFirestore(nextProd, false);
          return nextProd;
        })
      );
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
    setImports((prev) => prev.filter((imp) => imp.id !== importId));
    if (target) {
      setProducts((prev) =>
        prev.map((p) => {
          if (p.id !== target.productId) return p;
          const adjusted = {
            ...p,
            stock: Math.max(0, p.stock - target.quantity),
            updatedAt: nowIso,
          };
          if (isGoogleAuthenticated) void syncProductToFirestore(adjusted, false);
          return adjusted;
        })
      );
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

  const handleDeleteProduct = (productId: string) => {
    if (!canPerformRoleAction(role, 'delete_record')) return;
    const target = products.find((p) => p.id === productId);
    setProducts((prev) => prev.filter((p) => p.id !== productId));
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
    }
    showToast('Quản lý đã xóa mặt hàng vật tư khỏi danh mục kho (Đã lưu Lịch sử thao tác).');
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
    }
    showToast('Quản lý đã xóa hồ sơ khách hàng (Đã ghi vào Lịch sử thao tác).');
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
        sales,
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

      setSales(fifoResult.updatedSales);
      if (isGoogleAuthenticated) {
        const settledIds = new Set(fifoResult.settledAllocations.map((a) => a.recordId));
        fifoResult.updatedSales
          .filter((s) => settledIds.has(s.id))
          .forEach((s) => {
            void syncSaleToFirestore(s, false);
          });
      }

      // Update customer's totalDebt in customers state
      setCustomers((prev) =>
        prev.map((c) => {
          const isMatched =
            (params.customerId && c.id === params.customerId) ||
            (params.customerPhone && c.phone === params.customerPhone) ||
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
        imports,
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

      setImports(fifoResult.updatedImports);
      if (isGoogleAuthenticated) {
        const settledIds = new Set(fifoResult.settledAllocations.map((a) => a.recordId));
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
        ownerId: activeUid,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    });
    if (added.length > 0) {
      setProducts((prev) => [...added, ...prev]);
      if (isGoogleAuthenticated) {
        added.forEach((p) => void syncProductToFirestore(p, true));
      }
      showToast(`Đã tải lên ${added.length} mặt hàng vật tư từ tệp Excel!`);
    }
    return added.length;
  };

  const handleImportCustomersFromExcel = (rows: Record<string, unknown>[]): number => {
    const nowIso = new Date().toISOString();
    const activeUid = auth.currentUser?.uid || currentStaff.uid;
    const added: CustomerProfile[] = [];
    const defaultWh =
      lockedWarehouse ||
      (currentStaff.assignedWarehouse !== 'Tất cả kho'
        ? currentStaff.assignedWarehouse
        : warehouses[0] || 'Tâm An Mỹ Ngãi');
    rows.forEach((r, idx) => {
      const name = String(r['Họ Tên Khách Hàng'] || r['Tên Khách Hàng'] || '').trim();
      const phone = String(r['Số Điện Thoại'] || r['Số Điện Thoại KH'] || '').trim();
      if (!name) return;
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
        totalPurchased: Math.max(0, Number(r['Tổng Mua (VNĐ)'] || 0)),
        totalDebt: Math.max(0, Number(r['Dư Nợ Hiện Tại (VNĐ)'] || 0)),
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
      showToast(`Đã tải lên ${added.length} hồ sơ khách hàng từ tệp Excel!`);
    }
    return added.length;
  };

  const handleImportSalesFromExcel = (rows: Record<string, unknown>[]): number => {
    const nowIso = new Date().toISOString();
    const activeUid = auth.currentUser?.uid || currentStaff.uid;
    const defaultDueDate = computeDueDateAfterDays(7, getTodayVietnamDateStr());
    const addedSales: SaleTransaction[] = [];
    const prodDeltaById = new Map<string, number>();

    rows.forEach((r, idx) => {
      const custName = String(r['Tên Khách Hàng'] || '').trim();
      const prodName = String(r['Tên Vật Tư Nông Nghiệp'] || r['Sản Phẩm'] || '').trim();
      const qty = Math.max(1, Number(r['Số Lượng Bán'] || r['Số Lượng'] || 1));
      const price = Math.max(0, Number(r['Đơn Giá Bán (VNĐ)'] || r['Đơn Giá (đ)'] || 0));
      if (!custName || !prodName) return;
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
      const matchedProd = products.find(
        (p) =>
          (!p.warehouseName || !wh || p.warehouseName === wh) &&
          normalizeVietnameseSearch(p.name) === normalizeVietnameseSearch(prodName)
      );
      if (matchedProd) {
        prodDeltaById.set(matchedProd.id, (prodDeltaById.get(matchedProd.id) || 0) - qty);
      }

      const paid = Math.max(0, Number(r['Khách Đã Trả (VNĐ)'] || r['Đã Thu (đ)'] || qty * price));
      const sum = calculateSaleSummary(qty, price, paid);
      addedSales.push({
        id: `sale_xl_${Date.now()}_${idx}`,
        invoiceCode: `HD-XL-${sales.length + idx + 1}`,
        customerId: matchedCust?.id || `cust_xl_${idx}`,
        customerName: matchedCust?.name || custName,
        customerPhone: matchedCust?.phone || custPhone,
        productId: matchedProd?.id || `prod_xl_${idx}`,
        productName: matchedProd?.name || prodName,
        unit: matchedProd?.unit || String(r['Đơn Vị'] || 'Bao').trim(),
        quantity: qty,
        unitPrice: price,
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
        setProducts((prev) =>
          prev.map((p) => {
            const delta = prodDeltaById.get(p.id);
            return delta
              ? { ...p, stock: Math.max(0, p.stock + delta), updatedAt: nowIso }
              : p;
          })
        );
      }
      setCustomers((prev) => reconcileCustomersFromSales(prev, nextSales, nowIso).customers);
      showToast(`Đã tải lên ${addedSales.length} hóa đơn bán hàng từ tệp Excel!`);
    }
    return addedSales.length;
  };

  const handleImportWarehouseFromExcel = (rows: Record<string, unknown>[]): number => {
    const nowIso = new Date().toISOString();
    const activeUid = auth.currentUser?.uid || currentStaff.uid;
    const defaultDueDate = computeDueDateAfterDays(7, getTodayVietnamDateStr());
    const addedImports: ImportTransaction[] = [];
    const prodDeltaById = new Map<string, { qty: number; unitCost: number }>();

    rows.forEach((r, idx) => {
      const prodName = String(r['Tên Vật Tư Nhập Kho'] || r['Sản Phẩm'] || '').trim();
      const supName = String(r['Nhà Cung Cấp'] || '').trim();
      const qty = Math.max(1, Number(r['Số Lượng Nhập'] || 1));
      const cost = Math.max(0, Number(r['Đơn Giá Nhập (VNĐ)'] || r['Giá Nhập (đ)'] || 0));
      if (!prodName || !supName) return;
      const wh =
        lockedWarehouse ||
        String(r['Kho Nhập Hàng'] || warehouses[0] || 'Tâm An Mỹ Ngãi').trim();
      const matchedProd = products.find(
        (p) =>
          (!p.warehouseName || !wh || p.warehouseName === wh) &&
          normalizeVietnameseSearch(p.name) === normalizeVietnameseSearch(prodName)
      );
      if (matchedProd) {
        const prevD = prodDeltaById.get(matchedProd.id) || { qty: 0, unitCost: cost };
        prodDeltaById.set(matchedProd.id, {
          qty: prevD.qty + qty,
          unitCost: cost > 0 ? cost : prevD.unitCost,
        });
      }

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
        productId: matchedProd?.id || `prod_xl_${idx}`,
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
        setProducts((prev) =>
          prev.map((p) => {
            const delta = prodDeltaById.get(p.id);
            return delta
              ? {
                  ...p,
                  stock: p.stock + delta.qty,
                  importPrice: delta.unitCost > 0 ? delta.unitCost : p.importPrice,
                  updatedAt: nowIso,
                }
              : p;
          })
        );
      }
      showToast(`Đã tải lên ${addedImports.length} phiếu nhập kho từ tệp Excel!`);
    }
    return addedImports.length;
  };

  const handleImportDebtPaymentsFromExcel = (rows: Record<string, unknown>[]): number => {
    let updatedCount = 0;
    const nowIso = new Date().toISOString();
    let workingSales = [...sales];
    let workingImports = [...imports];
    let salesChanged = false;
    let importsChanged = false;

    rows.forEach((r) => {
      const code = String(r['Mã Hóa Đơn / Mã Phiếu Nhập'] || '').trim();
      const amount = Math.max(0, Number(r['Số Tiền Thanh Toán Đợt Này (VNĐ)'] || 0));
      const note = String(r['Ghi Chú Thanh Toán'] || 'Cập nhật từ Excel').trim();
      if (!code || amount <= 0) return;

      if (code.startsWith('HD-')) {
        workingSales = workingSales.map((s) => {
          if (s.invoiceCode !== code || s.debtAmount <= 0) return s;
          salesChanged = true;
          updatedCount += 1;
          const noteSuffix = `[Thu nợ Excel: +${Math.min(s.debtAmount, Math.round(amount)).toLocaleString('vi-VN')}đ${note ? ' - ' + note : ''}]`;
          return applyDebtPayment(
            { ...s, note: s.note ? `${s.note} | ${noteSuffix}` : noteSuffix },
            amount,
            nowIso
          );
        });
      } else if (code.startsWith('PN-')) {
        workingImports = workingImports.map((i) => {
          if (i.receiptCode !== code || i.debtAmount <= 0) return i;
          importsChanged = true;
          updatedCount += 1;
          const noteSuffix = `[Trả nợ Excel: -${Math.min(i.debtAmount, Math.round(amount)).toLocaleString('vi-VN')}đ${note ? ' - ' + note : ''}]`;
          return applyDebtPayment(
            { ...i, note: i.note ? `${i.note} | ${noteSuffix}` : noteSuffix },
            amount,
            nowIso
          );
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
    if (updatedCount > 0) {
      showToast(`Đã cập nhật thanh toán cho ${updatedCount} chứng từ công nợ từ Excel!`);
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

    // 1. If input is an email address, verify via Firebase Authentication first
    if (query.includes('@')) {
      try {
        const fbRes = await firebaseSignInWithEmailPassword(query, password);
        syncUserSessionFromFirebase(fbRes.user);
        showToast(`Đăng nhập thành công (${fbRes.user.email || query})!`);
        return {
          ok: true,
          message: `Đăng nhập thành công (${fbRes.user.email || query})!`,
        };
      } catch (err) {
        const code = (err as { code?: string })?.code || '';
        if (code === 'auth/too-many-requests') {
          return {
            ok: false,
            message: 'Tài khoản tạm thời bị giới hạn do nhập sai nhiều lần. Vui lòng thử lại sau ít phút.',
          };
        }
        // Fallback to local hashed staff account only if an internal hashed password is stored
        const matchedLocal = staffList.find(
          (s) => s.email && s.email.toLowerCase() === query && isHashedPassword(s.password)
        );
        if (!matchedLocal) {
          return {
            ok: false,
            message:
              'Email hoặc mật khẩu không đúng (hoặc tài khoản dùng Đăng nhập bằng Google — vui lòng bấm "Đăng nhập bằng Google").',
          };
        }
        if (!matchedLocal.active) {
          return {
            ok: false,
            message: `Tài khoản "${matchedLocal.username}" đã bị khóa bởi Quản lý chính.`,
          };
        }
        const okHash = await verifyPassword(password, matchedLocal.password, matchedLocal.uid);
        if (!okHash) {
          return { ok: false, message: 'Mật khẩu không chính xác. Vui lòng kiểm tra lại.' };
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
      }
    }

    // 2. Internal username/phone login using salted SHA-256 hash verification
    const digitsQuery = query.replace(/\D+/g, '');
    const matched = staffList.find(
      (s) =>
        s.username.toLowerCase() === query ||
        (s.phone && digitsQuery.length >= 9 && s.phone.replace(/\D+/g, '') === digitsQuery)
    );
    if (!matched) {
      return {
        ok: false,
        message: `Không tìm thấy tài khoản "${usernameOrEmail}".`,
      };
    }
    if (!matched.active) {
      return {
        ok: false,
        message: `Tài khoản "${matched.username}" đã bị khóa bởi Quản lý chính.`,
      };
    }
    const isPasswordValid = await verifyPassword(password, matched.password, matched.uid);
    if (!isPasswordValid) {
      return {
        ok: false,
        message:
          'Mật khẩu không chính xác (hoặc tài khoản này cần đăng nhập bằng nút Google / Email Firebase).',
      };
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
    const authRes = authenticateStaffByGoogleEmail(staffList, trimmedEmail);

    if (authRes.ok && authRes.staff) {
      const matchedRaw = authRes.staff;
      const targetUid = isAdminEmail ? PRIMARY_ADMIN_UID : googleUid || matchedRaw.uid;
      const matched = normalizeIndependentWarehouseStaffMember({
        ...matchedRaw,
        uid: targetUid,
        updatedAt: nowIso,
      });

      if (matched.uid !== matchedRaw.uid || matched.assignedWarehouse !== matchedRaw.assignedWarehouse) {
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
      void upsertRealtimeUserDirectoryProfile(matched);
      showToast(
        `Đã đăng nhập bằng Google (${matched.email}): ${matched.displayName} — Kho: ${matched.assignedWarehouse}`
      );
      return {
        ok: true,
        message: authRes.message,
      };
    }

    // First-time Google sign-up -> auto-create independent warehouse TÂM AN + Gmail (or custom suffix) & isolate data
    const baseUser =
      trimmedEmail.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '') ||
      `user_${Date.now().toString().slice(-4)}`;
    const autoWarehouseName = isAdminEmail
      ? 'Tất cả kho'
      : preferredWarehouseName
      ? normalizeCustomTamAnWarehouseName(preferredWarehouseName, trimmedEmail)
      : formatDefaultWarehouseNameFromGmail(trimmedEmail);

    if (!isAdminEmail) {
      // Clear any previous local account's non-matching workspace records before hydrating from RTDB
      setProducts([]);
      setCustomers([]);
      setSuppliers([]);
      setSales([]);
      setImports([]);
      setReceiptVouchers([]);
      setPaymentVouchers([]);
      setSavedVouchers([]);
      setAuditLogs([]);
      setWarehouses([autoWarehouseName]);
    }

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
    setCurrentStaffId(newStaff.uid);
    setRole(newStaff.role);
    setCurrentUserEmail(newStaff.email);
    setIsGoogleAuthenticated(true);
    setIsSessionLoggedIn(true);
    void upsertRealtimeUserDirectoryProfile(newStaff);
    if (!isAdminEmail && !preferredWarehouseName) {
      setQuickRenameSuffix(extractCustomWarehouseSuffix(autoWarehouseName));
      setQuickRenameWarehouseOpen(true);
    }
    showToast(
      `Đã đăng ký & đăng nhập bằng Gmail (${newStaff.email}) — Tự động tạo kho độc lập: ${newStaff.assignedWarehouse}`
    );
    return {
      ok: true,
      message: `Đăng ký & đăng nhập Gmail thành công (${newStaff.email}) · Kho quản lý độc lập: ${newStaff.assignedWarehouse}!`,
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

    const alreadyExistsLocally = staffList.some(
      (s) => s.email && s.email.toLowerCase() === query
    );
    if (alreadyExistsLocally) {
      return {
        ok: false,
        message: `Địa chỉ Gmail "${query}" đã được đăng ký trước đó. Vui lòng chuyển sang tab Đăng nhập hoặc dùng Quên mật khẩu.`,
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
      const uniqueUsername = staffList.some((s) => s.username.toLowerCase() === baseUsername)
        ? `${baseUsername}_${Date.now().toString().slice(-3)}`
        : baseUsername;
      const posRole: StaffPositionRole = isPrimary ? 'primary_manager' : 'warehouse_manager';
      const autoWarehouseName = isPrimary
        ? 'Tất cả kho'
        : payload.customWarehouseName
        ? normalizeCustomTamAnWarehouseName(payload.customWarehouseName, query)
        : formatDefaultWarehouseNameFromGmail(query);

      if (!isPrimary) {
        // Brand-new independent warehouse account starts with an isolated clean warehouse
        setProducts([]);
        setCustomers([]);
        setSuppliers([]);
        setSales([]);
        setImports([]);
        setReceiptVouchers([]);
        setPaymentVouchers([]);
        setSavedVouchers([]);
        setAuditLogs([]);
        setWarehouses([autoWarehouseName]);
      }

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

      // Immediately persist user directory & isolated workspace to Firebase RTDB
      void upsertRealtimeUserDirectoryProfile(created);
      void writeRealtimeWorkspace(created.uid, {
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
      });
      setRtdbWriteTrigger((n) => n + 1);

      showToast(
        `Đã đăng ký Gmail @${created.username} — Tự động tạo kho: ${created.assignedWarehouse} & đồng bộ Realtime DB!`
      );
      return {
        ok: true,
        message: `Đăng ký tài khoản mới thành công (@${created.username})! Đã tạo kho riêng "${created.assignedWarehouse}" và đồng bộ trực tiếp lên hệ thống.${
          fbSignUp.verificationSent
            ? ' Vui lòng kiểm tra hộp thư Gmail để xác minh email và bật thêm sao lưu Cloud.'
            : ''
        }`,
      };
    } catch (err) {
      pendingRegistrationRef.current = null;
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/email-already-in-use') {
        return {
          ok: false,
          message: `Gmail "${query}" đã tồn tại trên hệ thống Firebase Authentication. Vui lòng đăng nhập hoặc dùng chức năng Quên mật khẩu.`,
        };
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
    const nowIso = new Date().toISOString();
    const oldWarehouse = target.assignedWarehouse;
    const isSingleWhAccount =
      oldWarehouse !== 'Tất cả kho' && !canAccountCreateStaff(target);

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
    const target = staffList.find((s) => s.uid === uid);
    const nowIso = new Date().toISOString();
    setStaffList((prev) =>
      prev.map((s) =>
        s.uid === uid ? { ...s, assignedWarehouse: warehouseName, updatedAt: nowIso } : s
      )
    );
    if (target) {
      if (isGoogleAuthenticated) {
        void upsertRealtimeUserDirectoryProfile({
          ...target,
          assignedWarehouse: warehouseName,
          updatedAt: nowIso,
        });
      }
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
      if (isGoogleAuthenticated) {
        void upsertRealtimeUserDirectoryProfile({
          ...target,
          role: resolvedRole,
          positionRole,
          permissions,
          assignedWarehouse,
          updatedAt: nowIso,
        });
      }
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
    if (Array.isArray(payload.suppliers)) {
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
    if (Array.isArray(payload.receiptVouchers)) {
      setReceiptVouchers(payload.receiptVouchers);
    }
    if (Array.isArray(payload.paymentVouchers)) {
      setPaymentVouchers(payload.paymentVouchers);
    }
    if (Array.isArray(payload.savedVouchers)) {
      setSavedVouchers(payload.savedVouchers);
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
      if (audit.targetEntity === 'sale') {
        const restoredSale = parsed as SaleTransaction;
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
        const restoredImp = parsed as ImportTransaction;
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
        const rec = parsed as Record<string, unknown>;
        if (typeof rec.voucherType === 'string') {
          const restoredVc = parsed as SavedVoucherRecord;
          setSavedVouchers((prev) => [restoredVc, ...prev.filter((v) => v.id !== restoredVc.id)]);
        } else if (
          String(rec.id || '').startsWith('rv_') ||
          String(rec.voucherCode || '').startsWith('PT')
        ) {
          const restoredRv = parsed as CashReceiptVoucher;
          setReceiptVouchers((prev) => [restoredRv, ...prev.filter((r) => r.id !== restoredRv.id)]);
        } else if (
          String(rec.id || '').startsWith('pv_') ||
          String(rec.voucherCode || '').startsWith('PC')
        ) {
          const restoredPv = parsed as CashPaymentVoucher;
          setPaymentVouchers((prev) => [restoredPv, ...prev.filter((p) => p.id !== restoredPv.id)]);
        } else {
          const restoredVc = parsed as SavedVoucherRecord;
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
    if (isScopedSingleWh) {
      // Wipe only the current user's independent warehouse data, keeping other warehouses completely intact
      setProducts((prev) => prev.filter((p) => p.warehouseName !== lockedWarehouse));
      setCustomers((prev) => prev.filter((c) => c.warehouseName !== lockedWarehouse));
      setSuppliers((prev) => prev.filter((sp) => sp.warehouseName !== lockedWarehouse));
      setSales((prev) => prev.filter((s) => s.warehouseName !== lockedWarehouse));
      setImports((prev) => prev.filter((i) => i.warehouseName !== lockedWarehouse));
      setReceiptVouchers((prev) => prev.filter((r) => r.warehouseName !== lockedWarehouse));
      setPaymentVouchers((prev) => prev.filter((p) => p.warehouseName !== lockedWarehouse));
      setSavedVouchers((prev) => prev.filter((v) => v.warehouseName !== lockedWarehouse));
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

    const wiped = executeFullApplicationDataWipe({ staffList });
    setProducts(wiped.products);
    setCustomers(wiped.customers);
    setSuppliers(wiped.suppliers);
    setSales(wiped.sales);
    setImports(wiped.imports);
    setReceiptVouchers(wiped.receiptVouchers);
    setPaymentVouchers(wiped.paymentVouchers);
    setSavedVouchers(wiped.savedVouchers);
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
            src="/assets/logo-taman.png"
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
              src="/assets/logo-taman.png"
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
                  : 'Quản lý 1 kho độc lập · Đầy đủ chức năng'
                : 'Vui lòng đăng nhập tài khoản'}
            </div>
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <div className="flex items-center gap-1 text-emerald-800 font-semibold min-w-0">
                <Warehouse className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  {isAdminAccount ? `Kho: ${activeWarehouseLabel}` : `Quản lý 1 kho: ${activeWarehouseLabel}`}
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
        {/* Top Bar Contract: Always pinned at top when scrolling vertically down */}
        <header className="bg-white/95 backdrop-blur-xs border-b border-slate-200 sticky top-0 z-40 shadow-2xs w-full max-w-full">
          <div className="px-2.5 sm:px-3.5 lg:px-6 py-2 sm:py-2.5 flex items-center justify-between gap-2 sm:gap-2.5">
            <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1 overflow-hidden">
              <button
                type="button"
                onClick={() => setMobileMenuOpen((prev) => !prev)}
                aria-label="Mở menu điều hướng"
                className="lg:hidden p-1.5 text-slate-600 hover:text-slate-900 rounded-lg border border-slate-200 shrink-0"
              >
                {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
              </button>

              <div className="flex items-center gap-1.5 text-xs sm:text-sm min-w-0 overflow-hidden">
                <span className="font-bold text-emerald-800 whitespace-nowrap shrink-0">
                  VTNN Tâm An
                </span>
                <span className="hidden lg:inline text-slate-300 shrink-0" aria-hidden="true">
                  /
                </span>
                <span className="hidden lg:inline font-semibold text-slate-900 whitespace-nowrap truncate">
                  {activeNavLabel}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {/* Live Firebase Realtime Database Connection Pill */}
              {isGoogleAuthenticated && (
                <span
                  title="Trạng thái đồng bộ dữ liệu thời gian thực Firebase Realtime Database (gapgold-e6b62-default-rtdb)"
                  className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border whitespace-nowrap ${
                    rtdbSyncState === 'live'
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : rtdbSyncState === 'connecting'
                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                      : 'bg-slate-100 text-slate-600 border-slate-200'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      rtdbSyncState === 'live'
                        ? 'bg-emerald-500'
                        : rtdbSyncState === 'connecting'
                        ? 'bg-amber-500'
                        : 'bg-slate-400'
                    }`}
                  />
                  <span>
                    {rtdbSyncState === 'live'
                      ? 'Realtime DB'
                      : rtdbSyncState === 'connecting'
                      ? 'Đang kết nối...'
                      : 'Ngoại tuyến'}
                  </span>
                </span>
              )}

              {/* Desktop Multi-Warehouse Selector for Primary Manager & Deputy General Manager */}
              <div className="hidden md:block">
                <MultiWarehouseFilterPopover
                  triggerId="desktop-multi-warehouse-filter"
                  allWarehouses={warehouses}
                  selectedWarehouses={selectedFilterWarehouses}
                  onChangeSelectedWarehouses={(next) => {
                    setSelectedFilterWarehouses(next);
                  }}
                  canFilterMultiWarehouses={canFilterMultiWarehouses}
                  lockedWarehouseLabel={activeWarehouseLabel}
                />
              </div>

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
                className="px-2 py-1.5 lg:px-3 lg:py-2 text-[11px] sm:text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 rounded-lg transition-colors flex items-center gap-1 sm:gap-1.5 whitespace-nowrap shrink-0"
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden lg:inline">Thoát đăng nhập</span>
                <span className="lg:hidden">Thoát</span>
              </button>

              {/* Push Notification Center Trigger */}
              <button
                type="button"
                onClick={() => setIsNotifDrawerOpen(true)}
                aria-label={`Thông báo đẩy (${unreadNotifCount} chưa đọc)`}
                className="px-2 py-1.5 lg:px-3 lg:py-2 text-[11px] sm:text-xs font-semibold text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors flex items-center gap-1 sm:gap-1.5 whitespace-nowrap shrink-0"
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
                  className="px-2.5 py-1.5 lg:px-3.5 lg:py-2 text-[11px] sm:text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <span className="sm:hidden">+ Đơn bán</span>
                  <span className="hidden sm:inline">+ Tạo đơn bán</span>
                </button>
              )}
            </div>
          </div>

          {/* Mobile Sub-Bar showing current screen & interactive multi-warehouse filter clearly */}
          <div className="md:hidden px-3 py-1.5 bg-slate-50 border-t border-slate-200/80 flex items-center justify-between gap-2 text-[11px]">
            <span className="font-semibold text-slate-800 truncate">{activeNavLabel}</span>
            <MultiWarehouseFilterPopover
              triggerId="mobile-multi-warehouse-filter"
              allWarehouses={warehouses}
              selectedWarehouses={selectedFilterWarehouses}
              onChangeSelectedWarehouses={(next) => {
                setSelectedFilterWarehouses(next);
              }}
              canFilterMultiWarehouses={canFilterMultiWarehouses}
              lockedWarehouseLabel={activeWarehouseLabel}
              compact
            />
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
              {/* Brand Hero Banner + Admin / Single-Warehouse Status Indicator */}
              <div className="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-start sm:items-center gap-3.5 sm:gap-4">
                  <img
                    src="/assets/logo-taman.png"
                    alt="Logo Vật tư Nông nghiệp Tâm An"
                    referrerPolicy="no-referrer"
                    className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl object-contain border border-slate-200 p-1 shrink-0 bg-white"
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {isAdminAccount ? (
                        <span className="px-2.5 py-0.5 text-xs font-bold bg-emerald-700 text-white rounded-md flex items-center gap-1">
                          <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                          <span>Quản lý chính · Toàn bộ các kho</span>
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 text-xs font-bold bg-emerald-700 text-white rounded-md flex items-center gap-1">
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
                      if (isAdminAccount) {
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
                    <span>
                      {isAdminAccount
                        ? 'Mở Bảng Phân Quyền Kho'
                        : `Đổi tên hiển thị kho (${currentStaff.assignedWarehouse})`}
                    </span>
                  </button>
                </div>
              </div>

              {/* Quick Warehouse Assignment Dashboard (Visible when Primary Manager Gu6OYdsdiWbRvbEINqaWZXj3LV83 is logged in) */}
              {isAdminAccount && (
                <div className="bg-white rounded-xl border border-emerald-200 overflow-hidden shadow-2xs">
                  <div className="px-4 sm:px-5 py-3 bg-emerald-50/80 border-b border-emerald-200 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
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
                      return (
                        <div
                          key={`dash-admin-${st.uid}`}
                          className={`p-3 rounded-xl border flex flex-col justify-between gap-2 text-xs ${
                            isRowAdmin
                              ? 'bg-emerald-50/50 border-emerald-300'
                              : 'bg-slate-50/70 border-slate-200'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="font-bold text-slate-900 truncate">
                                {st.displayName}
                              </span>
                              <span className="px-1.5 py-0.5 text-[10px] font-bold rounded shrink-0 bg-emerald-100 text-emerald-900">
                                {isRowAdmin ? 'Tất cả kho' : '1 Kho'}
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
              warehouses={warehouses}
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
              warehouses={warehouses}
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

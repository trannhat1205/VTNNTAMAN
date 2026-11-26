import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FolderPlus,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  MessageSquareCode,
  Phone,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UserCog,
  UserPlus,
  Warehouse,
  X,
} from 'lucide-react';
import {
  StaffFunctionalPermission,
  StaffMember,
  StaffPositionRole,
  UserRole,
} from '../types';
import { ADMIN_BACKUP_EMAIL, ADMIN_PRIMARY_PHONE, PRIMARY_ADMIN_UID } from '../data/seedData';
import { SearchableSelect } from './SearchableSelect';
import { InitialLoginScreenPortal, PasswordInputWithEye } from './InitialLoginScreenPortal';
export { InitialLoginScreenPortal, PasswordInputWithEye };
import {
  ALL_STAFF_FUNCTIONAL_PERMISSIONS,
  canAccountCreateStaff,
  canStaffRenameWarehouse,
  dedupeWarehouseNames,
  extractCustomWarehouseSuffix,
  formatDefaultWarehouseNameFromGmail,
  formatVND,
  getDefaultPermissionsForPosition,
  getPositionRoleLabel,
  getSelfWarehouseRenameCount,
  hasCompletedStaffPersonalGmail,
  hasMultiWarehouseManagementGrant,
  MANDATORY_WAREHOUSE_PREFIX,
  normalizeCustomTamAnWarehouseName,
  normalizeVietnameseSearch,
  normalizeWarehouseKey,
  resolveCanonicalSelectWarehouseValue,
  SearchableOptionItem,
} from '../utils/businessLogic';
import { AdminWarehouseAccountSummary } from '../utils/rtdbSyncLogic';

export interface GmailRecoveryLog {
  id: string;
  username: string;
  displayName: string;
  recipientGmail: string;
  newPasswordIssued: string;
  sentAt: string;
}

interface StaffAccountManagerProps {
  staffList: StaffMember[];
  currentStaff: StaffMember;
  warehouses: string[];
  isGoogleAuthenticated?: boolean;
  currentUserEmail?: string | null;
  onGoogleManagerLogin?: () => Promise<{ ok: boolean; message: string } | void> | void;
  onGoogleLoginByEmail?: (
    email: string,
    googleDisplayName?: string,
    googleUid?: string
  ) => { ok: boolean; message: string };
  onAddWarehouse: (warehouseName: string) => void;
  onChangePassword: (
    uid: string,
    currentPass: string,
    newPass: string
  ) => Promise<{ ok: boolean; message: string }> | { ok: boolean; message: string };
  onCreateStaffAccount: (payload: {
    username: string;
    password: string;
    displayName: string;
    phone: string;
    email: string;
    role: UserRole;
    positionRole: StaffPositionRole;
    permissions: StaffFunctionalPermission[];
    assignedWarehouse: string;
  }) => Promise<{ ok: boolean; message: string }> | { ok: boolean; message: string };
  onUpdateStaffWarehouse: (uid: string, warehouseName: string) => void;
  onUpdateStaffMultiWarehouses?: (
    uid: string,
    selectedWarehouses: string[],
    grantAllWarehouses: boolean
  ) => void;
  onUpdateStaffPermissions?: (
    uid: string,
    positionRole: StaffPositionRole,
    permissions: StaffFunctionalPermission[],
    assignedWarehouse: string,
    assignedWarehouses?: string[]
  ) => void;
  onResetStaffPasswordByManager: (uid: string, newPass: string) => Promise<void> | void;
  onToggleStaffActive: (uid: string) => void;
  onUpdateStaffProfile: (payload: {
    uid: string;
    displayName: string;
    phone: string;
    email: string;
    newPassword?: string;
    customWarehouseName?: string;
  }) => Promise<{ ok: boolean; message: string }> | { ok: boolean; message: string };
  isSessionLoggedIn?: boolean;
  onLogout?: () => void;
  rtdbSyncState?: 'connecting' | 'live' | 'offline';
  adminWorkspaceSummaries?: AdminWarehouseAccountSummary[];
  onInspectWarehouse?: (warehouseName: string) => void;
}

export const StaffAccountManager: React.FC<StaffAccountManagerProps> = ({
  staffList,
  currentStaff,
  warehouses,
  onAddWarehouse,
  onChangePassword,
  onCreateStaffAccount,
  onUpdateStaffWarehouse,
  onUpdateStaffMultiWarehouses,
  onUpdateStaffPermissions,
  onResetStaffPasswordByManager,
  onToggleStaffActive,
  onUpdateStaffProfile,
  onLogout,
  rtdbSyncState = 'connecting',
  adminWorkspaceSummaries = [],
  onInspectWarehouse,
}) => {
  // Personal Profile & Gmail Supplementation State ("Chỉnh sửa thông tin cá nhân — Bổ sung Gmail nhân viên")
  const [personalTargetUid, setPersonalTargetUid] = useState<string>(currentStaff.uid);
  const targetPersonalStaff = useMemo(
    () => staffList.find((s) => s.uid === personalTargetUid) || currentStaff,
    [staffList, personalTargetUid, currentStaff]
  );
  const [personalDisplayName, setPersonalDisplayName] = useState<string>(
    currentStaff.displayName
  );
  const [personalEmail, setPersonalEmail] = useState<string>(currentStaff.email || '');
  const [personalPhone, setPersonalPhone] = useState<string>(currentStaff.phone || '');
  const [personalNewPassword, setPersonalNewPassword] = useState<string>('');
  const [personalWarehouseSuffix, setPersonalWarehouseSuffix] = useState<string>(() =>
    extractCustomWarehouseSuffix(currentStaff.assignedWarehouse)
  );
  const [personalProfileFeedback, setPersonalProfileFeedback] = useState<{
    type: 'error' | 'success';
    text: string;
  } | null>(null);

  useEffect(() => {
    setPersonalTargetUid(currentStaff.uid);
  }, [currentStaff.uid]);

  useEffect(() => {
    setPersonalDisplayName(targetPersonalStaff.displayName);
    setPersonalEmail(targetPersonalStaff.email || '');
    setPersonalPhone(targetPersonalStaff.phone || '');
    setPersonalWarehouseSuffix(
      extractCustomWarehouseSuffix(targetPersonalStaff.assignedWarehouse)
    );
    setPersonalNewPassword('');
  }, [
    targetPersonalStaff.uid,
    targetPersonalStaff.displayName,
    targetPersonalStaff.email,
    targetPersonalStaff.phone,
    targetPersonalStaff.assignedWarehouse,
  ]);

  // Change Password State (for currently logged-in staff/manager)
  const [oldPass, setOldPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [passFeedback, setPassFeedback] = useState<{
    type: 'error' | 'success';
    text: string;
  } | null>(null);

  // Manager Create New Staff Account State
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newInitialPassword, setNewInitialPassword] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPositionRole, setNewPositionRole] = useState<StaffPositionRole>('warehouse_manager');
  const [newSelectedPermissions, setNewSelectedPermissions] = useState<StaffFunctionalPermission[]>(
    () => getDefaultPermissionsForPosition('warehouse_manager')
  );
  const [newAssignedWarehouse, setNewAssignedWarehouse] = useState<string>('');
  const [showNewWarehouseInput, setShowNewWarehouseInput] = useState<boolean>(false);
  const [inlineWarehouseName, setInlineWarehouseName] = useState<string>('');
  const [createFeedback, setCreateFeedback] = useState<{
    type: 'error' | 'success';
    text: string;
  } | null>(null);

  // Real-time permission update banner
  const [realtimeBanner, setRealtimeBanner] = useState<string | null>(null);

  // Manager Reset Password Modal State
  const [resettingStaff, setResettingStaff] = useState<StaffMember | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');

  // Edit Staff Profile Modal State
  const [editingStaffModal, setEditingStaffModal] = useState<StaffMember | null>(null);
  const [modalDisplayName, setModalDisplayName] = useState('');
  const [modalPhone, setModalPhone] = useState('');
  const [modalEmail, setModalEmail] = useState('');
  const [modalPassword, setModalPassword] = useState('');
  const [modalWarehouseSuffix, setModalWarehouseSuffix] = useState('');

  // Primary Manager Edit Staff [X] Roles & Permissions Modal State
  const [permissionModalStaff, setPermissionModalStaff] = useState<StaffMember | null>(null);
  const [permModalPosition, setPermModalPosition] =
    useState<StaffPositionRole>('warehouse_manager');
  const [permModalList, setPermModalList] = useState<StaffFunctionalPermission[]>([]);
  const [permModalWarehouse, setPermModalWarehouse] = useState<string>('');
  const [permModalMultiWarehouses, setPermModalMultiWarehouses] = useState<string[]>([]);

  // Primary Manager Dedicated Multi-Warehouse Assignment Modal ("Cấp quyền quản lý nhiều kho")
  const [multiWhModalStaff, setMultiWhModalStaff] = useState<StaffMember | null>(null);
  const [multiWhSelectedList, setMultiWhSelectedList] = useState<string[]>([]);
  const [multiWhGrantAll, setMultiWhGrantAll] = useState<boolean>(false);
  const [multiWhSearch, setMultiWhSearch] = useState<string>('');

  const canonicalWarehouses = useMemo(
    () =>
      dedupeWarehouseNames([
        ...warehouses,
        ...staffList.map((s) => s.assignedWarehouse),
        ...staffList.flatMap((s) => s.assignedWarehouses || []),
      ]),
    [warehouses, staffList]
  );

  const selfRenameStatus = useMemo(
    () => canStaffRenameWarehouse(currentStaff, currentStaff),
    [currentStaff]
  );

  const personalTargetRenameStatus = useMemo(
    () => canStaffRenameWarehouse(targetPersonalStaff, currentStaff),
    [targetPersonalStaff, currentStaff]
  );

  const summaryByWarehouseKey = useMemo(() => {
    const map = new Map<string, { owners: string[]; products: number; sales: number }>();
    for (const s of adminWorkspaceSummaries) {
      const key = normalizeWarehouseKey(s.assignedWarehouse);
      if (!key || s.assignedWarehouse === 'Tất cả kho') continue;
      const prev = map.get(key) || { owners: [], products: 0, sales: 0 };
      if (s.username && !prev.owners.includes(`@${s.username}`)) {
        prev.owners.push(`@${s.username}`);
      }
      prev.products += Number(s.productsCount) || 0;
      prev.sales += Number(s.salesCount) || 0;
      map.set(key, prev);
    }
    return map;
  }, [adminWorkspaceSummaries]);

  const openMultiWarehouseModal = (st: StaffMember) => {
    setMultiWhModalStaff(st);
    setMultiWhSearch('');
    const isAll =
      st.assignedWarehouse === 'Tất cả kho' ||
      Boolean(st.permissions?.includes('manage_all_warehouses')) ||
      st.positionRole === 'deputy_general_manager';
    setMultiWhGrantAll(isAll);
    const canonicalByKey = new Map(
      canonicalWarehouses.map((w) => [normalizeWarehouseKey(w), w])
    );
    const rawList =
      st.assignedWarehouses && st.assignedWarehouses.length > 0
        ? st.assignedWarehouses
        : st.assignedWarehouse && st.assignedWarehouse !== 'Tất cả kho'
        ? [st.assignedWarehouse]
        : [];
    const mapped = dedupeWarehouseNames(
      rawList.map((w) => canonicalByKey.get(normalizeWarehouseKey(w)) || w)
    );
    setMultiWhSelectedList(mapped);
  };

  // Strict check: ONLY trannhat1205@gmail.com or phone 0393120246 can create accounts & assign permissions
  const canCreateAndAssignRoles = canAccountCreateStaff(currentStaff);

  // For non-primary staff, only show their own record so they only see what belongs to their account
  const visibleStaffRows = useMemo(
    () =>
      canCreateAndAssignRoles
        ? staffList
        : staffList.filter((s) => s.uid === currentStaff.uid),
    [canCreateAndAssignRoles, staffList, currentStaff.uid]
  );

  const currentAccountPerms = useMemo(
    () =>
      currentStaff.permissions ||
      getDefaultPermissionsForPosition(currentStaff.positionRole || 'sales_warehouse_staff'),
    [currentStaff]
  );

  const warehouseSelectOptions = useMemo<SearchableOptionItem[]>(
    () =>
      warehouses.map((w) => ({
        value: w,
        label: w,
        subLabel: 'Kho vật tư nông nghiệp Tâm An',
        badge: 'Kho riêng',
      })),
    [warehouses]
  );

  const togglePermissionInCreateForm = (permKey: StaffFunctionalPermission) => {
    setNewSelectedPermissions((prev) =>
      prev.includes(permKey) ? prev.filter((k) => k !== permKey) : [...prev, permKey]
    );
  };

  const togglePermissionInModal = (permKey: StaffFunctionalPermission) => {
    setPermModalList((prev) =>
      prev.includes(permKey) ? prev.filter((k) => k !== permKey) : [...prev, permKey]
    );
  };

  // Direct 1-click real-time [X] permission toggle for Primary Manager right on any staff card/row
  const handleInstantTogglePermission = (
    targetStaff: StaffMember,
    permKey: StaffFunctionalPermission
  ) => {
    if (!canCreateAndAssignRoles || !onUpdateStaffPermissions) return;
    const isMultiWh = hasMultiWarehouseManagementGrant(targetStaff);
    if (permKey === 'edit_delete_vouchers' && !isMultiWh) {
      setRealtimeBanner(
        `Chỉ tài khoản được Admin chính cấp quyền Quản lý nhiều kho mới có tính năng Sửa / Xóa phiếu. Hãy bấm "Cấp nhiều kho" cho @${targetStaff.username} trước!`
      );
      openMultiWarehouseModal(targetStaff);
      return;
    }
    const currentPerms =
      targetStaff.permissions ||
      getDefaultPermissionsForPosition(targetStaff.positionRole || 'warehouse_manager');
    const exists = currentPerms.includes(permKey);
    const nextPerms = exists
      ? currentPerms.filter((p) => p !== permKey)
      : [...currentPerms, permKey];
    const resolvedPos = targetStaff.positionRole || 'warehouse_manager';
    onUpdateStaffPermissions(
      targetStaff.uid,
      resolvedPos,
      nextPerms,
      targetStaff.assignedWarehouse,
      targetStaff.assignedWarehouses
    );
    const permLabel =
      ALL_STAFF_FUNCTIONAL_PERMISSIONS.find((p) => p.key === permKey)?.label || permKey;
    setRealtimeBanner(
      `Đã cập nhật thời gian thực cho @${targetStaff.username}: ${
        exists ? 'Tắt [ ]' : 'Bật [X]'
      } "${permLabel}"`
    );
  };

  const handlePositionRoleChange = (pos: StaffPositionRole) => {
    setNewPositionRole(pos);
    setNewSelectedPermissions(getDefaultPermissionsForPosition(pos));
    if (pos === 'deputy_general_manager' || pos === 'primary_manager') {
      setNewAssignedWarehouse('Tất cả kho');
      setShowNewWarehouseInput(false);
    } else if (newAssignedWarehouse === 'Tất cả kho') {
      setNewAssignedWarehouse('');
    }
  };

  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPass.length < 4) {
      setPassFeedback({
        type: 'error',
        text: 'Mật khẩu mới phải có ít nhất 4 ký tự.',
      });
      return;
    }
    if (newPass !== confirmPass) {
      setPassFeedback({
        type: 'error',
        text: 'Mật khẩu xác nhận không khớp với mật khẩu mới.',
      });
      return;
    }
    const res = await onChangePassword(currentStaff.uid, oldPass, newPass);
    setPassFeedback({
      type: res.ok ? 'success' : 'error',
      text: res.message,
    });
    if (res.ok) {
      setOldPass('');
      setNewPass('');
      setConfirmPass('');
    }
  };

  const handlePersonalGmailSupplementSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onUpdateStaffProfile) return;
    const trimmedEmail = personalEmail.trim().toLowerCase();
    const trimmedPhone = personalPhone.trim();
    const trimmedName = personalDisplayName.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setPersonalProfileFeedback({
        type: 'error',
        text: 'Vui lòng nhập địa chỉ Gmail cá nhân hợp lệ (VD: vtnntaman@gmail.com).',
      });
      return;
    }
    if (personalNewPassword && personalNewPassword.length < 4) {
      setPersonalProfileFeedback({
        type: 'error',
        text: 'Mật khẩu mới phải có tối thiểu 4 ký tự (hoặc để trống nếu giữ nguyên mật khẩu hiện tại).',
      });
      return;
    }

    const renamePermission = canStaffRenameWarehouse(targetPersonalStaff, currentStaff);
    const normalizedWarehouseName = renamePermission.allowed
      ? normalizeCustomTamAnWarehouseName(personalWarehouseSuffix, trimmedEmail)
      : undefined;

    const res = await onUpdateStaffProfile({
      uid: targetPersonalStaff.uid,
      displayName: trimmedName || targetPersonalStaff.displayName,
      phone: trimmedPhone,
      email: trimmedEmail,
      newPassword: personalNewPassword || undefined,
      customWarehouseName: normalizedWarehouseName,
    });
    setPersonalProfileFeedback({
      type: res.ok ? 'success' : 'error',
      text: res.ok
        ? `Đã lưu hồ sơ cá nhân cho @${targetPersonalStaff.username}${
            normalizedWarehouseName ? ` · Tên hiển thị kho: "${normalizedWarehouseName}"` : ''
          }!`
        : res.message,
    });
    if (res.ok) {
      setPersonalNewPassword('');
    }
  };

  const handleConfirmInlineWarehouse = (): string | null => {
    const trimmed = inlineWarehouseName.trim();
    if (!trimmed) return null;
    onAddWarehouse(trimmed);
    setNewAssignedWarehouse(trimmed);
    setShowNewWarehouseInput(false);
    setInlineWarehouseName('');
    return trimmed;
  };

  const handleCreateAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreateAndAssignRoles) {
      setCreateFeedback({
        type: 'error',
        text: `Chỉ tài khoản Quản lý chính (${ADMIN_BACKUP_EMAIL} hoặc SĐT ${ADMIN_PRIMARY_PHONE}) mới có quyền tạo tài khoản và phân quyền cho nhân sự.`,
      });
      return;
    }

    let resolvedWarehouse = newAssignedWarehouse;
    if (showNewWarehouseInput || newAssignedWarehouse === '__new_warehouse__') {
      const createdWh = handleConfirmInlineWarehouse();
      if (createdWh) resolvedWarehouse = createdWh;
    }

    const isAllWarehouseRole =
      newPositionRole === 'deputy_general_manager' ||
      newPositionRole === 'primary_manager' ||
      newSelectedPermissions.includes('manage_all_warehouses');

    if (isAllWarehouseRole) {
      resolvedWarehouse = 'Tất cả kho';
    } else if (!resolvedWarehouse || resolvedWarehouse === '__new_warehouse__') {
      resolvedWarehouse = warehouses[0] || 'Tâm An Mỹ Ngãi';
    }

    const resolvedSystemRole: UserRole =
      isAllWarehouseRole || newSelectedPermissions.includes('edit_delete_vouchers')
        ? 'manager'
        : 'staff';

    const res = await onCreateStaffAccount({
      username: newUsername.trim(),
      password: newInitialPassword,
      displayName: newDisplayName.trim(),
      phone: newPhone.trim(),
      email: newEmail.trim(),
      role: resolvedSystemRole,
      positionRole: newPositionRole,
      permissions: newSelectedPermissions,
      assignedWarehouse: resolvedWarehouse,
    });
    setCreateFeedback({
      type: res.ok ? 'success' : 'error',
      text: res.message,
    });
    if (res.ok) {
      setNewDisplayName('');
      setNewUsername('');
      setNewInitialPassword('');
      setNewPhone('');
      setNewEmail('');
      setNewPositionRole('warehouse_manager');
      setNewSelectedPermissions(getDefaultPermissionsForPosition('warehouse_manager'));
      setNewAssignedWarehouse('');
      setShowNewWarehouseInput(false);
      setInlineWarehouseName('');
    }
  };

  const isCreatingAllWarehouseRole =
    newPositionRole === 'deputy_general_manager' ||
    newPositionRole === 'primary_manager' ||
    newSelectedPermissions.includes('manage_all_warehouses');

  return (
    <div className="space-y-6">
      {/* Logged-in Account Status & Warehouse Scope Banner */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1.5 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {canCreateAndAssignRoles ? (
              <span className="px-2.5 py-0.5 text-[11px] font-bold bg-emerald-700 text-white rounded-md flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                <span>Quản lý chính · Toàn bộ các kho</span>
              </span>
            ) : hasMultiWarehouseManagementGrant(currentStaff) ? (
              <span className="px-2.5 py-0.5 text-[11px] font-bold bg-teal-700 text-white rounded-md flex items-center gap-1">
                <Warehouse className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {currentStaff.assignedWarehouse === 'Tất cả kho' ||
                  currentStaff.permissions?.includes('manage_all_warehouses')
                    ? 'Phó quản lý · Tất cả kho (Sửa/Xóa)'
                    : `Quản lý ${dedupeWarehouseNames(currentStaff.assignedWarehouses || []).length} kho được cấp (Sửa/Xóa)`}
                </span>
              </span>
            ) : (
              <span className="px-2.5 py-0.5 text-[11px] font-bold bg-emerald-700 text-white rounded-md flex items-center gap-1">
                <Warehouse className="w-3.5 h-3.5 shrink-0" />
                <span>Quản lý 1 kho độc lập</span>
              </span>
            )}
            <span className="px-2.5 py-0.5 text-[11px] font-bold bg-emerald-100 text-emerald-900 rounded-md">
              Đang đăng nhập: @{currentStaff.username}
            </span>
            <span className="text-xs font-mono font-bold text-emerald-900 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-200">
              {canCreateAndAssignRoles
                ? `Quản trị tổng: ${currentStaff.assignedWarehouse}`
                : hasMultiWarehouseManagementGrant(currentStaff)
                ? currentStaff.assignedWarehouses && currentStaff.assignedWarehouses.length >= 2
                  ? `Phạm vi: ${dedupeWarehouseNames(currentStaff.assignedWarehouses).join(', ')}`
                  : `Phạm vi: ${currentStaff.assignedWarehouse}`
                : `Quản lý 1 kho: ${currentStaff.assignedWarehouse}`}
            </span>
            {canCreateAndAssignRoles && (
              <span className="text-[11px] font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 break-all">
                UID: {PRIMARY_ADMIN_UID}
              </span>
            )}
          </div>
          <h2 className="text-base font-bold text-slate-900 flex flex-wrap items-center gap-2">
            <span>{currentStaff.displayName}</span>
            {canCreateAndAssignRoles && (
              <span className="text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                Toàn quyền đọc/ghi &amp; Phân quyền kho
              </span>
            )}
          </h2>
          {canCreateAndAssignRoles && (
            <p className="text-xs text-slate-600">
              Tài khoản Quản lý chính có toàn quyền xem dữ liệu tất cả người dùng/kho và phân quyền quản lý kho cho bất kỳ tài khoản người dùng nào.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="w-full sm:w-auto justify-center px-3.5 py-2 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span>Thoát đăng nhập</span>
            </button>
          )}
        </div>
      </div>

      {/* Quick Self-Service Warehouse Rename Card for Independent Single-Warehouse Owners */}
      {!canCreateAndAssignRoles &&
        !hasMultiWarehouseManagementGrant(currentStaff) &&
        currentStaff.assignedWarehouse !== 'Tất cả kho' && (
          <div className="bg-white rounded-xl border border-emerald-200 overflow-hidden shadow-xs">
            <div className="px-5 py-3.5 bg-emerald-50/80 border-b border-emerald-200 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Warehouse className="w-4 h-4 text-emerald-700 shrink-0" />
                <h3 className="text-sm font-bold text-slate-900">
                  Tên Kho Riêng Của Bạn ({MANDATORY_WAREHOUSE_PREFIX} + TÊN SỬA ĐỔI)
                </h3>
              </div>
              {selfRenameStatus.allowed ? (
                <span className="px-2.5 py-0.5 text-[11px] font-bold bg-amber-600 text-white rounded">
                  Được đổi 1 lần duy nhất (còn 1/1 lượt)
                </span>
              ) : (
                <span className="px-2.5 py-0.5 text-[11px] font-bold bg-slate-700 text-white rounded flex items-center gap-1">
                  <Lock className="w-3 h-3 shrink-0" />
                  <span>Đã khóa đổi tên kho (1/1)</span>
                </span>
              )}
            </div>
            {selfRenameStatus.allowed ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const normalizedWh = normalizeCustomTamAnWarehouseName(
                    personalWarehouseSuffix,
                    currentStaff.email
                  );
                  const res = await onUpdateStaffProfile({
                    uid: currentStaff.uid,
                    displayName: personalDisplayName.trim() || currentStaff.displayName,
                    phone: personalPhone.trim(),
                    email: personalEmail.trim() || currentStaff.email || '',
                    customWarehouseName: normalizedWh,
                  });
                  setRealtimeBanner(res.message);
                }}
                className="p-4 sm:p-5 flex flex-col md:flex-row md:items-end gap-3"
              >
                <div className="flex-1 min-w-0 space-y-1">
                  <label
                    htmlFor="quick-self-warehouse-suffix"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Đổi tên kho 1 lần duy nhất (giữ nguyên tiền tố{' '}
                    <strong>{MANDATORY_WAREHOUSE_PREFIX}</strong>; sau khi lưu chỉ Quản lý chính mới có quyền đổi lại):
                  </label>
                  <div className="flex items-stretch rounded-lg overflow-hidden border border-emerald-400 bg-white">
                    <span className="px-3 py-2 text-xs font-mono font-extrabold bg-emerald-800 text-white flex items-center select-none shrink-0">
                      {MANDATORY_WAREHOUSE_PREFIX}
                    </span>
                    <input
                      id="quick-self-warehouse-suffix"
                      type="text"
                      required
                      value={personalWarehouseSuffix}
                      onChange={(e) => setPersonalWarehouseSuffix(e.target.value)}
                      placeholder="VD: BA SAO, MỸ AN..."
                      className="flex-1 min-w-0 px-3 py-2 text-xs font-mono font-bold text-slate-900 bg-white focus:outline-none uppercase"
                    />
                  </div>
                  <div className="text-[11px] text-emerald-800">
                    Tên hiển thị &amp; đồng bộ RTDB:{' '}
                    <strong>
                      {normalizeCustomTamAnWarehouseName(personalWarehouseSuffix, currentStaff.email)}
                    </strong>
                  </div>
                </div>
                <button
                  type="submit"
                  className="px-4 py-2.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg whitespace-nowrap shrink-0"
                >
                  Lưu tên kho mới (1 lần)
                </button>
              </form>
            ) : (
              <div className="p-4 sm:p-5 bg-amber-50/60 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-start gap-2.5 min-w-0">
                  <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <div className="font-bold text-slate-900">
                      Tên kho hiện tại:{' '}
                      <span className="font-mono text-emerald-900 bg-white px-2 py-0.5 rounded border border-emerald-300">
                        {currentStaff.assignedWarehouse}
                      </span>
                    </div>
                    <p className="text-amber-900">
                      Tài khoản của bạn đã sử dụng hết <strong>1/1 lần đổi tên kho</strong>. Chỉ tài khoản{' '}
                      <strong>Quản lý chính ({ADMIN_BACKUP_EMAIL})</strong> mới có quyền thay đổi lại tên kho.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

      {/* Quick Warehouse Assignment Panel for Primary Manager (Gu6OYdsdiWbRvbEINqaWZXj3LV83) */}
      {canCreateAndAssignRoles && (
        <div
          id="admin-warehouse-assignment-dashboard"
          className="bg-white rounded-xl border border-emerald-200 overflow-hidden shadow-xs"
        >
          <div className="px-4 sm:px-5 py-3.5 bg-emerald-50/80 border-b border-emerald-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
              <h3 className="text-sm sm:text-base font-bold text-slate-900">
                Bảng Phân Quyền Quản Lý Kho Cho Người Dùng
              </h3>
            </div>
            <span className="text-xs font-mono text-emerald-900 bg-white px-2.5 py-1 rounded-md border border-emerald-200 font-semibold break-all">
              UID: {PRIMARY_ADMIN_UID}
            </span>
          </div>

          <div className="p-3.5 sm:p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-xs text-slate-700 space-y-0.5 min-w-0">
                <div className="font-bold text-slate-900">
                  Phân quyền nhanh kho quản lý cho tài khoản người dùng bất kỳ ({staffList.length} tài khoản · {warehouses.length} kho)
                </div>
                <div>
                  Người quản lý chính có thể chọn bất kỳ tài khoản người dùng nào bên dưới để gán hoặc chuyển quyền quản lý kho ngay lập tức.
                </div>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full lg:w-auto shrink-0">
                <input
                  type="text"
                  value={inlineWarehouseName}
                  onChange={(e) => setInlineWarehouseName(e.target.value)}
                  placeholder="Tên kho mới (VD: BA SAO)..."
                  className="w-full sm:w-56 min-w-0 flex-1 px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg font-mono"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!inlineWarehouseName.trim()) return;
                    const formatted = normalizeCustomTamAnWarehouseName(inlineWarehouseName);
                    onAddWarehouse(formatted);
                    setInlineWarehouseName('');
                    setRealtimeBanner(`Đã tạo kho mới: "${formatted}"`);
                  }}
                  className="w-full sm:w-auto px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg whitespace-nowrap text-center justify-center flex items-center"
                >
                  + Thêm kho TÂM AN
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {staffList.map((st) => {
                const isRowAdmin = canAccountCreateStaff(st);
                const rowHasMultiWh = hasMultiWarehouseManagementGrant(st);
                const rowMultiList = st.assignedWarehouses || [];
                const isRowAllWh =
                  isRowAdmin ||
                  st.assignedWarehouse === 'Tất cả kho' ||
                  Boolean(st.permissions?.includes('manage_all_warehouses'));
                return (
                  <div
                    key={`admin-assign-${st.uid}`}
                    className={`p-3.5 rounded-xl border flex flex-col justify-between gap-2.5 ${
                      isRowAdmin
                        ? 'bg-emerald-50/50 border-emerald-300'
                        : rowHasMultiWh
                        ? 'bg-teal-50/40 border-teal-300'
                        : 'bg-white border-slate-200 hover:border-emerald-300'
                    }`}
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-xs text-slate-900 truncate">
                          {st.displayName}
                        </span>
                        {isRowAdmin ? (
                          <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-700 text-white rounded shrink-0">
                            Admin · Tất cả kho
                          </span>
                        ) : isRowAllWh ? (
                          <span className="px-2 py-0.5 text-[10px] font-bold bg-teal-700 text-white rounded shrink-0">
                            Tất cả kho · Sửa/Xóa
                          </span>
                        ) : rowMultiList.length >= 2 ? (
                          <span className="px-2 py-0.5 text-[10px] font-bold bg-teal-700 text-white rounded shrink-0">
                            {rowMultiList.length} kho · Sửa/Xóa
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200 rounded shrink-0">
                            1 kho · Khóa Sửa/Xóa
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 truncate">
                        @{st.username} · {st.email || 'Chưa có Gmail'}
                      </div>
                      {!isRowAdmin && rowMultiList.length >= 2 && (
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {rowMultiList.map((wh) => (
                            <span
                              key={wh}
                              className="px-1.5 py-0.5 text-[10px] font-semibold bg-white text-teal-900 border border-teal-200 rounded"
                            >
                              {wh}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="pt-1 border-t border-slate-100 flex items-center justify-between gap-1.5">
                      {isRowAdmin ? (
                        <>
                          <span className="text-[11px] font-semibold text-slate-600">
                            Kho quản lý:
                          </span>
                          <span className="text-xs font-bold text-emerald-900">Tất cả kho</span>
                        </>
                      ) : (
                        <>
                          <select
                            aria-label={`Phân quyền kho cho ${st.username}`}
                            value={
                              isRowAllWh
                                ? 'Tất cả kho'
                                : resolveCanonicalSelectWarehouseValue(
                                    st.assignedWarehouse,
                                    canonicalWarehouses
                                  )
                            }
                            onChange={(e) => {
                              onUpdateStaffWarehouse(st.uid, e.target.value);
                              setRealtimeBanner(
                                `Đã phân quyền kho "${e.target.value}" cho @${st.username} (${st.displayName})`
                              );
                            }}
                            className="flex-1 min-w-0 px-2 py-1.5 text-xs font-bold bg-emerald-50 border border-emerald-300 rounded-lg text-emerald-950"
                          >
                            {canonicalWarehouses.map((w) => (
                              <option key={w} value={w}>
                                {w}
                              </option>
                            ))}
                            <option value="Tất cả kho">Tất cả kho (Phó quản lý tổng)</option>
                          </select>
                          {onUpdateStaffMultiWarehouses && (
                            <button
                              type="button"
                              onClick={() => openMultiWarehouseModal(st)}
                              title="Chọn nhiều kho chỉ định cho tài khoản này (tự mở quyền Sửa/Xóa phiếu)"
                              className="px-2.5 py-1.5 text-[11px] font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-lg whitespace-nowrap shrink-0"
                            >
                              Cấp nhiều kho
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Real-Time Firebase RTDB Cross-Warehouse & User Monitoring Table (Primary Admin Exclusive) */}
            <div className="mt-4 pt-4 border-t border-emerald-200/80 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center gap-2">
                    <span
                      className={`inline-block w-2.5 h-2.5 rounded-full ${
                        rtdbSyncState === 'live'
                          ? 'bg-emerald-500'
                          : rtdbSyncState === 'connecting'
                          ? 'bg-amber-500'
                          : 'bg-slate-400'
                      }`}
                    />
                    <span>
                      Giám sát Dữ liệu Thời gian thực Tất cả Tài khoản Kho &amp; Người dùng (Realtime DB)
                    </span>
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Mọi đơn bán, phiếu nhập, phiếu thu/chi, tồn kho và hồ sơ người dùng từ từng tài khoản kho được đồng bộ trực tiếp về gapgold-e6b62-default-rtdb.
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-900 border border-emerald-200">
                  {rtdbSyncState === 'live'
                    ? 'Đang kết nối Realtime DB'
                    : rtdbSyncState === 'connecting'
                    ? 'Đang đồng bộ Realtime DB...'
                    : 'Chế độ ngoại tuyến'}
                </span>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-left border-collapse text-xs min-w-[820px]">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">Tài khoản &amp; Người dùng</th>
                      <th className="py-2.5 px-3">Kho phụ trách</th>
                      <th className="py-2.5 px-3 text-right">Vật tư / KH</th>
                      <th className="py-2.5 px-3 text-right">Đơn bán &amp; Doanh thu</th>
                      <th className="py-2.5 px-3 text-right">Nợ KH / Nợ NCC</th>
                      <th className="py-2.5 px-3 text-right">Thu / Chi / In</th>
                      <th className="py-2.5 px-3 text-right">Đồng bộ cuối</th>
                      <th className="py-2.5 px-3 text-center">Kiểm tra</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {adminWorkspaceSummaries.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-4 px-3 text-center text-slate-500">
                          Đang tải danh sách dữ liệu thời gian thực từ Firebase Realtime Database...
                        </td>
                      </tr>
                    ) : (
                      adminWorkspaceSummaries.map((item) => (
                        <tr key={`rtdb-sum-${item.uid}`} className="hover:bg-emerald-50/40">
                          <td className="py-2.5 px-3">
                            <div className="font-bold text-slate-900 flex items-center gap-1.5">
                              <span>{item.displayName}</span>
                              {item.isPrimaryAdmin && (
                                <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-700 text-white rounded">
                                  Admin Chính
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500">
                              @{item.username} · {item.email || item.phone || item.uid.slice(0, 10)}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-emerald-900">
                            {item.assignedWarehouse}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono">
                            {item.productsCount} VT · {item.customersCount} KH
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <div className="font-bold text-slate-900 font-mono">
                              {formatVND(item.salesRevenue)}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {item.salesCount} đơn bán · {item.importsCount} nhập
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono">
                            <div className="text-amber-700 font-semibold">
                              KH: {formatVND(item.customerDebtTotal)}
                            </div>
                            <div className="text-rose-700 text-[11px]">
                              NCC: {formatVND(item.supplierDebtTotal)}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                            {item.receiptVouchersCount} PT · {item.paymentVouchersCount} PC ·{' '}
                            {item.savedVouchersCount} In
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-[11px] text-slate-500">
                            {item.lastSyncedAt
                              ? item.lastSyncedAt.slice(0, 19).replace('T', ' ')
                              : 'Chưa có phát sinh'}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            {onInspectWarehouse && (
                              <button
                                type="button"
                                onClick={() => onInspectWarehouse(item.assignedWarehouse)}
                                className="px-2.5 py-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md whitespace-nowrap"
                              >
                                Xem dữ liệu
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {realtimeBanner && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-300 text-xs font-semibold text-emerald-900 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{realtimeBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setRealtimeBanner(null)}
            className="text-emerald-800 hover:underline text-[11px]"
          >
            Đóng
          </button>
        </div>
      )}

      {/* Main Content: If Primary Manager -> Full Create + Real-Time Permission Matrix; If Staff -> Scoped Personal Account View */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {canCreateAndAssignRoles && (
          <div
            id="manager-create-staff-section"
            className="xl:col-span-5 bg-white rounded-xl border border-slate-200 overflow-hidden"
          >
            <div className="px-5 sm:px-6 py-4 border-b border-slate-200 bg-slate-50/60">
              <h3 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>
                  Tạo Tài Khoản & Đánh Dấu [X] Phân Quyền
                </span>
              </h3>
            </div>

            <form onSubmit={handleCreateAccountSubmit} className="p-5 sm:p-6 space-y-4">
              {createFeedback && (
                <div
                  className={`p-3 rounded-lg border text-xs font-medium flex items-center gap-2 ${
                    createFeedback.type === 'error'
                      ? 'bg-red-50 border-red-200 text-red-700'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  }`}
                >
                  {createFeedback.type === 'error' ? (
                    <AlertCircle className="w-4 h-4 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  )}
                  <span>{createFeedback.text}</span>
                </div>
              )}

              <div>
                <label
                  htmlFor="create-staff-fullname"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Họ và tên nhân sự *
                </label>
                <input
                  id="create-staff-fullname"
                  type="text"
                  required
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  placeholder="VD: Trần Minh Khoa (Kế toán công nợ / Quản lý kho)"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="create-staff-username"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Tên đăng nhập cấp (Username) *
                  </label>
                  <input
                    id="create-staff-username"
                    type="text"
                    required
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="VD: khoa_ketoan"
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="create-staff-password"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Mật khẩu cấp ban đầu *
                  </label>
                  <PasswordInputWithEye
                    id="create-staff-password"
                    required
                    defaultVisible={true}
                    value={newInitialPassword}
                    onChange={setNewInitialPassword}
                    placeholder="Nhập mật khẩu (tối thiểu 6 ký tự)"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                <div>
                  <label
                    htmlFor="create-staff-role"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Vai trò hệ thống chính *
                  </label>
                  <select
                    id="create-staff-role"
                    value={newPositionRole}
                    onChange={(e) => handlePositionRoleChange(e.target.value as StaffPositionRole)}
                    className="w-full px-3 py-2 text-xs font-semibold bg-white border border-slate-200 rounded-lg text-slate-900"
                  >
                    <option value="warehouse_manager">1. Nhân sự Quản lý từng kho riêng</option>
                    <option value="deputy_general_manager">
                      2. Nhân sự Phó quản lý chung tất cả các kho
                    </option>
                    <option value="warehouse_accountant">
                      3. Nhân sự Kế toán tổng hợp từng kho riêng
                    </option>
                    <option value="sales_accountant">
                      4. Kế toán bán hàng & Xuất hóa đơn (Kho riêng)
                    </option>
                    <option value="debt_accountant">
                      5. Kế toán công nợ Bán hàng & Nhà cung cấp
                    </option>
                    <option value="cash_bank_treasurer">
                      6. Thủ quỹ Tiền mặt & Thủ quỹ Ngân hàng
                    </option>
                    <option value="sales_warehouse_staff">
                      7. Nhân viên bán hàng & quản lý kho riêng
                    </option>
                  </select>
                </div>

                {/* Per-Staff Warehouse Assignment Selector + Inline Warehouse Creation */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-1">
                    <label
                      htmlFor="create-staff-warehouse"
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Phân quyền Kho quản lý *
                    </label>
                    {!isCreatingAllWarehouseRole && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = !showNewWarehouseInput;
                          setShowNewWarehouseInput(next);
                          setNewAssignedWarehouse(next ? '__new_warehouse__' : '');
                        }}
                        className="text-[11px] font-semibold text-emerald-700 hover:underline flex items-center gap-0.5 whitespace-nowrap"
                      >
                        <FolderPlus className="w-3 h-3" />
                        <span>{showNewWarehouseInput ? 'Đóng' : '+ Tạo thêm kho'}</span>
                      </button>
                    )}
                  </div>

                  {isCreatingAllWarehouseRole ? (
                    <input
                      type="text"
                      disabled
                      value="Tất cả kho (Phụ tiếp Quản lý chính)"
                      className="w-full px-3 py-2 text-xs bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900 font-bold"
                    />
                  ) : (
                    <SearchableSelect
                      id="create-staff-warehouse"
                      value={
                        newAssignedWarehouse === '__new_warehouse__' ? '' : newAssignedWarehouse
                      }
                      options={warehouseSelectOptions}
                      onChange={(val) => {
                        setNewAssignedWarehouse(val);
                        setShowNewWarehouseInput(false);
                      }}
                      placeholder="-- Chọn kho phân quyền --"
                      createActionLabel="+ Tạo thêm kho mới trực tiếp..."
                      onCreateAction={() => {
                        setNewAssignedWarehouse('__new_warehouse__');
                        setShowNewWarehouseInput(true);
                      }}
                    />
                  )}

                  {showNewWarehouseInput && !isCreatingAllWarehouseRole && (
                    <div className="p-2.5 bg-emerald-50/70 border border-emerald-200 rounded-lg space-y-2">
                      <input
                        type="text"
                        value={inlineWarehouseName}
                        onChange={(e) => setInlineWarehouseName(e.target.value)}
                        placeholder="Nhập tên kho mới (VD: Tâm An Tháp Mười)..."
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md"
                      />
                      <button
                        type="button"
                        onClick={handleConfirmInlineWarehouse}
                        className="w-full py-1 px-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md"
                      >
                        Lưu kho mới & Gán cho nhân viên
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Granular [X] Multi-Role & Functional Permission Matrix */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-bold text-slate-900">
                    Đánh dấu [X] các chức năng phân quyền riêng:
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setNewSelectedPermissions(
                          ALL_STAFF_FUNCTIONAL_PERMISSIONS.map((item) => item.key)
                        )
                      }
                      className="px-2 py-1 text-[11px] font-semibold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 rounded"
                    >
                      Chọn tất cả
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setNewSelectedPermissions(getDefaultPermissionsForPosition(newPositionRole))
                      }
                      className="px-2 py-1 text-[11px] font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded"
                    >
                      Mặc định
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-1.5 max-h-64 overflow-y-auto pr-1">
                  {ALL_STAFF_FUNCTIONAL_PERMISSIONS.map((perm) => {
                    const isChecked = newSelectedPermissions.includes(perm.key);
                    return (
                      <label
                        key={perm.key}
                        onClick={() => togglePermissionInCreateForm(perm.key)}
                        className={`p-2 rounded-lg border cursor-pointer transition-colors flex items-start gap-2 text-xs ${
                          isChecked
                            ? 'bg-emerald-50/90 border-emerald-600 text-slate-900'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100/70'
                        }`}
                      >
                        <span
                          className={`mt-0.5 px-1.5 py-0.5 font-mono text-[10px] font-extrabold rounded border shrink-0 ${
                            isChecked
                              ? 'bg-emerald-700 text-white border-emerald-700'
                              : 'bg-slate-100 text-slate-400 border-slate-300'
                          }`}
                        >
                          {isChecked ? '[X]' : '[ ]'}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-slate-900">{perm.label}</div>
                          <div className="text-[11px] text-slate-500 leading-snug">
                            {perm.description}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="create-staff-phone"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Số điện thoại nhân sự
                  </label>
                  <input
                    id="create-staff-phone"
                    type="tel"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="VD: 0908..."
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label
                    htmlFor="create-staff-email"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Gmail nhân sự (Nhận mật khẩu khi quên)
                  </label>
                  <input
                    id="create-staff-email"
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="VD: khoa.nv@gmail.com"
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <UserPlus className="w-4 h-4" />
                <span>Tạo tài khoản & Lưu phân quyền [X]</span>
              </button>
            </form>
          </div>
        )}

        {/* Right / Full Column: Real-Time Staff Permission List + Personal Password Change */}
        <div className={canCreateAndAssignRoles ? 'xl:col-span-7 space-y-6' : 'xl:col-span-12 space-y-6'}>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>
                    {canCreateAndAssignRoles
                      ? 'Danh Sách Tài Khoản & Cập Nhật Phân Quyền'
                      : `Thông Tin Tài Khoản Cá Nhân (@${currentStaff.username})`}
                  </span>
                </h3>
              </div>
            </div>

            <div className="divide-y divide-slate-200">
              {visibleStaffRows.map((st) => {
                const perms =
                  st.permissions ||
                  getDefaultPermissionsForPosition(st.positionRole || 'sales_warehouse_staff');
                const isPrimaryOwnerRow = canAccountCreateStaff(st);

                return (
                  <div key={st.uid} className="p-4 sm:p-5 hover:bg-slate-50/70 space-y-3">
                    <div className="space-y-2.5">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-sm text-slate-900">{st.displayName}</span>
                          <span className="font-mono text-xs font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            @{st.username}
                          </span>
                          {st.uid === currentStaff.uid && (
                            <span className="px-2 py-0.5 text-[10px] font-bold bg-slate-900 text-white rounded">
                              Đang mở
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-semibold text-emerald-800">
                          {getPositionRoleLabel(st.positionRole)}
                        </div>
                        <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="font-mono">Gmail: {st.email || 'Chưa bổ sung'}</span>
                          {st.phone && <span className="font-mono">SĐT: {st.phone}</span>}
                        </div>
                      </div>

                      {/* Action Buttons for Staff Row */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {canCreateAndAssignRoles && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setPermissionModalStaff(st);
                                setPermModalPosition(
                                  st.positionRole ||
                                    (st.role === 'manager'
                                      ? 'deputy_general_manager'
                                      : 'warehouse_manager')
                                );
                                setPermModalList(
                                  st.permissions ||
                                    getDefaultPermissionsForPosition(
                                      st.positionRole || 'warehouse_manager'
                                    )
                                );
                                setPermModalWarehouse(st.assignedWarehouse);
                                setPermModalMultiWarehouses(st.assignedWarehouses || []);
                              }}
                              className="px-2.5 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                            >
                              Phân quyền [X]
                            </button>
                            {!isPrimaryOwnerRow && onUpdateStaffMultiWarehouses && (
                              <button
                                type="button"
                                onClick={() => openMultiWarehouseModal(st)}
                                className={`px-2.5 py-1.5 text-xs font-bold rounded-lg border transition-colors ${
                                  hasMultiWarehouseManagementGrant(st)
                                    ? 'bg-teal-700 hover:bg-teal-800 text-white border-teal-700'
                                    : 'bg-teal-50 hover:bg-teal-100 text-teal-900 border-teal-300'
                                }`}
                              >
                                {st.assignedWarehouses && st.assignedWarehouses.length >= 2
                                  ? `Quản lý ${st.assignedWarehouses.length} kho`
                                  : st.assignedWarehouse === 'Tất cả kho'
                                  ? 'Quản lý tất cả kho'
                                  : '+ Cấp nhiều kho'}
                              </button>
                            )}
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setEditingStaffModal(st);
                            setModalDisplayName(st.displayName);
                            setModalPhone(st.phone || '');
                            setModalEmail(st.email || '');
                            setModalPassword('');
                            setModalWarehouseSuffix(
                              extractCustomWarehouseSuffix(st.assignedWarehouse)
                            );
                          }}
                          className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                        >
                          Sửa TT / Tên Kho
                        </button>
                        {canCreateAndAssignRoles && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setResettingStaff(st);
                                setResetPasswordValue('');
                              }}
                              className="px-2.5 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 rounded-lg"
                            >
                              Cấp lại MK
                            </button>
                            {st.uid !== currentStaff.uid && (
                              <button
                                type="button"
                                onClick={() => onToggleStaffActive(st.uid)}
                                className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                              >
                                {st.active ? 'Khóa TK' : 'Mở TK'}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Warehouse Selector + Real-time [X] Toggle Chips — ONLY visible to Primary Manager */}
                    {canCreateAndAssignRoles && (
                      <div className="pt-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="text-slate-500 font-medium flex items-center gap-1">
                            <Warehouse className="w-3.5 h-3.5 text-emerald-700" />
                            <span>Kho được phân quyền:</span>
                          </span>
                          {!isPrimaryOwnerRow ? (
                            <>
                              <select
                                aria-label={`Chọn kho phân quyền cho ${st.username}`}
                                value={resolveCanonicalSelectWarehouseValue(
                                  st.assignedWarehouse,
                                  canonicalWarehouses
                                )}
                                onChange={(e) => onUpdateStaffWarehouse(st.uid, e.target.value)}
                                className="px-2.5 py-1 text-xs font-semibold bg-white border border-slate-200 rounded-md text-emerald-800"
                              >
                                {canonicalWarehouses.map((w) => (
                                  <option key={w} value={w}>
                                    {w}
                                  </option>
                                ))}
                                <option value="Tất cả kho">Tất cả kho (Phó quản lý tổng)</option>
                              </select>
                              <span
                                className={`px-2 py-0.5 text-[10px] font-semibold rounded border ${
                                  getSelfWarehouseRenameCount(st) >= 1
                                    ? 'bg-slate-100 text-slate-600 border-slate-200'
                                    : 'bg-amber-50 text-amber-800 border-amber-200'
                                }`}
                                title="Tài khoản đăng ký mới chỉ tự đổi tên kho 1 lần duy nhất; Admin chính luôn đổi được không giới hạn"
                              >
                                {getSelfWarehouseRenameCount(st) >= 1
                                  ? 'Đã đổi tên kho (1/1)'
                                  : 'Chưa đổi tên kho (0/1)'}
                              </span>
                              {st.assignedWarehouses && st.assignedWarehouses.length >= 2 && (
                                <div className="flex flex-wrap items-center gap-1">
                                  {st.assignedWarehouses.map((wh) => (
                                    <span
                                      key={wh}
                                      className="px-2 py-0.5 text-[11px] font-bold bg-teal-50 text-teal-900 border border-teal-300 rounded-md"
                                    >
                                      {wh}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="font-bold text-emerald-800">{st.assignedWarehouse}</span>
                          )}
                        </div>

                        {/* Real-Time Interactive [X] / [ ] Permission Chips */}
                        <div className="flex flex-wrap gap-1.5">
                          {ALL_STAFF_FUNCTIONAL_PERMISSIONS.map((p) => {
                            const hasMultiGrant = hasMultiWarehouseManagementGrant(st);
                            const isEditDeleteLocked =
                              p.key === 'edit_delete_vouchers' && !isPrimaryOwnerRow && !hasMultiGrant;
                            const isGranted = !isEditDeleteLocked && perms.includes(p.key);
                            return (
                              <button
                                key={p.key}
                                type="button"
                                disabled={isPrimaryOwnerRow}
                                onClick={() => handleInstantTogglePermission(st, p.key)}
                                title={
                                  isEditDeleteLocked
                                    ? 'Chỉ cấp cho tài khoản được Admin chính phân quyền Quản lý nhiều kho (bấm để cấp nhiều kho)'
                                    : !isPrimaryOwnerRow
                                    ? 'Bấm để bật [X] hoặc tắt [ ] quyền này ngay theo thời gian thực'
                                    : p.description
                                }
                                className={`px-2 py-1 text-[11px] font-medium rounded-md border transition-colors flex items-center gap-1 ${
                                  isEditDeleteLocked
                                    ? 'bg-amber-50/70 text-amber-800 border-amber-200 hover:bg-amber-100'
                                    : isGranted
                                    ? 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100'
                                    : 'bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100'
                                } ${!isPrimaryOwnerRow ? 'cursor-pointer' : 'cursor-default'}`}
                              >
                                {isEditDeleteLocked ? (
                                  <Lock className="w-3 h-3 shrink-0" />
                                ) : (
                                  <span className="font-mono font-bold">
                                    {isGranted ? '[X]' : '[ ]'}
                                  </span>
                                )}
                                <span>
                                  {p.label}
                                  {isEditDeleteLocked ? ' (Chỉ TK nhiều kho)' : ''}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Personal Profile & Gmail Supplementation Card ("Chỉnh sửa thông tin cá nhân — Bổ sung Gmail nhân viên") */}
          <div
            id="personal-profile-gmail-section"
            className="bg-white rounded-xl border border-emerald-200 overflow-hidden shadow-xs"
          >
            <div className="px-5 sm:px-6 py-4 border-b border-emerald-200 bg-emerald-50/70 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-2">
                  <UserCog className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>
                    Chỉnh Sửa Thông Tin Cá Nhân
                  </span>
                </h2>
              </div>
              <span
                className={`px-2.5 py-1 text-[11px] font-bold rounded-md border ${
                  hasCompletedStaffPersonalGmail(targetPersonalStaff)
                    ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                    : 'bg-amber-50 text-amber-800 border-amber-300'
                }`}
              >
                {hasCompletedStaffPersonalGmail(targetPersonalStaff)
                  ? `Đã bổ sung Gmail: ${targetPersonalStaff.email}`
                  : 'Chưa bổ sung Gmail cá nhân'}
              </span>
            </div>

            <form onSubmit={handlePersonalGmailSupplementSubmit} className="p-5 sm:p-6 space-y-4">
              {personalProfileFeedback && (
                <div
                  className={`p-3.5 rounded-lg border text-xs font-medium flex items-start gap-2 ${
                    personalProfileFeedback.type === 'error'
                      ? 'bg-red-50 border-red-200 text-red-700'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  }`}
                >
                  {personalProfileFeedback.type === 'error' ? (
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700" />
                  )}
                  <span>{personalProfileFeedback.text}</span>
                </div>
              )}

              {canCreateAndAssignRoles && (
                <div>
                  <label
                    htmlFor="personal-select-staff-uid"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Chọn tài khoản nhân viên cần chỉnh sửa thông tin cá nhân / bổ sung Gmail
                  </label>
                  <select
                    id="personal-select-staff-uid"
                    value={personalTargetUid}
                    onChange={(e) => {
                      setPersonalTargetUid(e.target.value);
                      setPersonalProfileFeedback(null);
                    }}
                    className="w-full px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                  >
                    {staffList.map((st) => (
                      <option key={st.uid} value={st.uid}>
                        @{st.username} — {st.displayName} (Gmail:{' '}
                        {st.email || 'Chưa bổ sung'} · SĐT: {st.phone || 'Chưa có'})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="personal-profile-fullname"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Họ và tên nhân viên *
                  </label>
                  <input
                    id="personal-profile-fullname"
                    type="text"
                    required
                    value={personalDisplayName}
                    onChange={(e) => setPersonalDisplayName(e.target.value)}
                    placeholder="Nhập họ và tên nhân viên..."
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                  />
                </div>

                <div>
                  <label
                    htmlFor="personal-profile-phone"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Số điện thoại liên hệ
                  </label>
                  <input
                    id="personal-profile-phone"
                    type="tel"
                    value={personalPhone}
                    onChange={(e) => setPersonalPhone(e.target.value)}
                    placeholder="VD: 0918223344"
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="personal-profile-gmail"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Địa chỉ Gmail tài khoản *
                  </label>
                  <input
                    id="personal-profile-gmail"
                    type="email"
                    required
                    value={personalEmail}
                    onChange={(e) => setPersonalEmail(e.target.value)}
                    placeholder="VD: vtnntaman@gmail.com"
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>

                <div>
                  <label
                    htmlFor="personal-profile-new-password"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Mật khẩu mới
                  </label>
                  <PasswordInputWithEye
                    id="personal-profile-new-password"
                    value={personalNewPassword}
                    onChange={setPersonalNewPassword}
                    placeholder="Nhập mật khẩu mới nếu muốn đổi..."
                  />
                </div>
              </div>

              {/* Custom Warehouse Display Name with Locked "TÂM AN" Prefix & 1-Time Self-Rename Lock */}
              {targetPersonalStaff.assignedWarehouse !== 'Tất cả kho' &&
                !canAccountCreateStaff(targetPersonalStaff) && (
                  <div
                    className={`p-4 rounded-xl border space-y-2 ${
                      personalTargetRenameStatus.allowed
                        ? 'bg-emerald-50/80 border-emerald-200'
                        : 'bg-amber-50/70 border-amber-200'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label
                        htmlFor="personal-warehouse-suffix"
                        className="text-xs font-bold text-emerald-950 flex items-center gap-1.5"
                      >
                        <Warehouse className="w-4 h-4 text-emerald-700 shrink-0" />
                        <span>Tên hiển thị Kho quản lý *</span>
                      </label>
                      {personalTargetRenameStatus.isPrimaryAdminActor ? (
                        <span className="px-2 py-0.5 text-[11px] font-bold bg-emerald-700 text-white rounded">
                          Admin chính · Đổi không giới hạn
                        </span>
                      ) : personalTargetRenameStatus.allowed ? (
                        <span className="px-2 py-0.5 text-[11px] font-bold bg-amber-600 text-white rounded">
                          Chỉ được đổi 1 lần duy nhất (còn 1/1)
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-[11px] font-bold bg-slate-700 text-white rounded inline-flex items-center gap-1">
                          <Lock className="w-3 h-3 shrink-0" />
                          <span>Đã khóa đổi tên kho (1/1)</span>
                        </span>
                      )}
                    </div>

                    <div
                      className={`flex items-stretch rounded-lg overflow-hidden border ${
                        personalTargetRenameStatus.allowed
                          ? 'border-emerald-400 bg-white focus-within:ring-2 focus-within:ring-emerald-600/20'
                          : 'border-slate-300 bg-slate-100 opacity-80'
                      }`}
                    >
                      <span className="px-3.5 py-2 text-sm font-mono font-extrabold bg-emerald-800 text-white flex items-center select-none shrink-0">
                        {MANDATORY_WAREHOUSE_PREFIX}
                      </span>
                      <input
                        id="personal-warehouse-suffix"
                        type="text"
                        required
                        disabled={!personalTargetRenameStatus.allowed}
                        value={personalWarehouseSuffix}
                        onChange={(e) => setPersonalWarehouseSuffix(e.target.value)}
                        placeholder="Nhập tên kho (VD: BA SAO, MỸ NGÃI, VTNNTAMAN)..."
                        className="flex-1 min-w-0 px-3 py-2 text-sm font-mono font-bold text-slate-900 bg-transparent focus:outline-none uppercase disabled:cursor-not-allowed"
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-900">
                      <span>
                        Tên kho hiển thị:{' '}
                        <strong className="font-mono text-emerald-950 bg-white px-2 py-0.5 rounded border border-emerald-300">
                          {personalTargetRenameStatus.allowed
                            ? normalizeCustomTamAnWarehouseName(
                                personalWarehouseSuffix,
                                personalEmail
                              )
                            : targetPersonalStaff.assignedWarehouse}
                        </strong>
                      </span>
                      {!personalTargetRenameStatus.allowed && (
                        <span className="text-[11px] text-amber-900 font-semibold">
                          Đã sử dụng 1/1 lần đổi tên kho — chỉ Quản lý chính ({ADMIN_BACKUP_EMAIL}) mới có quyền đổi lại.
                        </span>
                      )}
                    </div>
                  </div>
                )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <button
                  type="submit"
                  className="py-2.5 px-4 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <Mail className="w-4 h-4 shrink-0" />
                  <span>Lưu hồ sơ cá nhân &amp; Cập nhật tên hiển thị kho</span>
                </button>
              </div>
            </form>
          </div>

          {/* Personal Password Change Card */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 sm:px-6 py-4 border-b border-slate-200 bg-slate-50/60 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-emerald-700" />
                  <span>Thay Đổi Mật Khẩu Cá Nhân (@{currentStaff.username})</span>
                </h2>
              </div>
            </div>

            <form onSubmit={handleChangePasswordSubmit} className="p-5 sm:p-6 space-y-4">
              {passFeedback && (
                <div
                  className={`p-3 rounded-lg border text-xs font-medium flex items-center gap-2 ${
                    passFeedback.type === 'error'
                      ? 'bg-red-50 border-red-200 text-red-700'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  }`}
                >
                  {passFeedback.type === 'error' ? (
                    <AlertCircle className="w-4 h-4 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  )}
                  <span>{passFeedback.text}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label
                    htmlFor="change-old-pass"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Mật khẩu hiện tại *
                  </label>
                  <PasswordInputWithEye
                    id="change-old-pass"
                    required
                    value={oldPass}
                    onChange={setOldPass}
                    placeholder="Mật khẩu hiện tại..."
                  />
                </div>
                <div>
                  <label
                    htmlFor="change-new-pass"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Mật khẩu mới *
                  </label>
                  <PasswordInputWithEye
                    id="change-new-pass"
                    required
                    value={newPass}
                    onChange={setNewPass}
                    placeholder="Tối thiểu 4 ký tự"
                  />
                </div>
                <div>
                  <label
                    htmlFor="change-confirm-pass"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Xác nhận mật khẩu mới *
                  </label>
                  <PasswordInputWithEye
                    id="change-confirm-pass"
                    required
                    value={confirmPass}
                    onChange={setConfirmPass}
                    placeholder="Nhập lại mật khẩu mới"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="py-2 px-4 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <KeyRound className="w-4 h-4" />
                <span>Cập nhật mật khẩu mới</span>
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Modal 1: Primary Manager [X] Role & Permission Assignment (Mobile-Safe) */}
      {permissionModalStaff && canCreateAndAssignRoles && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2.5 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Phân quyền vai trò và chức năng cho tài khoản cá nhân"
        >
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-2xl max-h-[calc(100dvh-1.25rem)] sm:max-h-[90vh] flex flex-col overflow-hidden shadow-xl">
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 bg-emerald-900 text-white flex items-center justify-between shrink-0">
              <div className="min-w-0 pr-2">
                <h3 className="text-sm sm:text-base font-bold truncate">
                  Phân Quyền [X]: {permissionModalStaff.displayName} (@
                  {permissionModalStaff.username})
                </h3>
                <p className="text-[11px] sm:text-xs text-emerald-200 mt-0.5">
                  Cập nhật ngay theo thời gian thực bởi Quản lý chính ({ADMIN_BACKUP_EMAIL})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPermissionModalStaff(null)}
                className="p-1.5 text-emerald-200 hover:text-white rounded-lg shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1 overscroll-contain">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Vai trò hệ thống *
                  </label>
                  <select
                    value={permModalPosition}
                    onChange={(e) => {
                      const pos = e.target.value as StaffPositionRole;
                      setPermModalPosition(pos);
                      setPermModalList(getDefaultPermissionsForPosition(pos));
                      if (pos === 'deputy_general_manager' || pos === 'primary_manager') {
                        setPermModalWarehouse('Tất cả kho');
                      }
                    }}
                    className="w-full px-3 py-2 text-xs font-semibold bg-white border border-slate-200 rounded-lg"
                  >
                    <option value="warehouse_manager">1. Nhân sự Quản lý từng kho riêng</option>
                    <option value="deputy_general_manager">
                      2. Nhân sự Phó quản lý chung tất cả các kho
                    </option>
                    <option value="warehouse_accountant">
                      3. Nhân sự Kế toán tổng hợp từng kho riêng
                    </option>
                    <option value="sales_accountant">4. Kế toán bán hàng & Hóa đơn</option>
                    <option value="debt_accountant">
                      5. Kế toán công nợ Bán hàng & Nhà cung cấp
                    </option>
                    <option value="cash_bank_treasurer">6. Thủ quỹ Tiền mặt & Ngân hàng</option>
                    <option value="sales_warehouse_staff">
                      7. Nhân viên bán hàng & quản lý kho riêng
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Phân quyền Kho quản lý *
                  </label>
                  <select
                    value={resolveCanonicalSelectWarehouseValue(
                      permModalWarehouse,
                      canonicalWarehouses
                    )}
                    onChange={(e) => setPermModalWarehouse(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-semibold bg-white border border-slate-200 rounded-lg"
                  >
                    {canonicalWarehouses.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                    <option value="Tất cả kho">Tất cả kho (Quản lý chung)</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-900">
                  Đánh dấu [X] các chức năng được phép sử dụng:
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {ALL_STAFF_FUNCTIONAL_PERMISSIONS.map((perm) => {
                    const checked = permModalList.includes(perm.key);
                    return (
                      <label
                        key={perm.key}
                        onClick={() => togglePermissionInModal(perm.key)}
                        className={`p-2.5 rounded-lg border cursor-pointer flex items-start gap-2.5 text-xs ${
                          checked
                            ? 'bg-emerald-50 border-emerald-600 text-slate-900'
                            : 'bg-white border-slate-200 text-slate-600'
                        }`}
                      >
                        <span
                          className={`mt-0.5 px-1.5 py-0.5 font-mono text-[11px] font-extrabold rounded border shrink-0 ${
                            checked
                              ? 'bg-emerald-700 text-white border-emerald-700'
                              : 'bg-slate-100 text-slate-400 border-slate-300'
                          }`}
                        >
                          {checked ? '[X]' : '[ ]'}
                        </span>
                        <div>
                          <div className="font-bold text-slate-900">{perm.label}</div>
                          <div className="text-[11px] text-slate-600 mt-0.5">
                            {perm.description}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="px-4 sm:px-6 py-3 border-t border-slate-200 bg-slate-50/90 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setPermissionModalStaff(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => {
                  onUpdateStaffPermissions?.(
                    permissionModalStaff.uid,
                    permModalPosition,
                    permModalList,
                    permModalWarehouse,
                    permModalMultiWarehouses
                  );
                  setRealtimeBanner(
                    `Đã lưu phân quyền [X] thời gian thực cho @${permissionModalStaff.username}!`
                  );
                  setPermissionModalStaff(null);
                }}
                className="px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
              >
                Lưu phân quyền [X]
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Primary Admin Multi-Warehouse Assignment ("Cấp quyền quản lý nhiều kho cho tài khoản chỉ định") */}
      {multiWhModalStaff && canCreateAndAssignRoles && onUpdateStaffMultiWarehouses && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-2.5 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Cấp quyền quản lý nhiều kho cho ${multiWhModalStaff.displayName}`}
        >
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg max-h-[calc(100dvh-1.25rem)] sm:max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-4 sm:px-6 py-3.5 border-b border-teal-200 bg-teal-50/80 flex items-center justify-between gap-2 shrink-0">
              <div className="min-w-0">
                <h3 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-1.5">
                  <Warehouse className="w-4 h-4 text-teal-700 shrink-0" />
                  <span className="truncate">
                    Cấp Quyền Quản Lý Nhiều Kho (@{multiWhModalStaff.username})
                  </span>
                </h3>
                <p className="text-[11px] text-teal-900 mt-0.5">
                  {multiWhModalStaff.displayName} · {multiWhModalStaff.email || 'Tài khoản nhân sự'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMultiWhModalStaff(null)}
                aria-label="Đóng cửa sổ cấp nhiều kho"
                className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 sm:p-5 space-y-3.5 overflow-y-auto flex-1 overscroll-contain">
              {/* Rule Explanation Banner */}
              <div
                className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
                  multiWhGrantAll || multiWhSelectedList.length >= 2
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                    : 'bg-amber-50 border-amber-300 text-amber-950'
                }`}
              >
                {multiWhGrantAll || multiWhSelectedList.length >= 2 ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                ) : (
                  <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                )}
                <div>
                  {multiWhGrantAll ? (
                    <span>
                      <strong>Quản lý tất cả các kho (Phó quản lý tổng):</strong> Tài khoản được
                      xem/điều phối toàn bộ kho và <strong>MỞ quyền Sửa / Xóa hóa đơn, phiếu</strong>.
                    </span>
                  ) : multiWhSelectedList.length >= 2 ? (
                    <span>
                      <strong>Quản lý {multiWhSelectedList.length} kho được chỉ định:</strong> Tài
                      khoản được đồng bộ &amp; điều phối đúng {multiWhSelectedList.length} kho đã
                      tick và <strong>MỞ quyền Sửa / Xóa hóa đơn, phiếu</strong>.
                    </span>
                  ) : (
                    <span>
                      <strong>Chế độ 1 kho độc lập:</strong> Chỉ tài khoản được phân quyền quản lý
                      từ <strong>2 kho trở lên</strong> (hoặc Tất cả kho) mới có quyền{' '}
                      <strong>Sửa / Xóa phiếu, hóa đơn</strong>.
                    </span>
                  )}
                </div>
              </div>

              {/* Grant ALL Warehouses Checkbox */}
              <label className="p-3 rounded-xl border-2 cursor-pointer flex items-center justify-between gap-2 transition-colors bg-slate-50 hover:bg-teal-50/60 border-teal-300">
                <div className="flex items-center gap-2.5 min-w-0">
                  <input
                    type="checkbox"
                    checked={multiWhGrantAll}
                    onChange={(e) => setMultiWhGrantAll(e.target.checked)}
                    className="w-4 h-4 accent-teal-700 rounded shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900">
                      Cấp quyền quản lý TẤT CẢ CÁC KHO ({canonicalWarehouses.length} kho)
                    </div>
                    <div className="text-[11px] text-slate-600">
                      Phó quản lý tổng — giám sát toàn bộ kho &amp; mở toàn quyền Sửa / Xóa chứng từ
                    </div>
                  </div>
                </div>
                <span className="px-2 py-0.5 text-[10px] font-bold bg-teal-700 text-white rounded shrink-0">
                  Tất cả
                </span>
              </label>

              {/* Specific Designated Warehouses Checkboxes */}
              {!multiWhGrantAll && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900">
                      Hoặc chọn các kho chỉ định ({multiWhSelectedList.length}/{canonicalWarehouses.length}{' '}
                      kho đã chọn):
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setMultiWhSelectedList([...canonicalWarehouses])}
                        className="px-2 py-0.5 text-[11px] font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded"
                      >
                        Chọn hết
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setMultiWhSelectedList(
                            multiWhModalStaff.assignedWarehouse &&
                              multiWhModalStaff.assignedWarehouse !== 'Tất cả kho'
                              ? [multiWhModalStaff.assignedWarehouse]
                              : []
                          )
                        }
                        className="px-2 py-0.5 text-[11px] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded"
                      >
                        Về 1 kho gốc
                      </button>
                    </div>
                  </div>

                  <input
                    type="text"
                    value={multiWhSearch}
                    onChange={(e) => setMultiWhSearch(e.target.value)}
                    placeholder="Gõ tên kho cần tìm nhanh (VD: MỸ NGÃI, PHUCANTAM, NHAN QUA...)..."
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />

                  <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white">
                    {canonicalWarehouses
                      .filter((w) => {
                        const q = normalizeVietnameseSearch(multiWhSearch);
                        const meta = summaryByWarehouseKey.get(normalizeWarehouseKey(w));
                        const haystack = `${w} ${meta?.owners.join(' ') || ''}`;
                        return !q || normalizeVietnameseSearch(haystack).includes(q);
                      })
                      .map((w) => {
                        const whKey = normalizeWarehouseKey(w);
                        const checked = multiWhSelectedList.some(
                          (item) => normalizeWarehouseKey(item) === whKey
                        );
                        const whMeta = summaryByWarehouseKey.get(whKey);
                        return (
                          <label
                            key={w}
                            className={`px-3 py-2.5 flex items-center justify-between gap-2 cursor-pointer transition-colors text-xs ${
                              checked ? 'bg-teal-50/80 text-teal-950 font-bold' : 'hover:bg-slate-50 text-slate-800'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  setMultiWhSelectedList((prev) =>
                                    prev.some((item) => normalizeWarehouseKey(item) === whKey)
                                      ? prev.filter((item) => normalizeWarehouseKey(item) !== whKey)
                                      : [...prev, w]
                                  )
                                }
                                className="w-4 h-4 accent-teal-700 rounded shrink-0"
                              />
                              <div className="min-w-0">
                                <div className="truncate">{w}</div>
                                {whMeta && (
                                  <div className="text-[10px] font-normal text-slate-500 truncate">
                                    {whMeta.owners.join(', ')}
                                    {(whMeta.products > 0 || whMeta.sales > 0) &&
                                      ` · ${whMeta.products} VT · ${whMeta.sales} đơn`}
                                  </div>
                                )}
                              </div>
                            </div>
                            {checked && (
                              <span className="text-[10px] font-bold text-teal-700 shrink-0">
                                Đã chọn
                              </span>
                            )}
                          </label>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>

            <div className="px-4 sm:px-6 py-3 border-t border-slate-200 bg-slate-50/90 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setMultiWhModalStaff(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={!multiWhGrantAll && multiWhSelectedList.length === 0}
                onClick={() => {
                  onUpdateStaffMultiWarehouses(
                    multiWhModalStaff.uid,
                    multiWhSelectedList,
                    multiWhGrantAll
                  );
                  setRealtimeBanner(
                    multiWhGrantAll
                      ? `Đã cấp quyền quản lý TẤT CẢ KHO & Sửa/Xóa cho @${multiWhModalStaff.username}!`
                      : multiWhSelectedList.length >= 2
                      ? `Đã cấp quyền quản lý ${multiWhSelectedList.length} kho (${multiWhSelectedList.join(', ')}) & mở quyền Sửa/Xóa cho @${multiWhModalStaff.username}!`
                      : `Đã đặt @${multiWhModalStaff.username} về quản lý 1 kho (${multiWhSelectedList[0]}) và khóa quyền Sửa/Xóa.`
                  );
                  setMultiWhModalStaff(null);
                }}
                className="px-4 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 disabled:bg-slate-300 rounded-lg"
              >
                Lưu phân quyền kho
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Edit / Supplement Staff Info & Gmail (Mobile-Safe) */}
      {editingStaffModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2.5 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Chỉnh sửa thông tin và bổ sung Gmail nhân viên"
        >
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-md max-h-[calc(100dvh-1.25rem)] sm:max-h-[90vh] flex flex-col overflow-hidden shadow-xl">
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 flex items-center justify-between shrink-0 bg-white">
              <h3 className="text-sm sm:text-base font-bold text-slate-900">
                Cài đặt Gmail & Thông tin (@{editingStaffModal.username})
              </h3>
              <button
                type="button"
                onClick={() => setEditingStaffModal(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const modalRenameCheck = canStaffRenameWarehouse(editingStaffModal, currentStaff);
                onUpdateStaffProfile({
                  uid: editingStaffModal.uid,
                  displayName: modalDisplayName.trim(),
                  phone: modalPhone.trim(),
                  email: modalEmail.trim(),
                  newPassword: modalPassword.trim() || undefined,
                  customWarehouseName: modalRenameCheck.allowed
                    ? normalizeCustomTamAnWarehouseName(modalWarehouseSuffix, modalEmail.trim())
                    : undefined,
                });
                setEditingStaffModal(null);
              }}
              className="flex flex-col flex-1 min-h-0 overflow-hidden"
            >
              <div className="p-4 sm:p-6 space-y-3.5 sm:space-y-4 overflow-y-auto flex-1 overscroll-contain">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Họ và tên nhân viên *
                  </label>
                  <input
                    type="text"
                    required
                    value={modalDisplayName}
                    onChange={(e) => setModalDisplayName(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg"
                  />
                </div>
                {editingStaffModal.assignedWarehouse !== 'Tất cả kho' &&
                  !canAccountCreateStaff(editingStaffModal) &&
                  (() => {
                    const modalRenameCheck = canStaffRenameWarehouse(
                      editingStaffModal,
                      currentStaff
                    );
                    return (
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <label className="block text-xs font-semibold text-slate-700">
                            Tên hiển thị Kho *
                          </label>
                          {modalRenameCheck.isPrimaryAdminActor ? (
                            <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-700 text-white rounded">
                              Admin chính · Đổi nhiều lần
                            </span>
                          ) : modalRenameCheck.allowed ? (
                            <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-600 text-white rounded">
                              Đổi 1 lần duy nhất
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 text-[10px] font-bold bg-slate-700 text-white rounded inline-flex items-center gap-1">
                              <Lock className="w-2.5 h-2.5 shrink-0" />
                              <span>Đã khóa (1/1)</span>
                            </span>
                          )}
                        </div>
                        <div
                          className={`flex items-stretch rounded-lg overflow-hidden border ${
                            modalRenameCheck.allowed
                              ? 'border-emerald-400 bg-white'
                              : 'border-slate-300 bg-slate-100 opacity-80'
                          }`}
                        >
                          <span className="px-3 py-2 text-xs font-mono font-extrabold bg-emerald-800 text-white flex items-center select-none shrink-0">
                            {MANDATORY_WAREHOUSE_PREFIX}
                          </span>
                          <input
                            type="text"
                            required
                            disabled={!modalRenameCheck.allowed}
                            value={modalWarehouseSuffix}
                            onChange={(e) => setModalWarehouseSuffix(e.target.value)}
                            placeholder="VD: BA SAO"
                            className="flex-1 min-w-0 px-3 py-2 text-xs font-mono font-bold text-slate-900 bg-transparent focus:outline-none uppercase disabled:cursor-not-allowed"
                          />
                        </div>
                        <div className="text-[11px] text-emerald-800 mt-1">
                          {modalRenameCheck.allowed ? (
                            <>
                              Hiển thị:{' '}
                              <strong>
                                {normalizeCustomTamAnWarehouseName(modalWarehouseSuffix, modalEmail)}
                              </strong>
                            </>
                          ) : (
                            <span className="text-amber-800 font-semibold">
                              Đã dùng hết 1/1 lần đổi tên kho — chỉ Quản lý chính ({ADMIN_BACKUP_EMAIL}) mới có quyền đổi lại.
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Địa chỉ Gmail (Nhận mật khẩu khi quên) *
                  </label>
                  <input
                    type="email"
                    required
                    value={modalEmail}
                    onChange={(e) => setModalEmail(e.target.value)}
                    placeholder="VD: nhanvien@gmail.com"
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Số điện thoại
                  </label>
                  <input
                    type="tel"
                    value={modalPhone}
                    onChange={(e) => setModalPhone(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Mật khẩu mới (Để trống nếu không đổi)
                  </label>
                  <PasswordInputWithEye
                    value={modalPassword}
                    onChange={setModalPassword}
                    placeholder="Nhập mật khẩu mới..."
                  />
                </div>
              </div>
              <div className="px-4 sm:px-6 py-3 border-t border-slate-200 bg-slate-50/90 flex items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setEditingStaffModal(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                >
                  Lưu cập nhật
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 3: Manager Reset Staff Password (Mobile-Safe) */}
      {resettingStaff && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2.5 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Cấp lại mật khẩu nhân viên"
        >
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-md max-h-[calc(100dvh-1.25rem)] sm:max-h-[90vh] flex flex-col overflow-hidden shadow-xl">
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 flex items-center justify-between shrink-0 bg-white">
              <h3 className="text-sm sm:text-base font-bold text-slate-900">
                Cấp lại mật khẩu cho @{resettingStaff.username}
              </h3>
              <button
                type="button"
                onClick={() => setResettingStaff(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!resetPasswordValue.trim()) return;
                await onResetStaffPasswordByManager(resettingStaff.uid, resetPasswordValue.trim());
                setResettingStaff(null);
              }}
              className="flex flex-col flex-1 min-h-0 overflow-hidden"
            >
              <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1 overscroll-contain">
                <div>
                  <label
                    htmlFor="manager-reset-pass-input"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Mật khẩu mới cấp cho nhân viên *
                  </label>
                  <PasswordInputWithEye
                    id="manager-reset-pass-input"
                    required
                    defaultVisible={true}
                    value={resetPasswordValue}
                    onChange={setResetPasswordValue}
                  />
                </div>
              </div>
              <div className="px-4 sm:px-6 py-3 border-t border-slate-200 bg-slate-50/90 flex items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setResettingStaff(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                >
                  Lưu mật khẩu mới
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

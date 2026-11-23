import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  FolderPlus,
  KeyRound,
  Lock,
  LogIn,
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
import {
  ALL_STAFF_FUNCTIONAL_PERMISSIONS,
  canAccountCreateStaff,
  extractCustomWarehouseSuffix,
  formatDefaultWarehouseNameFromGmail,
  getDefaultPermissionsForPosition,
  getPositionRoleLabel,
  hasCompletedStaffPersonalGmail,
  MANDATORY_WAREHOUSE_PREFIX,
  normalizeCustomTamAnWarehouseName,
  SearchableOptionItem,
} from '../utils/businessLogic';

export interface GmailRecoveryLog {
  id: string;
  username: string;
  displayName: string;
  recipientGmail: string;
  newPasswordIssued: string;
  sentAt: string;
}

interface PasswordInputWithEyeProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  defaultVisible?: boolean;
  ariaLabel?: string;
}

/**
 * Reusable password input with an interactive Eye / EyeOff toggle button
 * so the user can turn visibility ON or OFF to verify the typed password.
 */
export const PasswordInputWithEye: React.FC<PasswordInputWithEyeProps> = ({
  id,
  value,
  onChange,
  placeholder = 'Mật khẩu',
  required = false,
  defaultVisible = false,
  ariaLabel,
}) => {
  const [visible, setVisible] = useState<boolean>(defaultVisible);

  return (
    <div className="relative flex items-center w-full">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="w-full pl-3.5 pr-10 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 transition-all"
      />
      <button
        type="button"
        onClick={() => setVisible((prev) => !prev)}
        title={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu để kiểm tra'}
        aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
        className="absolute right-2.5 p-1.5 text-slate-500 hover:text-emerald-700 hover:bg-slate-100 rounded-lg transition-colors"
      >
        {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
};

interface InitialLoginScreenPortalProps {
  staffList: StaffMember[];
  currentStaff: StaffMember;
  isGoogleAuthenticated: boolean;
  currentUserEmail: string | null;
  onGoogleManagerLogin: () => Promise<{ ok: boolean; message: string } | void> | void;
  onGoogleLoginByEmail?: (
    email: string,
    googleDisplayName?: string,
    googleUid?: string
  ) => { ok: boolean; message: string };
  onLoginStaff: (
    usernameOrEmail: string,
    password: string
  ) => Promise<{ ok: boolean; message: string }> | { ok: boolean; message: string };
  onSignUpStaff?: (payload: {
    displayName: string;
    emailOrPhone: string;
    username?: string;
    password: string;
    provider: 'email_password' | 'phone' | 'google';
  }) => Promise<{ ok: boolean; message: string }> | { ok: boolean; message: string };
  onUpdateStaffProfile: (payload: {
    uid: string;
    displayName: string;
    phone: string;
    email: string;
    newPassword?: string;
    customWarehouseName?: string;
  }) => Promise<{ ok: boolean; message: string }> | { ok: boolean; message: string };
  onOpenCreateStaffSection?: () => void;
  onDismissBanner?: () => void;
  isCollapsible?: boolean;
  isSessionLoggedIn?: boolean;
  onLogout?: () => void;
}

/**
 * Authentication Screen (Production-hardened Gmail & Google Auth):
 * - Tabs: Đăng nhập (Sign-in) | Đăng ký tài khoản bằng Gmail (Sign-up) | Quên mật khẩu (Firebase Reset Email)
 * - Each new Gmail sign-up automatically creates an independent warehouse named:
 *   "TÂM AN " + uppercase Gmail local-part (e.g. vtnntaman@gmail.com -> TÂM AN VTNNTAMAN)
 *   with full independent warehouse management functions.
 */
export const InitialLoginScreenPortal: React.FC<InitialLoginScreenPortalProps> = ({
  onGoogleManagerLogin,
  onLoginStaff,
  onSignUpStaff,
}) => {
  const [authMode, setAuthMode] = useState<'login' | 'signup' | 'forgot_password'>('login');

  // 1. Sign-in (Gmail / Username & Password) state
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [isGoogleSigningIn, setIsGoogleSigningIn] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginFeedback, setLoginFeedback] = useState<{
    type: 'error' | 'success';
    text: string;
  } | null>(null);

  // 2. Sign-up (Gmail only) state
  const [signUpDisplayName, setSignUpDisplayName] = useState('');
  const [signUpEmail, setSignUpEmail] = useState('');
  const [signUpPassword, setSignUpPassword] = useState('');
  const [signUpConfirmPassword, setSignUpConfirmPassword] = useState('');

  // Live preview of default warehouse name generated from Gmail during Sign-Up
  const previewDefaultWarehouseName = useMemo(
    () => formatDefaultWarehouseNameFromGmail(signUpEmail || 'vtnntaman@gmail.com'),
    [signUpEmail]
  );

  // 3. Forgot password (Firebase Password Reset Email only — no local enumeration or overwrite)
  const [forgotGmailInput, setForgotGmailInput] = useState<string>('');
  const [forgotFeedback, setForgotFeedback] = useState<{
    type: 'error' | 'success';
    text: string;
  } | null>(null);

  const handleSwitchAuthMode = (nextMode: 'login' | 'signup' | 'forgot_password') => {
    setAuthMode(nextMode);
    setLoginFeedback(null);
    setForgotFeedback(null);
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    const trimmedUser = loginUsername.trim();
    if (!trimmedUser || !loginPassword) {
      setLoginFeedback({
        type: 'error',
        text: 'Vui lòng nhập đầy đủ Email/Tên đăng nhập và Mật khẩu.',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await onLoginStaff(trimmedUser, loginPassword);
      setLoginFeedback({
        type: res.ok ? 'success' : 'error',
        text: res.message,
      });
      if (res.ok) {
        setLoginUsername('');
        setLoginPassword('');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignUpEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    const trimmedEmail = signUpEmail.trim().toLowerCase();
    const trimmedName = signUpDisplayName.trim() || trimmedEmail.split('@')[0] || 'Chủ kho Tâm An';

    if (!trimmedEmail || !trimmedEmail.endsWith('@gmail.com')) {
      setLoginFeedback({
        type: 'error',
        text: 'Chỉ đăng ký tài khoản bằng địa chỉ Gmail (@gmail.com). Ví dụ: vtnntaman@gmail.com',
      });
      return;
    }
    if (signUpPassword.length < 6) {
      setLoginFeedback({
        type: 'error',
        text: 'Mật khẩu đăng ký phải có ít nhất 6 ký tự (theo chuẩn Firebase Authentication).',
      });
      return;
    }
    if (signUpPassword !== signUpConfirmPassword) {
      setLoginFeedback({
        type: 'error',
        text: 'Mật khẩu xác nhận không khớp với mật khẩu đã nhập.',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      if (onSignUpStaff) {
        const res = await onSignUpStaff({
          displayName: trimmedName,
          emailOrPhone: trimmedEmail,
          password: signUpPassword,
          provider: 'email_password',
        });
        setLoginFeedback({
          type: res.ok ? 'success' : 'error',
          text: res.message,
        });
      } else {
        const res = await onLoginStaff(trimmedEmail, signUpPassword);
        setLoginFeedback({
          type: res.ok ? 'success' : 'error',
          text: res.message,
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleButtonClick = async () => {
    if (isGoogleSigningIn || isSubmitting) return;
    setIsGoogleSigningIn(true);
    setLoginFeedback({
      type: 'success',
      text: 'Đang mở cửa sổ chọn tài khoản Google — Vui lòng chọn một tài khoản Gmail trong cửa sổ bật lên để đăng nhập...',
    });
    try {
      const res = await onGoogleManagerLogin();
      if (res && typeof res === 'object' && 'ok' in res) {
        setLoginFeedback({
          type: res.ok ? 'success' : 'error',
          text: res.message,
        });
      }
    } catch {
      setLoginFeedback({
        type: 'error',
        text: 'Chưa hoàn tất chọn tài khoản Google. Vui lòng chọn một tài khoản Google để đăng nhập.',
      });
    } finally {
      setIsGoogleSigningIn(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    const trimmedEmail = forgotGmailInput.trim().toLowerCase();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setForgotFeedback({
        type: 'error',
        text: 'Vui lòng nhập địa chỉ Email / Gmail hợp lệ để nhận liên kết đặt lại mật khẩu.',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const { firebaseSendPasswordResetEmail } = await import('../services/firebaseService');
      await firebaseSendPasswordResetEmail(trimmedEmail);
      setForgotFeedback({
        type: 'success',
        text: `Nếu địa chỉ email ${trimmedEmail} đã đăng ký trên hệ thống, liên kết đặt lại mật khẩu từ Firebase Authentication đã được gửi tới hộp thư của bạn (vui lòng kiểm tra cả mục Spam).`,
      });
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/invalid-email') {
        setForgotFeedback({
          type: 'error',
          text: 'Địa chỉ email không đúng định dạng.',
        });
      } else if (code === 'auth/too-many-requests') {
        setForgotFeedback({
          type: 'error',
          text: 'Bạn đã gửi yêu cầu quá nhiều lần. Vui lòng thử lại sau ít phút.',
        });
      } else {
        setForgotFeedback({
          type: 'success',
          text: `Nếu địa chỉ email ${trimmedEmail} đã đăng ký trên hệ thống, liên kết đặt lại mật khẩu từ Firebase Authentication đã được gửi tới hộp thư của bạn (vui lòng kiểm tra cả mục Spam).`,
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-lg px-5 sm:px-8 py-7 sm:py-8">
        {/* Invisible Firebase Recaptcha Container for Phone Auth */}
        <div id="firebase-recaptcha-container" />

        {/* Centered Logo & Brand Header */}
        <div className="flex flex-col items-center text-center mb-5">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-200 p-2 flex items-center justify-center shadow-xs mb-2.5">
            <img
              src="/assets/logo-taman.png"
              alt="Logo VTNN Tâm An"
              referrerPolicy="no-referrer"
              className="w-full h-full object-contain"
            />
          </div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">VTNN Tâm An</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Vật tư Tâm An, Nhà Nông an tâm
          </p>
        </div>

        {/* Top Mode Switcher: Đăng nhập (Sign-in) | Đăng ký bằng Gmail (Sign-up) */}
        {authMode !== 'forgot_password' && (
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl mb-4">
            <button
              type="button"
              onClick={() => handleSwitchAuthMode('login')}
              className={`py-2 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                authMode === 'login'
                  ? 'bg-white text-emerald-800 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <LogIn className="w-3.5 h-3.5 shrink-0" />
              <span>Đăng nhập</span>
            </button>
            <button
              type="button"
              onClick={() => handleSwitchAuthMode('signup')}
              className={`py-2 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                authMode === 'signup'
                  ? 'bg-white text-emerald-800 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5 shrink-0" />
              <span>Đăng ký bằng Gmail</span>
            </button>
          </div>
        )}

        {/* VIEW 1: SIGN-IN OR GMAIL SIGN-UP FLOWS */}
        {authMode !== 'forgot_password' && (
          <div className="space-y-4">
            {loginFeedback && (
              <div
                className={`p-3 rounded-xl border text-xs font-medium flex items-center gap-2 ${
                  loginFeedback.type === 'error'
                    ? 'bg-red-50 border-red-200 text-red-700'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                }`}
              >
                {loginFeedback.type === 'error' ? (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                )}
                <span>{loginFeedback.text}</span>
              </div>
            )}

            {/* SUB-VIEW 1A: GMAIL / PASSWORD SIGN-IN */}
            {authMode === 'login' && (
              <form onSubmit={handleLoginSubmit} className="space-y-3.5">
                <div>
                  <label htmlFor="portal-login-username" className="sr-only">
                    Địa chỉ Gmail hoặc Tên đăng nhập
                  </label>
                  <input
                    id="portal-login-username"
                    type="text"
                    required
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    placeholder="Địa chỉ Gmail hoặc Tên đăng nhập (VD: vtnntaman@gmail.com)"
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 transition-all"
                  />
                </div>

                <div>
                  <label htmlFor="portal-login-password" className="sr-only">
                    Mật khẩu
                  </label>
                  <PasswordInputWithEye
                    id="portal-login-password"
                    required
                    value={loginPassword}
                    onChange={setLoginPassword}
                    placeholder="Mật khẩu"
                    ariaLabel="Mật khẩu"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 px-4 text-sm font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 active:bg-emerald-900 rounded-full transition-colors shadow-xs flex items-center justify-center gap-2"
                >
                  <LogIn className="w-4 h-4 shrink-0" />
                  <span>{isSubmitting ? 'Đang đăng nhập...' : 'Đăng nhập bằng Gmail / Mật khẩu'}</span>
                </button>
              </form>
            )}

            {/* SUB-VIEW 1B: GMAIL SIGN-UP (Auto-creates independent warehouse TÂM AN + GMAIL) */}
            {authMode === 'signup' && (
              <form onSubmit={handleSignUpEmailSubmit} className="space-y-3.5">
                <div>
                  <label htmlFor="portal-signup-name" className="sr-only">
                    Họ và tên hiển thị
                  </label>
                  <input
                    id="portal-signup-name"
                    type="text"
                    required
                    value={signUpDisplayName}
                    onChange={(e) => setSignUpDisplayName(e.target.value)}
                    placeholder="Họ và tên chủ kho / người dùng *"
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 transition-all"
                  />
                </div>

                <div>
                  <label htmlFor="portal-signup-email" className="sr-only">
                    Địa chỉ Gmail đăng ký
                  </label>
                  <input
                    id="portal-signup-email"
                    type="email"
                    required
                    value={signUpEmail}
                    onChange={(e) => setSignUpEmail(e.target.value)}
                    placeholder="Địa chỉ Gmail đăng ký (VD: vtnntaman@gmail.com) *"
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 transition-all"
                  />
                </div>

                {/* Live Auto-Created Independent Warehouse Preview Box */}
                <div className="p-3 rounded-xl bg-emerald-50/90 border border-emerald-200 space-y-1 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-emerald-900 flex items-center gap-1.5">
                      <Warehouse className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                      <span>Kho tự động tạo khi đăng ký:</span>
                    </span>
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-700 text-white rounded-md">
                      Quản lý 1 kho độc lập
                    </span>
                  </div>
                  <div className="font-mono font-extrabold text-sm text-emerald-950 tracking-tight">
                    {previewDefaultWarehouseName}
                  </div>
                  <p className="text-[11px] text-emerald-800 leading-snug">
                    Đầy đủ tất cả chức năng quản trị trên kho riêng. Có thể đổi tên hiển thị kho trong{' '}
                    <strong>Hồ sơ cá nhân</strong> (giữ nguyên tiền tố mặc định{' '}
                    <strong>&quot;TÂM AN&quot;</strong>, VD: <strong>TÂM AN BA SAO</strong>).
                  </p>
                </div>

                <div>
                  <label htmlFor="portal-signup-password" className="sr-only">
                    Mật khẩu đăng ký
                  </label>
                  <PasswordInputWithEye
                    id="portal-signup-password"
                    required
                    value={signUpPassword}
                    onChange={setSignUpPassword}
                    placeholder="Mật khẩu mới (tối thiểu 6 ký tự) *"
                    ariaLabel="Mật khẩu đăng ký"
                  />
                </div>

                <div>
                  <label htmlFor="portal-signup-confirm-password" className="sr-only">
                    Nhập lại mật khẩu
                  </label>
                  <PasswordInputWithEye
                    id="portal-signup-confirm-password"
                    required
                    value={signUpConfirmPassword}
                    onChange={setSignUpConfirmPassword}
                    placeholder="Nhập lại mật khẩu xác nhận *"
                    ariaLabel="Nhập lại mật khẩu xác nhận"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 px-4 text-sm font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 active:bg-emerald-900 rounded-full transition-colors shadow-xs flex items-center justify-center gap-2"
                >
                  <UserPlus className="w-4 h-4 shrink-0" />
                  <span>{isSubmitting ? 'Đang đăng ký...' : 'Đăng ký tài khoản Gmail & Tạo kho riêng'}</span>
                </button>
              </form>
            )}

            {/* Forgot Password Link & Switch Mode Link */}
            <div className="flex items-center justify-between pt-1 text-xs">
              <button
                type="button"
                onClick={() => handleSwitchAuthMode('forgot_password')}
                className="font-semibold text-slate-700 hover:text-emerald-700 hover:underline transition-colors"
              >
                Quên mật khẩu?
              </button>
              <button
                type="button"
                onClick={() =>
                  handleSwitchAuthMode(authMode === 'login' ? 'signup' : 'login')
                }
                className="font-semibold text-emerald-700 hover:underline transition-colors"
              >
                {authMode === 'login' ? 'Chưa có tài khoản? Đăng ký' : 'Đã có tài khoản? Đăng nhập'}
              </button>
            </div>

            {/* Divider */}
            <div className="relative flex items-center py-1">
              <div className="flex-grow border-t border-slate-200" />
              <span className="shrink-0 mx-3 text-[11px] text-slate-400 font-medium">Hoặc</span>
              <div className="flex-grow border-t border-slate-200" />
            </div>

            {/* Universal Google Sign-in & Sign-up Button */}
            <div className="space-y-2.5">
              <button
                type="button"
                disabled={isGoogleSigningIn}
                onClick={handleGoogleButtonClick}
                className="w-full py-2.5 px-4 text-xs font-bold text-slate-800 bg-white hover:bg-slate-50 disabled:opacity-60 border border-slate-300 rounded-full transition-colors flex items-center justify-center gap-2.5 shadow-2xs"
              >
                <svg
                  version="1.1"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 48 48"
                  className="w-4 h-4 block shrink-0"
                >
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                </svg>
                <span>
                  {isGoogleSigningIn
                    ? 'Đang chờ chọn tài khoản Google...'
                    : authMode === 'signup'
                    ? 'Đăng ký & Tiếp tục bằng Google'
                    : 'Đăng nhập bằng Google'}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* VIEW 2: FORGOT PASSWORD (FIREBASE PASSWORD RESET EMAIL ONLY) */}
        {authMode === 'forgot_password' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => handleSwitchAuthMode('login')}
                className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Quay lại đăng nhập</span>
              </button>
              <span className="text-xs font-bold text-amber-700">Khôi phục mật khẩu</span>
            </div>

            {forgotFeedback && (
              <div
                className={`p-3 rounded-xl border text-xs font-medium space-y-1.5 ${
                  forgotFeedback.type === 'error'
                    ? 'bg-red-50 border-red-200 text-red-700'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                }`}
              >
                <div>{forgotFeedback.text}</div>
                {forgotFeedback.type === 'success' && (
                  <button
                    type="button"
                    onClick={() => handleSwitchAuthMode('login')}
                    className="font-bold text-emerald-800 underline block"
                  >
                    Quay lại màn hình đăng nhập →
                  </button>
                )}
              </div>
            )}

            <form onSubmit={handleForgotSubmit} className="space-y-3.5">
              <div>
                <label
                  htmlFor="forgot-gmail-input"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Địa chỉ Email / Gmail đã đăng ký *
                </label>
                <input
                  id="forgot-gmail-input"
                  type="email"
                  required
                  value={forgotGmailInput}
                  onChange={(e) => setForgotGmailInput(e.target.value)}
                  placeholder="VD: vtnntaman@gmail.com"
                  className="w-full px-3.5 py-2.5 text-sm font-mono bg-white border border-slate-300 rounded-xl"
                />
                <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                  Hệ thống sẽ gửi email chứa liên kết đặt lại mật khẩu bảo mật qua Firebase Authentication. Đối với tài khoản nội bộ chưa liên kết Gmail, vui lòng liên hệ Quản lý chính để cấp lại mật khẩu.
                </p>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 px-4 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-60 rounded-full transition-colors flex items-center justify-center gap-2"
              >
                <Mail className="w-4 h-4 shrink-0" />
                <span>{isSubmitting ? 'Đang gửi...' : 'Gửi Email Đặt Lại Mật Khẩu'}</span>
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};

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
  onUpdateStaffPermissions?: (
    uid: string,
    positionRole: StaffPositionRole,
    permissions: StaffFunctionalPermission[],
    assignedWarehouse: string
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
}

export const StaffAccountManager: React.FC<StaffAccountManagerProps> = ({
  staffList,
  currentStaff,
  warehouses,
  onAddWarehouse,
  onChangePassword,
  onCreateStaffAccount,
  onUpdateStaffWarehouse,
  onUpdateStaffPermissions,
  onResetStaffPasswordByManager,
  onToggleStaffActive,
  onUpdateStaffProfile,
  onLogout,
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
      targetStaff.assignedWarehouse
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

    const isSingleWarehouseTarget =
      targetPersonalStaff.assignedWarehouse !== 'Tất cả kho' &&
      !canAccountCreateStaff(targetPersonalStaff);
    const normalizedWarehouseName = isSingleWarehouseTarget
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
                return (
                  <div
                    key={`admin-assign-${st.uid}`}
                    className={`p-3.5 rounded-xl border flex flex-col justify-between gap-2.5 ${
                      isRowAdmin
                        ? 'bg-emerald-50/50 border-emerald-300'
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
                            Tất cả kho
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded shrink-0">
                            Quản lý 1 kho
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 truncate">
                        @{st.username} · {st.email || 'Chưa có Gmail'}
                      </div>
                    </div>

                    <div className="pt-1 border-t border-slate-100 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-slate-600 whitespace-nowrap shrink-0">
                        Kho quản lý:
                      </span>
                      {isRowAdmin ? (
                        <span className="text-xs font-bold text-emerald-900">Tất cả kho</span>
                      ) : (
                        <select
                          aria-label={`Phân quyền kho cho ${st.username}`}
                          value={st.assignedWarehouse}
                          onChange={(e) => {
                            onUpdateStaffWarehouse(st.uid, e.target.value);
                            setRealtimeBanner(
                              `Đã phân quyền quản lý kho "${e.target.value}" cho tài khoản @${st.username} (${st.displayName})`
                            );
                          }}
                          className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-bold bg-emerald-50 border border-emerald-300 rounded-lg text-emerald-950"
                        >
                          {warehouses.map((w) => (
                            <option key={w} value={w}>
                              {w}
                            </option>
                          ))}
                          <option value="Tất cả kho">Tất cả kho (Phó quản lý tổng)</option>
                        </select>
                      )}
                    </div>
                  </div>
                );
              })}
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
                            }}
                            className="px-2.5 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
                          >
                            Phân quyền [X]
                          </button>
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
                            <select
                              aria-label={`Chọn kho phân quyền cho ${st.username}`}
                              value={st.assignedWarehouse}
                              onChange={(e) => onUpdateStaffWarehouse(st.uid, e.target.value)}
                              className="px-2.5 py-1 text-xs font-semibold bg-white border border-slate-200 rounded-md text-emerald-800"
                            >
                              <option value="Tất cả kho">Tất cả kho</option>
                              {warehouses.map((w) => (
                                <option key={w} value={w}>
                                  {w}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="font-bold text-emerald-800">{st.assignedWarehouse}</span>
                          )}
                        </div>

                        {/* Real-Time Interactive [X] / [ ] Permission Chips */}
                        <div className="flex flex-wrap gap-1.5">
                          {ALL_STAFF_FUNCTIONAL_PERMISSIONS.map((p) => {
                            const isGranted = perms.includes(p.key);
                            return (
                              <button
                                key={p.key}
                                type="button"
                                disabled={isPrimaryOwnerRow}
                                onClick={() => handleInstantTogglePermission(st, p.key)}
                                title={
                                  !isPrimaryOwnerRow
                                    ? 'Bấm để bật [X] hoặc tắt [ ] quyền này ngay theo thời gian thực'
                                    : p.description
                                }
                                className={`px-2 py-1 text-[11px] font-medium rounded-md border transition-colors flex items-center gap-1 ${
                                  isGranted
                                    ? 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100'
                                    : 'bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100'
                                } ${!isPrimaryOwnerRow ? 'cursor-pointer' : 'cursor-default'}`}
                              >
                                <span className="font-mono font-bold">
                                  {isGranted ? '[X]' : '[ ]'}
                                </span>
                                <span>{p.label}</span>
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

              {/* Custom Warehouse Display Name with Locked "TÂM AN" Prefix */}
              {targetPersonalStaff.assignedWarehouse !== 'Tất cả kho' &&
                !canAccountCreateStaff(targetPersonalStaff) && (
                  <div className="p-4 rounded-xl bg-emerald-50/80 border border-emerald-200 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label
                        htmlFor="personal-warehouse-suffix"
                        className="text-xs font-bold text-emerald-950 flex items-center gap-1.5"
                      >
                        <Warehouse className="w-4 h-4 text-emerald-700 shrink-0" />
                        <span>Tên hiển thị Kho quản lý *</span>
                      </label>
                      <span className="px-2 py-0.5 text-[11px] font-bold bg-emerald-700 text-white rounded">
                        Quản lý 1 kho độc lập
                      </span>
                    </div>

                    <div className="flex items-stretch rounded-lg overflow-hidden border border-emerald-400 bg-white focus-within:ring-2 focus-within:ring-emerald-600/20">
                      <span className="px-3.5 py-2 text-sm font-mono font-extrabold bg-emerald-800 text-white flex items-center select-none shrink-0">
                        {MANDATORY_WAREHOUSE_PREFIX}
                      </span>
                      <input
                        id="personal-warehouse-suffix"
                        type="text"
                        required
                        value={personalWarehouseSuffix}
                        onChange={(e) => setPersonalWarehouseSuffix(e.target.value)}
                        placeholder="Nhập tên kho (VD: BA SAO, MỸ NGÃI, VTNNTAMAN)..."
                        className="flex-1 min-w-0 px-3 py-2 text-sm font-mono font-bold text-slate-900 bg-white focus:outline-none uppercase"
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-900">
                      <span>
                        Tên kho hiển thị sau khi lưu:{' '}
                        <strong className="font-mono text-emerald-950 bg-white px-2 py-0.5 rounded border border-emerald-300">
                          {normalizeCustomTamAnWarehouseName(
                            personalWarehouseSuffix,
                            personalEmail
                          )}
                        </strong>
                      </span>
                      <span className="text-[11px] text-emerald-700">
                        Ví dụ: nhập <strong>BA SAO</strong> → hiển thị <strong>TÂM AN BA SAO</strong>
                      </span>
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
                    value={permModalWarehouse}
                    onChange={(e) => setPermModalWarehouse(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-semibold bg-white border border-slate-200 rounded-lg"
                  >
                    <option value="Tất cả kho">Tất cả kho (Quản lý chung)</option>
                    {warehouses.map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
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
                    permModalWarehouse
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
                const isSingleWh =
                  editingStaffModal.assignedWarehouse !== 'Tất cả kho' &&
                  !canAccountCreateStaff(editingStaffModal);
                onUpdateStaffProfile({
                  uid: editingStaffModal.uid,
                  displayName: modalDisplayName.trim(),
                  phone: modalPhone.trim(),
                  email: modalEmail.trim(),
                  newPassword: modalPassword.trim() || undefined,
                  customWarehouseName: isSingleWh
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
                  !canAccountCreateStaff(editingStaffModal) && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Tên hiển thị Kho *
                      </label>
                      <div className="flex items-stretch rounded-lg overflow-hidden border border-emerald-400 bg-white">
                        <span className="px-3 py-2 text-xs font-mono font-extrabold bg-emerald-800 text-white flex items-center select-none shrink-0">
                          {MANDATORY_WAREHOUSE_PREFIX}
                        </span>
                        <input
                          type="text"
                          required
                          value={modalWarehouseSuffix}
                          onChange={(e) => setModalWarehouseSuffix(e.target.value)}
                          placeholder="VD: BA SAO"
                          className="flex-1 min-w-0 px-3 py-2 text-xs font-mono font-bold text-slate-900 bg-white focus:outline-none uppercase"
                        />
                      </div>
                      <div className="text-[11px] text-emerald-800 mt-1">
                        Hiển thị:{' '}
                        <strong>
                          {normalizeCustomTamAnWarehouseName(modalWarehouseSuffix, modalEmail)}
                        </strong>
                      </div>
                    </div>
                  )}
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

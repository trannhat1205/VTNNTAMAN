import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  LogIn,
  Mail,
  UserPlus,
  Warehouse,
} from 'lucide-react';
import { StaffMember } from '../types';
import {
  extractCustomWarehouseSuffix,
  formatDefaultWarehouseNameFromGmail,
  MANDATORY_WAREHOUSE_PREFIX,
  normalizeCustomTamAnWarehouseName,
} from '../utils/businessLogic';
import { firebaseSendPasswordResetEmail } from '../services/firebaseService';

export interface PasswordInputWithEyeProps {
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

export interface InitialLoginScreenPortalProps {
  staffList: StaffMember[];
  currentStaff: StaffMember;
  isGoogleAuthenticated: boolean;
  currentUserEmail: string | null;
  onGoogleManagerLogin: (
    customWarehouseName?: string
  ) => Promise<{ ok: boolean; message: string } | void> | void;
  onGoogleLoginByEmail?: (
    email: string,
    googleDisplayName?: string,
    googleUid?: string,
    preferredWarehouseName?: string
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
    customWarehouseName?: string;
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
  const [signUpWarehouseSuffix, setSignUpWarehouseSuffix] = useState('');
  const [hasEditedSignupWarehouse, setHasEditedSignupWarehouse] = useState(false);

  // Live preview of default / custom warehouse name during Sign-Up (TÂM AN + TÊN SỬA ĐỔI)
  const previewDefaultWarehouseName = useMemo(() => {
    if (hasEditedSignupWarehouse && signUpWarehouseSuffix.trim()) {
      return normalizeCustomTamAnWarehouseName(signUpWarehouseSuffix, signUpEmail);
    }
    return formatDefaultWarehouseNameFromGmail(signUpEmail || 'vtnntaman@gmail.com');
  }, [signUpEmail, signUpWarehouseSuffix, hasEditedSignupWarehouse]);

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
          customWarehouseName: previewDefaultWarehouseName,
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
      const preferredWh =
        authMode === 'signup' && hasEditedSignupWarehouse && signUpWarehouseSuffix.trim()
          ? normalizeCustomTamAnWarehouseName(signUpWarehouseSuffix)
          : undefined;
      const res = await onGoogleManagerLogin(preferredWh);
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
                    onChange={(e) => {
                      const nextEmail = e.target.value;
                      setSignUpEmail(nextEmail);
                      if (!hasEditedSignupWarehouse) {
                        setSignUpWarehouseSuffix(
                          extractCustomWarehouseSuffix(
                            formatDefaultWarehouseNameFromGmail(nextEmail || 'vtnntaman@gmail.com')
                          )
                        );
                      }
                    }}
                    placeholder="Địa chỉ Gmail đăng ký (VD: vtnntaman@gmail.com) *"
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15 transition-all"
                  />
                </div>

                {/* Self-Service Independent Warehouse Creator & Name Editor (TÂM AN + TÊN SỬA ĐỔI) */}
                <div className="p-3 rounded-xl bg-emerald-50/90 border border-emerald-200 space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-emerald-900 flex items-center gap-1.5">
                      <Warehouse className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                      <span>Tên kho tự tạo &amp; tự sửa đổi:</span>
                    </span>
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-700 text-white rounded-md">
                      Quản lý 1 kho độc lập
                    </span>
                  </div>
                  <div className="flex items-stretch rounded-lg overflow-hidden border border-emerald-400 bg-white">
                    <span className="px-2.5 py-2 text-xs font-mono font-extrabold bg-emerald-800 text-white flex items-center select-none shrink-0">
                      {MANDATORY_WAREHOUSE_PREFIX}
                    </span>
                    <input
                      id="portal-signup-warehouse-suffix"
                      type="text"
                      value={
                        hasEditedSignupWarehouse
                          ? signUpWarehouseSuffix
                          : extractCustomWarehouseSuffix(previewDefaultWarehouseName)
                      }
                      onChange={(e) => {
                        setHasEditedSignupWarehouse(true);
                        setSignUpWarehouseSuffix(e.target.value);
                      }}
                      placeholder="NHẬP TÊN KHO (VD: BA SAO)"
                      aria-label="Tên kho sửa đổi sau TÂM AN"
                      className="flex-1 min-w-0 px-2.5 py-2 text-xs font-mono font-bold text-slate-900 bg-white focus:outline-none uppercase"
                    />
                  </div>
                  <div className="font-mono font-extrabold text-xs text-emerald-950 tracking-tight">
                    Tên kho hiển thị: {previewDefaultWarehouseName}
                  </div>
                  <p className="text-[11px] text-emerald-800 leading-snug">
                    Hệ thống tự cấp kho riêng và đồng bộ thời gian thực — bạn tự đặt/đổi tên theo chuẩn{' '}
                    <strong>&quot;TÂM AN + TÊN SỬA ĐỔI&quot;</strong> không cần Admin cấp.
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

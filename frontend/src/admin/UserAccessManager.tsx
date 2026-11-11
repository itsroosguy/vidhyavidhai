import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Edit3,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
  XCircle,
} from 'lucide-react';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { INITIAL_SUPER_ADMINS, isAllowlistedSuperAdmin } from '../config/accessControl';
import type { BackendApiClient } from '../services/apiClient';
import type {
  AppConfiguration,
  FacilitatorApprovalMode,
  ManagedUser,
  UserProfile,
} from '../types/domain';

interface UserAccessManagerProps {
  api: BackendApiClient;
  currentUser: UserProfile;
  config?: AppConfiguration;
  onConfigUpdated?: (next: AppConfiguration) => void;
  onUsersChanged?: (pendingCount: number) => void;
  onNotify: (type: 'success' | 'error' | 'warning', title: string, detail?: string) => void;
}

export const UserAccessManager: React.FC<UserAccessManagerProps> = ({
  api,
  currentUser,
  config,
  onConfigUpdated,
  onUsersChanged,
  onNotify,
}) => {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const currentPwRef = useRef<HTMLInputElement>(null);
  const newPwRef = useRef<HTMLInputElement>(null);
  const pwAnnounceTimerRef = useRef<number | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [currentPwTouched, setCurrentPwTouched] = useState(false);
  const [currentPwSubmitted, setCurrentPwSubmitted] = useState(false);
  const [currentPwServerError, setCurrentPwServerError] = useState<string | null>(null);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [newPwTouched, setNewPwTouched] = useState(false);
  const [newPwSubmitted, setNewPwSubmitted] = useState(false);
  const [newPwServerError, setNewPwServerError] = useState<string | null>(null);
  const [showNewPassword, setShowNewPassword] = useState(false);

  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordSavedMessage, setPasswordSavedMessage] = useState<string | null>(null);
  const [pwLiveAnnouncement, setPwLiveAnnouncement] = useState('');

  const schedulePwAnnouncement = useCallback((message: string, delayMs = 0) => {
    if (typeof window === 'undefined') return;
    if (pwAnnounceTimerRef.current !== null) {
      window.clearTimeout(pwAnnounceTimerRef.current);
      pwAnnounceTimerRef.current = null;
    }
    setPwLiveAnnouncement('');
    if (!message) return;
    if (delayMs <= 0) {
      setPwLiveAnnouncement(message);
      return;
    }
    pwAnnounceTimerRef.current = window.setTimeout(() => {
      setPwLiveAnnouncement(message);
    }, delayMs);
  }, []);

  useEffect(() => {
    return () => {
      if (pwAnnounceTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(pwAnnounceTimerRef.current);
      }
    };
  }, []);

  const captionId = useId();
  const isSuperAdmin = currentUser.role === 'super_admin';
  const isSupabaseMode = api.mode === 'supabase';
  const approvalMode: FacilitatorApprovalMode =
    config?.policy.facilitatorApprovalMode ?? 'manual_allowlist';

  const loadUsers = useCallback(async () => {
    const res = await api.listManagedUsers();
    if (res.ok && res.data) {
      setUsers(res.data);
      const pending = res.data.filter(
        (u) => !isAllowlistedSuperAdmin(u.email) && u.status === 'PENDING',
      ).length;
      onUsersChanged?.(pending);
    }
  }, [api, onUsersChanged]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const handleAddFacilitator = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.manageUser({
        name,
        email,
        role: 'facilitator',
        active: true,
        status: 'APPROVED',
      });
      if (res.ok) {
        onNotify('success', 'Facilitator approved', `${email} added as Facilitator`);
        setName('');
        setEmail('');
        await loadUsers();
      } else {
        onNotify('error', 'Failed to save user', res.error);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSetStatus = async (
    u: ManagedUser,
    nextStatus: 'APPROVED' | 'DENIED',
  ) => {
    const res = await api.manageUser({
      userId: u.userId,
      name: u.name,
      email: u.email,
      role: 'facilitator',
      active: nextStatus === 'APPROVED',
      status: nextStatus,
    });
    if (res.ok) {
      onNotify(
        'success',
        nextStatus === 'APPROVED' ? 'Facilitator approved' : 'Facilitator access denied',
        u.email,
      );
      await loadUsers();
    } else {
      onNotify('error', 'Action denied', res.error);
    }
  };

  const handleSaveUserName = async (u: ManagedUser) => {
    const trimmed = editingName.trim();
    if (!trimmed) {
      onNotify('warning', 'Facilitator name cannot be empty');
      return;
    }
    setSavingEdit(true);
    try {
      const currentStatus = u.status ?? (u.active ? 'APPROVED' : 'DENIED');
      const res = await api.manageUser({
        userId: u.userId,
        name: trimmed,
        email: u.email,
        role: 'facilitator',
        active: u.active,
        status: currentStatus,
      });
      if (res.ok) {
        onNotify('success', 'Facilitator name updated', `${trimmed} (${u.email})`);
        setEditingUserId(null);
        setEditingName('');
        await loadUsers();
      } else {
        onNotify('error', 'Failed to update facilitator name', res.error);
      }
    } finally {
      setSavingEdit(false);
    }
  };

  const handleConfirmDeleteUser = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    const res = await api.deleteUser(target.userId || target.email);
    if (res.ok) {
      onNotify('success', 'User removed from directory', target.email);
      await loadUsers();
    } else {
      onNotify('error', 'Failed to remove user', res.error);
    }
  };

  const handleApprovalModeChange = async (nextMode: FacilitatorApprovalMode) => {
    if (!isSuperAdmin || !config) return;
    setSavingPolicy(true);
    try {
      const res = await api.saveAppConfiguration({
        policy: {
          allowFacilitatorDeleteOwn: config.policy.allowFacilitatorDeleteOwn,
          allowFacilitatorExportOwn: false,
          facilitatorApprovalMode: nextMode,
        },
      });
      if (res.ok && res.data) {
        onConfigUpdated?.(res.data);
        onNotify(
          'success',
          'Approval policy updated',
          nextMode === 'manual_allowlist'
            ? 'New Google accounts wait for Super Admin approval.'
            : 'Verified Google accounts are auto-approved as Facilitators.',
        );
      } else {
        onNotify('error', 'Failed to update approval policy', res.error);
      }
    } finally {
      setSavingPolicy(false);
    }
  };

  const currentPwError =
    currentPwServerError ||
    ((currentPwTouched || currentPwSubmitted) && !currentPassword
      ? 'Enter your current Super Administrator password.'
      : null);

  const newPwError =
    newPwServerError ||
    ((newPwTouched || newPwSubmitted) && newPassword.trim().length < 8
      ? 'Enter a new password with at least 8 characters.'
      : null);

  const handleChangeSuperAdminPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (typeof api.changeSuperAdminPassword !== 'function') return;
    setCurrentPwSubmitted(true);
    setNewPwSubmitted(true);
    setCurrentPwServerError(null);
    setNewPwServerError(null);
    setPasswordSavedMessage(null);

    if (!currentPassword) {
      schedulePwAnnouncement('');
      currentPwRef.current?.focus();
      return;
    }
    if (newPassword.trim().length < 8) {
      schedulePwAnnouncement('');
      newPwRef.current?.focus();
      return;
    }
    if (newPassword === currentPassword) {
      const sameMsg = 'New password must be different from your current password.';
      setNewPwServerError(sameMsg);
      schedulePwAnnouncement('');
      newPwRef.current?.focus();
      return;
    }

    setSavingPassword(true);
    try {
      const res = await api.changeSuperAdminPassword(currentPassword, newPassword);
      if (res.ok) {
        setCurrentPassword('');
        setNewPassword('');
        setCurrentPwTouched(false);
        setCurrentPwSubmitted(false);
        setNewPwTouched(false);
        setNewPwSubmitted(false);
        setShowCurrentPassword(false);
        setShowNewPassword(false);
        const successText = isSupabaseMode
          ? 'Password updated securely in Supabase Auth. Use your new password next time you sign in.'
          : 'Password updated securely. Use your new password next time you sign in on this browser.';
        setPasswordSavedMessage(successText);
        schedulePwAnnouncement(successText, 250);
        onNotify('success', 'Super Administrator password updated', currentUser.email);
      } else if (res.code === 'INVALID_CURRENT_PASSWORD' || res.code === 'INVALID_PASSWORD') {
        const msg = res.error || 'Current password is incorrect.';
        setCurrentPwServerError(msg);
        schedulePwAnnouncement(`Current password: ${msg}`, 500);
        window.setTimeout(() => currentPwRef.current?.focus(), 0);
      } else {
        const msg = res.error || 'Unable to update password.';
        setNewPwServerError(msg);
        schedulePwAnnouncement(`New password: ${msg}`, 500);
        window.setTimeout(() => newPwRef.current?.focus(), 0);
      }
    } finally {
      setSavingPassword(false);
    }
  };

  const pendingUsers = users.filter(
    (u) => !isAllowlistedSuperAdmin(u.email) && u.status === 'PENDING',
  );
  const directoryUsers = users.filter(
    (u) => !isAllowlistedSuperAdmin(u.email),
  );

  return (
    <div className="flex flex-col gap-5">
      {/* 1. Protected Super Administrator Accounts */}
      <section className="ct-card p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="text-lg sm:text-xl font-medium text-[#0A1B2C] flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[#006BB8]" aria-hidden="true" />
              Protected Super Administrators ({INITIAL_SUPER_ADMINS.length})
            </h2>
            <p className="text-xs sm:text-sm text-[#243647] mt-0.5 leading-relaxed">
              {isSupabaseMode
                ? 'Enforced strictly at the PostgreSQL database level via Supabase Auth, email allowlisting, and Row-Level Security policies. Plaintext passwords are never stored in browser storage, database tables, exports, or audit logs, and no other account can elevate itself to Administrator.'
                : 'Enforced strictly via allowlist verification and salted PBKDF2-SHA256 password authentication on local sign-in (and Google OAuth when connected online). Plaintext passwords are never stored in browser storage, database sheets, exports, or audit logs, and no other account can be elevated to Administrator.'}
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#E8F6FF] border border-[#0284C7]/45 text-[#006BB8]">
            <Lock className="w-3.5 h-3.5" aria-hidden="true" />
            Password-Protected Allowlist
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {INITIAL_SUPER_ADMINS.map((admin) => (
            <div
              key={admin.userId}
              className="p-3.5 rounded-xl bg-[#F5F2E9] border border-[#DFD7C2] flex items-center justify-between gap-3 text-xs"
            >
              <div className="min-w-0">
                <div className="font-medium text-[#0A1B2C]">{admin.name}</div>
                <div className="font-mono text-[#243647] truncate">{admin.email}</div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#0A1B2C] text-[#FAF8F2]">
                  SUPER_ADMIN
                </span>
                <span className="text-[11px] text-[#047857]">Password protected</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 1b. Change Signed-In Super Administrator Password */}
      {isSuperAdmin &&
        isAllowlistedSuperAdmin(currentUser.email) &&
        typeof api.changeSuperAdminPassword === 'function' && (
          <section className="ct-card p-5 sm:p-6">
            <div aria-live="polite" className="visually-hidden">
              {pwLiveAnnouncement}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h3
                  id="change-sa-password-heading"
                  className="text-base sm:text-lg font-medium text-[#0A1B2C] flex items-center gap-2"
                >
                  <KeyRound className="w-4 h-4 text-[#006BB8]" aria-hidden="true" />
                  <span>Change Super Administrator Password</span>
                </h3>
                <p className="text-xs text-[#243647] mt-0.5 leading-relaxed">
                  {isSupabaseMode ? (
                    <>
                      Update the Supabase Auth sign-in password for{' '}
                      <span className="font-mono text-[#0A1B2C]">{currentUser.email}</span>.
                      Credentials are hashed server-side by Supabase Auth.
                    </>
                  ) : (
                    <>
                      Update the login password for{' '}
                      <span className="font-mono text-[#0A1B2C]">{currentUser.email}</span> on this
                      browser. Only a salted cryptographic hash is stored locally.
                    </>
                  )}
                </p>
              </div>
            </div>

            {passwordSavedMessage && (
              <div
                role="status"
                className="mb-4 flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-xs bg-[#ECFDF5] border border-[#047857]/35 text-[#047857]"
              >
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{passwordSavedMessage}</span>
              </div>
            )}

            <form
              method="post"
              aria-labelledby="change-sa-password-heading"
              onSubmit={(e) => void handleChangeSuperAdminPassword(e)}
              noValidate
              className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start"
            >
              <input
                type="email"
                name="email"
                autoComplete="username"
                value={currentUser.email}
                readOnly
                tabIndex={-1}
                aria-hidden="true"
                className="visually-hidden"
              />

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="sa-current-password"
                  className="text-xs font-medium text-[#0A1B2C]"
                >
                  Current password <span aria-hidden="true">*</span>
                </label>
                <span id="sa-current-pw-hint" className="text-xs text-[#33475B]">
                  Enter your active Super Administrator password.
                </span>
                <span id="sa-current-pw-warning" className="visually-hidden">
                  Warning: this will display your current password on the screen.
                </span>
                <div className="flex items-stretch gap-2">
                  <div className="relative flex-1 min-w-0">
                    <Lock
                      className="w-4 h-4 text-[#33475B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      ref={currentPwRef}
                      id="sa-current-password"
                      name="currentPassword"
                      type={showCurrentPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      enterKeyHint="next"
                      placeholder="Current password"
                      value={currentPassword}
                      onChange={(e) => {
                        setCurrentPassword(e.target.value);
                        setCurrentPwTouched(false);
                        setCurrentPwSubmitted(false);
                        if (currentPwServerError) setCurrentPwServerError(null);
                        setPasswordSavedMessage(null);
                        schedulePwAnnouncement('');
                      }}
                      onBlur={() => {
                        setCurrentPwTouched(true);
                        if (!currentPassword) {
                          schedulePwAnnouncement(
                            'Current password: Enter your current Super Administrator password.',
                            500,
                          );
                        }
                      }}
                      aria-invalid={Boolean(currentPwError)}
                      aria-describedby={
                        currentPwError
                          ? 'sa-current-pw-hint sa-current-pw-error'
                          : 'sa-current-pw-hint'
                      }
                      className="ct-input pl-10 text-sm rounded-xl bg-[#FFFFFF] border-[#5F7082]"
                    />
                  </div>
                  <button
                    type="button"
                    aria-pressed={showCurrentPassword}
                    aria-label={
                      showCurrentPassword ? 'Hide current password' : 'Show current password'
                    }
                    aria-describedby="sa-current-pw-warning"
                    onClick={() => setShowCurrentPassword((v) => !v)}
                    className="min-w-[44px] min-h-[44px] px-2.5 rounded-xl bg-[#FFFFFF] hover:bg-[#F5F2E9] border border-[#5F7082] hover:border-[#0284C7] text-[#0A1B2C] inline-flex items-center justify-center cursor-pointer transition-colors shrink-0"
                  >
                    {showCurrentPassword ? (
                      <EyeOff className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <Eye className="w-4 h-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
                {currentPwError && (
                  <div
                    id="sa-current-pw-error"
                    className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs bg-[#FFF1F2] border border-[#BE123C]/40 text-[#BE123C]"
                  >
                    <AlertCircle
                      role="img"
                      aria-label="Error"
                      className="w-4 h-4 shrink-0 mt-0.5"
                    />
                    <span>{currentPwError}</span>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="sa-new-password" className="text-xs font-medium text-[#0A1B2C]">
                  New password <span aria-hidden="true">*</span>
                </label>
                <span id="sa-new-pw-hint" className="text-xs text-[#33475B]">
                  At least 8 characters and different from your current password.
                </span>
                <span id="sa-new-pw-warning" className="visually-hidden">
                  Warning: this will display your new password on the screen.
                </span>
                <div className="flex items-stretch gap-2">
                  <div className="relative flex-1 min-w-0">
                    <KeyRound
                      className="w-4 h-4 text-[#33475B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      ref={newPwRef}
                      id="sa-new-password"
                      name="newPassword"
                      type={showNewPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      enterKeyHint="done"
                      placeholder="New password (min 8 chars)"
                      value={newPassword}
                      onChange={(e) => {
                        setNewPassword(e.target.value);
                        setNewPwTouched(false);
                        setNewPwSubmitted(false);
                        if (newPwServerError) setNewPwServerError(null);
                        setPasswordSavedMessage(null);
                        schedulePwAnnouncement('');
                      }}
                      onBlur={() => {
                        setNewPwTouched(true);
                        if (newPassword.trim().length < 8) {
                          schedulePwAnnouncement(
                            'New password: Enter a new password with at least 8 characters.',
                            500,
                          );
                        }
                      }}
                      aria-invalid={Boolean(newPwError)}
                      aria-describedby={
                        newPwError ? 'sa-new-pw-hint sa-new-pw-error' : 'sa-new-pw-hint'
                      }
                      className="ct-input pl-10 text-sm rounded-xl bg-[#FFFFFF] border-[#5F7082]"
                    />
                  </div>
                  <button
                    type="button"
                    aria-pressed={showNewPassword}
                    aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                    aria-describedby="sa-new-pw-warning"
                    onClick={() => setShowNewPassword((v) => !v)}
                    className="min-w-[44px] min-h-[44px] px-2.5 rounded-xl bg-[#FFFFFF] hover:bg-[#F5F2E9] border border-[#5F7082] hover:border-[#0284C7] text-[#0A1B2C] inline-flex items-center justify-center cursor-pointer transition-colors shrink-0"
                  >
                    {showNewPassword ? (
                      <EyeOff className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <Eye className="w-4 h-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
                {newPwError && (
                  <div
                    id="sa-new-pw-error"
                    className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs bg-[#FFF1F2] border border-[#BE123C]/40 text-[#BE123C]"
                  >
                    <AlertCircle
                      role="img"
                      aria-label="Error"
                      className="w-4 h-4 shrink-0 mt-0.5"
                    />
                    <span>{newPwError}</span>
                  </div>
                )}
              </div>

              <div className="md:col-span-2 flex justify-end">
                <button
                  type="submit"
                  disabled={savingPassword}
                  className="ct-btn-primary text-sm min-h-[44px]"
                >
                  <KeyRound className="w-4 h-4" aria-hidden="true" />
                  <span>{savingPassword ? 'Updating password...' : 'Update password'}</span>
                </button>
              </div>
            </form>
          </section>
        )}

      {/* 2. Facilitator Google Login Approval Policy */}
      {config && (
        <section className="ct-card p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="text-base sm:text-lg font-medium text-[#0A1B2C]">
                {isSupabaseMode
                  ? 'Sign-In Approval Policy (Non-Admin Users)'
                  : 'Google Sign-In Approval Policy (Non-Admin Users)'}
              </h3>
              <p className="text-xs text-[#243647] mt-0.5">
                {isSupabaseMode ? (
                  <>
                    Every non-allowlisted user authenticates through Supabase Auth (Google OAuth or
                    Email) and always receives the restricted{' '}
                    <strong className="font-medium text-[#0A1B2C]">Facilitator</strong> role.
                  </>
                ) : (
                  <>
                    Every non-allowlisted user authenticates through Google OAuth and always receives
                    the restricted <strong className="font-medium text-[#0A1B2C]">Facilitator</strong>{' '}
                    role.
                  </>
                )}
              </p>
            </div>
            {savingPolicy && (
              <span className="text-xs text-[#006BB8] font-medium">Saving policy...</span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <label
              className={`p-3.5 rounded-xl border cursor-pointer transition-colors flex items-start gap-2.5 ${
                approvalMode === 'manual_allowlist'
                  ? 'bg-[#E8F6FF] border-[#0284C7] text-[#0A1B2C]'
                  : 'bg-[#F5F2E9] border-[#DFD7C2] text-[#243647] hover:border-[#0284C7]/60'
              }`}
            >
              <input
                type="radio"
                name="facilitator-approval-mode"
                value="manual_allowlist"
                disabled={!isSuperAdmin || savingPolicy}
                checked={approvalMode === 'manual_allowlist'}
                onChange={() => void handleApprovalModeChange('manual_allowlist')}
                className="mt-0.5 accent-[#006BB8]"
              />
              <div>
                <div className="font-medium text-[#0A1B2C]">
                  Manual Allowlist / Approval Queue (Recommended)
                </div>
                <p className="text-[#243647] mt-1 leading-relaxed">
                  Unrecognized Google users are placed into a Pending queue and cannot enter data
                  until a Super Administrator approves them below.
                </p>
              </div>
            </label>

            <label
              className={`p-3.5 rounded-xl border cursor-pointer transition-colors flex items-start gap-2.5 ${
                approvalMode === 'auto_approve'
                  ? 'bg-[#E8F6FF] border-[#0284C7] text-[#0A1B2C]'
                  : 'bg-[#F5F2E9] border-[#DFD7C2] text-[#243647] hover:border-[#0284C7]/60'
              }`}
            >
              <input
                type="radio"
                name="facilitator-approval-mode"
                value="auto_approve"
                disabled={!isSuperAdmin || savingPolicy}
                checked={approvalMode === 'auto_approve'}
                onChange={() => void handleApprovalModeChange('auto_approve')}
                className="mt-0.5 accent-[#006BB8]"
              />
              <div>
                <div className="font-medium text-[#0A1B2C]">
                  Auto-Approve Verified Google Logins
                </div>
                <p className="text-[#243647] mt-1 leading-relaxed">
                  Any verified Google account signs straight into Classroom Data Entry as a
                  Facilitator unless explicitly denied here.
                </p>
              </div>
            </label>
          </div>
        </section>
      )}

      {/* 3. Pending Approval Queue */}
      {pendingUsers.length > 0 && (
        <section
          aria-label="Pending facilitator approval requests"
          className="ct-card p-5 sm:p-6 border-[#B45309]/45 bg-[#FFFBEB]"
        >
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-5 h-5 text-[#B45309]" aria-hidden="true" />
            <h3 className="text-base sm:text-lg font-medium text-[#0A1B2C] ct-num">
              Pending Approval Queue ({pendingUsers.length})
            </h3>
          </div>
          <div className="space-y-2.5">
            {pendingUsers.map((u) => (
              <div
                key={u.userId}
                className="p-3.5 rounded-xl bg-[#FFFFFF] border border-[#DFD7C2] flex flex-wrap items-center justify-between gap-3 text-xs"
              >
                <div>
                  <div className="font-medium text-[#0A1B2C]">{u.name}</div>
                  <div className="font-mono text-[#243647]">{u.email}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!isSuperAdmin}
                    onClick={() => void handleSetStatus(u, 'APPROVED')}
                    className="ct-btn-primary text-xs min-h-[36px] px-3 py-1"
                  >
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                    Approve Facilitator
                  </button>
                  <button
                    type="button"
                    disabled={!isSuperAdmin}
                    onClick={() => void handleSetStatus(u, 'DENIED')}
                    className="ct-btn-danger text-xs min-h-[36px] px-3 py-1"
                  >
                    <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                    Deny
                  </button>
                  <button
                    type="button"
                    disabled={!isSuperAdmin}
                    onClick={() => setDeleteTarget(u)}
                    aria-label={`Remove ${u.email}`}
                    className="ct-btn-secondary text-xs min-h-[36px] px-3 py-1 border-[#BE123C]/40 text-[#BE123C] hover:bg-[#FFF1F2]"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 4. Facilitator Allowlist & Pre-Approval Table */}
      <section className="ct-card p-5 sm:p-6">
        <h3 className="text-base sm:text-lg font-medium text-[#0A1B2C] mb-1">
          Facilitator Directory &amp; Pre-Approval ({directoryUsers.length})
        </h3>
        <p className="text-xs sm:text-sm text-[#243647] mb-4 leading-relaxed">
          Pre-approve a Google email for direct Facilitator access, or deactivate/deny accounts at
          any time. Facilitators only access Classroom Data Entry and their own submissions.
        </p>

        <form
          onSubmit={(e) => void handleAddFacilitator(e)}
          className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5"
        >
          <input
            type="text"
            required
            placeholder="Facilitator full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="ct-input text-sm"
            aria-label="New facilitator full name"
          />
          <input
            type="email"
            required
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Google email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="ct-input text-sm"
            aria-label="New facilitator Google email"
          />
          <button
            type="submit"
            disabled={!isSuperAdmin || saving}
            className="ct-btn-primary text-sm"
          >
            <UserPlus className="w-4 h-4" aria-hidden="true" />
            Add / Approve Facilitator
          </button>
        </form>

        <div
          tabIndex={0}
          role="region"
          aria-labelledby={captionId}
          className="ct-table-wrapper rounded-xl border border-[#DFD7C2]"
        >
          <table className="w-full text-left text-xs border-collapse min-w-[660px]">
            <caption id={captionId} className="visually-hidden">
              Facilitator access control directory
            </caption>
            <thead className="bg-[#F5F2E9] text-[#243647] uppercase text-[11px]">
              <tr>
                <th scope="col" className="p-3 font-medium">Name</th>
                <th scope="col" className="p-3 font-medium">Google Email</th>
                <th scope="col" className="p-3 font-medium">Role</th>
                <th scope="col" className="p-3 font-medium">Status</th>
                <th scope="col" className="p-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DFD7C2]">
              {directoryUsers.map((u) => {
                const status = u.status ?? (u.active ? 'APPROVED' : 'DENIED');
                const badgeClass =
                  status === 'APPROVED' && u.active
                    ? 'bg-[#ECFDF5] border-[#047857]/35 text-[#047857]'
                    : status === 'PENDING'
                      ? 'bg-[#FFFBEB] border-[#B45309]/40 text-[#92400E]'
                      : 'bg-[#FFF1F2] border-[#BE123C]/40 text-[#BE123C]';

                return (
                  <tr key={u.userId} className="bg-[#FFFFFF] hover:bg-[#F5F2E9] transition-colors">
                    <td className="p-3 font-medium text-[#0A1B2C]">
                      {editingUserId === u.userId ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            aria-label={`Edit name for ${u.email}`}
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            className="ct-input text-xs min-h-[34px] py-1 px-2 max-w-[190px]"
                          />
                          <button
                            type="button"
                            disabled={savingEdit}
                            onClick={() => void handleSaveUserName(u)}
                            aria-label={`Save name for ${u.email}`}
                            className="p-1.5 rounded-lg bg-[#E8F6FF] border border-[#0284C7]/45 text-[#006BB8] cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingUserId(null);
                              setEditingName('');
                            }}
                            aria-label={`Cancel editing ${u.email}`}
                            className="p-1.5 rounded-lg bg-[#F5F2E9] border border-[#8E8674] text-[#243647] cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span>{u.name}</span>
                          {isSuperAdmin && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingUserId(u.userId);
                                setEditingName(u.name);
                              }}
                              aria-label={`Edit name for ${u.email}`}
                              className="p-1 rounded hover:bg-[#EFE8D6] text-[#243647] hover:text-[#006BB8] cursor-pointer transition-colors"
                            >
                              <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="p-3 font-mono text-[#243647]">{u.email}</td>
                    <td className="p-3 uppercase font-medium text-[#243647]">FACILITATOR</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full font-medium border ${badgeClass}`}>
                        {status}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {status !== 'APPROVED' || !u.active ? (
                          <button
                            type="button"
                            disabled={!isSuperAdmin}
                            onClick={() => void handleSetStatus(u, 'APPROVED')}
                            className="ct-btn-secondary text-xs min-h-[34px] px-3 py-1"
                          >
                            Approve
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={!isSuperAdmin}
                            onClick={() => void handleSetStatus(u, 'DENIED')}
                            className="ct-btn-secondary text-xs min-h-[34px] px-3 py-1"
                          >
                            Deny / Deactivate
                          </button>
                        )}
                        {isSuperAdmin && (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(u)}
                            aria-label={`Remove user ${u.email}`}
                            className="p-2 rounded-lg bg-[#FFF1F2] hover:bg-[#FFE4E6] border border-[#BE123C]/40 text-[#BE123C] cursor-pointer transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Remove user from directory?"
        description={
          isSupabaseMode
            ? 'This revokes and removes this Facilitator profile from Supabase PostgreSQL. Any existing sessions submitted by this user remain safely preserved in form_submissions.'
            : 'This permanently removes this Facilitator account from Google Sheets (Facilitators tab). Any existing sessions submitted by this user remain in the Sessions tab.'
        }
        metadata={
          deleteTarget
            ? [
                { label: 'Name', value: deleteTarget.name },
                { label: isSupabaseMode ? 'Email' : 'Google Email', value: deleteTarget.email },
                { label: 'Status', value: deleteTarget.status ?? (deleteTarget.active ? 'APPROVED' : 'DENIED') },
              ]
            : undefined
        }
        confirmLabel="Yes, remove user"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => void handleConfirmDeleteUser()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};

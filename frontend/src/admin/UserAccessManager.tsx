import React, { useCallback, useEffect, useId, useState } from 'react';
import { Check, Clock, Lock, ShieldCheck, UserPlus, XCircle } from 'lucide-react';
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

  const captionId = useId();
  const isSuperAdmin = currentUser.role === 'super_admin';
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
            <h2 className="text-lg sm:text-xl font-medium text-[#E8EFFC] flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[#4EBBBB]" aria-hidden="true" />
              Protected Super Administrators ({INITIAL_SUPER_ADMINS.length})
            </h2>
            <p className="text-xs sm:text-sm text-[#A4B7D2] mt-0.5 leading-relaxed">
              Enforced strictly via server-side allowlist and Google OAuth authentication. No
              passwords exist in frontend, source code, database sheets, or exports, and no other
              account can be elevated to Administrator.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#4EBBBB]/15 border border-[#4EBBBB]/45 text-[#4EBBBB]">
            <Lock className="w-3.5 h-3.5" aria-hidden="true" />
            Server-Locked Allowlist
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {INITIAL_SUPER_ADMINS.map((admin) => (
            <div
              key={admin.userId}
              className="p-3.5 rounded-xl bg-[#0C1931] border border-[#26456F] flex items-center justify-between gap-3 text-xs"
            >
              <div className="min-w-0">
                <div className="font-medium text-[#E8EFFC]">{admin.name}</div>
                <div className="font-mono text-[#A4B7D2] truncate">{admin.email}</div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#4EBBBB]/15 border border-[#4EBBBB]/45 text-[#4EBBBB]">
                  SUPER_ADMIN
                </span>
                <span className="text-[11px] text-[#48B98A]">Active · Protected</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 2. Facilitator Google Login Approval Policy */}
      {config && (
        <section className="ct-card p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="text-base sm:text-lg font-medium text-[#E8EFFC]">
                Google Sign-In Approval Policy (Non-Admin Users)
              </h3>
              <p className="text-xs text-[#A4B7D2] mt-0.5">
                Every non-allowlisted user authenticates through Google OAuth and always receives
                the restricted <strong className="font-medium text-[#E8EFFC]">Facilitator</strong>{' '}
                role.
              </p>
            </div>
            {savingPolicy && (
              <span className="text-xs text-[#4EBBBB] font-medium">Saving policy...</span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <label
              className={`p-3.5 rounded-xl border cursor-pointer transition-colors flex items-start gap-2.5 ${
                approvalMode === 'manual_allowlist'
                  ? 'bg-[#4EBBBB]/12 border-[#4EBBBB]/55 text-[#E8EFFC]'
                  : 'bg-[#0C1931] border-[#26456F] text-[#A4B7D2] hover:border-[#4EBBBB]/40'
              }`}
            >
              <input
                type="radio"
                name="facilitator-approval-mode"
                value="manual_allowlist"
                disabled={!isSuperAdmin || savingPolicy}
                checked={approvalMode === 'manual_allowlist'}
                onChange={() => void handleApprovalModeChange('manual_allowlist')}
                className="mt-0.5 accent-[#4EBBBB]"
              />
              <div>
                <div className="font-medium text-[#E8EFFC]">
                  Manual Allowlist / Approval Queue (Recommended)
                </div>
                <p className="text-[#A4B7D2] mt-1 leading-relaxed">
                  Unrecognized Google users are placed into a Pending queue and cannot enter data
                  until a Super Administrator approves them below.
                </p>
              </div>
            </label>

            <label
              className={`p-3.5 rounded-xl border cursor-pointer transition-colors flex items-start gap-2.5 ${
                approvalMode === 'auto_approve'
                  ? 'bg-[#4EBBBB]/12 border-[#4EBBBB]/55 text-[#E8EFFC]'
                  : 'bg-[#0C1931] border-[#26456F] text-[#A4B7D2] hover:border-[#4EBBBB]/40'
              }`}
            >
              <input
                type="radio"
                name="facilitator-approval-mode"
                value="auto_approve"
                disabled={!isSuperAdmin || savingPolicy}
                checked={approvalMode === 'auto_approve'}
                onChange={() => void handleApprovalModeChange('auto_approve')}
                className="mt-0.5 accent-[#4EBBBB]"
              />
              <div>
                <div className="font-medium text-[#E8EFFC]">
                  Auto-Approve Verified Google Logins
                </div>
                <p className="text-[#A4B7D2] mt-1 leading-relaxed">
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
          className="ct-card p-5 sm:p-6 border-[#F2B44D]/50 bg-[#392A11]"
        >
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-5 h-5 text-[#F2B44D]" aria-hidden="true" />
            <h3 className="text-base sm:text-lg font-medium text-[#E8EFFC] ct-num">
              Pending Approval Queue ({pendingUsers.length})
            </h3>
          </div>
          <div className="space-y-2.5">
            {pendingUsers.map((u) => (
              <div
                key={u.userId}
                className="p-3.5 rounded-xl bg-[#0C1931] border border-[#26456F] flex flex-wrap items-center justify-between gap-3 text-xs"
              >
                <div>
                  <div className="font-medium text-[#E8EFFC]">{u.name}</div>
                  <div className="font-mono text-[#A4B7D2]">{u.email}</div>
                </div>
                <div className="flex items-center gap-2">
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
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 4. Facilitator Allowlist & Pre-Approval Table */}
      <section className="ct-card p-5 sm:p-6">
        <h3 className="text-base sm:text-lg font-medium text-[#E8EFFC] mb-1">
          Facilitator Directory &amp; Pre-Approval ({directoryUsers.length})
        </h3>
        <p className="text-xs sm:text-sm text-[#A4B7D2] mb-4 leading-relaxed">
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
          className="ct-table-wrapper rounded-xl border border-[#26456F]"
        >
          <table className="w-full text-left text-xs border-collapse min-w-[660px]">
            <caption id={captionId} className="visually-hidden">
              Facilitator access control directory
            </caption>
            <thead className="bg-[#0C1931] text-[#A4B7D2] uppercase text-[11px]">
              <tr>
                <th scope="col" className="p-3 font-medium">Name</th>
                <th scope="col" className="p-3 font-medium">Google Email</th>
                <th scope="col" className="p-3 font-medium">Role</th>
                <th scope="col" className="p-3 font-medium">Status</th>
                <th scope="col" className="p-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#26456F]">
              {directoryUsers.map((u) => {
                const status = u.status ?? (u.active ? 'APPROVED' : 'DENIED');
                const badgeClass =
                  status === 'APPROVED' && u.active
                    ? 'bg-[#48B98A]/15 border-[#48B98A]/40 text-[#48B98A]'
                    : status === 'PENDING'
                      ? 'bg-[#392A11] border-[#F2B44D]/45 text-[#F2B44D]'
                      : 'bg-[#E77B83]/15 border-[#E77B83]/45 text-[#E77B83]';

                return (
                  <tr key={u.userId} className="bg-[#101E3C] hover:bg-[#162D55] transition-colors">
                    <td className="p-3 font-medium text-[#E8EFFC]">{u.name}</td>
                    <td className="p-3 font-mono text-[#A4B7D2]">{u.email}</td>
                    <td className="p-3 uppercase font-medium text-[#A4B7D2]">FACILITATOR</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full font-medium border ${badgeClass}`}>
                        {status}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-2">
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
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

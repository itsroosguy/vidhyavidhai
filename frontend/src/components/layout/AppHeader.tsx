import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardEdit,
  FolderKanban,
  GraduationCap,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { UserProfile } from '../../types/domain';

export type ActiveTab = 'enter_class' | 'my_classes' | 'admin_dashboard';

interface AppHeaderProps {
  user: UserProfile;
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onSignOut: () => void;
  isLiveBackend: boolean;
  outboxCount?: number;
  onOpenSyncStatus?: () => void;
  onRetryOutbox?: () => void;
  onOpenQuickAddModal?: () => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  user,
  activeTab,
  onSelectTab,
  onSignOut,
  isLiveBackend,
  outboxCount = 0,
  onOpenSyncStatus,
  onRetryOutbox,
  onOpenQuickAddModal,
}) => {
  const isSuperAdmin = user.role === 'super_admin';
  const containerClass = 'max-w-[1220px]';

  return (
    <header className={`w-full ${containerClass} mx-auto pt-4 pb-5 px-4 sm:px-6 transition-all`}>
      {/* Unified Top Studio Bar */}
      <div className="mb-4 px-4 py-2.5 rounded-2xl bg-[#FFFFFF]/92 backdrop-blur-md border border-[#E2E8F0] shadow-[0_6px_22px_rgba(15,23,42,0.05),inset_0_1px_0_rgba(255,255,255,0.9)] flex flex-wrap items-center justify-between gap-2.5 text-[11px]">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Primary Brand Lockup: Vidhya Vidhai Foundation always in front of Career Tours */}
          <div className="inline-flex items-center gap-2">
            <div
              aria-hidden="true"
              className="w-7 h-7 rounded-lg bg-[#0F172A] text-[#FFFFFF] flex items-center justify-center shadow-[0_4px_12px_rgba(15,23,42,0.16)] shrink-0"
            >
              <GraduationCap className="w-3.5 h-3.5" />
            </div>
            <div className="flex flex-wrap items-center gap-x-1.5 text-xs tracking-tight">
              <span className="font-medium text-[#0F172A]">Vidhya Vidhai Foundation</span>
              <span className="text-[#526077]" aria-hidden="true">
                ·
              </span>
              <span className="font-medium text-[#0F766E]">Career Tours</span>
            </div>
          </div>

          {isSuperAdmin ? (
            <>
              <span className="hidden sm:block h-4 w-px bg-[#CBD5E1]" aria-hidden="true" />
              <button
                type="button"
                onClick={onOpenSyncStatus}
                disabled={!onOpenSyncStatus}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium border transition-colors ${
                  onOpenSyncStatus ? 'cursor-pointer hover:border-[#0F766E]' : ''
                } ${
                  outboxCount > 0
                    ? 'bg-[#FFFBEB] border-[#B45309]/40 text-[#B45309]'
                    : isLiveBackend
                      ? 'bg-[#ECFDF5] border-[#047857]/35 text-[#047857]'
                      : 'bg-[#F1F5F9] border-[#CBD5E1] text-[#475569]'
                }`}
              >
                {isLiveBackend ? (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5 text-[#047857]" aria-hidden="true" />
                    Google Sheets connected
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5 text-[#B45309]" aria-hidden="true" />
                    Local sandbox mode
                  </>
                )}
                {outboxCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.25 rounded-full bg-[#0F766E] text-[#FFFFFF] font-medium ct-num">
                    {outboxCount} queued
                  </span>
                )}
              </button>
            </>
          ) : outboxCount > 0 ? (
            <>
              <span className="hidden sm:block h-4 w-px bg-[#CBD5E1]" aria-hidden="true" />
              <button
                type="button"
                onClick={onRetryOutbox}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium border bg-[#FFFBEB] border-[#B45309]/40 text-[#B45309] cursor-pointer hover:bg-[#FEF3C7]"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                {outboxCount} offline pending · Retry save
              </button>
            </>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-full px-3 py-1 text-[#475569]">
            <span className="font-medium text-[#0F172A]">{user.name}</span>
            <span className="hidden sm:inline text-[#526077]" aria-hidden="true">
              ·
            </span>
            <span className="hidden sm:inline">{user.email}</span>
            <span className="ml-1 px-2 py-0.25 rounded-full bg-[#E6F6F4] text-[#0F766E] font-medium">
              {isSuperAdmin ? 'Super Admin' : 'Facilitator'}
            </span>
          </div>

          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-medium bg-[#FFFFFF] hover:bg-[#F1F5F9] border border-[#738AA1] hover:border-[#0F766E] text-[#0F172A] cursor-pointer transition-colors"
          >
            <LogOut className="w-3 h-3 text-[#475569]" aria-hidden="true" />
            Sign out
          </button>
        </div>
      </div>

      {/* Hero Title + Integrated Primary Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          {!(isSuperAdmin && activeTab === 'admin_dashboard') && (
            <div
              aria-hidden="true"
              className="w-11 h-11 rounded-2xl bg-[#FFFFFF] border border-[#E2E8F0] shadow-[0_6px_18px_rgba(15,23,42,0.06)] flex items-center justify-center text-[#0F766E] shrink-0 mt-0.5"
            >
              <GraduationCap className="w-5 h-5" />
            </div>
          )}
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-[#0F766E] mb-0.5">
              Vidhya Vidhai Foundation · Career Tours
            </p>
            <h1 className="text-[1.6rem] sm:text-[2rem] font-medium tracking-tight text-[#0F172A] leading-tight">
              {isSuperAdmin && activeTab === 'admin_dashboard'
                ? 'Administrator Console'
                : 'Classroom Data Entry'}
            </h1>
            {isSuperAdmin && activeTab === 'admin_dashboard' ? (
              <p className="mt-1 text-sm text-[#475569] max-w-xl leading-relaxed">
                Programme governance, verified metrics, district performance, exports, and access approvals.
              </p>
            ) : (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#475569]">
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#0F766E]" aria-hidden="true" />
                  Live CSAT, ITP &amp; Session ID
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#047857]" aria-hidden="true" />
                  Auto-saved drafts on this device
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Primary Navigation Pills — strictly scoped by role */}
          <nav
            aria-label="Primary application views"
            className="inline-flex flex-wrap items-center gap-1.5 p-1 rounded-2xl bg-[#FFFFFF]/92 border border-[#E2E8F0] shadow-xs"
          >
            <button
              type="button"
              onClick={() => onSelectTab('enter_class')}
              aria-current={activeTab === 'enter_class' ? 'page' : undefined}
              className={`min-h-[38px] px-4 py-1.5 rounded-xl text-sm font-medium transition-colors cursor-pointer inline-flex items-center gap-2 ${
                activeTab === 'enter_class'
                  ? 'bg-[#E6F6F4] text-[#0F172A] border border-[#0F766E]/60'
                  : 'text-[#475569] border border-transparent hover:bg-[#F1F5F9] hover:text-[#0F172A]'
              }`}
            >
              <ClipboardEdit
                className={`w-4 h-4 ${activeTab === 'enter_class' ? 'text-[#0F766E]' : 'text-[#475569]'}`}
                aria-hidden="true"
              />
              Enter a class
            </button>

            <button
              type="button"
              onClick={() => onSelectTab('my_classes')}
              aria-current={activeTab === 'my_classes' ? 'page' : undefined}
              className={`min-h-[38px] px-4 py-1.5 rounded-xl text-sm font-medium transition-colors cursor-pointer inline-flex items-center gap-2 ${
                activeTab === 'my_classes'
                  ? 'bg-[#E6F6F4] text-[#0F172A] border border-[#0F766E]/60'
                  : 'text-[#475569] border border-transparent hover:bg-[#F1F5F9] hover:text-[#0F172A]'
              }`}
            >
              <FolderKanban
                className={`w-4 h-4 ${activeTab === 'my_classes' ? 'text-[#0F766E]' : 'text-[#475569]'}`}
                aria-hidden="true"
              />
              My classes
            </button>

            {isSuperAdmin && (
              <button
                type="button"
                onClick={() => onSelectTab('admin_dashboard')}
                aria-current={activeTab === 'admin_dashboard' ? 'page' : undefined}
                className={`min-h-[38px] px-4 py-1.5 rounded-xl text-sm font-medium transition-colors cursor-pointer inline-flex items-center gap-2 ${
                  activeTab === 'admin_dashboard'
                    ? 'bg-[#E6F6F4] text-[#0F172A] border border-[#0F766E]/60'
                    : 'text-[#475569] border border-transparent hover:bg-[#F1F5F9] hover:text-[#0F172A]'
                }`}
              >
                <ShieldCheck
                  className={`w-4 h-4 ${activeTab === 'admin_dashboard' ? 'text-[#0F766E]' : 'text-[#475569]'}`}
                  aria-hidden="true"
                />
                Admin Console
              </button>
            )}
          </nav>

          {onOpenQuickAddModal && activeTab !== 'enter_class' && (
            <button
              type="button"
              onClick={onOpenQuickAddModal}
              className="ct-btn-primary text-xs sm:text-sm min-h-[40px] px-4 rounded-xl"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              New submission
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

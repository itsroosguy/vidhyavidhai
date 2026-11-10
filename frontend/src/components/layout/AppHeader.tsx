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
      <div className="mb-4 px-4 py-2.5 rounded-2xl bg-[#101E3C]/90 backdrop-blur-md border border-[#26456F] shadow-[inset_0_1px_0_rgba(232,239,252,0.06)] flex flex-wrap items-center justify-between gap-2.5 text-[11px]">
        <div className="flex items-center gap-2">
          {isSuperAdmin ? (
            <button
              type="button"
              onClick={onOpenSyncStatus}
              disabled={!onOpenSyncStatus}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium border transition-colors ${
                onOpenSyncStatus ? 'cursor-pointer hover:bg-[#172B4D]' : ''
              } ${
                outboxCount > 0
                  ? 'bg-[#392A11] border-[#F2B44D]/45 text-[#F2B44D]'
                  : isLiveBackend
                    ? 'bg-[#48B98A]/12 border-[#48B98A]/45 text-[#48B98A]'
                    : 'bg-[#162D55] border-[#26456F] text-[#A4B7D2]'
              }`}
            >
              {isLiveBackend ? (
                <>
                  <ShieldCheck className="w-3.5 h-3.5 text-[#48B98A]" aria-hidden="true" />
                  Google Sheets connected
                </>
              ) : (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 text-[#F2B44D]" aria-hidden="true" />
                  Local sandbox mode
                </>
              )}
              {outboxCount > 0 && (
                <span className="ml-1 px-1.5 py-0.25 rounded-full bg-[#4EBBBB] text-[#0C1326] font-medium ct-num">
                  {outboxCount} queued
                </span>
              )}
            </button>
          ) : outboxCount > 0 ? (
            <button
              type="button"
              onClick={onRetryOutbox}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium border bg-[#392A11] border-[#F2B44D]/45 text-[#F2B44D] cursor-pointer hover:bg-[#392A11]/85"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              {outboxCount} offline pending · Retry save
            </button>
          ) : (
            <span className="text-xs font-medium text-[#A4B7D2] px-1">
              Career Tours Classroom Entry
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1.5 bg-[#0C1931] border border-[#26456F] rounded-full px-3 py-1 text-[#A4B7D2]">
            <span className="font-medium text-[#E8EFFC]">{user.name}</span>
            <span className="hidden sm:inline text-[#8294B1]" aria-hidden="true">
              ·
            </span>
            <span className="hidden sm:inline">{user.email}</span>
            <span className="ml-1 px-2 py-0.25 rounded-full bg-[#4EBBBB]/14 text-[#4EBBBB] font-medium">
              {isSuperAdmin ? 'Super Admin' : 'Facilitator'}
            </span>
          </div>

          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-medium bg-[#162D55] hover:bg-[#172B4D] border border-[#26456F] text-[#E8EFFC] cursor-pointer transition-colors"
          >
            <LogOut className="w-3 h-3 text-[#A4B7D2]" aria-hidden="true" />
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
              className="w-11 h-11 rounded-2xl bg-[#162D55] border border-[#26456F] shadow-[inset_0_1px_0_rgba(232,239,252,0.1)] flex items-center justify-center text-[#4EBBBB] shrink-0 mt-0.5"
            >
              <GraduationCap className="w-5 h-5" />
            </div>
          )}
          <div>
            <h1 className="text-[1.6rem] sm:text-[2rem] font-medium tracking-tight text-[#E8EFFC] leading-tight">
              {isSuperAdmin && activeTab === 'admin_dashboard'
                ? 'Administrator Console'
                : 'Classroom Data Entry'}
            </h1>
            {isSuperAdmin && activeTab === 'admin_dashboard' ? (
              <p className="mt-1 text-sm text-[#A4B7D2] max-w-xl leading-relaxed">
                Programme governance, verified metrics, district performance, exports, and access approvals.
              </p>
            ) : (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#A4B7D2]">
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#4EBBBB]" aria-hidden="true" />
                  Live CSAT, ITP &amp; Session ID
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#48B98A]" aria-hidden="true" />
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
            className="inline-flex flex-wrap items-center gap-1.5 p-1 rounded-2xl bg-[#101E3C]/90 border border-[#26456F]"
          >
            <button
              type="button"
              onClick={() => onSelectTab('enter_class')}
              aria-current={activeTab === 'enter_class' ? 'page' : undefined}
              className={`min-h-[38px] px-4 py-1.5 rounded-xl text-sm font-medium transition-colors cursor-pointer inline-flex items-center gap-2 ${
                activeTab === 'enter_class'
                  ? 'bg-[#172B4D] text-[#E8EFFC] border border-[#4EBBBB]/70'
                  : 'text-[#A4B7D2] border border-transparent hover:bg-[#162D55] hover:text-[#E8EFFC]'
              }`}
            >
              <ClipboardEdit
                className={`w-4 h-4 ${activeTab === 'enter_class' ? 'text-[#4EBBBB]' : 'text-[#A4B7D2]'}`}
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
                  ? 'bg-[#172B4D] text-[#E8EFFC] border border-[#4EBBBB]/70'
                  : 'text-[#A4B7D2] border border-transparent hover:bg-[#162D55] hover:text-[#E8EFFC]'
              }`}
            >
              <FolderKanban
                className={`w-4 h-4 ${activeTab === 'my_classes' ? 'text-[#4EBBBB]' : 'text-[#A4B7D2]'}`}
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
                    ? 'bg-[#172B4D] text-[#E8EFFC] border border-[#4EBBBB]/70'
                    : 'text-[#A4B7D2] border border-transparent hover:bg-[#162D55] hover:text-[#E8EFFC]'
                }`}
              >
                <ShieldCheck
                  className={`w-4 h-4 ${activeTab === 'admin_dashboard' ? 'text-[#4EBBBB]' : 'text-[#A4B7D2]'}`}
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

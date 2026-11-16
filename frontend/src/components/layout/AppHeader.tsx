import React from 'react';
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  ClipboardEdit,
  CloudOff,
  FolderKanban,
  GraduationCap,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import vidhyaVidhaiMark from '../../assets/vidhya-vidhai-mark.png';
import type { UserProfile } from '../../types/domain';

export type ActiveTab = 'enter_class' | 'my_classes' | 'admin_dashboard';

interface AppHeaderProps {
  user: UserProfile;
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onSignOut: () => void;
  isLiveBackend: boolean;
  isSupabaseMode?: boolean;
  sheetsConnected?: boolean;
  isTeamIntakeActive?: boolean;
  needsDirectReauth?: boolean;
  quickSyncOpen?: boolean;
  onToggleQuickSyncBar?: () => void;
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
  isSupabaseMode = false,
  sheetsConnected = false,
  isTeamIntakeActive = false,
  needsDirectReauth = false,
  quickSyncOpen = false,
  onToggleQuickSyncBar,
  outboxCount = 0,
  onOpenSyncStatus,
  onRetryOutbox,
  onOpenQuickAddModal,
}) => {
  const isSuperAdmin = user.role === 'super_admin';
  const isCentralDbForFacilitator = isSupabaseMode || isLiveBackend || isTeamIntakeActive;
  const containerClass = 'max-w-[1220px]';

  return (
    <header className={`w-full ${containerClass} mx-auto pt-4 pb-5 px-4 sm:px-6 transition-all`}>
      {/* Unified Top Studio Bar */}
      <div className="mb-4 px-4 py-2.5 rounded-2xl bg-[#FFFFFF]/95 backdrop-blur-md border border-[#DFD7C2] shadow-[0_6px_22px_rgba(10,27,44,0.06),inset_0_1px_0_rgba(255,255,255,0.92)] flex flex-wrap items-center justify-between gap-2.5 text-[11px]">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Primary Brand Lockup: Vidhya Vidhai Foundation always in front of Career Tours */}
          <div className="inline-flex items-center gap-2">
            <img
              src={vidhyaVidhaiMark}
              alt=""
              aria-hidden="true"
              width={230}
              height={230}
              className="w-7 h-7 object-contain shrink-0 select-none"
            />
            <div className="flex flex-wrap items-center gap-x-1.5 text-xs tracking-tight">
              <span className="font-medium text-[#0A1B2C]">Vidhya Vidhai Foundation</span>
              <span className="text-[#33475B]" aria-hidden="true">
                ·
              </span>
              <span className="font-medium text-[#006BB8]">Career Tours</span>
            </div>
          </div>

          {isSuperAdmin ? (
            <>
              <span className="hidden sm:block h-4 w-px bg-[#C7BEA7]" aria-hidden="true" />
              <button
                type="button"
                onClick={onOpenSyncStatus}
                disabled={!onOpenSyncStatus}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium border transition-colors ${
                  onOpenSyncStatus ? 'cursor-pointer hover:border-[#0284C7]' : ''
                } ${
                  outboxCount > 0 || (!isSupabaseMode && needsDirectReauth)
                    ? 'bg-[#FFFBEB] border-[#B45309]/40 text-[#92400E]'
                    : isSupabaseMode || isLiveBackend
                      ? 'bg-[#ECFDF5] border-[#047857]/35 text-[#047857]'
                      : 'bg-[#FFFBEB] border-[#B45309]/40 text-[#92400E]'
                }`}
              >
                {isSupabaseMode ? (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5 text-[#047857]" aria-hidden="true" />
                    {sheetsConnected
                      ? 'Database + Sheets Live'
                      : 'Database Online · Setup Sheets Webhook'}
                  </>
                ) : needsDirectReauth ? (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5 text-[#B45309]" aria-hidden="true" />
                    Re-authorize Google Sheets
                  </>
                ) : isLiveBackend ? (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5 text-[#047857]" aria-hidden="true" />
                    Google Sheets Live
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5 text-[#B45309]" aria-hidden="true" />
                    Local Storage · Setup Google Sheets
                  </>
                )}
                {outboxCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.25 rounded-full bg-[#1EA7FF] text-[#0A1B2C] font-medium ct-num">
                    {outboxCount} queued
                  </span>
                )}
              </button>
              {onToggleQuickSyncBar && (
                <button
                  type="button"
                  aria-expanded={quickSyncOpen}
                  onClick={onToggleQuickSyncBar}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-medium border transition-colors cursor-pointer ${
                    quickSyncOpen
                      ? 'bg-[#E8F6FF] border-[#0284C7]/60 text-[#0A1B2C]'
                      : 'bg-[#FAF8F2] border-[#C7BEA7] text-[#243647] hover:border-[#0284C7] hover:text-[#0A1B2C]'
                  }`}
                >
                  Quick Sheet Sync
                </button>
              )}
            </>
          ) : (
            <>
              <span className="hidden sm:block h-4 w-px bg-[#C7BEA7]" aria-hidden="true" />
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium border ${
                  isCentralDbForFacilitator
                    ? 'bg-[#ECFDF5] border-[#047857]/35 text-[#047857]'
                    : 'bg-[#FFFBEB] border-[#B45309]/40 text-[#92400E]'
                }`}
              >
                {isCentralDbForFacilitator ? (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5 text-[#047857]" aria-hidden="true" />
                    {isSupabaseMode ? 'Vidhya Vidhai Cloud' : 'Central Database'}
                  </>
                ) : (
                  <>
                    <CloudOff className="w-3.5 h-3.5 text-[#B45309]" aria-hidden="true" />
                    Device-Only Mode
                  </>
                )}
              </span>
              {outboxCount > 0 && (
                <button
                  type="button"
                  onClick={onRetryOutbox}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium border bg-[#FFFBEB] border-[#B45309]/40 text-[#B45309] cursor-pointer hover:bg-[#FEF3C7]"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  {outboxCount} offline pending · Retry save
                </button>
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1.5 bg-[#F5F2E9] border border-[#DFD7C2] rounded-full px-3 py-1 text-[#243647]">
            <span className="font-medium text-[#0A1B2C]">{user.name}</span>
            <span className="hidden sm:inline text-[#33475B]" aria-hidden="true">
              ·
            </span>
            <span className="hidden sm:inline">{user.email}</span>
            <span className="ml-1 px-2 py-0.25 rounded-full bg-[#E8F6FF] border border-[#0284C7]/35 text-[#006BB8] font-medium">
              {isSuperAdmin ? 'Super Admin' : 'Facilitator'}
            </span>
          </div>

          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-medium bg-[#FFFFFF] hover:bg-[#F5F2E9] border border-[#5F7082] hover:border-[#0284C7] text-[#0A1B2C] cursor-pointer transition-colors"
          >
            <LogOut className="w-3 h-3 text-[#243647]" aria-hidden="true" />
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
              className="w-11 h-11 rounded-2xl bg-[#FFFFFF] border border-[#DFD7C2] shadow-[0_6px_18px_rgba(10,27,44,0.06)] flex items-center justify-center text-[#006BB8] shrink-0 mt-0.5"
            >
              <GraduationCap className="w-5 h-5" />
            </div>
          )}
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-[#006BB8] mb-0.5">
              Vidhya Vidhai Foundation · Career Tours
            </p>
            <h1 className="text-[1.6rem] sm:text-[2rem] font-medium tracking-tight text-[#0A1B2C] leading-tight">
              {isSuperAdmin && activeTab === 'admin_dashboard'
                ? 'Administrator Console'
                : 'Classroom Data Entry'}
            </h1>
            {isSuperAdmin && activeTab === 'admin_dashboard' ? (
              <p className="mt-1 text-sm text-[#243647] max-w-xl leading-relaxed">
                Programme governance, verified metrics, district performance, exports, and access approvals.
              </p>
            ) : (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#243647]">
                <span className="inline-flex items-center gap-1.5">
                  <Calculator className="w-3.5 h-3.5 text-[#006BB8]" aria-hidden="true" />
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
            className="inline-flex flex-wrap items-center gap-1.5 p-1 rounded-2xl bg-[#FFFFFF]/95 border border-[#DFD7C2] shadow-xs"
          >
            <button
              type="button"
              onClick={() => onSelectTab('enter_class')}
              aria-current={activeTab === 'enter_class' ? 'page' : undefined}
              className={`min-h-[38px] px-4 py-1.5 rounded-xl text-sm font-medium transition-colors cursor-pointer inline-flex items-center gap-2 ${
                activeTab === 'enter_class'
                  ? 'bg-[#E8F6FF] text-[#0A1B2C] border border-[#0284C7]/60'
                  : 'text-[#243647] border border-transparent hover:bg-[#F5F2E9] hover:text-[#0A1B2C]'
              }`}
            >
              <ClipboardEdit
                className={`w-4 h-4 ${activeTab === 'enter_class' ? 'text-[#006BB8]' : 'text-[#243647]'}`}
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
                  ? 'bg-[#E8F6FF] text-[#0A1B2C] border border-[#0284C7]/60'
                  : 'text-[#243647] border border-transparent hover:bg-[#F5F2E9] hover:text-[#0A1B2C]'
              }`}
            >
              <FolderKanban
                className={`w-4 h-4 ${activeTab === 'my_classes' ? 'text-[#006BB8]' : 'text-[#243647]'}`}
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
                    ? 'bg-[#E8F6FF] text-[#0A1B2C] border border-[#0284C7]/60'
                    : 'text-[#243647] border border-transparent hover:bg-[#F5F2E9] hover:text-[#0A1B2C]'
                }`}
              >
                <ShieldCheck
                  className={`w-4 h-4 ${activeTab === 'admin_dashboard' ? 'text-[#006BB8]' : 'text-[#243647]'}`}
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

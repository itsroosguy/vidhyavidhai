import React, { useEffect, useRef } from 'react';
import { Menu, X } from 'lucide-react';
import { ADMIN_NAV_ITEMS, type AdminSectionSlug } from '../utils/routes';

interface AdminNavProps {
  activeSection: AdminSectionSlug;
  onSelectSection: (section: AdminSectionSlug) => void;
  pendingUsersCount?: number;
  outboxCount?: number;
}

export const AdminNav: React.FC<AdminNavProps> = ({
  activeSection,
  onSelectSection,
  pendingUsersCount = 0,
  outboxCount = 0,
}) => {
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = navRef.current;
    if (!el || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mq = window.matchMedia('(max-width: 1023px)');

    const syncPopoverMode = () => {
      if (mq.matches) {
        el.setAttribute('popover', 'auto');
      } else {
        if (typeof (el as HTMLElement & { hidePopover?: () => void }).hidePopover === 'function') {
          try {
            (el as HTMLElement & { hidePopover: () => void }).hidePopover();
          } catch {
            // Popover may already be closed
          }
        }
        el.removeAttribute('popover');
      }
    };

    syncPopoverMode();
    mq.addEventListener('change', syncPopoverMode);
    return () => {
      mq.removeEventListener('change', syncPopoverMode);
    };
  }, []);

  const currentItem =
    ADMIN_NAV_ITEMS.find((item) => item.slug === activeSection) ?? ADMIN_NAV_ITEMS[0]!;

  const handleSelect = (slug: AdminSectionSlug) => {
    onSelectSection(slug);
    const el = navRef.current;
    if (
      el &&
      el.hasAttribute('popover') &&
      typeof (el as HTMLElement & { hidePopover?: () => void }).hidePopover === 'function'
    ) {
      try {
        (el as HTMLElement & { hidePopover: () => void }).hidePopover();
      } catch {
        // Ignore if not currently open
      }
    }
  };

  return (
    <aside className="min-w-0">
      {/* Narrow-viewport drawer trigger */}
      <div className="lg:hidden mb-3 flex items-center justify-between gap-3 ct-card px-3.5 py-2.5">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-[#33475B]">Admin Section</div>
          <div className="text-sm font-medium text-[#0A1B2C] truncate">{currentItem.label}</div>
        </div>
        <button
          type="button"
          popoverTarget="admin-nav-drawer"
          popoverTargetAction="toggle"
          aria-controls="admin-nav-drawer"
          className="ct-btn-secondary text-xs min-h-[44px] px-3.5 shrink-0"
        >
          <Menu className="w-4 h-4 text-[#006BB8]" aria-hidden="true" />
          Menu
        </button>
      </div>

      {/* Single semantic <nav> rendered once for both desktop rail and mobile popover */}
      <nav
        ref={navRef}
        id="admin-nav-drawer"
        aria-label="Administrator"
        className="ct-admin-nav ct-card p-3 lg:sticky lg:top-4"
      >
        <div className="flex items-center justify-between gap-2 px-2 pb-2.5 mb-2 border-b border-[#DFD7C2]">
          <span className="text-[11px] font-medium uppercase tracking-wider text-[#33475B]">
            Admin Navigation
          </span>
          <button
            type="button"
            popoverTarget="admin-nav-drawer"
            popoverTargetAction="hide"
            aria-label="Close administrator menu"
            className="lg:hidden p-1.5 rounded-lg text-[#243647] hover:text-[#0A1B2C] hover:bg-[#F5F2E9] cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <ul className="space-y-1 list-none m-0 p-0">
          {ADMIN_NAV_ITEMS.map((item) => {
            const isCurrent = activeSection === item.slug;
            const badgeCount =
              item.slug === 'user-management'
                ? pendingUsersCount
                : item.slug === 'google-sheets-sync'
                  ? outboxCount
                  : 0;

            return (
              <li key={item.slug}>
                <button
                  type="button"
                  onClick={() => handleSelect(item.slug)}
                  aria-current={isCurrent ? 'page' : undefined}
                  className={`ct-admin-nav-item w-full text-left px-3 py-2 rounded-lg border flex items-center justify-between gap-2 text-xs sm:text-[13px] cursor-pointer transition-colors ${
                    isCurrent
                      ? 'bg-[#E8F6FF] border-[#0284C7]/50 text-[#0A1B2C] font-medium'
                      : 'border-transparent text-[#243647] hover:text-[#0A1B2C] hover:bg-[#F5F2E9]'
                  }`}
                >
                  <span className="truncate">{item.label}</span>
                  {badgeCount > 0 ? (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[#1EA7FF] text-[#0A1B2C] ct-num shrink-0">
                      {badgeCount}
                    </span>
                  ) : isCurrent ? (
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-[#006BB8] shrink-0"
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
};

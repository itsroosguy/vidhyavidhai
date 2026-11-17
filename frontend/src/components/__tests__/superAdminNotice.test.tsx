import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { DEFAULT_REPORT_SHEET_URL } from '../notifications/LiveReportFloatingBadge';
import {
  clearCachedSheetsConnection,
  setRuntimeSheetsBackendUrl,
} from '../../services/authService';

describe('LiveReportFloatingBadge', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setRuntimeSheetsBackendUrl('');
    clearCachedSheetsConnection('local_sandbox');
    clearCachedSheetsConnection('apps_script');
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders cute floating notification on the bottom right for Super Admins linking to the 63-column Google Sheet, allows minimize/dismiss, and stays hidden for Facilitators', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText(/^Email/i), 'brinthajayaprakash888@gmail.com');
    await user.type(screen.getByLabelText(/^Password/i), 'brintha888');
    await user.click(screen.getByRole('button', { name: /^Sign In$/i }));

    // Verify blocking popup dialog is completely removed
    expect(
      screen.queryByRole('dialog', { name: /Download Excel Reports in Analytics/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Google Sheet Auto Data Feed — Live Soon/i),
    ).not.toBeInTheDocument();

    // Verify cute floating notification is present on the bottom right
    const badge = await screen.findByRole('complementary', {
      name: /Live Google Sheet Report Notification/i,
    });
    expect(badge).toBeInTheDocument();
    expect(within(badge).getByText(/5-Min Live Sync Active/i)).toBeInTheDocument();
    expect(within(badge).getByText(/Project Activity Report & Checklist/i)).toBeInTheDocument();

    const reportLink = within(badge).getByRole('link', { name: /Click for report link/i });
    expect(reportLink).toHaveAttribute('href', DEFAULT_REPORT_SHEET_URL);
    expect(reportLink).toHaveAttribute('target', '_blank');

    // Test minimize button -> collapses into cute pill
    const minimizeBtn = within(badge).getByRole('button', { name: /Minimize notification/i });
    await user.click(minimizeBtn);

    const pillShortcut = await screen.findByRole('complementary', {
      name: /Live Report Link Shortcut/i,
    });
    expect(pillShortcut).toBeInTheDocument();
    expect(within(pillShortcut).getByRole('link', { name: /Click for report link/i })).toHaveAttribute(
      'href',
      DEFAULT_REPORT_SHEET_URL,
    );

    // Sign out and sign in as regular Facilitator -> notification badge must never appear
    await user.click(screen.getByRole('button', { name: /Sign out/i }));
    await screen.findByLabelText(/^Email/i);
    await user.type(screen.getByLabelText(/^Email/i), 'priya.facilitator@example.org');
    await user.click(screen.getByRole('button', { name: /^Sign In$/i }));

    await screen.findByLabelText(/^School name/i);
    expect(
      screen.queryByRole('complementary', { name: /Live Google Sheet Report Notification/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('complementary', { name: /Live Report Link Shortcut/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Click for report link/i)).not.toBeInTheDocument();
  });
});

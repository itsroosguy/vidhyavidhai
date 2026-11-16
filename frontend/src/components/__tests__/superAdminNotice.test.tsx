import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import {
  clearCachedSheetsConnection,
  setRuntimeSheetsBackendUrl,
} from '../../services/authService';

describe('SuperAdminAnalyticsNoticeModal', () => {
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

  it('pops up on Super Admin sign-in with Analytics Excel and Google Sheet feed notice, navigates to Analytics, and stays hidden for Facilitators', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText(/^Email/i), 'brinthajayaprakash888@gmail.com');
    await user.type(screen.getByLabelText(/^Password/i), 'brintha888');
    await user.click(screen.getByRole('button', { name: /^Sign In$/i }));

    const noticeDialog = await screen.findByRole('dialog', {
      name: /Download Excel Reports in Analytics/i,
    });
    expect(within(noticeDialog).getByText(/Export Filtered \(\.xlsx\)/i)).toBeInTheDocument();
    expect(
      within(noticeDialog).getByText(/Google Sheet Auto Data Feed — Live Soon/i),
    ).toBeInTheDocument();

    await user.click(within(noticeDialog).getByRole('button', { name: /Open Analytics/i }));

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: /Download Excel Reports in Analytics/i }),
      ).not.toBeInTheDocument();
      expect(window.location.pathname).toBe('/admin/analytics');
    });

    // Sign out and sign in as regular Facilitator -> popup must never appear
    await user.click(screen.getByRole('button', { name: /Sign out/i }));
    await screen.findByLabelText(/^Email/i);
    await user.type(screen.getByLabelText(/^Email/i), 'priya.facilitator@example.org');
    await user.click(screen.getByRole('button', { name: /^Sign In$/i }));

    await screen.findByLabelText(/^School name/i);
    expect(
      screen.queryByRole('dialog', { name: /Download Excel Reports in Analytics/i }),
    ).not.toBeInTheDocument();
  });
});

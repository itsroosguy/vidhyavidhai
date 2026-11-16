import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { AdminDashboardPage } from '../../admin/AdminDashboardPage';
import { GoogleSheetsBanner } from '../../admin/GoogleSheetsBanner';
import { MyClassesPage } from '../../dashboard/MyClassesPage';
import { LocalSandboxApiClient } from '../../services/apiClient';
import {
  SANDBOX_USERS,
  clearCachedSheetsConnection,
  setRuntimeSheetsBackendUrl,
} from '../../services/authService';
import { loadFormDraft } from '../../services/draftStorage';
import { enqueueSyncOutboxItem, loadSyncOutbox } from '../../services/syncService';
import { createTestConfig, createValidFormValues } from '../../testFixtures';
import { ADMIN_NAV_ITEMS } from '../../utils/routes';
import { SessionEntryForm } from '../SessionEntryForm';

describe('UI Component Workflows — Strict RBAC, Route Guard, 7-Section Form & 12-Section Admin Console', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setRuntimeSheetsBackendUrl('');
    clearCachedSheetsConnection('local_sandbox');
    clearCachedSheetsConnection('apps_script');
    window.history.replaceState(null, '', '/');
  });

  it('renders all 7 numbered sections without a Block dropdown and opens ValidationErrorModal on invalid save', async () => {
    const user = userEvent.setup();
    const cfg = createTestConfig();
    const api = new LocalSandboxApiClient(() => SANDBOX_USERS.facilitator.userId, cfg);

    render(
      <SessionEntryForm
        api={api}
        user={SANDBOX_USERS.facilitator}
        config={cfg}
        editingSession={null}
        onCancelEdit={vi.fn()}
        onSavedNavigateToMyClasses={vi.fn()}
        onNotify={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'About you' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'About the session' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'About the school' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'About the class' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Students.*answers/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Teacher.*answer/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your results' })).toBeInTheDocument();
    // Facilitators must NEVER see Google Sheets sync terminology in Section 7
    expect(screen.queryByText(/Google Sheets/i)).not.toBeInTheDocument();

    const districtSelect = screen.getByLabelText(/^District/i);
    await user.selectOptions(districtSelect, 'Cuddalore');
    expect(screen.queryByLabelText(/^Block/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText('Block list not configured. Please contact the administrator.'),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Save this class/i }));
    const errDialog = await screen.findByRole('dialog', { name: /Please resolve/i });
    expect(within(errDialog).getByText(/Section 2/i)).toBeInTheDocument();
    const jumpBtns = within(errDialog).getAllByRole('button', { name: /Jump/i });
    expect(jumpBtns.length).toBeGreaterThan(0);
    await user.click(jumpBtns[0]!);
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Please resolve/i })).not.toBeInTheDocument();
    });
  });

  it('allows combined class rows, clock picker + keyboard time, review verification modal, and saving a facilitator session without leaking Sheets info', async () => {
    const user = userEvent.setup();
    const cfg = createTestConfig();
    const api = new LocalSandboxApiClient(() => SANDBOX_USERS.facilitator.userId, cfg);

    render(
      <SessionEntryForm
        api={api}
        user={SANDBOX_USERS.facilitator}
        config={cfg}
        editingSession={null}
        onCancelEdit={vi.fn()}
        onSavedNavigateToMyClasses={vi.fn()}
        onNotify={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /What time did it start\?/i }));
    const clockRegion = screen.getByRole('region', {
      name: /What time did it start\? clock selector/i,
    });
    await user.click(within(clockRegion).getByRole('button', { name: "10 o'clock" }));
    await user.click(within(clockRegion).getByRole('button', { name: '00 minutes' }));
    await user.click(within(clockRegion).getByRole('button', { name: 'Done' }));

    await user.click(screen.getByRole('button', { name: /What time did it end\?/i }));
    const endKeyboard = screen.getByLabelText(/What time did it end\? direct time input/i);
    await user.type(endKeyboard, '11:30');
    await user.click(
      within(
        screen.getByRole('region', { name: /What time did it end\? clock selector/i }),
      ).getByRole('button', { name: 'Done' }),
    );

    await user.type(screen.getByLabelText(/^School name/i), 'GHSS Panruti');
    await user.type(screen.getByLabelText(/School code \(UDISE\)/i), '33180100101');
    await user.selectOptions(
      screen.getByLabelText(/What kind of school is it\?/i),
      'Government school',
    );
    await user.selectOptions(screen.getByLabelText(/^District/i), 'Cuddalore');
    await user.type(screen.getByLabelText(/^PIN code/i), '607106');

    await user.selectOptions(screen.getByLabelText(/Which class \(grade\) is it\?/i), '8');
    await user.selectOptions(screen.getByLabelText(/^Section/i), 'A');
    await user.type(screen.getByLabelText(/How many students were present\?/i), '40');

    await user.selectOptions(
      screen.getByLabelText(
        /Did you take this session for more than one section or grade together\?/i,
      ),
      'combined',
    );
    expect(screen.getByText('Class 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('Class 2 of 2')).toBeInTheDocument();

    const gradeSelects = screen.getAllByLabelText(/Which class \(grade\) is it\?/i);
    const sectionSelects = screen.getAllByLabelText(/^Section/i);
    const presentInputs = screen.getAllByLabelText(/How many students were present\?/i);
    await user.selectOptions(gradeSelects[1]!, '8');
    await user.selectOptions(sectionSelects[1]!, 'B');
    await user.type(presentInputs[1]!, '10');

    await user.type(screen.getByLabelText(/Grade 8 · A Question A score 5/i), '20');
    await user.type(screen.getByLabelText(/Grade 8 · B Question A score 1/i), '10');
    await user.type(screen.getByLabelText(/Grade 8 · A Question B score 5/i), '20');
    await user.type(screen.getByLabelText(/Grade 8 · B Question B score 1/i), '10');

    await user.selectOptions(screen.getByLabelText(/Teacher's score/i), 'promoter');
    await user.click(screen.getByRole('button', { name: /Record exact 0–10 score/i }));
    await user.click(screen.getByRole('button', { name: /^10$/ }));

    const sec7 = document.getElementById('section-7')!;
    expect(within(sec7).getAllByText('3.67').length).toBeGreaterThanOrEqual(2);
    expect(within(sec7).getAllByText('+100').length).toBeGreaterThanOrEqual(1);
    expect(within(sec7).getByText('Expected Responses')).toBeInTheDocument();
    expect(within(sec7).getByText('Actual Responses')).toBeInTheDocument();
    expect(within(sec7).getByText('Unanswered')).toBeInTheDocument();
    expect(within(sec7).getByText(/1 hr 30 mins/i)).toBeInTheDocument();
    expect(within(sec7).getByText(/AFE-IN-AM-OV-TA-2026/)).toBeInTheDocument();

    await user.click(within(sec7).getByRole('button', { name: /Show the working/i }));
    expect(within(sec7).getByText(/CSAT = .*110 ÷ 30 = 3\.67/)).toBeInTheDocument();
    expect(within(sec7).getByText(/ITP = .*110 ÷ 30 = 3\.67/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Save this class/i }));
    const reviewDialog = await screen.findByRole('dialog', {
      name: /Review before submitting session/i,
    });
    expect(within(reviewDialog).getAllByText(/3\.67/).length).toBeGreaterThanOrEqual(2);
    await user.click(within(reviewDialog).getByRole('button', { name: /Confirm & submit/i }));

    const successDialog = await screen.findByRole('dialog', {
      name: /Session saved successfully!/i,
    });
    expect(within(successDialog).getByText(/^Saved on this device$/i)).toBeInTheDocument();
    expect(within(successDialog).queryByText(/Google Sheets/i)).not.toBeInTheDocument();
    expect(api.getRawSessionsForTest()).toHaveLength(1);
    expect(api.getRawSessionsForTest()[0]!.sessionId).toMatch(/_33180100101_CMB_02C_001$/);
  });

  it('triggers DuplicateWarningModal when matching UDISE + date + tour already exists', async () => {
    const user = userEvent.setup();
    const cfg = createTestConfig();
    const api = new LocalSandboxApiClient(() => SANDBOX_USERS.facilitator.userId, cfg);

    await api.createSession(
      createValidFormValues({
        udiseCode: '33180100101',
        schoolName: 'GHSS Panruti Duplicate Test',
        tourId: 'TOUR_AM',
      }),
    );

    render(
      <SessionEntryForm
        api={api}
        user={SANDBOX_USERS.facilitator}
        config={cfg}
        editingSession={null}
        onCancelEdit={vi.fn()}
        onSavedNavigateToMyClasses={vi.fn()}
        onNotify={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /What time did it start\?/i }));
    await user.type(
      screen.getByLabelText(/What time did it start\? direct time input/i),
      '09:00',
    );
    await user.click(
      within(
        screen.getByRole('region', { name: /What time did it start\? clock selector/i }),
      ).getByRole('button', { name: 'Done' }),
    );
    await user.click(screen.getByRole('button', { name: /What time did it end\?/i }));
    await user.type(screen.getByLabelText(/What time did it end\? direct time input/i), '10:00');
    await user.click(
      within(
        screen.getByRole('region', { name: /What time did it end\? clock selector/i }),
      ).getByRole('button', { name: 'Done' }),
    );

    await user.type(screen.getByLabelText(/^School name/i), 'GHSS Panruti Duplicate Test');
    await user.type(screen.getByLabelText(/School code \(UDISE\)/i), '33180100101');
    await user.selectOptions(
      screen.getByLabelText(/What kind of school is it\?/i),
      'Government school',
    );
    await user.selectOptions(screen.getByLabelText(/^District/i), 'Cuddalore');
    await user.type(screen.getByLabelText(/^PIN code/i), '607106');

    await user.selectOptions(screen.getByLabelText(/Which class \(grade\) is it\?/i), '8');
    await user.selectOptions(screen.getByLabelText(/^Section/i), 'A');
    await user.type(screen.getByLabelText(/How many students were present\?/i), '20');
    await user.type(screen.getByLabelText(/Grade 8 · A Question A score 5/i), '20');
    await user.type(screen.getByLabelText(/Grade 8 · A Question B score 5/i), '20');
    await user.selectOptions(screen.getByLabelText(/Teacher's score/i), 'promoter');

    await user.click(screen.getByRole('button', { name: /Save this class/i }));

    const dupDialog = await screen.findByRole('dialog', {
      name: /Similar classroom submission already exists/i,
    });
    expect(within(dupDialog).getByText(/GHSS Panruti Duplicate Test/i)).toBeInTheDocument();
    await user.click(within(dupDialog).getByRole('button', { name: /Proceed to review anyway/i }));

    const reviewDialog = await screen.findByRole('dialog', {
      name: /Review before submitting session/i,
    });
    expect(reviewDialog).toBeInTheDocument();
  });

  it('auto-saves local drafts without auth tokens and confirms before clearing entered data', async () => {
    const user = userEvent.setup();
    const cfg = createTestConfig();
    const api = new LocalSandboxApiClient(() => SANDBOX_USERS.facilitator.userId, cfg);

    render(
      <SessionEntryForm
        api={api}
        user={SANDBOX_USERS.facilitator}
        config={cfg}
        editingSession={null}
        onCancelEdit={vi.fn()}
        onSavedNavigateToMyClasses={vi.fn()}
        onNotify={vi.fn()}
      />,
    );

    const schoolInput = screen.getByLabelText(/^School name/i);
    await user.type(schoolInput, 'Draft School GHSS');

    await waitFor(
      () => {
        const draft = loadFormDraft(SANDBOX_USERS.facilitator.email);
        expect(draft?.values.schoolName).toBe('Draft School GHSS');
      },
      { timeout: 1500 },
    );

    const rawDraftJson = JSON.stringify(loadFormDraft(SANDBOX_USERS.facilitator.email));
    expect(rawDraftJson).not.toContain('idToken');

    await user.click(screen.getByRole('button', { name: /Clear the class details/i }));
    const dialog = screen.getByRole('dialog', { name: /Clear the class details\?/i });
    await user.click(within(dialog).getByRole('button', { name: /Yes, clear form/i }));

    await waitFor(() => {
      expect((screen.getByLabelText(/^School name/i) as HTMLInputElement).value).toBe('');
    });
    expect(loadFormDraft(SANDBOX_USERS.facilitator.email)).toBeNull();
  });

  it('queues NETWORK_ERROR submissions in Sync Outbox silently without admin telemetry', async () => {
    const user = userEvent.setup();
    const cfg = createTestConfig();
    const api = new LocalSandboxApiClient(() => SANDBOX_USERS.facilitator.userId, cfg);
    let failNext = true;
    const origCreate = api.createSession.bind(api);
    vi.spyOn(api, 'createSession').mockImplementation(async (values) => {
      if (failNext) {
        failNext = false;
        return { ok: false, code: 'NETWORK_ERROR', error: 'Simulated offline outage' };
      }
      return origCreate(values);
    });

    const onOutboxEnqueued = vi.fn();
    render(
      <SessionEntryForm
        api={api}
        user={SANDBOX_USERS.facilitator}
        config={cfg}
        editingSession={null}
        onCancelEdit={vi.fn()}
        onSavedNavigateToMyClasses={vi.fn()}
        onOutboxEnqueued={onOutboxEnqueued}
        onNotify={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /What time did it start\?/i }));
    await user.type(
      screen.getByLabelText(/What time did it start\? direct time input/i),
      '09:00',
    );
    await user.click(
      within(
        screen.getByRole('region', { name: /What time did it start\? clock selector/i }),
      ).getByRole('button', { name: 'Done' }),
    );
    await user.click(screen.getByRole('button', { name: /What time did it end\?/i }));
    await user.type(screen.getByLabelText(/What time did it end\? direct time input/i), '10:00');
    await user.click(
      within(
        screen.getByRole('region', { name: /What time did it end\? clock selector/i }),
      ).getByRole('button', { name: 'Done' }),
    );
    await user.type(screen.getByLabelText(/^School name/i), 'GHSS Outbox Retry School');
    await user.type(screen.getByLabelText(/School code \(UDISE\)/i), '33180100777');
    await user.selectOptions(
      screen.getByLabelText(/What kind of school is it\?/i),
      'Government school',
    );
    await user.selectOptions(screen.getByLabelText(/^District/i), 'Cuddalore');
    await user.type(screen.getByLabelText(/^PIN code/i), '607106');
    await user.selectOptions(screen.getByLabelText(/Which class \(grade\) is it\?/i), '8');
    await user.selectOptions(screen.getByLabelText(/^Section/i), 'A');
    await user.type(screen.getByLabelText(/How many students were present\?/i), '25');
    await user.type(screen.getByLabelText(/Grade 8 · A Question A score 5/i), '25');
    await user.type(screen.getByLabelText(/Grade 8 · A Question B score 5/i), '25');
    await user.selectOptions(screen.getByLabelText(/Teacher's score/i), 'promoter');

    await user.click(screen.getByRole('button', { name: /Save this class/i }));
    const reviewDialog = await screen.findByRole('dialog', {
      name: /Review before submitting session/i,
    });
    await user.click(within(reviewDialog).getByRole('button', { name: /Confirm & submit/i }));

    await waitFor(() => {
      expect(onOutboxEnqueued).toHaveBeenCalledTimes(1);
    });
    const outbox = loadSyncOutbox(SANDBOX_USERS.facilitator.email);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.schoolName).toBe('GHSS Outbox Retry School');
    expect(outbox[0]!.syncStatus).toBe('PENDING_RETRY');
  });

  it('strips exports and total counts from Facilitator MyClassesPage and navigates all 12 sections in AdminDashboardPage', async () => {
    const user = userEvent.setup();
    let actorId = SANDBOX_USERS.facilitator.userId;
    const cfg = createTestConfig();
    const api = new LocalSandboxApiClient(() => actorId, cfg);
    await api.createSession(
      createValidFormValues({
        schoolName: 'GHSS Nagapattinam Model',
        district: 'Nagapattinam',
      }),
    );

    const { unmount } = render(
      <MyClassesPage
        api={api}
        user={SANDBOX_USERS.facilitator}
        config={cfg}
        onEditSession={vi.fn()}
        onNotify={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('GHSS Nagapattinam Model')).toBeInTheDocument();
    });
    // Facilitators NEVER see export buttons, total submission count summaries, or Google Sheets banners
    expect(screen.queryByRole('button', { name: /Export My Sessions/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/\(1 session\)/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /Connect Your Google Sheet|Google Sheets Connected/i }),
    ).not.toBeInTheDocument();
    unmount();

    // Super Admin Dashboard across all 12 sections
    actorId = SANDBOX_USERS.super_admin_1.userId;
    render(
      <AdminDashboardPage
        api={api}
        user={SANDBOX_USERS.super_admin_1}
        config={cfg}
        onEditSession={vi.fn()}
        onNavigateSettings={vi.fn()}
        onNotify={vi.fn()}
      />,
    );

    const adminNav = await screen.findByRole('navigation', { name: 'Administrator' });
    for (const item of ADMIN_NAV_ITEMS) {
      expect(within(adminNav).getByRole('button', { name: item.label })).toBeInTheDocument();
    }

    await waitFor(() => {
      expect(screen.getByText('Admin Programme Dashboard')).toBeInTheDocument();
      expect(screen.getByText(/12 independent reconciliation checks passed/i)).toBeInTheDocument();
    });

    // Old amber warning banner & Configure in Settings button must be completely replaced by the clean Google Sheets prompt
    expect(
      screen.queryByText(/Programme setup items pending administrator input:/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Configure in Settings/i })).not.toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Connect Your Google Sheet' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Connect your Google Sheet to securely store, manage and access all programme data in one place.',
      ),
    ).toBeInTheDocument();

    // Open Connect Modal, verify prefilled target sheet ID, connect existing sheet -> Connected Banner -> Sync -> Non-destructive Disconnect
    await user.click(screen.getByRole('button', { name: 'Connect Google Sheets' }));
    const sheetsDialog = await screen.findByRole('dialog', {
      name: 'Connect Your Google Sheet',
    });
    const urlInput = within(sheetsDialog).getByLabelText(
      /Google Spreadsheet URL or ID/i,
    ) as HTMLInputElement;
    expect(urlInput.value).toContain('1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE');

    await user.click(
      within(sheetsDialog).getByRole('button', { name: 'Connect Google Sheets' }),
    );
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    const connectedBanner = await screen.findByRole('region', {
      name: 'Target Sheet Selected (Local Storage)',
    });
    expect(within(connectedBanner).getByText(SANDBOX_USERS.super_admin_1.email)).toBeInTheDocument();
    const manageBtn = within(connectedBanner).getByRole('button', { name: 'Manage Connection' });
    expect(manageBtn).toBeInTheDocument();

    // Open Manage Connection modal & run sync -> deduplicates safely
    await user.click(manageBtn);
    const manageDialog = await screen.findByRole('dialog', {
      name: 'Manage Google Sheets Connection',
    });
    await user.click(
      within(manageDialog).getByRole('button', { name: /Sync Programme Data Now/i }),
    );
    await waitFor(() => {
      expect(within(manageDialog).getByRole('status').textContent).toMatch(/1 session\(s\)/i);
    });

    // Disconnect via two-step safe confirmation -> returns cleanly to prompt
    await user.click(within(manageDialog).getByRole('button', { name: /^Disconnect$/i }));
    await user.click(within(manageDialog).getByRole('button', { name: /Confirm disconnect/i }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Connect Your Google Sheet' })).toBeInTheDocument();
    });

    // Test blur/submit validation & Create New Spreadsheet option in modal
    await user.click(screen.getByRole('button', { name: 'Connect Google Sheets' }));
    const sheetsDialog2 = await screen.findByRole('dialog', {
      name: 'Connect Your Google Sheet',
    });
    const urlInput2 = within(sheetsDialog2).getByLabelText(/Google Spreadsheet URL or ID/i);
    await user.clear(urlInput2);
    await user.type(urlInput2, 'bad');
    expect(urlInput2).toHaveAttribute('aria-invalid', 'false');
    await user.tab();
    expect(urlInput2).toHaveAttribute('aria-invalid', 'true');
    expect(
      within(sheetsDialog2).getByText(/Error: Enter a valid Google Sheets URL/i),
    ).toBeInTheDocument();

    await user.click(within(sheetsDialog2).getByLabelText('Create a new spreadsheet'));
    const titleInput = within(sheetsDialog2).getByLabelText(/New Google Spreadsheet Name/i);
    await user.clear(titleInput);
    await user.type(titleInput, 'Vidhya Vidhai · New Live Sheet');
    await user.click(
      within(sheetsDialog2).getByRole('button', { name: /Create & Connect Spreadsheet/i }),
    );
    const connectedBanner2 = await screen.findByRole('region', {
      name: 'Target Sheet Selected (Local Storage)',
    });
    expect(
      within(connectedBanner2).getByRole('link', { name: /Vidhya Vidhai · New Live Sheet/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Navigate to Schools -> test sortable th + DetailedAnalyticsModal
    await user.click(within(adminNav).getByRole('button', { name: 'Schools' }));
    const schoolSortBtn = await screen.findByRole('button', { name: 'School / UDISE' });
    await user.click(schoolSortBtn);
    expect(schoolSortBtn.closest('th')).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByText(/UDISE School Master Directory/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Inspect GHSS Nagapattinam Model breakdown' }));
    const sliceDialog = await screen.findByRole('dialog', { name: /GHSS Nagapattinam Model/i });
    expect(within(sliceDialog).getByText(/Question A \(CSAT\) Sentiment/i)).toBeInTheDocument();
    await user.click(within(sliceDialog).getByRole('button', { name: /^Close$/ }));

    // Navigate through User Management -> verify Protected Super Admins & zero Admin promotion dropdown
    await user.click(within(adminNav).getByRole('button', { name: 'User Management' }));
    const adminMatches = await screen.findAllByText('brinthajayaprakash888@gmail.com');
    expect(adminMatches.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('karunya@vidhyavidhai.org')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Super Administrator/i })).not.toBeInTheDocument();

    // Navigate through Performance Reports -> test ExportReportModal
    await user.click(within(adminNav).getByRole('button', { name: 'Performance Reports' }));
    await user.click(screen.getByRole('button', { name: /Export Official Workbook \(\.xlsx\)/i }));
    const exportDialog = await screen.findByRole('dialog', {
      name: /Export Programme Report \(\.xlsx \/ \.csv\)/i,
    });
    expect(within(exportDialog).getByText('1 export rows')).toBeInTheDocument();
    expect(within(exportDialog).getByRole('button', { name: 'Download .csv' })).toBeEnabled();
    await user.click(within(exportDialog).getByRole('button', { name: 'Cancel' }));

    // Remaining sections render cleanly without crashing
    for (const label of [
      'Analytics',
      'All Submissions',
      'Facilitators',
      'Student Feedback',
      'Teacher Feedback',
      'Data Quality',
      'Google Sheets Sync',
      'Settings',
    ]) {
      const btn = within(adminNav).getByRole('button', { name: label });
      await user.click(btn);
      expect(btn).toHaveAttribute('aria-current', 'page');
    }
    expect(await screen.findByText(/System Configuration & 63-Column Export Template/i)).toBeInTheDocument();
    expect(screen.queryByText(/District–Block Master Data/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Block$/i)).not.toBeInTheDocument();
  });

  it('keeps login clean without exposing account lists, redirects Continue with Google to /auth/google, routes only the 2 allowlisted admins to /admin/overview, isolates other accounts to /classroom-entry, and guards manual admin URLs', async () => {
    const user = userEvent.setup();
    render(<App />);

    // 1. Login screen renders clean dedicated portal UI with Vidhya Vidhai logo, Foundation in front of Career Tours, Roos StudioX attribution, passwordless auth, and zero preset role/name leaks
    expect(
      screen.getByRole('heading', { name: 'Career Tours Classroom Portal' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sign in to your workspace' })).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /Vidhya Vidhai Foundation — Educate, Innovate, Lead/i }),
    ).toBeInTheDocument();
    const creditLink = screen.getByRole('link', { name: /Roos StudioX/i });
    expect(creditLink).toHaveAttribute('href', 'https://roosstudiox.com/');
    expect(creditLink).toHaveAttribute('rel', 'noopener noreferrer');
    const brandBannerText = Array.from(document.querySelectorAll('header span'))
      .map((n) => n.textContent ?? '')
      .join(' ');
    expect(brandBannerText.indexOf('Vidhya Vidhai Foundation')).toBeGreaterThan(-1);
    expect(brandBannerText.indexOf('Vidhya Vidhai Foundation')).toBeLessThan(
      brandBannerText.indexOf('Career Tours'),
    );
    expect(screen.queryByLabelText(/Password/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Super Admin 1/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Facilitator 1/i)).not.toBeInTheDocument();
    expect(screen.queryByText('brinthajayaprakash888@gmail.com')).not.toBeInTheDocument();
    expect(screen.queryByText('karunya@vidhyavidhai.org')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Preview account switcher')).not.toBeInTheDocument();

    // 2. Clicking "Continue with Google" redirects cleanly to dedicated /auth/google experience
    await user.click(screen.getByRole('button', { name: /Continue with Google/i }));
    expect(window.location.pathname).toBe('/auth/google');
    expect(await screen.findByRole('heading', { name: 'Sign in with Google' })).toBeInTheDocument();

    // 3. Denied user blocked with Access Denied screen, then returns cleanly to /auth/google
    await user.type(screen.getByLabelText(/Google account email/i), 'denied.user@example.org');
    await user.click(screen.getByRole('button', { name: /Verify & Sign In/i }));
    expect(await screen.findByRole('heading', { name: 'Access Denied' })).toBeInTheDocument();
    expect(screen.getByText('denied.user@example.org')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Try a different Google account/i }));
    expect(window.location.pathname).toBe('/auth/google');
    expect(await screen.findByRole('heading', { name: 'Sign in with Google' })).toBeInTheDocument();

    // 4. Super Admin 1 signs in through /auth/google and redirects automatically to /admin/overview
    const googleEmailInput = screen.getByLabelText(/Google account email/i);
    await user.clear(googleEmailInput);
    await user.type(googleEmailInput, 'brinthajayaprakash888@gmail.com');
    await user.type(screen.getByLabelText(/^Password/i), 'brintha888');
    await user.click(screen.getByRole('button', { name: /Verify & Sign In/i }));
    await waitFor(
      () => {
        expect(window.location.pathname).toBe('/admin/overview');
      },
      { timeout: 2000 },
    );
    expect(
      screen.getAllByText(/Vidhya Vidhai Foundation\s*·\s*Career Tours/i).length,
    ).toBeGreaterThanOrEqual(1);
    const headerBrandNodes = screen.getByRole('banner').querySelectorAll('span, p');
    const headerText = Array.from(headerBrandNodes).map((n) => n.textContent ?? '').join(' ');
    expect(headerText.indexOf('Vidhya Vidhai Foundation')).toBeGreaterThan(-1);
    expect(headerText.indexOf('Vidhya Vidhai Foundation')).toBeLessThan(
      headerText.indexOf('Career Tours'),
    );

    const primaryNav = await screen.findByRole('navigation', { name: 'Primary application views' });
    expect(within(primaryNav).getByRole('button', { name: 'Enter a class' })).toBeInTheDocument();
    expect(within(primaryNav).getByRole('button', { name: 'My classes' })).toBeInTheDocument();
    expect(within(primaryNav).getByRole('button', { name: 'Admin Console' })).toBeInTheDocument();

    // Open Google Sheets Sync Status modal showing honest Local Storage + Setup Needed (zero developer/sandbox jargon)
    await user.click(screen.getByRole('button', { name: /Local Storage · Setup Google Sheets/i }));
    const syncDialog = await screen.findByRole('dialog', {
      name: /Google Sheets Sync Status/i,
    });
    expect(
      within(syncDialog).getByText(
        /Not Connected Online Yet — Saving Locally on This Device/i,
      ),
    ).toBeInTheDocument();
    expect(within(syncDialog).queryByText(/Local Sandbox/i)).not.toBeInTheDocument();
    expect(within(syncDialog).queryByText(/Preview Mode/i)).not.toBeInTheDocument();
    await user.click(within(syncDialog).getByRole('button', { name: /^Close$/ }));

    // 5. Sign out -> navigate to /auth/google -> saved recent Google account tile + Use another Google account -> Super Admin 2
    await user.click(screen.getByRole('button', { name: /Sign out/i }));
    expect(window.location.pathname).toBe('/login');
    await user.click(await screen.findByRole('button', { name: /Continue with Google/i }));
    expect(await screen.findByText(/Choose a recently signed-in account/i)).toBeInTheDocument();
    expect(screen.getByText('brinthajayaprakash888@gmail.com')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Use another Google account/i }));
    await user.type(screen.getByLabelText(/Google account email/i), 'karunya@vidhyavidhai.org');
    await user.type(screen.getByLabelText(/^Password/i), 'karunya@VV');
    await user.click(screen.getByRole('button', { name: /Verify & Sign In/i }));
    await waitFor(
      () => {
        expect(window.location.pathname).toBe('/admin/overview');
      },
      { timeout: 2000 },
    );
    expect(
      within(await screen.findByRole('navigation', { name: 'Primary application views' })).getByRole(
        'button',
        { name: 'Admin Console' },
      ),
    ).toBeInTheDocument();

    // 6. Sign out -> facilitator signs in on /login via passwordless Workspace Email -> lands strictly in /classroom-entry with ZERO admin/Sheets UI
    await user.click(screen.getByRole('button', { name: /Sign out/i }));
    await user.type(await screen.findByLabelText(/^Email/i), 'teacher.anitha@vidhyavidhai.org');
    await user.click(screen.getByRole('button', { name: /^Sign In$/i }));

    await waitFor(
      () => {
        expect(window.location.pathname).toBe('/classroom-entry');
        const facNav = screen.getByRole('navigation', { name: 'Primary application views' });
        expect(within(facNav).queryByRole('button', { name: 'Admin Console' })).not.toBeInTheDocument();
      },
      { timeout: 2000 },
    );
    expect(
      screen.queryByRole('button', { name: /Local Storage · Setup Google Sheets/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Preview account switcher')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect Google Sheets/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'About you' })).toBeInTheDocument();

    // 7. Facilitator manually visits restricted /admin/overview URL -> Access Denied screen + auto-redirect to /classroom-entry
    await act(async () => {
      window.history.pushState(null, '', '/admin/overview');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    const alertBox = await screen.findByRole('alert');
    expect(within(alertBox).getByRole('heading', { name: 'Access Denied' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Administrator' })).not.toBeInTheDocument();

    await waitFor(
      () => {
        expect(window.location.pathname).toBe('/classroom-entry');
        expect(screen.getByRole('heading', { name: 'About you' })).toBeInTheDocument();
      },
      { timeout: 2600 },
    );
  });

  it('renders redesigned Analytics & Performance empty state cleanly without fabricated metrics and updates dynamically across all charts and insights when filtered', async () => {
    const user = userEvent.setup();
    const cfg = createTestConfig();
    let actorId: string = SANDBOX_USERS.super_admin_1.userId;
    const api = new LocalSandboxApiClient(() => actorId, cfg);

    // 1. Empty state on Analytics page (0 sessions)
    const { rerender } = render(
      <AdminDashboardPage
        api={api}
        user={SANDBOX_USERS.super_admin_1}
        config={cfg}
        activeSection="analytics"
        onSelectSection={vi.fn()}
        onEditSession={vi.fn()}
        onNotify={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: 'Analytics & Performance' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Understand programme reach, engagement and performance across districts, schools and facilitators.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Monthly Programme Performance' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'District-wise Performance' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Career Tour Performance' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Language Distribution' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Grade-wise Student Reach' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Facilitator Performance' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Feedback & Satisfaction' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Programme Insights' })).toBeInTheDocument();
    expect(screen.getAllByText('No data yet').length).toBeGreaterThanOrEqual(4);

    // 2. Seed two months / districts / tours / languages / grades
    actorId = SANDBOX_USERS.facilitator.userId;
    const c1 = await api.createSession(
      createValidFormValues({
        schoolName: 'GHSS Cuddalore Town',
        udiseCode: '33180100105',
        district: 'Cuddalore',
        tourId: 'TOUR_AM',
        language: 'Tamil',
        startDate: '2026-10-10',
        endDate: '2026-10-10',
        classes: [
          {
            rowId: 'a1',
            grade: '8',
            section: 'A',
            studentsPresent: '50',
            questionA: { score5: '40', score4: '10', score3: '0', score2: '0', score1: '0' },
            questionB: { score5: '30', score4: '20', score3: '0', score2: '0', score1: '0' },
          },
        ],
        teacherNpsGroup: 'promoter',
        teacherExactScore: '9',
      }),
    );
    expect(c1.ok).toBe(true);
    const c2 = await api.createSession(
      createValidFormValues({
        schoolName: 'GHSS Nagapattinam Central',
        udiseCode: '33190200208',
        district: 'Nagapattinam',
        tourId: 'TOUR_RFC',
        language: 'English',
        startDate: '2026-11-05',
        endDate: '2026-11-05',
        classes: [
          {
            rowId: 'a2',
            grade: '9',
            section: 'A',
            studentsPresent: '80',
            questionA: { score5: '80', score4: '0', score3: '0', score2: '0', score1: '0' },
            questionB: { score5: '60', score4: '20', score3: '0', score2: '0', score1: '0' },
          },
        ],
        teacherNpsGroup: 'promoter',
        teacherExactScore: '10',
      }),
    );
    expect(c2.ok).toBe(true);

    actorId = SANDBOX_USERS.super_admin_1.userId;
    rerender(
      <AdminDashboardPage
        api={api}
        user={SANDBOX_USERS.super_admin_1}
        config={cfg}
        activeSection="analytics"
        dataVersion={1}
        onSelectSection={vi.fn()}
        onEditSession={vi.fn()}
        onNotify={vi.fn()}
      />,
    );

    const kpiSection = screen.getByLabelText('Key programme performance indicators');
    await waitFor(() => {
      expect(screen.getByText('Live calculation')).toBeInTheDocument();
      expect(within(kpiSection).getByText('130')).toBeInTheDocument();
      expect(within(kpiSection).getByText('+60% vs Oct \'26')).toBeInTheDocument();
    });

    // Career Tour metric focus toggle updates active column mode
    const tourSection = screen.getByRole('region', { name: 'Career Tour Performance' });
    await user.click(within(tourSection).getByRole('button', { name: 'Students' }));
    expect(within(tourSection).getByRole('button', { name: 'Students' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Inspect drill-down opens modal for Nagapattinam
    await user.click(screen.getByRole('button', { name: 'Inspect Nagapattinam district analytics' }));
    expect(
      await screen.findByRole('heading', { name: /Nagapattinam District Analytics/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Close$/i }));

    // District filter dynamically updates KPIs, insights, and distributions
    await user.selectOptions(screen.getByLabelText(/^District$/i), 'Cuddalore');
    await waitFor(() => {
      expect(screen.getByText('1 filter active')).toBeInTheDocument();
      expect(within(kpiSection).getByText('50')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Clear filters/i }));
    await waitFor(() => {
      expect(screen.getByText('All programme records')).toBeInTheDocument();
      expect(within(kpiSection).getByText('130')).toBeInTheDocument();
    });
  });

  it('supports Super Admin session archive/restore/single-delete/bulk-delete, school edit/remove, user edit/remove, and settings master cleanup', async () => {
    const user = userEvent.setup();
    const initialCfg = createTestConfig({
      exportTemplate63: {
        templateName: 'Official_63_Test.xlsx',
        verified: true,
        columns: Array.from({ length: 63 }, (_, i) => ({
          index: i + 1,
          header: `Column ${i + 1}`,
          sourceKey: '',
        })),
      },
    });
    let actorId: string = SANDBOX_USERS.facilitator.userId;
    const api = new LocalSandboxApiClient(() => actorId, initialCfg);

    const s1Res = await api.createSession(
      createValidFormValues({
        schoolName: 'GHSS Alpha One',
        udiseCode: '33180100111',
        district: 'Cuddalore',
        pinCode: '607106',
        startTime: '09:00',
        endTime: '10:00',
      }),
    );
    const s2Res = await api.createSession(
      createValidFormValues({
        schoolName: 'GHSS Beta Two',
        udiseCode: '33190200222',
        district: 'Nagapattinam',
        pinCode: '611104',
        startTime: '11:00',
        endTime: '12:00',
      }),
    );
    const s3Res = await api.createSession(
      createValidFormValues({
        schoolName: 'GHSS Gamma Three',
        udiseCode: '33200300333',
        district: 'Sivaganga',
        pinCode: '630001',
        startTime: '14:00',
        endTime: '15:00',
      }),
    );
    expect(s1Res.ok && s2Res.ok && s3Res.ok).toBe(true);
    const rec1 = s1Res.data!.session;
    const rec2 = s2Res.data!.session;
    const rec3 = s3Res.data!.session;

    actorId = SANDBOX_USERS.super_admin_1.userId;

    function StatefulAdminWrapper() {
      const [cfgState, setCfgState] = useState(initialCfg);
      return (
        <AdminDashboardPage
          api={api}
          user={SANDBOX_USERS.super_admin_1}
          config={cfgState}
          onConfigUpdated={setCfgState}
          onEditSession={vi.fn()}
          onNotify={vi.fn()}
        />
      );
    }

    render(<StatefulAdminWrapper />);
    const adminNav = await screen.findByRole('navigation', { name: 'Administrator' });

    // 1. All Submissions: archive -> show archived -> restore -> single permanent delete -> multi-select bulk delete
    await user.click(within(adminNav).getByRole('button', { name: 'All Submissions' }));
    await waitFor(() => {
      expect(screen.getByText('All Authorized Programme Records (3)')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: `Archive ${rec1.sessionId}` }));
    const archiveDialog = await screen.findByRole('dialog', { name: /Archive session record\?/i });
    await user.click(within(archiveDialog).getByRole('button', { name: /Yes, archive session/i }));
    await waitFor(() => {
      expect(screen.getByText('All Authorized Programme Records (2)')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Include archived sessions'));
    await waitFor(() => {
      expect(screen.getByText('All Authorized Programme Records (3)')).toBeInTheDocument();
      expect(screen.getByText('ARCHIVED')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: `Restore ${rec1.sessionId}` }));
    const restoreDialog = await screen.findByRole('dialog', { name: /Restore archived session\?/i });
    await user.click(within(restoreDialog).getByRole('button', { name: /Yes, restore session/i }));
    await waitFor(() => {
      expect(screen.queryByText('ARCHIVED')).not.toBeInTheDocument();
    });

    // Single permanent delete rec1
    await user.click(screen.getByRole('button', { name: `Delete ${rec1.sessionId} permanently` }));
    const deleteDialog = await screen.findByRole('dialog', {
      name: /Permanently delete session record\?/i,
    });
    await user.click(within(deleteDialog).getByRole('button', { name: /Yes, delete permanently/i }));
    await waitFor(() => {
      expect(screen.getByText('All Authorized Programme Records (2)')).toBeInTheDocument();
    });

    // Bulk delete rec2 & rec3
    await user.click(screen.getByLabelText(`Select session ${rec2.sessionId}`));
    await user.click(screen.getByLabelText(`Select session ${rec3.sessionId}`));
    await user.click(screen.getByRole('button', { name: /Delete Selected \(2\)/i }));
    const bulkDialog = await screen.findByRole('dialog', {
      name: /Permanently delete 2 selected session\(s\)\?/i,
    });
    await user.click(within(bulkDialog).getByRole('button', { name: /Yes, delete 2 session\(s\)/i }));
    await waitFor(() => {
      expect(screen.getByText('All Authorized Programme Records (0)')).toBeInTheDocument();
    });

    // 2. Schools: edit school record in GlassModal + remove school via ConfirmDialog
    await user.click(within(adminNav).getByRole('button', { name: 'Schools' }));
    await waitFor(() => {
      expect(screen.getByText('UDISE School Master Directory (3)')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Edit school 33180100111' }));
    const schoolEditModal = await screen.findByRole('dialog', {
      name: /Edit School Master Record/i,
    });
    const nameInput = within(schoolEditModal).getByLabelText(/Canonical School Name/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'GHSS Alpha Canonical Updated');
    await user.click(within(schoolEditModal).getByRole('button', { name: 'Save School Record' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByText('GHSS Alpha Canonical Updated')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Remove school 33190200222' }));
    const schoolDelDialog = await screen.findByRole('dialog', {
      name: /Remove school from UDISE directory\?/i,
    });
    await user.click(within(schoolDelDialog).getByRole('button', { name: /Yes, remove school/i }));
    await waitFor(() => {
      expect(screen.getByText('UDISE School Master Directory (2)')).toBeInTheDocument();
    });

    // 3. User Management: inline edit facilitator name + delete non-allowlisted facilitator
    await user.click(within(adminNav).getByRole('button', { name: 'User Management' }));
    await waitFor(() => {
      expect(screen.getByText('Facilitator Directory & Pre-Approval (4)')).toBeInTheDocument();
    });

    const fac1Email = SANDBOX_USERS.facilitator.email;
    const fac2Email = SANDBOX_USERS.facilitator_2.email;
    await user.click(screen.getByRole('button', { name: `Edit name for ${fac1Email}` }));
    const editFacInput = screen.getByLabelText(`Edit name for ${fac1Email}`);
    await user.clear(editFacInput);
    await user.type(editFacInput, 'Priya S Renamed');
    await user.click(screen.getByRole('button', { name: `Save name for ${fac1Email}` }));
    await waitFor(() => {
      expect(screen.getByText('Priya S Renamed')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: `Remove user ${fac2Email}` }));
    const delUserDialog = await screen.findByRole('dialog', {
      name: /Remove user from directory\?/i,
    });
    await user.click(within(delUserDialog).getByRole('button', { name: /Yes, remove user/i }));
    await waitFor(() => {
      expect(screen.getByText('Facilitator Directory & Pre-Approval (3)')).toBeInTheDocument();
    });

    // 4. Settings: confirm Block master UI is completely absent, remove Career Tour, remove 63-column template
    await user.click(within(adminNav).getByRole('button', { name: 'Settings' }));
    await waitFor(() => {
      expect(screen.getByText(/System Configuration & 63-Column Export Template/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/District–Block Master Data/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Current District Coverage/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Not configured yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/No blocks configured/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Block$/i)).not.toBeInTheDocument();

    // Check Analytics also has no Block filter dropdown
    await user.click(within(adminNav).getByRole('button', { name: 'Analytics' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Analytics & Performance/i })).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/^Block$/i)).not.toBeInTheDocument();
    await user.click(within(adminNav).getByRole('button', { name: 'Settings' }));
    await waitFor(() => {
      expect(screen.getByText(/System Configuration & 63-Column Export Template/i)).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole('button', { name: 'Remove tour Robotics Fulfillment Center' }),
    );
    expect(screen.queryByText('Robotics Fulfillment Center')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove Template' }));
    expect(screen.getByText('Not imported yet')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Save System Configuration/i }));
    await waitFor(async () => {
      const persistedCfg = await api.getAppConfiguration();
      expect(persistedCfg.data!.tours).toHaveLength(1);
      expect(persistedCfg.data!.exportTemplate63).toBeNull();
    });
  });

  it('keeps structured table headers, sortable controls, filter chips, 0-row schema export, and official declarations on All Submissions & Performance Reports at 0 sessions', async () => {
    const user = userEvent.setup();
    const cfg = createTestConfig();
    const api = new LocalSandboxApiClient(() => SANDBOX_USERS.super_admin_1.userId, cfg);

    // 1. All Submissions at 0 sessions
    const { rerender } = render(
      <AdminDashboardPage
        api={api}
        user={SANDBOX_USERS.super_admin_1}
        config={cfg}
        activeSection="all-submissions"
        onSelectSection={vi.fn()}
        onEditSession={vi.fn()}
        onOpenNewModal={vi.fn()}
        onNotify={vi.fn()}
      />,
    );

    expect(
      await screen.findByText('All Authorized Programme Records (0)'),
    ).toBeInTheDocument();

    const recordsRegion = screen.getByRole('region', {
      name: /Authorized programme session records/i,
    });
    const recordsTable = within(recordsRegion).getByRole('table');

    for (const colName of [
      'Session ID',
      'Facilitator',
      'School / UDISE',
      'District',
      'Tour',
      'Date',
      'Students',
      'CSAT',
      'ITP',
      'NPS',
    ]) {
      expect(within(recordsTable).getByRole('button', { name: colName })).toBeInTheDocument();
    }
    expect(screen.queryByLabelText(/^Block$/i)).not.toBeInTheDocument();
    expect(within(recordsTable).queryByText(/District \/ Block/i)).not.toBeInTheDocument();
    expect(within(recordsTable).getByText('No records match filters.')).toBeInTheDocument();

    // Sortable <th aria-sort> toggle
    const sessionSortBtn = within(recordsTable).getByRole('button', { name: 'Session ID' });
    await user.click(sessionSortBtn);
    expect(sessionSortBtn.closest('th')).toHaveAttribute('aria-sort', 'ascending');
    await user.click(sessionSortBtn);
    expect(sessionSortBtn.closest('th')).toHaveAttribute('aria-sort', 'descending');

    // Filter chips appear and can be removed directly above the table
    await user.selectOptions(screen.getByLabelText(/^District$/i), 'Cuddalore');
    const chipsRegion = await screen.findByLabelText('Active table filters');
    expect(within(chipsRegion).getByText('District: Cuddalore')).toBeInTheDocument();
    const activeTable = within(
      screen.getByRole('region', { name: /Authorized programme session records/i }),
    ).getByRole('table');
    expect(
      await within(activeTable).findByRole('button', { name: /Reset Filters/i }),
    ).toBeInTheDocument();
    await user.click(
      within(chipsRegion).getByRole('button', { name: 'Remove District: Cuddalore filter' }),
    );
    await waitFor(() => {
      expect(screen.queryByLabelText('Active table filters')).not.toBeInTheDocument();
    });

    // ARIA disclosure toggles Table Schema & Declarations cleanly
    const declBtn = screen.getByRole('button', {
      name: /Table Schema & Declarations \(9\)/i,
    });
    expect(declBtn).toHaveAttribute('aria-expanded', 'false');
    await user.click(declBtn);
    expect(declBtn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('GOV-01')).toBeInTheDocument();
    expect(screen.getByText('MET-01')).toBeInTheDocument();
    expect(screen.getByText('INT-02')).toBeInTheDocument();

    // 0-session Export opens ExportReportModal in schema-ready mode
    await user.click(
      within(recordsTable).getByRole('button', { name: /Export Schema Workbook \(\.xlsx\)/i }),
    );
    const exportDialog = await screen.findByRole('dialog', {
      name: /Export Programme Report \(\.xlsx \/ \.csv\)/i,
    });
    expect(within(exportDialog).getByText('0 export rows')).toBeInTheDocument();
    expect(within(exportDialog).getByRole('button', { name: 'Download .csv' })).toBeEnabled();
    expect(
      within(exportDialog).getByRole('button', { name: 'Download Schema-Ready Workbook (.xlsx)' }),
    ).toBeEnabled();
    await user.click(within(exportDialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // 2. Performance Reports at 0 sessions: Declarations + Searchable/Filterable 56-Col Dictionary
    rerender(
      <AdminDashboardPage
        api={api}
        user={SANDBOX_USERS.super_admin_1}
        config={cfg}
        activeSection="performance-reports"
        onSelectSection={vi.fn()}
        onEditSession={vi.fn()}
        onOpenNewModal={vi.fn()}
        onNotify={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole('heading', {
        name: /Official Programme Metric & Data Integrity Declarations/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('INT-01')).toBeInTheDocument();
    expect(screen.getByText('MET-04')).toBeInTheDocument();

    expect(
      screen.getByRole('heading', {
        name: /Export Schema Data Dictionary & Validation Reference \(56 \/ 56 columns\)/i,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Education Block')).not.toBeInTheDocument();

    const dictSearch = screen.getByLabelText(/Search schema columns/i);
    await user.type(dictSearch, 'UDISE');
    expect(
      screen.getByRole('heading', {
        name: /Export Schema Data Dictionary & Validation Reference \(2 \/ 56 columns\)/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('UDISE Code (11-digit text)')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Reset filter/i }));
    expect(
      screen.getByRole('heading', {
        name: /Export Schema Data Dictionary & Validation Reference \(56 \/ 56 columns\)/i,
      }),
    ).toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText(/^Category$/i),
      'Student Feedback (Q-A / CSAT)',
    );
    expect(screen.getByText('Session Pooled CSAT')).toBeInTheDocument();
  });

  it('allows Super Admins to verify & activate Live Google Sheets Sync safely in-app without developer jargon or secrets, and switches banners accurately', async () => {
    const user = userEvent.setup();

    // 1. Verify GoogleSheetsBanner separates green Live state vs amber Preview state
    const baseConnection = {
      connected: true,
      authMethod: 'local_sandbox' as const,
      oauthConfigured: false,
      connectedAccount: SANDBOX_USERS.super_admin_1.email,
      spreadsheetId: '1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE',
      spreadsheetName: 'Vidhya Vidhai · Career Tours Database',
      spreadsheetUrl:
        'https://docs.google.com/spreadsheets/d/1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE/edit?gid=0#gid=0',
      connectedAt: '2026-11-10T10:00:00Z',
      connectedBy: SANDBOX_USERS.super_admin_1.email,
      lastSyncedAt: '2026-11-10T10:00:00Z',
      lastSyncStatus: 'SYNCED' as const,
      lastSyncMessage: '',
      initializedTabs: ['Sessions'],
      defaultSpreadsheetId: '1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE',
      defaultSpreadsheetUrl:
        'https://docs.google.com/spreadsheets/d/1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE/edit?gid=0#gid=0',
    };
    const { rerender, unmount } = render(
      <GoogleSheetsBanner
        connection={baseConnection}
        isLiveBackend={false}
        userEmail={SANDBOX_USERS.super_admin_1.email}
        onConnectClick={vi.fn()}
        onManageClick={vi.fn()}
        onActivateLiveClick={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('region', { name: 'Target Sheet Selected (Local Storage)' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activate Live Sync' })).toBeInTheDocument();

    rerender(
      <GoogleSheetsBanner
        connection={{ ...baseConnection, authMethod: 'apps_script', oauthConfigured: true }}
        isLiveBackend={true}
        userEmail={SANDBOX_USERS.super_admin_1.email}
        onConnectClick={vi.fn()}
        onManageClick={vi.fn()}
      />,
    );
    expect(screen.getByRole('region', { name: 'Google Sheets Connected' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage Connection' })).toBeInTheDocument();
    unmount();

    // 2. Super Admin signs in -> opens Local Storage · Setup Google Sheets -> validation guards -> activates live backend
    render(<App />);
    await user.type(await screen.findByLabelText(/^Email/i), 'brinthajayaprakash888@gmail.com');
    await user.type(screen.getByLabelText(/^Password/i), 'brintha888');
    await user.click(screen.getByRole('button', { name: /^Sign In$/i }));
    await waitFor(() => {
      expect(window.location.pathname).toBe('/admin/overview');
    });

    await user.click(screen.getByRole('button', { name: /Local Storage · Setup Google Sheets/i }));
    const syncDialog = await screen.findByRole('dialog', {
      name: /Google Sheets Sync Status/i,
    });
    expect(within(syncDialog).queryByText(/Pipeline Telemetry/i)).not.toBeInTheDocument();
    expect(within(syncDialog).queryByText(/frontend\/\.env/i)).not.toBeInTheDocument();

    const urlField = within(syncDialog).getByLabelText(/Google Apps Script Web App URL/i);
    const clientField = within(syncDialog).getByLabelText(/Google Sign-In OAuth Web Client ID/i);

    await user.type(urlField, 'http://script.google.com/macros/s/abc/dev');
    await user.type(clientField, 'GOCSPX-secret-should-be-blocked');
    await user.click(
      within(syncDialog).getByRole('button', { name: /Verify & Activate Live Google Sync/i }),
    );
    expect(
      await within(syncDialog).findByText(/must use secure https:\/\//i),
    ).toBeInTheDocument();
    expect(
      within(syncDialog).getByText(/Do not paste a Google Client Secret/i),
    ).toBeInTheDocument();

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          status: 'READY',
          service: 'Career Tours Classroom Data Entry & Feedback Management API',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    try {
      await user.clear(urlField);
      await user.type(
        urlField,
        'https://script.google.com/macros/s/AKfycb1234567890abcdefghijklmnop/exec',
      );
      await user.clear(clientField);
      await user.type(clientField, '1234567890-testwebclient.apps.googleusercontent.com');
      await user.click(
        within(syncDialog).getByRole('button', { name: /Verify & Activate Live Google Sync/i }),
      );

      await waitFor(() => {
        expect(window.location.pathname).toBe('/auth/google');
        expect(
          screen.getByRole('button', { name: /Sign In with Google Account Chooser/i }),
        ).toBeInTheDocument();
      });

      const stored = JSON.parse(localStorage.getItem('ct_live_backend_config_v1') || '{}');
      expect(stored.appsScriptUrl).toBe(
        'https://script.google.com/macros/s/AKfycb1234567890abcdefghijklmnop/exec',
      );
      expect(stored.googleClientId).toBe(
        '1234567890-testwebclient.apps.googleusercontent.com',
      );
      expect(stored.configuredBy).toBe('brinthajayaprakash888@gmail.com');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('keeps the green Google Sheets Connected banner stable across dashboard filter changes and transient NETWORK_ERROR polling failures', async () => {
    const user = userEvent.setup();
    const cfg = createTestConfig();
    const api = new LocalSandboxApiClient(() => SANDBOX_USERS.super_admin_1.userId, cfg);

    const liveConnectedState = {
      connected: true,
      authMethod: 'apps_script' as const,
      oauthConfigured: false,
      connectedAccount: SANDBOX_USERS.super_admin_1.email,
      spreadsheetId: '1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE',
      spreadsheetName: 'Vidhya Vidhai · Career Tours Database',
      spreadsheetUrl:
        'https://docs.google.com/spreadsheets/d/1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE/edit?gid=0#gid=0',
      connectedAt: '2026-11-11T00:00:00Z',
      connectedBy: SANDBOX_USERS.super_admin_1.email,
      lastSyncedAt: '2026-11-11T00:00:00Z',
      lastSyncStatus: 'SYNCED' as const,
      lastSyncMessage: 'Connected & verified',
      initializedTabs: ['Sessions', 'Session Details'],
      defaultSpreadsheetId: '1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE',
      defaultSpreadsheetUrl:
        'https://docs.google.com/spreadsheets/d/1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE/edit?gid=0#gid=0',
    };

    const getAdminSessionsSpy = vi.spyOn(api, 'getAdminSessions');
    const getSheetsConnSpy = vi
      .spyOn(api, 'getSheetsConnection')
      .mockResolvedValueOnce({ ok: true, data: liveConnectedState })
      .mockResolvedValue({
        ok: false,
        code: 'NETWORK_ERROR',
        error: 'Simulated temporary outage',
      });

    render(
      <AdminDashboardPage
        api={api}
        user={SANDBOX_USERS.super_admin_1}
        config={cfg}
        activeSection="overview"
        isLiveBackend={true}
        onSelectSection={vi.fn()}
        onEditSession={vi.fn()}
        onOpenNewModal={vi.fn()}
        onNotify={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole('region', { name: 'Google Sheets Connected' }),
    ).toBeInTheDocument();
    expect(getSheetsConnSpy).toHaveBeenCalledTimes(1);

    // Changing dashboard filters must reload admin data WITHOUT re-querying getSheetsConnection or resetting the banner
    getAdminSessionsSpy.mockClear();
    await user.selectOptions(screen.getByLabelText(/^District$/i), 'Cuddalore');
    await user.type(screen.getByLabelText(/School Name \/ Search/i), 'Panruti');
    await waitFor(() => {
      expect(getAdminSessionsSpy).toHaveBeenCalledWith(
        expect.objectContaining({ district: 'Cuddalore', search: 'Panruti' }),
      );
    });
    expect(getSheetsConnSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('region', { name: 'Google Sheets Connected' })).toBeInTheDocument();

    // Even if online event triggers a status refresh and the backend temporarily returns NETWORK_ERROR,
    // the verified green banner remains intact instead of flashing "Connect Your Google Sheet".
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => {
      expect(getSheetsConnSpy).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByRole('region', { name: 'Google Sheets Connected' })).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Connect Your Google Sheet' }),
    ).not.toBeInTheDocument();
  });

  it('shows Google Sheets Live header, OAuth sync status, live form destination banner, and Synced to Google Sheets modal when Google OAuth is connected (while hiding Sheets jargon from Facilitators)', async () => {
    const user = userEvent.setup();
    const oauthConn = {
      connected: true,
      authMethod: 'google_oauth' as const,
      oauthConfigured: true,
      connectedAccount: 'brinthajayaprakash888@gmail.com',
      spreadsheetId: '1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE',
      spreadsheetName: 'Vidhya Vidhai · Career Tours Database',
      spreadsheetUrl:
        'https://docs.google.com/spreadsheets/d/1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE/edit?gid=0#gid=0',
      connectedAt: '2026-11-11T00:00:00Z',
      connectedBy: 'brinthajayaprakash888@gmail.com',
      lastSyncedAt: '2026-11-11T00:00:00Z',
      lastSyncStatus: 'SYNCED' as const,
      lastSyncMessage: 'Connected via Google OAuth 2.0',
      initializedTabs: ['Sessions', 'Session Details', 'Schools', 'Facilitators', 'Configuration'],
      defaultSpreadsheetId: '1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE',
      defaultSpreadsheetUrl:
        'https://docs.google.com/spreadsheets/d/1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE/edit?gid=0#gid=0',
    };

    const persistedSessions: Array<Record<string, unknown>> = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/sheets')) {
        if (!init?.method || init.method.toUpperCase() === 'GET') {
          return new Response(JSON.stringify({ ok: true, data: oauthConn }), { status: 200 });
        }
        const body = init.body ? JSON.parse(String(init.body)) : {};
        if (body.action === 'loadWorkspace') {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                sessions: persistedSessions,
                schools: [],
                users: [],
                configurationPatch: {},
                auditLogs: [],
                syncLogs: [],
                spreadsheetId: oauthConn.spreadsheetId,
              },
            }),
            { status: 200 },
          );
        }
        if (body.action === 'createSession') {
          const rec = {
            sessionRecordId: 'REC_UI_OAUTH_1',
            sessionId: 'CT_IN_20261110_33180100101_08_A_001',
            clientSubmissionKey: body.values.clientSubmissionKey,
            facilitatorName: body.values.facilitatorName,
            facilitatorEmail: 'brinthajayaprakash888@gmail.com',
            facilitatorUserId: SANDBOX_USERS.super_admin_1.userId,
            tourId: body.values.tourId,
            tourName: 'Amazon Music: Careers Behind the Beats',
            videoId: 'AFE-IN-AM-OV-TA-2026',
            language: body.values.language,
            startDate: body.values.startDate,
            endDate: body.values.endDate,
            startTime: body.values.startTime,
            endTime: body.values.endTime,
            durationMinutes: 60,
            durationFormatted: '1 hr',
            reportingMonth: 'November',
            submissionTimestamp: '2026-11-11T05:00:00Z',
            submissionDateFormatted: '11-11-2026',
            schoolName: body.values.schoolName,
            udiseCode: body.values.udiseCode,
            schoolType: body.values.schoolType,
            state: body.values.state,
            district: body.values.district,
            pinCode: body.values.pinCode,
            sessionType: 'single',
            totalClasses: 1,
            totalStudentsPresent: 40,
            totalQuestionAResponses: 40,
            totalQuestionBResponses: 40,
            overallCsat: 5,
            overallItp: 5,
            teacherScore: 10,
            teacherClassification: 'Promoter',
            teacherNps: 100,
            submissionStatus: 'COMMITTED',
            syncStatus: 'SYNCED',
            createdAt: '2026-11-11T05:00:00Z',
            updatedAt: '2026-11-11T05:00:00Z',
            createdBy: 'brinthajayaprakash888@gmail.com',
            updatedBy: 'brinthajayaprakash888@gmail.com',
            archived: false,
            details: [],
          };
          persistedSessions.unshift(rec);
          return new Response(
            JSON.stringify({ ok: true, data: { session: rec, warnings: [] } }),
            { status: 200 },
          );
        }
      }
      return new Response(JSON.stringify({ ok: false, error: 'Not found' }), { status: 404 });
    });

    try {
      const { unmount } = render(<App />);

      await user.type(await screen.findByLabelText(/^Email/i), 'brinthajayaprakash888@gmail.com');
      await user.type(screen.getByLabelText(/^Password/i), 'brintha888');
      await user.click(screen.getByRole('button', { name: /^Sign In$/i }));

      await waitFor(() => {
        expect(window.location.pathname).toBe('/admin/overview');
      });

      // Header must show Google Sheets Live (never Local Storage · Setup Google Sheets)
      const liveBtn = await screen.findByRole('button', { name: /Google Sheets Live/i });
      expect(liveBtn).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Local Storage · Setup Google Sheets/i }),
      ).not.toBeInTheDocument();

      // Open Sync Status modal -> shows OAuth connected & Online Google Sheets Storage Active
      await user.click(liveBtn);
      const syncDialog = await screen.findByRole('dialog', {
        name: /Google Sheets Sync Status/i,
      });
      expect(within(syncDialog).getByText('Google Sheets Live')).toBeInTheDocument();
      expect(
        within(syncDialog).getByText(/Connected to Google Sheets via Google OAuth 2.0/i),
      ).toBeInTheDocument();
      expect(
        within(syncDialog).getByText(/Online Google Sheets Storage Active/i),
      ).toBeInTheDocument();
      expect(within(syncDialog).queryByText(/Local Sandbox/i)).not.toBeInTheDocument();
      await user.click(within(syncDialog).getByRole('button', { name: /^Close$/ }));

      // Navigate to Enter a class -> fill form -> submit -> SubmissionSuccessModal shows Synced to Google Sheets
      const primaryNav = screen.getByRole('navigation', { name: 'Primary application views' });
      await user.click(within(primaryNav).getByRole('button', { name: 'Enter a class' }));

      const mainRegion = screen.getByRole('main');
      expect(
        await within(mainRegion).findByText(/Form details save directly into/i),
      ).toBeInTheDocument();
      expect(within(mainRegion).getByText('Google Sheets Live')).toBeInTheDocument();
      expect(
        within(mainRegion).getByText(/Vidhya Vidhai · Career Tours Database/i),
      ).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /What time did it start\?/i }));
      await user.type(screen.getByLabelText(/What time did it start\? direct time input/i), '10:00');
      await user.click(
        within(
          screen.getByRole('region', { name: /What time did it start\? clock selector/i }),
        ).getByRole('button', { name: 'Done' }),
      );
      await user.click(screen.getByRole('button', { name: /What time did it end\?/i }));
      await user.type(screen.getByLabelText(/What time did it end\? direct time input/i), '11:00');
      await user.click(
        within(
          screen.getByRole('region', { name: /What time did it end\? clock selector/i }),
        ).getByRole('button', { name: 'Done' }),
      );

      await user.type(screen.getByLabelText(/^School name/i), 'GHSS OAuth Live Test');
      await user.type(screen.getByLabelText(/School code \(UDISE\)/i), '33180100101');
      await user.selectOptions(
        screen.getByLabelText(/What kind of school is it\?/i),
        'Government school',
      );
      await user.selectOptions(screen.getByLabelText(/^District/i), 'Cuddalore');
      await user.type(screen.getByLabelText(/^PIN code/i), '607106');

      await user.selectOptions(screen.getByLabelText(/Which class \(grade\) is it\?/i), '8');
      await user.selectOptions(screen.getByLabelText(/^Section/i), 'A');
      await user.type(screen.getByLabelText(/How many students were present\?/i), '40');

      await user.type(screen.getByLabelText(/Grade 8 · A Question A score 5/i), '40');
      await user.type(screen.getByLabelText(/Grade 8 · A Question B score 5/i), '40');
      await user.selectOptions(screen.getByLabelText(/Teacher's score/i), 'promoter');

      await user.click(screen.getByRole('button', { name: /Save this class/i }));
      const reviewDialog = await screen.findByRole('dialog', {
        name: /Review before submitting session/i,
      });
      await user.click(within(reviewDialog).getByRole('button', { name: /Confirm & submit/i }));

      const successDialog = await screen.findByRole('dialog', {
        name: /Session saved successfully!/i,
      });
      expect(within(successDialog).getByText('Synced to Google Sheets')).toBeInTheDocument();
      expect(
        within(successDialog).getByRole('link', { name: /Open in Google Sheets/i }),
      ).toHaveAttribute('href', oauthConn.spreadsheetUrl);
      expect(within(successDialog).queryByText(/Local Sandbox/i)).not.toBeInTheDocument();
      expect(persistedSessions).toHaveLength(1);
      unmount();

      // Facilitator with the same /api/sheets environment must NEVER see any "Google Sheets" text
      const facApi = new LocalSandboxApiClient(
        () => SANDBOX_USERS.facilitator.userId,
        createTestConfig(),
        '/api/sheets',
      );
      render(
        <SessionEntryForm
          api={facApi}
          user={SANDBOX_USERS.facilitator}
          config={createTestConfig()}
          editingSession={null}
          isGoogleSheetsLive={true}
          sheetsConnection={oauthConn}
          onCancelEdit={vi.fn()}
          onSavedNavigateToMyClasses={vi.fn()}
          onNotify={vi.fn()}
        />,
      );
      expect(screen.queryByText(/Google Sheets/i)).not.toBeInTheDocument();
    } finally {
      fetchSpy.mockRestore();
      setRuntimeSheetsBackendUrl('');
    }
  });

  it('remembers 5+ signed-in accounts on /login and /auth/google (empty on fresh browser), restores admin /admin/analytics across reloads without Access Denied flash, and preserves submitted data across reload', async () => {
    const user = userEvent.setup();

    // 1. Fresh browser has zero saved login accounts exposed
    const app1 = render(<App />);
    expect(screen.queryByText(/Saved logins on this browser/i)).not.toBeInTheDocument();

    // 2. Super Admin 1 signs in, creates a session, navigates to /admin/analytics
    await user.type(await screen.findByLabelText(/^Email/i), 'brinthajayaprakash888@gmail.com');
    await user.type(screen.getByLabelText(/^Password/i), 'brintha888');
    await user.click(screen.getByRole('button', { name: /^Sign In$/i }));
    await waitFor(() => {
      expect(window.location.pathname).toBe('/admin/overview');
    });

    const primaryNav = screen.getByRole('navigation', { name: 'Primary application views' });
    await user.click(within(primaryNav).getByRole('button', { name: 'Enter a class' }));

    await user.click(screen.getByRole('button', { name: /What time did it start\?/i }));
    await user.type(screen.getByLabelText(/What time did it start\? direct time input/i), '09:00');
    await user.click(
      within(
        screen.getByRole('region', { name: /What time did it start\? clock selector/i }),
      ).getByRole('button', { name: 'Done' }),
    );
    await user.click(screen.getByRole('button', { name: /What time did it end\?/i }));
    await user.type(screen.getByLabelText(/What time did it end\? direct time input/i), '10:00');
    await user.click(
      within(
        screen.getByRole('region', { name: /What time did it end\? clock selector/i }),
      ).getByRole('button', { name: 'Done' }),
    );

    await user.type(screen.getByLabelText(/^School name/i), 'GHSS Reload Persistent School');
    await user.type(screen.getByLabelText(/School code \(UDISE\)/i), '33180100555');
    await user.selectOptions(
      screen.getByLabelText(/What kind of school is it\?/i),
      'Government school',
    );
    await user.selectOptions(screen.getByLabelText(/^District/i), 'Cuddalore');
    await user.type(screen.getByLabelText(/^PIN code/i), '607106');
    await user.selectOptions(screen.getByLabelText(/Which class \(grade\) is it\?/i), '8');
    await user.selectOptions(screen.getByLabelText(/^Section/i), 'A');
    await user.type(screen.getByLabelText(/How many students were present\?/i), '42');
    await user.type(screen.getByLabelText(/Grade 8 · A Question A score 5/i), '42');
    await user.type(screen.getByLabelText(/Grade 8 · A Question B score 5/i), '42');
    await user.selectOptions(screen.getByLabelText(/Teacher's score/i), 'promoter');

    await user.click(screen.getByRole('button', { name: /Save this class/i }));
    const reviewDialog = await screen.findByRole('dialog', {
      name: /Review before submitting session/i,
    });
    await user.click(within(reviewDialog).getByRole('button', { name: /Confirm & submit/i }));
    const successDialog = await screen.findByRole('dialog', {
      name: /Session saved successfully!/i,
    });
    await user.click(within(successDialog).getByRole('button', { name: 'Close dialog' }));

    await user.click(within(primaryNav).getByRole('button', { name: 'Admin Console' }));
    const adminNav = await screen.findByRole('navigation', { name: 'Administrator' });
    await user.click(within(adminNav).getByRole('button', { name: 'Analytics' }));
    await waitFor(() => {
      expect(window.location.pathname).toBe('/admin/analytics');
    });
    expect(
      await screen.findByRole('heading', { name: 'Analytics & Performance' }),
    ).toBeInTheDocument();

    // 3. Simulate full browser reload on protected deep route /admin/analytics
    app1.unmount();
    render(<App />);
    expect(screen.queryByRole('heading', { name: 'Access Denied' })).not.toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Analytics & Performance' }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/admin/analytics');
    const kpiSection = await screen.findByLabelText('Key programme performance indicators');
    await waitFor(() => {
      expect(within(kpiSection).getByText('42')).toBeInTheDocument();
    });

    // 4. Sign in/out across 4 more distinct accounts (5 total remembered — no 4-account truncation)
    for (const [email, pw] of [
      ['karunya@vidhyavidhai.org', 'karunya@VV'],
      ['priya.facilitator@example.org', null],
      ['arun.facilitator@example.org', null],
      ['kavitha.facilitator@example.org', null],
    ] as const) {
      await user.click(screen.getByRole('button', { name: /Sign out/i }));
      const emailField = await screen.findByLabelText(/^Email/i);
      await user.clear(emailField);
      await user.type(emailField, email);
      if (pw) {
        await user.type(screen.getByLabelText(/^Password/i), pw);
      }
      await user.click(screen.getByRole('button', { name: /^Sign In$/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Sign out/i })).toBeInTheDocument();
      });
    }

    await user.click(screen.getByRole('button', { name: /Sign out/i }));
    expect(await screen.findByText(/Saved logins on this browser \(5\)/i)).toBeInTheDocument();
    for (const email of [
      'brinthajayaprakash888@gmail.com',
      'karunya@vidhyavidhai.org',
      'priya.facilitator@example.org',
      'arun.facilitator@example.org',
      'kavitha.facilitator@example.org',
    ]) {
      expect(screen.getByText(email)).toBeInTheDocument();
    }

    // Also verify all 5 appear in /auth/google chooser
    await user.click(screen.getByRole('button', { name: /Continue with Google/i }));
    expect(await screen.findByText(/Choose a recently signed-in account/i)).toBeInTheDocument();
    expect(screen.getByText('brinthajayaprakash888@gmail.com')).toBeInTheDocument();
    expect(screen.getByText('kavitha.facilitator@example.org')).toBeInTheDocument();

    // Selecting saved Super Admin account card prompts for password instead of 1-click entry
    await user.click(screen.getByText('karunya@vidhyavidhai.org').closest('button')!);
    const savedPwInput = await screen.findByLabelText(/^Password/i);
    await user.type(savedPwInput, 'karunya@VV');
    await user.click(savedPwInput.closest('form')!.querySelector('button[type="submit"]')!);
    await waitFor(() => {
      expect(window.location.pathname).toBe('/admin/overview');
      expect(
        within(screen.getByRole('banner')).getByText('karunya@vidhyavidhai.org'),
      ).toBeInTheDocument();
    });
  });

  it('flushes SessionEntryForm draft synchronously on pagehide within <500ms and exposes zero AI, preview, or telemetry jargon in rendered UI', async () => {
    const user = userEvent.setup();
    const cfg = createTestConfig();
    const api = new LocalSandboxApiClient(() => SANDBOX_USERS.super_admin_1.userId, cfg);

    render(
      <SessionEntryForm
        api={api}
        user={SANDBOX_USERS.super_admin_1}
        config={cfg}
        editingSession={null}
        onCancelEdit={vi.fn()}
        onSavedNavigateToMyClasses={vi.fn()}
        onNotify={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText(/^School name/i), 'Instant Pagehide Flush GHSS');
    // Fire pagehide immediately without waiting for the 500ms debounce
    fireEvent(window, new Event('pagehide'));

    const draft = loadFormDraft(SANDBOX_USERS.super_admin_1.email);
    expect(draft?.values.schoolName).toBe('Instant Pagehide Flush GHSS');

    const bodyText = document.body.textContent ?? '';
    expect(bodyText).not.toMatch(
      /\b(Preview Mode|Browser Preview Mode|Manage Preview|Live Telemetry|ID Preview|Idempotent replay queue|Local Sandbox)\b/i,
    );
  });

  it('automatically replays queued offline Sync Outbox submissions when online connectivity returns', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText(/^Email/i), 'brinthajayaprakash888@gmail.com');
    await user.type(screen.getByLabelText(/^Password/i), 'brintha888');
    await user.click(screen.getByRole('button', { name: /^Sign In$/i }));
    await waitFor(() => {
      expect(window.location.pathname).toBe('/admin/overview');
    });

    enqueueSyncOutboxItem('brinthajayaprakash888@gmail.com', {
      clientSubmissionKey: 'auto-replay-key-1',
      operation: 'createSession',
      schoolName: 'GHSS Reconnect Auto Replay',
      udiseCode: '33180100909',
      startDate: '2026-11-10',
      facilitatorEmail: 'brinthajayaprakash888@gmail.com',
      syncStatus: 'PENDING_RETRY',
      attempts: 1,
      lastAttemptAt: '2026-11-10T10:00:00Z',
      lastError: 'Temporary network drop',
      values: createValidFormValues({
        clientSubmissionKey: 'auto-replay-key-1',
        schoolName: 'GHSS Reconnect Auto Replay',
        udiseCode: '33180100909',
      }),
    });
    expect(loadSyncOutbox('brinthajayaprakash888@gmail.com')).toHaveLength(1);

    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() => {
      expect(loadSyncOutbox('brinthajayaprakash888@gmail.com')).toHaveLength(0);
    });
    const adminNav = await screen.findByRole('navigation', { name: 'Administrator' });
    await user.click(within(adminNav).getByRole('button', { name: 'All Submissions' }));
    expect(await screen.findByText('GHSS Reconnect Auto Replay')).toBeInTheDocument();
  });

  it('enforces Super Admin password authentication on /login and /auth/google, keeps inline accessible validation without /access-denied redirects, supports Show/Hide & paste, and updates passwords in User Management', async () => {
    const user = userEvent.setup();
    render(<App />);

    // 1. Typing Super Admin email reveals accessible Password field with Show password toggle and paste support
    const emailInput = await screen.findByLabelText(/^Email/i);
    await user.type(emailInput, 'brinthajayaprakash888@gmail.com');

    const pwInput = screen.getByLabelText(/^Password/i) as HTMLInputElement;
    expect(pwInput).toHaveAttribute('type', 'password');
    expect(pwInput).toHaveAttribute('autocomplete', 'current-password');
    expect(pwInput).toHaveAttribute('required');
    expect(pwInput).toHaveAttribute('aria-invalid', 'false');

    // Empty submit stays on /login or /, sets aria-invalid="true", focuses password input, never navigates to /access-denied
    await user.click(screen.getByRole('button', { name: /^Sign In$/i }));
    expect(['/', '/login']).toContain(window.location.pathname);
    expect(screen.queryByRole('heading', { name: 'Access Denied' })).not.toBeInTheDocument();
    expect(pwInput).toHaveAttribute('aria-invalid', 'true');
    expect(pwInput.getAttribute('aria-describedby')).toContain('workspace-password-error');
    expect(document.getElementById('workspace-password-error')).toHaveTextContent(
      /Enter your Super Administrator password\./i,
    );

    // Typing clears active error immediately without yelling mid-typing; wrong password stays on login route with server error
    await user.type(pwInput, 'wrongpass123');
    expect(pwInput).toHaveAttribute('aria-invalid', 'false');
    await user.click(screen.getByRole('button', { name: /^Sign In$/i }));
    await waitFor(() => {
      expect(document.getElementById('workspace-password-error')).toHaveTextContent(
        /Incorrect password\./i,
      );
    });
    expect(pwInput).toHaveAttribute('aria-invalid', 'true');
    expect(['/', '/login']).toContain(window.location.pathname);

    // Toggle Show password -> Unmask -> Mask
    const toggleBtn = screen.getByRole('button', { name: /Show password/i });
    expect(toggleBtn).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggleBtn);
    expect(pwInput).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: /Hide password/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: /Hide password/i }));
    expect(pwInput).toHaveAttribute('type', 'password');

    // 2. Also verify /auth/google rejects wrong password for Super Admin without redirecting away
    await user.click(screen.getByRole('button', { name: /Continue with Google/i }));
    const gEmail = await screen.findByLabelText(/Google account email/i);
    await user.clear(gEmail);
    await user.type(gEmail, 'karunya@vidhyavidhai.org');
    const gPw = screen.getByLabelText(/^Password/i);
    await user.type(gPw, 'wrong-karunya');
    await user.click(screen.getByRole('button', { name: /Verify & Sign In/i }));
    await waitFor(() => {
      expect(document.getElementById('google-pw-error')).toHaveTextContent(/Incorrect password\./i);
    });
    expect(window.location.pathname).toBe('/auth/google');

    // 3. Allow password pasting & sign in cleanly as Brintha on /login -> change password in User Management
    await user.click(screen.getByRole('button', { name: /Back to sign-in/i }));
    const backEmail = await screen.findByLabelText(/^Email/i);
    await user.clear(backEmail);
    await user.type(backEmail, 'brinthajayaprakash888@gmail.com');
    const backPw = screen.getByLabelText(/^Password/i);
    await user.click(backPw);
    await user.paste('brintha888');
    await user.click(screen.getByRole('button', { name: /^Sign In$/i }));

    await waitFor(() => {
      expect(window.location.pathname).toBe('/admin/overview');
    });

    const adminNav = await screen.findByRole('navigation', { name: 'Administrator' });
    await user.click(within(adminNav).getByRole('button', { name: 'User Management' }));
    expect(
      await screen.findByRole('heading', { name: /Change Super Administrator Password/i }),
    ).toBeInTheDocument();

    const curPwField = screen.getByLabelText(/^Current password/i);
    const newPwField = screen.getByLabelText(/^New password/i);
    await user.type(curPwField, 'wrong-current');
    await user.type(newPwField, 'BrinthaRotated#26');
    await user.click(screen.getByRole('button', { name: /Update password/i }));
    await waitFor(() => {
      expect(document.getElementById('sa-current-pw-error')).toHaveTextContent(
        /Current password is incorrect\./i,
      );
    });
    expect(curPwField).toHaveAttribute('aria-invalid', 'true');

    await user.clear(curPwField);
    await user.type(curPwField, 'brintha888');
    await user.clear(newPwField);
    await user.type(newPwField, 'BrinthaRotated#26');
    await user.click(screen.getByRole('button', { name: /Update password/i }));
    await waitFor(() => {
      const banners = screen.getAllByRole('status');
      expect(
        banners.some((el) =>
          /Password updated securely\. Use your new password/i.test(el.textContent || ''),
        ),
      ).toBe(true);
    });

    // 4. Sign out -> saved Super Admin card opens inline prompt (not 1-click); old password fails, rotated password works!
    await user.click(screen.getByRole('button', { name: /Sign out/i }));
    const rememberedRegion = await screen.findByRole('region', {
      name: /Remembered workspace logins/i,
    });
    const savedBrinthaBtn = within(rememberedRegion)
      .getByText('brinthajayaprakash888@gmail.com')
      .closest('button')!;
    await user.click(savedBrinthaBtn);
    const savedPwPrompt = await screen.findByLabelText(/^Password/i);
    expect(savedPwPrompt).toHaveAttribute('id', 'saved-admin-password');
    await user.type(savedPwPrompt, 'brintha888');
    await user.click(savedPwPrompt.closest('form')!.querySelector('button[type="submit"]')!);
    await waitFor(() => {
      expect(document.getElementById('saved-admin-pw-error')).toHaveTextContent(
        /Incorrect password\./i,
      );
    });
    expect(window.location.pathname).toBe('/login');

    await user.clear(savedPwPrompt);
    await user.type(savedPwPrompt, 'BrinthaRotated#26');
    await user.click(savedPwPrompt.closest('form')!.querySelector('button[type="submit"]')!);
    await waitFor(() => {
      expect(window.location.pathname).toBe('/admin/overview');
    });

    // Zero plaintext passwords persisted in Web Storage
    const storageDump = JSON.stringify({ ls: { ...localStorage }, ss: { ...sessionStorage } });
    expect(storageDump).not.toContain('brintha888');
    expect(storageDump).not.toContain('BrinthaRotated#26');
    expect(storageDump).not.toContain('karunya@VV');
  }, 20000);
});

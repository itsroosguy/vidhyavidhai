import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { AdminDashboardPage } from '../../admin/AdminDashboardPage';
import { MyClassesPage } from '../../dashboard/MyClassesPage';
import { LocalSandboxApiClient } from '../../services/apiClient';
import { SANDBOX_USERS } from '../../services/authService';
import { loadFormDraft } from '../../services/draftStorage';
import { loadSyncOutbox } from '../../services/syncService';
import { createTestConfig, createValidFormValues } from '../../testFixtures';
import { ADMIN_NAV_ITEMS } from '../../utils/routes';
import { SessionEntryForm } from '../SessionEntryForm';

describe('UI Component Workflows — Strict RBAC, Route Guard, 7-Section Form & 12-Section Admin Console', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('renders all 7 numbered sections, enforces district-dependent block clearing, and opens ValidationErrorModal on invalid save', async () => {
    const user = userEvent.setup();
    const unconfiguredCfg = createTestConfig({ districtBlocks: [] });
    const api = new LocalSandboxApiClient(() => SANDBOX_USERS.facilitator.userId, unconfiguredCfg);

    render(
      <SessionEntryForm
        api={api}
        user={SANDBOX_USERS.facilitator}
        config={unconfiguredCfg}
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
    expect(
      screen.getAllByText('Block list not configured. Please contact the administrator.').length,
    ).toBeGreaterThanOrEqual(1);

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
    await user.selectOptions(screen.getByLabelText(/^Block/i), 'Panruti');
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
    expect(within(successDialog).getByText(/Saved in Local Sandbox/i)).toBeInTheDocument();
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
    await user.selectOptions(screen.getByLabelText(/^Block/i), 'Panruti');
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
    await user.selectOptions(screen.getByLabelText(/^Block/i), 'Panruti');
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
        block: 'Kilvelur',
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
    // Facilitators NEVER see export buttons or total submission count summaries
    expect(screen.queryByRole('button', { name: /Export My Sessions/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/\(1 session\)/i)).not.toBeInTheDocument();
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
    expect(await screen.findByText('brinthajayaprakash888@gmail.com')).toBeInTheDocument();
    expect(screen.getByText('karunya@vidhyavidhai.org')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Super Administrator/i })).not.toBeInTheDocument();

    // Navigate through Performance Reports -> test ExportReportModal
    await user.click(within(adminNav).getByRole('button', { name: 'Performance Reports' }));
    await user.click(screen.getByRole('button', { name: /Export Official Workbook \(\.xlsx\)/i }));
    const exportDialog = await screen.findByRole('dialog', {
      name: /Export Programme Report \(\.xlsx\)/i,
    });
    expect(within(exportDialog).getByText('1 export rows')).toBeInTheDocument();
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
    expect(await screen.findByText(/District–Block Master Data/i)).toBeInTheDocument();
  });

  it('keeps login clean without exposing account lists, routes only the 2 allowlisted admins to /admin/overview, isolates other accounts to /classroom-entry, and guards manual admin URLs', async () => {
    const user = userEvent.setup();
    render(<App />);

    // 1. Login screen renders clean 2026 sign-in card with Vidhya Vidhai Foundation in front of Career Tours and zero preset role/name leaks
    expect(screen.getByRole('heading', { name: 'Sign in with email' })).toBeInTheDocument();
    const authSpans = Array.from(document.querySelectorAll('main span')).map((n) => n.textContent ?? '').join(' ');
    expect(authSpans.indexOf('Vidhya Vidhai Foundation')).toBeGreaterThan(-1);
    expect(authSpans.indexOf('Vidhya Vidhai Foundation')).toBeLessThan(authSpans.indexOf('Career Tours'));
    expect(screen.queryByText(/Super Admin 1/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Facilitator 1/i)).not.toBeInTheDocument();
    expect(screen.queryByText('brinthajayaprakash888@gmail.com')).not.toBeInTheDocument();
    expect(screen.queryByText('karunya@vidhyavidhai.org')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Preview account switcher')).not.toBeInTheDocument();

    // 2. Denied user blocked with Access Denied screen
    await user.type(screen.getByLabelText(/^Email$/i), 'denied.user@example.org');
    await user.type(screen.getByLabelText(/^Password$/i), 'workspace-session-token');
    await user.click(screen.getByRole('button', { name: /Get Started/i }));
    expect(await screen.findByRole('heading', { name: 'Access Denied' })).toBeInTheDocument();
    expect(screen.getByText('denied.user@example.org')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Try a different Google account/i }));

    // 3. Super Admin 1 login automatically redirects to /admin/overview with reports & Sync Status
    await user.clear(screen.getByLabelText(/^Email$/i));
    await user.type(screen.getByLabelText(/^Email$/i), 'brinthajayaprakash888@gmail.com');
    await user.type(screen.getByLabelText(/^Password$/i), 'workspace-session-token');
    await user.click(screen.getByRole('button', { name: /Get Started/i }));
    expect(window.location.pathname).toBe('/admin/overview');
    expect(screen.getAllByText(/Vidhya Vidhai Foundation\s*·\s*Career Tours/i).length).toBeGreaterThanOrEqual(1);
    const headerBrandNodes = screen.getByRole('banner').querySelectorAll('span, p');
    const headerText = Array.from(headerBrandNodes).map((n) => n.textContent ?? '').join(' ');
    expect(headerText.indexOf('Vidhya Vidhai Foundation')).toBeGreaterThan(-1);
    expect(headerText.indexOf('Vidhya Vidhai Foundation')).toBeLessThan(headerText.indexOf('Career Tours'));

    const primaryNav = await screen.findByRole('navigation', { name: 'Primary application views' });
    expect(within(primaryNav).getByRole('button', { name: 'Enter a class' })).toBeInTheDocument();
    expect(within(primaryNav).getByRole('button', { name: 'My classes' })).toBeInTheDocument();
    expect(within(primaryNav).getByRole('button', { name: 'Admin Console' })).toBeInTheDocument();

    // Open Modal #8 Sync Status honestly displaying Local Sandbox
    await user.click(screen.getByRole('button', { name: /Local sandbox mode/i }));
    const syncDialog = await screen.findByRole('dialog', {
      name: /Google Sheets Sync Status/i,
    });
    expect(
      within(syncDialog).getByText(/Running in Local Sandbox Mode \(Not Connected to Live Google Sheets\)/i),
    ).toBeInTheDocument();
    await user.click(within(syncDialog).getByRole('button', { name: /^Close$/ }));

    // Sign out -> test Super Admin 2
    await user.click(screen.getByRole('button', { name: /Sign out/i }));
    await user.type(await screen.findByLabelText(/^Email$/i), 'karunya@vidhyavidhai.org');
    await user.click(screen.getByRole('button', { name: /Continue with Google/i }));
    await waitFor(() => {
      expect(window.location.pathname).toBe('/admin/overview');
    });
    expect(
      within(await screen.findByRole('navigation', { name: 'Primary application views' })).getByRole(
        'button',
        { name: 'Admin Console' },
      ),
    ).toBeInTheDocument();

    // Sign out -> any other Google email lands strictly in /classroom-entry with ZERO admin/Sheets UI
    await user.click(screen.getByRole('button', { name: /Sign out/i }));
    await user.type(await screen.findByLabelText(/^Email$/i), 'teacher.anitha@vidhyavidhai.org');
    await user.click(screen.getByRole('button', { name: /Continue with Google/i }));

    await waitFor(() => {
      expect(window.location.pathname).toBe('/classroom-entry');
      const facNav = screen.getByRole('navigation', { name: 'Primary application views' });
      expect(within(facNav).queryByRole('button', { name: 'Admin Console' })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /Local sandbox mode/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Preview account switcher')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'About you' })).toBeInTheDocument();

    // 4. Facilitator manually visits restricted /admin/overview URL -> Access Denied screen + auto-redirect to /classroom-entry
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
});

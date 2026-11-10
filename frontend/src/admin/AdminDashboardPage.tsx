import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  Edit3,
  Eye,
  FileSpreadsheet,
  FilterX,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { formatPct1, formatScore2 } from '../calculations/metrics';
import {
  DistrictComparisonBars,
  MonthlyTrendsChart,
  SentimentStackedChart,
} from '../components/charts/AnalyticsCharts';
import {
  DetailedAnalyticsModal,
  type DetailedAnalyticsTarget,
} from '../components/modals/DetailedAnalyticsModal';
import { ExportReportModal } from '../components/modals/ExportReportModal';
import { GoogleSheetsConnectModal } from '../components/modals/GoogleSheetsConnectModal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { INITIAL_SUPER_ADMINS, isAllowlistedSuperAdmin } from '../config/accessControl';
import { SessionDetailModal } from '../dashboard/SessionDetailModal';
import type { BackendApiClient } from '../services/apiClient';
import {
  generateInitializedDatabaseWorkbookBuffer,
  triggerXlsxDownload,
} from '../services/exportService';
import type {
  AppConfiguration,
  DashboardAnalytics,
  GoogleSheetsConnectionState,
  PaginatedResult,
  SchoolRecord,
  SessionQueryFilters,
  SessionRecord,
  SubmissionStatus,
  SyncOutboxItem,
  UserProfile,
} from '../types/domain';
import { ADMIN_NAV_ITEMS, type AdminSectionSlug } from '../utils/routes';
import { formatISODateToDDMMYYYY } from '../utils/temporal';
import { getBlocksForDistrict } from '../validations/sessionValidation';
import { AdminNav } from './AdminNav';
import { AuditLogViewer } from './AuditLogViewer';
import { GoogleSheetsBanner } from './GoogleSheetsBanner';
import { GoogleSheetsSyncPanel } from './GoogleSheetsSyncPanel';
import { MasterDataSettings } from './MasterDataSettings';
import { UserAccessManager } from './UserAccessManager';

interface AdminDashboardPageProps {
  api: BackendApiClient;
  user: UserProfile;
  config: AppConfiguration;
  activeSection?: AdminSectionSlug;
  onSelectSection?: (section: AdminSectionSlug) => void;
  onConfigUpdated?: (next: AppConfiguration) => void;
  isLiveBackend?: boolean;
  dataVersion?: number;
  outboxItems?: SyncOutboxItem[];
  onRetryOutboxItem?: (item: SyncOutboxItem) => Promise<void>;
  onRetryAllOutbox?: () => Promise<void>;
  onOutboxChanged?: () => void;
  onEditSession: (session: SessionRecord) => void;
  onNavigateSettings?: () => void;
  onOpenNewModal?: () => void;
  onOpenEditModal?: (session: SessionRecord) => void;
  onOpenSyncStatus?: () => void;
  onNotify: (type: 'success' | 'error' | 'warning', title: string, detail?: string) => void;
}

type SchoolSortColumn =
  | 'schoolName'
  | 'district'
  | 'sessions'
  | 'studentsReached'
  | 'averageCsat'
  | 'averageItp'
  | 'missingResponsesQa';

type SortDirection = 'ascending' | 'descending';

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const FILTER_BAR_SECTIONS = new Set<AdminSectionSlug>([
  'overview',
  'analytics',
  'all-submissions',
  'schools',
  'facilitators',
  'student-feedback',
  'teacher-feedback',
  'performance-reports',
  'data-quality',
]);

export const AdminDashboardPage: React.FC<AdminDashboardPageProps> = ({
  api,
  user,
  config,
  activeSection: controlledSection,
  onSelectSection,
  onConfigUpdated,
  isLiveBackend = false,
  dataVersion = 0,
  outboxItems = [],
  onRetryOutboxItem,
  onRetryAllOutbox,
  onOutboxChanged,
  onEditSession,
  onNavigateSettings,
  onOpenNewModal,
  onOpenEditModal,
  onOpenSyncStatus,
  onNotify,
}) => {
  const isSuperAdmin = user.role === 'super_admin';
  const [fallbackSection, setFallbackSection] = useState<AdminSectionSlug>('overview');
  const currentSection: AdminSectionSlug = controlledSection ?? fallbackSection;

  const handleSelectSection = useCallback(
    (next: AdminSectionSlug) => {
      if (onSelectSection) {
        onSelectSection(next);
      } else {
        setFallbackSection(next);
      }
      if (next === 'settings' && onNavigateSettings && !onSelectSection) {
        onNavigateSettings();
      }
    },
    [onNavigateSettings, onSelectSection],
  );

  const [filters, setFilters] = useState<SessionQueryFilters>({
    search: '',
    district: '',
    block: '',
    school: '',
    facilitatorEmail: '',
    tourId: '',
    language: '',
    grade: '',
    dateFrom: '',
    dateTo: '',
    status: '',
    includeArchived: false,
    page: 1,
    pageSize: 15,
  });

  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [sessionsPage, setSessionsPage] = useState<PaginatedResult<SessionRecord>>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 15,
    totalPages: 1,
  });
  const [pendingUsersCount, setPendingUsersCount] = useState(0);
  const [schoolDirectoryQuery, setSchoolDirectoryQuery] = useState('');
  const [schoolDirectory, setSchoolDirectory] = useState<SchoolRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [preparingExport, setPreparingExport] = useState(false);
  const [exportModalSessions, setExportModalSessions] = useState<SessionRecord[] | null>(null);
  const [drillDownTarget, setDrillDownTarget] = useState<DetailedAnalyticsTarget | null>(null);
  const [expandedFacilitator, setExpandedFacilitator] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<SessionRecord | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<SessionRecord | null>(null);
  const [sheetsConnection, setSheetsConnection] = useState<GoogleSheetsConnectionState | null>(null);
  const [sheetsConnLoading, setSheetsConnLoading] = useState(false);
  const [sheetsModalOpen, setSheetsModalOpen] = useState(false);
  const [sheetsOauthFeedback, setSheetsOauthFeedback] = useState<{
    type: 'authorized' | 'error';
    message: string;
  } | null>(null);

  const [schoolSort, setSchoolSort] = useState<{
    col: SchoolSortColumn;
    dir: SortDirection;
  }>({ col: 'studentsReached', dir: 'descending' });
  const [schoolSortStatus, setSchoolSortStatus] = useState('');
  const [showAllSchools, setShowAllSchools] = useState(false);

  const schoolCaptionId = useId();
  const schoolDirCaptionId = useId();
  const recordsCaptionId = useId();
  const teacherCaptionId = useId();
  const dqCaptionId = useId();

  const districtBlocks = getBlocksForDistrict(filters.district ?? '', config);
  const activeNavMeta =
    ADMIN_NAV_ITEMS.find((i) => i.slug === currentSection) ?? ADMIN_NAV_ITEMS[0]!;

  const loadAdminData = useCallback(async () => {
    if (!isSuperAdmin) return;
    setLoading(true);
    try {
      const [summaryRes, listRes, usersRes] = await Promise.all([
        api.getDashboardSummary(filters),
        api.getAdminSessions(filters),
        api.listManagedUsers(),
      ]);
      if (summaryRes.ok && summaryRes.data) {
        setAnalytics(summaryRes.data);
      } else {
        onNotify('error', 'Failed to load analytics', summaryRes.error);
      }
      if (listRes.ok && listRes.data) {
        setSessionsPage(listRes.data);
      }
      if (usersRes.ok && usersRes.data) {
        const pending = usersRes.data.filter(
          (u) => !isAllowlistedSuperAdmin(u.email) && u.status === 'PENDING',
        ).length;
        setPendingUsersCount(pending);
      }
    } finally {
      setLoading(false);
    }
  }, [api, filters, isSuperAdmin, onNotify]);

  const loadSheetsConnection = useCallback(async () => {
    if (!isSuperAdmin) return;
    setSheetsConnLoading(true);
    try {
      const res = await api.getSheetsConnection();
      if (res.ok && res.data) {
        setSheetsConnection(res.data);
      }
    } finally {
      setSheetsConnLoading(false);
    }
  }, [api, isSuperAdmin]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    void loadAdminData();
    void loadSheetsConnection();
  }, [isSuperAdmin, loadAdminData, loadSheetsConnection, dataVersion]);

  useEffect(() => {
    if (!isSuperAdmin || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const oauthStatus = url.searchParams.get('sheets_oauth');
    if (!oauthStatus) return;

    const reason = url.searchParams.get('reason') || '';
    url.searchParams.delete('sheets_oauth');
    url.searchParams.delete('reason');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);

    if (oauthStatus === 'authorized') {
      setSheetsOauthFeedback({
        type: 'authorized',
        message: 'Google account authorized via OAuth 2.0. Choose or create your Google Sheet below.',
      });
      setSheetsModalOpen(true);
    } else if (oauthStatus === 'error') {
      const msg =
        reason === 'unauthorized_admin'
          ? 'Only approved Vidhya Vidhai Super Administrators may authorize Google Sheets access.'
          : `Google OAuth authorization could not be completed (${reason || 'cancelled'}).`;
      setSheetsOauthFeedback({ type: 'error', message: msg });
      setSheetsModalOpen(true);
      onNotify('error', 'Google Sheets OAuth failed', msg);
    }
  }, [isSuperAdmin, onNotify]);

  const handleBannerConnectClick = () => {
    const startUrl = api.getSheetsOAuthStartUrl?.(user.email) ?? null;
    if (
      startUrl &&
      sheetsConnection?.oauthConfigured &&
      !sheetsConnection?.connectedAccount
    ) {
      window.location.assign(startUrl);
      return;
    }
    setSheetsModalOpen(true);
  };

  const handleDownloadInitializedWorkbook = useCallback(async () => {
    const collectedSessions: SessionRecord[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const res = await api.getAdminSessions({ includeArchived: true, page, pageSize: 100 });
      if (!res.ok || !res.data) {
        onNotify('error', 'Failed to collect sessions for workbook export', res.error);
        return;
      }
      collectedSessions.push(...res.data.items);
      totalPages = res.data.totalPages || 1;
      page++;
    } while (page <= totalPages);

    const [usersRes, schoolsRes] = await Promise.all([
      api.listManagedUsers(),
      api.searchSchools(''),
    ]);

    const { buffer, tabsCount, rowCount } = await generateInitializedDatabaseWorkbookBuffer({
      sessions: collectedSessions,
      config,
      users: usersRes.ok && usersRes.data ? usersRes.data : [],
      schools: schoolsRes.ok && schoolsRes.data ? schoolsRes.data : [],
    });

    triggerXlsxDownload(buffer, 'Vidhya_Vidhai_Career_Tours_Google_Sheet.xlsx');
    onNotify(
      'success',
      'Initialized Google Sheet workbook downloaded',
      `${tabsCount} official database tabs ready (${rowCount} session record${rowCount === 1 ? '' : 's'}). Use File → Import in Google Sheets.`,
    );
  }, [api, config, onNotify]);

  useEffect(() => {
    if (!isSuperAdmin || currentSection !== 'schools') return;
    let active = true;
    void api.searchSchools(schoolDirectoryQuery).then((res) => {
      if (active && res.ok && res.data) {
        setSchoolDirectory(res.data);
      }
    });
    return () => {
      active = false;
    };
  }, [api, currentSection, isSuperAdmin, schoolDirectoryQuery, dataVersion]);

  const handleDistrictFilterChange = (district: string) => {
    setFilters((prev) => ({
      ...prev,
      district,
      block: '',
      page: 1,
    }));
  };

  const handleClearFilters = () => {
    setFilters({
      search: '',
      district: '',
      block: '',
      school: '',
      facilitatorEmail: '',
      tourId: '',
      language: '',
      grade: '',
      dateFrom: '',
      dateTo: '',
      status: '',
      includeArchived: false,
      page: 1,
      pageSize: 15,
    });
  };

  const handlePrepareExportModal = async () => {
    setPreparingExport(true);
    try {
      const collected: SessionRecord[] = [];
      let page = 1;
      let totalPages = 1;
      do {
        const exportRes = await api.getAdminSessions({ ...filters, page, pageSize: 100 });
        if (!exportRes.ok || !exportRes.data) {
          onNotify('error', 'Export preparation failed', exportRes.error);
          return;
        }
        collected.push(...exportRes.data.items);
        totalPages = exportRes.data.totalPages;
        page++;
      } while (page <= totalPages);

      if (collected.length === 0) {
        onNotify('warning', 'No records match current filters');
        return;
      }

      setExportModalSessions(collected);
    } finally {
      setPreparingExport(false);
    }
  };

  const handleArchiveConfirm = async () => {
    if (!archiveTarget) return;
    const target = archiveTarget;
    setArchiveTarget(null);
    const res = await api.archiveSession(target.sessionRecordId);
    if (res.ok) {
      onNotify('success', 'Session archived', `${target.sessionId} archived with audit record.`);
      void loadAdminData();
    } else {
      onNotify('error', 'Archive failed', res.error);
    }
  };

  const handleEditAction = (session: SessionRecord) => {
    if (onOpenEditModal) {
      onOpenEditModal(session);
    } else {
      onEditSession(session);
    }
  };

  const handleSchoolSort = (col: SchoolSortColumn, colLabel: string) => {
    const nextDir: SortDirection =
      schoolSort.col === col
        ? schoolSort.dir === 'ascending'
          ? 'descending'
          : 'ascending'
        : col === 'schoolName' || col === 'district'
          ? 'ascending'
          : 'descending';
    setSchoolSort({ col, dir: nextDir });
    const count = analytics?.schoolBreakdown.length ?? 0;
    setSchoolSortStatus(`Sorted by ${colLabel}, ${nextDir}, ${count} schools`);
  };

  const sortedSchools = useMemo(() => {
    if (!analytics?.schoolBreakdown) return [];
    const list = [...analytics.schoolBreakdown];
    const factor = schoolSort.dir === 'ascending' ? 1 : -1;
    list.sort((a, b) => {
      switch (schoolSort.col) {
        case 'schoolName':
          return factor * COLLATOR.compare(a.schoolName, b.schoolName);
        case 'district':
          return factor * COLLATOR.compare(a.district, b.district);
        case 'sessions':
          return factor * (a.sessions - b.sessions);
        case 'studentsReached':
          return factor * (a.studentsReached - b.studentsReached);
        case 'averageCsat': {
          const av = a.averageCsat ?? -1;
          const bv = b.averageCsat ?? -1;
          return factor * (av - bv);
        }
        case 'averageItp': {
          const av = a.averageItp ?? -1;
          const bv = b.averageItp ?? -1;
          return factor * (av - bv);
        }
        case 'missingResponsesQa':
          return factor * (a.missingResponsesQa - b.missingResponsesQa);
      }
    });
    return list;
  }, [analytics?.schoolBreakdown, schoolSort]);

  const visibleSchools = showAllSchools ? sortedSchools : sortedSchools.slice(0, 15);

  const renderSortIcon = (col: SchoolSortColumn) => {
    if (schoolSort.col !== col) {
      return <ArrowUpDown className="w-3.5 h-3.5 opacity-45 shrink-0" aria-hidden="true" />;
    }
    return schoolSort.dir === 'ascending' ? (
      <ArrowUp className="w-3.5 h-3.5 text-[#006BB8] shrink-0" aria-hidden="true" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-[#006BB8] shrink-0" aria-hidden="true" />
    );
  };

  const renderReconciliationBanner = () => {
    if (!analytics) return null;
    if (analytics.reconciliation.verified) {
      return (
        <div className="px-4 py-2.5 rounded-xl bg-[#ECFDF5] border border-[#047857]/35 flex flex-wrap items-center justify-between gap-2 text-xs text-[#047857] ct-num">
          <span className="inline-flex items-center gap-2 font-medium">
            <CheckCircle2 className="w-4 h-4 text-[#047857]" aria-hidden="true" />
            Verified · {analytics.reconciliation.checksRun} independent reconciliation checks passed
          </span>
          <span className="text-[#243647]">
            Single-counted students · Pooled denominators ·{' '}
            {new Date(analytics.reconciliation.checkedAt).toLocaleTimeString()}
          </span>
        </div>
      );
    }
    return (
      <div
        role="alert"
        className="p-4 rounded-xl bg-[#FFF1F2] border border-[#BE123C]/40 text-xs text-[#0A1B2C] space-y-1.5"
      >
        <div className="font-medium flex items-center gap-2 text-[#BE123C]">
          <AlertTriangle className="w-4 h-4 text-[#BE123C]" aria-hidden="true" />
          Analytics Reconciliation Discrepancy Detected
        </div>
        <ul className="list-disc pl-5 space-y-0.5 text-[#BE123C]">
          {analytics.reconciliation.discrepancies.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      </div>
    );
  };

  const renderKpiStrip = () => {
    if (!analytics) return null;
    return (
      <section
        aria-label="Key programme indicators"
        className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3 ct-num"
      >
        <div className="ct-card p-3.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-[#33475B]">
            Total Sessions
          </div>
          <div className="text-2xl font-semibold text-[#0A1B2C] mt-1">
            {analytics.totalSessions}
          </div>
        </div>

        <div className="ct-card p-3.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-[#33475B]">
            Students Reached
          </div>
          <div className="text-2xl font-semibold text-[#0A1B2C] mt-1">
            {analytics.totalStudentsReached}
          </div>
        </div>

        <div className="ct-card p-3.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-[#33475B]">
            Schools Covered
          </div>
          <div className="text-2xl font-semibold text-[#0A1B2C] mt-1">
            {analytics.totalSchoolsCovered}
          </div>
        </div>

        <div className="ct-card p-3.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-[#33475B]">
            Active Facilitators
          </div>
          <div className="text-2xl font-semibold text-[#0A1B2C] mt-1">
            {analytics.totalFacilitatorsActive}
          </div>
        </div>

        <div className="rounded-xl p-3.5 bg-[#E8F6FF] border border-[#0284C7]/50 shadow-sm">
          <div className="text-[11px] font-medium uppercase tracking-wide text-[#006BB8]">
            Pooled CSAT
          </div>
          <div className="text-2xl font-semibold text-[#0A1B2C] mt-1">
            {formatScore2(analytics.averageCsat)}
          </div>
          <div className="text-[11px] text-[#243647] mt-0.5">
            {analytics.totalQuestionAResponses} responses
          </div>
        </div>

        <div className="ct-card p-3.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-[#33475B]">
            Pooled ITP
          </div>
          <div className="text-2xl font-semibold text-[#0A1B2C] mt-1">
            {formatScore2(analytics.averageItp)}
          </div>
          <div className="text-[11px] text-[#33475B] mt-0.5">
            {analytics.totalQuestionBResponses} responses
          </div>
        </div>

        <div className="ct-card p-3.5">
          <div className="text-[11px] font-medium uppercase tracking-wide text-[#33475B]">
            Teacher NPS
          </div>
          <div className="text-2xl font-semibold text-[#0A1B2C] mt-1">
            {analytics.teacherNpsAverage !== null
              ? analytics.teacherNpsAverage > 0
                ? `+${analytics.teacherNpsAverage}`
                : String(analytics.teacherNpsAverage)
              : '—'}
          </div>
        </div>
      </section>
    );
  };

  const renderEmptyAnalytics = () => (
    <section className="ct-card p-8 text-center">
      <p className="text-base font-medium text-[#0A1B2C]">No submitted sessions match yet</p>
      <p className="text-xs sm:text-sm text-[#243647] mt-1">
        Metrics, trends, and breakdowns appear automatically once committed sessions exist for the
        active filters.
      </p>
    </section>
  );

  const renderSectionBody = () => {
    switch (currentSection) {
      case 'overview':
        return (
          <div className="flex flex-col gap-5">
            {renderReconciliationBanner()}
            {renderKpiStrip()}

            {analytics && analytics.totalSessions > 0 ? (
              <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="ct-card p-5">
                  <h3 className="text-sm sm:text-base font-medium text-[#0A1B2C] mb-3">
                    Sessions &amp; Students by Approved District
                  </h3>
                  <DistrictComparisonBars
                    districtBreakdown={analytics.districtBreakdown}
                    onDrillDown={(target) => setDrillDownTarget(target)}
                  />
                </div>
                <div className="ct-card p-5">
                  <h3 className="text-sm sm:text-base font-medium text-[#0A1B2C] mb-3">
                    Student Sentiment &amp; Teacher NPS Breakdown
                  </h3>
                  <SentimentStackedChart
                    qaSentiment={analytics.qaSentiment}
                    qbSentiment={analytics.qbSentiment}
                    npsDistribution={analytics.npsDistribution}
                  />
                </div>
              </section>
            ) : (
              renderEmptyAnalytics()
            )}

            {/* Quick Section Index */}
            <section className="ct-card p-5">
              <h3 className="text-sm sm:text-base font-medium text-[#0A1B2C] mb-3">
                Administrator Sections Directory
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {ADMIN_NAV_ITEMS.filter((i) => i.slug !== 'overview').map((item) => (
                  <button
                    key={item.slug}
                    type="button"
                    onClick={() => handleSelectSection(item.slug)}
                    className="p-3.5 rounded-xl bg-[#F5F2E9] hover:bg-[#EFE8D6] border border-[#DFD7C2] text-left flex items-start justify-between gap-2 transition-colors cursor-pointer"
                  >
                    <div>
                      <div className="text-sm font-medium text-[#0A1B2C]">{item.label}</div>
                      <p className="text-xs text-[#243647] mt-0.5 leading-relaxed">
                        {item.description}
                      </p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-[#006BB8] shrink-0 mt-0.5" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </section>
          </div>
        );

      case 'analytics':
        return (
          <div className="flex flex-col gap-5">
            {renderReconciliationBanner()}
            {renderKpiStrip()}
            {analytics && analytics.totalSessions > 0 ? (
              <>
                <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <div className="ct-card p-5">
                    <h3 className="text-sm sm:text-base font-medium text-[#0A1B2C] mb-3">
                      District Comparison
                    </h3>
                    <DistrictComparisonBars
                      districtBreakdown={analytics.districtBreakdown}
                      onDrillDown={(target) => setDrillDownTarget(target)}
                    />
                  </div>
                  <div className="ct-card p-5">
                    <MonthlyTrendsChart
                      monthlyBreakdown={analytics.monthlyBreakdown}
                      onDrillDown={(target) => setDrillDownTarget(target)}
                    />
                  </div>
                </section>

                <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                  <div className="ct-card p-5">
                    <h3 className="text-sm sm:text-base font-medium text-[#0A1B2C] mb-3">
                      Sessions by Career Tour
                    </h3>
                    <div className="space-y-2.5 text-xs ct-num">
                      {analytics.tourBreakdown.map((t) => (
                        <div
                          key={t.tourId}
                          className="p-3 rounded-lg bg-[#F5F2E9] border border-[#DFD7C2] flex flex-wrap justify-between items-center gap-2"
                        >
                          <div>
                            <div className="font-medium text-[#0A1B2C]">{t.tourName}</div>
                            <div className="text-[#243647] mt-0.5">
                              CSAT{' '}
                              <strong className="font-medium text-[#006BB8]">
                                {formatScore2(t.averageCsat)}
                              </strong>{' '}
                              · ITP {formatScore2(t.averageItp)} · Pos{' '}
                              {formatPct1(t.positiveCsatPct)}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setDrillDownTarget({
                                category: 'Tour',
                                title: `${t.tourName} Analytics`,
                                subtitle: `${t.sessions} committed sessions · ${t.studentsReached} students`,
                                filtersPatch: { tourId: t.tourId },
                              })
                            }
                            aria-label={`Inspect ${t.tourName} breakdown`}
                            className="px-2.5 py-1 rounded bg-[#FFFFFF] hover:bg-[#E8F6FF] border border-[#8E8674] hover:border-[#0284C7] text-[11px] font-medium text-[#0A1B2C] cursor-pointer transition-colors"
                          >
                            Inspect
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="ct-card p-5">
                    <h3 className="text-sm sm:text-base font-medium text-[#0A1B2C] mb-3">
                      Grade-wise Reach &amp; Scores
                    </h3>
                    <div className="space-y-2 text-xs ct-num">
                      {analytics.gradeBreakdown.map((g) => (
                        <div
                          key={g.grade}
                          className="p-3 rounded-lg bg-[#F5F2E9] border border-[#DFD7C2] flex flex-wrap justify-between items-center gap-2"
                        >
                          <span className="font-medium text-[#0A1B2C]">Grade {g.grade}</span>
                          <div className="flex items-center gap-2 text-[#243647]">
                            <span>
                              {g.studentsReached} std · CSAT{' '}
                              <strong className="font-medium text-[#006BB8]">
                                {formatScore2(g.averageCsat)}
                              </strong>
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setDrillDownTarget({
                                  category: 'Grade',
                                  title: `Grade ${g.grade} Analytics`,
                                  subtitle: `${g.classesCount} class rows · ${g.studentsReached} students`,
                                  filtersPatch: { grade: g.grade },
                                })
                              }
                              aria-label={`Inspect Grade ${g.grade} breakdown`}
                              className="px-2 py-0.5 rounded bg-[#FFFFFF] hover:bg-[#E8F6FF] border border-[#8E8674] hover:border-[#0284C7] text-[11px] font-medium text-[#0A1B2C] cursor-pointer transition-colors"
                            >
                              Inspect
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="ct-card p-5">
                    <h3 className="text-sm sm:text-base font-medium text-[#0A1B2C] mb-3">
                      By Delivery Language
                    </h3>
                    <div className="space-y-2 text-xs ct-num">
                      {analytics.languageBreakdown.map((lang) => (
                        <div
                          key={lang.language}
                          className="p-3 rounded-lg bg-[#F5F2E9] border border-[#DFD7C2] flex items-center justify-between gap-2"
                        >
                          <div>
                            <div className="font-medium text-[#0A1B2C]">{lang.language}</div>
                            <div className="text-[#243647] mt-0.5">
                              {lang.sessions} sess · CSAT{' '}
                              <strong className="font-medium text-[#006BB8]">
                                {formatScore2(lang.averageCsat)}
                              </strong>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setDrillDownTarget({
                                category: 'Language',
                                title: `${lang.language} Sessions Analytics`,
                                subtitle: `${lang.sessions} sessions · ${lang.studentsReached} students`,
                                filtersPatch: { language: lang.language },
                              })
                            }
                            aria-label={`Inspect ${lang.language} language breakdown`}
                            className="px-2 py-0.5 rounded bg-[#FFFFFF] hover:bg-[#E8F6FF] border border-[#8E8674] hover:border-[#0284C7] text-[11px] font-medium text-[#0A1B2C] cursor-pointer transition-colors"
                          >
                            Inspect
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              </>
            ) : (
              renderEmptyAnalytics()
            )}
          </div>
        );

      case 'all-submissions':
        return (
          <section className="ct-card p-5">
            <h3 className="text-sm sm:text-base font-medium text-[#0A1B2C] mb-3 ct-num">
              All Authorized Programme Records ({sessionsPage.total})
            </h3>

            {loading ? (
              <div className="py-10 text-center text-sm text-[#243647]">
                Loading programme records...
              </div>
            ) : sessionsPage.items.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#243647]">No records match filters.</div>
            ) : (
              <>
                <div
                  tabIndex={0}
                  role="region"
                  aria-labelledby={recordsCaptionId}
                  className="ct-table-wrapper rounded-xl border border-[#DFD7C2]"
                >
                  <table className="w-full text-left text-xs border-collapse min-w-[960px]">
                    <caption id={recordsCaptionId} className="visually-hidden">
                      Authorized programme session records
                    </caption>
                    <thead className="bg-[#F5F2E9] text-[#243647] uppercase text-[11px]">
                      <tr>
                        <th scope="col" className="p-3 font-medium">Session ID</th>
                        <th scope="col" className="p-3 font-medium">Facilitator</th>
                        <th scope="col" className="p-3 font-medium">School / UDISE</th>
                        <th scope="col" className="p-3 font-medium">District / Block</th>
                        <th scope="col" className="p-3 font-medium">Tour</th>
                        <th scope="col" className="p-3 font-medium">Date</th>
                        <th scope="col" className="p-3 font-medium">Students</th>
                        <th scope="col" className="p-3 font-medium">CSAT</th>
                        <th scope="col" className="p-3 font-medium">ITP</th>
                        <th scope="col" className="p-3 font-medium">NPS</th>
                        <th scope="col" className="p-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#DFD7C2]">
                      {sessionsPage.items.map((s) => (
                        <tr
                          key={s.sessionRecordId}
                          className="bg-[#FFFFFF] hover:bg-[#F5F2E9] transition-colors ct-num"
                        >
                          <th
                            scope="row"
                            className="p-3 font-mono font-medium text-[#006BB8] whitespace-nowrap"
                          >
                            {s.sessionId}
                          </th>
                          <td className="p-3">
                            <div className="text-[#0A1B2C] font-medium">{s.facilitatorName}</div>
                            <div className="text-[11px] text-[#243647]">{s.facilitatorEmail}</div>
                          </td>
                          <td className="p-3">
                            <div className="text-[#0A1B2C] font-medium">{s.schoolName}</div>
                            <div className="text-[11px] font-mono text-[#33475B]">{s.udiseCode}</div>
                          </td>
                          <td className="p-3 text-[#243647]">
                            <div className="text-[#0A1B2C]">{s.district}</div>
                            <div className="text-[11px] text-[#33475B]">{s.block}</div>
                          </td>
                          <td className="p-3 text-[#243647] max-w-[160px] truncate" title={s.tourName}>
                            {s.tourName}
                          </td>
                          <td className="p-3 text-[#243647] whitespace-nowrap">
                            {formatISODateToDDMMYYYY(s.startDate)}
                          </td>
                          <td className="p-3 text-[#0A1B2C] font-medium">
                            {s.totalStudentsPresent}
                          </td>
                          <td className="p-3 text-[#006BB8] font-semibold">
                            {formatScore2(s.overallCsat)}
                          </td>
                          <td className="p-3 text-[#0A1B2C] font-medium">
                            {formatScore2(s.overallItp)}
                          </td>
                          <td className="p-3 text-[#0A1B2C]">
                            {s.teacherNps > 0 ? '+100' : s.teacherNps}
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setSelectedDetail(s)}
                                aria-label={`Inspect ${s.sessionId}`}
                                className="p-2 rounded-lg bg-[#F5F2E9] hover:bg-[#EFE8D6] border border-[#8E8674] text-[#0A1B2C] cursor-pointer transition-colors"
                              >
                                <Eye className="w-4 h-4" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleEditAction(s)}
                                aria-label={`Correct ${s.sessionId}`}
                                className="p-2 rounded-lg bg-[#E8F6FF] hover:bg-[#1EA7FF]/20 border border-[#0284C7]/45 text-[#006BB8] cursor-pointer transition-colors"
                              >
                                <Edit3 className="w-4 h-4" aria-hidden="true" />
                              </button>
                              {!s.archived && (
                                <button
                                  type="button"
                                  onClick={() => setArchiveTarget(s)}
                                  aria-label={`Archive ${s.sessionId}`}
                                  className="p-2 rounded-lg bg-[#FFF1F2] hover:bg-[#FFE4E6] border border-[#BE123C]/40 text-[#BE123C] cursor-pointer transition-colors"
                                >
                                  <Archive className="w-4 h-4" aria-hidden="true" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-[#243647] ct-num">
                  <span>
                    Page {sessionsPage.page} of {sessionsPage.totalPages} · {sessionsPage.total} total
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={sessionsPage.page <= 1}
                      onClick={() =>
                        setFilters((prev) => ({
                          ...prev,
                          page: Math.max(1, (prev.page ?? 1) - 1),
                        }))
                      }
                      className="ct-btn-secondary text-xs min-h-[36px] px-3 py-1"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={sessionsPage.page >= sessionsPage.totalPages}
                      onClick={() =>
                        setFilters((prev) => ({
                          ...prev,
                          page: Math.min(sessionsPage.totalPages, (prev.page ?? 1) + 1),
                        }))
                      }
                      className="ct-btn-secondary text-xs min-h-[36px] px-3 py-1"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>
        );

      case 'schools':
        return (
          <div className="flex flex-col gap-5">
            <section className="ct-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <h3 className="text-sm sm:text-base font-medium text-[#0A1B2C]">
                    School-wise Performance ({sortedSchools.length})
                  </h3>
                  <p className="text-xs text-[#243647]">
                    Click column headings to sort or inspect any school&apos;s detailed score
                    distribution.
                  </p>
                </div>

                {sortedSchools.length > 15 && (
                  <button
                    type="button"
                    onClick={() => setShowAllSchools((v) => !v)}
                    className="ct-btn-secondary text-xs min-h-[34px] px-3 py-1"
                  >
                    {showAllSchools ? 'Show top 15' : `Show all ${sortedSchools.length} schools`}
                  </button>
                )}
              </div>

              <div role="status" aria-live="polite" className="visually-hidden">
                {schoolSortStatus}
              </div>

              {sortedSchools.length === 0 ? (
                renderEmptyAnalytics()
              ) : (
                <div
                  tabIndex={0}
                  role="region"
                  aria-labelledby={schoolCaptionId}
                  className="ct-table-wrapper rounded-xl border border-[#DFD7C2]"
                >
                  <table className="w-full text-left text-xs border-collapse min-w-[780px]">
                    <caption id={schoolCaptionId} className="visually-hidden">
                      School-wise Career Tours metrics
                    </caption>
                    <thead className="bg-[#F5F2E9] text-[#243647] uppercase text-[11px]">
                      <tr>
                        <th
                          scope="col"
                          aria-sort={schoolSort.col === 'schoolName' ? schoolSort.dir : undefined}
                          className="p-0 font-medium"
                        >
                          <button
                            type="button"
                            onClick={() => handleSchoolSort('schoolName', 'School')}
                            className="w-full min-h-[36px] p-3 flex items-center gap-1.5 text-left hover:text-[#0A1B2C] cursor-pointer"
                          >
                            <span>School / UDISE</span>
                            {renderSortIcon('schoolName')}
                          </button>
                        </th>
                        <th
                          scope="col"
                          aria-sort={schoolSort.col === 'district' ? schoolSort.dir : undefined}
                          className="p-0 font-medium"
                        >
                          <button
                            type="button"
                            onClick={() => handleSchoolSort('district', 'District')}
                            className="w-full min-h-[36px] p-3 flex items-center gap-1.5 text-left hover:text-[#0A1B2C] cursor-pointer"
                          >
                            <span>District / Block</span>
                            {renderSortIcon('district')}
                          </button>
                        </th>
                        <th
                          scope="col"
                          aria-sort={schoolSort.col === 'sessions' ? schoolSort.dir : undefined}
                          className="p-0 font-medium"
                        >
                          <button
                            type="button"
                            onClick={() => handleSchoolSort('sessions', 'Sessions')}
                            className="w-full min-h-[36px] p-3 flex items-center gap-1.5 text-left hover:text-[#0A1B2C] cursor-pointer"
                          >
                            <span>Sessions</span>
                            {renderSortIcon('sessions')}
                          </button>
                        </th>
                        <th
                          scope="col"
                          aria-sort={schoolSort.col === 'studentsReached' ? schoolSort.dir : undefined}
                          className="p-0 font-medium"
                        >
                          <button
                            type="button"
                            onClick={() => handleSchoolSort('studentsReached', 'Students')}
                            className="w-full min-h-[36px] p-3 flex items-center gap-1.5 text-left hover:text-[#0A1B2C] cursor-pointer"
                          >
                            <span>Students</span>
                            {renderSortIcon('studentsReached')}
                          </button>
                        </th>
                        <th
                          scope="col"
                          aria-sort={schoolSort.col === 'averageCsat' ? schoolSort.dir : undefined}
                          className="p-0 font-medium"
                        >
                          <button
                            type="button"
                            onClick={() => handleSchoolSort('averageCsat', 'CSAT')}
                            className="w-full min-h-[36px] p-3 flex items-center gap-1.5 text-left hover:text-[#0A1B2C] cursor-pointer"
                          >
                            <span>CSAT</span>
                            {renderSortIcon('averageCsat')}
                          </button>
                        </th>
                        <th
                          scope="col"
                          aria-sort={schoolSort.col === 'averageItp' ? schoolSort.dir : undefined}
                          className="p-0 font-medium"
                        >
                          <button
                            type="button"
                            onClick={() => handleSchoolSort('averageItp', 'ITP')}
                            className="w-full min-h-[36px] p-3 flex items-center gap-1.5 text-left hover:text-[#0A1B2C] cursor-pointer"
                          >
                            <span>ITP</span>
                            {renderSortIcon('averageItp')}
                          </button>
                        </th>
                        <th
                          scope="col"
                          aria-sort={
                            schoolSort.col === 'missingResponsesQa' ? schoolSort.dir : undefined
                          }
                          className="p-0 font-medium"
                        >
                          <button
                            type="button"
                            onClick={() => handleSchoolSort('missingResponsesQa', 'Missing Votes')}
                            className="w-full min-h-[36px] p-3 flex items-center gap-1.5 text-left hover:text-[#0A1B2C] cursor-pointer"
                          >
                            <span>Missing Q-A</span>
                            {renderSortIcon('missingResponsesQa')}
                          </button>
                        </th>
                        <th scope="col" className="p-3 font-medium">
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#DFD7C2]">
                      {visibleSchools.map((sc) => (
                        <tr
                          key={sc.udiseCode}
                          className="bg-[#FFFFFF] hover:bg-[#F5F2E9] transition-colors ct-num"
                        >
                          <th scope="row" className="p-3 text-left font-medium text-[#0A1B2C]">
                            <div>{sc.schoolName}</div>
                            <div className="text-[11px] font-mono font-normal text-[#33475B]">
                              {sc.udiseCode}
                            </div>
                          </th>
                          <td className="p-3 text-[#243647]">
                            <div className="text-[#0A1B2C]">{sc.district}</div>
                            <div className="text-[11px] text-[#33475B]">{sc.block}</div>
                          </td>
                          <td className="p-3 text-[#0A1B2C]">{sc.sessions}</td>
                          <td className="p-3 text-[#0A1B2C] font-medium">{sc.studentsReached}</td>
                          <td className="p-3 font-semibold text-[#006BB8]">
                            {formatScore2(sc.averageCsat)}
                          </td>
                          <td className="p-3 font-medium text-[#0A1B2C]">
                            {formatScore2(sc.averageItp)}
                          </td>
                          <td className="p-3 text-[#243647]">{sc.missingResponsesQa}</td>
                          <td className="p-3">
                            <button
                              type="button"
                              onClick={() =>
                                setDrillDownTarget({
                                  category: 'School',
                                  title: sc.schoolName,
                                  subtitle: `UDISE ${sc.udiseCode} · ${sc.block}, ${sc.district}`,
                                  filtersPatch: {
                                    search: sc.udiseCode,
                                    district: sc.district,
                                  },
                                })
                              }
                              aria-label={`Inspect ${sc.schoolName} breakdown`}
                              className="px-2.5 py-1 rounded bg-[#FFFFFF] hover:bg-[#E8F6FF] border border-[#8E8674] hover:border-[#0284C7] text-[11px] font-medium text-[#0A1B2C] cursor-pointer transition-colors"
                            >
                              Inspect
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* UDISE School Master Directory Search */}
            <section className="ct-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div>
                  <h3 className="text-sm sm:text-base font-medium text-[#0A1B2C]">
                    UDISE School Master Directory ({schoolDirectory.length})
                  </h3>
                  <p className="text-xs text-[#243647]">
                    Conflict-safe canonical school names keyed by 11-digit UDISE code.
                  </p>
                </div>
                <div className="relative w-full sm:w-72">
                  <Search
                    className="w-4 h-4 text-[#243647] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={schoolDirectoryQuery}
                    onChange={(e) => setSchoolDirectoryQuery(e.target.value)}
                    placeholder="Filter UDISE directory..."
                    aria-label="Search UDISE school directory"
                    className="ct-input pl-9 text-xs"
                  />
                </div>
              </div>

              {schoolDirectory.length === 0 ? (
                <p className="text-xs text-[#243647] py-4">
                  No registered school records match the directory filter yet.
                </p>
              ) : (
                <div
                  tabIndex={0}
                  role="region"
                  aria-labelledby={schoolDirCaptionId}
                  className="ct-table-wrapper rounded-xl border border-[#DFD7C2]"
                >
                  <table className="w-full text-left text-xs border-collapse min-w-[680px]">
                    <caption id={schoolDirCaptionId} className="visually-hidden">
                      Registered UDISE school master records
                    </caption>
                    <thead className="bg-[#F5F2E9] text-[#243647] uppercase text-[11px]">
                      <tr>
                        <th scope="col" className="p-2.5 font-medium">UDISE Code</th>
                        <th scope="col" className="p-2.5 font-medium">Canonical School Name</th>
                        <th scope="col" className="p-2.5 font-medium">Type</th>
                        <th scope="col" className="p-2.5 font-medium">District / Block</th>
                        <th scope="col" className="p-2.5 font-medium">PIN</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#DFD7C2]">
                      {schoolDirectory.map((sch) => (
                        <tr key={sch.udiseCode} className="bg-[#FFFFFF] hover:bg-[#F5F2E9] transition-colors ct-num">
                          <th scope="row" className="p-2.5 font-mono font-medium text-[#006BB8]">
                            {sch.udiseCode}
                          </th>
                          <td className="p-2.5 text-[#0A1B2C] font-medium">{sch.schoolName}</td>
                          <td className="p-2.5 text-[#243647]">{sch.schoolType}</td>
                          <td className="p-2.5 text-[#243647]">
                            {sch.district} · {sch.block}
                          </td>
                          <td className="p-2.5 font-mono text-[#243647]">{sch.pinCode}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        );

      case 'facilitators':
        return (
          <section className="ct-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h3 className="text-sm sm:text-base font-medium text-[#0A1B2C]">
                  Facilitator-wise Performance ({analytics?.facilitatorPanels.length ?? 0})
                </h3>
                <p className="text-xs text-[#243647]">
                  Expand any facilitator to inspect session volume, student reach, CSAT, ITP, and
                  average Teacher NPS.
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleSelectSection('user-management')}
                className="ct-btn-secondary text-xs min-h-[36px] px-3"
              >
                Manage Access &amp; Approvals
              </button>
            </div>

            {!analytics || analytics.facilitatorPanels.length === 0 ? (
              renderEmptyAnalytics()
            ) : (
              <div className="flex flex-col gap-2">
                {analytics.facilitatorPanels.map((f) => {
                  const isOpen = expandedFacilitator === f.email;
                  return (
                    <div
                      key={f.email}
                      className="rounded-xl bg-[#F5F2E9] border border-[#DFD7C2] overflow-hidden"
                    >
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => setExpandedFacilitator(isOpen ? null : f.email)}
                        className="w-full p-3.5 flex flex-wrap items-center justify-between gap-3 text-left hover:bg-[#EFE8D6] cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-2.5">
                          {isOpen ? (
                            <ChevronDown className="w-4 h-4 text-[#006BB8]" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-[#243647]" aria-hidden="true" />
                          )}
                          <div>
                            <div className="text-sm font-medium text-[#0A1B2C]">{f.name}</div>
                            <div className="text-xs text-[#243647]">{f.email}</div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-4 text-xs ct-num text-[#243647]">
                          <span>
                            Sessions:{' '}
                            <strong className="font-medium text-[#0A1B2C]">{f.sessions}</strong>
                          </span>
                          <span>
                            Students:{' '}
                            <strong className="font-medium text-[#0A1B2C]">
                              {f.studentsReached}
                            </strong>
                          </span>
                          <span>
                            CSAT:{' '}
                            <strong className="font-medium text-[#006BB8]">
                              {formatScore2(f.averageCsat)}
                            </strong>
                          </span>
                          <span>
                            ITP:{' '}
                            <strong className="font-medium text-[#0A1B2C]">
                              {formatScore2(f.averageItp)}
                            </strong>
                          </span>
                        </div>
                      </button>

                      {isOpen && (
                        <div className="p-3.5 border-t border-[#DFD7C2] bg-[#FFFFFF] flex flex-wrap items-center justify-between gap-3 text-xs text-[#243647] ct-num">
                          <div>
                            Avg Teacher NPS:{' '}
                            <strong className="font-medium text-[#0A1B2C]">
                              {f.teacherNpsAverage !== null ? f.teacherNpsAverage : '—'}
                            </strong>{' '}
                            · Positive CSAT:{' '}
                            <strong className="font-medium text-[#0A1B2C]">
                              {formatPct1(f.positiveCsatPct)}
                            </strong>{' '}
                            · Latest submission:{' '}
                            <strong className="font-medium text-[#0A1B2C]">
                              {new Date(f.latestSubmission).toLocaleString()}
                            </strong>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setDrillDownTarget({
                                  category: 'Facilitator',
                                  title: `${f.name} Performance`,
                                  subtitle: `${f.email} · ${f.sessions} committed sessions`,
                                  filtersPatch: { facilitatorEmail: f.email },
                                })
                              }
                              className="ct-btn-secondary text-xs min-h-[34px] px-3 py-1"
                            >
                              Detailed view
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setFilters((prev) => ({
                                  ...prev,
                                  facilitatorEmail: f.email,
                                  page: 1,
                                }));
                                handleSelectSection('all-submissions');
                              }}
                              className="ct-btn-secondary text-xs min-h-[34px] px-3 py-1"
                            >
                              View facilitator submissions
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );

      case 'student-feedback':
        return analytics && analytics.totalSessions > 0 ? (
          <div className="flex flex-col gap-5">
            <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="ct-card p-5">
                <h3 className="text-sm sm:text-base font-medium text-[#0A1B2C] mb-3">
                  Question A (CSAT) &amp; Question B (ITP) Sentiment Mix
                </h3>
                <SentimentStackedChart
                  qaSentiment={analytics.qaSentiment}
                  qbSentiment={analytics.qbSentiment}
                  npsDistribution={analytics.npsDistribution}
                />
              </div>

              <div className="ct-card p-5">
                <h3 className="text-sm sm:text-base font-medium text-[#0A1B2C] mb-3">
                  1–5 Score Vote Distribution
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs ct-num">
                  <div className="space-y-2 p-3.5 rounded-xl bg-[#F5F2E9] border border-[#DFD7C2]">
                    <div className="font-medium text-[#006BB8]">
                      Question A — CSAT ({analytics.totalQuestionAResponses} votes)
                    </div>
                    {analytics.csatDistribution.map((row) => (
                      <div key={row.score} className="flex justify-between gap-2">
                        <span className="text-[#243647] truncate">
                          {row.score} · {row.label}
                        </span>
                        <strong className="font-medium text-[#0A1B2C]">{row.count}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2 p-3.5 rounded-xl bg-[#F5F2E9] border border-[#DFD7C2]">
                    <div className="font-medium text-[#0A1B2C]">
                      Question B — ITP ({analytics.totalQuestionBResponses} votes)
                    </div>
                    {analytics.itpDistribution.map((row) => (
                      <div key={row.score} className="flex justify-between gap-2">
                        <span className="text-[#243647] truncate">
                          {row.score} · {row.label}
                        </span>
                        <strong className="font-medium text-[#0A1B2C]">{row.count}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="ct-card p-5">
                <h3 className="text-sm font-medium text-[#0A1B2C] mb-3">
                  Scores by Delivery Language
                </h3>
                <div className="space-y-2 text-xs ct-num">
                  {analytics.languageBreakdown.map((lang) => (
                    <div
                      key={lang.language}
                      className="p-3 rounded-lg bg-[#F5F2E9] border border-[#DFD7C2] flex justify-between items-center gap-2"
                    >
                      <span className="font-medium text-[#0A1B2C]">{lang.language}</span>
                      <span className="text-[#243647]">
                        {lang.studentsReached} students · CSAT{' '}
                        <strong className="font-medium text-[#006BB8]">
                          {formatScore2(lang.averageCsat)}
                        </strong>{' '}
                        · ITP {formatScore2(lang.averageItp)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="ct-card p-5">
                <h3 className="text-sm font-medium text-[#0A1B2C] mb-3">Scores by Grade</h3>
                <div className="space-y-2 text-xs ct-num">
                  {analytics.gradeBreakdown.map((g) => (
                    <div
                      key={g.grade}
                      className="p-3 rounded-lg bg-[#F5F2E9] border border-[#DFD7C2] flex justify-between items-center gap-2"
                    >
                      <span className="font-medium text-[#0A1B2C]">Grade {g.grade}</span>
                      <span className="text-[#243647]">
                        {g.classesCount} classes · CSAT{' '}
                        <strong className="font-medium text-[#006BB8]">{formatScore2(g.averageCsat)}</strong> ·
                        ITP {formatScore2(g.averageItp)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        ) : (
          renderEmptyAnalytics()
        );

      case 'teacher-feedback': {
        const totalTeachers =
          (analytics?.npsDistribution.promoter ?? 0) +
          (analytics?.npsDistribution.passive ?? 0) +
          (analytics?.npsDistribution.detractor ?? 0);

        return (
          <div className="flex flex-col gap-5">
            {analytics && (
              <section className="grid grid-cols-1 sm:grid-cols-4 gap-3 ct-num">
                <div className="rounded-xl p-4 bg-[#E8F6FF] border border-[#0284C7]/45">
                  <div className="text-[11px] uppercase tracking-wide text-[#006BB8] font-medium">
                    Overall Teacher NPS
                  </div>
                  <div className="text-2xl font-semibold text-[#0A1B2C] mt-1">
                    {analytics.teacherNpsAverage !== null
                      ? analytics.teacherNpsAverage > 0
                        ? `+${analytics.teacherNpsAverage}`
                        : String(analytics.teacherNpsAverage)
                      : '—'}
                  </div>
                </div>
                <div className="ct-card p-4">
                  <div className="text-[11px] uppercase text-[#047857] font-medium">
                    Promoters (+100 / 9–10)
                  </div>
                  <div className="text-2xl font-semibold text-[#0A1B2C] mt-1">
                    {analytics.npsDistribution.promoter}
                  </div>
                  <div className="text-xs text-[#243647] mt-0.5">
                    {totalTeachers > 0
                      ? `${Math.round((analytics.npsDistribution.promoter / totalTeachers) * 100)}%`
                      : '—'}
                  </div>
                </div>
                <div className="ct-card p-4">
                  <div className="text-[11px] uppercase text-[#92400E] font-medium">
                    Passives (0 / 7–8)
                  </div>
                  <div className="text-2xl font-semibold text-[#0A1B2C] mt-1">
                    {analytics.npsDistribution.passive}
                  </div>
                  <div className="text-xs text-[#243647] mt-0.5">
                    {totalTeachers > 0
                      ? `${Math.round((analytics.npsDistribution.passive / totalTeachers) * 100)}%`
                      : '—'}
                  </div>
                </div>
                <div className="ct-card p-4">
                  <div className="text-[11px] uppercase text-[#BE123C] font-medium">
                    Detractors (-100 / 0–6)
                  </div>
                  <div className="text-2xl font-semibold text-[#0A1B2C] mt-1">
                    {analytics.npsDistribution.detractor}
                  </div>
                  <div className="text-xs text-[#243647] mt-0.5">
                    {totalTeachers > 0
                      ? `${Math.round((analytics.npsDistribution.detractor / totalTeachers) * 100)}%`
                      : '—'}
                  </div>
                </div>
              </section>
            )}

            <section className="ct-card p-5">
              <h3 className="text-sm sm:text-base font-medium text-[#0A1B2C] mb-3 ct-num">
                Session-level Teacher Responses ({sessionsPage.items.length})
              </h3>
              {sessionsPage.items.length === 0 ? (
                renderEmptyAnalytics()
              ) : (
                <div
                  tabIndex={0}
                  role="region"
                  aria-labelledby={teacherCaptionId}
                  className="ct-table-wrapper rounded-xl border border-[#DFD7C2]"
                >
                  <table className="w-full text-left text-xs border-collapse min-w-[720px]">
                    <caption id={teacherCaptionId} className="visually-hidden">
                      Teacher NPS classifications and exact scores per session
                    </caption>
                    <thead className="bg-[#F5F2E9] text-[#243647] uppercase text-[11px]">
                      <tr>
                        <th scope="col" className="p-3 font-medium">Session ID</th>
                        <th scope="col" className="p-3 font-medium">School</th>
                        <th scope="col" className="p-3 font-medium">Tour</th>
                        <th scope="col" className="p-3 font-medium">Classification</th>
                        <th scope="col" className="p-3 font-medium">Exact Score</th>
                        <th scope="col" className="p-3 font-medium">NPS Weight</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#DFD7C2]">
                      {sessionsPage.items.map((s) => (
                        <tr key={s.sessionRecordId} className="bg-[#FFFFFF] hover:bg-[#F5F2E9] transition-colors ct-num">
                          <th scope="row" className="p-3 font-mono font-medium text-[#006BB8]">
                            {s.sessionId}
                          </th>
                          <td className="p-3 text-[#0A1B2C]">{s.schoolName}</td>
                          <td className="p-3 text-[#243647]">{s.tourName}</td>
                          <td className="p-3 text-[#0A1B2C] font-medium">
                            {s.teacherClassification}
                          </td>
                          <td className="p-3 text-[#243647]">
                            {s.teacherScore !== null ? `${s.teacherScore} / 10` : '—'}
                          </td>
                          <td className="p-3 font-semibold text-[#0A1B2C]">
                            {s.teacherNps > 0 ? '+100' : s.teacherNps}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        );
      }

      case 'performance-reports':
        return (
          <div className="flex flex-col gap-5">
            <section className="ct-card p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base sm:text-lg font-medium text-[#0A1B2C] flex items-center gap-2">
                    <FileSpreadsheet className="w-5 h-5 text-[#006BB8]" aria-hidden="true" />
                    63-Column Performance Reports &amp; Export Readiness
                  </h3>
                  <p className="text-xs sm:text-sm text-[#243647] mt-0.5">
                    Generate verified class-level `.xlsx` workbooks matching your official
                    63-column partner schema. Strictly restricted to Super Administrators.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={preparingExport || sessionsPage.total === 0}
                  onClick={() => void handlePrepareExportModal()}
                  className="ct-btn-primary text-xs min-h-[40px] px-4"
                >
                  <Download className="w-4 h-4" aria-hidden="true" />
                  {preparingExport ? 'Preparing...' : 'Export Official Workbook (.xlsx)'}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs ct-num">
                <div className="p-3.5 rounded-xl bg-[#F5F2E9] border border-[#DFD7C2]">
                  <div className="text-[#243647]">School Year</div>
                  <div className="text-sm font-medium text-[#0A1B2C] mt-1">
                    {config.schoolYear}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-[#F5F2E9] border border-[#DFD7C2]">
                  <div className="text-[#243647]">Partner Organization</div>
                  <div className="text-sm font-medium text-[#0A1B2C] mt-1">
                    {config.partnerName.trim() || 'Not configured yet'}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-[#F5F2E9] border border-[#DFD7C2]">
                  <div className="text-[#243647]">63-Column Template</div>
                  <div className="text-sm font-medium text-[#0A1B2C] mt-1">
                    {config.exportTemplate63?.columns.length === 63
                      ? `Ready (${config.exportTemplate63.templateName})`
                      : 'Pending import in Settings'}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-[#E8F6FF] border border-[#0284C7]/45">
                  <div className="text-[#243647]">Matching Export Sessions</div>
                  <div className="text-sm font-semibold text-[#006BB8] mt-1">
                    {sessionsPage.total} sessions
                  </div>
                </div>
              </div>
            </section>

            {renderKpiStrip()}
          </div>
        );

      case 'data-quality':
        return (
          <div className="flex flex-col gap-5">
            {renderReconciliationBanner()}
            {analytics ? (
              <>
                <section
                  aria-label="Response completeness and data quality"
                  className="ct-card p-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs ct-num"
                >
                  <div>
                    <div className="text-[#243647]">Missing Q-A Votes</div>
                    <div className="text-base font-semibold text-[#0A1B2C] mt-1">
                      {analytics.totalMissingResponsesQA} (
                      {formatPct1(analytics.missingResponseRateQaPct)})
                    </div>
                  </div>
                  <div>
                    <div className="text-[#243647]">Missing Q-B Votes</div>
                    <div className="text-base font-semibold text-[#0A1B2C] mt-1">
                      {analytics.totalMissingResponsesQB} (
                      {formatPct1(analytics.missingResponseRateQbPct)})
                    </div>
                  </div>
                  <div>
                    <div className="text-[#243647]">Low Coverage (&lt;75%)</div>
                    <div className="text-base font-semibold text-[#92400E] mt-1">
                      {analytics.dataQuality.lowCoverageSessionsCount} sessions
                    </div>
                  </div>
                  <div>
                    <div className="text-[#243647]">Q-A / Q-B Mismatches</div>
                    <div className="text-base font-semibold text-[#0A1B2C] mt-1">
                      {analytics.dataQuality.qaQbMismatchCount} sessions
                    </div>
                  </div>
                  <div>
                    <div className="text-[#243647]">Excluded PENDING</div>
                    <div className="text-base font-semibold text-[#0A1B2C] mt-1">
                      {analytics.dataQuality.excludedPendingCount}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#243647]">Unconfigured Video IDs</div>
                    <div className="text-base font-semibold text-[#0A1B2C] mt-1">
                      {analytics.dataQuality.unconfiguredVideoCount}
                    </div>
                  </div>
                </section>

                <section className="ct-card p-5">
                  <h3 className="text-sm sm:text-base font-medium text-[#0A1B2C] mb-3">
                    School Response Completeness Audit
                  </h3>
                  {sortedSchools.length === 0 ? (
                    renderEmptyAnalytics()
                  ) : (
                    <div
                      tabIndex={0}
                      role="region"
                      aria-labelledby={dqCaptionId}
                      className="ct-table-wrapper rounded-xl border border-[#DFD7C2]"
                    >
                      <table className="w-full text-left text-xs border-collapse min-w-[660px]">
                        <caption id={dqCaptionId} className="visually-hidden">
                          Missing Q-A and Q-B response counts by school
                        </caption>
                        <thead className="bg-[#F5F2E9] text-[#243647] uppercase text-[11px]">
                          <tr>
                            <th scope="col" className="p-2.5 font-medium">School</th>
                            <th scope="col" className="p-2.5 font-medium">Students</th>
                            <th scope="col" className="p-2.5 font-medium">Q-A Votes</th>
                            <th scope="col" className="p-2.5 font-medium">Missing Q-A</th>
                            <th scope="col" className="p-2.5 font-medium">Q-B Votes</th>
                            <th scope="col" className="p-2.5 font-medium">Missing Q-B</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#DFD7C2]">
                          {[...sortedSchools]
                            .sort((a, b) => b.missingResponsesQa - a.missingResponsesQa)
                            .map((sc) => (
                              <tr key={sc.udiseCode} className="bg-[#FFFFFF] hover:bg-[#F5F2E9] transition-colors ct-num">
                                <th scope="row" className="p-2.5 text-[#0A1B2C] font-medium">
                                  {sc.schoolName}
                                </th>
                                <td className="p-2.5 text-[#0A1B2C]">{sc.studentsReached}</td>
                                <td className="p-2.5 text-[#243647]">{sc.qaResponses}</td>
                                <td className="p-2.5 font-semibold text-[#92400E]">
                                  {sc.missingResponsesQa}
                                </td>
                                <td className="p-2.5 text-[#243647]">{sc.qbResponses}</td>
                                <td className="p-2.5 font-semibold text-[#92400E]">
                                  {sc.missingResponsesQb}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </>
            ) : (
              renderEmptyAnalytics()
            )}
          </div>
        );

      case 'google-sheets-sync':
        return (
          <GoogleSheetsSyncPanel
            api={api}
            user={user}
            isLiveBackend={isLiveBackend}
            outboxItems={outboxItems}
            onRetryItem={onRetryOutboxItem}
            onRetryAll={onRetryAllOutbox}
            onOutboxChanged={onOutboxChanged}
            onOpenSyncModal={onOpenSyncStatus}
          />
        );

      case 'user-management':
        return (
          <div className="flex flex-col gap-5">
            <UserAccessManager
              api={api}
              currentUser={user}
              config={config}
              onConfigUpdated={onConfigUpdated}
              onUsersChanged={setPendingUsersCount}
              onNotify={onNotify}
            />
            <AuditLogViewer api={api} />
          </div>
        );

      case 'settings':
        return (
          <MasterDataSettings
            api={api}
            user={user}
            config={config}
            onConfigUpdated={onConfigUpdated ?? (() => undefined)}
            onNotify={onNotify}
          />
        );
    }
  };

  if (!isSuperAdmin) {
    return null;
  }

  return (
    <main className="w-full max-w-[1220px] mx-auto px-4 sm:px-6 pb-16">
      {currentSection !== 'settings' && (
        <GoogleSheetsBanner
          connection={sheetsConnection}
          loading={sheetsConnLoading}
          userEmail={user.email}
          onConnectClick={handleBannerConnectClick}
          onManageClick={() => setSheetsModalOpen(true)}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[248px_minmax(0,1fr)] gap-5 items-start">
        <AdminNav
          activeSection={currentSection}
          onSelectSection={handleSelectSection}
          pendingUsersCount={pendingUsersCount}
          outboxCount={outboxItems.length}
        />

        <div className="min-w-0 flex flex-col gap-5">
          {/* Active Admin Section Header */}
          <section className="ct-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-medium text-[#0A1B2C] flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-[#006BB8]" aria-hidden="true" />
                  <span>
                    {currentSection === 'overview'
                      ? 'Admin Programme Dashboard'
                      : activeNavMeta.label}
                  </span>
                </h2>
                <p className="text-xs sm:text-sm text-[#243647] mt-0.5">
                  {activeNavMeta.description} · Approved Super Admins:{' '}
                  {INITIAL_SUPER_ADMINS.map((sa) => sa.email).join(', ')}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {onOpenNewModal && (
                  <button
                    type="button"
                    onClick={onOpenNewModal}
                    className="ct-btn-secondary text-xs min-h-[40px] px-3.5"
                  >
                    <Plus className="w-4 h-4 text-[#006BB8]" aria-hidden="true" />
                    Add submission
                  </button>
                )}
                {onOpenSyncStatus && (
                  <button
                    type="button"
                    onClick={onOpenSyncStatus}
                    className="ct-btn-secondary text-xs min-h-[40px] px-3.5"
                  >
                    <Database className="w-4 h-4 text-[#243647]" aria-hidden="true" />
                    Sync Status
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void loadAdminData()}
                  className="ct-btn-secondary text-xs min-h-[40px] px-3"
                >
                  <RefreshCw className="w-4 h-4" aria-hidden="true" />
                  Refresh
                </button>
                {FILTER_BAR_SECTIONS.has(currentSection) && (
                  <button
                    type="button"
                    disabled={preparingExport || sessionsPage.total === 0}
                    onClick={() => void handlePrepareExportModal()}
                    className="ct-btn-primary text-xs min-h-[40px] px-4"
                  >
                    <Download className="w-4 h-4" aria-hidden="true" />
                    {preparingExport ? 'Preparing...' : 'Export Filtered (.xlsx)'}
                  </button>
                )}
              </div>
            </div>

            {FILTER_BAR_SECTIONS.has(currentSection) && (
              <div role="search" aria-label="Filter programme records" className="mt-4 pt-4 border-t border-[#DFD7C2]">
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
                  <div>
                    <label htmlFor="adm-district" className="block text-xs font-medium text-[#0A1B2C] mb-1">
                      District
                    </label>
                    <select
                      id="adm-district"
                      value={filters.district ?? ''}
                      onChange={(e) => handleDistrictFilterChange(e.target.value)}
                      className="ct-input ct-select text-sm"
                    >
                      <option value="">All districts</option>
                      {config.allowedDistricts.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="adm-block" className="block text-xs font-medium text-[#0A1B2C] mb-1">
                      Block
                    </label>
                    <select
                      id="adm-block"
                      disabled={!filters.district || districtBlocks.length === 0}
                      value={filters.block ?? ''}
                      onChange={(e) =>
                        setFilters((prev) => ({ ...prev, block: e.target.value, page: 1 }))
                      }
                      className="ct-input ct-select text-sm"
                    >
                      <option value="">
                        {!filters.district ? 'Select district' : 'All blocks in district'}
                      </option>
                      {districtBlocks.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="adm-school" className="block text-xs font-medium text-[#0A1B2C] mb-1">
                      School Name / Search
                    </label>
                    <input
                      id="adm-school"
                      type="search"
                      placeholder="School, UDISE, ID..."
                      value={filters.search ?? ''}
                      onChange={(e) =>
                        setFilters((prev) => ({ ...prev, search: e.target.value, page: 1 }))
                      }
                      className="ct-input text-sm"
                    />
                  </div>

                  <div>
                    <label htmlFor="adm-fac" className="block text-xs font-medium text-[#0A1B2C] mb-1">
                      Facilitator Email
                    </label>
                    <input
                      id="adm-fac"
                      type="text"
                      placeholder="Filter by email"
                      value={filters.facilitatorEmail ?? ''}
                      onChange={(e) =>
                        setFilters((prev) => ({
                          ...prev,
                          facilitatorEmail: e.target.value,
                          page: 1,
                        }))
                      }
                      className="ct-input text-sm"
                    />
                  </div>

                  <div>
                    <label htmlFor="adm-tour" className="block text-xs font-medium text-[#0A1B2C] mb-1">
                      Career Tour
                    </label>
                    <select
                      id="adm-tour"
                      value={filters.tourId ?? ''}
                      onChange={(e) =>
                        setFilters((prev) => ({ ...prev, tourId: e.target.value, page: 1 }))
                      }
                      className="ct-input ct-select text-sm"
                    >
                      <option value="">All tours</option>
                      {config.tours.map((t) => (
                        <option key={t.tourId} value={t.tourId}>
                          {t.tourName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="adm-lang" className="block text-xs font-medium text-[#0A1B2C] mb-1">
                      Language
                    </label>
                    <select
                      id="adm-lang"
                      value={filters.language ?? ''}
                      onChange={(e) =>
                        setFilters((prev) => ({ ...prev, language: e.target.value, page: 1 }))
                      }
                      className="ct-input ct-select text-sm"
                    >
                      <option value="">All languages</option>
                      {config.languageOptions.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="adm-grade" className="block text-xs font-medium text-[#0A1B2C] mb-1">
                      Grade
                    </label>
                    <select
                      id="adm-grade"
                      value={filters.grade ?? ''}
                      onChange={(e) =>
                        setFilters((prev) => ({ ...prev, grade: e.target.value, page: 1 }))
                      }
                      className="ct-input ct-select text-sm"
                    >
                      <option value="">All grades</option>
                      {config.gradeOptions.map((g) => (
                        <option key={g} value={g}>
                          Grade {g}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="adm-from" className="block text-xs font-medium text-[#0A1B2C] mb-1">
                      From Date
                    </label>
                    <input
                      id="adm-from"
                      type="date"
                      value={filters.dateFrom ?? ''}
                      onChange={(e) =>
                        setFilters((prev) => ({ ...prev, dateFrom: e.target.value, page: 1 }))
                      }
                      className="ct-input text-sm ct-num"
                    />
                  </div>

                  <div>
                    <label htmlFor="adm-to" className="block text-xs font-medium text-[#0A1B2C] mb-1">
                      To Date
                    </label>
                    <input
                      id="adm-to"
                      type="date"
                      value={filters.dateTo ?? ''}
                      onChange={(e) =>
                        setFilters((prev) => ({ ...prev, dateTo: e.target.value, page: 1 }))
                      }
                      className="ct-input text-sm ct-num"
                    />
                  </div>

                  <div>
                    <label htmlFor="adm-status" className="block text-xs font-medium text-[#0A1B2C] mb-1">
                      Status
                    </label>
                    <select
                      id="adm-status"
                      value={filters.status ?? ''}
                      onChange={(e) =>
                        setFilters((prev) => ({
                          ...prev,
                          status: e.target.value as SubmissionStatus | '',
                          page: 1,
                        }))
                      }
                      className="ct-input ct-select text-sm"
                    >
                      <option value="">All statuses</option>
                      <option value="COMMITTED">COMMITTED</option>
                      <option value="CORRECTED">CORRECTED</option>
                    </select>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <label className="inline-flex items-center gap-2 text-xs text-[#243647] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(filters.includeArchived)}
                      onChange={(e) =>
                        setFilters((prev) => ({
                          ...prev,
                          includeArchived: e.target.checked,
                          page: 1,
                        }))
                      }
                      className="w-4 h-4 accent-[#006BB8]"
                    />
                    Include archived sessions
                  </label>

                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[11px] text-[#047857]">
                      <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                      SUPER_ADMIN verified
                    </span>
                    <button
                      type="button"
                      onClick={handleClearFilters}
                      className="ct-btn-secondary text-xs min-h-[38px] px-3 py-1"
                    >
                      <FilterX className="w-4 h-4" aria-hidden="true" />
                      Clear filters
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>

          {renderSectionBody()}
        </div>
      </div>

      <SessionDetailModal
        session={selectedDetail}
        isSuperAdmin
        onClose={() => setSelectedDetail(null)}
        onEdit={handleEditAction}
      />

      <ExportReportModal
        open={Boolean(exportModalSessions)}
        onClose={() => setExportModalSessions(null)}
        sessions={exportModalSessions ?? []}
        config={config}
        defaultFilenamePrefix={`Career_Tours_Admin_Report_${
          filters.district || 'All_Approved_Districts'
        }`}
        scopeLabel={filters.district || 'ALL_APPROVED_DISTRICTS'}
        onExportComplete={(rowCount, colCount, usedOfficial63, mode) => {
          void api.logExportEvent(filters.district || 'ALL_APPROVED_DISTRICTS', rowCount, mode);
          onNotify(
            'success',
            'Admin Excel export downloaded',
            `${rowCount} class rows exported (${colCount} columns${
              usedOfficial63 ? ', official 63-col template' : ''
            }).`,
          );
        }}
      />

      <DetailedAnalyticsModal
        open={Boolean(drillDownTarget)}
        onClose={() => setDrillDownTarget(null)}
        target={drillDownTarget}
        baseFilters={filters}
        api={api}
        onApplyFilterToDashboard={(patch) => {
          setFilters((prev) => ({ ...prev, ...patch, page: 1 }));
        }}
      />

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title="Archive session record?"
        description="This record will be marked archived and excluded from standard reporting totals. Every archive action is preserved in the Audit Log."
        metadata={
          archiveTarget
            ? [
                { label: 'Session ID', value: archiveTarget.sessionId },
                { label: 'School', value: archiveTarget.schoolName },
                { label: 'Facilitator', value: archiveTarget.facilitatorEmail },
                { label: 'Students Present', value: String(archiveTarget.totalStudentsPresent) },
              ]
            : undefined
        }
        confirmLabel="Yes, archive session"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => void handleArchiveConfirm()}
        onCancel={() => setArchiveTarget(null)}
      />

      <GoogleSheetsConnectModal
        open={sheetsModalOpen}
        onClose={() => setSheetsModalOpen(false)}
        api={api}
        user={user}
        connection={sheetsConnection}
        oauthFeedback={sheetsOauthFeedback}
        onConnectionChanged={(next) => {
          setSheetsConnection(next);
          if (next.connected) {
            setSheetsOauthFeedback(null);
          }
        }}
        onSynced={() => loadAdminData()}
        onDownloadInitializedWorkbook={handleDownloadInitializedWorkbook}
        onNotify={onNotify}
      />
    </main>
  );
};

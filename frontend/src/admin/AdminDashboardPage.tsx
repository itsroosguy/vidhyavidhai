import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
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
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { formatPct1, formatScore2 } from '../calculations/metrics';
import {
  DistrictComparisonBars,
  SentimentStackedChart,
} from '../components/charts/AnalyticsCharts';
import { AnalyticsSectionView } from './AnalyticsSectionView';
import {
  DetailedAnalyticsModal,
  type DetailedAnalyticsTarget,
} from '../components/modals/DetailedAnalyticsModal';
import { ExportReportModal } from '../components/modals/ExportReportModal';
import { GlassModal } from '../components/modals/GlassModal';
import { GoogleSheetsConnectModal } from '../components/modals/GoogleSheetsConnectModal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { INITIAL_SUPER_ADMINS, isAllowlistedSuperAdmin } from '../config/accessControl';
import { SessionDetailModal } from '../dashboard/SessionDetailModal';
import type { BackendApiClient } from '../services/apiClient';
import {
  clearCachedSheetsConnection,
  loadCachedSheetsConnection,
  saveCachedSheetsConnection,
} from '../services/authService';
import {
  getStorageDurabilityStatus,
  triggerJsonDownload,
  type StorageDurabilityStatus,
} from '../services/durableStorage';
import {
  generateInitializedDatabaseWorkbookBuffer,
  triggerXlsxDownload,
} from '../services/exportService';
import {
  STANDARD_EXPORT_FIELD_DECLARATIONS,
  buildProgrammeDeclarationItems,
  getExportColumnDeclaration,
} from '../services/workbookSchemaMetadata';
import type {
  AppConfiguration,
  DashboardAnalytics,
  DatabaseHealthReport,
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
  needsDirectReauth?: boolean;
  oauthSheetsConnection?: GoogleSheetsConnectionState | null;
  onConnectionChanged?: (next: GoogleSheetsConnectionState) => void;
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
  onAuthorizeNow?: () => Promise<void> | void;
  onEnvironmentChanged?: () => void;
  onLiveBackendActivated?: () => void;
  onResetLiveBackend?: () => void;
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

type SubmissionSortColumn =
  | 'sessionId'
  | 'facilitatorName'
  | 'schoolName'
  | 'district'
  | 'tourName'
  | 'startDate'
  | 'totalStudentsPresent'
  | 'overallCsat'
  | 'overallItp'
  | 'teacherNps';

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
  needsDirectReauth = false,
  oauthSheetsConnection = null,
  onConnectionChanged,
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
  onAuthorizeNow,
  onEnvironmentChanged,
  onLiveBackendActivated,
  onResetLiveBackend,
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
  const [restoreTarget, setRestoreTarget] = useState<SessionRecord | null>(null);
  const [deleteSessionTarget, setDeleteSessionTarget] = useState<SessionRecord | null>(null);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [deletingSessions, setDeletingSessions] = useState(false);
  const [schoolEditTarget, setSchoolEditTarget] = useState<SchoolRecord | null>(null);
  const [schoolEditForm, setSchoolEditForm] = useState({
    schoolName: '',
    udiseCode: '',
    schoolType: '',
    district: '',
    pinCode: '',
    active: true,
  });
  const [schoolEditError, setSchoolEditError] = useState('');
  const [savingSchoolEdit, setSavingSchoolEdit] = useState(false);
  const [schoolDeleteTarget, setSchoolDeleteTarget] = useState<SchoolRecord | null>(null);
  const [deletingSchool, setDeletingSchool] = useState(false);
  const [sheetsConnection, setSheetsConnection] = useState<GoogleSheetsConnectionState | null>(() => {
    if (oauthSheetsConnection?.connected && oauthSheetsConnection.spreadsheetId) {
      return oauthSheetsConnection;
    }
    if (api.mode === 'apps_script' && !isLiveBackend) return null;
    return loadCachedSheetsConnection(api.mode);
  });
  const sheetsConnectionRef = useRef<GoogleSheetsConnectionState | null>(sheetsConnection);
  sheetsConnectionRef.current = sheetsConnection;
  const onConnectionChangedRef = useRef(onConnectionChanged);
  onConnectionChangedRef.current = onConnectionChanged;
  const prevOauthSheetsConnRef = useRef<GoogleSheetsConnectionState | null>(oauthSheetsConnection);
  useEffect(() => {
    const prev = prevOauthSheetsConnRef.current;
    prevOauthSheetsConnRef.current = oauthSheetsConnection;
    if (oauthSheetsConnection?.connected && oauthSheetsConnection.spreadsheetId) {
      setSheetsConnection(oauthSheetsConnection);
    } else if (prev?.connected && !oauthSheetsConnection?.connected) {
      setSheetsConnection(oauthSheetsConnection ?? null);
    }
  }, [oauthSheetsConnection]);
  const displaySheetsConnection = sheetsConnection ?? oauthSheetsConnection ?? null;
  const [sheetsConnLoading, setSheetsConnLoading] = useState(false);
  const [authorizingDirect, setAuthorizingDirect] = useState(false);
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

  const [submissionSort, setSubmissionSort] = useState<{
    col: SubmissionSortColumn;
    dir: SortDirection;
  } | null>(null);
  const [submissionSortStatus, setSubmissionSortStatus] = useState('');
  const [showTableDeclarations, setShowTableDeclarations] = useState(false);
  const [dictQuery, setDictQuery] = useState('');
  const [dictCategory, setDictCategory] = useState<string>('ALL');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>('');
  const [importingJson, setImportingJson] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [recoveringDb, setRecoveringDb] = useState(false);
  const [dbHealth, setDbHealth] = useState<DatabaseHealthReport | null>(null);
  const [storageDurability, setStorageDurability] = useState<StorageDurabilityStatus | null>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const isSupabaseMode = api.mode === 'supabase';

  const handleCheckDbHealth = useCallback(async () => {
    if (!api.getDatabaseHealth) return;
    setCheckingHealth(true);
    try {
      const res = await api.getDatabaseHealth();
      if (res.ok && res.data) {
        setDbHealth(res.data);
      } else {
        onNotify('error', 'Database health check failed', res.error);
      }
    } finally {
      setCheckingHealth(false);
    }
  }, [api, onNotify]);

  const handleRecoverDbHealth = async () => {
    if (!api.recoverDatabaseHealth) return;
    setRecoveringDb(true);
    try {
      const res = await api.recoverDatabaseHealth();
      if (res.ok && res.data) {
        setDbHealth(res.data);
        onNotify(
          'success',
          'Database integrity check & repair complete',
          `${res.data.repairedSchoolMasters} school record(s) verified/repaired; ${res.data.promotedPendingCount} pending record(s) reconciled.`,
        );
        void loadAdminDataRef.current({ background: true });
      } else {
        onNotify('error', 'Database recovery failed', res.error);
      }
    } finally {
      setRecoveringDb(false);
    }
  };

  const handleDownloadJsonBackup = async () => {
    if (!api.exportDatabaseBackupPackage) return;
    setBackingUp(true);
    try {
      const res = await api.exportDatabaseBackupPackage();
      if (res.ok && res.data) {
        const fname = `Career_Tours_Database_Backup_${new Date().toISOString().slice(0, 10)}.json`;
        triggerJsonDownload(fname, res.data);
        onNotify(
          'success',
          'Database JSON backup downloaded',
          `${res.data.recordCount} session(s), ${res.data.schoolsCount} school(s), and ${res.data.usersCount} user(s) exported.`,
        );
      } else {
        onNotify('error', 'Backup export failed', res.error);
      }
    } finally {
      setBackingUp(false);
    }
  };

  const handleImportJsonFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !api.importSessionsPackage) return;
    setImportingJson(true);
    try {
      const rawText = await file.text();
      const parsed = JSON.parse(rawText) as unknown;
      const res = await api.importSessionsPackage(parsed);
      if (res.ok && res.data) {
        onNotify(
          'success',
          'JSON import completed',
          `Imported ${res.data.importedCount} session(s), skipped ${res.data.skippedDuplicates} duplicate(s), repaired ${res.data.repairedSchools} school(s).`,
        );
        void loadAdminDataRef.current();
      } else {
        onNotify('error', 'Import failed', res.error || 'Invalid backup or transfer file.');
      }
    } catch (err) {
      onNotify(
        'error',
        'Invalid JSON file',
        err instanceof Error ? err.message : 'Unable to parse JSON payload.',
      );
    } finally {
      setImportingJson(false);
    }
  };

  useEffect(() => {
    if (!isSuperAdmin || currentSection !== 'settings') return;
    void getStorageDurabilityStatus().then(setStorageDurability);
    void handleCheckDbHealth();
  }, [currentSection, handleCheckDbHealth, isSuperAdmin]);

  const schoolCaptionId = useId();
  const schoolDirCaptionId = useId();
  const recordsCaptionId = useId();
  const teacherCaptionId = useId();
  const dqCaptionId = useId();
  const declHeadingId = useId();
  const declPanelId = useId();
  const dictCaptionId = useId();
  const dictSearchId = useId();
  const dictCatId = useId();

  const activeNavMeta =
    ADMIN_NAV_ITEMS.find((i) => i.slug === currentSection) ?? ADMIN_NAV_ITEMS[0]!;

  const loadAdminData = useCallback(async (opts?: { background?: boolean }) => {
    if (!isSuperAdmin) return;
    if (!opts?.background) {
      setLoading(true);
    } else {
      api.invalidateWorkspaceCache?.();
    }
    try {
      const [summaryRes, listRes, usersRes] = await Promise.all([
        api.getDashboardSummary(filters),
        api.getAdminSessions(filters),
        api.listManagedUsers(),
      ]);
      if (summaryRes.ok && summaryRes.data) {
        setAnalytics(summaryRes.data);
      } else if (!opts?.background) {
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
      setLastRefreshedAt(new Date().toISOString());
    } finally {
      if (!opts?.background) {
        setLoading(false);
      }
    }
  }, [api, filters, isSuperAdmin, onNotify]);

  const loadAdminDataRef = useRef(loadAdminData);
  loadAdminDataRef.current = loadAdminData;

  const loadSheetsConnection = useCallback(async () => {
    if (!isSuperAdmin) return;
    if (!sheetsConnectionRef.current?.connected) {
      setSheetsConnLoading(true);
    }
    try {
      const res = await api.getSheetsConnection();
      if (res.ok && res.data) {
        if (res.data.connected && res.data.spreadsheetId) {
          saveCachedSheetsConnection(api.mode, res.data);
        } else {
          clearCachedSheetsConnection(api.mode);
        }
        setSheetsConnection(res.data);
        onConnectionChangedRef.current?.(res.data);
      }
    } finally {
      setSheetsConnLoading(false);
    }
  }, [api, isSuperAdmin]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    void loadAdminData();
  }, [isSuperAdmin, loadAdminData, dataVersion]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    void loadSheetsConnection();
  }, [isSuperAdmin, loadSheetsConnection]);

  useEffect(() => {
    if (!isSuperAdmin || typeof window === 'undefined') return;
    const handleOnline = () => {
      void loadSheetsConnection();
      void loadAdminDataRef.current({ background: true });
    };
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void loadAdminDataRef.current({ background: true });
      }
    };
    const timer = window.setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void loadAdminDataRef.current({ background: true });
      }
    }, 25_000);

    window.addEventListener('online', handleOnline);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', handleOnline);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [isSuperAdmin, loadSheetsConnection]);

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
      api.searchSchools('', true),
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
      `${tabsCount} tabs ready (${rowCount} session record${rowCount === 1 ? '' : 's'}). Use File → Import in Google Sheets.`,
    );
  }, [api, config, onNotify]);

  const loadSchoolDirectory = useCallback(async () => {
    if (!isSuperAdmin || currentSection !== 'schools') return;
    const res = await api.searchSchools(schoolDirectoryQuery, true);
    if (res.ok && res.data) {
      setSchoolDirectory(res.data);
    }
  }, [api, currentSection, isSuperAdmin, schoolDirectoryQuery]);

  useEffect(() => {
    if (!isSuperAdmin || currentSection !== 'schools') return;
    let active = true;
    void api.searchSchools(schoolDirectoryQuery, true).then((res) => {
      if (active && res.ok && res.data) {
        setSchoolDirectory(res.data);
      }
    });
    return () => {
      active = false;
    };
  }, [api, currentSection, isSuperAdmin, schoolDirectoryQuery, dataVersion]);

  useEffect(() => {
    setSelectedSessionIds([]);
  }, [filters]);

  const handleDistrictFilterChange = (district: string) => {
    setFilters((prev) => ({
      ...prev,
      district,
      page: 1,
    }));
  };

  const handleClearFilters = () => {
    setFilters({
      search: '',
      district: '',
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
        totalPages = exportRes.data.totalPages || 1;
        page++;
      } while (page <= totalPages);

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

  const handleRestoreConfirm = async () => {
    if (!restoreTarget) return;
    const target = restoreTarget;
    setRestoreTarget(null);
    const res = await api.restoreSession(target.sessionRecordId);
    if (res.ok) {
      onNotify('success', 'Session restored', `${target.sessionId} restored to active reporting.`);
      void loadAdminData();
    } else {
      onNotify('error', 'Restore failed', res.error);
    }
  };

  const handleDeleteSessionConfirm = async () => {
    if (!deleteSessionTarget || deletingSessions) return;
    const target = deleteSessionTarget;
    setDeleteSessionTarget(null);
    setDeletingSessions(true);
    try {
      const res = await api.deleteSession(target.sessionRecordId);
      if (res.ok) {
        setSelectedSessionIds((prev) => prev.filter((id) => id !== target.sessionRecordId));
        onNotify(
          'success',
          'Session permanently deleted',
          `Removed ${target.sessionId} and ${res.data?.deletedDetailsCount ?? 0} class detail row(s) from ${
            isSupabaseMode ? 'Supabase PostgreSQL' : 'Google Sheets'
          }.`,
        );
        void loadAdminData();
      } else {
        onNotify('error', 'Delete failed', res.error);
      }
    } finally {
      setDeletingSessions(false);
    }
  };

  const handleBulkDeleteConfirm = async () => {
    if (selectedSessionIds.length === 0 || deletingSessions) return;
    const ids = [...selectedSessionIds];
    setBulkDeleteOpen(false);
    setDeletingSessions(true);
    try {
      const res = await api.bulkDeleteSessions(ids);
      if (res.ok && res.data) {
        setSelectedSessionIds([]);
        onNotify(
          'success',
          `Deleted ${res.data.deletedCount} session record(s)`,
          `Removed ${res.data.deletedDetailsCount} linked class row(s) permanently from ${
            isSupabaseMode ? 'Supabase PostgreSQL' : 'Google Sheets'
          }.`,
        );
        void loadAdminData();
      } else {
        onNotify('error', 'Bulk delete failed', res.error);
      }
    } finally {
      setDeletingSessions(false);
    }
  };

  const toggleSelectSession = (sessionRecordId: string) => {
    setSelectedSessionIds((prev) =>
      prev.includes(sessionRecordId)
        ? prev.filter((id) => id !== sessionRecordId)
        : [...prev, sessionRecordId],
    );
  };

  const toggleSelectAllOnPage = () => {
    const pageIds = sessionsPage.items.map((s) => s.sessionRecordId);
    const allSelected =
      pageIds.length > 0 && pageIds.every((id) => selectedSessionIds.includes(id));
    if (allSelected) {
      setSelectedSessionIds([]);
    } else {
      setSelectedSessionIds(pageIds);
    }
  };

  const openSchoolEditModal = (sch: SchoolRecord) => {
    setSchoolEditTarget(sch);
    setSchoolEditForm({
      schoolName: sch.schoolName,
      udiseCode: sch.udiseCode,
      schoolType: sch.schoolType,
      district: sch.district,
      pinCode: sch.pinCode,
      active: sch.active,
    });
    setSchoolEditError('');
  };

  const handleSaveSchoolEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schoolEditTarget || savingSchoolEdit) return;
    const cleanName = schoolEditForm.schoolName.trim();
    const cleanUdise = schoolEditForm.udiseCode.trim();
    const cleanPin = schoolEditForm.pinCode.trim();
    if (!cleanName) {
      setSchoolEditError('Enter a canonical school name.');
      return;
    }
    if (!/^\d{11}$/.test(cleanUdise)) {
      setSchoolEditError('UDISE code must be exactly 11 digits.');
      return;
    }
    if (!/^\d{6}$/.test(cleanPin)) {
      setSchoolEditError('PIN code must be exactly 6 digits.');
      return;
    }

    setSavingSchoolEdit(true);
    setSchoolEditError('');
    try {
      const res = await api.updateSchool({
        schoolRecordId: schoolEditTarget.schoolRecordId,
        schoolName: cleanName,
        udiseCode: cleanUdise,
        schoolType: schoolEditForm.schoolType,
        state: schoolEditTarget.state,
        district: schoolEditForm.district,
        pinCode: cleanPin,
        active: schoolEditForm.active,
      });
      if (res.ok && res.data) {
        onNotify('success', 'School record updated', `${res.data.udiseCode} · ${res.data.schoolName}`);
        setSchoolEditTarget(null);
        await loadSchoolDirectory();
        void loadAdminData();
      } else {
        setSchoolEditError(res.error || 'Failed to update school record.');
        onNotify('error', 'School update failed', res.error);
      }
    } finally {
      setSavingSchoolEdit(false);
    }
  };

  const handleConfirmDeleteSchool = async () => {
    if (!schoolDeleteTarget || deletingSchool) return;
    const target = schoolDeleteTarget;
    setSchoolDeleteTarget(null);
    setDeletingSchool(true);
    try {
      const res = await api.deleteSchool(target.schoolRecordId || target.udiseCode);
      if (res.ok) {
        onNotify(
          'success',
          'School removed from UDISE directory',
          `${target.udiseCode} (${target.schoolName})`,
        );
        await loadSchoolDirectory();
      } else {
        onNotify('error', 'Failed to remove school', res.error);
      }
    } finally {
      setDeletingSchool(false);
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

  const handleSubmissionSort = (col: SubmissionSortColumn, colLabel: string) => {
    const nextDir: SortDirection =
      submissionSort?.col === col
        ? submissionSort.dir === 'ascending'
          ? 'descending'
          : 'ascending'
        : col === 'totalStudentsPresent' ||
            col === 'overallCsat' ||
            col === 'overallItp' ||
            col === 'teacherNps' ||
            col === 'startDate'
          ? 'descending'
          : 'ascending';
    setSubmissionSort({ col, dir: nextDir });
    setSubmissionSortStatus(
      `Sorted by ${colLabel}, ${nextDir}, ${sessionsPage.items.length} visible rows`,
    );
  };

  const sortedSubmissions = useMemo(() => {
    const list = [...sessionsPage.items];
    if (!submissionSort || list.length <= 1) return list;
    const factor = submissionSort.dir === 'ascending' ? 1 : -1;
    list.sort((a, b) => {
      switch (submissionSort.col) {
        case 'sessionId':
          return factor * COLLATOR.compare(a.sessionId, b.sessionId);
        case 'facilitatorName':
          return factor * COLLATOR.compare(a.facilitatorName, b.facilitatorName);
        case 'schoolName':
          return factor * COLLATOR.compare(a.schoolName, b.schoolName);
        case 'district':
          return factor * COLLATOR.compare(a.district, b.district);
        case 'tourName':
          return factor * COLLATOR.compare(a.tourName, b.tourName);
        case 'startDate':
          return factor * COLLATOR.compare(a.startDate, b.startDate);
        case 'totalStudentsPresent':
          return factor * (a.totalStudentsPresent - b.totalStudentsPresent);
        case 'overallCsat':
          return factor * ((a.overallCsat ?? -1) - (b.overallCsat ?? -1));
        case 'overallItp':
          return factor * ((a.overallItp ?? -1) - (b.overallItp ?? -1));
        case 'teacherNps':
          return factor * (a.teacherNps - b.teacherNps);
      }
    });
    return list;
  }, [sessionsPage.items, submissionSort]);

  const renderSubmissionSortIcon = (col: SubmissionSortColumn) => {
    if (submissionSort?.col !== col) {
      return <ArrowUpDown className="w-3.5 h-3.5 opacity-45 shrink-0" aria-hidden="true" />;
    }
    return submissionSort.dir === 'ascending' ? (
      <ArrowUp className="w-3.5 h-3.5 text-[#006BB8] shrink-0" aria-hidden="true" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-[#006BB8] shrink-0" aria-hidden="true" />
    );
  };

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
    if (filters.district) {
      chips.push({
        key: 'district',
        label: `District: ${filters.district}`,
        onRemove: () => setFilters((prev) => ({ ...prev, district: '', page: 1 })),
      });
    }
    if (filters.search?.trim()) {
      chips.push({
        key: 'search',
        label: `Search: ${filters.search.trim()}`,
        onRemove: () => setFilters((prev) => ({ ...prev, search: '', page: 1 })),
      });
    }
    if (filters.facilitatorEmail?.trim()) {
      chips.push({
        key: 'facilitatorEmail',
        label: `Facilitator: ${filters.facilitatorEmail.trim()}`,
        onRemove: () => setFilters((prev) => ({ ...prev, facilitatorEmail: '', page: 1 })),
      });
    }
    if (filters.tourId) {
      const tourName =
        config.tours.find((t) => t.tourId === filters.tourId)?.tourName ?? filters.tourId;
      chips.push({
        key: 'tourId',
        label: `Tour: ${tourName}`,
        onRemove: () => setFilters((prev) => ({ ...prev, tourId: '', page: 1 })),
      });
    }
    if (filters.language) {
      chips.push({
        key: 'language',
        label: `Language: ${filters.language}`,
        onRemove: () => setFilters((prev) => ({ ...prev, language: '', page: 1 })),
      });
    }
    if (filters.grade) {
      chips.push({
        key: 'grade',
        label: `Grade: ${filters.grade}`,
        onRemove: () => setFilters((prev) => ({ ...prev, grade: '', page: 1 })),
      });
    }
    if (filters.dateFrom) {
      chips.push({
        key: 'dateFrom',
        label: `From: ${formatISODateToDDMMYYYY(filters.dateFrom)}`,
        onRemove: () => setFilters((prev) => ({ ...prev, dateFrom: '', page: 1 })),
      });
    }
    if (filters.dateTo) {
      chips.push({
        key: 'dateTo',
        label: `To: ${formatISODateToDDMMYYYY(filters.dateTo)}`,
        onRemove: () => setFilters((prev) => ({ ...prev, dateTo: '', page: 1 })),
      });
    }
    if (filters.status) {
      chips.push({
        key: 'status',
        label: `Status: ${filters.status}`,
        onRemove: () => setFilters((prev) => ({ ...prev, status: '', page: 1 })),
      });
    }
    if (filters.includeArchived) {
      chips.push({
        key: 'includeArchived',
        label: 'Including archived',
        onRemove: () => setFilters((prev) => ({ ...prev, includeArchived: false, page: 1 })),
      });
    }
    return chips;
  }, [config.tours, filters]);

  const programmeDeclarations = useMemo(() => buildProgrammeDeclarationItems(config), [config]);

  const exportDictionaryRows = useMemo(() => {
    if (config.exportTemplate63 && config.exportTemplate63.columns.length === 63) {
      return config.exportTemplate63.columns.map((col, idx) => {
        const decl = getExportColumnDeclaration(col);
        return {
          colNumber: idx + 1,
          header: col.header,
          sourceKey: col.sourceKey || '—',
          category: decl.category,
          dataType: decl.dataType,
          validationRule: decl.validationRule,
          definition: decl.definition,
        };
      });
    }
    return STANDARD_EXPORT_FIELD_DECLARATIONS.map((col, idx) => ({
      colNumber: idx + 1,
      header: col.header,
      sourceKey: col.sourceKey,
      category: col.category,
      dataType: col.dataType,
      validationRule: col.validationRule,
      definition: col.definition,
    }));
  }, [config.exportTemplate63]);

  const dictionaryCategories = useMemo(
    () => Array.from(new Set(exportDictionaryRows.map((r) => r.category))),
    [exportDictionaryRows],
  );

  const filteredDictionaryRows = useMemo(() => {
    const q = dictQuery.trim().toLowerCase();
    return exportDictionaryRows.filter((row) => {
      if (dictCategory !== 'ALL' && row.category !== dictCategory) return false;
      if (!q) return true;
      return (
        row.header.toLowerCase().includes(q) ||
        row.sourceKey.toLowerCase().includes(q) ||
        row.category.toLowerCase().includes(q) ||
        row.validationRule.toLowerCase().includes(q) ||
        row.definition.toLowerCase().includes(q)
      );
    });
  }, [dictCategory, dictQuery, exportDictionaryRows]);

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
          <AnalyticsSectionView
            analytics={analytics}
            loading={loading}
            config={config}
            filters={filters}
            sessionsTotal={sessionsPage.total}
            preparingExport={preparingExport}
            onFiltersChange={setFilters}
            onDistrictFilterChange={handleDistrictFilterChange}
            onClearFilters={handleClearFilters}
            onRefresh={() => {
              api.invalidateWorkspaceCache?.();
              void loadAdminData();
            }}
            onExportFiltered={() => void handlePrepareExportModal()}
            onOpenNewModal={onOpenNewModal}
            onOpenSyncStatus={onOpenSyncStatus}
            onDrillDown={(target) => setDrillDownTarget(target)}
          />
        );

      case 'all-submissions': {
        const allPageSelected =
          sortedSubmissions.length > 0 &&
          sortedSubmissions.every((s) => selectedSessionIds.includes(s.sessionRecordId));

        return (
          <section className="ct-card p-5 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm sm:text-base font-medium text-[#0A1B2C] ct-num">
                All Authorized Programme Records ({sessionsPage.total})
              </h3>

              <div className="flex flex-wrap items-center gap-2 ct-num">
                {selectedSessionIds.length > 0 && (
                  <>
                    <button
                      type="button"
                      disabled={deletingSessions}
                      onClick={() => setBulkDeleteOpen(true)}
                      className="ct-btn-danger text-xs min-h-[36px] px-3 py-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      Delete Selected ({selectedSessionIds.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedSessionIds([])}
                      className="ct-btn-secondary text-xs min-h-[36px] px-3 py-1"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                      Clear selection
                    </button>
                  </>
                )}

                <h4 id={declHeadingId} className="m-0">
                  <button
                    type="button"
                    aria-expanded={showTableDeclarations}
                    aria-controls={declPanelId}
                    onClick={() => setShowTableDeclarations((v) => !v)}
                    className="ct-btn-secondary text-xs min-h-[36px] px-3 py-1"
                  >
                    {showTableDeclarations ? (
                      <ChevronDown className="w-3.5 h-3.5 text-[#006BB8]" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-[#243647]" aria-hidden="true" />
                    )}
                    <span>Table Schema &amp; Declarations ({programmeDeclarations.length})</span>
                  </button>
                </h4>
              </div>
            </div>

            {activeFilterChips.length > 0 && (
              <div
                aria-label="Active table filters"
                className="flex flex-wrap items-center gap-2 px-3 py-2.5 rounded-xl bg-[#F5F2E9] border border-[#DFD7C2] text-xs ct-num"
              >
                <span className="text-[11px] font-medium uppercase tracking-wide text-[#33475B]">
                  Active filters:
                </span>
                {activeFilterChips.map((chip) => (
                  <span
                    key={chip.key}
                    className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-0.5 rounded-full bg-[#FFFFFF] border border-[#C7BEA7] text-[#0A1B2C]"
                  >
                    <span>{chip.label}</span>
                    <button
                      type="button"
                      onClick={chip.onRemove}
                      aria-label={`Remove ${chip.label} filter`}
                      className="w-6 h-6 inline-flex items-center justify-center rounded-full hover:bg-[#EFE8D6] text-[#243647] cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="ml-auto text-xs font-medium text-[#006BB8] hover:underline cursor-pointer px-1.5 py-1"
                >
                  Reset all
                </button>
              </div>
            )}

            {showTableDeclarations && (
              <div
                id={declPanelId}
                aria-labelledby={declHeadingId}
                className="p-4 rounded-xl bg-[#F5F2E9] border border-[#DFD7C2] space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-[#243647]">
                    Official Vidhya Vidhai governance, pooled CSAT/ITP/NPS formulas, leading-zero
                    plain-text formats, and 1:N export contracts applied to this table and Excel
                    workbooks.
                  </p>
                  <button
                    type="button"
                    onClick={() => handleSelectSection('performance-reports')}
                    className="ct-btn-secondary text-xs min-h-[34px] px-3 py-1"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-[#006BB8]" aria-hidden="true" />
                    Open {exportDictionaryRows.length}-Col Data Dictionary
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5 text-xs">
                  {programmeDeclarations.map((decl) => (
                    <div
                      key={decl.refCode}
                      className="p-3 rounded-lg bg-[#FFFFFF] border border-[#DFD7C2] space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="px-1.5 py-0.5 rounded bg-[#E8F6FF] border border-[#0284C7]/35 font-mono text-[10px] font-medium text-[#006BB8]">
                          {decl.refCode}
                        </span>
                        <span className="text-[10px] font-medium uppercase tracking-wide text-[#33475B]">
                          {decl.category}
                        </span>
                      </div>
                      <div className="font-medium text-[#0A1B2C]">{decl.title}</div>
                      <div className="font-mono text-[11px] text-[#006BB8] bg-[#FAF8F2] px-2 py-1 rounded border border-[#DFD7C2] whitespace-pre-line break-words">
                        {decl.ruleOrFormula}
                      </div>
                      <p className="text-[11px] text-[#243647] leading-relaxed">
                        {decl.declaration}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div role="status" aria-live="polite" className="visually-hidden">
              {submissionSortStatus}
            </div>

            {loading && analytics === null ? (
              <div className="py-10 text-center text-sm text-[#243647]">
                Loading programme records...
              </div>
            ) : (
              <>
                <div
                  tabIndex={0}
                  role="region"
                  aria-labelledby={recordsCaptionId}
                  aria-busy={loading}
                  className="ct-table-wrapper ct-table-wrapper--sticky rounded-xl border border-[#DFD7C2]"
                >
                  <table className="w-full text-left text-xs min-w-[1040px]">
                    <caption id={recordsCaptionId} className="visually-hidden">
                      Authorized programme session records
                    </caption>
                    <thead className="bg-[#F5F2E9] text-[#243647] uppercase text-[11px]">
                      <tr>
                        <th scope="col" className="p-3 w-10">
                          <input
                            type="checkbox"
                            aria-label="Select all sessions on this page"
                            disabled={sortedSubmissions.length === 0}
                            checked={allPageSelected}
                            onChange={toggleSelectAllOnPage}
                            className="w-4 h-4 accent-[#006BB8] cursor-pointer disabled:cursor-not-allowed disabled:opacity-45"
                          />
                        </th>
                        <th
                          scope="col"
                          aria-sort={
                            submissionSort?.col === 'sessionId' ? submissionSort.dir : undefined
                          }
                          className="p-0 font-medium"
                        >
                          <button
                            type="button"
                            onClick={() => handleSubmissionSort('sessionId', 'Session ID')}
                            className="w-full min-h-[38px] p-3 flex items-center gap-1.5 text-left hover:text-[#0A1B2C] cursor-pointer"
                          >
                            <span>Session ID</span>
                            {renderSubmissionSortIcon('sessionId')}
                          </button>
                        </th>
                        <th
                          scope="col"
                          aria-sort={
                            submissionSort?.col === 'facilitatorName'
                              ? submissionSort.dir
                              : undefined
                          }
                          className="p-0 font-medium"
                        >
                          <button
                            type="button"
                            onClick={() => handleSubmissionSort('facilitatorName', 'Facilitator')}
                            className="w-full min-h-[38px] p-3 flex items-center gap-1.5 text-left hover:text-[#0A1B2C] cursor-pointer"
                          >
                            <span>Facilitator</span>
                            {renderSubmissionSortIcon('facilitatorName')}
                          </button>
                        </th>
                        <th
                          scope="col"
                          aria-sort={
                            submissionSort?.col === 'schoolName' ? submissionSort.dir : undefined
                          }
                          className="p-0 font-medium"
                        >
                          <button
                            type="button"
                            onClick={() => handleSubmissionSort('schoolName', 'School / UDISE')}
                            className="w-full min-h-[38px] p-3 flex items-center gap-1.5 text-left hover:text-[#0A1B2C] cursor-pointer"
                          >
                            <span>School / UDISE</span>
                            {renderSubmissionSortIcon('schoolName')}
                          </button>
                        </th>
                        <th
                          scope="col"
                          aria-sort={
                            submissionSort?.col === 'district' ? submissionSort.dir : undefined
                          }
                          className="p-0 font-medium"
                        >
                          <button
                            type="button"
                            onClick={() => handleSubmissionSort('district', 'District')}
                            className="w-full min-h-[38px] p-3 flex items-center gap-1.5 text-left hover:text-[#0A1B2C] cursor-pointer"
                          >
                            <span>District</span>
                            {renderSubmissionSortIcon('district')}
                          </button>
                        </th>
                        <th
                          scope="col"
                          aria-sort={
                            submissionSort?.col === 'tourName' ? submissionSort.dir : undefined
                          }
                          className="p-0 font-medium"
                        >
                          <button
                            type="button"
                            onClick={() => handleSubmissionSort('tourName', 'Tour')}
                            className="w-full min-h-[38px] p-3 flex items-center gap-1.5 text-left hover:text-[#0A1B2C] cursor-pointer"
                          >
                            <span>Tour</span>
                            {renderSubmissionSortIcon('tourName')}
                          </button>
                        </th>
                        <th
                          scope="col"
                          aria-sort={
                            submissionSort?.col === 'startDate' ? submissionSort.dir : undefined
                          }
                          className="p-0 font-medium"
                        >
                          <button
                            type="button"
                            onClick={() => handleSubmissionSort('startDate', 'Date')}
                            className="w-full min-h-[38px] p-3 flex items-center gap-1.5 text-left hover:text-[#0A1B2C] cursor-pointer"
                          >
                            <span>Date</span>
                            {renderSubmissionSortIcon('startDate')}
                          </button>
                        </th>
                        <th
                          scope="col"
                          aria-sort={
                            submissionSort?.col === 'totalStudentsPresent'
                              ? submissionSort.dir
                              : undefined
                          }
                          className="p-0 font-medium"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              handleSubmissionSort('totalStudentsPresent', 'Students')
                            }
                            className="w-full min-h-[38px] p-3 flex items-center gap-1.5 text-left hover:text-[#0A1B2C] cursor-pointer"
                          >
                            <span>Students</span>
                            {renderSubmissionSortIcon('totalStudentsPresent')}
                          </button>
                        </th>
                        <th
                          scope="col"
                          aria-sort={
                            submissionSort?.col === 'overallCsat' ? submissionSort.dir : undefined
                          }
                          className="p-0 font-medium"
                        >
                          <button
                            type="button"
                            onClick={() => handleSubmissionSort('overallCsat', 'CSAT')}
                            className="w-full min-h-[38px] p-3 flex items-center gap-1.5 text-left hover:text-[#0A1B2C] cursor-pointer"
                          >
                            <span>CSAT</span>
                            {renderSubmissionSortIcon('overallCsat')}
                          </button>
                        </th>
                        <th
                          scope="col"
                          aria-sort={
                            submissionSort?.col === 'overallItp' ? submissionSort.dir : undefined
                          }
                          className="p-0 font-medium"
                        >
                          <button
                            type="button"
                            onClick={() => handleSubmissionSort('overallItp', 'ITP')}
                            className="w-full min-h-[38px] p-3 flex items-center gap-1.5 text-left hover:text-[#0A1B2C] cursor-pointer"
                          >
                            <span>ITP</span>
                            {renderSubmissionSortIcon('overallItp')}
                          </button>
                        </th>
                        <th
                          scope="col"
                          aria-sort={
                            submissionSort?.col === 'teacherNps' ? submissionSort.dir : undefined
                          }
                          className="p-0 font-medium"
                        >
                          <button
                            type="button"
                            onClick={() => handleSubmissionSort('teacherNps', 'NPS')}
                            className="w-full min-h-[38px] p-3 flex items-center gap-1.5 text-left hover:text-[#0A1B2C] cursor-pointer"
                          >
                            <span>NPS</span>
                            {renderSubmissionSortIcon('teacherNps')}
                          </button>
                        </th>
                        <th scope="col" className="p-3 font-medium">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedSubmissions.length === 0 ? (
                        <tr className="bg-[#FFFFFF]">
                          <td colSpan={12} className="p-0">
                            <div className="sticky left-0 w-[min(100cqi,100%)] p-5 sm:p-8 text-center">
                              <div className="max-w-lg mx-auto space-y-3">
                                <p className="text-sm font-medium text-[#0A1B2C]">
                                  No records match filters.
                                </p>
                                <p className="text-xs text-[#243647] leading-relaxed">
                                  {activeFilterChips.length > 0
                                    ? 'Zero classroom submissions match the active filters above. Clear filters to view available sessions or export the structured workbook.'
                                    : 'No classroom sessions have been submitted yet. All table columns, AutoFilters, plain-text UDISE/PIN formats, 0-evaluated formulas, and Declarations remain ready.'}
                                </p>
                                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                                  {onOpenNewModal && (
                                    <button
                                      type="button"
                                      onClick={onOpenNewModal}
                                      className="ct-btn-secondary text-xs min-h-[36px] px-3 py-1"
                                    >
                                      <Plus className="w-3.5 h-3.5 text-[#006BB8]" aria-hidden="true" />
                                      Add Submission
                                    </button>
                                  )}
                                  {activeFilterChips.length > 0 && (
                                    <button
                                      type="button"
                                      onClick={handleClearFilters}
                                      className="ct-btn-secondary text-xs min-h-[36px] px-3 py-1"
                                    >
                                      <FilterX className="w-3.5 h-3.5" aria-hidden="true" />
                                      Reset Filters
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    disabled={preparingExport}
                                    onClick={() => void handlePrepareExportModal()}
                                    className="ct-btn-primary text-xs min-h-[36px] px-3.5 py-1"
                                  >
                                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                                    Export Schema Workbook (.xlsx)
                                  </button>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        sortedSubmissions.map((s) => (
                          <tr
                            key={s.sessionRecordId}
                            className="bg-[#FFFFFF] hover:bg-[#F5F2E9] transition-colors ct-num"
                          >
                            <td className="p-3">
                              <input
                                type="checkbox"
                                aria-label={`Select session ${s.sessionId}`}
                                checked={selectedSessionIds.includes(s.sessionRecordId)}
                                onChange={() => toggleSelectSession(s.sessionRecordId)}
                                className="w-4 h-4 accent-[#006BB8] cursor-pointer"
                              />
                            </td>
                            <th
                              scope="row"
                              className="p-3 font-mono font-medium text-[#006BB8] whitespace-nowrap"
                            >
                              <span>{s.sessionId}</span>
                              {s.archived && (
                                <span className="ml-1.5 px-1.5 py-0.5 rounded bg-[#FFFBEB] border border-[#B45309]/40 text-[#92400E] text-[10px] font-sans font-medium">
                                  ARCHIVED
                                </span>
                              )}
                            </th>
                            <td className="p-3">
                              <div className="text-[#0A1B2C] font-medium">{s.facilitatorName}</div>
                              <div className="text-[11px] text-[#243647]">{s.facilitatorEmail}</div>
                            </td>
                            <td className="p-3">
                              <div className="text-[#0A1B2C] font-medium">{s.schoolName}</div>
                              <div className="text-[11px] font-mono text-[#33475B]">
                                {s.udiseCode}
                              </div>
                            </td>
                            <td className="p-3 text-[#243647]">
                              <div className="text-[#0A1B2C]">{s.district}</div>
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
                                {!s.archived && (
                                  <button
                                    type="button"
                                    onClick={() => handleEditAction(s)}
                                    aria-label={`Correct ${s.sessionId}`}
                                    className="p-2 rounded-lg bg-[#E8F6FF] hover:bg-[#1EA7FF]/20 border border-[#0284C7]/45 text-[#006BB8] cursor-pointer transition-colors"
                                  >
                                    <Edit3 className="w-4 h-4" aria-hidden="true" />
                                  </button>
                                )}
                                {s.archived ? (
                                  <button
                                    type="button"
                                    onClick={() => setRestoreTarget(s)}
                                    aria-label={`Restore ${s.sessionId}`}
                                    className="p-2 rounded-lg bg-[#ECFDF5] hover:bg-[#D1FAE5] border border-[#047857]/40 text-[#047857] cursor-pointer transition-colors"
                                  >
                                    <RotateCcw className="w-4 h-4" aria-hidden="true" />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setArchiveTarget(s)}
                                    aria-label={`Archive ${s.sessionId}`}
                                    className="p-2 rounded-lg bg-[#FFFBEB] hover:bg-[#FEF3C7] border border-[#B45309]/40 text-[#92400E] cursor-pointer transition-colors"
                                  >
                                    <Archive className="w-4 h-4" aria-hidden="true" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setDeleteSessionTarget(s)}
                                  aria-label={`Delete ${s.sessionId} permanently`}
                                  className="p-2 rounded-lg bg-[#FFF1F2] hover:bg-[#FFE4E6] border border-[#BE123C]/40 text-[#BE123C] cursor-pointer transition-colors"
                                >
                                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {sessionsPage.total > 0 && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-[#243647] ct-num">
                    <span>
                      Page {sessionsPage.page} of {sessionsPage.totalPages} · {sessionsPage.total}{' '}
                      total
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
                )}
              </>
            )}
          </section>
        );
      }

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
                            <span>District</span>
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
                                  subtitle: `UDISE ${sc.udiseCode} · ${sc.district}`,
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
                  <table className="w-full text-left text-xs border-collapse min-w-[780px]">
                    <caption id={schoolDirCaptionId} className="visually-hidden">
                      Registered UDISE school master records
                    </caption>
                    <thead className="bg-[#F5F2E9] text-[#243647] uppercase text-[11px]">
                      <tr>
                        <th scope="col" className="p-2.5 font-medium">UDISE Code</th>
                        <th scope="col" className="p-2.5 font-medium">Canonical School Name</th>
                        <th scope="col" className="p-2.5 font-medium">Type</th>
                        <th scope="col" className="p-2.5 font-medium">District</th>
                        <th scope="col" className="p-2.5 font-medium">PIN</th>
                        <th scope="col" className="p-2.5 font-medium">Status</th>
                        <th scope="col" className="p-2.5 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#DFD7C2]">
                      {schoolDirectory.map((sch) => (
                        <tr key={sch.schoolRecordId || sch.udiseCode} className="bg-[#FFFFFF] hover:bg-[#F5F2E9] transition-colors ct-num">
                          <th scope="row" className="p-2.5 font-mono font-medium text-[#006BB8]">
                            {sch.udiseCode}
                          </th>
                          <td className="p-2.5 text-[#0A1B2C] font-medium">{sch.schoolName}</td>
                          <td className="p-2.5 text-[#243647]">{sch.schoolType}</td>
                          <td className="p-2.5 text-[#243647]">
                            {sch.district}
                          </td>
                          <td className="p-2.5 font-mono text-[#243647]">{sch.pinCode}</td>
                          <td className="p-2.5">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                                sch.active
                                  ? 'bg-[#ECFDF5] border-[#047857]/35 text-[#047857]'
                                  : 'bg-[#FFFBEB] border-[#B45309]/40 text-[#92400E]'
                              }`}
                            >
                              {sch.active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="p-2.5">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openSchoolEditModal(sch)}
                                aria-label={`Edit school ${sch.udiseCode}`}
                                className="p-1.5 rounded-lg bg-[#E8F6FF] hover:bg-[#1EA7FF]/20 border border-[#0284C7]/45 text-[#006BB8] cursor-pointer transition-colors"
                              >
                                <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setSchoolDeleteTarget(sch)}
                                aria-label={`Remove school ${sch.udiseCode}`}
                                className="p-1.5 rounded-lg bg-[#FFF1F2] hover:bg-[#FFE4E6] border border-[#BE123C]/40 text-[#BE123C] cursor-pointer transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            </div>
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
                    63-column partner schema — structured and schema-ready even at 0 sessions.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={preparingExport}
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

            <section className="ct-card p-5 sm:p-6 space-y-4">
              <div>
                <h3 className="text-sm sm:text-base font-medium text-[#0A1B2C]">
                  Official Programme Metric &amp; Data Integrity Declarations
                </h3>
                <p className="text-xs text-[#243647] mt-0.5">
                  Published governance, weighted formula, plain-text preservation, and lock rules
                  embedded in every `.xlsx` export and synchronized Google Sheet&apos;s{' '}
                  <strong>Declarations</strong> tab.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 text-xs">
                {programmeDeclarations.map((decl) => (
                  <article
                    key={decl.refCode}
                    className="p-4 rounded-xl bg-[#F5F2E9] border border-[#DFD7C2] flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="px-2 py-0.5 rounded bg-[#E8F6FF] border border-[#0284C7]/40 font-mono text-[11px] font-medium text-[#006BB8]">
                        {decl.refCode}
                      </span>
                      <span className="text-[11px] font-medium uppercase tracking-wide text-[#33475B]">
                        {decl.category}
                      </span>
                    </div>
                    <h4 className="text-sm font-medium text-[#0A1B2C] m-0">{decl.title}</h4>
                    <div className="font-mono text-[11px] text-[#006BB8] bg-[#FFFFFF] px-2.5 py-1.5 rounded-lg border border-[#DFD7C2] whitespace-pre-line break-words">
                      {decl.ruleOrFormula}
                    </div>
                    <p className="text-xs text-[#243647] leading-relaxed m-0">
                      {decl.declaration}
                    </p>
                  </article>
                ))}
              </div>
            </section>

            <section className="ct-card p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="text-sm sm:text-base font-medium text-[#0A1B2C] ct-num">
                    Export Schema Data Dictionary &amp; Validation Reference (
                    {filteredDictionaryRows.length} / {exportDictionaryRows.length} columns)
                  </h3>
                  <p className="text-xs text-[#243647] mt-0.5">
                    Every column includes frozen Row 1 headers, AutoFilter controls, Excel/Sheets
                    number formats (`@`, `0.00`, `#,##0`), and dropdown validations.
                  </p>
                </div>

                <div className="flex flex-wrap items-end gap-2.5 w-full lg:w-auto">
                  <div className="flex-1 sm:flex-initial min-w-[210px]">
                    <label
                      htmlFor={dictSearchId}
                      className="block text-[11px] font-medium text-[#33475B] mb-1"
                    >
                      Search schema columns
                    </label>
                    <div className="relative">
                      <Search
                        className="w-3.5 h-3.5 text-[#33475B] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                        aria-hidden="true"
                      />
                      <input
                        id={dictSearchId}
                        type="search"
                        value={dictQuery}
                        onChange={(e) => setDictQuery(e.target.value)}
                        placeholder="Header, UDISE, CSAT..."
                        className="ct-input !min-h-[38px] !py-1.5 !pl-8 !pr-2.5 text-xs"
                      />
                    </div>
                  </div>

                  <div className="min-w-[190px]">
                    <label
                      htmlFor={dictCatId}
                      className="block text-[11px] font-medium text-[#33475B] mb-1"
                    >
                      Category
                    </label>
                    <select
                      id={dictCatId}
                      value={dictCategory}
                      onChange={(e) => setDictCategory(e.target.value)}
                      className="ct-input ct-select !min-h-[38px] !py-1.5 !px-2.5 !pr-8 text-xs"
                    >
                      <option value="ALL">All categories</option>
                      {dictionaryCategories.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>

                  {(dictQuery.trim() !== '' || dictCategory !== 'ALL') && (
                    <button
                      type="button"
                      onClick={() => {
                        setDictQuery('');
                        setDictCategory('ALL');
                      }}
                      className="ct-btn-secondary text-xs min-h-[38px] px-3 py-1"
                    >
                      <FilterX className="w-3.5 h-3.5" aria-hidden="true" />
                      Reset filter
                    </button>
                  )}
                </div>
              </div>

              <div
                tabIndex={0}
                role="region"
                aria-labelledby={dictCaptionId}
                className="ct-table-wrapper ct-table-wrapper--sticky rounded-xl border border-[#DFD7C2]"
              >
                <table className="w-full text-left text-xs min-w-[680px] lg:min-w-0 table-auto">
                  <caption id={dictCaptionId} className="visually-hidden">
                    Export workbook column data dictionary and validation rules
                  </caption>
                  <thead className="bg-[#F5F2E9] text-[#243647] uppercase text-[11px]">
                    <tr>
                      <th scope="col" className="p-2.5 font-medium w-12">
                        Col #
                      </th>
                      <th scope="col" className="p-2.5 font-medium w-[22%]">
                        Worksheet Header
                      </th>
                      <th scope="col" className="p-2.5 font-medium w-[16%]">
                        Category
                      </th>
                      <th scope="col" className="p-2.5 font-medium w-[12%]">
                        Type / Format
                      </th>
                      <th scope="col" className="p-2.5 font-medium w-[21%]">
                        Validation Rule
                      </th>
                      <th scope="col" className="p-2.5 font-medium">
                        Official Declaration
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDictionaryRows.length === 0 ? (
                      <tr className="bg-[#FFFFFF]">
                        <td colSpan={6} className="p-0 text-center text-xs text-[#243647]">
                          <div className="sticky left-0 w-[min(100cqi,100%)] p-5 sm:p-6 space-y-2.5">
                            <p className="font-medium text-[#0A1B2C]">
                              No schema columns match your search.
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                setDictQuery('');
                                setDictCategory('ALL');
                              }}
                              className="ct-btn-secondary text-xs min-h-[34px] px-3 py-1"
                            >
                              Reset Dictionary Filter
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredDictionaryRows.map((col) => (
                        <tr
                          key={`${col.colNumber}-${col.header}`}
                          className="bg-[#FFFFFF] hover:bg-[#F5F2E9] transition-colors ct-num"
                        >
                          <td className="p-2.5 font-mono text-[#33475B] align-top">{col.colNumber}</td>
                          <th scope="row" className="p-2.5 text-left align-top">
                            <div className="font-medium text-[#0A1B2C] break-words">{col.header}</div>
                            <div className="font-mono text-[11px] font-normal text-[#006BB8] break-all">
                              {col.sourceKey}
                            </div>
                          </th>
                          <td className="p-2.5 text-[#243647] align-top">{col.category}</td>
                          <td className="p-2.5 font-mono text-[11px] text-[#0A1B2C] align-top">
                            {col.dataType}
                          </td>
                          <td className="p-2.5 text-[#243647] align-top leading-relaxed">
                            {col.validationRule}
                          </td>
                          <td className="p-2.5 text-[#243647] align-top leading-relaxed">
                            {col.definition}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
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
            needsDirectReauth={needsDirectReauth}
            oauthSheetsConnection={displaySheetsConnection}
            outboxItems={outboxItems}
            onRetryItem={onRetryOutboxItem}
            onRetryAll={onRetryAllOutbox}
            onOutboxChanged={onOutboxChanged}
            onOpenSyncModal={onOpenSyncStatus}
            onAuthorizeNow={onAuthorizeNow}
            onConnectionChanged={(next) => {
              setSheetsConnection(next);
              if (next.connected && next.spreadsheetId) {
                saveCachedSheetsConnection(api.mode, next);
                setSheetsOauthFeedback(null);
              } else {
                clearCachedSheetsConnection(api.mode);
              }
              onConnectionChangedRef.current?.(next);
            }}
            onSynced={() => {
              api.invalidateWorkspaceCache?.();
              return loadAdminData();
            }}
            onEnvironmentChanged={onEnvironmentChanged}
            onLiveBackendActivated={onLiveBackendActivated}
            onResetLiveBackend={onResetLiveBackend}
            onNotify={onNotify}
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
          <div className="flex flex-col gap-5">
            <MasterDataSettings
              api={api}
              user={user}
              config={config}
              onConfigUpdated={onConfigUpdated ?? (() => undefined)}
              onNotify={onNotify}
            />

            <section className="ct-card p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-medium text-[#0A1B2C] flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-[#006BB8]" aria-hidden="true" />
                    <span>Database Integrity, Backup &amp; JSON Import</span>
                  </h3>
                  <p className="text-xs text-[#243647] mt-0.5">
                    {isSupabaseMode
                      ? 'Verify Supabase PostgreSQL relational integrity, export full JSON backups, or merge offline transfer packages.'
                      : 'Check workspace storage durability, repair missing school master entries, or back up and import records.'}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {api.getDatabaseHealth && (
                    <button
                      type="button"
                      disabled={checkingHealth}
                      onClick={() => void handleCheckDbHealth()}
                      className="ct-btn-secondary text-xs min-h-[38px] px-3"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${checkingHealth ? 'animate-spin' : ''}`}
                        aria-hidden="true"
                      />
                      {checkingHealth ? 'Checking...' : 'Check Integrity'}
                    </button>
                  )}
                  {api.recoverDatabaseHealth && (
                    <button
                      type="button"
                      disabled={recoveringDb}
                      onClick={() => void handleRecoverDbHealth()}
                      className="ct-btn-secondary text-xs min-h-[38px] px-3"
                    >
                      <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                      {recoveringDb ? 'Repairing...' : 'Verify & Repair'}
                    </button>
                  )}
                  {api.exportDatabaseBackupPackage && (
                    <button
                      type="button"
                      disabled={backingUp}
                      onClick={() => void handleDownloadJsonBackup()}
                      className="ct-btn-secondary text-xs min-h-[38px] px-3"
                    >
                      <Download className="w-3.5 h-3.5 text-[#006BB8]" aria-hidden="true" />
                      {backingUp ? 'Exporting...' : 'Download JSON Backup'}
                    </button>
                  )}
                  {api.importSessionsPackage && (
                    <>
                      <input
                        ref={importFileInputRef}
                        type="file"
                        accept="application/json,.json"
                        onChange={(e) => void handleImportJsonFile(e)}
                        className="visually-hidden"
                        aria-label="Import backup or transfer JSON file"
                      />
                      <button
                        type="button"
                        disabled={importingJson}
                        onClick={() => importFileInputRef.current?.click()}
                        className="ct-btn-primary text-xs min-h-[38px] px-3.5"
                      >
                        <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                        {importingJson ? 'Importing...' : 'Import Backup / Transfer (.json)'}
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-[#F5F2E9] border border-[#DFD7C2]">
                  <div className="text-[#243647]">Primary Storage Engine</div>
                  <div className="font-medium text-[#0A1B2C] mt-1">
                    {isSupabaseMode
                      ? 'Supabase PostgreSQL (Cloud)'
                      : storageDurability?.persistentStorageGranted
                        ? 'Persistent Browser Storage'
                        : 'Browser Local Storage'}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#F5F2E9] border border-[#DFD7C2]">
                  <div className="text-[#243647]">Health Status</div>
                  <div className="font-medium text-[#0A1B2C] mt-1">
                    {dbHealth
                      ? dbHealth.healthy
                        ? 'Healthy (Zero Anomalies)'
                        : `${dbHealth.orphanDetailRowCount} orphan / ${dbHealth.missingSchoolMasterUdise.length} missing schools`
                      : 'Pending check'}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#F5F2E9] border border-[#DFD7C2]">
                  <div className="text-[#243647]">Committed / Corrected</div>
                  <div className="font-medium text-[#0A1B2C] ct-num mt-1">
                    {dbHealth ? `${dbHealth.committedCount} / ${dbHealth.correctedCount}` : '—'}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#F5F2E9] border border-[#DFD7C2]">
                  <div className="text-[#243647]">Archived Sessions</div>
                  <div className="font-medium text-[#0A1B2C] ct-num mt-1">
                    {dbHealth ? dbHealth.archivedCount : '—'}
                  </div>
                </div>
              </div>
            </section>
          </div>
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
          connection={displaySheetsConnection}
          loading={sheetsConnLoading}
          isLiveBackend={isLiveBackend}
          isSupabaseMode={isSupabaseMode}
          needsDirectReauth={needsDirectReauth}
          authorizing={authorizingDirect}
          userEmail={user.email}
          onConnectClick={handleBannerConnectClick}
          onManageClick={() => setSheetsModalOpen(true)}
          onActivateLiveClick={onOpenSyncStatus}
          onAuthorizeNow={
            onAuthorizeNow
              ? () => {
                  setAuthorizingDirect(true);
                  void Promise.resolve(onAuthorizeNow()).finally(() =>
                    setAuthorizingDirect(false),
                  );
                }
              : undefined
          }
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
          {/* Active Admin Section Header (Analytics renders its dedicated BI header) */}
          {currentSection !== 'analytics' && (
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
                  {lastRefreshedAt
                    ? ` · Updated ${new Date(lastRefreshedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`
                    : ''}
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
                  onClick={() => {
                    api.invalidateWorkspaceCache?.();
                    void loadAdminData();
                  }}
                  className="ct-btn-secondary text-xs min-h-[40px] px-3"
                >
                  <RefreshCw className="w-4 h-4" aria-hidden="true" />
                  Refresh
                </button>
                {FILTER_BAR_SECTIONS.has(currentSection) && (
                  <button
                    type="button"
                    disabled={preparingExport}
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
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
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

                  <div className="xl:col-span-2">
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
          )}

          {renderSectionBody()}
        </div>
      </div>

      <SessionDetailModal
        session={selectedDetail}
        isSuperAdmin
        isSupabaseMode={isSupabaseMode}
        onClose={() => setSelectedDetail(null)}
        onEdit={handleEditAction}
        onRestore={(s) => setRestoreTarget(s)}
        onDelete={(s) => setDeleteSessionTarget(s)}
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
          const isCsv = mode.endsWith(':csv');
          onNotify(
            'success',
            isCsv ? 'Admin CSV export downloaded' : 'Admin Excel export downloaded',
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

      <ConfirmDialog
        open={Boolean(restoreTarget)}
        title="Restore archived session?"
        description="This record will return to active programme reporting totals and facilitator dashboards."
        metadata={
          restoreTarget
            ? [
                { label: 'Session ID', value: restoreTarget.sessionId },
                { label: 'School', value: restoreTarget.schoolName },
                { label: 'Facilitator', value: restoreTarget.facilitatorEmail },
              ]
            : undefined
        }
        confirmLabel="Yes, restore session"
        cancelLabel="Cancel"
        onConfirm={() => void handleRestoreConfirm()}
        onCancel={() => setRestoreTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(deleteSessionTarget)}
        title="Permanently delete session record?"
        description={
          isSupabaseMode
            ? 'This permanently removes the session and all linked class rows from Supabase PostgreSQL and writes an Audit Log entry. This cannot be undone.'
            : 'This permanently removes the session and all linked class rows from Google Sheets (Sessions and Session Details tabs) and writes an Audit Log entry. This cannot be undone.'
        }
        metadata={
          deleteSessionTarget
            ? [
                { label: 'Session ID', value: deleteSessionTarget.sessionId },
                { label: 'School', value: deleteSessionTarget.schoolName },
                { label: 'Facilitator', value: deleteSessionTarget.facilitatorEmail },
                {
                  label: 'Class Rows Linked',
                  value: String(deleteSessionTarget.details.length),
                },
              ]
            : undefined
        }
        confirmLabel="Yes, delete permanently"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => void handleDeleteSessionConfirm()}
        onCancel={() => setDeleteSessionTarget(null)}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        title={`Permanently delete ${selectedSessionIds.length} selected session(s)?`}
        description={
          isSupabaseMode
            ? 'All selected session rows and their linked class detail rows will be permanently deleted from Supabase PostgreSQL, and an Audit Log entry will be recorded.'
            : 'All selected session rows and their linked class detail rows will be permanently deleted from Google Sheets inside a single server lock, and an Audit Log entry will be recorded.'
        }
        metadata={[
          { label: 'Selected Sessions', value: String(selectedSessionIds.length) },
        ]}
        confirmLabel={`Yes, delete ${selectedSessionIds.length} session(s)`}
        cancelLabel="Cancel"
        destructive
        onConfirm={() => void handleBulkDeleteConfirm()}
        onCancel={() => setBulkDeleteOpen(false)}
      />

      <ConfirmDialog
        open={Boolean(schoolDeleteTarget)}
        title="Remove school from UDISE directory?"
        description={
          isSupabaseMode
            ? 'This deletes the canonical school entry from the Schools directory in Supabase PostgreSQL. Existing submitted sessions referencing this school remain unchanged.'
            : 'This deletes the canonical school entry from the Schools tab in Google Sheets. Existing submitted sessions referencing this school remain unchanged.'
        }
        metadata={
          schoolDeleteTarget
            ? [
                { label: 'UDISE Code', value: schoolDeleteTarget.udiseCode },
                { label: 'School Name', value: schoolDeleteTarget.schoolName },
                {
                  label: 'District',
                  value: schoolDeleteTarget.district,
                },
              ]
            : undefined
        }
        confirmLabel="Yes, remove school"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => void handleConfirmDeleteSchool()}
        onCancel={() => setSchoolDeleteTarget(null)}
      />

      <GlassModal
        open={Boolean(schoolEditTarget)}
        onClose={() => setSchoolEditTarget(null)}
        size="md"
        eyebrow="UDISE School Master"
        title="Edit School Master Record"
        subtitle={
          schoolEditTarget
            ? `Canonical directory entry (${schoolEditTarget.schoolRecordId})`
            : undefined
        }
        closeLabel="Close school editor"
      >
        {schoolEditTarget && (
          <form onSubmit={(e) => void handleSaveSchoolEdit(e)} className="space-y-4 text-xs sm:text-sm">
            {schoolEditError && (
              <div
                role="alert"
                className="p-3 rounded-lg bg-[#FFF1F2] border border-[#BE123C]/40 text-xs text-[#BE123C]"
              >
                {schoolEditError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label htmlFor="edit-sch-name" className="block text-xs font-medium text-[#0A1B2C] mb-1">
                  Canonical School Name
                </label>
                <input
                  id="edit-sch-name"
                  type="text"
                  required
                  value={schoolEditForm.schoolName}
                  onChange={(e) =>
                    setSchoolEditForm((prev) => ({ ...prev, schoolName: e.target.value }))
                  }
                  className="ct-input text-sm"
                />
              </div>

              <div>
                <label htmlFor="edit-sch-udise" className="block text-xs font-medium text-[#0A1B2C] mb-1">
                  UDISE Code (11 digits)
                </label>
                <input
                  id="edit-sch-udise"
                  type="text"
                  inputMode="numeric"
                  required
                  maxLength={11}
                  value={schoolEditForm.udiseCode}
                  onChange={(e) =>
                    setSchoolEditForm((prev) => ({
                      ...prev,
                      udiseCode: e.target.value.replace(/\D/g, '').slice(0, 11),
                    }))
                  }
                  className="ct-input text-sm font-mono ct-num"
                />
              </div>

              <div>
                <label htmlFor="edit-sch-pin" className="block text-xs font-medium text-[#0A1B2C] mb-1">
                  PIN Code (6 digits)
                </label>
                <input
                  id="edit-sch-pin"
                  type="text"
                  inputMode="numeric"
                  required
                  maxLength={6}
                  value={schoolEditForm.pinCode}
                  onChange={(e) =>
                    setSchoolEditForm((prev) => ({
                      ...prev,
                      pinCode: e.target.value.replace(/\D/g, '').slice(0, 6),
                    }))
                  }
                  className="ct-input text-sm font-mono ct-num"
                />
              </div>

              <div>
                <label htmlFor="edit-sch-type" className="block text-xs font-medium text-[#0A1B2C] mb-1">
                  School Type
                </label>
                <select
                  id="edit-sch-type"
                  value={schoolEditForm.schoolType}
                  onChange={(e) =>
                    setSchoolEditForm((prev) => ({ ...prev, schoolType: e.target.value }))
                  }
                  className="ct-input ct-select text-sm"
                >
                  {config.schoolTypes.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                  {!config.schoolTypes.includes(schoolEditForm.schoolType) &&
                    schoolEditForm.schoolType && (
                      <option value={schoolEditForm.schoolType}>{schoolEditForm.schoolType}</option>
                    )}
                </select>
              </div>

              <div>
                <label htmlFor="edit-sch-dist" className="block text-xs font-medium text-[#0A1B2C] mb-1">
                  District
                </label>
                <select
                  id="edit-sch-dist"
                  value={schoolEditForm.district}
                  onChange={(e) =>
                    setSchoolEditForm((prev) => ({ ...prev, district: e.target.value }))
                  }
                  className="ct-input ct-select text-sm"
                >
                  {config.allowedDistricts.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2 flex items-center pt-1">
                <label className="inline-flex items-center gap-2 text-xs text-[#0A1B2C] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={schoolEditForm.active}
                    onChange={(e) =>
                      setSchoolEditForm((prev) => ({ ...prev, active: e.target.checked }))
                    }
                    className="w-4 h-4 accent-[#006BB8]"
                  />
                  Active in UDISE autofill lookup
                </label>
              </div>
            </div>

            <div className="pt-2 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setSchoolEditTarget(null)}
                className="ct-btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingSchoolEdit}
                className="ct-btn-primary text-sm"
              >
                {savingSchoolEdit ? 'Saving...' : 'Save School Record'}
              </button>
            </div>
          </form>
        )}
      </GlassModal>

      <GoogleSheetsConnectModal
        open={sheetsModalOpen}
        onClose={() => setSheetsModalOpen(false)}
        api={api}
        user={user}
        config={config}
        isLiveBackend={isLiveBackend}
        needsDirectReauth={needsDirectReauth}
        connection={displaySheetsConnection}
        oauthFeedback={sheetsOauthFeedback}
        onConnectionChanged={(next) => {
          setSheetsConnection(next);
          if (next.connected && next.spreadsheetId) {
            saveCachedSheetsConnection(api.mode, next);
            setSheetsOauthFeedback(null);
          } else {
            clearCachedSheetsConnection(api.mode);
          }
          onConnectionChangedRef.current?.(next);
        }}
        onEnvironmentChanged={onEnvironmentChanged}
        onSynced={() => {
          api.invalidateWorkspaceCache?.();
          return loadAdminData();
        }}
        onDownloadInitializedWorkbook={handleDownloadInitializedWorkbook}
        onOpenSyncSetup={onOpenSyncStatus}
        onNotify={onNotify}
      />
    </main>
  );
};

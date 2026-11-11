export type UserRole = 'facilitator' | 'super_admin';

export type UserApprovalStatus = 'APPROVED' | 'PENDING' | 'DENIED';

export type FacilitatorApprovalMode = 'manual_allowlist' | 'auto_approve';

export interface UserProfile {
  userId: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  status?: UserApprovalStatus;
  authMode: 'google_oauth' | 'local_sandbox' | 'supabase';
  idToken?: string;
  organisationId?: string;
  organisationName?: string;
}

export type SessionMode = 'single' | 'combined';

export type TeacherNpsGroup = 'promoter' | 'passive' | 'detractor';

export type SyncStatus = 'SYNCED' | 'PENDING_RETRY' | 'FAILED' | 'LOCAL_SANDBOX';

export interface SyncOutboxItem {
  clientSubmissionKey: string;
  operation: 'createSession' | 'updateSession';
  sessionRecordId?: string;
  sessionId?: string;
  schoolName: string;
  udiseCode: string;
  startDate: string;
  facilitatorEmail: string;
  syncStatus: SyncStatus;
  attempts: number;
  lastAttemptAt: string;
  syncedAt?: string;
  lastError?: string;
  values: SessionFormValues;
}

export interface SyncLogEntry {
  syncId: string;
  timestamp: string;
  clientSubmissionKey: string;
  sessionRecordId: string;
  sessionId: string;
  actorEmail: string;
  operation: string;
  attempt: number;
  status: 'SYNCED' | 'FAILED' | 'PENDING_RETRY' | 'LOCAL_SANDBOX';
  errorMessage: string;
}

export interface ScoreCounts {
  score5: string; // Kept as raw string in form state so empty vs '0' vs invalid decimals don't get silently coerced
  score4: string;
  score3: string;
  score2: string;
  score1: string;
}

export interface NumericScoreCounts {
  score5: number;
  score4: number;
  score3: number;
  score2: number;
  score1: number;
}

export interface ScaleSentimentBreakdown {
  total: number;
  weighted: number;
  exactAverage: number | null;
  average: number | null;
  positiveCount: number; // scores 4 + 5
  neutralCount: number; // score 3
  negativeCount: number; // scores 1 + 2
  positivePct: number | null;
  neutralPct: number | null;
  negativePct: number | null;
}

export interface ClassGroupInput {
  rowId: string;
  grade: string;
  section: string;
  studentsPresent: string;
  questionA: ScoreCounts;
  questionB: ScoreCounts;
}

export interface ClassMetrics {
  rowId: string;
  grade: string;
  section: string;
  studentsPresent: number;
  questionACounts: NumericScoreCounts;
  questionBCounts: NumericScoreCounts;
  questionATotal: number;
  questionAWeighted: number;
  csatAverage: number | null;
  questionACoveragePct: number | null;
  questionAMissingResponses: number;
  questionAPositivePct: number | null;
  questionBTotal: number;
  questionBWeighted: number;
  itpAverage: number | null;
  questionBCoveragePct: number | null;
  questionBMissingResponses: number;
  questionBPositivePct: number | null;
}

export interface SessionMetricsSummary {
  totalClasses: number;
  totalStudentsPresent: number;
  totalQuestionAResponses: number;
  totalQuestionAWeighted: number;
  totalQuestionAMissing: number;
  overallCsat: number | null;
  overallQuestionACoveragePct: number | null;
  questionASentiment: ScaleSentimentBreakdown;
  totalQuestionBResponses: number;
  totalQuestionBWeighted: number;
  totalQuestionBMissing: number;
  overallItp: number | null;
  overallQuestionBCoveragePct: number | null;
  questionBSentiment: ScaleSentimentBreakdown;
  teacherScoreExact: number | null;
  teacherClassification: 'Promoter' | 'Passive' | 'Detractor' | null;
  teacherNps: number | null;
  classBreakdown: ClassMetrics[];
}

export interface SessionFormValues {
  clientSubmissionKey: string;
  facilitatorName: string;
  facilitatorEmail: string;
  tourId: string;
  language: string;
  startDate: string; // YYYY-MM-DD (Asia/Kolkata)
  endDate: string; // YYYY-MM-DD (Asia/Kolkata)
  startTime: string; // HH:MM (24h) or ''
  endTime: string; // HH:MM (24h) or ''
  schoolName: string;
  udiseCode: string; // 11-digit string
  schoolType: string;
  state: string;
  district: string;
  pinCode: string; // 6-digit string
  sessionMode: SessionMode;
  classes: ClassGroupInput[];
  teacherNpsGroup: TeacherNpsGroup | '';
  teacherExactScore: string; // optional '0'..'10' or ''
}

export interface SessionDetailRecord {
  detailRecordId: string;
  sessionRecordId: string;
  sessionId: string;
  grade: string;
  section: string;
  studentsPresent: number;
  questionAScore5: number;
  questionAScore4: number;
  questionAScore3: number;
  questionAScore2: number;
  questionAScore1: number;
  questionATotal: number;
  questionAWeightedScore: number;
  csat: number | null;
  questionBScore5: number;
  questionBScore4: number;
  questionBScore3: number;
  questionBScore2: number;
  questionBScore1: number;
  questionBTotal: number;
  questionBWeightedScore: number;
  itp: number | null;
  createdAt: string;
  updatedAt: string;
}

export type SubmissionStatus = 'COMMITTED' | 'PENDING' | 'CORRECTED';

export interface SessionRecord {
  sessionRecordId: string;
  sessionId: string;
  clientSubmissionKey: string;
  facilitatorName: string;
  facilitatorEmail: string;
  facilitatorUserId: string;
  tourId: string;
  tourName: string;
  videoId: string;
  language: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  durationMinutes: number;
  durationFormatted: string;
  reportingMonth: string;
  submissionTimestamp: string;
  submissionDateFormatted: string; // dd-mm-yyyy
  schoolName: string;
  udiseCode: string;
  schoolType: string;
  state: string;
  district: string;
  pinCode: string;
  sessionType: SessionMode;
  totalClasses: number;
  totalStudentsPresent: number;
  totalQuestionAResponses: number;
  totalQuestionBResponses: number;
  overallCsat: number | null;
  overallItp: number | null;
  teacherScore: number | null;
  teacherClassification: 'Promoter' | 'Passive' | 'Detractor';
  teacherNps: number;
  submissionStatus: SubmissionStatus;
  syncStatus?: SyncStatus;
  syncedAt?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  archived: boolean;
  details: SessionDetailRecord[];
}

export interface DuplicateSessionCandidate {
  sessionRecordId: string;
  sessionId: string;
  schoolName: string;
  udiseCode: string;
  startDate: string;
  startTime: string;
  tourName: string;
  facilitatorName: string;
  overlappingGrades: string[];
}

export interface TourOption {
  tourId: string;
  tourName: string;
  tourCode: string;
  active: boolean;
  videoIdByLanguage?: Record<string, string>;
}

export interface ExportColumnSpec {
  index: number; // 1..63
  header: string;
  sourceKey: string;
  format?: 'text' | 'number' | 'decimal2' | 'date_ddmmyyyy' | 'time_hhmm' | 'constant';
  constantValue?: string | number;
}

export interface ExportTemplateSchema {
  templateName: string;
  verified: boolean;
  uploadedAt?: string;
  uploadedBy?: string;
  columns: ExportColumnSpec[];
}

export interface AppConfiguration {
  programmeTimezone: string;
  stateName: string;
  allowedDistricts: string[];
  gradeOptions: string[];
  sectionOptions: string[];
  schoolTypes: string[];
  tours: TourOption[];
  languageOptions: string[];
  languageCodes: Record<string, string>;
  schoolYear: string;
  partnerName: string;
  reportingDefaults: {
    cc: string;
    completionRate: number;
    underservedReach: string;
    dataSource: string;
    feedbackFrom: string;
    educatorId: string;
  };
  policy: {
    allowFacilitatorDeleteOwn: boolean;
    allowFacilitatorExportOwn: boolean;
    facilitatorApprovalMode: FacilitatorApprovalMode;
  };
  exportTemplate63: ExportTemplateSchema | null;
}

export type ValidationSection = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface ValidationIssue {
  code: string;
  field: string;
  section: ValidationSection;
  severity: 'error' | 'warning';
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface SchoolRecord {
  schoolRecordId: string;
  schoolName: string;
  udiseCode: string;
  schoolType: string;
  state: string;
  district: string;
  pinCode: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedUser {
  userId: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  status?: UserApprovalStatus;
  emailConfirmed?: boolean;
  hasLoginAccount?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProvisionFacilitatorResult {
  user: ManagedUser;
  created: boolean;
}

export interface BulkProvisionItemResult {
  email: string;
  name: string;
  ok: boolean;
  created?: boolean;
  error?: string;
}

export interface BulkProvisionFacilitatorsResult {
  totalCount: number;
  createdCount: number;
  updatedCount: number;
  failedCount: number;
  results: BulkProvisionItemResult[];
  users: ManagedUser[];
}

export interface AuditLogEntry {
  auditId: string;
  timestamp: string;
  userId: string;
  userEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  previousSummary: string;
  newSummary: string;
  result: 'SUCCESS' | 'DENIED' | 'FAILED';
}

export interface SessionQueryFilters {
  search?: string;
  district?: string;
  school?: string;
  facilitatorEmail?: string;
  tourId?: string;
  language?: string;
  grade?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: SubmissionStatus | '';
  includeArchived?: boolean;
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ReconciliationReport {
  verified: boolean;
  checkedAt: string;
  checksRun: number;
  discrepancies: string[];
}

export interface DataQualityMetrics {
  totalClassRows: number;
  totalMissingQa: number;
  totalMissingQb: number;
  missingRateQaPct: number | null;
  missingRateQbPct: number | null;
  lowCoverageSessionsCount: number;
  qaQbMismatchCount: number;
  unconfiguredVideoCount: number;
  excludedPendingCount: number;
}

export interface DashboardAnalytics {
  totalSessions: number;
  totalStudentsReached: number;
  totalSchoolsCovered: number;
  totalFacilitatorsActive: number;
  totalQuestionAResponses: number;
  totalQuestionBResponses: number;
  totalMissingResponsesQA: number;
  totalMissingResponsesQB: number;
  missingResponseRateQaPct: number | null;
  missingResponseRateQbPct: number | null;
  averageCsat: number | null;
  averageItp: number | null;
  teacherNpsAverage: number | null;
  qaSentiment: ScaleSentimentBreakdown;
  qbSentiment: ScaleSentimentBreakdown;
  districtBreakdown: Array<{
    district: string;
    sessions: number;
    studentsReached: number;
    schoolsCount: number;
    qaResponses: number;
    qbResponses: number;
    missingResponsesQa: number;
    averageCsat: number | null;
    averageItp: number | null;
    positiveCsatPct: number | null;
    positiveItpPct: number | null;
  }>;
  schoolBreakdown: Array<{
    udiseCode: string;
    schoolName: string;
    district: string;
    sessions: number;
    studentsReached: number;
    qaResponses: number;
    qbResponses: number;
    missingResponsesQa: number;
    missingResponsesQb: number;
    averageCsat: number | null;
    averageItp: number | null;
    positiveCsatPct: number | null;
    positiveItpPct: number | null;
  }>;
  monthlyBreakdown: Array<{
    monthKey: string; // YYYY-MM
    monthLabel: string; // e.g., November 2026
    sessions: number;
    studentsReached: number;
    schoolsCount?: number;
    facilitatorsCount?: number;
    averageCsat: number | null;
    averageItp: number | null;
    positiveCsatPct: number | null;
    positiveItpPct: number | null;
    teacherNpsAverage: number | null;
  }>;
  tourBreakdown: Array<{
    tourId: string;
    tourName: string;
    sessions: number;
    studentsReached: number;
    schoolsCount?: number;
    averageCsat: number | null;
    averageItp: number | null;
    positiveCsatPct: number | null;
    positiveItpPct: number | null;
  }>;
  languageBreakdown: Array<{
    language: string;
    sessions: number;
    studentsReached: number;
    averageCsat: number | null;
    averageItp: number | null;
    positiveCsatPct: number | null;
    positiveItpPct: number | null;
  }>;
  gradeBreakdown: Array<{
    grade: string;
    classesCount: number;
    studentsReached: number;
    averageCsat: number | null;
    averageItp: number | null;
    positiveCsatPct: number | null;
  }>;
  timelineSeries: Array<{
    date: string;
    sessions: number;
    studentsReached: number;
  }>;
  csatDistribution: Array<{ score: number; label: string; count: number }>;
  itpDistribution: Array<{ score: number; label: string; count: number }>;
  npsDistribution: {
    promoter: number;
    passive: number;
    detractor: number;
  };
  facilitatorPanels: Array<{
    name: string;
    email: string;
    sessions: number;
    studentsReached: number;
    schoolsCount?: number;
    missingResponsesQa: number;
    averageCsat: number | null;
    averageItp: number | null;
    positiveCsatPct: number | null;
    positiveItpPct: number | null;
    teacherNpsAverage: number | null;
    latestSubmission: string;
  }>;
  dataQuality: DataQualityMetrics;
  reconciliation: ReconciliationReport;
}

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
  warnings?: string[];
}

export type SheetsAuthMethod = 'google_oauth' | 'apps_script' | 'local_sandbox';

export type SheetsConnectionProvider =
  | 'direct_browser'
  | 'sheets_backend'
  | 'apps_script'
  | 'local_sandbox';

export interface GoogleSheetsConnectionState {
  connected: boolean;
  authMethod: SheetsAuthMethod;
  connectionProvider?: SheetsConnectionProvider;
  oauthConfigured: boolean;
  connectedAccount: string;
  spreadsheetId: string;
  spreadsheetName: string;
  spreadsheetUrl: string;
  appsScriptUrl?: string;
  appsScriptSyncKey?: string;
  connectedAt: string;
  connectedBy: string;
  lastSyncedAt: string;
  lastSyncStatus: 'IDLE' | 'SYNCED' | 'FAILED';
  lastSyncMessage: string;
  initializedTabs: string[];
  defaultSpreadsheetId: string;
  defaultSpreadsheetUrl: string;
}

export interface GoogleSpreadsheetSummary {
  spreadsheetId: string;
  name: string;
  url: string;
  modifiedTime?: string;
}

export interface SheetsSyncSummary {
  syncedCount: number;
  skippedDuplicates: number;
  totalSheetSessions: number;
  syncedAt: string;
  message: string;
}

export interface TeamIntakeConfig {
  appsScriptUrl?: string;
  intakeKey?: string;
  googleClientId?: string;
  configuredAt: string;
  configuredBy?: string;
  label?: string;
}

export interface TeamIntakeSetupResponse {
  configured: boolean;
  intakeKey: string;
  approvalMode: FacilitatorApprovalMode;
  updatedAt: string;
}

export interface DatabaseHealthReport {
  healthy: boolean;
  totalSessions: number;
  committedCount: number;
  correctedCount: number;
  pendingCount: number;
  recoverablePendingCount: number;
  archivedCount: number;
  promotedPendingCount: number;
  orphanPendingCount: number;
  orphanDetailRowCount: number;
  duplicateSessionIds: string[];
  duplicateRecordIds: string[];
  missingSchoolMasterUdise: string[];
  repairedSchoolMasters: number;
  checkedAt: string;
}

export interface SessionTransferPackage {
  format: 'VV_FACILITATOR_TRANSFER_V1';
  version: 1;
  exportedAt: string;
  exportedBy: { email: string; name: string };
  recordCount: number;
  integrityHash: string;
  sessions: SessionRecord[];
}

export interface DatabaseBackupPackage {
  format: 'VV_DATABASE_BACKUP_V1';
  version: 1;
  exportedAt: string;
  exportedBy: { email: string; name: string };
  recordCount: number;
  schoolsCount: number;
  usersCount: number;
  integrityHash: string;
  sessions: SessionRecord[];
  schools: SchoolRecord[];
  users: ManagedUser[];
  configuration: AppConfiguration;
}

export interface ImportSessionsResult {
  importedCount: number;
  skippedDuplicates: number;
  rejectedCount: number;
  registeredFacilitators: number;
  repairedSchools: number;
  errors: string[];
}

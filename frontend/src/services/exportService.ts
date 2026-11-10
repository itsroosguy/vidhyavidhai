import type {
  AppConfiguration,
  ExportColumnSpec,
  ExportTemplateSchema,
  ManagedUser,
  SchoolRecord,
  SessionDetailRecord,
  SessionRecord,
} from '../types/domain';
import { INITIAL_SUPER_ADMINS } from '../config/accessControl';
import { formatISODateToDDMMYYYY } from '../utils/temporal';

async function loadExcelJS() {
  const mod = await import('exceljs');
  return mod.default;
}

export interface FlattenedExportRow {
  session_record_id: string;
  detail_record_id: string;
  session_id: string;
  cc: string;
  school_year: string;
  partner_name: string;
  data_source: string;
  completion_rate: number;
  underserved_reach: string;
  feedback_from: string;
  educator_id: string;
  facilitator_name: string;
  facilitator_email: string;
  tour_id: string;
  tour_name: string;
  video_id: string;
  language: string;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  duration_formatted: string;
  reporting_month: string;
  submission_date: string;
  submission_timestamp: string;
  school_name: string;
  udise_code: string;
  school_type: string;
  state: string;
  district: string;
  block: string;
  pin_code: string;
  session_type: string;
  total_classes: number;
  grade: string;
  section: string;
  students_present: number;
  qa_5: number;
  qa_4: number;
  qa_3: number;
  qa_2: number;
  qa_1: number;
  qa_total: number;
  qa_weighted: number;
  csat: number | string;
  qb_5: number;
  qb_4: number;
  qb_3: number;
  qb_2: number;
  qb_1: number;
  qb_total: number;
  qb_weighted: number;
  itp: number | string;
  overall_csat: number | string;
  overall_itp: number | string;
  teacher_score: number | string;
  teacher_classification: string;
  teacher_nps: number;
  submission_status: string;
}

export const KNOWN_EXPORT_SOURCE_KEYS: Array<{ key: keyof FlattenedExportRow; label: string }> = [
  { key: 'session_id', label: 'Session ID' },
  { key: 'cc', label: 'Country Code (IN)' },
  { key: 'school_year', label: 'School Year' },
  { key: 'partner_name', label: 'Partner Name' },
  { key: 'data_source', label: 'Data Source (Manual)' },
  { key: 'completion_rate', label: 'Completion Rate (100)' },
  { key: 'underserved_reach', label: 'Underserved Reach (Yes)' },
  { key: 'feedback_from', label: 'Feedback From' },
  { key: 'educator_id', label: 'Educator ID (NA)' },
  { key: 'facilitator_name', label: 'Facilitator Name' },
  { key: 'facilitator_email', label: 'Facilitator Email' },
  { key: 'tour_id', label: 'Tour ID' },
  { key: 'tour_name', label: 'Tour Name' },
  { key: 'video_id', label: 'Video ID' },
  { key: 'language', label: 'Language' },
  { key: 'start_date', label: 'Start Date (dd-mm-yyyy)' },
  { key: 'end_date', label: 'End Date (dd-mm-yyyy)' },
  { key: 'start_time', label: 'Start Time (HH:MM)' },
  { key: 'end_time', label: 'End Time (HH:MM)' },
  { key: 'duration_minutes', label: 'Duration (minutes)' },
  { key: 'duration_formatted', label: 'Session Length (text)' },
  { key: 'reporting_month', label: 'Reporting Month' },
  { key: 'submission_date', label: 'Submission Date (dd-mm-yyyy)' },
  { key: 'school_name', label: 'School Name' },
  { key: 'udise_code', label: 'UDISE Code (11-digit text)' },
  { key: 'school_type', label: 'School Type' },
  { key: 'state', label: 'State' },
  { key: 'district', label: 'District' },
  { key: 'block', label: 'Block' },
  { key: 'pin_code', label: 'PIN Code (6-digit text)' },
  { key: 'session_type', label: 'Session Type (single/combined)' },
  { key: 'total_classes', label: 'Total Classes in Session' },
  { key: 'grade', label: 'Grade (per row)' },
  { key: 'section', label: 'Section (per row)' },
  { key: 'students_present', label: 'Students Present (per row)' },
  { key: 'qa_5', label: 'Q-A Score 5 (Loved it)' },
  { key: 'qa_4', label: 'Q-A Score 4 (Liked it)' },
  { key: 'qa_3', label: 'Q-A Score 3 (It was okay)' },
  { key: 'qa_2', label: "Q-A Score 2 (Didn't like much)" },
  { key: 'qa_1', label: "Q-A Score 1 (Didn't like at all)" },
  { key: 'qa_total', label: 'Q-A Total Responses' },
  { key: 'qa_weighted', label: 'Q-A Weighted Score' },
  { key: 'csat', label: 'Class CSAT Average' },
  { key: 'qb_5', label: 'Q-B Score 5 (Extremely interested)' },
  { key: 'qb_4', label: 'Q-B Score 4 (Very interested)' },
  { key: 'qb_3', label: 'Q-B Score 3 (Moderately interested)' },
  { key: 'qb_2', label: 'Q-B Score 2 (Slightly interested)' },
  { key: 'qb_1', label: 'Q-B Score 1 (Not at all interested)' },
  { key: 'qb_total', label: 'Q-B Total Responses' },
  { key: 'qb_weighted', label: 'Q-B Weighted Score' },
  { key: 'itp', label: 'Class ITP Average' },
  { key: 'overall_csat', label: 'Session Pooled CSAT' },
  { key: 'overall_itp', label: 'Session Pooled ITP' },
  { key: 'teacher_score', label: 'Teacher Score (0-10)' },
  { key: 'teacher_classification', label: 'Teacher Classification' },
  { key: 'teacher_nps', label: 'Teacher NPS (+100/0/-100)' },
  { key: 'submission_status', label: 'Submission Status' },
];

export function buildFlattenedExportRows(
  sessions: SessionRecord[],
  config: AppConfiguration,
): FlattenedExportRow[] {
  const rows: FlattenedExportRow[] = [];

  for (const s of sessions) {
    const details: SessionDetailRecord[] =
      s.details && s.details.length > 0
        ? s.details
        : [
            {
              detailRecordId: `${s.sessionRecordId}_D1`,
              sessionRecordId: s.sessionRecordId,
              sessionId: s.sessionId,
              grade: '',
              section: '',
              studentsPresent: s.totalStudentsPresent,
              questionAScore5: 0,
              questionAScore4: 0,
              questionAScore3: 0,
              questionAScore2: 0,
              questionAScore1: 0,
              questionATotal: s.totalQuestionAResponses,
              questionAWeightedScore: 0,
              csat: s.overallCsat,
              questionBScore5: 0,
              questionBScore4: 0,
              questionBScore3: 0,
              questionBScore2: 0,
              questionBScore1: 0,
              questionBTotal: s.totalQuestionBResponses,
              questionBWeightedScore: 0,
              itp: s.overallItp,
              createdAt: s.createdAt,
              updatedAt: s.updatedAt,
            },
          ];

    for (const d of details) {
      rows.push({
        session_record_id: s.sessionRecordId,
        detail_record_id: d.detailRecordId,
        session_id: s.sessionId,
        cc: config.reportingDefaults.cc,
        school_year: config.schoolYear,
        partner_name: config.partnerName,
        data_source: config.reportingDefaults.dataSource,
        completion_rate: config.reportingDefaults.completionRate,
        underserved_reach: config.reportingDefaults.underservedReach,
        feedback_from: config.reportingDefaults.feedbackFrom,
        educator_id: config.reportingDefaults.educatorId,
        facilitator_name: s.facilitatorName,
        facilitator_email: s.facilitatorEmail,
        tour_id: s.tourId,
        tour_name: s.tourName,
        video_id: s.videoId,
        language: s.language,
        start_date: formatISODateToDDMMYYYY(s.startDate),
        end_date: formatISODateToDDMMYYYY(s.endDate),
        start_time: s.startTime,
        end_time: s.endTime,
        duration_minutes: s.durationMinutes,
        duration_formatted: s.durationFormatted,
        reporting_month: s.reportingMonth,
        submission_date: s.submissionDateFormatted || formatISODateToDDMMYYYY(s.startDate),
        submission_timestamp: s.submissionTimestamp,
        school_name: s.schoolName,
        udise_code: String(s.udiseCode),
        school_type: s.schoolType,
        state: s.state,
        district: s.district,
        block: s.block,
        pin_code: String(s.pinCode),
        session_type: s.sessionType,
        total_classes: s.totalClasses,
        grade: String(d.grade),
        section: String(d.section),
        students_present: d.studentsPresent,
        qa_5: d.questionAScore5,
        qa_4: d.questionAScore4,
        qa_3: d.questionAScore3,
        qa_2: d.questionAScore2,
        qa_1: d.questionAScore1,
        qa_total: d.questionATotal,
        qa_weighted: d.questionAWeightedScore,
        csat: d.csat === null ? '' : d.csat,
        qb_5: d.questionBScore5,
        qb_4: d.questionBScore4,
        qb_3: d.questionBScore3,
        qb_2: d.questionBScore2,
        qb_1: d.questionBScore1,
        qb_total: d.questionBTotal,
        qb_weighted: d.questionBWeightedScore,
        itp: d.itp === null ? '' : d.itp,
        overall_csat: s.overallCsat === null ? '' : s.overallCsat,
        overall_itp: s.overallItp === null ? '' : s.overallItp,
        teacher_score: s.teacherScore === null ? '' : s.teacherScore,
        teacher_classification: s.teacherClassification,
        teacher_nps: s.teacherNps,
        submission_status: s.submissionStatus,
      });
    }
  }

  return rows;
}

function guessSourceKey(header: string): {
  sourceKey: string;
  format: ExportColumnSpec['format'];
} {
  const h = header.trim().toLowerCase();
  if (h === 'cc' || h.includes('country')) return { sourceKey: 'cc', format: 'text' };
  if (h.includes('school_year') || h.includes('school year')) return { sourceKey: 'school_year', format: 'text' };
  if (h.includes('partner')) return { sourceKey: 'partner_name', format: 'text' };
  if (h.includes('data_source') || h.includes('data source')) return { sourceKey: 'data_source', format: 'text' };
  if (h.includes('completion')) return { sourceKey: 'completion_rate', format: 'number' };
  if (h.includes('underserved')) return { sourceKey: 'underserved_reach', format: 'text' };
  if (h.includes('educator')) return { sourceKey: 'educator_id', format: 'text' };
  if (h.includes('session_id') || h === 'session id') return { sourceKey: 'session_id', format: 'text' };
  if (h.includes('video_id') || h === 'video id') return { sourceKey: 'video_id', format: 'text' };
  if (h.includes('udise')) return { sourceKey: 'udise_code', format: 'text' };
  if (h.includes('pin')) return { sourceKey: 'pin_code', format: 'text' };
  if (h.includes('district')) return { sourceKey: 'district', format: 'text' };
  if (h.includes('block')) return { sourceKey: 'block', format: 'text' };
  if (h === 'state') return { sourceKey: 'state', format: 'text' };
  if (h.includes('school_name') || h === 'school name') return { sourceKey: 'school_name', format: 'text' };
  if (h.includes('school_type') || h.includes('school type') || h.includes('kind of school')) {
    return { sourceKey: 'school_type', format: 'text' };
  }
  if (h.includes('facilitator') && h.includes('email')) return { sourceKey: 'facilitator_email', format: 'text' };
  if (h.includes('facilitator')) return { sourceKey: 'facilitator_name', format: 'text' };
  if (h.includes('language')) return { sourceKey: 'language', format: 'text' };
  if (h.includes('start_date') || h.includes('start date')) return { sourceKey: 'start_date', format: 'date_ddmmyyyy' };
  if (h.includes('end_date') || h.includes('end date')) return { sourceKey: 'end_date', format: 'date_ddmmyyyy' };
  if (h.includes('submission')) return { sourceKey: 'submission_date', format: 'date_ddmmyyyy' };
  if (h === 'month' || h.includes('reporting_month')) return { sourceKey: 'reporting_month', format: 'text' };
  if (h === 'grade' || h.includes('class')) return { sourceKey: 'grade', format: 'text' };
  if (h === 'section') return { sourceKey: 'section', format: 'text' };
  if (h.includes('present')) return { sourceKey: 'students_present', format: 'number' };
  if (h === 'csat' || h.includes('csat_avg')) return { sourceKey: 'csat', format: 'decimal2' };
  if (h === 'itp' || h.includes('itp_avg')) return { sourceKey: 'itp', format: 'decimal2' };
  if (h.includes('nps')) return { sourceKey: 'teacher_nps', format: 'number' };
  return { sourceKey: '', format: 'text' };
}

/**
 * Parses an official 63-column Excel template (.xlsx) uploaded by the Super Administrator.
 * Strictly validates that the header row has exactly 63 columns and preserves exact spelling & order.
 */
export async function parseOfficial63TemplateXlsx(
  fileBuffer: ArrayBuffer,
  templateName: string,
  uploadedBy: string,
): Promise<{ ok: true; schema: ExportTemplateSchema } | { ok: false; error: string }> {
  try {
    const ExcelJS = await loadExcelJS();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      return { ok: false, error: 'Workbook contains no worksheets.' };
    }

    const headerRow = sheet.getRow(1);
    const headers: string[] = [];
    for (let col = 1; col <= Math.max(headerRow.cellCount, 63); col++) {
      const val = headerRow.getCell(col).text?.trim() ?? '';
      if (col <= 63) {
        headers.push(val);
      } else if (val !== '') {
        headers.push(val);
      }
    }

    if (headers.length !== 63 || headers.some((h) => h === '')) {
      return {
        ok: false,
        error: `Template validation failed: expected exactly 63 non-empty columns in row 1, found ${headers.filter(Boolean).length} non-empty headers across ${headers.length} columns.`,
      };
    }

    const columns: ExportColumnSpec[] = headers.map((header, i) => {
      const guess = guessSourceKey(header);
      return {
        index: i + 1,
        header,
        sourceKey: guess.sourceKey,
        format: guess.format,
      };
    });

    return {
      ok: true,
      schema: {
        templateName,
        verified: true,
        uploadedAt: new Date().toISOString(),
        uploadedBy,
        columns,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unable to read .xlsx file.',
    };
  }
}

export async function generateExportWorkbookBuffer(
  sessions: SessionRecord[],
  config: AppConfiguration,
  mode: 'official_63' | 'standard' = 'official_63',
): Promise<{
  buffer: ArrayBuffer;
  rowCount: number;
  columnCount: number;
  usedOfficial63Schema: boolean;
}> {
  const flatRows = buildFlattenedExportRows(sessions, config);
  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Career Tours Classroom Management System';
  workbook.created = new Date();

  const use63 =
    mode === 'official_63' &&
    Boolean(config.exportTemplate63 && config.exportTemplate63.columns.length === 63);

  const worksheet = workbook.addWorksheet('Career Tours Data', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  if (use63 && config.exportTemplate63) {
    const specs = [...config.exportTemplate63.columns].sort((a, b) => a.index - b.index);
    worksheet.addRow(specs.map((c) => c.header));

    for (const row of flatRows) {
      const values = specs.map((spec) => {
        if (spec.format === 'constant') {
          return spec.constantValue ?? '';
        }
        if (!spec.sourceKey) {
          return '';
        }
        const raw = (row as unknown as Record<string, unknown>)[spec.sourceKey];
        if (raw === undefined || raw === null) return '';
        if (spec.format === 'text' || spec.sourceKey === 'udise_code' || spec.sourceKey === 'pin_code') {
          return String(raw);
        }
        return raw;
      });
      const added = worksheet.addRow(values);
      specs.forEach((spec, idx) => {
        const cell = added.getCell(idx + 1);
        if (spec.sourceKey === 'udise_code' || spec.sourceKey === 'pin_code' || spec.format === 'text') {
          cell.numFmt = '@';
        } else if (spec.format === 'decimal2' && typeof cell.value === 'number') {
          cell.numFmt = '0.00';
        }
      });
    }

    worksheet.getRow(1).font = { bold: true };
    const buffer = await workbook.xlsx.writeBuffer();
    return {
      buffer: buffer as ArrayBuffer,
      rowCount: flatRows.length,
      columnCount: 63,
      usedOfficial63Schema: true,
    };
  }

  // Standard full workbook export (used until official 63-column template headers are imported by Admin)
  const standardCols = KNOWN_EXPORT_SOURCE_KEYS;
  worksheet.addRow(standardCols.map((c) => c.label));

  for (const row of flatRows) {
    const added = worksheet.addRow(standardCols.map((c) => row[c.key] ?? ''));
    standardCols.forEach((c, idx) => {
      const cell = added.getCell(idx + 1);
      if (c.key === 'udise_code' || c.key === 'pin_code') {
        cell.numFmt = '@';
      } else if ((c.key === 'csat' || c.key === 'itp' || c.key === 'overall_csat' || c.key === 'overall_itp') && typeof cell.value === 'number') {
        cell.numFmt = '0.00';
      }
    });
  }

  worksheet.getRow(1).font = { bold: true };
  standardCols.forEach((c, idx) => {
    worksheet.getColumn(idx + 1).width = Math.max(14, c.label.length + 4);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    buffer: buffer as ArrayBuffer,
    rowCount: flatRows.length,
    columnCount: standardCols.length,
    usedOfficial63Schema: false,
  };
}

export async function generateInitializedDatabaseWorkbookBuffer(params: {
  sessions: SessionRecord[];
  config: AppConfiguration;
  users?: ManagedUser[];
  schools?: SchoolRecord[];
}): Promise<{ buffer: ArrayBuffer; tabsCount: number; rowCount: number }> {
  const { sessions, config, users = [], schools = [] } = params;
  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Vidhya Vidhai · Career Tours Classroom System';
  workbook.created = new Date();

  const styleHeaderRow = (ws: { getRow: (r: number) => { font: unknown; eachCell: (cb: (cell: { fill: unknown; font: unknown }) => void) => void } }) => {
    const headerRow = ws.getRow(1);
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF171C24' },
      };
      cell.font = { bold: true, color: { argb: 'FFF5F6F7' } };
    });
  };

  // 1. Sessions (42 columns matching SetupDatabase.gs)
  const sessionsWs = workbook.addWorksheet('Sessions', { views: [{ state: 'frozen', ySplit: 1 }] });
  const sessionsHeaders = [
    'session_record_id',
    'session_id',
    'client_submission_key',
    'facilitator_name',
    'facilitator_email',
    'facilitator_user_id',
    'tour_id',
    'tour_name',
    'video_id',
    'language',
    'start_date',
    'end_date',
    'start_time',
    'end_time',
    'duration_minutes',
    'duration_formatted',
    'reporting_month',
    'submission_timestamp',
    'submission_date_formatted',
    'school_name',
    'udise_code',
    'school_type',
    'state',
    'district',
    'block',
    'pin_code',
    'session_type',
    'total_classes',
    'total_students_present',
    'total_qa_responses',
    'total_qb_responses',
    'overall_csat',
    'overall_itp',
    'teacher_score',
    'teacher_classification',
    'teacher_nps',
    'submission_status',
    'created_at',
    'updated_at',
    'created_by',
    'updated_by',
    'archived',
  ];
  sessionsWs.addRow(sessionsHeaders);
  styleHeaderRow(sessionsWs);
  const sessionTextCols = new Set([1, 2, 3, 11, 12, 13, 14, 18, 19, 21, 26, 37, 38, 39, 42]);
  for (const s of sessions) {
    const row = sessionsWs.addRow([
      s.sessionRecordId,
      s.sessionId,
      s.clientSubmissionKey,
      s.facilitatorName,
      s.facilitatorEmail,
      s.facilitatorUserId,
      s.tourId,
      s.tourName,
      s.videoId,
      s.language,
      s.startDate,
      s.endDate,
      s.startTime,
      s.endTime,
      s.durationMinutes,
      s.durationFormatted,
      s.reportingMonth,
      s.submissionTimestamp,
      s.submissionDateFormatted,
      s.schoolName,
      String(s.udiseCode),
      s.schoolType,
      s.state,
      s.district,
      s.block,
      String(s.pinCode),
      s.sessionType,
      s.totalClasses,
      s.totalStudentsPresent,
      s.totalQuestionAResponses,
      s.totalQuestionBResponses,
      s.overallCsat ?? '',
      s.overallItp ?? '',
      s.teacherScore ?? '',
      s.teacherClassification,
      s.teacherNps,
      s.submissionStatus,
      s.createdAt,
      s.updatedAt,
      s.createdBy,
      s.updatedBy,
      s.archived ? 'true' : 'false',
    ]);
    sessionTextCols.forEach((colIdx) => {
      row.getCell(colIdx).numFmt = '@';
    });
  }

  // 2. Session Details (24 columns)
  const detailsWs = workbook.addWorksheet('Session Details', { views: [{ state: 'frozen', ySplit: 1 }] });
  detailsWs.addRow([
    'detail_record_id',
    'session_record_id',
    'session_id',
    'grade',
    'section',
    'students_present',
    'qa_score_5',
    'qa_score_4',
    'qa_score_3',
    'qa_score_2',
    'qa_score_1',
    'qa_total',
    'qa_weighted_score',
    'csat',
    'qb_score_5',
    'qb_score_4',
    'qb_score_3',
    'qb_score_2',
    'qb_score_1',
    'qb_total',
    'qb_weighted_score',
    'itp',
    'created_at',
    'updated_at',
  ]);
  styleHeaderRow(detailsWs);
  for (const s of sessions) {
    for (const d of s.details || []) {
      const row = detailsWs.addRow([
        d.detailRecordId,
        d.sessionRecordId,
        d.sessionId,
        String(d.grade),
        String(d.section),
        d.studentsPresent,
        d.questionAScore5,
        d.questionAScore4,
        d.questionAScore3,
        d.questionAScore2,
        d.questionAScore1,
        d.questionATotal,
        d.questionAWeightedScore,
        d.csat ?? '',
        d.questionBScore5,
        d.questionBScore4,
        d.questionBScore3,
        d.questionBScore2,
        d.questionBScore1,
        d.questionBTotal,
        d.questionBWeightedScore,
        d.itp ?? '',
        d.createdAt,
        d.updatedAt,
      ]);
      [1, 2, 3, 4, 5].forEach((cIdx) => {
        row.getCell(cIdx).numFmt = '@';
      });
    }
  }

  // 3. Facilitators
  const facWs = workbook.addWorksheet('Facilitators', { views: [{ state: 'frozen', ySplit: 1 }] });
  facWs.addRow(['user_id', 'name', 'email', 'role', 'active', 'created_at', 'updated_at', 'status']);
  styleHeaderRow(facWs);
  for (const u of users.filter((usr) => usr.role === 'facilitator')) {
    const r = facWs.addRow([
      u.userId,
      u.name,
      u.email,
      'facilitator',
      u.active ? 'true' : 'false',
      u.createdAt,
      u.updatedAt,
      u.status ?? (u.active ? 'APPROVED' : 'DENIED'),
    ]);
    [1, 3, 4, 5, 8].forEach((cIdx) => {
      r.getCell(cIdx).numFmt = '@';
    });
  }

  // 4. Schools
  const schoolsWs = workbook.addWorksheet('Schools', { views: [{ state: 'frozen', ySplit: 1 }] });
  schoolsWs.addRow([
    'school_record_id',
    'school_name',
    'udise_code',
    'school_type',
    'state',
    'district',
    'block',
    'pin_code',
    'active',
    'created_at',
    'updated_at',
  ]);
  styleHeaderRow(schoolsWs);
  for (const sc of schools) {
    const r = schoolsWs.addRow([
      sc.schoolRecordId,
      sc.schoolName,
      String(sc.udiseCode),
      sc.schoolType,
      sc.state,
      sc.district,
      sc.block,
      String(sc.pinCode),
      sc.active ? 'true' : 'false',
      sc.createdAt,
      sc.updatedAt,
    ]);
    [1, 3, 8, 9].forEach((cIdx) => {
      r.getCell(cIdx).numFmt = '@';
    });
  }

  // 5. Configuration
  const cfgWs = workbook.addWorksheet('Configuration', { views: [{ state: 'frozen', ySplit: 1 }] });
  cfgWs.addRow(['config_key', 'config_value_json', 'updated_at', 'updated_by']);
  styleHeaderRow(cfgWs);
  const nowIso = new Date().toISOString();
  const cfgPairs: Array<[string, unknown]> = [
    ['programme_timezone', config.programmeTimezone],
    ['state_name', config.stateName],
    ['allowed_districts', config.allowedDistricts],
    ['district_blocks', config.districtBlocks],
    ['grade_options', config.gradeOptions],
    ['section_options', config.sectionOptions],
    ['school_types', config.schoolTypes],
    ['tours', config.tours],
    ['language_options', config.languageOptions],
    ['language_codes', config.languageCodes],
    ['school_year', config.schoolYear],
    ['partner_name', config.partnerName],
    ['reporting_defaults', config.reportingDefaults],
    ['policy', config.policy],
  ];
  for (const [k, v] of cfgPairs) {
    const r = cfgWs.addRow([k, JSON.stringify(v), nowIso, 'SYSTEM_EXPORT']);
    [1, 2, 3, 4].forEach((cIdx) => {
      r.getCell(cIdx).numFmt = '@';
    });
  }

  // 6. Admin Users
  const adminWs = workbook.addWorksheet('Admin Users', { views: [{ state: 'frozen', ySplit: 1 }] });
  adminWs.addRow(['user_id', 'name', 'email', 'role', 'active', 'created_at', 'updated_at', 'status']);
  styleHeaderRow(adminWs);
  for (const sa of INITIAL_SUPER_ADMINS) {
    const r = adminWs.addRow([
      sa.userId,
      sa.name,
      sa.email,
      'super_admin',
      'true',
      nowIso,
      nowIso,
      'APPROVED',
    ]);
    [1, 3, 4, 5, 8].forEach((cIdx) => {
      r.getCell(cIdx).numFmt = '@';
    });
  }

  // 7. Audit Log
  const auditWs = workbook.addWorksheet('Audit Log', { views: [{ state: 'frozen', ySplit: 1 }] });
  auditWs.addRow([
    'audit_id',
    'timestamp',
    'user_id',
    'user_email',
    'action',
    'entity_type',
    'entity_id',
    'previous_summary',
    'new_summary',
    'result',
  ]);
  styleHeaderRow(auditWs);

  // 8. Sync Log
  const syncWs = workbook.addWorksheet('Sync Log', { views: [{ state: 'frozen', ySplit: 1 }] });
  syncWs.addRow([
    'sync_id',
    'timestamp',
    'client_submission_key',
    'session_record_id',
    'session_id',
    'actor_email',
    'operation',
    'attempt',
    'status',
    'error_message',
  ]);
  styleHeaderRow(syncWs);

  workbook.worksheets.forEach((ws) => {
    ws.columns.forEach((col) => {
      col.width = Math.max(16, col.width || 16);
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    buffer: buffer as ArrayBuffer,
    tabsCount: 8,
    rowCount: sessions.length,
  };
}

export function triggerXlsxDownload(buffer: ArrayBuffer, filename: string): void {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

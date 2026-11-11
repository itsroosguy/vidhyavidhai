import type ExcelJS from 'exceljs';
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
import {
  AUXILIARY_TAB_SCHEMAS,
  SESSION_COLUMN_META,
  SESSION_DETAIL_COLUMN_META,
  STANDARD_EXPORT_FIELD_DECLARATIONS,
  buildProgrammeDeclarationItems,
  getExportColumnDeclaration,
  type WorkbookColumnMeta,
} from './workbookSchemaMetadata';

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

export const KNOWN_EXPORT_SOURCE_KEYS: Array<{ key: keyof FlattenedExportRow; label: string }> =
  STANDARD_EXPORT_FIELD_DECLARATIONS.map((item) => ({
    key: item.sourceKey as keyof FlattenedExportRow,
    label: item.header,
  }));

export function colIndexToLetter(colIdx: number): string {
  let num = colIdx;
  let letters = '';
  while (num > 0) {
    const rem = (num - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    num = Math.floor((num - 1) / 26);
  }
  return letters || 'A';
}

const THIN_GRID_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFD7CFC0' } },
  left: { style: 'thin', color: { argb: 'FFD7CFC0' } },
  bottom: { style: 'thin', color: { argb: 'FFD7CFC0' } },
  right: { style: 'thin', color: { argb: 'FFD7CFC0' } },
};

const HEADER_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF334155' } },
  left: { style: 'thin', color: { argb: 'FF334155' } },
  right: { style: 'thin', color: { argb: 'FF334155' } },
  bottom: { style: 'medium', color: { argb: 'FF1EA7FF' } },
};

const VALIDATION_ROW_CAP = 500;
const FORMULA_SCAN_MAX_ROW = 2500;

function sanitizeListFormulaValues(items: string[]): string | null {
  const cleaned = items
    .map((v) => v.replace(/"/g, '').trim())
    .filter((v, i, arr) => v.length > 0 && arr.indexOf(v) === i);
  if (cleaned.length === 0) return null;
  const literal = `"${cleaned.join(',')}"`;
  return literal.length <= 250 ? literal : null;
}

function getDropdownConfigForColumn(
  columnKey: string,
  config: AppConfiguration,
): { list: string[]; title: string; prompt: string } | null {
  const key = columnKey.toLowerCase();
  if (key === 'district') {
    return {
      list: config.allowedDistricts,
      title: 'Approved District',
      prompt: `Select one approved Tamil Nadu district: ${config.allowedDistricts.join(', ')}.`,
    };
  }
  if (key === 'language') {
    return {
      list: config.languageOptions,
      title: 'Delivery Language',
      prompt: 'Choose a configured instructional language.',
    };
  }
  if (key === 'grade') {
    return {
      list: config.gradeOptions,
      title: 'Grade Level',
      prompt: `Allowed grades: ${config.gradeOptions.join(', ')}.`,
    };
  }
  if (key === 'section') {
    return {
      list: config.sectionOptions,
      title: 'Section',
      prompt: 'Choose class section or "No section".',
    };
  }
  if (key === 'school_type') {
    return {
      list: config.schoolTypes,
      title: 'School Management Type',
      prompt: 'Select canonical school management category.',
    };
  }
  if (key === 'session_type') {
    return {
      list: ['single', 'combined'],
      title: 'Session Type',
      prompt: 'single = 1 class/section; combined = multi-class expansion.',
    };
  }
  if (key === 'submission_status') {
    return {
      list: ['COMMITTED', 'CORRECTED', 'PENDING'],
      title: 'Submission Status',
      prompt: 'Two-phase lock status. Only COMMITTED & CORRECTED enter reporting.',
    };
  }
  if (key === 'archived' || key === 'active') {
    return {
      list: ['true', 'false'],
      title: 'Boolean Flag',
      prompt: 'Plain text boolean string ("true" or "false").',
    };
  }
  if (key === 'status') {
    return {
      list: ['APPROVED', 'PENDING', 'DENIED'],
      title: 'Status',
      prompt: 'Allowlist approval or sync status.',
    };
  }
  if (key === 'teacher_classification') {
    return {
      list: ['Promoter', 'Passive', 'Detractor'],
      title: 'Teacher NPS Classification',
      prompt: 'Promoter (9–10), Passive (7–8), Detractor (0–6).',
    };
  }
  if (key === 'underserved_reach') {
    return {
      list: ['Yes', 'No'],
      title: 'Underserved Reach',
      prompt: 'Reporting flag for underserved student cohorts.',
    };
  }
  if (key === 'data_source') {
    return {
      list: ['Manual', 'Imported'],
      title: 'Data Source',
      prompt: 'Capture channel indicator.',
    };
  }
  return null;
}

interface ColumnFormatDescriptor {
  keyForValidation: string;
  header: string;
  displayTitle: string;
  dataType: string;
  validationRule: string;
  definition: string;
  width: number;
  numFmt?: string;
  align?: 'left' | 'center' | 'right';
  wrapText?: boolean;
  isStatusCol?: boolean;
}

/**
 * Enhances any structured table worksheet with dark styled header row, hover notes,
 * column widths, native AutoFilter, dropdown Data Validations, and Conditional Formatting
 * WITHOUT creating blank cells in empty data rows (preserving exact `ws.rowCount`).
 */
function enhanceTableWorksheet(
  ws: ExcelJS.Worksheet,
  columns: ColumnFormatDescriptor[],
  dataRowCount: number,
  config: AppConfiguration,
): void {
  const headerRow = ws.getRow(1);
  headerRow.height = columns.some((c) => c.header.length > 24) ? 34 : 30;

  columns.forEach((colDesc, idx) => {
    const colIdx = idx + 1;
    const colLetter = colIndexToLetter(colIdx);

    const column = ws.getColumn(colIdx);
    column.width = Math.max(12, Math.min(78, colDesc.width));
    if (colDesc.numFmt) {
      column.numFmt = colDesc.numFmt;
    }
    column.alignment = {
      horizontal: colDesc.align ?? 'left',
      vertical: 'middle',
      wrapText: Boolean(colDesc.wrapText),
    };

    const hCell = headerRow.getCell(colIdx);
    hCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF171C24' },
    };
    hCell.font = {
      name: 'Calibri',
      size: 10,
      bold: true,
      color: { argb: 'FFF8FAFC' },
    };
    hCell.alignment = {
      horizontal: colDesc.align === 'right' ? 'right' : 'left',
      vertical: 'middle',
      wrapText: true,
    };
    hCell.border = HEADER_BORDER;
    hCell.note = {
      texts: [
        { font: { bold: true, size: 10 }, text: `${colDesc.displayTitle} (${colDesc.header})\n` },
        { font: { italic: true, size: 9 }, text: `Type: ${colDesc.dataType} · Rule: ${colDesc.validationRule}\n` },
        { font: { size: 9 }, text: colDesc.definition },
      ],
    };

    // Dropdown validations (2..500)
    const dropdown = getDropdownConfigForColumn(colDesc.keyForValidation, config);
    const dvStore = (ws as unknown as {
      dataValidations?: { add: (address: string, validation: ExcelJS.DataValidation) => void };
    }).dataValidations;
    if (dropdown && dvStore) {
      const listFormula = sanitizeListFormulaValues(dropdown.list);
      if (listFormula) {
        dvStore.add(`${colLetter}2:${colLetter}${VALIDATION_ROW_CAP}`, {
          type: 'list',
          allowBlank: true,
          formulae: [listFormula],
          showInputMessage: true,
          promptTitle: dropdown.title,
          prompt: dropdown.prompt,
        });
      }
    }

    // Status conditional highlighting rules (zero leading '=' inside OOXML formula tags)
    if (
      colDesc.isStatusCol ||
      colDesc.keyForValidation === 'submission_status' ||
      colDesc.keyForValidation === 'status' ||
      colDesc.keyForValidation === 'teacher_classification'
    ) {
      const rangeRef = `${colLetter}2:${colLetter}${VALIDATION_ROW_CAP}`;
      ws.addConditionalFormatting({
        ref: rangeRef,
        rules: [
          {
            type: 'expression',
            priority: 1,
            formulae: [`OR(${colLetter}2="COMMITTED",${colLetter}2="APPROVED",${colLetter}2="SYNCED",${colLetter}2="Promoter")`],
            style: {
              fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFECFDF5' } },
              font: { bold: true, color: { argb: 'FF047857' } },
            },
          },
          {
            type: 'expression',
            priority: 2,
            formulae: [`OR(${colLetter}2="CORRECTED",${colLetter}2="PENDING",${colLetter}2="Passive")`],
            style: {
              fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFFBEB' } },
              font: { bold: true, color: { argb: 'FF92400E' } },
            },
          },
          {
            type: 'expression',
            priority: 3,
            formulae: [`OR(${colLetter}2="DENIED",${colLetter}2="FAILED",${colLetter}2="Detractor")`],
            style: {
              fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFF1F2' } },
              font: { bold: true, color: { argb: 'FFBE123C' } },
            },
          },
        ],
      });
    }
  });

  // Format populated data rows cleanly
  for (let r = 2; r <= dataRowCount + 1; r++) {
    const row = ws.getRow(r);
    const isEven = r % 2 === 0;
    let maxLines = 1;
    columns.forEach((colDesc, idx) => {
      const colIdx = idx + 1;
      const cell = row.getCell(colIdx);
      cell.border = THIN_GRID_BORDER;
      if (isEven) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8FAFC' },
        };
      }
      cell.font = {
        name: 'Calibri',
        size: 10,
        color: { argb: 'FF0A1B2C' },
      };
      if (colDesc.numFmt) {
        cell.numFmt = colDesc.numFmt;
      }
      if (colDesc.wrapText && typeof cell.value === 'string' && colDesc.width > 0) {
        const estimated = Math.ceil(cell.value.length / Math.max(18, colDesc.width - 4));
        if (estimated > maxLines) maxLines = estimated;
      }
    });
    row.height = Math.min(180, Math.max(21, maxLines * 14 + 6));
  }

  // Native AutoFilter on Row 1 spanning all columns (covers empty row 2 when 0 rows so filter arrows work immediately)
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(2, dataRowCount + 1), column: columns.length },
  };

  // Subtle zebra striping via Conditional Formatting for rows appended later
  if (columns.length > 0) {
    const endCol = colIndexToLetter(columns.length);
    ws.addConditionalFormatting({
      ref: `A2:${endCol}${VALIDATION_ROW_CAP}`,
      rules: [
        {
          type: 'expression',
          priority: 10,
          formulae: ['AND(LEN(TRIM($A2))>0,MOD(ROW(),2)=0)'],
          style: {
            fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFF5F8FC' } },
          },
        },
      ],
    });
  }
}

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

function writeSectionBanner(
  ws: ExcelJS.Worksheet,
  title: string,
  colSpan: number,
  bgArgb = 'FF0A1B2C',
  textArgb = 'FFFFFFFF',
): ExcelJS.Row {
  const row = ws.addRow([title]);
  row.height = 24;
  const endCol = colIndexToLetter(colSpan);
  ws.mergeCells(`A${row.number}:${endCol}${row.number}`);
  for (let c = 1; c <= colSpan; c++) {
    const cell = row.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: textArgb } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    cell.border = THIN_GRID_BORDER;
  }
  return row;
}

function writeTableSubHeaders(ws: ExcelJS.Worksheet, headers: string[], alignRightCols: Set<number> = new Set()): ExcelJS.Row {
  const row = ws.addRow(headers);
  row.height = 24;
  headers.forEach((_, idx) => {
    const colIdx = idx + 1;
    const cell = row.getCell(colIdx);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F6FF' } };
    cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF0A1B2C' } };
    cell.alignment = {
      vertical: 'middle',
      horizontal: alignRightCols.has(colIdx) ? 'right' : 'left',
      wrapText: true,
    };
    cell.border = {
      ...THIN_GRID_BORDER,
      bottom: { style: 'medium', color: { argb: 'FF006BB8' } },
    };
  });
  return row;
}

function styleSummaryDataRow(
  row: ExcelJS.Row,
  colCount: number,
  options: {
    zebra?: boolean;
    bold?: boolean;
    totalRow?: boolean;
    formats?: Record<number, string>;
    alignments?: Record<number, 'left' | 'center' | 'right'>;
  } = {},
): void {
  row.height = options.totalRow ? 23 : 21;
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.border = options.totalRow
      ? {
          top: { style: 'medium', color: { argb: 'FF0A1B2C' } },
          bottom: { style: 'double', color: { argb: 'FF0A1B2C' } },
          left: { style: 'thin', color: { argb: 'FFD7CFC0' } },
          right: { style: 'thin', color: { argb: 'FFD7CFC0' } },
        }
      : THIN_GRID_BORDER;

    if (options.totalRow) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F2E9' } };
    } else if (options.zebra) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    }

    cell.font = {
      name: 'Calibri',
      size: 10,
      bold: Boolean(options.bold || options.totalRow),
      color: { argb: 'FF0A1B2C' },
    };
    const numFmt = options.formats?.[c];
    if (numFmt) {
      cell.numFmt = numFmt;
    }
    cell.alignment = {
      vertical: 'middle',
      horizontal: options.alignments?.[c] ?? (c >= 3 ? 'right' : 'left'),
      wrapText: c === 5 || c === 2,
    };
  }
}

function addSummaryAndKpisWorksheet(
  workbook: ExcelJS.Workbook,
  config: AppConfiguration,
  options:
    | { mode: 'database'; sessionCount: number }
    | { mode: 'export'; dataTabName: string; exportCols: Array<{ header: string; sourceKey: string }> },
): void {
  const ws = workbook.addWorksheet('Summary & KPIs', {
    views: [{ state: 'frozen', ySplit: 2 }],
    properties: { showGridLines: true },
  });

  const colWidths = [16, 36, 18, 18, 22, 18, 16, 16, 26];
  colWidths.forEach((w, idx) => {
    ws.getColumn(idx + 1).width = w;
  });

  // Top Title & Scope Declarations Banner
  const titleRow = ws.addRow([
    'Vidhya Vidhai Foundation · Career Tours Programme — Live Summary & KPI Dashboard',
  ]);
  titleRow.height = 30;
  ws.mergeCells('A1:I1');
  for (let c = 1; c <= 9; c++) {
    const cell = titleRow.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF171C24' } };
    cell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFF8FAFC' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  }

  const subRow = ws.addRow([
    `State: ${config.stateName} · Districts: ${config.allowedDistricts.join(', ')} · Year: ${config.schoolYear} · TZ: ${config.programmeTimezone} · Live Formula Totals (Zero Fabricated Rows)`,
  ]);
  subRow.height = 22;
  ws.mergeCells('A2:I2');
  for (let c = 1; c <= 9; c++) {
    const cell = subRow.getCell(c);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F6FF' } };
    cell.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF006BB8' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF0284C7' } } };
  }

  ws.addRow([]).height = 10;

  if (options.mode === 'database') {
    const sHeaders = SESSION_COLUMN_META.map((c) => c.header);
    const dHeaders = SESSION_DETAIL_COLUMN_META.map((c) => c.header);
    const colOf = (headers: string[], name: string) =>
      colIndexToLetter(headers.indexOf(name) + 1);

    const sStatus = colOf(sHeaders, 'submission_status');
    const sArch = colOf(sHeaders, 'archived');
    const sStudents = colOf(sHeaders, 'total_students_present');
    const sDistrict = colOf(sHeaders, 'district');
    const sTourId = colOf(sHeaders, 'tour_id');
    const sLang = colOf(sHeaders, 'language');
    const sCsat = colOf(sHeaders, 'overall_csat');
    const sItp = colOf(sHeaders, 'overall_itp');
    const sNps = colOf(sHeaders, 'teacher_nps');

    const dGrade = colOf(dHeaders, 'grade');
    const dStud = colOf(dHeaders, 'students_present');
    const dQaTot = colOf(dHeaders, 'qa_total');
    const dQaW = colOf(dHeaders, 'qa_weighted_score');
    const dQbTot = colOf(dHeaders, 'qb_total');
    const dQbW = colOf(dHeaders, 'qb_weighted_score');

    const R = FORMULA_SCAN_MAX_ROW;

    // 1. Programme KPI Overview
    writeSectionBanner(ws, '1. Official Programme Key Performance Indicators (Live Formulas)', 5);
    writeTableSubHeaders(
      ws,
      ['Metric Code', 'Programme Indicator', 'Live Value', 'Unit / Scale', 'Formula Declaration'],
      new Set([3]),
    );

    const kpiRows: Array<[string, string, string, string, string, string]> = [
      [
        'KPI-01',
        'Total Committed Sessions',
        `IFERROR(COUNTIFS(Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
        'Sessions',
        '#,##0',
        'Counts Sessions where status <> PENDING and archived = false',
      ],
      [
        'KPI-02',
        'Total Students Reached (Single-Counted)',
        `IFERROR(SUMIFS(Sessions!${sStudents}2:${sStudents}${R},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
        'Students',
        '#,##0',
        'Sum of committed non-archived attendance (zero double counting)',
      ],
      [
        'KPI-03',
        'Total Class Groups Covered',
        `IFERROR(COUNTA('Session Details'!A2:A${R}),0)`,
        'Class rows',
        '#,##0',
        'Expanded grade/section detail rows in Session Details tab',
      ],
      [
        'KPI-04',
        'Registered Canonical Schools',
        `IFERROR(COUNTA(Schools!A2:A${R}),0)`,
        'Schools',
        '#,##0',
        'Unique 11-digit UDISE schools registered in Schools tab',
      ],
      [
        'KPI-05',
        'Approved Facilitators',
        `IFERROR(COUNTIF(Facilitators!H2:H${R},"APPROVED"),0)`,
        'Accounts',
        '#,##0',
        'Approved facilitator rows in Facilitators tab',
      ],
      [
        'KPI-06',
        'Protected / Approved Super Admins',
        `IFERROR(COUNTIF('Admin Users'!H2:H${R},"APPROVED"),0)`,
        'Accounts',
        '#,##0',
        'Approved administrator accounts in Admin Users tab',
      ],
      [
        'KPI-07',
        'Pooled Student CSAT (Q-A Enjoyment)',
        `IFERROR(SUM('Session Details'!${dQaW}2:${dQaW}${R})/SUM('Session Details'!${dQaTot}2:${dQaTot}${R}),0)`,
        '1.00–5.00',
        '0.00',
        'SUM(qa_weighted_score) / SUM(qa_total)',
      ],
      [
        'KPI-08',
        'Pooled Student ITP (Q-B Career Interest)',
        `IFERROR(SUM('Session Details'!${dQbW}2:${dQbW}${R})/SUM('Session Details'!${dQbTot}2:${dQbTot}${R}),0)`,
        '1.00–5.00',
        '0.00',
        'SUM(qb_weighted_score) / SUM(qb_total)',
      ],
      [
        'KPI-09',
        'Pooled Teacher NPS (-100 to +100)',
        `IFERROR(AVERAGEIFS(Sessions!${sNps}2:${sNps}${R},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
        'NPS Index',
        '+#,##0;-#,##0;0',
        'Mean Teacher NPS across committed sessions (+100 / 0 / -100)',
      ],
      [
        'KPI-10',
        'Question A Response Coverage Rate',
        `IFERROR(SUM('Session Details'!${dQaTot}2:${dQaTot}${R})/SUM('Session Details'!${dStud}2:${dStud}${R}),0)`,
        'Percentage',
        '0.0%',
        'SUM(qa_total) / SUM(students_present)',
      ],
    ];

    kpiRows.forEach(([code, label, formula, unit, numFmt, decl], i) => {
      const r = ws.addRow([code, label, { formula, result: 0 }, unit, decl]);
      styleSummaryDataRow(r, 5, {
        zebra: i % 2 === 1,
        bold: i < 2 || i === 6 || i === 7,
        formats: { 3: numFmt },
        alignments: { 1: 'center', 2: 'left', 3: 'right', 4: 'center', 5: 'left' },
      });
    });

    ws.addRow([]).height = 10;

    // 2. Approved District Matrix
    writeSectionBanner(ws, '2. Approved District-wise Programme Reach (Tamil Nadu)', 7);
    writeTableSubHeaders(
      ws,
      ['District', 'State', 'Sessions', 'Students Reached', 'Avg CSAT', 'Avg ITP', 'Avg Teacher NPS'],
      new Set([3, 4, 5, 6, 7]),
    );

    const distStartRow = ws.rowCount + 1;
    config.allowedDistricts.forEach((dist, idx) => {
      const r = ws.addRow([
        dist,
        config.stateName,
        {
          formula: `IFERROR(COUNTIFS(Sessions!${sDistrict}2:${sDistrict}${R},A${distStartRow + idx},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
          result: 0,
        },
        {
          formula: `IFERROR(SUMIFS(Sessions!${sStudents}2:${sStudents}${R},Sessions!${sDistrict}2:${sDistrict}${R},A${distStartRow + idx},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
          result: 0,
        },
        {
          formula: `IFERROR(AVERAGEIFS(Sessions!${sCsat}2:${sCsat}${R},Sessions!${sDistrict}2:${sDistrict}${R},A${distStartRow + idx},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
          result: 0,
        },
        {
          formula: `IFERROR(AVERAGEIFS(Sessions!${sItp}2:${sItp}${R},Sessions!${sDistrict}2:${sDistrict}${R},A${distStartRow + idx},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
          result: 0,
        },
        {
          formula: `IFERROR(AVERAGEIFS(Sessions!${sNps}2:${sNps}${R},Sessions!${sDistrict}2:${sDistrict}${R},A${distStartRow + idx},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
          result: 0,
        },
      ]);
      styleSummaryDataRow(r, 7, {
        zebra: idx % 2 === 1,
        formats: { 3: '#,##0', 4: '#,##0', 5: '0.00', 6: '0.00', 7: '+#,##0;-#,##0;0' },
        alignments: { 1: 'left', 2: 'center', 3: 'right', 4: 'right', 5: 'right', 6: 'right', 7: 'right' },
      });
    });

    const distEndRow = Math.max(distStartRow, distStartRow + config.allowedDistricts.length - 1);
    const distTotRow = ws.addRow([
      'Total / Pooled',
      config.stateName,
      { formula: `SUM(C${distStartRow}:C${distEndRow})`, result: 0 },
      { formula: `SUM(D${distStartRow}:D${distEndRow})`, result: 0 },
      { formula: `IFERROR(SUM('Session Details'!${dQaW}2:${dQaW}${R})/SUM('Session Details'!${dQaTot}2:${dQaTot}${R}),0)`, result: 0 },
      { formula: `IFERROR(SUM('Session Details'!${dQbW}2:${dQbW}${R})/SUM('Session Details'!${dQbTot}2:${dQbTot}${R}),0)`, result: 0 },
      { formula: `IFERROR(AVERAGEIFS(Sessions!${sNps}2:${sNps}${R},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`, result: 0 },
    ]);
    styleSummaryDataRow(distTotRow, 7, {
      totalRow: true,
      formats: { 3: '#,##0', 4: '#,##0', 5: '0.00', 6: '0.00', 7: '+#,##0;-#,##0;0' },
      alignments: { 1: 'left', 2: 'center', 3: 'right', 4: 'right', 5: 'right', 6: 'right', 7: 'right' },
    });

    ws.addRow([]).height = 10;

    // 3. Official Career Tours Catalog
    writeSectionBanner(ws, '3. Official Career Tours Catalog & Delivery Breakdown', 8);
    writeTableSubHeaders(
      ws,
      ['Tour ID', 'Career Tour Name', 'Code', 'Active', 'Tamil Video ID', 'Sessions', 'Students Reached', 'Avg CSAT'],
      new Set([6, 7, 8]),
    );
    const tourStartRow = ws.rowCount + 1;
    config.tours.forEach((tour, idx) => {
      const r = ws.addRow([
        tour.tourId,
        tour.tourName,
        tour.tourCode,
        tour.active ? 'Active' : 'Inactive',
        tour.videoIdByLanguage?.Tamil || 'Pending',
        {
          formula: `IFERROR(COUNTIFS(Sessions!${sTourId}2:${sTourId}${R},A${tourStartRow + idx},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
          result: 0,
        },
        {
          formula: `IFERROR(SUMIFS(Sessions!${sStudents}2:${sStudents}${R},Sessions!${sTourId}2:${sTourId}${R},A${tourStartRow + idx},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
          result: 0,
        },
        {
          formula: `IFERROR(AVERAGEIFS(Sessions!${sCsat}2:${sCsat}${R},Sessions!${sTourId}2:${sTourId}${R},A${tourStartRow + idx},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
          result: 0,
        },
      ]);
      styleSummaryDataRow(r, 8, {
        zebra: idx % 2 === 1,
        formats: { 6: '#,##0', 7: '#,##0', 8: '0.00' },
        alignments: { 1: 'center', 2: 'left', 3: 'center', 4: 'center', 5: 'left', 6: 'right', 7: 'right', 8: 'right' },
      });
    });

    ws.addRow([]).height = 10;

    // 4. Grade Breakdown
    writeSectionBanner(ws, '4. Grade-wise Classroom Coverage (Session Details)', 6);
    writeTableSubHeaders(
      ws,
      ['Grade', 'Label', 'Class Rows', 'Students Present', 'Pooled CSAT', 'Pooled ITP'],
      new Set([3, 4, 5, 6]),
    );
    const gStart = ws.rowCount + 1;
    config.gradeOptions.forEach((grade, idx) => {
      const rNum = gStart + idx;
      const r = ws.addRow([
        grade,
        `Grade ${grade}`,
        { formula: `IFERROR(COUNTIF('Session Details'!${dGrade}2:${dGrade}${R},A${rNum}),0)`, result: 0 },
        { formula: `IFERROR(SUMIF('Session Details'!${dGrade}2:${dGrade}${R},A${rNum},'Session Details'!${dStud}2:${dStud}${R}),0)`, result: 0 },
        { formula: `IFERROR(SUMIF('Session Details'!${dGrade}2:${dGrade}${R},A${rNum},'Session Details'!${dQaW}2:${dQaW}${R})/SUMIF('Session Details'!${dGrade}2:${dGrade}${R},A${rNum},'Session Details'!${dQaTot}2:${dQaTot}${R}),0)`, result: 0 },
        { formula: `IFERROR(SUMIF('Session Details'!${dGrade}2:${dGrade}${R},A${rNum},'Session Details'!${dQbW}2:${dQbW}${R})/SUMIF('Session Details'!${dGrade}2:${dGrade}${R},A${rNum},'Session Details'!${dQbTot}2:${dQbTot}${R}),0)`, result: 0 },
      ]);
      styleSummaryDataRow(r, 6, {
        zebra: idx % 2 === 1,
        formats: { 3: '#,##0', 4: '#,##0', 5: '0.00', 6: '0.00' },
        alignments: { 1: 'center', 2: 'left', 3: 'right', 4: 'right', 5: 'right', 6: 'right' },
      });
    });

    ws.addRow([]).height = 10;

    // 5. Language Distribution
    writeSectionBanner(ws, '5. Language-wise Programme Delivery', 5);
    writeTableSubHeaders(
      ws,
      ['Code', 'Delivery Language', 'Sessions', 'Students Reached', 'Avg CSAT'],
      new Set([3, 4, 5]),
    );
    const lStart = ws.rowCount + 1;
    config.languageOptions.forEach((lang, idx) => {
      const rNum = lStart + idx;
      const r = ws.addRow([
        config.languageCodes[lang] || lang.slice(0, 2).toUpperCase(),
        lang,
        { formula: `IFERROR(COUNTIFS(Sessions!${sLang}2:${sLang}${R},B${rNum},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`, result: 0 },
        { formula: `IFERROR(SUMIFS(Sessions!${sStudents}2:${sStudents}${R},Sessions!${sLang}2:${sLang}${R},B${rNum},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`, result: 0 },
        { formula: `IFERROR(AVERAGEIFS(Sessions!${sCsat}2:${sCsat}${R},Sessions!${sLang}2:${sLang}${R},B${rNum},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`, result: 0 },
      ]);
      styleSummaryDataRow(r, 5, {
        zebra: idx % 2 === 1,
        formats: { 3: '#,##0', 4: '#,##0', 5: '0.00' },
        alignments: { 1: 'center', 2: 'left', 3: 'right', 4: 'right', 5: 'right' },
      });
    });
  } else {
    // Export Workbook mode -> Formulas point strictly at 'Career Tours Data'!
    const tab = `'${options.dataTabName}'`;
    const findCol = (key: string) => {
      const idx = options.exportCols.findIndex((c) => c.sourceKey === key);
      return idx >= 0 ? colIndexToLetter(idx + 1) : '';
    };

    const cSessId = findCol('session_id') || 'A';
    const cDist = findCol('district');
    const cTourId = findCol('tour_id');
    const cLang = findCol('language');
    const cGrade = findCol('grade');
    const cStud = findCol('students_present');
    const cQaTot = findCol('qa_total');
    const cQaW = findCol('qa_weighted');
    const cCsat = findCol('csat');
    const cQbTot = findCol('qb_total');
    const cQbW = findCol('qb_weighted');
    const cItp = findCol('itp');
    const cNps = findCol('teacher_nps');
    const R = FORMULA_SCAN_MAX_ROW;

    writeSectionBanner(ws, '1. Official Export Summary KPIs (Live Formulas referencing Career Tours Data)', 5);
    writeTableSubHeaders(
      ws,
      ['Metric Code', 'Programme Indicator', 'Live Value', 'Unit / Scale', 'Formula Declaration'],
      new Set([3]),
    );

    const kpiRows: Array<[string, string, string, string, string, string]> = [
      [
        'EXP-01',
        'Expanded Class Rows in Export',
        `IFERROR(COUNTA(${tab}!${cSessId}2:${cSessId}${R}),0)`,
        'Class rows',
        '#,##0',
        '1 row per grade/section in combined sessions',
      ],
      [
        'EXP-02',
        'Unique Classroom Sessions',
        `IFERROR(SUMPRODUCT((${tab}!${cSessId}2:${cSessId}1000<>"")/COUNTIF(${tab}!${cSessId}2:${cSessId}1000,${tab}!${cSessId}2:${cSessId}1000&"")),0)`,
        'Sessions',
        '#,##0',
        'Distinct Session IDs in Career Tours Data',
      ],
      [
        'EXP-03',
        'Total Students Present (Single-Counted)',
        cStud ? `IFERROR(SUM(${tab}!${cStud}2:${cStud}${R}),0)` : '0',
        'Students',
        '#,##0',
        cStud ? 'Sum of per-class students_present column' : 'students_present unmapped in 63-col template',
      ],
      [
        'EXP-04',
        'Pooled Student CSAT (Q-A)',
        cQaW && cQaTot
          ? `IFERROR(SUM(${tab}!${cQaW}2:${cQaW}${R})/SUM(${tab}!${cQaTot}2:${cQaTot}${R}),0)`
          : cCsat
            ? `IFERROR(AVERAGE(${tab}!${cCsat}2:${cCsat}${R}),0)`
            : '0',
        '1.00–5.00',
        '0.00',
        cQaW && cQaTot ? 'Weighted numerator / total responses' : 'Mean Class CSAT column',
      ],
      [
        'EXP-05',
        'Pooled Student ITP (Q-B)',
        cQbW && cQbTot
          ? `IFERROR(SUM(${tab}!${cQbW}2:${cQbW}${R})/SUM(${tab}!${cQbTot}2:${cQbTot}${R}),0)`
          : cItp
            ? `IFERROR(AVERAGE(${tab}!${cItp}2:${cItp}${R}),0)`
            : '0',
        '1.00–5.00',
        '0.00',
        cQbW && cQbTot ? 'Weighted numerator / total responses' : 'Mean Class ITP column',
      ],
      [
        'EXP-06',
        'Average Teacher NPS (-100 to +100)',
        cNps ? `IFERROR(AVERAGE(${tab}!${cNps}2:${cNps}${R}),0)` : '0',
        'NPS Index',
        '+#,##0;-#,##0;0',
        cNps ? 'Average Teacher NPS across exported rows' : 'teacher_nps unmapped',
      ],
    ];

    kpiRows.forEach(([code, label, formula, unit, numFmt, decl], i) => {
      const r = ws.addRow([
        code,
        label,
        formula === '0' ? 0 : { formula, result: 0 },
        unit,
        decl,
      ]);
      styleSummaryDataRow(r, 5, {
        zebra: i % 2 === 1,
        bold: i < 3,
        formats: { 3: numFmt },
        alignments: { 1: 'center', 2: 'left', 3: 'right', 4: 'center', 5: 'left' },
      });
    });

    ws.addRow([]).height = 10;

    // 2. Approved Districts
    writeSectionBanner(ws, '2. Approved District Breakdown (Export Scope)', 5);
    writeTableSubHeaders(
      ws,
      ['District', 'State', 'Export Rows', 'Students Present', 'Avg CSAT'],
      new Set([3, 4, 5]),
    );
    const dStart = ws.rowCount + 1;
    config.allowedDistricts.forEach((dist, idx) => {
      const rNum = dStart + idx;
      const r = ws.addRow([
        dist,
        config.stateName,
        cDist ? { formula: `IFERROR(COUNTIF(${tab}!${cDist}2:${cDist}${R},A${rNum}),0)`, result: 0 } : 0,
        cDist && cStud ? { formula: `IFERROR(SUMIF(${tab}!${cDist}2:${cDist}${R},A${rNum},${tab}!${cStud}2:${cStud}${R}),0)`, result: 0 } : 0,
        cDist && cCsat ? { formula: `IFERROR(AVERAGEIF(${tab}!${cDist}2:${cDist}${R},A${rNum},${tab}!${cCsat}2:${cCsat}${R}),0)`, result: 0 } : 0,
      ]);
      styleSummaryDataRow(r, 5, {
        zebra: idx % 2 === 1,
        formats: { 3: '#,##0', 4: '#,##0', 5: '0.00' },
        alignments: { 1: 'left', 2: 'center', 3: 'right', 4: 'right', 5: 'right' },
      });
    });

    if (cGrade || cLang || cTourId) {
      ws.addRow([]).height = 10;
      writeSectionBanner(ws, '3. Grade & Language Export Distribution', 5);
      writeTableSubHeaders(
        ws,
        ['Dimension', 'Category Value', 'Class Rows', 'Students Present', 'Avg CSAT'],
        new Set([3, 4, 5]),
      );
      let rowToggle = 0;
      if (cGrade) {
        for (const grade of config.gradeOptions) {
          const rNum = ws.rowCount + 1;
          const r = ws.addRow([
            'Grade',
            grade,
            { formula: `IFERROR(COUNTIF(${tab}!${cGrade}2:${cGrade}${R},B${rNum}),0)`, result: 0 },
            cStud ? { formula: `IFERROR(SUMIF(${tab}!${cGrade}2:${cGrade}${R},B${rNum},${tab}!${cStud}2:${cStud}${R}),0)`, result: 0 } : 0,
            cCsat ? { formula: `IFERROR(AVERAGEIF(${tab}!${cGrade}2:${cGrade}${R},B${rNum},${tab}!${cCsat}2:${cCsat}${R}),0)`, result: 0 } : 0,
          ]);
          styleSummaryDataRow(r, 5, {
            zebra: rowToggle++ % 2 === 1,
            formats: { 3: '#,##0', 4: '#,##0', 5: '0.00' },
            alignments: { 1: 'center', 2: 'center', 3: 'right', 4: 'right', 5: 'right' },
          });
        }
      }
      if (cLang) {
        for (const lang of config.languageOptions) {
          const rNum = ws.rowCount + 1;
          const r = ws.addRow([
            'Language',
            lang,
            { formula: `IFERROR(COUNTIF(${tab}!${cLang}2:${cLang}${R},B${rNum}),0)`, result: 0 },
            cStud ? { formula: `IFERROR(SUMIF(${tab}!${cLang}2:${cLang}${R},B${rNum},${tab}!${cStud}2:${cStud}${R}),0)`, result: 0 } : 0,
            cCsat ? { formula: `IFERROR(AVERAGEIF(${tab}!${cLang}2:${cLang}${R},B${rNum},${tab}!${cCsat}2:${cCsat}${R}),0)`, result: 0 } : 0,
          ]);
          styleSummaryDataRow(r, 5, {
            zebra: rowToggle++ % 2 === 1,
            formats: { 3: '#,##0', 4: '#,##0', 5: '0.00' },
            alignments: { 1: 'center', 2: 'left', 3: 'right', 4: 'right', 5: 'right' },
          });
        }
      }
    }
  }

  // Final section on both modes: Human-readable System Configuration & Governance Snapshot
  ws.addRow([]).height = 10;
  writeSectionBanner(ws, 'System Configuration & Programme Governance Snapshot', 5);
  writeTableSubHeaders(ws, ['Setting Key', 'Configured Label', 'Current Value', 'Compliance', 'Notes']);
  const cfgSnapshotRows: Array<[string, string, string, string, string]> = [
    ['programme_timezone', 'Programme Timezone', config.programmeTimezone, 'Verified', 'Used for IST date boundaries & Session IDs'],
    ['state_name', 'Programme State', config.stateName, 'Verified', 'Strict regional scope'],
    ['allowed_districts', 'Approved Districts', config.allowedDistricts.join(', '), 'Verified', `${config.allowedDistricts.length} approved districts`],
    ['partner_name', 'Partner Organization', config.partnerName.trim() || 'Not configured yet', config.partnerName.trim() ? 'Ready' : 'Pending Input', 'Populates official monitoring exports'],
    ['export_template_63', '63-Col Official Schema', config.exportTemplate63?.columns.length === 63 ? config.exportTemplate63.templateName : 'Standard 56-Col Mode', config.exportTemplate63?.columns.length === 63 ? 'Loaded' : 'Pending Upload', 'Exact 63-header preservation on upload'],
    ['super_admins', 'Protected Super Admins', INITIAL_SUPER_ADMINS.map((a) => a.email).join(', '), 'Locked RBAC', 'Zero credentials stored in sheets'],
  ];
  cfgSnapshotRows.forEach((vals, idx) => {
    const r = ws.addRow(vals);
    styleSummaryDataRow(r, 5, {
      zebra: idx % 2 === 1,
      alignments: { 1: 'left', 2: 'left', 3: 'left', 4: 'center', 5: 'left' },
    });
  });
}

function addDeclarationsWorksheet(
  workbook: ExcelJS.Workbook,
  config: AppConfiguration,
  sheetDictionaries: Array<{ tabName: string; columns: ColumnFormatDescriptor[] }>,
): void {
  const ws = workbook.addWorksheet('Declarations', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { showGridLines: true },
  });

  const colMeta: Array<{ header: string; width: number; align: 'left' | 'center' }> = [
    { header: 'declaration_category', width: 24, align: 'left' },
    { header: 'target_tab_or_scope', width: 22, align: 'left' },
    { header: 'ref_or_col_num', width: 14, align: 'center' },
    { header: 'field_or_rule_key', width: 30, align: 'left' },
    { header: 'display_title', width: 32, align: 'left' },
    { header: 'type_format_or_formula', width: 36, align: 'left' },
    { header: 'validation_and_official_declaration', width: 68, align: 'left' },
  ];

  const headerRow = ws.addRow(colMeta.map((m) => m.header));
  headerRow.height = 30;
  colMeta.forEach((m, idx) => {
    const colIdx = idx + 1;
    const col = ws.getColumn(colIdx);
    col.width = m.width;
    col.numFmt = '@';
    col.alignment = { horizontal: m.align, vertical: 'middle', wrapText: true };

    const cell = headerRow.getCell(colIdx);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF171C24' } };
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFF8FAFC' } };
    cell.border = HEADER_BORDER;
    cell.alignment = { horizontal: m.align, vertical: 'middle', wrapText: true };
  });

  const rowsToWrite: Array<[string, string, string, string, string, string, string]> = [];

  // 1. Official Governance, Metric Formulas & Data Integrity Declarations
  for (const decl of buildProgrammeDeclarationItems(config)) {
    rowsToWrite.push([
      decl.category,
      'ALL_TABS',
      decl.refCode,
      decl.refCode,
      decl.title,
      decl.ruleOrFormula,
      decl.declaration,
    ]);
  }

  // 2. Column-by-Column Data Dictionary across included sheets
  for (const dict of sheetDictionaries) {
    dict.columns.forEach((c, idx) => {
      rowsToWrite.push([
        `Data Dictionary (${dict.tabName})`,
        dict.tabName,
        `Col ${idx + 1} (${colIndexToLetter(idx + 1)})`,
        c.header,
        c.displayTitle,
        `${c.dataType}${c.numFmt ? ` [${c.numFmt}]` : ''}`,
        `${c.validationRule} — ${c.definition}`,
      ]);
    });
  }

  rowsToWrite.forEach((tuple, idx) => {
    const r = ws.addRow(tuple);
    const isEven = idx % 2 === 1;
    let maxLines = 1;
    tuple.forEach((val, colIdx0) => {
      const colIdx = colIdx0 + 1;
      const cell = r.getCell(colIdx);
      cell.numFmt = '@';
      cell.border = THIN_GRID_BORDER;
      if (isEven) {
        cell.fill = { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFF8FAFC' }, fgColor: { argb: 'FFF8FAFC' } };
      }
      cell.font = {
        name: 'Calibri',
        size: 10,
        bold: colIdx === 1 || colIdx === 4,
        color: { argb: colIdx === 1 ? 'FF006BB8' : 'FF0A1B2C' },
      };
      const w = colMeta[colIdx0]!.width;
      const est = Math.ceil(String(val).length / Math.max(16, w - 3));
      if (est > maxLines) maxLines = est;
    });
    r.height = Math.min(120, Math.max(22, maxLines * 14 + 8));
  });

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(2, rowsToWrite.length + 1), column: colMeta.length },
  };
}

function metaListToDescriptors(list: WorkbookColumnMeta[]): ColumnFormatDescriptor[] {
  return list.map((m) => ({
    keyForValidation: m.header,
    header: m.header,
    displayTitle: m.displayTitle,
    dataType: m.dataType,
    validationRule: m.validationRule,
    definition: m.definition,
    width: m.width,
    numFmt: m.numFmt,
    align: m.align,
    wrapText: m.wrapText,
    isStatusCol:
      m.header === 'submission_status' ||
      m.header === 'status' ||
      m.header === 'teacher_classification',
  }));
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
  workbook.creator = 'Vidhya Vidhai Foundation · Career Tours Classroom Management System';
  workbook.created = new Date();

  const use63 =
    mode === 'official_63' &&
    Boolean(config.exportTemplate63 && config.exportTemplate63.columns.length === 63);

  const worksheet = workbook.addWorksheet('Career Tours Data', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { showGridLines: true },
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

    const colDescriptors: ColumnFormatDescriptor[] = specs.map((spec) => {
      const decl = getExportColumnDeclaration(spec);
      const isText = spec.sourceKey === 'udise_code' || spec.sourceKey === 'pin_code' || spec.format === 'text';
      const isDec = spec.format === 'decimal2';
      const isNum = spec.format === 'number';
      return {
        keyForValidation: spec.sourceKey || spec.header,
        header: spec.header,
        displayTitle: decl.meta?.displayTitle ?? spec.header,
        dataType: decl.dataType,
        validationRule: decl.validationRule,
        definition: decl.definition,
        width: decl.meta?.width ?? Math.max(16, Math.min(44, spec.header.length + 6)),
        numFmt: isText ? '@' : isDec ? '0.00' : isNum ? '#,##0' : decl.meta?.numFmt,
        align: decl.meta?.align ?? (isNum || isDec ? 'right' : 'left'),
        isStatusCol:
          spec.sourceKey === 'submission_status' || spec.sourceKey === 'teacher_classification',
      };
    });

    enhanceTableWorksheet(worksheet, colDescriptors, flatRows.length, config);
    addSummaryAndKpisWorksheet(workbook, config, {
      mode: 'export',
      dataTabName: 'Career Tours Data',
      exportCols: specs.map((s) => ({ header: s.header, sourceKey: s.sourceKey })),
    });
    addDeclarationsWorksheet(workbook, config, [
      { tabName: 'Career Tours Data', columns: colDescriptors },
    ]);

    const buffer = await workbook.xlsx.writeBuffer();
    return {
      buffer: buffer as ArrayBuffer,
      rowCount: flatRows.length,
      columnCount: 63,
      usedOfficial63Schema: true,
    };
  }

  // Standard full workbook export (used until official 63-column template headers are imported by Admin)
  const standardCols = STANDARD_EXPORT_FIELD_DECLARATIONS;
  worksheet.addRow(standardCols.map((c) => c.header));

  for (const row of flatRows) {
    const added = worksheet.addRow(
      standardCols.map((c) => row[c.sourceKey as keyof FlattenedExportRow] ?? ''),
    );
    standardCols.forEach((c, idx) => {
      const cell = added.getCell(idx + 1);
      if (c.sourceKey === 'udise_code' || c.sourceKey === 'pin_code' || c.numFmt === '@') {
        cell.numFmt = '@';
      } else if (
        (c.sourceKey === 'csat' ||
          c.sourceKey === 'itp' ||
          c.sourceKey === 'overall_csat' ||
          c.sourceKey === 'overall_itp') &&
        typeof cell.value === 'number'
      ) {
        cell.numFmt = '0.00';
      }
    });
  }

  const colDescriptors: ColumnFormatDescriptor[] = standardCols.map((c) => ({
    keyForValidation: c.sourceKey,
    header: c.header,
    displayTitle: c.displayTitle,
    dataType: c.dataType,
    validationRule: c.validationRule,
    definition: c.definition,
    width: c.width,
    numFmt: c.numFmt,
    align: c.align,
    isStatusCol:
      c.sourceKey === 'submission_status' || c.sourceKey === 'teacher_classification',
  }));

  enhanceTableWorksheet(worksheet, colDescriptors, flatRows.length, config);
  addSummaryAndKpisWorksheet(workbook, config, {
    mode: 'export',
    dataTabName: 'Career Tours Data',
    exportCols: standardCols.map((c) => ({ header: c.header, sourceKey: c.sourceKey })),
  });
  addDeclarationsWorksheet(workbook, config, [
    { tabName: 'Career Tours Data', columns: colDescriptors },
  ]);

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

  const sheetDictionaries: Array<{ tabName: string; columns: ColumnFormatDescriptor[] }> = [];

  // 1. Sessions (41 columns matching SetupDatabase.gs)
  const sessionsWs = workbook.addWorksheet('Sessions', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { showGridLines: true },
  });
  sessionsWs.addRow(SESSION_COLUMN_META.map((c) => c.header));
  const sessionTextCols = new Set([1, 2, 3, 11, 12, 13, 14, 18, 19, 21, 25, 36, 37, 38, 41]);
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
  const sessionsDesc = metaListToDescriptors(SESSION_COLUMN_META);
  enhanceTableWorksheet(sessionsWs, sessionsDesc, sessions.length, config);
  sheetDictionaries.push({ tabName: 'Sessions', columns: sessionsDesc });

  // 2. Session Details (24 columns)
  const detailsWs = workbook.addWorksheet('Session Details', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { showGridLines: true },
  });
  detailsWs.addRow(SESSION_DETAIL_COLUMN_META.map((c) => c.header));
  let detailRowCount = 0;
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
      detailRowCount++;
    }
  }
  const detailsDesc = metaListToDescriptors(SESSION_DETAIL_COLUMN_META);
  enhanceTableWorksheet(detailsWs, detailsDesc, detailRowCount, config);
  sheetDictionaries.push({ tabName: 'Session Details', columns: detailsDesc });

  // 3. Facilitators
  const facWs = workbook.addWorksheet('Facilitators', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { showGridLines: true },
  });
  const facMeta = AUXILIARY_TAB_SCHEMAS.Facilitators!;
  facWs.addRow(facMeta.map((c) => c.header));
  const facRows = users.filter((usr) => usr.role === 'facilitator');
  for (const u of facRows) {
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
  const facDesc = metaListToDescriptors(facMeta);
  enhanceTableWorksheet(facWs, facDesc, facRows.length, config);
  sheetDictionaries.push({ tabName: 'Facilitators', columns: facDesc });

  // 4. Schools
  const schoolsWs = workbook.addWorksheet('Schools', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { showGridLines: true },
  });
  const schoolsMeta = AUXILIARY_TAB_SCHEMAS.Schools!;
  schoolsWs.addRow(schoolsMeta.map((c) => c.header));
  for (const sc of schools) {
    const r = schoolsWs.addRow([
      sc.schoolRecordId,
      sc.schoolName,
      String(sc.udiseCode),
      sc.schoolType,
      sc.state,
      sc.district,
      String(sc.pinCode),
      sc.active ? 'true' : 'false',
      sc.createdAt,
      sc.updatedAt,
    ]);
    [1, 3, 7, 8].forEach((cIdx) => {
      r.getCell(cIdx).numFmt = '@';
    });
  }
  const schoolsDesc = metaListToDescriptors(schoolsMeta);
  enhanceTableWorksheet(schoolsWs, schoolsDesc, schools.length, config);
  sheetDictionaries.push({ tabName: 'Schools', columns: schoolsDesc });

  // 5. Configuration
  const cfgWs = workbook.addWorksheet('Configuration', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { showGridLines: true },
  });
  const cfgMeta = AUXILIARY_TAB_SCHEMAS.Configuration!;
  cfgWs.addRow(cfgMeta.map((c) => c.header));
  const nowIso = new Date().toISOString();
  const cfgPairs: Array<[string, unknown]> = [
    ['programme_timezone', config.programmeTimezone],
    ['state_name', config.stateName],
    ['allowed_districts', config.allowedDistricts],
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
  const cfgDesc = metaListToDescriptors(cfgMeta);
  enhanceTableWorksheet(cfgWs, cfgDesc, cfgPairs.length, config);
  sheetDictionaries.push({ tabName: 'Configuration', columns: cfgDesc });

  // 6. Admin Users
  const adminWs = workbook.addWorksheet('Admin Users', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { showGridLines: true },
  });
  const adminMeta = AUXILIARY_TAB_SCHEMAS['Admin Users']!;
  adminWs.addRow(adminMeta.map((c) => c.header));
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
  const adminDesc = metaListToDescriptors(adminMeta);
  enhanceTableWorksheet(adminWs, adminDesc, INITIAL_SUPER_ADMINS.length, config);
  sheetDictionaries.push({ tabName: 'Admin Users', columns: adminDesc });

  // 7. Audit Log
  const auditWs = workbook.addWorksheet('Audit Log', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { showGridLines: true },
  });
  const auditMeta = AUXILIARY_TAB_SCHEMAS['Audit Log']!;
  auditWs.addRow(auditMeta.map((c) => c.header));
  const auditDesc = metaListToDescriptors(auditMeta);
  enhanceTableWorksheet(auditWs, auditDesc, 0, config);
  sheetDictionaries.push({ tabName: 'Audit Log', columns: auditDesc });

  // 8. Sync Log
  const syncWs = workbook.addWorksheet('Sync Log', {
    views: [{ state: 'frozen', ySplit: 1 }],
    properties: { showGridLines: true },
  });
  const syncMeta = AUXILIARY_TAB_SCHEMAS['Sync Log']!;
  syncWs.addRow(syncMeta.map((c) => c.header));
  const syncDesc = metaListToDescriptors(syncMeta);
  enhanceTableWorksheet(syncWs, syncDesc, 0, config);
  sheetDictionaries.push({ tabName: 'Sync Log', columns: syncDesc });

  // 9. Summary & KPIs (live Excel/Sheets formulas computing totals, district/tour/grade/language breakdowns)
  addSummaryAndKpisWorksheet(workbook, config, {
    mode: 'database',
    sessionCount: sessions.length,
  });

  // 10. Declarations (Governance rules, Calculation formulas & Filterable Field Dictionary)
  addDeclarationsWorksheet(workbook, config, sheetDictionaries);

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    buffer: buffer as ArrayBuffer,
    tabsCount: workbook.worksheets.length,
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

/**
 * RFC-4180 CSV cell sanitizer with formula-injection neutralization.
 * Numeric values (including negative integers/decimals like Teacher NPS `-100`)
 * are preserved as numbers without a leading quote, while string formulas
 * starting with =, +, -, @, tab, or carriage return are neutralized with a
 * leading apostrophe before RFC-4180 quoting.
 */
export function sanitizeCsvCell(val: unknown): string {
  if (val === undefined || val === null) {
    return '';
  }
  const raw = String(val);
  const isPureFiniteNumeric = /^-?\d+(\.\d+)?$/.test(raw);
  const neutralized = !isPureFiniteNumeric && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[",\r\n]/.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
}

export function generateExportCsvString(
  sessions: SessionRecord[],
  config: AppConfiguration,
  mode: 'official_63' | 'standard' = 'standard',
): {
  csv: string;
  rowCount: number;
  columnCount: number;
  usedOfficial63Schema: boolean;
} {
  const flatRows = buildFlattenedExportRows(sessions, config);
  const use63 =
    mode === 'official_63' &&
    Boolean(config.exportTemplate63 && config.exportTemplate63.columns.length === 63);

  const lines: string[] = [];

  if (use63 && config.exportTemplate63) {
    const specs = [...config.exportTemplate63.columns].sort((a, b) => a.index - b.index);
    lines.push(specs.map((spec) => sanitizeCsvCell(spec.header)).join(','));

    for (const row of flatRows) {
      const cells = specs.map((spec) => {
        if (spec.format === 'constant') {
          return sanitizeCsvCell(spec.constantValue ?? '');
        }
        if (!spec.sourceKey) {
          return '';
        }
        const raw = (row as unknown as Record<string, unknown>)[spec.sourceKey];
        if (raw === undefined || raw === null) {
          return '';
        }
        if (spec.format === 'text' || spec.sourceKey === 'udise_code' || spec.sourceKey === 'pin_code') {
          return sanitizeCsvCell(String(raw));
        }
        return sanitizeCsvCell(raw);
      });
      lines.push(cells.join(','));
    }

    return {
      csv: `\uFEFF${lines.join('\r\n')}`,
      rowCount: flatRows.length,
      columnCount: 63,
      usedOfficial63Schema: true,
    };
  }

  const standardCols = STANDARD_EXPORT_FIELD_DECLARATIONS;
  lines.push(standardCols.map((c) => sanitizeCsvCell(c.header)).join(','));

  for (const row of flatRows) {
    const cells = standardCols.map((c) => {
      const raw = row[c.sourceKey as keyof FlattenedExportRow] ?? '';
      return sanitizeCsvCell(raw);
    });
    lines.push(cells.join(','));
  }

  return {
    csv: `\uFEFF${lines.join('\r\n')}`,
    rowCount: flatRows.length,
    columnCount: standardCols.length,
    usedOfficial63Schema: false,
  };
}

export function triggerCsvDownload(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

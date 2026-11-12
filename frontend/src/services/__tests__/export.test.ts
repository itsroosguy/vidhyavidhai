import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { createTestConfig, createValidFormValues } from '../../testFixtures';
import { LocalSandboxApiClient } from '../apiClient';
import { SANDBOX_USERS } from '../authService';
import {
  generateExportCsvString,
  generateExportWorkbookBuffer,
  generateInitializedDatabaseWorkbookBuffer,
  normalizeExportTimeText,
  parseOfficial63TemplateXlsx,
} from '../exportService';

async function buildSample63ColumnTemplateBuffer(): Promise<{ buffer: ArrayBuffer; headers: string[] }> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Template');
  const headers: string[] = [
    'CC',
    'School_Year',
    'Partner_Name',
    'Data_Source',
    'Session_ID',
    'Video_ID',
    'Language',
    'Start_Date',
    'End_Date',
    'Submission_Date',
    'Month',
    'Facilitator_Name',
    'Facilitator_Email',
    'School_Name',
    'UDISE',
    'School_Type',
    'State',
    'District',
    'Block',
    'PIN_Code',
    'Grade',
    'Section',
    'Students_Present',
    'CSAT',
    'ITP',
    'Teacher_NPS',
  ];
  for (let i = headers.length + 1; i <= 63; i++) {
    headers.push(`Report_Field_${i}`);
  }
  ws.addRow(headers);
  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  return { buffer: buf, headers };
}

describe('Excel (.xlsx) Export & 63-Column Template Ingestion', () => {
  it('validates official 63-column .xlsx templates and rejects malformed column counts', async () => {
    // Reject 10-column file
    const badWb = new ExcelJS.Workbook();
    badWb.addWorksheet('Bad').addRow(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
    const badBuf = (await badWb.xlsx.writeBuffer()) as ArrayBuffer;
    const badRes = await parseOfficial63TemplateXlsx(badBuf, 'bad.xlsx', 'admin@example.org');
    expect(badRes.ok).toBe(false);

    // Accept exact 63-column file
    const { buffer } = await buildSample63ColumnTemplateBuffer();
    const goodRes = await parseOfficial63TemplateXlsx(buffer, 'official_63.xlsx', 'sa@example.org');
    expect(goodRes.ok).toBe(true);
    if (goodRes.ok) {
      expect(goodRes.schema.columns).toHaveLength(63);
      expect(goodRes.schema.columns[0]!.header).toBe('CC');
      expect(goodRes.schema.columns[14]!.sourceKey).toBe('udise_code');
      expect(goodRes.schema.columns[62]!.header).toBe('Report_Field_63');
    }
  });

  it('expands combined-class sessions into 1 row per class/section and preserves leading zeroes & exact 63 columns', async () => {
    const { buffer, headers } = await buildSample63ColumnTemplateBuffer();
    const parsed = await parseOfficial63TemplateXlsx(buffer, 'official.xlsx', 'sa@example.org');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const cfg = createTestConfig({ exportTemplate63: parsed.schema });
    const api = new LocalSandboxApiClient(() => SANDBOX_USERS.facilitator.userId, cfg);

    // Combined session with 3 classes and leading zeroes on both UDISE & PIN
    const combinedValues = createValidFormValues({
      udiseCode: '01234567890',
      pinCode: '006001',
      startDate: '2026-11-05',
      endDate: '2026-11-05',
      sessionMode: 'combined',
      classes: [
        {
          rowId: 'r1',
          grade: '8',
          section: 'A',
          studentsPresent: '30',
          questionA: { score5: '30', score4: '0', score3: '0', score2: '0', score1: '0' },
          questionB: { score5: '30', score4: '0', score3: '0', score2: '0', score1: '0' },
        },
        {
          rowId: 'r2',
          grade: '8',
          section: 'B',
          studentsPresent: '25',
          questionA: { score5: '0', score4: '0', score3: '0', score2: '0', score1: '25' },
          questionB: { score5: '0', score4: '0', score3: '0', score2: '0', score1: '25' },
        },
        {
          rowId: 'r3',
          grade: '9',
          section: 'No section',
          studentsPresent: '20',
          questionA: { score5: '10', score4: '10', score3: '0', score2: '0', score1: '0' },
          questionB: { score5: '10', score4: '10', score3: '0', score2: '0', score1: '0' },
        },
      ],
    });

    const saved = await api.createSession(combinedValues);
    expect(saved.ok).toBe(true);
    const session = saved.data!.session;
    expect(session.sessionId).toContain('_01234567890_CMB_03C_001');

    const exported = await generateExportWorkbookBuffer([session], cfg, 'official_63');
    expect(exported.usedOfficial63Schema).toBe(true);
    expect(exported.columnCount).toBe(63);
    expect(exported.rowCount).toBe(3);

    // Parse back using ExcelJS to verify actual Excel cell content, headers, formats, and row expansion
    const verifyWb = new ExcelJS.Workbook();
    await verifyWb.xlsx.load(exported.buffer);
    const sheet = verifyWb.worksheets[0]!;
    expect(sheet.rowCount).toBe(4); // 1 header + 3 detail rows

    const exportedHeaders: string[] = [];
    for (let c = 1; c <= 63; c++) {
      exportedHeaders.push(sheet.getRow(1).getCell(c).text);
    }
    expect(exportedHeaders).toEqual(headers);

    // Check UDISE (col 15) & PIN (col 20) retain leading zeroes as string text with numFmt '@'
    const r2 = sheet.getRow(2);
    expect(r2.getCell(15).value).toBe('01234567890');
    expect(r2.getCell(15).numFmt).toBe('@');
    expect(r2.getCell(20).value).toBe('006001');
    expect(r2.getCell(20).numFmt).toBe('@');
    expect(r2.getCell(8).value).toBe('05-11-2026'); // dd-mm-yyyy date format

    // Verify per-row class values across all 3 rows
    expect(sheet.getRow(2).getCell(21).value).toBe('8');
    expect(sheet.getRow(2).getCell(22).value).toBe('A');
    expect(sheet.getRow(2).getCell(24).value).toBe(5); // class CSAT 5.00

    expect(sheet.getRow(3).getCell(21).value).toBe('8');
    expect(sheet.getRow(3).getCell(22).value).toBe('B');
    expect(sheet.getRow(3).getCell(24).value).toBe(1); // class CSAT 1.00

    expect(sheet.getRow(4).getCell(21).value).toBe('9');
    expect(sheet.getRow(4).getCell(22).value).toBe('No section');
    expect(sheet.getRow(4).getCell(24).value).toBe(4.5); // class CSAT 4.50
  });

  it('generates initialized 10-tab Google Sheets database workbook preserving UDISE/PIN leading zeroes, filters, validations, Summary & KPIs, and Declarations', async () => {
    const cfg = createTestConfig();
    const api = new LocalSandboxApiClient(() => SANDBOX_USERS.facilitator.userId, cfg);
    const saved = await api.createSession(
      createValidFormValues({
        udiseCode: '01234567890',
        pinCode: '006001',
      }),
    );
    expect(saved.ok).toBe(true);
    const session = saved.data!.session;

    const { buffer, tabsCount, rowCount } = await generateInitializedDatabaseWorkbookBuffer({
      sessions: [session],
      config: cfg,
    });
    expect(tabsCount).toBe(10);
    expect(rowCount).toBe(1);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const tabNames = wb.worksheets.map((ws) => ws.name);
    expect(tabNames).toEqual([
      'Sessions',
      'Session Details',
      'Facilitators',
      'Schools',
      'Configuration',
      'Admin Users',
      'Audit Log',
      'Sync Log',
      'Summary & KPIs',
      'Declarations',
    ]);
    const sessSheet = wb.getWorksheet('Sessions')!;
    const sessHeaders = (sessSheet.getRow(1).values as unknown[]).filter(Boolean);
    expect(sessHeaders).toHaveLength(41);
    expect(sessHeaders).not.toContain('block');
    expect(sessSheet.getRow(2).getCell(21).value).toBe('01234567890');
    expect(sessSheet.getRow(2).getCell(25).value).toBe('006001');
    expect(sessSheet.autoFilter).toBeTruthy();

    const schoolsSheet = wb.getWorksheet('Schools')!;
    const schoolHeaders = (schoolsSheet.getRow(1).values as unknown[]).filter(Boolean);
    expect(schoolHeaders).toHaveLength(10);
    expect(schoolHeaders).not.toContain('block');

    const summarySheet = wb.getWorksheet('Summary & KPIs')!;
    expect(String(summarySheet.getRow(6).getCell(3).formula || '')).toContain('COUNTIFS(');

    const declSheet = wb.getWorksheet('Declarations')!;
    expect(declSheet.autoFilter).toBeTruthy();
    const declText = declSheet.getSheetValues().flat().filter(Boolean).join(' ');
    expect(declText).toContain('GOV-01');
    expect(declText).toContain('MET-01');
    expect(declText).toContain('udise_code');
  });

  it('generates structured schema-ready .xlsx workbooks even when 0 sessions exist (filters, dropdown validations, zero-evaluated Summary & KPIs, and full Declarations)', async () => {
    const cfg = createTestConfig();
    const emptyExport = await generateExportWorkbookBuffer([], cfg, 'standard');
    expect(emptyExport.rowCount).toBe(0);
    expect(emptyExport.columnCount).toBe(56);

    // Inspect raw OOXML structure to ensure valid Excel AutoFilter, DataValidations, & ConditionalFormatting
    const zip = await JSZip.loadAsync(emptyExport.buffer);
    const sheet1Xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet1Xml).toContain('<autoFilter');
    expect(sheet1Xml).toContain('<dataValidations');
    expect(sheet1Xml).toContain('Cuddalore,Nagapattinam,Sivaganga');
    expect(sheet1Xml).toContain('<conditionalFormatting');
    expect(sheet1Xml).not.toContain('<tablePart');
    expect(sheet1Xml).not.toContain('<formula>=');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(emptyExport.buffer);
    expect(wb.worksheets.map((ws) => ws.name)).toEqual([
      'Career Tours Data',
      'Summary & KPIs',
      'Declarations',
    ]);

    const dataWs = wb.getWorksheet('Career Tours Data')!;
    expect(dataWs.rowCount).toBe(1);
    expect(dataWs.autoFilter).toBeTruthy();

    const summaryWs = wb.getWorksheet('Summary & KPIs')!;
    expect(summaryWs.getRow(6).getCell(3).result).toBe(0);
    expect(String(summaryWs.getRow(6).getCell(3).formula || '')).toContain('IFERROR(');
    const summaryText = summaryWs.getSheetValues().flat().filter(Boolean).join(' ');
    expect(summaryText).not.toContain('Active Blocks');
    expect(summaryText).not.toContain('Configured Blocks');

    const declWs = wb.getWorksheet('Declarations')!;
    expect(declWs.autoFilter).toBeTruthy();
    expect(declWs.rowCount).toBeGreaterThanOrEqual(65); // 9 official declarations + 56 columns

    const emptyDb = await generateInitializedDatabaseWorkbookBuffer({
      sessions: [],
      config: cfg,
    });
    expect(emptyDb.tabsCount).toBe(10);
    expect(emptyDb.rowCount).toBe(0);
    const dbWb = new ExcelJS.Workbook();
    await dbWb.xlsx.load(emptyDb.buffer);
    expect(dbWb.getWorksheet('Sessions')!.rowCount).toBe(1);
    expect(dbWb.getWorksheet('Sessions')!.autoFilter).toBeTruthy();
    expect(dbWb.getWorksheet('Declarations')!.rowCount).toBeGreaterThan(100);
  });

  it('keeps Start Time and End Time as spacious plain-text HH:MM cells in .xlsx and Excel-safe IST text in .csv (no ########)', async () => {
    expect(normalizeExportTimeText('13:40:00')).toBe('13:40');
    expect(normalizeExportTimeText('1:40 PM')).toBe('13:40');
    expect(normalizeExportTimeText('1899-12-30T08:10:00.000Z')).toBe('13:40');

    const cfg = createTestConfig();
    const api = new LocalSandboxApiClient(() => SANDBOX_USERS.facilitator.userId, cfg);
    const saved = await api.createSession(
      createValidFormValues({
        startTime: '13:40',
        endTime: '15:45',
      }),
    );
    expect(saved.ok).toBe(true);
    const baseSession = saved.data!.session;
    const legacyIsoSession = {
      ...baseSession,
      startTime: '1899-12-30T08:10:00.000Z',
      endTime: '03:45 PM',
    };

    // 1. Standard .xlsx export preserves OOXML shared string t="s", numFmt="@", and wide columns
    const stdXlsx = await generateExportWorkbookBuffer([legacyIsoSession], cfg, 'standard');
    const stdZip = await JSZip.loadAsync(stdXlsx.buffer);
    const sheet1Xml = await stdZip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet1Xml).toContain('<c r="R2" s="13" t="s">');
    expect(sheet1Xml).toContain('<c r="S2" s="13" t="s">');

    const stdWb = new ExcelJS.Workbook();
    await stdWb.xlsx.load(stdXlsx.buffer);
    const dataWs = stdWb.getWorksheet('Career Tours Data')!;
    expect(dataWs.getColumn(18).width).toBeGreaterThanOrEqual(21);
    expect(dataWs.getColumn(19).width).toBeGreaterThanOrEqual(21);
    expect(dataWs.getRow(2).getCell(18).value).toBe('13:40');
    expect(dataWs.getRow(2).getCell(18).numFmt).toBe('@');
    expect(dataWs.getRow(2).getCell(19).value).toBe('15:45');
    expect(dataWs.getRow(2).getCell(19).numFmt).toBe('@');

    // 2. 10-tab Database .xlsx export widens Sessions time columns & preserves text HH:MM
    const dbXlsx = await generateInitializedDatabaseWorkbookBuffer({
      sessions: [legacyIsoSession],
      config: cfg,
    });
    const dbWb = new ExcelJS.Workbook();
    await dbWb.xlsx.load(dbXlsx.buffer);
    const sessWs = dbWb.getWorksheet('Sessions')!;
    expect(sessWs.getColumn(13).width).toBeGreaterThanOrEqual(18);
    expect(sessWs.getColumn(14).width).toBeGreaterThanOrEqual(18);
    expect(sessWs.getRow(2).getCell(13).value).toBe('13:40');
    expect(sessWs.getRow(2).getCell(13).numFmt).toBe('@');
    expect(sessWs.getRow(2).getCell(14).value).toBe('15:45');
    expect(sessWs.getRow(2).getCell(14).numFmt).toBe('@');

    // 3. Official 63-column auto-mapping picks up Start Time & End Time headers
    const tplWb = new ExcelJS.Workbook();
    const tplWs = tplWb.addWorksheet('Template');
    const tplHeaders = Array.from({ length: 63 }, (_, i) => {
      if (i === 0) return 'Session_ID';
      if (i === 1) return 'Start Time (HH:MM)';
      if (i === 2) return 'End Time (HH:MM)';
      return `Col_${i + 1}`;
    });
    tplWs.addRow(tplHeaders);
    const parsed63 = await parseOfficial63TemplateXlsx(
      (await tplWb.xlsx.writeBuffer()) as ArrayBuffer,
      'times_63.xlsx',
      'sa@example.org',
    );
    expect(parsed63.ok).toBe(true);
    if (!parsed63.ok) return;
    expect(parsed63.schema.columns[1]!.sourceKey).toBe('start_time');
    expect(parsed63.schema.columns[2]!.sourceKey).toBe('end_time');

    const cfg63 = createTestConfig({ exportTemplate63: parsed63.schema });
    const exp63Xlsx = await generateExportWorkbookBuffer([legacyIsoSession], cfg63, 'official_63');
    const wb63 = new ExcelJS.Workbook();
    await wb63.xlsx.load(exp63Xlsx.buffer);
    const ws63 = wb63.getWorksheet('Career Tours Data')!;
    expect(ws63.getColumn(2).width).toBeGreaterThanOrEqual(20);
    expect(ws63.getRow(2).getCell(2).value).toBe('13:40');
    expect(ws63.getRow(2).getCell(2).numFmt).toBe('@');
    expect(ws63.getRow(2).getCell(3).value).toBe('15:45');
    expect(ws63.getRow(2).getCell(3).numFmt).toBe('@');

    // 4. CSV export appends "IST" so Excel never converts HH:MM into ######## Time serials
    const stdCsv = generateExportCsvString([legacyIsoSession], cfg, 'standard');
    expect(stdCsv.csv).toContain(',13:40 IST,15:45 IST,');

    const csv63 = generateExportCsvString([legacyIsoSession], cfg63, 'official_63');
    expect(csv63.csv).toContain(',13:40 IST,15:45 IST,');

    const blankTimeCsv = generateExportCsvString([{ ...baseSession, startTime: '', endTime: '' }], cfg, 'standard');
    expect(blankTimeCsv.csv).not.toContain(' IST');
  });
});

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { createTestConfig, createValidFormValues } from '../../testFixtures';
import { LocalSandboxApiClient } from '../apiClient';
import { SANDBOX_USERS } from '../authService';
import {
  generateExportWorkbookBuffer,
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
});

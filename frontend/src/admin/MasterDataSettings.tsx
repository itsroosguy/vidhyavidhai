import React, { useEffect, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, Plus, Save, Upload } from 'lucide-react';
import type { BackendApiClient } from '../services/apiClient';
import {
  KNOWN_EXPORT_SOURCE_KEYS,
  parseOfficial63TemplateXlsx,
} from '../services/exportService';
import type {
  AppConfiguration,
  DistrictBlockEntry,
  ExportTemplateSchema,
  TourOption,
  UserProfile,
} from '../types/domain';
import { AuditLogViewer } from './AuditLogViewer';

interface MasterDataSettingsProps {
  api: BackendApiClient;
  user: UserProfile;
  config: AppConfiguration;
  onConfigUpdated: (next: AppConfiguration) => void;
  onNotify: (type: 'success' | 'error' | 'warning', title: string, detail?: string) => void;
}

interface ParsedBlockPreview {
  validEntries: DistrictBlockEntry[];
  errors: Array<{ row: number; raw: string; reason: string }>;
}

function parseBlockCsvLines(
  rawLines: string[][],
  allowedDistricts: string[],
): ParsedBlockPreview {
  const validEntries: DistrictBlockEntry[] = [];
  const errors: Array<{ row: number; raw: string; reason: string }> = [];
  const seen = new Set<string>();

  rawLines.forEach((cols, idx) => {
    const rowNum = idx + 1;
    const district = (cols[0] ?? '').trim();
    const block = (cols[1] ?? '').trim();
    const activeRaw = (cols[2] ?? 'true').trim().toLowerCase();

    if (idx === 0 && district.toLowerCase() === 'district' && block.toLowerCase() === 'block') {
      return;
    }

    if (!district && !block) return;

    if (!allowedDistricts.includes(district)) {
      errors.push({
        row: rowNum,
        raw: `${district}, ${block}`,
        reason: `District "${district}" is not in allowed list (${allowedDistricts.join(', ')}).`,
      });
      return;
    }

    if (!block) {
      errors.push({
        row: rowNum,
        raw: `${district}, (blank)`,
        reason: 'Block name cannot be blank.',
      });
      return;
    }

    const pairKey = `${district.toLowerCase()}::${block.toLowerCase()}`;
    if (seen.has(pairKey)) {
      errors.push({
        row: rowNum,
        raw: `${district}, ${block}`,
        reason: 'Duplicate district/block pair in upload.',
      });
      return;
    }

    seen.add(pairKey);
    const active = activeRaw !== 'false' && activeRaw !== '0' && activeRaw !== 'inactive';
    validEntries.push({ district, block, active });
  });

  return { validEntries, errors };
}

export const MasterDataSettings: React.FC<MasterDataSettingsProps> = ({
  api,
  user,
  config,
  onConfigUpdated,
  onNotify,
}) => {
  const isSuperAdmin = user.role === 'super_admin';

  // Block import state
  const [csvPaste, setCsvPaste] = useState('');
  const [replaceBlocks, setReplaceBlocks] = useState(false);
  const [blockPreview, setBlockPreview] = useState<ParsedBlockPreview | null>(null);
  const [importingBlocks, setImportingBlocks] = useState(false);

  // 63-column template import state
  const [draftTemplate, setDraftTemplate] = useState<ExportTemplateSchema | null>(
    config.exportTemplate63,
  );
  const [savingConfig, setSavingConfig] = useState(false);

  // System settings state (Super Admin)
  const [schoolYear, setSchoolYear] = useState(config.schoolYear);
  const [partnerName, setPartnerName] = useState(config.partnerName);
  const [tours, setTours] = useState<TourOption[]>(config.tours);
  const [schoolTypesText, setSchoolTypesText] = useState(config.schoolTypes.join('\n'));
  const [gradesText, setGradesText] = useState(config.gradeOptions.join(', '));
  const [languagesText, setLanguagesText] = useState(config.languageOptions.join(', '));
  const [allowFacDelete, setAllowFacDelete] = useState(config.policy.allowFacilitatorDeleteOwn);

  const [newTourName, setNewTourName] = useState('');
  const [newTourCode, setNewTourCode] = useState('');
  const [selectedVideoLang, setSelectedVideoLang] = useState<string>('Tamil');

  useEffect(() => {
    setDraftTemplate(config.exportTemplate63);
    setSchoolYear(config.schoolYear);
    setPartnerName(config.partnerName);
    setTours(config.tours);
    setSchoolTypesText(config.schoolTypes.join('\n'));
    setGradesText(config.gradeOptions.join(', '));
    setLanguagesText(config.languageOptions.join(', '));
    setAllowFacDelete(config.policy.allowFacilitatorDeleteOwn);
  }, [config]);

  const handlePreviewCsvPaste = () => {
    const lines = csvPaste
      .split(/\r?\n/)
      .map((line) => line.split(',').map((c) => c.trim()));
    setBlockPreview(parseBlockCsvLines(lines, config.allowedDistricts));
  };

  const handleBlockFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.name.toLowerCase().endsWith('.csv')) {
      const text = await file.text();
      setCsvPaste(text);
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.split(',').map((c) => c.trim()));
      setBlockPreview(parseBlockCsvLines(lines, config.allowedDistricts));
      return;
    }

    try {
      const buf = await file.arrayBuffer();
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const sheet = wb.worksheets[0];
      if (!sheet) {
        onNotify('error', 'Empty workbook');
        return;
      }
      const rows: string[][] = [];
      sheet.eachRow((row) => {
        rows.push([
          row.getCell(1).text.trim(),
          row.getCell(2).text.trim(),
          row.getCell(3).text.trim() || 'true',
        ]);
      });
      setBlockPreview(parseBlockCsvLines(rows, config.allowedDistricts));
    } catch (err) {
      onNotify('error', 'Failed to read block file', err instanceof Error ? err.message : '');
    }
  };

  const handleApplyBlockImport = async () => {
    if (!blockPreview || blockPreview.validEntries.length === 0) return;
    setImportingBlocks(true);
    try {
      const res = await api.importBlockMaster(blockPreview.validEntries, replaceBlocks);
      if (res.ok && res.data) {
        const refreshed = await api.getAppConfiguration();
        if (refreshed.ok && refreshed.data) {
          onConfigUpdated(refreshed.data);
        }
        onNotify(
          'success',
          'Block master imported',
          `Imported ${res.data.importedCount} entries (${res.data.totalCount} total blocks configured).`,
        );
        setBlockPreview(null);
        setCsvPaste('');
      } else {
        onNotify('error', 'Block import failed', res.error);
      }
    } finally {
      setImportingBlocks(false);
    }
  };

  const handleTemplate63Upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const parsed = await parseOfficial63TemplateXlsx(buf, file.name, user.email);
    if (!parsed.ok) {
      onNotify('error', 'Invalid 63-column template', parsed.error);
      return;
    }
    setDraftTemplate(parsed.schema);
    onNotify(
      'success',
      '63 columns validated',
      'Review the column-to-field mappings below and click "Save System Configuration".',
    );
  };

  const handleAddTour = () => {
    if (!newTourName.trim() || !newTourCode.trim()) return;
    const cleanCode = newTourCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    setTours((prev) => [
      ...prev,
      {
        tourId: `TOUR_${cleanCode}_${Date.now().toString().slice(-4)}`,
        tourName: newTourName.trim(),
        tourCode: cleanCode,
        active: true,
        videoIdByLanguage: {},
      },
    ]);
    setNewTourName('');
    setNewTourCode('');
  };

  const handleSaveSystemConfig = async () => {
    if (!isSuperAdmin) return;
    setSavingConfig(true);
    try {
      const res = await api.saveAppConfiguration({
        schoolYear: schoolYear.trim() || '2026-27',
        partnerName: partnerName.trim(),
        tours,
        schoolTypes: schoolTypesText
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
        gradeOptions: gradesText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        languageOptions: languagesText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        policy: {
          allowFacilitatorDeleteOwn: allowFacDelete,
          allowFacilitatorExportOwn: false,
          facilitatorApprovalMode: config.policy.facilitatorApprovalMode ?? 'manual_allowlist',
        },
        exportTemplate63: draftTemplate,
      });

      if (res.ok && res.data) {
        onConfigUpdated(res.data);
        onNotify('success', 'System configuration saved');
      } else {
        onNotify('error', 'Failed to save configuration', res.error);
      }
    } finally {
      setSavingConfig(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Block Master Import */}
      <section className="ct-card p-5 sm:p-6">
        <h2 className="text-xl font-medium text-[#0A1B2C] mb-1 ct-num">
          District–Block Master Data ({config.districtBlocks.length} blocks configured)
        </h2>
        <p className="text-xs sm:text-sm text-[#243647] mb-4 leading-relaxed">
          Import approved blocks strictly for{' '}
          <strong className="font-medium text-[#0A1B2C]">{config.allowedDistricts.join(', ')}</strong>. Upload a
          CSV or Excel file with columns <code>District, Block, Active</code> (e.g.{' '}
          <code>Cuddalore, Panruti, true</code>). Invalid rows or unapproved districts are flagged
          without silently discarding data.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="flex flex-col gap-3">
            <label className="text-xs font-medium text-[#0A1B2C]">
              Upload CSV / Excel (.xlsx) Block Mapping
              <input
                type="file"
                accept=".csv,.xlsx"
                onChange={(e) => void handleBlockFileUpload(e)}
                className="mt-1.5 block w-full text-xs text-[#243647] file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-[#1EA7FF] hover:file:bg-[#0D94EC] file:text-[#0A1B2C] file:font-medium cursor-pointer"
              />
            </label>

            <div>
              <label htmlFor="block-csv-paste" className="block text-xs font-medium text-[#0A1B2C] mb-1">
                Or paste CSV rows (District, Block, Active)
              </label>
              <textarea
                id="block-csv-paste"
                rows={4}
                value={csvPaste}
                onChange={(e) => setCsvPaste(e.target.value)}
                placeholder={'District,Block,Active\nCuddalore,Panruti,true\nNagapattinam,Kilvelur,true'}
                className="ct-input text-xs font-mono"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 text-xs text-[#243647] cursor-pointer">
                <input
                  type="checkbox"
                  checked={replaceBlocks}
                  onChange={(e) => setReplaceBlocks(e.target.checked)}
                  className="w-4 h-4 accent-[#006BB8]"
                />
                Replace existing block list
              </label>
              <button
                type="button"
                onClick={handlePreviewCsvPaste}
                className="ct-btn-secondary text-xs min-h-[38px] px-3"
              >
                <Upload className="w-4 h-4" aria-hidden="true" />
                Preview Import
              </button>
            </div>
          </div>

          <div className="rounded-xl bg-[#F5F2E9] border border-[#DFD7C2] p-4">
            <h3 className="text-sm font-medium text-[#0A1B2C] mb-2.5">Current District Coverage</h3>
            <div className="space-y-2 text-xs ct-num">
              {config.allowedDistricts.map((dist) => {
                const count = config.districtBlocks.filter(
                  (b) => b.district === dist && b.active,
                ).length;
                return (
                  <div
                    key={dist}
                    className="flex justify-between p-2.5 rounded-lg bg-[#FFFFFF] border border-[#DFD7C2]"
                  >
                    <span className="font-medium text-[#0A1B2C]">{dist}</span>
                    <span className={count > 0 ? 'text-[#047857] font-medium' : 'text-[#92400E]'}>
                      {count > 0 ? `${count} active blocks` : 'Not configured yet'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Preview & Errors */}
        {blockPreview && (
          <div className="mt-4 p-4 rounded-xl bg-[#F5F2E9] border border-[#DFD7C2] flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 ct-num">
              <span className="text-sm font-medium text-[#0A1B2C]">
                Preview: {blockPreview.validEntries.length} valid rows · {blockPreview.errors.length}{' '}
                errors
              </span>
              <button
                type="button"
                disabled={
                  importingBlocks ||
                  blockPreview.validEntries.length === 0 ||
                  blockPreview.errors.length > 0
                }
                onClick={() => void handleApplyBlockImport()}
                className="ct-btn-primary text-xs min-h-[38px] px-4"
              >
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                {importingBlocks ? 'Importing...' : 'Apply Valid Import'}
              </button>
            </div>

            {blockPreview.errors.length > 0 && (
              <div className="p-3 rounded-lg bg-[#FFF1F2] border border-[#BE123C]/40 text-xs text-[#BE123C]">
                <p className="font-medium mb-1">
                  Fix or remove invalid rows before applying (errors are never silently discarded):
                </p>
                <ul className="list-disc pl-5 space-y-0.5">
                  {blockPreview.errors.map((e) => (
                    <li key={`${e.row}-${e.raw}`}>
                      Row {e.row} ({e.raw}): {e.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 2. System Configuration & Official 63-Column Template */}
      <section className="ct-card p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <h2 className="text-xl font-medium text-[#0A1B2C]">
              System Configuration & 63-Column Export Template
            </h2>
            <p className="text-xs sm:text-sm text-[#243647] mt-0.5">
              {isSuperAdmin
                ? 'Super Administrator access verified: configure programme settings, tours, Video IDs, partner name, and the 63-column reporting template.'
                : 'Read-only view. Only a Super Administrator can modify system configuration and export schemas.'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
          <div>
            <label htmlFor="cfg-schoolYear" className="block text-xs font-medium text-[#0A1B2C] mb-1">
              School Year
            </label>
            <input
              id="cfg-schoolYear"
              type="text"
              disabled={!isSuperAdmin}
              value={schoolYear}
              onChange={(e) => setSchoolYear(e.target.value)}
              className="ct-input text-sm ct-num"
            />
          </div>

          <div>
            <label htmlFor="cfg-partnerName" className="block text-xs font-medium text-[#0A1B2C] mb-1">
              Partner Name (required for reporting)
            </label>
            <input
              id="cfg-partnerName"
              type="text"
              disabled={!isSuperAdmin}
              placeholder="Enter official partner organization name"
              value={partnerName}
              onChange={(e) => setPartnerName(e.target.value)}
              className="ct-input text-sm"
            />
          </div>

          <div>
            <label htmlFor="cfg-grades" className="block text-xs font-medium text-[#0A1B2C] mb-1">
              Grade Options (comma-separated)
            </label>
            <input
              id="cfg-grades"
              type="text"
              disabled={!isSuperAdmin}
              value={gradesText}
              onChange={(e) => setGradesText(e.target.value)}
              className="ct-input text-sm"
            />
          </div>

          <div>
            <label htmlFor="cfg-languages" className="block text-xs font-medium text-[#0A1B2C] mb-1">
              Language Options (comma-separated)
            </label>
            <input
              id="cfg-languages"
              type="text"
              disabled={!isSuperAdmin}
              value={languagesText}
              onChange={(e) => setLanguagesText(e.target.value)}
              className="ct-input text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
          <div>
            <label htmlFor="cfg-schoolTypes" className="block text-xs font-medium text-[#0A1B2C] mb-1">
              School Types (one per line)
            </label>
            <textarea
              id="cfg-schoolTypes"
              rows={4}
              disabled={!isSuperAdmin}
              value={schoolTypesText}
              onChange={(e) => setSchoolTypesText(e.target.value)}
              className="ct-input text-xs"
            />
          </div>

          <div className="p-4 rounded-xl bg-[#F5F2E9] border border-[#DFD7C2] flex flex-col gap-3">
            <h3 className="text-sm font-medium text-[#0A1B2C]">Facilitator Form Policies</h3>
            <label className="inline-flex items-center gap-2 text-xs text-[#243647] cursor-pointer">
              <input
                type="checkbox"
                disabled={!isSuperAdmin}
                checked={allowFacDelete}
                onChange={(e) => setAllowFacDelete(e.target.checked)}
                className="w-4 h-4 accent-[#006BB8]"
              />
              Allow facilitators to archive their own submitted sessions
            </label>
            <p className="text-xs text-[#33475B] leading-relaxed">
              Reporting, analytics, and `.xlsx` data exports remain restricted exclusively to Super
              Administrators.
            </p>
          </div>
        </div>

        {/* Tour Inventory & Video IDs */}
        <div className="mb-5 p-4 rounded-xl bg-[#F5F2E9] border border-[#DFD7C2]">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-medium text-[#0A1B2C]">
              Career Tour Inventory & Configured Video IDs
            </h3>
            <div className="flex items-center gap-2 text-xs">
              <label htmlFor="cfg-video-lang" className="text-[#243647]">
                Language:
              </label>
              <select
                id="cfg-video-lang"
                value={selectedVideoLang}
                onChange={(e) => setSelectedVideoLang(e.target.value)}
                className="ct-input ct-select w-40 text-xs min-h-[36px] py-1"
              >
                {config.languageOptions.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-3">
            {tours.map((tour, idx) => (
              <div
                key={tour.tourId}
                className="p-3 rounded-lg bg-[#FFFFFF] border border-[#DFD7C2] grid grid-cols-1 sm:grid-cols-3 gap-3 items-center text-xs"
              >
                <div>
                  <div className="font-medium text-[#0A1B2C]">{tour.tourName}</div>
                  <div className="text-[#243647] font-mono">
                    ID: {tour.tourId} · Code: {tour.tourCode}
                  </div>
                </div>
                <div>
                  <label htmlFor={`cfg-vid-${tour.tourId}`} className="block text-[#243647] mb-1">
                    {selectedVideoLang} Video ID
                  </label>
                  <input
                    id={`cfg-vid-${tour.tourId}`}
                    type="text"
                    disabled={!isSuperAdmin}
                    placeholder="e.g. AFE-IN-AM-OV-TA-2026"
                    value={tour.videoIdByLanguage?.[selectedVideoLang] ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setTours((prev) =>
                        prev.map((t, i) =>
                          i === idx
                            ? {
                                ...t,
                                videoIdByLanguage: {
                                  ...t.videoIdByLanguage,
                                  [selectedVideoLang]: val,
                                },
                              }
                            : t,
                        ),
                      );
                    }}
                    className="ct-input text-xs font-mono min-h-[36px] py-1"
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <label className="inline-flex items-center gap-1.5 text-[#243647] cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!isSuperAdmin}
                      checked={tour.active}
                      onChange={(e) =>
                        setTours((prev) =>
                          prev.map((t, i) => (i === idx ? { ...t, active: e.target.checked } : t)),
                        )
                      }
                      className="w-4 h-4 accent-[#006BB8]"
                    />
                    Active
                  </label>
                </div>
              </div>
            ))}

            {isSuperAdmin && (
              <div className="flex flex-wrap items-end gap-2 pt-2">
                <div className="flex-1 min-w-[200px]">
                  <label htmlFor="cfg-new-tour-name" className="block text-xs text-[#243647] mb-1">
                    Add New Career Tour
                  </label>
                  <input
                    id="cfg-new-tour-name"
                    type="text"
                    placeholder="Tour title"
                    value={newTourName}
                    onChange={(e) => setNewTourName(e.target.value)}
                    className="ct-input text-xs min-h-[38px] py-1"
                  />
                </div>
                <div className="w-28">
                  <label htmlFor="cfg-new-tour-code" className="block text-xs text-[#243647] mb-1">
                    Tour Code
                  </label>
                  <input
                    id="cfg-new-tour-code"
                    type="text"
                    placeholder="e.g. AWS"
                    value={newTourCode}
                    onChange={(e) => setNewTourCode(e.target.value)}
                    className="ct-input text-xs min-h-[38px] py-1 uppercase"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAddTour}
                  className="ct-btn-secondary text-xs min-h-[38px] px-3 py-1"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  Add Tour
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Official 63-column Template Uploader */}
        <div className="p-4 rounded-xl bg-[#F5F2E9] border border-[#DFD7C2] mb-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h3 className="text-sm font-medium text-[#0A1B2C] flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-[#006BB8]" aria-hidden="true" />
              Official 63-Column Excel Reporting Template
            </h3>
            <span
              className={`text-xs px-2.5 py-0.5 rounded-full font-medium border ${
                draftTemplate?.columns.length === 63
                  ? 'bg-[#ECFDF5] text-[#047857] border-[#047857]/35'
                  : 'bg-[#FFFBEB] text-[#92400E] border-[#B45309]/40'
              }`}
            >
              {draftTemplate?.columns.length === 63
                ? `Loaded: ${draftTemplate.templateName} (63 columns)`
                : 'Not imported yet'}
            </span>
          </div>
          <p className="text-xs text-[#243647] mb-3">
            Upload the original 63-column <code>.xlsx</code> reporting template to automatically
            capture the exact header names and column order (1–63) without guessing.
          </p>

          {isSuperAdmin && (
            <input
              type="file"
              accept=".xlsx"
              aria-label="Upload official 63-column Excel template"
              onChange={(e) => void handleTemplate63Upload(e)}
              className="block w-full text-xs text-[#243647] file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-[#1EA7FF] hover:file:bg-[#0D94EC] file:text-[#0A1B2C] file:font-medium cursor-pointer"
            />
          )}

          {draftTemplate && draftTemplate.columns.length === 63 && (
            <div className="mt-3 max-h-60 overflow-y-auto rounded-lg border border-[#DFD7C2] divide-y divide-[#DFD7C2] text-xs">
              {draftTemplate.columns.map((col, idx) => (
                <div
                  key={col.index}
                  className="p-2 flex flex-wrap items-center justify-between gap-2 bg-[#FFFFFF]"
                >
                  <span className="font-mono text-[#0A1B2C] ct-num">
                    #{col.index}: <strong className="font-medium">{col.header}</strong>
                  </span>
                  <select
                    disabled={!isSuperAdmin}
                    aria-label={`Source field mapping for column ${col.index}: ${col.header}`}
                    value={col.sourceKey}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDraftTemplate((prev) =>
                        prev
                          ? {
                              ...prev,
                              columns: prev.columns.map((c, i) =>
                                i === idx ? { ...c, sourceKey: val } : c,
                              ),
                            }
                          : null,
                      );
                    }}
                    className="ct-input ct-select w-60 text-xs min-h-[36px] py-1"
                  >
                    <option value="">-- Blank / Unmapped --</option>
                    {KNOWN_EXPORT_SOURCE_KEYS.map((sk) => (
                      <option key={sk.key} value={sk.key}>
                        {sk.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>

        {isSuperAdmin && (
          <button
            type="button"
            disabled={savingConfig}
            onClick={() => void handleSaveSystemConfig()}
            className="ct-btn-primary"
          >
            <Save className="w-4 h-4" aria-hidden="true" />
            {savingConfig ? 'Saving configuration...' : 'Save System Configuration'}
          </button>
        )}
      </section>

      {/* 3. Audit Log */}
      <AuditLogViewer api={api} />
    </div>
  );
};

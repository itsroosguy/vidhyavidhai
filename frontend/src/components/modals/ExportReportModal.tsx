import React, { useMemo, useState } from 'react';
import { AlertTriangle, Download, FileSpreadsheet, Info } from 'lucide-react';
import {
  generateExportCsvString,
  generateExportWorkbookBuffer,
  triggerCsvDownload,
  triggerXlsxDownload,
} from '../../services/exportService';
import type { AppConfiguration, SessionRecord } from '../../types/domain';
import { GlassModal } from './GlassModal';

interface ExportReportModalProps {
  open: boolean;
  onClose: () => void;
  sessions: SessionRecord[];
  config: AppConfiguration;
  defaultFilenamePrefix: string;
  scopeLabel: string;
  onExportComplete: (rowCount: number, columnCount: number, usedOfficial63: boolean, mode: string) => void;
}

export const ExportReportModal: React.FC<ExportReportModalProps> = ({
  open,
  onClose,
  sessions,
  config,
  defaultFilenamePrefix,
  scopeLabel,
  onExportComplete,
}) => {
  const hasOfficial63 = Boolean(
    config.exportTemplate63 && config.exportTemplate63.columns.length === 63,
  );
  const [schemaMode, setSchemaMode] = useState<'official_63' | 'standard'>(
    hasOfficial63 ? 'official_63' : 'standard',
  );
  const [exporting, setExporting] = useState(false);

  const expandedRowCount = useMemo(
    () => sessions.reduce((acc, s) => acc + Math.max(1, s.details.length), 0),
    [sessions],
  );
  const totalStudents = useMemo(
    () => sessions.reduce((acc, s) => acc + s.totalStudentsPresent, 0),
    [sessions],
  );

  const effectiveMode =
    schemaMode === 'official_63' && hasOfficial63 ? 'official_63' : 'standard';

  const handleDownloadXlsx = async () => {
    setExporting(true);
    try {
      const out = await generateExportWorkbookBuffer(sessions, config, effectiveMode);
      const fname = `${defaultFilenamePrefix}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      triggerXlsxDownload(out.buffer, fname);
      onExportComplete(out.rowCount, out.columnCount, out.usedOfficial63Schema, effectiveMode);
      onClose();
    } finally {
      setExporting(false);
    }
  };

  const handleDownloadCsv = () => {
    setExporting(true);
    try {
      const out = generateExportCsvString(sessions, config, effectiveMode);
      const fname = `${defaultFilenamePrefix}_${new Date().toISOString().slice(0, 10)}.csv`;
      triggerCsvDownload(out.csv, fname);
      onExportComplete(
        out.rowCount,
        out.columnCount,
        out.usedOfficial63Schema,
        `${effectiveMode}:csv`,
      );
      onClose();
    } finally {
      setExporting(false);
    }
  };

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      size="md"
      eyebrow="Spreadsheet & CSV Export"
      title="Export Programme Report (.xlsx / .csv)"
      subtitle="Expanded rows emit one line per grade and section for combined classes, matching monitoring requirements."
      headerBadge={
        <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#F5F2E9] border border-[#C7BEA7] text-[#0A1B2C] ct-num">
          {expandedRowCount} export rows
        </span>
      }
      footer={
        <>
          <button type="button" onClick={onClose} className="ct-btn-secondary text-sm">
            Cancel
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={handleDownloadCsv}
            className="ct-btn-secondary text-sm"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            {exporting ? 'Preparing...' : 'Download .csv'}
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={() => void handleDownloadXlsx()}
            className="ct-btn-primary text-sm"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            {exporting
              ? 'Generating .xlsx...'
              : sessions.length === 0
                ? 'Download Schema-Ready Workbook (.xlsx)'
                : 'Download .xlsx Workbook'}
          </button>
        </>
      }
    >
      {/* Scope & Expansion Preview */}
      <div className="grid grid-cols-3 gap-3 text-xs">
        <div className="p-3.5 rounded-lg bg-[#F5F2E9] border border-[#DFD7C2]">
          <div className="text-[#243647]">Matching Sessions</div>
          <div className="text-lg font-semibold text-[#0A1B2C] ct-num mt-1">{sessions.length}</div>
        </div>
        <div className="p-3.5 rounded-lg bg-[#E8F6FF] border border-[#0284C7]/45">
          <div className="text-[#006BB8] font-medium">Expanded Rows</div>
          <div className="text-lg font-semibold text-[#0A1B2C] ct-num mt-1">
            {expandedRowCount}
          </div>
        </div>
        <div className="p-3.5 rounded-lg bg-[#F5F2E9] border border-[#DFD7C2]">
          <div className="text-[#243647]">Students Present</div>
          <div className="text-lg font-semibold text-[#0A1B2C] ct-num mt-1">{totalStudents}</div>
        </div>
      </div>

      <div className="p-3.5 rounded-xl bg-[#F5F2E9] border border-[#DFD7C2] text-xs space-y-1.5">
        <div className="flex items-center justify-between text-[#243647]">
          <span>Active Filter Scope</span>
          <span className="font-mono text-[#0A1B2C]">{scopeLabel}</span>
        </div>
        <div className="flex items-center justify-between text-[#243647]">
          <span>Partner Name</span>
          <span className="text-[#0A1B2C]">
            {config.partnerName.trim() || 'Not configured yet (blank)'}
          </span>
        </div>
      </div>

      {/* Schema Choice */}
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-[#0A1B2C]">Export column schema</legend>

        <label
          className={`flex items-start gap-3 p-3.5 rounded-xl border transition-colors ${
            hasOfficial63
              ? schemaMode === 'official_63'
                ? 'bg-[#E8F6FF] border-[#0284C7] cursor-pointer'
                : 'bg-[#FFFFFF] border-[#DFD7C2] cursor-pointer hover:border-[#0284C7]/60'
              : 'bg-[#F5F2E9] border-[#DFD7C2] opacity-70 cursor-not-allowed'
          }`}
        >
          <input
            type="radio"
            name="export-schema-mode"
            disabled={!hasOfficial63}
            checked={effectiveMode === 'official_63'}
            onChange={() => setSchemaMode('official_63')}
            className="mt-1 accent-[#006BB8]"
          />
          <div className="text-xs space-y-0.5">
            <div className="font-medium text-[#0A1B2C] flex items-center gap-1.5">
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#006BB8]" aria-hidden="true" />
              Official 63-Column Monitoring Template
            </div>
            <p className="text-[#243647]">
              {hasOfficial63
                ? `Verified template loaded (${config.exportTemplate63?.templateName}). Preserves exact 63-column order.`
                : 'Pending upload of the official 63-column header schema in Master Data Settings.'}
            </p>
          </div>
        </label>

        <label
          className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-colors ${
            effectiveMode === 'standard'
              ? 'bg-[#E8F6FF] border-[#0284C7]'
              : 'bg-[#FFFFFF] border-[#DFD7C2] hover:border-[#0284C7]/60'
          }`}
        >
          <input
            type="radio"
            name="export-schema-mode"
            checked={effectiveMode === 'standard'}
            onChange={() => setSchemaMode('standard')}
            className="mt-1 accent-[#006BB8]"
          />
          <div className="text-xs space-y-0.5">
            <div className="font-medium text-[#0A1B2C]">
              Standard Analytical Workbook (.xlsx)
            </div>
            <p className="text-[#243647]">
              Clean multi-column export covering Session ID, UDISE text preservation, CSAT, ITP,
              Teacher NPS, attendance, and Video IDs.
            </p>
          </div>
        </label>
      </fieldset>

      {sessions.length === 0 && (
        <div className="p-3 rounded-lg bg-[#E8F6FF] border border-[#0284C7]/40 text-xs text-[#0A1B2C] flex items-start gap-2">
          <Info className="w-4 h-4 text-[#006BB8] shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            0 sessions currently match this filter. Downloading now produces a structured
            schema-ready workbook (AutoFilters, dropdown validations, plain-text UDISE/PIN
            formats, 0-evaluated <strong>Summary &amp; KPIs</strong> formulas, and full{' '}
            <strong>Declarations</strong>).
          </div>
        </div>
      )}

      {(!hasOfficial63 || !config.partnerName.trim()) && (
        <div className="p-3 rounded-lg bg-[#FFFBEB] border border-[#B45309]/40 text-xs text-[#92400E] flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-[#B45309] shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            {!hasOfficial63 && 'Official 63-column headers have not been imported yet. '}
            {!config.partnerName.trim() && 'Partner Name is not set in Master Data Settings. '}
            Standard export remains fully accurate and preserves leading-zero UDISE & PIN codes.
          </div>
        </div>
      )}
    </GlassModal>
  );
};

import React, { useMemo, useState } from 'react';
import { AlertTriangle, Download, FileSpreadsheet } from 'lucide-react';
import {
  generateExportWorkbookBuffer,
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

  const handleDownload = async () => {
    if (sessions.length === 0) return;
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

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      size="md"
      eyebrow="Spreadsheet Export"
      title="Export Programme Report (.xlsx)"
      subtitle="Expanded rows emit one line per grade and section for combined classes, matching monitoring requirements."
      headerBadge={
        <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#162D55] border border-[#26456F] text-[#E8EFFC] ct-num">
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
            disabled={exporting || sessions.length === 0}
            onClick={() => void handleDownload()}
            className="ct-btn-primary text-sm"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            {exporting ? 'Generating .xlsx...' : 'Download .xlsx Workbook'}
          </button>
        </>
      }
    >
      {/* Scope & Expansion Preview */}
      <div className="grid grid-cols-3 gap-3 text-xs">
        <div className="p-3.5 rounded-lg bg-[#0C1931] border border-[#26456F]">
          <div className="text-[#A4B7D2]">Matching Sessions</div>
          <div className="text-lg font-semibold text-[#E8EFFC] ct-num mt-1">{sessions.length}</div>
        </div>
        <div className="p-3.5 rounded-lg bg-[#0C1931] border border-[#26456F]">
          <div className="text-[#A4B7D2]">Expanded Rows</div>
          <div className="text-lg font-semibold text-[#4EBBBB] ct-num mt-1">
            {expandedRowCount}
          </div>
        </div>
        <div className="p-3.5 rounded-lg bg-[#0C1931] border border-[#26456F]">
          <div className="text-[#A4B7D2]">Students Present</div>
          <div className="text-lg font-semibold text-[#E8EFFC] ct-num mt-1">{totalStudents}</div>
        </div>
      </div>

      <div className="p-3.5 rounded-xl bg-[#0C1931] border border-[#26456F] text-xs space-y-1.5">
        <div className="flex items-center justify-between text-[#A4B7D2]">
          <span>Active Filter Scope</span>
          <span className="font-mono text-[#E8EFFC]">{scopeLabel}</span>
        </div>
        <div className="flex items-center justify-between text-[#A4B7D2]">
          <span>Partner Name</span>
          <span className="text-[#E8EFFC]">
            {config.partnerName.trim() || 'Not configured yet (blank)'}
          </span>
        </div>
      </div>

      {/* Schema Choice */}
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-[#E8EFFC]">Export column schema</legend>

        <label
          className={`flex items-start gap-3 p-3.5 rounded-xl border transition-colors ${
            hasOfficial63
              ? schemaMode === 'official_63'
                ? 'bg-[#4EBBBB]/12 border-[#4EBBBB]/55 cursor-pointer'
                : 'bg-[#0C1931] border-[#26456F] cursor-pointer hover:border-[#4EBBBB]/45'
              : 'bg-[#0C1931]/60 border-[#26456F] opacity-55 cursor-not-allowed'
          }`}
        >
          <input
            type="radio"
            name="export-schema-mode"
            disabled={!hasOfficial63}
            checked={effectiveMode === 'official_63'}
            onChange={() => setSchemaMode('official_63')}
            className="mt-1 accent-[#4EBBBB]"
          />
          <div className="text-xs space-y-0.5">
            <div className="font-medium text-[#E8EFFC] flex items-center gap-1.5">
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#4EBBBB]" aria-hidden="true" />
              Official 63-Column Monitoring Template
            </div>
            <p className="text-[#A4B7D2]">
              {hasOfficial63
                ? `Verified template loaded (${config.exportTemplate63?.templateName}). Preserves exact 63-column order.`
                : 'Pending upload of the official 63-column header schema in Master Data Settings.'}
            </p>
          </div>
        </label>

        <label
          className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-colors ${
            effectiveMode === 'standard'
              ? 'bg-[#4EBBBB]/12 border-[#4EBBBB]/55'
              : 'bg-[#0C1931] border-[#26456F] hover:border-[#4EBBBB]/45'
          }`}
        >
          <input
            type="radio"
            name="export-schema-mode"
            checked={effectiveMode === 'standard'}
            onChange={() => setSchemaMode('standard')}
            className="mt-1 accent-[#4EBBBB]"
          />
          <div className="text-xs space-y-0.5">
            <div className="font-medium text-[#E8EFFC]">
              Standard Analytical Workbook (.xlsx)
            </div>
            <p className="text-[#A4B7D2]">
              Clean multi-column export covering Session ID, UDISE text preservation, CSAT, ITP,
              Teacher NPS, attendance, and Video IDs.
            </p>
          </div>
        </label>
      </fieldset>

      {(!hasOfficial63 || !config.partnerName.trim()) && (
        <div className="p-3 rounded-lg bg-[#392A11] border border-[#F2B44D]/45 text-xs text-[#F2B44D] flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
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

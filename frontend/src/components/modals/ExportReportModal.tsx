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
        <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#F1F5F9] border border-[#CBD5E1] text-[#0F172A] ct-num">
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
        <div className="p-3.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]">
          <div className="text-[#475569]">Matching Sessions</div>
          <div className="text-lg font-semibold text-[#0F172A] ct-num mt-1">{sessions.length}</div>
        </div>
        <div className="p-3.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]">
          <div className="text-[#475569]">Expanded Rows</div>
          <div className="text-lg font-semibold text-[#0F766E] ct-num mt-1">
            {expandedRowCount}
          </div>
        </div>
        <div className="p-3.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]">
          <div className="text-[#475569]">Students Present</div>
          <div className="text-lg font-semibold text-[#0F172A] ct-num mt-1">{totalStudents}</div>
        </div>
      </div>

      <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs space-y-1.5">
        <div className="flex items-center justify-between text-[#475569]">
          <span>Active Filter Scope</span>
          <span className="font-mono text-[#0F172A]">{scopeLabel}</span>
        </div>
        <div className="flex items-center justify-between text-[#475569]">
          <span>Partner Name</span>
          <span className="text-[#0F172A]">
            {config.partnerName.trim() || 'Not configured yet (blank)'}
          </span>
        </div>
      </div>

      {/* Schema Choice */}
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-[#0F172A]">Export column schema</legend>

        <label
          className={`flex items-start gap-3 p-3.5 rounded-xl border transition-colors ${
            hasOfficial63
              ? schemaMode === 'official_63'
                ? 'bg-[#E6F6F4] border-[#0F766E]/60 cursor-pointer'
                : 'bg-[#FFFFFF] border-[#E2E8F0] cursor-pointer hover:border-[#0F766E]/45'
              : 'bg-[#F1F5F9] border-[#E2E8F0] opacity-65 cursor-not-allowed'
          }`}
        >
          <input
            type="radio"
            name="export-schema-mode"
            disabled={!hasOfficial63}
            checked={effectiveMode === 'official_63'}
            onChange={() => setSchemaMode('official_63')}
            className="mt-1 accent-[#0F766E]"
          />
          <div className="text-xs space-y-0.5">
            <div className="font-medium text-[#0F172A] flex items-center gap-1.5">
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#0F766E]" aria-hidden="true" />
              Official 63-Column Monitoring Template
            </div>
            <p className="text-[#475569]">
              {hasOfficial63
                ? `Verified template loaded (${config.exportTemplate63?.templateName}). Preserves exact 63-column order.`
                : 'Pending upload of the official 63-column header schema in Master Data Settings.'}
            </p>
          </div>
        </label>

        <label
          className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-colors ${
            effectiveMode === 'standard'
              ? 'bg-[#E6F6F4] border-[#0F766E]/60'
              : 'bg-[#FFFFFF] border-[#E2E8F0] hover:border-[#0F766E]/45'
          }`}
        >
          <input
            type="radio"
            name="export-schema-mode"
            checked={effectiveMode === 'standard'}
            onChange={() => setSchemaMode('standard')}
            className="mt-1 accent-[#0F766E]"
          />
          <div className="text-xs space-y-0.5">
            <div className="font-medium text-[#0F172A]">
              Standard Analytical Workbook (.xlsx)
            </div>
            <p className="text-[#475569]">
              Clean multi-column export covering Session ID, UDISE text preservation, CSAT, ITP,
              Teacher NPS, attendance, and Video IDs.
            </p>
          </div>
        </label>
      </fieldset>

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

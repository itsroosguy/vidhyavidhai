import React, { useCallback, useEffect, useId, useState } from 'react';
import {
  Archive,
  Download,
  Edit3,
  Eye,
  FilterX,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import { formatScore2 } from '../calculations/metrics';
import { ExportReportModal } from '../components/modals/ExportReportModal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import type { BackendApiClient } from '../services/apiClient';
import type {
  AppConfiguration,
  PaginatedResult,
  SessionQueryFilters,
  SessionRecord,
  UserProfile,
} from '../types/domain';
import { formatISODateToDDMMYYYY } from '../utils/temporal';
import { SessionDetailModal } from './SessionDetailModal';

interface MyClassesPageProps {
  api: BackendApiClient;
  user: UserProfile;
  config: AppConfiguration;
  dataVersion?: number;
  onEditSession: (session: SessionRecord) => void;
  onOpenNewModal?: () => void;
  onOpenEditModal?: (session: SessionRecord) => void;
  onNotify: (type: 'success' | 'error' | 'warning', title: string, detail?: string) => void;
}

export const MyClassesPage: React.FC<MyClassesPageProps> = ({
  api,
  user,
  config,
  dataVersion = 0,
  onEditSession,
  onOpenNewModal,
  onOpenEditModal,
  onNotify,
}) => {
  const [filters, setFilters] = useState<SessionQueryFilters>({
    search: '',
    district: '',
    tourId: '',
    grade: '',
    dateFrom: '',
    dateTo: '',
    page: 1,
    pageSize: 10,
  });

  const [result, setResult] = useState<PaginatedResult<SessionRecord>>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 10,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [preparingExport, setPreparingExport] = useState(false);
  const [exportModalSessions, setExportModalSessions] = useState<SessionRecord[] | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<SessionRecord | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<SessionRecord | null>(null);

  const isSuperAdmin = user.role === 'super_admin';
  const captionId = useId();

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getMySessions(filters);
      if (res.ok && res.data) {
        setResult(res.data);
      } else {
        onNotify('error', 'Failed to load sessions', res.error);
      }
    } finally {
      setLoading(false);
    }
  }, [api, filters, onNotify]);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions, dataVersion]);

  const handleClearFilters = () => {
    setFilters({
      search: '',
      district: '',
      tourId: '',
      grade: '',
      dateFrom: '',
      dateTo: '',
      page: 1,
      pageSize: 10,
    });
  };

  const handleArchiveConfirm = async () => {
    if (!archiveTarget) return;
    const target = archiveTarget;
    setArchiveTarget(null);
    const res = await api.archiveSession(target.sessionRecordId);
    if (res.ok) {
      onNotify('success', 'Session archived', `${target.sessionId} moved to archive.`);
      void fetchSessions();
    } else {
      onNotify('error', 'Could not archive session', res.error);
    }
  };

  const handlePrepareExportModal = async () => {
    if (!isSuperAdmin) return;
    setPreparingExport(true);
    try {
      const collected: SessionRecord[] = [];
      let page = 1;
      let totalPages = 1;
      do {
        const res = await api.getMySessions({ ...filters, page, pageSize: 100 });
        if (!res.ok || !res.data) {
          onNotify('error', 'Export preparation failed', res.error);
          return;
        }
        collected.push(...res.data.items);
        totalPages = res.data.totalPages;
        page++;
      } while (page <= totalPages);

      if (collected.length === 0) {
        onNotify('warning', 'Nothing to export', 'No matching sessions found.');
        return;
      }
      setExportModalSessions(collected);
    } finally {
      setPreparingExport(false);
    }
  };

  const handleEditAction = (session: SessionRecord) => {
    if (onOpenEditModal) {
      onOpenEditModal(session);
    } else {
      onEditSession(session);
    }
  };

  return (
    <main className="w-full max-w-[1220px] mx-auto px-4 sm:px-6 pb-16 flex flex-col gap-5">
      {/* Header & Search */}
      <section className="ct-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-xl font-medium text-[#0A1B2C]">My classes</h2>
            <p className="text-xs sm:text-sm text-[#243647] mt-0.5 ct-num">
              {isSuperAdmin ? (
                <>
                  Showing records owned by <strong className="font-medium text-[#0A1B2C]">{user.email}</strong> (
                  {result.total} {result.total === 1 ? 'session' : 'sessions'})
                </>
              ) : (
                <>
                  Your saved classroom entries for{' '}
                  <strong className="font-medium text-[#0A1B2C]">{user.email}</strong>
                </>
              )}
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
            <button
              type="button"
              onClick={() => void fetchSessions()}
              className="ct-btn-secondary text-xs min-h-[40px] px-3"
            >
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              Refresh
            </button>
            {isSuperAdmin && (
              <button
                type="button"
                disabled={preparingExport || result.total === 0}
                onClick={() => void handlePrepareExportModal()}
                className="ct-btn-primary text-xs min-h-[40px] px-4"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                {preparingExport ? 'Preparing...' : 'Export My Sessions (.xlsx)'}
              </button>
            )}
          </div>
        </div>

        {/* Search & Filter controls */}
        <div role="search" aria-label="Filter saved classes">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="sm:col-span-2">
              <label htmlFor="my-search" className="block text-xs font-medium text-[#0A1B2C] mb-1">
                Search (School, UDISE, Session ID)
              </label>
              <div className="relative">
                <Search
                  className="w-4 h-4 text-[#33475B] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="my-search"
                  type="search"
                  placeholder="Search school, UDISE, ID..."
                  value={filters.search ?? ''}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, search: e.target.value, page: 1 }))
                  }
                  className="ct-input pl-9 text-sm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="my-district" className="block text-xs font-medium text-[#0A1B2C] mb-1">
                District
              </label>
              <select
                id="my-district"
                value={filters.district ?? ''}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, district: e.target.value, page: 1 }))
                }
                className="ct-input ct-select text-sm"
              >
                <option value="">All 3 districts</option>
                {config.allowedDistricts.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="my-tour" className="block text-xs font-medium text-[#0A1B2C] mb-1">
                Career Tour
              </label>
              <select
                id="my-tour"
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
              <label htmlFor="my-grade" className="block text-xs font-medium text-[#0A1B2C] mb-1">
                Grade
              </label>
              <select
                id="my-grade"
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
              <label htmlFor="my-dateFrom" className="block text-xs font-medium text-[#0A1B2C] mb-1">
                From Date
              </label>
              <input
                id="my-dateFrom"
                type="date"
                value={filters.dateFrom ?? ''}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, dateFrom: e.target.value, page: 1 }))
                }
                className="ct-input text-sm ct-num"
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
            <div className="w-full sm:w-48">
              <label htmlFor="my-dateTo" className="block text-xs font-medium text-[#0A1B2C] mb-1">
                To Date
              </label>
              <input
                id="my-dateTo"
                type="date"
                value={filters.dateTo ?? ''}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, dateTo: e.target.value, page: 1 }))
                }
                className="ct-input text-sm ct-num"
              />
            </div>

            <button
              type="button"
              onClick={handleClearFilters}
              className="ct-btn-secondary text-xs min-h-[40px] px-3"
            >
              <FilterX className="w-4 h-4" aria-hidden="true" />
              Clear filters
            </button>
          </div>
        </div>
      </section>

      {/* Results Table */}
      <section className="ct-card p-4 sm:p-5">
        {loading ? (
          <div className="py-12 text-center text-sm text-[#243647]">
            Loading your saved sessions...
          </div>
        ) : result.items.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-base font-medium text-[#0A1B2C]">No sessions found</p>
            <p className="text-xs sm:text-sm text-[#243647] mt-1">
              Submit a session in "Enter a class" or clear your active filters.
            </p>
          </div>
        ) : (
          <>
            <div
              tabIndex={0}
              role="region"
              aria-labelledby={captionId}
              className="ct-table-wrapper rounded-xl border border-[#DFD7C2]"
            >
              <table className="w-full text-left text-xs sm:text-sm border-collapse min-w-[920px]">
                <caption id={captionId} className="visually-hidden">
                  Facilitator submitted classroom sessions
                </caption>
                <thead className="bg-[#F5F2E9] text-[#243647] uppercase text-[11px]">
                  <tr>
                    <th scope="col" className="p-3 font-medium">Session ID</th>
                    <th scope="col" className="p-3 font-medium">School Name</th>
                    <th scope="col" className="p-3 font-medium">District / Block</th>
                    <th scope="col" className="p-3 font-medium">Tour</th>
                    <th scope="col" className="p-3 font-medium">Class</th>
                    <th scope="col" className="p-3 font-medium">Date</th>
                    <th scope="col" className="p-3 font-medium">Students</th>
                    <th scope="col" className="p-3 font-medium">CSAT</th>
                    <th scope="col" className="p-3 font-medium">ITP</th>
                    <th scope="col" className="p-3 font-medium">Teacher NPS</th>
                    <th scope="col" className="p-3 font-medium">Status</th>
                    <th scope="col" className="p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#DFD7C2]">
                  {result.items.map((s) => {
                    const classText =
                      s.sessionType === 'single' && s.details[0]
                        ? `${s.details[0].grade}${s.details[0].section === 'No section' ? '' : s.details[0].section}`
                        : `Combined (${s.totalClasses})`;

                    return (
                      <tr key={s.sessionRecordId} className="bg-[#FFFFFF] hover:bg-[#F5F2E9] transition-colors ct-num">
                        <th scope="row" className="p-3 font-mono text-xs font-medium text-[#006BB8] whitespace-nowrap">
                          {s.sessionId}
                        </th>
                        <td className="p-3 text-[#0A1B2C]">
                          <div className="font-medium">{s.schoolName}</div>
                          <div className="text-[11px] font-mono text-[#33475B]">{s.udiseCode}</div>
                        </td>
                        <td className="p-3 text-[#243647]">
                          <div className="text-[#0A1B2C]">{s.district}</div>
                          <div className="text-xs text-[#33475B]">{s.block}</div>
                        </td>
                        <td className="p-3 text-[#243647] max-w-[180px] truncate" title={s.tourName}>
                          {s.tourName}
                        </td>
                        <td className="p-3 text-[#0A1B2C] whitespace-nowrap">{classText}</td>
                        <td className="p-3 text-[#243647] whitespace-nowrap">
                          {formatISODateToDDMMYYYY(s.startDate)}
                        </td>
                        <td className="p-3 text-[#0A1B2C] font-medium">{s.totalStudentsPresent}</td>
                        <td className="p-3 text-[#006BB8] font-semibold">
                          {formatScore2(s.overallCsat)}
                        </td>
                        <td className="p-3 text-[#0A1B2C] font-medium">
                          {formatScore2(s.overallItp)}
                        </td>
                        <td className="p-3 text-[#0A1B2C] whitespace-nowrap">
                          {s.teacherNps > 0 ? '+100' : s.teacherNps} ({s.teacherClassification})
                        </td>
                        <td className="p-3">
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#ECFDF5] text-[#047857] border border-[#047857]/35">
                            {s.submissionStatus}
                          </span>
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setSelectedDetail(s)}
                              aria-label={`View ${s.sessionId}`}
                              className="p-2 rounded-lg bg-[#F5F2E9] hover:bg-[#EFE8D6] border border-[#8E8674] text-[#0A1B2C] cursor-pointer transition-colors"
                            >
                              <Eye className="w-4 h-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleEditAction(s)}
                              aria-label={`Edit ${s.sessionId}`}
                              className="p-2 rounded-lg bg-[#E8F6FF] hover:bg-[#1EA7FF]/20 border border-[#0284C7]/45 text-[#006BB8] cursor-pointer transition-colors"
                            >
                              <Edit3 className="w-4 h-4" aria-hidden="true" />
                            </button>
                            {config.policy.allowFacilitatorDeleteOwn && (
                              <button
                                type="button"
                                onClick={() => setArchiveTarget(s)}
                                aria-label={`Archive ${s.sessionId}`}
                                className="p-2 rounded-lg bg-[#FFF1F2] hover:bg-[#BE123C]/15 border border-[#BE123C]/35 text-[#BE123C] cursor-pointer transition-colors"
                              >
                                <Archive className="w-4 h-4" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-[#243647] ct-num">
              <span>
                Page {result.page} of {result.totalPages}
                {isSuperAdmin ? ` · ${result.total} records` : ''}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={result.page <= 1}
                  onClick={() =>
                    setFilters((prev) => ({ ...prev, page: Math.max(1, (prev.page ?? 1) - 1) }))
                  }
                  className="ct-btn-secondary text-xs min-h-[36px] px-3 py-1"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={result.page >= result.totalPages}
                  onClick={() =>
                    setFilters((prev) => ({
                      ...prev,
                      page: Math.min(result.totalPages, (prev.page ?? 1) + 1),
                    }))
                  }
                  className="ct-btn-secondary text-xs min-h-[36px] px-3 py-1"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      <SessionDetailModal
        session={selectedDetail}
        isSuperAdmin={isSuperAdmin}
        onClose={() => setSelectedDetail(null)}
        onEdit={handleEditAction}
      />

      {/* Modal #9: Export Report Preview (Administrator only) */}
      {isSuperAdmin && (
        <ExportReportModal
          open={Boolean(exportModalSessions)}
          onClose={() => setExportModalSessions(null)}
          sessions={exportModalSessions ?? []}
          config={config}
          defaultFilenamePrefix="Career_Tours_My_Sessions"
          scopeLabel={`MY_SESSIONS (${filters.district || 'All districts'})`}
          onExportComplete={(rowCount, colCount, usedOfficial63, mode) => {
            void api.logExportEvent('MY_SESSIONS', rowCount, mode);
            onNotify(
              'success',
              'Excel export downloaded',
              `${rowCount} class rows exported across ${colCount} columns${
                usedOfficial63
                  ? ' (official 63-column template)'
                  : ' (standard workbook; 63-col template pending import)'
              }.`,
            );
          }}
        />
      )}

      {/* Modal #6: Archive Confirmation */}
      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title="Archive this session?"
        description="This record will be moved to archive and excluded from standard reporting totals. Every archive action is preserved in the Audit Log."
        metadata={
          archiveTarget
            ? [
                { label: 'Session ID', value: archiveTarget.sessionId },
                { label: 'School', value: archiveTarget.schoolName },
                { label: 'UDISE', value: archiveTarget.udiseCode },
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
    </main>
  );
};

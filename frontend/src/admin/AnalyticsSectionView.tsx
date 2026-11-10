import React, { useMemo } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Database,
  Download,
  FilterX,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import {
  computeKpiPeriodComparisons,
  computeProgrammeInsights,
} from '../calculations/analytics';
import { formatPct1, formatScore2 } from '../calculations/metrics';
import {
  CareerTourColumnChart,
  DistrictHorizontalChart,
  FacilitatorRankedChart,
  FeedbackSatisfactionSection,
  GradeReachBarChart,
  KPI_ICON_MAP,
  LanguageDonutChart,
  MonthlyProgrammePerformanceChart,
  ProgrammeInsightsPanel,
  TrendBadge,
} from '../components/charts/AnalyticsPageCharts';
import type { DetailedAnalyticsTarget } from '../components/modals/DetailedAnalyticsModal';
import type {
  AppConfiguration,
  DashboardAnalytics,
  SessionQueryFilters,
  SubmissionStatus,
} from '../types/domain';
import { getBlocksForDistrict } from '../validations/sessionValidation';

interface AnalyticsSectionViewProps {
  analytics: DashboardAnalytics | null;
  loading: boolean;
  config: AppConfiguration;
  filters: SessionQueryFilters;
  sessionsTotal: number;
  preparingExport: boolean;
  onFiltersChange: React.Dispatch<React.SetStateAction<SessionQueryFilters>>;
  onDistrictFilterChange: (district: string) => void;
  onClearFilters: () => void;
  onRefresh: () => void;
  onExportFiltered: () => void;
  onOpenNewModal?: () => void;
  onOpenSyncStatus?: () => void;
  onDrillDown: (target: DetailedAnalyticsTarget) => void;
}

export const AnalyticsSectionView: React.FC<AnalyticsSectionViewProps> = ({
  analytics,
  loading,
  config,
  filters,
  sessionsTotal,
  preparingExport,
  onFiltersChange,
  onDistrictFilterChange,
  onClearFilters,
  onRefresh,
  onExportFiltered,
  onOpenNewModal,
  onOpenSyncStatus,
  onDrillDown,
}) => {
  const districtBlocks = getBlocksForDistrict(filters.district ?? '', config);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.district) count++;
    if (filters.block) count++;
    if (filters.search?.trim()) count++;
    if (filters.facilitatorEmail?.trim()) count++;
    if (filters.tourId) count++;
    if (filters.language) count++;
    if (filters.grade) count++;
    if (filters.dateFrom) count++;
    if (filters.dateTo) count++;
    if (filters.status) count++;
    if (filters.includeArchived) count++;
    return count;
  }, [filters]);

  const comparisons = useMemo(
    () => (analytics ? computeKpiPeriodComparisons(analytics) : null),
    [analytics],
  );

  const insights = useMemo(
    () => (analytics ? computeProgrammeInsights(analytics, config, filters) : null),
    [analytics, config, filters],
  );

  const totalTeachers = analytics
    ? analytics.npsDistribution.promoter +
      analytics.npsDistribution.passive +
      analytics.npsDistribution.detractor
    : 0;

  const teacherNpsDisplay =
    analytics && analytics.teacherNpsAverage !== null
      ? analytics.teacherNpsAverage > 0
        ? `+${analytics.teacherNpsAverage}`
        : String(analytics.teacherNpsAverage)
      : '—';

  return (
    <div className="flex flex-col gap-5">
      {/* 1. Top Header & Compact Elegant Filters Card */}
      <section className="ct-card p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <span
              className="w-10 h-10 rounded-xl bg-[#FFF2DF] border border-[#FDBA74] text-[#C2410C] inline-flex items-center justify-center shrink-0 mt-0.5"
              aria-hidden="true"
            >
              <BarChart3 className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-xl sm:text-[22px] font-medium tracking-tight text-[#0A1B2C] leading-snug">
                Analytics &amp; Performance
              </h2>
              <p className="text-xs sm:text-[13px] text-[#33475B] mt-0.5 max-w-2xl leading-relaxed">
                Understand programme reach, engagement and performance across districts, schools and
                facilitators.
              </p>
            </div>
          </div>

          {/* Primary & Utility Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            {onOpenNewModal && (
              <button
                type="button"
                onClick={onOpenNewModal}
                className="ct-btn-secondary text-xs min-h-[38px] px-3 py-1.5"
              >
                <Plus className="w-3.5 h-3.5 text-[#006BB8]" aria-hidden="true" />
                Add submission
              </button>
            )}
            {onOpenSyncStatus && (
              <button
                type="button"
                onClick={onOpenSyncStatus}
                className="ct-btn-secondary text-xs min-h-[38px] px-3 py-1.5"
              >
                <Database className="w-3.5 h-3.5 text-[#33475B]" aria-hidden="true" />
                Sync Status
              </button>
            )}
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="ct-btn-secondary text-xs min-h-[38px] px-3 py-1.5"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loading ? 'motion-safe:animate-spin' : ''}`}
                aria-hidden="true"
              />
              Refresh
            </button>
            <button
              type="button"
              disabled={preparingExport || sessionsTotal === 0}
              onClick={onExportFiltered}
              className="ct-btn-primary text-xs min-h-[38px] px-3.5 py-1.5"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              {preparingExport ? 'Preparing...' : 'Export Filtered (.xlsx)'}
            </button>
          </div>
        </div>

        {/* Compact Filter Ribbon */}
        <div
          role="search"
          aria-label="Filter programme records"
          className="pt-3.5 border-t border-[#E5DFD2] space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
            <div>
              <label htmlFor="adm-district" className="block text-[11px] font-medium text-[#33475B] mb-1">
                District
              </label>
              <select
                id="adm-district"
                value={filters.district ?? ''}
                onChange={(e) => onDistrictFilterChange(e.target.value)}
                className="ct-input ct-select !min-h-[38px] !py-1.5 !px-2.5 !pr-8 text-[13px]"
              >
                <option value="">All districts</option>
                {config.allowedDistricts.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="adm-block" className="block text-[11px] font-medium text-[#33475B] mb-1">
                Block
              </label>
              <select
                id="adm-block"
                disabled={!filters.district || districtBlocks.length === 0}
                value={filters.block ?? ''}
                onChange={(e) =>
                  onFiltersChange((prev) => ({ ...prev, block: e.target.value, page: 1 }))
                }
                className="ct-input ct-select !min-h-[38px] !py-1.5 !px-2.5 !pr-8 text-[13px]"
              >
                <option value="">{!filters.district ? 'Select district' : 'All blocks'}</option>
                {districtBlocks.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="adm-school" className="block text-[11px] font-medium text-[#33475B] mb-1">
                School Name / Search
              </label>
              <div className="relative">
                <Search
                  className="w-3.5 h-3.5 text-[#475569] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="adm-school"
                  type="search"
                  placeholder="School, UDISE, ID..."
                  value={filters.search ?? ''}
                  onChange={(e) =>
                    onFiltersChange((prev) => ({ ...prev, search: e.target.value, page: 1 }))
                  }
                  className="ct-input !min-h-[38px] !py-1.5 !pl-8 !pr-2.5 text-[13px]"
                />
              </div>
            </div>

            <div>
              <label htmlFor="adm-fac" className="block text-[11px] font-medium text-[#33475B] mb-1">
                Facilitator Email
              </label>
              <input
                id="adm-fac"
                type="text"
                placeholder="Filter by email"
                value={filters.facilitatorEmail ?? ''}
                onChange={(e) =>
                  onFiltersChange((prev) => ({
                    ...prev,
                    facilitatorEmail: e.target.value,
                    page: 1,
                  }))
                }
                className="ct-input !min-h-[38px] !py-1.5 !px-2.5 text-[13px]"
              />
            </div>

            <div>
              <label htmlFor="adm-tour" className="block text-[11px] font-medium text-[#33475B] mb-1">
                Career Tour
              </label>
              <select
                id="adm-tour"
                value={filters.tourId ?? ''}
                onChange={(e) =>
                  onFiltersChange((prev) => ({ ...prev, tourId: e.target.value, page: 1 }))
                }
                className="ct-input ct-select !min-h-[38px] !py-1.5 !px-2.5 !pr-8 text-[13px]"
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
              <label htmlFor="adm-lang" className="block text-[11px] font-medium text-[#33475B] mb-1">
                Language
              </label>
              <select
                id="adm-lang"
                value={filters.language ?? ''}
                onChange={(e) =>
                  onFiltersChange((prev) => ({ ...prev, language: e.target.value, page: 1 }))
                }
                className="ct-input ct-select !min-h-[38px] !py-1.5 !px-2.5 !pr-8 text-[13px]"
              >
                <option value="">All languages</option>
                {config.languageOptions.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="adm-grade" className="block text-[11px] font-medium text-[#33475B] mb-1">
                Grade
              </label>
              <select
                id="adm-grade"
                value={filters.grade ?? ''}
                onChange={(e) =>
                  onFiltersChange((prev) => ({ ...prev, grade: e.target.value, page: 1 }))
                }
                className="ct-input ct-select !min-h-[38px] !py-1.5 !px-2.5 !pr-8 text-[13px]"
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
              <label htmlFor="adm-from" className="block text-[11px] font-medium text-[#33475B] mb-1">
                From Date
              </label>
              <input
                id="adm-from"
                type="date"
                value={filters.dateFrom ?? ''}
                onChange={(e) =>
                  onFiltersChange((prev) => ({ ...prev, dateFrom: e.target.value, page: 1 }))
                }
                className="ct-input !min-h-[38px] !py-1.5 !px-2.5 text-[13px] ct-num"
              />
            </div>

            <div>
              <label htmlFor="adm-to" className="block text-[11px] font-medium text-[#33475B] mb-1">
                To Date
              </label>
              <input
                id="adm-to"
                type="date"
                value={filters.dateTo ?? ''}
                onChange={(e) =>
                  onFiltersChange((prev) => ({ ...prev, dateTo: e.target.value, page: 1 }))
                }
                className="ct-input !min-h-[38px] !py-1.5 !px-2.5 text-[13px] ct-num"
              />
            </div>

            <div>
              <label htmlFor="adm-status" className="block text-[11px] font-medium text-[#33475B] mb-1">
                Status
              </label>
              <select
                id="adm-status"
                value={filters.status ?? ''}
                onChange={(e) =>
                  onFiltersChange((prev) => ({
                    ...prev,
                    status: e.target.value as SubmissionStatus | '',
                    page: 1,
                  }))
                }
                className="ct-input ct-select !min-h-[38px] !py-1.5 !px-2.5 !pr-8 text-[13px]"
              >
                <option value="">All statuses</option>
                <option value="COMMITTED">COMMITTED</option>
                <option value="CORRECTED">CORRECTED</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">
            <label className="inline-flex items-center gap-2 text-[#243647] cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(filters.includeArchived)}
                onChange={(e) =>
                  onFiltersChange((prev) => ({
                    ...prev,
                    includeArchived: e.target.checked,
                    page: 1,
                  }))
                }
                className="w-4 h-4 accent-[#006BB8]"
              />
              Include archived sessions
            </label>

            <div className="flex flex-wrap items-center gap-2.5 ct-num">
              {analytics &&
                (analytics.reconciliation.verified ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#ECFDF5] border border-[#047857]/25 text-[11px] font-medium text-[#047857]">
                    <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                    Reconciled ({analytics.reconciliation.checksRun} checks)
                  </span>
                ) : (
                  <span
                    role="alert"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FFF1F2] border border-[#BE123C]/35 text-[11px] font-medium text-[#BE123C]"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                    Reconciliation discrepancy
                  </span>
                ))}

              <span className="inline-flex items-center gap-1 text-[11px] text-[#33475B]">
                <SlidersHorizontal className="w-3 h-3" aria-hidden="true" />
                {activeFilterCount === 0 ? 'All programme records' : `${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} active`}
              </span>

              <button
                type="button"
                onClick={onClearFilters}
                disabled={activeFilterCount === 0}
                className="ct-btn-secondary text-xs !min-h-[34px] !px-2.5 !py-1"
              >
                <FilterX className="w-3.5 h-3.5" aria-hidden="true" />
                Clear filters
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Reconciliation Anomaly Alert when unverified */}
      {analytics && !analytics.reconciliation.verified && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-[#FFF1F2] border border-[#BE123C]/40 text-xs text-[#0A1B2C] space-y-1.5"
        >
          <div className="font-medium flex items-center gap-2 text-[#BE123C]">
            <AlertTriangle className="w-4 h-4 text-[#BE123C]" aria-hidden="true" />
            Analytics Reconciliation Discrepancy Detected
          </div>
          <ul className="list-disc pl-5 space-y-0.5 text-[#BE123C]">
            {analytics.reconciliation.discrepancies.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Loading skeleton when initial summary hasn't loaded yet */}
      {!analytics || !comparisons || !insights ? (
        <section aria-busy="true" aria-label="Loading analytics" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((k) => (
            <div key={k} className="ct-card p-4 h-28 flex flex-col justify-between">
              <div className="h-3 w-24 rounded bg-[#EFE8D6]" />
              <div className="h-6 w-16 rounded bg-[#EAE4D5]" />
              <div className="h-2.5 w-28 rounded bg-[#F5F2E9]" />
            </div>
          ))}
        </section>
      ) : (
        <>
          {/* 2. KPI Overview (7 Cards in Balanced 4 + 3 Bento Grid) */}
          <section
            aria-label="Key programme performance indicators"
            className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-12 gap-3 ct-num"
          >
            {/* Row 1: Programme Scale (4 cards × 3 cols) */}
            {[
              {
                key: 'sessions',
                label: 'Total Sessions',
                value: analytics.totalSessions.toLocaleString(),
                Icon: KPI_ICON_MAP.sessions,
                iconBg: 'bg-[#FFF2DF] border-[#FDBA74] text-[#C2410C]',
                cardTint:
                  analytics.totalSessions === 0
                    ? 'bg-[#FFFBF5] border-[#F3DFC1]'
                    : 'bg-[#FFFFFF] border-[#DFD7C2]',
                comparison: comparisons.metrics.sessions,
                sublabel:
                  comparisons.periodCount > 0
                    ? `Across ${comparisons.periodCount} active month${comparisons.periodCount === 1 ? '' : 's'}`
                    : 'Committed programme sessions',
              },
              {
                key: 'students',
                label: 'Students Reached',
                value: analytics.totalStudentsReached.toLocaleString(),
                Icon: KPI_ICON_MAP.students,
                iconBg: 'bg-[#E8F6FF] border-[#BAE6FD] text-[#006BB8]',
                cardTint: 'bg-[#FFFFFF] border-[#DFD7C2]',
                comparison: comparisons.metrics.studentsReached,
                sublabel: 'Single-counted class attendance',
              },
              {
                key: 'schools',
                label: 'Schools Covered',
                value: analytics.totalSchoolsCovered.toLocaleString(),
                Icon: KPI_ICON_MAP.schools,
                iconBg: 'bg-[#ECFDF5] border-[#A7F3D0] text-[#047857]',
                cardTint: 'bg-[#FFFFFF] border-[#DFD7C2]',
                comparison: comparisons.metrics.schoolsCovered,
                sublabel: 'Unique UDISE school campuses',
              },
              {
                key: 'facilitators',
                label: 'Active Facilitators',
                value: analytics.totalFacilitatorsActive.toLocaleString(),
                Icon: KPI_ICON_MAP.facilitators,
                iconBg: 'bg-[#EEF2FF] border-[#C7D2FE] text-[#4338CA]',
                cardTint: 'bg-[#FFFFFF] border-[#DFD7C2]',
                comparison: comparisons.metrics.activeFacilitators,
                sublabel: 'Submitting educators',
              },
            ].map(({ key, label, value, Icon, iconBg, cardTint, comparison, sublabel }) => (
              <div
                key={key}
                className={`xl:col-span-3 rounded-xl border p-4 shadow-[0_6px_18px_rgba(10,27,44,0.04)] flex flex-col justify-between gap-2.5 ${cardTint}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[#33475B]">{label}</span>
                  <span
                    className={`w-7 h-7 rounded-lg border inline-flex items-center justify-center shrink-0 ${iconBg}`}
                    aria-hidden="true"
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                </div>

                <div className="text-[26px] leading-tight font-medium text-[#0A1B2C]">
                  {value}
                </div>

                <div className="flex flex-col gap-1">
                  <div>
                    <TrendBadge comparison={comparison} />
                  </div>
                  <span className="text-[11px] text-[#33475B] truncate" title={sublabel}>
                    {sublabel}
                  </span>
                </div>
              </div>
            ))}

            {/* Row 2: Quality & Feedback Impact (3 cards × 4 cols) */}
            {[
              {
                key: 'csat',
                label: 'Pooled CSAT',
                value: formatScore2(analytics.averageCsat),
                Icon: KPI_ICON_MAP.csat,
                iconBg: 'bg-[#FFF2DF] border-[#FDBA74] text-[#C2410C]',
                comparison: comparisons.metrics.averageCsat,
                sublabel: `${analytics.totalQuestionAResponses.toLocaleString()} response${analytics.totalQuestionAResponses === 1 ? '' : 's'}${analytics.qaSentiment.positivePct !== null ? ` · Pos ${formatPct1(analytics.qaSentiment.positivePct)}` : ''}`,
              },
              {
                key: 'itp',
                label: 'Pooled ITP',
                value: formatScore2(analytics.averageItp),
                Icon: KPI_ICON_MAP.itp,
                iconBg: 'bg-[#E8F6FF] border-[#BAE6FD] text-[#006BB8]',
                comparison: comparisons.metrics.averageItp,
                sublabel: `${analytics.totalQuestionBResponses.toLocaleString()} response${analytics.totalQuestionBResponses === 1 ? '' : 's'}${analytics.qbSentiment.positivePct !== null ? ` · Pos ${formatPct1(analytics.qbSentiment.positivePct)}` : ''}`,
              },
              {
                key: 'nps',
                label: 'Teacher NPS',
                value: teacherNpsDisplay,
                Icon: KPI_ICON_MAP.nps,
                iconBg: 'bg-[#ECFDF5] border-[#A7F3D0] text-[#047857]',
                comparison: comparisons.metrics.teacherNps,
                sublabel: `${totalTeachers.toLocaleString()} response${totalTeachers === 1 ? '' : 's'}${totalTeachers > 0 ? ` · ${analytics.npsDistribution.promoter} Promoter${analytics.npsDistribution.promoter === 1 ? '' : 's'}` : ''}`,
              },
            ].map(({ key, label, value, Icon, iconBg, comparison, sublabel }) => (
              <div
                key={key}
                className="xl:col-span-4 rounded-xl bg-[#FFFFFF] border border-[#DFD7C2] p-4 shadow-[0_6px_18px_rgba(10,27,44,0.04)] flex flex-col justify-between gap-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[#33475B]">{label}</span>
                  <span
                    className={`w-7 h-7 rounded-lg border inline-flex items-center justify-center shrink-0 ${iconBg}`}
                    aria-hidden="true"
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                </div>

                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[26px] leading-tight font-medium text-[#0A1B2C]">
                    {value}
                  </span>
                  <TrendBadge comparison={comparison} />
                </div>

                <span className="text-[11px] text-[#33475B]">{sublabel}</span>
              </div>
            ))}
          </section>

          {/* 3. Main Analytics Graphs (A–G) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
            {/* A. Monthly Programme Performance */}
            <div className="lg:col-span-7">
              <MonthlyProgrammePerformanceChart
                monthlyBreakdown={analytics.monthlyBreakdown}
                totalSessions={analytics.totalSessions}
                onDrillDown={onDrillDown}
              />
            </div>

            {/* B. District-wise Performance */}
            <div className="lg:col-span-5">
              <DistrictHorizontalChart
                districtBreakdown={analytics.districtBreakdown}
                totalSessions={analytics.totalSessions}
                onDrillDown={onDrillDown}
              />
            </div>

            {/* C. Career Tour Performance */}
            <div className="lg:col-span-7">
              <CareerTourColumnChart
                tourBreakdown={analytics.tourBreakdown}
                config={config}
                onDrillDown={onDrillDown}
              />
            </div>

            {/* D. Language Distribution */}
            <div className="lg:col-span-5">
              <LanguageDonutChart
                languageBreakdown={analytics.languageBreakdown}
                totalStudentsReached={analytics.totalStudentsReached}
                onDrillDown={onDrillDown}
              />
            </div>

            {/* E. Grade-wise Student Reach */}
            <div className="lg:col-span-5">
              <GradeReachBarChart
                gradeBreakdown={analytics.gradeBreakdown}
                onDrillDown={onDrillDown}
              />
            </div>

            {/* F. Facilitator Performance */}
            <div className="lg:col-span-7">
              <FacilitatorRankedChart
                facilitatorPanels={analytics.facilitatorPanels}
                onDrillDown={onDrillDown}
              />
            </div>

            {/* G. Feedback & Satisfaction */}
            <div className="lg:col-span-12">
              <FeedbackSatisfactionSection
                analytics={analytics}
                comparisons={comparisons.metrics}
              />
            </div>
          </div>

          {/* 4. Smart Insights Section */}
          <ProgrammeInsightsPanel report={insights} />
        </>
      )}
    </div>
  );
};

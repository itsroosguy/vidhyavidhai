import React, { useEffect, useState } from 'react';
import { CheckCircle2, Filter } from 'lucide-react';
import { formatPct1, formatScore2 } from '../../calculations/metrics';
import type { BackendApiClient } from '../../services/apiClient';
import type {
  DashboardAnalytics,
  SessionQueryFilters,
  SessionRecord,
} from '../../types/domain';
import { formatISODateToDDMMYYYY } from '../../utils/temporal';
import { GlassModal } from './GlassModal';

export interface DetailedAnalyticsTarget {
  category: 'School' | 'District' | 'Month' | 'Tour' | 'Language' | 'Grade' | 'Facilitator';
  title: string;
  subtitle?: string;
  filtersPatch: Partial<SessionQueryFilters>;
  monthKey?: string; // YYYY-MM when drilling into a month
}

interface DetailedAnalyticsModalProps {
  open: boolean;
  onClose: () => void;
  target: DetailedAnalyticsTarget | null;
  baseFilters: SessionQueryFilters;
  api: BackendApiClient;
  onApplyFilterToDashboard?: (patch: Partial<SessionQueryFilters>) => void;
}

export const DetailedAnalyticsModal: React.FC<DetailedAnalyticsModalProps> = ({
  open,
  onClose,
  target,
  baseFilters,
  api,
  onApplyFilterToDashboard,
}) => {
  const [loading, setLoading] = useState(false);
  const [sliceSummary, setSliceSummary] = useState<DashboardAnalytics | null>(null);
  const [sliceSessions, setSliceSessions] = useState<SessionRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !target) return;
    let cancelled = false;

    const loadSlice = async () => {
      setLoading(true);
      setError(null);
      try {
        const mergedFilters: SessionQueryFilters = {
          ...baseFilters,
          ...target.filtersPatch,
          page: 1,
          pageSize: 50,
        };

        // Derive dateFrom/dateTo bounds when drilling down into a YYYY-MM month row
        if (target.monthKey && /^\d{4}-\d{2}$/.test(target.monthKey)) {
          const [yStr, mStr] = target.monthKey.split('-');
          const y = Number.parseInt(yStr!, 10);
          const m = Number.parseInt(mStr!, 10);
          const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
          const mFrom = `${target.monthKey}-01`;
          const mTo = `${target.monthKey}-${String(lastDay).padStart(2, '0')}`;
          if (!mergedFilters.dateFrom || mFrom > mergedFilters.dateFrom) {
            mergedFilters.dateFrom = mFrom;
          }
          if (!mergedFilters.dateTo || mTo < mergedFilters.dateTo) {
            mergedFilters.dateTo = mTo;
          }
        }

        const [sumRes, sessRes] = await Promise.all([
          api.getDashboardSummary(mergedFilters),
          api.getAdminSessions(mergedFilters),
        ]);

        if (cancelled) return;
        if (sumRes.ok && sumRes.data) {
          setSliceSummary(sumRes.data);
        } else {
          setError(sumRes.error || 'Unable to compute drill-down metrics.');
        }
        if (sessRes.ok && sessRes.data) {
          setSliceSessions(sessRes.data.items);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadSlice();
    return () => {
      cancelled = true;
    };
  }, [api, baseFilters, open, target]);

  return (
    <GlassModal
      open={open && Boolean(target)}
      onClose={onClose}
      size="xl"
      eyebrow={target ? `${target.category} Drill-Down` : 'Detailed Analytics'}
      title={target?.title ?? 'Detailed Analytics'}
      subtitle={
        target?.subtitle ??
        'Reconciled student sentiment, score distributions, and response completeness for this slice.'
      }
      headerBadge={
        sliceSummary?.reconciliation?.verified ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#48B98A]/15 border border-[#48B98A]/40 text-[#48B98A] ct-num">
            <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
            Verified · {sliceSummary.reconciliation.checksRun} checks
          </span>
        ) : undefined
      }
      footer={
        <>
          {target && onApplyFilterToDashboard && Object.keys(target.filtersPatch).length > 0 && (
            <button
              type="button"
              onClick={() => {
                onApplyFilterToDashboard(target.filtersPatch);
                onClose();
              }}
              className="ct-btn-secondary text-sm"
            >
              <Filter className="w-4 h-4" aria-hidden="true" />
              Apply as dashboard filter
            </button>
          )}
          <button type="button" onClick={onClose} className="ct-btn-primary text-sm">
            Close
          </button>
        </>
      }
    >
      {loading && (
        <div className="py-12 text-center text-sm text-[#A4B7D2]">
          Recomputing and verifying slice analytics...
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-lg bg-[#E77B83]/12 border border-[#E77B83]/45 text-sm text-[#E77B83]">
          {error}
        </div>
      )}

      {!loading && sliceSummary && (
        <div className="space-y-5">
          {/* Slice KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
            <div className="p-3.5 rounded-lg bg-[#0C1931] border border-[#26456F]">
              <div className="text-[#A4B7D2]">Sessions</div>
              <div className="text-xl font-semibold text-[#E8EFFC] ct-num mt-1">
                {sliceSummary.totalSessions}
              </div>
            </div>
            <div className="p-3.5 rounded-lg bg-[#0C1931] border border-[#26456F]">
              <div className="text-[#A4B7D2]">Students Present</div>
              <div className="text-xl font-semibold text-[#E8EFFC] ct-num mt-1">
                {sliceSummary.totalStudentsReached}
              </div>
            </div>
            <div className="p-3.5 rounded-lg bg-[#0C1931] border border-[#26456F]">
              <div className="text-[#A4B7D2]">Pooled CSAT</div>
              <div className="text-xl font-semibold text-[#4EBBBB] ct-num mt-1">
                {formatScore2(sliceSummary.averageCsat)}
              </div>
              <div className="text-[11px] text-[#A4B7D2] ct-num mt-0.5">
                {sliceSummary.totalQuestionAResponses} resp · Miss {sliceSummary.totalMissingResponsesQA}
              </div>
            </div>
            <div className="p-3.5 rounded-lg bg-[#0C1931] border border-[#26456F]">
              <div className="text-[#A4B7D2]">Pooled ITP</div>
              <div className="text-xl font-semibold text-[#E8EFFC] ct-num mt-1">
                {formatScore2(sliceSummary.averageItp)}
              </div>
              <div className="text-[11px] text-[#A4B7D2] ct-num mt-0.5">
                {sliceSummary.totalQuestionBResponses} resp · Miss {sliceSummary.totalMissingResponsesQB}
              </div>
            </div>
            <div className="p-3.5 rounded-lg bg-[#0C1931] border border-[#26456F] col-span-2 sm:col-span-1">
              <div className="text-[#A4B7D2]">Teacher NPS</div>
              <div className="text-xl font-semibold text-[#E8EFFC] ct-num mt-1">
                {sliceSummary.teacherNpsAverage !== null
                  ? sliceSummary.teacherNpsAverage > 0
                    ? `+${sliceSummary.teacherNpsAverage}`
                    : String(sliceSummary.teacherNpsAverage)
                  : '—'}
              </div>
            </div>
          </div>

          {/* Sentiment & Distribution Comparison */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              {
                title: 'Question A (CSAT) Sentiment & Distribution',
                sentiment: sliceSummary.qaSentiment,
                dist: sliceSummary.csatDistribution,
                missing: sliceSummary.totalMissingResponsesQA,
                missRate: sliceSummary.missingResponseRateQaPct,
              },
              {
                title: 'Question B (ITP) Sentiment & Distribution',
                sentiment: sliceSummary.qbSentiment,
                dist: sliceSummary.itpDistribution,
                missing: sliceSummary.totalMissingResponsesQB,
                missRate: sliceSummary.missingResponseRateQbPct,
              },
            ].map((q) => (
              <div
                key={q.title}
                className="p-4 rounded-xl bg-[#0C1931] border border-[#26456F] space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs sm:text-sm font-medium text-[#E8EFFC]">{q.title}</h3>
                  <span className="text-[11px] text-[#A4B7D2] ct-num">
                    Missing: {q.missing} ({formatPct1(q.missRate)})
                  </span>
                </div>

                {/* Stacked Pos/Neu/Neg Bar */}
                <div className="space-y-1.5">
                  <div className="h-2.5 w-full rounded-full overflow-hidden bg-[#101E3C] border border-[#26456F]/60 flex">
                    {q.sentiment.total > 0 && (
                      <>
                        <div
                          className="h-full bg-[#4EBBBB]"
                          style={{ width: `${q.sentiment.positivePct ?? 0}%` }}
                          title={`Positive (4–5): ${formatPct1(q.sentiment.positivePct)}`}
                        />
                        <div
                          className="h-full bg-[#8294B1]"
                          style={{ width: `${q.sentiment.neutralPct ?? 0}%` }}
                          title={`Neutral (3): ${formatPct1(q.sentiment.neutralPct)}`}
                        />
                        <div
                          className="h-full bg-[#E77B83]"
                          style={{ width: `${q.sentiment.negativePct ?? 0}%` }}
                          title={`Negative (1–2): ${formatPct1(q.sentiment.negativePct)}`}
                        />
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap justify-between gap-2 text-[11px] text-[#A4B7D2] ct-num">
                    <span>
                      Positive (4–5):{' '}
                      <strong className="font-medium text-[#E8EFFC]">
                        {q.sentiment.positiveCount} ({formatPct1(q.sentiment.positivePct)})
                      </strong>
                    </span>
                    <span>
                      Neutral (3):{' '}
                      <strong className="font-medium text-[#E8EFFC]">
                        {q.sentiment.neutralCount} ({formatPct1(q.sentiment.neutralPct)})
                      </strong>
                    </span>
                    <span>
                      Negative (1–2):{' '}
                      <strong className="font-medium text-[#E8EFFC]">
                        {q.sentiment.negativeCount} ({formatPct1(q.sentiment.negativePct)})
                      </strong>
                    </span>
                  </div>
                </div>

                {/* 5..1 Count Bars */}
                <div className="space-y-1.5 pt-1">
                  {q.dist.map((row) => {
                    const pct = q.sentiment.total > 0 ? (row.count / q.sentiment.total) * 100 : 0;
                    return (
                      <div key={row.score} className="flex items-center gap-2 text-xs ct-num">
                        <span className="w-28 truncate text-[#A4B7D2]">
                          {row.score} · {row.label}
                        </span>
                        <div className="flex-1 h-1.5 rounded-full bg-[#162D55] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[#4EBBBB]"
                            style={{ width: `${Math.round(pct)}%` }}
                          />
                        </div>
                        <span className="w-16 text-right text-[#E8EFFC]">
                          {row.count} ({Math.round(pct)}%)
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Matching Sessions Preview */}
          <div>
            <h3 className="text-xs sm:text-sm font-medium text-[#E8EFFC] mb-2">
              Matching Sessions ({sliceSessions.length} shown)
            </h3>
            <div className="ct-table-wrapper rounded-xl border border-[#26456F]">
              <table className="w-full text-left text-xs border-collapse min-w-[600px]">
                <thead className="bg-[#0C1931] text-[#A4B7D2] uppercase text-[11px]">
                  <tr>
                    <th scope="col" className="p-2.5 font-medium">Session ID</th>
                    <th scope="col" className="p-2.5 font-medium">School</th>
                    <th scope="col" className="p-2.5 font-medium">Tour / Language</th>
                    <th scope="col" className="p-2.5 font-medium">Date</th>
                    <th scope="col" className="p-2.5 font-medium">Students</th>
                    <th scope="col" className="p-2.5 font-medium">CSAT</th>
                    <th scope="col" className="p-2.5 font-medium">ITP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#26456F]">
                  {sliceSessions.map((s) => (
                    <tr key={s.sessionRecordId} className="bg-[#101E3C] hover:bg-[#162D55] transition-colors ct-num">
                      <td className="p-2.5 font-mono text-[#4EBBBB] whitespace-nowrap">
                        {s.sessionId}
                      </td>
                      <td className="p-2.5 text-[#E8EFFC]">{s.schoolName}</td>
                      <td className="p-2.5 text-[#A4B7D2]">
                        {s.tourName} · {s.language}
                      </td>
                      <td className="p-2.5 text-[#A4B7D2] whitespace-nowrap">
                        {formatISODateToDDMMYYYY(s.startDate)}
                      </td>
                      <td className="p-2.5 text-[#E8EFFC]">{s.totalStudentsPresent}</td>
                      <td className="p-2.5 text-[#E8EFFC]">{formatScore2(s.overallCsat)}</td>
                      <td className="p-2.5 text-[#E8EFFC]">{formatScore2(s.overallItp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </GlassModal>
  );
};

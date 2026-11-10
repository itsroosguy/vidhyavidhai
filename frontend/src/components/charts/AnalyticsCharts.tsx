import React, { useId, useState } from 'react';
import { formatPct1, formatScore2 } from '../../calculations/metrics';
import type { DashboardAnalytics } from '../../types/domain';
import type { DetailedAnalyticsTarget } from '../modals/DetailedAnalyticsModal';

interface MonthlyTrendsChartProps {
  monthlyBreakdown: DashboardAnalytics['monthlyBreakdown'];
  onDrillDown?: (target: DetailedAnalyticsTarget) => void;
}

export const MonthlyTrendsChart: React.FC<MonthlyTrendsChartProps> = ({
  monthlyBreakdown,
  onDrillDown,
}) => {
  const captionId = useId();
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (monthlyBreakdown.length === 0) {
    return (
      <div className="p-4 rounded-xl bg-[#0C1931] border border-[#26456F] text-xs text-[#A4B7D2]">
        Monthly trends will appear once committed sessions exist.
      </div>
    );
  }

  const maxStudents = Math.max(1, ...monthlyBreakdown.map((m) => m.studentsReached));
  const chartW = 520;
  const chartH = 190;
  const padL = 36;
  const padR = 16;
  const padT = 18;
  const padB = 34;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;
  const slotW = innerW / monthlyBreakdown.length;
  const barW = Math.min(36, Math.max(14, slotW * 0.48));

  const csatPoints = monthlyBreakdown
    .map((m, idx) => {
      if (m.averageCsat === null) return null;
      const x = padL + idx * slotW + slotW / 2;
      const y = padT + innerH - (Math.max(1, Math.min(5, m.averageCsat)) / 5) * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter(Boolean)
    .join(' ');

  const hovered = hoveredIdx !== null ? monthlyBreakdown[hoveredIdx] : null;

  return (
    <figure className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm sm:text-base font-medium text-[#E8EFFC]">
            Monthly Reach & CSAT Trajectory
          </h3>
          <figcaption id={captionId} className="text-xs text-[#A4B7D2]">
            Bars track single-counted students present per month; the teal line marks pooled CSAT (1–5).
          </figcaption>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-[#A4B7D2]">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#26456F]" aria-hidden="true" />
            Students present
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-[#4EBBBB]" aria-hidden="true" />
            Pooled CSAT
          </span>
        </div>
      </div>

      <div className="rounded-xl bg-[#0C1931] border border-[#26456F] p-3">
        <svg
          role="img"
          aria-labelledby={captionId}
          viewBox={`0 0 ${chartW} ${chartH}`}
          className="w-full h-auto overflow-visible"
        >
          {/* Horizontal gridlines */}
          {[0.25, 0.5, 0.75, 1].map((frac) => {
            const y = padT + innerH * (1 - frac);
            const labelVal = Math.round(maxStudents * frac);
            return (
              <g key={frac}>
                <line
                  x1={padL}
                  y1={y}
                  x2={chartW - padR}
                  y2={y}
                  stroke="#26456F"
                  strokeOpacity="0.6"
                  strokeDasharray="3 3"
                />
                <text
                  x={padL - 6}
                  y={y + 3}
                  textAnchor="end"
                  fill="#8294B1"
                  fontSize="9.5"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {labelVal}
                </text>
              </g>
            );
          })}

          {/* Student Bars */}
          {monthlyBreakdown.map((m, idx) => {
            const cx = padL + idx * slotW + slotW / 2;
            const barH = (m.studentsReached / maxStudents) * innerH;
            const x = cx - barW / 2;
            const y = padT + innerH - barH;
            const isHovered = hoveredIdx === idx;
            return (
              <g
                key={m.monthKey}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
              >
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={Math.max(2, barH)}
                  rx={4}
                  fill={isHovered ? 'rgba(78, 187, 187, 0.55)' : 'rgba(38, 69, 111, 0.8)'}
                />
                <text
                  x={cx}
                  y={chartH - 10}
                  textAnchor="middle"
                  fill="#A4B7D2"
                  fontSize="10"
                >
                  {m.monthLabel.slice(0, 3)} {m.monthKey.slice(2, 4)}
                </text>
              </g>
            );
          })}

          {/* Pooled CSAT Line */}
          {monthlyBreakdown.length > 1 && csatPoints && (
            <polyline
              fill="none"
              stroke="#4EBBBB"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={csatPoints}
            />
          )}

          {/* Data nodes */}
          {monthlyBreakdown.map((m, idx) => {
            if (m.averageCsat === null) return null;
            const cx = padL + idx * slotW + slotW / 2;
            const cy = padT + innerH - (Math.max(1, Math.min(5, m.averageCsat)) / 5) * innerH;
            return (
              <circle
                key={`${m.monthKey}-dot`}
                cx={cx}
                cy={cy}
                r={hoveredIdx === idx ? 4.5 : 3.5}
                fill="#4EBBBB"
                stroke="#0C1931"
                strokeWidth="1.5"
              />
            );
          })}
        </svg>

        {/* Active Inspection Strip & Clickable Month Drill-down Pills */}
        <div className="mt-2 pt-2.5 border-t border-[#26456F] flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="text-[#A4B7D2] ct-num">
            {hovered ? (
              <span>
                <strong className="font-medium text-[#E8EFFC]">{hovered.monthLabel}:</strong>{' '}
                {hovered.sessions} sessions · {hovered.studentsReached} students · CSAT{' '}
                <strong className="font-medium text-[#4EBBBB]">
                  {formatScore2(hovered.averageCsat)}
                </strong>{' '}
                · ITP {formatScore2(hovered.averageItp)}
              </span>
            ) : (
              <span>Select a month pill to inspect its reconciled score breakdown.</span>
            )}
          </div>

          {onDrillDown && (
            <div className="flex flex-wrap gap-1.5">
              {monthlyBreakdown.map((m) => (
                <button
                  key={m.monthKey}
                  type="button"
                  onClick={() =>
                    onDrillDown({
                      category: 'Month',
                      title: `${m.monthLabel} Analytics`,
                      subtitle: `Monthly drill-down across ${m.sessions} committed sessions and ${m.studentsReached} students present.`,
                      filtersPatch: {},
                      monthKey: m.monthKey,
                    })
                  }
                  className="px-2 py-0.5 rounded-md bg-[#162D55] hover:bg-[#172B4D] border border-[#26456F] text-[11px] text-[#E8EFFC] ct-num cursor-pointer transition-colors"
                >
                  {m.monthLabel.slice(0, 3)} · {formatScore2(m.averageCsat)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </figure>
  );
};

interface SentimentStackedChartProps {
  qaSentiment: DashboardAnalytics['qaSentiment'];
  qbSentiment: DashboardAnalytics['qbSentiment'];
  npsDistribution: DashboardAnalytics['npsDistribution'];
}

export const SentimentStackedChart: React.FC<SentimentStackedChartProps> = ({
  qaSentiment,
  qbSentiment,
  npsDistribution,
}) => {
  const npsTotal =
    npsDistribution.promoter + npsDistribution.passive + npsDistribution.detractor;
  const pct = (part: number, whole: number) =>
    whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

  return (
    <div className="space-y-4">
      {[
        { title: 'Question A (CSAT Sentiment)', s: qaSentiment },
        { title: 'Question B (ITP Sentiment)', s: qbSentiment },
      ].map((row) => (
        <div key={row.title} className="space-y-1.5">
          <div className="flex items-center justify-between text-xs ct-num">
            <span className="font-medium text-[#E8EFFC]">{row.title}</span>
            <span className="text-[#A4B7D2]">
              {row.s.total} votes · Pos {formatPct1(row.s.positivePct)}
            </span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-[#0C1931] border border-[#26456F]/60 overflow-hidden flex">
            {row.s.total > 0 && (
              <>
                <div
                  className="h-full bg-[#4EBBBB]"
                  style={{ width: `${row.s.positivePct ?? 0}%` }}
                  title={`Positive (4–5): ${row.s.positiveCount}`}
                />
                <div
                  className="h-full bg-[#8294B1]"
                  style={{ width: `${row.s.neutralPct ?? 0}%` }}
                  title={`Neutral (3): ${row.s.neutralCount}`}
                />
                <div
                  className="h-full bg-[#E77B83]"
                  style={{ width: `${row.s.negativePct ?? 0}%` }}
                  title={`Negative (1–2): ${row.s.negativeCount}`}
                />
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-3 text-[11px] text-[#A4B7D2] ct-num">
            <span>
              4–5 Pos: <strong className="font-medium text-[#E8EFFC]">{row.s.positiveCount}</strong>
            </span>
            <span>
              3 Neu: <strong className="font-medium text-[#E8EFFC]">{row.s.neutralCount}</strong>
            </span>
            <span>
              1–2 Neg: <strong className="font-medium text-[#E8EFFC]">{row.s.negativeCount}</strong>
            </span>
          </div>
        </div>
      ))}

      <div className="pt-3 border-t border-[#26456F] space-y-2">
        <div className="flex items-center justify-between text-xs ct-num">
          <span className="font-medium text-[#E8EFFC]">Teacher NPS Mix</span>
          <span className="text-[#A4B7D2]">{npsTotal} sessions</span>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs ct-num">
          <div className="p-2.5 rounded-lg bg-[#0C1931] border border-[#26456F]">
            <div className="text-[#A4B7D2] text-[11px]">Promoter (9–10)</div>
            <div className="text-base font-semibold text-[#48B98A] mt-0.5">
              {npsDistribution.promoter}
            </div>
            <div className="text-[11px] text-[#8294B1]">
              {pct(npsDistribution.promoter, npsTotal)}%
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-[#0C1931] border border-[#26456F]">
            <div className="text-[#A4B7D2] text-[11px]">Passive (7–8)</div>
            <div className="text-base font-semibold text-[#F2B44D] mt-0.5">
              {npsDistribution.passive}
            </div>
            <div className="text-[11px] text-[#8294B1]">
              {pct(npsDistribution.passive, npsTotal)}%
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-[#0C1931] border border-[#26456F]">
            <div className="text-[#A4B7D2] text-[11px]">Detractor (0–6)</div>
            <div className="text-base font-semibold text-[#E77B83] mt-0.5">
              {npsDistribution.detractor}
            </div>
            <div className="text-[11px] text-[#8294B1]">
              {pct(npsDistribution.detractor, npsTotal)}%
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface DistrictComparisonBarsProps {
  districtBreakdown: DashboardAnalytics['districtBreakdown'];
  onDrillDown?: (target: DetailedAnalyticsTarget) => void;
}

export const DistrictComparisonBars: React.FC<DistrictComparisonBarsProps> = ({
  districtBreakdown,
  onDrillDown,
}) => {
  const maxStudents = Math.max(1, ...districtBreakdown.map((x) => x.studentsReached));

  return (
    <div className="space-y-3">
      {districtBreakdown.map((d) => {
        const widthPct = Math.round((d.studentsReached / maxStudents) * 100);
        return (
          <div
            key={d.district}
            className="p-3 rounded-xl bg-[#0C1931] border border-[#26456F] text-xs space-y-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 ct-num">
              <span className="font-medium text-[#E8EFFC] text-sm">{d.district}</span>
              <div className="flex items-center gap-3 text-[#A4B7D2]">
                <span>
                  {d.sessions} sessions · {d.schoolsCount} schools · {d.studentsReached} students
                </span>
                <span className="text-[#4EBBBB] font-medium">
                  CSAT {formatScore2(d.averageCsat)}
                </span>
                <span>ITP {formatScore2(d.averageItp)}</span>
                {onDrillDown && (
                  <button
                    type="button"
                    onClick={() =>
                      onDrillDown({
                        category: 'District',
                        title: `${d.district} District Analytics`,
                        subtitle: `${d.sessions} sessions · ${d.schoolsCount} schools · ${d.studentsReached} students reached`,
                        filtersPatch: { district: d.district },
                      })
                    }
                    className="px-2 py-0.5 rounded bg-[#162D55] hover:bg-[#172B4D] border border-[#26456F] text-[11px] text-[#E8EFFC] cursor-pointer transition-colors"
                  >
                    Inspect
                  </button>
                )}
              </div>
            </div>
            <div className="w-full h-2 rounded-full bg-[#162D55] overflow-hidden">
              <div
                className="h-full bg-[#4EBBBB] rounded-full transition-all"
                style={{ width: `${widthPct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

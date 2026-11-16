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
      <div className="p-4 rounded-xl bg-[#F5F2E9] border border-[#DFD7C2] text-xs text-[#243647]">
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
          <h3 className="text-sm sm:text-base font-medium text-[#0A1B2C]">
            Monthly Reach & CSAT Trajectory
          </h3>
          <figcaption id={captionId} className="text-xs text-[#243647]">
            Bars track single-counted students present per month; the Azure line marks pooled CSAT (1–5).
          </figcaption>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-[#243647]">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#5F7082]" aria-hidden="true" />
            Students present
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-[#006BB8]" aria-hidden="true" />
            Pooled CSAT
          </span>
        </div>
      </div>

      <div className="rounded-xl bg-[#F5F2E9] border border-[#DFD7C2] p-3">
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
                  stroke="#C7BEA7"
                  strokeOpacity="0.85"
                  strokeDasharray="3 3"
                />
                <text
                  x={padL - 6}
                  y={y + 3}
                  textAnchor="end"
                  fill="#33475B"
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
                  fill={isHovered ? '#1EA7FF' : 'rgba(10, 27, 44, 0.16)'}
                />
                <text
                  x={cx}
                  y={chartH - 10}
                  textAnchor="middle"
                  fill="#243647"
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
              stroke="#006BB8"
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
                fill="#1EA7FF"
                stroke="#0A1B2C"
                strokeWidth="1.5"
              />
            );
          })}
        </svg>

        {/* Active Inspection Strip & Clickable Month Drill-down Pills */}
        <div className="mt-2 pt-2.5 border-t border-[#DFD7C2] flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="text-[#243647] ct-num">
            {hovered ? (
              <span>
                <strong className="font-medium text-[#0A1B2C]">{hovered.monthLabel}:</strong>{' '}
                {hovered.sessions} sessions · {hovered.studentsReached} students · CSAT{' '}
                <strong className="font-medium text-[#006BB8]">
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
                  className="px-2 py-0.5 rounded-md bg-[#FFFFFF] hover:bg-[#E8F6FF] border border-[#8E8674] hover:border-[#0284C7] text-[11px] text-[#0A1B2C] ct-num cursor-pointer transition-colors"
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
            <span className="font-medium text-[#0A1B2C]">{row.title}</span>
            <span className="text-[#243647]">
              {row.s.total} votes · Pos {formatPct1(row.s.positivePct)}
            </span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-[#DFD7C2] border border-[#C7BEA7] overflow-hidden flex">
            {row.s.total > 0 && (
              <>
                <div
                  className="h-full bg-[#006BB8]"
                  style={{ width: `${row.s.positivePct ?? 0}%` }}
                  title={`Positive (4–5): ${row.s.positiveCount}`}
                />
                <div
                  className="h-full bg-[#5F7082]"
                  style={{ width: `${row.s.neutralPct ?? 0}%` }}
                  title={`Neutral (3): ${row.s.neutralCount}`}
                />
                <div
                  className="h-full bg-[#BE123C]"
                  style={{ width: `${row.s.negativePct ?? 0}%` }}
                  title={`Negative (1–2): ${row.s.negativeCount}`}
                />
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-3 text-[11px] text-[#243647] ct-num">
            <span>
              4–5 Pos: <strong className="font-medium text-[#0A1B2C]">{row.s.positiveCount}</strong>
            </span>
            <span>
              3 Neu: <strong className="font-medium text-[#0A1B2C]">{row.s.neutralCount}</strong>
            </span>
            <span>
              1–2 Neg: <strong className="font-medium text-[#0A1B2C]">{row.s.negativeCount}</strong>
            </span>
          </div>
        </div>
      ))}

      <div className="pt-3 border-t border-[#DFD7C2] space-y-2">
        <div className="flex items-center justify-between text-xs ct-num">
          <span className="font-medium text-[#0A1B2C]">Teacher NPS Mix</span>
          <span className="text-[#243647]">{npsTotal} sessions</span>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs ct-num">
          <div className="p-2.5 rounded-lg bg-[#ECFDF5] border border-[#047857]/30">
            <div className="text-[#243647] text-[11px]">Promoter (9–10)</div>
            <div className="text-base font-semibold text-[#047857] mt-0.5">
              {npsDistribution.promoter}
            </div>
            <div className="text-[11px] text-[#33475B]">
              {pct(npsDistribution.promoter, npsTotal)}%
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-[#FFFBEB] border border-[#B45309]/30">
            <div className="text-[#243647] text-[11px]">Passive (7–8)</div>
            <div className="text-base font-semibold text-[#92400E] mt-0.5">
              {npsDistribution.passive}
            </div>
            <div className="text-[11px] text-[#33475B]">
              {pct(npsDistribution.passive, npsTotal)}%
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-[#FFF1F2] border border-[#BE123C]/30">
            <div className="text-[#243647] text-[11px]">Detractor (0–6)</div>
            <div className="text-base font-semibold text-[#BE123C] mt-0.5">
              {npsDistribution.detractor}
            </div>
            <div className="text-[11px] text-[#33475B]">
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
            className="p-3 rounded-xl bg-[#F5F2E9] border border-[#DFD7C2] text-xs space-y-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 ct-num">
              <span className="font-medium text-[#0A1B2C] text-sm">{d.district}</span>
              <div className="flex items-center gap-3 text-[#243647]">
                <span>
                  {d.sessions} sessions · {d.schoolsCount} schools · {d.studentsReached} students
                </span>
                <span className="text-[#006BB8] font-medium">
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
                    className="px-2 py-0.5 rounded bg-[#FFFFFF] hover:bg-[#E8F6FF] border border-[#8E8674] hover:border-[#0284C7] text-[11px] text-[#0A1B2C] cursor-pointer transition-colors"
                  >
                    Inspect
                  </button>
                )}
              </div>
            </div>
            <div className="w-full h-2 rounded-full bg-[#DFD7C2] overflow-hidden">
              <div
                className="h-full bg-[#006BB8] rounded-full transition-all"
                style={{ width: `${widthPct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

import React, { useId, useMemo, useRef, useState } from 'react';
import {
  Award,
  BarChart2,
  BookOpen,
  Compass,
  Globe2,
  GraduationCap,
  HeartHandshake,
  Lightbulb,
  MapPin,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  Minus,
  Users,
} from 'lucide-react';
import type {
  KpiPeriodMetricComparison,
  ProgrammeInsightsReport,
} from '../../calculations/analytics';
import { formatPct1, formatScore2, round1 } from '../../calculations/metrics';
import type { AppConfiguration, DashboardAnalytics } from '../../types/domain';
import type { DetailedAnalyticsTarget } from '../modals/DetailedAnalyticsModal';

const DONUT_COLORS = [
  '#C2410C', // Warm terracotta-amber
  '#006BB8', // Cobalt azure
  '#0D9488', // Emerald teal
  '#4338CA', // Deep indigo
  '#B45309', // Rich ochre
  '#BE123C', // Crimson rose
  '#33475B', // Deep slate
  '#047857', // Forest green
] as const;

/**
 * Generates a smooth monotone-safe cubic Bezier SVG path across sorted (x, y) points.
 * Clamps control point Y values within [minY, maxY] so curves never overshoot axis baselines.
 */
function buildSmoothSplinePath(
  points: Array<{ x: number; y: number }>,
  minY: number,
  maxY: number,
): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0]!.x.toFixed(1)} ${points[0]!.y.toFixed(1)}`;
  const clampY = (y: number) => Math.max(minY, Math.min(maxY, y));
  let path = `M ${points[0]!.x.toFixed(1)} ${points[0]!.y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = clampY(p1.y + (p2.y - p0.y) / 6);
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = clampY(p2.y - (p3.y - p1.y) / 6);
    path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return path;
}

const MONTH_PLACEHOLDER_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function plural(count: number, singular: string, pluralWord = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}

function computeNiceAxisMax(maxVal: number, steps = 4): number {
  if (maxVal <= 0) return steps;
  const rawStep = maxVal / steps;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const fraction = rawStep / magnitude;
  let niceFraction = 1;
  if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (magnitude >= 10 && fraction <= 2.5) niceFraction = 2.5;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;
  return niceFraction * magnitude * steps;
}

export const TrendBadge: React.FC<{ comparison: KpiPeriodMetricComparison }> = React.memo(
  ({ comparison }) => {
    if (comparison.direction === 'up') {
      return (
        <span
          title={comparison.comparisonLabel}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#ECFDF5] border border-[#047857]/25 text-[#047857] ct-num"
        >
          <TrendingUp className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{comparison.deltaBadge}</span>
        </span>
      );
    }
    if (comparison.direction === 'down') {
      return (
        <span
          title={comparison.comparisonLabel}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#FFF1F2] border border-[#BE123C]/25 text-[#BE123C] ct-num"
        >
          <TrendingDown className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{comparison.deltaBadge}</span>
        </span>
      );
    }
    if (comparison.direction === 'flat') {
      return (
        <span
          title={comparison.comparisonLabel}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#F5F2E9] border border-[#DFD7C2] text-[#33475B] ct-num"
        >
          <Minus className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{comparison.deltaBadge}</span>
        </span>
      );
    }
    return (
      <span
        title={comparison.comparisonLabel}
        className="inline-flex items-center gap-1 text-[11px] text-[#33475B] ct-num"
      >
        <span className="text-[#8E8674]" aria-hidden="true">
          —
        </span>
        <span className="truncate">{comparison.deltaBadge}</span>
      </span>
    );
  },
);
TrendBadge.displayName = 'TrendBadge';

/* -------------------------------------------------------------------------- */
/* A. Monthly Programme Performance (Interactive Dual-Metric Spline Chart)    */
/* -------------------------------------------------------------------------- */

interface MonthlyProgrammePerformanceChartProps {
  monthlyBreakdown: DashboardAnalytics['monthlyBreakdown'];
  totalSessions: number;
  onDrillDown?: (target: DetailedAnalyticsTarget) => void;
}

export const MonthlyProgrammePerformanceChart: React.FC<MonthlyProgrammePerformanceChartProps> =
  React.memo(({ monthlyBreakdown, totalSessions, onDrillDown }) => {
    const titleId = useId();
    const descId = useId();
    const areaGradId = useId();
    const [activeIdx, setActiveIdx] = useState<number | null>(null);
    const [showSessions, setShowSessions] = useState(true);
    const [showStudents, setShowStudents] = useState(true);

    const chartW = 560;
    const chartH = 224;
    const padL = 42;
    const padR = 40;
    const padT = 18;
    const padB = 34;
    const innerW = chartW - padL - padR;
    const innerH = chartH - padT - padB;

    const maxStudentsAxis = useMemo(
      () => computeNiceAxisMax(Math.max(4, ...monthlyBreakdown.map((m) => m.studentsReached))),
      [monthlyBreakdown],
    );
    const maxSessionsAxis = useMemo(
      () => computeNiceAxisMax(Math.max(4, ...monthlyBreakdown.map((m) => m.sessions))),
      [monthlyBreakdown],
    );

    const plotData = useMemo(() => {
      if (monthlyBreakdown.length === 0) return [];
      return monthlyBreakdown.map((m, idx) => {
        const x =
          monthlyBreakdown.length === 1
            ? padL + innerW / 2
            : padL + (idx / (monthlyBreakdown.length - 1)) * innerW;
        const yStudents = padT + innerH - (m.studentsReached / maxStudentsAxis) * innerH;
        const ySessions = padT + innerH - (m.sessions / maxSessionsAxis) * innerH;
        return {
          ...m,
          idx,
          x,
          yStudents,
          ySessions,
          shortLabel: `${m.monthLabel.slice(0, 3)} '${m.monthKey.slice(2, 4)}`,
        };
      });
    }, [innerH, innerW, maxSessionsAxis, maxStudentsAxis, monthlyBreakdown]);

    const studentsPath = useMemo(() => {
      if (plotData.length < 2) return '';
      return buildSmoothSplinePath(
        plotData.map((p) => ({ x: p.x, y: p.yStudents })),
        padT,
        padT + innerH,
      );
    }, [innerH, plotData]);

    const studentsAreaPath = useMemo(() => {
      if (!studentsPath || plotData.length < 2) return '';
      const first = plotData[0]!;
      const last = plotData[plotData.length - 1]!;
      const baseY = padT + innerH;
      return `${studentsPath} L ${last.x.toFixed(1)} ${baseY.toFixed(1)} L ${first.x.toFixed(1)} ${baseY.toFixed(1)} Z`;
    }, [innerH, plotData, studentsPath]);

    const sessionsPath = useMemo(() => {
      if (plotData.length < 2) return '';
      return buildSmoothSplinePath(
        plotData.map((p) => ({ x: p.x, y: p.ySessions })),
        padT,
        padT + innerH,
      );
    }, [innerH, plotData]);

    const activePoint = activeIdx !== null ? plotData[activeIdx] ?? null : null;

    return (
      <section
        aria-labelledby={titleId}
        className="ct-card p-5 flex flex-col gap-4 h-full"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <span
              className="w-8 h-8 rounded-lg bg-[#FFF7ED] border border-[#FED7AA] text-[#C2410C] inline-flex items-center justify-center shrink-0"
              aria-hidden="true"
            >
              <TrendingUp className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h3 id={titleId} className="text-[15px] font-medium text-[#0A1B2C] leading-snug">
                Monthly Programme Performance
              </h3>
              <p id={descId} className="text-xs text-[#33475B] mt-0.5">
                Sessions conducted and students reached over time
              </p>
            </div>
          </div>

          <div
            role="group"
            aria-label="Toggle monthly chart series"
            className="flex flex-wrap items-center gap-1.5 text-xs"
          >
            <button
              type="button"
              aria-pressed={showSessions}
              onClick={() => setShowSessions((v) => (!v || showStudents ? !v : v))}
              className={`inline-flex items-center gap-1.5 min-h-[26px] px-2.5 py-1 rounded-full border text-[11px] font-medium cursor-pointer transition-colors ${
                showSessions
                  ? 'bg-[#FFF7ED] border-[#FDBA74] text-[#9A3412]'
                  : 'bg-[#FFFFFF] border-[#DFD7C2] text-[#33475B]'
              }`}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: showSessions ? '#C2410C' : '#C7BEA7' }}
                aria-hidden="true"
              />
              Sessions
            </button>
            <button
              type="button"
              aria-pressed={showStudents}
              onClick={() => setShowStudents((v) => (!v || showSessions ? !v : v))}
              className={`inline-flex items-center gap-1.5 min-h-[26px] px-2.5 py-1 rounded-full border text-[11px] font-medium cursor-pointer transition-colors ${
                showStudents
                  ? 'bg-[#E8F6FF] border-[#7DD3FC] text-[#006BB8]'
                  : 'bg-[#FFFFFF] border-[#DFD7C2] text-[#33475B]'
              }`}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: showStudents ? '#006BB8' : '#C7BEA7' }}
                aria-hidden="true"
              />
              Students Reached
            </button>
          </div>
        </div>

        {totalSessions === 0 || plotData.length === 0 ? (
          <div className="relative flex-1 flex flex-col justify-center rounded-xl bg-[#FAF8F2] border border-[#E5DFD2] p-3">
            <svg
              role="img"
              aria-labelledby={titleId}
              aria-describedby={descId}
              viewBox={`0 0 ${chartW} ${chartH}`}
              className="w-full h-auto block"
            >
              {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                const y = padT + innerH * (1 - frac);
                const val = Math.round(200 * frac);
                return (
                  <g key={frac}>
                    <line
                      x1={padL}
                      y1={y}
                      x2={chartW - padR}
                      y2={y}
                      stroke="#DFD7C2"
                      strokeDasharray={frac === 0 ? undefined : '3 3'}
                    />
                    <text
                      x={padL - 8}
                      y={y + 3.5}
                      textAnchor="end"
                      fill="#475569"
                      fontSize="10"
                      className="ct-num"
                    >
                      {val}
                    </text>
                  </g>
                );
              })}

              {/* Subtle illustrative ghost wave */}
              <path
                d={`M ${padL} ${padT + innerH * 0.85} C ${padL + innerW * 0.22} ${padT + innerH * 0.76}, ${padL + innerW * 0.35} ${padT + innerH * 0.36}, ${padL + innerW * 0.5} ${padT + innerH * 0.42} C ${padL + innerW * 0.68} ${padT + innerH * 0.48}, ${padL + innerW * 0.8} ${padT + innerH * 0.75}, ${padL + innerW} ${padT + innerH * 0.65} L ${padL + innerW} ${padT + innerH} L ${padL} ${padT + innerH} Z`}
                fill="rgba(251, 146, 60, 0.12)"
              />
              <path
                d={`M ${padL} ${padT + innerH * 0.85} C ${padL + innerW * 0.22} ${padT + innerH * 0.76}, ${padL + innerW * 0.35} ${padT + innerH * 0.36}, ${padL + innerW * 0.5} ${padT + innerH * 0.42} C ${padL + innerW * 0.68} ${padT + innerH * 0.48}, ${padL + innerW * 0.8} ${padT + innerH * 0.75}, ${padL + innerW} ${padT + innerH * 0.65}`}
                fill="none"
                stroke="#FDBA74"
                strokeWidth="1.5"
                strokeDasharray="4 4"
              />

              {MONTH_PLACEHOLDER_LABELS.map((m, i) => {
                const x = padL + (i / (MONTH_PLACEHOLDER_LABELS.length - 1)) * innerW;
                return (
                  <text
                    key={m}
                    x={x}
                    y={chartH - 10}
                    textAnchor="middle"
                    fill="#475569"
                    fontSize="10"
                  >
                    {m}
                  </text>
                );
              })}
            </svg>

            <div className="absolute inset-x-4 top-3 bottom-9 flex flex-col items-center justify-center text-center pointer-events-none">
              <div className="inline-flex flex-col items-center px-3.5 py-2.5 rounded-xl bg-[#FAF8F2]/90 border border-[#E5DFD2]/80">
                <div className="w-9 h-9 rounded-full bg-[#FFF7ED] border border-[#FED7AA] text-[#C2410C] inline-flex items-center justify-center mb-1.5">
                  <BarChart2 className="w-4 h-4" aria-hidden="true" />
                </div>
                <p className="text-sm font-medium text-[#0A1B2C]">No data yet</p>
                <p className="text-xs text-[#33475B] max-w-[260px] mt-0.5">
                  Submit programme sessions to see monthly performance trends.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              {/* Dual axis labels outside plot container so hover tooltip never covers right axis label */}
              <div className="flex items-center justify-between text-[10px] text-[#33475B] px-1 mb-1 ct-num">
                <span>Students (left axis)</span>
                <span>Sessions (right axis)</span>
              </div>
              <div className="relative rounded-xl bg-[#FAF8F2] border border-[#E5DFD2] p-3">

              <svg
                role="img"
                aria-labelledby={titleId}
                aria-describedby={descId}
                viewBox={`0 0 ${chartW} ${chartH}`}
                className="w-full h-auto block overflow-visible"
                onMouseLeave={() => setActiveIdx(null)}
              >
                <defs>
                  <linearGradient id={areaGradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#006BB8" stopOpacity="0.18" />
                    <stop offset="100%" stopColor="#006BB8" stopOpacity="0.01" />
                  </linearGradient>
                </defs>

                {/* Horizontal Grid & Left/Right Axis Ticks */}
                {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                  const y = padT + innerH * (1 - frac);
                  const leftLabel = Math.round(maxStudentsAxis * frac);
                  const rightLabel = Math.round(maxSessionsAxis * frac);
                  return (
                    <g key={frac}>
                      <line
                        x1={padL}
                        y1={y}
                        x2={chartW - padR}
                        y2={y}
                        stroke="#DFD7C2"
                        strokeDasharray={frac === 0 ? undefined : '3 3'}
                      />
                      <text
                        x={padL - 7}
                        y={y + 3.5}
                        textAnchor="end"
                        fill="#33475B"
                        fontSize="10"
                        className="ct-num"
                      >
                        {leftLabel}
                      </text>
                      <text
                        x={chartW - padR + 7}
                        y={y + 3.5}
                        textAnchor="start"
                        fill="#9A3412"
                        fontSize="10"
                        className="ct-num"
                      >
                        {rightLabel}
                      </text>
                    </g>
                  );
                })}

                {/* Active crosshair vertical guide */}
                {activePoint && (
                  <line
                    x1={activePoint.x}
                    y1={padT}
                    x2={activePoint.x}
                    y2={padT + innerH}
                    stroke="#8E8674"
                    strokeDasharray="3 3"
                  />
                )}

                {/* Students area + spline */}
                {showStudents && studentsAreaPath && (
                  <path d={studentsAreaPath} fill={`url(#${areaGradId})`} />
                )}
                {showStudents && studentsPath && (
                  <path
                    d={studentsPath}
                    fill="none"
                    stroke="#006BB8"
                    strokeWidth="2.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}

                {/* Sessions spline */}
                {showSessions && sessionsPath && (
                  <path
                    d={sessionsPath}
                    fill="none"
                    stroke="#C2410C"
                    strokeWidth="2.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}

                {/* Interactive Month Points & X-axis labels */}
                {plotData.map((p) => {
                  const isActive = activeIdx === p.idx;
                  const labelStep = plotData.length > 10 ? Math.ceil(plotData.length / 8) : 1;
                  const showTick =
                    p.idx % labelStep === 0 || p.idx === plotData.length - 1 || isActive;
                  return (
                    <g key={p.monthKey}>
                      {showStudents && (
                        <circle
                          cx={p.x}
                          cy={p.yStudents}
                          r={isActive ? 5.5 : 4}
                          fill="#FFFFFF"
                          stroke="#006BB8"
                          strokeWidth="2.25"
                        />
                      )}
                      {showSessions && (
                        <circle
                          cx={p.x}
                          cy={p.ySessions}
                          r={isActive ? 5.5 : 4}
                          fill="#FFFFFF"
                          stroke="#C2410C"
                          strokeWidth="2.25"
                        />
                      )}

                      {showTick && (
                        <text
                          x={p.x}
                          y={chartH - 10}
                          textAnchor="middle"
                          fill={isActive ? '#0A1B2C' : '#33475B'}
                          fontWeight={isActive ? '500' : '400'}
                          fontSize="10.5"
                        >
                          {p.shortLabel}
                        </text>
                      )}

                      {/* Accessible keyboard & pointer hit target */}
                      <rect
                        x={Math.max(padL - 12, p.x - 18)}
                        y={padT - 6}
                        width={36}
                        height={innerH + 28}
                        fill="transparent"
                        className="cursor-pointer focus:outline-none"
                        tabIndex={0}
                        role="button"
                        aria-label={`${p.monthLabel}: ${plural(p.sessions, 'session')}, ${plural(p.studentsReached, 'student')} reached, CSAT ${formatScore2(p.averageCsat)}, ITP ${formatScore2(p.averageItp)}. Activate to inspect.`}
                        onMouseEnter={() => setActiveIdx(p.idx)}
                        onFocus={() => setActiveIdx(p.idx)}
                        onBlur={() => setActiveIdx((cur) => (cur === p.idx ? null : cur))}
                        onKeyDown={(e) => {
                          if ((e.key === 'Enter' || e.key === ' ') && onDrillDown) {
                            e.preventDefault();
                            onDrillDown({
                              category: 'Month',
                              title: `${p.monthLabel} Analytics`,
                              subtitle: `${plural(p.sessions, 'session')} · ${plural(p.studentsReached, 'student')} reached`,
                              filtersPatch: {},
                              monthKey: p.monthKey,
                            });
                          }
                        }}
                        onClick={() =>
                          onDrillDown?.({
                            category: 'Month',
                            title: `${p.monthLabel} Analytics`,
                            subtitle: `${plural(p.sessions, 'session')} · ${plural(p.studentsReached, 'student')} reached`,
                            filtersPatch: {},
                            monthKey: p.monthKey,
                          })
                        }
                      />
                    </g>
                  );
                })}
              </svg>

              {/* Floating pointer-events-none tooltip on active month */}
              {activePoint && (
                <div
                  role="status"
                  className="pointer-events-none absolute top-3 right-3 z-10 rounded-lg bg-[#0A1B2C] text-[#FFFFFF] px-3 py-2 text-xs shadow-lg ct-num max-w-[230px]"
                >
                  <div className="font-medium text-[#FAF8F2]">{activePoint.monthLabel}</div>
                  <div className="mt-1 space-y-0.5 text-[11px] text-[#E2E8F0]">
                    <div>Sessions: {activePoint.sessions}</div>
                    <div>Students: {activePoint.studentsReached.toLocaleString()}</div>
                    <div>
                      CSAT {formatScore2(activePoint.averageCsat)} · ITP{' '}
                      {formatScore2(activePoint.averageItp)}
                    </div>
                  </div>
                </div>
              )}
              </div>
            </div>

            {/* Footer Readout & Direct Month Pills */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs ct-num">
              <div className="text-[#33475B]">
                {activePoint ? (
                  <span>
                    <span className="font-medium text-[#0A1B2C]">{activePoint.monthLabel}:</span>{' '}
                    {activePoint.sessions} sess · {activePoint.studentsReached.toLocaleString()} std ·
                    CSAT {formatScore2(activePoint.averageCsat)}
                  </span>
                ) : plotData.length === 1 ? (
                  <span>
                    Single active month ({plotData[0]!.monthLabel}) — trajectory lines connect once
                    2+ months are logged.
                  </span>
                ) : (
                  <span>Hover or focus any month marker to inspect monthly metrics.</span>
                )}
              </div>

              {onDrillDown && (
                <div className="flex flex-wrap gap-1.5">
                  {plotData.map((m) => (
                    <button
                      key={m.monthKey}
                      type="button"
                      onMouseEnter={() => setActiveIdx(m.idx)}
                      onMouseLeave={() => setActiveIdx(null)}
                      onClick={() =>
                        onDrillDown({
                          category: 'Month',
                          title: `${m.monthLabel} Analytics`,
                          subtitle: `${plural(m.sessions, 'committed session')} · ${plural(m.studentsReached, 'student')} reached`,
                          filtersPatch: {},
                          monthKey: m.monthKey,
                        })
                      }
                      className="min-h-[26px] px-2.5 py-1 rounded-lg bg-[#FFFFFF] hover:bg-[#E8F6FF] border border-[#DFD7C2] hover:border-[#0284C7] text-[11px] text-[#0A1B2C] cursor-pointer transition-colors"
                    >
                      {m.shortLabel} · {m.sessions}s / {m.studentsReached}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    );
  });
MonthlyProgrammePerformanceChart.displayName = 'MonthlyProgrammePerformanceChart';

/* -------------------------------------------------------------------------- */
/* B. District-wise Performance (Sorted Horizontal Bars)                      */
/* -------------------------------------------------------------------------- */

interface DistrictHorizontalChartProps {
  districtBreakdown: DashboardAnalytics['districtBreakdown'];
  totalSessions: number;
  onDrillDown?: (target: DetailedAnalyticsTarget) => void;
}

export const DistrictHorizontalChart: React.FC<DistrictHorizontalChartProps> = React.memo(
  ({ districtBreakdown, totalSessions, onDrillDown }) => {
    const titleId = useId();
    const sorted = useMemo(() => {
      if (totalSessions === 0) return districtBreakdown;
      return [...districtBreakdown].sort(
        (a, b) =>
          b.studentsReached - a.studentsReached ||
          b.sessions - a.sessions ||
          a.district.localeCompare(b.district),
      );
    }, [districtBreakdown, totalSessions]);

    const maxStudents = useMemo(
      () => Math.max(1, ...sorted.map((d) => d.studentsReached)),
      [sorted],
    );
    const maxSessions = useMemo(() => Math.max(1, ...sorted.map((d) => d.sessions)), [sorted]);

    return (
      <section
        aria-labelledby={titleId}
        className="ct-card p-5 flex flex-col gap-4 h-full"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-start gap-2.5 min-w-0">
            <span
              className="w-8 h-8 rounded-lg bg-[#FFF7ED] border border-[#FED7AA] text-[#C2410C] inline-flex items-center justify-center shrink-0"
              aria-hidden="true"
            >
              <MapPin className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h3 id={titleId} className="text-[15px] font-medium text-[#0A1B2C] leading-snug">
                District-wise Performance
              </h3>
              <p className="text-xs text-[#33475B] mt-0.5">
                {totalSessions > 0
                  ? 'Sorted by reach across approved districts'
                  : 'Programme reach across Cuddalore, Nagapattinam & Sivaganga'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-[#33475B]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#C2410C]" aria-hidden="true" />
              Sessions
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#006BB8]" aria-hidden="true" />
              Students
            </span>
          </div>
        </div>

        <div className="space-y-3.5 my-auto">
          {sorted.map((d) => {
            const stuPct = totalSessions > 0 ? Math.round((d.studentsReached / maxStudents) * 100) : 0;
            const sessPct = totalSessions > 0 ? Math.round((d.sessions / maxSessions) * 100) : 0;
            const canInspect = Boolean(onDrillDown && d.sessions > 0);
            return (
              <div
                key={d.district}
                className="p-3 rounded-xl bg-[#FAF8F2] border border-[#E5DFD2] space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs ct-num">
                  <div className="min-w-0">
                    <div className="font-medium text-[#0A1B2C] text-[13px]">{d.district}</div>
                    {d.sessions > 0 && (
                      <div className="text-[11px] text-[#33475B]">
                        {plural(d.schoolsCount, 'school')} · CSAT {formatScore2(d.averageCsat)}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[12px] text-[#0A1B2C] font-medium">
                      {d.sessions} <span className="text-[#8E8674]">|</span>{' '}
                      {d.studentsReached.toLocaleString()}
                    </span>
                    {canInspect && (
                      <button
                        type="button"
                        onClick={() =>
                          onDrillDown?.({
                            category: 'District',
                            title: `${d.district} District Analytics`,
                            subtitle: `${plural(d.sessions, 'session')} · ${plural(d.schoolsCount, 'school')} · ${plural(d.studentsReached, 'student')} reached`,
                            filtersPatch: { district: d.district },
                          })
                        }
                        aria-label={`Inspect ${d.district} district analytics`}
                        className="min-h-[26px] min-w-[26px] px-2.5 py-0.5 rounded-md bg-[#FFFFFF] hover:bg-[#E8F6FF] border border-[#DFD7C2] hover:border-[#0284C7] text-[11px] text-[#0A1B2C] cursor-pointer transition-colors"
                      >
                        Inspect
                      </button>
                    )}
                  </div>
                </div>

                {/* Dual proportional horizontal tracks */}
                <div className="space-y-1.5" aria-hidden="true">
                  <div className="h-2 w-full rounded-full bg-[#EAE4D5] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#C2410C] motion-safe:transition-[width] motion-safe:duration-300"
                      style={{ width: `${d.sessions > 0 ? Math.max(4, sessPct) : 0}%` }}
                    />
                  </div>
                  <div className="h-2 w-full rounded-full bg-[#EAE4D5] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#006BB8] motion-safe:transition-[width] motion-safe:duration-300"
                      style={{ width: `${d.studentsReached > 0 ? Math.max(4, stuPct) : 0}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="text-[11px] text-[#33475B] flex items-center justify-between pt-1 border-t border-[#E5DFD2] ct-num">
          <span>Format: Sessions | Students</span>
          <span>
            {totalSessions > 0 ? `${districtBreakdown.filter((d) => d.sessions > 0).length} active` : '0 active sessions'}
          </span>
        </div>
      </section>
    );
  },
);
DistrictHorizontalChart.displayName = 'DistrictHorizontalChart';

/* -------------------------------------------------------------------------- */
/* C. Career Tour Performance (Grouped Multi-Metric Column Chart)             */
/* -------------------------------------------------------------------------- */

type TourMetricFilter = 'all' | 'sessions' | 'students' | 'schools';

interface CareerTourColumnChartProps {
  tourBreakdown: DashboardAnalytics['tourBreakdown'];
  config: AppConfiguration;
  onDrillDown?: (target: DetailedAnalyticsTarget) => void;
}

const TOUR_METRIC_OPTIONS: ReadonlyArray<{ id: TourMetricFilter; label: string }> = [
  { id: 'all', label: 'All 3' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'students', label: 'Students' },
  { id: 'schools', label: 'Schools' },
];

export const CareerTourColumnChart: React.FC<CareerTourColumnChartProps> = React.memo(
  ({ tourBreakdown, config, onDrillDown }) => {
    const titleId = useId();
    const toolbarRef = useRef<HTMLDivElement>(null);
    const [metricMode, setMetricMode] = useState<TourMetricFilter>('all');
    const [hoveredTourId, setHoveredTourId] = useState<string | null>(null);

    const enrichedTours = useMemo(() => {
      return tourBreakdown.map((t) => {
        const meta = config.tours.find((ct) => ct.tourId === t.tourId);
        const shortCode = meta?.tourCode || t.tourName;
        return {
          ...t,
          shortCode,
          schools: t.schoolsCount ?? 0,
        };
      });
    }, [config.tours, tourBreakdown]);

    const handleToolbarKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      const idx = TOUR_METRIC_OPTIONS.findIndex((o) => o.id === metricMode);
      if (idx === -1) return;
      const rtl =
        typeof window !== 'undefined' &&
        toolbarRef.current &&
        window.getComputedStyle(toolbarRef.current).direction === 'rtl';
      let nextIdx: number | null = null;
      if (e.key === 'ArrowRight') {
        nextIdx = (idx + (rtl ? -1 : 1) + TOUR_METRIC_OPTIONS.length) % TOUR_METRIC_OPTIONS.length;
      } else if (e.key === 'ArrowLeft') {
        nextIdx = (idx + (rtl ? 1 : -1) + TOUR_METRIC_OPTIONS.length) % TOUR_METRIC_OPTIONS.length;
      } else if (e.key === 'Home') {
        nextIdx = 0;
      } else if (e.key === 'End') {
        nextIdx = TOUR_METRIC_OPTIONS.length - 1;
      }
      if (nextIdx === null) return;
      e.preventDefault();
      const nextOpt = TOUR_METRIC_OPTIONS[nextIdx]!;
      setMetricMode(nextOpt.id);
      const buttons = toolbarRef.current?.querySelectorAll<HTMLButtonElement>('button');
      buttons?.[nextIdx]?.focus();
    };

    const maxSess = Math.max(1, ...enrichedTours.map((t) => t.sessions));
    const maxStud = Math.max(1, ...enrichedTours.map((t) => t.studentsReached));
    const maxSch = Math.max(1, ...enrichedTours.map((t) => t.schools));

    const activeTour =
      enrichedTours.find((t) => t.tourId === hoveredTourId) ?? enrichedTours[0] ?? null;

    return (
      <section aria-labelledby={titleId} className="ct-card p-5 flex flex-col gap-4 h-full">
        <div className="flex flex-wrap items-start justify-between gap-2.5">
          <div className="flex items-start gap-2.5 min-w-0">
            <span
              className="w-8 h-8 rounded-lg bg-[#FFF7ED] border border-[#FED7AA] text-[#C2410C] inline-flex items-center justify-center shrink-0"
              aria-hidden="true"
            >
              <Compass className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h3 id={titleId} className="text-[15px] font-medium text-[#0A1B2C] leading-snug">
                Career Tour Performance
              </h3>
              <p className="text-xs text-[#33475B] mt-0.5">
                Sessions, student participation &amp; school coverage by tour
              </p>
            </div>
          </div>

          <div
            ref={toolbarRef}
            role="toolbar"
            aria-label="Filter career tour comparison metric"
            onKeyDown={handleToolbarKeyDown}
            className="inline-flex flex-wrap items-center gap-0.5 p-0.5 rounded-lg bg-[#F5F2E9] border border-[#DFD7C2] text-[11px]"
          >
            {TOUR_METRIC_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                tabIndex={metricMode === opt.id ? 0 : -1}
                aria-pressed={metricMode === opt.id}
                onClick={() => setMetricMode(opt.id)}
                className={`min-h-[26px] min-w-[28px] px-2 py-1 rounded-md font-medium cursor-pointer transition-colors ${
                  metricMode === opt.id
                    ? 'bg-[#FFFFFF] text-[#0A1B2C] shadow-xs ring-1 ring-[#0A1B2C]/15'
                    : 'text-[#33475B] hover:text-[#0A1B2C]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {enrichedTours.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center rounded-xl bg-[#FAF8F2] border border-[#E5DFD2] p-6 text-center min-h-[210px]">
            <div className="flex items-end gap-2.5 h-16 mb-3 opacity-60" aria-hidden="true">
              <div className="w-4 h-7 rounded-t bg-[#DFD7C2]" />
              <div className="w-4 h-12 rounded-t bg-[#E5DFD2]" />
              <div className="w-4 h-5 rounded-t bg-[#DFD7C2]" />
              <div className="w-2" />
              <div className="w-4 h-9 rounded-t bg-[#E5DFD2]" />
              <div className="w-4 h-14 rounded-t bg-[#DFD7C2]" />
              <div className="w-4 h-6 rounded-t bg-[#E5DFD2]" />
            </div>
            <p className="text-sm font-medium text-[#0A1B2C]">No data yet</p>
            <p className="text-xs text-[#33475B] mt-0.5 max-w-[260px]">
              Career tour performance will appear once sessions are submitted.
            </p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col justify-between gap-3">
            {/* Grouped Column Plot */}
            <div className="rounded-xl bg-[#FAF8F2] border border-[#E5DFD2] px-4 pt-4 pb-3">
              <div className="flex items-center justify-end gap-3 text-[11px] text-[#33475B] mb-3">
                {(metricMode === 'all' || metricMode === 'sessions') && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-xs bg-[#C2410C]" aria-hidden="true" />
                    Sessions
                  </span>
                )}
                {(metricMode === 'all' || metricMode === 'students') && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-xs bg-[#006BB8]" aria-hidden="true" />
                    Students
                  </span>
                )}
                {(metricMode === 'all' || metricMode === 'schools') && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-xs bg-[#0D9488]" aria-hidden="true" />
                    Schools
                  </span>
                )}
              </div>

              <div
                className="grid gap-3 items-end border-b border-[#DFD7C2] pb-2 min-h-[146px]"
                style={{
                  gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))',
                }}
              >
                {enrichedTours.map((t) => {
                  const isFocused = hoveredTourId === t.tourId;
                  const hSess = Math.max(8, Math.round((t.sessions / maxSess) * 116));
                  const hStud = Math.max(8, Math.round((t.studentsReached / maxStud) * 116));
                  const hSch = Math.max(8, Math.round((t.schools / maxSch) * 116));

                  return (
                    <button
                      key={t.tourId}
                      type="button"
                      onMouseEnter={() => setHoveredTourId(t.tourId)}
                      onFocus={() => setHoveredTourId(t.tourId)}
                      onClick={() =>
                        onDrillDown?.({
                          category: 'Tour',
                          title: `${t.tourName} Analytics`,
                          subtitle: `${plural(t.sessions, 'session')} · ${plural(t.studentsReached, 'student')} · ${plural(t.schools, 'school')}`,
                          filtersPatch: { tourId: t.tourId },
                        })
                      }
                      aria-label={`${t.tourName}: ${plural(t.sessions, 'session')}, ${plural(t.studentsReached, 'student')} reached, ${plural(t.schools, 'school')} covered, CSAT ${formatScore2(t.averageCsat)}. Inspect breakdown.`}
                      className={`group flex flex-col items-center justify-end gap-1.5 p-1.5 rounded-lg cursor-pointer transition-colors ${
                        isFocused ? 'bg-[#FFFFFF] ring-1 ring-[#0284C7]/40' : 'hover:bg-[#FFFFFF]/70'
                      }`}
                    >
                      <div className="flex items-end justify-center gap-1.5 h-[122px]">
                        {(metricMode === 'all' || metricMode === 'sessions') && (
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-[10px] text-[#9A3412] ct-num">{t.sessions}</span>
                            <div
                              className="w-4 sm:w-5 rounded-t-md bg-[#C2410C] group-hover:brightness-110 motion-safe:transition-[height] motion-safe:duration-300"
                              style={{ height: `${hSess}px` }}
                            />
                          </div>
                        )}
                        {(metricMode === 'all' || metricMode === 'students') && (
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-[10px] text-[#006BB8] ct-num">
                              {t.studentsReached}
                            </span>
                            <div
                              className="w-4 sm:w-5 rounded-t-md bg-[#006BB8] group-hover:brightness-110 motion-safe:transition-[height] motion-safe:duration-300"
                              style={{ height: `${hStud}px` }}
                            />
                          </div>
                        )}
                        {(metricMode === 'all' || metricMode === 'schools') && (
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-[10px] text-[#047857] ct-num">{t.schools}</span>
                            <div
                              className="w-4 sm:w-5 rounded-t-md bg-[#0D9488] group-hover:brightness-110 motion-safe:transition-[height] motion-safe:duration-300"
                              style={{ height: `${hSch}px` }}
                            />
                          </div>
                        )}
                      </div>
                      <span className="text-[11px] font-medium text-[#0A1B2C] ct-num truncate max-w-[84px]" title={t.tourName}>
                        {t.shortCode}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Active Tour Readout */}
              {activeTour && (
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs ct-num">
                  <span className="font-medium text-[#0A1B2C] truncate min-w-0" title={activeTour.tourName}>
                    {activeTour.tourName}
                  </span>
                  <span className="text-[#33475B] shrink-0">
                    {activeTour.sessions} sess · {activeTour.studentsReached} std ·{' '}
                    {activeTour.schools} sch · CSAT {formatScore2(activeTour.averageCsat)}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    );
  },
);
CareerTourColumnChart.displayName = 'CareerTourColumnChart';

/* -------------------------------------------------------------------------- */
/* D. Language Distribution (Interactive SVG Donut Chart)                     */
/* -------------------------------------------------------------------------- */

interface LanguageDonutChartProps {
  languageBreakdown: DashboardAnalytics['languageBreakdown'];
  totalStudentsReached: number;
  onDrillDown?: (target: DetailedAnalyticsTarget) => void;
}

export const LanguageDonutChart: React.FC<LanguageDonutChartProps> = React.memo(
  ({ languageBreakdown, totalStudentsReached, onDrillDown }) => {
    const titleId = useId();
    const [activeLang, setActiveLang] = useState<string | null>(null);

    const radius = 42;
    const circumference = 2 * Math.PI * radius;

    const slices = useMemo(() => {
      const sorted = [...languageBreakdown].sort(
        (a, b) => b.studentsReached - a.studentsReached || b.sessions - a.sessions,
      );
      let cumulativePct = 0;
      return sorted.map((item, idx) => {
        const pct =
          totalStudentsReached > 0 ? (item.studentsReached / totalStudentsReached) * 100 : 0;
        const dashLength = (pct / 100) * circumference;
        const dashOffset = -((cumulativePct / 100) * circumference);
        cumulativePct += pct;
        return {
          ...item,
          pct,
          dashLength,
          dashOffset,
          color: DONUT_COLORS[idx % DONUT_COLORS.length]!,
        };
      });
    }, [circumference, languageBreakdown, totalStudentsReached]);

    const focused = slices.find((s) => s.language === activeLang) ?? null;

    return (
      <section
        aria-labelledby={titleId}
        className="ct-card p-5 flex flex-col gap-4 h-full"
      >
        <div className="flex items-start gap-2.5">
          <span
            className="w-8 h-8 rounded-lg bg-[#FFF7ED] border border-[#FED7AA] text-[#C2410C] inline-flex items-center justify-center shrink-0"
            aria-hidden="true"
          >
            <Globe2 className="w-4 h-4" />
          </span>
          <div>
            <h3 id={titleId} className="text-[15px] font-medium text-[#0A1B2C] leading-snug">
              Language Distribution
            </h3>
            <p className="text-xs text-[#33475B] mt-0.5">
              Student participation across delivery languages
            </p>
          </div>
        </div>

        <div className="flex flex-col items-center gap-4 my-auto">
          <div className="relative w-32 h-32 shrink-0 flex items-center justify-center">
            <svg
              role="img"
              aria-labelledby={titleId}
              viewBox="0 0 112 112"
              className="w-full h-full -rotate-90"
            >
              <circle
                cx="56"
                cy="56"
                r={radius}
                fill="none"
                stroke={totalStudentsReached === 0 ? '#EAE4D5' : '#F3EFE4'}
                strokeWidth="14"
              />
              {totalStudentsReached > 0 &&
                slices.map((slice) => {
                  const isActive = activeLang === slice.language;
                  return (
                    <circle
                      key={slice.language}
                      cx="56"
                      cy="56"
                      r={radius}
                      fill="none"
                      stroke={slice.color}
                      strokeWidth={isActive ? 17 : 14}
                      strokeDasharray={`${slice.dashLength} ${circumference}`}
                      strokeDashoffset={slice.dashOffset}
                      className="cursor-pointer motion-safe:transition-[stroke-width] motion-safe:duration-150"
                      onMouseEnter={() => setActiveLang(slice.language)}
                      onMouseLeave={() => setActiveLang(null)}
                      onClick={() =>
                        onDrillDown?.({
                          category: 'Language',
                          title: `${slice.language} Sessions Analytics`,
                          subtitle: `${plural(slice.sessions, 'session')} · ${plural(slice.studentsReached, 'student')} reached`,
                          filtersPatch: { language: slice.language },
                        })
                      }
                    />
                  );
                })}
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-3 ct-num">
              {focused ? (
                <>
                  <span className="text-[16px] font-medium text-[#0A1B2C] leading-tight">
                    {round1(focused.pct)}%
                  </span>
                  <span className="text-[11px] text-[#33475B] truncate max-w-[74px]">
                    {focused.language}
                  </span>
                  <span className="text-[10px] text-[#475569]">
                    {focused.studentsReached.toLocaleString()} std
                  </span>
                </>
              ) : (
                <>
                  <span className="text-[17px] font-medium text-[#0A1B2C] leading-tight">
                    {totalStudentsReached.toLocaleString()}
                  </span>
                  <span className="text-[11px] text-[#33475B]">Students</span>
                </>
              )}
            </div>
          </div>

          {/* Interactive Legend with Percentages & Counts */}
          {slices.length === 0 || totalStudentsReached === 0 ? (
            <div className="w-full space-y-2.5 text-xs">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center justify-between gap-2 text-[#475569]">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full bg-[#DFD7C2]"
                      aria-hidden="true"
                    />
                    <span className="h-2.5 w-20 rounded bg-[#EFE8D6]" />
                  </span>
                  <span className="ct-num">—</span>
                </div>
              ))}
              <p className="text-[11px] text-[#33475B] pt-1 text-center">
                Language shares appear once sessions are submitted.
              </p>
            </div>
          ) : (
            <div className="w-full space-y-1.5 text-xs ct-num min-w-0">
              {slices.map((s) => {
                const isActive = activeLang === s.language;
                return (
                  <button
                    key={s.language}
                    type="button"
                    onMouseEnter={() => setActiveLang(s.language)}
                    onMouseLeave={() => setActiveLang(null)}
                    onFocus={() => setActiveLang(s.language)}
                    onBlur={() => setActiveLang(null)}
                    onClick={() =>
                      onDrillDown?.({
                        category: 'Language',
                        title: `${s.language} Sessions Analytics`,
                        subtitle: `${plural(s.sessions, 'session')} · ${plural(s.studentsReached, 'student')} reached`,
                        filtersPatch: { language: s.language },
                      })
                    }
                    className={`w-full px-3 py-1.5 rounded-lg border flex items-center justify-between gap-3 text-left cursor-pointer transition-colors ${
                      isActive
                        ? 'bg-[#E8F6FF] border-[#0284C7]/45'
                        : 'bg-[#FAF8F2] border-[#E5DFD2] hover:bg-[#F5F2E9]'
                    }`}
                  >
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: s.color }}
                        aria-hidden="true"
                      />
                      <span className="font-medium text-[#0A1B2C]">{s.language}</span>
                    </span>
                    <span className="text-[#243647] shrink-0">
                      {s.studentsReached.toLocaleString()}{' '}
                      <span className="text-[#475569]">({formatPct1(s.pct)})</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>
    );
  },
);
LanguageDonutChart.displayName = 'LanguageDonutChart';

/* -------------------------------------------------------------------------- */
/* E. Grade-wise Student Reach (Vertical Bar Chart)                           */
/* -------------------------------------------------------------------------- */

interface GradeReachBarChartProps {
  gradeBreakdown: DashboardAnalytics['gradeBreakdown'];
  onDrillDown?: (target: DetailedAnalyticsTarget) => void;
}

export const GradeReachBarChart: React.FC<GradeReachBarChartProps> = React.memo(
  ({ gradeBreakdown, onDrillDown }) => {
    const titleId = useId();
    const [hoveredGrade, setHoveredGrade] = useState<string | null>(null);

    const maxStudents = useMemo(
      () => Math.max(1, ...gradeBreakdown.map((g) => g.studentsReached)),
      [gradeBreakdown],
    );
    const active = gradeBreakdown.find((g) => g.grade === hoveredGrade) ?? gradeBreakdown[0] ?? null;

    return (
      <section aria-labelledby={titleId} className="ct-card p-5 flex flex-col gap-4 h-full">
        <div className="flex items-start gap-2.5">
          <span
            className="w-8 h-8 rounded-lg bg-[#FFF7ED] border border-[#FED7AA] text-[#C2410C] inline-flex items-center justify-center shrink-0"
            aria-hidden="true"
          >
            <GraduationCap className="w-4 h-4" />
          </span>
          <div>
            <h3 id={titleId} className="text-[15px] font-medium text-[#0A1B2C] leading-snug">
              Grade-wise Student Reach
            </h3>
            <p className="text-xs text-[#33475B] mt-0.5">
              Student participation and feedback across grades
            </p>
          </div>
        </div>

        {gradeBreakdown.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center rounded-xl bg-[#FAF8F2] border border-[#E5DFD2] p-6 text-center min-h-[210px]">
            <div className="flex items-end gap-2 h-14 mb-3 opacity-70" aria-hidden="true">
              {[24, 34, 42, 48, 56].map((h, i) => (
                <div
                  key={i}
                  className="w-4 rounded-t-md bg-[#E5DFD2]"
                  style={{ height: `${h}px` }}
                />
              ))}
            </div>
            <p className="text-sm font-medium text-[#0A1B2C]">No data yet</p>
            <p className="text-xs text-[#33475B] mt-0.5 max-w-[240px]">
              Grade-wise participation will be shown here.
            </p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col justify-between gap-3">
            <div className="rounded-xl bg-[#FAF8F2] border border-[#E5DFD2] px-4 pt-5 pb-3">
              <div
                className="grid gap-2.5 items-end border-b border-[#DFD7C2] pb-2 min-h-[146px]"
                style={{
                  gridTemplateColumns: 'repeat(auto-fit, minmax(56px, 1fr))',
                }}
              >
                {gradeBreakdown.map((g) => {
                  const barH = Math.max(10, Math.round((g.studentsReached / maxStudents) * 110));
                  const isFocused = hoveredGrade === g.grade;
                  return (
                    <button
                      key={g.grade}
                      type="button"
                      onMouseEnter={() => setHoveredGrade(g.grade)}
                      onFocus={() => setHoveredGrade(g.grade)}
                      onClick={() =>
                        onDrillDown?.({
                          category: 'Grade',
                          title: `Grade ${g.grade} Analytics`,
                          subtitle: `${g.classesCount} class rows · ${g.studentsReached} students reached`,
                          filtersPatch: { grade: g.grade },
                        })
                      }
                      aria-label={`Grade ${g.grade}: ${g.studentsReached} students reached, ${g.classesCount} class rows, CSAT ${formatScore2(g.averageCsat)}. Inspect breakdown.`}
                      className={`group flex flex-col items-center justify-end gap-1 p-1 rounded-lg cursor-pointer transition-colors ${
                        isFocused ? 'bg-[#FFFFFF] ring-1 ring-[#0284C7]/40' : 'hover:bg-[#FFFFFF]/70'
                      }`}
                    >
                      <span className="text-[11px] font-medium text-[#0A1B2C] ct-num">
                        {g.studentsReached}
                      </span>
                      <div
                        className="w-7 sm:w-8 rounded-t-lg bg-[#006BB8] group-hover:bg-[#1EA7FF] motion-safe:transition-[height] motion-safe:duration-300"
                        style={{ height: `${barH}px` }}
                      />
                      <span className="text-[11px] text-[#33475B] ct-num mt-0.5">
                        Gr {g.grade}
                      </span>
                    </button>
                  );
                })}
              </div>

              {active && (
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs ct-num">
                  <span className="font-medium text-[#0A1B2C]">Grade {active.grade}</span>
                  <span className="text-[#33475B]">
                    {active.classesCount} class row{active.classesCount === 1 ? '' : 's'} · CSAT{' '}
                    <span className="text-[#006BB8] font-medium">
                      {formatScore2(active.averageCsat)}
                    </span>{' '}
                    · ITP {formatScore2(active.averageItp)}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    );
  },
);
GradeReachBarChart.displayName = 'GradeReachBarChart';

/* -------------------------------------------------------------------------- */
/* F. Facilitator Performance (Ranked Horizontal Bars)                        */
/* -------------------------------------------------------------------------- */

interface FacilitatorRankedChartProps {
  facilitatorPanels: DashboardAnalytics['facilitatorPanels'];
  onDrillDown?: (target: DetailedAnalyticsTarget) => void;
}

export const FacilitatorRankedChart: React.FC<FacilitatorRankedChartProps> = React.memo(
  ({ facilitatorPanels, onDrillDown }) => {
    const titleId = useId();
    const [showAll, setShowAll] = useState(false);

    const visibleRows = useMemo(
      () => (showAll ? facilitatorPanels : facilitatorPanels.slice(0, 6)),
      [facilitatorPanels, showAll],
    );
    const maxStudents = useMemo(
      () => Math.max(1, ...facilitatorPanels.map((f) => f.studentsReached)),
      [facilitatorPanels],
    );

    return (
      <section aria-labelledby={titleId} className="ct-card p-5 flex flex-col gap-4 h-full">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-start gap-2.5 min-w-0">
            <span
              className="w-8 h-8 rounded-lg bg-[#FFF7ED] border border-[#FED7AA] text-[#C2410C] inline-flex items-center justify-center shrink-0"
              aria-hidden="true"
            >
              <Users className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h3 id={titleId} className="text-[15px] font-medium text-[#0A1B2C] leading-snug">
                Facilitator Performance
              </h3>
              <p className="text-xs text-[#33475B] mt-0.5">
                Ranked by sessions conducted, students reached &amp; schools covered
              </p>
            </div>
          </div>

          {facilitatorPanels.length > 6 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="min-h-[26px] px-2.5 py-1 rounded-lg bg-[#FAF8F2] hover:bg-[#F5F2E9] border border-[#DFD7C2] text-[11px] font-medium text-[#0A1B2C] cursor-pointer transition-colors"
            >
              {showAll ? 'Show Top 6' : `Show all ${facilitatorPanels.length}`}
            </button>
          )}
        </div>

        {facilitatorPanels.length === 0 ? (
          <div className="flex-1 flex flex-col justify-center space-y-3 rounded-xl bg-[#FAF8F2] border border-[#E5DFD2] p-4 min-h-[210px]">
            {[78, 56, 38].map((w, idx) => (
              <div key={idx} className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-[#EFE8D6] border border-[#DFD7C2] shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-2.5 rounded-full bg-[#EAE4D5]" style={{ width: `${w}%` }} />
                </div>
                <div className="w-16 h-2.5 rounded-full bg-[#EFE8D6]" />
              </div>
            ))}
            <p className="text-xs text-[#33475B] text-center pt-1">
              Facilitator rankings will appear once sessions are submitted.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5 flex-1">
            {visibleRows.map((fac, idx) => {
              const barPct = Math.max(5, Math.round((fac.studentsReached / maxStudents) * 100));
              const schoolsCovered = fac.schoolsCount ?? 0;
              return (
                <button
                  key={fac.email}
                  type="button"
                  onClick={() =>
                    onDrillDown?.({
                      category: 'Facilitator',
                      title: `${fac.name} Performance`,
                      subtitle: `${fac.email} · ${plural(fac.sessions, 'session')} · ${plural(fac.studentsReached, 'student')}`,
                      filtersPatch: { facilitatorEmail: fac.email },
                    })
                  }
                  aria-label={`Rank ${idx + 1}: ${fac.name}, ${plural(fac.sessions, 'session')}, ${plural(fac.studentsReached, 'student')}, ${plural(schoolsCovered, 'school')} covered, CSAT ${formatScore2(fac.averageCsat)}. Inspect facilitator.`}
                  className="w-full p-2.5 rounded-xl bg-[#FAF8F2] hover:bg-[#F5F2E9] border border-[#E5DFD2] hover:border-[#0284C7]/45 text-left space-y-1.5 cursor-pointer transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 text-xs ct-num">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-5 h-5 rounded-full bg-[#FFFFFF] border border-[#DFD7C2] text-[10px] font-medium text-[#0A1B2C] inline-flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <span className="font-medium text-[#0A1B2C] truncate" title={fac.name}>
                        {fac.name}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#243647] shrink-0">
                      <span className="font-medium text-[#0A1B2C]">{fac.sessions}</span> sess ·{' '}
                      <span className="font-medium text-[#0A1B2C]">
                        {fac.studentsReached.toLocaleString()}
                      </span>{' '}
                      std · <span>{schoolsCovered} sch</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className="flex-1 h-2 rounded-full bg-[#EAE4D5] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#C2410C] motion-safe:transition-[width] motion-safe:duration-300"
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-[#006BB8] font-medium ct-num shrink-0">
                      CSAT {formatScore2(fac.averageCsat)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    );
  },
);
FacilitatorRankedChart.displayName = 'FacilitatorRankedChart';

/* -------------------------------------------------------------------------- */
/* G. Feedback & Satisfaction (CSAT, ITP & Teacher NPS Gauges + Trends)       */
/* -------------------------------------------------------------------------- */

interface GaugeCardProps {
  label: string;
  subtitle: string;
  displayValue: string;
  fillFraction: number | null; // 0..1
  strokeColor: string;
  trackColor: string;
  responsesText: string;
  comparison?: KpiPeriodMetricComparison;
  children?: React.ReactNode;
}

const RadialGaugeCard: React.FC<GaugeCardProps> = ({
  label,
  subtitle,
  displayValue,
  fillFraction,
  strokeColor,
  trackColor,
  responsesText,
  comparison,
  children,
}) => {
  const radius = 38;
  const circ = 2 * Math.PI * radius;
  // Use 270deg (0.75 of circle) open arc for a clean modern speedometer feel
  const arcLen = circ * 0.75;
  const filledLen = fillFraction !== null ? Math.max(0, Math.min(1, fillFraction)) * arcLen : 0;

  return (
    <div className="p-4 rounded-xl bg-[#FAF8F2] border border-[#E5DFD2] flex flex-col justify-between gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[13px] font-medium text-[#0A1B2C]">{label}</div>
          <div className="text-[11px] text-[#33475B]">{subtitle}</div>
        </div>
        {comparison && <TrendBadge comparison={comparison} />}
      </div>

      <div className="flex items-center gap-4">
        <div className="relative w-24 h-24 shrink-0 flex items-center justify-center">
          <svg viewBox="0 0 100 100" className="w-full h-full rotate-[135deg]" aria-hidden="true">
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={trackColor}
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={`${arcLen} ${circ}`}
            />
            {fillFraction !== null && (
              <circle
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke={strokeColor}
                strokeWidth="9"
                strokeLinecap="round"
                strokeDasharray={`${filledLen} ${circ}`}
              />
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center ct-num">
            <span className="text-lg font-medium text-[#0A1B2C] leading-none">
              {displayValue}
            </span>
          </div>
        </div>

        <div className="flex-1 min-w-0 space-y-2">
          <div className="text-xs font-medium text-[#0A1B2C] ct-num">{responsesText}</div>
          {children}
        </div>
      </div>
    </div>
  );
};

interface FeedbackSatisfactionSectionProps {
  analytics: DashboardAnalytics;
  comparisons: {
    averageCsat: KpiPeriodMetricComparison;
    averageItp: KpiPeriodMetricComparison;
    teacherNps: KpiPeriodMetricComparison;
  };
}

export const FeedbackSatisfactionSection: React.FC<FeedbackSatisfactionSectionProps> = React.memo(
  ({ analytics, comparisons }) => {
    const titleId = useId();

    const validMonths = useMemo(
      () => analytics.monthlyBreakdown.filter((m) => /^\d{4}-\d{2}$/.test(m.monthKey)),
      [analytics.monthlyBreakdown],
    );
    const hasTrendData = validMonths.length >= 2;

    const totalTeachers =
      analytics.npsDistribution.promoter +
      analytics.npsDistribution.passive +
      analytics.npsDistribution.detractor;

    const npsDisplay =
      analytics.teacherNpsAverage !== null
        ? analytics.teacherNpsAverage > 0
          ? `+${round1(analytics.teacherNpsAverage)}`
          : String(round1(analytics.teacherNpsAverage))
        : '—';

    return (
      <section aria-labelledby={titleId} className="ct-card p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-start gap-2.5">
            <span
              className="w-8 h-8 rounded-lg bg-[#FFF7ED] border border-[#FED7AA] text-[#C2410C] inline-flex items-center justify-center shrink-0"
              aria-hidden="true"
            >
              <Star className="w-4 h-4" />
            </span>
            <div>
              <h3 id={titleId} className="text-[15px] font-medium text-[#0A1B2C] leading-snug">
                Feedback &amp; Satisfaction
              </h3>
              <p className="text-xs text-[#33475B] mt-0.5">
                Student CSAT, career interest (ITP), and educator NPS with pooled response counts
              </p>
            </div>
          </div>

          <span className="text-[11px] text-[#33475B] ct-num">
            {hasTrendData
              ? `Multi-month trend (${validMonths.length} active months)`
              : analytics.totalSessions > 0
                ? 'Trends appear after 2+ months of data'
                : 'Awaiting feedback responses'}
          </span>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3.5">
          {/* 1. CSAT Gauge & Sentiment */}
          <RadialGaugeCard
            label="Pooled CSAT"
            subtitle="Session enjoyment (1–5 scale)"
            displayValue={formatScore2(analytics.averageCsat)}
            fillFraction={
              analytics.averageCsat !== null ? Math.max(0, Math.min(1, analytics.averageCsat / 5)) : null
            }
            strokeColor="#C2410C"
            trackColor="#EAE4D5"
            responsesText={`${analytics.totalQuestionAResponses.toLocaleString()} student responses`}
            comparison={hasTrendData ? comparisons.averageCsat : undefined}
          >
            <div className="space-y-1.5 text-[11px] ct-num">
              <div className="h-2 w-full rounded-full bg-[#EAE4D5] overflow-hidden flex">
                {analytics.qaSentiment.total > 0 && (
                  <>
                    <div
                      className="h-full bg-[#047857]"
                      style={{ width: `${analytics.qaSentiment.positivePct ?? 0}%` }}
                      title={`4–5 Pos: ${analytics.qaSentiment.positiveCount}`}
                    />
                    <div
                      className="h-full bg-[#94A3B8]"
                      style={{ width: `${analytics.qaSentiment.neutralPct ?? 0}%` }}
                      title={`3 Neu: ${analytics.qaSentiment.neutralCount}`}
                    />
                    <div
                      className="h-full bg-[#BE123C]"
                      style={{ width: `${analytics.qaSentiment.negativePct ?? 0}%` }}
                      title={`1–2 Neg: ${analytics.qaSentiment.negativeCount}`}
                    />
                  </>
                )}
              </div>
              <div className="flex justify-between text-[#33475B]">
                <span>Pos {formatPct1(analytics.qaSentiment.positivePct)}</span>
                <span>Miss {analytics.totalMissingResponsesQA.toLocaleString()}</span>
              </div>
            </div>
          </RadialGaugeCard>

          {/* 2. ITP Gauge & Sentiment */}
          <RadialGaugeCard
            label="Pooled ITP"
            subtitle="Career curiosity (1–5 scale)"
            displayValue={formatScore2(analytics.averageItp)}
            fillFraction={
              analytics.averageItp !== null ? Math.max(0, Math.min(1, analytics.averageItp / 5)) : null
            }
            strokeColor="#006BB8"
            trackColor="#EAE4D5"
            responsesText={`${analytics.totalQuestionBResponses.toLocaleString()} student responses`}
            comparison={hasTrendData ? comparisons.averageItp : undefined}
          >
            <div className="space-y-1.5 text-[11px] ct-num">
              <div className="h-2 w-full rounded-full bg-[#EAE4D5] overflow-hidden flex">
                {analytics.qbSentiment.total > 0 && (
                  <>
                    <div
                      className="h-full bg-[#006BB8]"
                      style={{ width: `${analytics.qbSentiment.positivePct ?? 0}%` }}
                      title={`4–5 Pos: ${analytics.qbSentiment.positiveCount}`}
                    />
                    <div
                      className="h-full bg-[#94A3B8]"
                      style={{ width: `${analytics.qbSentiment.neutralPct ?? 0}%` }}
                      title={`3 Neu: ${analytics.qbSentiment.neutralCount}`}
                    />
                    <div
                      className="h-full bg-[#BE123C]"
                      style={{ width: `${analytics.qbSentiment.negativePct ?? 0}%` }}
                      title={`1–2 Neg: ${analytics.qbSentiment.negativeCount}`}
                    />
                  </>
                )}
              </div>
              <div className="flex justify-between text-[#33475B]">
                <span>Pos {formatPct1(analytics.qbSentiment.positivePct)}</span>
                <span>Miss {analytics.totalMissingResponsesQB.toLocaleString()}</span>
              </div>
            </div>
          </RadialGaugeCard>

          {/* 3. Teacher NPS Gauge & Mix */}
          <RadialGaugeCard
            label="Teacher NPS"
            subtitle="Net Promoter (-100 to +100)"
            displayValue={npsDisplay}
            fillFraction={
              analytics.teacherNpsAverage !== null
                ? Math.max(0, Math.min(1, (analytics.teacherNpsAverage + 100) / 200))
                : null
            }
            strokeColor="#047857"
            trackColor="#EAE4D5"
            responsesText={`${totalTeachers.toLocaleString()} educator responses`}
            comparison={hasTrendData ? comparisons.teacherNps : undefined}
          >
            <div className="grid grid-cols-3 gap-1 text-center text-[10px] ct-num">
              <div className="py-1 px-1 rounded bg-[#ECFDF5] border border-[#047857]/25 text-[#047857]">
                P: {analytics.npsDistribution.promoter}
              </div>
              <div className="py-1 px-1 rounded bg-[#FFFBEB] border border-[#B45309]/25 text-[#92400E]">
                N: {analytics.npsDistribution.passive}
              </div>
              <div className="py-1 px-1 rounded bg-[#FFF1F2] border border-[#BE123C]/25 text-[#BE123C]">
                D: {analytics.npsDistribution.detractor}
              </div>
            </div>
          </RadialGaugeCard>
        </div>

        {/* Multi-month feedback progression only rendered when >=2 valid months exist */}
        {hasTrendData && (
          <div className="pt-3 border-t border-[#E5DFD2]">
            <div className="text-[11px] font-medium text-[#33475B] mb-2">
              Monthly Feedback Score Progression
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-6 gap-2 text-xs ct-num">
              {validMonths.map((m) => (
                <div
                  key={m.monthKey}
                  className="px-2.5 py-2 rounded-lg bg-[#FAF8F2] border border-[#E5DFD2]"
                >
                  <div className="text-[11px] font-medium text-[#0A1B2C]">
                    {m.monthLabel.slice(0, 3)} &apos;{m.monthKey.slice(2, 4)}
                  </div>
                  <div className="text-[11px] text-[#33475B] mt-0.5 space-y-0.5">
                    <div>CSAT: {formatScore2(m.averageCsat)}</div>
                    <div>ITP: {formatScore2(m.averageItp)}</div>
                    <div>
                      NPS:{' '}
                      {m.teacherNpsAverage !== null
                        ? m.teacherNpsAverage > 0
                          ? `+${m.teacherNpsAverage}`
                          : m.teacherNpsAverage
                        : '—'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  },
);
FeedbackSatisfactionSection.displayName = 'FeedbackSatisfactionSection';

/* -------------------------------------------------------------------------- */
/* Programme Insights (Smart Executive Band)                                  */
/* -------------------------------------------------------------------------- */

const INSIGHT_ICONS = {
  'top-district': MapPin,
  'top-tour': Compass,
  'top-grade': GraduationCap,
  'monthly-trend': TrendingUp,
  'coverage-attention': BookOpen,
} as const;

export const ProgrammeInsightsPanel: React.FC<{ report: ProgrammeInsightsReport }> = React.memo(
  ({ report }) => {
    const titleId = useId();
    return (
      <section
        aria-labelledby={titleId}
        className="rounded-2xl bg-[#FFFBF5] border border-[#F3DFC1] p-5 space-y-3.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span
              className="w-8 h-8 rounded-lg bg-[#FFF2DF] border border-[#FDBA74] text-[#C2410C] inline-flex items-center justify-center shrink-0"
              aria-hidden="true"
            >
              <Lightbulb className="w-4 h-4" />
            </span>
            <div>
              <h3 id={titleId} className="text-[15px] font-medium text-[#0A1B2C] leading-snug">
                Programme Insights
              </h3>
              <p className="text-xs text-[#33475B]">
                Automatically derived from active filtered session records
              </p>
            </div>
          </div>

          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#FFFFFF] border border-[#F3DFC1] text-[11px] font-medium text-[#9A3412]">
            <Sparkles className="w-3 h-3" aria-hidden="true" />
            {report.hasData ? 'Live calculation' : 'Awaiting submissions'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {report.items.map((item) => {
            const Icon = INSIGHT_ICONS[item.id];
            const surfaceClass =
              item.tone === 'attention'
                ? 'bg-[#FFFBEB] border-[#FCD34D]'
                : item.tone === 'positive'
                  ? 'bg-[#FFFFFF] border-[#E5DFD2]'
                  : 'bg-[#FFFFFF] border-[#E5DFD2]';

            return (
              <div
                key={item.id}
                className={`p-3.5 rounded-xl border ${surfaceClass} flex flex-col justify-between gap-2`}
              >
                <div className="flex items-center gap-2">
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      item.tone === 'attention'
                        ? 'text-[#B45309]'
                        : item.tone === 'empty'
                          ? 'text-[#8E8674]'
                          : 'text-[#C2410C]'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="text-[11px] font-medium text-[#33475B]">{item.title}</span>
                </div>

                <div>
                  <div className="text-[13px] font-medium text-[#0A1B2C] leading-snug break-words ct-num">
                    {item.headline}
                  </div>
                  <p className="text-[11px] text-[#33475B] mt-1 leading-relaxed ct-num">
                    {item.detail}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  },
);
ProgrammeInsightsPanel.displayName = 'ProgrammeInsightsPanel';

export const KPI_ICON_MAP = {
  sessions: BarChart2,
  students: Users,
  schools: Award,
  facilitators: HeartHandshake,
  csat: Star,
  itp: Sparkles,
  nps: Award,
} as const;

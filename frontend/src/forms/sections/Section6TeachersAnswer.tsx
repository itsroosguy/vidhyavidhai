import React, { useState } from 'react';
import { Award, CheckCircle2, ChevronDown, ChevronRight, MinusCircle, ThumbsDown, ThumbsUp } from 'lucide-react';
import {
  TEACHER_NPS_GROUPS,
  TEACHER_NPS_HELPER,
  TEACHER_NPS_QUESTION,
} from '../../config/defaults';
import type { SessionMetricsSummary, TeacherNpsGroup } from '../../types/domain';

interface Section6Props {
  teacherNpsGroup: TeacherNpsGroup | '';
  teacherExactScore: string;
  metrics: SessionMetricsSummary;
  isComplete?: boolean;
  errorMap: Record<string, string>;
  onSelectGroup: (group: TeacherNpsGroup | '') => void;
  onSelectExactScore: (scoreStr: string) => void;
}

const NPS_TIER_CARDS: Array<{
  group: TeacherNpsGroup;
  title: string;
  range: string;
  npsValue: string;
  icon: typeof ThumbsUp;
  activeClass: string;
  iconColor: string;
}> = [
  {
    group: 'promoter',
    title: 'Promoter',
    range: '9–10 out of 10',
    npsValue: '+100 NPS',
    icon: ThumbsUp,
    activeClass: 'bg-[#ECFDF5] border-[#047857]',
    iconColor: 'text-[#047857]',
  },
  {
    group: 'passive',
    title: 'Passive',
    range: '7–8 out of 10',
    npsValue: '0 NPS',
    icon: MinusCircle,
    activeClass: 'bg-[#FFFBEB] border-[#B45309]',
    iconColor: 'text-[#B45309]',
  },
  {
    group: 'detractor',
    title: 'Detractor',
    range: '0–6 out of 10',
    npsValue: '-100 NPS',
    icon: ThumbsDown,
    activeClass: 'bg-[#FFF1F2] border-[#BE123C]',
    iconColor: 'text-[#BE123C]',
  },
];

export const Section6TeachersAnswer: React.FC<Section6Props> = ({
  teacherNpsGroup,
  teacherExactScore,
  metrics,
  isComplete = false,
  errorMap,
  onSelectGroup,
  onSelectExactScore,
}) => {
  const [showExactScores, setShowExactScores] = useState(Boolean(teacherExactScore));
  const errMsg = errorMap.teacherNpsGroup || errorMap.teacherExactScore;

  const handleGroupPick = (nextGroup: TeacherNpsGroup | '') => {
    onSelectGroup(nextGroup);
    if (teacherExactScore) {
      const n = Number.parseInt(teacherExactScore, 10);
      const actual = n >= 9 ? 'promoter' : n >= 7 ? 'passive' : 'detractor';
      if (actual !== nextGroup) {
        onSelectExactScore('');
      }
    }
  };

  return (
    <section
      id="section-6"
      tabIndex={-1}
      aria-labelledby="sec6-heading"
      data-complete={isComplete ? 'true' : 'false'}
      className="ct-form-section p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3.5">
          <span
            className={`ct-section-icon ${isComplete ? 'ct-section-icon--complete' : ''}`}
            aria-hidden="true"
          >
            <Award className="w-4 h-4" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="sec6-heading" className="text-lg sm:text-[1.125rem] font-medium text-[#0A1B2C]">
                Teacher's answer
              </h2>
              {isComplete && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#ECFDF5] border border-[#047857]/35 text-[#047857]">
                  <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                  Ready
                </span>
              )}
            </div>
            <p className="text-xs text-[#243647] mt-0.5">
              Classroom teacher Net Promoter Score (NPS) classification
            </p>
          </div>
        </div>
      </div>

      <p className="text-sm sm:text-[15px] font-medium text-[#0A1B2C] leading-relaxed">
        Ask the teachers who sat in: "{TEACHER_NPS_QUESTION}"
      </p>
      <p className="mt-1 text-xs sm:text-sm text-[#243647] leading-relaxed mb-4">
        {TEACHER_NPS_HELPER}
      </p>

      <div className="ct-bento-well p-4 flex flex-col gap-3.5">
        {/* Visual Quick-Tier Cards synced cleanly with the dropdown */}
        <div className="ct-tier-grid-3">
          {NPS_TIER_CARDS.map((card) => {
            const active = teacherNpsGroup === card.group;
            const Icon = card.icon;
            return (
              <button
                key={card.group}
                type="button"
                aria-pressed={active}
                onClick={() => handleGroupPick(card.group)}
                className={`ct-interactive-tile h-full text-left rounded-xl p-3 border transition-colors cursor-pointer flex flex-col justify-between gap-1.5 ${
                  active
                    ? card.activeClass
                    : 'bg-[#FFFFFF] border-[#8E8674] hover:border-[#0284C7]'
                }`}
              >
                <div className="w-full flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <Icon className={`w-4 h-4 shrink-0 ${card.iconColor}`} aria-hidden="true" />
                    <span className="text-sm font-medium text-[#0A1B2C] truncate">{card.title}</span>
                  </span>
                  <span className={`text-[11px] font-medium ct-num whitespace-nowrap shrink-0 ${card.iconColor}`}>
                    {card.npsValue}
                  </span>
                </div>
                <div className="text-[11px] text-[#243647] ct-num whitespace-nowrap pl-6">
                  {card.range}
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="teacherNpsGroup" className="text-sm font-medium text-[#0A1B2C]">
            Teacher's{' '}
            <span className="whitespace-nowrap">
              score
              <span className="ml-1 text-[#006BB8]" aria-hidden="true">
                *
              </span>
            </span>
          </label>
          <select
            id="teacherNpsGroup"
            name="teacherNpsGroup"
            required={!teacherExactScore}
            value={teacherNpsGroup}
            onChange={(e) => handleGroupPick(e.target.value as TeacherNpsGroup | '')}
            aria-invalid={Boolean(errMsg)}
            aria-describedby={errMsg ? 'teacherNps-error' : undefined}
            data-error="teacherNps-error"
            className="ct-input ct-select"
          >
            <option value="">Choose...</option>
            {TEACHER_NPS_GROUPS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <button
            type="button"
            aria-expanded={showExactScores}
            onClick={() => setShowExactScores((prev) => !prev)}
            className="inline-flex items-center gap-1 text-xs font-medium text-[#243647] hover:text-[#006BB8] cursor-pointer transition-colors"
          >
            {showExactScores ? (
              <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            Record exact 0–10 score (optional)
          </button>

          {showExactScores && (
            <div className="mt-2.5 flex flex-wrap gap-1.5" role="group" aria-label="Exact teacher score 0 to 10">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
                const isSelected = teacherExactScore === String(num);
                const group: TeacherNpsGroup =
                  num >= 9 ? 'promoter' : num >= 7 ? 'passive' : 'detractor';
                return (
                  <button
                    key={num}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => {
                      if (isSelected) {
                        onSelectExactScore('');
                      } else {
                        onSelectExactScore(String(num));
                        onSelectGroup(group);
                      }
                    }}
                    className={`ct-interactive-tile min-w-[40px] min-h-[40px] px-2 rounded-lg text-sm font-medium ct-num border transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#1EA7FF] text-[#0A1B2C] border-[#0284C7]'
                        : 'bg-[#FFFFFF] text-[#0A1B2C] border-[#8E8674] hover:bg-[#F5F2E9]'
                    }`}
                  >
                    {num}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {metrics.teacherClassification !== null && metrics.teacherNps !== null && (
          <div className="px-3.5 py-2.5 rounded-lg bg-[#FFFFFF] border border-[#DFD7C2] flex flex-wrap items-center gap-4 text-xs text-[#243647] ct-num">
            <span>
              Classification:{' '}
              <strong className="font-medium text-[#006BB8]">{metrics.teacherClassification}</strong>
            </span>
            {metrics.teacherScoreExact !== null && (
              <span>
                Exact score:{' '}
                <strong className="font-medium text-[#0A1B2C]">
                  {metrics.teacherScoreExact} / 10
                </strong>
              </span>
            )}
            <span>
              Teacher NPS:{' '}
              <strong className="font-medium text-[#0A1B2C]">
                {metrics.teacherNps > 0 ? '+100' : metrics.teacherNps}
              </strong>
            </span>
          </div>
        )}

        {errMsg && (
          <p id="teacherNps-error" className="text-xs text-[#BE123C] font-medium">
            {errMsg}
          </p>
        )}
      </div>
    </section>
  );
};

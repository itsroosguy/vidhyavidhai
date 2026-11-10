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
              <h2 id="sec6-heading" className="text-lg sm:text-[1.125rem] font-medium text-[#0F172A]">
                Teacher's answer
              </h2>
              {isComplete && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#ECFDF5] border border-[#047857]/35 text-[#047857]">
                  <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                  Ready
                </span>
              )}
            </div>
            <p className="text-xs text-[#475569] mt-0.5">
              Classroom teacher Net Promoter Score (NPS) classification
            </p>
          </div>
        </div>
      </div>

      <p className="text-sm sm:text-[15px] font-medium text-[#0F172A] leading-relaxed">
        Ask the teachers who sat in: "{TEACHER_NPS_QUESTION}"
      </p>
      <p className="mt-1 text-xs sm:text-sm text-[#475569] leading-relaxed mb-4">
        {TEACHER_NPS_HELPER}
      </p>

      <div className="ct-bento-well p-4 flex flex-col gap-3.5">
        {/* Visual Quick-Tier Cards synced cleanly with the dropdown */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {NPS_TIER_CARDS.map((card) => {
            const active = teacherNpsGroup === card.group;
            const Icon = card.icon;
            return (
              <button
                key={card.group}
                type="button"
                aria-pressed={active}
                onClick={() => handleGroupPick(card.group)}
                className={`ct-interactive-tile text-left rounded-xl p-3 border transition-colors cursor-pointer flex items-center justify-between gap-2 ${
                  active
                    ? card.activeClass
                    : 'bg-[#FFFFFF] border-[#CBD5E1] hover:border-[#0F766E]/55'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className={`w-4 h-4 shrink-0 ${card.iconColor}`} aria-hidden="true" />
                  <div>
                    <div className="text-sm font-medium text-[#0F172A]">{card.title}</div>
                    <div className="text-[11px] text-[#475569] ct-num">{card.range}</div>
                  </div>
                </div>
                <span className={`text-[11px] font-medium ct-num ${card.iconColor}`}>
                  {card.npsValue}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="teacherNpsGroup" className="text-sm font-medium text-[#0F172A]">
            Teacher's score
            <span className="ml-1 text-[#0F766E]" aria-hidden="true">
              *
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
            className="inline-flex items-center gap-1 text-xs font-medium text-[#475569] hover:text-[#0F766E] cursor-pointer transition-colors"
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
                        ? 'bg-[#0F766E] text-[#FFFFFF] border-[#0F766E]'
                        : 'bg-[#FFFFFF] text-[#0F172A] border-[#CBD5E1] hover:bg-[#F1F5F9]'
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
          <div className="px-3.5 py-2.5 rounded-lg bg-[#FFFFFF] border border-[#E2E8F0] flex flex-wrap items-center gap-4 text-xs text-[#475569] ct-num">
            <span>
              Classification:{' '}
              <strong className="font-medium text-[#0F766E]">{metrics.teacherClassification}</strong>
            </span>
            {metrics.teacherScoreExact !== null && (
              <span>
                Exact score:{' '}
                <strong className="font-medium text-[#0F172A]">
                  {metrics.teacherScoreExact} / 10
                </strong>
              </span>
            )}
            <span>
              Teacher NPS:{' '}
              <strong className="font-medium text-[#0F172A]">
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

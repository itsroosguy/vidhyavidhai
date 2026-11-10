import React from 'react';
import { AlertCircle, ArrowUpRight } from 'lucide-react';
import type { ValidationIssue } from '../../types/domain';
import { GlassModal } from './GlassModal';

interface ValidationErrorModalProps {
  open: boolean;
  errors: ValidationIssue[];
  onClose: () => void;
  onJumpToIssue: (issue: ValidationIssue) => void;
}

const SECTION_LABELS: Record<number, string> = {
  1: 'Section 1 · About you',
  2: 'Section 2 · About the session',
  3: 'Section 3 · About the school',
  4: 'Section 4 · About the class',
  5: "Section 5 · Students' answers",
  6: "Section 6 · Teacher's answer",
  7: 'Section 7 · Review & results',
};

export const ValidationErrorModal: React.FC<ValidationErrorModalProps> = ({
  open,
  errors,
  onClose,
  onJumpToIssue,
}) => {
  const grouped = new Map<number, ValidationIssue[]>();
  for (const err of errors) {
    const arr = grouped.get(err.section) ?? [];
    arr.push(err);
    grouped.set(err.section, arr);
  }

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      size="md"
      eyebrow="Action Required"
      title={`Please resolve ${errors.length} required ${errors.length === 1 ? 'field' : 'fields'}`}
      subtitle="Review the highlighted items below before continuing to the submission summary."
      headerBadge={
        <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#E77B83]/15 border border-[#E77B83]/45 text-[#E77B83] ct-num">
          {errors.length} {errors.length === 1 ? 'issue' : 'issues'}
        </span>
      }
      footer={
        <button type="button" onClick={onClose} className="ct-btn-primary text-sm">
          Return to form
        </button>
      }
    >
      <div role="alert" className="space-y-3">
        {Array.from(grouped.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([sectionNum, issues]) => (
            <div
              key={sectionNum}
              className="rounded-xl bg-[#0C1931] border border-[#26456F] p-3.5 space-y-2.5"
            >
              <div className="text-xs font-medium text-[#E8EFFC] flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-[#E77B83] shrink-0" aria-hidden="true" />
                <span>{SECTION_LABELS[sectionNum] ?? `Section ${sectionNum}`}</span>
              </div>

              <ul className="space-y-2">
                {issues.map((issue, idx) => (
                  <li
                    key={`${issue.code}-${idx}`}
                    className="flex items-start justify-between gap-3 text-xs sm:text-sm text-[#E8EFFC] pl-6"
                  >
                    <span className="leading-relaxed">{issue.message}</span>
                    <button
                      type="button"
                      onClick={() => onJumpToIssue(issue)}
                      className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-[#162D55] hover:bg-[#172B4D] border border-[#26456F] text-[#4EBBBB] cursor-pointer transition-colors"
                    >
                      Jump
                      <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </div>
    </GlassModal>
  );
};

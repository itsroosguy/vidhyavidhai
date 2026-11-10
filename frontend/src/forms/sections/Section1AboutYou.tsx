import React from 'react';
import { CheckCircle2, Mail, UserRound } from 'lucide-react';
import type { UserProfile } from '../../types/domain';

interface Section1Props {
  facilitatorName: string;
  facilitatorEmail: string;
  user: UserProfile;
  isAdminEditingOther: boolean;
  isComplete?: boolean;
  errorMap: Record<string, string>;
  onChangeName: (val: string) => void;
}

export const Section1AboutYou: React.FC<Section1Props> = ({
  facilitatorName,
  facilitatorEmail,
  isAdminEditingOther,
  isComplete = false,
  errorMap,
  onChangeName,
}) => {
  const initials = facilitatorName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <section
      id="section-1"
      tabIndex={-1}
      aria-labelledby="sec1-heading"
      data-complete={isComplete ? 'true' : 'false'}
      className="ct-form-section p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="flex items-start gap-3.5">
          <span
            className={`ct-section-icon ${isComplete ? 'ct-section-icon--complete' : ''}`}
            aria-hidden="true"
          >
            <UserRound className="w-4 h-4" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="sec1-heading" className="text-lg sm:text-[1.125rem] font-medium text-[#0F172A]">
                About you
              </h2>
              {isComplete && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#ECFDF5] border border-[#047857]/35 text-[#047857]">
                  <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                  Ready
                </span>
              )}
            </div>
            <p className="text-xs text-[#475569] mt-0.5">
              Facilitator identity linked to this session record
            </p>
          </div>
        </div>

        <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full bg-[#F8FAFC] border border-[#CBD5E1] text-[#475569]">
          <Mail className="w-3.5 h-3.5 text-[#0F766E]" aria-hidden="true" />
          {isAdminEditingOther ? (
            <>
              Owner preserved: <strong className="font-medium text-[#0F172A]">{facilitatorEmail}</strong>
            </>
          ) : (
            <span className="text-[#0F172A]">{facilitatorEmail}</span>
          )}
        </span>
      </div>

      <div className="ct-bento-well p-4 flex items-start sm:items-center gap-3.5">
        <div
          aria-hidden="true"
          className="hidden sm:flex w-11 h-11 rounded-2xl bg-[#E6F6F4] border border-[#0F766E]/25 items-center justify-center text-sm font-medium text-[#0F766E] shrink-0 mt-5"
        >
          {initials || <UserRound className="w-4 h-4 text-[#526077]" />}
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          <label htmlFor="facilitatorName" className="text-sm font-medium text-[#0F172A]">
            Your name
            <span className="ml-1 text-[#0F766E]" aria-hidden="true">
              *
            </span>
          </label>
          <input
            id="facilitatorName"
            name="facilitatorName"
            type="text"
            required
            autoComplete="name"
            placeholder="e.g. Priya S"
            value={facilitatorName}
            onChange={(e) => onChangeName(e.target.value)}
            aria-invalid={Boolean(errorMap.facilitatorName)}
            aria-describedby={errorMap.facilitatorName ? 'facilitatorName-error' : undefined}
            data-error="facilitatorName-error"
            className="ct-input"
          />
          {errorMap.facilitatorName && (
            <p id="facilitatorName-error" className="text-xs text-[#BE123C] font-medium">
              {errorMap.facilitatorName}
            </p>
          )}
        </div>
      </div>
    </section>
  );
};

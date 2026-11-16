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
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
        <div className="flex items-start gap-3.5 min-w-0 flex-1">
          <span
            className={`ct-section-icon ${isComplete ? 'ct-section-icon--complete' : ''}`}
            aria-hidden="true"
          >
            <UserRound className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="sec1-heading" className="text-lg sm:text-[1.125rem] font-medium text-[#0A1B2C]">
                About you
              </h2>
              {isComplete && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#ECFDF5] border border-[#047857]/35 text-[#047857]">
                  <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                  Ready
                </span>
              )}
            </div>
            <p className="text-xs text-[#243647] mt-0.5">
              Facilitator identity linked to this session record
            </p>
          </div>
        </div>

        <span className="self-start shrink-0 max-w-full inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full bg-[#0A1B2C] border border-[#0A1B2C] text-[#FAF8F2]">
          <Mail className="w-3.5 h-3.5 text-[#1EA7FF] shrink-0" aria-hidden="true" />
          {isAdminEditingOther ? (
            <span className="truncate">
              Owner preserved: <strong className="font-medium text-[#FFFFFF]">{facilitatorEmail}</strong>
            </span>
          ) : (
            <span className="text-[#FAF8F2] truncate">{facilitatorEmail}</span>
          )}
        </span>
      </div>

      <div className="ct-bento-well p-4">
        <div className="grid grid-cols-1 sm:grid-cols-[2.75rem_minmax(0,1fr)] gap-x-3.5 gap-y-1.5 items-center">
          <label
            htmlFor="facilitatorName"
            className="sm:col-start-2 text-sm font-medium text-[#0A1B2C]"
          >
            Your{' '}
            <span className="whitespace-nowrap">
              name
              <span className="ml-1 text-[#006BB8]" aria-hidden="true">
                *
              </span>
            </span>
          </label>

          <div
            aria-hidden="true"
            className="hidden sm:flex sm:col-start-1 sm:row-start-2 w-11 h-11 rounded-2xl bg-[#0A1B2C] border border-[#0A1B2C] items-center justify-center text-sm font-medium text-[#FAF8F2] shrink-0"
          >
            {initials || <UserRound className="w-4 h-4 text-[#1EA7FF]" />}
          </div>

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
            className="ct-input sm:col-start-2 sm:row-start-2"
          />

          {errorMap.facilitatorName && (
            <p
              id="facilitatorName-error"
              className="sm:col-start-2 sm:row-start-3 text-xs text-[#BE123C] font-medium"
            >
              {errorMap.facilitatorName}
            </p>
          )}
        </div>
      </div>
    </section>
  );
};

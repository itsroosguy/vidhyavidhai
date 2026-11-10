import React from 'react';
import { Calendar, CheckCircle2, Clapperboard, Clock, Globe } from 'lucide-react';
import type { AppConfiguration, SessionFormValues } from '../../types/domain';
import { resolveConfiguredVideoId } from '../../utils/sessionId';
import {
  calculateSessionDurationMinutes,
  formatDurationHuman,
  formatISODateToDDMMYYYY,
  getMonthNameFromISO,
  getTodayKolkataISO,
} from '../../utils/temporal';
import { AnalogueTimePicker } from '../../components/ui/AnalogueTimePicker';

interface Section2Props {
  values: SessionFormValues;
  config: AppConfiguration;
  isComplete?: boolean;
  errorMap: Record<string, string>;
  onUpdate: <K extends keyof SessionFormValues>(field: K, value: SessionFormValues[K]) => void;
}

export const Section2AboutSession: React.FC<Section2Props> = ({
  values,
  config,
  isComplete = false,
  errorMap,
  onUpdate,
}) => {
  const todayIso = getTodayKolkataISO(config.programmeTimezone);
  const reportingMonth = getMonthNameFromISO(values.startDate) || '—';
  const submissionDateFormatted = formatISODateToDDMMYYYY(todayIso);
  const activeTours = config.tours.filter((t) => t.active);
  const selectedTour = config.tours.find((t) => t.tourId === values.tourId);
  const videoInfo = resolveConfiguredVideoId(selectedTour, values.language, config);
  const durationMins = calculateSessionDurationMinutes(
    values.startDate,
    values.startTime,
    values.endDate,
    values.endTime,
    config.programmeTimezone,
  );

  return (
    <section
      id="section-2"
      tabIndex={-1}
      aria-labelledby="sec2-heading"
      data-complete={isComplete ? 'true' : 'false'}
      className="ct-form-section p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="flex items-start gap-3.5">
          <span
            className={`ct-section-icon ${isComplete ? 'ct-section-icon--complete' : ''}`}
            aria-hidden="true"
          >
            <Clapperboard className="w-4 h-4" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="sec2-heading" className="text-lg sm:text-[1.125rem] font-medium text-[#0F172A]">
                About the session
              </h2>
              {isComplete && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#ECFDF5] border border-[#047857]/35 text-[#047857]">
                  <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                  Ready
                </span>
              )}
            </div>
            <p className="text-xs text-[#475569] mt-0.5">
              Career Tour video played, language shown, dates, and exact timings
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs ct-num">
          {durationMins !== null && durationMins > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#E6F6F4] border border-[#0F766E]/35 text-[#0F766E] font-medium">
              <Clock className="w-3.5 h-3.5" aria-hidden="true" />
              {formatDurationHuman(durationMins)}
            </span>
          )}
          {selectedTour && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#F8FAFC] border border-[#CBD5E1] text-[#475569]">
              <Globe className="w-3.5 h-3.5 text-[#0F766E]" aria-hidden="true" />
              {videoInfo.isConfigured ? videoInfo.videoId : 'Select language'}
            </span>
          )}
        </div>
      </div>

      {/* Bento Well 1 — Media & Auto Metadata */}
      <div className="ct-bento-well p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-start mb-4">
        {/* Career Tour / Video */}
        <div className="flex flex-col gap-1.5 lg:col-span-2">
          <label htmlFor="tourId" className="text-sm font-medium text-[#0F172A]">
            Which video did you show?
            <span className="ml-1 text-[#0F766E]" aria-hidden="true">
              *
            </span>
          </label>
          <select
            id="tourId"
            name="tourId"
            required
            value={values.tourId}
            onChange={(e) => onUpdate('tourId', e.target.value)}
            aria-invalid={Boolean(errorMap.tourId)}
            aria-describedby={errorMap.tourId ? 'tourId-error' : undefined}
            data-error="tourId-error"
            className="ct-input ct-select"
          >
            <option value="">Choose...</option>
            {activeTours.map((tour) => (
              <option key={tour.tourId} value={tour.tourId}>
                {tour.tourName}
              </option>
            ))}
          </select>
          {errorMap.tourId && (
            <p id="tourId-error" className="text-xs text-[#BE123C] font-medium">
              {errorMap.tourId}
            </p>
          )}
        </div>

        {/* Language */}
        <div className="flex flex-col gap-1.5 lg:col-span-2">
          <label htmlFor="language" className="text-sm font-medium text-[#0F172A]">
            In which language?
            <span className="ml-1 text-[#0F766E]" aria-hidden="true">
              *
            </span>
          </label>
          <select
            id="language"
            name="language"
            required
            value={values.language}
            onChange={(e) => onUpdate('language', e.target.value)}
            aria-invalid={Boolean(errorMap.language)}
            aria-describedby={errorMap.language ? 'language-error' : undefined}
            data-error="language-error"
            className="ct-input ct-select"
          >
            <option value="">Choose...</option>
            {config.languageOptions.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
          {errorMap.language && (
            <p id="language-error" className="text-xs text-[#BE123C] font-medium">
              {errorMap.language}
            </p>
          )}
        </div>

        {/* Month (auto-filled) */}
        <div className="flex flex-col gap-1.5 lg:col-span-2">
          <label htmlFor="reportingMonth" className="text-sm font-medium text-[#0F172A]">
            Month
          </label>
          <input
            id="reportingMonth"
            type="text"
            readOnly
            value={reportingMonth}
            aria-describedby="reportingMonth-hint"
            className="ct-input"
          />
          <p id="reportingMonth-hint" className="text-xs text-[#526077]">
            Filled from the start date.
          </p>
        </div>

        {/* Date of submission */}
        <div className="flex flex-col gap-1.5 lg:col-span-2">
          <label htmlFor="submissionDate" className="text-sm font-medium text-[#0F172A]">
            Date of submission
          </label>
          <input
            id="submissionDate"
            type="text"
            readOnly
            value={submissionDateFormatted}
            aria-describedby="submissionDate-hint"
            className="ct-input ct-num"
          />
          <p id="submissionDate-hint" className="text-xs text-[#526077]">
            Today's date, filled automatically.
          </p>
        </div>
      </div>

      {/* Bento Well 2 — Connected Start -> Duration Bridge -> End Timeline */}
      <div className="ct-bento-well p-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-4 items-center">
        {/* Start Node */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="startDate" className="text-sm font-medium text-[#0F172A]">
              Date the session started
              <span className="ml-1 text-[#0F766E]" aria-hidden="true">
                *
              </span>
            </label>
            <input
              id="startDate"
              name="startDate"
              type="date"
              required
              max={todayIso}
              value={values.startDate}
              onChange={(e) => onUpdate('startDate', e.target.value)}
              aria-invalid={Boolean(errorMap.startDate)}
              aria-describedby={errorMap.startDate ? 'startDate-error' : undefined}
              data-error="startDate-error"
              className="ct-input ct-num"
            />
            {errorMap.startDate && (
              <p id="startDate-error" className="text-xs text-[#BE123C] font-medium">
                {errorMap.startDate}
              </p>
            )}
          </div>

          <AnalogueTimePicker
            id="startTime"
            label="What time did it start?"
            value={values.startTime}
            onChange={(t) => onUpdate('startTime', t)}
            required
            errorMessage={errorMap.startTime}
          />
        </div>

        {/* Center Timeline Duration Bridge */}
        <div className="flex flex-col items-center justify-center gap-1.5 px-2 py-2 lg:py-0">
          <span className="text-[11px] font-medium text-[#526077] text-center">
            Calculated session length
          </span>
          <div className="w-full lg:w-auto flex items-center justify-center gap-2">
            <span className="hidden lg:block w-5 h-px bg-[#CBD5E1]" aria-hidden="true" />
            <div
              className={`min-h-[40px] px-3.5 py-2 rounded-full border flex items-center gap-2 text-xs sm:text-sm ct-num transition-colors ${
                durationMins && durationMins > 0
                  ? 'bg-[#E6F6F4] border-[#0F766E]/45 text-[#0F172A] font-medium'
                  : 'bg-[#FFFFFF] border-[#CBD5E1] text-[#526077]'
              }`}
            >
              <Calendar className="w-4 h-4 text-[#0F766E] shrink-0" aria-hidden="true" />
              <span>
                {durationMins && durationMins > 0
                  ? formatDurationHuman(durationMins)
                  : 'Select start & end time'}
              </span>
            </div>
            <span className="hidden lg:block w-5 h-px bg-[#CBD5E1]" aria-hidden="true" />
          </div>
        </div>

        {/* End Node */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="endDate" className="text-sm font-medium text-[#0F172A]">
              Date the session ended
              <span className="ml-1 text-[#0F766E]" aria-hidden="true">
                *
              </span>
            </label>
            <input
              id="endDate"
              name="endDate"
              type="date"
              required
              min={values.startDate || undefined}
              max={todayIso}
              value={values.endDate}
              onChange={(e) => onUpdate('endDate', e.target.value)}
              aria-invalid={Boolean(errorMap.endDate)}
              aria-describedby={errorMap.endDate ? 'endDate-error' : undefined}
              data-error="endDate-error"
              className="ct-input ct-num"
            />
            {errorMap.endDate && (
              <p id="endDate-error" className="text-xs text-[#BE123C] font-medium">
                {errorMap.endDate}
              </p>
            )}
          </div>

          <AnalogueTimePicker
            id="endTime"
            label="What time did it end?"
            value={values.endTime}
            onChange={(t) => onUpdate('endTime', t)}
            required
            errorMessage={errorMap.endTime}
          />
        </div>
      </div>
    </section>
  );
};

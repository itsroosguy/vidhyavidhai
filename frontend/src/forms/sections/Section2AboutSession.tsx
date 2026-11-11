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
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
        <div className="flex items-start gap-3.5 min-w-0 flex-1">
          <span
            className={`ct-section-icon ${isComplete ? 'ct-section-icon--complete' : ''}`}
            aria-hidden="true"
          >
            <Clapperboard className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="sec2-heading" className="text-lg sm:text-[1.125rem] font-medium text-[#0A1B2C]">
                About the session
              </h2>
              {isComplete && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#ECFDF5] border border-[#047857]/35 text-[#047857]">
                  <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                  Ready
                </span>
              )}
            </div>
            <p className="text-xs text-[#243647] mt-0.5">
              Career Tour video played, language shown, dates, and exact timings
            </p>
          </div>
        </div>

        <div className="flex flex-wrap sm:justify-end items-center gap-2 text-xs ct-num shrink-0">
          {durationMins !== null && durationMins > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#E8F6FF] border border-[#0284C7]/45 text-[#006BB8] font-medium whitespace-nowrap">
              <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              {formatDurationHuman(durationMins)}
            </span>
          )}
          {selectedTour && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#0A1B2C] border border-[#0A1B2C] text-[#FAF8F2] whitespace-nowrap">
              <Globe className="w-3.5 h-3.5 text-[#1EA7FF] shrink-0" aria-hidden="true" />
              {videoInfo.isConfigured ? videoInfo.videoId : 'Select language'}
            </span>
          )}
        </div>
      </div>

      {/* Bento Well 1 — Media & Auto Metadata */}
      <div className="ct-bento-well p-4 flex flex-col gap-4 mb-4">
        <div className="ct-field-grid-2">
          {/* Career Tour / Video */}
          <div className="ct-field-col">
            <div className="ct-field-label">
              <label htmlFor="tourId" className="text-sm font-medium text-[#0A1B2C]">
                Which video did you{' '}
                <span className="whitespace-nowrap">
                  show?
                  <span className="ml-1 text-[#006BB8]" aria-hidden="true">
                    *
                  </span>
                </span>
              </label>
            </div>
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
            <div className="ct-field-meta">
              {errorMap.tourId && (
                <p id="tourId-error" className="text-xs text-[#BE123C] font-medium">
                  {errorMap.tourId}
                </p>
              )}
            </div>
          </div>

          {/* Language */}
          <div className="ct-field-col">
            <div className="ct-field-label">
              <label htmlFor="language" className="text-sm font-medium text-[#0A1B2C]">
                In which{' '}
                <span className="whitespace-nowrap">
                  language?
                  <span className="ml-1 text-[#006BB8]" aria-hidden="true">
                    *
                  </span>
                </span>
              </label>
            </div>
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
            <div className="ct-field-meta">
              {errorMap.language && (
                <p id="language-error" className="text-xs text-[#BE123C] font-medium">
                  {errorMap.language}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="ct-field-grid-2">
          {/* Month (auto-filled) */}
          <div className="ct-field-col">
            <div className="ct-field-label">
              <label htmlFor="reportingMonth" className="text-sm font-medium text-[#0A1B2C]">
                Month
              </label>
            </div>
            <input
              id="reportingMonth"
              type="text"
              readOnly
              value={reportingMonth}
              aria-describedby="reportingMonth-hint"
              className="ct-input"
            />
            <div className="ct-field-meta">
              <p id="reportingMonth-hint" className="text-xs text-[#33475B]">
                Filled from the start date.
              </p>
            </div>
          </div>

          {/* Date of submission */}
          <div className="ct-field-col">
            <div className="ct-field-label">
              <label htmlFor="submissionDate" className="text-sm font-medium text-[#0A1B2C]">
                Date of submission
              </label>
            </div>
            <input
              id="submissionDate"
              type="text"
              readOnly
              value={submissionDateFormatted}
              aria-describedby="submissionDate-hint"
              className="ct-input ct-num"
            />
            <div className="ct-field-meta">
              <p id="submissionDate-hint" className="text-xs text-[#33475B]">
                Today's date, filled automatically.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Bento Well 2 — Subgrid-Locked Date Row + Time Row with Full-Width Calculated Duration */}
      <div className="ct-bento-well p-4 flex flex-col gap-4">
        <div className="ct-field-grid-2">
          {/* Date the session started */}
          <div className="ct-field-col">
            <div className="ct-field-label">
              <label htmlFor="startDate" className="text-sm font-medium text-[#0A1B2C]">
                Date the session{' '}
                <span className="whitespace-nowrap">
                  started
                  <span className="ml-1 text-[#006BB8]" aria-hidden="true">
                    *
                  </span>
                </span>
              </label>
            </div>
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
            <div className="ct-field-meta">
              {errorMap.startDate && (
                <p id="startDate-error" className="text-xs text-[#BE123C] font-medium">
                  {errorMap.startDate}
                </p>
              )}
            </div>
          </div>

          {/* Date the session ended */}
          <div className="ct-field-col">
            <div className="ct-field-label">
              <label htmlFor="endDate" className="text-sm font-medium text-[#0A1B2C]">
                Date the session{' '}
                <span className="whitespace-nowrap">
                  ended
                  <span className="ml-1 text-[#006BB8]" aria-hidden="true">
                    *
                  </span>
                </span>
              </label>
            </div>
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
            <div className="ct-field-meta">
              {errorMap.endDate && (
                <p id="endDate-error" className="text-xs text-[#BE123C] font-medium">
                  {errorMap.endDate}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="ct-field-grid-2">
          <AnalogueTimePicker
            id="startTime"
            label="What time did it start?"
            value={values.startTime}
            onChange={(t) => onUpdate('startTime', t)}
            required
            errorMessage={errorMap.startTime}
          />

          <AnalogueTimePicker
            id="endTime"
            label="What time did it end?"
            value={values.endTime}
            onChange={(t) => onUpdate('endTime', t)}
            required
            errorMessage={errorMap.endTime}
          />
        </div>

        {/* Full-Width Calculated Session Duration Footer */}
        <div className="pt-3 border-t border-[#DFD7C2] flex flex-wrap items-center justify-between gap-2.5">
          <span className="text-xs font-medium text-[#33475B]">
            Calculated session length
          </span>
          <div
            className={`min-h-[38px] px-3.5 py-1.5 rounded-full border inline-flex items-center gap-2 text-xs sm:text-sm ct-num transition-colors ${
              durationMins && durationMins > 0
                ? 'bg-[#E8F6FF] border-[#0284C7]/55 text-[#0A1B2C] font-medium'
                : 'bg-[#0A1B2C] border-[#0A1B2C] text-[#FAF8F2]'
            }`}
          >
            <Calendar
              className={`w-4 h-4 shrink-0 ${
                durationMins && durationMins > 0 ? 'text-[#006BB8]' : 'text-[#1EA7FF]'
              }`}
              aria-hidden="true"
            />
            <span>
              {durationMins && durationMins > 0
                ? formatDurationHuman(durationMins)
                : 'Select start & end time'}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};

import React, { useEffect, useId, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { formatTime24To12, from24HourTime, isValidTime24, to24HourTime } from '../../utils/temporal';

interface AnalogueTimePickerProps {
  id: string;
  label: string;
  value: string; // HH:MM (24-hour) or ''
  onChange: (newTime24: string) => void;
  required?: boolean;
  errorMessage?: string;
}

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

const DIAL_VIEWBOX = 220;
const DIAL_CENTER = DIAL_VIEWBOX / 2;
const NUMBER_RADIUS = 79;
const HAND_LINE_LENGTH = NUMBER_RADIUS - 16;
const HAND_TIP_RADIUS = NUMBER_RADIUS;

export const AnalogueTimePicker: React.FC<AnalogueTimePickerProps> = ({
  id,
  label,
  value,
  onChange,
  required,
  errorMessage,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [dialMode, setDialMode] = useState<'hour' | 'minute'>('hour');

  const parsed = from24HourTime(value);
  const [selectedHour12, setSelectedHour12] = useState<number>(parsed?.hour12 ?? 10);
  const [selectedMinute, setSelectedMinute] = useState<number>(parsed?.minute ?? 0);
  const [selectedPeriod, setSelectedPeriod] = useState<'AM' | 'PM'>(parsed?.period ?? 'AM');

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const keyboardInputId = `${id}-keyboard`;
  const errorId = `${id}-error`;
  const latestValueRef = useRef(value);
  latestValueRef.current = value;

  useEffect(() => {
    const next = from24HourTime(value);
    if (next) {
      setSelectedHour12(next.hour12);
      setSelectedMinute(next.minute);
      setSelectedPeriod(next.period);
    }
  }, [value]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const commitSelection = (h12: number, m: number, p: 'AM' | 'PM') => {
    const next24 = to24HourTime(h12, m, p);
    latestValueRef.current = next24;
    onChange(next24);
  };

  const handleOpenToggle = () => {
    if (!isOpen) {
      setDialMode('hour');
    }
    setIsOpen((prev) => !prev);
  };

  const handleHourPick = (h: number) => {
    setSelectedHour12(h);
    commitSelection(h, selectedMinute, selectedPeriod);
    setDialMode('minute');
  };

  const handleMinutePick = (m: number) => {
    setSelectedMinute(m);
    commitSelection(selectedHour12, m, selectedPeriod);
  };

  const handlePeriodChange = (p: 'AM' | 'PM') => {
    setSelectedPeriod(p);
    if (isValidTime24(value)) {
      commitSelection(selectedHour12, selectedMinute, p);
    }
  };

  const handleDone = () => {
    if (!isValidTime24(latestValueRef.current)) {
      commitSelection(selectedHour12, selectedMinute, selectedPeriod);
    }
    setIsOpen(false);
  };

  const activeAngleDeg =
    dialMode === 'hour'
      ? (selectedHour12 % 12) * 30 - 90
      : (selectedMinute / 5) * 30 - 90;

  const handRad = (activeAngleDeg * Math.PI) / 180;
  const handX = DIAL_CENTER + HAND_LINE_LENGTH * Math.cos(handRad);
  const handY = DIAL_CENTER + HAND_LINE_LENGTH * Math.sin(handRad);
  const handTipX = DIAL_CENTER + HAND_TIP_RADIUS * Math.cos(handRad);
  const handTipY = DIAL_CENTER + HAND_TIP_RADIUS * Math.sin(handRad);

  const hasValue = isValidTime24(value);
  const displayHourStr = hasValue ? String(selectedHour12).padStart(2, '0') : '--';
  const displayMinStr = hasValue ? String(selectedMinute).padStart(2, '0') : '--';

  return (
    <div ref={containerRef} className="flex flex-col gap-1.5 min-w-0">
      <label htmlFor={id} className="text-sm font-medium text-[#0A1B2C]">
        {label}
        {required && (
          <span className="ml-1 text-[#006BB8]" aria-hidden="true">
            *
          </span>
        )}
      </label>

      <button
        ref={triggerRef}
        type="button"
        id={id}
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-invalid={Boolean(errorMessage)}
        aria-describedby={errorMessage ? errorId : undefined}
        onClick={handleOpenToggle}
        className={`ct-input flex items-center justify-between gap-2 text-left cursor-pointer ${
          errorMessage ? 'border-[#BE123C]' : ''
        }`}
      >
        <span className={hasValue ? 'text-[#0A1B2C] font-medium ct-num truncate' : 'text-[#33475B] truncate'}>
          {hasValue ? formatTime24To12(value) : 'Choose time'}
        </span>
        <Clock className="w-4 h-4 text-[#33475B] shrink-0" aria-hidden="true" />
      </button>

      {errorMessage && (
        <p id={errorId} className="text-xs text-[#BE123C] font-medium">
          {errorMessage}
        </p>
      )}

      {isOpen && (
        <div
          id={panelId}
          role="region"
          aria-label={`${label} clock selector`}
          className="mt-1.5 p-3.5 sm:p-4 rounded-2xl bg-[#FFFFFF] border border-[#C7BEA7] shadow-[0_14px_34px_rgba(10,27,44,0.14)] w-full max-w-[300px] overflow-hidden"
        >
          {/* Header: Digital HH:MM readout + segmented AM/PM toggle */}
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="inline-flex items-center gap-1 ct-num shrink-0">
              <button
                type="button"
                onClick={() => setDialMode('hour')}
                aria-label="Select hour on clock"
                aria-pressed={dialMode === 'hour'}
                className={`min-w-[42px] px-2 py-1.5 rounded-lg text-base sm:text-lg font-medium leading-none whitespace-nowrap text-center cursor-pointer transition-colors border ${
                  dialMode === 'hour'
                    ? 'bg-[#E8F6FF] text-[#006BB8] border-[#0284C7]'
                    : 'bg-[#F5F2E9] text-[#0A1B2C] border-[#DFD7C2] hover:border-[#0284C7]'
                }`}
              >
                {displayHourStr}
              </button>
              <span className="text-base font-medium text-[#33475B] select-none px-0.5" aria-hidden="true">
                :
              </span>
              <button
                type="button"
                onClick={() => setDialMode('minute')}
                aria-label="Select minute on clock"
                aria-pressed={dialMode === 'minute'}
                className={`min-w-[42px] px-2 py-1.5 rounded-lg text-base sm:text-lg font-medium leading-none whitespace-nowrap text-center cursor-pointer transition-colors border ${
                  dialMode === 'minute'
                    ? 'bg-[#E8F6FF] text-[#006BB8] border-[#0284C7]'
                    : 'bg-[#F5F2E9] text-[#0A1B2C] border-[#DFD7C2] hover:border-[#0284C7]'
                }`}
              >
                {displayMinStr}
              </button>
            </div>

            <div
              className="inline-flex rounded-lg bg-[#F5F2E9] border border-[#DFD7C2] p-0.5 shrink-0"
              role="group"
              aria-label="AM or PM"
            >
              {(['AM', 'PM'] as const).map((period) => {
                const active = selectedPeriod === period;
                return (
                  <button
                    key={period}
                    type="button"
                    aria-pressed={active}
                    onClick={() => handlePeriodChange(period)}
                    className={`min-h-[32px] px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer ${
                      active
                        ? 'bg-[#006BB8] text-[#FFFFFF] shadow-2xs'
                        : 'text-[#243647] hover:text-[#0A1B2C]'
                    }`}
                  >
                    {period}
                  </button>
                );
              })}
            </div>
          </div>

          <p className="text-[11px] font-medium text-[#33475B] text-center mb-2.5">
            {dialMode === 'hour' ? 'Select hour' : 'Select minutes'}
          </p>

          {/* Proportional analogue dial that scales cleanly inside any card width */}
          <div className="relative mx-auto w-full max-w-[216px] aspect-square rounded-full bg-[#F5F2E9] border border-[#C7BEA7] select-none shadow-[inset_0_2px_6px_rgba(10,27,44,0.06)]">
            <svg
              aria-hidden="true"
              viewBox={`0 0 ${DIAL_VIEWBOX} ${DIAL_VIEWBOX}`}
              className="absolute inset-0 z-0 w-full h-full pointer-events-none"
            >
              {/* Subtle dial tick marks */}
              {Array.from({ length: 12 }, (_, idx) => {
                const rad = (idx * 30 - 90) * (Math.PI / 180);
                const innerR = 96;
                const outerR = 102;
                return (
                  <line
                    key={idx}
                    x1={DIAL_CENTER + innerR * Math.cos(rad)}
                    y1={DIAL_CENTER + innerR * Math.sin(rad)}
                    x2={DIAL_CENTER + outerR * Math.cos(rad)}
                    y2={DIAL_CENTER + outerR * Math.sin(rad)}
                    stroke="#C7BEA7"
                    strokeWidth={idx % 3 === 0 ? '1.75' : '1'}
                    strokeLinecap="round"
                  />
                );
              })}

              {/* Clock hand ending at the outer edge of the target badge so digits remain unobstructed */}
              <line
                x1={DIAL_CENTER}
                y1={DIAL_CENTER}
                x2={handX}
                y2={handY}
                stroke={hasValue ? '#006BB8' : '#8FA6BA'}
                strokeWidth={hasValue ? '2.5' : '1.75'}
                strokeDasharray={hasValue ? undefined : '4 3'}
                strokeLinecap="round"
              />
              {!hasValue && (
                <circle
                  cx={handTipX}
                  cy={handTipY}
                  r="15"
                  fill="rgba(2, 132, 199, 0.14)"
                />
              )}
              <circle
                cx={DIAL_CENTER}
                cy={DIAL_CENTER}
                r="4.5"
                fill={hasValue ? '#006BB8' : '#8FA6BA'}
              />
            </svg>

            {(dialMode === 'hour' ? HOURS : MINUTES).map((item, idx) => {
              const angle = (idx * 30 - 90) * (Math.PI / 180);
              const leftPct = ((DIAL_CENTER + NUMBER_RADIUS * Math.cos(angle)) / DIAL_VIEWBOX) * 100;
              const topPct = ((DIAL_CENTER + NUMBER_RADIUS * Math.sin(angle)) / DIAL_VIEWBOX) * 100;
              const isSelected =
                hasValue &&
                (dialMode === 'hour' ? selectedHour12 === item : selectedMinute === item);
              const isPreviewed =
                !hasValue &&
                (dialMode === 'hour' ? selectedHour12 === item : selectedMinute === item);

              return (
                <button
                  key={`${dialMode}-${item}`}
                  type="button"
                  onClick={() =>
                    dialMode === 'hour' ? handleHourPick(item) : handleMinutePick(item)
                  }
                  style={{
                    left: `${leftPct.toFixed(2)}%`,
                    top: `${topPct.toFixed(2)}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                  aria-label={
                    dialMode === 'hour'
                      ? `${item} o'clock`
                      : `${String(item).padStart(2, '0')} minutes`
                  }
                  aria-pressed={isSelected}
                  className={`absolute z-10 w-8 h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-medium ct-num cursor-pointer ${
                    isSelected
                      ? 'bg-[#006BB8] text-[#FFFFFF] shadow-xs'
                      : isPreviewed
                        ? 'text-[#006BB8] hover:bg-[#E8F6FF]'
                        : 'text-[#0A1B2C] hover:bg-[#EFE8D6]'
                  }`}
                >
                  {dialMode === 'hour' ? item : String(item).padStart(2, '0')}
                </button>
              );
            })}
          </div>

          <div className="mt-3.5 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={handleDone}
              className="ct-btn-primary flex-1 text-sm min-h-[42px] px-4 py-1.5"
            >
              Done
            </button>
            {hasValue && (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setIsOpen(false);
                }}
                className="ct-btn-secondary text-xs min-h-[42px] px-3 py-1.5"
              >
                Clear
              </button>
            )}
          </div>

          {/* Keyboard-accessible direct entry alternative inside clock panel */}
          <div className="mt-3 pt-2.5 border-t border-[#DFD7C2] flex flex-wrap items-center justify-between gap-2">
            <label
              htmlFor={keyboardInputId}
              className="text-xs font-medium text-[#243647] whitespace-nowrap shrink-0"
            >
              Or type time
            </label>
            <input
              id={keyboardInputId}
              type="time"
              value={value}
              onChange={(e) => {
                const raw = e.target.value;
                latestValueRef.current = raw;
                const parsedNext = from24HourTime(raw);
                if (parsedNext) {
                  setSelectedHour12(parsedNext.hour12);
                  setSelectedMinute(parsedNext.minute);
                  setSelectedPeriod(parsedNext.period);
                }
                onChange(raw);
              }}
              aria-label={`${label} direct time input`}
              className="ct-input w-auto min-w-0 max-w-full flex-1 basis-[132px] min-h-[40px] py-1 px-2.5 text-xs ct-num"
            />
          </div>
        </div>
      )}
    </div>
  );
};

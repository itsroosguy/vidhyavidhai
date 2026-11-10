import React, { useEffect, useId, useRef, useState } from 'react';
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

  const handLength = 72;
  const handRad = (activeAngleDeg * Math.PI) / 180;
  const handX = 108 + handLength * Math.cos(handRad);
  const handY = 108 + handLength * Math.sin(handRad);

  const hasValue = isValidTime24(value);
  const displayHourStr = hasValue ? String(selectedHour12).padStart(2, '0') : '--';
  const displayMinStr = hasValue ? String(selectedMinute).padStart(2, '0') : '--';

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-[#0F172A]">
        {label}
        {required && (
          <span className="ml-1 text-[#0F766E]" aria-hidden="true">
            *
          </span>
        )}
      </label>

      <button
        type="button"
        id={id}
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-invalid={Boolean(errorMessage)}
        aria-describedby={errorMessage ? errorId : undefined}
        onClick={handleOpenToggle}
        className={`ct-input flex items-center justify-between text-left cursor-pointer ${
          errorMessage ? 'border-[#BE123C]' : ''
        }`}
      >
        <span className={hasValue ? 'text-[#0F172A] font-medium ct-num' : 'text-[#526077]'}>
          {hasValue ? formatTime24To12(value) : 'Choose time'}
        </span>
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
          className="mt-1 p-4 rounded-xl bg-[#FFFFFF] border border-[#CBD5E1] shadow-[0_14px_34px_rgba(15,23,42,0.14)] w-full max-w-[276px]"
        >
          {/* Digital display + AM/PM toggle */}
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-1.5 text-2xl font-medium tracking-wider ct-num">
              <button
                type="button"
                onClick={() => setDialMode('hour')}
                aria-label="Select hour on clock"
                aria-pressed={dialMode === 'hour'}
                className={`px-2.5 py-1 rounded-md cursor-pointer transition-colors border ${
                  dialMode === 'hour'
                    ? 'bg-[#0F766E] text-[#FFFFFF] border-[#0F766E]'
                    : 'bg-[#F8FAFC] text-[#0F172A] border-[#CBD5E1] hover:border-[#0F766E]/70'
                }`}
              >
                {displayHourStr}
              </button>
              <span className="text-[#526077]" aria-hidden="true">
                :
              </span>
              <button
                type="button"
                onClick={() => setDialMode('minute')}
                aria-label="Select minute on clock"
                aria-pressed={dialMode === 'minute'}
                className={`px-2.5 py-1 rounded-md cursor-pointer transition-colors border ${
                  dialMode === 'minute'
                    ? 'bg-[#0F766E] text-[#FFFFFF] border-[#0F766E]'
                    : 'bg-[#F8FAFC] text-[#0F172A] border-[#CBD5E1] hover:border-[#0F766E]/70'
                }`}
              >
                {displayMinStr}
              </button>
            </div>

            <div className="flex flex-col gap-1" role="group" aria-label="AM or PM">
              {(['AM', 'PM'] as const).map((period) => {
                const active = selectedPeriod === period;
                return (
                  <button
                    key={period}
                    type="button"
                    aria-pressed={active}
                    onClick={() => handlePeriodChange(period)}
                    className={`px-3 py-1 rounded text-xs font-medium cursor-pointer transition-colors border ${
                      active
                        ? 'bg-[#0F766E] text-[#FFFFFF] border-[#0F766E]'
                        : 'bg-[#F8FAFC] text-[#0F172A] border-[#CBD5E1] hover:bg-[#F1F5F9]'
                    }`}
                  >
                    {period}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Circular Daylight White analogue clock face */}
          <div className="relative mx-auto w-[216px] h-[216px] rounded-full bg-[#F8FAFC] border border-[#CBD5E1] select-none shadow-inner">
            {hasValue && (
              <svg
                aria-hidden="true"
                viewBox="0 0 216 216"
                className="absolute inset-0 w-full h-full pointer-events-none"
              >
                <line
                  x1="108"
                  y1="108"
                  x2={handX}
                  y2={handY}
                  stroke="#0F766E"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                <circle cx="108" cy="108" r="4" fill="#0F766E" />
                <circle cx={handX} cy={handY} r="15" fill="rgba(15, 118, 110, 0.16)" />
              </svg>
            )}

            {(dialMode === 'hour' ? HOURS : MINUTES).map((item, idx) => {
              const angle = (idx * 30 - 90) * (Math.PI / 180);
              const radius = 82;
              const left = 108 + radius * Math.cos(angle);
              const top = 108 + radius * Math.sin(angle);
              const isSelected =
                hasValue &&
                (dialMode === 'hour' ? selectedHour12 === item : selectedMinute === item);

              return (
                <button
                  key={item}
                  type="button"
                  onClick={() =>
                    dialMode === 'hour' ? handleHourPick(item) : handleMinutePick(item)
                  }
                  style={{
                    left: `${left}px`,
                    top: `${top}px`,
                    transform: 'translate(-50%, -50%)',
                  }}
                  aria-label={
                    dialMode === 'hour'
                      ? `${item} o'clock`
                      : `${String(item).padStart(2, '0')} minutes`
                  }
                  aria-pressed={isSelected}
                  className={`absolute w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ct-num cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-[#0F766E] text-[#FFFFFF] font-medium'
                      : 'text-[#0F172A] hover:bg-[#E2E8F0]'
                  }`}
                >
                  {dialMode === 'hour' ? item : String(item).padStart(2, '0')}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={handleDone}
              className="ct-btn-primary text-sm min-h-[38px] px-6 py-1.5"
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
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#475569] hover:text-[#0F172A] hover:bg-[#F1F5F9] cursor-pointer transition-colors"
              >
                Clear
              </button>
            )}
          </div>

          {/* Keyboard-accessible direct entry alternative inside clock panel */}
          <div className="mt-3 pt-2.5 border-t border-[#E2E8F0] flex items-center justify-between gap-2">
            <label htmlFor={keyboardInputId} className="text-[11px] text-[#475569]">
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
              className="ct-input w-[132px] min-h-[36px] py-1 px-2 text-xs ct-num"
            />
          </div>
        </div>
      )}
    </div>
  );
};

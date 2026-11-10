import { Temporal } from 'temporal-polyfill';
import { PROGRAMME_TIMEZONE } from '../config/defaults';

function getTemporal(): typeof Temporal {
  const g = globalThis as unknown as { Temporal?: typeof Temporal };
  if (typeof g !== 'undefined' && typeof g.Temporal !== 'undefined') {
    return g.Temporal;
  }
  return Temporal;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function getTodayKolkataISO(tz: string = PROGRAMME_TIMEZONE): string {
  const T = getTemporal();
  return T.Now.plainDateISO(tz).toString();
}

export function isValidISODate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  try {
    const T = getTemporal();
    T.PlainDate.from(dateStr);
    return true;
  } catch {
    return false;
  }
}

export function isValidTime24(timeStr: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(timeStr)) return false;
  const [hStr, mStr] = timeStr.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  return Number.isInteger(h) && Number.isInteger(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

export function isFutureDateKolkata(dateStr: string, tz: string = PROGRAMME_TIMEZONE): boolean {
  if (!isValidISODate(dateStr)) return false;
  const T = getTemporal();
  const target = T.PlainDate.from(dateStr);
  const today = T.Now.plainDateISO(tz);
  return T.PlainDate.compare(target, today) > 0;
}

export function comparePlainDates(a: string, b: string): number {
  const T = getTemporal();
  return T.PlainDate.compare(T.PlainDate.from(a), T.PlainDate.from(b));
}

export function formatISODateToDDMMYYYY(dateStr: string): string {
  if (!isValidISODate(dateStr)) return '';
  const T = getTemporal();
  const d = T.PlainDate.from(dateStr);
  const dd = String(d.day).padStart(2, '0');
  const mm = String(d.month).padStart(2, '0');
  return `${dd}-${mm}-${d.year}`;
}

export function formatISODateToYYYYMMDD(dateStr: string): string {
  if (!isValidISODate(dateStr)) return '';
  const T = getTemporal();
  const d = T.PlainDate.from(dateStr);
  const dd = String(d.day).padStart(2, '0');
  const mm = String(d.month).padStart(2, '0');
  return `${d.year}${mm}${dd}`;
}

export function getMonthNameFromISO(dateStr: string): string {
  if (!isValidISODate(dateStr)) return '';
  const T = getTemporal();
  const d = T.PlainDate.from(dateStr);
  return MONTH_NAMES[d.month - 1] ?? '';
}

/**
 * Calculates elapsed session duration in minutes across midnight or multiple dates
 * in Asia/Kolkata without UTC offset drift.
 * Returns null when inputs are invalid or end <= start.
 */
export function calculateSessionDurationMinutes(
  startDate: string,
  startTime: string,
  endDate: string,
  endTime: string,
  tz: string = PROGRAMME_TIMEZONE,
): number | null {
  if (!isValidISODate(startDate) || !isValidISODate(endDate)) return null;
  if (!isValidTime24(startTime) || !isValidTime24(endTime)) return null;

  try {
    const T = getTemporal();
    const startZdt = T.PlainDate.from(startDate)
      .toPlainDateTime(T.PlainTime.from(startTime))
      .toZonedDateTime(tz);
    const endZdt = T.PlainDate.from(endDate)
      .toPlainDateTime(T.PlainTime.from(endTime))
      .toZonedDateTime(tz);

    const diff = startZdt.until(endZdt, { largestUnit: 'minute', smallestUnit: 'minute' });
    if (diff.sign <= 0) return null;
    return diff.minutes;
  } catch {
    return null;
  }
}

export function formatDurationHuman(totalMinutes: number | null): string {
  if (totalMinutes === null || !Number.isFinite(totalMinutes) || totalMinutes <= 0) {
    return '—';
  }
  const T = getTemporal();
  const dur = T.Duration.from({ minutes: Math.round(totalMinutes) }).round({
    largestUnit: 'hour',
  });
  const days = Math.floor(dur.hours / 24);
  const hours = dur.hours % 24;
  const mins = dur.minutes;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hr' : 'hrs'}`);
  if (mins > 0 || parts.length === 0) parts.push(`${mins} ${mins === 1 ? 'min' : 'mins'}`);
  return parts.join(' ');
}

export function formatTime24To12(time24: string): string {
  if (!isValidTime24(time24)) return '';
  const [hStr, mStr] = time24.split(':');
  const h24 = Number(hStr);
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h12).padStart(2, '0')}:${mStr} ${period}`;
}

export function to24HourTime(hour12: number, minute: number, period: 'AM' | 'PM'): string {
  let h24 = hour12 % 12;
  if (period === 'PM') h24 += 12;
  return `${String(h24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function from24HourTime(time24: string): {
  hour12: number;
  minute: number;
  period: 'AM' | 'PM';
} | null {
  if (!isValidTime24(time24)) return null;
  const [hStr, mStr] = time24.split(':');
  const h24 = Number(hStr);
  const m = Number(mStr);
  return {
    hour12: h24 % 12 === 0 ? 12 : h24 % 12,
    minute: m,
    period: h24 >= 12 ? 'PM' : 'AM',
  };
}

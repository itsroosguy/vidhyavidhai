import type { AppConfiguration, ClassGroupInput, SessionMode, TourOption } from '../types/domain';
import { formatISODateToYYYYMMDD } from './temporal';

export function formatClassSegmentForSessionId(
  sessionMode: SessionMode,
  classes: Pick<ClassGroupInput, 'grade' | 'section'>[],
): { gradeToken: string; classToken: string } | null {
  if (sessionMode === 'single') {
    const first = classes[0];
    if (!first || !first.grade.trim() || !first.section.trim()) return null;
    const gradeToken = first.grade.trim().padStart(2, '0');
    const secClean = first.section.trim().toUpperCase();
    const classToken = secClean === 'NO SECTION' ? 'NS' : secClean.replace(/[^A-Z0-9]/g, '');
    if (!classToken) return null;
    return { gradeToken, classToken };
  }

  if (classes.length < 2) return null;
  const validRows = classes.filter((c) => c.grade.trim() && c.section.trim());
  if (validRows.length !== classes.length) return null;

  return {
    gradeToken: 'CMB',
    classToken: `${String(classes.length).padStart(2, '0')}C`,
  };
}

/**
 * Generates the deterministic Session ID prefix in the original format:
 * CT_IN_YYYYMMDD_UDISE_GG_CLASS
 * Server appends _NNN under LockService to guarantee zero collisions.
 */
export function buildSessionIdPrefix(
  startDate: string,
  udiseCode: string,
  sessionMode: SessionMode,
  classes: Pick<ClassGroupInput, 'grade' | 'section'>[],
): string | null {
  const yyyymmdd = formatISODateToYYYYMMDD(startDate);
  if (!yyyymmdd) return null;
  if (!/^\d{11}$/.test(udiseCode.trim())) return null;

  const seg = formatClassSegmentForSessionId(sessionMode, classes);
  if (!seg) return null;

  return `CT_IN_${yyyymmdd}_${udiseCode.trim()}_${seg.gradeToken}_${seg.classToken}`;
}

export function formatSessionIdWithSequence(prefix: string, sequence: number): string {
  return `${prefix}_${String(sequence).padStart(3, '0')}`;
}

export function resolveConfiguredVideoId(
  tour: TourOption | undefined,
  language: string,
  _config: AppConfiguration,
): { videoId: string; isConfigured: boolean } {
  if (!tour) {
    return { videoId: '', isConfigured: false };
  }
  const exact = tour.videoIdByLanguage?.[language]?.trim();
  if (exact) {
    return { videoId: exact, isConfigured: true };
  }
  return {
    videoId: `Not configured for ${tour.tourName} (${language || 'language unset'})`,
    isConfigured: false,
  };
}

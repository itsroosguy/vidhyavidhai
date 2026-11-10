import {
  calculateScaleMetrics,
  isValidWholeNumberString,
  toNumericCounts,
} from '../calculations/metrics';
import type {
  AppConfiguration,
  SessionFormValues,
  ValidationIssue,
  ValidationResult,
} from '../types/domain';
import {
  calculateSessionDurationMinutes,
  comparePlainDates,
  isFutureDateKolkata,
  isValidISODate,
  isValidTime24,
} from '../utils/temporal';

export function getBlocksForDistrict(
  district: string,
  config: AppConfiguration,
): string[] {
  if (!district) return [];
  return config.districtBlocks
    .filter((entry) => entry.active && entry.district === district)
    .map((entry) => entry.block)
    .sort((a, b) => a.localeCompare(b));
}

export function validateSessionForm(
  values: SessionFormValues,
  config: AppConfiguration,
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Section 1 — About you
  if (!values.facilitatorName.trim()) {
    errors.push({
      code: 'FACILITATOR_NAME_REQUIRED',
      field: 'facilitatorName',
      section: 1,
      severity: 'error',
      message: 'Enter your facilitator name.',
    });
  }
  if (!values.facilitatorEmail.trim()) {
    errors.push({
      code: 'FACILITATOR_EMAIL_REQUIRED',
      field: 'facilitatorEmail',
      section: 1,
      severity: 'error',
      message: 'Signed-in facilitator email is required.',
    });
  }

  // Section 2 — About the session
  const selectedTour = config.tours.find(
    (t) => t.active && t.tourId === values.tourId,
  );
  if (!selectedTour) {
    errors.push({
      code: 'TOUR_REQUIRED',
      field: 'tourId',
      section: 2,
      severity: 'error',
      message: 'Choose which Career Tour video you showed.',
    });
  }

  if (!values.language || !config.languageOptions.includes(values.language)) {
    errors.push({
      code: 'LANGUAGE_REQUIRED',
      field: 'language',
      section: 2,
      severity: 'error',
      message: 'Select the session language.',
    });
  }

  const startDateValid = isValidISODate(values.startDate);
  const endDateValid = isValidISODate(values.endDate);

  if (!startDateValid) {
    errors.push({
      code: 'START_DATE_INVALID',
      field: 'startDate',
      section: 2,
      severity: 'error',
      message: 'Enter a valid session start date.',
    });
  } else if (isFutureDateKolkata(values.startDate, config.programmeTimezone)) {
    errors.push({
      code: 'START_DATE_FUTURE',
      field: 'startDate',
      section: 2,
      severity: 'error',
      message: 'Session start date cannot be in the future.',
    });
  }

  if (!endDateValid) {
    errors.push({
      code: 'END_DATE_INVALID',
      field: 'endDate',
      section: 2,
      severity: 'error',
      message: 'Enter a valid session end date.',
    });
  } else if (isFutureDateKolkata(values.endDate, config.programmeTimezone)) {
    errors.push({
      code: 'END_DATE_FUTURE',
      field: 'endDate',
      section: 2,
      severity: 'error',
      message: 'Session end date cannot be in the future.',
    });
  }

  if (startDateValid && endDateValid && comparePlainDates(values.endDate, values.startDate) < 0) {
    errors.push({
      code: 'END_DATE_BEFORE_START',
      field: 'endDate',
      section: 2,
      severity: 'error',
      message: 'Session end date cannot be earlier than the start date.',
    });
  }

  const startTimeValid = isValidTime24(values.startTime);
  const endTimeValid = isValidTime24(values.endTime);

  if (!startTimeValid) {
    errors.push({
      code: 'START_TIME_REQUIRED',
      field: 'startTime',
      section: 2,
      severity: 'error',
      message: 'Choose the session start time.',
    });
  }
  if (!endTimeValid) {
    errors.push({
      code: 'END_TIME_REQUIRED',
      field: 'endTime',
      section: 2,
      severity: 'error',
      message: 'Choose the session end time.',
    });
  }

  if (
    startDateValid &&
    endDateValid &&
    startTimeValid &&
    endTimeValid &&
    comparePlainDates(values.endDate, values.startDate) >= 0
  ) {
    const durationMins = calculateSessionDurationMinutes(
      values.startDate,
      values.startTime,
      values.endDate,
      values.endTime,
      config.programmeTimezone,
    );
    if (durationMins === null) {
      errors.push({
        code: 'END_BEFORE_START_TIME',
        field: 'endTime',
        section: 2,
        severity: 'error',
        message:
          'Session end date and time must be later than the start date and time. If the session ran past midnight, set the end date to the next day.',
      });
    } else if (durationMins > 480) {
      warnings.push({
        code: 'LONG_SESSION_DURATION',
        field: 'endTime',
        section: 2,
        severity: 'warning',
        message: `Session duration is ${Math.round(durationMins / 60)} hours (${durationMins} mins). Confirm start/end dates and AM/PM are correct.`,
      });
    }
  }

  // Section 3 — About the school
  if (!values.schoolName.trim()) {
    errors.push({
      code: 'SCHOOL_NAME_REQUIRED',
      field: 'schoolName',
      section: 3,
      severity: 'error',
      message: 'Enter the school name.',
    });
  }

  const udise = values.udiseCode.trim();
  if (!/^\d{11}$/.test(udise)) {
    errors.push({
      code: 'UDISE_INVALID',
      field: 'udiseCode',
      section: 3,
      severity: 'error',
      message: 'School code (UDISE) must be exactly 11 numeric digits.',
    });
  }

  if (!values.schoolType || !config.schoolTypes.includes(values.schoolType)) {
    errors.push({
      code: 'SCHOOL_TYPE_REQUIRED',
      field: 'schoolType',
      section: 3,
      severity: 'error',
      message: 'Select the school type.',
    });
  }

  if (!values.district || !config.allowedDistricts.includes(values.district)) {
    errors.push({
      code: 'DISTRICT_INVALID',
      field: 'district',
      section: 3,
      severity: 'error',
      message: `District must be one of: ${config.allowedDistricts.join(', ')}.`,
    });
  } else {
    const approvedBlocks = getBlocksForDistrict(values.district, config);
    if (approvedBlocks.length === 0) {
      errors.push({
        code: 'BLOCKS_NOT_CONFIGURED',
        field: 'block',
        section: 3,
        severity: 'error',
        message: 'Block list not configured. Please contact the administrator.',
      });
    } else if (!values.block || !approvedBlocks.includes(values.block)) {
      errors.push({
        code: 'BLOCK_REQUIRED',
        field: 'block',
        section: 3,
        severity: 'error',
        message: 'Select an approved block for the chosen district.',
      });
    }
  }

  const pin = values.pinCode.trim();
  if (!/^\d{6}$/.test(pin)) {
    errors.push({
      code: 'PIN_INVALID',
      field: 'pinCode',
      section: 3,
      severity: 'error',
      message: 'PIN code must be exactly 6 numeric digits.',
    });
  }

  // Section 4 & 5 — Class & Students' answers
  if (values.sessionMode === 'single') {
    if (values.classes.length !== 1) {
      errors.push({
        code: 'SINGLE_CLASS_ROW_COUNT',
        field: 'classes',
        section: 4,
        severity: 'error',
        message: 'Single class mode must contain exactly one class row.',
      });
    }
  } else {
    if (values.classes.length < 2 || values.classes.length > 10) {
      errors.push({
        code: 'COMBINED_CLASS_ROW_COUNT',
        field: 'classes',
        section: 4,
        severity: 'error',
        message: 'Combined class sessions must include between 2 and 10 class/grade rows.',
      });
    }
  }

  const seenClassKeys = new Set<string>();

  values.classes.forEach((row, index) => {
    const label = `Class ${index + 1}`;
    if (!row.grade || !config.gradeOptions.includes(row.grade)) {
      errors.push({
        code: 'GRADE_REQUIRED',
        field: `classes.${index}.grade`,
        section: 4,
        severity: 'error',
        message: `${label}: Select the class (grade).`,
      });
    }

    if (!row.section || !config.sectionOptions.includes(row.section)) {
      errors.push({
        code: 'SECTION_REQUIRED',
        field: `classes.${index}.section`,
        section: 4,
        severity: 'error',
        message: `${label}: Select the section (or choose "No section").`,
      });
    }

    if (row.grade && row.section) {
      const key = `${row.grade}::${row.section}`;
      if (seenClassKeys.has(key)) {
        errors.push({
          code: 'DUPLICATE_CLASS_ROW',
          field: `classes.${index}.section`,
          section: 4,
          severity: 'error',
          message: `Duplicate class entry: Grade ${row.grade} (${row.section}) appears more than once.`,
        });
      }
      seenClassKeys.add(key);
    }

    const rawStudents = row.studentsPresent.trim();
    const studentsValidInt = /^\d+$/.test(rawStudents);
    const studentsPresent = studentsValidInt ? Number.parseInt(rawStudents, 10) : 0;

    if (!studentsValidInt || studentsPresent <= 0) {
      errors.push({
        code: 'STUDENTS_PRESENT_INVALID',
        field: `classes.${index}.studentsPresent`,
        section: 4,
        severity: 'error',
        message: `${label}: Number of students present must be a whole number greater than 0.`,
      });
    }

    // Question A counts
    const qaFields = ['score5', 'score4', 'score3', 'score2', 'score1'] as const;
    let qaFormatError = false;
    for (const k of qaFields) {
      if (!isValidWholeNumberString(row.questionA[k], true)) {
        qaFormatError = true;
        errors.push({
          code: 'SCORE_COUNT_INVALID',
          field: `classes.${index}.questionA.${k}`,
          section: 5,
          severity: 'error',
          message: `${label} (Question A): Enter whole numbers (0 or greater) only — no negative or decimal counts.`,
        });
        break;
      }
    }

    // Question B counts
    let qbFormatError = false;
    for (const k of qaFields) {
      if (!isValidWholeNumberString(row.questionB[k], true)) {
        qbFormatError = true;
        errors.push({
          code: 'SCORE_COUNT_INVALID',
          field: `classes.${index}.questionB.${k}`,
          section: 5,
          severity: 'error',
          message: `${label} (Question B): Enter whole numbers (0 or greater) only — no negative or decimal counts.`,
        });
        break;
      }
    }

    if (!qaFormatError && !qbFormatError) {
      const qaCalc = calculateScaleMetrics(toNumericCounts(row.questionA));
      const qbCalc = calculateScaleMetrics(toNumericCounts(row.questionB));

      if (studentsPresent > 0 && qaCalc.total > studentsPresent) {
        errors.push({
          code: 'QA_EXCEEDS_PRESENT',
          field: `classes.${index}.questionA`,
          section: 5,
          severity: 'error',
          message: `${label}: Question A total (${qaCalc.total}) cannot exceed students present (${studentsPresent}).`,
        });
      }

      if (studentsPresent > 0 && qbCalc.total > studentsPresent) {
        errors.push({
          code: 'QB_EXCEEDS_PRESENT',
          field: `classes.${index}.questionB`,
          section: 5,
          severity: 'error',
          message: `${label}: Question B total (${qbCalc.total}) cannot exceed students present (${studentsPresent}).`,
        });
      }

      if (qaCalc.total !== qbCalc.total) {
        warnings.push({
          code: 'QA_QB_TOTAL_MISMATCH',
          field: `classes.${index}.questionB`,
          section: 5,
          severity: 'warning',
          message: `${label}: Question A responses (${qaCalc.total}) differ from Question B responses (${qbCalc.total}).`,
        });
      }

      if (studentsPresent > 0) {
        const qaCov = (qaCalc.total / studentsPresent) * 100;
        const qbCov = (qbCalc.total / studentsPresent) * 100;

        if (qaCalc.total === 0 || qbCalc.total === 0) {
          warnings.push({
            code: 'ZERO_STUDENT_RESPONSES',
            field: `classes.${index}.questionA`,
            section: 5,
            severity: 'warning',
            message: `${label}: At least one question has 0 student responses recorded.`,
          });
        } else if (qaCov < 75 || qbCov < 75) {
          warnings.push({
            code: 'LOW_RESPONSE_COVERAGE',
            field: `classes.${index}.questionA`,
            section: 5,
            severity: 'warning',
            message: `${label}: Response coverage is below 75% (Question A: ${qaCov.toFixed(0)}%, Question B: ${qbCov.toFixed(0)}%).`,
          });
        }
      }
    }
  });

  // Section 6 — Teacher's answer
  const trimmedExact = values.teacherExactScore.trim();
  if (trimmedExact !== '') {
    if (!/^(10|[0-9])$/.test(trimmedExact)) {
      errors.push({
        code: 'TEACHER_EXACT_SCORE_INVALID',
        field: 'teacherExactScore',
        section: 6,
        severity: 'error',
        message: "Teacher's exact score must be a whole number from 0 to 10.",
      });
    } else if (values.teacherNpsGroup) {
      const score = Number.parseInt(trimmedExact, 10);
      const expectedGroup = score >= 9 ? 'promoter' : score >= 7 ? 'passive' : 'detractor';
      if (expectedGroup !== values.teacherNpsGroup) {
        errors.push({
          code: 'TEACHER_SCORE_GROUP_MISMATCH',
          field: 'teacherExactScore',
          section: 6,
          severity: 'error',
          message: `Exact score ${score} belongs to ${expectedGroup}, which does not match the selected group.`,
        });
      }
    }
  } else if (!values.teacherNpsGroup) {
    errors.push({
      code: 'TEACHER_NPS_REQUIRED',
      field: 'teacherNpsGroup',
      section: 6,
      severity: 'error',
      message: "Select the teacher's NPS recommendation score or group.",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

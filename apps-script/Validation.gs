/**
 * Validation.gs — Authoritative server-side form & business rule validation.
 */

function ctArrayIncludes_(arr, item) {
  if (!arr || !arr.length) return false;
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] === item) return true;
  }
  return false;
}

function ctValidateSessionForm_(values, config) {
  var errors = [];
  var warnings = [];
  var todayKolkata = ctGetTodayKolkataISO_();

  if (!values || typeof values !== 'object') {
    return {
      valid: false,
      errors: [{ code: 'PAYLOAD_INVALID', field: 'form', section: 1, severity: 'error', message: 'Invalid session payload.' }],
      warnings: []
    };
  }

  // Section 1
  if (!String(values.facilitatorName || '').trim()) {
    errors.push({ code: 'FACILITATOR_NAME_REQUIRED', field: 'facilitatorName', section: 1, severity: 'error', message: 'Enter your facilitator name.' });
  }
  if (!String(values.facilitatorEmail || '').trim()) {
    errors.push({ code: 'FACILITATOR_EMAIL_REQUIRED', field: 'facilitatorEmail', section: 1, severity: 'error', message: 'Signed-in facilitator email is required.' });
  }

  // Section 2
  var selectedTour = null;
  for (var tIdx = 0; tIdx < (config.tours || []).length; tIdx++) {
    var t = config.tours[tIdx];
    if (t.active && t.tourId === values.tourId) {
      selectedTour = t;
      break;
    }
  }
  if (!selectedTour) {
    errors.push({ code: 'TOUR_REQUIRED', field: 'tourId', section: 2, severity: 'error', message: 'Choose which Career Tour video you showed.' });
  }

  if (!values.language || !ctArrayIncludes_(config.languageOptions, values.language)) {
    errors.push({ code: 'LANGUAGE_REQUIRED', field: 'language', section: 2, severity: 'error', message: 'Select the session language.' });
  }

  var startDateValid = ctIsValidISODate_(values.startDate);
  var endDateValid = ctIsValidISODate_(values.endDate);

  if (!startDateValid) {
    errors.push({ code: 'START_DATE_INVALID', field: 'startDate', section: 2, severity: 'error', message: 'Enter a valid session start date.' });
  } else if (values.startDate > todayKolkata) {
    errors.push({ code: 'START_DATE_FUTURE', field: 'startDate', section: 2, severity: 'error', message: 'Session start date cannot be in the future.' });
  }

  if (!endDateValid) {
    errors.push({ code: 'END_DATE_INVALID', field: 'endDate', section: 2, severity: 'error', message: 'Enter a valid session end date.' });
  } else if (values.endDate > todayKolkata) {
    errors.push({ code: 'END_DATE_FUTURE', field: 'endDate', section: 2, severity: 'error', message: 'Session end date cannot be in the future.' });
  }

  if (startDateValid && endDateValid && values.endDate < values.startDate) {
    errors.push({ code: 'END_DATE_BEFORE_START', field: 'endDate', section: 2, severity: 'error', message: 'Session end date cannot be earlier than the start date.' });
  }

  var startTimeValid = ctIsValidTime24_(values.startTime);
  var endTimeValid = ctIsValidTime24_(values.endTime);

  if (!startTimeValid) {
    errors.push({ code: 'START_TIME_REQUIRED', field: 'startTime', section: 2, severity: 'error', message: 'Choose the session start time.' });
  }
  if (!endTimeValid) {
    errors.push({ code: 'END_TIME_REQUIRED', field: 'endTime', section: 2, severity: 'error', message: 'Choose the session end time.' });
  }

  if (startDateValid && endDateValid && startTimeValid && endTimeValid && values.endDate >= values.startDate) {
    var dur = ctCalculateSessionDurationMinutes_(values.startDate, values.startTime, values.endDate, values.endTime);
    if (dur === null) {
      errors.push({
        code: 'END_BEFORE_START_TIME',
        field: 'endTime',
        section: 2,
        severity: 'error',
        message: 'Session end date and time must be later than the start date and time. If the session ran past midnight, set the end date to the next day.'
      });
    } else if (dur > 480) {
      warnings.push({
        code: 'LONG_SESSION_DURATION',
        field: 'endTime',
        section: 2,
        severity: 'warning',
        message: 'Session duration is ' + Math.round(dur / 60) + ' hours (' + dur + ' mins). Confirm start/end dates and AM/PM are correct.'
      });
    }
  }

  // Section 3
  if (!String(values.schoolName || '').trim()) {
    errors.push({ code: 'SCHOOL_NAME_REQUIRED', field: 'schoolName', section: 3, severity: 'error', message: 'Enter the school name.' });
  }

  var udise = String(values.udiseCode || '').trim();
  if (!/^\d{11}$/.test(udise)) {
    errors.push({ code: 'UDISE_INVALID', field: 'udiseCode', section: 3, severity: 'error', message: 'School code (UDISE) must be exactly 11 numeric digits.' });
  }

  if (!values.schoolType || !ctArrayIncludes_(config.schoolTypes, values.schoolType)) {
    errors.push({ code: 'SCHOOL_TYPE_REQUIRED', field: 'schoolType', section: 3, severity: 'error', message: 'Select the school type.' });
  }

  if (!values.district || !ctArrayIncludes_(config.allowedDistricts, values.district)) {
    errors.push({
      code: 'DISTRICT_INVALID',
      field: 'district',
      section: 3,
      severity: 'error',
      message: 'District must be one of: ' + (config.allowedDistricts || []).join(', ') + '.'
    });
  }

  var pin = String(values.pinCode || '').trim();
  if (!/^\d{6}$/.test(pin)) {
    errors.push({ code: 'PIN_INVALID', field: 'pinCode', section: 3, severity: 'error', message: 'PIN code must be exactly 6 numeric digits.' });
  }

  // Section 4 & 5
  var classes = values.classes || [];
  if (values.sessionMode === 'single') {
    if (classes.length !== 1) {
      errors.push({ code: 'SINGLE_CLASS_ROW_COUNT', field: 'classes', section: 4, severity: 'error', message: 'Single class mode must contain exactly one class row.' });
    }
  } else if (values.sessionMode === 'combined') {
    if (classes.length < 2 || classes.length > 10) {
      errors.push({ code: 'COMBINED_CLASS_ROW_COUNT', field: 'classes', section: 4, severity: 'error', message: 'Combined class sessions must include between 2 and 10 class/grade rows.' });
    }
  } else {
    errors.push({ code: 'SESSION_MODE_INVALID', field: 'sessionMode', section: 4, severity: 'error', message: 'Invalid session mode.' });
  }

  var seenClassKeys = {};
  var scoreKeys = ['score5', 'score4', 'score3', 'score2', 'score1'];

  for (var i = 0; i < classes.length; i++) {
    var row = classes[i];
    var label = 'Class ' + (i + 1);
    if (!row.grade || !ctArrayIncludes_(config.gradeOptions, String(row.grade))) {
      errors.push({ code: 'GRADE_REQUIRED', field: 'classes.' + i + '.grade', section: 4, severity: 'error', message: label + ': Select the class (grade).' });
    }
    if (!row.section || !ctArrayIncludes_(config.sectionOptions, String(row.section))) {
      errors.push({ code: 'SECTION_REQUIRED', field: 'classes.' + i + '.section', section: 4, severity: 'error', message: label + ': Select the section (or choose "No section").' });
    }
    if (row.grade && row.section) {
      var cKey = row.grade + '::' + row.section;
      if (seenClassKeys[cKey]) {
        errors.push({ code: 'DUPLICATE_CLASS_ROW', field: 'classes.' + i + '.section', section: 4, severity: 'error', message: 'Duplicate class entry: Grade ' + row.grade + ' (' + row.section + ') appears more than once.' });
      }
      seenClassKeys[cKey] = true;
    }

    var rawStudents = String(row.studentsPresent || '').trim();
    var studentsValidInt = /^\d+$/.test(rawStudents);
    var studentsPresent = studentsValidInt ? parseInt(rawStudents, 10) : 0;
    if (!studentsValidInt || studentsPresent <= 0) {
      errors.push({ code: 'STUDENTS_PRESENT_INVALID', field: 'classes.' + i + '.studentsPresent', section: 4, severity: 'error', message: label + ': Number of students present must be a whole number greater than 0.' });
    }

    var qaFormatError = false;
    var qbFormatError = false;
    for (var kIdx = 0; kIdx < scoreKeys.length; kIdx++) {
      var sk = scoreKeys[kIdx];
      if (!ctIsValidWholeNumberString_(row.questionA && row.questionA[sk], true)) {
        qaFormatError = true;
        errors.push({ code: 'SCORE_COUNT_INVALID', field: 'classes.' + i + '.questionA.' + sk, section: 5, severity: 'error', message: label + ' (Question A): Enter whole numbers (0 or greater) only — no negative or decimal counts.' });
        break;
      }
    }
    for (var kIdx2 = 0; kIdx2 < scoreKeys.length; kIdx2++) {
      var sk2 = scoreKeys[kIdx2];
      if (!ctIsValidWholeNumberString_(row.questionB && row.questionB[sk2], true)) {
        qbFormatError = true;
        errors.push({ code: 'SCORE_COUNT_INVALID', field: 'classes.' + i + '.questionB.' + sk2, section: 5, severity: 'error', message: label + ' (Question B): Enter whole numbers (0 or greater) only — no negative or decimal counts.' });
        break;
      }
    }

    if (!qaFormatError && !qbFormatError) {
      var qaCalc = ctCalculateScaleMetrics_(ctToNumericCounts_(row.questionA));
      var qbCalc = ctCalculateScaleMetrics_(ctToNumericCounts_(row.questionB));

      if (studentsPresent > 0 && qaCalc.total > studentsPresent) {
        errors.push({ code: 'QA_EXCEEDS_PRESENT', field: 'classes.' + i + '.questionA', section: 5, severity: 'error', message: label + ': Question A total (' + qaCalc.total + ') cannot exceed students present (' + studentsPresent + ').' });
      }
      if (studentsPresent > 0 && qbCalc.total > studentsPresent) {
        errors.push({ code: 'QB_EXCEEDS_PRESENT', field: 'classes.' + i + '.questionB', section: 5, severity: 'error', message: label + ': Question B total (' + qbCalc.total + ') cannot exceed students present (' + studentsPresent + ').' });
      }
      if (qaCalc.total !== qbCalc.total) {
        warnings.push({ code: 'QA_QB_TOTAL_MISMATCH', field: 'classes.' + i + '.questionB', section: 5, severity: 'warning', message: label + ': Question A responses (' + qaCalc.total + ') differ from Question B responses (' + qbCalc.total + ').' });
      }
      if (studentsPresent > 0) {
        var qaCov = (qaCalc.total / studentsPresent) * 100;
        var qbCov = (qbCalc.total / studentsPresent) * 100;
        if (qaCalc.total === 0 || qbCalc.total === 0) {
          warnings.push({ code: 'ZERO_STUDENT_RESPONSES', field: 'classes.' + i + '.questionA', section: 5, severity: 'warning', message: label + ': At least one question has 0 student responses recorded.' });
        } else if (qaCov < 75 || qbCov < 75) {
          warnings.push({ code: 'LOW_RESPONSE_COVERAGE', field: 'classes.' + i + '.questionA', section: 5, severity: 'warning', message: label + ': Response coverage is below 75%.' });
        }
      }
    }
  }

  // Section 6
  var trimmedExact = String(values.teacherExactScore || '').trim();
  if (trimmedExact !== '') {
    if (!/^(10|[0-9])$/.test(trimmedExact)) {
      errors.push({ code: 'TEACHER_EXACT_SCORE_INVALID', field: 'teacherExactScore', section: 6, severity: 'error', message: "Teacher's exact score must be a whole number from 0 to 10." });
    } else if (values.teacherNpsGroup) {
      var tScore = parseInt(trimmedExact, 10);
      var expectedGroup = tScore >= 9 ? 'promoter' : tScore >= 7 ? 'passive' : 'detractor';
      if (expectedGroup !== values.teacherNpsGroup) {
        errors.push({ code: 'TEACHER_SCORE_GROUP_MISMATCH', field: 'teacherExactScore', section: 6, severity: 'error', message: 'Exact score ' + tScore + ' belongs to ' + expectedGroup + ', which does not match the selected group.' });
      }
    }
  } else if (!values.teacherNpsGroup) {
    errors.push({ code: 'TEACHER_NPS_REQUIRED', field: 'teacherNpsGroup', section: 6, severity: 'error', message: "Select the teacher's NPS recommendation score or group." });
  }

  return {
    valid: errors.length === 0,
    errors: errors,
    warnings: warnings
  };
}

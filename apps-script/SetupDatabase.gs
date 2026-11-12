/**
 * SetupDatabase.gs — Idempotent Google Sheets schema initializer & formatter.
 * Run `initializeDatabase()` (or `setupForLocalSandbox()` for Apps Script Sync Bridge) once from the
 * Apps Script editor. Safe to re-run — never deletes existing data rows.
 */

var CT_PRESET_SANDBOX_SYNC_KEY = '__CT_PRESET_SYNC_KEY__';
var CT_PRESET_FACILITATOR_INTAKE_KEY = '__CT_PRESET_INTAKE_KEY__';

var CT_SCHEMA_DEFINITIONS = [
  {
    name: 'Sessions',
    headers: [
      'session_record_id',
      'session_id',
      'client_submission_key',
      'facilitator_name',
      'facilitator_email',
      'facilitator_user_id',
      'tour_id',
      'tour_name',
      'video_id',
      'language',
      'start_date',
      'end_date',
      'start_time',
      'end_time',
      'duration_minutes',
      'duration_formatted',
      'reporting_month',
      'submission_timestamp',
      'submission_date_formatted',
      'school_name',
      'udise_code',
      'school_type',
      'state',
      'district',
      'pin_code',
      'session_type',
      'total_classes',
      'total_students_present',
      'total_qa_responses',
      'total_qb_responses',
      'overall_csat',
      'overall_itp',
      'teacher_score',
      'teacher_classification',
      'teacher_nps',
      'submission_status',
      'created_at',
      'updated_at',
      'created_by',
      'updated_by',
      'archived'
    ],
    textColumns: [1, 2, 3, 11, 12, 13, 14, 18, 19, 21, 25, 36, 37, 38, 41]
  },
  {
    name: 'Session Details',
    headers: [
      'detail_record_id',
      'session_record_id',
      'session_id',
      'grade',
      'section',
      'students_present',
      'qa_score_5',
      'qa_score_4',
      'qa_score_3',
      'qa_score_2',
      'qa_score_1',
      'qa_total',
      'qa_weighted_score',
      'csat',
      'qb_score_5',
      'qb_score_4',
      'qb_score_3',
      'qb_score_2',
      'qb_score_1',
      'qb_total',
      'qb_weighted_score',
      'itp',
      'created_at',
      'updated_at'
    ],
    textColumns: [1, 2, 3, 4, 5]
  },
  {
    name: 'Facilitators',
    headers: ['user_id', 'name', 'email', 'role', 'active', 'created_at', 'updated_at', 'status'],
    textColumns: [1, 3, 4, 5, 8]
  },
  {
    name: 'Schools',
    headers: [
      'school_record_id',
      'school_name',
      'udise_code',
      'school_type',
      'state',
      'district',
      'pin_code',
      'active',
      'created_at',
      'updated_at'
    ],
    textColumns: [1, 3, 7, 8]
  },
  {
    name: 'Configuration',
    headers: ['config_key', 'config_value_json', 'updated_at', 'updated_by'],
    textColumns: [1, 2, 3, 4]
  },
  {
    name: 'Admin Users',
    headers: ['user_id', 'name', 'email', 'role', 'active', 'created_at', 'updated_at', 'status'],
    textColumns: [1, 3, 4, 5, 8]
  },
  {
    name: 'Audit Log',
    headers: [
      'audit_id',
      'timestamp',
      'user_id',
      'user_email',
      'action',
      'entity_type',
      'entity_id',
      'previous_summary',
      'new_summary',
      'result'
    ],
    textColumns: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  },
  {
    name: 'Sync Log',
    headers: [
      'sync_id',
      'timestamp',
      'client_submission_key',
      'session_record_id',
      'session_id',
      'actor_email',
      'operation',
      'attempt',
      'status',
      'error_message'
    ],
    textColumns: [1, 2, 3, 4, 5, 6, 7, 9, 10]
  }
];

var CT_COLUMN_WIDTHS_BY_HEADER = {
  session_record_id: 260,
  session_id: 300,
  client_submission_key: 260,
  facilitator_name: 175,
  facilitator_email: 225,
  facilitator_user_id: 165,
  tour_id: 110,
  tour_name: 260,
  video_id: 195,
  language: 120,
  start_date: 115,
  end_date: 115,
  start_time: 105,
  end_time: 105,
  duration_minutes: 135,
  duration_formatted: 135,
  reporting_month: 135,
  submission_timestamp: 190,
  submission_date_formatted: 175,
  school_name: 250,
  udise_code: 140,
  school_type: 205,
  state: 115,
  district: 135,
  pin_code: 115,
  session_type: 120,
  total_classes: 115,
  total_students_present: 155,
  total_qa_responses: 145,
  total_qb_responses: 145,
  overall_csat: 115,
  overall_itp: 115,
  teacher_score: 120,
  teacher_classification: 165,
  teacher_nps: 115,
  submission_status: 145,
  created_at: 185,
  updated_at: 185,
  created_by: 215,
  updated_by: 215,
  archived: 100,
  detail_record_id: 240,
  grade: 95,
  section: 115,
  students_present: 135,
  qa_score_5: 100,
  qa_score_4: 100,
  qa_score_3: 100,
  qa_score_2: 100,
  qa_score_1: 100,
  qa_total: 100,
  qa_weighted_score: 140,
  csat: 95,
  qb_score_5: 100,
  qb_score_4: 100,
  qb_score_3: 100,
  qb_score_2: 100,
  qb_score_1: 100,
  qb_total: 100,
  qb_weighted_score: 140,
  itp: 95,
  user_id: 170,
  name: 190,
  email: 245,
  role: 125,
  active: 95,
  status: 125,
  school_record_id: 185,
  config_key: 195,
  config_value_json: 560,
  audit_id: 195,
  timestamp: 185,
  user_email: 225,
  action: 185,
  entity_type: 135,
  entity_id: 220,
  previous_summary: 260,
  new_summary: 280,
  result: 115,
  sync_id: 195,
  actor_email: 225,
  operation: 175,
  attempt: 95,
  error_message: 310
};

var CT_HEADER_NOTES_BY_NAME = {
  session_record_id: 'Primary UUID (Text @). Unique internal key for each session header row.',
  session_id: 'Official Career Tours Session ID (Text @). Natural deduplication key.',
  client_submission_key: 'Client-generated UUID ensuring retry & offline idempotency.',
  udise_code: '11-digit school UDISE code stored strictly as Plain Text (@) to preserve leading zeroes.',
  pin_code: '6-digit PIN code stored strictly as Plain Text (@) to preserve leading zeroes.',
  district: 'Approved Tamil Nadu district: Cuddalore, Nagapattinam, Sivaganga.',
  total_students_present: 'Total students present in the session (single-counted; never duplicated across combined rows).',
  overall_csat: 'Weighted Q-A Student Enjoyment score (1.00–5.00): SUM(qa_weighted_score)/SUM(qa_total).',
  overall_itp: 'Weighted Q-B Career Interest score (1.00–5.00): SUM(qb_weighted_score)/SUM(qb_total).',
  teacher_nps: 'Teacher NPS weight: Promoter (9–10)=+100, Passive (7–8)=0, Detractor (0–6)=-100.',
  submission_status: 'Two-phase lock status. Only COMMITTED and CORRECTED rows enter programme analytics & exports.',
  students_present: 'Class-row attendance for a single grade/section (1:N expansion row).',
  config_value_json: 'JSON payload managed by Super Administrators. Never store passwords here.'
};

function ctColIndexToLetter_(colIdx) {
  var num = colIdx;
  var letters = '';
  while (num > 0) {
    var rem = (num - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    num = Math.floor((num - 1) / 26);
  }
  return letters || 'A';
}

function ctGetDropdownChoices_(headerName, defaults) {
  if (headerName === 'district') return (defaults && defaults.allowedDistricts) || ['Cuddalore', 'Nagapattinam', 'Sivaganga'];
  if (headerName === 'language') return (defaults && defaults.languageOptions) || ['Tamil', 'English'];
  if (headerName === 'grade') return (defaults && defaults.gradeOptions) || ['8', '9', '10', '11', '12'];
  if (headerName === 'section') return (defaults && defaults.sectionOptions) || ['A', 'B', 'C', 'D', 'E', 'F', 'No section'];
  if (headerName === 'school_type') return (defaults && defaults.schoolTypes) || [];
  if (headerName === 'session_type') return ['single', 'combined'];
  if (headerName === 'submission_status') return ['COMMITTED', 'CORRECTED', 'PENDING'];
  if (headerName === 'archived' || headerName === 'active') return ['true', 'false'];
  if (headerName === 'status') return ['APPROVED', 'PENDING', 'DENIED'];
  if (headerName === 'role') return ['super_admin', 'facilitator'];
  if (headerName === 'teacher_classification') return ['Promoter', 'Passive', 'Detractor'];
  return null;
}

function ctApplySafeHeaderStyle_(range, bgHex, fgHex) {
  range.setFontWeight('bold');
  range.setBackground(bgHex);
  range.setFontColor(fgHex);
  if (typeof range.setVerticalAlignment === 'function') range.setVerticalAlignment('middle');
  if (typeof range.setHorizontalAlignment === 'function') range.setHorizontalAlignment('left');
  if (typeof range.setWrapStrategy === 'function' && typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.WrapStrategy) {
    range.setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  }
  if (typeof range.setBorder === 'function' && typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.BorderStyle) {
    range.setBorder(true, true, true, true, true, false, '#334155', SpreadsheetApp.BorderStyle.SOLID);
    range.setBorder(null, null, true, null, null, null, '#1EA7FF', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  }
}

function ctEnhanceSheetTableStructure_(sheet, def, defaults, optForceRefreshFilter) {
  var colCount = def.headers.length;
  var headerRange = sheet.getRange(1, 1, 1, colCount);
  ctApplySafeHeaderStyle_(headerRange, '#171C24', '#F8FAFC');

  if (typeof sheet.setRowHeight === 'function') {
    try { sheet.setRowHeight(1, 34); } catch (e) {}
  }

  sheet.setFrozenRows(1);

  var maxRows = Math.max(sheet.getMaxRows(), 200);
  var isTextCol = {};
  for (var t = 0; t < def.textColumns.length; t++) {
    isTextCol[def.textColumns[t]] = true;
  }

  for (var cIdx = 1; cIdx <= colCount; cIdx++) {
    var hdr = def.headers[cIdx - 1];
    if (typeof sheet.setColumnWidth === 'function') {
      try { sheet.setColumnWidth(cIdx, CT_COLUMN_WIDTHS_BY_HEADER[hdr] || 155); } catch (eWidth) {}
    }

    if (isTextCol[cIdx]) {
      sheet.getRange(1, cIdx, maxRows, 1).setNumberFormat('@');
    } else if (hdr === 'csat' || hdr === 'itp' || hdr === 'overall_csat' || hdr === 'overall_itp') {
      sheet.getRange(2, cIdx, maxRows - 1, 1).setNumberFormat('0.00');
    }

    // Header hover note explaining validation & programme rule
    var headerCell = sheet.getRange(1, cIdx, 1, 1);
    if (typeof headerCell.setNote === 'function') {
      var noteText =
        CT_HEADER_NOTES_BY_NAME[hdr] ||
        ('Column ' + cIdx + ' (' + def.name + '): ' + hdr + (isTextCol[cIdx] ? ' [Plain Text @]' : ''));
      try { headerCell.setNote(noteText); } catch (eNote) {}
    }

    // Dropdown validation for categorical columns (rows 2..min(maxRows,500))
    var choices = ctGetDropdownChoices_(hdr, defaults);
    if (
      choices &&
      choices.length > 0 &&
      typeof SpreadsheetApp !== 'undefined' &&
      typeof SpreadsheetApp.newDataValidation === 'function'
    ) {
      try {
        var rule = SpreadsheetApp.newDataValidation()
          .requireValueInList(choices, true)
          .setAllowInvalid(true)
          .setHelpText('Allowed values: ' + choices.join(', '))
          .build();
        sheet.getRange(2, cIdx, Math.min(maxRows - 1, 499), 1).setDataValidation(rule);
      } catch (eDv) {}
    }
  }

  // Wrap JSON values neatly inside Configuration without expanding rows prematurely
  if (def.name === 'Configuration' && maxRows >= 2) {
    var cfgValRange = sheet.getRange(2, 2, maxRows - 1, 1);
    if (typeof cfgValRange.setWrapStrategy === 'function' && typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.WrapStrategy) {
      try { cfgValRange.setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP); } catch (eWrap) {}
    }
  }

  // Native Google Sheets Filter across headers + data range
  if (typeof sheet.getFilter === 'function') {
    var existingFilter = sheet.getFilter();
    if (existingFilter && optForceRefreshFilter) {
      try { existingFilter.remove(); } catch (eRmFilter) {}
      existingFilter = null;
    }
    if (!existingFilter) {
      try {
        var filterRows = Math.max(sheet.getLastRow(), 2);
        sheet.getRange(1, 1, filterRows, colCount).createFilter();
      } catch (eFilter) {}
    }
  }

  // Subtle zebra banding (created once idempotently)
  if (
    typeof sheet.getBandings === 'function' &&
    sheet.getBandings().length === 0 &&
    typeof SpreadsheetApp !== 'undefined' &&
    SpreadsheetApp.BandingTheme
  ) {
    try {
      var bandingRange = sheet.getRange(1, 1, Math.min(maxRows, 500), colCount);
      var banding = bandingRange.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false);
      if (banding && typeof banding.setHeaderRowColor === 'function') {
        banding.setHeaderRowColor('#171C24');
        banding.setFirstRowColor('#FFFFFF');
        banding.setSecondRowColor('#F8FAFC');
      }
    } catch (eBand) {}
  }
}

function ctRefreshSummaryAndKpisSheet_(ss, defaults) {
  var sheet = ss.getSheetByName('Summary & KPIs');
  if (!sheet) {
    sheet = ss.insertSheet('Summary & KPIs');
  }
  if (typeof sheet.getFilter === 'function' && sheet.getFilter()) {
    try { sheet.getFilter().remove(); } catch (eF) {}
  }

  var sDef = CT_SCHEMA_DEFINITIONS[0]; // Sessions
  var dDef = CT_SCHEMA_DEFINITIONS[1]; // Session Details
  var sCol = function (name) { return ctColIndexToLetter_(sDef.headers.indexOf(name) + 1); };
  var dCol = function (name) { return ctColIndexToLetter_(dDef.headers.indexOf(name) + 1); };

  var sStatus = sCol('submission_status');
  var sArch = sCol('archived');
  var sStudents = sCol('total_students_present');
  var sDistrict = sCol('district');
  var sTourId = sCol('tour_id');
  var sLang = sCol('language');
  var sCsat = sCol('overall_csat');
  var sItp = sCol('overall_itp');
  var sNps = sCol('teacher_nps');

  var dGrade = dCol('grade');
  var dStud = dCol('students_present');
  var dQaTot = dCol('qa_total');
  var dQaW = dCol('qa_weighted_score');
  var dQbTot = dCol('qb_total');
  var dQbW = dCol('qb_weighted_score');
  var R = 2500;

  var rows = [];
  var rowTypes = []; // 'banner' | 'subtitle' | 'spacer' | 'section' | 'subheader' | 'data' | 'total'

  rows.push(['Vidhya Vidhai · Career Tours Programme Summary & Live KPIs', '', '', '', '', '', '', '']);
  rowTypes.push('banner');
  rows.push([
    'State: ' + defaults.stateName + ' · Approved Districts: ' + defaults.allowedDistricts.join(', ') + ' · Timezone: ' + defaults.programmeTimezone + ' · Live Formulas referencing Sessions & Session Details',
    '', '', '', '', '', '', ''
  ]);
  rowTypes.push('subtitle');
  rows.push(['', '', '', '', '', '', '', '']);
  rowTypes.push('spacer');

  rows.push(['1. Official Programme Key Performance Indicators (Live Formulas)', '', '', '', '', '', '', '']);
  rowTypes.push('section');
  rows.push(['Metric Code', 'Programme Indicator', 'Live Value', 'Unit / Scale', 'Formula Declaration', '', '', '']);
  rowTypes.push('subheader');

  var kpiItems = [
    ['KPI-01', 'Total Committed Sessions', '=IFERROR(COUNTIFS(Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)', 'Sessions', 'Counts Sessions where submission_status <> PENDING and archived = false'],
    ['KPI-02', 'Total Students Reached (Single-Counted)', '=IFERROR(SUMIFS(Sessions!' + sStudents + '2:' + sStudents + R + ',Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)', 'Students', 'Single-counted attendance across committed non-archived sessions'],
    ['KPI-03', 'Total Class Groups Covered', "=IFERROR(COUNTA('Session Details'!A2:A" + R + '),0)', 'Class rows', 'Expanded 1:N grade/section rows in Session Details'],
    ['KPI-04', 'Registered Canonical Schools', '=IFERROR(COUNTA(Schools!A2:A' + R + '),0)', 'Schools', 'Canonical 11-digit UDISE schools in Schools tab'],
    ['KPI-05', 'Approved Facilitators', '=IFERROR(COUNTIF(Facilitators!H2:H' + R + ',"APPROVED"),0)', 'Accounts', 'Approved facilitator rows in Facilitators tab'],
    ['KPI-06', 'Protected / Approved Super Admins', "=IFERROR(COUNTIF('Admin Users'!H2:H" + R + ',"APPROVED"),0)', 'Accounts', 'Approved Super Administrators in Admin Users tab'],
    ['KPI-07', 'Pooled Student CSAT (Q-A Enjoyment)', "=IFERROR(SUM('Session Details'!" + dQaW + '2:' + dQaW + R + ")/SUM('Session Details'!" + dQaTot + '2:' + dQaTot + R + '),0)', '1.00–5.00', 'SUM(qa_weighted_score) / SUM(qa_total)'],
    ['KPI-08', 'Pooled Student ITP (Q-B Career Interest)', "=IFERROR(SUM('Session Details'!" + dQbW + '2:' + dQbW + R + ")/SUM('Session Details'!" + dQbTot + '2:' + dQbTot + R + '),0)', '1.00–5.00', 'SUM(qb_weighted_score) / SUM(qb_total)'],
    ['KPI-09', 'Pooled Teacher NPS (-100 to +100)', '=IFERROR(AVERAGEIFS(Sessions!' + sNps + '2:' + sNps + R + ',Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)', 'NPS Index', 'Mean session teacher_nps (+100 / 0 / -100)'],
    ['KPI-10', 'Question A Response Coverage Rate', "=IFERROR(SUM('Session Details'!" + dQaTot + '2:' + dQaTot + R + ")/SUM('Session Details'!" + dStud + '2:' + dStud + R + '),0)', 'Percentage', 'SUM(qa_total) / SUM(students_present)']
  ];
  for (var k = 0; k < kpiItems.length; k++) {
    rows.push([kpiItems[k][0], kpiItems[k][1], kpiItems[k][2], kpiItems[k][3], kpiItems[k][4], '', '', '']);
    rowTypes.push('data');
  }

  rows.push(['', '', '', '', '', '', '', '']);
  rowTypes.push('spacer');
  rows.push(['2. Approved District-wise Programme Reach (Tamil Nadu)', '', '', '', '', '', '', '']);
  rowTypes.push('section');
  rows.push(['District', 'State', 'School Year', 'Sessions', 'Students Reached', 'Avg CSAT', 'Avg ITP', 'Avg Teacher NPS']);
  rowTypes.push('subheader');

  var distStartRow = rows.length + 1;
  for (var d = 0; d < defaults.allowedDistricts.length; d++) {
    var distName = defaults.allowedDistricts[d];
    var rNum = rows.length + 1;
    rows.push([
      distName,
      defaults.stateName,
      defaults.schoolYear,
      '=IFERROR(COUNTIFS(Sessions!' + sDistrict + '2:' + sDistrict + R + ',A' + rNum + ',Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)',
      '=IFERROR(SUMIFS(Sessions!' + sStudents + '2:' + sStudents + R + ',Sessions!' + sDistrict + '2:' + sDistrict + R + ',A' + rNum + ',Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)',
      '=IFERROR(AVERAGEIFS(Sessions!' + sCsat + '2:' + sCsat + R + ',Sessions!' + sDistrict + '2:' + sDistrict + R + ',A' + rNum + ',Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)',
      '=IFERROR(AVERAGEIFS(Sessions!' + sItp + '2:' + sItp + R + ',Sessions!' + sDistrict + '2:' + sDistrict + R + ',A' + rNum + ',Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)',
      '=IFERROR(AVERAGEIFS(Sessions!' + sNps + '2:' + sNps + R + ',Sessions!' + sDistrict + '2:' + sDistrict + R + ',A' + rNum + ',Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)'
    ]);
    rowTypes.push('data');
  }
  var distEndRow = rows.length;
  rows.push([
    'Total / Pooled',
    defaults.stateName,
    defaults.schoolYear,
    '=SUM(D' + distStartRow + ':D' + distEndRow + ')',
    '=SUM(E' + distStartRow + ':E' + distEndRow + ')',
    "=IFERROR(SUM('Session Details'!" + dQaW + '2:' + dQaW + R + ")/SUM('Session Details'!" + dQaTot + '2:' + dQaTot + R + '),0)',
    "=IFERROR(SUM('Session Details'!" + dQbW + '2:' + dQbW + R + ")/SUM('Session Details'!" + dQbTot + '2:' + dQbTot + R + '),0)',
    '=IFERROR(AVERAGEIFS(Sessions!' + sNps + '2:' + sNps + R + ',Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)'
  ]);
  rowTypes.push('total');

  rows.push(['', '', '', '', '', '', '', '']);
  rowTypes.push('spacer');
  rows.push(['3. Career Tours Catalog & Delivery Breakdown', '', '', '', '', '', '', '']);
  rowTypes.push('section');
  rows.push(['Tour ID', 'Career Tour Name', 'Code', 'Active', 'Tamil Video ID', 'Sessions', 'Students Reached', 'Avg CSAT']);
  rowTypes.push('subheader');

  for (var tIdx = 0; tIdx < defaults.tours.length; tIdx++) {
    var tr = defaults.tours[tIdx];
    var trNum = rows.length + 1;
    rows.push([
      tr.tourId,
      tr.tourName,
      tr.tourCode,
      tr.active ? 'Active' : 'Inactive',
      (tr.videoIdByLanguage && tr.videoIdByLanguage.Tamil) || 'Pending',
      '=IFERROR(COUNTIFS(Sessions!' + sTourId + '2:' + sTourId + R + ',A' + trNum + ',Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)',
      '=IFERROR(SUMIFS(Sessions!' + sStudents + '2:' + sStudents + R + ',Sessions!' + sTourId + '2:' + sTourId + R + ',A' + trNum + ',Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)',
      '=IFERROR(AVERAGEIFS(Sessions!' + sCsat + '2:' + sCsat + R + ',Sessions!' + sTourId + '2:' + sTourId + R + ',A' + trNum + ',Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)'
    ]);
    rowTypes.push('data');
  }

  rows.push(['', '', '', '', '', '', '', '']);
  rowTypes.push('spacer');
  rows.push(['4. Grade-wise & Language Breakdown (Live Formulas)', '', '', '', '', '', '', '']);
  rowTypes.push('section');
  rows.push(['Dimension', 'Category', 'Value Key', 'Class / Session Count', 'Students Reached', 'Avg CSAT', '', '']);
  rowTypes.push('subheader');

  for (var gIdx = 0; gIdx < defaults.gradeOptions.length; gIdx++) {
    var gr = defaults.gradeOptions[gIdx];
    var gRowNum = rows.length + 1;
    rows.push([
      'Grade',
      'Grade ' + gr,
      gr,
      "=IFERROR(COUNTIF('Session Details'!" + dGrade + '2:' + dGrade + R + ',C' + gRowNum + '),0)',
      "=IFERROR(SUMIF('Session Details'!" + dGrade + '2:' + dGrade + R + ',C' + gRowNum + ",'Session Details'!" + dStud + '2:' + dStud + R + '),0)',
      "=IFERROR(SUMIF('Session Details'!" + dGrade + '2:' + dGrade + R + ',C' + gRowNum + ",'Session Details'!" + dQaW + '2:' + dQaW + R + ")/SUMIF('Session Details'!" + dGrade + '2:' + dGrade + R + ',C' + gRowNum + ",'Session Details'!" + dQaTot + '2:' + dQaTot + R + '),0)',
      '',
      ''
    ]);
    rowTypes.push('data');
  }
  for (var lIdx = 0; lIdx < defaults.languageOptions.length; lIdx++) {
    var lg = defaults.languageOptions[lIdx];
    var lRowNum = rows.length + 1;
    rows.push([
      'Language',
      lg,
      (defaults.languageCodes && defaults.languageCodes[lg]) || lg.slice(0, 2).toUpperCase(),
      '=IFERROR(COUNTIFS(Sessions!' + sLang + '2:' + sLang + R + ',B' + lRowNum + ',Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)',
      '=IFERROR(SUMIFS(Sessions!' + sStudents + '2:' + sStudents + R + ',Sessions!' + sLang + '2:' + sLang + R + ',B' + lRowNum + ',Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)',
      '=IFERROR(AVERAGEIFS(Sessions!' + sCsat + '2:' + sCsat + R + ',Sessions!' + sLang + '2:' + sLang + R + ',B' + lRowNum + ',Sessions!' + sStatus + '2:' + sStatus + R + ',"<>PENDING",Sessions!' + sArch + '2:' + sArch + R + ',"false"),0)',
      '',
      ''
    ]);
    rowTypes.push('data');
  }

  var existingLastRow = Math.max(sheet.getLastRow(), rows.length);
  if (existingLastRow > 0) {
    var clearRng = sheet.getRange(1, 1, existingLastRow, 8);
    if (typeof clearRng.clearContent === 'function') clearRng.clearContent();
  }

  sheet.getRange(1, 1, rows.length, 8).setValues(rows);
  sheet.setFrozenRows(2);

  var summaryWidths = [165, 290, 155, 130, 340, 125, 135, 135];
  if (typeof sheet.setColumnWidth === 'function') {
    for (var w = 0; w < summaryWidths.length; w++) {
      try { sheet.setColumnWidth(w + 1, summaryWidths[w]); } catch (eSw) {}
    }
  }

  for (var rIdx = 0; rIdx < rowTypes.length; rIdx++) {
    var rowRange = sheet.getRange(rIdx + 1, 1, 1, 8);
    var kind = rowTypes[rIdx];
    if (kind === 'banner') {
      rowRange.setBackground('#0B1220');
      rowRange.setFontColor('#F8FAFC');
      rowRange.setFontWeight('bold');
      if (typeof rowRange.setFontSize === 'function') rowRange.setFontSize(13);
      if (typeof rowRange.mergeAcross === 'function') {
        try { rowRange.mergeAcross(); } catch (eM1) {}
      }
    } else if (kind === 'subtitle') {
      rowRange.setBackground('#E8F6FF');
      rowRange.setFontColor('#006BB8');
      if (typeof rowRange.mergeAcross === 'function') {
        try { rowRange.mergeAcross(); } catch (eM2) {}
      }
    } else if (kind === 'section') {
      rowRange.setBackground('#F0F4F8');
      rowRange.setFontColor('#0A1B2C');
      rowRange.setFontWeight('bold');
      if (typeof rowRange.mergeAcross === 'function') {
        try { rowRange.mergeAcross(); } catch (eM3) {}
      }
    } else if (kind === 'subheader') {
      ctApplySafeHeaderStyle_(rowRange, '#171C24', '#F8FAFC');
    } else if (kind === 'total') {
      rowRange.setBackground('#EFF6FF');
      rowRange.setFontColor('#0A1B2C');
      rowRange.setFontWeight('bold');
    } else if (kind === 'data') {
      rowRange.setBackground(rIdx % 2 === 1 ? '#F8FAFC' : '#FFFFFF');
      rowRange.setFontColor('#0A1B2C');
      rowRange.setFontWeight('normal');
    }
  }
}

function ctRefreshDeclarationsSheet_(ss, defaults) {
  var sheet = ss.getSheetByName('Declarations');
  if (!sheet) {
    sheet = ss.insertSheet('Declarations');
  }

  var headers = [
    'declaration_category',
    'target_tab_or_scope',
    'ref_or_col_num',
    'field_or_rule_key',
    'display_title',
    'type_format_or_formula',
    'validation_and_official_declaration'
  ];

  var initialAdmins = ctGetInitialSuperAdmins_().map(function (a) { return a.email; }).join(', ');
  var declRows = [
    headers,
    [
      'Programme Governance',
      'ALL_TABS',
      'GOV-01',
      'GOV-01',
      'Approved Geography & Timezone',
      'State: ' + defaults.stateName + ' · Districts: ' + defaults.allowedDistricts.join(', ') + ' · TZ: ' + defaults.programmeTimezone,
      'Only schools within Tamil Nadu and approved districts (Cuddalore, Nagapattinam, Sivaganga) are valid. All dates use Asia/Kolkata (IST).'
    ],
    [
      'Programme Governance',
      'ALL_TABS',
      'GOV-02',
      'GOV-02',
      'Protected Super Administrators & RBAC',
      initialAdmins,
      'Only allowlisted Super Administrators may connect sheets, alter Configuration, archive/restore records, delete data, or export official .xlsx files. Zero passwords are stored.'
    ],
    [
      'Programme Governance',
      'ALL_TABS',
      'GOV-03',
      'GOV-03',
      'Zero Fabricated Data Policy',
      'Empty initial DB tables (0 sample classrooms, 0 fabricated partners)',
      'Core database tabs contain no sample/dummy session rows. Summary & KPIs live formulas cleanly evaluate to 0 until genuine sessions are committed.'
    ],
    [
      'Metric Formula',
      'Sessions / Session Details',
      'MET-01',
      'MET-01',
      'Pooled Student CSAT (Question A)',
      'CSAT = SUM(qa_weighted_score) / SUM(qa_total)',
      'Scale 1.00–5.00. Weighted across all student respondents, never an unweighted average of class averages.'
    ],
    [
      'Metric Formula',
      'Sessions / Session Details',
      'MET-02',
      'MET-02',
      'Pooled Student ITP (Question B)',
      'ITP = SUM(qb_weighted_score) / SUM(qb_total)',
      'Scale 1.00–5.00. Weighted across all Question B respondents on committed non-archived rows.'
    ],
    [
      'Metric Formula',
      'Sessions',
      'MET-03',
      'MET-03',
      'Teacher Net Promoter Score (Teacher NPS)',
      'Promoter (9–10)=+100, Passive (7–8)=0, Detractor (0–6)=-100 · AVERAGE(teacher_nps)',
      'Evaluated once per unique classroom session header (never double-weighted across combined classes).'
    ],
    [
      'Metric Formula',
      'Sessions -> Session Details',
      'MET-04',
      'MET-04',
      'Combined-Class 1:N Expansion & Single Counting',
      '1 Session Header -> N Session Details rows',
      'Each Grade/Section row holds its own attendance and Q-A/Q-B votes so attendance totals never double-count.'
    ],
    [
      'Data Integrity',
      'Sessions / Schools',
      'INT-01',
      'INT-01',
      'Plain Text (@) Leading-Zero Preservation',
      'numFmt = "@" on udise_code (11 chars), pin_code (6 chars), session_id, dates & times',
      'Protects leading zeroes on UDISE codes, PIN codes, and ISO/DD-MM-YYYY date strings in Google Sheets & Excel.'
    ],
    [
      'Data Integrity',
      'Sessions / Sync Log / Audit Log',
      'INT-02',
      'INT-02',
      'Atomic LockService Two-Phase Commit & 3-Key Deduplication',
      'Unique keys: session_record_id + session_id + client_submission_key',
      'Two-phase write (PENDING -> COMMITTED/CORRECTED) inside ScriptLock prevents duplicates on retries and logs every mutation.'
    ]
  ];

  // Append column-by-column Data Dictionary across all 8 schema tabs
  for (var t = 0; t < CT_SCHEMA_DEFINITIONS.length; t++) {
    var tabDef = CT_SCHEMA_DEFINITIONS[t];
    var textSet = {};
    for (var tc = 0; tc < tabDef.textColumns.length; tc++) textSet[tabDef.textColumns[tc]] = true;
    for (var h = 0; h < tabDef.headers.length; h++) {
      var colNum = h + 1;
      var colLetter = ctColIndexToLetter_(colNum);
      var hdrName = tabDef.headers[h];
      var isTxt = Boolean(textSet[colNum]);
      declRows.push([
        'Data Dictionary (' + tabDef.name + ')',
        tabDef.name,
        'Col ' + colNum + ' (' + colLetter + ')',
        hdrName,
        hdrName.replace(/_/g, ' ').replace(/\b\w/g, function (ch) { return ch.toUpperCase(); }),
        isTxt ? 'Plain Text (@)' : 'Numeric / Decimal',
        CT_HEADER_NOTES_BY_NAME[hdrName] || ('Canonical field in "' + tabDef.name + '" tab.')
      ]);
    }
  }

  var existingLast = Math.max(sheet.getLastRow(), declRows.length);
  if (existingLast > 0) {
    var clr = sheet.getRange(1, 1, existingLast, headers.length);
    if (typeof clr.clearContent === 'function') clr.clearContent();
  }

  var fullRng = sheet.getRange(1, 1, declRows.length, headers.length);
  fullRng.setNumberFormat('@');
  fullRng.setValues(declRows);
  if (typeof fullRng.setWrapStrategy === 'function' && typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.WrapStrategy) {
    try { fullRng.setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP); } catch (eW) {}
  }

  ctApplySafeHeaderStyle_(sheet.getRange(1, 1, 1, headers.length), '#171C24', '#F8FAFC');
  sheet.setFrozenRows(1);

  var widths = [175, 165, 110, 210, 225, 250, 440];
  if (typeof sheet.setColumnWidth === 'function') {
    for (var wi = 0; wi < widths.length; wi++) {
      try { sheet.setColumnWidth(wi + 1, widths[wi]); } catch (eDw) {}
    }
  }
  if (typeof sheet.getFilter === 'function' && !sheet.getFilter()) {
    try { sheet.getRange(1, 1, declRows.length, headers.length).createFilter(); } catch (eDf) {}
  }
}

function ctInitializeSpreadsheetObject_(ss, optActorEmail) {
  if (!ss) {
    throw ctApiError_('INVALID_SPREADSHEET', 'A valid Google Spreadsheet instance is required.');
  }
  var actorLabel = String(optActorEmail || 'SYSTEM_INIT');
  var nowIso = ctNowIso_();
  var initializedTabs = [];
  var defaults = ctDefaultConfigObject_();

  for (var i = 0; i < CT_SCHEMA_DEFINITIONS.length; i++) {
    var def = CT_SCHEMA_DEFINITIONS[i];
    var sheet = ss.getSheetByName(def.name);
    if (!sheet) {
      sheet = ss.insertSheet(def.name);
    }

    // Set headers cleanly in row 1 if blank, migrate legacy 'block' column non-destructively, or append missing trailing columns safely
    var lastCol =
      typeof sheet.getLastColumn === 'function' ? sheet.getLastColumn() : def.headers.length + 1;
    var probeWidth = Math.max(def.headers.length, lastCol);
    var existingHeaders = sheet.getRange(1, 1, 1, probeWidth).getValues()[0];
    var hasHeader = String(existingHeaders[0] || '').trim() !== '';
    var migratedSchema = false;

    if (!hasHeader) {
      var headerRange = sheet.getRange(1, 1, 1, def.headers.length);
      headerRange.setValues([def.headers]);
    } else {
      if (def.name === 'Sessions' || def.name === 'Schools') {
        var blockColIdx = -1;
        for (var hIdx = 0; hIdx < existingHeaders.length; hIdx++) {
          if (String(existingHeaders[hIdx] || '').trim().toLowerCase() === 'block') {
            blockColIdx = hIdx;
            break;
          }
        }
        if (blockColIdx !== -1 && typeof sheet.deleteColumn === 'function') {
          if (typeof sheet.getFilter === 'function' && sheet.getFilter()) {
            try { sheet.getFilter().remove(); } catch (eFlt) {}
          }
          sheet.deleteColumn(blockColIdx + 1);
          sheet.getRange(1, 1, 1, def.headers.length).setValues([def.headers]);
          migratedSchema = true;
        }
      }
      if (!migratedSchema && def.headers.length >= 8 && String(existingHeaders[7] || '').trim() === '') {
        sheet.getRange(1, 8, 1, 1).setValue(def.headers[7]);
      }
    }

    ctEnhanceSheetTableStructure_(sheet, def, defaults, migratedSchema);
    initializedTabs.push(def.name);
  }

  // Create & refresh live formula Summary & KPIs + comprehensive Declarations tabs
  ctRefreshSummaryAndKpisSheet_(ss, defaults);
  ctRefreshDeclarationsSheet_(ss, defaults);

  // Seed default configuration keys ONLY if missing (never overwrite custom admin edits)
  var cfgSheet = ss.getSheetByName(SHEET_NAMES.CONFIGURATION);
  var existingKeys = {};
  if (cfgSheet.getLastRow() >= 2) {
    var col = cfgSheet.getRange(2, 1, cfgSheet.getLastRow() - 1, 1).getValues();
    var legacyRows = [];
    for (var r = 0; r < col.length; r++) {
      var k = String(col[r][0] || '').trim();
      if (k === 'district_blocks') {
        legacyRows.push(r + 2);
        continue;
      }
      if (k) existingKeys[k] = true;
    }
    for (var dr = legacyRows.length - 1; dr >= 0; dr--) {
      cfgSheet.deleteRow(legacyRows[dr]);
    }
  }

  var seedPairs = [
    ['programme_timezone', defaults.programmeTimezone],
    ['state_name', defaults.stateName],
    ['allowed_districts', defaults.allowedDistricts],
    ['grade_options', defaults.gradeOptions],
    ['section_options', defaults.sectionOptions],
    ['school_types', defaults.schoolTypes],
    ['tours', defaults.tours],
    ['language_options', defaults.languageOptions],
    ['language_codes', defaults.languageCodes],
    ['school_year', defaults.schoolYear],
    ['partner_name', defaults.partnerName],
    ['reporting_defaults', defaults.reportingDefaults],
    ['policy', defaults.policy]
  ];

  for (var sIdx = 0; sIdx < seedPairs.length; sIdx++) {
    if (!existingKeys[seedPairs[sIdx][0]]) {
      ctUpsertConfigKey_(cfgSheet, seedPairs[sIdx][0], seedPairs[sIdx][1], actorLabel);
    }
  }

  // Idempotently ensure protected allowlisted SUPER_ADMIN accounts exist in Admin Users (zero passwords stored)
  var initialSuperAdmins = ctGetInitialSuperAdmins_();
  var adminSheet = ss.getSheetByName(SHEET_NAMES.ADMIN_USERS);
  var existingAdmins = [];
  var adminLastRow = adminSheet.getLastRow();
  if (adminLastRow >= 2) {
    var adminVals = adminSheet.getRange(2, 1, adminLastRow - 1, 8).getValues();
    for (var av = 0; av < adminVals.length; av++) {
      var admRow = adminVals[av];
      var admEmail = String(admRow[2] || '').trim().toLowerCase();
      if (!admEmail) continue;
      var activeRaw = admRow[4];
      var activeBool =
        activeRaw === true ||
        String(activeRaw).trim().toLowerCase() === 'true' ||
        String(activeRaw).trim() === '1';
      existingAdmins.push({
        rowNumber: av + 2,
        userId: String(admRow[0] || '').trim(),
        name: String(admRow[1] || '').trim(),
        email: admEmail,
        role: String(admRow[3] || '').trim().toLowerCase(),
        active: activeBool,
        createdAt: String(admRow[5] || ''),
        status: String(admRow[7] || '').trim().toUpperCase()
      });
    }
  }

  for (var saIdx = 0; saIdx < initialSuperAdmins.length; saIdx++) {
    var sa = initialSuperAdmins[saIdx];
    var matchedRow = null;
    for (var aIdx = 0; aIdx < existingAdmins.length; aIdx++) {
      if (existingAdmins[aIdx].email === sa.email) {
        matchedRow = existingAdmins[aIdx];
        break;
      }
    }

    if (!matchedRow) {
      var nextRow = Math.max(2, ctFindLastPopulatedRow_(adminSheet, 1) + 1);
      var admRange = adminSheet.getRange(nextRow, 1, 1, 8);
      admRange.setNumberFormat('@');
      admRange.setValues([[
        sa.userId,
        sa.name,
        sa.email,
        'super_admin',
        'true',
        nowIso,
        nowIso,
        'APPROVED'
      ]]);
    } else if (
      matchedRow.role !== 'super_admin' ||
      !matchedRow.active ||
      matchedRow.status !== 'APPROVED'
    ) {
      var repairRange = adminSheet.getRange(matchedRow.rowNumber, 1, 1, 8);
      repairRange.setNumberFormat('@');
      repairRange.setValues([[
        matchedRow.userId || sa.userId,
        matchedRow.name || sa.name,
        sa.email,
        'super_admin',
        'true',
        matchedRow.createdAt || nowIso,
        nowIso,
        'APPROVED'
      ]]);
    }
  }

  ctInvalidateConfigCache_();
  return initializedTabs;
}

function initializeDatabase() {
  var ss = ctGetSpreadsheet_();
  ctInitializeSpreadsheetObject_(ss, 'SYSTEM_INIT');
  return 'Career Tours database initialized cleanly at ' + ctNowIso_();
}

/**
 * One-click initializer for the Apps Script Sync Bridge.
 * Sets `SANDBOX_SYNC_KEY` in Script Properties (using custom key, copied preset key, or fresh key),
 * initializes all 10 tabs (8 schema tabs + Summary & KPIs + Declarations) on the connected/bound
 * spreadsheet (or creates a dedicated spreadsheet automatically for standalone scripts),
 * and records connection metadata without storing any secret inside any sheet cell.
 */
function setupForLocalSandbox(optionalCustomSyncKey, optionalSpreadsheetUrlOrId, optionalCustomIntakeKey) {
  var presetKey =
    typeof CT_PRESET_SANDBOX_SYNC_KEY !== 'undefined' ? String(CT_PRESET_SANDBOX_SYNC_KEY || '').trim() : '';
  var placeholder = '__CT_PRESET_' + 'SYNC_KEY__';
  var chosenKey = '';
  if (optionalCustomSyncKey && String(optionalCustomSyncKey).trim()) {
    chosenKey = String(optionalCustomSyncKey).trim();
  } else if (presetKey && presetKey !== placeholder) {
    chosenKey = presetKey;
  }

  var presetIntakeKey =
    typeof CT_PRESET_FACILITATOR_INTAKE_KEY !== 'undefined'
      ? String(CT_PRESET_FACILITATOR_INTAKE_KEY || '').trim()
      : '';
  var intakePlaceholder = '__CT_PRESET_' + 'INTAKE_KEY__';
  var chosenIntakeKey = '';
  if (optionalCustomIntakeKey && String(optionalCustomIntakeKey).trim()) {
    chosenIntakeKey = String(optionalCustomIntakeKey).trim();
  } else if (presetIntakeKey && presetIntakeKey !== intakePlaceholder) {
    chosenIntakeKey = presetIntakeKey;
  }

  var syncKey = ctConfigureSandboxSyncKey_(chosenKey);
  var intakeKey =
    typeof ctConfigureFacilitatorIntakeKey_ === 'function'
      ? ctConfigureFacilitatorIntakeKey_(chosenIntakeKey)
      : '';
  var props = PropertiesService.getScriptProperties();
  var explicitTargetId = ctParseSpreadsheetId_(optionalSpreadsheetUrlOrId);
  var ss = null;

  if (explicitTargetId) {
    ss = SpreadsheetApp.openById(explicitTargetId);
  } else {
    try {
      ss = ctGetSpreadsheet_();
    } catch (err) {
      ss = SpreadsheetApp.create('Vidhya Vidhai · Career Tours Database');
    }
  }

  var initializedTabs = ctInitializeSpreadsheetObject_(ss, 'SYSTEM_LOCAL_SANDBOX_SETUP');
  var resolvedId =
    typeof ss.getId === 'function' && ss.getId()
      ? ss.getId()
      : explicitTargetId || '';
  var ssName =
    typeof ss.getName === 'function' && ss.getName()
      ? ss.getName()
      : 'Vidhya Vidhai · Career Tours Database';
  var ssUrl =
    typeof ss.getUrl === 'function' && ss.getUrl()
      ? ss.getUrl()
      : resolvedId
      ? 'https://docs.google.com/spreadsheets/d/' + resolvedId + '/edit'
      : '';

  if (resolvedId && typeof props.setProperty === 'function') {
    props.setProperty('CONNECTED_SPREADSHEET_ID', resolvedId);
    props.setProperty('CONNECTED_SPREADSHEET_NAME', ssName);
    props.setProperty('CONNECTED_SPREADSHEET_URL', ssUrl);
    props.setProperty('CONNECTED_DISCONNECTED', 'false');
    props.setProperty('CONNECTED_TABS_JSON', JSON.stringify(initializedTabs));
  }

  if (typeof Logger !== 'undefined' && typeof Logger.log === 'function') {
    Logger.log(
      'Apps Script Sync Bridge ready. Spreadsheet: ' +
        ssName +
        ' (' +
        ssUrl +
        ') | Tabs: ' +
        initializedTabs.join(', ') +
        ' | SANDBOX_SYNC_KEY configured (length=' +
        syncKey.length +
        ') | FACILITATOR_INTAKE_KEY configured (length=' +
        intakeKey.length +
        ').'
    );
  }

  return {
    ok: true,
    syncKeyConfigured: true,
    syncKeyLength: syncKey.length,
    intakeKeyConfigured: Boolean(intakeKey && intakeKey.length >= 16),
    intakeKeyLength: intakeKey ? intakeKey.length : 0,
    spreadsheetId: resolvedId,
    spreadsheetName: ssName,
    spreadsheetUrl: ssUrl,
    initializedTabs: initializedTabs
  };
}

/**
 * SetupDatabase.gs — Idempotent Google Sheets schema initializer & formatter.
 * Run `initializeDatabase()` once from the Apps Script editor after configuring `SPREADSHEET_ID`
 * (or running inside a bound spreadsheet). Safe to re-run — never deletes existing data rows.
 */

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
      'block',
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
    textColumns: [1, 2, 3, 11, 12, 13, 14, 18, 19, 21, 26, 37, 38, 39, 42]
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
      'block',
      'pin_code',
      'active',
      'created_at',
      'updated_at'
    ],
    textColumns: [1, 3, 8, 9]
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

function initializeDatabase() {
  var ss = ctGetSpreadsheet_();
  var nowIso = ctNowIso_();

  for (var i = 0; i < CT_SCHEMA_DEFINITIONS.length; i++) {
    var def = CT_SCHEMA_DEFINITIONS[i];
    var sheet = ss.getSheetByName(def.name);
    if (!sheet) {
      sheet = ss.insertSheet(def.name);
    }

    // Set headers cleanly in row 1 if blank, or append missing trailing columns safely
    var existingHeaders = sheet.getRange(1, 1, 1, def.headers.length).getValues()[0];
    var hasHeader = String(existingHeaders[0] || '').trim() !== '';
    if (!hasHeader) {
      var headerRange = sheet.getRange(1, 1, 1, def.headers.length);
      headerRange.setValues([def.headers]);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#171C24');
      headerRange.setFontColor('#F5F6F7');
    } else if (def.headers.length >= 8 && String(existingHeaders[7] || '').trim() === '') {
      var statusColHeader = sheet.getRange(1, 8, 1, 1);
      statusColHeader.setValue(def.headers[7]);
      statusColHeader.setFontWeight('bold');
      statusColHeader.setBackground('#171C24');
      statusColHeader.setFontColor('#F5F6F7');
    }

    sheet.setFrozenRows(1);

    // Format ID, date, UDISE, PIN columns as plain text (@) across column capacity so leading zeroes stay intact
    var maxRows = Math.max(sheet.getMaxRows(), 200);
    for (var c = 0; c < def.textColumns.length; c++) {
      var colIdx = def.textColumns[c];
      sheet.getRange(1, colIdx, maxRows, 1).setNumberFormat('@');
    }
  }

  // Seed default configuration keys ONLY if missing (never overwrite custom admin edits)
  var cfgSheet = ss.getSheetByName(SHEET_NAMES.CONFIGURATION);
  var existingKeys = {};
  if (cfgSheet.getLastRow() >= 2) {
    var col = cfgSheet.getRange(2, 1, cfgSheet.getLastRow() - 1, 1).getValues();
    for (var r = 0; r < col.length; r++) {
      var k = String(col[r][0] || '').trim();
      if (k) existingKeys[k] = true;
    }
  }

  var defaults = ctDefaultConfigObject_();
  var seedPairs = [
    ['programme_timezone', defaults.programmeTimezone],
    ['state_name', defaults.stateName],
    ['allowed_districts', defaults.allowedDistricts],
    ['district_blocks', defaults.districtBlocks],
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
      ctUpsertConfigKey_(cfgSheet, seedPairs[sIdx][0], seedPairs[sIdx][1], 'SYSTEM_INIT');
    }
  }

  // Idempotently ensure the two protected initial SUPER_ADMIN accounts exist in Admin Users (zero passwords stored)
  var initialSuperAdmins = ctGetInitialSuperAdmins_();
  var adminSheet = ss.getSheetByName(SHEET_NAMES.ADMIN_USERS);
  var existingAdmins = ctReadUserRowsFromSheet_(SHEET_NAMES.ADMIN_USERS);

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
      var nextRow = Math.max(2, adminSheet.getLastRow() + 1);
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
  return 'Career Tours database initialized cleanly at ' + nowIso;
}

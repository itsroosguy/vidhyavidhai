/**
 * ============================================================================
 * VIDHYA VIDHAI FOUNDATION · CAREER TOURS
 * 63-Column Live Mirroring & 5-Minute Auto-Sync
 * Target Sheet: Classroom Data Entry - Report
 * Spreadsheet ID: 1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE
 * ============================================================================
 */

var CT_CONFIG = {
  SUPABASE_URL: 'https://gjkworgzniinnpnoinsd.supabase.co',
  ANON_KEY: 'sb_publishable_EEJSAvn7IL2vCQB8f5xqyQ_dSx7FmcJ',
  SYNC_KEY: 'VV-WH-1D85E77814DE4513ABE078F6CD1DC020',
  TAB_NAME: 'Classroom Data Entry'
};

var CT_EXACT_63_HEADERS = [
  'distribution_channel_host_id',
  'product_name',
  'unique_student_id',
  'cc',
  'zipcode_postal_code',
  'completion_date',
  'completion_rate',
  'student_csat',
  'underserved_reach',
  'grade_of_students',
  'educator_id',
  'educator_nps',
  'distribution_channel_host',
  'session_id',
  'session_start_date',
  'session_end_date',
  'session_start_time',
  'session_stop_time',
  'school_year',
  'latitude',
  'longitude',
  'state',
  'city',
  'district',
  'tour_id',
  'data_collection_method',
  'partner_name',
  'academic_year',
  'month_name',
  'school_udise',
  'school_name',
  'school_type',
  'class_section',
  'language',
  'unit_type',
  'student_count',
  'itp_avg',
  'session_duration_minutes',
  'response_rate_percentage',
  'video_completion_rate',
  'quiz_accuracy_percentage',
  'avg_watch_time_seconds',
  'videos_completed_count',
  'quizzes_completed_count',
  'total_questions_answered',
  'correct_answers_count',
  'session_completed_flag',
  'completion_percentage',
  'total_watch_time_seconds',
  'avg_playback_speed',
  'pause_count_total',
  'seek_count_total',
  'facilitator_name',
  'teacher_confidence_rating',
  'teacher_feedback_text',
  'implementation_challenges',
  'device_type',
  'platform_os',
  'platform_version',
  'app_version',
  'network_type',
  'data_source',
  'submission_date'
];

/**
 * Main Sync Function: Fetches live records from Supabase and mirrors
 * them into the 63-column structure in the Google Sheet.
 */
function mirrorCareerTours63Col() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CT_CONFIG.TAB_NAME);

  if (!sheet) {
    // If "Classroom Data Entry" tab doesn't exist, check if there is an initial "Sheet1" to rename
    var firstSheet = ss.getSheets()[0];
    if (firstSheet && (firstSheet.getName() === 'Sheet1' || firstSheet.getName() === 'Sheet 1')) {
      firstSheet.setName(CT_CONFIG.TAB_NAME);
      sheet = firstSheet;
    } else {
      sheet = ss.insertSheet(CT_CONFIG.TAB_NAME, 0);
    }
  }

  // Fetch live 63-column report feed from Supabase RPC endpoint
  var endpoint = CT_CONFIG.SUPABASE_URL + '/rest/v1/rpc/get_career_tours_63col_feed';
  var response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    headers: {
      'apikey': CT_CONFIG.ANON_KEY,
      'Authorization': 'Bearer ' + CT_CONFIG.ANON_KEY,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify({ p_sync_key: CT_CONFIG.SYNC_KEY }),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  if (code !== 200) {
    throw new Error('Supabase feed returned HTTP ' + code + ': ' + response.getContentText());
  }

  var data = JSON.parse(response.getContentText());
  if (!data || !data.ok || !Array.isArray(data.rows)) {
    throw new Error('Invalid response structure received from Supabase.');
  }

  var rows = data.rows;
  var headers = CT_EXACT_63_HEADERS;

  // 1. Ensure header row (Row 1) has exact 63 columns
  sheet.getRange(1, 1, 1, 63).setValues([headers]);
  sheet.getRange(1, 1, 1, 63)
    .setFontWeight('bold')
    .setBackground('#0A1B2C')
    .setFontColor('#FFFFFF')
    .setHorizontalAlignment('center')
    .setWrap(false);
  sheet.setFrozenRows(1);

  // 2. Clear old data rows if existing sheet has more rows than current payload
  var currentLastRow = sheet.getLastRow();
  if (currentLastRow > 1) {
    sheet.getRange(2, 1, currentLastRow - 1, 63).clearContent();
  }

  // 3. Write data rows
  if (rows.length > 0) {
    // Set text format for UDISE (col 30) and Zipcode (col 5) to protect leading zeros
    var dataRange = sheet.getRange(2, 1, rows.length, 63);
    sheet.getRange(2, 5, rows.length, 1).setNumberFormat('@');
    sheet.getRange(2, 30, rows.length, 1).setNumberFormat('@');

    dataRange.setValues(rows);
    dataRange.setFontFamily('Inter').setFontSize(10).setVerticalAlignment('middle');
  }

  var statusMsg = 'Successfully mirrored ' + rows.length + ' class records across 63 columns at ' + (data.updatedAt || new Date().toLocaleTimeString());
  Logger.log(statusMsg);
  try {
    ss.toast(statusMsg, 'Career Tours Synced ✅', 6);
  } catch (e) {}

  return { ok: true, count: rows.length, updatedAt: data.updatedAt };
}

/**
 * Creates or resets the automated 5-minute background sync trigger.
 */
function install5MinuteSyncTrigger() {
  remove5MinuteSyncTrigger();

  ScriptApp.newTrigger('mirrorCareerTours63Col')
    .timeBased()
    .everyMinutes(5)
    .create();

  // Run initial mirror immediately
  var res = mirrorCareerTours63Col();
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      '5-Minute Auto-Sync is now ACTIVE! Synced ' + res.count + ' records.',
      'Auto-Sync Enabled ⏱️',
      8
    );
  } catch (e) {}
}

/**
 * Removes active 5-minute background sync triggers.
 */
function remove5MinuteSyncTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var count = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'mirrorCareerTours63Col') {
      ScriptApp.deleteTrigger(triggers[i]);
      count++;
    }
  }
  return { ok: true, removedCount: count };
}

/**
 * Adds custom top-level menu when spreadsheet is opened.
 */
function onOpen() {
  try {
    var ui = SpreadsheetApp.getUi();
    ui.createMenu('Career Tours 🔄')
      .addItem('▶ Refresh Data Now', 'mirrorCareerTours63Col')
      .addSeparator()
      .addItem('⏱ Enable 5-Minute Auto-Sync', 'install5MinuteSyncTrigger')
      .addItem('⏹ Stop Auto-Sync', 'remove5MinuteSyncTrigger')
      .addToUi();
  } catch (e) {}
}

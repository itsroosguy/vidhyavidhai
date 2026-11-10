/**
 * Configuration.gs — Master configuration loader, writer, and CacheService manager.
 */

var CONFIG_CACHE_KEY = 'CT_APP_CONFIG_V1';
var CONFIG_CACHE_TTL_SECONDS = 300; // 5 minutes

function ctDefaultConfigObject_() {
  return {
    programmeTimezone: 'Asia/Kolkata',
    stateName: 'Tamil Nadu',
    allowedDistricts: ['Cuddalore', 'Nagapattinam', 'Sivaganga'],
    // Intentionally empty until Super Administrator / Administrator imports official block list
    districtBlocks: [],
    gradeOptions: ['8', '9', '10', '11', '12'],
    sectionOptions: ['A', 'B', 'C', 'D', 'E', 'F', 'No section'],
    schoolTypes: [
      'Government school',
      'Government aided school',
      'Private school',
      'Central government school (KV, JNV...)',
      'Tribal school (EMRS)',
      'Kasturba Gandhi Balika Vidyalaya (KGBV)',
      'Other'
    ],
    tours: [
      {
        tourId: 'TOUR_AM',
        tourName: 'Amazon Music: Careers Behind the Beats',
        tourCode: 'AM',
        active: true,
        videoIdByLanguage: {
          Tamil: 'AFE-IN-AM-OV-TA-2026'
        }
      },
      {
        tourId: 'TOUR_RFC',
        tourName: 'Robotics Fulfillment Center',
        tourCode: 'RFC',
        active: true,
        videoIdByLanguage: {}
      }
    ],
    languageOptions: ['English', 'Hindi', 'Tamil', 'Telugu', 'Kannada', 'Marathi', 'Gujarati', 'Odia'],
    languageCodes: {
      English: 'EN',
      Hindi: 'HI',
      Tamil: 'TA',
      Telugu: 'TE',
      Kannada: 'KN',
      Marathi: 'MR',
      Gujarati: 'GU',
      Odia: 'OR'
    },
    schoolYear: '2026-27',
    // Partner name must be explicitly configured by Super Administrator; never fabricated
    partnerName: '',
    reportingDefaults: {
      cc: 'IN',
      completionRate: 100,
      underservedReach: 'Yes',
      dataSource: 'Manual',
      feedbackFrom: 'students and teacher',
      educatorId: 'NA'
    },
    policy: {
      allowFacilitatorDeleteOwn: true,
      allowFacilitatorExportOwn: false,
      facilitatorApprovalMode: 'manual_allowlist'
    },
    exportTemplate63: null
  };
}

function ctInvalidateConfigCache_() {
  try {
    CacheService.getScriptCache().remove(CONFIG_CACHE_KEY);
  } catch (err) {
    console.warn('Cache invalidate error: ' + err);
  }
}

/**
 * Loads AppConfiguration from the Configuration sheet (with ScriptCache acceleration).
 */
function ctLoadConfiguration_() {
  try {
    var cached = CacheService.getScriptCache().get(CONFIG_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (e) {
    // Ignore cache read error and read authoritative sheet
  }

  var cfg = ctDefaultConfigObject_();
  var sheet = ctGetSheet_(SHEET_NAMES.CONFIGURATION);
  var lastRow = sheet.getLastRow();

  if (lastRow >= 2) {
    var rows = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    var keyMap = {
      programme_timezone: 'programmeTimezone',
      state_name: 'stateName',
      allowed_districts: 'allowedDistricts',
      district_blocks: 'districtBlocks',
      grade_options: 'gradeOptions',
      section_options: 'sectionOptions',
      school_types: 'schoolTypes',
      tours: 'tours',
      language_options: 'languageOptions',
      language_codes: 'languageCodes',
      school_year: 'schoolYear',
      partner_name: 'partnerName',
      reporting_defaults: 'reportingDefaults',
      policy: 'policy',
      export_template_63: 'exportTemplate63'
    };

    for (var i = 0; i < rows.length; i++) {
      var k = String(rows[i][0] || '').trim();
      var rawVal = String(rows[i][1] || '').trim();
      var targetProp = keyMap[k];
      if (!targetProp || !rawVal) continue;
      try {
        cfg[targetProp] = JSON.parse(rawVal);
      } catch (parseErr) {
        if (typeof cfg[targetProp] === 'string') {
          cfg[targetProp] = rawVal;
        }
      }
    }
  }

  cfg.policy = {
    allowFacilitatorDeleteOwn: cfg.policy ? cfg.policy.allowFacilitatorDeleteOwn !== false : true,
    allowFacilitatorExportOwn: false,
    facilitatorApprovalMode:
      cfg.policy && cfg.policy.facilitatorApprovalMode === 'auto_approve'
        ? 'auto_approve'
        : 'manual_allowlist'
  };

  try {
    CacheService.getScriptCache().put(
      CONFIG_CACHE_KEY,
      JSON.stringify(cfg),
      CONFIG_CACHE_TTL_SECONDS
    );
  } catch (cacheErr) {
    // CacheService skips objects >100KB gracefully without blocking normal sheet operation
    console.warn('Config cache put skipped: ' + cacheErr);
  }

  return cfg;
}

/**
 * Upserts a single configuration key-value row without clearing the whole Configuration sheet.
 */
function ctUpsertConfigKey_(sheet, key, valueObj, actorEmail) {
  var lastRow = sheet.getLastRow();
  var nowIso = ctNowIso_();
  var jsonStr = JSON.stringify(valueObj);

  if (lastRow >= 2) {
    var keyCol = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < keyCol.length; i++) {
      if (String(keyCol[i][0] || '').trim() === key) {
        var rowRange = sheet.getRange(i + 2, 1, 1, 4);
        rowRange.setNumberFormat('@');
        rowRange.setValues([[key, jsonStr, nowIso, actorEmail]]);
        return;
      }
    }
  }

  var appendRowIdx = Math.max(2, sheet.getLastRow() + 1);
  var appendRange = sheet.getRange(appendRowIdx, 1, 1, 4);
  appendRange.setNumberFormat('@');
  appendRange.setValues([[key, jsonStr, nowIso, actorEmail]]);
}

function ctHandleGetAppConfiguration_(actor) {
  if (!actor) throw ctApiError_('UNAUTHENTICATED', 'Authentication required.');
  var full = ctLoadConfiguration_();
  if (actor.role === 'super_admin') {
    return full;
  }
  // Facilitators receive strictly classroom entry lookups — never admin export schemas, partner constants, or approval policy
  return {
    programmeTimezone: full.programmeTimezone,
    stateName: full.stateName,
    allowedDistricts: full.allowedDistricts,
    districtBlocks: full.districtBlocks,
    gradeOptions: full.gradeOptions,
    sectionOptions: full.sectionOptions,
    schoolTypes: full.schoolTypes,
    tours: full.tours,
    languageOptions: full.languageOptions,
    languageCodes: full.languageCodes,
    schoolYear: full.schoolYear,
    partnerName: '',
    reportingDefaults: {
      cc: '',
      completionRate: 100,
      underservedReach: '',
      dataSource: full.reportingDefaults ? full.reportingDefaults.dataSource : 'Manual',
      feedbackFrom: full.reportingDefaults ? full.reportingDefaults.feedbackFrom : 'students and teacher',
      educatorId: full.reportingDefaults ? full.reportingDefaults.educatorId : 'NA'
    },
    policy: {
      allowFacilitatorDeleteOwn: Boolean(full.policy && full.policy.allowFacilitatorDeleteOwn),
      allowFacilitatorExportOwn: false,
      facilitatorApprovalMode: 'manual_allowlist'
    },
    exportTemplate63: null
  };
}

function ctHandleSaveAppConfiguration_(actor, payload) {
  ctRequireRole_(actor, ['super_admin']);

  var partial = (payload && payload.config) || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var current = ctLoadConfiguration_();
    var prevSummary = JSON.stringify({
      schoolYear: current.schoolYear,
      partnerName: current.partnerName,
      allowedDistricts: current.allowedDistricts,
      toursCount: (current.tours || []).length
    });

    var sheet = ctGetSheet_(SHEET_NAMES.CONFIGURATION);
    var propToSheetKey = {
      programmeTimezone: 'programme_timezone',
      stateName: 'state_name',
      allowedDistricts: 'allowed_districts',
      districtBlocks: 'district_blocks',
      gradeOptions: 'grade_options',
      sectionOptions: 'section_options',
      schoolTypes: 'school_types',
      tours: 'tours',
      languageOptions: 'language_options',
      languageCodes: 'language_codes',
      schoolYear: 'school_year',
      partnerName: 'partner_name',
      reportingDefaults: 'reporting_defaults',
      policy: 'policy',
      exportTemplate63: 'export_template_63'
    };

    var updatedKeys = [];
    for (var prop in propToSheetKey) {
      if (Object.prototype.hasOwnProperty.call(partial, prop) && partial[prop] !== undefined) {
        // Guard against invalid export template schema
        if (prop === 'exportTemplate63' && partial[prop] !== null) {
          var tpl = partial[prop];
          if (!tpl.columns || tpl.columns.length !== 63) {
            throw ctApiError_('INVALID_TEMPLATE', '63-column export template must contain exactly 63 columns.');
          }
        }
        var valToSave = partial[prop];
        if (prop === 'policy') {
          valToSave = {
            allowFacilitatorDeleteOwn: partial[prop].allowFacilitatorDeleteOwn !== false,
            allowFacilitatorExportOwn: false,
            facilitatorApprovalMode:
              partial[prop].facilitatorApprovalMode === 'auto_approve'
                ? 'auto_approve'
                : 'manual_allowlist'
          };
        }
        ctUpsertConfigKey_(sheet, propToSheetKey[prop], valToSave, actor.email);
        updatedKeys.push(propToSheetKey[prop]);
      }
    }

    ctInvalidateConfigCache_();
    var nextConfig = ctLoadConfiguration_();

    ctAppendAuditLog_(
      actor,
      'UPDATE_CONFIG',
      'Configuration',
      'SYSTEM',
      prevSummary,
      'Updated keys: ' + updatedKeys.join(', '),
      'SUCCESS'
    );

    return nextConfig;
  } finally {
    lock.releaseLock();
  }
}

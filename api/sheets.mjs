import crypto from 'node:crypto';

export const ALLOWLISTED_SUPER_ADMINS = [
  { userId: 'SA_BRINTHA', name: 'Brintha Jayaprakash', email: 'brinthajayaprakash888@gmail.com' },
  { userId: 'SA_KARUNYA', name: 'Karunya', email: 'karunya@vidhyavidhai.org' },
];

export const DEFAULT_TARGET_SPREADSHEET_ID = '1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE';
export const DEFAULT_TARGET_SPREADSHEET_URL =
  'https://docs.google.com/spreadsheets/d/1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE/edit?gid=0#gid=0';

const SESSION_COOKIE_NAME = 'ct_sheets_session';
const OAUTH_STATE_COOKIE_NAME = 'ct_sheets_oauth_state';
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB guard

export const SHEETS_SCHEMA_DEFINITIONS = [
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
      'archived',
    ],
    textColumns: [1, 2, 3, 11, 12, 13, 14, 18, 19, 21, 25, 36, 37, 38, 41],
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
      'updated_at',
    ],
    textColumns: [1, 2, 3, 4, 5],
  },
  {
    name: 'Facilitators',
    headers: ['user_id', 'name', 'email', 'role', 'active', 'created_at', 'updated_at', 'status'],
    textColumns: [1, 3, 4, 5, 8],
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
      'updated_at',
    ],
    textColumns: [1, 3, 7, 8],
  },
  {
    name: 'Configuration',
    headers: ['config_key', 'config_value_json', 'updated_at', 'updated_by'],
    textColumns: [1, 2, 3, 4],
  },
  {
    name: 'Admin Users',
    headers: ['user_id', 'name', 'email', 'role', 'active', 'created_at', 'updated_at', 'status'],
    textColumns: [1, 3, 4, 5, 8],
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
      'result',
    ],
    textColumns: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
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
      'error_message',
    ],
    textColumns: [1, 2, 3, 4, 5, 6, 7, 9, 10],
  },
];

const AUX_SUMMARY_TAB = 'Summary & KPIs';
const AUX_DECLARATIONS_TAB = 'Declarations';

const DECLARATIONS_HEADERS = [
  'declaration_category',
  'target_tab_or_scope',
  'ref_or_col_num',
  'field_or_rule_key',
  'display_title',
  'type_format_or_formula',
  'validation_and_official_declaration',
];

const COLUMN_PIXEL_WIDTHS = {
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
  error_message: 310,
};

const HEADER_NOTES_BY_NAME = {
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
  config_value_json: 'JSON payload managed by Super Administrators. Never store passwords here.',
};

const DROPDOWN_LISTS_BY_HEADER = {
  district: ['Cuddalore', 'Nagapattinam', 'Sivaganga'],
  language: ['English', 'Hindi', 'Tamil', 'Telugu', 'Kannada', 'Marathi', 'Gujarati', 'Odia'],
  grade: ['8', '9', '10', '11', '12'],
  section: ['A', 'B', 'C', 'D', 'E', 'F', 'No section'],
  school_type: [
    'Government school',
    'Government aided school',
    'Private school',
    'Central government school (KV, JNV...)',
    'Tribal school (EMRS)',
    'Kasturba Gandhi Balika Vidyalaya (KGBV)',
    'Other',
  ],
  session_type: ['single', 'combined'],
  submission_status: ['COMMITTED', 'CORRECTED', 'PENDING'],
  archived: ['true', 'false'],
  active: ['true', 'false'],
  status: ['APPROVED', 'PENDING', 'DENIED'],
  role: ['super_admin', 'facilitator'],
  teacher_classification: ['Promoter', 'Passive', 'Detractor'],
};

function colIndexToLetter(colIdx) {
  let num = colIdx;
  let letters = '';
  while (num > 0) {
    const rem = (num - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    num = Math.floor((num - 1) / 26);
  }
  return letters || 'A';
}

function buildSummaryAndKpisSheetPayload() {
  const sDef = SHEETS_SCHEMA_DEFINITIONS[0];
  const dDef = SHEETS_SCHEMA_DEFINITIONS[1];
  const sCol = (name) => colIndexToLetter(sDef.headers.indexOf(name) + 1);
  const dCol = (name) => colIndexToLetter(dDef.headers.indexOf(name) + 1);

  const sStatus = sCol('submission_status');
  const sArch = sCol('archived');
  const sStudents = sCol('total_students_present');
  const sDistrict = sCol('district');
  const sTourId = sCol('tour_id');
  const sLang = sCol('language');
  const sCsat = sCol('overall_csat');
  const sItp = sCol('overall_itp');
  const sNps = sCol('teacher_nps');

  const dGrade = dCol('grade');
  const dStud = dCol('students_present');
  const dQaTot = dCol('qa_total');
  const dQaW = dCol('qa_weighted_score');
  const dQbTot = dCol('qb_total');
  const dQbW = dCol('qb_weighted_score');
  const R = 2500;

  const rows = [];
  const rowKinds = [];

  rows.push(['Vidhya Vidhai · Career Tours Programme Summary & Live KPIs', '', '', '', '', '', '', '']);
  rowKinds.push('banner');
  rows.push([
    'State: Tamil Nadu · Approved Districts: Cuddalore, Nagapattinam, Sivaganga · Timezone: Asia/Kolkata · Live Formulas referencing Sessions & Session Details',
    '', '', '', '', '', '', '',
  ]);
  rowKinds.push('subtitle');
  rows.push(['', '', '', '', '', '', '', '']);
  rowKinds.push('spacer');

  rows.push(['1. Official Programme Key Performance Indicators (Live Formulas)', '', '', '', '', '', '', '']);
  rowKinds.push('section');
  rows.push(['Metric Code', 'Programme Indicator', 'Live Value', 'Unit / Scale', 'Formula Declaration', '', '', '']);
  rowKinds.push('subheader');

  const kpiRows = [
    ['KPI-01', 'Total Committed Sessions', `=IFERROR(COUNTIFS(Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`, 'Sessions', 'Counts Sessions where submission_status <> PENDING and archived = false'],
    ['KPI-02', 'Total Students Reached (Single-Counted)', `=IFERROR(SUMIFS(Sessions!${sStudents}2:${sStudents}${R},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`, 'Students', 'Single-counted attendance across committed non-archived sessions'],
    ['KPI-03', 'Total Class Groups Covered', `=IFERROR(COUNTA('Session Details'!A2:A${R}),0)`, 'Class rows', 'Expanded 1:N grade/section rows in Session Details'],
    ['KPI-04', 'Registered Canonical Schools', `=IFERROR(COUNTA(Schools!A2:A${R}),0)`, 'Schools', 'Canonical 11-digit UDISE schools in Schools tab'],
    ['KPI-05', 'Approved Facilitators', `=IFERROR(COUNTIF(Facilitators!H2:H${R},"APPROVED"),0)`, 'Accounts', 'Approved facilitator rows in Facilitators tab'],
    ['KPI-06', 'Protected / Approved Super Admins', `=IFERROR(COUNTIF('Admin Users'!H2:H${R},"APPROVED"),0)`, 'Accounts', 'Approved Super Administrators in Admin Users tab'],
    ['KPI-07', 'Pooled Student CSAT (Q-A Enjoyment)', `=IFERROR(SUM('Session Details'!${dQaW}2:${dQaW}${R})/SUM('Session Details'!${dQaTot}2:${dQaTot}${R}),0)`, '1.00–5.00', 'SUM(qa_weighted_score) / SUM(qa_total)'],
    ['KPI-08', 'Pooled Student ITP (Q-B Career Interest)', `=IFERROR(SUM('Session Details'!${dQbW}2:${dQbW}${R})/SUM('Session Details'!${dQbTot}2:${dQbTot}${R}),0)`, '1.00–5.00', 'SUM(qb_weighted_score) / SUM(qb_total)'],
    ['KPI-09', 'Pooled Teacher NPS (-100 to +100)', `=IFERROR(AVERAGEIFS(Sessions!${sNps}2:${sNps}${R},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`, 'NPS Index', 'Mean session teacher_nps (+100 / 0 / -100)'],
    ['KPI-10', 'Question A Response Coverage Rate', `=IFERROR(SUM('Session Details'!${dQaTot}2:${dQaTot}${R})/SUM('Session Details'!${dStud}2:${dStud}${R}),0)`, 'Percentage', 'SUM(qa_total) / SUM(students_present)'],
  ];
  for (const item of kpiRows) {
    rows.push([...item, '', '', '']);
    rowKinds.push('data');
  }

  rows.push(['', '', '', '', '', '', '', '']);
  rowKinds.push('spacer');
  rows.push(['2. Approved District-wise Programme Reach (Tamil Nadu)', '', '', '', '', '', '', '']);
  rowKinds.push('section');
  rows.push(['District', 'State', 'School Year', 'Sessions', 'Students Reached', 'Avg CSAT', 'Avg ITP', 'Avg Teacher NPS']);
  rowKinds.push('subheader');

  const distStartRow = rows.length + 1;
  for (const distName of ['Cuddalore', 'Nagapattinam', 'Sivaganga']) {
    const rNum = rows.length + 1;
    rows.push([
      distName,
      'Tamil Nadu',
      '2026-27',
      `=IFERROR(COUNTIFS(Sessions!${sDistrict}2:${sDistrict}${R},A${rNum},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
      `=IFERROR(SUMIFS(Sessions!${sStudents}2:${sStudents}${R},Sessions!${sDistrict}2:${sDistrict}${R},A${rNum},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
      `=IFERROR(AVERAGEIFS(Sessions!${sCsat}2:${sCsat}${R},Sessions!${sDistrict}2:${sDistrict}${R},A${rNum},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
      `=IFERROR(AVERAGEIFS(Sessions!${sItp}2:${sItp}${R},Sessions!${sDistrict}2:${sDistrict}${R},A${rNum},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
      `=IFERROR(AVERAGEIFS(Sessions!${sNps}2:${sNps}${R},Sessions!${sDistrict}2:${sDistrict}${R},A${rNum},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
    ]);
    rowKinds.push('data');
  }
  const distEndRow = rows.length;
  rows.push([
    'Total / Pooled',
    'Tamil Nadu',
    '2026-27',
    `=SUM(D${distStartRow}:D${distEndRow})`,
    `=SUM(E${distStartRow}:E${distEndRow})`,
    `=IFERROR(SUM('Session Details'!${dQaW}2:${dQaW}${R})/SUM('Session Details'!${dQaTot}2:${dQaTot}${R}),0)`,
    `=IFERROR(SUM('Session Details'!${dQbW}2:${dQbW}${R})/SUM('Session Details'!${dQbTot}2:${dQbTot}${R}),0)`,
    `=IFERROR(AVERAGEIFS(Sessions!${sNps}2:${sNps}${R},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
  ]);
  rowKinds.push('total');

  rows.push(['', '', '', '', '', '', '', '']);
  rowKinds.push('spacer');
  rows.push(['3. Career Tours Catalog & Delivery Breakdown', '', '', '', '', '', '', '']);
  rowKinds.push('section');
  rows.push(['Tour ID', 'Career Tour Name', 'Code', 'Active', 'Tamil Video ID', 'Sessions', 'Students Reached', 'Avg CSAT']);
  rowKinds.push('subheader');

  const tours = [
    ['TOUR_AM', 'Amazon Music: Careers Behind the Beats', 'AM', 'Active', 'AFE-IN-AM-OV-TA-2026'],
    ['TOUR_RFC', 'Robotics Fulfillment Center', 'RFC', 'Active', 'Pending'],
  ];
  for (const t of tours) {
    const rNum = rows.length + 1;
    rows.push([
      t[0],
      t[1],
      t[2],
      t[3],
      t[4],
      `=IFERROR(COUNTIFS(Sessions!${sTourId}2:${sTourId}${R},A${rNum},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
      `=IFERROR(SUMIFS(Sessions!${sStudents}2:${sStudents}${R},Sessions!${sTourId}2:${sTourId}${R},A${rNum},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
      `=IFERROR(AVERAGEIFS(Sessions!${sCsat}2:${sCsat}${R},Sessions!${sTourId}2:${sTourId}${R},A${rNum},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
    ]);
    rowKinds.push('data');
  }

  rows.push(['', '', '', '', '', '', '', '']);
  rowKinds.push('spacer');
  rows.push(['4. Grade-wise & Language Breakdown (Live Formulas)', '', '', '', '', '', '', '']);
  rowKinds.push('section');
  rows.push(['Dimension', 'Category', 'Value Key', 'Class / Session Count', 'Students Reached', 'Avg CSAT', '', '']);
  rowKinds.push('subheader');

  for (const grade of ['8', '9', '10', '11', '12']) {
    const rNum = rows.length + 1;
    rows.push([
      'Grade',
      `Grade ${grade}`,
      grade,
      `=IFERROR(COUNTIF('Session Details'!${dGrade}2:${dGrade}${R},C${rNum}),0)`,
      `=IFERROR(SUMIF('Session Details'!${dGrade}2:${dGrade}${R},C${rNum},'Session Details'!${dStud}2:${dStud}${R}),0)`,
      `=IFERROR(SUMIF('Session Details'!${dGrade}2:${dGrade}${R},C${rNum},'Session Details'!${dQaW}2:${dQaW}${R})/SUMIF('Session Details'!${dGrade}2:${dGrade}${R},C${rNum},'Session Details'!${dQaTot}2:${dQaTot}${R}),0)`,
      '',
      '',
    ]);
    rowKinds.push('data');
  }

  const langs = [
    ['English', 'EN'],
    ['Hindi', 'HI'],
    ['Tamil', 'TA'],
    ['Telugu', 'TE'],
    ['Kannada', 'KN'],
    ['Marathi', 'MR'],
    ['Gujarati', 'GU'],
    ['Odia', 'OR'],
  ];
  for (const [lang, code] of langs) {
    const rNum = rows.length + 1;
    rows.push([
      'Language',
      lang,
      code,
      `=IFERROR(COUNTIFS(Sessions!${sLang}2:${sLang}${R},B${rNum},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
      `=IFERROR(SUMIFS(Sessions!${sStudents}2:${sStudents}${R},Sessions!${sLang}2:${sLang}${R},B${rNum},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
      `=IFERROR(AVERAGEIFS(Sessions!${sCsat}2:${sCsat}${R},Sessions!${sLang}2:${sLang}${R},B${rNum},Sessions!${sStatus}2:${sStatus}${R},"<>PENDING",Sessions!${sArch}2:${sArch}${R},"false"),0)`,
      '',
      '',
    ]);
    rowKinds.push('data');
  }

  return { rows, rowKinds };
}

function buildDeclarationsSheetRows() {
  const adminEmails = ALLOWLISTED_SUPER_ADMINS.map((a) => `${a.name} <${a.email}>`).join('; ');
  const rows = [
    DECLARATIONS_HEADERS,
    [
      'Programme Governance',
      'ALL_TABS',
      'GOV-01',
      'GOV-01',
      'Approved Geography & Timezone',
      'State: Tamil Nadu · Districts: Cuddalore, Nagapattinam, Sivaganga · TZ: Asia/Kolkata',
      'Only schools within Tamil Nadu and approved districts (Cuddalore, Nagapattinam, Sivaganga) are valid. All dates evaluate in Asia/Kolkata (IST).',
    ],
    [
      'Programme Governance',
      'ALL_TABS',
      'GOV-02',
      'GOV-02',
      'Protected Super Administrators & RBAC',
      adminEmails,
      'Only allowlisted Super Administrators may connect sheets, modify Configuration, archive/restore records, delete data, or export official .xlsx files. Zero passwords stored.',
    ],
    [
      'Programme Governance',
      'ALL_TABS',
      'GOV-03',
      'GOV-03',
      'Zero Fabricated Data Policy',
      'Empty initial DB tables (0 sample classrooms, 0 fabricated partners)',
      'Core database tabs hold no sample/dummy sessions. Summary & KPIs live formulas cleanly evaluate to 0 until real classroom sessions are committed.',
    ],
    [
      'Metric Formula',
      'Sessions / Session Details',
      'MET-01',
      'MET-01',
      'Pooled Student CSAT (Question A)',
      'CSAT = SUM(qa_weighted_score) / SUM(qa_total)',
      'Scale 1.00–5.00. Weighted across all student respondents, never an unweighted average of class averages.',
    ],
    [
      'Metric Formula',
      'Sessions / Session Details',
      'MET-02',
      'MET-02',
      'Pooled Student ITP (Question B)',
      'ITP = SUM(qb_weighted_score) / SUM(qb_total)',
      'Scale 1.00–5.00. Weighted across all Question B respondents on committed non-archived rows.',
    ],
    [
      'Metric Formula',
      'Sessions',
      'MET-03',
      'MET-03',
      'Teacher Net Promoter Score (Teacher NPS)',
      'Promoter (9–10)=+100, Passive (7–8)=0, Detractor (0–6)=-100 · AVERAGE(teacher_nps)',
      'Evaluated once per unique classroom session header (never multiplied across expanded combined-class rows).',
    ],
    [
      'Metric Formula',
      'Sessions -> Session Details',
      'MET-04',
      'MET-04',
      'Combined-Class 1:N Expansion & Single Counting',
      '1 Session Header -> N Session Details rows',
      'Each Grade/Section row holds its own attendance and Q-A/Q-B votes so attendance totals never double-count.',
    ],
    [
      'Data Integrity',
      'Sessions / Schools',
      'INT-01',
      'INT-01',
      'Plain Text (@) Leading-Zero Preservation',
      'numFmt = "@" on udise_code (11 chars), pin_code (6 chars), session_id, dates & times',
      'Protects leading zeroes on UDISE codes, PIN codes, and ISO/DD-MM-YYYY date strings in Google Sheets & Excel.',
    ],
    [
      'Data Integrity',
      'Sessions / Sync Log / Audit Log',
      'INT-02',
      'INT-02',
      'Atomic LockService Two-Phase Commit & 3-Key Deduplication',
      'Unique keys: session_record_id + session_id + client_submission_key',
      'Two-phase write (PENDING -> COMMITTED/CORRECTED) inside backend locks prevents duplicates on retries and logs every mutation.',
    ],
  ];

  for (const def of SHEETS_SCHEMA_DEFINITIONS) {
    const textSet = new Set(def.textColumns || []);
    def.headers.forEach((hdr, idx) => {
      const colNum = idx + 1;
      const isText = textSet.has(colNum);
      rows.push([
        `Data Dictionary (${def.name})`,
        def.name,
        `Col ${colNum} (${colIndexToLetter(colNum)})`,
        hdr,
        hdr.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()),
        isText ? 'Plain Text (@)' : 'Numeric / Decimal',
        HEADER_NOTES_BY_NAME[hdr] || `Canonical field in "${def.name}" tab.`,
      ]);
    });
  }

  return rows;
}

export function isAllowlistedSuperAdminEmail(email) {
  const clean = String(email || '').trim().toLowerCase();
  return ALLOWLISTED_SUPER_ADMINS.some((sa) => sa.email === clean);
}

export function findAllowlistedSuperAdmin(email) {
  const clean = String(email || '').trim().toLowerCase();
  return ALLOWLISTED_SUPER_ADMINS.find((sa) => sa.email === clean) || null;
}

export function parseSpreadsheetId(urlOrId) {
  const raw = String(urlOrId || '').trim();
  if (!raw) return '';
  const match = /\/spreadsheets\/d\/([a-zA-Z0-9-_]{10,})/.exec(raw);
  if (match && match[1]) return match[1];
  if (/^[a-zA-Z0-9-_]{10,120}$/.test(raw)) return raw;
  return '';
}

function deriveEncryptionKey(secret) {
  if (!secret || String(secret).trim().length < 16) {
    return null;
  }
  return crypto.createHash('sha256').update(String(secret)).digest();
}

export function encryptCookiePayload(obj, secret) {
  const key = deriveEncryptionKey(secret);
  if (!key) {
    throw new Error('SHEETS_TOKEN_SECRET missing or shorter than 16 characters.');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptCookiePayload(token, secret) {
  const key = deriveEncryptionKey(secret);
  if (!key || !token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const iv = Buffer.from(parts[0], 'base64url');
    const tag = Buffer.from(parts[1], 'base64url');
    const ciphertext = Buffer.from(parts[2], 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader) {
  const map = {};
  if (!cookieHeader) return map;
  for (const pair of String(cookieHeader).split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) map[k] = decodeURIComponent(v);
  }
  return map;
}

function formatCookie(
  name,
  value,
  { maxAgeSeconds = 60 * 60 * 24 * 30, secure = true, sameSite = 'Lax' } = {},
) {
  const effectiveSameSite = sameSite === 'None' && secure ? 'None' : 'Lax';
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', `SameSite=${effectiveSameSite}`];
  if (typeof maxAgeSeconds === 'number') parts.push(`Max-Age=${maxAgeSeconds}`);
  if (secure || effectiveSameSite === 'None') parts.push('Secure');
  return parts.join('; ');
}

const TOKEN_REFRESH_BUFFER_MS = 300_000;

function isTrustedOrigin(origin, reqBaseOrigin, env = {}) {
  if (!origin) return false;
  if (origin === reqBaseOrigin) return true;
  const extraOrigins = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (extraOrigins.includes(origin)) return true;
  try {
    const u = new URL(origin);
    if (
      u.protocol === 'http:' &&
      (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
    ) {
      return true;
    }
    if (u.protocol !== 'https:') return false;
    return (
      u.hostname === 'vidhyavidhai.roosstudiox.com' ||
      u.hostname.endsWith('.roosstudiox.com') ||
      u.hostname === 'vidhyavidhai.org' ||
      u.hostname.endsWith('.vidhyavidhai.org') ||
      u.hostname.endsWith('.vercel.app')
    );
  } catch {
    return false;
  }
}

function resolveCorsContext(req, env = {}) {
  const origin = String(req.headers.origin || '').trim();
  const baseOrigin = resolveBaseOrigin(req);
  const trusted = isTrustedOrigin(origin, baseOrigin, env);
  const isCrossOrigin = Boolean(origin && trusted && origin !== baseOrigin);
  return {
    origin: trusted ? origin : '',
    trusted,
    isCrossOrigin,
  };
}

function applyCorsHeaders(res, cors) {
  if (cors && cors.trusted && cors.origin) {
    res.setHeader('Access-Control-Allow-Origin', cors.origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
}

function sendJson(res, statusCode, body, cookiesToSet = [], cors = null) {
  applyCorsHeaders(res, cors);
  if (cookiesToSet.length > 0) {
    res.setHeader('Set-Cookie', cookiesToSet);
  }
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function sendRedirect(res, location, cookiesToSet = [], cors = null) {
  applyCorsHeaders(res, cors);
  if (cookiesToSet.length > 0) {
    res.setHeader('Set-Cookie', cookiesToSet);
  }
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  if (typeof req.body === 'string') {
    return JSON.parse(req.body || '{}');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw Object.assign(new Error('Request payload exceeds maximum limit.'), { statusCode: 413, apiCode: 'PAYLOAD_TOO_LARGE' });
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

function resolveBaseOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  return `${proto}://${host}`;
}

function isSecureRequest(req) {
  const origin = resolveBaseOrigin(req);
  return origin.startsWith('https://');
}

function a1Tab(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function sanitizePublicConnectionState(session, oauthConfigured) {
  if (!session || !session.spreadsheetId) {
    return {
      connected: false,
      authMethod: 'google_oauth',
      oauthConfigured,
      connectedAccount: session?.connectedAccount || '',
      spreadsheetId: '',
      spreadsheetName: '',
      spreadsheetUrl: '',
      connectedAt: '',
      connectedBy: '',
      lastSyncedAt: session?.lastSyncedAt || '',
      lastSyncStatus: session?.lastSyncStatus || 'IDLE',
      lastSyncMessage: session?.lastSyncMessage || '',
      initializedTabs: [],
      defaultSpreadsheetId: DEFAULT_TARGET_SPREADSHEET_ID,
      defaultSpreadsheetUrl: DEFAULT_TARGET_SPREADSHEET_URL,
    };
  }

  return {
    connected: true,
    authMethod: 'google_oauth',
    oauthConfigured,
    connectedAccount: session.connectedAccount || '',
    spreadsheetId: session.spreadsheetId,
    spreadsheetName: session.spreadsheetName || 'Career Tours Spreadsheet',
    spreadsheetUrl:
      session.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${session.spreadsheetId}/edit`,
    connectedAt: session.connectedAt || '',
    connectedBy: session.connectedBy || '',
    lastSyncedAt: session.lastSyncedAt || '',
    lastSyncStatus: session.lastSyncStatus || 'IDLE',
    lastSyncMessage: session.lastSyncMessage || '',
    initializedTabs: Array.isArray(session.initializedTabs) ? session.initializedTabs : [],
    defaultSpreadsheetId: DEFAULT_TARGET_SPREADSHEET_ID,
    defaultSpreadsheetUrl: DEFAULT_TARGET_SPREADSHEET_URL,
  };
}

const DEFAULT_PROGRAMME_TIMEZONE = 'Asia/Kolkata';

const SERVER_DEFAULT_CONFIGURATION = {
  programmeTimezone: DEFAULT_PROGRAMME_TIMEZONE,
  stateName: 'Tamil Nadu',
  allowedDistricts: ['Cuddalore', 'Nagapattinam', 'Sivaganga'],
  gradeOptions: ['8', '9', '10', '11', '12'],
  sectionOptions: ['A', 'B', 'C', 'D', 'E', 'F', 'No section'],
  schoolTypes: DROPDOWN_LISTS_BY_HEADER.school_type,
  tours: [
    {
      tourId: 'TOUR_AM',
      tourName: 'Amazon Music: Careers Behind the Beats',
      tourCode: 'AM',
      active: true,
      videoIdByLanguage: { Tamil: 'AFE-IN-AM-OV-TA-2026' },
    },
    {
      tourId: 'TOUR_RFC',
      tourName: 'Robotics Fulfillment Center',
      tourCode: 'RFC',
      active: true,
      videoIdByLanguage: {},
    },
  ],
  languageOptions: DROPDOWN_LISTS_BY_HEADER.language,
  languageCodes: {
    English: 'EN',
    Hindi: 'HI',
    Tamil: 'TA',
    Telugu: 'TE',
    Kannada: 'KN',
    Marathi: 'MR',
    Gujarati: 'GU',
    Odia: 'OR',
  },
  schoolYear: '2026-27',
  partnerName: '',
  reportingDefaults: {
    cc: 'IN',
    completionRate: 100,
    underservedReach: 'Yes',
    dataSource: 'Manual',
    feedbackFrom: 'students and teacher',
    educatorId: 'NA',
  },
  policy: {
    allowFacilitatorDeleteOwn: true,
    allowFacilitatorExportOwn: false,
    facilitatorApprovalMode: 'auto_approve',
  },
  exportTemplate63: null,
};

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

function getTodayKolkataISO(tz = DEFAULT_PROGRAMME_TIMEZONE) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: DEFAULT_PROGRAMME_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }
}

function isValidISODate(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isValidTime24(timeStr) {
  if (typeof timeStr !== 'string' || !/^\d{2}:\d{2}$/.test(timeStr)) return false;
  const [h, m] = timeStr.split(':').map(Number);
  return Number.isInteger(h) && Number.isInteger(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

function formatISODateToDDMMYYYY(dateStr) {
  if (!isValidISODate(dateStr)) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}-${m}-${y}`;
}

function formatISODateToYYYYMMDD(dateStr) {
  if (!isValidISODate(dateStr)) return '';
  return dateStr.replace(/-/g, '');
}

function getMonthNameFromISO(dateStr) {
  if (!isValidISODate(dateStr)) return '';
  const monthIdx = Number(dateStr.split('-')[1]) - 1;
  return MONTH_NAMES[monthIdx] || '';
}

function calculateSessionDurationMinutes(startDate, startTime, endDate, endTime) {
  if (!isValidISODate(startDate) || !isValidISODate(endDate)) return null;
  if (!isValidTime24(startTime) || !isValidTime24(endTime)) return null;
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [sh, smin] = startTime.split(':').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const [eh, emin] = endTime.split(':').map(Number);
  const startMs = Date.UTC(sy, sm - 1, sd, sh, smin);
  const endMs = Date.UTC(ey, em - 1, ed, eh, emin);
  const diffMins = Math.round((endMs - startMs) / 60000);
  return diffMins > 0 ? diffMins : null;
}

function formatDurationHuman(totalMinutes) {
  if (totalMinutes === null || !Number.isFinite(totalMinutes) || totalMinutes <= 0) {
    return '—';
  }
  const rounded = Math.round(totalMinutes);
  const totalHours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const parts = [];
  if (days > 0) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hr' : 'hrs'}`);
  if (mins > 0 || parts.length === 0) parts.push(`${mins} ${mins === 1 ? 'min' : 'mins'}`);
  return parts.join(' ');
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseWholeInt(raw) {
  const clean = String(raw ?? '').trim();
  if (clean === '') return { valid: true, value: 0 };
  if (!/^\d+$/.test(clean)) return { valid: false, value: 0 };
  return { valid: true, value: Number.parseInt(clean, 10) };
}

function resolveTeacherNpsServer(group, exactScoreRaw) {
  const cleanExact = String(exactScoreRaw ?? '').trim();
  if (cleanExact !== '' && /^(10|[0-9])$/.test(cleanExact)) {
    const score = Number.parseInt(cleanExact, 10);
    if (score >= 9) return { exactScore: score, classification: 'Promoter', nps: 100 };
    if (score >= 7) return { exactScore: score, classification: 'Passive', nps: 0 };
    return { exactScore: score, classification: 'Detractor', nps: -100 };
  }
  if (group === 'promoter') return { exactScore: null, classification: 'Promoter', nps: 100 };
  if (group === 'passive') return { exactScore: null, classification: 'Passive', nps: 0 };
  if (group === 'detractor') return { exactScore: null, classification: 'Detractor', nps: -100 };
  return { exactScore: null, classification: null, nps: null };
}

function buildSessionIdPrefixServer(startDate, udiseCode, sessionMode, classes) {
  const yyyymmdd = formatISODateToYYYYMMDD(startDate);
  const cleanUdise = String(udiseCode || '').trim();
  if (!yyyymmdd || !/^\d{11}$/.test(cleanUdise)) return null;
  if (sessionMode === 'single') {
    const first = classes[0];
    if (!first || !String(first.grade || '').trim() || !String(first.section || '').trim()) return null;
    const gradeToken = String(first.grade).trim().padStart(2, '0');
    const secClean = String(first.section).trim().toUpperCase();
    const classToken = secClean === 'NO SECTION' ? 'NS' : secClean.replace(/[^A-Z0-9]/g, '');
    if (!classToken) return null;
    return `CT_IN_${yyyymmdd}_${cleanUdise}_${gradeToken}_${classToken}`;
  }
  if (classes.length < 2) return null;
  for (const c of classes) {
    if (!String(c.grade || '').trim() || !String(c.section || '').trim()) return null;
  }
  return `CT_IN_${yyyymmdd}_${cleanUdise}_CMB_${String(classes.length).padStart(2, '0')}C`;
}

function toNullableNumber(val) {
  if (val === '' || val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function toNumberOrZero(val, fallback = 0) {
  if (val === '' || val === null || val === undefined) return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function parseConfigFromSheetRows(rows) {
  const patch = {};
  for (const r of rows || []) {
    const key = String(r[0] || '').trim();
    const rawJson = String(r[1] || '').trim();
    if (!key || !rawJson) continue;
    let parsed;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      parsed = rawJson;
    }
    switch (key) {
      case 'programme_timezone':
        if (typeof parsed === 'string' && parsed.trim()) patch.programmeTimezone = parsed.trim();
        break;
      case 'state_name':
        if (typeof parsed === 'string' && parsed.trim()) patch.stateName = parsed.trim();
        break;
      case 'allowed_districts':
        if (Array.isArray(parsed) && parsed.length > 0) patch.allowedDistricts = parsed.map(String);
        break;
      case 'grade_options':
        if (Array.isArray(parsed) && parsed.length > 0) patch.gradeOptions = parsed.map(String);
        break;
      case 'section_options':
        if (Array.isArray(parsed) && parsed.length > 0) patch.sectionOptions = parsed.map(String);
        break;
      case 'school_types':
        if (Array.isArray(parsed) && parsed.length > 0) patch.schoolTypes = parsed.map(String);
        break;
      case 'tours':
        if (Array.isArray(parsed) && parsed.length > 0) patch.tours = parsed;
        break;
      case 'language_options':
        if (Array.isArray(parsed) && parsed.length > 0) patch.languageOptions = parsed.map(String);
        break;
      case 'language_codes':
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) patch.languageCodes = parsed;
        break;
      case 'school_year':
        if (typeof parsed === 'string') patch.schoolYear = parsed;
        break;
      case 'partner_name':
        if (typeof parsed === 'string') patch.partnerName = parsed;
        break;
      case 'reporting_defaults':
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          patch.reportingDefaults = { ...SERVER_DEFAULT_CONFIGURATION.reportingDefaults, ...parsed };
        }
        break;
      case 'policy':
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          patch.policy = {
            allowFacilitatorDeleteOwn: parsed.allowFacilitatorDeleteOwn !== false,
            allowFacilitatorExportOwn: false,
            facilitatorApprovalMode:
              parsed.facilitatorApprovalMode === 'manual_allowlist' ? 'manual_allowlist' : 'auto_approve',
          };
        }
        break;
      case 'export_template_63':
        patch.exportTemplate63 = parsed || null;
        break;
      default:
        break;
    }
  }
  return {
    config: { ...SERVER_DEFAULT_CONFIGURATION, ...patch },
    configurationPatch: patch,
  };
}

function buildConfigKeyValuesFromPartial(partial) {
  const mapping = [
    ['programmeTimezone', 'programme_timezone'],
    ['stateName', 'state_name'],
    ['allowedDistricts', 'allowed_districts'],
    ['gradeOptions', 'grade_options'],
    ['sectionOptions', 'section_options'],
    ['schoolTypes', 'school_types'],
    ['tours', 'tours'],
    ['languageOptions', 'language_options'],
    ['languageCodes', 'language_codes'],
    ['schoolYear', 'school_year'],
    ['partnerName', 'partner_name'],
    ['reportingDefaults', 'reporting_defaults'],
    ['policy', 'policy'],
    ['exportTemplate63', 'export_template_63'],
  ];
  const entries = [];
  for (const [prop, sheetKey] of mapping) {
    if (partial[prop] !== undefined) {
      let val = partial[prop];
      if (prop === 'policy' && val && typeof val === 'object') {
        val = {
          allowFacilitatorDeleteOwn: val.allowFacilitatorDeleteOwn !== false,
          allowFacilitatorExportOwn: false,
          facilitatorApprovalMode:
            val.facilitatorApprovalMode === 'auto_approve' ? 'auto_approve' : 'manual_allowlist',
        };
      }
      entries.push([sheetKey, JSON.stringify(val)]);
    }
  }
  return entries;
}

function resolveSessionSheetLayout(headerRow) {
  const norm = (headerRow || []).map((h) => String(h || '').trim().toLowerCase());
  if (norm.includes('session_record_id')) {
    const hasBlock = norm.includes('block');
    const idxOr = (name, fallbackIdx) => {
      const idx = norm.indexOf(name);
      return idx !== -1 ? idx : fallbackIdx;
    };
    return {
      hasBlock,
      studentsCol0: idxOr('total_students_present', hasBlock ? 28 : 27),
      statusCol1: idxOr('submission_status', hasBlock ? 36 : 35) + 1,
      createdAtCol0: idxOr('created_at', hasBlock ? 37 : 36),
      updatedAtCol1: idxOr('updated_at', hasBlock ? 38 : 37) + 1,
      createdByCol0: idxOr('created_by', hasBlock ? 39 : 38),
      updatedByCol1: idxOr('updated_by', hasBlock ? 40 : 39) + 1,
      archivedCol1: idxOr('archived', hasBlock ? 41 : 40) + 1,
      totalCols: hasBlock ? 42 : 41,
    };
  }
  return {
    hasBlock: false,
    studentsCol0: 27,
    statusCol1: 36,
    createdAtCol0: 36,
    updatedAtCol1: 38,
    createdByCol0: 38,
    updatedByCol1: 40,
    archivedCol1: 41,
    totalCols: 41,
  };
}

function resolveSchoolSheetLayout(headerRow) {
  const norm = (headerRow || []).map((h) => String(h || '').trim().toLowerCase());
  if (norm.includes('school_record_id')) {
    const hasBlock = norm.includes('block');
    const activeIdx = norm.indexOf('active');
    const createdIdx = norm.indexOf('created_at');
    return {
      hasBlock,
      activeCol0: activeIdx !== -1 ? activeIdx : hasBlock ? 8 : 7,
      createdAtCol0: createdIdx !== -1 ? createdIdx : hasBlock ? 9 : 8,
      totalCols: hasBlock ? 11 : 10,
    };
  }
  return {
    hasBlock: false,
    activeCol0: 7,
    createdAtCol0: 8,
    totalCols: 10,
  };
}

function serializeSessionRow(s, includeLegacyBlockCol = false) {
  return [
    String(s.sessionRecordId || ''),
    String(s.sessionId || ''),
    String(s.clientSubmissionKey || ''),
    String(s.facilitatorName || ''),
    String(s.facilitatorEmail || ''),
    String(s.facilitatorUserId || ''),
    String(s.tourId || ''),
    String(s.tourName || ''),
    String(s.videoId || ''),
    String(s.language || ''),
    String(s.startDate || ''),
    String(s.endDate || ''),
    String(s.startTime || ''),
    String(s.endTime || ''),
    toNumberOrZero(s.durationMinutes, 0),
    String(s.durationFormatted || ''),
    String(s.reportingMonth || ''),
    String(s.submissionTimestamp || ''),
    String(s.submissionDateFormatted || ''),
    String(s.schoolName || ''),
    String(s.udiseCode || ''),
    String(s.schoolType || ''),
    String(s.state || ''),
    String(s.district || ''),
    ...(includeLegacyBlockCol ? [''] : []),
    String(s.pinCode || ''),
    String(s.sessionType || 'single'),
    toNumberOrZero(s.totalClasses, 1),
    toNumberOrZero(s.totalStudentsPresent, 0),
    toNumberOrZero(s.totalQuestionAResponses, 0),
    toNumberOrZero(s.totalQuestionBResponses, 0),
    s.overallCsat === null || s.overallCsat === undefined ? '' : s.overallCsat,
    s.overallItp === null || s.overallItp === undefined ? '' : s.overallItp,
    s.teacherScore === null || s.teacherScore === undefined ? '' : s.teacherScore,
    String(s.teacherClassification || ''),
    toNumberOrZero(s.teacherNps, 0),
    String(s.submissionStatus || 'COMMITTED'),
    String(s.createdAt || ''),
    String(s.updatedAt || ''),
    String(s.createdBy || ''),
    String(s.updatedBy || ''),
    s.archived ? 'true' : 'false',
  ];
}

function serializeSchoolRow(sc, includeLegacyBlockCol = false) {
  return [
    String(sc.schoolRecordId || ''),
    String(sc.schoolName || ''),
    String(sc.udiseCode || ''),
    String(sc.schoolType || ''),
    String(sc.state || 'Tamil Nadu'),
    String(sc.district || ''),
    ...(includeLegacyBlockCol ? [''] : []),
    String(sc.pinCode || ''),
    typeof sc.active === 'string' ? sc.active : sc.active === false ? 'false' : 'true',
    String(sc.createdAt || ''),
    String(sc.updatedAt || ''),
  ];
}

function serializeDetailRow(d) {
  return [
    String(d.detailRecordId || ''),
    String(d.sessionRecordId || ''),
    String(d.sessionId || ''),
    String(d.grade || ''),
    String(d.section || ''),
    toNumberOrZero(d.studentsPresent, 0),
    toNumberOrZero(d.questionAScore5, 0),
    toNumberOrZero(d.questionAScore4, 0),
    toNumberOrZero(d.questionAScore3, 0),
    toNumberOrZero(d.questionAScore2, 0),
    toNumberOrZero(d.questionAScore1, 0),
    toNumberOrZero(d.questionATotal, 0),
    toNumberOrZero(d.questionAWeightedScore, 0),
    d.csat === null || d.csat === undefined ? '' : d.csat,
    toNumberOrZero(d.questionBScore5, 0),
    toNumberOrZero(d.questionBScore4, 0),
    toNumberOrZero(d.questionBScore3, 0),
    toNumberOrZero(d.questionBScore2, 0),
    toNumberOrZero(d.questionBScore1, 0),
    toNumberOrZero(d.questionBTotal, 0),
    toNumberOrZero(d.questionBWeightedScore, 0),
    d.itp === null || d.itp === undefined ? '' : d.itp,
    String(d.createdAt || ''),
    String(d.updatedAt || ''),
  ];
}

function parseDetailRow(r) {
  if (!r || !r[0] || !r[1]) return null;
  return {
    detailRecordId: String(r[0] || '').trim(),
    sessionRecordId: String(r[1] || '').trim(),
    sessionId: String(r[2] || '').trim(),
    grade: String(r[3] || '').trim(),
    section: String(r[4] || '').trim(),
    studentsPresent: toNumberOrZero(r[5], 0),
    questionAScore5: toNumberOrZero(r[6], 0),
    questionAScore4: toNumberOrZero(r[7], 0),
    questionAScore3: toNumberOrZero(r[8], 0),
    questionAScore2: toNumberOrZero(r[9], 0),
    questionAScore1: toNumberOrZero(r[10], 0),
    questionATotal: toNumberOrZero(r[11], 0),
    questionAWeightedScore: toNumberOrZero(r[12], 0),
    csat: toNullableNumber(r[13]),
    questionBScore5: toNumberOrZero(r[14], 0),
    questionBScore4: toNumberOrZero(r[15], 0),
    questionBScore3: toNumberOrZero(r[16], 0),
    questionBScore2: toNumberOrZero(r[17], 0),
    questionBScore1: toNumberOrZero(r[18], 0),
    questionBTotal: toNumberOrZero(r[19], 0),
    questionBWeightedScore: toNumberOrZero(r[20], 0),
    itp: toNullableNumber(r[21]),
    createdAt: String(r[22] || '').trim(),
    updatedAt: String(r[23] || '').trim(),
  };
}

function parseSessionRow(r, detailsBySessionRecordId, headerRow = null) {
  if (!r || !r[0] || !r[1]) return null;
  const sessionRecordId = String(r[0] || '').trim();
  const hasExplicitHeader =
    Array.isArray(headerRow) &&
    headerRow.some((h) => String(h || '').trim().toLowerCase() === 'session_record_id');
  const legacyByShape =
    !hasExplicitHeader &&
    (r.length >= 42 ||
      ((String(r[36] || '').trim().toUpperCase() === 'PENDING' ||
        String(r[36] || '').trim().toUpperCase() === 'COMMITTED' ||
        String(r[36] || '').trim().toUpperCase() === 'CORRECTED') &&
        !(
          String(r[35] || '').trim().toUpperCase() === 'PENDING' ||
          String(r[35] || '').trim().toUpperCase() === 'COMMITTED' ||
          String(r[35] || '').trim().toUpperCase() === 'CORRECTED'
        )));
  const layout = hasExplicitHeader
    ? resolveSessionSheetLayout(headerRow)
    : resolveSessionSheetLayout(legacyByShape ? ['session_record_id', 'block'] : null);
  const shift = layout.hasBlock ? 1 : 0;

  const statusRaw = String(r[layout.statusCol1 - 1] || 'COMMITTED').trim().toUpperCase();
  const submissionStatus =
    statusRaw === 'PENDING' || statusRaw === 'CORRECTED' ? statusRaw : 'COMMITTED';
  const clsRaw = String(r[33 + shift] || '').trim();
  const teacherClassification =
    clsRaw === 'Promoter' || clsRaw === 'Passive' || clsRaw === 'Detractor' ? clsRaw : 'Passive';

  return {
    sessionRecordId,
    sessionId: String(r[1] || '').trim(),
    clientSubmissionKey: String(r[2] || '').trim(),
    facilitatorName: String(r[3] || '').trim(),
    facilitatorEmail: String(r[4] || '').trim().toLowerCase(),
    facilitatorUserId: String(r[5] || '').trim(),
    tourId: String(r[6] || '').trim(),
    tourName: String(r[7] || '').trim(),
    videoId: String(r[8] || '').trim(),
    language: String(r[9] || '').trim(),
    startDate: String(r[10] || '').trim(),
    endDate: String(r[11] || '').trim(),
    startTime: String(r[12] || '').trim(),
    endTime: String(r[13] || '').trim(),
    durationMinutes: toNumberOrZero(r[14], 0),
    durationFormatted: String(r[15] || '').trim(),
    reportingMonth: String(r[16] || '').trim(),
    submissionTimestamp: String(r[17] || '').trim(),
    submissionDateFormatted: String(r[18] || '').trim(),
    schoolName: String(r[19] || '').trim(),
    udiseCode: String(r[20] || '').trim(),
    schoolType: String(r[21] || '').trim(),
    state: String(r[22] || '').trim(),
    district: String(r[23] || '').trim(),
    pinCode: String(r[24 + shift] || '').trim(),
    sessionType: String(r[25 + shift] || '').trim() === 'combined' ? 'combined' : 'single',
    totalClasses: toNumberOrZero(r[26 + shift], 1),
    totalStudentsPresent: toNumberOrZero(r[layout.studentsCol0], 0),
    totalQuestionAResponses: toNumberOrZero(r[28 + shift], 0),
    totalQuestionBResponses: toNumberOrZero(r[29 + shift], 0),
    overallCsat: toNullableNumber(r[30 + shift]),
    overallItp: toNullableNumber(r[31 + shift]),
    teacherScore: toNullableNumber(r[32 + shift]),
    teacherClassification,
    teacherNps: toNumberOrZero(r[34 + shift], 0),
    submissionStatus,
    syncStatus: 'SYNCED',
    createdAt: String(r[layout.createdAtCol0] || '').trim(),
    updatedAt: String(r[layout.updatedAtCol1 - 1] || '').trim(),
    createdBy: String(r[layout.createdByCol0] || '').trim().toLowerCase(),
    updatedBy: String(r[layout.updatedByCol1 - 1] || '').trim().toLowerCase(),
    archived: String(r[layout.archivedCol1 - 1] ?? '').trim().toLowerCase() === 'true',
    details: detailsBySessionRecordId.get(sessionRecordId) || [],
  };
}

function parseSchoolRow(r, headerRow = null) {
  if (!r || !r[0] || !r[2]) return null;
  const hasExplicitHeader =
    Array.isArray(headerRow) &&
    headerRow.some((h) => String(h || '').trim().toLowerCase() === 'school_record_id');
  const legacyByShape =
    !hasExplicitHeader &&
    (r.length >= 11 ||
      String(r[8] ?? '').trim().toLowerCase() === 'true' ||
      String(r[8] ?? '').trim().toLowerCase() === 'false');
  const layout = hasExplicitHeader
    ? resolveSchoolSheetLayout(headerRow)
    : resolveSchoolSheetLayout(legacyByShape ? ['school_record_id', 'block'] : null);
  const shift = layout.hasBlock ? 1 : 0;

  return {
    schoolRecordId: String(r[0] || '').trim(),
    schoolName: String(r[1] || '').trim(),
    udiseCode: String(r[2] || '').trim(),
    schoolType: String(r[3] || '').trim(),
    state: String(r[4] || '').trim(),
    district: String(r[5] || '').trim(),
    pinCode: String(r[6 + shift] || '').trim(),
    active: String(r[layout.activeCol0] ?? 'true').trim().toLowerCase() !== 'false',
    createdAt: String(r[layout.createdAtCol0] || '').trim(),
    updatedAt: String(r[layout.createdAtCol0 + 1] || '').trim(),
  };
}

function parseUserRow(r, fallbackRole = 'facilitator') {
  if (!r || !r[0] || !r[2]) return null;
  const email = String(r[2] || '').trim().toLowerCase();
  const isSa = isAllowlistedSuperAdminEmail(email);
  const rawRole = String(r[3] || fallbackRole).trim().toLowerCase();
  const role = isSa ? 'super_admin' : rawRole === 'super_admin' ? 'facilitator' : 'facilitator';
  const statusRaw = String(r[7] || '').trim().toUpperCase();
  const active = isSa ? true : String(r[4] ?? 'true').trim().toLowerCase() !== 'false';
  const status =
    isSa
      ? 'APPROVED'
      : statusRaw === 'APPROVED' || statusRaw === 'PENDING' || statusRaw === 'DENIED'
        ? statusRaw
        : active
          ? 'APPROVED'
          : 'DENIED';
  return {
    userId: String(r[0] || '').trim(),
    name: String(r[1] || '').trim(),
    email,
    role,
    active: status === 'APPROVED',
    status,
    createdAt: String(r[5] || '').trim(),
    updatedAt: String(r[6] || '').trim(),
  };
}

function parseAuditRow(r) {
  if (!r || !r[0]) return null;
  const resRaw = String(r[9] || 'SUCCESS').trim().toUpperCase();
  return {
    auditId: String(r[0] || '').trim(),
    timestamp: String(r[1] || '').trim(),
    userId: String(r[2] || '').trim(),
    userEmail: String(r[3] || '').trim().toLowerCase(),
    action: String(r[4] || '').trim(),
    entityType: String(r[5] || '').trim(),
    entityId: String(r[6] || '').trim(),
    previousSummary: String(r[7] || ''),
    newSummary: String(r[8] || ''),
    result: resRaw === 'DENIED' || resRaw === 'FAILED' ? resRaw : 'SUCCESS',
  };
}

function parseSyncRow(r) {
  if (!r || !r[0]) return null;
  const stRaw = String(r[8] || 'SYNCED').trim().toUpperCase();
  const status =
    stRaw === 'LOCAL_SANDBOX' || stRaw === 'PENDING_RETRY' || stRaw === 'FAILED' ? stRaw : 'SYNCED';
  return {
    syncId: String(r[0] || '').trim(),
    timestamp: String(r[1] || '').trim(),
    clientSubmissionKey: String(r[2] || '').trim(),
    sessionRecordId: String(r[3] || '').trim(),
    sessionId: String(r[4] || '').trim(),
    actorEmail: String(r[5] || '').trim().toLowerCase(),
    operation: String(r[6] || '').trim(),
    attempt: toNumberOrZero(r[7], 1),
    status,
    errorMessage: String(r[9] || ''),
  };
}

function computeSessionMetricsAndValidateServer(rawValues, config, actorInfo) {
  const values = {
    clientSubmissionKey: String(rawValues?.clientSubmissionKey || '').trim(),
    facilitatorName: String(rawValues?.facilitatorName || actorInfo.name || '').trim(),
    facilitatorEmail: actorInfo.email,
    tourId: String(rawValues?.tourId || '').trim(),
    language: String(rawValues?.language || '').trim(),
    startDate: String(rawValues?.startDate || '').trim(),
    endDate: String(rawValues?.endDate || '').trim(),
    startTime: String(rawValues?.startTime || '').trim(),
    endTime: String(rawValues?.endTime || '').trim(),
    schoolName: String(rawValues?.schoolName || '').trim(),
    udiseCode: String(rawValues?.udiseCode || '').trim(),
    schoolType: String(rawValues?.schoolType || '').trim(),
    state: String(rawValues?.state || config.stateName || 'Tamil Nadu').trim(),
    district: String(rawValues?.district || '').trim(),
    pinCode: String(rawValues?.pinCode || '').trim(),
    sessionMode: rawValues?.sessionMode === 'combined' ? 'combined' : 'single',
    classes: Array.isArray(rawValues?.classes) ? rawValues.classes : [],
    teacherNpsGroup: String(rawValues?.teacherNpsGroup || '').trim(),
    teacherExactScore: String(rawValues?.teacherExactScore ?? '').trim(),
  };

  const errors = [];
  const warnings = [];

  if (!values.facilitatorName) errors.push('Enter your facilitator name.');
  const tour = (config.tours || []).find((t) => t.active !== false && t.tourId === values.tourId);
  if (!tour) errors.push('Choose which Career Tour video you showed.');
  if (!values.language || !(config.languageOptions || []).includes(values.language)) {
    errors.push('Select the session language.');
  }

  const todayKolkata = getTodayKolkataISO(config.programmeTimezone);
  const startDateValid = isValidISODate(values.startDate);
  const endDateValid = isValidISODate(values.endDate);
  if (!startDateValid) errors.push('Enter a valid session start date.');
  else if (values.startDate > todayKolkata) errors.push('Session start date cannot be in the future.');

  if (!endDateValid) errors.push('Enter a valid session end date.');
  else if (values.endDate > todayKolkata) errors.push('Session end date cannot be in the future.');

  if (startDateValid && endDateValid && values.endDate < values.startDate) {
    errors.push('Session end date cannot be earlier than the start date.');
  }

  const startTimeValid = isValidTime24(values.startTime);
  const endTimeValid = isValidTime24(values.endTime);
  if (!startTimeValid) errors.push('Choose the session start time.');
  if (!endTimeValid) errors.push('Choose the session end time.');

  let durationMinutes = 0;
  if (startDateValid && endDateValid && startTimeValid && endTimeValid && values.endDate >= values.startDate) {
    const mins = calculateSessionDurationMinutes(
      values.startDate,
      values.startTime,
      values.endDate,
      values.endTime,
    );
    if (mins === null) {
      errors.push('Session end date and time must be later than the start date and time.');
    } else {
      durationMinutes = mins;
      if (mins > 480) {
        warnings.push(
          `Session duration is ${Math.round(mins / 60)} hours (${mins} mins). Confirm start/end dates and AM/PM are correct.`,
        );
      }
    }
  }

  if (!values.schoolName) errors.push('Enter the school name.');
  if (!/^\d{11}$/.test(values.udiseCode)) {
    errors.push('School code (UDISE) must be exactly 11 numeric digits.');
  }
  if (!values.schoolType || !(config.schoolTypes || []).includes(values.schoolType)) {
    errors.push('Select the school type.');
  }
  if (!values.district || !(config.allowedDistricts || []).includes(values.district)) {
    errors.push(`District must be one of: ${(config.allowedDistricts || []).join(', ')}.`);
  }
  if (!/^\d{6}$/.test(values.pinCode)) {
    errors.push('PIN code must be exactly 6 numeric digits.');
  }

  if (values.sessionMode === 'single') {
    if (values.classes.length !== 1) errors.push('Single class mode must contain exactly one class row.');
  } else if (values.classes.length < 2 || values.classes.length > 10) {
    errors.push('Combined class sessions must include between 2 and 10 class/grade rows.');
  }

  const seenClassKeys = new Set();
  const classBreakdown = [];
  let pooledQaTotal = 0;
  let pooledQaWeighted = 0;
  let pooledQbTotal = 0;
  let pooledQbWeighted = 0;
  let totalStudentsPresent = 0;

  values.classes.forEach((row, index) => {
    const label = `Class ${index + 1}`;
    const grade = String(row?.grade || '').trim();
    const section = String(row?.section || '').trim();
    if (!grade || !(config.gradeOptions || []).includes(grade)) {
      errors.push(`${label}: Select the class (grade).`);
    }
    if (!section || !(config.sectionOptions || []).includes(section)) {
      errors.push(`${label}: Select the section (or choose "No section").`);
    }
    if (grade && section) {
      const k = `${grade}::${section}`;
      if (seenClassKeys.has(k)) {
        errors.push(`Duplicate class entry: Grade ${grade} (${section}) appears more than once.`);
      }
      seenClassKeys.add(k);
    }

    const rawPresent = String(row?.studentsPresent ?? '').trim();
    const presentOk = /^\d+$/.test(rawPresent);
    const studentsPresent = presentOk ? Number.parseInt(rawPresent, 10) : 0;
    if (!presentOk || studentsPresent <= 0) {
      errors.push(`${label}: Number of students present must be a whole number greater than 0.`);
    }

    const keys = ['score5', 'score4', 'score3', 'score2', 'score1'];
    const qaCounts = {};
    const qbCounts = {};
    let qaBad = false;
    let qbBad = false;
    for (const k of keys) {
      const a = parseWholeInt(row?.questionA?.[k]);
      if (!a.valid) qaBad = true;
      qaCounts[k] = a.value;
      const b = parseWholeInt(row?.questionB?.[k]);
      if (!b.valid) qbBad = true;
      qbCounts[k] = b.value;
    }
    if (qaBad) {
      errors.push(`${label} (Question A): Enter whole numbers (0 or greater) only.`);
    }
    if (qbBad) {
      errors.push(`${label} (Question B): Enter whole numbers (0 or greater) only.`);
    }

    const qaTotal = qaCounts.score5 + qaCounts.score4 + qaCounts.score3 + qaCounts.score2 + qaCounts.score1;
    const qaWeighted =
      5 * qaCounts.score5 + 4 * qaCounts.score4 + 3 * qaCounts.score3 + 2 * qaCounts.score2 + qaCounts.score1;
    const qbTotal = qbCounts.score5 + qbCounts.score4 + qbCounts.score3 + qbCounts.score2 + qbCounts.score1;
    const qbWeighted =
      5 * qbCounts.score5 + 4 * qbCounts.score4 + 3 * qbCounts.score3 + 2 * qbCounts.score2 + qbCounts.score1;

    if (!qaBad && !qbBad) {
      if (studentsPresent > 0 && qaTotal > studentsPresent) {
        errors.push(`${label}: Question A total (${qaTotal}) cannot exceed students present (${studentsPresent}).`);
      }
      if (studentsPresent > 0 && qbTotal > studentsPresent) {
        errors.push(`${label}: Question B total (${qbTotal}) cannot exceed students present (${studentsPresent}).`);
      }
      if (qaTotal !== qbTotal) {
        warnings.push(`${label}: Question A responses (${qaTotal}) differ from Question B responses (${qbTotal}).`);
      }
      if (studentsPresent > 0) {
        const qaCov = (qaTotal / studentsPresent) * 100;
        const qbCov = (qbTotal / studentsPresent) * 100;
        if (qaTotal === 0 || qbTotal === 0) {
          warnings.push(`${label}: At least one question has 0 student responses recorded.`);
        } else if (qaCov < 75 || qbCov < 75) {
          warnings.push(
            `${label}: Response coverage is below 75% (Question A: ${qaCov.toFixed(0)}%, Question B: ${qbCov.toFixed(0)}%).`,
          );
        }
      }
    }

    totalStudentsPresent += studentsPresent;
    pooledQaTotal += qaTotal;
    pooledQaWeighted += qaWeighted;
    pooledQbTotal += qbTotal;
    pooledQbWeighted += qbWeighted;

    classBreakdown.push({
      grade,
      section,
      studentsPresent,
      qaCounts,
      qaTotal,
      qaWeighted,
      csatAverage: qaTotal > 0 ? round2(qaWeighted / qaTotal) : null,
      qbCounts,
      qbTotal,
      qbWeighted,
      itpAverage: qbTotal > 0 ? round2(qbWeighted / qbTotal) : null,
    });
  });

  if (values.teacherExactScore !== '') {
    if (!/^(10|[0-9])$/.test(values.teacherExactScore)) {
      errors.push("Teacher's exact score must be a whole number from 0 to 10.");
    } else if (values.teacherNpsGroup) {
      const sc = Number.parseInt(values.teacherExactScore, 10);
      const expectedGrp = sc >= 9 ? 'promoter' : sc >= 7 ? 'passive' : 'detractor';
      if (expectedGrp !== values.teacherNpsGroup) {
        errors.push(`Exact score ${sc} belongs to ${expectedGrp}, which does not match the selected group.`);
      }
    }
  } else if (!values.teacherNpsGroup) {
    errors.push("Select the teacher's NPS recommendation score or group.");
  }

  const teacher = resolveTeacherNpsServer(values.teacherNpsGroup, values.teacherExactScore);
  const videoId = tour?.videoIdByLanguage?.[values.language]?.trim() || 'UNCONFIGURED_VIDEO_ID';

  return {
    valid: errors.length === 0,
    errorMessage: errors.join(' '),
    warnings,
    values,
    tour,
    videoId,
    durationMinutes,
    todayKolkata,
    teacher,
    totalStudentsPresent,
    pooledQaTotal,
    pooledQbTotal,
    overallCsat: pooledQaTotal > 0 ? round2(pooledQaWeighted / pooledQaTotal) : null,
    overallItp: pooledQbTotal > 0 ? round2(pooledQbWeighted / pooledQbTotal) : null,
    classBreakdown,
  };
}

function parseUpdatedRangeRowNumber(updatedRange) {
  if (!updatedRange || typeof updatedRange !== 'string') return null;
  const match = /![A-Z]+(\d+)(?::[A-Z]+\d+)?$/i.exec(updatedRange.trim());
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

async function deleteSheetRowsDescending(spreadsheetId, callGoogle, items) {
  if (!items || items.length === 0) return;
  const meta = await callGoogle(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId,
    )}?fields=${encodeURIComponent('sheets(properties(sheetId,title))')}`,
  );
  const sheetIdByTitle = new Map();
  for (const s of meta.sheets || []) {
    if (s.properties?.title && s.properties?.sheetId !== undefined) {
      sheetIdByTitle.set(s.properties.title, s.properties.sheetId);
    }
  }

  const requests = [];
  const sorted = [...items].sort((a, b) => b.rowNum - a.rowNum);
  for (const item of sorted) {
    const sheetId = sheetIdByTitle.get(item.sheetTitle);
    if (sheetId === undefined || !Number.isInteger(item.rowNum) || item.rowNum < 2) continue;
    requests.push({
      deleteDimension: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: item.rowNum - 1,
          endIndex: item.rowNum,
        },
      },
    });
  }
  if (requests.length > 0) {
    await callGoogle(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      { method: 'POST', body: JSON.stringify({ requests }) },
    );
  }
}

export function createSheetsHandler({
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  async function verifyIdTokenHeader(authHeader, clientId) {
    if (!authHeader || !String(authHeader).startsWith('Bearer ')) return null;
    const idToken = String(authHeader).slice('Bearer '.length).trim();
    if (!idToken || !clientId) return null;
    const res = await fetchImpl(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    );
    if (!res.ok) return null;
    const claims = await res.json();
    const nowSec = Math.floor(Date.now() / 1000);
    if (
      String(claims.aud || '') !== clientId ||
      String(claims.email_verified) !== 'true' ||
      Number(claims.exp || 0) <= nowSec ||
      !isAllowlistedSuperAdminEmail(claims.email)
    ) {
      return null;
    }
    return String(claims.email).trim().toLowerCase();
  }

  async function ensureFreshAccessToken(
    session,
    clientId,
    clientSecret,
    { forceRefresh = false } = {},
  ) {
    if (!session || !session.accessToken) {
      throw Object.assign(new Error('Google OAuth authorization required.'), {
        statusCode: 401,
        apiCode: 'OAUTH_REQUIRED',
      });
    }
    const now = Date.now();
    if (!forceRefresh && (!session.expiresAt || session.expiresAt - now > TOKEN_REFRESH_BUFFER_MS)) {
      return { session, refreshed: false };
    }
    if (!session.refreshToken) {
      if (!forceRefresh && session.expiresAt && session.expiresAt - now > 15_000) {
        return { session, refreshed: false };
      }
      throw Object.assign(new Error('Google OAuth session expired. Please reconnect your Google account.'), {
        statusCode: 401,
        apiCode: 'OAUTH_EXPIRED',
      });
    }

    let tokenRes = null;
    let fetchErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        tokenRes = await fetchImpl('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: session.refreshToken,
            grant_type: 'refresh_token',
          }).toString(),
        });
        if (tokenRes.status === 429 || tokenRes.status >= 500) {
          if (attempt === 0) continue;
          break;
        }
        break;
      } catch (err) {
        fetchErr = err;
        tokenRes = null;
        if (attempt === 0) continue;
      }
    }

    if (!tokenRes || tokenRes.status === 429 || tokenRes.status >= 500) {
      if (!forceRefresh && session.expiresAt && session.expiresAt - Date.now() > 15_000) {
        return { session, refreshed: false, transientError: true };
      }
      throw Object.assign(
        new Error(
          fetchErr?.message ||
            'Temporary Google OAuth server issue while refreshing token. Please retry shortly.',
        ),
        {
          statusCode: 503,
          apiCode: 'TRANSIENT_OAUTH_ERROR',
        },
      );
    }

    if (!tokenRes.ok) {
      throw Object.assign(new Error('Failed to refresh Google OAuth token. Please reconnect your Google account.'), {
        statusCode: 401,
        apiCode: 'OAUTH_REFRESH_FAILED',
      });
    }

    const refreshedTokens = await tokenRes.json();
    const updatedSession = {
      ...session,
      accessToken: refreshedTokens.access_token || session.accessToken,
      refreshToken: refreshedTokens.refresh_token || session.refreshToken,
      expiresAt: Date.now() + Number(refreshedTokens.expires_in || 3600) * 1000,
    };
    return { session: updatedSession, refreshed: true };
  }

  async function googleApiJson(url, accessToken, options = {}) {
    const res = await fetchImpl(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    let parsed = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    if (!res.ok) {
      const apiMsg = parsed?.error?.message || `Google API returned HTTP ${res.status}`;
      const err = new Error(apiMsg);
      err.rawStatus = res.status;
      err.statusCode =
        res.status === 401 ? 401 : res.status === 403 ? 403 : res.status === 404 ? 404 : 502;
      err.apiCode =
        res.status === 401
          ? 'GOOGLE_UNAUTHORIZED'
          : res.status === 403
            ? 'SHEET_ACCESS_DENIED'
            : 'GOOGLE_API_ERROR';
      throw err;
    }
    return parsed;
  }

  async function googleApiWithSession(sessionState, clientId, clientSecret, url, options = {}) {
    try {
      return await googleApiJson(url, sessionState.current.accessToken, options);
    } catch (err) {
      if (err?.rawStatus === 401 && sessionState.current?.refreshToken) {
        const refreshed = await ensureFreshAccessToken(
          sessionState.current,
          clientId,
          clientSecret,
          { forceRefresh: true },
        );
        sessionState.current = refreshed.session;
        sessionState.dirty = true;
        return googleApiJson(url, sessionState.current.accessToken, options);
      }
      throw err;
    }
  }

  async function initializeSpreadsheetSchema(spreadsheetId, tokenOrCaller, actorEmail) {
    const callGoogle =
      typeof tokenOrCaller === 'function'
        ? tokenOrCaller
        : (url, opts) => googleApiJson(url, tokenOrCaller, opts);
    const metaFields =
      'spreadsheetId,properties.title,spreadsheetUrl,sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)),bandedRanges(bandedRangeId))';
    let meta = await callGoogle(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId,
      )}?fields=${encodeURIComponent(metaFields)}`,
    );

    const existingTitles = new Set((meta.sheets || []).map((s) => s.properties?.title).filter(Boolean));
    const requiredTabSpecs = [
      ...SHEETS_SCHEMA_DEFINITIONS.map((d) => ({
        title: d.name,
        frozenRowCount: 1,
        columnCount: Math.max(26, d.headers.length),
      })),
      { title: AUX_SUMMARY_TAB, frozenRowCount: 2, columnCount: 26 },
      { title: AUX_DECLARATIONS_TAB, frozenRowCount: 1, columnCount: 26 },
    ];
    const missingTabs = requiredTabSpecs.filter((t) => !existingTitles.has(t.title));

    if (missingTabs.length > 0) {
      await callGoogle(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
        {
          method: 'POST',
          body: JSON.stringify({
            requests: missingTabs.map((t) => ({
              addSheet: {
                properties: {
                  title: t.title,
                  gridProperties: {
                    frozenRowCount: t.frozenRowCount,
                    rowCount: 1000,
                    columnCount: t.columnCount,
                  },
                },
              },
            })),
          }),
        },
      );
      meta = await callGoogle(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          spreadsheetId,
        )}?fields=${encodeURIComponent(metaFields)}`,
      );
    }

    const sheetByTitle = new Map();
    for (const s of meta.sheets || []) {
      if (s.properties?.title) {
        sheetByTitle.set(s.properties.title, s);
      }
    }

    // Write row 1 headers cleanly ONLY if row 1 is currently empty, and idempotently migrate legacy 'block' / 'district_blocks'
    const headerRanges = SHEETS_SCHEMA_DEFINITIONS.map((d) => `${a1Tab(d.name)}!1:1`);
    const existingHeaderData = await callGoogle(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId,
      )}/values:batchGet?${[...headerRanges, `${a1Tab('Configuration')}!A2:A`]
        .map((r) => `ranges=${encodeURIComponent(r)}`)
        .join('&')}`,
    );

    const migrationRequests = [];
    const migratedTabs = new Set();
    const rawUpdates = [];
    const valueRangesList = existingHeaderData.valueRanges || [];
    SHEETS_SCHEMA_DEFINITIONS.forEach((def, idx) => {
      const vr = valueRangesList[idx] || {};
      const firstRow = (vr.values && vr.values[0]) || [];
      if (def.name === 'Sessions' || def.name === 'Schools') {
        const blockCol0 = firstRow.findIndex(
          (h) => String(h || '').trim().toLowerCase() === 'block',
        );
        const sheetId = sheetByTitle.get(def.name)?.properties?.sheetId;
        if (blockCol0 !== -1 && sheetId !== undefined) {
          migrationRequests.push({
            deleteDimension: {
              range: {
                sheetId,
                dimension: 'COLUMNS',
                startIndex: blockCol0,
                endIndex: blockCol0 + 1,
              },
            },
          });
          migratedTabs.add(def.name);
          rawUpdates.push({
            range: `${a1Tab(def.name)}!A1`,
            values: [def.headers],
          });
          return;
        }
      }
      if (!firstRow[0] || String(firstRow[0]).trim() === '') {
        rawUpdates.push({
          range: `${a1Tab(def.name)}!A1`,
          values: [def.headers],
        });
      }
    });

    const cfgKeyProbeRows = (valueRangesList[SHEETS_SCHEMA_DEFINITIONS.length]?.values) || [];
    const cfgSheetIdForMig = sheetByTitle.get('Configuration')?.properties?.sheetId;
    if (cfgSheetIdForMig !== undefined) {
      const legacyBlockCfgRows0 = [];
      cfgKeyProbeRows.forEach((r, idx) => {
        if (String(r[0] || '').trim() === 'district_blocks') {
          legacyBlockCfgRows0.push(idx + 1); // 0-based sheet row (row 2 = index 1)
        }
      });
      legacyBlockCfgRows0
        .sort((a, b) => b - a)
        .forEach((row0) => {
          migrationRequests.push({
            deleteDimension: {
              range: {
                sheetId: cfgSheetIdForMig,
                dimension: 'ROWS',
                startIndex: row0,
                endIndex: row0 + 1,
              },
            },
          });
        });
    }

    if (migrationRequests.length > 0) {
      await callGoogle(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
        {
          method: 'POST',
          body: JSON.stringify({ requests: migrationRequests }),
        },
      );
    }

    const declarationsRows = buildDeclarationsSheetRows();
    rawUpdates.push({
      range: `${a1Tab(AUX_DECLARATIONS_TAB)}!A1`,
      values: declarationsRows,
    });

    const summaryPayload = buildSummaryAndKpisSheetPayload();

    // Build structural formatting, AutoFilters, Data Validations, Notes & Banding requests
    const formatRequests = [];
    const headerDarkFormat = {
      backgroundColor: { red: 0.09, green: 0.11, blue: 0.14 },
      textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 0.973, green: 0.98, blue: 0.988 } },
      horizontalAlignment: 'LEFT',
      verticalAlignment: 'MIDDLE',
      wrapStrategy: 'WRAP',
      borders: {
        bottom: { style: 'SOLID_MEDIUM', color: { red: 0.118, green: 0.655, blue: 1.0 } },
      },
    };
    const headerDarkFields =
      'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,borders.bottom)';

    // Clear Summary & KPIs and Declarations cleanly inside batchUpdate before repopulating
    const summaryMeta = sheetByTitle.get(AUX_SUMMARY_TAB);
    const declMeta = sheetByTitle.get(AUX_DECLARATIONS_TAB);
    if (summaryMeta?.properties?.sheetId !== undefined) {
      formatRequests.push({
        repeatCell: {
          range: { sheetId: summaryMeta.properties.sheetId },
          cell: {},
          fields: 'userEnteredValue,userEnteredFormat',
        },
      });
    }
    if (declMeta?.properties?.sheetId !== undefined) {
      formatRequests.push({
        repeatCell: {
          range: { sheetId: declMeta.properties.sheetId },
          cell: {},
          fields: 'userEnteredValue,userEnteredFormat',
        },
      });
    }

    for (const def of SHEETS_SCHEMA_DEFINITIONS) {
      const sheetObj = sheetByTitle.get(def.name);
      const sheetId = sheetObj?.properties?.sheetId;
      if (sheetId === undefined) continue;

      const rawColCount = sheetObj.properties?.gridProperties?.columnCount;
      const currentColCount =
        typeof rawColCount === 'number'
          ? rawColCount - (migratedTabs.has(def.name) ? 1 : 0)
          : undefined;
      if (typeof currentColCount === 'number' && currentColCount < def.headers.length) {
        formatRequests.push({
          updateSheetProperties: {
            properties: {
              sheetId,
              gridProperties: { columnCount: def.headers.length, frozenRowCount: 1 },
            },
            fields: 'gridProperties.columnCount,gridProperties.frozenRowCount',
          },
        });
      } else {
        formatRequests.push({
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount',
          },
        });
      }

      // Row 1 height + dark styled header
      formatRequests.push({
        updateDimensionProperties: {
          range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
          properties: { pixelSize: 34 },
          fields: 'pixelSize',
        },
      });
      formatRequests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: def.headers.length },
          cell: { userEnteredFormat: headerDarkFormat },
          fields: headerDarkFields,
        },
      });

      // Row 1 hover notes
      formatRequests.push({
        updateCells: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: def.headers.length },
          rows: [
            {
              values: def.headers.map((hdr, idx) => ({
                note:
                  HEADER_NOTES_BY_NAME[hdr] ||
                  `Column ${idx + 1} (${def.name}): ${hdr}${def.textColumns?.includes(idx + 1) ? ' [Plain Text @]' : ''}`,
              })),
            },
          ],
          fields: 'note',
        },
      });

      // Explicit pixel widths, number formats (@ text / 0.00 decimals), and dropdown validations
      const textSet = new Set(def.textColumns || []);
      def.headers.forEach((hdr, col0) => {
        const col1 = col0 + 1;
        formatRequests.push({
          updateDimensionProperties: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: col0, endIndex: col0 + 1 },
            properties: { pixelSize: COLUMN_PIXEL_WIDTHS[hdr] || 155 },
            fields: 'pixelSize',
          },
        });
        if (textSet.has(col1)) {
          formatRequests.push({
            repeatCell: {
              range: { sheetId, startRowIndex: 0, startColumnIndex: col0, endColumnIndex: col0 + 1 },
              cell: { userEnteredFormat: { numberFormat: { type: 'TEXT', pattern: '@' } } },
              fields: 'userEnteredFormat.numberFormat',
            },
          });
        } else if (hdr === 'csat' || hdr === 'itp' || hdr === 'overall_csat' || hdr === 'overall_itp') {
          formatRequests.push({
            repeatCell: {
              range: { sheetId, startRowIndex: 1, startColumnIndex: col0, endColumnIndex: col0 + 1 },
              cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '0.00' } } },
              fields: 'userEnteredFormat.numberFormat',
            },
          });
        }

        const listChoices = DROPDOWN_LISTS_BY_HEADER[hdr];
        if (listChoices && listChoices.length > 0) {
          formatRequests.push({
            setDataValidation: {
              range: { sheetId, startRowIndex: 1, startColumnIndex: col0, endColumnIndex: col0 + 1 },
              rule: {
                condition: {
                  type: 'ONE_OF_LIST',
                  values: listChoices.map((v) => ({ userEnteredValue: v })),
                },
                strict: false,
                showCustomUi: true,
              },
            },
          });
        }
      });

      if (def.name === 'Configuration') {
        formatRequests.push({
          repeatCell: {
            range: { sheetId, startRowIndex: 1, startColumnIndex: 1, endColumnIndex: 2 },
            cell: { userEnteredFormat: { wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } },
            fields: 'userEnteredFormat(wrapStrategy,verticalAlignment)',
          },
        });
      }

      formatRequests.push({
        setBasicFilter: {
          filter: {
            range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: def.headers.length },
          },
        },
      });

      if (!(sheetObj.bandedRanges && sheetObj.bandedRanges.length > 0)) {
        formatRequests.push({
          addBanding: {
            bandedRange: {
              range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: def.headers.length },
              rowProperties: {
                headerColor: { red: 0.09, green: 0.11, blue: 0.14 },
                firstBandColor: { red: 1.0, green: 1.0, blue: 1.0 },
                secondBandColor: { red: 0.973, green: 0.98, blue: 0.988 },
              },
            },
          },
        });
      }
    }

    // Format Summary & KPIs tab
    if (summaryMeta?.properties?.sheetId !== undefined) {
      const sSheetId = summaryMeta.properties.sheetId;
      const summaryColWidths = [165, 290, 155, 130, 340, 125, 135, 135];
      formatRequests.push({
        updateSheetProperties: {
          properties: { sheetId: sSheetId, gridProperties: { frozenRowCount: 2 } },
          fields: 'gridProperties.frozenRowCount',
        },
      });
      summaryColWidths.forEach((px, col0) => {
        formatRequests.push({
          updateDimensionProperties: {
            range: { sheetId: sSheetId, dimension: 'COLUMNS', startIndex: col0, endIndex: col0 + 1 },
            properties: { pixelSize: px },
            fields: 'pixelSize',
          },
        });
      });
      summaryPayload.rowKinds.forEach((kind, row0) => {
        if (kind === 'banner') {
          formatRequests.push({
            repeatCell: {
              range: { sheetId: sSheetId, startRowIndex: row0, endRowIndex: row0 + 1, startColumnIndex: 0, endColumnIndex: 8 },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.043, green: 0.071, blue: 0.125 },
                  textFormat: { bold: true, fontSize: 12, foregroundColor: { red: 0.973, green: 0.98, blue: 0.988 } },
                  verticalAlignment: 'MIDDLE',
                },
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment)',
            },
          });
        } else if (kind === 'subtitle') {
          formatRequests.push({
            repeatCell: {
              range: { sheetId: sSheetId, startRowIndex: row0, endRowIndex: row0 + 1, startColumnIndex: 0, endColumnIndex: 8 },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.91, green: 0.965, blue: 1.0 },
                  textFormat: { italic: true, fontSize: 9, foregroundColor: { red: 0.0, green: 0.42, blue: 0.72 } },
                },
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat)',
            },
          });
        } else if (kind === 'section') {
          formatRequests.push({
            repeatCell: {
              range: { sheetId: sSheetId, startRowIndex: row0, endRowIndex: row0 + 1, startColumnIndex: 0, endColumnIndex: 8 },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.941, green: 0.957, blue: 0.973 },
                  textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 0.039, green: 0.106, blue: 0.173 } },
                },
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat)',
            },
          });
        } else if (kind === 'subheader') {
          formatRequests.push({
            repeatCell: {
              range: { sheetId: sSheetId, startRowIndex: row0, endRowIndex: row0 + 1, startColumnIndex: 0, endColumnIndex: 8 },
              cell: { userEnteredFormat: headerDarkFormat },
              fields: headerDarkFields,
            },
          });
        } else if (kind === 'total') {
          formatRequests.push({
            repeatCell: {
              range: { sheetId: sSheetId, startRowIndex: row0, endRowIndex: row0 + 1, startColumnIndex: 0, endColumnIndex: 8 },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.937, green: 0.965, blue: 1.0 },
                  textFormat: { bold: true, foregroundColor: { red: 0.039, green: 0.106, blue: 0.173 } },
                },
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat)',
            },
          });
        } else if (kind === 'data') {
          formatRequests.push({
            repeatCell: {
              range: { sheetId: sSheetId, startRowIndex: row0, endRowIndex: row0 + 1, startColumnIndex: 0, endColumnIndex: 8 },
              cell: {
                userEnteredFormat: {
                  backgroundColor: row0 % 2 === 1 ? { red: 0.973, green: 0.98, blue: 0.988 } : { red: 1.0, green: 1.0, blue: 1.0 },
                },
              },
              fields: 'userEnteredFormat.backgroundColor',
            },
          });
        }
      });
    }

    // Format Declarations tab
    if (declMeta?.properties?.sheetId !== undefined) {
      const dSheetId = declMeta.properties.sheetId;
      const declWidths = [175, 165, 110, 210, 225, 250, 440];
      formatRequests.push({
        updateSheetProperties: {
          properties: { sheetId: dSheetId, gridProperties: { frozenRowCount: 1 } },
          fields: 'gridProperties.frozenRowCount',
        },
      });
      formatRequests.push({
        updateDimensionProperties: {
          range: { sheetId: dSheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
          properties: { pixelSize: 34 },
          fields: 'pixelSize',
        },
      });
      formatRequests.push({
        repeatCell: {
          range: { sheetId: dSheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 7 },
          cell: {
            userEnteredFormat: {
              numberFormat: { type: 'TEXT', pattern: '@' },
              wrapStrategy: 'WRAP',
              verticalAlignment: 'MIDDLE',
            },
          },
          fields: 'userEnteredFormat(numberFormat,wrapStrategy,verticalAlignment)',
        },
      });
      formatRequests.push({
        repeatCell: {
          range: { sheetId: dSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 7 },
          cell: { userEnteredFormat: headerDarkFormat },
          fields: headerDarkFields,
        },
      });
      declWidths.forEach((px, col0) => {
        formatRequests.push({
          updateDimensionProperties: {
            range: { sheetId: dSheetId, dimension: 'COLUMNS', startIndex: col0, endIndex: col0 + 1 },
            properties: { pixelSize: px },
            fields: 'pixelSize',
          },
        });
      });
      formatRequests.push({
        setBasicFilter: {
          filter: {
            range: { sheetId: dSheetId, startRowIndex: 0, endRowIndex: declarationsRows.length, startColumnIndex: 0, endColumnIndex: 7 },
          },
        },
      });
      if (!(declMeta.bandedRanges && declMeta.bandedRanges.length > 0)) {
        formatRequests.push({
          addBanding: {
            bandedRange: {
              range: { sheetId: dSheetId, startRowIndex: 0, endRowIndex: declarationsRows.length, startColumnIndex: 0, endColumnIndex: 7 },
              rowProperties: {
                headerColor: { red: 0.09, green: 0.11, blue: 0.14 },
                firstBandColor: { red: 1.0, green: 1.0, blue: 1.0 },
                secondBandColor: { red: 0.973, green: 0.98, blue: 0.988 },
              },
            },
          },
        });
      }
    }

    if (formatRequests.length > 0) {
      await callGoogle(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
        {
          method: 'POST',
          body: JSON.stringify({ requests: formatRequests }),
        },
      );
    }

    if (rawUpdates.length > 0) {
      await callGoogle(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          spreadsheetId,
        )}/values:batchUpdate`,
        {
          method: 'POST',
          body: JSON.stringify({
            valueInputOption: 'RAW',
            data: rawUpdates,
          }),
        },
      );
    }

    // Write live formulas on Summary & KPIs using USER_ENTERED
    await callGoogle(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId,
      )}/values:batchUpdate`,
      {
        method: 'POST',
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: [
            {
              range: `${a1Tab(AUX_SUMMARY_TAB)}!A1`,
              values: summaryPayload.rows,
            },
          ],
        }),
      },
    );

    // Idempotently ensure the two protected Super Admin accounts exist in Admin Users
    const adminCheck = await callGoogle(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId,
      )}/values/${encodeURIComponent(`${a1Tab('Admin Users')}!C2:C`)}`,
    );
    const existingAdminEmails = new Set(
      (adminCheck.values || []).flat().map((e) => String(e || '').trim().toLowerCase()),
    );
    const nowIso = new Date().toISOString();
    const missingAdmins = ALLOWLISTED_SUPER_ADMINS.filter((sa) => !existingAdminEmails.has(sa.email));
    if (missingAdmins.length > 0) {
      await callGoogle(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          spreadsheetId,
        )}/values/${encodeURIComponent(`${a1Tab('Admin Users')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        {
          method: 'POST',
          body: JSON.stringify({
            values: missingAdmins.map((sa) => [
              sa.userId,
              sa.name,
              sa.email,
              'super_admin',
              'true',
              nowIso,
              nowIso,
              'APPROVED',
            ]),
          }),
        },
      );
    }

    // Seed missing Configuration keys idempotently without overwriting existing admin config
    const cfgCheck = await callGoogle(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId,
      )}/values/${encodeURIComponent(`${a1Tab('Configuration')}!A2:A`)}`,
    );
    const existingCfgKeys = new Set(
      (cfgCheck.values || []).flat().map((k) => String(k || '').trim()),
    );
    const defaultCfgPairs = [
      ['programme_timezone', 'Asia/Kolkata'],
      ['state_name', 'Tamil Nadu'],
      ['allowed_districts', ['Cuddalore', 'Nagapattinam', 'Sivaganga']],
      ['grade_options', ['8', '9', '10', '11', '12']],
      ['section_options', ['A', 'B', 'C', 'D', 'E', 'F', 'No section']],
      ['school_types', DROPDOWN_LISTS_BY_HEADER.school_type],
      ['language_options', DROPDOWN_LISTS_BY_HEADER.language],
      ['school_year', '2026-27'],
      ['partner_name', ''],
    ];
    const missingCfgRows = defaultCfgPairs
      .filter(([k]) => !existingCfgKeys.has(k))
      .map(([k, v]) => [k, JSON.stringify(v), nowIso, actorEmail]);
    if (missingCfgRows.length > 0) {
      await callGoogle(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          spreadsheetId,
        )}/values/${encodeURIComponent(`${a1Tab('Configuration')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        {
          method: 'POST',
          body: JSON.stringify({ values: missingCfgRows }),
        },
      );
    }

    // Append initial audit event safely
    await callGoogle(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId,
      )}/values/${encodeURIComponent(`${a1Tab('Audit Log')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        body: JSON.stringify({
          values: [
            [
              `AUD_${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
              nowIso,
              findAllowlistedSuperAdmin(actorEmail)?.userId || 'SA_ADMIN',
              actorEmail,
              'CONNECT_GOOGLE_SHEET',
              'Configuration',
              spreadsheetId,
              '',
              `Connected & initialized 8 core DB tabs + Summary & KPIs + Declarations in "${meta.properties?.title || spreadsheetId}"`,
              'SUCCESS',
            ],
          ],
        }),
      },
    );

    return {
      spreadsheetId: meta.spreadsheetId || spreadsheetId,
      spreadsheetName: meta.properties?.title || 'Career Tours Spreadsheet',
      spreadsheetUrl:
        meta.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
      initializedTabs: SHEETS_SCHEMA_DEFINITIONS.map((d) => d.name),
    };
  }

  return async function handleSheetsRequest(req, res) {
    const clientId = String(env.GOOGLE_CLIENT_ID || '').trim();
    const clientSecret = String(env.GOOGLE_CLIENT_SECRET || '').trim();
    const tokenSecret = String(env.SHEETS_TOKEN_SECRET || '').trim();
    const oauthConfigured = Boolean(clientId && clientSecret && tokenSecret.length >= 16);
    const secureCookie = isSecureRequest(req);
    const cors = resolveCorsContext(req, env);
    const cookieSameSite = cors.isCrossOrigin && secureCookie ? 'None' : 'Lax';

    if (req.method === 'OPTIONS') {
      applyCorsHeaders(res, cors);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Max-Age', '86400');
      res.statusCode = 204;
      res.end();
      return;
    }

    const requestUrl = new URL(req.url || '/api/sheets', resolveBaseOrigin(req));
    const action = requestUrl.searchParams.get('action') || '';
    const cookies = parseCookies(req.headers.cookie);

    if (req.method === 'GET') {
      if (action === 'status') {
        const rawStatusSession = oauthConfigured
          ? decryptCookiePayload(cookies[SESSION_COOKIE_NAME], tokenSecret)
          : null;
        let statusSession = rawStatusSession;
        const statusCookies = [];
        if (oauthConfigured && rawStatusSession && rawStatusSession.accessToken) {
          try {
            const refreshedCheck = await ensureFreshAccessToken(
              rawStatusSession,
              clientId,
              clientSecret,
            );
            statusSession = refreshedCheck.session;
            if (refreshedCheck.refreshed) {
              statusCookies.push(
                formatCookie(
                  SESSION_COOKIE_NAME,
                  encryptCookiePayload(refreshedCheck.session, tokenSecret),
                  {
                    secure: secureCookie,
                    sameSite: cookieSameSite,
                  },
                ),
              );
            }
          } catch (err) {
            if (err?.apiCode === 'OAUTH_REFRESH_FAILED' || err?.apiCode === 'OAUTH_EXPIRED') {
              statusSession = {
                ...rawStatusSession,
                spreadsheetId: '',
                accessToken: '',
              };
            }
          }
        }
        return sendJson(
          res,
          200,
          {
            ok: true,
            data: sanitizePublicConnectionState(statusSession, oauthConfigured),
          },
          statusCookies,
          cors,
        );
      }

      if (action === 'oauthStart') {
        if (!oauthConfigured) {
          return sendRedirect(
            res,
            '/admin/overview?sheets_oauth=error&reason=oauth_not_configured',
            [],
            cors,
          );
        }
        const state = crypto.randomBytes(24).toString('base64url');
        const redirectUri = `${resolveBaseOrigin(req)}/api/sheets?action=oauthCallback`;
        const hintEmail = String(requestUrl.searchParams.get('login_hint') || '').trim().toLowerCase();
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope:
            'openid email profile https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.metadata.readonly',
          access_type: 'offline',
          prompt: 'consent',
          state,
        });
        if (hintEmail && isAllowlistedSuperAdminEmail(hintEmail)) {
          params.set('login_hint', hintEmail);
        }
        const encryptedState = encryptCookiePayload(
          { state, createdAt: Date.now() },
          tokenSecret,
        );
        return sendRedirect(
          res,
          `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
          [
            formatCookie(OAUTH_STATE_COOKIE_NAME, encryptedState, {
              maxAgeSeconds: 600,
              secure: secureCookie,
              sameSite: 'Lax',
            }),
          ],
          cors,
        );
      }

      if (action === 'oauthCallback') {
        const clearStateCookie = formatCookie(OAUTH_STATE_COOKIE_NAME, '', {
          maxAgeSeconds: 0,
          secure: secureCookie,
          sameSite: 'Lax',
        });
        if (!oauthConfigured) {
          return sendRedirect(
            res,
            '/admin/overview?sheets_oauth=error&reason=oauth_not_configured',
            [clearStateCookie],
            cors,
          );
        }

        const oauthErr = requestUrl.searchParams.get('error');
        if (oauthErr) {
          return sendRedirect(
            res,
            `/admin/overview?sheets_oauth=error&reason=${encodeURIComponent(oauthErr)}`,
            [clearStateCookie],
            cors,
          );
        }

        const returnedState = requestUrl.searchParams.get('state') || '';
        const code = requestUrl.searchParams.get('code') || '';
        const savedStatePayload = decryptCookiePayload(cookies[OAUTH_STATE_COOKIE_NAME], tokenSecret);
        if (!savedStatePayload || savedStatePayload.state !== returnedState || !code) {
          return sendRedirect(
            res,
            '/admin/overview?sheets_oauth=error&reason=invalid_state',
            [clearStateCookie],
            cors,
          );
        }

        const redirectUri = `${resolveBaseOrigin(req)}/api/sheets?action=oauthCallback`;
        const tokenRes = await fetchImpl('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }).toString(),
        });
        if (!tokenRes.ok) {
          return sendRedirect(
            res,
            '/admin/overview?sheets_oauth=error&reason=token_exchange_failed',
            [clearStateCookie],
            cors,
          );
        }

        const tokens = await tokenRes.json();
        const userRes = await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (!userRes.ok) {
          return sendRedirect(
            res,
            '/admin/overview?sheets_oauth=error&reason=userinfo_failed',
            [clearStateCookie],
            cors,
          );
        }
        const profile = await userRes.json();
        const email = String(profile.email || '').trim().toLowerCase();
        if (!profile.email_verified || !isAllowlistedSuperAdminEmail(email)) {
          return sendRedirect(
            res,
            '/admin/overview?sheets_oauth=error&reason=unauthorized_admin',
            [clearStateCookie],
            cors,
          );
        }

        const existingSession =
          decryptCookiePayload(cookies[SESSION_COOKIE_NAME], tokenSecret) || {};
        const nextSession = {
          ...existingSession,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || existingSession.refreshToken || '',
          expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
          connectedAccount: email,
        };
        const encryptedSession = encryptCookiePayload(nextSession, tokenSecret);

        return sendRedirect(
          res,
          '/admin/overview?sheets_oauth=authorized',
          [
            clearStateCookie,
            formatCookie(SESSION_COOKIE_NAME, encryptedSession, {
              secure: secureCookie,
              sameSite: cookieSameSite,
            }),
          ],
          cors,
        );
      }

      return sendJson(
        res,
        400,
        { ok: false, code: 'BAD_REQUEST', error: 'Unknown GET action.' },
        [],
        cors,
      );
    }

    if (req.method !== 'POST') {
      return sendJson(
        res,
        405,
        { ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed.' },
        [],
        cors,
      );
    }

    if (!oauthConfigured) {
      return sendJson(
        res,
        503,
        {
          ok: false,
          code: 'SERVER_MISCONFIGURED',
          error:
            'Google OAuth 2.0 server credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SHEETS_TOKEN_SECRET) are not configured on the backend.',
        },
        [],
        cors,
      );
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(
        res,
        err.statusCode || 400,
        {
          ok: false,
          code: err.apiCode || 'BAD_REQUEST',
          error: err.message || 'Invalid JSON body.',
        },
        [],
        cors,
      );
    }

    const postAction = String(body.action || action || '').trim();
    const rawSession = decryptCookiePayload(cookies[SESSION_COOKIE_NAME], tokenSecret);
    const idTokenEmail = await verifyIdTokenHeader(req.headers.authorization, clientId);
    const actorEmail =
      (rawSession?.connectedAccount && isAllowlistedSuperAdminEmail(rawSession.connectedAccount)
        ? rawSession.connectedAccount
        : '') || idTokenEmail;

    if (!actorEmail || !isAllowlistedSuperAdminEmail(actorEmail)) {
      return sendJson(
        res,
        403,
        {
          ok: false,
          code: 'FORBIDDEN',
          error: 'Only approved Super Administrators may manage Google Sheets connections.',
        },
        [],
        cors,
      );
    }

    try {
      if (postAction === 'disconnect') {
        if (rawSession?.accessToken) {
          // Best-effort token revocation on Google side
          await fetchImpl(
            `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(rawSession.accessToken)}`,
            { method: 'POST' },
          ).catch(() => undefined);
        }
        const cleared = formatCookie(SESSION_COOKIE_NAME, '', {
          maxAgeSeconds: 0,
          secure: secureCookie,
          sameSite: cookieSameSite,
        });
        return sendJson(
          res,
          200,
          { ok: true, data: sanitizePublicConnectionState(null, oauthConfigured) },
          [cleared],
          cors,
        );
      }

      const initialFresh = await ensureFreshAccessToken(rawSession, clientId, clientSecret);
      const sessionState = {
        current: initialFresh.session,
        dirty: initialFresh.refreshed,
      };
      const callGoogle = (url, opts) =>
        googleApiWithSession(sessionState, clientId, clientSecret, url, opts);

      const pendingCookies = [];
      const persistSession = (next) => {
        pendingCookies.push(
          formatCookie(SESSION_COOKIE_NAME, encryptCookiePayload(next, tokenSecret), {
            secure: secureCookie,
            sameSite: cookieSameSite,
          }),
        );
      };

      if (postAction === 'listSpreadsheets') {
        const driveRes = await callGoogle(
          "https://www.googleapis.com/drive/v3/files?q=mimeType%3D'application%2Fvnd.google-apps.spreadsheet'+and+trashed%3Dfalse&fields=files(id,name,webViewLink,modifiedTime)&orderBy=modifiedTime+desc&pageSize=25",
        );
        if (sessionState.dirty) persistSession(sessionState.current);
        return sendJson(
          res,
          200,
          {
            ok: true,
            data: (driveRes.files || []).map((f) => ({
              spreadsheetId: f.id,
              name: f.name,
              url: f.webViewLink || `https://docs.google.com/spreadsheets/d/${f.id}/edit`,
              modifiedTime: f.modifiedTime || '',
            })),
          },
          pendingCookies,
          cors,
        );
      }

      if (postAction === 'connect') {
        const spreadsheetId = parseSpreadsheetId(body.spreadsheetUrlOrId || DEFAULT_TARGET_SPREADSHEET_ID);
        if (!spreadsheetId) {
          return sendJson(
            res,
            400,
            {
              ok: false,
              code: 'INVALID_SPREADSHEET_ID',
              error: 'Please provide a valid Google Spreadsheet URL or ID.',
            },
            [],
            cors,
          );
        }
        const info = await initializeSpreadsheetSchema(spreadsheetId, callGoogle, actorEmail);
        const nowIso = new Date().toISOString();
        const updatedSession = {
          ...sessionState.current,
          spreadsheetId: info.spreadsheetId,
          spreadsheetName: info.spreadsheetName,
          spreadsheetUrl: info.spreadsheetUrl,
          initializedTabs: info.initializedTabs,
          connectedAt: nowIso,
          connectedBy: actorEmail,
          lastSyncedAt: nowIso,
          lastSyncStatus: 'SYNCED',
          lastSyncMessage: 'Connected & verified 8 core DB tabs + Summary & KPIs + Declarations cleanly.',
        };
        persistSession(updatedSession);
        return sendJson(
          res,
          200,
          { ok: true, data: sanitizePublicConnectionState(updatedSession, oauthConfigured) },
          pendingCookies,
          cors,
        );
      }

      if (postAction === 'create') {
        const title = String(body.title || 'Vidhya Vidhai · Career Tours Database').trim();
        if (!title) {
          return sendJson(
            res,
            400,
            {
              ok: false,
              code: 'INVALID_TITLE',
              error: 'Spreadsheet name is required.',
            },
            [],
            cors,
          );
        }
        const created = await callGoogle(
          'https://sheets.googleapis.com/v4/spreadsheets',
          {
            method: 'POST',
            body: JSON.stringify({
              properties: { title, timeZone: 'Asia/Kolkata' },
              sheets: [
                ...SHEETS_SCHEMA_DEFINITIONS.map((d) => ({
                  properties: {
                    title: d.name,
                    gridProperties: {
                      frozenRowCount: 1,
                      rowCount: 1000,
                      columnCount: Math.max(26, d.headers.length),
                    },
                  },
                })),
                {
                  properties: {
                    title: AUX_SUMMARY_TAB,
                    gridProperties: { frozenRowCount: 2, rowCount: 1000, columnCount: 26 },
                  },
                },
                {
                  properties: {
                    title: AUX_DECLARATIONS_TAB,
                    gridProperties: { frozenRowCount: 1, rowCount: 1000, columnCount: 26 },
                  },
                },
              ],
            }),
          },
        );
        const info = await initializeSpreadsheetSchema(created.spreadsheetId, callGoogle, actorEmail);
        const nowIso = new Date().toISOString();
        const updatedSession = {
          ...sessionState.current,
          spreadsheetId: info.spreadsheetId,
          spreadsheetName: info.spreadsheetName,
          spreadsheetUrl: info.spreadsheetUrl,
          initializedTabs: info.initializedTabs,
          connectedAt: nowIso,
          connectedBy: actorEmail,
          lastSyncedAt: nowIso,
          lastSyncStatus: 'SYNCED',
          lastSyncMessage: `Created "${info.spreadsheetName}" with 8 core DB tabs + Summary & KPIs + Declarations.`,
        };
        persistSession(updatedSession);
        return sendJson(
          res,
          200,
          { ok: true, data: sanitizePublicConnectionState(updatedSession, oauthConfigured) },
          pendingCookies,
          cors,
        );
      }

      const actorInfo = findAllowlistedSuperAdmin(actorEmail) || {
        userId: `SA_${crypto.createHash('sha1').update(actorEmail).digest('hex').slice(0, 8).toUpperCase()}`,
        name: actorEmail.split('@')[0] || actorEmail,
        email: actorEmail,
      };

      const requireConnectedSpreadsheet = () => {
        if (!sessionState.current.spreadsheetId) {
          sendJson(
            res,
            400,
            {
              ok: false,
              code: 'NOT_CONNECTED',
              error: 'Connect a Google Spreadsheet before reading or writing programme data.',
            },
            [],
            cors,
          );
          return null;
        }
        return sessionState.current.spreadsheetId;
      };

      const appendLogRows = async (spreadsheetId, { auditRow = null, syncRow = null }) => {
        const ops = [];
        if (auditRow) {
          ops.push(
            callGoogle(
              `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
                spreadsheetId,
              )}/values/${encodeURIComponent(`${a1Tab('Audit Log')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
              { method: 'POST', body: JSON.stringify({ values: [auditRow] }) },
            ),
          );
        }
        if (syncRow) {
          ops.push(
            callGoogle(
              `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
                spreadsheetId,
              )}/values/${encodeURIComponent(`${a1Tab('Sync Log')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
              { method: 'POST', body: JSON.stringify({ values: [syncRow] }) },
            ),
          );
        }
        if (ops.length > 0) {
          await Promise.all(ops);
        }
      };

      const batchGetRanges = async (spreadsheetId, ranges) => {
        const resBatch = await callGoogle(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
            spreadsheetId,
          )}/values:batchGet?${ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&')}`,
        );
        return (resBatch?.valueRanges || []).map((vr) => vr?.values || []);
      };

      if (postAction === 'sync') {
        if (!sessionState.current.spreadsheetId) {
          return sendJson(
            res,
            400,
            {
              ok: false,
              code: 'NOT_CONNECTED',
              error: 'Connect a Google Spreadsheet before syncing programme data.',
            },
            [],
            cors,
          );
        }

        const spreadsheetId = sessionState.current.spreadsheetId;
        const [
          sessionHeaderRows,
          existingSessionKeys,
          existingDetailRows,
          schoolHeaderRows,
          existingSchoolRows,
          existingFacRows,
          existingCfgRows,
        ] = await batchGetRanges(spreadsheetId, [
          `${a1Tab('Sessions')}!1:1`,
          `${a1Tab('Sessions')}!A2:C`,
          `${a1Tab('Session Details')}!A2:A`,
          `${a1Tab('Schools')}!1:1`,
          `${a1Tab('Schools')}!A2:C`,
          `${a1Tab('Facilitators')}!A2:C`,
          `${a1Tab('Configuration')}!A2:D`,
        ]);
        const sessionLayout = resolveSessionSheetLayout(sessionHeaderRows[0] || []);
        const schoolLayout = resolveSchoolSheetLayout(schoolHeaderRows[0] || []);

        const seenRecordIds = new Set();
        const seenSessionIds = new Set();
        const seenClientKeys = new Set();
        for (const r of existingSessionKeys) {
          if (r[0]) seenRecordIds.add(String(r[0]).trim());
          if (r[1]) seenSessionIds.add(String(r[1]).trim());
          if (r[2]) seenClientKeys.add(String(r[2]).trim());
        }

        const seenDetailIds = new Set();
        for (const r of existingDetailRows) {
          if (r[0]) seenDetailIds.add(String(r[0]).trim());
        }

        const incomingSessions = Array.isArray(body.sessions) ? body.sessions : [];
        const sessionRowsToAppend = [];
        const detailRowsToAppend = [];
        let skippedDuplicates = 0;

        for (const s of incomingSessions) {
          if (!s || !s.sessionId) continue;
          const rId = String(s.sessionRecordId || '').trim();
          const sId = String(s.sessionId || '').trim();
          const cKey = String(s.clientSubmissionKey || '').trim();
          if (
            (rId && seenRecordIds.has(rId)) ||
            (sId && seenSessionIds.has(sId)) ||
            (cKey && seenClientKeys.has(cKey))
          ) {
            skippedDuplicates++;
            continue;
          }
          sessionRowsToAppend.push(serializeSessionRow(s, sessionLayout.hasBlock));
          for (const d of s.details || []) {
            const dId = String(d.detailRecordId || '').trim();
            if (dId && seenDetailIds.has(dId)) continue;
            detailRowsToAppend.push([
              dId,
              s.sessionRecordId || '',
              s.sessionId || '',
              String(d.grade || ''),
              String(d.section || ''),
              d.studentsPresent ?? 0,
              d.questionAScore5 ?? 0,
              d.questionAScore4 ?? 0,
              d.questionAScore3 ?? 0,
              d.questionAScore2 ?? 0,
              d.questionAScore1 ?? 0,
              d.questionATotal ?? 0,
              d.questionAWeightedScore ?? 0,
              d.csat ?? '',
              d.questionBScore5 ?? 0,
              d.questionBScore4 ?? 0,
              d.questionBScore3 ?? 0,
              d.questionBScore2 ?? 0,
              d.questionBScore1 ?? 0,
              d.questionBTotal ?? 0,
              d.questionBWeightedScore ?? 0,
              d.itp ?? '',
              d.createdAt || s.createdAt || '',
              d.updatedAt || s.updatedAt || '',
            ]);
            if (dId) seenDetailIds.add(dId);
          }
          if (rId) seenRecordIds.add(rId);
          seenSessionIds.add(sId);
          if (cKey) seenClientKeys.add(cKey);
        }

        if (sessionRowsToAppend.length > 0) {
          await callGoogle(
            `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
              spreadsheetId,
            )}/values/${encodeURIComponent(`${a1Tab('Sessions')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
            { method: 'POST', body: JSON.stringify({ values: sessionRowsToAppend }) },
          );
        }
        if (detailRowsToAppend.length > 0) {
          await callGoogle(
            `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
              spreadsheetId,
            )}/values/${encodeURIComponent(`${a1Tab('Session Details')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
            { method: 'POST', body: JSON.stringify({ values: detailRowsToAppend }) },
          );
        }

        const nowIso = new Date().toISOString();

        // Optional deduplicated Schools sync (explicit schools + session-derived schools if requested)
        const seenSchoolIds = new Set();
        const seenSchoolUdises = new Set();
        for (const r of existingSchoolRows) {
          if (r[0]) seenSchoolIds.add(String(r[0]).trim());
          if (r[2]) seenSchoolUdises.add(String(r[2]).trim());
        }
        const incomingSchools = Array.isArray(body.schools) ? [...body.schools] : [];
        if (Array.isArray(body.schools)) {
          for (const s of incomingSessions) {
            const udise = String(s?.udiseCode || '').trim();
            if (!udise) continue;
            if (!incomingSchools.some((sc) => String(sc?.udiseCode || '').trim() === udise)) {
              incomingSchools.push({
                schoolRecordId: `SCH_${udise}`,
                schoolName: s.schoolName || '',
                udiseCode: udise,
                schoolType: s.schoolType || '',
                state: s.state || 'Tamil Nadu',
                district: s.district || '',
                pinCode: String(s.pinCode || ''),
                active: true,
                createdAt: s.createdAt || nowIso,
                updatedAt: s.updatedAt || nowIso,
              });
            }
          }
        }
        const schoolRowsToAppend = [];
        for (const sc of incomingSchools) {
          if (!sc) continue;
          const scId = String(sc.schoolRecordId || '').trim();
          const udise = String(sc.udiseCode || '').trim();
          if (!udise && !scId) continue;
          if ((scId && seenSchoolIds.has(scId)) || (udise && seenSchoolUdises.has(udise))) continue;
          schoolRowsToAppend.push(
            serializeSchoolRow(
              {
                schoolRecordId: scId || `SCH_${udise}`,
                schoolName: sc.schoolName || '',
                udiseCode: udise,
                schoolType: sc.schoolType || '',
                state: sc.state || 'Tamil Nadu',
                district: sc.district || '',
                pinCode: String(sc.pinCode || ''),
                active: sc.active !== false,
                createdAt: sc.createdAt || nowIso,
                updatedAt: sc.updatedAt || nowIso,
              },
              schoolLayout.hasBlock,
            ),
          );
          if (scId) seenSchoolIds.add(scId);
          if (udise) seenSchoolUdises.add(udise);
        }
        if (schoolRowsToAppend.length > 0) {
          await callGoogle(
            `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
              spreadsheetId,
            )}/values/${encodeURIComponent(`${a1Tab('Schools')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
            { method: 'POST', body: JSON.stringify({ values: schoolRowsToAppend }) },
          );
        }

        // Optional deduplicated Facilitators sync (never insert Super Admins into Facilitators tab)
        const seenFacIds = new Set();
        const seenFacEmails = new Set();
        for (const r of existingFacRows) {
          if (r[0]) seenFacIds.add(String(r[0]).trim());
          if (r[2]) seenFacEmails.add(String(r[2]).trim().toLowerCase());
        }
        const facRowsToAppend = [];
        if (Array.isArray(body.facilitators)) {
          for (const u of body.facilitators) {
            if (!u) continue;
            const emailClean = String(u.email || '').trim().toLowerCase();
            if (!emailClean || isAllowlistedSuperAdminEmail(emailClean) || u.role === 'super_admin') {
              continue;
            }
            const uId = String(u.userId || '').trim();
            if ((uId && seenFacIds.has(uId)) || seenFacEmails.has(emailClean)) continue;
            const status =
              u.status === 'APPROVED' || u.status === 'PENDING' || u.status === 'DENIED'
                ? u.status
                : u.active === false
                  ? 'DENIED'
                  : 'APPROVED';
            const activeFlag = status === 'APPROVED';
            facRowsToAppend.push([
              uId || `FAC_${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
              String(u.name || emailClean.split('@')[0] || emailClean),
              emailClean,
              'facilitator',
              activeFlag ? 'true' : 'false',
              String(u.createdAt || nowIso),
              String(u.updatedAt || nowIso),
              status,
            ]);
            if (uId) seenFacIds.add(uId);
            seenFacEmails.add(emailClean);
          }
        }
        if (facRowsToAppend.length > 0) {
          await callGoogle(
            `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
              spreadsheetId,
            )}/values/${encodeURIComponent(`${a1Tab('Facilitators')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
            { method: 'POST', body: JSON.stringify({ values: facRowsToAppend }) },
          );
        }

        // Optional Configuration upsert
        if (body.configuration && typeof body.configuration === 'object' && !Array.isArray(body.configuration)) {
          const cfgEntries = buildConfigKeyValuesFromPartial(body.configuration);
          if (cfgEntries.length > 0) {
            const keyToRowNum = new Map();
            existingCfgRows.forEach((r, idx) => {
              const k = String(r[0] || '').trim();
              if (k) keyToRowNum.set(k, idx + 2);
            });
            const batchUpdates = [];
            const appendRows = [];
            for (const [k, valJson] of cfgEntries) {
              const rowValues = [k, valJson, nowIso, actorEmail];
              const existingRowNum = keyToRowNum.get(k);
              if (existingRowNum) {
                batchUpdates.push({
                  range: `${a1Tab('Configuration')}!A${existingRowNum}:D${existingRowNum}`,
                  values: [rowValues],
                });
              } else {
                appendRows.push(rowValues);
              }
            }
            if (batchUpdates.length > 0) {
              await callGoogle(
                `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
                  spreadsheetId,
                )}/values:batchUpdate`,
                {
                  method: 'POST',
                  body: JSON.stringify({ valueInputOption: 'RAW', data: batchUpdates }),
                },
              );
            }
            if (appendRows.length > 0) {
              await callGoogle(
                `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
                  spreadsheetId,
                )}/values/${encodeURIComponent(`${a1Tab('Configuration')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
                {
                  method: 'POST',
                  body: JSON.stringify({ values: appendRows }),
                },
              );
            }
          }
        }

        const syncedParts = [];
        if (sessionRowsToAppend.length > 0) syncedParts.push(`${sessionRowsToAppend.length} session(s)`);
        if (schoolRowsToAppend.length > 0) syncedParts.push(`${schoolRowsToAppend.length} school(s)`);
        if (facRowsToAppend.length > 0) syncedParts.push(`${facRowsToAppend.length} facilitator(s)`);

        const message =
          syncedParts.length > 0
            ? `Synced ${syncedParts.join(', ')}; skipped ${skippedDuplicates} existing duplicate(s).`
            : `Verified ${seenRecordIds.size} session(s) up to date (0 duplicates written).`;

        await appendLogRows(spreadsheetId, {
          auditRow: [
            `AUD_${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
            nowIso,
            actorInfo.userId,
            actorEmail,
            'SYNC_GOOGLE_SHEET',
            'Configuration',
            spreadsheetId,
            '',
            message,
            'SUCCESS',
          ],
          syncRow: [
            `SYNC_${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
            nowIso,
            'BULK_SYNC',
            spreadsheetId,
            'ALL',
            actorEmail,
            'syncAllToGoogleSheet',
            1,
            'SYNCED',
            '',
          ],
        });

        const updatedSession = {
          ...sessionState.current,
          lastSyncedAt: nowIso,
          lastSyncStatus: 'SYNCED',
          lastSyncMessage: message,
        };
        persistSession(updatedSession);
        return sendJson(
          res,
          200,
          {
            ok: true,
            data: {
              syncedCount: sessionRowsToAppend.length,
              skippedDuplicates,
              totalSheetSessions: seenRecordIds.size,
              syncedSchoolsCount: schoolRowsToAppend.length,
              syncedFacilitatorsCount: facRowsToAppend.length,
              syncedAt: nowIso,
              message,
            },
          },
          pendingCookies,
          cors,
        );
      }

      if (postAction === 'loadWorkspace') {
        const spreadsheetId = requireConnectedSpreadsheet();
        if (!spreadsheetId) return;

        const [
          sessAllRows,
          detailRows,
          schoolAllRows,
          facRows,
          adminRows,
          cfgRows,
          auditRows,
          syncRows,
        ] = await batchGetRanges(spreadsheetId, [
          `${a1Tab('Sessions')}!A1:AP`,
          `${a1Tab('Session Details')}!A2:X`,
          `${a1Tab('Schools')}!A1:K`,
          `${a1Tab('Facilitators')}!A2:H`,
          `${a1Tab('Admin Users')}!A2:H`,
          `${a1Tab('Configuration')}!A2:D`,
          `${a1Tab('Audit Log')}!A2:J`,
          `${a1Tab('Sync Log')}!A2:J`,
        ]);

        const sessHeader = sessAllRows[0] || [];
        const sessRows = sessAllRows.slice(1);
        const schoolHeader = schoolAllRows[0] || [];
        const schoolRows = schoolAllRows.slice(1);

        const detailsBySessionRecordId = new Map();
        for (const r of detailRows) {
          const parsedDetail = parseDetailRow(r);
          if (!parsedDetail) continue;
          const list = detailsBySessionRecordId.get(parsedDetail.sessionRecordId) || [];
          list.push(parsedDetail);
          detailsBySessionRecordId.set(parsedDetail.sessionRecordId, list);
        }

        const sessions = sessRows
          .map((r) => parseSessionRow(r, detailsBySessionRecordId, sessHeader))
          .filter(Boolean)
          .reverse();

        const schools = schoolRows.map((r) => parseSchoolRow(r, schoolHeader)).filter(Boolean);

        const usersByEmail = new Map();
        for (const r of adminRows) {
          const u = parseUserRow(r, 'super_admin');
          if (u && isAllowlistedSuperAdminEmail(u.email)) {
            usersByEmail.set(u.email, u);
          }
        }
        for (const sa of ALLOWLISTED_SUPER_ADMINS) {
          if (!usersByEmail.has(sa.email)) {
            const nowIso = new Date().toISOString();
            usersByEmail.set(sa.email, {
              userId: sa.userId,
              name: sa.name,
              email: sa.email,
              role: 'super_admin',
              active: true,
              status: 'APPROVED',
              createdAt: nowIso,
              updatedAt: nowIso,
            });
          }
        }
        for (const r of facRows) {
          const u = parseUserRow(r, 'facilitator');
          if (u && !isAllowlistedSuperAdminEmail(u.email)) {
            usersByEmail.set(u.email, u);
          }
        }

        const { configurationPatch } = parseConfigFromSheetRows(cfgRows);
        const auditLogs = auditRows.map(parseAuditRow).filter(Boolean).reverse().slice(0, 250);
        const syncLogs = syncRows.map(parseSyncRow).filter(Boolean).reverse().slice(0, 250);

        if (sessionState.dirty) persistSession(sessionState.current);
        return sendJson(
          res,
          200,
          {
            ok: true,
            data: {
              sessions,
              schools,
              users: Array.from(usersByEmail.values()),
              configurationPatch,
              auditLogs,
              syncLogs,
              spreadsheetId,
            },
          },
          pendingCookies,
          cors,
        );
      }

      if (postAction === 'createSession') {
        const spreadsheetId = requireConnectedSpreadsheet();
        if (!spreadsheetId) return;

        const rawValues = body.values || body;
        const [cfgRows, sessAllRows, schoolAllRows] = await batchGetRanges(spreadsheetId, [
          `${a1Tab('Configuration')}!A2:D`,
          `${a1Tab('Sessions')}!A1:AP`,
          `${a1Tab('Schools')}!A1:K`,
        ]);
        const sessHeader = sessAllRows[0] || [];
        const sessRows = sessAllRows.slice(1);
        const sessionLayout = resolveSessionSheetLayout(sessHeader);
        const schoolHeader = schoolAllRows[0] || [];
        const schoolRows = schoolAllRows.slice(1);
        const schoolLayout = resolveSchoolSheetLayout(schoolHeader);

        const clientKey = String(rawValues?.clientSubmissionKey || '').trim();
        if (clientKey) {
          const existingCommittedRow = sessRows.find(
            (r) =>
              String(r[2] || '').trim() === clientKey &&
              String(r[sessionLayout.statusCol1 - 1] || '').trim().toUpperCase() !== 'PENDING',
          );
          if (existingCommittedRow) {
            const existingRecordId = String(existingCommittedRow[0] || '').trim();
            const [detailRows] = await batchGetRanges(spreadsheetId, [
              `${a1Tab('Session Details')}!A2:X`,
            ]);
            const detailsMap = new Map();
            const list = [];
            for (const dr of detailRows) {
              const d = parseDetailRow(dr);
              if (d && d.sessionRecordId === existingRecordId) list.push(d);
            }
            detailsMap.set(existingRecordId, list);
            const existingSession = parseSessionRow(existingCommittedRow, detailsMap, sessHeader);
            if (sessionState.dirty) persistSession(sessionState.current);
            return sendJson(
              res,
              200,
              {
                ok: true,
                data: {
                  session: existingSession,
                  warnings: ['Duplicate submission prevented — returned existing record.'],
                },
              },
              pendingCookies,
              cors,
            );
          }
        }

        const { config } = parseConfigFromSheetRows(cfgRows);
        const validated = computeSessionMetricsAndValidateServer(rawValues, config, actorInfo);
        if (!validated.valid) {
          return sendJson(
            res,
            400,
            {
              ok: false,
              code: 'VALIDATION_FAILED',
              error: validated.errorMessage,
            },
            pendingCookies,
            cors,
          );
        }

        const prefix = buildSessionIdPrefixServer(
          validated.values.startDate,
          validated.values.udiseCode,
          validated.values.sessionMode,
          validated.values.classes,
        );
        if (!prefix) {
          return sendJson(
            res,
            400,
            { ok: false, code: 'SESSION_ID_ERROR', error: 'Unable to derive Session ID.' },
            pendingCookies,
            cors,
          );
        }

        const seenSessionIds = new Set();
        let maxSeq = 0;
        for (const r of sessRows) {
          const sId = String(r[1] || '').trim();
          if (!sId) continue;
          seenSessionIds.add(sId);
          if (sId.startsWith(`${prefix}_`)) {
            const n = Number.parseInt(sId.slice(prefix.length + 1), 10);
            if (Number.isInteger(n) && n > maxSeq) maxSeq = n;
          }
        }
        let candidateSeq = maxSeq + 1;
        let sessionId = `${prefix}_${String(candidateSeq).padStart(3, '0')}`;
        while (seenSessionIds.has(sessionId)) {
          candidateSeq++;
          sessionId = `${prefix}_${String(candidateSeq).padStart(3, '0')}`;
        }

        const nowIso = new Date().toISOString();
        const sessionRecordId = `REC_${crypto.randomUUID().toUpperCase()}`;
        const detailRecords = validated.classBreakdown.map((c, idx) => ({
          detailRecordId: `DET_${sessionRecordId}_${idx + 1}`,
          sessionRecordId,
          sessionId,
          grade: c.grade,
          section: c.section,
          studentsPresent: c.studentsPresent,
          questionAScore5: c.qaCounts.score5,
          questionAScore4: c.qaCounts.score4,
          questionAScore3: c.qaCounts.score3,
          questionAScore2: c.qaCounts.score2,
          questionAScore1: c.qaCounts.score1,
          questionATotal: c.qaTotal,
          questionAWeightedScore: c.qaWeighted,
          csat: c.csatAverage,
          questionBScore5: c.qbCounts.score5,
          questionBScore4: c.qbCounts.score4,
          questionBScore3: c.qbCounts.score3,
          questionBScore2: c.qbCounts.score2,
          questionBScore1: c.qbCounts.score1,
          questionBTotal: c.qbTotal,
          questionBWeightedScore: c.qbWeighted,
          itp: c.itpAverage,
          createdAt: nowIso,
          updatedAt: nowIso,
        }));

        const pendingRecord = {
          sessionRecordId,
          sessionId,
          clientSubmissionKey: validated.values.clientSubmissionKey || `KEY_${crypto.randomUUID()}`,
          facilitatorName: validated.values.facilitatorName,
          facilitatorEmail: actorInfo.email,
          facilitatorUserId: actorInfo.userId,
          tourId: validated.tour.tourId,
          tourName: validated.tour.tourName,
          videoId: validated.videoId,
          language: validated.values.language,
          startDate: validated.values.startDate,
          endDate: validated.values.endDate,
          startTime: validated.values.startTime,
          endTime: validated.values.endTime,
          durationMinutes: validated.durationMinutes,
          durationFormatted: formatDurationHuman(validated.durationMinutes),
          reportingMonth: getMonthNameFromISO(validated.values.startDate),
          submissionTimestamp: nowIso,
          submissionDateFormatted: formatISODateToDDMMYYYY(validated.todayKolkata),
          schoolName: validated.values.schoolName,
          udiseCode: validated.values.udiseCode,
          schoolType: validated.values.schoolType,
          state: validated.values.state,
          district: validated.values.district,
          pinCode: validated.values.pinCode,
          sessionType: validated.values.sessionMode,
          totalClasses: detailRecords.length,
          totalStudentsPresent: validated.totalStudentsPresent,
          totalQuestionAResponses: validated.pooledQaTotal,
          totalQuestionBResponses: validated.pooledQbTotal,
          overallCsat: validated.overallCsat,
          overallItp: validated.overallItp,
          teacherScore: validated.teacher.exactScore,
          teacherClassification: validated.teacher.classification || 'Passive',
          teacherNps: validated.teacher.nps ?? 0,
          submissionStatus: 'PENDING',
          syncStatus: 'SYNCED',
          createdAt: nowIso,
          updatedAt: nowIso,
          createdBy: actorInfo.email,
          updatedBy: actorInfo.email,
          archived: false,
          details: [],
        };

        // Phase 1: Write PENDING row to Sessions
        const appendSessRes = await callGoogle(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
            spreadsheetId,
          )}/values/${encodeURIComponent(`${a1Tab('Sessions')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
          {
            method: 'POST',
            body: JSON.stringify({
              values: [serializeSessionRow(pendingRecord, sessionLayout.hasBlock)],
            }),
          },
        );
        let rowNum = parseUpdatedRangeRowNumber(appendSessRes?.updates?.updatedRange);
        if (!rowNum) {
          const [colARows] = await batchGetRanges(spreadsheetId, [`${a1Tab('Sessions')}!A2:A`]);
          const foundIdx = colARows.findIndex((r) => String(r[0] || '').trim() === sessionRecordId);
          if (foundIdx !== -1) rowNum = foundIdx + 2;
        }

        // Phase 2: Write child class rows to Session Details
        if (detailRecords.length > 0) {
          await callGoogle(
            `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
              spreadsheetId,
            )}/values/${encodeURIComponent(`${a1Tab('Session Details')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
            { method: 'POST', body: JSON.stringify({ values: detailRecords.map(serializeDetailRow) }) },
          );
        }

        // Phase 3: Promote Sessions submission_status column -> COMMITTED
        if (rowNum) {
          const statusColLetter = colIndexToLetter(sessionLayout.statusCol1);
          await callGoogle(
            `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
              spreadsheetId,
            )}/values/${encodeURIComponent(`${a1Tab('Sessions')}!${statusColLetter}${rowNum}`)}?valueInputOption=RAW`,
            { method: 'PUT', body: JSON.stringify({ values: [['COMMITTED']] }) },
          );
        }

        // Non-destructive School Master upsert
        let schoolUdiseConflict;
        const existingSchoolRow = schoolRows.find(
          (r) => String(r[2] || '').trim() === validated.values.udiseCode,
        );
        if (!existingSchoolRow) {
          const newSchoolRow = serializeSchoolRow(
            {
              schoolRecordId: `SCH_${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
              schoolName: validated.values.schoolName,
              udiseCode: validated.values.udiseCode,
              schoolType: validated.values.schoolType,
              state: validated.values.state,
              district: validated.values.district,
              pinCode: validated.values.pinCode,
              active: true,
              createdAt: nowIso,
              updatedAt: nowIso,
            },
            schoolLayout.hasBlock,
          );
          await callGoogle(
            `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
              spreadsheetId,
            )}/values/${encodeURIComponent(`${a1Tab('Schools')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
            { method: 'POST', body: JSON.stringify({ values: [newSchoolRow] }) },
          );
        } else {
          const registeredName = String(existingSchoolRow[1] || '').trim();
          if (registeredName.toLowerCase() !== validated.values.schoolName.toLowerCase()) {
            schoolUdiseConflict = `UDISE ${validated.values.udiseCode} is already registered to "${registeredName}". School master record was preserved; admin review recommended.`;
          }
        }

        await appendLogRows(spreadsheetId, {
          auditRow: [
            `AUD_${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
            nowIso,
            actorInfo.userId,
            actorInfo.email,
            'CREATE_SESSION',
            'Session',
            sessionRecordId,
            '',
            `Session ${sessionId} (${validated.values.district}, ${validated.totalStudentsPresent} students)`,
            'SUCCESS',
          ],
          syncRow: [
            `SYNC_${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
            nowIso,
            pendingRecord.clientSubmissionKey,
            sessionRecordId,
            sessionId,
            actorInfo.email,
            'createSession',
            1,
            'SYNCED',
            '',
          ],
        });

        const committedRecord = {
          ...pendingRecord,
          submissionStatus: 'COMMITTED',
          syncStatus: 'SYNCED',
          details: detailRecords,
        };
        const updatedSessionCookie = {
          ...sessionState.current,
          lastSyncedAt: nowIso,
          lastSyncStatus: 'SYNCED',
          lastSyncMessage: `Synced session ${sessionId} (${validated.totalStudentsPresent} students).`,
        };
        persistSession(updatedSessionCookie);

        return sendJson(
          res,
          200,
          {
            ok: true,
            data: {
              session: committedRecord,
              warnings: validated.warnings,
              ...(schoolUdiseConflict ? { schoolUdiseConflict } : {}),
            },
          },
          pendingCookies,
          cors,
        );
      }

      if (postAction === 'updateSession') {
        const spreadsheetId = requireConnectedSpreadsheet();
        if (!spreadsheetId) return;

        const sessionRecordId = String(body.sessionRecordId || '').trim();
        if (!sessionRecordId) {
          return sendJson(
            res,
            400,
            { ok: false, code: 'INVALID_ID', error: 'sessionRecordId is required.' },
            [],
            cors,
          );
        }

        const [sessAllRows, detailRows, cfgRows] = await batchGetRanges(spreadsheetId, [
          `${a1Tab('Sessions')}!A1:AP`,
          `${a1Tab('Session Details')}!A2:X`,
          `${a1Tab('Configuration')}!A2:D`,
        ]);
        const sessHeader = sessAllRows[0] || [];
        const sessRows = sessAllRows.slice(1);
        const sessionLayout = resolveSessionSheetLayout(sessHeader);

        const idx = sessRows.findIndex((r) => String(r[0] || '').trim() === sessionRecordId);
        if (idx === -1) {
          return sendJson(
            res,
            404,
            { ok: false, code: 'NOT_FOUND', error: 'Session record not found.' },
            pendingCookies,
            cors,
          );
        }
        const rowNum = idx + 2;
        const existing = parseSessionRow(sessRows[idx], new Map(), sessHeader);
        const { config } = parseConfigFromSheetRows(cfgRows);
        const rawValues = body.values || body;
        const validated = computeSessionMetricsAndValidateServer(rawValues, config, {
          ...actorInfo,
          email: existing.facilitatorEmail || actorInfo.email,
          userId: existing.facilitatorUserId || actorInfo.userId,
        });
        if (!validated.valid) {
          return sendJson(
            res,
            400,
            { ok: false, code: 'VALIDATION_FAILED', error: validated.errorMessage },
            pendingCookies,
            cors,
          );
        }

        const nowIso = new Date().toISOString();
        const prevSummary = `CSAT=${existing.overallCsat}, ITP=${existing.overallItp}, Students=${existing.totalStudentsPresent}`;
        const updatedRecord = {
          ...existing,
          facilitatorName: validated.values.facilitatorName,
          tourId: validated.tour.tourId,
          tourName: validated.tour.tourName,
          videoId: validated.videoId,
          language: validated.values.language,
          startDate: validated.values.startDate,
          endDate: validated.values.endDate,
          startTime: validated.values.startTime,
          endTime: validated.values.endTime,
          durationMinutes: validated.durationMinutes,
          durationFormatted: formatDurationHuman(validated.durationMinutes),
          reportingMonth: getMonthNameFromISO(validated.values.startDate),
          schoolName: validated.values.schoolName,
          udiseCode: validated.values.udiseCode,
          schoolType: validated.values.schoolType,
          state: validated.values.state || existing.state,
          district: validated.values.district,
          pinCode: validated.values.pinCode,
          sessionType: validated.values.sessionMode,
          totalClasses: validated.classBreakdown.length,
          totalStudentsPresent: validated.totalStudentsPresent,
          totalQuestionAResponses: validated.pooledQaTotal,
          totalQuestionBResponses: validated.pooledQbTotal,
          overallCsat: validated.overallCsat,
          overallItp: validated.overallItp,
          teacherScore: validated.teacher.exactScore,
          teacherClassification: validated.teacher.classification || 'Passive',
          teacherNps: validated.teacher.nps ?? 0,
          submissionStatus: 'CORRECTED',
          syncStatus: 'SYNCED',
          updatedAt: nowIso,
          updatedBy: actorInfo.email,
          details: [],
        };

        const detailRecords = validated.classBreakdown.map((c, dIdx) => ({
          detailRecordId: `DET_${sessionRecordId}_${dIdx + 1}`,
          sessionRecordId,
          sessionId: existing.sessionId,
          grade: c.grade,
          section: c.section,
          studentsPresent: c.studentsPresent,
          questionAScore5: c.qaCounts.score5,
          questionAScore4: c.qaCounts.score4,
          questionAScore3: c.qaCounts.score3,
          questionAScore2: c.qaCounts.score2,
          questionAScore1: c.qaCounts.score1,
          questionATotal: c.qaTotal,
          questionAWeightedScore: c.qaWeighted,
          csat: c.csatAverage,
          questionBScore5: c.qbCounts.score5,
          questionBScore4: c.qbCounts.score4,
          questionBScore3: c.qbCounts.score3,
          questionBScore2: c.qbCounts.score2,
          questionBScore1: c.qbCounts.score1,
          questionBTotal: c.qbTotal,
          questionBWeightedScore: c.qbWeighted,
          itp: c.itpAverage,
          createdAt: existing.createdAt || nowIso,
          updatedAt: nowIso,
        }));
        updatedRecord.details = detailRecords;

        const existingDetailEntries = [];
        detailRows.forEach((dr, dIdx) => {
          if (String(dr[1] || '').trim() === sessionRecordId) {
            existingDetailEntries.push({ rowNum: dIdx + 2 });
          }
        });

        const batchUpdateItems = [
          {
            range: `${a1Tab('Sessions')}!A${rowNum}:${colIndexToLetter(sessionLayout.totalCols)}${rowNum}`,
            values: [serializeSessionRow(updatedRecord, sessionLayout.hasBlock)],
          },
        ];
        const overwriteCount = Math.min(existingDetailEntries.length, detailRecords.length);
        for (let i = 0; i < overwriteCount; i++) {
          batchUpdateItems.push({
            range: `${a1Tab('Session Details')}!A${existingDetailEntries[i].rowNum}:X${existingDetailEntries[i].rowNum}`,
            values: [serializeDetailRow(detailRecords[i])],
          });
        }
        await callGoogle(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
            spreadsheetId,
          )}/values:batchUpdate`,
          {
            method: 'POST',
            body: JSON.stringify({ valueInputOption: 'RAW', data: batchUpdateItems }),
          },
        );

        if (detailRecords.length > existingDetailEntries.length) {
          await callGoogle(
            `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
              spreadsheetId,
            )}/values/${encodeURIComponent(`${a1Tab('Session Details')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
            {
              method: 'POST',
              body: JSON.stringify({
                values: detailRecords.slice(existingDetailEntries.length).map(serializeDetailRow),
              }),
            },
          );
        } else if (existingDetailEntries.length > detailRecords.length) {
          await deleteSheetRowsDescending(
            spreadsheetId,
            callGoogle,
            existingDetailEntries.slice(detailRecords.length).map((e) => ({
              sheetTitle: 'Session Details',
              rowNum: e.rowNum,
            })),
          );
        }

        await appendLogRows(spreadsheetId, {
          auditRow: [
            `AUD_${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
            nowIso,
            actorInfo.userId,
            actorInfo.email,
            'ADMIN_CORRECT_SESSION',
            'Session',
            sessionRecordId,
            prevSummary,
            `CSAT=${updatedRecord.overallCsat}, ITP=${updatedRecord.overallItp}, Students=${updatedRecord.totalStudentsPresent}`,
            'SUCCESS',
          ],
          syncRow: [
            `SYNC_${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
            nowIso,
            updatedRecord.clientSubmissionKey,
            sessionRecordId,
            updatedRecord.sessionId,
            actorInfo.email,
            'updateSession',
            1,
            'SYNCED',
            '',
          ],
        });

        persistSession({
          ...sessionState.current,
          lastSyncedAt: nowIso,
          lastSyncStatus: 'SYNCED',
          lastSyncMessage: `Updated session ${updatedRecord.sessionId}.`,
        });

        return sendJson(
          res,
          200,
          { ok: true, data: { session: updatedRecord, warnings: validated.warnings } },
          pendingCookies,
          cors,
        );
      }

      if (postAction === 'archiveSession' || postAction === 'restoreSession') {
        const spreadsheetId = requireConnectedSpreadsheet();
        if (!spreadsheetId) return;

        const sessionRecordId = String(body.sessionRecordId || '').trim();
        if (!sessionRecordId) {
          return sendJson(
            res,
            400,
            { ok: false, code: 'INVALID_ID', error: 'sessionRecordId is required.' },
            [],
            cors,
          );
        }

        const [sessAllRows] = await batchGetRanges(spreadsheetId, [`${a1Tab('Sessions')}!A1:AP`]);
        const sessHeader = sessAllRows[0] || [];
        const sessRows = sessAllRows.slice(1);
        const sessionLayout = resolveSessionSheetLayout(sessHeader);
        const idx = sessRows.findIndex((r) => String(r[0] || '').trim() === sessionRecordId);
        if (idx === -1) {
          return sendJson(
            res,
            404,
            { ok: false, code: 'NOT_FOUND', error: 'Session record not found.' },
            pendingCookies,
            cors,
          );
        }

        const rowNum = idx + 2;
        const existingRow = sessRows[idx];
        const nextArchived = postAction === 'archiveSession';
        const nowIso = new Date().toISOString();
        const startColLetter = colIndexToLetter(sessionLayout.updatedAtCol1);
        const endColLetter = colIndexToLetter(sessionLayout.archivedCol1);

        await callGoogle(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
            spreadsheetId,
          )}/values/${encodeURIComponent(`${a1Tab('Sessions')}!${startColLetter}${rowNum}:${endColLetter}${rowNum}`)}?valueInputOption=RAW`,
          {
            method: 'PUT',
            body: JSON.stringify({
              values: [[nowIso, String(existingRow[sessionLayout.createdByCol0] || actorInfo.email), actorInfo.email, nextArchived ? 'true' : 'false']],
            }),
          },
        );

        await appendLogRows(spreadsheetId, {
          auditRow: [
            `AUD_${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
            nowIso,
            actorInfo.userId,
            actorInfo.email,
            nextArchived ? 'ARCHIVE_SESSION' : 'RESTORE_SESSION',
            'Session',
            sessionRecordId,
            nextArchived ? 'archived=false' : 'archived=true',
            nextArchived ? 'archived=true' : 'archived=false',
            'SUCCESS',
          ],
          syncRow: [
            `SYNC_${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
            nowIso,
            String(existingRow[2] || ''),
            sessionRecordId,
            String(existingRow[1] || ''),
            actorInfo.email,
            postAction,
            1,
            'SYNCED',
            '',
          ],
        });

        persistSession({
          ...sessionState.current,
          lastSyncedAt: nowIso,
          lastSyncStatus: 'SYNCED',
          lastSyncMessage: `${nextArchived ? 'Archived' : 'Restored'} session ${existingRow[1] || sessionRecordId}.`,
        });

        return sendJson(res, 200, { ok: true, data: { archived: nextArchived } }, pendingCookies, cors);
      }

      if (postAction === 'deleteSession' || postAction === 'bulkDeleteSessions') {
        const spreadsheetId = requireConnectedSpreadsheet();
        if (!spreadsheetId) return;

        let idSet;
        if (postAction === 'deleteSession') {
          const cleanId = String(body.sessionRecordId || '').trim();
          if (!cleanId) {
            return sendJson(
              res,
              400,
              { ok: false, code: 'INVALID_ID', error: 'sessionRecordId is required.' },
              [],
              cors,
            );
          }
          idSet = new Set([cleanId]);
        } else {
          if (!Array.isArray(body.sessionRecordIds)) {
            return sendJson(
              res,
              400,
              { ok: false, code: 'INVALID_ID', error: 'sessionRecordIds must be an array.' },
              [],
              cors,
            );
          }
          const cleaned = body.sessionRecordIds.map((x) => String(x || '').trim()).filter(Boolean);
          if (cleaned.length === 0) {
            return sendJson(
              res,
              400,
              { ok: false, code: 'INVALID_ID', error: 'At least one sessionRecordId is required.' },
              [],
              cors,
            );
          }
          idSet = new Set(cleaned);
        }

        const [sessAllRows, detailRows] = await batchGetRanges(spreadsheetId, [
          `${a1Tab('Sessions')}!A1:AP`,
          `${a1Tab('Session Details')}!A2:C`,
        ]);
        const sessHeader = sessAllRows[0] || [];
        const sessRows = sessAllRows.slice(1);
        const sessionLayout = resolveSessionSheetLayout(sessHeader);

        const matchedSessions = [];
        sessRows.forEach((r, i) => {
          if (idSet.has(String(r[0] || '').trim())) {
            matchedSessions.push({ rowNum: i + 2, row: r });
          }
        });
        if (matchedSessions.length === 0) {
          return sendJson(
            res,
            404,
            {
              ok: false,
              code: 'NOT_FOUND',
              error: postAction === 'deleteSession' ? 'Session record not found.' : 'No matching session records found.',
            },
            pendingCookies,
            cors,
          );
        }

        const matchedDetails = [];
        detailRows.forEach((dr, i) => {
          if (idSet.has(String(dr[1] || '').trim())) {
            matchedDetails.push({ sheetTitle: 'Session Details', rowNum: i + 2 });
          }
        });

        await deleteSheetRowsDescending(spreadsheetId, callGoogle, [
          ...matchedSessions.map((m) => ({ sheetTitle: 'Sessions', rowNum: m.rowNum })),
          ...matchedDetails,
        ]);

        const nowIso = new Date().toISOString();
        if (postAction === 'deleteSession') {
          const targetRow = matchedSessions[0].row;
          await appendLogRows(spreadsheetId, {
            auditRow: [
              `AUD_${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
              nowIso,
              actorInfo.userId,
              actorInfo.email,
              'DELETE_SESSION',
              'Session',
              String(targetRow[0] || ''),
              `Session ${targetRow[1]} (${targetRow[19]}, ${targetRow[sessionLayout.studentsCol0]} students, ${matchedDetails.length} detail rows)`,
              'Permanently deleted',
              'SUCCESS',
            ],
            syncRow: [
              `SYNC_${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
              nowIso,
              String(targetRow[2] || ''),
              String(targetRow[0] || ''),
              String(targetRow[1] || ''),
              actorInfo.email,
              'deleteSession',
              1,
              'SYNCED',
              '',
            ],
          });
          persistSession({
            ...sessionState.current,
            lastSyncedAt: nowIso,
            lastSyncStatus: 'SYNCED',
            lastSyncMessage: `Deleted session ${targetRow[1]}.`,
          });
          return sendJson(
            res,
            200,
            { ok: true, data: { deleted: true, deletedDetailsCount: matchedDetails.length } },
            pendingCookies,
            cors,
          );
        }

        const sessionIdList = matchedSessions.map((m) => String(m.row[1] || m.row[0] || '').trim());
        const summaryIds =
          sessionIdList.slice(0, 10).join(', ') +
          (sessionIdList.length > 10 ? ` (+${sessionIdList.length - 10} more)` : '');
        await appendLogRows(spreadsheetId, {
          auditRow: [
            `AUD_${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
            nowIso,
            actorInfo.userId,
            actorInfo.email,
            'BULK_DELETE_SESSIONS',
            'Session',
            'BULK',
            summaryIds,
            `Deleted ${matchedSessions.length} session(s) and ${matchedDetails.length} detail row(s)`,
            'SUCCESS',
          ],
          syncRow: [
            `SYNC_${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
            nowIso,
            'BULK_DELETE',
            String(matchedSessions.length),
            summaryIds,
            actorInfo.email,
            'bulkDeleteSessions',
            1,
            'SYNCED',
            '',
          ],
        });
        persistSession({
          ...sessionState.current,
          lastSyncedAt: nowIso,
          lastSyncStatus: 'SYNCED',
          lastSyncMessage: `Deleted ${matchedSessions.length} session(s).`,
        });
        return sendJson(
          res,
          200,
          { ok: true, data: { deletedCount: matchedSessions.length, deletedDetailsCount: matchedDetails.length } },
          pendingCookies,
          cors,
        );
      }

      if (postAction === 'updateSchool') {
        const spreadsheetId = requireConnectedSpreadsheet();
        if (!spreadsheetId) return;

        const school = body.school || body;
        const schoolRecordId = String(school.schoolRecordId || '').trim();
        const schoolName = String(school.schoolName || '').trim();
        const udiseCode = String(school.udiseCode || '').trim();
        const schoolType = String(school.schoolType || '').trim();
        const district = String(school.district || '').trim();
        const pinCode = String(school.pinCode || '').trim();
        const active = school.active !== false;

        if (!schoolRecordId) {
          return sendJson(res, 400, { ok: false, code: 'INVALID_ID', error: 'schoolRecordId is required.' }, [], cors);
        }
        if (!schoolName) {
          return sendJson(res, 400, { ok: false, code: 'VALIDATION_FAILED', error: 'School name is required.' }, [], cors);
        }
        if (!/^\d{11}$/.test(udiseCode)) {
          return sendJson(res, 400, { ok: false, code: 'VALIDATION_FAILED', error: 'UDISE code must be exactly 11 digits.' }, [], cors);
        }
        if (!/^\d{6}$/.test(pinCode)) {
          return sendJson(res, 400, { ok: false, code: 'VALIDATION_FAILED', error: 'PIN code must be exactly 6 digits.' }, [], cors);
        }
        if (!schoolType) {
          return sendJson(res, 400, { ok: false, code: 'VALIDATION_FAILED', error: 'School type is required.' }, [], cors);
        }

        const [schoolAllRows, cfgRows] = await batchGetRanges(spreadsheetId, [
          `${a1Tab('Schools')}!A1:K`,
          `${a1Tab('Configuration')}!A2:D`,
        ]);
        const schoolHeader = schoolAllRows[0] || [];
        const schoolRows = schoolAllRows.slice(1);
        const schoolLayout = resolveSchoolSheetLayout(schoolHeader);
        const { config } = parseConfigFromSheetRows(cfgRows);
        if (!(config.allowedDistricts || []).includes(district)) {
          return sendJson(
            res,
            400,
            { ok: false, code: 'VALIDATION_FAILED', error: 'District must be one of the approved programme districts.' },
            pendingCookies,
            cors,
          );
        }

        const idx = schoolRows.findIndex((r) => String(r[0] || '').trim() === schoolRecordId);
        if (idx === -1) {
          return sendJson(res, 404, { ok: false, code: 'NOT_FOUND', error: 'School record not found.' }, pendingCookies, cors);
        }
        const conflicting = schoolRows.find(
          (r) => String(r[0] || '').trim() !== schoolRecordId && String(r[2] || '').trim() === udiseCode,
        );
        if (conflicting) {
          return sendJson(
            res,
            409,
            {
              ok: false,
              code: 'DUPLICATE_UDISE',
              error: `UDISE ${udiseCode} is already assigned to "${String(conflicting[1] || '').trim()}".`,
            },
            pendingCookies,
            cors,
          );
        }

        const existingRow = schoolRows[idx];
        const prevSummary = `${existingRow[2] || ''} (${existingRow[1] || ''}, active=${existingRow[schoolLayout.activeCol0] || 'true'})`;
        const nowIso = new Date().toISOString();
        const stateVal = String(school.state || existingRow[4] || config.stateName || 'Tamil Nadu').trim();
        const createdAt = String(existingRow[schoolLayout.createdAtCol0] || nowIso);
        const rowNum = idx + 2;

        await callGoogle(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
            spreadsheetId,
          )}/values/${encodeURIComponent(`${a1Tab('Schools')}!A${rowNum}:${colIndexToLetter(schoolLayout.totalCols)}${rowNum}`)}?valueInputOption=RAW`,
          {
            method: 'PUT',
            body: JSON.stringify({
              values: [
                serializeSchoolRow(
                  {
                    schoolRecordId,
                    schoolName,
                    udiseCode,
                    schoolType,
                    state: stateVal,
                    district,
                    pinCode,
                    active,
                    createdAt,
                    updatedAt: nowIso,
                  },
                  schoolLayout.hasBlock,
                ),
              ],
            }),
          },
        );

        await appendLogRows(spreadsheetId, {
          auditRow: [
            `AUD_${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
            nowIso,
            actorInfo.userId,
            actorInfo.email,
            'UPDATE_SCHOOL',
            'School',
            schoolRecordId,
            prevSummary,
            `${udiseCode} (${schoolName}, active=${active})`,
            'SUCCESS',
          ],
        });

        if (sessionState.dirty) persistSession(sessionState.current);
        return sendJson(
          res,
          200,
          {
            ok: true,
            data: {
              schoolRecordId,
              schoolName,
              udiseCode,
              schoolType,
              state: stateVal,
              district,
              pinCode,
              active,
              createdAt,
              updatedAt: nowIso,
            },
          },
          pendingCookies,
          cors,
        );
      }

      if (postAction === 'deleteSchool') {
        const spreadsheetId = requireConnectedSpreadsheet();
        if (!spreadsheetId) return;

        const cleanId = String(body.schoolRecordId || '').trim();
        if (!cleanId) {
          return sendJson(res, 400, { ok: false, code: 'INVALID_ID', error: 'schoolRecordId is required.' }, [], cors);
        }

        const [schoolAllRows] = await batchGetRanges(spreadsheetId, [`${a1Tab('Schools')}!A1:K`]);
        const schoolRows = schoolAllRows.slice(1);
        const idx = schoolRows.findIndex(
          (r) => String(r[0] || '').trim() === cleanId || String(r[2] || '').trim() === cleanId,
        );
        if (idx === -1) {
          return sendJson(res, 404, { ok: false, code: 'NOT_FOUND', error: 'School record not found.' }, pendingCookies, cors);
        }

        const targetRow = schoolRows[idx];
        const udiseCode = String(targetRow[2] || '').trim();
        await deleteSheetRowsDescending(spreadsheetId, callGoogle, [
          { sheetTitle: 'Schools', rowNum: idx + 2 },
        ]);

        const nowIso = new Date().toISOString();
        await appendLogRows(spreadsheetId, {
          auditRow: [
            `AUD_${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
            nowIso,
            actorInfo.userId,
            actorInfo.email,
            'DELETE_SCHOOL',
            'School',
            String(targetRow[0] || udiseCode),
            `${udiseCode} (${targetRow[1] || ''})`,
            'Removed from Schools directory',
            'SUCCESS',
          ],
        });

        if (sessionState.dirty) persistSession(sessionState.current);
        return sendJson(res, 200, { ok: true, data: { deleted: true, udiseCode } }, pendingCookies, cors);
      }

      if (postAction === 'manageUser') {
        const spreadsheetId = requireConnectedSpreadsheet();
        if (!spreadsheetId) return;

        const input = body.user || body;
        const emailClean = String(input.email || '').trim().toLowerCase();
        const nameClean = String(input.name || '').trim();
        if (!emailClean || !nameClean) {
          return sendJson(res, 400, { ok: false, code: 'INVALID_USER', error: 'Name and email are required.' }, [], cors);
        }

        const nowIso = new Date().toISOString();
        if (isAllowlistedSuperAdminEmail(emailClean)) {
          await appendLogRows(spreadsheetId, {
            auditRow: [
              `AUD_${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
              nowIso,
              actorInfo.userId,
              actorInfo.email,
              'MANAGE_USER',
              'User',
              emailClean,
              '',
              'Protected Super Admin account cannot be modified',
              'DENIED',
            ],
          });
          return sendJson(
            res,
            403,
            {
              ok: false,
              code: 'PROTECTED_ACCOUNT',
              error: 'Initial Super Administrator accounts are protected by server policy and cannot be modified or deactivated.',
            },
            pendingCookies,
            cors,
          );
        }

        const requestedRole = String(input.role || '').trim().toLowerCase();
        if (requestedRole === 'admin' || requestedRole === 'super_admin') {
          await appendLogRows(spreadsheetId, {
            auditRow: [
              `AUD_${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
              nowIso,
              actorInfo.userId,
              actorInfo.email,
              'MANAGE_USER',
              'User',
              emailClean,
              '',
              'Blocked administrator role elevation',
              'DENIED',
            ],
          });
          return sendJson(
            res,
            403,
            {
              ok: false,
              code: 'FORBIDDEN',
              error: 'Administrator privileges are restricted exclusively to the two approved Super Administrator accounts.',
            },
            pendingCookies,
            cors,
          );
        }
        if (requestedRole !== 'facilitator') {
          return sendJson(res, 400, { ok: false, code: 'INVALID_ROLE', error: 'Invalid user role.' }, pendingCookies, cors);
        }

        const nextStatus =
          input.status === 'APPROVED' || input.status === 'PENDING' || input.status === 'DENIED'
            ? input.status
            : input.active !== false
              ? 'APPROVED'
              : 'DENIED';
        const nextActive = nextStatus === 'APPROVED';

        const [facRows] = await batchGetRanges(spreadsheetId, [`${a1Tab('Facilitators')}!A2:H`]);
        const idx = facRows.findIndex(
          (r) =>
            (input.userId && String(r[0] || '').trim() === String(input.userId).trim()) ||
            String(r[2] || '').trim().toLowerCase() === emailClean,
        );

        let userRecord;
        if (idx !== -1) {
          const existingRow = facRows[idx];
          const userId = String(existingRow[0] || `FAC_${crypto.randomBytes(4).toString('hex').toUpperCase()}`).trim();
          const createdAt = String(existingRow[5] || nowIso).trim();
          const rowNum = idx + 2;
          await callGoogle(
            `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
              spreadsheetId,
            )}/values/${encodeURIComponent(`${a1Tab('Facilitators')}!A${rowNum}:H${rowNum}`)}?valueInputOption=RAW`,
            {
              method: 'PUT',
              body: JSON.stringify({
                values: [[userId, nameClean, emailClean, 'facilitator', nextActive ? 'true' : 'false', createdAt, nowIso, nextStatus]],
              }),
            },
          );
          userRecord = {
            userId,
            name: nameClean,
            email: emailClean,
            role: 'facilitator',
            active: nextActive,
            status: nextStatus,
            createdAt,
            updatedAt: nowIso,
          };
          await appendLogRows(spreadsheetId, {
            auditRow: [
              `AUD_${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
              nowIso,
              actorInfo.userId,
              actorInfo.email,
              'UPDATE_USER',
              'User',
              userId,
              `facilitator (status=${existingRow[7] || ''}, active=${existingRow[4] || ''})`,
              `facilitator (status=${nextStatus}, active=${nextActive})`,
              'SUCCESS',
            ],
          });
        } else {
          const userId = `FAC_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
          await callGoogle(
            `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
              spreadsheetId,
            )}/values/${encodeURIComponent(`${a1Tab('Facilitators')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
            {
              method: 'POST',
              body: JSON.stringify({
                values: [[userId, nameClean, emailClean, 'facilitator', nextActive ? 'true' : 'false', nowIso, nowIso, nextStatus]],
              }),
            },
          );
          userRecord = {
            userId,
            name: nameClean,
            email: emailClean,
            role: 'facilitator',
            active: nextActive,
            status: nextStatus,
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          await appendLogRows(spreadsheetId, {
            auditRow: [
              `AUD_${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
              nowIso,
              actorInfo.userId,
              actorInfo.email,
              'CREATE_USER',
              'User',
              userId,
              '',
              `${emailClean} (facilitator, status=${nextStatus})`,
              'SUCCESS',
            ],
          });
        }

        if (sessionState.dirty) persistSession(sessionState.current);
        return sendJson(res, 200, { ok: true, data: userRecord }, pendingCookies, cors);
      }

      if (postAction === 'deleteUser') {
        const spreadsheetId = requireConnectedSpreadsheet();
        if (!spreadsheetId) return;

        const identifier = String(body.userIdOrEmail || '').trim();
        if (!identifier) {
          return sendJson(res, 400, { ok: false, code: 'INVALID_USER', error: 'userIdOrEmail is required.' }, [], cors);
        }

        const cleanLower = identifier.toLowerCase();
        const nowIso = new Date().toISOString();
        const isProtectedMatch = ALLOWLISTED_SUPER_ADMINS.some(
          (sa) => sa.email === cleanLower || sa.userId === identifier,
        );
        if (isProtectedMatch) {
          await appendLogRows(spreadsheetId, {
            auditRow: [
              `AUD_${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
              nowIso,
              actorInfo.userId,
              actorInfo.email,
              'DELETE_USER',
              'User',
              identifier,
              '',
              'Attempted deletion of protected initial Super Administrator',
              'DENIED',
            ],
          });
          return sendJson(
            res,
            403,
            {
              ok: false,
              code: 'PROTECTED_ACCOUNT',
              error: 'Initial Super Administrator accounts are protected by server policy and cannot be modified or deleted.',
            },
            pendingCookies,
            cors,
          );
        }

        const [facRows] = await batchGetRanges(spreadsheetId, [`${a1Tab('Facilitators')}!A2:H`]);
        const idx = facRows.findIndex(
          (r) => String(r[0] || '').trim() === identifier || String(r[2] || '').trim().toLowerCase() === cleanLower,
        );
        if (idx === -1) {
          return sendJson(res, 404, { ok: false, code: 'NOT_FOUND', error: 'Facilitator user record not found.' }, pendingCookies, cors);
        }

        const targetRow = facRows[idx];
        const targetEmail = String(targetRow[2] || '').trim().toLowerCase();
        if (isAllowlistedSuperAdminEmail(targetEmail)) {
          return sendJson(
            res,
            403,
            {
              ok: false,
              code: 'PROTECTED_ACCOUNT',
              error: 'Initial Super Administrator accounts are protected by server policy and cannot be modified or deleted.',
            },
            pendingCookies,
            cors,
          );
        }

        await deleteSheetRowsDescending(spreadsheetId, callGoogle, [
          { sheetTitle: 'Facilitators', rowNum: idx + 2 },
        ]);

        await appendLogRows(spreadsheetId, {
          auditRow: [
            `AUD_${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
            nowIso,
            actorInfo.userId,
            actorInfo.email,
            'DELETE_USER',
            'User',
            String(targetRow[0] || targetEmail),
            `${targetEmail} (${targetRow[1] || ''}, status=${targetRow[7] || ''})`,
            'Removed from Facilitators directory',
            'SUCCESS',
          ],
        });

        if (sessionState.dirty) persistSession(sessionState.current);
        return sendJson(res, 200, { ok: true, data: { deleted: true, email: targetEmail } }, pendingCookies, cors);
      }

      if (postAction === 'saveConfiguration') {
        const spreadsheetId = requireConnectedSpreadsheet();
        if (!spreadsheetId) return;

        const partial = body.config || body.partial || {};
        const [cfgRows] = await batchGetRanges(spreadsheetId, [`${a1Tab('Configuration')}!A2:D`]);
        const { config: currentCfg } = parseConfigFromSheetRows(cfgRows);
        const nowIso = new Date().toISOString();

        const keyToRowNum = new Map();
        cfgRows.forEach((r, idx) => {
          const k = String(r[0] || '').trim();
          if (k) keyToRowNum.set(k, idx + 2);
        });

        const entries = buildConfigKeyValuesFromPartial(partial);
        const batchUpdates = [];
        const appendRows = [];
        for (const [k, valJson] of entries) {
          const rowValues = [k, valJson, nowIso, actorInfo.email];
          const existingRowNum = keyToRowNum.get(k);
          if (existingRowNum) {
            batchUpdates.push({
              range: `${a1Tab('Configuration')}!A${existingRowNum}:D${existingRowNum}`,
              values: [rowValues],
            });
          } else {
            appendRows.push(rowValues);
          }
        }

        if (batchUpdates.length > 0) {
          await callGoogle(
            `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
              spreadsheetId,
            )}/values:batchUpdate`,
            { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: batchUpdates }) },
          );
        }
        if (appendRows.length > 0) {
          await callGoogle(
            `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
              spreadsheetId,
            )}/values/${encodeURIComponent(`${a1Tab('Configuration')}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
            { method: 'POST', body: JSON.stringify({ values: appendRows }) },
          );
        }

        const mergedConfig = {
          ...currentCfg,
          ...partial,
          ...(partial.policy
            ? {
                policy: {
                  allowFacilitatorDeleteOwn: partial.policy.allowFacilitatorDeleteOwn !== false,
                  allowFacilitatorExportOwn: false,
                  facilitatorApprovalMode:
                    partial.policy.facilitatorApprovalMode === 'auto_approve' ? 'auto_approve' : 'manual_allowlist',
                },
              }
            : {}),
        };

        await appendLogRows(spreadsheetId, {
          auditRow: [
            `AUD_${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
            nowIso,
            actorInfo.userId,
            actorInfo.email,
            'UPDATE_CONFIG',
            'Configuration',
            'SYSTEM',
            '',
            JSON.stringify({
              schoolYear: mergedConfig.schoolYear,
              partnerName: mergedConfig.partnerName,
              districts: mergedConfig.allowedDistricts,
            }),
            'SUCCESS',
          ],
        });

        if (sessionState.dirty) persistSession(sessionState.current);
        return sendJson(res, 200, { ok: true, data: mergedConfig }, pendingCookies, cors);
      }

      if (postAction === 'logExportEvent') {
        const spreadsheetId = requireConnectedSpreadsheet();
        if (!spreadsheetId) return;

        const scope = String(body.scope || 'ALL').trim();
        const rowCount = Number(body.rowCount || 0);
        const format = String(body.format || 'xlsx').trim();
        const nowIso = new Date().toISOString();

        await appendLogRows(spreadsheetId, {
          auditRow: [
            `AUD_${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
            nowIso,
            actorInfo.userId,
            actorInfo.email,
            'EXPORT_XLSX',
            'Export',
            scope,
            '',
            `${rowCount} rows (${format})`,
            'SUCCESS',
          ],
        });

        if (sessionState.dirty) persistSession(sessionState.current);
        return sendJson(res, 200, { ok: true, data: { logged: true } }, pendingCookies, cors);
      }

      return sendJson(
        res,
        400,
        {
          ok: false,
          code: 'UNKNOWN_ACTION',
          error: `Unknown action: ${postAction}`,
        },
        [],
        cors,
      );
    } catch (err) {
      return sendJson(
        res,
        err.statusCode || 500,
        {
          ok: false,
          code: err.apiCode || 'INTERNAL_ERROR',
          error: err.message || 'Unexpected error communicating with Google Sheets API.',
        },
        [],
        cors,
      );
    }
  };
}

export default createSheetsHandler();

import type { AppConfiguration, ClassGroupInput, ScoreCounts, SessionFormValues } from '../types/domain';
import { getTodayKolkataISO } from '../utils/temporal';

export const PROGRAMME_TIMEZONE = 'Asia/Kolkata';

export const DEFAULT_TARGET_SPREADSHEET_ID = '1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE';
export const DEFAULT_TARGET_SPREADSHEET_URL =
  'https://docs.google.com/spreadsheets/d/1KKfxmSbWVk32Axsae275kTm9AJx_FxppDHGUmqDeUpE/edit?gid=0#gid=0';

export function parseGoogleSpreadsheetId(urlOrId: string): string {
  const raw = urlOrId.trim();
  if (!raw) return '';
  const match = /\/spreadsheets\/d\/([a-zA-Z0-9-_]{10,})/.exec(raw);
  if (match?.[1]) return match[1];
  if (/^[a-zA-Z0-9-_]{10,120}$/.test(raw)) return raw;
  return '';
}

export const APPROVED_DISTRICTS = ['Cuddalore', 'Nagapattinam', 'Sivaganga'] as const;

export const QUESTION_A_PROMPT = 'How much did you enjoy this Career Tour?';
export const QUESTION_A_OPTIONS = [
  { score: 5 as const, label: 'Loved it' },
  { score: 4 as const, label: 'Liked it' },
  { score: 3 as const, label: 'It was okay' },
  { score: 2 as const, label: "Didn't like it much" },
  { score: 1 as const, label: "Didn't like it at all" },
] as const;

export const QUESTION_B_PROMPT =
  'After watching, how interested are you in learning more about careers of the future?';
export const QUESTION_B_OPTIONS = [
  { score: 5 as const, label: 'Extremely interested' },
  { score: 4 as const, label: 'Very interested' },
  { score: 3 as const, label: 'Moderately interested' },
  { score: 2 as const, label: 'Slightly interested' },
  { score: 1 as const, label: 'Not at all interested' },
] as const;

export const TEACHER_NPS_QUESTION =
  'On a scale of 0 to 10, how likely are you to recommend this tour to other teachers or schools?';
export const TEACHER_NPS_HELPER =
  "Ask the teacher of this class and choose the group their number falls in. If no teacher sat in, ask the school's headmaster or the teacher in charge.";

export const TEACHER_NPS_GROUPS = [
  {
    value: 'promoter' as const,
    range: '9–10',
    classification: 'Promoter' as const,
    nps: 100,
    label: '9–10 · Promoter (+100)',
    scores: [10, 9],
  },
  {
    value: 'passive' as const,
    range: '7–8',
    classification: 'Passive' as const,
    nps: 0,
    label: '7–8 · Passive (0)',
    scores: [8, 7],
  },
  {
    value: 'detractor' as const,
    range: '0–6',
    classification: 'Detractor' as const,
    nps: -100,
    label: '0–6 · Detractor (-100)',
    scores: [6, 5, 4, 3, 2, 1, 0],
  },
] as const;

export const DEFAULT_APP_CONFIGURATION: AppConfiguration = {
  programmeTimezone: PROGRAMME_TIMEZONE,
  stateName: 'Tamil Nadu',
  allowedDistricts: [...APPROVED_DISTRICTS],
  gradeOptions: ['8', '9', '10', '11', '12'],
  sectionOptions: ['A', 'B', 'C', 'D', 'E', 'F', 'No section'],
  schoolTypes: [
    'Government school',
    'Government aided school',
    'Private school',
    'Central government school (KV, JNV...)',
    'Tribal school (EMRS)',
    'Kasturba Gandhi Balika Vidyalaya (KGBV)',
    'Other',
  ],
  tours: [
    {
      tourId: 'TOUR_AM',
      tourName: 'Amazon Music: Careers Behind the Beats',
      tourCode: 'AM',
      active: true,
      videoIdByLanguage: {
        Tamil: 'AFE-IN-AM-OV-TA-2026',
      },
    },
    {
      tourId: 'TOUR_RFC',
      tourName: 'Robotics Fulfillment Center',
      tourCode: 'RFC',
      active: true,
      videoIdByLanguage: {},
    },
  ],
  languageOptions: [
    'English',
    'Hindi',
    'Tamil',
    'Telugu',
    'Kannada',
    'Marathi',
    'Gujarati',
    'Odia',
  ],
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
  // Partner name must be explicitly configured by Super Administrator; never fabricated.
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
  // 63-column reporting header template must be uploaded by Super Administrator to guarantee exact match.
  exportTemplate63: null,
};

export function createEmptyScoreCounts(): ScoreCounts {
  return {
    score5: '',
    score4: '',
    score3: '',
    score2: '',
    score1: '',
  };
}

export function createEmptyClassRow(seed = 'row-1'): ClassGroupInput {
  return {
    rowId: seed,
    grade: '',
    section: '',
    studentsPresent: '',
    questionA: createEmptyScoreCounts(),
    questionB: createEmptyScoreCounts(),
  };
}

export function createInitialSessionForm(
  facilitatorName = '',
  facilitatorEmail = '',
  config: AppConfiguration = DEFAULT_APP_CONFIGURATION,
): SessionFormValues {
  const today = getTodayKolkataISO();
  const defaultTour = config.tours.find((t) => t.active)?.tourId ?? '';
  const defaultLanguage = config.languageOptions.includes('Tamil')
    ? 'Tamil'
    : (config.languageOptions[0] ?? 'Tamil');

  return {
    clientSubmissionKey: generateUuid(),
    facilitatorName,
    facilitatorEmail,
    tourId: defaultTour,
    language: defaultLanguage,
    startDate: today,
    endDate: today,
    startTime: '',
    endTime: '',
    schoolName: '',
    udiseCode: '',
    schoolType: '',
    state: config.stateName || 'Tamil Nadu',
    district: '',
    pinCode: '',
    sessionMode: 'single',
    classes: [createEmptyClassRow('row-1')],
    teacherNpsGroup: '',
    teacherExactScore: '',
  };
}

export function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ct-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

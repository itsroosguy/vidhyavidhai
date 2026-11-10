import { DEFAULT_APP_CONFIGURATION } from './config/defaults';
import type { AppConfiguration, SessionFormValues } from './types/domain';
import { getTodayKolkataISO } from './utils/temporal';

export function createTestConfig(overrides?: Partial<AppConfiguration>): AppConfiguration {
  return {
    ...DEFAULT_APP_CONFIGURATION,
    districtBlocks: [
      { district: 'Cuddalore', block: 'Panruti', active: true },
      { district: 'Cuddalore', block: 'Kurinjipadi', active: true },
      { district: 'Nagapattinam', block: 'Kilvelur', active: true },
      { district: 'Sivaganga', block: 'Karaikudi', active: true },
    ],
    partnerName: 'Test Programme Partner',
    policy: {
      ...DEFAULT_APP_CONFIGURATION.policy,
      facilitatorApprovalMode: 'manual_allowlist',
    },
    ...overrides,
  };
}

export function createValidFormValues(overrides?: Partial<SessionFormValues>): SessionFormValues {
  const today = getTodayKolkataISO();
  return {
    clientSubmissionKey: `key-${Math.random().toString(36).slice(2)}`,
    facilitatorName: 'Priya S',
    facilitatorEmail: 'priya.facilitator@example.org',
    tourId: 'TOUR_AM',
    language: 'Tamil',
    startDate: today,
    endDate: today,
    startTime: '10:00',
    endTime: '11:00',
    schoolName: 'Government Higher Secondary School Panruti',
    udiseCode: '33180100101',
    schoolType: 'Government school',
    state: 'Tamil Nadu',
    district: 'Cuddalore',
    block: 'Panruti',
    pinCode: '607106',
    sessionMode: 'single',
    classes: [
      {
        rowId: 'row-1',
        grade: '8',
        section: 'A',
        studentsPresent: '40',
        questionA: { score5: '25', score4: '10', score3: '5', score2: '0', score1: '0' },
        questionB: { score5: '20', score4: '15', score3: '5', score2: '0', score1: '0' },
      },
    ],
    teacherNpsGroup: 'promoter',
    teacherExactScore: '9',
    ...overrides,
  };
}

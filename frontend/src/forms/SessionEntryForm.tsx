import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Award,
  Building2,
  Check,
  CheckCircle2,
  Clapperboard,
  CloudOff,
  Hash,
  History,
  ListChecks,
  RotateCcw,
  Sparkles,
  UserRound,
  Users,
} from 'lucide-react';
import { calculateSessionMetrics, formatScore2 } from '../calculations/metrics';
import { DuplicateWarningModal } from '../components/modals/DuplicateWarningModal';
import { ReviewSubmissionModal } from '../components/modals/ReviewSubmissionModal';
import { SubmissionSuccessModal } from '../components/modals/SubmissionSuccessModal';
import { ValidationErrorModal } from '../components/modals/ValidationErrorModal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import {
  createEmptyClassRow,
  createInitialSessionForm,
  generateUuid,
} from '../config/defaults';
import type { BackendApiClient } from '../services/apiClient';
import { getAuthEnvironment } from '../services/authService';
import {
  clearFormDraft,
  loadFormDraft,
  saveFormDraft,
  type StoredDraft,
} from '../services/draftStorage';
import {
  appendLocalSyncEvent,
  enqueueSyncOutboxItem,
  findDuplicateSessionCandidates,
} from '../services/syncService';
import type {
  AppConfiguration,
  DuplicateSessionCandidate,
  SchoolRecord,
  ScoreCounts,
  SessionFormValues,
  SessionMode,
  SessionRecord,
  SyncStatus,
  UserProfile,
  ValidationIssue,
} from '../types/domain';
import { attachAriaValidationSync } from '../utils/ariaValidation';
import { buildSessionIdPrefix } from '../utils/sessionId';
import { validateSessionForm } from '../validations/sessionValidation';
import { Section1AboutYou } from './sections/Section1AboutYou';
import { Section2AboutSession } from './sections/Section2AboutSession';
import { Section3AboutSchool } from './sections/Section3AboutSchool';
import { Section4AboutClass } from './sections/Section4AboutClass';
import { Section5StudentsAnswers } from './sections/Section5StudentsAnswers';
import { Section6TeachersAnswer } from './sections/Section6TeachersAnswer';
import { Section7Results } from './sections/Section7Results';

interface SessionEntryFormProps {
  api: BackendApiClient;
  user: UserProfile;
  config: AppConfiguration;
  editingSession: SessionRecord | null;
  onCancelEdit: () => void;
  onSavedNavigateToMyClasses: () => void;
  onNotify: (type: 'success' | 'error' | 'warning', title: string, detail?: string) => void;
  embeddedInModal?: boolean;
  onSessionSaved?: (session: SessionRecord, syncStatus: SyncStatus) => void;
  onOpenSyncStatus?: () => void;
  onOutboxEnqueued?: () => void;
  onCloseModal?: () => void;
}

function sessionRecordToFormValues(record: SessionRecord): SessionFormValues {
  const exactScoreStr = record.teacherScore !== null ? String(record.teacherScore) : '';
  const group =
    record.teacherClassification === 'Promoter'
      ? 'promoter'
      : record.teacherClassification === 'Passive'
        ? 'passive'
        : 'detractor';

  return {
    clientSubmissionKey: generateUuid(),
    facilitatorName: record.facilitatorName,
    facilitatorEmail: record.facilitatorEmail,
    tourId: record.tourId,
    language: record.language,
    startDate: record.startDate,
    endDate: record.endDate,
    startTime: record.startTime,
    endTime: record.endTime,
    schoolName: record.schoolName,
    udiseCode: record.udiseCode,
    schoolType: record.schoolType,
    state: record.state,
    district: record.district,
    block: record.block,
    pinCode: record.pinCode,
    sessionMode: record.sessionType,
    classes: record.details.map((d, i) => ({
      rowId: d.detailRecordId || `edit-row-${i + 1}`,
      grade: d.grade,
      section: d.section,
      studentsPresent: String(d.studentsPresent),
      questionA: {
        score5: String(d.questionAScore5),
        score4: String(d.questionAScore4),
        score3: String(d.questionAScore3),
        score2: String(d.questionAScore2),
        score1: String(d.questionAScore1),
      },
      questionB: {
        score5: String(d.questionBScore5),
        score4: String(d.questionBScore4),
        score3: String(d.questionBScore3),
        score2: String(d.questionBScore2),
        score1: String(d.questionBScore1),
      },
    })),
    teacherNpsGroup: group,
    teacherExactScore: exactScoreStr,
  };
}

function resolveFieldDomId(field: string): string | null {
  if (field === 'facilitatorName') return 'facilitatorName';
  if (field === 'tourId') return 'tourId';
  if (field === 'language') return 'language';
  if (field === 'startDate') return 'startDate';
  if (field === 'endDate') return 'endDate';
  if (field === 'startTime') return 'startTime';
  if (field === 'endTime') return 'endTime';
  if (field === 'schoolName') return 'schoolName';
  if (field === 'udiseCode') return 'udiseCode';
  if (field === 'schoolType') return 'schoolType';
  if (field === 'district') return 'district';
  if (field === 'block') return 'block';
  if (field === 'pinCode') return 'pinCode';
  if (field === 'teacherNpsGroup' || field === 'teacherExactScore') return 'teacherNpsGroup';

  const classMatch = /^classes\.(\d+)\.(\w+)/.exec(field);
  if (classMatch) {
    const idx = classMatch[1];
    const sub = classMatch[2];
    if (sub === 'grade') return `class-grade-${idx}`;
    if (sub === 'section') return `class-section-${idx}`;
    if (sub === 'studentsPresent') return `class-present-${idx}`;
    if (sub === 'questionA') return `qa-${idx}-score5`;
    if (sub === 'questionB') return `qb-${idx}-score5`;
  }
  return null;
}

export const SessionEntryForm: React.FC<SessionEntryFormProps> = ({
  api,
  user,
  config,
  editingSession,
  onCancelEdit,
  onSavedNavigateToMyClasses,
  onNotify,
  embeddedInModal = false,
  onSessionSaved,
  onOpenSyncStatus,
  onOutboxEnqueued,
  onCloseModal,
}) => {
  const formRef = useRef<HTMLFormElement>(null);
  const studioNavRef = useRef<HTMLElement>(null);
  const [values, setValues] = useState<SessionFormValues>(() =>
    editingSession
      ? sessionRecordToFormValues(editingSession)
      : createInitialSessionForm(user.name, user.email, config),
  );
  const [pendingDraft, setPendingDraft] = useState<StoredDraft | null>(() => {
    if (editingSession) return null;
    return loadFormDraft(user.email);
  });
  const isSuperAdmin = user.role === 'super_admin';
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [matchedSchool, setMatchedSchool] = useState<SchoolRecord | null>(null);
  const [savedResult, setSavedResult] = useState<{
    session: SessionRecord;
    warnings: string[];
    schoolUdiseConflict?: string;
    syncStatus: SyncStatus;
  } | null>(null);

  // Modal workflow states (Validation -> Duplicate -> Review -> Success)
  const [validationModalOpen, setValidationModalOpen] = useState(false);
  const [duplicateCandidates, setDuplicateCandidates] = useState<DuplicateSessionCandidate[]>([]);
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [successModalOpen, setSuccessModalOpen] = useState(false);
  const [queuedOfflineNotice, setQueuedOfflineNotice] = useState(false);

  useEffect(() => {
    if (!formRef.current) return;
    return attachAriaValidationSync(formRef.current);
  }, []);

  // Desktop scrollspy navigation sync: native CSS scroll-target-group + IntersectionObserver fallback
  useEffect(() => {
    if (embeddedInModal) return;
    const navEl = studioNavRef.current;
    const formEl = formRef.current;
    if (!navEl || !formEl) return;

    const links = Array.from(navEl.querySelectorAll<HTMLAnchorElement>('a[href^="#section-"]'));
    if (links.length === 0) return;

    const supportsScrollTargetGroup =
      typeof CSS !== 'undefined' &&
      typeof CSS.supports === 'function' &&
      CSS.supports('scroll-target-group: auto');

    if (supportsScrollTargetGroup) {
      let syncTimer: number | undefined;
      const syncAriaCurrent = () => {
        let currentLink: HTMLAnchorElement | null = null;
        try {
          currentLink = navEl.querySelector<HTMLAnchorElement>('a:target-current');
        } catch {
          currentLink = null;
        }
        const activeTarget = currentLink ?? links[0] ?? null;
        links.forEach((link) => {
          link.setAttribute('aria-current', link === activeTarget ? 'true' : 'false');
        });
      };

      const scheduleSync = () => {
        window.clearTimeout(syncTimer);
        syncTimer = window.setTimeout(syncAriaCurrent, 80);
      };

      syncAriaCurrent();
      document.addEventListener('scrollend', syncAriaCurrent);
      window.addEventListener('scroll', scheduleSync, { passive: true });
      window.addEventListener('hashchange', scheduleSync);
      return () => {
        window.clearTimeout(syncTimer);
        document.removeEventListener('scrollend', syncAriaCurrent);
        window.removeEventListener('scroll', scheduleSync);
        window.removeEventListener('hashchange', scheduleSync);
      };
    }

    const setActiveId = (sectionId: string) => {
      links.forEach((link) => {
        const isActive = link.getAttribute('href') === `#${sectionId}`;
        link.classList.toggle('target-current', isActive);
        link.setAttribute('aria-current', isActive ? 'true' : 'false');
      });
    };

    setActiveId('section-1');

    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      return;
    }

    const sections = Array.from(formEl.querySelectorAll<HTMLElement>('section[id^="section-"]'));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.getAttribute('id');
            if (id) setActiveId(id);
          }
        }
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    );

    sections.forEach((sec) => observer.observe(sec));
    return () => observer.disconnect();
  }, [embeddedInModal]);

  useEffect(() => {
    if (editingSession) {
      setValues(sessionRecordToFormValues(editingSession));
      setSavedResult(null);
      setHasAttemptedSubmit(false);
      setQueuedOfflineNotice(false);
    }
  }, [editingSession]);

  // Debounced auto-save draft locally (zero credentials stored)
  useEffect(() => {
    if (savedResult) return;
    const timer = setTimeout(() => {
      const hasAnyData =
        values.schoolName.trim() !== '' ||
        values.udiseCode.trim() !== '' ||
        values.startTime !== '' ||
        values.classes.some((c) => c.grade !== '' || c.studentsPresent !== '');
      if (hasAnyData) {
        saveFormDraft(
          user.email,
          values,
          editingSession?.sessionRecordId ?? null,
          editingSession?.sessionId ?? null,
        );
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [editingSession, savedResult, user.email, values]);

  // UDISE lookup when 11 digits entered
  useEffect(() => {
    if (!/^\d{11}$/.test(values.udiseCode.trim())) {
      setMatchedSchool(null);
      return;
    }
    let cancelled = false;
    api.getSchoolByUdise(values.udiseCode.trim()).then((res) => {
      if (!cancelled && res.ok) {
        setMatchedSchool(res.data ?? null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [api, values.udiseCode]);

  const metrics = useMemo(
    () =>
      calculateSessionMetrics(
        values.classes,
        values.teacherNpsGroup,
        values.teacherExactScore,
      ),
    [values.classes, values.teacherExactScore, values.teacherNpsGroup],
  );

  const validation = useMemo(
    () => validateSessionForm(values, config),
    [config, values],
  );

  const sectionStatus = useMemo(() => {
    const s1 = values.facilitatorName.trim().length > 0;
    const s2 = Boolean(
      values.tourId &&
        values.language &&
        values.startDate &&
        values.endDate &&
        values.startTime &&
        values.endTime,
    );
    const s3 = Boolean(
      values.schoolName.trim() &&
        /^\d{11}$/.test(values.udiseCode) &&
        values.schoolType &&
        values.district &&
        values.block &&
        /^\d{6}$/.test(values.pinCode),
    );
    const s4 =
      values.classes.length > 0 &&
      values.classes.every(
        (c) => Boolean(c.grade && c.section && Number.parseInt(c.studentsPresent, 10) > 0),
      );
    const s5 =
      metrics.classBreakdown.length > 0 &&
      metrics.classBreakdown.every(
        (c) =>
          c.questionATotal > 0 &&
          c.questionBTotal > 0 &&
          c.questionATotal <= c.studentsPresent &&
          c.questionBTotal <= c.studentsPresent,
      );
    const s6 = Boolean(values.teacherNpsGroup);
    return [s1, s2, s3, s4, s5, s6];
  }, [metrics.classBreakdown, values]);

  const completedSectionCount = sectionStatus.filter(Boolean).length;

  const errorMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (!hasAttemptedSubmit) return map;
    for (const err of validation.errors) {
      if (!map[err.field]) map[err.field] = err.message;
    }
    return map;
  }, [hasAttemptedSubmit, validation.errors]);

  const updateField = <K extends keyof SessionFormValues>(
    field: K,
    value: SessionFormValues[K],
  ) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleDistrictChange = (district: string) => {
    setValues((prev) => ({
      ...prev,
      district,
      block: '',
    }));
  };

  const handleApplyMatchedSchool = (school: SchoolRecord) => {
    const allowed = config.allowedDistricts.includes(school.district);
    setValues((prev) => ({
      ...prev,
      schoolName: school.schoolName,
      schoolType: config.schoolTypes.includes(school.schoolType) ? school.schoolType : prev.schoolType,
      district: allowed ? school.district : prev.district,
      block: allowed ? school.block : '',
      pinCode: school.pinCode,
    }));
  };

  const handleModeChange = (mode: SessionMode) => {
    setValues((prev) => {
      if (mode === prev.sessionMode) return prev;
      if (mode === 'single') {
        const first = prev.classes[0] ?? createEmptyClassRow('row-1');
        return { ...prev, sessionMode: 'single', classes: [first] };
      }
      const first = prev.classes[0] ?? createEmptyClassRow('row-1');
      const second = prev.classes[1] ?? createEmptyClassRow(`row-${Date.now()}`);
      return { ...prev, sessionMode: 'combined', classes: [first, second] };
    });
  };

  const handleUpdateClassField = (
    rowIndex: number,
    field: 'grade' | 'section' | 'studentsPresent',
    val: string,
  ) => {
    setValues((prev) => ({
      ...prev,
      classes: prev.classes.map((c, i) => (i === rowIndex ? { ...c, [field]: val } : c)),
    }));
  };

  const handleAddClassRow = () => {
    setValues((prev) => {
      if (prev.classes.length >= 10) return prev;
      return {
        ...prev,
        classes: [...prev.classes, createEmptyClassRow(`row-${Date.now()}-${prev.classes.length + 1}`)],
      };
    });
  };

  const handleRemoveClassRow = (rowIndex: number) => {
    setValues((prev) => {
      if (prev.classes.length <= 2) return prev;
      return {
        ...prev,
        classes: prev.classes.filter((_, i) => i !== rowIndex),
      };
    });
  };

  const handleClearClassRow = (rowIndex: number) => {
    setValues((prev) => ({
      ...prev,
      classes: prev.classes.map((c, i) =>
        i === rowIndex ? createEmptyClassRow(c.rowId) : c,
      ),
    }));
  };

  const handleUpdateCount = (
    rowIndex: number,
    question: 'questionA' | 'questionB',
    scoreKey: keyof ScoreCounts,
    rawValue: string,
  ) => {
    setValues((prev) => ({
      ...prev,
      classes: prev.classes.map((c, i) =>
        i === rowIndex
          ? {
              ...c,
              [question]: {
                ...c[question],
                [scoreKey]: rawValue,
              },
            }
          : c,
      ),
    }));
  };

  const handleRestoreDraft = () => {
    if (!pendingDraft) return;
    setValues({
      ...pendingDraft.values,
      facilitatorEmail: user.email,
      clientSubmissionKey: generateUuid(),
    });
    setPendingDraft(null);
    onNotify('success', 'Draft restored', 'Your unfinished local draft has been loaded.');
  };

  const handleDiscardDraft = () => {
    clearFormDraft(user.email);
    setPendingDraft(null);
    onNotify('warning', 'Draft discarded');
  };

  const performReset = () => {
    clearFormDraft(user.email);
    setPendingDraft(null);
    setSavedResult(null);
    setHasAttemptedSubmit(false);
    setQueuedOfflineNotice(false);
    setValues(createInitialSessionForm(user.name, user.email, config));
    if (editingSession) {
      onCancelEdit();
    }
  };

  const handleRequestClear = () => {
    const hasEnteredData =
      values.schoolName.trim() !== '' ||
      values.udiseCode.trim() !== '' ||
      values.startTime !== '' ||
      values.endTime !== '' ||
      values.classes.some((c) => c.grade !== '' || c.studentsPresent !== '');

    if (hasEnteredData && !savedResult) {
      setConfirmClearOpen(true);
    } else {
      performReset();
    }
  };

  const jumpToIssue = (issue: ValidationIssue) => {
    setValidationModalOpen(false);
    setTimeout(() => {
      const targetDomId = resolveFieldDomId(issue.field);
      const targetEl =
        (targetDomId && document.getElementById(targetDomId)) ||
        document.getElementById(`section-${issue.section}`);
      if (targetEl) {
        if (typeof targetEl.scrollIntoView === 'function') {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        if (typeof (targetEl as HTMLElement).focus === 'function') {
          targetEl.focus({ preventScroll: true });
        }
      }
    }, 60);
  };

  const handleSave = async () => {
    if (isSubmitting) return;
    setHasAttemptedSubmit(true);

    if (!validation.valid) {
      const firstErr = validation.errors[0];
      onNotify(
        'error',
        `Please fix ${validation.errors.length} required ${validation.errors.length === 1 ? 'field' : 'fields'}`,
        firstErr?.message,
      );
      setValidationModalOpen(true);
      return;
    }

    // Duplicate protection check on new submissions before Review modal
    if (!editingSession) {
      const lookupRes = isSuperAdmin
        ? await api.getAdminSessions({ search: values.udiseCode, page: 1, pageSize: 50 })
        : await api.getMySessions({ search: values.udiseCode, page: 1, pageSize: 50 });

      const existing = lookupRes.ok && lookupRes.data ? lookupRes.data.items : [];
      const matches = findDuplicateSessionCandidates(values, existing, undefined);
      if (matches.length > 0) {
        setDuplicateCandidates(matches);
        setDuplicateModalOpen(true);
        return;
      }
    }

    setReviewModalOpen(true);
  };

  const executeConfirmedSubmit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    const env = getAuthEnvironment();

    try {
      const res = editingSession
        ? await api.updateSession(editingSession.sessionRecordId, values)
        : await api.createSession(values);

      if (!res.ok || !res.data) {
        if (res.code === 'NETWORK_ERROR') {
          const nowIso = new Date().toISOString();
          enqueueSyncOutboxItem(user.email, {
            clientSubmissionKey: values.clientSubmissionKey,
            operation: editingSession ? 'updateSession' : 'createSession',
            sessionRecordId: editingSession?.sessionRecordId,
            sessionId: editingSession?.sessionId,
            schoolName: values.schoolName,
            udiseCode: values.udiseCode,
            startDate: values.startDate,
            facilitatorEmail: user.email,
            syncStatus: 'PENDING_RETRY',
            attempts: 1,
            lastAttemptAt: nowIso,
            lastError: res.error || 'Network unavailable',
            values,
          });
          appendLocalSyncEvent(user.email, {
            syncId: generateUuid(),
            timestamp: nowIso,
            clientSubmissionKey: values.clientSubmissionKey,
            sessionRecordId: editingSession?.sessionRecordId ?? '',
            sessionId: editingSession?.sessionId ?? '',
            actorEmail: user.email,
            operation: editingSession ? 'updateSession' : 'createSession',
            attempt: 1,
            status: 'PENDING_RETRY',
            errorMessage: res.error || 'Network unavailable',
          });
          clearFormDraft(user.email);
          setReviewModalOpen(false);
          setQueuedOfflineNotice(true);
          onOutboxEnqueued?.();
          onNotify(
            'warning',
            isSuperAdmin ? 'Saved offline to Sync Outbox' : 'Saved offline on this device',
            isSuperAdmin
              ? 'Google Sheets could not be reached. Open Sync Status to retry submission idempotently.'
              : 'Network connection unavailable. Use Retry save in the top bar once reconnected.',
          );
          return;
        }

        setReviewModalOpen(false);
        onNotify(
          'error',
          editingSession ? 'Failed to update session' : 'Failed to save session',
          res.error,
        );
        return;
      }

      const actualSyncStatus: SyncStatus = env.isLiveBackendConfigured
        ? (res.data.session.syncStatus ?? 'SYNCED')
        : 'LOCAL_SANDBOX';

      appendLocalSyncEvent(user.email, {
        syncId: generateUuid(),
        timestamp: new Date().toISOString(),
        clientSubmissionKey: values.clientSubmissionKey,
        sessionRecordId: res.data.session.sessionRecordId,
        sessionId: res.data.session.sessionId,
        actorEmail: user.email,
        operation: editingSession ? 'updateSession' : 'createSession',
        attempt: 1,
        status: actualSyncStatus,
        errorMessage: '',
      });

      clearFormDraft(user.email);
      setPendingDraft(null);
      setQueuedOfflineNotice(false);
      setSavedResult({
        session: res.data.session,
        warnings: res.data.warnings ?? [],
        schoolUdiseConflict:
          'schoolUdiseConflict' in res.data && typeof res.data.schoolUdiseConflict === 'string'
            ? res.data.schoolUdiseConflict
            : undefined,
        syncStatus: actualSyncStatus,
      });
      setReviewModalOpen(false);
      setSuccessModalOpen(true);

      onNotify(
        'success',
        editingSession ? 'Session updated' : 'Session saved',
        `Generated Session ID: ${res.data.session.sessionId}`,
      );
      onSessionSaved?.(res.data.session, actualSyncStatus);
    } finally {
      setIsSubmitting(false);
    }
  };

  const progressPct = Math.round((completedSectionCount / 6) * 100);
  const expectedResponses = metrics.totalStudentsPresent * 2;
  const actualResponses = metrics.totalQuestionAResponses + metrics.totalQuestionBResponses;
  const responseCoveragePct =
    expectedResponses > 0 ? Math.min(100, Math.round((actualResponses / expectedResponses) * 100)) : 0;
  const csatGaugePct =
    metrics.overallCsat !== null ? Math.min(100, Math.max(0, (metrics.overallCsat / 5) * 100)) : 0;
  const itpGaugePct =
    metrics.overallItp !== null ? Math.min(100, Math.max(0, (metrics.overallItp / 5) * 100)) : 0;
  const sessionIdPreview = buildSessionIdPrefix(
    values.startDate,
    values.udiseCode,
    values.sessionMode,
    values.classes,
  );

  const SECTION_LINKS = [
    { id: 'section-1', label: 'You', dockTitle: 'About you', icon: UserRound, statusIdx: 0 },
    { id: 'section-2', label: 'Session', dockTitle: 'About the session', icon: Clapperboard, statusIdx: 1 },
    { id: 'section-3', label: 'School', dockTitle: 'About the school', icon: Building2, statusIdx: 2 },
    { id: 'section-4', label: 'Class', dockTitle: 'About the class', icon: Users, statusIdx: 3 },
    { id: 'section-5', label: 'Answers', dockTitle: "Students' answers", icon: ListChecks, statusIdx: 4 },
    { id: 'section-6', label: 'Teacher', dockTitle: "Teacher's answer", icon: Award, statusIdx: 5 },
    { id: 'section-7', label: 'Summary', dockTitle: 'Your results', icon: Sparkles, statusIdx: -1 },
  ] as const;

  return (
    <div
      className={
        embeddedInModal
          ? 'w-full ct-form-shell'
          : 'w-full max-w-[1220px] mx-auto px-4 sm:px-6 pb-16 ct-form-shell'
      }
    >
      {/* Mobile & Tablet Sticky Section Jump Ribbon (<lg); Desktop moves to Studio Cockpit Dock */}
      <div className={embeddedInModal ? 'mb-4' : 'mb-5 ct-jump-bar lg:hidden'}>
        <div
          className={`${
            embeddedInModal ? 'bg-[#F1F5F9] border border-[#CBD5E1]' : 'ct-glass ct-jump-bar-surface'
          } px-3 py-2 rounded-2xl flex items-center justify-between gap-2.5 text-xs`}
        >
          <nav
            className="flex-1 min-w-0 flex flex-wrap sm:flex-nowrap items-center gap-1.5 sm:overflow-x-auto"
            aria-label="Form sections"
          >
            {SECTION_LINKS.map((s) => {
              const done = s.statusIdx >= 0 ? sectionStatus[s.statusIdx] : validation.valid;
              const Icon = s.icon;
              return (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border whitespace-nowrap transition-colors ${
                    done
                      ? 'bg-[#E6F6F4] border-[#0F766E] text-[#0F172A]'
                      : 'bg-[#FFFFFF] border-[#CBD5E1] text-[#475569] hover:text-[#0F172A] hover:border-[#0F766E]/60'
                  }`}
                >
                  {done ? (
                    <span
                      className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#ECFDF5] text-[#047857] shrink-0"
                      aria-hidden="true"
                    >
                      <Check className="w-3 h-3" strokeWidth={2.5} />
                    </span>
                  ) : (
                    <Icon className="w-3.5 h-3.5 text-[#0F766E] shrink-0" aria-hidden="true" />
                  )}
                  <span className="font-medium">{s.label}</span>
                </a>
              );
            })}
          </nav>

          <div
            className="ct-progress-ring-wrapper shrink-0"
            title={`${completedSectionCount} of 6 sections ready`}
          >
            <progress
              value={progressPct}
              max={100}
              aria-label="Form sections readiness"
              aria-valuetext={`${completedSectionCount} of 6 sections ready`}
              className="ct-progress-ring"
              style={{ '--ct-progress-val': progressPct } as React.CSSProperties}
            />
            <span className="ct-progress-ring-label" aria-hidden="true">
              {completedSectionCount}/6
            </span>
          </div>
        </div>
      </div>

      {/* Asymmetric 2026 Bento Workbench Layout (Main Stream + Sticky Studio Telemetry Dock on Desktop) */}
      <div
        className={
          embeddedInModal
            ? 'w-full'
            : 'lg:grid lg:grid-cols-[minmax(0,1fr)_336px] xl:grid-cols-[minmax(0,1fr)_356px] lg:gap-6 items-start'
        }
      >
        <div className="min-w-0 flex flex-col">
          {/* Offline Outbox Notice */}
          {queuedOfflineNotice && (
            <div
              role="status"
              className="mb-4 p-4 rounded-xl bg-[#FFFBEB] border border-[#B45309]/40 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex items-start gap-2.5 text-xs sm:text-sm text-[#0F172A]">
                <CloudOff className="w-4 h-4 text-[#B45309] shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <p className="font-medium text-[#B45309]">
                    {isSuperAdmin
                      ? 'Submission queued offline for Google Sheets retry'
                      : 'Submission saved offline on this device'}
                  </p>
                  <p className="text-xs text-[#92400E] mt-0.5">
                    Network connectivity failed. Your exact responses are saved locally for safe
                    retry.
                  </p>
                </div>
              </div>
              {isSuperAdmin && onOpenSyncStatus && (
                <button
                  type="button"
                  onClick={onOpenSyncStatus}
                  className="ct-btn-secondary text-xs min-h-[36px] px-3 py-1"
                >
                  Open Sync Outbox
                </button>
              )}
            </div>
          )}

          {/* Editing mode banner */}
          {editingSession && (
            <div
              role="status"
              className="mb-4 p-4 rounded-xl bg-[#E6F6F4] border border-[#0F766E]/45 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="text-sm text-[#0F172A]">
                Editing saved session{' '}
                <strong className="font-mono font-medium text-[#0F766E]">
                  {editingSession.sessionId}
                </strong>
              </div>
              <button
                type="button"
                onClick={() => {
                  performReset();
                  if (embeddedInModal) onCloseModal?.();
                }}
                className="ct-btn-secondary text-xs min-h-[36px] px-3 py-1"
              >
                Cancel editing
              </button>
            </div>
          )}

          {/* Local draft recovery banner */}
          {pendingDraft && !editingSession && (
            <div
              role="region"
              aria-label="Local draft recovery"
              className="mb-4 p-4 rounded-xl bg-[#FFFFFF] border border-[#0F766E]/40 shadow-sm flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex items-start gap-2.5 text-sm text-[#0F172A]">
                <History className="w-5 h-5 text-[#0F766E] shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <p className="font-medium">
                    Unfinished local draft found (not submitted yet)
                  </p>
                  <p className="text-xs text-[#475569] mt-0.5 ct-num">
                    Saved locally on {new Date(pendingDraft.savedAt).toLocaleString()} · School:{' '}
                    {pendingDraft.values.schoolName || 'Not entered'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleRestoreDraft}
                  className="ct-btn-primary text-xs min-h-[36px] px-3 py-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  Restore draft
                </button>
                <button
                  type="button"
                  onClick={handleDiscardDraft}
                  className="ct-btn-secondary text-xs min-h-[36px] px-3 py-1.5"
                >
                  Discard draft
                </button>
              </div>
            </div>
          )}

          <form
            ref={formRef}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void handleSave();
            }}
            className="flex flex-col gap-5 min-w-0"
          >
            <Section1AboutYou
              facilitatorName={values.facilitatorName}
              facilitatorEmail={values.facilitatorEmail}
              user={user}
              isAdminEditingOther={Boolean(
                editingSession && editingSession.facilitatorEmail !== user.email,
              )}
              isComplete={sectionStatus[0]}
              errorMap={errorMap}
              onChangeName={(val) => updateField('facilitatorName', val)}
            />

            <Section2AboutSession
              values={values}
              config={config}
              isComplete={sectionStatus[1]}
              errorMap={errorMap}
              onUpdate={updateField}
            />

            <Section3AboutSchool
              values={values}
              config={config}
              isComplete={sectionStatus[2]}
              errorMap={errorMap}
              matchedSchool={matchedSchool}
              onUpdate={updateField}
              onDistrictChange={handleDistrictChange}
              onApplyMatchedSchool={handleApplyMatchedSchool}
            />

            <Section4AboutClass
              sessionMode={values.sessionMode}
              classes={values.classes}
              metrics={metrics}
              config={config}
              isComplete={sectionStatus[3]}
              errorMap={errorMap}
              onChangeMode={handleModeChange}
              onUpdateClassField={handleUpdateClassField}
              onAddClassRow={handleAddClassRow}
              onRemoveClassRow={handleRemoveClassRow}
              onClearClassRow={handleClearClassRow}
            />

            <Section5StudentsAnswers
              sessionMode={values.sessionMode}
              classes={values.classes}
              classMetrics={metrics.classBreakdown}
              isComplete={sectionStatus[4]}
              errorMap={errorMap}
              onUpdateCount={handleUpdateCount}
            />

            <Section6TeachersAnswer
              teacherNpsGroup={values.teacherNpsGroup}
              teacherExactScore={values.teacherExactScore}
              metrics={metrics}
              isComplete={sectionStatus[5]}
              errorMap={errorMap}
              onSelectGroup={(g) => updateField('teacherNpsGroup', g)}
              onSelectExactScore={(s) => updateField('teacherExactScore', s)}
            />

            <Section7Results
              values={values}
              metrics={metrics}
              validation={validation}
              config={config}
              isSuperAdmin={isSuperAdmin}
              hasAttemptedSubmit={hasAttemptedSubmit}
              isSubmitting={isSubmitting}
              isEditing={Boolean(editingSession)}
              editingSessionId={editingSession?.sessionId ?? null}
              savedResult={savedResult}
              onSave={() => void handleSave()}
              onRequestClear={handleRequestClear}
              onStartNewSession={performReset}
              onViewSavedInMyClasses={() => {
                onCloseModal?.();
                onSavedNavigateToMyClasses();
              }}
              onOpenSyncStatus={isSuperAdmin ? onOpenSyncStatus : undefined}
              onCancelModal={embeddedInModal ? onCloseModal : undefined}
            />
          </form>
        </div>

        {/* Sticky Desktop Studio Cockpit Dock (scrollspy nav + live session telemetry) */}
        {!embeddedInModal && (
          <aside
            aria-label="Session workbench cockpit"
            className="hidden lg:flex lg:flex-col lg:gap-4 lg:sticky lg:top-4"
          >
            {/* Card 1: Completion Ring + Native CSS Scrollspy Navigator */}
            <div className="ct-glass rounded-2xl p-4 flex flex-col gap-3.5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wider text-[#526077]">
                    Session Checklist
                  </div>
                  <div className="text-sm font-medium text-[#0F172A] mt-0.5 ct-num">
                    {completedSectionCount} of 6 ready
                  </div>
                </div>

                <div
                  className="ct-progress-ring-wrapper shrink-0"
                  title={`${completedSectionCount} of 6 sections ready`}
                >
                  <progress
                    value={progressPct}
                    max={100}
                    aria-label="Studio readiness"
                    aria-valuetext={`${completedSectionCount} of 6 ready`}
                    className="ct-progress-ring"
                    style={{ '--ct-progress-val': progressPct } as React.CSSProperties}
                  />
                  <span className="ct-progress-ring-label" aria-hidden="true">
                    {progressPct}%
                  </span>
                </div>
              </div>

              <nav
                ref={studioNavRef}
                aria-label="Jump to form sections"
                className="ct-studio-nav flex flex-col gap-1"
              >
                {SECTION_LINKS.map((s) => {
                  const done = s.statusIdx >= 0 ? sectionStatus[s.statusIdx] : validation.valid;
                  const Icon = s.icon;
                  return (
                    <a
                      key={s.id}
                      href={`#${s.id}`}
                      className="ct-interactive-tile flex items-center justify-between gap-2.5 px-3 py-2 rounded-xl border border-transparent text-xs sm:text-[13px] text-[#475569] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition-colors"
                    >
                      <span className="inline-flex items-center gap-2.5 min-w-0">
                        <Icon className="w-4 h-4 text-[#0F766E] shrink-0" aria-hidden="true" />
                        <span className="truncate">{s.dockTitle}</span>
                      </span>
                      {done && (
                        <span
                          className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#ECFDF5] text-[#047857] shrink-0"
                          aria-hidden="true"
                        >
                          <Check className="w-3 h-3" strokeWidth={2.5} />
                        </span>
                      )}
                    </a>
                  );
                })}
              </nav>
            </div>

            {/* Card 2: Real-Time Telemetry Pulse */}
            <div className="ct-glass rounded-2xl p-4 flex flex-col gap-3.5 ct-num">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wider text-[#526077]">
                  Live Telemetry
                </span>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                    validation.valid
                      ? 'bg-[#ECFDF5] border-[#047857]/35 text-[#047857]'
                      : 'bg-[#F8FAFC] border-[#CBD5E1] text-[#475569]'
                  }`}
                >
                  {validation.valid ? 'Ready to save' : `${validation.errors.length} pending`}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="ct-bento-well p-3">
                  <div className="text-[10px] uppercase tracking-wider text-[#526077]">CSAT</div>
                  <div className="text-lg font-semibold text-[#0F766E] mt-0.5">
                    {formatScore2(metrics.overallCsat)}
                  </div>
                  <div aria-hidden="true" className="mt-2 h-1 rounded-full bg-[#E2E8F0] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#0F766E] transition-[width] duration-200"
                      style={{ width: `${csatGaugePct}%` }}
                    />
                  </div>
                </div>

                <div className="ct-bento-well p-3">
                  <div className="text-[10px] uppercase tracking-wider text-[#526077]">ITP</div>
                  <div className="text-lg font-semibold text-[#0F172A] mt-0.5">
                    {formatScore2(metrics.overallItp)}
                  </div>
                  <div aria-hidden="true" className="mt-2 h-1 rounded-full bg-[#E2E8F0] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#047857] transition-[width] duration-200"
                      style={{ width: `${itpGaugePct}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="ct-bento-well p-3 flex flex-col gap-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#526077]">Teacher rating</span>
                  <span className="font-medium text-[#0F172A]">
                    {metrics.teacherClassification
                      ? `${metrics.teacherClassification} (${
                          metrics.teacherNps && metrics.teacherNps > 0
                            ? '+100'
                            : metrics.teacherNps ?? 0
                        })`
                      : 'Pending'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#526077]">Response coverage</span>
                  <span className="font-medium text-[#0F172A]">
                    {actualResponses}/{expectedResponses} ({responseCoveragePct}%)
                  </span>
                </div>
                <div aria-hidden="true" className="h-1 rounded-full bg-[#E2E8F0] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#0F766E] transition-[width] duration-200"
                    style={{ width: `${responseCoveragePct}%` }}
                  />
                </div>
              </div>

              <div className="ct-bento-well p-3 flex items-start gap-2 text-xs">
                <Hash className="w-3.5 h-3.5 text-[#0F766E] shrink-0 mt-0.5" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-[#526077]">ID Preview</div>
                  <div className="font-mono text-[11px] text-[#0F172A] break-all mt-0.5">
                    {savedResult
                      ? savedResult.session.sessionId
                      : editingSession
                        ? editingSession.sessionId
                        : sessionIdPreview
                          ? `${sessionIdPreview}_NNN`
                          : 'Waiting for date, UDISE & class'}
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={isSubmitting || Boolean(savedResult && !editingSession)}
                onClick={() => void handleSave()}
                className="ct-btn-primary w-full justify-center rounded-xl text-sm"
              >
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                {isSubmitting
                  ? 'Submitting...'
                  : savedResult
                    ? 'Session saved'
                    : editingSession
                      ? 'Review & update'
                      : 'Review & submit'}
              </button>
            </div>
          </aside>
        )}
      </div>

      {/* Modal #4: Validation Errors */}
      <ValidationErrorModal
        open={validationModalOpen}
        errors={validation.errors}
        onClose={() => setValidationModalOpen(false)}
        onJumpToIssue={jumpToIssue}
      />

      {/* Modal #5: Duplicate Submission Warning */}
      <DuplicateWarningModal
        open={duplicateModalOpen}
        candidates={duplicateCandidates}
        onCancel={() => setDuplicateModalOpen(false)}
        onProceedAnyway={() => {
          setDuplicateModalOpen(false);
          setReviewModalOpen(true);
        }}
      />

      {/* Modal #2: Review Before Submission */}
      <ReviewSubmissionModal
        open={reviewModalOpen}
        isEditing={Boolean(editingSession)}
        isSubmitting={isSubmitting}
        values={values}
        metrics={metrics}
        warnings={validation.warnings}
        config={config}
        onBackToEdit={() => setReviewModalOpen(false)}
        onConfirmSubmit={() => void executeConfirmedSubmit()}
      />

      {/* Modal #3: Successful Submission */}
      <SubmissionSuccessModal
        open={successModalOpen}
        isEditing={Boolean(editingSession)}
        isSuperAdmin={isSuperAdmin}
        session={savedResult?.session ?? null}
        syncStatus={savedResult?.syncStatus ?? 'LOCAL_SANDBOX'}
        warnings={savedResult?.warnings ?? []}
        schoolUdiseConflict={savedResult?.schoolUdiseConflict}
        onClose={() => {
          setSuccessModalOpen(false);
          if (embeddedInModal && editingSession) {
            onCloseModal?.();
          }
        }}
        onStartNewSession={() => {
          setSuccessModalOpen(false);
          performReset();
        }}
        onViewInMyClasses={() => {
          setSuccessModalOpen(false);
          onCloseModal?.();
          onSavedNavigateToMyClasses();
        }}
        onOpenSyncStatus={isSuperAdmin ? onOpenSyncStatus : undefined}
      />

      {/* Modal #6: Confirm Clear Form */}
      <ConfirmDialog
        open={confirmClearOpen}
        title="Clear the class details?"
        description="You have unsaved data in this form. Clearing will discard your current entries and remove your local draft."
        confirmLabel="Yes, clear form"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          setConfirmClearOpen(false);
          performReset();
        }}
        onCancel={() => setConfirmClearOpen(false)}
      />
    </div>
  );
};

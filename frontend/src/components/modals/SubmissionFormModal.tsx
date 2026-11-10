import React from 'react';
import type { BackendApiClient } from '../../services/apiClient';
import { SessionEntryForm } from '../../forms/SessionEntryForm';
import type {
  AppConfiguration,
  SessionRecord,
  SyncStatus,
  UserProfile,
} from '../../types/domain';
import { GlassModal } from './GlassModal';

interface SubmissionFormModalProps {
  open: boolean;
  onClose: () => void;
  api: BackendApiClient;
  user: UserProfile;
  config: AppConfiguration;
  editingSession: SessionRecord | null;
  onSavedNavigateToMyClasses: () => void;
  onSessionSaved?: (session: SessionRecord, syncStatus: SyncStatus) => void;
  onOpenSyncStatus?: () => void;
  onOutboxEnqueued?: () => void;
  onNotify: (type: 'success' | 'error' | 'warning', title: string, detail?: string) => void;
}

export const SubmissionFormModal: React.FC<SubmissionFormModalProps> = ({
  open,
  onClose,
  api,
  user,
  config,
  editingSession,
  onSavedNavigateToMyClasses,
  onSessionSaved,
  onOpenSyncStatus,
  onOutboxEnqueued,
  onNotify,
}) => {
  const isEditing = Boolean(editingSession);

  return (
    <GlassModal
      open={open}
      onClose={onClose}
      size="2xl"
      eyebrow={isEditing ? 'Edit Submission' : 'New Submission'}
      title={
        editingSession
          ? `Edit Session · ${editingSession.sessionId}`
          : 'Add New Classroom Submission'
      }
      subtitle={
        isEditing
          ? 'Updates recalculate CSAT/ITP/NPS automatically while preserving the Session ID and appending an audit log entry.'
          : 'Record a classroom Career Tours session. Real-time metrics, validation, and duplicate checks run before saving.'
      }
    >
      {open && (
        <SessionEntryForm
          key={editingSession?.sessionRecordId ?? 'modal-new-submission'}
          api={api}
          user={user}
          config={config}
          editingSession={editingSession}
          embeddedInModal={true}
          onCancelEdit={onClose}
          onCloseModal={onClose}
          onSavedNavigateToMyClasses={onSavedNavigateToMyClasses}
          onSessionSaved={onSessionSaved}
          onOpenSyncStatus={onOpenSyncStatus}
          onOutboxEnqueued={onOutboxEnqueued}
          onNotify={onNotify}
        />
      )}
    </GlassModal>
  );
};

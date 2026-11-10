import React from 'react';
import { formatScore2 } from '../calculations/metrics';
import { GlassModal } from '../components/modals/GlassModal';
import type { SessionRecord } from '../types/domain';
import { formatISODateToDDMMYYYY, formatTime24To12 } from '../utils/temporal';

interface SessionDetailModalProps {
  session: SessionRecord | null;
  isSuperAdmin?: boolean;
  onClose: () => void;
  onEdit?: (session: SessionRecord) => void;
}

export const SessionDetailModal: React.FC<SessionDetailModalProps> = ({
  session,
  isSuperAdmin = false,
  onClose,
  onEdit,
}) => {
  const missingQa = session
    ? Math.max(0, session.totalStudentsPresent - session.totalQuestionAResponses)
    : 0;
  const missingQb = session
    ? Math.max(0, session.totalStudentsPresent - session.totalQuestionBResponses)
    : 0;

  return (
    <GlassModal
      open={Boolean(session)}
      onClose={onClose}
      size="lg"
      eyebrow="Session Record Details"
      title={session ? session.sessionId : 'Session Details'}
      subtitle={
        session
          ? `Internal ID: ${session.sessionRecordId} · Status: ${session.submissionStatus}${
              session.archived ? ' (ARCHIVED)' : ''
            }`
          : undefined
      }
      headerBadge={
        isSuperAdmin && session?.syncStatus ? (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#162D55] border border-[#26456F] text-[#A4B7D2]">
            {session.syncStatus === 'SYNCED' ? 'Google Sheets Synced' : session.syncStatus}
          </span>
        ) : undefined
      }
      closeLabel="Close session details"
      footer={
        <>
          {onEdit && session && !session.archived && (
            <button
              type="button"
              onClick={() => {
                const target = session;
                onClose();
                onEdit(target);
              }}
              className="ct-btn-primary text-sm"
            >
              Edit this session
            </button>
          )}
          <button type="button" onClick={onClose} className="ct-btn-secondary text-sm">
            Close
          </button>
        </>
      }
    >
      {session && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs sm:text-sm bg-[#0C1931] p-4 rounded-xl border border-[#26456F]">
            <div>
              <span className="text-[#A4B7D2]">Facilitator:</span>{' '}
              <span className="font-medium text-[#E8EFFC]">{session.facilitatorName}</span>{' '}
              <span className="text-[#8294B1]">({session.facilitatorEmail})</span>
            </div>
            <div>
              <span className="text-[#A4B7D2]">Tour:</span>{' '}
              <span className="font-medium text-[#E8EFFC]">{session.tourName}</span>
            </div>
            <div>
              <span className="text-[#A4B7D2]">Video ID:</span>{' '}
              <span className="font-mono text-[#4EBBBB]">{session.videoId}</span>
            </div>
            <div>
              <span className="text-[#A4B7D2]">Language:</span>{' '}
              <span className="font-medium text-[#E8EFFC]">{session.language}</span>
            </div>
            <div>
              <span className="text-[#A4B7D2]">Schedule:</span>{' '}
              <span className="font-medium text-[#E8EFFC] ct-num">
                {formatISODateToDDMMYYYY(session.startDate)} ({formatTime24To12(session.startTime)}) →{' '}
                {formatISODateToDDMMYYYY(session.endDate)} ({formatTime24To12(session.endTime)})
              </span>
            </div>
            <div>
              <span className="text-[#A4B7D2]">Length / Month:</span>{' '}
              <span className="font-medium text-[#E8EFFC] ct-num">
                {session.durationFormatted} · {session.reportingMonth}
              </span>
            </div>
            <div>
              <span className="text-[#A4B7D2]">School:</span>{' '}
              <span className="font-medium text-[#E8EFFC]">{session.schoolName}</span>{' '}
              <span className="text-[#A4B7D2]">({session.schoolType})</span>
            </div>
            <div>
              <span className="text-[#A4B7D2]">UDISE / PIN:</span>{' '}
              <span className="font-mono font-medium text-[#E8EFFC] ct-num">
                {session.udiseCode} / {session.pinCode}
              </span>
            </div>
            <div>
              <span className="text-[#A4B7D2]">Location:</span>{' '}
              <span className="font-medium text-[#E8EFFC]">
                {session.block}, {session.district}, {session.state}
              </span>
            </div>
            <div>
              <span className="text-[#A4B7D2]">Teacher NPS:</span>{' '}
              <span className="font-medium text-[#E8EFFC] ct-num">
                {session.teacherClassification} ({session.teacherNps > 0 ? '+100' : session.teacherNps}
                {session.teacherScore !== null ? `, Score ${session.teacherScore}/10` : ''})
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs ct-num">
            <div className="p-3.5 rounded-xl bg-[#4EBBBB]/12 border border-[#4EBBBB]/45 text-center">
              <div className="text-[11px] font-medium uppercase text-[#4EBBBB]">Pooled CSAT</div>
              <div className="text-xl font-semibold text-[#E8EFFC] mt-1">
                {formatScore2(session.overallCsat)}
              </div>
              <div className="text-[11px] text-[#A4B7D2] mt-0.5">Miss {missingQa}</div>
            </div>
            <div className="p-3.5 rounded-xl bg-[#0C1931] border border-[#26456F] text-center">
              <div className="text-[11px] font-medium uppercase text-[#A4B7D2]">Pooled ITP</div>
              <div className="text-xl font-semibold text-[#E8EFFC] mt-1">
                {formatScore2(session.overallItp)}
              </div>
              <div className="text-[11px] text-[#A4B7D2] mt-0.5">Miss {missingQb}</div>
            </div>
            <div className="p-3.5 rounded-xl bg-[#0C1931] border border-[#26456F] text-center">
              <div className="text-[11px] font-medium uppercase text-[#A4B7D2]">Students</div>
              <div className="text-xl font-semibold text-[#E8EFFC] mt-1">
                {session.totalStudentsPresent}
              </div>
            </div>
            <div className="p-3.5 rounded-xl bg-[#0C1931] border border-[#26456F] text-center">
              <div className="text-[11px] font-medium uppercase text-[#A4B7D2]">Teacher NPS</div>
              <div className="text-xl font-semibold text-[#E8EFFC] mt-1">
                {session.teacherNps > 0 ? '+100' : session.teacherNps}
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-xs sm:text-sm font-medium text-[#E8EFFC] mb-2">
              Class / Grade Breakdown ({session.details.length}{' '}
              {session.details.length === 1 ? 'row' : 'rows'})
            </h3>
            <div className="ct-table-wrapper rounded-xl border border-[#26456F]">
              <table className="w-full text-left text-xs border-collapse min-w-[560px]">
                <thead className="bg-[#0C1931] text-[#A4B7D2] uppercase text-[11px]">
                  <tr>
                    <th scope="col" className="p-2.5 font-medium">Grade</th>
                    <th scope="col" className="p-2.5 font-medium">Section</th>
                    <th scope="col" className="p-2.5 font-medium">Present</th>
                    <th scope="col" className="p-2.5 font-medium">Q-A (5..1)</th>
                    <th scope="col" className="p-2.5 font-medium">CSAT</th>
                    <th scope="col" className="p-2.5 font-medium">Q-B (5..1)</th>
                    <th scope="col" className="p-2.5 font-medium">ITP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#26456F]">
                  {session.details.map((d) => (
                    <tr key={d.detailRecordId} className="bg-[#101E3C] hover:bg-[#162D55] transition-colors ct-num">
                      <td className="p-2.5 font-medium text-[#E8EFFC]">{d.grade}</td>
                      <td className="p-2.5 text-[#A4B7D2]">{d.section}</td>
                      <td className="p-2.5 text-[#E8EFFC]">{d.studentsPresent}</td>
                      <td className="p-2.5 font-mono text-[#A4B7D2]">
                        {d.questionAScore5}/{d.questionAScore4}/{d.questionAScore3}/{d.questionAScore2}/{d.questionAScore1}{' '}
                        ({d.questionATotal})
                      </td>
                      <td className="p-2.5 font-semibold text-[#4EBBBB]">{formatScore2(d.csat)}</td>
                      <td className="p-2.5 font-mono text-[#A4B7D2]">
                        {d.questionBScore5}/{d.questionBScore4}/{d.questionBScore3}/{d.questionBScore2}/{d.questionBScore1}{' '}
                        ({d.questionBTotal})
                      </td>
                      <td className="p-2.5 font-medium text-[#E8EFFC]">{formatScore2(d.itp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </GlassModal>
  );
};

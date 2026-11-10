import React, { useCallback, useEffect, useId, useState } from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import type { BackendApiClient } from '../services/apiClient';
import type { AuditLogEntry, PaginatedResult } from '../types/domain';

interface AuditLogViewerProps {
  api: BackendApiClient;
}

export const AuditLogViewer: React.FC<AuditLogViewerProps> = ({ api }) => {
  const [page, setPage] = useState(1);
  const [logs, setLogs] = useState<PaginatedResult<AuditLogEntry>>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 15,
    totalPages: 1,
  });

  const captionId = useId();

  const load = useCallback(async () => {
    const res = await api.getAuditLogs(page, 15);
    if (res.ok && res.data) setLogs(res.data);
  }, [api, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="ct-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h2 className="text-xl font-medium text-[#E8EFFC] flex items-center gap-2 ct-num">
            <ShieldAlert className="w-5 h-5 text-[#4EBBBB]" aria-hidden="true" />
            Security & Change Audit Log ({logs.total})
          </h2>
          <p className="text-xs text-[#A4B7D2] mt-0.5">
            Immutable trail of session creations, corrections, archives, exports, configuration
            changes, and denied access attempts.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void load()}
          className="ct-btn-secondary text-xs min-h-[38px] px-3"
        >
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          Refresh
        </button>
      </div>

      {logs.items.length === 0 ? (
        <p className="text-xs text-[#A4B7D2] py-6 text-center">No audit events recorded yet.</p>
      ) : (
        <>
          <div
            tabIndex={0}
            role="region"
            aria-labelledby={captionId}
            className="ct-table-wrapper rounded-xl border border-[#26456F]"
          >
            <table className="w-full text-left text-xs border-collapse min-w-[780px]">
              <caption id={captionId} className="visually-hidden">
                Security and change audit trail
              </caption>
              <thead className="bg-[#0C1931] text-[#A4B7D2] uppercase text-[11px]">
                <tr>
                  <th scope="col" className="p-2.5 font-medium">Timestamp</th>
                  <th scope="col" className="p-2.5 font-medium">User</th>
                  <th scope="col" className="p-2.5 font-medium">Action</th>
                  <th scope="col" className="p-2.5 font-medium">Entity</th>
                  <th scope="col" className="p-2.5 font-medium">Summary</th>
                  <th scope="col" className="p-2.5 font-medium">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#26456F]">
                {logs.items.map((l) => (
                  <tr key={l.auditId} className="bg-[#101E3C] hover:bg-[#162D55] transition-colors ct-num">
                    <td className="p-2.5 font-mono text-[#A4B7D2] whitespace-nowrap">
                      {new Date(l.timestamp).toLocaleString()}
                    </td>
                    <td className="p-2.5 text-[#E8EFFC]">{l.userEmail}</td>
                    <td className="p-2.5 font-medium text-[#4EBBBB]">{l.action}</td>
                    <td className="p-2.5 text-[#A4B7D2]">
                      {l.entityType} ({l.entityId})
                    </td>
                    <td className="p-2.5 text-[#A4B7D2] max-w-xs truncate" title={l.newSummary}>
                      {l.previousSummary ? `${l.previousSummary} → ` : ''}
                      {l.newSummary}
                    </td>
                    <td className="p-2.5">
                      <span
                        className={`px-2 py-0.5 rounded-full font-medium border ${
                          l.result === 'SUCCESS'
                            ? 'bg-[#48B98A]/15 border-[#48B98A]/40 text-[#48B98A]'
                            : 'bg-[#E77B83]/15 border-[#E77B83]/45 text-[#E77B83]'
                        }`}
                      >
                        {l.result}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex justify-between items-center text-xs text-[#A4B7D2] ct-num">
            <span>
              Page {logs.page} of {logs.totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={logs.page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="ct-btn-secondary text-xs min-h-[34px] px-3 py-1"
              >
                Prev
              </button>
              <button
                type="button"
                disabled={logs.page >= logs.totalPages}
                onClick={() => setPage((p) => Math.min(logs.totalPages, p + 1))}
                className="ct-btn-secondary text-xs min-h-[34px] px-3 py-1"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
};

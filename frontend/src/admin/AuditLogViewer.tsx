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
          <h2 className="text-xl font-medium text-[#0A1B2C] flex items-center gap-2 ct-num">
            <ShieldAlert className="w-5 h-5 text-[#006BB8]" aria-hidden="true" />
            Security & Change Audit Log ({logs.total})
          </h2>
          <p className="text-xs text-[#243647] mt-0.5">
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
        <p className="text-xs text-[#243647] py-6 text-center">No audit events recorded yet.</p>
      ) : (
        <>
          <div
            tabIndex={0}
            role="region"
            aria-labelledby={captionId}
            className="ct-table-wrapper rounded-xl border border-[#DFD7C2]"
          >
            <table className="w-full text-left text-xs border-collapse min-w-[780px]">
              <caption id={captionId} className="visually-hidden">
                Security and change audit trail
              </caption>
              <thead className="bg-[#F5F2E9] text-[#243647] uppercase text-[11px]">
                <tr>
                  <th scope="col" className="p-2.5 font-medium">Timestamp</th>
                  <th scope="col" className="p-2.5 font-medium">User</th>
                  <th scope="col" className="p-2.5 font-medium">Action</th>
                  <th scope="col" className="p-2.5 font-medium">Entity</th>
                  <th scope="col" className="p-2.5 font-medium">Summary</th>
                  <th scope="col" className="p-2.5 font-medium">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#DFD7C2]">
                {logs.items.map((l) => (
                  <tr key={l.auditId} className="bg-[#FFFFFF] hover:bg-[#F5F2E9] transition-colors ct-num">
                    <td className="p-2.5 font-mono text-[#243647] whitespace-nowrap">
                      {new Date(l.timestamp).toLocaleString()}
                    </td>
                    <td className="p-2.5 text-[#0A1B2C]">{l.userEmail}</td>
                    <td className="p-2.5 font-medium text-[#006BB8]">{l.action}</td>
                    <td className="p-2.5 text-[#243647]">
                      {l.entityType} ({l.entityId})
                    </td>
                    <td className="p-2.5 text-[#243647] max-w-xs truncate" title={l.newSummary}>
                      {l.previousSummary ? `${l.previousSummary} → ` : ''}
                      {l.newSummary}
                    </td>
                    <td className="p-2.5">
                      <span
                        className={`px-2 py-0.5 rounded-full font-medium border ${
                          l.result === 'SUCCESS'
                            ? 'bg-[#ECFDF5] border-[#047857]/35 text-[#047857]'
                            : 'bg-[#FFF1F2] border-[#BE123C]/40 text-[#BE123C]'
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

          <div className="mt-3 flex justify-between items-center text-xs text-[#243647] ct-num">
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

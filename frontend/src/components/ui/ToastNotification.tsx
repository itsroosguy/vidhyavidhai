import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning';
  title: string;
  detail?: string;
}

interface ToastNotificationProps {
  toast: ToastMessage | null;
  onDismiss: () => void;
}

export const ToastNotification: React.FC<ToastNotificationProps> = ({ toast, onDismiss }) => {
  if (!toast) return null;

  const accent = {
    success: 'border-[#48B98A]/50 text-[#48B98A]',
    error: 'border-[#E77B83]/55 text-[#E77B83]',
    warning: 'border-[#F2B44D]/50 text-[#F2B44D]',
  }[toast.type];

  const Icon =
    toast.type === 'success'
      ? CheckCircle2
      : toast.type === 'error'
        ? AlertCircle
        : AlertTriangle;

  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      className={`fixed bottom-4 right-4 z-50 max-w-md w-[calc(100%-2rem)] rounded-xl bg-[#101E3C] border p-4 shadow-2xl flex items-start gap-3 ${accent}`}
    >
      <Icon className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#E8EFFC]">{toast.title}</p>
        {toast.detail && (
          <p className="text-xs mt-1 text-[#A4B7D2] break-words leading-relaxed">
            {toast.detail}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="p-1.5 rounded-md hover:bg-[#162D55] text-[#A4B7D2] hover:text-[#E8EFFC] cursor-pointer shrink-0 transition-colors"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
};

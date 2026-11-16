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
    success: 'border-[#047857]/40 text-[#047857]',
    error: 'border-[#BE123C]/45 text-[#BE123C]',
    warning: 'border-[#B45309]/45 text-[#B45309]',
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
      className={`fixed bottom-4 right-4 z-50 max-w-md w-[calc(100%-2rem)] rounded-xl bg-[#FFFFFF] border p-4 shadow-[0_18px_48px_rgba(10,27,44,0.16)] flex items-start gap-3 ${accent}`}
    >
      <Icon className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#0A1B2C]">{toast.title}</p>
        {toast.detail && (
          <p className="text-xs mt-1 text-[#243647] break-words leading-relaxed">
            {toast.detail}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="p-1.5 rounded-md hover:bg-[#F5F2E9] text-[#243647] hover:text-[#0A1B2C] cursor-pointer shrink-0 transition-colors"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
};

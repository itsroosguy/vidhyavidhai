import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { attachDialogLightDismiss, closeTopLayer } from '../../utils/dialogTopLayer';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl';

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'w-full max-w-md',
  md: 'w-full max-w-xl',
  lg: 'w-full max-w-3xl',
  xl: 'w-full max-w-4xl',
  '2xl': 'w-full max-w-5xl',
};

interface GlassModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  subtitle?: string;
  headerBadge?: React.ReactNode;
  size?: ModalSize;
  closeLabel?: string;
  disableLightDismiss?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export const GlassModal: React.FC<GlassModalProps> = ({
  open,
  onClose,
  title,
  eyebrow,
  subtitle,
  headerBadge,
  size = 'md',
  closeLabel = 'Close dialog',
  disableLightDismiss = false,
  footer,
  children,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closingViaHandlerRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      delete dialog.dataset.closing;
      dialog.showModal();
    } else if (!open && dialog.open) {
      closingViaHandlerRef.current = true;
      void closeTopLayer(dialog).finally(() => {
        closingViaHandlerRef.current = false;
      });
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleNativeClose = () => {
      if (!closingViaHandlerRef.current) {
        onClose();
      }
    };

    dialog.addEventListener('close', handleNativeClose);
    const detachLightDismiss = disableLightDismiss
      ? () => {
          const onCancel = (e: Event) => {
            e.preventDefault();
          };
          dialog.addEventListener('cancel', onCancel);
          return () => dialog.removeEventListener('cancel', onCancel);
        }
      : () =>
          attachDialogLightDismiss(dialog, () => {
            void closeTopLayer(dialog).then(() => onClose());
          });

    const cleanupDismiss = detachLightDismiss();
    return () => {
      dialog.removeEventListener('close', handleNativeClose);
      cleanupDismiss();
    };
  }, [disableLightDismiss, onClose]);

  const requestClose = () => {
    const dialog = dialogRef.current;
    if (dialog && dialog.open) {
      closingViaHandlerRef.current = true;
      void closeTopLayer(dialog).then(() => {
        closingViaHandlerRef.current = false;
        onClose();
      });
    } else {
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className={SIZE_CLASSES[size]}
    >
      <div className="flex flex-col max-h-[88dvh]">
        {/* Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-[#DFD7C2] flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            {(eyebrow || headerBadge) && (
              <div className="flex flex-wrap items-center gap-2 mb-1">
                {eyebrow && (
                  <span className="text-[11px] font-medium uppercase tracking-wider text-[#006BB8]">
                    {eyebrow}
                  </span>
                )}
                {headerBadge}
              </div>
            )}
            <h2
              id={titleId}
              className="text-lg sm:text-xl font-medium text-[#0A1B2C] leading-snug tracking-tight"
            >
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs sm:text-sm text-[#243647] mt-0.5 leading-relaxed">
                {subtitle}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={requestClose}
            aria-label={closeLabel}
            className="shrink-0 w-9 h-9 rounded-lg bg-[#F5F2E9] hover:bg-[#EFE8D6] border border-[#8E8674] text-[#243647] hover:text-[#0A1B2C] inline-flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="px-5 sm:px-6 py-5 overflow-y-auto flex-1 space-y-4">
          {children}
        </div>

        {/* Optional Footer */}
        {footer && (
          <div className="px-5 sm:px-6 py-4 border-t border-[#DFD7C2] bg-[#F5F2E9] flex flex-wrap items-center justify-end gap-2.5 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </dialog>
  );
};

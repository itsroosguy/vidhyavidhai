import React, { useEffect, useId, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { attachDialogLightDismiss, closeTopLayer } from '../../utils/dialogTopLayer';

export interface ConfirmDialogMetadata {
  label: string;
  value: string;
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  metadata?: ConfirmDialogMetadata[];
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  metadata,
  onConfirm,
  onCancel,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closingProgrammaticallyRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      delete dialog.dataset.closing;
      dialog.showModal();
    } else if (!open && dialog.open) {
      closingProgrammaticallyRef.current = true;
      void closeTopLayer(dialog).finally(() => {
        closingProgrammaticallyRef.current = false;
      });
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      if (closingProgrammaticallyRef.current) return;
      const val = dialog.returnValue;
      dialog.returnValue = '';
      if (val === 'confirm') {
        onConfirm();
      } else {
        onCancel();
      }
    };

    dialog.addEventListener('close', handleClose);
    const cleanupLight = attachDialogLightDismiss(dialog, () => {
      dialog.returnValue = '';
      void closeTopLayer(dialog, '');
    });

    return () => {
      dialog.removeEventListener('close', handleClose);
      cleanupLight();
    };
  }, [onCancel, onConfirm]);

  const handleAction = (choice: 'confirm' | 'cancel') => {
    const d = dialogRef.current;
    if (d && d.open) {
      d.returnValue = choice;
      void closeTopLayer(d, choice).then(() => {
        d.returnValue = '';
        if (choice === 'confirm') onConfirm();
        else onCancel();
      });
    } else if (choice === 'confirm') {
      onConfirm();
    } else {
      onCancel();
    }
  };

  return (
    <dialog ref={dialogRef} aria-labelledby={titleId} className="w-full max-w-md">
      <div className="p-6 flex flex-col gap-4">
        <div className="flex items-start gap-3">
          {destructive && (
            <div className="w-9 h-9 rounded-lg bg-[#FFF1F2] border border-[#BE123C]/35 flex items-center justify-center text-[#BE123C] shrink-0 mt-0.5">
              <AlertTriangle className="w-4 h-4" aria-hidden="true" />
            </div>
          )}
          <div>
            <span className="text-[11px] font-medium uppercase tracking-wider text-[#33475B]">
              {destructive ? 'Confirmation Required' : 'Confirm Action'}
            </span>
            <h2 id={titleId} className="text-lg font-medium text-[#0A1B2C] mt-0.5">
              {title}
            </h2>
          </div>
        </div>

        <p className="text-sm text-[#243647] leading-relaxed">{description}</p>

        {metadata && metadata.length > 0 && (
          <dl className="grid grid-cols-1 gap-1.5 p-3 rounded-lg bg-[#F5F2E9] border border-[#DFD7C2] text-xs">
            {metadata.map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-3">
                <dt className="text-[#243647]">{item.label}</dt>
                <dd className="font-mono text-[#0A1B2C] text-right truncate">{item.value}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className="flex flex-wrap justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={() => handleAction('cancel')}
            autoFocus={destructive}
            className="ct-btn-secondary text-sm px-4"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => handleAction('confirm')}
            className={destructive ? 'ct-btn-danger text-sm px-4' : 'ct-btn-primary text-sm px-4'}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
};

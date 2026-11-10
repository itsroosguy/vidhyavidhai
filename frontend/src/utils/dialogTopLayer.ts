/**
 * Safe utilities for native HTML <dialog> top-layer modal choreography & light-dismiss.
 * Tested in Chromium/Safari/Firefox and safe under jsdom where getAnimations/matchMedia may be absent.
 */

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export async function closeTopLayer(
  dialog: HTMLDialogElement | null,
  returnValue = '',
): Promise<void> {
  if (!dialog || !dialog.open) return;

  if (prefersReducedMotion()) {
    dialog.close(returnValue);
    return;
  }

  const getAnims = (dialog as unknown as { getAnimations?: () => Animation[] }).getAnimations;
  if (typeof getAnims !== 'function') {
    dialog.close(returnValue);
    return;
  }

  dialog.dataset.closing = 'true';
  try {
    const anims = dialog.getAnimations();
    if (anims.length > 0) {
      await Promise.allSettled(anims.map((a) => a.finished));
    }
  } catch {
    // Fallback immediately to native close on animation abort/rejection
  }
  delete dialog.dataset.closing;
  if (dialog.open) {
    dialog.close(returnValue);
  }
}

/**
 * Light-dismiss fallback for browsers lacking `closedBy="any"` on <dialog>.
 * Uses pointerdown+pointerup outside bounding rect so drags/selections inside never dismiss accidentally.
 */
export function attachDialogLightDismiss(
  dialog: HTMLDialogElement,
  onRequestDismiss: () => void,
): () => void {
  const supportsClosedBy = typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype;
  if (supportsClosedBy) {
    dialog.setAttribute('closedby', 'any');
    const onCancel = (e: Event) => {
      e.preventDefault();
      onRequestDismiss();
    };
    dialog.addEventListener('cancel', onCancel);
    return () => {
      dialog.removeEventListener('cancel', onCancel);
    };
  }

  let pressedOutside = false;

  const isOutside = (e: PointerEvent): boolean => {
    const r = dialog.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };

  const onPointerDown = (e: PointerEvent) => {
    pressedOutside = isOutside(e);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (pressedOutside && isOutside(e)) {
      pressedOutside = false;
      onRequestDismiss();
    }
  };

  const onCancel = (e: Event) => {
    e.preventDefault();
    onRequestDismiss();
  };

  dialog.addEventListener('pointerdown', onPointerDown);
  dialog.addEventListener('pointerup', onPointerUp);
  dialog.addEventListener('cancel', onCancel);

  return () => {
    dialog.removeEventListener('pointerdown', onPointerDown);
    dialog.removeEventListener('pointerup', onPointerUp);
    dialog.removeEventListener('cancel', onCancel);
  };
}

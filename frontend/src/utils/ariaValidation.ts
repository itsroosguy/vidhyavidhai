/**
 * Synchronizes programmatic ARIA state (aria-invalid, dynamic aria-describedby error linking,
 * and a single polite live-region announcer) with :user-invalid interaction timing.
 */

let announcerEl: HTMLDivElement | null = null;
let announceTimer: ReturnType<typeof setTimeout> | undefined;
let lastAnnouncedField: Element | null = null;
const flagged = new WeakSet<Element>();
const announced = new WeakSet<Element>();

function getAnnouncer(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;
  if (!announcerEl) {
    announcerEl = document.createElement('div');
    announcerEl.setAttribute('aria-live', 'polite');
    announcerEl.className = 'visually-hidden';
    document.body.append(announcerEl);
  }
  return announcerEl;
}

function linkError(el: HTMLElement, shown: boolean): void {
  const errorId = el.dataset.error;
  if (!errorId) return;
  const ids = (el.getAttribute('aria-describedby') || '')
    .split(/\s+/)
    .filter((id) => id && id !== errorId);
  if (shown) ids.push(errorId);
  if (ids.length > 0) el.setAttribute('aria-describedby', ids.join(' '));
  else el.removeAttribute('aria-describedby');
}

function announceError(el: HTMLElement): void {
  const errorId = el.dataset.error;
  if (!errorId) return;
  const errorNode = document.getElementById(errorId);
  const announcer = getAnnouncer();
  if (!errorNode || !announcer) return;

  const labelText = (el as HTMLInputElement).labels?.[0]?.textContent?.trim() ?? '';
  const msgText = errorNode.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  if (!msgText) return;

  clearTimeout(announceTimer);
  announcer.textContent = '';
  lastAnnouncedField = el;
  announceTimer = setTimeout(() => {
    if (announcer) {
      announcer.textContent = labelText ? `${labelText}: ${msgText}` : msgText;
    }
  }, 450);
}

export function attachAriaValidationSync(root: HTMLElement): () => void {
  const syncControl = (target: EventTarget | null, shouldAnnounce = false) => {
    if (!(target instanceof HTMLElement)) return;
    if (!target.matches('input, select, textarea')) return;

    let isInvalid = false;
    try {
      isInvalid = target.matches(':user-invalid') || target.dataset.customInvalid === 'true';
    } catch {
      isInvalid = target.dataset.customInvalid === 'true';
    }

    if (isInvalid) {
      if (shouldAnnounce && !announced.has(target)) {
        announceError(target);
        announced.add(target);
      }
      target.setAttribute('aria-invalid', 'true');
      linkError(target, true);
      flagged.add(target);
    } else if (flagged.has(target) || target.getAttribute('aria-invalid') !== 'true') {
      target.setAttribute('aria-invalid', 'false');
      linkError(target, false);
      flagged.delete(target);
      announced.delete(target);
      if (lastAnnouncedField === target && announcerEl) {
        clearTimeout(announceTimer);
        announcerEl.textContent = '';
      }
    }
  };

  root.querySelectorAll<HTMLElement>('input, select, textarea').forEach((el) => {
    if (!el.hasAttribute('aria-invalid')) el.setAttribute('aria-invalid', 'false');
  });

  const onBlur = (e: FocusEvent) => syncControl(e.target, true);
  const onInput = (e: Event) => {
    if (e.target instanceof HTMLElement && e.target.hasAttribute('aria-invalid')) {
      syncControl(e.target, false);
    }
  };
  const onChange = (e: Event) => syncControl(e.target, true);
  const onInvalid = (e: Event) => {
    if (e.target instanceof Element) announced.add(e.target);
    syncControl(e.target, false);
  };

  root.addEventListener('blur', onBlur, true);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange, true);
  root.addEventListener('invalid', onInvalid, true);

  return () => {
    root.removeEventListener('blur', onBlur, true);
    root.removeEventListener('input', onInput);
    root.removeEventListener('change', onChange, true);
    root.removeEventListener('invalid', onInvalid, true);
    clearTimeout(announceTimer);
  };
}

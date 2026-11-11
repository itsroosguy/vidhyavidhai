import { validateAppsScriptSyncKey, validateFacilitatorIntakeKey } from './authService';

let cachedTemplate: string | null = null;
let templateLoadPromise: Promise<string> | null = null;

export function getCachedAppsScriptTemplate(): string | null {
  return cachedTemplate;
}

export async function loadAppsScriptTemplate(): Promise<string> {
  if (cachedTemplate) return cachedTemplate;
  if (!templateLoadPromise) {
    templateLoadPromise = import('../../../apps-script/dist/CareerToursAllInOne.gs?raw')
      .then((mod) => {
        const text = typeof mod?.default === 'string' ? mod.default : '';
        if (!text) {
          throw new Error('Unable to load Apps Script bundle template.');
        }
        cachedTemplate = text;
        return text;
      })
      .catch((err) => {
        templateLoadPromise = null;
        throw err;
      });
  }
  return templateLoadPromise;
}

export function preloadAppsScriptTemplate(): void {
  void loadAppsScriptTemplate().catch(() => {
    // Ignore background preload failures; explicit loader surfaces error cleanly.
  });
}

function toSingleQuotedAppsScriptLiteral(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
  return `'${escaped}'`;
}

const PRESET_SYNC_KEY_PATTERN =
  /var\s+CT_PRESET_SANDBOX_SYNC_KEY\s*=\s*['"]__CT_PRESET_SYNC_KEY__['"]\s*;/;
const PRESET_INTAKE_KEY_PATTERN =
  /var\s+CT_PRESET_FACILITATOR_INTAKE_KEY\s*=\s*['"]__CT_PRESET_INTAKE_KEY__['"]\s*;/;

export function buildPersonalizedAppsScriptBundle(
  template: string,
  syncKey: string,
  intakeKey?: string,
): string {
  const check = validateAppsScriptSyncKey(syncKey);
  if (!check.valid) {
    return template;
  }
  const literal = toSingleQuotedAppsScriptLiteral(check.normalized);
  let output = PRESET_SYNC_KEY_PATTERN.test(template)
    ? template.replace(PRESET_SYNC_KEY_PATTERN, () => `var CT_PRESET_SANDBOX_SYNC_KEY = ${literal};`)
    : `var CT_PRESET_SANDBOX_SYNC_KEY = ${literal};\n\n${template}`;

  if (intakeKey) {
    const intakeCheck = validateFacilitatorIntakeKey(intakeKey);
    if (intakeCheck.valid) {
      const intakeLiteral = toSingleQuotedAppsScriptLiteral(intakeCheck.normalized);
      if (PRESET_INTAKE_KEY_PATTERN.test(output)) {
        output = output.replace(
          PRESET_INTAKE_KEY_PATTERN,
          () => `var CT_PRESET_FACILITATOR_INTAKE_KEY = ${intakeLiteral};`,
        );
      }
    }
  }

  return output;
}

export function triggerAppsScriptBundleDownload(
  content: string,
  filename = 'CareerToursAllInOne.gs',
): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 1500);
}

// ============================================================================
// Accessible Invoker Command Copy Listener (Single document delegation)
// ============================================================================

const copyTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
let copyListenerAttached = false;
let lastAnnouncement = '';

function reportCopyOutcome(button: HTMLElement, ok: boolean): void {
  const sibling = button.nextElementSibling;
  const tip =
    sibling && sibling.getAttribute('role') === 'status' ? (sibling as HTMLElement) : null;
  const existingTimer = copyTimers.get(button);
  if (existingTimer !== undefined) {
    clearTimeout(existingTimer);
  }
  button.removeAttribute('data-copied');
  button.removeAttribute('data-failed');

  let message = ok ? 'Copied' : 'Copy failed';
  if (message === lastAnnouncement) {
    message += '\u00A0';
  }
  lastAnnouncement = message;

  if (tip) {
    tip.textContent = '';
  }
  void button.offsetWidth;
  button.setAttribute(ok ? 'data-copied' : 'data-failed', '');

  const writeTip = () => {
    if (tip) {
      tip.textContent = message;
    }
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(writeTip);
  } else {
    writeTip();
  }

  copyTimers.set(
    button,
    setTimeout(() => {
      button.removeAttribute('data-copied');
      button.removeAttribute('data-failed');
      if (tip) {
        tip.textContent = '';
      }
    }, 2200),
  );
}

function legacyCopyFallback(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;inset-block-start:0;opacity:0';
  document.body.append(field);
  field.select();
  try {
    return typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

async function performTargetCopy(button: HTMLElement, target: HTMLElement): Promise<void> {
  const raw =
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
      ? target.value
      : target.innerText || target.textContent || '';
  const text = raw.trim();
  if (!text) return;

  try {
    if (
      typeof navigator === 'undefined' ||
      !navigator.clipboard ||
      typeof navigator.clipboard.writeText !== 'function'
    ) {
      throw new Error('Clipboard API unavailable');
    }
    await navigator.clipboard.writeText(text);
    reportCopyOutcome(button, true);
  } catch {
    reportCopyOutcome(button, legacyCopyFallback(text));
  }
}

export function ensureCopyCommandListener(): void {
  if (copyListenerAttached || typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }
  copyListenerAttached = true;

  if ('CommandEvent' in window) {
    document.addEventListener(
      'command',
      (event: Event) => {
        const cmdEvent = event as Event & {
          command?: string;
          source?: Element | null;
          target?: EventTarget | null;
        };
        if (
          typeof cmdEvent.command === 'string' &&
          cmdEvent.command.startsWith('--copy') &&
          cmdEvent.source instanceof HTMLElement &&
          cmdEvent.target instanceof HTMLElement
        ) {
          void performTargetCopy(cmdEvent.source, cmdEvent.target);
        }
      },
      true,
    );
  } else {
    document.addEventListener('click', (event: MouseEvent) => {
      const origin = event.target instanceof Element ? event.target : null;
      const button = origin?.closest('button[command^="--copy"]');
      if (!(button instanceof HTMLElement)) return;
      const targetId = button.getAttribute('commandfor');
      if (!targetId) return;
      const targetEl = document.getElementById(targetId);
      if (targetEl instanceof HTMLElement) {
        void performTargetCopy(button, targetEl);
      }
    });
  }
}

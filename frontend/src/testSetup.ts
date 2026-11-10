import '@testing-library/jest-dom/vitest';
import { Temporal } from 'temporal-polyfill';

if (typeof (globalThis as unknown as { Temporal?: typeof Temporal }).Temporal === 'undefined') {
  (globalThis as unknown as { Temporal: typeof Temporal }).Temporal = Temporal;
}

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(String(key)) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(String(key));
    },
    setItem(key: string, value: string) {
      store.set(String(key), String(value));
    },
  };
}

if (
  typeof window !== 'undefined' &&
  (!window.localStorage || typeof window.localStorage.clear !== 'function')
) {
  const mem = createMemoryStorage();
  Object.defineProperty(window, 'localStorage', { value: mem, configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: mem, configurable: true });
}

if (typeof HTMLDialogElement !== 'undefined') {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModalMock(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function closeMock(this: HTMLDialogElement, returnValue?: string) {
      if (returnValue !== undefined) {
        this.returnValue = returnValue;
      }
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  }
}

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}

if (typeof window !== 'undefined' && !window.scrollTo) {
  window.scrollTo = () => undefined;
}

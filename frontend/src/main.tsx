import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Temporal } from 'temporal-polyfill';
import App from './App';
import './styles/index.css';

const g = globalThis as unknown as { Temporal?: typeof Temporal };
if (typeof g.Temporal === 'undefined') {
  g.Temporal = Temporal;
}

if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    console.warn('New bundle deployment detected, reloading page...', event);
    window.location.reload();
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

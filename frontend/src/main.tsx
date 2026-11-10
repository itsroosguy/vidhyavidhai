import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Temporal } from 'temporal-polyfill';
import App from './App';
import './styles/index.css';

const g = globalThis as unknown as { Temporal?: typeof Temporal };
if (typeof g.Temporal === 'undefined') {
  g.Temporal = Temporal;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

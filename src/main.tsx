import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

const CHUNK_RELOAD_GUARD_KEY = 'vtnn_taman_chunk_reload_ts';

function tryRecoverFromStaleChunkError(preventDefault?: () => void): void {
  if (typeof window === 'undefined') return;
  try {
    const now = Date.now();
    const lastReload = Number(window.sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY) || 0);
    if (now - lastReload > 15_000) {
      preventDefault?.();
      window.sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, String(now));
      window.location.reload();
    }
  } catch {
    // Ignore storage restriction errors in private mode
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    tryRecoverFromStaleChunkError(() => event.preventDefault());
  });

  window.addEventListener('unhandledrejection', (event) => {
    const msg = String(
      (event.reason && (event.reason.message || event.reason)) || ''
    ).toLowerCase();
    if (
      msg.includes('failed to fetch dynamically imported module') ||
      msg.includes('importing a module script failed') ||
      msg.includes('loading chunk')
    ) {
      tryRecoverFromStaleChunkError(() => event.preventDefault());
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);

if (typeof window !== 'undefined' && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

if (import.meta.env.DEV) {
  // The preview overlay drops the original message when ErrorEvent.error is null.
  // Preserve diagnostics without hiding the error or suppressing the overlay.
  window.addEventListener('error', event => {
    if (event.error instanceof Error) return;
    console.error('[runtime-diagnostic] window.error', {
      message: event.message,
      filename: event.filename?.split(/[?#]/)[0],
      line: event.lineno,
      column: event.colno,
    });
  });
  window.addEventListener('unhandledrejection', event => {
    if (event.reason instanceof Error) return;
    console.error('[runtime-diagnostic] unhandledrejection',
      typeof event.reason === 'string' ? event.reason : Object.prototype.toString.call(event.reason));
  });
}

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);

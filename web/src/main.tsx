import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import { AppProvider } from './lib/store';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </HashRouter>
  </StrictMode>,
);

// Offline shell: cache the app so it opens without a network. Records live in IndexedDB regardless.
if ('serviceWorker' in navigator && import.meta.env.PROD && import.meta.env.VITE_SW !== '0') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* optional enhancement */ }); });
}

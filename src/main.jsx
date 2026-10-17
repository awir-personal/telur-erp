import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { ThemeProvider } from './lib/theme';
import { ConfirmProvider } from './lib/confirm';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <ThemeProvider><ConfirmProvider><BrowserRouter><App /></BrowserRouter></ConfirmProvider></ThemeProvider>,
);

// PWA: daftarkan service worker hanya di build produksi (bukan saat npm run dev).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

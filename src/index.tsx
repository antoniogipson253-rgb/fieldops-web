import * as Sentry from '@sentry/react';

Sentry.init({
  dsn: 'https://ac4bea366b10ebce13c1e2d15833e1a9@o4511572839890944.ingest.us.sentry.io/4511572849262592',
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  environment: process.env.NODE_ENV,
});

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Global styles
const style = document.createElement('style');
style.textContent = `
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  body {
    background-color: #0A0F1E;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  ::-webkit-scrollbar {
    width: 6px;
  }
  ::-webkit-scrollbar-track {
    background: #0A0F1E;
  }
  ::-webkit-scrollbar-thumb {
    background: #1F2937;
    border-radius: 3px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: #374151;
  }
  select option {
    background-color: #111827;
    color: #FFFFFF;
  }
`;
document.head.appendChild(style);

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import './styles/work.css';
import { App } from './App';
import { registerDevMocks } from './bridge/devMocks';

if (import.meta.env.DEV) registerDevMocks();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

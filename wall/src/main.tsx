import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import './styles/work.css';
import './styles/unwind.css';
import './styles/zen.css';
import { App } from './App';
import { registerDevMocks } from './bridge/devMocks';
import { installFullscreenKeys } from './ui/fullscreen';

if (import.meta.env.DEV) registerDevMocks();
installFullscreenKeys();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

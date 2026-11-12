import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import './styles/frame.css';
import './styles/work.css';
import './styles/home.css';
import './styles/meet.css';
import './styles/ribbon.css';
import './styles/agents.css';
import './styles/unwind.css';
import './styles/zen.css';
import { App } from './App';
import { registerDevMocks } from './bridge/devMocks';
import { seedReviewFocus } from './ribbon/devMock';
import { usePlaceStore } from './state/places';
import { installFullscreenKeys } from './ui/fullscreen';
import { reviewFrame } from './ui/reviewClock';

if (import.meta.env.DEV) {
  registerDevMocks();
  seedReviewFocus(reviewFrame?.ms ?? null);
  // A review still opens on the place it names.
  if (reviewFrame) usePlaceStore.getState().setActive(reviewFrame.place);
}
installFullscreenKeys();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

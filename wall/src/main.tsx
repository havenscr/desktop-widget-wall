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
import { usePlaceStore } from './state/places';
import { installFullscreenKeys } from './ui/fullscreen';
import { reviewFrame } from './ui/reviewClock';

if (import.meta.env.DEV) {
  // Imported here, in the development branch only, so a release build carries no mock code.
  const [{ registerDevMocks }, { seedReviewFocus }] = await Promise.all([import('./bridge/devMocks'), import('./ribbon/devMock')]);
  registerDevMocks();
  seedReviewFocus(reviewFrame?.ms ?? null);
  // A review still opens on the place it names.
  if (reviewFrame) usePlaceStore.getState().setActive(reviewFrame.place);
  // Dev only, for stills and the fit check: `?go=meet`, `?go=zen` or `?go=dream` opens that screen.
  const go = new URLSearchParams(window.location.search).get('go');
  // The horizon applies the review place when it mounts, so this waits a moment and goes after it.
  if (go === 'meet' || go === 'zen' || go === 'dream') {
    setTimeout(() => (go === 'dream' ? usePlaceStore.getState().openDream() : usePlaceStore.getState().setActive(go)), 400);
  }
}
installFullscreenKeys();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

import { useEffect } from 'react';
import { startAudio } from './audio/capture';
import { Watt } from './buddy/Watt';
import { useFocusStore } from './focus/store';
import { acquireNowPlaying } from './music/store';
import { HorizonCanvas } from './horizon/HorizonCanvas';
import { Rail } from './rail/Rail';
import { usePlaceStore } from './state/places';
import { Screens } from './screens/Screens';
import { Stage } from './stage/Stage';

export function App() {
  const active = usePlaceStore((s) => s.active);
  // The focus timer lives for the whole app, not for the Work screen.
  useEffect(() => {
    useFocusStore.getState().init();
  }, []);

  // Audio levels and the now playing poll also live for the whole app, so the horizon ripple,
  // the Work music bar and the Unwind view all read the same single source.
  useEffect(() => startAudio(), []);
  useEffect(() => acquireNowPlaying(), []);

  return (
    <Stage>
      <HorizonCanvas />
      <div className="veil" data-place={active} aria-hidden="true" />
      <Watt />
      <div className="shell">
        <Rail />
        <Screens />
      </div>
    </Stage>
  );
}

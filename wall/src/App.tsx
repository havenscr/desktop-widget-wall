import { useEffect } from 'react';
import { startAudio } from './audio/capture';
import { Watt } from './buddy/Watt';
import { useFocusStore } from './focus/store';
import { acquireNowPlaying } from './music/store';
import { HorizonCanvas, WeatherOverlay } from './horizon/HorizonCanvas';
import { Rail } from './rail/Rail';
import { usePlaceStore } from './state/places';
import { Screens } from './screens/Screens';
import { Stage } from './stage/Stage';
import { HoverTipLayer } from './ui/HoverTip';
import { ScreensOffLayer } from './ui/ScreensOffLayer';
import { ToolsDrawer } from './tools/ToolsDrawer';
import { useSignalStore } from './signals/store';
import { startAutoSwitch } from './meet/autoSwitch';
import { LeaveBanner } from './signals/LeaveBanner';
import { FloatingRecordingChip } from './signals/RecordingChip';
import { DrawerScrim } from './ribbon/DrawerScrim';

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
  useEffect(() => useSignalStore.getState().init(), []);
  // Meet opens by itself when a Teams or Zoom call starts.
  useEffect(() => startAutoSwitch(), []);

  return (
    <Stage>
      <HorizonCanvas />
      <div className="veil" data-place={active} aria-hidden="true" />
      <WeatherOverlay />
      <Watt />
      <div className="shell">
        <Rail />
        <Screens />
      </div>
      <DrawerScrim />
      <LeaveBanner />
      <FloatingRecordingChip />
      <ScreensOffLayer />
      <ToolsDrawer />
      <HoverTipLayer />
    </Stage>
  );
}

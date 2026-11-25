import { useEffect, type CSSProperties } from 'react';
import { startAudio } from './audio/capture';
import { Watt } from './buddy/Watt';
import { useFocusStore } from './focus/store';
import { acquireNowPlaying } from './music/store';
import { HorizonCanvas, WeatherOverlay } from './horizon/HorizonCanvas';
import { Rail } from './rail/Rail';
import { usePlaceStore } from './state/places';
import { veilScale } from './backdrop/palette';
import { skyListed, useBackdropSettings } from './backdrop/settings';
import { Screens } from './screens/Screens';
import { Stage } from './stage/Stage';
import { HoverTipLayer } from './ui/HoverTip';
import { LibraryMenuLayer } from './unwind/watch/LibraryMenu';
import { ScreensOffLayer } from './ui/ScreensOffLayer';
import { ToolsDrawer } from './tools/ToolsDrawer';
import { useSignalStore } from './signals/store';
import { startAutoSwitch } from './meet/autoSwitch';
import { LeaveBanner } from './signals/LeaveBanner';
import { FloatingRecordingChip } from './signals/RecordingChip';
import { DrawerScrim } from './ribbon/DrawerScrim';
import { useOnAirLiveReport } from './onair/useOnAirLiveReport';

export function App() {
  const active = usePlaceStore((s) => s.active);
  const strength = useBackdropSettings((s) => s.strength);
  const skyOn = useBackdropSettings((s) => s.available && skyListed(s.places, active));
  // A stronger sky thins the page veil, so the sky reads as strong on a page of cards as on Zen.
  const veilK = skyOn ? veilScale(strength) : 1;
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
  // Tell Rust (and the person card) whether On Air is live, so no address is shown while it is.
  useOnAirLiveReport();

  return (
    <Stage>
      <HorizonCanvas />
      <div className="veil" data-place={active} style={{ '--veil-k': veilK } as CSSProperties} aria-hidden="true" />
      <WeatherOverlay />
      {/* The sun row (ribbon/Ribbon.tsx draws into it): under Watt, who walks that band. */}
      <div className="sun-layer" data-sun-layer="" aria-hidden="true" />
      <Watt />
      <div className="shell" data-place={active}>
        <Rail />
        <Screens />
      </div>
      <DrawerScrim />
      <LeaveBanner />
      <FloatingRecordingChip />
      <ScreensOffLayer />
      <ToolsDrawer />
      <HoverTipLayer />
      <LibraryMenuLayer />
    </Stage>
  );
}

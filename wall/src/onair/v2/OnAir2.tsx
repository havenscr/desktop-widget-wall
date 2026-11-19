import { useCallback, useEffect, useState } from 'react';
import { reviewNow } from '../../ui/reviewClock';
import { useSignalStore } from '../../signals/store';
import { MODE_STORAGE_KEY, parseHeld, pickMode, type PageMode } from '../modes';
import { startTakes } from '../takes';
import { useOnAirLoad } from '../useOnAirLoad';
import { useNow } from '../useNow';
import { useLivePolling, useYtLive } from '../ytliveStore';
import { LivePage } from './LivePage';
import { ModesRow } from './ModesRow';
import { PresentingPage } from './PresentingPage';
import { RecordingPage } from './RecordingPage';

function readHeld(): PageMode | null {
  try {
    return parseHeld(window.localStorage.getItem(MODE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeHeld(held: PageMode | null): void {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, JSON.stringify({ held }));
  } catch {
    // Not kept across a reload this time; the hold still works.
  }
}

/** A 90 character reason, for the one line rule (`?whylong=1`, development review only). */
const WHY_LONG = 'the wall picked this page because a recorder, a broadcast and a call are all on at the same time';

/**
 * The new On Air frame, behind `?onair=v2` in development only: the modes row on every page, and a page
 * for Live, Recording and Presenting. The page for nothing on air is empty below the row until its pull request.
 */
export function OnAir2() {
  const real = useNow();
  // A review still freezes the wall's moment; everything else uses the clock.
  const now = reviewNow ? reviewNow() : real;
  useOnAirLoad(real);
  // The take store follows the recorder only while this frame is open (strict mode starts, stops and starts it again).
  useEffect(() => startTakes(), []);
  // YouTube's status is read only while this frame shows and the page is awake.
  useLivePolling();
  const status = useYtLive((s) => s.status);
  const known = useSignalStore((s) => s.known);
  const recording = useSignalStore((s) => s.recording);
  const call = useSignalStore((s) => s.call);
  const browserAv = useSignalStore((s) => s.browserAv);
  const [held, setHeld] = useState<PageMode | null>(readHeld);
  const hold = useCallback((m: PageMode | null) => {
    setHeld(m);
    writeHeld(m);
  }, []);
  const pick = pickMode({ known, recording, call, browserAv, live: status ? { state: status.state, scheduledAt: status.scheduledAt } : null, held, now });
  const why = new URLSearchParams(window.location.search).get('whylong') === '1' ? WHY_LONG : pick.why;
  return (
    <section className="oa2" data-place="onair" data-mode={pick.mode} data-held={held ? 'true' : 'false'} aria-label="On air">
      <ModesRow pick={pick} held={held} why={why} onHold={hold} onAuto={() => hold(null)} />
      {pick.mode === 'live' && <LivePage now={now} />}
      {pick.mode === 'rec' && <RecordingPage now={now} />}
      {pick.mode === 'meet' && <PresentingPage now={now} />}
    </section>
  );
}

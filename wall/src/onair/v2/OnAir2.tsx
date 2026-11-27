import { useCallback, useEffect, useRef, useState } from 'react';
import { reviewNow } from '../../ui/reviewClock';
import { useSignalStore } from '../../signals/store';
import { MODE_STORAGE_KEY, parseHeld, pickMode, type PageMode } from '../modes';
import { startTakes } from '../takes';
import { useOnAirLoad } from '../useOnAirLoad';
import { useNow } from '../useNow';
import { useLivePolling, useYtLive } from '../ytliveStore';
import { readLast, writeLast, type LastOnAir } from '../lastOnAir';
import { useOnAirStore } from '../store';
import { IdlePage } from './IdlePage';
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

/** A reason longer than any the wall gives, for the never cut rule (`?whylong=1`, development review only). */
const WHY_LONG = 'the wall cannot read the camera and the mic';
/** Three lines of reason (`?whylong=3`, development review only): the row grows to hold it. */
const WHY_THREE = 'the wall cannot read the camera and mic, so it waits';

/**
 * On Air: the modes row on every page, and a page for Live, Recording, Presenting and nothing on air.
 * When a page that something was on for gives way to the idle page, what it was is kept for "Last time on air".
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
  // The idle page's record: when a page ends, how long it ran and how many marks the day holds.
  const [last, setLast] = useState<LastOnAir | null>(readLast);
  const running = useRef<{ mode: PageMode; since: number } | null>(null);
  const mode = pick.mode;
  useEffect(() => {
    const was = running.current;
    if (mode !== 'none') {
      if (!was || was.mode !== mode) running.current = { mode, since: Date.now() };
      return;
    }
    if (!was) return;
    running.current = null;
    const rec: LastOnAir = { endedAt: Date.now(), mode: was.mode, lengthMs: Math.max(0, Date.now() - was.since), marks: useOnAirStore.getState().marks?.today ?? 0 };
    writeLast(rec);
    setLast(rec);
  }, [mode]);
  const why = new URLSearchParams(window.location.search).get('whylong') === '3' ? WHY_THREE : new URLSearchParams(window.location.search).get('whylong') === '1' ? WHY_LONG : pick.why;
  return (
    <section className="oa2" data-place="onair" data-mode={pick.mode} data-held={held ? 'true' : 'false'} aria-label="On air">
      <ModesRow pick={pick} held={held} why={why} onHold={hold} onAuto={() => hold(null)} />
      {pick.mode === 'none' && <IdlePage now={now} last={last} onHold={hold} />}
      {pick.mode === 'live' && <LivePage now={now} />}
      {pick.mode === 'rec' && <RecordingPage now={now} />}
      {pick.mode === 'meet' && <PresentingPage now={now} />}
    </section>
  );
}

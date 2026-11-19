import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { IconX } from '@tabler/icons-react';
import { LOOK_GROUPS, LOOKS, lookFor, type LookId, type LookSettings } from './looks';
import { useWatchStore } from './store';
import { tip } from '../../ui/HoverTip';
import { LINES_TITLE, LinesPanel } from './LinesPanel';
import { LookTunePanel } from './LookTunePanel';

/** A small drawing of each look for its tile, as the approved settings sheet draws them. */
function LookPicture({ look }: { look: LookId }) {
  return (
    <i className={`w-pic ${look}`} aria-hidden="true">
      <b />
    </i>
  );
}

/** With a look per kind the foot says whose settings these are (the look's, never the kind's). */
const KIND_FOOT = 'A look keeps its own settings, whatever kind of video plays in it. Changes show at once.';
/**
 * Arrow keys across the looks of one radiogroup: Left and Up the previous, Right and Down the
 * next (wrapping), Home and End the first and last. The arrow selects as well as moves the
 * focus, as a radiogroup does; only the chosen look is in the Tab order (`tabIndex`).
 */
function lookKeys(value: LookId, onPick: (l: LookId) => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    const n = LOOKS.length;
    const i = Math.max(0, LOOKS.findIndex((l) => l.id === value));
    const to = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i + n - 1) % n : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    onPick(LOOKS[to].id);
    e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[to]?.focus();
  };
}

function Choice({ value, onPick, label }: { value: LookId; onPick: (l: LookId) => void; label: string }) {
  return (
    <div className="w-seg" role="radiogroup" aria-label={label} onKeyDown={lookKeys(value, onPick)}>
      {LOOKS.map((l) => (
        <button key={l.id} type="button" role="radio" aria-checked={value === l.id} tabIndex={value === l.id ? 0 : -1} className={value === l.id ? 'on' : ''} title={l.hint} onClick={() => onPick(l.id)}>
          {l.name}
        </button>
      ))}
    </div>
  );
}

/**
 * How video is shown: one look for everything (picture tiles) or one per kind (videos and
 * playlists, live streams, Twitch). It sits over the right wing, as the approved drawing has
 * it, and closes on its cross, Escape, a click outside it or the gear. The choice is kept in
 * local storage (`wall2-watch-look`) and checked on read.
 */
export function WatchSheet({ initial = 'looks' }: { initial?: 'looks' | 'lines' }) {
  // lines controls: a "Looks | Lines" switch at the top; Listen opens the sheet on Lines.
  const [page, setPage] = useState<'looks' | 'lines'>(initial);
  const title = page === 'lines' ? LINES_TITLE : 'How video is shown';
  const looks = useWatchStore((s) => s.looks);
  const saved = useWatchStore((s) => s.saved);
  const playing = useWatchStore((s) => s.playing);
  // With a look per kind, which look the settings below are for (the one playing now, else the first kind's).
  const [tuned, setTuned] = useState<LookId | null>(null);
  const tuneLook: LookId = looks.mode === 'one' ? looks.all : tuned ?? (playing ? lookFor(looks, playing.kind) : looks.video);
  const ref = useRef<HTMLDivElement>(null);
  const set = (next: Partial<LookSettings>) => useWatchStore.getState().setLooks({ ...looks, ...next });
  const close = () => useWatchStore.getState().setSheet(false);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') useWatchStore.getState().setSheet(false);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || ref.current?.contains(t) || t.closest?.('.w-gear')) return;
      useWatchStore.getState().setSheet(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, []);

  const yt = saved.filter((i) => i.kind !== 'twitch').length;
  const tw = saved.length - yt;
  return (
    <div className={`w-sheet${page === 'lines' ? ' ln-sheet' : ' w-tune'}`} role="dialog" aria-label={title} ref={ref} tabIndex={-1}>
      <button type="button" className="w-x" aria-label="Close" title="Close" onClick={close}>
        <IconX size={22} aria-hidden="true" />
      </button>
      <div className="u-k">{title}</div>
      <div className="w-seg ln-pages" role="tablist" aria-label="Looks or lines">
        <button type="button" role="tab" aria-selected={page === 'looks'} className={page === 'looks' ? 'on' : ''} {...tip('How a video is shown on the wall')} onClick={() => setPage('looks')}>
          Looks
        </button>
        <button type="button" role="tab" aria-selected={page === 'lines'} className={page === 'lines' ? 'on' : ''} {...tip('How the music lines along the horizon move')} onClick={() => setPage('lines')}>
          Lines
        </button>
      </div>
      {page === 'lines' ? <LinesPanel /> : <>
      <div className="w-seg w-mode" role="radiogroup" aria-label="The same look for all, or each source its own">
        <button type="button" role="radio" aria-checked={looks.mode === 'one'} className={looks.mode === 'one' ? 'on' : ''} title="Every video, live stream and Twitch channel plays in the same look" onClick={() => set({ mode: 'one' })}>
          Same for all
        </button>
        <button type="button" role="radio" aria-checked={looks.mode === 'kind'} className={looks.mode === 'kind' ? 'on' : ''} title="Pick a look for each source: videos and playlists, live streams, Twitch" onClick={() => set({ mode: 'kind' })}>
          Each source its own
        </button>
      </div>
      {looks.mode === 'one' ? (
        <div className="w-one">
          <div className="w-tiles" role="radiogroup" aria-label="Look for everything" onKeyDown={lookKeys(looks.all, (l) => set({ all: l }))}>
          {LOOKS.map((l) => (
            <button key={l.id} type="button" role="radio" aria-checked={looks.all === l.id} tabIndex={looks.all === l.id ? 0 : -1} className={`w-tile${looks.all === l.id ? ' on' : ''}`} title={l.hint} onClick={() => set({ all: l.id })}>
              <LookPicture look={l.id} />
              {l.name}
            </button>
          ))}
          </div>
          <p className="w-hint">{LOOKS.find((l) => l.id === looks.all)?.hint}</p>
        </div>
      ) : (
        <div className="w-kinds">
          {LOOK_GROUPS.map((g) => (
            <div className="w-srow" key={g.id}>
              <span>{g.name}</span>
              <Choice value={looks[g.id]} label={`Look for ${g.name.toLowerCase()}`} onPick={(l) => set({ [g.id]: l })} />
            </div>
          ))}
          <div className="w-srow wk-pick">
            <span>Settings for</span>
            <Choice value={tuneLook} label="Look to adjust" onPick={setTuned} />
          </div>
        </div>
      )}
      <LookTunePanel look={tuneLook} foot={looks.mode === 'kind' ? KIND_FOOT : undefined} />
      <div className="w-sfoot">
        <span className="w-count">
          Saved here: {yt} YouTube, {tw} Twitch
        </span>
      </div>
      </>}
    </div>
  );
}

import { useEffect, useRef } from 'react';
import { IconX } from '@tabler/icons-react';
import { LOOK_GROUPS, LOOKS, type LookId, type LookSettings } from './looks';
import { useWatchStore } from './store';

/** A small drawing of each look for its tile, as the approved settings sheet draws them. */
function LookPicture({ look }: { look: LookId }) {
  return (
    <i className={`w-pic ${look}`} aria-hidden="true">
      <b />
    </i>
  );
}

function Choice({ value, onPick, label }: { value: LookId; onPick: (l: LookId) => void; label: string }) {
  return (
    <div className="w-seg" role="radiogroup" aria-label={label}>
      {LOOKS.map((l) => (
        <button key={l.id} type="button" role="radio" aria-checked={value === l.id} className={value === l.id ? 'on' : ''} title={l.hint} onClick={() => onPick(l.id)}>
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
export function WatchSheet() {
  const looks = useWatchStore((s) => s.looks);
  const saved = useWatchStore((s) => s.saved);
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
    <div className="w-sheet" role="dialog" aria-label="How video is shown" ref={ref} tabIndex={-1}>
      <button type="button" className="w-x" aria-label="Close" title="Close" onClick={close}>
        <IconX size={22} aria-hidden="true" />
      </button>
      <div className="u-k">How video is shown</div>
      <div className="w-seg w-mode" role="radiogroup" aria-label="One look or one per kind">
        <button type="button" role="radio" aria-checked={looks.mode === 'one'} className={looks.mode === 'one' ? 'on' : ''} title="Every video plays in the same look" onClick={() => set({ mode: 'one' })}>
          One look for everything
        </button>
        <button type="button" role="radio" aria-checked={looks.mode === 'kind'} className={looks.mode === 'kind' ? 'on' : ''} title="Pick a look for each kind of video" onClick={() => set({ mode: 'kind' })}>
          A look for each kind
        </button>
      </div>
      {looks.mode === 'one' ? (
        <div className="w-tiles" role="radiogroup" aria-label="Look for everything">
          {LOOKS.map((l) => (
            <button key={l.id} type="button" role="radio" aria-checked={looks.all === l.id} className={`w-tile${looks.all === l.id ? ' on' : ''}`} title={l.hint} onClick={() => set({ all: l.id })}>
              <LookPicture look={l.id} />
              {l.name}
            </button>
          ))}
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
        </div>
      )}
      <div className="w-sfoot">
        <span>The Look button on a playing video steps to the next look.</span>
        <span className="w-count">
          Saved here: {yt} YouTube, {tw} Twitch
        </span>
      </div>
    </div>
  );
}

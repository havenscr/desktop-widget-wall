import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { IconBrandTwitch, IconBrandYoutube, IconBroadcast, IconCheck, IconPencil, IconPlaylist, IconX } from '@tabler/icons-react';
import { useSkyKeepClear } from '../../horizon/sky';
import { useSignalStore } from '../../signals/store';
import { kindName, refKey, type WatchKind } from './links';
import { MAX_LABEL, MAX_SAVED, type SavedItem } from './saved';
import { useWatchStore } from './store';

/** How long a refusal line stays under the field. */
export const PASTE_ERROR_MS = 6000;

export function KindIcon({ kind, size = 22 }: { kind: WatchKind; size?: number }) {
  switch (kind) {
    case 'twitch':
      return <IconBrandTwitch size={size} aria-hidden="true" />;
    case 'live':
      return <IconBroadcast size={size} aria-hidden="true" />;
    case 'playlist':
      return <IconPlaylist size={size} aria-hidden="true" />;
    default:
      return <IconBrandYoutube size={size} aria-hidden="true" />;
  }
}

function NameField({ item }: { item: SavedItem }) {
  const [text, setText] = useState(item.label);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const key = refKey(item);
  const done = () => useWatchStore.getState().rename(key, text);
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      done();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      useWatchStore.getState().setEditing(null);
    }
  };
  return (
    <div className="w-row editing">
      <span className="w-kind" title={kindName(item.kind)}>
        <KindIcon kind={item.kind} />
      </span>
      <input
        ref={ref}
        className="w-name-in"
        value={text}
        maxLength={MAX_LABEL}
        aria-label={`Name for this ${kindName(item.kind).toLowerCase()}`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
      />
      <button type="button" className="w-mini" title="Save the name" aria-label="Save the name" onClick={done}>
        <IconCheck size={20} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * True while the list has rows below what shows (so it can fade at the bottom); read on
 * scroll, on resize and whenever the rows change.
 */
function useMoreBelow(count: number) {
  const ref = useRef<HTMLUListElement>(null);
  const [more, setMore] = useState(false);
  const check = useCallback(() => {
    const el = ref.current;
    setMore(!!el && el.scrollHeight - el.scrollTop - el.clientHeight > 2);
  }, []);
  useEffect(() => {
    check();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [check, count]);
  return { ref, more, check };
}

/**
 * The Watch card (right wing, above Room): the saved list and one field, "Paste a YouTube or
 * Twitch link". A row plays on click; its pencil renames it and its cross removes it (32 px
 * targets, each with a tooltip). Empty, it explains itself and the field fills the card; past
 * the rows that fit, the list scrolls inside the card.
 */
export function WatchCard() {
  const saved = useWatchStore((s) => s.saved);
  const playing = useWatchStore((s) => s.playing);
  const editing = useWatchStore((s) => s.editing);
  const inCall = useSignalStore((s) => s.call !== null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const errTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(errTimer.current), []);
  const playingKey = playing ? refKey(playing) : null;
  const list = useMoreBelow(saved.length);
  const st = useWatchStore.getState();
  // sky layers: the moon keeps clear of this card.
  const [card, setCard] = useState<HTMLElement | null>(null);
  useSkyKeepClear('watch-card', card);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const refused = st.addLink(text);
    clearTimeout(errTimer.current);
    if (refused) {
      setError(refused);
      errTimer.current = setTimeout(() => setError(null), PASTE_ERROR_MS);
    } else {
      setError(null);
      setText('');
    }
  };

  const field = (
    <form className="w-field" onSubmit={submit}>
      <input
        className="w-paste"
        value={text}
        placeholder="Paste a YouTube or Twitch link"
        aria-label="Paste a YouTube or Twitch link"
        spellCheck={false}
        autoComplete="off"
        maxLength={4096}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" className="w-add" disabled={!text.trim()} title="Save this link to the list">
        Save
      </button>
    </form>
  );
  const errLine = error ? (
    <div className="w-err" role="alert">
      {error}
    </div>
  ) : null;

  if (saved.length === 0) {
    return (
      <section ref={setCard} className="u-card w-card empty" aria-label="Watch list">
        <div className="u-card-head">
          <span className="u-k">Watch list</span>
        </div>
        <p className="w-explain">Save the videos, playlists, live streams and Twitch channels you watch here. They stay on this wall; one click plays them in the sky.</p>
        <p className="w-forms">youtu.be/… · youtube.com/watch?v=… · /live/… · /playlist?list=… · twitch.tv/…</p>
        {field}
        {errLine}
      </section>
    );
  }

  return (
    <section ref={setCard} className="u-card w-card" aria-label="Watch list">
      <div className="u-card-head">
        <span className="u-k">Watch list</span>
        <span className="u-xs" title={`At most ${MAX_SAVED}`}>
          {saved.length} saved
        </span>
      </div>
      <ul className={`w-list${list.more ? ' more' : ''}`} ref={list.ref} onScroll={list.check}>
        {saved.map((item) => {
          const key = refKey(item);
          if (editing === key)
            return (
              <li key={key}>
                <NameField item={item} />
              </li>
            );
          const on = playingKey === key;
          return (
            <li key={key}>
              <div className={`w-row${on ? ' on' : ''}`}>
                <button
                  type="button"
                  className="w-play"
                  disabled={inCall && !on}
                  title={inCall && !on ? 'Video waits until the call ends' : on ? `${item.label} is on` : `Play ${item.label} (${kindName(item.kind).toLowerCase()})`}
                  aria-pressed={on}
                  onClick={() => (on ? undefined : st.play(item))}
                >
                  <span className="w-kind">
                    <KindIcon kind={item.kind} />
                  </span>
                  <span className="w-label u-ell">{item.label}</span>
                  {on ? <span className="w-on">On</span> : null}
                </button>
                <button type="button" className="w-mini" title={`Rename ${item.label}`} aria-label={`Rename ${item.label}`} onClick={() => st.setEditing(key)}>
                  <IconPencil size={18} aria-hidden="true" />
                </button>
                <button type="button" className="w-mini" title={`Remove ${item.label} from the list`} aria-label={`Remove ${item.label}`} onClick={() => st.remove(key)}>
                  <IconX size={18} aria-hidden="true" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {field}
      {errLine}
    </section>
  );
}

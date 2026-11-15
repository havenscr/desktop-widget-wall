import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { IconBrandTwitch, IconBrandYoutube, IconBroadcast, IconCheck, IconPencil, IconPlaylist, IconPlaylistAdd, IconPlus, IconX } from '@tabler/icons-react';
import { useSkyKeepClear } from '../../horizon/sky';
import { tip } from '../../ui/HoverTip';
import { useSignalStore } from '../../signals/store';
import { kindName, parseLink, refKey, type WatchKind, type WatchRef } from './links';
import { ADD_ERRORS, MAX_LABEL, MAX_SAVED, type SavedItem } from './saved';
import { useWatchStore } from './store';
import { AddMenu } from './AddToPlaylist';
import { OwnEditor } from './OwnEditor';
import { OwnFollow } from './OwnFollow';
import { countText, DeleteAsk, OwnTile, savedVideo } from './OwnParts';
import { useOwnLists } from './ownLists';
import { playOwn, setFollow, useOwnView, type OwnView } from './ownPlay';

/** How long a refusal line stays under the field. */
export const PASTE_ERROR_MS = 6000;
/** How long the offer of a second choice (the playlist a pasted video link also names) stays under the field. */
export const OFFER_MS = 20_000;

export function KindIcon({ kind, size = 22 }: { kind: WatchKind; size?: number }) {
  switch (kind) {
    case 'twitch':
      return <IconBrandTwitch size={size} aria-hidden="true" />;
    case 'live':
      return <IconBroadcast size={size} aria-hidden="true" />;
    case 'playlist':
      return <IconPlaylist size={size} aria-hidden="true" />;
    case 'own':
      return <OwnTile size={26} />;
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

/** The draft row of a new playlist: its tile and a name field holding "My playlist", selected. Enter makes it; Escape drops it. */
function DraftRow({ onDone, onError }: { onDone: () => void; onError: (line: string) => void }) {
  const [text, setText] = useState('My playlist');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const make = () => {
    const made = useOwnLists.getState().create(text);
    if (!made.ok) {
      onError(made.error);
      onDone();
      return;
    }
    onDone();
    useOwnLists.getState().setOpen(made.id);
  };
  return (
    <div className="w-row editing own-draft">
      <span className="w-kind">
        <OwnTile size={26} />
      </span>
      <input
        ref={ref}
        className="w-name-in"
        value={text}
        maxLength={MAX_LABEL}
        aria-label="Name for the new playlist"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            make();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onDone();
          }
        }}
      />
      <button type="button" className="w-mini cy" title="Make the playlist" aria-label="Make the playlist" onClick={make}>
        <IconCheck size={20} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * The list view of the Watch card: the saved list and one field, "Paste a YouTube or Twitch link". A row plays on
 * click; its pencil renames it and its cross removes it (32 px targets, each with a tooltip). A playlist the owner
 * made shows its tile and its count, and plays from its first video; a connected YouTube playlist shows the word
 * "YouTube". Empty, it explains itself and the field fills the card; past the rows that fit, the list scrolls.
 */
function WatchList({ empty, draft, setDraft, host, own }: { empty: boolean; draft: boolean; setDraft: (on: boolean) => void; host: HTMLElement | null; own: OwnView | null }) {
  const saved = useWatchStore((s) => s.saved);
  const lists = useOwnLists((s) => s.lists);
  const playing = useWatchStore((s) => s.playing);
  const editing = useWatchStore((s) => s.editing);
  const inCall = useSignalStore((s) => s.call !== null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ key: string; anchor: HTMLElement } | null>(null);
  // The playlist a pasted video link also names, offered once (`known`: the video was in the list already); kept here, never saved.
  const [offer, setOffer] = useState<{ ref: WatchRef; known: boolean } | null>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const errTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const offerTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(
    () => () => {
      clearTimeout(errTimer.current);
      clearTimeout(offerTimer.current);
    },
    [],
  );
  const dropOffer = () => {
    clearTimeout(offerTimer.current);
    setOffer(null);
  };
  const showError = (line: string) => {
    setError(line);
    clearTimeout(errTimer.current);
    errTimer.current = setTimeout(() => setError(null), PASTE_ERROR_MS);
  };
  const playingKey = playing ? refKey(playing) : null;
  const list = useMoreBelow(saved.length + (draft ? 1 : 0));
  const st = useWatchStore.getState();
  // Another row's click drops a draft that was never made.
  const other = () => {
    if (draft) setDraft(false);
    if (asking) setAsking(null);
  };

  const alreadySaved = (ref: WatchRef) => useWatchStore.getState().saved.some((i) => refKey(i) === refKey(ref));
  const showOffer = (ref: WatchRef, known: boolean) => {
    setOffer({ ref, known });
    offerTimer.current = setTimeout(() => setOffer(null), OFFER_MS);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseLink(text);
    const refused = st.addLink(text);
    clearTimeout(errTimer.current);
    dropOffer();
    if (refused) {
      showError(refused);
      // A video already in the list can still bring a playlist that is not: the refusal stays as it is, the offer follows it.
      if (refused === ADD_ERRORS.dup && parsed.ok && parsed.alsoList && !alreadySaved(parsed.alsoList)) showOffer(parsed.alsoList, true);
    } else {
      setError(null);
      setText('');
      if (parsed.ok && parsed.alsoList && !alreadySaved(parsed.alsoList)) showOffer(parsed.alsoList, false);
    }
  };

  const savePlaylist = () => {
    if (!offer) return;
    // The video's name field, if still open, stays open: only the list changes.
    const refused = st.addRef(offer.ref, false);
    dropOffer();
    if (refused) showError(refused);
    // The button goes with the offer: the focus moves on to the paste field rather than falling to the page.
    fieldRef.current?.focus();
  };

  const field = (
    <form className="w-field" onSubmit={submit}>
      <input
        ref={fieldRef}
        className="w-paste"
        value={text}
        placeholder="Paste a YouTube or Twitch link"
        aria-label="Paste a YouTube or Twitch link"
        spellCheck={false}
        autoComplete="off"
        maxLength={4096}
        onChange={(e) => {
          setText(e.target.value);
          dropOffer();
        }}
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

  const offerLine = offer ? (
    <div className="w-offer" role="status">
      <span>{offer.known ? 'The link also names a playlist.' : 'Saved the video. The link also names a playlist.'}</span>
      <button type="button" {...tip('Adds that YouTube playlist to the list as its own entry')} onClick={savePlaylist}>
        Save the playlist too
      </button>
    </div>
  ) : null;

  const full = saved.length >= MAX_SAVED;
  const newButton = (
    <button
      type="button"
      className="w-new"
      disabled={full}
      {...tip(full ? ADD_ERRORS.full : 'Make a playlist of your own on this wall')}
      onClick={() => {
        setAsking(null);
        setDraft(true);
      }}
    >
      <IconPlus size={16} aria-hidden="true" />
      New playlist
    </button>
  );

  if (empty) {
    return (
      <>
        <div className="u-card-head">
          <span className="u-k">Watch list</span>
          {newButton}
        </div>
        <p className="w-explain">Save the videos, playlists, live streams and Twitch channels you watch here. They stay on this wall; one click plays them in the sky.</p>
        <p className="w-forms">youtu.be/… · youtube.com/watch?v=… · /live/… · /playlist?list=… · twitch.tv/…</p>
        {field}
        {errLine}
        {offerLine}
      </>
    );
  }

  const menuItem = menu ? saved.find((i) => refKey(i) === menu.key) : undefined;
  return (
    <>
      <div className="u-card-head">
        <span className="u-k">Watch list</span>
        <span className="u-xs" title={`At most ${MAX_SAVED}`}>
          {saved.length} saved
        </span>
        {newButton}
      </div>
      <ul className={`w-list${list.more ? ' more' : ''}`} ref={list.ref} onScroll={list.check}>
        {draft ? (
          <li key="draft">
            <DraftRow onDone={() => setDraft(false)} onError={showError} />
          </li>
        ) : null}
        {saved.map((item) => {
          const key = refKey(item);
          if (editing === key)
            return (
              <li key={key}>
                <NameField item={item} />
              </li>
            );
          if (item.kind === 'own') {
            const count = lists[item.id]?.items.length ?? 0;
            const here = own !== null && own.listId === item.id;
            if (asking === key)
              return (
                <li key={key}>
                  <div className="w-row">
                    <DeleteAsk name={item.label} count={count} onDelete={() => (setAsking(null), useOwnLists.getState().deleteList(item.id))} onKeep={() => setAsking(null)} />
                  </div>
                </li>
              );
            return (
              <li key={key}>
                <div className={`w-row own-row${here ? ' on' : ''}`}>
                  <button
                    type="button"
                    className="w-play"
                    disabled={inCall && !here}
                    title={inCall && !here ? 'Video waits until the call ends' : here ? `${item.label} is playing. Show it.` : count === 0 ? 'Empty: click to add videos' : `Play ${item.label} (your playlist)`}
                    aria-pressed={here}
                    onClick={() => {
                      other();
                      if (here) setFollow(true);
                      else if (count === 0) useOwnLists.getState().setOpen(item.id);
                      else playOwn(item.id);
                    }}
                  >
                    <span className="w-kind">
                      <KindIcon kind="own" />
                    </span>
                    <span className="w-label u-ell">{item.label}</span>
                    {here ? (
                      <span className="own-pill" title={`Video ${own!.place} of ${own!.count}`}>
                        {own!.place} of {own!.count}
                      </span>
                    ) : (
                      <span className="w-count">{countText(count)}</span>
                    )}
                  </button>
                  <button type="button" className="w-mini" title={`Edit ${item.label}`} aria-label={`Edit ${item.label}`} onClick={() => (other(), useOwnLists.getState().setOpen(item.id))}>
                    <IconPencil size={18} aria-hidden="true" />
                  </button>
                  <button type="button" className="w-mini" title={`Delete ${item.label}`} aria-label={`Delete ${item.label}`} onClick={() => (other(), setAsking(key))}>
                    <IconX size={18} aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          }
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
                  onClick={() => (other(), on ? undefined : st.play(item))}
                >
                  <span className="w-kind">
                    <KindIcon kind={item.kind} />
                  </span>
                  <span className="w-label u-ell">{item.label}</span>
                  {item.kind === 'playlist' ? <span className="w-count">YouTube</span> : null}
                  {on ? <span className="w-on">On</span> : null}
                </button>
                {item.kind === 'video' ? (
                  <button
                    type="button"
                    className="w-mini w-addrow"
                    aria-label={`Add ${item.label} to a playlist`}
                    aria-haspopup="menu"
                    aria-expanded={menu?.key === key}
                    title="Add to a playlist"
                    onClick={(e) => {
                      other();
                      const anchor = e.currentTarget;
                      setMenu(menu?.key === key ? null : { key, anchor });
                    }}
                  >
                    <IconPlaylistAdd size={18} aria-hidden="true" />
                  </button>
                ) : null}
                <button type="button" className="w-mini" title={`Rename ${item.label}`} aria-label={`Rename ${item.label}`} onClick={() => (other(), st.setEditing(key))}>
                  <IconPencil size={18} aria-hidden="true" />
                </button>
                <button type="button" className="w-mini" title={`Remove ${item.label} from the list`} aria-label={`Remove ${item.label}`} onClick={() => (other(), st.remove(key))}>
                  <IconX size={18} aria-hidden="true" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {field}
      {errLine}
      {offerLine}
      {menu && menuItem && host ? <AddMenu video={savedVideo(menuItem)} anchor={menu.anchor} host={host} onClose={() => setMenu(null)} /> : null}
    </>
  );
}

/**
 * The Watch card (right wing, above Room): the list view, or, while a playlist of the owner's own is open, the editor
 * (the card grows down to just above the ground), or, while one plays and the card follows it, the playing playlist.
 */
export function WatchCard() {
  const saved = useWatchStore((s) => s.saved);
  const open = useOwnLists((s) => s.open);
  const own = useOwnView();
  const [draft, setDraft] = useState(false);
  // sky layers: the moon keeps clear of this card (its real box, which grows while the editor is open).
  const [card, setCard] = useState<HTMLElement | null>(null);
  useSkyKeepClear('watch-card', card);
  const mode = open ? 'edit' : own?.follow ? 'follow' : 'list';
  const empty = mode === 'list' && saved.length === 0 && !draft;
  return (
    <section ref={setCard} className={`u-card w-card${empty ? ' empty' : ''}${mode === 'edit' ? ' own-tall' : ''}`} aria-label="Watch list">
      {mode === 'edit' ? <OwnEditor id={open!} /> : mode === 'follow' ? <OwnFollow view={own!} /> : <WatchList empty={empty} draft={draft} setDraft={setDraft} host={card} own={own} />}
    </section>
  );
}

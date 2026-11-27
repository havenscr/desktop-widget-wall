import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { IconBrandTwitch, IconBrandYoutube, IconBroadcast, IconCheck, IconPencil, IconPlaylist, IconPlaylistAdd, IconPlus, IconSearch, IconX } from '@tabler/icons-react';
import { useSkyKeepClear } from '../../horizon/sky';
import { FitTitle } from '../../ui/FitTitle';
import { tip } from '../../ui/HoverTip';
import { useSignalStore } from '../../signals/store';
import { defaultLabel, kindName, parseLink, refKey, type WatchKind, type WatchRef } from './links';
import { ADD_ERRORS, MAX_LABEL, MAX_SAVED, type SavedItem } from './saved';
import { useWatchStore } from './store';
import { AddMenu } from './AddToPlaylist';
import { OwnEditor } from './OwnEditor';
import { OwnFollow } from './OwnFollow';
import { RowMenu } from './RowMenu';
import { linkText } from './rowMenuModel';
import { openInBrowser } from './openInBrowser';
import { PASTE_ERROR_MS } from './ownShared';
import { countText, DeleteAsk, OwnTile, savedVideo } from './OwnParts';
import { askDetails } from './ownDetails';
import { useOwnLists } from './ownLists';
import { CARD_COLLAPSE_MS, useListGrow } from './useListGrow';
import { restBridge, restZone, useWatchRest } from './rest';
import { playOwn, setFollow, useOwnView, type OwnView } from './ownPlay';
import { closeWatchSearch, isLinkText, resetWatchSearch, runWatchSearch, useWatchSearch, wordsProblem } from './searchStore';
import { WatchResults } from './WatchSearch';
import { ListChips } from './ListChips';
import { ALL_CHIP, chipCounts, chipExists, countLine, filterItems, sortItems, wordsOf } from './listView';
import { useListView } from './listViewStore';

export { PASTE_ERROR_MS };
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

/** The row of "Edit link": the item's address in a field; Enter saves it, Escape keeps the old one, a refused link shows its reason under the row. */
function LinkField({ item, onDone }: { item: SavedItem; onDone: (key: string) => void }) {
  const [text, setText] = useState(linkText(item));
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const done = () => {
    const at = useWatchStore.getState().saved.findIndex((i) => refKey(i) === refKey(item));
    const refused = useWatchStore.getState().relink(refKey(item), text);
    if (refused) setError(refused);
    else {
      const now = useWatchStore.getState().saved[at];
      onDone(now ? refKey(now) : refKey(item));
    }
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      done();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onDone(refKey(item));
    }
  };
  return (
    <div className="w-link-row">
      <div className="w-row editing">
        <span className="w-kind" title={kindName(item.kind)}>
          <KindIcon kind={item.kind} />
        </span>
        <input
          ref={ref}
          className="w-name-in"
          value={text}
          maxLength={4096}
          spellCheck={false}
          autoComplete="off"
          aria-label={`Link for ${item.label}`}
          aria-invalid={error ? true : undefined}
          onChange={(e) => (setText(e.target.value), setError(null))}
          onKeyDown={onKey}
        />
        <button type="button" className="w-mini" title="Save the link" aria-label="Save the link" onClick={done}>
          <IconCheck size={20} aria-hidden="true" />
        </button>
      </div>
      {error ? (
        <div className="w-err" role="alert">
          {error}
        </div>
      ) : null}
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
  const searching = useWatchSearch((s) => s.open);
  const resetNonce = useWatchSearch((s) => s.resetNonce);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ key: string; anchor: HTMLElement } | null>(null);
  // The row menu (right-click or Shift+F10), and the row whose link is being edited.
  const [rowMenu, setRowMenu] = useState<{ key: string; anchor: HTMLElement; byKeyboard: boolean } | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  // The playlist a pasted video link also names, offered once (`known`: the video was in the list already); kept here, never saved.
  const [offer, setOffer] = useState<{ ref: WatchRef; known: boolean } | null>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  // The card is in use while its field has text, a name is being typed, the new playlist form or a question or a menu is open: it never rests then.
  const held = text.trim() !== '' || editing !== null || draft || asking !== null || menu !== null || rowMenu !== null || linking !== null || searching;
  useEffect(() => {
    useWatchRest.setState({ cardHeld: held });
    // A field that went away with the focus in it sends no blur: the card's focus hold is let go when it was the last thing holding it.
    if (!held && !(host && document.activeElement && host.contains(document.activeElement))) restBridge.current?.focus('card', false);
    return () => useWatchRest.setState({ cardHeld: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held]);
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
  // The chip and sort in force, and the words typed in the field (a link is never a filter). A chip whose items are all gone means All.
  const view = useListView();
  const counts = useMemo(() => chipCounts(saved), [saved]);
  const chip = chipExists(counts, view.chip) ? view.chip : ALL_CHIP;
  useEffect(() => {
    // A chip that fell back to All is forgotten, so a tag made again later does not quietly filter the list.
    if (view.chip !== chip) view.setChip(chip);
  }, [view, chip]);
  const filterText = isLinkText(text) ? '' : text;
  const shown = useMemo(() => sortItems(filterItems(saved, chip, filterText, editing), view.sort), [saved, chip, filterText, editing, view.sort]);
  const narrowed = chip !== ALL_CHIP || wordsOf(filterText).length > 0;
  const list = useMoreBelow(shown.length + (draft ? 1 : 0));
  useEffect(() => {
    // A new view of the list starts at its top.
    if (list.ref.current) list.ref.current.scrollTop = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chip, view.sort, filterText]);
  // Back on the watch list (a reset, Escape, the way back): the search box is empty. A reset also scrolls the list to its top.
  const wasSearching = useRef(searching);
  useEffect(() => {
    if (wasSearching.current && !searching) setText('');
    wasSearching.current = searching;
  }, [searching]);
  useEffect(() => {
    setText('');
    setError(null);
    if (list.ref.current) list.ref.current.scrollTop = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetNonce]);
  // While results show, a click (press and release) on bare page outside the card ends the search. Hover alone never does;
  // buttons, fields, menus and dialogs elsewhere keep their own clicks.
  useEffect(() => {
    if (!searching || !host) return;
    let armed = false;
    const bare = (t: EventTarget | null) =>
      t instanceof Element && !host.contains(t) && !t.closest('button, a, input, textarea, select, label, [role="menu"], [role="dialog"], .w-pop, .watt-menu');
    const down = (e: PointerEvent) => void (armed = e.button === 0 && bare(e.target));
    const up = (e: PointerEvent) => {
      const hit = armed && e.button === 0 && bare(e.target);
      armed = false;
      if (hit) resetWatchSearch();
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
    };
  }, [searching, host]);
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
    // Words search YouTube; a link is saved to the list.
    if (!isLinkText(text)) {
      if (text.trim()) {
        dropOffer();
        const problem = wordsProblem(text);
        if (problem) {
          showError(problem);
          return;
        }
        setError(null);
        void runWatchSearch(text);
      }
      return;
    }
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
      closeWatchSearch();
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

  const words = text.trim() !== '' && !isLinkText(text);
  const field = (
    <form className="w-field" onSubmit={submit}>
      <span className="w-fieldbox">
      <IconSearch size={20} stroke={1.8} aria-hidden="true" className="w-fieldicon" />
      <input
        ref={fieldRef}
        className="w-paste"
        value={text}
        placeholder="Search or paste a link"
        aria-label="Search or paste a link"
        {...tip('Words search YouTube. A YouTube video, playlist or live stream, or a Twitch channel saves to the list.')}
        spellCheck={false}
        autoComplete="off"
        maxLength={4096}
        onChange={(e) => {
          setText(e.target.value);
          dropOffer();
          if (e.target.value.trim() === '') closeWatchSearch();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && searching) {
            e.preventDefault();
            e.stopPropagation();
            closeWatchSearch();
          }
        }}
      />
      </span>
      <button type="submit" className="w-add" disabled={!text.trim()} title={words ? 'Search YouTube for these words (uses one of the day\'s searches)' : 'Save this link to the list'}>
        {words ? 'Search' : 'Save'}
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

  if (searching) {
    return (
      <>
        <div className="u-card-head">
          <span className="u-k">Watch list</span>
        </div>
        <WatchResults host={host} />
        {field}
        {errLine}
      </>
    );
  }

  if (empty) {
    return (
      <>
        <div className="u-card-head">
          <span className="u-k">Watch list</span>
          {newButton}
        </div>
        <p className="w-explain">Save the videos, playlists, live streams and Twitch channels you watch here. They stay on this wall; one click plays them in the sky.</p>
        {field}
        {errLine}
        {offerLine}
      </>
    );
  }

  const openRowMenu = (e: { currentTarget: HTMLElement; preventDefault: () => void }, key: string, byKeyboard: boolean) => {
    e.preventDefault();
    other();
    setMenu(null);
    setRowMenu({ key, anchor: e.currentTarget, byKeyboard });
  };
  const rowMenuItem = rowMenu ? saved.find((i) => refKey(i) === rowMenu.key) : undefined;
  const menuItem = menu ? saved.find((i) => refKey(i) === menu.key) : undefined;
  return (
    <>
      <div className="u-card-head">
        <span className="u-k">Watch list</span>
        <span className="u-xs" title={`At most ${MAX_SAVED}`}>
          {countLine(shown.length, saved.length, narrowed)}
        </span>
        {newButton}
      </div>
      {saved.length > 0 ? <ListChips counts={counts} chip={chip} sort={view.sort} onChip={view.setChip} onSort={view.setSort} /> : null}
      <ul className={`w-list${list.more ? ' more' : ''}`} ref={list.ref} onScroll={list.check}>
        {draft ? (
          <li key="draft">
            <DraftRow onDone={() => setDraft(false)} onError={showError} />
          </li>
        ) : null}
        {shown.length === 0 && !draft ? (
          <li className="w-none" role="status">
            {wordsOf(filterText).length > 0 ? 'Nothing in the list matches those words.' : 'Nothing saved under this chip.'}
          </li>
        ) : null}
        {shown.map((item) => {
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
                    <span className="w-kind" {...tip(kindName('own'))}>
                      <KindIcon kind="own" />
                    </span>
                    <FitTitle top={20} boxH={40} lh={1.1} className="w-label">
                      {item.label}
                    </FitTitle>
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
          if (linking === key)
            return (
              <li key={key} data-key={key}>
                <LinkField item={item} onDone={(next) => (setLinking(null), setTimeout(() => document.querySelector<HTMLElement>(`.w-list li[data-key="${next}"] .w-play`)?.focus(), 0))} />
              </li>
            );
          const on = playingKey === key;
          return (
            <li key={key} data-key={key}>
              <div
                className={`w-row${on ? ' on' : ''}`}
                onContextMenu={(e) => openRowMenu(e, key, false)}
                onKeyDown={(e) => {
                  if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') openRowMenu(e, key, true);
                }}
              >
                <button
                  type="button"
                  className="w-play"
                  disabled={inCall && !on}
                  title={inCall && !on ? 'Video waits until the call ends' : on ? `${item.label} is on` : `Play ${item.label} (${kindName(item.kind).toLowerCase()})`}
                  aria-pressed={on}
                  onClick={() => (other(), on ? undefined : st.play(item))}
                >
                  <span className="w-kind" {...tip(kindName(item.kind))}>
                    <KindIcon kind={item.kind} />
                  </span>
                  <FitTitle top={20} boxH={40} lh={1.1} className="w-label">
                    {item.label}
                  </FitTitle>
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
      {rowMenu && rowMenuItem && host ? (
        <RowMenu
          item={rowMenuItem}
          anchor={rowMenu.anchor}
          host={host}
          byKeyboard={rowMenu.byKeyboard}
          onEdit={() => setLinking(rowMenu.key)}
          onOpen={() => void openInBrowser(rowMenuItem).then((ok) => (ok ? undefined : showError('Could not open the browser.')))}
          onClose={(restore) => {
            const anchor = rowMenu.anchor;
            setRowMenu(null);
            if (restore) anchor.querySelector<HTMLElement>('.w-play')?.focus();
          }}
        />
      ) : null}
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
  // A saved video or live stream nobody named shows its real title as soon as YouTube's details say it (signed in only);
  // the player fills it the same way when it plays (`fillLabel` never touches a name that was typed).
  // A named video is not asked just for its length and views: that would spend YouTube quota on up to 200 videos at every load,
  // for numbers nothing shows yet. Its length and views fill when it is saved from a search, or when a name is asked for anyway.
  const unnamed = saved
    .filter((i) => (i.kind === 'video' || i.kind === 'live') && (i.label === defaultLabel(i)))
    .map((i) => i.id)
    .join(',');
  useEffect(() => {
    if (!unnamed) return;
    askDetails(unnamed.split(','), (id, info) => {
      const st = useWatchStore.getState();
      // A saved item is kind plus id: the same id may be saved as a video and as a live stream, each filled by its own key.
      for (const hit of st.saved) {
        if (hit.kind !== 'video' && hit.kind !== 'live') continue;
        if (hit.id !== id) continue;
        // Only items asked above (unnamed ones) reach this; a titled v1 video gets length and views from a search save instead, to spare YouTube quota.
        if (hit.kind === 'video') st.noteMeta(refKey(hit), { seconds: info.seconds, views: info.views });
        if (info.title) st.fillLabel(refKey(hit), info.title);
      }
    });
  }, [unnamed]);
  // Opening the Watch tab starts from the default list: no results kept from a visit before.
  useEffect(() => resetWatchSearch(), []);
  const mode = open ? 'edit' : own?.follow ? 'follow' : 'list';
  const searching = useWatchSearch((s) => s.open) && mode === 'list';
  const empty = mode === 'list' && saved.length === 0 && !draft && !searching;
  // While a video plays and the controls rest, the card rests with them (same timing); it never rests in use (see `cardHeld`)
  // or while its playlist editor or follow view is open. At rest it keeps the pointer only to notice it entering its box.
  const resting = useWatchRest((s) => s.rest && !s.cardHeld) && mode === 'list';
  const zone = restZone('card');
  const grow = useListGrow(card, mode === 'list' && !empty && !searching);
  // `closing` marks the card's shrink after it stops growing, so what fades back in beneath it (the keys row) waits for it.
  // Derived while rendering (not in an effect), so there is no frame between the card letting go and the mark.
  const [closing, setClosing] = useState(false);
  const [wasGrown, setWasGrown] = useState(grow.grown);
  if (wasGrown !== grow.grown) {
    setWasGrown(grow.grown);
    setClosing(!grow.grown);
  }
  useEffect(() => {
    if (!closing) return;
    const id = setTimeout(() => setClosing(false), CARD_COLLAPSE_MS);
    return () => clearTimeout(id);
  }, [closing]);
  return (
    <section
      ref={setCard}
      className={`u-card w-card${empty ? ' empty' : ''}${mode === 'edit' || searching ? ' own-tall' : ''}${grow.grown ? ' grown' : ''}${closing ? ' closing' : ''}`}
      style={{ ['--w-collapse' as string]: `${CARD_COLLAPSE_MS}ms` }}
      aria-label="Watch list"
      data-rest={resting ? 'true' : 'false'}
      {...zone}
      onPointerEnter={() => (zone.onPointerEnter(), grow.handlers.onPointerEnter())}
      onPointerLeave={(e) => (zone.onPointerLeave(e), grow.handlers.onPointerLeave())}
      onFocusCapture={grow.handlers.onFocusCapture}
      onBlurCapture={grow.handlers.onBlurCapture}
    >
      {mode === 'edit' ? <OwnEditor id={open!} /> : mode === 'follow' ? <OwnFollow view={own!} /> : <WatchList empty={empty} draft={draft} setDraft={setDraft} host={card} own={own} />}
    </section>
  );
}

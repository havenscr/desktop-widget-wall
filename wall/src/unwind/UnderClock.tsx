import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { IconPlus, IconVolume, IconVolumeOff, IconZzz } from '@tabler/icons-react';
import { playerName, procName, sourceKey } from '../music/players';
import { useNowPlaying } from '../music/useNowPlaying';
import { quietFocus, tip } from '../ui/HoverTip';
import { useVisible } from '../ui/useVisible';
import { clampVolume, volumePercent } from './model';
import { shownSource } from './ownSource';
import { useAppVolume } from './Volume';
import { kindName, refKey } from './watch/links';
import { PinGlyph } from './watch/PinGlyph';
import { PinMenu } from './watch/PinMenu';
import { artBackground, pinnable, resolvePins, usePins } from './watch/pins';
import type { SavedItem } from './watch/saved';
import { nextStep, sleepWords, stepSleep, useSleep } from './watch/sleep';
import { useWatchStore } from './watch/store';
import { ctlTiming } from './watch/Watch';

/** Development only: `?wrows=shown` holds the rows at full strength for stills. */
export const underClock = { hold: false };

/** How often the chip's minutes are read again while the timer runs. */
const CHIP_TICK_MS = 10_000;

/**
 * Sessions this row never moves: a web view or a browser. `set_audio_session_volume` matches a name by "contains" in
 * either direction, so one of these would also move every other web view app, the wall's own sounds and the browser.
 */
export const SHARED_PROCESSES: ReadonlySet<string> = new Set(['msedgewebview2', 'msedge', 'chrome', 'firefox', 'brave', 'opera', 'vivaldi']);

const NO_SOUND = 'Nothing playing on this PC can be turned up or down here.';
const TWITCH_SOUND = 'Twitch keeps its own volume. Use the sound control on the video.';

/**
 * Whether the rows are at rest (quiet) or shown. They start at rest. The pointer anywhere in the zone (the
 * column from the date line to the last row, not the foot) or keyboard focus inside the rows or on the two tabs, or an open pin
 * menu shows them; `ctlTiming.restMs` after the last of those leaves they go quiet again.
 */
function useRest(zone: { current: HTMLDivElement | null }, held: boolean) {
  const [pointer, setPointer] = useState(false);
  const [focus, setFocus] = useState(false);
  const [rest, setRest] = useState(true);
  // Whether the last input was the keyboard: a focus after a click (the pin just pressed) does not hold the rows shown.
  const keys = useRef(false);
  useEffect(() => {
    const key = () => {
      keys.current = true;
    };
    const mouse = () => {
      keys.current = false;
    };
    // Keyboard focus on the rows or on the Listen and Watch tabs (inside the zone) holds the rows shown.
    const into = (e: FocusEvent) => setFocus(keys.current && e.target instanceof Element && e.target.closest('.u-tabs, .u-quick') !== null);
    const away = () => setFocus(false);
    document.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', mouse, true);
    document.addEventListener('focusin', into);
    document.addEventListener('focusout', away);
    return () => {
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('pointerdown', mouse, true);
      document.removeEventListener('focusin', into);
      document.removeEventListener('focusout', away);
    };
  }, []);
  useEffect(() => {
    const inside = (e: MouseEvent) => {
      const r = zone.current?.getBoundingClientRect();
      setPointer(!!r && r.width > 0 && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom);
    };
    const out = () => setPointer(false);
    document.addEventListener('pointermove', inside, { passive: true });
    document.addEventListener('pointerdown', inside, { passive: true });
    document.documentElement.addEventListener('mouseleave', out);
    return () => {
      document.removeEventListener('pointermove', inside);
      document.removeEventListener('pointerdown', inside);
      document.documentElement.removeEventListener('mouseleave', out);
    };
  }, [zone]);
  const shown = underClock.hold || pointer || focus || held;
  useEffect(() => {
    if (shown) {
      setRest(false);
      return;
    }
    const id = setTimeout(() => setRest(true), ctlTiming.restMs);
    return () => clearTimeout(id);
  }, [shown]);
  return rest;
}

interface MenuAt {
  index: number;
  byKeyboard: boolean;
}

/** A label as words, each its own box: a word too long for the pin is cut with an ellipsis on its line, never broken mid-word. */
function words(label: string) {
  return label.split(' ').flatMap((w, i) => (i === 0 ? [<span className="u-pin-word" key={i}>{w}</span>] : [' ', <span className="u-pin-word" key={i}>{w}</span>]));
}

function Pins({ onMenu }: { onMenu: (open: boolean) => void }) {
  const places = usePins((s) => s.places);
  const saved = useWatchStore((s) => s.saved);
  const playing = useWatchStore((s) => s.playing);
  const items = resolvePins(places, saved);
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const wasOpen = useRef<number | null>(null);
  // True from an Enter or Space press on a pin to its click: that click opens the menu as a keyboard opening, not a mouse one.
  const viaKey = useRef(false);
  useEffect(() => onMenu(menu !== null), [menu, onMenu]);

  const open = (index: number, byKeyboard: boolean) => setMenu({ index, byKeyboard });
  const close = (restore: boolean) => {
    const at = menu?.index;
    setMenu(null);
    if (restore && at !== undefined) {
      quietFocus();
      buttons.current[at]?.focus();
    }
  };

  return (
    <div className="u-pins" role="group" aria-label="Pins">
      {items.map((item, i) => {
        const lit = !!item && !!playing && refKey(playing) === refKey(item);
        const press = () => {
          wasOpen.current = menu?.index ?? null;
          viaKey.current = false;
        };
        return (
          <div className="u-pinslot" key={i}>
            <button
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              className={`u-pin${item ? '' : ' add'}${lit ? ' on' : ''}`}
              aria-pressed={item ? lit : undefined}
              aria-haspopup="menu"
              aria-label={item ? undefined : 'Add a pin'}
              {...(item
                ? tip(() => (
                    <div className="sp-tipline">
                      <b>{item.label}</b>
                      <span>
                        {kindName(item.kind)} · {lit ? 'Playing now' : 'Click to play'} · Right-click for Replace and Remove
                      </span>
                    </div>
                  ))
                : tip('Add a pin: one click to start a video from the Watch list'))}
              onPointerDown={press}
              onClick={() => {
                if (!item) {
                  if (wasOpen.current !== i) open(i, viaKey.current);
                  viaKey.current = false;
                  return;
                }
                // The pin that plays does nothing new: it never restarts.
                if (!lit) useWatchStore.getState().play(item);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                open(i, false);
              }}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') viaKey.current = true;
                if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                  e.preventDefault();
                  open(i, true);
                }
              }}
            >
              {item ? (
                <>
                  <i className="u-pin-art" style={{ background: artBackground(refKey(item)) }}>
                    <PinGlyph kind={item.kind} />
                  </i>
                  <span className="u-pin-name">{words(item.label)}</span>
                </>
              ) : (
                <>
                  <IconPlus size={20} aria-hidden="true" />
                  <span className="u-pin-add">Add a pin</span>
                </>
              )}
            </button>
            {menu?.index === i ? <PlacedMenu index={i} item={item} places={places} saved={saved} byKeyboard={menu.byKeyboard} onClose={close} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function PlacedMenu({ index, item, places, saved, byKeyboard, onClose }: { index: number; item: SavedItem | null; places: readonly (string | null)[]; saved: readonly SavedItem[]; byKeyboard: boolean; onClose: (restore: boolean) => void }) {
  return (
    <PinMenu
      items={pinnable(places, saved)}
      listHasItems={saved.some((i) => i.kind !== 'own')}
      pinned={!!item}
      name={item?.label ?? 'Add a pin'}
      byKeyboard={byKeyboard}
      onPick={(key) => usePins.getState().pin(index, key)}
      onRemove={() => usePins.getState().unpin(index)}
      onOpenWatch={() => useWatchStore.getState().setTab('watch')}
      onClose={onClose}
    />
  );
}

/** What the sound button and slider drive now: the wall's own video, or the app Listen follows. */
function useSound() {
  const tab = useWatchStore((s) => s.tab);
  const playing = useWatchStore((s) => s.playing);
  const music = useWatchStore((s) => s.source === 'music');
  const paused = useWatchStore((s) => s.paused);
  const muted = useWatchStore((s) => s.muted);
  const volume = useWatchStore((s) => s.volume);
  const { info } = useNowPlaying();
  const source = sourceKey(info);
  // On Watch it is always the wall's video; on Listen it is the video while one plays out of sight, else the player's app.
  const video = tab === 'watch' || (!!playing && !paused);
  const app = useAppVolume(video ? null : source);
  const lastLevel = useRef(0);
  const appLevel = volumePercent(app.value);
  if (!video && app.session && !SHARED_PROCESSES.has(procName(app.session.name)) && appLevel > 0) lastLevel.current = appLevel;
  const name = shownSource(playerName(source)) ?? 'the player';

  if (video) {
    const twitch = playing?.kind === 'twitch';
    return {
      disabled: twitch,
      off: muted && !twitch,
      dim: muted && !twitch,
      level: volume,
      blank: twitch,
      who: 'Watch',
      buttonTip: twitch ? TWITCH_SOUND : muted ? 'Sound on' : 'Mute the video',
      sliderTip: twitch ? TWITCH_SOUND : playing ? `Volume of what plays: ${music ? 'YouTube, on the wall' : 'Watch'}, ${volume} percent` : `The next video starts at ${volume} percent`,
      toggle: () => useWatchStore.getState().setMuted(!muted),
      set: (v: number) => useWatchStore.getState().setVolume(v),
    };
  }
  const none = !app.session || SHARED_PROCESSES.has(procName(app.session.name));
  const back = lastLevel.current || 50;
  return {
    disabled: none,
    off: !none && appLevel === 0,
    dim: none,
    level: appLevel,
    blank: none,
    who: name,
    buttonTip: none ? NO_SOUND : appLevel > 0 ? `Silence ${name}` : `Sound back to ${back} percent`,
    sliderTip: none ? NO_SOUND : `Volume of what plays: ${name}, ${appLevel} percent`,
    toggle: () => app.set(appLevel > 0 ? 0 : back / 100),
    set: (v: number) => app.set(clampVolume(v / 100)),
  };
}

function SoundRow() {
  const s = useSound();
  const Glyph = s.off ? IconVolumeOff : IconVolume;
  const style = { ['--at' as string]: `${s.disabled ? 0 : s.level}%` } as CSSProperties;
  const onKeys = (e: KeyboardEvent<HTMLInputElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 5 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -5 : 0;
    if (!step || s.disabled) return;
    e.preventDefault();
    s.set(Math.min(100, Math.max(0, s.level + step)));
  };
  return (
    <>
      <button type="button" className="u-snd" aria-label={s.off ? `Unmute ${s.who}` : `Mute ${s.who}`} aria-pressed={s.off} aria-disabled={s.disabled || undefined} data-disabled={s.disabled ? '' : undefined} {...tip(s.buttonTip)} onClick={() => !s.disabled && s.toggle()}>
        <Glyph size={20} aria-hidden="true" />
      </button>
      <span className="ln-track u-qvol" data-dim={s.dim ? '' : undefined} data-disabled={s.disabled ? '' : undefined} style={style} {...tip(s.sliderTip)}>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={s.disabled ? 0 : s.level}
          disabled={s.disabled}
          aria-label={`Volume of ${s.who}`}
          aria-valuetext={`${s.level} percent`}
          onChange={(e) => s.set(Number(e.currentTarget.value))}
          onKeyDown={onKeys}
        />
      </span>
      <span className="u-qval" aria-hidden="true">
        {s.blank ? '' : s.level}
      </span>
    </>
  );
}

/** "11:04 PM" for a time, the same words as the wall's other clocks. */
function clock(at: number): string {
  return new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function SleepChip() {
  const endsAt = useSleep((s) => s.endsAt);
  const step = useSleep((s) => s.step);
  const [, tick] = useState(0);
  const visible = useVisible();
  // The words are read again every `CHIP_TICK_MS` while the timer runs and the page shows, and at once when it shows again.
  useEffect(() => {
    if (endsAt === null || !visible) return;
    tick((n) => n + 1);
    const id = setInterval(() => tick((n) => n + 1), CHIP_TICK_MS);
    return () => clearInterval(id);
  }, [endsAt, visible]);
  const next = nextStep(step);
  const on = endsAt !== null;
  return (
    <button
      type="button"
      className={`u-sleep${on ? ' on' : ''}`}
      aria-pressed={on}
      {...tip(() => (
        <div className="sp-tipline">
          <b>{on ? `Stops at ${clock(endsAt)}. ${next === 0 ? 'Click to turn it off.' : `Click for ${next} min.`}` : 'Stop in 30 min. Click again for 60, then 90.'}</b>
          <span>{on ? "Stops the wall's video and pauses the player shown on Listen; an app Windows cannot name is left alone" : "Stops the wall's video and pauses the player shown on Listen; an app Windows cannot name is left alone. It cannot stop an app the wall does not follow."}</span>
        </div>
      ))}
      onClick={() => stepSleep()}
    >
      <IconZzz size={18} aria-hidden="true" />
      <span>{sleepWords(endsAt)}</span>
    </button>
  );
}

/**
 * Under the clock, on both tabs: three pins (one click starts a Watch list item and shows Watch), then the
 * volume of what plays with a "Stop in 30 min" sleep timer. At rest the rows are quiet but never gone; the
 * pointer anywhere on the column from the date line to the last row, or keyboard focus inside, brings them up.
 */
export function UnderClock() {
  const zone = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const rest = useRest(zone, menuOpen);
  return (
    <>
      {/* The pointer zone: the date line down to the last row. It only measures; it takes no pointer. */}
      <div className="u-zone" ref={zone} aria-hidden="true" />
      <div
        className="u-quick"
        data-rest={rest ? 'true' : undefined}
      >
        <Pins onMenu={setMenuOpen} />
        <div className="u-qsound">
          <SoundRow />
          <SleepChip />
        </div>
      </div>
    </>
  );
}

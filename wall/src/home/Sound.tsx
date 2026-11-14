import {
  IconCoffee,
  IconDesk,
  IconDeviceLaptop,
  IconDeviceSpeaker,
  IconDots,
  IconHeadphones,
  IconHome,
  IconLamp,
  IconMoonStars,
  IconSofa,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconVolume,
  IconX,
  IconZzz,
} from '@tabler/icons-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { invoke } from '../bridge/tauri';
import { useVisible } from '../ui/useVisible';
import { tip } from '../ui/HoverTip';
import { useCentreStatus } from './centreSources';
import {
  LATCH_MS,
  NEEDS_CONFIRM,
  SAFE_VOLUME,
  SLEEP_CHOICES,
  ageWords,
  PLAY_ART,
  chipLabel,
  clockMs,
  faceTiles,
  houseTrack,
  playingWhere,
  moreControls,
  moreRoutines,
  wherePlaces,
  groupLabel,
  groupMovers,
  leftOutNote,
  groupTargets,
  groupVolume,
  inputWord,
  loudText,
  markAfterRead,
  musicPlaying,
  needsConfirm,
  nowLine,
  readLastPlay,
  sleepLeft,
  soonestTimer,
  speakerState,
  startedText,
  suggestedKey,
  writeLastPlay,
  type ControlRoutine,
  type MusicRoutine,
  type PlayMark,
  type PlaybackRead,
  type PlayResult,
  type Slot,
  type SonosPreset,
  type SonosSpeaker,
  type SonosSummary,
} from './soundModel';
import { clock, useSonos } from './useSonos';

export const RESULT_MS = 4000;
/** The service needs a moment after a command before its status shows the change. */
export const SETTLE_MS = 1500;
/** Arrow keys settle for this long before the one change is sent. */
export const KEY_SETTLE_MS = 400;
/** The line for a skip that gave no reason the wall recognises. */
const SKIP_LINE = "Skipped: this routine's own conditions say not now";

/** "Play anyway" stays on offer this long after a skip (Rust's own window). */
export const SKIP_OFFER_MS = 60_000;

type Pop = 'more' | 'speakers' | 'sleep' | null;
interface Result {
  text: string;
  warn: boolean;
}
interface Confirm {
  text: string;
  yes: string;
  go: () => void;
  no?: () => void;
}
interface Skip {
  key: string;
  name: string;
  reason: string | null;
  confirmed: boolean;
  at: number;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * One deliberate action, one write: the second click of a double click and the repeats of
 * a held key never reach the handler.
 */
function once(fn: () => void) {
  return {
    onClick: (e: ReactMouseEvent) => {
      if (e.detail > 1) return;
      fn();
    },
    onKeyDown: (e: ReactKeyboardEvent) => {
      if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault();
    },
  };
}

/**
 * The Sound block on Home: quick-play buttons for the Sonos service's music routines (the
 * five the owner uses: Morning, Day, Evening, Late night, Workday; the rest under More), the hour's suggestion, a
 * Where switch for the group presets, one volume slider that moves the playing group by a
 * step, a Speakers list with a slider each, play or pause, and a sleep timer. Nothing plays
 * or changes volume without a click; a loud change asks first; a play the routine's own
 * conditions skip says why and offers "Play anyway". A read that is not live dims the
 * block and stops writes.
 */
export function Sound({ fallback = false }: { fallback?: boolean }) {
  const { status, summary, okAt, now, stale, refresh } = useSonos();
  const publish = useCentreStatus((st) => st.set);
  const state = status === 'unconfigured' ? 'unconfigured' : summary ? 'ok' : status === 'error' ? 'down' : 'loading';
  useEffect(() => {
    publish('sonos', { state, okAt, check: () => void refresh() });
  }, [publish, state, okAt, refresh]);

  if (status === 'unconfigured') {
    return (
      <Shell side={null} bare>
        <div className="sound-note s">
          <IconDeviceSpeaker size={30} stroke={1.6} aria-hidden="true" />
          <span>Add sonosBaseUrl to feeds.json to control Sonos from here.</span>
        </div>
      </Shell>
    );
  }
  if (!summary && status === 'loading' && !fallback) {
    // Until Sonos answers the block holds its final size with quiet shapes, so Home's
    // centre does not resize when it arrives.
    return (
      <Shell side={null}>
        <div className="panel sound-panel sound-skel" aria-hidden="true">
          <div className="sound-skel-row sound-skel-plays">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span key={i} />
            ))}
          </div>
          <div className="sound-skel-row sound-skel-line">
            <span />
            <span />
          </div>
          <div className="sound-skel-row sound-skel-line">
            <span />
            <span />
          </div>
        </div>
      </Shell>
    );
  }
  if (!summary) {
    const down = status === 'error';
    return (
      <Shell side={down ? { text: 'Could not reach Sonos', warn: true } : null} bare>
        <div className="sound-note s">
          <IconDeviceSpeaker size={30} stroke={1.6} aria-hidden="true" />
          <span>{down ? 'The Sonos service did not answer. Checks again every 30 seconds.' : 'The Sonos service has not answered yet. Checks again every 30 seconds.'}</span>
        </div>
      </Shell>
    );
  }
  return <Live summary={summary} okAt={okAt} now={now} stale={stale} refresh={refresh} />;
}

function Shell({
  side,
  extra,
  stale = false,
  bare = false,
  children,
}: {
  side: Result | null;
  /** Shown beside the heading in place of `side` (the skip notice with "Play anyway"). */
  extra?: ReactNode;
  stale?: boolean;
  bare?: boolean;
  children: ReactNode;
}) {
  const cls = ['sound', stale ? 'stale' : '', bare ? 'bare' : ''].filter(Boolean).join(' ');
  const head: ReactNode =
    extra ??
    (side && (
      <span className={side.warn ? 'xs warn-text' : 'xs sound-result'} role="status">
        {side.text}
      </span>
    ));
  return (
    <section className={cls} aria-label="Sound">
      <div className="sound-head">
        <span className="k">Sound</span>
        {head}
      </div>
      {children}
    </section>
  );
}

function Live({
  summary: s,
  okAt,
  now,
  stale,
  refresh,
}: {
  summary: SonosSummary;
  okAt: number | null;
  now: number;
  stale: boolean;
  refresh: () => Promise<void>;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirmState] = useState<Confirm | null>(null);
  const confirmRef = useRef<Confirm | null>(null);
  const [pop, setPop] = useState<Pop>(null);
  const [mark, setMark] = useState<PlayMark | null>(readLastPlay);
  const [skip, setSkip] = useState<Skip | null>(null);
  const playback = usePlayback(s.readAtMs);
  const busyRef = useRef(false);
  /** Per control: clicks before this time (ms) are ignored. */
  const latch = useRef<Record<string, number>>({});
  const mounted = useRef(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const resultTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const setConfirm = useCallback((c: Confirm | null) => {
    confirmRef.current = c;
    setConfirmState(c);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const list = timers.current;
    return () => {
      mounted.current = false;
      list.forEach(clearTimeout);
      clearTimeout(resultTimer.current);
    };
  }, []);

  const show = useCallback((text: string, warn = false) => {
    setResult({ text, warn });
    clearTimeout(resultTimer.current);
    resultTimer.current = setTimeout(() => mounted.current && setResult(null), RESULT_MS);
  }, []);

  const changeMark = useCallback((next: PlayMark | null) => {
    setMark(next);
    writeLastPlay(next);
  }, []);

  // Each read decides whether "started N min ago" still describes what plays.
  useEffect(() => {
    setMark((m) => {
      const next = markAfterRead(m, s, clock());
      if (next !== m) writeLastPlay(next);
      return next;
    });
  }, [s]);

  /**
   * Runs one write: busy while it runs, latched for a moment after it settles, a brief
   * result, and a fresh read at once and a moment later.
   */
  const run = useCallback(
    async <T,>(
      id: string,
      call: (confirmed: boolean) => Promise<T>,
      ok: string | ((answer: T) => string | null),
      opts: { confirmed?: boolean; ask?: string; yes?: string; done?: (answer: T) => void; undo?: () => void } = {},
    ) => {
      if (busyRef.current || (latch.current[id] ?? 0) > Date.now()) return;
      busyRef.current = true;
      setBusy(id);
      setConfirm(null);
      // Rust asking for a confirm sent nothing, so the confirmed call is not latched out.
      let sent = true;
      try {
        const answer = await call(opts.confirmed ?? false);
        if (!mounted.current) return;
        opts.done?.(answer);
        const text = typeof ok === 'function' ? ok(answer) : ok;
        if (text) show(text);
        void refresh();
        timers.current.push(setTimeout(() => void refresh(), SETTLE_MS));
      } catch (e) {
        if (!mounted.current) return;
        const text = errText(e);
        if (text === NEEDS_CONFIRM) {
          sent = false;
          setConfirm({
            text: opts.ask ?? 'This sets a speaker above 40. Go ahead?',
            yes: opts.yes ?? 'Yes',
            go: () => void run(id, call, ok, { ...opts, confirmed: true }),
            no: opts.undo,
          });
        } else {
          opts.undo?.();
          show(text || 'Could not reach Sonos', true);
          void refresh();
        }
      } finally {
        busyRef.current = false;
        if (sent) latch.current[id] = Date.now() + LATCH_MS;
        if (mounted.current) setBusy(null);
      }
    },
    [refresh, show, setConfirm],
  );

  const locked = stale || busy !== null;
  const closePop = useCallback(() => setPop(null), []);
  // A question left open when the read goes stale is dropped (its slider goes back).
  useEffect(() => {
    if (!stale || !confirmRef.current) return;
    const c = confirmRef.current;
    setConfirm(null);
    c.no?.();
  }, [stale, setConfirm]);

  const face = faceTiles(s.music);
  const more = moreRoutines(s.music, face);
  const suggestion = suggestedKey(s.music, new Date(now));
  const playing = musicPlaying(s);
  const places = wherePlaces(s.presets);
  const extraControls = moreControls(s.controls);
  const offer = skip && now - skip.at < SKIP_OFFER_MS ? skip : null;

  const play = (r: MusicRoutine) => {
    // The tile's word where the routine has a tile (the ask, the skip notice and the result use it).
    const label = face.find((t) => t.routine.key === r.key)?.label ?? chipLabel(r.name);
    const ask =
      typeof r.volume === 'number' ? `${r.name} starts at volume ${r.volume}, above 40. Start it?` : `${r.name} starts at a volume the Sonos service sets. Start it?`;
    const go = (confirmed: boolean) =>
      void run<PlayResult>(
        `play:${r.key}`,
        (c) => invoke<PlayResult>('wall2_sonos_play', c ? { routineKey: r.key, confirm: true } : { routineKey: r.key }),
        (a) => (a?.started === false ? null : `Playing ${label}`),
        {
          confirmed,
          ask,
          yes: 'Start',
          done: (a) => {
            if (a?.started === false) {
              setSkip({ key: r.key, name: label, reason: a.reason ?? null, confirmed, at: clock() });
              return;
            }
            setSkip(null);
            changeMark({ key: r.key, at: clock(), group: null, seen: false });
          },
        },
      );
    setPop(null);
    if (typeof r.volume !== 'number' || r.volume > SAFE_VOLUME) setConfirm({ text: ask, yes: 'Start', go: () => go(true) });
    else go(false);
  };

  const playAnyway = (sk: Skip) =>
    void run<PlayResult>(
      `play:${sk.key}`,
      (c) => invoke<PlayResult>('wall2_sonos_play', c || sk.confirmed ? { routineKey: sk.key, confirm: true, force: true } : { routineKey: sk.key, force: true }),
      `Playing ${sk.name}`,
      {
        // A forced call the service refuses for needing the loud confirm sent nothing: ask,
        // and the Yes sends it again with the confirm, so the offer is not used up.
        ask: `${sk.name} starts at a volume the Sonos service sets. Start it?`,
        yes: 'Start',
        done: () => {
          setSkip(null);
          changeMark({ key: sk.key, at: clock(), group: null, seen: false });
        },
      },
    );

  const runControl = (c: ControlRoutine) => {
    const go = (confirmed: boolean) =>
      void run(`play:${c.key}`, (k) => invoke('wall2_sonos_play', k ? { routineKey: c.key, confirm: true } : { routineKey: c.key }), `Done: ${c.name}`, {
        confirmed,
        ask: loudText(c.loud, 'Group'),
        yes: 'Group',
      });
    setPop(null);
    if (c.loud.length > 0) setConfirm({ text: loudText(c.loud, 'Group'), yes: 'Group', go: () => go(true) });
    else go(false);
  };

  const setSpeaker = (sp: SonosSpeaker, level: number, undo: () => void) => {
    const ask = `Set ${sp.name} to ${level}? That is louder than 40.`;
    const target = { kind: 'speaker', id: sp.name };
    const go = (confirmed: boolean) =>
      void run(`vol:speaker:${sp.name}`, (c) => invoke('wall2_sonos_volume', c ? { target, level, confirm: true } : { target, level }), `${sp.name} volume ${level}`, {
        confirmed,
        ask,
        undo,
      });
    if (needsConfirm([level])) setConfirm({ text: ask, yes: `Set ${level}`, go: () => go(true), no: undo });
    else go(false);
  };

  const setGroup = (groupId: string, label: string, from: number, level: number, undo: () => void) => {
    const step = level - from;
    const targets = groupTargets(s, step);
    const loud = targets.filter((t) => t.level > SAFE_VOLUME);
    const ask = `This sets ${loud.map((t) => `${t.name} to ${t.level}`).join(', ')}, louder than 40. Go ahead?`;
    const target = { kind: 'group', id: groupId };
    const go = (confirmed: boolean) =>
      void run(`vol:group:${groupId}`, (c) => invoke('wall2_sonos_volume', c ? { target, step, confirm: true } : { target, step }), `${label} volume ${step > 0 ? 'up' : 'down'} ${Math.abs(step)}${leftOutNote(s, groupId) ? `. ${leftOutNote(s, groupId)}` : ''}`, {
        confirmed,
        ask,
        undo,
      });
    if (needsConfirm(targets.map((t) => t.level))) setConfirm({ text: ask, yes: 'Set', go: () => go(true), no: undo });
    else go(false);
  };

  const applyPreset = (p: SonosPreset, label: string) => {
    setPop(null);
    const ask = loudText(p.loud, 'Apply');
    const go = (confirmed: boolean) =>
      void run(`preset:${p.id}`, (c) => invoke('wall2_sonos_preset', c ? { presetId: p.id, confirm: true } : { presetId: p.id }), `Speakers set to ${label}`, {
        confirmed,
        ask,
        yes: 'Apply',
      });
    if (p.loud.length > 0) setConfirm({ text: ask, yes: 'Apply', go: () => go(true) });
    else go(false);
  };

  const pauseAll = () =>
    void run('pause', () => invoke('wall2_sonos_pause_all'), 'Paused every speaker', {
      done: () => changeMark(null),
    });
  const suggested = s.music.find((r) => r.key === suggestion) ?? null;
  const track = houseTrack(playback.read, s);
  // Without a track: the play this wall started (while the music it started still plays).
  const activeTile = playing.length > 0 && mark?.seen ? (face.find((t) => t.routine.key === mark.key) ?? null) : null;
  const activeSlot = activeTile?.slot ?? null;
  const activeName = activeTile?.label ?? null;

  let side: Result | null = result;
  let extra: ReactNode = null;
  if (!result && offer) {
    extra = (
      <span className="sound-skip" role="status">
        <span className="xs warn-text">{offer.reason ? `Skipped: ${offer.reason}` : SKIP_LINE}</span>
        <button type="button" className="sound-btn small" title="ignores this routine's own conditions" disabled={locked} {...once(() => playAnyway(offer))}>
          Play anyway
        </button>
      </span>
    );
  } else if (!result && stale) {
    side = { text: okAt ? `Sonos not reachable, showing ${ageWords(okAt, now)}` : 'Sonos not reachable', warn: true };
  }

  const hasMore = more.length > 0 || extraControls.length > 0;
  const hint = face.length === 1 && !hasMore;
  // One column per control, so no blank cell sits in the row; the hints take the room they name.
  const cols = face.length === 0 ? (hasMore ? 3 : 1) : face.length + (hasMore ? 1 : 0) + (hint ? 2 : 0);
  const timer = soonestTimer(s.sleepTimers, now);
  const left = timer ? sleepLeft(timer, now) : null;
  const gVol = groupVolume(s);
  const gLabel = groupLabel(s);

  return (
    <Shell side={side} extra={extra} stale={stale}>
      <div className="panel sound-panel l2">
        <NowStrip
          s={s}
          now={now}
          track={track}
          trackAt={playback.at}
          activeSlot={activeSlot}
          activeName={activeName}
          locked={locked}
          pauseAll={pauseAll}
          playSuggested={
            <button
              type="button"
              className="sound-btn cy"
              title={suggested ? `Start ${suggested.name}, the suggestion for this hour` : 'No routine fits this hour; pick one above'}
              disabled={locked || !suggested}
              {...once(() => suggested && play(suggested))}
            >
              <IconPlayerPlayFilled size={22} aria-hidden="true" />
              {suggested ? `Play ${face.find((t) => t.routine.key === suggested.key)?.label ?? chipLabel(suggested.name)}` : 'Play'}
            </button>
          }
          suggestedSlot={suggested ? (face.find((t) => t.routine.key === suggested.key)?.slot ?? null) : null}
        />
        <div className="sound-plays" role="group" aria-label="Quick play" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {face.map((t) => {
            const r = t.routine;
            const isStarted = mark?.key === r.key && mark.seen;
            const isSug = !isStarted && r.key === suggestion;
            const tag = isStarted ? <u className="sound-tag on">{startedText(mark.at, now)}</u> : isSug ? <u className="sound-tag sug">Suggested</u> : null;
            const cls = ['sound-chip', isStarted ? 'on' : '', isSug ? 'sug' : '', tag ? 'has-tag' : '', busy === `play:${r.key}` ? 'working' : ''].filter(Boolean).join(' ');
            const tip = [`Play ${r.name}`, r.favorite ? `(${r.favorite})` : '', typeof r.volume === 'number' ? `at volume ${r.volume}` : 'at a volume the service sets', isSug ? '. Suggested for this hour' : '']
              .filter(Boolean)
              .join(' ');
            return (
              <Chip
                key={r.key}
                className={cls}
                title={tip}
                disabled={locked}
                tag={tag}
                name={t.label}
                slot={t.slot}
                action={() => play(r)}
              />
            );
          })}
          {face.length === 0 && <div className="sound-quiet s span-all" style={hasMore ? { gridColumn: '1 / span 2' } : undefined}>No Morning, Day, Evening, Late night or Workday routine in the Sonos service yet.</div>}
          {(more.length > 0 || extraControls.length > 0) && (
            <div className="sound-anchor">
              <button
                type="button"
                className={pop === 'more' ? 'sound-chip more open' : 'sound-chip more'}
                title={`${more.length} more routines${extraControls.length ? ' and speaker controls' : ''}`}
                aria-expanded={pop === 'more'}
                onClick={() => setPop(pop === 'more' ? null : 'more')}
              >
                <b className="sound-chip-name">
                  More <IconDots size={22} stroke={2} aria-hidden="true" />
                </b>
                <span className="sound-chip-sub">{more.length > 0 ? `${more.length} more` : 'controls'}</span>
              </button>
              {pop === 'more' && (
                <Popup label="More routines" onClose={closePop} right down wide>
                  {more.length > 0 && <div className="k">Music</div>}
                  <div className="sound-more-list">
                    {more.map((r) => (
                      <button
                        key={r.key}
                        type="button"
                        className="sound-row-btn"
                        title={`Play ${r.name}${r.favorite ? ` (${r.favorite})` : ''}`}
                        disabled={locked}
                        {...once(() => play(r))}
                      >
                        <b>{r.name}</b>
                        <span className="xs">{[r.favorite, typeof r.volume === 'number' ? `volume ${r.volume}` : null].filter(Boolean).join(', ')}</span>
                      </button>
                    ))}
                  </div>
                  {extraControls.length > 0 && <div className="k">Speakers</div>}
                  <div className="sound-more-list">
                    {extraControls.map((c) => (
                      <button key={c.key} type="button" className="sound-row-btn" title={`Run ${c.name}`} disabled={locked} {...once(() => runControl(c))}>
                        <b>{c.name}</b>
                      </button>
                    ))}
                  </div>
                </Popup>
              )}
            </div>
          )}
          {hint && (
            <div className="sound-quiet xs fill">More music routines from the Sonos service show here.</div>
          )}
        </div>

        <div className="sound-line">
          {places.length > 0 && (
            <div className="sound-where" role="radiogroup" aria-label="Where">
              <span className="sound-lbl">Where</span>
              {places.map(({ label, preset: p }) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={p.active}
                  className={p.active ? 'seg on' : 'seg'}
                  title={p.active ? `${p.name}: the speakers are grouped this way now` : `Group the speakers as ${p.name}`}
                  disabled={locked}
                  {...once(() => applyPreset(p, label))}
                >
                  {(() => {
                    const Icon = WHERE_ICONS.find(([re]) => re.test(label))?.[1];
                    return Icon ? <Icon size={20} stroke={1.8} aria-hidden="true" /> : null;
                  })()}
                  {label}
                </button>
              ))}
            </div>
          )}
          {playing.length > 0 && (
            <button type="button" className="sound-btn" title="Pause every Sonos speaker" disabled={locked} {...once(pauseAll)}>
              <IconPlayerPauseFilled size={22} aria-hidden="true" />
              Sonos off
            </button>
          )}
        </div>

        <div className="sound-line">
          <IconVolume className="sound-vol-icon" size={26} stroke={1.8} aria-hidden="true" />
          {gLabel && gVol !== null && s.currentGroup ? (
            <VolumeSlider
              key={s.currentGroup}
              sync={s.readAtMs}
              className="sound-vol"
              label={gLabel}
              title={`Moves each speaker in the group (${groupMovers(s, s.currentGroup)
                .map((sp) => sp.name)
                .join(', ')}) by the same step from its own level`}
              value={gVol}
              disabled={locked}
              onCommit={(level, undo) => setGroup(s.currentGroup!, gLabel, gVol, level, undo)}
            />
          ) : (
            <span className="sound-vol s">No group to set; use Speakers</span>
          )}
          <div className="sound-anchor">
            <button
              type="button"
              className={pop === 'speakers' ? 'sound-btn open' : 'sound-btn'}
              title="Every speaker, its state and its own volume"
              aria-expanded={pop === 'speakers'}
              onClick={() => setPop(pop === 'speakers' ? null : 'speakers')}
            >
              <IconDeviceSpeaker size={22} stroke={1.8} aria-hidden="true" />
              Speakers {s.speakers.length}
            </button>
            {pop === 'speakers' && (
              <Popup label="Speakers" onClose={closePop} right wide>
                <div className="sound-spk-list">
                  {s.speakers.map((sp) => (
                    <SpeakerRow key={sp.name} sync={s.readAtMs} sp={sp} disabled={locked} onCommit={(level, undo) => setSpeaker(sp, level, undo)} />
                  ))}
                  {s.speakers.length === 0 && <div className="s">The Sonos service lists no speakers.</div>}
                </div>
              </Popup>
            )}
          </div>
          <div className="sound-anchor">
            {timer ? (
              <button
                type="button"
                className="sound-btn on"
                title={`Sonos sleeps ${left !== null ? `in ${left} min` : 'soon'}${timer.fadeMinutes ? `, fading over the last ${timer.fadeMinutes} min` : ''}. Click to cancel`}
                disabled={locked}
                {...once(() => void run('sleep-cancel', () => invoke('wall2_sonos_sleep_cancel', { id: timer.id }), 'Sleep timer off'))}
              >
                <IconZzz size={22} stroke={1.8} aria-hidden="true" />
                {left !== null ? `Sleep ${left} min` : 'Sleep on'}
                <IconX size={18} stroke={2} aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                className={pop === 'sleep' ? 'sound-btn open' : 'sound-btn'}
                title="Pause Sonos after 30, 60 or 90 minutes, fading out"
                aria-expanded={pop === 'sleep'}
                disabled={locked}
                onClick={() => setPop(pop === 'sleep' ? null : 'sleep')}
              >
                <IconZzz size={22} stroke={1.8} aria-hidden="true" />
                Sleep
              </button>
            )}
            {pop === 'sleep' && !timer && (
              <Popup label="Sleep timer" onClose={closePop} right>
                <div className="sound-sleep-opts">
                  {SLEEP_CHOICES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className="sound-btn"
                      title={`Pause every speaker in ${m} minutes, fading over the last 5`}
                      disabled={locked}
                      {...once(() => {
                        setPop(null);
                        void run('sleep', () => invoke('wall2_sonos_sleep', { minutes: m }), `Sleep in ${m} min`);
                      })}
                    >
                      {m} min
                    </button>
                  ))}
                </div>
              </Popup>
            )}
          </div>
        </div>

        {confirm && (
          <div className="sound-confirm" role="alertdialog" aria-label="Confirm">
            <span className="s">{confirm.text}</span>
            <button type="button" className="sound-btn cy" disabled={locked} {...once(confirm.go)}>
              {confirm.yes}
            </button>
            <button
              type="button"
              className="sound-btn"
              onClick={() => {
                const c = confirmRef.current;
                setConfirm(null);
                c?.no?.();
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </Shell>
  );
}

/**
 * A quick-play chip. Its name takes up to two lines; under a two-line name the favourite
 * line hides (it stays in the tooltip). Only a chip with a tag reserves room for it.
 */
const PLAY_ICONS = { cup: IconCoffee, headphones: IconHeadphones, lamp: IconLamp, moon: IconMoonStars, laptop: IconDeviceLaptop } as const;

/** A play's line icon on its colour wash (art A). */
export function PlayArt({ slot, size = 24 }: { slot: Slot; size?: number }) {
  const art = PLAY_ART[slot];
  const Icon = PLAY_ICONS[art.icon];
  return (
    <span className="sound-art" style={{ '--c': art.rgb } as CSSProperties} aria-hidden="true">
      <Icon size={size} stroke={1.7} />
    </span>
  );
}

const WHERE_ICONS: [RegExp, typeof IconDesk][] = [
  [/^office/i, IconDesk],
  [/^all/i, IconHome],
  [/^common/i, IconSofa],
];

function Chip({
  className,
  title,
  disabled,
  tag,
  name,
  slot,
  action,
}: {
  className: string;
  title: string;
  disabled: boolean;
  tag: ReactNode;
  name: string;
  slot: Slot;
  action: () => void;
}) {
  const nameRef = useRef<HTMLElement>(null);
  const [two, setTwo] = useState(false);
  useLayoutEffect(() => {
    const el = nameRef.current;
    if (!el) return;
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 25;
    setTwo(el.scrollHeight > lh * 1.4);
  }, [name, tag]);
  return (
    <button type="button" className={two ? `${className} two` : className} title={title} disabled={disabled} style={{ '--c': PLAY_ART[slot].rgb } as CSSProperties} {...once(action)}>
      {tag}
      <PlayArt slot={slot} />
      <b ref={nameRef} className="sound-chip-name">
        {name}
      </b>
    </button>
  );
}

/**
 * A slider that sends one change when the pointer lets go (or the arrow keys settle),
 * never while dragging, and never the same level twice. It holds the pointer while
 * dragging, so a release outside the window still finishes it; a cancelled pointer, a
 * window blur or the slider turning off mid-drag puts it back.
 */
function VolumeSlider({
  value,
  sync,
  label,
  title,
  disabled,
  className,
  onCommit,
}: {
  value: number;
  /** Changes with every read; the slider takes the read's value then, unless it is held. */
  sync: number;
  label: string;
  title: string;
  disabled: boolean;
  className?: string;
  onCommit: (level: number, undo: () => void) => void;
}) {
  const [v, setV] = useState(value);
  const vRef = useRef(value);
  const sent = useRef(value);
  const held = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  const keyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(keyTimer.current), []);
  const revert = useCallback(() => {
    held.current = false;
    vRef.current = valueRef.current;
    sent.current = valueRef.current;
    setV(valueRef.current);
  }, []);
  // A new read moves the slider to what the speakers say, but never under a held pointer.
  useEffect(() => {
    if (held.current) return;
    vRef.current = value;
    sent.current = value;
    setV(value);
  }, [value, sync]);
  // Turned off mid-drag, or the window loses focus mid-drag: put it back.
  useEffect(() => {
    if (disabled && held.current) revert();
  }, [disabled, revert]);
  useEffect(() => {
    const blur = () => {
      if (held.current) revert();
    };
    window.addEventListener('blur', blur);
    return () => window.removeEventListener('blur', blur);
  }, [revert]);
  const commit = () => {
    clearTimeout(keyTimer.current);
    const level = vRef.current;
    if (level === sent.current) return;
    sent.current = level;
    onCommit(level, () => {
      sent.current = valueRef.current;
      vRef.current = valueRef.current;
      setV(valueRef.current);
    });
  };
  const finish = () => {
    held.current = false;
    commit();
  };
  return (
    <label className={`sound-slider ${className ?? ''}`} title={title}>
      <span className="sound-slider-lb">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={v}
        disabled={disabled}
        aria-label={label ? `Volume, ${label}` : title}
        style={{ '--fill': `${v}%` } as CSSProperties}
        onChange={(e) => {
          vRef.current = Number(e.target.value);
          setV(vRef.current);
        }}
        onPointerDown={(e) => {
          held.current = true;
          try {
            e.currentTarget.setPointerCapture?.(e.pointerId);
          } catch {
            /* capture is a convenience; release still finishes the drag */
          }
        }}
        onPointerUp={finish}
        onLostPointerCapture={() => {
          if (held.current) finish();
        }}
        onPointerCancel={revert}
        onKeyUp={() => {
          clearTimeout(keyTimer.current);
          keyTimer.current = setTimeout(commit, KEY_SETTLE_MS);
        }}
        onBlur={() => {
          if (!held.current) commit();
        }}
      />
      <b className={v > SAFE_VOLUME ? 'sound-slider-v loud' : 'sound-slider-v'}>{v}</b>
    </label>
  );
}

function SpeakerRow({
  sp,
  sync,
  disabled,
  onCommit,
}: {
  sp: SonosSpeaker;
  sync: number;
  disabled: boolean;
  onCommit: (level: number, undo: () => void) => void;
}) {
  const input = inputWord(sp);
  const [failed, setFailed] = useState(false);
  return (
    <div className={sp.online ? 'sound-spk' : 'sound-spk off'}>
      <b className="sound-spk-name" title={sp.name}>
        {sp.name}
      </b>
      <span className={`sound-spk-state ${sp.state}`}>{speakerState(sp)}</span>
      {input && <u className="sound-input">{input}</u>}
      {sp.input === 'lineIn' ? (
        <button
          type="button"
          className="sound-btn small"
          title="This speaker plays the PC's own sound, so the PC volume is the real control. Opens the Windows volume control"
          {...once(() => void invoke('open_volume_mixer').catch(() => setFailed(true)))}
        >
          {failed ? 'Could not open' : 'PC volume'}
        </button>
      ) : sp.online && typeof sp.volume === 'number' ? (
        <VolumeSlider value={sp.volume} sync={sync} label="" title={`${sp.name} volume`} disabled={disabled} onCommit={onCommit} />
      ) : (
        <span className="xs">{sp.online ? 'No volume reading' : 'Not reachable'}</span>
      )}
    </div>
  );
}

/** A small panel above its button; closes on Escape or a click outside. */
function Popup({
  label,
  onClose,
  right = false,
  down = false,
  wide = false,
  children,
}: {
  label: string;
  onClose: () => void;
  right?: boolean;
  down?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const downOutside = (e: PointerEvent) => {
      const anchor = ref.current?.parentElement;
      const target = e.target as Node;
      // The confirm bar belongs to the action in the pop-out; a click there keeps it open.
      if (anchor && !anchor.contains(target) && !(target instanceof Element && target.closest('.sound-confirm'))) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', downOutside);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', downOutside);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);
  return (
    <div ref={ref} className={['sound-pop', right ? 'right' : '', down ? 'down' : '', wide ? 'wide' : ''].filter(Boolean).join(' ')} role="dialog" aria-label={label}>
      {children}
    </div>
  );
}

// Section: home round two (now playing at the left)

/**
 * The Spotify playback read beside each Sonos read (Spotify is read only here, and only
 * for what the house speakers play). Any failure, Spotify not set up or signed out, is no
 * track: the strip then shows what the Sonos read knows.
 */
function usePlayback(sync: number): { read: PlaybackRead | null; at: number } {
  const visible = useVisible();
  // `at`: when this read landed, on the wall clock. The track's position is as of then.
  const [p, setP] = useState<{ read: PlaybackRead | null; at: number }>(() => ({ read: null, at: clock() }));
  useEffect(() => {
    if (!visible) return;
    let live = true;
    invoke<PlaybackRead | null>('wall2_spotify_playback')
      .then((r) => live && setP({ read: r ?? null, at: clock() }))
      .catch(() => live && setP({ read: null, at: clock() }));
    return () => {
      live = false;
    };
  }, [visible, sync]);
  return p;
}

/**
 * Now playing at the left of the Sound block. With a Spotify track on a house speaker:
 * cover, title, artist, where it plays, pause and progress (no next: the wall has no
 * Spotify skip, and media keys reach only this PC). With music the Sonos read alone knows
 * of: the play this wall started (its art), where it plays and pause. With nothing playing:
 * "Nothing playing" and the hour's suggestion as a Play button.
 */
function NowStrip({
  s,
  now,
  track,
  trackAt,
  activeSlot,
  activeName,
  locked,
  pauseAll,
  playSuggested,
  suggestedSlot,
}: {
  s: SonosSummary;
  now: number;
  track: ReturnType<typeof houseTrack>;
  /** When the Spotify read that carries the track's position landed. */
  trackAt: number;
  activeSlot: Slot | null;
  activeName: string | null;
  locked: boolean;
  pauseAll: () => void;
  playSuggested: ReactNode;
  suggestedSlot: Slot | null;
}) {
  const where = playingWhere(s);
  // Progress moves on between reads while the track plays, counted from the Spotify read that
  // carries the position (it lands after the Sonos read that asks for it).
  const since = track ? Math.max(0, now - trackAt) : 0;
  const pos = track ? Math.min(track.durationMs, track.progressMs + since) : 0;
  const pause = (
    <button type="button" className="np-rd big" aria-label="Pause" disabled={locked} {...tip('Pause every Sonos speaker')} {...once(pauseAll)}>
      <IconPlayerPauseFilled size={24} aria-hidden="true" />
    </button>
  );
  if (track) {
    return (
      <div className="sound-np" aria-label="Now playing">
        <div className="np-top">
          {track.cover ? <img className="np-cover" src={track.cover} alt="" /> : <span className="np-cover blank" aria-hidden="true" />}
          <div className="np-meta">
            <span className="np-k">Now playing</span>
            <b className="np-title" {...tip(track.title)}>
              {track.title}
            </b>
            <span className="np-artist" {...tip(track.artist)}>
              {track.artist}
            </span>
            <span className="np-where" {...tip(`Spotify on ${track.where}`)}>
              <IconDeviceSpeaker size={18} stroke={1.8} aria-hidden="true" />
              {track.where}
            </span>
            <div className="np-ctl">{pause}</div>
          </div>
        </div>
        {track.durationMs > 0 && (
          <div className="np-prog" {...tip(() => `${clockMs(pos)} of ${clockMs(track.durationMs)}`)}>
            <span>{clockMs(pos)}</span>
            <div>
              <i style={{ width: `${Math.round((pos / track.durationMs) * 100)}%` }} />
            </div>
            <span>{clockMs(track.durationMs)}</span>
          </div>
        )}
      </div>
    );
  }
  if (where) {
    return (
      <div className="sound-np plain" aria-label="Now playing">
        <div className="np-top">
          {activeSlot ? <PlayArt slot={activeSlot} size={44} /> : <span className="np-cover blank small" aria-hidden="true"><IconDeviceSpeaker size={40} stroke={1.5} /></span>}
          <div className="np-meta">
            <span className="np-k">Now playing</span>
            <b className="np-title">{activeName ?? (s.nowPlaying?.track ? s.nowPlaying.track : 'Music')}</b>
            {!activeName && s.nowPlaying?.artist && <span className="np-artist">{s.nowPlaying.artist}</span>}
            <span className="np-where" {...tip(nowLine(s))}>
              <IconDeviceSpeaker size={18} stroke={1.8} aria-hidden="true" />
              {where}
            </span>
            <div className="np-ctl">{pause}</div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="sound-np quiet" aria-label="Now playing">
      <div className="np-top">
        {suggestedSlot ? <PlayArt slot={suggestedSlot} size={44} /> : <span className="np-cover blank small" aria-hidden="true"><IconDeviceSpeaker size={40} stroke={1.5} /></span>}
        <div className="np-meta">
          <span className="np-k">Sound</span>
          <b className="np-title">Nothing playing</b>
          <span className="np-artist">{suggestedSlot ? 'Suggested for this hour' : 'Pick a play beside this'}</span>
          <div className="np-ctl">{playSuggested}</div>
        </div>
      </div>
    </div>
  );
}

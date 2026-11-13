import {
  IconDeviceSpeaker,
  IconDots,
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
import { useCentreStatus } from './centreSources';
import {
  FACE_MAX,
  LATCH_MS,
  NEEDS_CONFIRM,
  SAFE_VOLUME,
  SLEEP_CHOICES,
  ageWords,
  chipLabel,
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
  orderPresets,
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
  type PlayResult,
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
/** Names longer than this on average put five chips on the face, not six. */
const LONG_NAME_CHARS = 14;

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
 * The Sound block on Home: quick-play buttons for the Sonos service's music routines (six
 * on the face, five when names are long, the rest under More), the hour's suggestion, a
 * Where switch for the group presets, one volume slider that moves the playing group by a
 * step, a Speakers list with a slider each, play or pause, and a sleep timer. Nothing plays
 * or changes volume without a click; a loud change asks first; a play the routine's own
 * conditions skip says why and offers "Play anyway". A read that is not live dims the
 * block and stops writes.
 */
export function Sound() {
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
  if (!summary) {
    const down = status === 'error';
    return (
      <Shell side={down ? { text: 'Could not reach Sonos', warn: true } : null} bare>
        <div className="sound-note s">
          <IconDeviceSpeaker size={30} stroke={1.6} aria-hidden="true" />
          <span>{down ? 'The Sonos service did not answer. Checks again every 30 seconds.' : 'Loading'}</span>
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

  const longNames = s.music.slice(0, FACE_MAX).reduce((n, r) => n + chipLabel(r.name).length, 0) / Math.max(1, Math.min(FACE_MAX, s.music.length)) > LONG_NAME_CHARS;
  const faceMax = longNames && s.music.length > FACE_MAX - 1 ? FACE_MAX - 1 : FACE_MAX;
  const face = s.music.slice(0, faceMax);
  const more = s.music.slice(faceMax);
  const suggestion = suggestedKey(s.music, new Date(now));
  const playing = musicPlaying(s);
  const presets = orderPresets(s.presets);
  const extraControls = s.controls.filter((c) => c.action !== 'pauseAll');
  const offer = skip && now - skip.at < SKIP_OFFER_MS ? skip : null;

  const play = (r: MusicRoutine) => {
    const label = chipLabel(r.name);
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
      () => invoke<PlayResult>('wall2_sonos_play', sk.confirmed ? { routineKey: sk.key, confirm: true, force: true } : { routineKey: sk.key, force: true }),
      `Playing ${sk.name}`,
      {
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

  const applyPreset = (p: SonosPreset) => {
    setPop(null);
    const ask = loudText(p.loud, 'Apply');
    const go = (confirmed: boolean) =>
      void run(`preset:${p.id}`, (c) => invoke('wall2_sonos_preset', c ? { presetId: p.id, confirm: true } : { presetId: p.id }), `Speakers set to ${p.name}`, {
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

  const cols = Math.max(face.length + (more.length || extraControls.length ? 1 : 0), 3);
  const timer = soonestTimer(s.sleepTimers, now);
  const left = timer ? sleepLeft(timer, now) : null;
  const gVol = groupVolume(s);
  const gLabel = groupLabel(s);

  return (
    <Shell side={side} extra={extra} stale={stale}>
      <div className="panel sound-panel">
        <div className="sound-plays" role="group" aria-label="Quick play" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {face.map((r) => {
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
                name={chipLabel(r.name)}
                sub={r.favorite ?? (typeof r.volume === 'number' ? `volume ${r.volume}` : 'routine')}
                action={() => play(r)}
              />
            );
          })}
          {face.length === 0 && <div className="sound-quiet s span-all">No music routines in the Sonos service yet.</div>}
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
          {face.length > 0 && face.length < 2 && !more.length && !extraControls.length && (
            <div className="sound-quiet xs fill">More music routines from the Sonos service show here.</div>
          )}
        </div>

        <div className="sound-line">
          {presets.length > 0 && (
            <div className="sound-where" role="radiogroup" aria-label="Where">
              <span className="sound-lbl">Where</span>
              {presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={p.active}
                  className={p.active ? 'seg on' : 'seg'}
                  title={p.active ? `${p.name}: the speakers are grouped this way now` : `Group the speakers as ${p.name}`}
                  disabled={locked}
                  {...once(() => applyPreset(p))}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
          <span className="sound-now s" title={s.nowPlaying?.track ? nowLine(s) : playing.map((p) => p.name).join(', ') || 'Nothing playing'}>
            {nowLine(s)}
          </span>
          {playing.length > 0 ? (
            <button type="button" className="sound-btn" title="Pause every Sonos speaker" disabled={locked} {...once(pauseAll)}>
              <IconPlayerPauseFilled size={22} aria-hidden="true" />
              Sonos off
            </button>
          ) : (
            <button
              type="button"
              className="sound-btn cy"
              title={suggested ? `Start ${suggested.name}, the suggestion for this hour` : 'No routine fits this hour; pick one above'}
              disabled={locked || !suggested}
              {...once(() => suggested && play(suggested))}
            >
              <IconPlayerPlayFilled size={22} aria-hidden="true" />
              {suggested ? `Play ${chipLabel(suggested.name)}` : 'Play'}
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
function Chip({
  className,
  title,
  disabled,
  tag,
  name,
  sub,
  action,
}: {
  className: string;
  title: string;
  disabled: boolean;
  tag: ReactNode;
  name: string;
  sub: string;
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
    <button type="button" className={two ? `${className} two` : className} title={title} disabled={disabled} {...once(action)}>
      {tag}
      <b ref={nameRef} className="sound-chip-name">
        {name}
      </b>
      {!two && <span className="sound-chip-sub">{sub}</span>}
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

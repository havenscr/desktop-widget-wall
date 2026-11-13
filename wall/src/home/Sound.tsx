import {
  IconDeviceSpeaker,
  IconDots,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconVolume,
  IconX,
  IconZzz,
} from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { invoke } from '../bridge/tauri';
import { NOT_CONFIGURED } from '../tasks/model';
import {
  LAST_PLAY_MS,
  NEEDS_CONFIRM,
  SAFE_VOLUME,
  SLEEP_CHOICES,
  ageWords,
  chipLabel,
  groupLabel,
  groupMusicSpeakers,
  groupVolume,
  inputWord,
  musicPlaying,
  needsConfirm,
  nowLine,
  orderPresets,
  readLastPlay,
  sleepLeft,
  speakerState,
  splitRoutines,
  startedText,
  suggestedKey,
  writeLastPlay,
  type MusicRoutine,
  type SonosSpeaker,
  type SonosSummary,
  type VolumeTarget,
} from './soundModel';
import { clock, useSonos } from './useSonos';

export const RESULT_MS = 4000;
/** The service needs a moment after a command before its status shows the change. */
export const SETTLE_MS = 1500;

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

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The Sound block on Home: quick-play buttons for the Sonos service's music routines (six
 * on the face, the rest under More), the hour's suggestion, a Where switch for the group
 * presets, one volume slider for the group that plays, a Speakers list with a slider each,
 * play or pause, and a sleep timer. Nothing plays or changes volume without a click, and
 * a raise above 40 asks first. A read that is not live dims the block and stops writes.
 */
export function Sound() {
  const { status, summary, okAt, now, stale, refresh } = useSonos();

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

function Shell({ side, stale = false, bare = false, children }: { side: Result | null; stale?: boolean; bare?: boolean; children: ReactNode }) {
  const cls = ['sound', stale ? 'stale' : '', bare ? 'bare' : ''].filter(Boolean).join(' ');
  return (
    <section className={cls} aria-label="Sound">
      <div className="sound-head">
        <span className="k">Sound</span>
        {side && (
          <span className={side.warn ? 'xs warn-text' : 'xs sound-result'} role="status">
            {side.text}
          </span>
        )}
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
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [pop, setPop] = useState<Pop>(null);
  const [last, setLast] = useState(readLastPlay);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const resultTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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

  /** Runs one write: busy while it runs, a brief result after, a fresh read a moment later. */
  const run = useCallback(
    async (id: string, call: (confirmed: boolean) => Promise<unknown>, ok: string, opts: { confirmed?: boolean; ask?: string; done?: () => void; undo?: () => void } = {}) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(id);
      setConfirm(null);
      try {
        await call(opts.confirmed ?? false);
        if (!mounted.current) return;
        opts.done?.();
        show(ok);
        void refresh();
        timers.current.push(setTimeout(() => void refresh(), SETTLE_MS));
      } catch (e) {
        if (!mounted.current) return;
        const text = errText(e);
        if (text === NEEDS_CONFIRM) {
          setConfirm({
            text: opts.ask ?? 'This raises the volume above 40. Go ahead?',
            yes: 'Yes',
            go: () => void run(id, call, ok, { ...opts, confirmed: true }),
            no: opts.undo,
          });
        } else {
          opts.undo?.();
          if (text === NOT_CONFIGURED) void refresh();
          show(text || 'Could not reach Sonos', true);
        }
      } finally {
        busyRef.current = false;
        if (mounted.current) setBusy(null);
      }
    },
    [refresh, show],
  );

  const locked = stale || busy !== null;
  const { face, more } = splitRoutines(s.music);
  const suggestion = suggestedKey(s.music, new Date(now));
  const playing = musicPlaying(s);
  const started = last && playing.length > 0 && now - last.at < LAST_PLAY_MS ? last : null;
  const presets = orderPresets(s.presets);
  const extraControls = s.controls.filter((c) => c.action !== 'pauseAll');

  const play = (r: MusicRoutine) => {
    const label = chipLabel(r.name);
    const ask = `${r.name} starts at volume ${r.volume ?? '?'}, above 40. Start it?`;
    const go = (confirmed: boolean) =>
      void run(`play:${r.key}`, (c) => invoke('wall2_sonos_play', c ? { routineKey: r.key, confirm: true } : { routineKey: r.key }), `Playing ${label}`, {
        confirmed,
        ask,
        done: () => {
          const at = clock();
          writeLastPlay(r.key, at);
          setLast({ key: r.key, at });
        },
      });
    setPop(null);
    if ((r.volume ?? 0) > SAFE_VOLUME) setConfirm({ text: ask, yes: 'Start', go: () => go(true) });
    else go(false);
  };

  const setVolume = (target: VolumeTarget, speakers: SonosSpeaker[], level: number, label: string, undo: () => void) => {
    const ask = `Set ${label} to ${level}? That is louder than 40.`;
    const go = (confirmed: boolean) =>
      void run(
        `vol:${target.kind}:${target.id}`,
        (c) => invoke('wall2_sonos_volume', c ? { target, level, confirm: true } : { target, level }),
        `${label} volume ${level}`,
        { confirmed, ask, undo },
      );
    if (needsConfirm(speakers, level)) setConfirm({ text: ask, yes: `Set ${level}`, go: () => go(true), no: undo });
    else go(false);
  };

  const pauseAll = () => void run('pause', () => invoke('wall2_sonos_pause_all'), 'Paused every speaker');
  const suggested = s.music.find((r) => r.key === suggestion) ?? face[0] ?? null;

  let side: Result | null = result;
  if (!side && stale) side = { text: okAt ? `Sonos not reachable, showing ${ageWords(okAt, now)}` : 'Sonos not reachable', warn: true };

  const cols = Math.max(face.length + (more.length || extraControls.length ? 1 : 0), 3);
  const timer = s.sleepTimers[0] ?? null;
  const left = timer ? sleepLeft(timer, now) : null;
  const gVol = groupVolume(s);
  const gLabel = groupLabel(s);

  return (
    <Shell side={side} stale={stale}>
      <div className="panel sound-panel">
        <div className="sound-plays" role="group" aria-label="Quick play" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {face.map((r) => {
            const isStarted = started?.key === r.key;
            const isSug = !isStarted && r.key === suggestion;
            const cls = ['sound-chip', isStarted ? 'on' : '', isSug ? 'sug' : '', busy === `play:${r.key}` ? 'working' : ''].filter(Boolean).join(' ');
            const tip = [`Play ${r.name}`, r.favorite ? `(${r.favorite})` : '', typeof r.volume === 'number' ? `at volume ${r.volume}` : '', isSug ? '. Suggested for this hour' : '']
              .filter(Boolean)
              .join(' ');
            return (
              <button key={r.key} type="button" className={cls} title={tip} disabled={locked} onClick={() => play(r)}>
                {isStarted && <u className="sound-tag on">{startedText(started.at, now)}</u>}
                {isSug && <u className="sound-tag sug">Suggested</u>}
                <b className="sound-chip-name">{chipLabel(r.name)}</b>
                <span className="sound-chip-sub">{r.favorite ?? (typeof r.volume === 'number' ? `volume ${r.volume}` : 'routine')}</span>
              </button>
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
                <Popup label="More routines" onClose={() => setPop(null)} right down wide>
                  {more.length > 0 && <div className="k">Music</div>}
                  <div className="sound-more-list">
                    {more.map((r) => (
                      <button key={r.key} type="button" className="sound-row-btn" title={`Play ${r.name}${r.favorite ? ` (${r.favorite})` : ''}`} disabled={locked} onClick={() => play(r)}>
                        <b>{r.name}</b>
                        <span className="xs">{[r.favorite, typeof r.volume === 'number' ? `volume ${r.volume}` : null].filter(Boolean).join(', ')}</span>
                      </button>
                    ))}
                  </div>
                  {extraControls.length > 0 && <div className="k">Speakers</div>}
                  <div className="sound-more-list">
                    {extraControls.map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        className="sound-row-btn"
                        title={`Run ${c.name}`}
                        disabled={locked}
                        onClick={() => {
                          setPop(null);
                          void run(`play:${c.key}`, () => invoke('wall2_sonos_play', { routineKey: c.key }), `Done: ${c.name}`);
                        }}
                      >
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
                  onClick={() => void run(`preset:${p.id}`, () => invoke('wall2_sonos_preset', { presetId: p.id }), `Speakers set to ${p.name}`)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
          <span className="sound-now s" title={s.nowPlaying?.track ? `${nowLine(s)}` : playing.map((p) => p.name).join(', ') || 'Nothing playing'}>
            {nowLine(s)}
          </span>
          {playing.length > 0 ? (
            <button type="button" className="sound-btn" title="Pause every Sonos speaker" disabled={locked} onClick={pauseAll}>
              <IconPlayerPauseFilled size={22} aria-hidden="true" />
              Sonos off
            </button>
          ) : (
            <button
              type="button"
              className="sound-btn cy"
              title={suggested ? `Start ${suggested.name}${suggested.key === suggestion ? ', the suggestion for this hour' : ''}` : 'No music routine to start'}
              disabled={locked || !suggested}
              onClick={() => suggested && play(suggested)}
            >
              <IconPlayerPlayFilled size={22} aria-hidden="true" />
              Play
            </button>
          )}
        </div>

        <div className="sound-line">
          <IconVolume className="sound-vol-icon" size={26} stroke={1.8} aria-hidden="true" />
          {gLabel && gVol !== null && s.currentGroup ? (
            <VolumeSlider
              key={`${s.currentGroup}:${gVol}:${s.readAtMs}`}
              className="sound-vol"
              label={gLabel}
              title={`Volume for ${groupMusicSpeakers(s, s.currentGroup)
                .map((sp) => sp.name)
                .join(', ')}`}
              value={gVol}
              disabled={locked}
              onCommit={(level, undo) => setVolume({ kind: 'group', id: s.currentGroup! }, groupMusicSpeakers(s, s.currentGroup), level, gLabel, undo)}
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
              <Popup label="Speakers" onClose={() => setPop(null)} right wide>
                <div className="sound-spk-list">
                  {s.speakers.map((sp) => (
                    <SpeakerRow key={`${sp.name}:${sp.volume}:${s.readAtMs}`} sp={sp} disabled={locked} onCommit={(level, undo) => setVolume({ kind: 'speaker', id: sp.name }, [sp], level, sp.name, undo)} />
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
                onClick={() => void run('sleep-cancel', () => invoke('wall2_sonos_sleep_cancel', { id: timer.id }), 'Sleep timer off')}
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
              <Popup label="Sleep timer" onClose={() => setPop(null)} right>
                <div className="sound-sleep-opts">
                  {SLEEP_CHOICES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className="sound-btn"
                      title={`Pause every speaker in ${m} minutes, fading over the last 5`}
                      disabled={locked}
                      onClick={() => {
                        setPop(null);
                        void run('sleep', () => invoke('wall2_sonos_sleep', { minutes: m }), `Sleep in ${m} min`);
                      }}
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
          <div className="sound-confirm" role="alertdialog" aria-label="Confirm volume">
            <span className="s">{confirm.text}</span>
            <button type="button" className="sound-btn cy" onClick={confirm.go}>
              {confirm.yes}
            </button>
            <button
              type="button"
              className="sound-btn"
              onClick={() => {
                confirm.no?.();
                setConfirm(null);
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

/** Arrow keys settle for this long before the one change is sent. */
export const KEY_SETTLE_MS = 400;

/**
 * A slider that sends one change when the pointer lets go (or the arrow keys settle),
 * never while dragging, and never the same level twice.
 */
function VolumeSlider({
  value,
  label,
  title,
  disabled,
  className,
  onCommit,
}: {
  value: number;
  label: string;
  title: string;
  disabled: boolean;
  className?: string;
  onCommit: (level: number, undo: () => void) => void;
}) {
  const [v, setV] = useState(value);
  const vRef = useRef(value);
  const sent = useRef(value);
  const keyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(keyTimer.current), []);
  const commit = () => {
    clearTimeout(keyTimer.current);
    const level = vRef.current;
    if (level === sent.current) return;
    sent.current = level;
    onCommit(level, () => {
      sent.current = value;
      vRef.current = value;
      setV(value);
    });
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
        onPointerUp={commit}
        onKeyUp={() => {
          clearTimeout(keyTimer.current);
          keyTimer.current = setTimeout(commit, KEY_SETTLE_MS);
        }}
        onBlur={commit}
      />
      <b className={v > SAFE_VOLUME ? 'sound-slider-v loud' : 'sound-slider-v'}>{v}</b>
    </label>
  );
}

function SpeakerRow({ sp, disabled, onCommit }: { sp: SonosSpeaker; disabled: boolean; onCommit: (level: number, undo: () => void) => void }) {
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
          onClick={() => invoke('open_volume_mixer').catch(() => setFailed(true))}
        >
          {failed ? 'Could not open' : 'PC volume'}
        </button>
      ) : sp.online && typeof sp.volume === 'number' ? (
        <VolumeSlider value={sp.volume} label="" title={`${sp.name} volume`} disabled={disabled} onCommit={onCommit} />
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
    const down = (e: PointerEvent) => {
      const anchor = ref.current?.parentElement;
      if (anchor && !anchor.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);
  return (
    <div ref={ref} className={['sound-pop', right ? 'right' : '', down ? 'down' : '', wide ? 'wide' : ''].filter(Boolean).join(' ')} role="dialog" aria-label={label}>
      {children}
    </div>
  );
}

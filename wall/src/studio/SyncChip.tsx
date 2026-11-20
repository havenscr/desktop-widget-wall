import { IconAdjustmentsHorizontal, IconAlertTriangle, IconChevronUp, IconLoader2, IconPalette, IconWaveSine } from '@tabler/icons-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { readCoverStrips } from '../music/coverTint';
import { useNowPlayingStore } from '../music/store';
import { useWatchStore } from '../unwind/watch/store';
import { tip } from '../ui/HoverTip';
import { CUSTOM_MAX, CUSTOM_MIN, PALETTES, SWATCHES, type PaletteEntry } from './lightsync/model';
import { attachPoll, isOn, useLightSync } from './lightsync/store';
import { SYNC_WORD, syncChipModel, syncTip, type SyncChipInput } from './moodRow';

const gradient = (c: readonly string[]): string => (c.length === 0 ? 'transparent' : c.length === 1 ? c[0] : `linear-gradient(135deg, ${c.join(', ')})`);

/** What the chip and its tip are drawn from, read from the store. */
export function useSyncInput(): SyncChipInput & { on: boolean } {
  const starting = useLightSync((s) => s.starting);
  const running = useLightSync((s) => s.status?.running === true);
  const failure = useLightSync((s) => s.failure);
  const palette = useLightSync((s) => s.palette);
  const on = useLightSync((s) => isOn(s));
  const name = PALETTES.find((p) => p.id === palette)?.name ?? 'Synthwave';
  return { starting, running, failure, paletteName: name, hueNote: false, on };
}

export function SyncTip() {
  // Drawn from the store as it is when the tip shows; "Stopped Hue Sync" is taken here, so it shows once.
  const [hue, setHue] = useState(false);
  useEffect(() => {
    if (useLightSync.getState().takeHueNote()) setHue(true);
  }, []);
  const s = useLightSync.getState();
  const name = PALETTES.find((p) => p.id === s.palette)?.name ?? 'Synthwave';
  const t = syncTip({ starting: s.starting, running: s.status?.running === true, failure: s.failure, paletteName: name, hueNote: hue });
  return (
    <span className="u-mood-tip">
      <span>{t.first}</span>
      {t.second && <span className={t.warn ? 'u-mood-warn' : undefined}>{t.second}</span>}
    </span>
  );
}

/** The Music sync chip: the name starts and stops sync; the dots open the palette strip. Fixed width (`SYNC_WIDTH`). */
export function SyncChip({ blocked }: { blocked: boolean }) {
  const input = useSyncInput();
  const open = useLightSync((s) => s.stripOpen);
  const palette = useLightSync((s) => s.palette);
  // The first read: sync may already be running (the page was reopened, or a key started it).
  useEffect(() => {
    const detach = attachPoll();
    void useLightSync.getState().poll();
    return detach;
  }, []);
  const m = syncChipModel(input);
  const entry = PALETTES.find((p) => p.id === palette) ?? PALETTES[0];
  const dots = entry.swatch.slice(0, 3);
  return (
    <div className={`u-mood u-sync${m.lit ? ' lit' : ''}${m.failed ? ' failed' : ''}${open ? ' open' : ''}`} data-mood="sync" data-state={m.busy ? 'starting' : m.failed ? 'failed' : m.lit ? 'on' : 'off'}>
      <button
        type="button"
        className="u-sync-main"
        data-part="sync-main"
        aria-pressed={m.lit}
        aria-disabled={blocked ? 'true' : undefined}
        onClick={() => void useLightSync.getState().toggle()}
        {...tip(() => <SyncTip />)}
      >
        {m.failed ? <IconAlertTriangle className="u-mood-ico warn" size={18} stroke={2} aria-hidden="true" /> : m.busy ? <IconLoader2 className="u-mood-ico u-spin" size={18} stroke={2} aria-hidden="true" /> : <IconWaveSine size={18} stroke={2} aria-hidden="true" />}
        <span className="u-mood-name">{SYNC_WORD}</span>
      </button>
      <button
        type="button"
        className="u-sync-dots"
        data-part="sync-dots"
        aria-label={`Colours: ${entry.name}`}
        aria-expanded={open}
        onClick={() => useLightSync.getState().openStrip(!open)}
        {...tip(() => <span className="u-mood-tip"><span>{`Colours: ${entry.name}`}</span><span>Click to choose how the lights are coloured.</span></span>)}
      >
        {dots.map((c, i) => (
          <span key={i} className="u-sync-dot" aria-hidden="true" style={{ background: c } as CSSProperties} />
        ))}
        <IconChevronUp className="u-sync-chev" size={16} stroke={2} aria-hidden="true" />
      </button>
    </div>
  );
}

function Pal({ p, picked, swatch }: { p: PaletteEntry; picked: boolean; swatch: readonly string[] }) {
  return (
    <button
      type="button"
      className={`u-pal${picked ? ' picked' : ''}${p.enabled ? '' : ' dis'}`}
      data-palette={p.id}
      aria-pressed={picked}
      aria-disabled={p.enabled ? undefined : 'true'}
      onClick={() => {
        if (p.enabled) useLightSync.getState().setPalette(p.id);
      }}
      {...tip(() => <span className="u-mood-tip"><span>{p.name}</span><span>{p.tip}</span></span>)}
    >
      <span className="u-pal-sw" aria-hidden="true" style={{ background: gradient(swatch) } as CSSProperties} />
      <span className="u-mood-name">{p.name}</span>
    </button>
  );
}

/** The palette strip: every palette with its name; one click picks and closes it. */
export function PaletteStrip() {
  const open = useLightSync((s) => s.stripOpen);
  const palette = useLightSync((s) => s.palette);
  const custom = useLightSync((s) => s.custom);
  if (!open) return null;
  return (
    <div className="u-pal-strip" role="group" aria-label="Music sync colours" data-part="palette-strip">
      {PALETTES.map((p) => (
        <Pal key={p.id} p={p} picked={p.id === palette} swatch={p.id === 'custom' ? custom : p.swatch} />
      ))}
      <button
        type="button"
        className="u-pal-set"
        data-part="palette-settings"
        aria-label="Settings"
        onClick={() => {
          useLightSync.getState().openStrip(false);
          useWatchStore.getState().setSheet(true, 'lights');
        }}
        {...tip(() => <span className="u-mood-tip"><span>Settings</span><span>Colour speed, brightness, kick flash and more, for every palette.</span></span>)}
      >
        <IconAdjustmentsHorizontal size={18} stroke={2} aria-hidden="true" />
      </button>
    </div>
  );
}

const SLOTS = Array.from({ length: CUSTOM_MAX }, (_, i) => i);

/** Custom colours (4C): keep the cover now playing, swap any with one of 24 swatches; three to five colours. */
export function CustomPicker() {
  const open = useLightSync((s) => s.customOpen);
  const custom = useLightSync((s) => s.custom);
  const art = useNowPlayingStore((s) => s.art);
  const [cover, setCover] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    setCover([]);
    if (open && art) {
      void readCoverStrips(art, CUSTOM_MAX).then((c) => {
        if (alive && c) setCover(c.map((v) => '#' + v.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')));
      });
    }
    return () => {
      alive = false;
    };
  }, [open, art]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useLightSync.getState().openCustom(false);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t && !ref.current?.contains(t) && !t.closest?.('[data-palette="custom"], [data-part="sync-dots"]')) useLightSync.getState().openCustom(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);
  if (!open) return null;
  const note = custom.length < CUSTOM_MIN ? `Pick ${CUSTOM_MIN - custom.length} more to use your own colours.` : 'Keep the cover now playing, then add or swap with swatches.';
  return (
    <div className="u-custom" role="dialog" aria-label="Custom colours" data-part="custom-picker" ref={ref}>
      <div className="u-k">Custom colours</div>
      <div className="uc-row">
        <span className="uc-label">Your colours</span>
        <span className="uc-mine" role="list" aria-label="Your colours">
          {SLOTS.map((i) =>
            custom[i] ? (
              <button
                key={i}
                type="button"
                role="listitem"
                className="uc-dot mine"
                data-colour={custom[i]}
                aria-label={`Take out ${custom[i]}`}
                style={{ background: custom[i] } as CSSProperties}
                onClick={() => useLightSync.getState().toggleCustom(custom[i])}
                {...tip(custom.length <= CUSTOM_MIN ? `${custom[i]}: keep at least ${CUSTOM_MIN} colours. Add another first to swap it.` : `${custom[i]}: click to take it out.`)}
              />
            ) : (
              <span key={i} role="listitem" className="uc-dot empty" aria-label="Empty slot" />
            ),
          )}
        </span>
      </div>
      <div className="uc-cover">
        <span className="uc-art" aria-hidden="true">
          {art ? <img src={art} alt="" /> : null}
        </span>
        <span className="uc-side">
        <span className="uc-from" aria-hidden="true">
          {cover.map((c, i) => (
            <i key={i} style={{ background: c } as CSSProperties} />
          ))}
        </span>
        <button
          type="button"
          className="uc-keep"
          data-part="keep-cover"
          aria-disabled={art ? undefined : 'true'}
          onClick={() => {
            if (art) void useLightSync.getState().keepCover();
          }}
          {...tip(art ? "Save the five colours of the cover now playing as your own. It replaces the colours you have." : 'Play something with a cover first, then keep its colours.')}
        >
          <IconPalette size={18} stroke={2} aria-hidden="true" />
          Keep this cover&apos;s colours
        </button>
        </span>
      </div>
      <div className="uc-grid" role="group" aria-label="Swatches">
        {SWATCHES.map((c) => {
          const mine = custom.includes(c);
          return (
            <button
              key={c}
              type="button"
              className={`uc-dot sw${mine ? ' mine' : ''}`}
              data-swatch={c}
              aria-label={c}
              aria-pressed={mine}
              style={{ background: c } as CSSProperties}
              onClick={() => useLightSync.getState().toggleCustom(c)}
              {...tip(mine ? `${c}: one of yours. Click to take it out.` : custom.length >= CUSTOM_MAX ? `${c}: you have five. Take one out first.` : `${c}: click to add it.`)}
            />
          );
        })}
      </div>
      <p className="uc-note">{note}</p>
    </div>
  );
}

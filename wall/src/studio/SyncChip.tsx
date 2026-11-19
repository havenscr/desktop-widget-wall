import { IconAlertTriangle, IconChevronUp, IconLoader2, IconWaveSine } from '@tabler/icons-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { tip } from '../ui/HoverTip';
import { PALETTES, type PaletteEntry } from './lightsync/model';
import { attachPoll, isOn, useLightSync } from './lightsync/store';
import { SYNC_WORD, syncChipModel, syncTip, type SyncChipInput } from './moodRow';

const NOT_YET = 'Your own colours come in a later update.';

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

function Pal({ p, picked }: { p: PaletteEntry; picked: boolean }) {
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
      {...tip(() => <span className="u-mood-tip"><span>{p.name}</span><span>{p.enabled ? p.tip : NOT_YET}</span></span>)}
    >
      <span className="u-pal-sw" aria-hidden="true" style={{ background: gradient(p.swatch) } as CSSProperties} />
      <span className="u-mood-name">{p.name}</span>
    </button>
  );
}

/** The palette strip: every palette with its name; one click picks and closes it. */
export function PaletteStrip() {
  const open = useLightSync((s) => s.stripOpen);
  const palette = useLightSync((s) => s.palette);
  if (!open) return null;
  return (
    <div className="u-pal-strip" role="group" aria-label="Music sync colours" data-part="palette-strip">
      {PALETTES.map((p) => (
        <Pal key={p.id} p={p} picked={p.id === palette} />
      ))}
    </div>
  );
}

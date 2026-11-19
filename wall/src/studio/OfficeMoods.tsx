import { IconAlertTriangle, IconArrowBackUp, IconBulb, IconLoader2, IconPower } from '@tabler/icons-react';
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { restZone, useWatchRest } from '../unwind/watch/rest';
import { tip } from '../ui/HoverTip';
import { useHome } from './homeStore';
import {
  BACK_FIXED,
  BACK_WORD,
  OFF_BUSY_EXTRA,
  backTip,
  OFF_FIXED,
  SYNC_WIDTH,
  chipTip,
  fitMoodRow,
  rowModel,
  type ChipModel,
  type Fit,
  type RowModel,
} from './moodRow';
import { useMoodsPolling } from './useMoodsPolling';
import { PaletteStrip, SyncChip } from './SyncChip';
import { isOn, useLightSync } from './lightsync/store';

const LABEL_WORD = 'Office moods';
/** The label pill's own parts: 9 px of padding each side, the 18 px bulb and its 8 px gap, letter spacing 3 px. */
const LABEL_PAD = 18 + 18 + 8;
const LABEL_TRACK = 3;

let canvas: CanvasRenderingContext2D | null | undefined;
/** The width of text in a font, by a canvas; a rough guess where there is no canvas (a test page). */
function textWidth(text: string, font: string): number {
  if (canvas === undefined) {
    try {
      // A test page (jsdom) has no canvas and says so loudly: it gets the rough guess.
      const test = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
      canvas = typeof document === 'undefined' || test ? null : document.createElement('canvas').getContext('2d');
    } catch {
      canvas = null;
    }
  }
  if (!canvas) return text.length * 9;
  canvas.font = font;
  return canvas.measureText(text).width;
}

/** The widths the fit rule needs, measured in the chip font, the label font and the Off chip's. */
function measure(row: RowModel, body: string, disp: string) {
  const chipFont = `500 17px ${body}`;
  const names = row.chips.filter((c) => c.id !== null).map((c) => textWidth(c.label, chipFont));
  const label = LABEL_PAD + textWidth(LABEL_WORD.toUpperCase(), `600 16px ${disp}`) + LABEL_TRACK * LABEL_WORD.length;
  const off = row.chips.some((c) => c.id === null) ? OFF_FIXED + OFF_BUSY_EXTRA + textWidth('Off', chipFont) : 0;
  const back = BACK_FIXED + textWidth(BACK_WORD, chipFont);
  return { names, label, off, back };
}

function Tip({ chip }: { chip: ChipModel }) {
  // The card is drawn from the store as it is when the card shows (and each time it is redrawn).
  const row = rowModel(useHome.getState());
  const c = row?.chips.find((x) => x.id === chip.id);
  if (!row || !c) return null;
  const t = chipTip(row, c);
  return (
    <span className="u-mood-tip">
      <span>{t.first}</span>
      {t.second && <span className={t.warn ? 'u-mood-warn' : undefined}>{t.second}</span>}
    </span>
  );
}

export function BackTip({ iconOnly }: { iconOnly: boolean }) {
  const row = rowModel(useHome.getState());
  if (!row) return null;
  const t = backTip(row, iconOnly);
  return (
    <span className="u-mood-tip">
      <span>{t.first}</span>
      {t.second && <span className={t.warn ? 'u-mood-warn' : undefined}>{t.second}</span>}
    </span>
  );
}

function Swatch({ chip }: { chip: ChipModel }) {
  if (chip.failed) return <IconAlertTriangle className="u-mood-ico warn" size={14} stroke={2} aria-hidden="true" />;
  if (chip.busy) return <IconLoader2 className="u-mood-ico u-spin" size={14} stroke={2} aria-hidden="true" />;
  if (!chip.swatch) return null;
  return (
    <span
      className="u-mood-dot"
      aria-hidden="true"
      style={{ background: chip.swatch.length === 1 ? chip.swatch[0] : `linear-gradient(135deg, ${chip.swatch[0]} 20%, ${chip.swatch[1]} 85%)`, '--glow': chip.swatch[chip.swatch.length - 1] } as CSSProperties}
    />
  );
}

export function Chip({ chip, row, cap, iconOnly, onClick }: { chip: ChipModel; row: RowModel; cap: number | null; iconOnly: boolean; onClick: () => void }) {
  const off = chip.id === null;
  const hasIcon = chip.failed || chip.busy;
  return (
    <button
      type="button"
      className={`u-mood${off ? ' off' : ''}${iconOnly ? ' icon-only' : ''}${chip.lit ? ' lit' : ''}${chip.failed ? ' failed' : ''}${row.blocked ? ' blocked' : ''}`}
      data-mood={off ? 'off' : chip.id}
      aria-label={iconOnly ? 'Off' : undefined}
      aria-pressed={chip.lit}
      aria-disabled={row.blocked ? 'true' : undefined}
      data-busy={chip.busy ? 'true' : undefined}
      onClick={onClick}
      {...tip(() => <Tip chip={chip} />)}
    >
      {(off ? hasIcon : true) && <Swatch chip={chip} />}
      {iconOnly && !hasIcon && <IconPower size={18} stroke={2} aria-hidden="true" />}
      {!iconOnly && (
        <span className="u-mood-name" style={cap !== null && !off ? ({ maxWidth: `${cap}px` } as CSSProperties) : undefined}>
          {chip.label}
        </span>
      )}
    </button>
  );
}

/**
 * The Office moods row at the foot of Unwind: a label, one chip per mood the home app lists, an Off chip only
 * when the home app offers it, and, only for a refusal or a failure, the amber line above the row's left part (the plain status stays a screen reader live region). It is the
 * `office-lights` slot itself: hidden states leave the empty 420 by 34 box the older rules know. Chips show
 * the home app's last read back, never the clicked value. See "Office moods" in `wall/README.md`.
 */
export function OfficeMoods() {
  const moods = useHome((s) => s.moods);
  const moodsWord = useHome((s) => s.moodsWord);
  const applying = useHome((s) => s.applying);
  const moodFail = useHome((s) => s.moodFail);
  const sticky = useHome((s) => s.sticky);
  useMoodsPolling();
  const restNow = useWatchRest((s) => s.rest);
  const row = rowModel({ moods, moodsWord, applying, moodFail, sticky });
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<Fit>({ label: true, cap: null, backIcon: false, offIcon: false, clip: false });
  const [fontsAt, setFontsAt] = useState(0);
  useLayoutEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) return;
    const again = () => setFontsAt((n) => n + 1);
    document.fonts.addEventListener?.('loadingdone', again);
    return () => document.fonts.removeEventListener?.('loadingdone', again);
  }, []);
  // The key of what the fit depends on: the names and whether Off is there.
  const key = row ? row.chips.map((c) => c.label).join('\u0001') : '';
  useLayoutEffect(() => {
    if (!row || !box.current) return;
    const cs = getComputedStyle(document.documentElement);
    const body = cs.getPropertyValue('--body').trim() || 'sans-serif';
    const disp = cs.getPropertyValue('--disp').trim() || 'sans-serif';
    const m = measure(row, body, disp);
    const next = fitMoodRow(m.names, m.label, m.off, m.back, SYNC_WIDTH);
    setFit((f) => (f.label === next.label && f.cap === next.cap && f.backIcon === next.backIcon && f.offIcon === next.offIcon && f.clip === next.clip ? f : next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fontsAt]);

  if (!row) return <div className="u-office-slot" data-slot="office-lights" aria-hidden="true" />;

  const click = (chip: ChipModel) => {
    // Nothing is sent while this PC may not write or a write is out; the native side checks again.
    if (row.blocked || row.waiting) return;
    const ls = useLightSync.getState();
    if (ls.starting || ls.stopping) return;
    const apply = () => {
      const st = useHome.getState();
      return chip.id === null ? st.applyOff() : st.applyMood(chip.id);
    };
    // Sync running: it stops first, without Lights back; then the chosen mood (or Off) is applied.
    void (isOn(ls) ? ls.stop().then(() => (useLightSync.getState().failure === null ? apply() : undefined)) : apply());
  };
  const goBack = () => {
    if (row.blocked || row.waiting || !row.canBack) return;
    void useHome.getState().goBackFromMood();
  };
  const line = row.line;
  // Rests with the Watch controls (same timing); a failure line (5 seconds) holds it in view. The chips never fade.
  const resting = restNow && moodFail === null;
  return (
    <>
      <div className="u-office-slot" data-slot="office-lights" data-moods="shown" data-stale={row.stale ? 'true' : undefined} role="group" aria-label={LABEL_WORD} ref={box} {...restZone('moods-row')}>
        {fit.label && (
          <span className="u-mood-label" data-part="label">
            <IconBulb size={18} aria-hidden="true" />
            <span>{LABEL_WORD}</span>
          </span>
        )}
        <PaletteStrip />
        <SyncChip blocked={false} />
        <div className="u-mood-run" data-clip={fit.clip ? 'true' : undefined}>
        {row.chips.map((c) => (
          <Chip key={c.id ?? 'office-off'} chip={c} row={row} cap={fit.cap} iconOnly={c.id === null && fit.offIcon} onClick={() => click(c)} />
        ))}
        <button
          type="button"
          className={`u-mood u-mood-back${fit.backIcon ? ' icon-only' : ''}${row.canBack ? '' : ' dis'}${row.blocked ? ' blocked' : ''}`}
          data-mood="back"
          aria-label={fit.backIcon ? BACK_WORD : undefined}
          aria-disabled={row.canBack && !row.blocked ? undefined : 'true'}
          onClick={goBack}
          {...tip(() => <BackTip iconOnly={fit.backIcon} />)}
        >
          <IconArrowBackUp size={18} stroke={2} aria-hidden="true" />
          {!fit.backIcon && <span className="u-mood-name">{BACK_WORD}</span>}
        </button>
        </div>
      </div>
      {/* The plain status (what is on, off, asking) is the chips' and the tips' job; the screen reader still hears it here. */}
      <div className="u-office-live" role="status" aria-live="polite" data-part="live">
        {line.lead}
        {line.rest}
      </div>
      {line.warn && (
        <div className="u-office-line warn" data-part="line" data-rest={resting ? 'true' : 'false'} aria-hidden="true" {...restZone('moods-line')}>
          {line.lead && <b>{line.lead}</b>}
          <span>{line.rest}</span>
        </div>
      )}
    </>
  );
}

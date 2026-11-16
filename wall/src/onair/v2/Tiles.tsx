import { IconBookmark, IconKeyboard, type Icon } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { tip } from '../../ui/HoverTip';
import { KeyIcon } from '../../work/keyIcons';
import { libKeyKind } from '../../work/keyKind';
import { keyboardOnMouseKey } from '../../work/keyPress';
import { resolveKey } from '../RightColumn';
import type { DeckKeys } from './useDeckKeys';

/** A heading row: an icon, the label, and text at the right. A press result takes the label's place for a few seconds. */
export function Head({ label, right, icon, brief }: { label: string; right?: ReactNode; icon?: ReactNode; brief?: string | null }) {
  return (
    <div className="oa2-hd">
      {icon}
      {brief ? (
        <span className="oa2-brief ellipsis" role="status" {...tip(brief)}>
          {brief}
        </span>
      ) : (
        <span className="k">{label}</span>
      )}
      {right !== undefined && <span className="oa2-hd-r ellipsis">{right}</span>}
    </div>
  );
}

/** One tile of a row. A library key is drawn as the deck draws it; `off` says why it does nothing now. */
export interface TileSpec {
  /** The key library id, sent by `wall2_keys_send_library`. */
  id: string;
  /** What the guard and the result line call this press; defaults to `onair:<id>`. */
  pressId?: string;
  label?: string;
  icon?: Icon;
  /** Drawn plain and dashed-off, with this as its hover card; a press shows it as the result line. */
  off?: string;
  /** Lit red, as Stop is while a recorder runs. */
  stop?: boolean;
}

/** The face of a tile that does nothing now. */
export function OffTile({ label, icon: I, why, keys }: { label: string; icon: Icon | null; why: string; keys: DeckKeys }) {
  return (
    <button type="button" className="deck-tile key-tile off" aria-label={label} aria-disabled="true" onClick={() => keys.showBrief(why)} {...tip(why)}>
      {I ? <I size={22} stroke={1.8} aria-hidden="true" /> : <IconKeyboard size={22} stroke={1.8} aria-hidden="true" />}
      <span className="deck-lbl">{label}</span>
    </button>
  );
}

export function LibTile({ keys, spec }: { keys: DeckKeys; spec: TileSpec }) {
  const k = keys.groups ? resolveKey(spec.id, keys.groups) : null;
  if (!k) return <OffTile keys={keys} label={spec.label ?? spec.id} icon={spec.icon ?? null} why={`The key library has no runnable key "${spec.id}"`} />;
  const label = spec.label ?? k.label;
  const I = spec.icon ?? k.recordingIcon;
  if (spec.off) return <OffTile keys={keys} label={label} icon={I} why={spec.off} />;
  return (
    <button
      type="button"
      className="deck-tile key-tile"
      data-kind={libKeyKind(k.group, k.id, k.action)}
      data-rec={spec.stop ? 'stop' : undefined}
      aria-label={label}
      onKeyDown={keys.onKeyDown(k.action)}
      onClick={(e) => {
        if (keyboardOnMouseKey(k.action, e.detail)) return;
        void keys.press(spec.pressId ?? `onair:${k.id}`, e.detail, { command: 'wall2_keys_send_library', args: { id: k.id } }, label, k.action, k.where, false);
      }}
      {...tip(k.tip)}
    >
      {I ? <I size={22} stroke={1.8} aria-hidden="true" /> : <KeyIcon name={k.icon} size={22} />}
      <span className="deck-lbl">{label}</span>
    </button>
  );
}

/** Mark a moment as a tile: one line in marks.txt with the given time (none given: what today's On Air writes, the show timer's time) and the current part. A second click within a second counts once. */
export function MarkTile({ mark, showMs, marking }: { mark: (showMs?: number) => Promise<void>; showMs: number | undefined; marking: boolean }) {
  return (
    <button
      type="button"
      className="deck-tile key-tile"
      data-kind="focus"
      aria-label="Mark a moment"
      aria-busy={marking}
      onClick={(e) => {
        // One mark for a double click: the second click of a pair never counts.
        if (e.detail > 1) return;
        void mark(showMs);
      }}
      {...tip('Write this time and the current part to marks.txt, for cutting Shorts later. A second click within a second counts once.')}
    >
      <IconBookmark size={22} stroke={1.8} aria-hidden="true" />
      <span className="deck-lbl">Mark a moment</span>
    </button>
  );
}

/** The row of tiles, or the one quiet line that says the library is not there. */
export function TileRow({ keys, cols, children }: { keys: DeckKeys; cols: number; children: ReactNode }) {
  if (keys.groups === null) {
    return (
      <div className="s deck-quiet oa2-quiet" {...tip(keys.failed ? 'The key library could not be read. Reopen On Air to try again, or restart the wall if this stays.' : 'Reading the key library')}>
        {keys.failed ? 'Keys not available' : 'Loading keys'}
      </div>
    );
  }
  return (
    <div className="deck-tiles keys-tiles oa2-tiles" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {children}
    </div>
  );
}

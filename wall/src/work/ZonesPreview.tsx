import { useEffect, useState } from 'react';
import { invoke } from '../bridge/tauri';
import { tip } from '../ui/HoverTip';
import { arrangeReason, errorText } from './deckModel';

/** One zone as fractions of the big screen, numbered left to right (as the layout numbers them). */
export interface PreviewZone {
  n: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One window the layout would move. `app` is a program name, never a title. */
export interface PreviewMove {
  zone: number;
  app: string;
  why: 'rule' | 'recent';
}

/** What `wall2_arrange_preview` answers: read only, nothing moved. */
export interface ZonesPreviewData {
  zones: PreviewZone[];
  moves: PreviewMove[];
  stay: number;
}

/** The key's action that this card belongs to. */
export const ZONES_ACTION = 'layout:zones';

/** The map is drawn at the big screen's usual 32 to 9 shape. */
export const MAP_W = 520;
export const MAP_H = 146;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type Read = { state: 'loading' } | { state: 'fail'; text: string } | { state: 'ok'; data: ZonesPreviewData };

/** Reads the preview once, when the card opens. Nothing is moved by reading it. */
function usePreview(): Read {
  const [read, setRead] = useState<Read>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    invoke<ZonesPreviewData>('wall2_arrange_preview').then(
      (data) => live && setRead(data && Array.isArray(data.zones) && Array.isArray(data.moves) ? { state: 'ok', data } : { state: 'fail', text: arrangeReason('') }),
      (e) => live && setRead({ state: 'fail', text: arrangeReason(errorText(e)) }),
    );
    return () => {
      live = false;
    };
  }, []);
  return read;
}

const HINT = 'Right-click for more.';

/** The hover card of My zones: the big screen as a small map, each zone with its program and why. Its box is the
 * same size loading, failed and loaded, so the card never moves or grows after it is placed above its key. */
export function ZonesPreviewCard() {
  const read = usePreview();
  const ok = read.state === 'ok' ? read.data : null;
  const by = new Map((ok?.moves ?? []).map((m) => [m.zone, m]));
  const stay = ok?.stay ?? 0;
  const moves = ok?.moves.length ?? 0;
  const click = `Click to move ${moves === 1 ? 'it' : 'them'}.`;
  const left = stay > 0 ? `${plural(stay, 'other window stays', 'other windows stay')} where ${stay === 1 ? 'it is' : 'they are'}. ` : '';
  return (
    <div className="zp" style={{ width: MAP_W + 2 }}>
      <span className="zp-k">My zones preview</span>
      <span className="zp-t">
        {ok ? (
          <>
            <b>{plural(moves, 'window', 'windows')}</b> move on the big screen
          </>
        ) : (
          '\u00a0'
        )}
      </span>
      <div className="zp-map" style={{ width: MAP_W, height: MAP_H }}>
        {!ok && <span className="zp-note">{read.state === 'fail' ? read.text : 'Looking at your windows'}</span>}
        {ok?.zones.map((z) => {
          const m = by.get(z.n);
          return (
            <div
              key={z.n}
              className={`zp-zone${m ? '' : ' empty'}${m?.why === 'rule' ? ' rule' : ''}`}
              data-zone={z.n}
              style={{ left: z.x * MAP_W, top: z.y * MAP_H, width: z.w * MAP_W, height: z.h * MAP_H }}
            >
              <span className="zp-n">{z.n}</span>
              {m && (
                <span className="zp-c">
                  <span className="zp-app">{m.app}</span>
                  <span className="zp-why">{m.why === 'rule' ? 'your rule' : 'used last'}</span>
                </span>
              )}
            </div>
          );
        })}
      </div>
      <span className="zp-f">
        {ok ? (
          <>
            {left}
            <b>{click}</b>
          </>
        ) : (
          '\u00a0'
        )}
      </span>
      <span className="zp-f zp-hint">{HINT}</span>
    </div>
  );
}

/**
 * The hover card for a key. My zones, when its layout can run, shows the preview card; every other key (and
 * My zones when it is off) keeps its own words.
 */
export function previewTip(action: string | null, off: boolean, text: string) {
  return action === ZONES_ACTION && !off ? tip(<ZonesPreviewCard />) : tip(text);
}

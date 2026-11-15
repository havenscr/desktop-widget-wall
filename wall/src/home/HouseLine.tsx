import { IconHome } from '@tabler/icons-react';
import { tip } from '../ui/HoverTip';
import { HOUSE_REFRESH_MS, maxAge, useDeskHouse, type DeskRooms, type FeedState, type House } from './useDesk';

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (n: number) => WORDS[n] ?? String(n);

/** "68° inside. Lights on in two rooms." Parts with no reading are left out; null when nothing is known. */
export function houseText(insideF: number | null, lit: number | null): string | null {
  const parts: string[] = [];
  if (insideF !== null) parts.push(`${insideF}° inside.`);
  if (lit !== null) parts.push(lit === 0 ? 'All lights off.' : `Lights on in ${word(lit)} ${lit === 1 ? 'room' : 'rooms'}.`);
  return parts.length ? parts.join(' ') : null;
}

function timeText(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export interface HouseView {
  text: string;
  rooms: { id: string; name: string; on: boolean }[];
  stale: boolean;
  asOf: string | null;
}

/**
 * The house line from the two desk reads, or null to hide it: while the routes are absent
 * (the home app's change is not live), not set up, loading, or failed with nothing read.
 */
export function houseView(house: FeedState<House>, rooms: FeedState<DeskRooms>): HouseView | null {
  const h = house.data;
  if (!h) return null;
  const roomList = rooms.data?.rooms ?? [];
  const lit = h.litRooms ?? (rooms.data ? roomList.filter((r) => r.on).length : null);
  const text = houseText(h.insideF, lit);
  if (!text) return null;
  const old = house.readAt === null || house.now - house.readAt > maxAge(HOUSE_REFRESH_MS);
  const stale = house.status === 'error' || h.stale || old || (rooms.data !== null && (rooms.data.stale || rooms.status === 'error'));
  const at = h.observedAt ? Date.parse(h.observedAt) : NaN;
  const asOfMs = Number.isFinite(at) ? at : house.readAt;
  return { text, rooms: roomList, stale, asOf: stale && asOfMs !== null ? `as of ${timeText(asOfMs)}` : null };
}

/** The room dots' row: indented to the text, 424 px wide. */
export const ROOMS_ROW_PX = 424;
const DOT_PX = 17; // the dot and its gap to the name
const ROOM_GAP_PX = 18;
const NAME_CHAR_PX = 9.4;
const MORE_PX = 74;

type RoomDot = { id: string; name: string; on: boolean };

/**
 * The room dots that fit one line. When every room fits they stay in the home app's order.
 * When some would not, the lit rooms come first (those are the ones worth seeing) and the rest
 * are counted as "+N" at the end; their names go in that chip's hover card. Widths are close
 * estimates at 18 px; the fit check measures the real line.
 */
export function fitRooms(rooms: RoomDot[], maxPx = ROOMS_ROW_PX): { shown: RoomDot[]; hidden: RoomDot[] } {
  const w = (r: RoomDot) => DOT_PX + r.name.length * NAME_CHAR_PX;
  const total = rooms.reduce((n, r) => n + w(r), 0) + Math.max(0, rooms.length - 1) * ROOM_GAP_PX;
  if (total <= maxPx) return { shown: rooms, hidden: [] };
  const ordered = [...rooms.filter((r) => r.on), ...rooms.filter((r) => !r.on)];
  const shown: RoomDot[] = [];
  let used = 0;
  for (const r of ordered) {
    const next = used + (shown.length ? ROOM_GAP_PX : 0) + w(r);
    if (next + ROOM_GAP_PX + MORE_PX > maxPx) break;
    shown.push(r);
    used = next;
  }
  return { shown, hidden: ordered.slice(shown.length) };
}

/** "68° inside." in bold and the rest plain, as the row draws it. */
function Lead({ text }: { text: string }) {
  const m = /^(\d+° inside\.)(.*)$/.exec(text);
  if (!m) return <>{text}</>;
  return (
    <>
      <b>{m[1]}</b>
      {m[2]}
    </>
  );
}

/**
 * Home's house row under the weather row: the temperature and lit rooms, then a dot per room.
 * Hidden while the home app's desk routes are absent; dimmed with "as of" when not live.
 */
export function HouseLine() {
  const { house, rooms } = useDeskHouse();
  const v = houseView(house, rooms);
  if (!v) return null;
  const { shown, hidden } = fitRooms(v.rooms);
  const asOf = v.asOf ? `, ${v.asOf}` : '';
  return (
    <div className={v.stale ? 'lw-house house stale' : 'lw-house house'} aria-label="House">
      <div className="lw-row" {...tip(`Inside temperature and lit rooms from the home app${asOf}.`)}>
        <span className="lw-glyph dim">
          <IconHome size={22} stroke={1.7} aria-hidden="true" />
        </span>
        <span className="lw-text house-line">
          <Lead text={v.text} />
        </span>
        {v.asOf && <span className="lw-side house-asof">{v.asOf}</span>}
      </div>
      {v.rooms.length > 0 && (
        <div className="house-rooms">
          {shown.map((r) => (
            <span key={r.id} className={r.on ? 'house-room on' : 'house-room'} {...tip(`${r.name}: ${r.on ? 'lights on' : 'lights off'}${asOf}`)}>
              <i aria-hidden="true" />
              {r.name}
            </span>
          ))}
          {hidden.length > 0 && (
            <span className="house-room more" {...tip(hidden.map((r) => `${r.name}: ${r.on ? 'lights on' : 'lights off'}`).join(', ') + asOf)}>
              +{hidden.length} more
            </span>
          )}
        </div>
      )}
      {/* The "Next" automation line goes here once the home app has a routine schedule:
          `/api/desk/schedule/today` answers `source: "none"` today, and the wall never guesses one. */}
    </div>
  );
}

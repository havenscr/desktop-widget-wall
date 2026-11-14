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

/** Home's house line under Sunset: the temperature and lit rooms, then a dot per room. */
export function HouseLine() {
  const { house, rooms } = useDeskHouse();
  const v = houseView(house, rooms);
  if (!v) return null;
  return (
    <div className={v.stale ? 'home-blk house stale' : 'home-blk house'} aria-label="House">
      <span className="k">
        House{v.asOf && <span className="house-asof">{v.asOf}</span>}
      </span>
      <div className="t3 house-line">{v.text}</div>
      {v.rooms.length > 0 && (
        <div className="house-rooms">
          {v.rooms.map((r) => (
            <span key={r.id} className={r.on ? 'house-room on' : 'house-room'} {...tip(`${r.name}: ${r.on ? 'lights on' : 'lights off'}${v.asOf ? `, ${v.asOf}` : ''}`)}>
              <i aria-hidden="true" />
              {r.name}
            </span>
          ))}
        </div>
      )}
      {/* The "Next" automation line goes here once the home app has a routine schedule:
          `/api/desk/schedule/today` answers `source: "none"` today, and the wall never guesses one. */}
    </div>
  );
}

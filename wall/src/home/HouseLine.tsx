import { IconHome, IconMoon, IconSun, IconSunset2 } from '@tabler/icons-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { tip } from '../ui/HoverTip';
import { useRemeasure } from '../ui/useRemeasure';
import { RoomLightsCard } from './RoomLightsCard';
import { HOUSE_REFRESH_MS, maxAge, useDeskHouse, type DeskRooms, type FeedState, type House, type NextChange } from './useDesk';

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

/** The Next line shows from this long before the change, and no further out than a day and a bit. */
export const NEXT_MAX_MS = 26 * 3_600_000;
/** "in N min" up to here; "at 10:30 PM" beyond. */
export const NEXT_COUNTDOWN_MIN = 60;
/** Amber in the last stretch before the change. */
export const NEXT_SOON_MIN = 15;
const NEXT_LABELS: Record<NextChange['slot'], string> = { day: 'Day', evening: 'Evening', 'late-night': 'Late night' };

export interface NextView {
  slot: NextChange['slot'];
  label: string;
  /** "in 42 min" or "at 10:30 PM". */
  when: string;
  soon: boolean;
  tip: string;
}

/**
 * The Next line from the house read, or null to hide it: no `next` (an older home app, or the home app has no
 * confident prediction), a time that is unreadable, already past, or more than 26 hours off. The label is the slot's
 * own. Within the hour it counts down in whole minutes rounded up (never "in 0 min" for a change not yet made);
 * later it gives the clock time. The caller hides it when the house read is stale.
 */
export function nextView(next: NextChange | null | undefined, now: number): NextView | null {
  if (!next || typeof next !== 'object') return null;
  const label = NEXT_LABELS[next.slot];
  const at = Date.parse(next.at);
  if (!label || !Number.isFinite(at)) return null;
  const left = at - now;
  if (left <= 0 || left > NEXT_MAX_MS) return null;
  const mins = Math.ceil(left / 60_000);
  const when = mins <= NEXT_COUNTDOWN_MIN ? `in ${mins} min` : `at ${timeText(at)}`;
  return {
    slot: next.slot,
    label,
    when,
    soon: mins <= NEXT_SOON_MIN,
    tip: `${label} runs at ${timeText(at)} (Apple Home). Hidden while a mood is held, On Air is on, or nobody is home.`,
  };
}

export interface HouseView {
  text: string;
  rooms: { id: string; name: string; on: boolean }[];
  stale: boolean;
  asOf: string | null;
  next: NextView | null;
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
  return { text, rooms: roomList, stale, asOf: stale && asOfMs !== null ? `as of ${timeText(asOfMs)}` : null, next: stale ? null : nextView(h.next, house.now) };
}

/** The room dots' lines: indented to the text, 424 px wide. */
export const ROOMS_ROW_PX = 424;
const DOT_PX = 17; // the dot and its gap to the name
const ROOM_GAP_PX = 18;
const NAME_CHAR_PX = 9.8;
const MORE_PX = 74;
/** The gap kept between the last dot and "as of 9:41 AM" at the right end of the row. */
const ASOF_GAP_PX = 18;

type RoomDot = { id: string; name: string; on: boolean };

/** The room dots take up to two lines under the weather row (the third line is the Next line). */
export const ROOM_LINES = 2;

/**
 * The room dots that fit two lines, packed in order as the row wraps. When every room fits they
 * stay in the home app's order. When some would not, the lit rooms come first (those are the ones
 * worth seeing) and the rest are counted as "+N more" at the end of the second line, which is
 * given up to that chip only when both lines are full; their names go in the chip's hover card.
 * Widths are close estimates at 18 px; the fit check measures the real lines.
 */
export function fitRooms(rooms: RoomDot[], maxPx = ROOMS_ROW_PX, drop = 0): { shown: RoomDot[]; hidden: RoomDot[] } {
  const w = (r: RoomDot) => DOT_PX + r.name.length * NAME_CHAR_PX;
  /** How many of `list` fit, packed line by line, the last line `reserve` px shorter. */
  const pack = (list: RoomDot[], reserve: number): number => {
    let line = 0;
    let used = 0;
    let n = 0;
    for (const r of list) {
      const cap = line === ROOM_LINES - 1 ? maxPx - reserve : maxPx;
      let next = used + (used > 0 ? ROOM_GAP_PX : 0) + w(r);
      if (next > cap && used > 0) {
        if (line === ROOM_LINES - 1) break;
        line += 1;
        used = 0;
        next = w(r);
        if (next > (line === ROOM_LINES - 1 ? maxPx - reserve : maxPx)) break;
      }
      used = next;
      n += 1;
    }
    return n;
  };
  const whole = pack(rooms, 0) === rooms.length;
  if (whole && drop === 0) return { shown: rooms, hidden: [] };
  const ordered = [...rooms.filter((r) => r.on), ...rooms.filter((r) => !r.on)];
  // `drop`: dots the real lines would not hold (the estimate ran short), taken off the end and counted.
  const n = Math.max(0, (whole ? rooms.length : pack(ordered, ROOM_GAP_PX + MORE_PX)) - drop);
  return { shown: ordered.slice(0, n), hidden: ordered.slice(n) };
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
 * Home's house row under the weather row: the temperature and lit rooms, then a dot per room, then (when the home app predicts one) the Next line: the routine about to run and when.
 * Hidden while the home app's desk routes are absent; dimmed when not live. Every dot that fits
 * the two lines shows; "as of 9:41 AM" sits at the right end of the last line only when the measured
 * dots leave room for it, otherwise it is in the hover card of the house row (and of each dot).
 */
export function HouseLine() {
  const { house, rooms } = useDeskHouse();
  const v = houseView(house, rooms);
  const rowRef = useRef<HTMLDivElement>(null);
  const [asOfFits, setAsOfFits] = useState(true);
  const asOfKey = v?.asOf ?? '';
  const roomKey = v ? v.rooms.map((r) => r.name).join('|') : '';
  // Dots the real lines could not hold (the width estimates ran short): taken off one at a time until the row is not clipped.
  // `epoch` counts the times the measure starts again from zero (late font, new width, new names).
  const [trim, setTrim] = useState({ key: '', n: 0, epoch: 0 });
  const drop = trim.key === roomKey ? trim.n : 0;
  const roomCount = v ? v.rooms.length : 0;
  const measureAsOf = () => {
    const row = rowRef.current;
    const label = row?.querySelector<HTMLElement>('.house-asof');
    if (!row || !label) return;
    const dots = row.querySelectorAll<HTMLElement>('.house-room');
    const last = dots[dots.length - 1];
    const end = last ? last.offsetLeft + last.offsetWidth : 0;
    setAsOfFits(end + ASOF_GAP_PX + label.offsetWidth <= row.clientWidth);
  };
  /** The row does not hold what it draws: a third line, or something wider than the row. */
  const clipped = (row: HTMLElement) => row.scrollHeight > row.clientHeight + 1 || row.scrollWidth > row.clientWidth + 1;
  const trimToFit = () => {
    const row = rowRef.current;
    // One more dot off per pass, never more than there are rooms, so the loop ends and cannot swing between two states.
    if (row && clipped(row) && drop < roomCount) setTrim({ key: roomKey, n: drop + 1, epoch: trim.epoch });
  };
  // Measured from zero again: nothing learned under an old font, width or list is kept.
  const restart = () => setTrim((t) => ({ key: roomKey, n: 0, epoch: t.epoch + 1 }));
  useLayoutEffect(trimToFit, [roomKey, drop, asOfKey, trim.epoch]);
  useLayoutEffect(measureAsOf, [asOfKey, roomKey, drop, trim.epoch]);
  // The display font arrives after the first paint, or the row changes width: start over.
  useRemeasure(rowRef, () => {
    restart();
    measureAsOf();
  }, v !== null);
  useEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (!fonts?.addEventListener) return;
    const again = () => restart();
    fonts.addEventListener('loadingdone', again);
    return () => fonts.removeEventListener('loadingdone', again);
  });
  if (!v) return null;
  const { shown, hidden } = fitRooms(v.rooms, ROOMS_ROW_PX, drop);
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
      </div>
      {(v.rooms.length > 0 || v.asOf) && (
        <div className="house-rooms" ref={rowRef}>
          {shown.map((r) => (
            <span key={r.id} className={r.on ? 'house-room on' : 'house-room'} {...tip(() => <RoomLightsCard roomId={r.id} fallback={{ name: r.name, on: r.on }} asOf={v.asOf ?? ''} />, { align: 'start' })}>
              <i aria-hidden="true" />
              <span className="house-room-name">{r.name}</span>
            </span>
          ))}
          {hidden.length > 0 && (
            <span className="house-room more" {...tip(hidden.map((r) => `${r.name}: ${r.on ? 'lights on' : 'lights off'}`).join(', ') + asOf)}>
              +{hidden.length} more
            </span>
          )}
          {v.asOf && (
            <span className={asOfFits ? 'lw-side house-asof' : 'lw-side house-asof off'} aria-hidden={asOfFits ? undefined : true}>
              {v.asOf}
            </span>
          )}
        </div>
      )}
      {v.next && (
        <div className={v.next.soon ? 'lw-row house-next soon' : 'lw-row house-next'} {...tip(v.next.tip)}>
          <span className="lw-glyph">{v.next.slot === 'day' ? <IconSun size={22} stroke={1.7} aria-hidden="true" /> : v.next.slot === 'evening' ? <IconSunset2 size={22} stroke={1.7} aria-hidden="true" /> : <IconMoon size={22} stroke={1.7} aria-hidden="true" />}</span>
          <span className="lw-text house-next-text">
            <b>{v.next.label}</b> {v.next.when}
          </span>
        </div>
      )}
    </div>
  );
}

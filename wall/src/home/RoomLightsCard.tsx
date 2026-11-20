import { deskRooms, type Room, type RoomLight } from './useDesk';

/** Rows the card lists before "+N more". */
export const ROOM_LIGHT_ROWS = 6;

export interface RoomCardView {
  title: string;
  /** Right of the title: "3 on", "Lights off" or "Lights on, none listed". */
  count: string;
  rows: { id: string; name: string; value: string }[];
  more: number;
}

/** The lights worth listing: on, and answering the bridge (Hue calls a lamp switched off at the wall "on"). Sorted by name. */
function litLights(lights: RoomLight[]): RoomLight[] {
  return lights.filter((l) => l.on && l.reachable).sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id));
}

/**
 * What the card for a room shows, or null when the home app sent no light list (an older app, or its
 * lights read failed): the dot then keeps its one-line text card.
 */
export function roomCardView(room: Room): RoomCardView | null {
  if (!room.lights) return null;
  if (!room.on) return { title: room.name, count: 'Lights off', rows: [], more: 0 };
  const lit = litLights(room.lights);
  if (lit.length === 0) return { title: room.name, count: 'Lights on, none listed', rows: [], more: 0 };
  return {
    title: room.name,
    count: `${lit.length} on`,
    rows: lit.slice(0, ROOM_LIGHT_ROWS).map((l) => ({ id: l.id, name: l.name, value: l.brightness === null ? 'on' : `${l.brightness}%` })),
    more: Math.max(0, lit.length - ROOM_LIGHT_ROWS),
  };
}

/**
 * The hover card of a room dot. It reads the shared rooms feed itself, so the list changes the moment a
 * read lands (a card built once at hover time would keep saying "lights on" after the room went off).
 * `fallback` is the dot's own state when the room is not in the feed any more.
 */
export function RoomLightsCard({ roomId, fallback, asOf }: { roomId: string; fallback: { name: string; on: boolean }; asOf: string }) {
  const room = deskRooms.use((s) => s.data?.rooms.find((r) => r.id === roomId)) ?? null;
  const view = room ? roomCardView(room) : null;
  if (!room || !view) {
    const r = room ?? { ...fallback };
    return <>{`${r.name}: ${r.on ? 'lights on' : 'lights off'}${asOf ? `, ${asOf}` : ''}`}</>;
  }
  return (
    <div className="rl-card">
      <div className="rl-head">
        <span className="rl-title">{view.title}</span>
        <span className="rl-count">{view.count}</span>
      </div>
      {view.rows.map((r) => (
        <div className="rl-row" key={r.id}>
          <i aria-hidden="true" />
          <span className="rl-name">{r.name}</span>
          <span className="rl-val">{r.value}</span>
        </div>
      ))}
      {view.more > 0 && <div className="rl-more">+{view.more} more</div>}
      {asOf && <div className="rl-asof">{asOf}</div>}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { type ChipCounts, type ChipId, type ListSort } from './listView';
import { SortChip } from './SortChip';

interface Props {
  counts: ChipCounts;
  chip: ChipId;
  sort: ListSort;
  onChip: (chip: ChipId) => void;
  onSort: (sort: ListSort) => void;
}

/** The chips in order: All, Live, Videos, Playlists, Twitch (only while one is saved), then the tags, most used first. */
export function chipList(counts: ChipCounts): { id: ChipId; label: string; count: number }[] {
  const out: { id: ChipId; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'live', label: 'Live', count: counts.live },
    { id: 'video', label: 'Videos', count: counts.video },
    { id: 'playlist', label: 'Playlists', count: counts.playlist },
  ];
  if (counts.twitch > 0) out.push({ id: 'twitch', label: 'Twitch', count: counts.twitch });
  for (const t of counts.tags) out.push({ id: t.chip, label: `#${t.name}`, count: t.count });
  return out;
}

/** The row between the card's head and its list: filter chips (scrolling sideways, faded at the right edge) and the sort chip. */
export function ListChips({ counts, chip, sort, onChip, onSort }: Props) {
  const row = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    // A chip chosen earlier and out of sight comes into view.
    row.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }, [chip]);
  const names = chipList(counts).map((c) => `${c.label}${c.count}`).join('|');
  useEffect(() => {
    // The fade at the right edge shows only while chips run past it.
    const el = row.current;
    if (!el) return;
    const measure = () => setOver(el.scrollWidth > el.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [names]);
  useEffect(() => {
    // A mouse wheel only turns up and down; with chips past the edge it scrolls them sideways instead.
    const el = row.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const max = el.scrollWidth - el.clientWidth;
      const next = Math.min(max, Math.max(0, el.scrollLeft + event.deltaY));
      if (next === el.scrollLeft) return;
      event.preventDefault();
      el.scrollLeft = next;
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  return (
    <div className="w-chiprow">
      <div ref={row} className={`w-chips${over ? ' over' : ''}`} role="group" aria-label="Show part of the list">
        {chipList(counts).map((c) => (
          <button key={c.id} type="button" className={`w-chip${c.id === chip ? ' on' : ''}`} aria-pressed={c.id === chip} aria-label={`${c.label}, ${c.count}`} onClick={() => onChip(c.id)}>
            <span className="w-chip-name">{c.label}</span>
            <span className="w-chip-n">{c.count}</span>
          </button>
        ))}
      </div>
      <SortChip value={sort} onPick={onSort} />
    </div>
  );
}


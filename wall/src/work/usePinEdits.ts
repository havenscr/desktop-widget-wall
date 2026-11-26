import { MAX_PINS, movePin, PINS_KEY, removePin, resolvePin, savePins, serializePins, swapPin, type LibGroup } from './libraryModel';
import type { KeyInfo } from './keysModel';
import type { usePins } from './usePins';

/** The stored pins as a list of raw entries, or null when the text is not one. */
function storedEntries(raw: string | null): unknown[] | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/** The ref a raw entry stands for, or null when it is neither a key reference nor a keys.json entry. */
function entryRef(e: unknown): string | null {
  if (typeof e === 'string') return e;
  if (typeof e === 'object' && e !== null && !Array.isArray(e) && typeof (e as { ref?: unknown }).ref === 'string') return (e as { ref: string }).ref;
  return null;
}

/**
 * The raw index of each pin that resolves now, in order: slot n of the row is `result[n]`. It follows the
 * rules `parsePins` uses to keep an entry, so the nth slot is the nth kept entry.
 */
function resolvedSlots(entries: readonly unknown[], lib: readonly LibGroup[], filePins: readonly KeyInfo[]): number[] {
  const slots: number[] = [];
  const seen = new Set<string>();
  entries.forEach((e, i) => {
    const ref = entryRef(e);
    if (ref === null || seen.has(ref)) return;
    if (typeof e !== 'string') {
      const k = filePins[Number(ref.slice(5))];
      const o = e as { label?: unknown; action?: unknown };
      if (k && k.label === o.label && k.action === o.action) {
        seen.add(ref);
        slots.push(i);
      }
      return;
    }
    if (ref.startsWith('file:')) return;
    if (resolvePin(ref, lib, filePins)) {
      seen.add(ref);
      slots.push(i);
    }
  });
  return slots;
}

/**
 * The stored list with the pins that resolve replaced by `next` (a change of one slot, or an added one at the end),
 * and every other raw entry left as it was. Never longer than MAX_PINS: room for an added pin comes from the oldest
 * entries that do not resolve (not a keys.json pin while keys.json is loading; with no such room it returns null and
 * the Add is refused), so `parsePins` never sees a list too long to read.
 */
function replaceResolved(entries: readonly unknown[], slots: readonly number[], next: readonly string[], filePins: readonly KeyInfo[], filesLoading: boolean): unknown[] | null {
  const one = (ref: string): unknown => (JSON.parse(serializePins([ref], filePins)) as unknown[])[0];
  const out = [...entries];
  slots.forEach((at, k) => {
    if (k < next.length) out[at] = one(next[k]);
  });
  for (let k = slots.length; k < next.length; k++) out.push(one(next[k]));
  const live = new Set(slots);
  // A keys.json pin is not given up while keys.json is still being read: it may resolve in a moment.
  const loading = (e: unknown) => filesLoading && (entryRef(e) ?? '').startsWith('file:');
  let excess = out.length - MAX_PINS;
  const kept = out.filter((e, at) => {
    if (excess > 0 && at < entries.length && !live.has(at) && !loading(e)) {
      excess--;
      return false;
    }
    return true;
  });
  // Every place is held by a pin that resolves or may yet: the Add is refused, as with five resolving pins.
  return excess > 0 ? null : kept;
}

/**
 * The edits of the Always here row, shared by the Work row and Unwind's keys row: choose (put a key in a slot, or add one
 * at the end), move, remove and reset. They edit the stored list in place when it is a well formed one, so a reference that
 * does not resolve right now is kept. `pins` is what `usePins` returned.
 */
export function usePinEdits({ read, lib, raw, setRaw, filePins, kept, pins }: ReturnType<typeof usePins>) {
  const refs = pins.map((p) => p.ref);
  const keepText = (text: string) => {
    try {
      localStorage.setItem(PINS_KEY, text);
    } catch {
      // Storage may be blocked; the choice then lasts until the page reloads.
    }
    setRaw(text);
  };
  const keep = (next: string[]) => keepText(serializePins(next, filePins));
  // The stored list, when it is a well formed one: an Add or a Remove edits it in place so a reference that
  // does not resolve right now (a file list still loading, a key the library lacks today) is kept, not dropped.
  const stored = lib && kept !== null ? storedEntries(raw) : null;
  const rawSlots = lib && stored ? resolvedSlots(stored, lib, filePins) : null;
  const commit = (next: string[]) => {
    if (stored && rawSlots) {
      const text = replaceResolved(stored, rawSlots, next, filePins, read.status === 'loading');
      if (text) keepText(JSON.stringify(text));
    } else keep(next);
  };
  return {
    choose: (slot: number, ref: string) => commit(swapPin(refs, slot, ref)),
    moveSlot: (slot: number, to: number) => commit(movePin(refs, slot, to)),
    removeSlot: (slot: number) => {
      if (stored && rawSlots && slot < rawSlots.length) keepText(JSON.stringify(stored.filter((_e, i) => i !== rawSlots[slot])));
      else keep(removePin(refs, slot));
    },
    reset: () => {
      savePins(null);
      setRaw(null);
    },
  };
}

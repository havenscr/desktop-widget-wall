import { create } from 'zustand';

/** Where the dismissed events are kept on this display. */
export const DISMISS_KEY = 'wall2-leave-dismissed';
/** An entry is kept until its event's real start has passed, then cleared. */
interface Entry { key: string; until: number }

function valid(v: unknown): v is Entry {
  return typeof v === 'object' && v !== null && typeof (v as Entry).key === 'string' && (v as Entry).key.length > 0 && (v as Entry).key.length <= 200 && Number.isFinite((v as Entry).until);
}

/** The kept entries, checked on read; anything odd is an empty list. Entries whose event is over are dropped, from storage too. */
export function readDismissed(now: number): Entry[] {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (raw === null) return [];
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const kept = v.filter(valid).filter((e) => e.until > now).slice(0, 50);
    // An entry whose event is over does not stay in storage: write the shorter list back.
    if (kept.length !== v.length) localStorage.setItem(DISMISS_KEY, JSON.stringify(kept));
    return kept;
  } catch {
    return [];
  }
}

function save(entries: Entry[]): void {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(entries));
  } catch {
    // Storage may be blocked; the dismissal then lasts until the page reloads.
  }
}

interface DismissState {
  entries: Entry[];
  /** Hide the banner for this event only, until its real start. */
  dismiss: (key: string, until: number, now?: number) => void;
}

export const useLeaveDismissed = create<DismissState>((set, get) => ({
  entries: readDismissed(Date.now()),
  dismiss: (key, until, now = Date.now()) => {
    const next = [...get().entries.filter((e) => e.until > now && e.key !== key), { key, until }].slice(-50);
    save(next);
    set({ entries: next });
  },
}));

/** Tests: forget every dismissal. */
export function resetLeaveDismissed(): void {
  save([]);
  useLeaveDismissed.setState({ entries: [] });
}

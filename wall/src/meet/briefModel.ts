import type { BriefError, BriefItem, BriefOut, ItemKind, SourceState } from '../bridge/meetBrief';

/** How many feed rows are drawn; the rest are a count. */
export const BRIEF_ROWS = 7;

export type BriefMode = 'feed' | 'empty' | 'building' | 'off' | 'error';
export type RowIcon = 'mail' | 'chat' | 'file' | 'folder' | 'crm' | 'note';

export interface BriefStrip {
  /** First listed person, or null. */
  who: string | null;
  company: string | null;
  /** `name · stage`, or the name alone. */
  deal: string | null;
  /** For a mixed or unmatched invite: the match label alone, with no company and no deal. */
  label: string | null;
}

export interface BriefRow {
  id: string;
  icon: RowIcon;
  title: string;
  sub: string;
  when: string;
  openKey: string | null;
}

export interface BriefViewModel {
  mode: BriefMode;
  strip: BriefStrip;
  rows: BriefRow[];
  /** Items past the cap. */
  more: number;
  /** The one line the island carries for this mode, or null. */
  line: string | null;
  /** Extra quiet lines (one per source that is not set up). */
  sourceLines: string[];
  /** The error line offers a Retry button. */
  retry: boolean;
}

export const OFF_LINE = 'Meeting brief not connected';
export const FORBIDDEN_LINE = 'The box refused the brief key';
export const FAILED_LINE = 'Meeting brief could not be read';
export const BUILDING_LINE = 'Getting the brief ready';
export const NONE_LINE = 'No brief for this meeting';
export const ON_AIR_LINE = 'Hidden while on air';
export const NOT_CHECKED = 'Sender not checked';

const KIND_WORDS: Record<ItemKind, string> = { note: 'Note', thread: 'Email thread', chat: 'Chat', meeting: 'Meeting', file: 'File', folder: 'Folder' };
const SOURCE_NOT_SET_UP: Record<string, string> = {
  crm: 'The CRM is not set up yet',
  mail: 'Mail is not set up yet',
  chats: 'Teams is not signed in yet',
  notes: 'Notes are not set up yet',
  files: 'Files are not set up yet',
};

export function kindWord(k: ItemKind): string {
  return KIND_WORDS[k] ?? 'Item';
}

export function rowIcon(item: Pick<BriefItem, 'source' | 'kind'>): RowIcon {
  if (item.kind === 'folder') return 'folder';
  if (item.source === 'crm') return 'crm';
  if (item.source === 'mail') return 'mail';
  if (item.source === 'chat') return 'chat';
  if (item.source === 'file') return 'file';
  return 'note';
}

/** `Nov 11`, with the year when it is not this year; empty for no date or a date that does not parse. */
export function shortDate(when: string | null, now: number = Date.now()): string {
  if (!when) return '';
  const t = Date.parse(when);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

function rowOf(item: BriefItem, now: number): BriefRow {
  const sub = [item.who, kindWord(item.kind), item.recording ? 'Recording' : null].filter((s): s is string => !!s).join(' · ');
  return { id: item.id, icon: rowIcon(item), title: item.title, sub, when: shortDate(item.when, now), openKey: item.openKey };
}

export function stripOf(out: BriefOut | null): BriefStrip {
  if (!out) return { who: null, company: null, deal: null, label: null };
  const label = out.match.label;
  if (out.match.kind === 'mixed' || out.match.kind === 'none') return { who: null, company: null, deal: null, label };
  const deal = out.deals[0];
  return {
    who: out.people[0]?.name ?? null,
    company: out.company?.name ?? null,
    deal: deal ? (deal.stage ? `${deal.name} · ${deal.stage}` : deal.name) : null,
    label,
  };
}

/** Source lines for the sources that are not set up, in the helper's order. */
export function notSetUpLines(sources: Record<string, SourceState>): string[] {
  return Object.keys(SOURCE_NOT_SET_UP)
    .filter((k) => sources[k] === 'not-set-up')
    .map((k) => SOURCE_NOT_SET_UP[k]);
}

const NONE: Omit<BriefViewModel, 'mode' | 'line' | 'retry'> = { strip: { who: null, company: null, deal: null, label: null }, rows: [], more: 0, sourceLines: [] };

/**
 * What the island does with the brief read: `out` is the last good answer for the meeting (or null), `err` the fixed word the
 * last read was refused with (or null). With neither, the island is exactly as it is without a brief.
 */
export function briefView(out: BriefOut | null, err: BriefError | null, now: number = Date.now()): BriefViewModel {
  if (err) {
    if (err === 'forbidden') return { ...NONE, mode: 'error', line: FORBIDDEN_LINE, retry: false };
    if (err === 'failed') return { ...NONE, mode: 'error', line: FAILED_LINE, retry: true };
    if (err === 'gone') return { ...NONE, mode: 'off', line: null, retry: false };
    return { ...NONE, mode: 'off', line: OFF_LINE, retry: false };
  }
  if (!out) return { ...NONE, mode: 'off', line: null, retry: false };
  if (out.state === 'building') return { ...NONE, mode: 'building', line: BUILDING_LINE, retry: false };
  const strip = stripOf(out);
  const sourceLines = notSetUpLines(out.sources as unknown as Record<string, SourceState>);
  if (out.state === 'none') return { ...NONE, strip, sourceLines, mode: 'empty', line: NONE_LINE, retry: false };
  if (out.items.length === 0) {
    return { ...NONE, strip, sourceLines, mode: 'empty', line: out.match.label ? `No history yet with ${out.match.label}` : 'No history yet', retry: false };
  }
  const rows = out.items.slice(0, BRIEF_ROWS).map((i) => rowOf(i, now));
  return { mode: 'feed', strip, rows, more: Math.max(0, out.items.length - rows.length), line: null, sourceLines: [], retry: false };
}

/** The whole item for a row (the detail needs preview and actions the row does not carry). */
export function itemById(out: BriefOut | null, id: string): BriefItem | null {
  return out?.items.find((i) => i.id === id) ?? null;
}

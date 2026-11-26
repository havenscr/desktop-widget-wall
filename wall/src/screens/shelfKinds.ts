import type { KeyKind } from '../work/keyKind';

/** The groups the Shelf keys fall into. */
export type ShelfCategory = 'stills' | 'recording' | 'tools' | 'files';

/** Shelf key library id to its group. A key not listed here keeps the neutral style. */
export const SHELF_CATEGORY: Record<string, ShelfCategory> = {
  'sx-region': 'stills',
  'sx-screen': 'stills',
  'sx-scrolling': 'stills',
  'sx-last-region': 'stills',
  'sx-record': 'recording',
  'sx-record-gif': 'recording',
  'sx-stop-record': 'recording',
  'sx-ocr': 'tools',
  'sx-color': 'tools',
  'sx-ruler': 'tools',
  'sx-pin': 'tools',
  'sx-highlighter': 'tools',
  'sx-history': 'files',
  'sx-folder': 'files',
};

/** Each group borrows an existing key kind, so the colour is the one the Work keys already use: pink, amber, cyan, green. */
export const CATEGORY_KIND: Record<ShelfCategory, KeyKind> = {
  stills: 'capture',
  recording: 'agent',
  tools: 'layout',
  files: 'app',
};

/** The key kind for a Shelf key id, or undefined for the neutral style. */
export function shelfKind(id: string): KeyKind | undefined {
  const c = SHELF_CATEGORY[id];
  return c ? CATEGORY_KIND[c] : undefined;
}

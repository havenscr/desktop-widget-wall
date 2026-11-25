/** Labels that read better as one word than as their first word. */
const SHORT: Record<string, string> = { 'Record 16:9': 'Record', 'Hide screen': 'Hide' };

const words = (label: string) => label.split(/\s+/).filter(Boolean);
const lower = (w: string) => w.toLowerCase();
const upFirst = (w: string) => (w ? w[0]!.toUpperCase() + w.slice(1) : w);

/** One word for a key: a known short form, else the first word of its label. */
export function shortLabel(label: string): string {
  return SHORT[label] ?? words(label)[0] ?? label;
}

/**
 * What a key may show, best first: the name its owner gave it (when there is one), the short word while no other
 * key shares it, a word of its label that no other label has ("Record 16:9" is "16:9", "Record screen" is "Screen"),
 * then each remaining word and the full label, shortest first. Nothing is ever cut, so the chooser picks among these.
 */
export function labelCandidates(label: string, all: readonly string[], name?: string): string[] {
  const out: string[] = [];
  const add = (w: string | undefined) => {
    if (w && !out.includes(w)) out.push(w);
  };
  add(name?.trim());
  const short = shortLabel(label);
  const others = all.filter((l, i) => !(l === label && i === all.indexOf(label)));
  const clash = others.some((l) => lower(shortLabel(l)) === lower(short));
  if (!clash) add(short);
  const theirs = new Set(others.flatMap((l) => words(l).map(lower)));
  const mine = words(label);
  const own = mine.filter((w) => !theirs.has(lower(w)));
  add(own[0] ? upFirst(own[0]) : undefined);
  const rest = [...mine.map(upFirst), label].sort((a, b) => a.length - b.length);
  for (const w of rest) add(w);
  if (clash) add(short);
  return out;
}

/** One word for each label; where two would read the same, each takes a word the other does not share. */
export function shortLabels(labels: readonly string[]): string[] {
  return labels.map((l) => labelCandidates(l, labels)[0] ?? l);
}

/** Width of a text in the key label's font. */
export type Measure = (text: string) => number;

/**
 * The first of the first three candidates (name, short word, distinguishing word) that fits `avail` px; failing that,
 * the shortest candidate that fits; failing that, the shortest one. `measure` is the real font's width (canvas) or a
 * stand-in under test. An unmeasured row (`avail` of 0) takes the first.
 */
export function pickLabel(candidates: readonly string[], avail: number, measure: Measure, firstN = 3): string {
  const first = candidates[0] ?? '';
  if (!(avail > 0)) return first;
  const fits = (t: string) => measure(t) <= avail;
  const lead = candidates.slice(0, firstN).find(fits);
  if (lead !== undefined) return lead;
  const byLength = [...candidates].sort((a, b) => measure(a) - measure(b));
  return byLength.find(fits) ?? byLength[0] ?? first;
}

/** A canvas measure for the font a label is drawn in, or null where there is no canvas. */
export function canvasMeasure(font: string): Measure | null {
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return null;
    ctx.font = font;
    return (t) => ctx.measureText(t).width;
  } catch {
    return null;
  }
}

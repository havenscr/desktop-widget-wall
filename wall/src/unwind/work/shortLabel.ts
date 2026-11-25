/** Labels that read better as one word than as their first word. */
const SHORT: Record<string, string> = { 'Record 16:9': 'Record', 'Hide screen': 'Hide' };

/** One word for a key: a known short form, else the first word of its label. */
export function shortLabel(label: string): string {
  return SHORT[label] ?? label.split(/\s+/)[0] ?? label;
}

/** One word for each label, except where two would read the same: those keep their full label. */
export function shortLabels(labels: readonly string[]): string[] {
  const words = labels.map(shortLabel);
  return words.map((w, i) => (words.filter((x) => x === w).length > 1 ? labels[i] : w));
}

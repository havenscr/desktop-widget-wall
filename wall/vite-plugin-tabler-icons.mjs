// Turns the Tabler outline icon set (installed as data by `@tabler/icons`) into one compact
// virtual module, `virtual:tabler-icon-data`: a map from icon name to a string of paths.
// Only `src/tasks/tagIcons.ts` imports it, and only through `import()`, so a production
// build emits it as its own chunk that the first load never fetches.
//
// One icon is its paths joined by `|`. A path is its `d` text, with a one letter prefix and
// `~` when the node carries one of the few extra attributes the set uses:
//   `f~` fill currentColor, `s~` fill currentColor and stroke none, `o~` opacity .5.
// Every node in the set is a `path`; anything else makes the build fail rather than be guessed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const VIRTUAL_ID = 'virtual:tabler-icon-data';
const RESOLVED = `\0${VIRTUAL_ID}`;

/** One icon's node list as the compact string. */
export function encodeIcon(nodes) {
  return nodes
    .map(([element, attrs]) => {
      const keys = Object.keys(attrs).filter((k) => k !== 'd').sort().join(',');
      if (element !== 'path' || typeof attrs.d !== 'string' || /[|~]/.test(attrs.d)) throw new Error(`tabler icons: unexpected node ${element}`);
      const prefix = {
        '': '',
        fill: attrs.fill === 'currentColor' ? 'f~' : null,
        'fill,stroke': attrs.fill === 'currentColor' && attrs.stroke === 'none' ? 's~' : null,
        opacity: attrs.opacity === '.5' ? 'o~' : null,
      }[keys];
      if (prefix === null || prefix === undefined) throw new Error(`tabler icons: unexpected attributes ${keys}`);
      return prefix + attrs.d;
    })
    .join('|');
}

/** The whole set as `{ name: encoded }`. */
export function encodeSet(set) {
  return Object.fromEntries(Object.entries(set).map(([name, nodes]) => [name, encodeIcon(nodes)]));
}

export function tablerIconData() {
  return {
    name: 'tabler-icon-data',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      const file = fileURLToPath(new URL('./node_modules/@tabler/icons/tabler-nodes-outline.json', import.meta.url));
      this.addWatchFile(file);
      const set = JSON.parse(readFileSync(file, 'utf8'));
      return `export default ${JSON.stringify(encodeSet(set))};`;
    },
  };
}

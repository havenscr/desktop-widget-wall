import { IconTag } from '@tabler/icons-react';
import { useEffect, useSyncExternalStore, type ReactElement } from 'react';

/**
 * The owner can give a tag any Tabler outline icon in his task app, so the wall carries the
 * whole set, as data, in its own chunk. Nothing here imports that chunk except `import()`:
 * it is fetched the first time a tag with an icon name is drawn, never on the first load.
 * Until it arrives, and for a name that is not in it, the plain `tag` glyph is drawn.
 */
type IconData = Record<string, string>;

let data: IconData | null = null;
let started = false;
const listeners = new Set<() => void>();

function publish(next: IconData): void {
  data = next;
  listeners.forEach((l) => l());
}

/** Start fetching the icon chunk (once). A failure leaves the plain glyph for good. */
export function requestIconData(): void {
  if (started) return;
  started = true;
  import('virtual:tabler-icon-data').then((m) => publish(m.default)).catch(() => undefined);
}

/** Tests only: stand in for the chunk (null forgets it and the fetch). */
export function setIconDataForTests(next: IconData | null): void {
  started = next !== null;
  data = next;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** The loaded icon data, or null while it has not arrived. Asks for it when `wanted`. */
export function useIconData(wanted: boolean): IconData | null {
  useEffect(() => {
    if (wanted) requestIconData();
  }, [wanted]);
  return useSyncExternalStore(subscribe, () => data);
}

export interface IconPath {
  d: string;
  fill?: 'currentColor';
  stroke?: 'none';
  opacity?: '.5';
}

/** What `d` may hold: path commands and numbers only. */
const PATH_TEXT = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s-]*$/;

/** The paths of one encoded icon (see `vite-plugin-tabler-icons.mjs`); a path with odd text is dropped. */
export function decodeIcon(spec: string): IconPath[] {
  const out: IconPath[] = [];
  for (const part of spec.split('|')) {
    const m = /^([fso])~(.*)$/.exec(part);
    const d = m ? m[2]! : part;
    if (!d || !PATH_TEXT.test(d)) continue;
    const path: IconPath = { d };
    if (m?.[1] === 'f') path.fill = 'currentColor';
    if (m?.[1] === 's') {
      path.fill = 'currentColor';
      path.stroke = 'none';
    }
    if (m?.[1] === 'o') path.opacity = '.5';
    out.push(path);
  }
  return out;
}

/** An icon name the task app may send: 1 to 64 of a-z, 0-9 and hyphen. */
export const ICON_NAME = /^[a-z0-9-]{1,64}$/;

/**
 * A tag's glyph: the named Tabler outline icon drawn from the loaded data as an inline SVG
 * (24 by 24 view box, stroke `currentColor`, 2 px, round caps and joins, no fill) built
 * from React elements, never markup text. The plain tag glyph stands in until the data has
 * loaded and for a name it does not hold.
 */
export function TagGlyph({ name, size }: { name?: string | null; size: number }): ReactElement {
  const icons = useIconData(!!name && ICON_NAME.test(name));
  const spec = name && ICON_NAME.test(name) && icons && Object.hasOwn(icons, name) ? icons[name] : undefined;
  const paths = spec ? decodeIcon(spec) : [];
  if (paths.length === 0) return <IconTag size={size} stroke={2} aria-hidden="true" />;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-icon={name}
    >
      {paths.map((p, i) => (
        <path key={i} d={p.d} fill={p.fill} stroke={p.stroke} opacity={p.opacity} />
      ))}
    </svg>
  );
}

/**
 * Media players by the id their media session reports (`source_app_id`: a Windows
 * AppUserModelId such as `SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify`, or a process name
 * such as `Spotify.exe`). Each known player has its display name and the process names its
 * audio session runs under. Every comparison is exact on a lower-cased name with only a
 * trailing `.exe` dropped (`procName`); no punctuation is ever stripped, so "Spot.ify.exe"
 * is not Spotify.
 */
interface KnownPlayer {
  name: string;
  /** Process names (`procName` form: lower case, no `.exe`) of its audio sessions. */
  processes: readonly string[];
  /** Exact package family names (lower case, the part before `_hash`). */
  packages?: readonly string[];
  /** Exact bare app ids (lower case) the player registers, such as Firefox's install hash. */
  ids?: readonly string[];
}

/**
 * Known players. A packaged id is one of these only when its package family name is in
 * the player's list; a process id only when its file name is one of the player's process
 * names; a bare id only when it is one of the player's ids, process names or its name.
 * Process lookups take the first player that lists the process, so the order matters for
 * `music.ui`: that is Groove Music's own executable (`Music.UI.exe`), so Groove comes
 * first and a process id `Music.UI.exe` is Groove. The Microsoft.ZuneMusic package now
 * ships Media Player (`Microsoft.Media.Player.exe`) but older installs still run Groove's
 * `Music.UI.exe` under it, so Media Player lists both for its volume.
 */
const KNOWN: readonly KnownPlayer[] = [
  { name: 'Spotify', processes: ['spotify'], packages: ['spotifyab.spotifymusic'] },
  { name: 'Apple Music', processes: ['applemusic', 'itunes'], packages: ['appleinc.applemusicwin', 'appleinc.itunes'] },
  { name: 'Groove Music', processes: ['music.ui'] },
  { name: 'Media Player', processes: ['microsoft.media.player', 'music.ui'], packages: ['microsoft.zunemusic'] },
  {
    name: 'Edge',
    processes: ['msedge'],
    packages: ['microsoft.microsoftedge', 'microsoft.microsoftedge.stable', 'microsoft.microsoftedge.beta', 'microsoft.microsoftedge.dev', 'microsoft.microsoftedge.canary'],
  },
  { name: 'Chrome', processes: ['chrome'] },
  { name: 'Firefox', processes: ['firefox'], ids: ['308046b0af4a39cb'] },
  { name: 'Brave', processes: ['brave'] },
  { name: 'Opera', processes: ['opera'] },
  { name: 'VLC', processes: ['vlc'] },
  { name: 'Amazon Music', processes: ['amazon music'], packages: ['amazonmobilellc.amazonmusic'] },
  { name: 'TIDAL', processes: ['tidal'], packages: ['tidalmusicas.tidalmusic'] },
  { name: 'Deezer', processes: ['deezer'], packages: ['deezer.62021768415af'] },
  { name: 'YouTube Music', processes: ['youtube music'], ids: ['com.github.th-ch.youtube-music'] },
  { name: 'Plexamp', processes: ['plexamp'] },
  { name: 'MusicBee', processes: ['musicbee'] },
  { name: 'foobar2000', processes: ['foobar2000'] },
];

/** How process names are compared: trimmed, lower case, a trailing `.exe` dropped. Nothing else. */
export const procName = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/\.exe$/, '');

const generic = (s: string) => s === '' || /^app(\.exe)?$/i.test(s);

/** "PlayerName" to "Player Name"; leaves runs of capitals ("VLC") alone. */
const spaced = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

/** True when `name` reads as a known player's name (so an unknown app must not use it). */
const looksKnown = (name: string) => {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return KNOWN.some((k) => k.name.toLowerCase().replace(/[^a-z0-9]/g, '') === n);
};

/** A source id split into the tokens rules match: a process, a package, or a bare id. */
type Parsed =
  | { kind: 'process'; file: string }
  | { kind: 'package'; family: string; entry: string }
  | { kind: 'bare'; id: string };

/**
 * `C:\...\vlc.exe` or `Spotify.exe` is a process (its file name); `Publisher.Name_hash!Entry`
 * is a package (family `Publisher.Name`, the entry after `!`); anything else (`MSEdge`,
 * `Chrome`, a label such as "Apple Music") is a bare id.
 */
function parse(raw: string): Parsed | null {
  const text = raw.trim();
  if (!text) return null;
  const file = text.split(/[\\/]/).filter(Boolean).pop() ?? '';
  if (file.includes('!')) {
    const [pkg = '', entry = ''] = file.split('!');
    return { kind: 'package', family: (pkg.split('_')[0] ?? '').trim(), entry: entry.trim() };
  }
  if (/[\\/]/.test(text) || /\.exe$/i.test(file)) return { kind: 'process', file: file.trim() };
  return { kind: 'bare', id: file };
}

/**
 * A readable name for an id no rule knows: a process's file name without `.exe`; for a
 * packaged app the entry, or the package name when the entry is the bare word `App`; a
 * bare id as it is. A name that would read as a known player's ("Evil.Spotify_x!App") is
 * not used: the full package family name (or the raw file name) is shown instead. Never
 * "App" on its own (then "Media player").
 */
export function cleanAppName(raw: string): string {
  const p = parse(raw);
  if (!p) return 'Media player';
  let name: string;
  let fallback: string;
  if (p.kind === 'process') {
    name = p.file.replace(/\.exe$/i, '');
    fallback = p.file;
  } else if (p.kind === 'package') {
    const entry = p.entry.replace(/\.exe$/i, '');
    name = !generic(entry) && !entry.includes('.') ? entry : (p.family.split('.').filter(Boolean).pop() ?? '');
    fallback = p.family || raw.trim();
  } else {
    name = p.id;
    fallback = p.id;
  }
  if (generic(name)) return 'Media player';
  if (looksKnown(name)) return looksKnown(fallback) ? `${fallback} (unknown)` : fallback;
  return spaced(name);
}

function known(source: string): KnownPlayer | null {
  const p = parse(source);
  if (!p) return null;
  if (p.kind === 'package') {
    const family = p.family.toLowerCase();
    return KNOWN.find((k) => k.packages?.includes(family)) ?? null;
  }
  if (p.kind === 'process') {
    const proc = procName(p.file);
    return KNOWN.find((k) => k.processes.includes(proc)) ?? null;
  }
  // A bare id: one of the player's ids or process names, or its own name (an older label).
  const id = p.id.toLowerCase();
  return KNOWN.find((k) => k.ids?.includes(id) || k.processes.includes(id) || k.name.toLowerCase() === id) ?? null;
}

/** The source as the wall shows it: the id when the session gave one, else the older label. */
export function sourceKey(info: { source_app_id?: string | null; source_app?: string | null } | null): string | null {
  const id = info?.source_app_id?.trim();
  if (id) return id;
  const label = info?.source_app?.trim();
  return label ? label : null;
}

/** "Spotify", "Edge", "Apple Music"; an unknown player by its cleaned name; null with no source. */
export function playerName(source: string | null | undefined): string | null {
  if (!source || !source.trim()) return null;
  return known(source)?.name ?? cleanAppName(source);
}

/** Every process name a known player owns; an unknown app never gets one of these. */
const KNOWN_PROCESSES = new Set(KNOWN.flatMap((k) => k.processes));

/**
 * The process names (`procName` form) whose audio session belongs to this source: from the
 * known players' table, else, for a process id, its own file name (a bare id: itself).
 * An unknown packaged id has no file name, so no session; and an unknown id never gets a
 * process a known player owns. Matching against sessions is exact (see `playingSession`).
 */
export function playerProcesses(source: string | null | undefined): readonly string[] {
  if (!source || !source.trim()) return [];
  const k = known(source);
  if (k) return k.processes;
  const p = parse(source);
  const own = p?.kind === 'process' ? procName(p.file) : p?.kind === 'bare' ? procName(p.id) : '';
  return own && !KNOWN_PROCESSES.has(own) ? [own] : [];
}

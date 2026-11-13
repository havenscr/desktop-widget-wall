/**
 * Media players by the id their media session reports (`source_app_id`: a Windows
 * AppUserModelId such as `SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify`, or a process name
 * such as `Spotify.exe`). Each known player has its display name and the process names its
 * audio session runs under (normalised: lower case, no `.exe`, letters and digits only).
 */
interface KnownPlayer {
  name: string;
  /** Process names (normalised) of its audio sessions; also matched against a process-form id. */
  processes: readonly string[];
  /** Package family names (lower case, before the `_hash`), each matched whole. */
  packages?: readonly RegExp[];
  /** Bare app ids (normalised) the player registers, such as Firefox's install hash. */
  ids?: readonly string[];
}

/**
 * Known players. Every rule matches a whole token of the id (a process name, a package
 * family name or a bare id), never a part of one, so "NotSpotify.exe" or
 * "ChromeHelper.exe" is never taken for Spotify or Chrome.
 */
const KNOWN: readonly KnownPlayer[] = [
  { name: 'Spotify', processes: ['spotify'], packages: [/^spotifyab\.spotifymusic$/] },
  { name: 'Apple Music', processes: ['applemusic', 'itunes'], packages: [/^appleinc\.applemusicwin$/, /^appleinc\.itunes$/] },
  { name: 'Media Player', processes: ['microsoftmediaplayer', 'musicui'], packages: [/^microsoft\.zunemusic$/] },
  { name: 'Groove Music', processes: ['musicui'] },
  { name: 'Edge', processes: ['msedge'], packages: [/^microsoft\.microsoftedge(\.(stable|beta|dev|canary))?$/] },
  { name: 'Chrome', processes: ['chrome'], ids: ['googlechrome'] },
  { name: 'Firefox', processes: ['firefox'], ids: ['308046b0af4a39cb'] },
  { name: 'Brave', processes: ['brave'] },
  { name: 'Opera', processes: ['opera'] },
  { name: 'VLC', processes: ['vlc'], ids: ['videolanvlc'] },
  { name: 'Amazon Music', processes: ['amazonmusic'], packages: [/^amazonmobilellc\.amazonmusic$/] },
  { name: 'TIDAL', processes: ['tidal'], packages: [/^tidalmusicas\.tidalmusic$/] },
  { name: 'Deezer', processes: ['deezer'], packages: [/^deezer\.[0-9a-z]+$/] },
  { name: 'YouTube Music', processes: ['youtubemusic'], ids: ['comgithubthchyoutubemusic'] },
  { name: 'Plexamp', processes: ['plexamp'] },
  { name: 'MusicBee', processes: ['musicbee'] },
  { name: 'foobar2000', processes: ['foobar2000'] },
];

/** Lower case, no `.exe`, letters and digits only: how process names are compared. */
export const squash = (s: string) => s.toLowerCase().replace(/\.exe$/, '').replace(/[^a-z0-9]/g, '');

const generic = (s: string) => s === '' || /^app(\.exe)?$/i.test(s);

/** "PlayerName" to "Player Name"; leaves runs of capitals ("VLC") alone. */
const spaced = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

/** A source id split into the tokens rules match: a process, a package, or a bare id. */
type Parsed =
  | { kind: 'process'; process: string }
  | { kind: 'package'; family: string; entry: string }
  | { kind: 'bare'; id: string };

/**
 * `C:\\...\\vlc.exe` or `Spotify.exe` is a process (its file name without `.exe`);
 * `Publisher.Name_hash!Entry` is a package (family `Publisher.Name`, the entry after `!`);
 * anything else (`MSEdge`, `Chrome`, a label such as "Apple Music") is a bare id.
 */
function parse(raw: string): Parsed | null {
  const text = raw.trim();
  if (!text) return null;
  const file = text.split(/[\\/]/).filter(Boolean).pop() ?? '';
  if (file.includes('!')) {
    const [pkg = '', entry = ''] = file.split('!');
    return { kind: 'package', family: (pkg.split('_')[0] ?? '').trim(), entry: entry.trim() };
  }
  if (/[\\/]/.test(text) || /\.exe$/i.test(file)) return { kind: 'process', process: file.replace(/\.exe$/i, '').trim() };
  return { kind: 'bare', id: file };
}

/**
 * A readable name for an id no rule knows: a process's file name without `.exe`; for a
 * packaged app the entry, or the package name when the entry is the bare word `App`; a
 * bare id as it is. Never "App" on its own (then "Media player").
 */
export function cleanAppName(raw: string): string {
  const p = parse(raw);
  if (!p) return 'Media player';
  let name: string;
  if (p.kind === 'process') name = p.process;
  else if (p.kind === 'package') {
    const entry = p.entry.replace(/\.exe$/i, '');
    name = !generic(entry) && !entry.includes('.') ? entry : (p.family.split('.').filter(Boolean).pop() ?? '');
  } else name = p.id;
  return generic(name) ? 'Media player' : spaced(name);
}

function known(source: string): KnownPlayer | null {
  const p = parse(source);
  if (!p) return null;
  if (p.kind === 'package') {
    const family = p.family.toLowerCase();
    return KNOWN.find((k) => k.packages?.some((re) => re.test(family))) ?? null;
  }
  if (p.kind === 'process') {
    const proc = squash(p.process);
    return KNOWN.find((k) => k.processes.includes(proc)) ?? null;
  }
  // A bare id: one of the player's ids or process names, or its own name (an older label).
  const id = squash(p.id);
  return KNOWN.find((k) => k.ids?.includes(id) || k.processes.includes(id) || squash(k.name) === id) ?? null;
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

/**
 * The process names (normalised) whose audio session belongs to this source: from the
 * known players' table, else the cleaned name itself. Matching against sessions is exact,
 * never a part of a name, so one app is never taken for another.
 */
export function playerProcesses(source: string | null | undefined): readonly string[] {
  if (!source || !source.trim()) return [];
  const k = known(source);
  if (k) return k.processes;
  // Unknown: a process-form id is its own process name ("Foo.Bar.Baz.exe"); otherwise the
  // cleaned name ("Vendor.NightPlayer_hash!App" to `NightPlayer.exe`).
  const p = parse(source);
  const name = p?.kind === 'process' ? squash(p.process) : squash(cleanAppName(source));
  return name && name !== 'mediaplayer' ? [name] : [];
}

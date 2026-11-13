/**
 * Media players by the id their media session reports (`source_app_id`: a Windows
 * AppUserModelId such as `SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify`, or a process name
 * such as `Spotify.exe`). Each known player has its display name and the process names its
 * audio session runs under (normalised: lower case, no `.exe`, letters and digits only).
 */
interface KnownPlayer {
  /** Matched against the id in lower case. */
  id: RegExp;
  name: string;
  processes: readonly string[];
}

/** Order matters where ids overlap: Edge before Chrome. */
const KNOWN: readonly KnownPlayer[] = [
  { id: /spotify/, name: 'Spotify', processes: ['spotify'] },
  { id: /applemusic|itunes|appleinc\./, name: 'Apple Music', processes: ['applemusic', 'itunes'] },
  { id: /zunemusic|microsoft\.media\.player|mediaplayer/, name: 'Media Player', processes: ['microsoftmediaplayer', 'musicui'] },
  { id: /groove/, name: 'Groove Music', processes: ['musicui'] },
  { id: /msedge|microsoftedge|^edge$/, name: 'Edge', processes: ['msedge'] },
  { id: /chrome/, name: 'Chrome', processes: ['chrome'] },
  { id: /firefox|308046b0af4a39cb/, name: 'Firefox', processes: ['firefox'] },
  { id: /brave/, name: 'Brave', processes: ['brave'] },
  { id: /opera/, name: 'Opera', processes: ['opera'] },
  { id: /vlc/, name: 'VLC', processes: ['vlc'] },
  { id: /amazonmusic|amazon music/, name: 'Amazon Music', processes: ['amazonmusic'] },
  { id: /tidal/, name: 'TIDAL', processes: ['tidal'] },
  { id: /deezer/, name: 'Deezer', processes: ['deezer'] },
  { id: /youtube-?music|youtubemusic/, name: 'YouTube Music', processes: ['youtubemusic'] },
  { id: /plexamp/, name: 'Plexamp', processes: ['plexamp'] },
  { id: /musicbee/, name: 'MusicBee', processes: ['musicbee'] },
  { id: /foobar2000/, name: 'foobar2000', processes: ['foobar2000'] },
];

/** Lower case, no `.exe`, letters and digits only: how process names are compared. */
export const squash = (s: string) => s.toLowerCase().replace(/\.exe$/, '').replace(/[^a-z0-9]/g, '');

const generic = (s: string) => s === '' || /^app(\.exe)?$/i.test(s);

/** "PlayerName" to "Player Name"; leaves runs of capitals ("VLC") alone. */
const spaced = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

/**
 * A readable name for an id no rule knows: the file name of a path without `.exe`; for a
 * packaged app (`Publisher.Name_hash!Entry`) the entry, or the package name when the entry
 * is the bare word `App`. Never "App" on its own (then "Media player").
 */
export function cleanAppName(raw: string): string {
  const file = raw.trim().split(/[\\/]/).filter(Boolean).pop() ?? '';
  const [pkg = '', entry = ''] = file.split('!');
  const strip = (s: string) => s.trim().replace(/\.exe$/i, '');
  const e = strip(entry);
  if (!generic(e) && !e.includes('.')) return spaced(e);
  const base = strip(pkg.split('_')[0] ?? '');
  const name = base.split('.').filter(Boolean).pop() ?? '';
  return generic(name) ? 'Media player' : spaced(name);
}

function known(id: string): KnownPlayer | null {
  const lower = id.toLowerCase();
  return KNOWN.find((p) => p.id.test(lower)) ?? null;
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
  const name = squash(cleanAppName(source));
  return name ? [name] : [];
}

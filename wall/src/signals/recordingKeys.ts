import { IconBookmark, IconPlayerPause, IconPlayerStopFilled, IconScreenshot, type Icon } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { invoke } from '../bridge/tauri';
import type { LibGroup } from '../work/libraryModel';

/** One key of the Recording page: a key of the built-in library, sent by its id. */
export interface RecordingKey {
  /** The library id `wall2_keys_send_library` takes. */
  id: 'rec-stop' | 'rec-toggle' | 'rec-marker' | 'snip';
  label: string;
  icon: Icon;
  /** Drawn with the red edge. */
  stop?: boolean;
  /** Where the press goes, for the words of a result: the recorder, or the app in front. */
  to: 'the recorder' | 'the app in front';
}

/** The Recording page, in order. Rust lets the first three through whatever is in front, only while a recorder is running. */
export const RECORDING_KEYS: readonly RecordingKey[] = [
  { id: 'rec-stop', label: 'Stop recording', icon: IconPlayerStopFilled, stop: true, to: 'the recorder' },
  { id: 'rec-toggle', label: 'Pause', icon: IconPlayerPause, to: 'the recorder' },
  { id: 'rec-marker', label: 'Mark moment', icon: IconBookmark, to: 'the recorder' },
  { id: 'snip', label: 'Snip', icon: IconScreenshot, to: 'the app in front' },
];

/** The name of the page in the Now heading. */
export const RECORDING_PAGE = 'Recording';

/** The hover card of a key: its action, the shortcut it sends (so it can be checked on the PC), and where it goes. */
export function recordingKeyTip(key: RecordingKey, how: string | undefined): string {
  const chord = how ? ` It sends ${how}.` : '';
  const action = key.id === 'rec-toggle' ? 'Pause the recording, or resume it' : key.id === 'rec-stop' ? 'Stop the recording' : key.id === 'rec-marker' ? 'Add a marker at this moment' : 'Take a screen snip';
  const check = key.id === 'snip' ? '' : ' This is a shortcut to check on your PC against the recorder\'s own settings.';
  return `${action}.${chord}${check}`;
}

let cache: Promise<Map<string, string>> | null = null;

/** The library's own text for each key's shortcut, read once (the same read the picker uses). */
function loadHows(): Promise<Map<string, string>> {
  cache ??= invoke<LibGroup[]>('wall2_keys_library').then(
    (groups) => {
      const m = new Map<string, string>();
      if (Array.isArray(groups)) for (const g of groups) for (const k of g.keys) m.set(k.id, k.how);
      return m;
    },
    () => {
      cache = null;
      return new Map<string, string>();
    },
  );
  return cache;
}

/** The shortcut text per key id; empty until the library has been read, and when it cannot be. */
export function useRecordingHows(): Map<string, string> {
  const [hows, setHows] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let live = true;
    void loadHows().then((m) => live && setHows(m));
    return () => {
      live = false;
    };
  }, []);
  return hows;
}

/** Tests: forget the shared read. */
export function resetRecordingHows(): void {
  cache = null;
}

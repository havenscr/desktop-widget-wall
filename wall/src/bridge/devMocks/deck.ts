import { saveMode } from '../../work/keysModel';
import { LIBRARY_DATA } from './libraryData';
import { knob, longOr } from './long';
import { mocks } from '../tauri';

/**
 * Dev only: the Always here and Now rows of Work's right wing, with invented sets, the key
 * library (`wall2_keys_library`) and pins. What waits for the "For you" page comes from the
 * agents, meeting and network mocks (`?agents=`, `?meet=none`, `?net=calm`).
 * `?arrange=` is `ok` (default), `none` (the wall is the only monitor), `nowin` (a layout
 * finds no windows) or `off` (the commands are missing, so the row is not drawn).
 * `?keys=` is `typical` (a Power BI like app in front, a general set and its own set),
 * `general` (another app in front, so the general set shows), `nogeneral` (another app, no
 * general set: "No keys for this app"), `idle`, `many` (eight keys), `one`, `wrong` (a held
 * set whose app is not in front, so a click is refused), `refuse` (Power BI cannot be
 * brought forward), `problem` (keys.json invalid), `library` (twelve pages as the Rust side
 * builds them: two sets of the file's own, General and the nine built-in sets from the key
 * library, whose labels carry their group's name, "VS Code: command palette"; VS Code is in
 * front) or `off`. `?hold=<set id>` starts held (`lib-excel` shows a set whose app is not in front).
 * `?pins=long` pins the five longest library labels.
 */
const key = (label: string, icon: string, action: string | null = null) => ({ label, icon, action });

export function registerDeckMocks(): void {
  const arrange = knob('arrange') ?? 'ok';
  if (arrange !== 'off') {
    mocks.set('wall2_arrange_status', () => arrange !== 'none');
    mocks.set('wall2_arrange', (args) => {
      if (arrange === 'nowin') throw 'no windows';
      return { moved: args?.layout === 'zones' ? 4 : 3, asked: args?.layout === 'zones' ? 4 : 3 };
    });
    mocks.set('wall2_arrange_undo', () => 3);
  }

  const mode = knob('keys') ?? 'typical';
  if (mode === 'off') return;
  const general = {
    id: 'general',
    name: 'General',
    general: true,
    keys: [
      key('Snip', 'screenshot'),
      key(longOr('Clipboard', 'Clipboard history'), 'clipboard'),
      key(longOr('Desktop', 'Show desktop'), 'desktop'),
      key('Lock the PC', 'lock', 'lock'),
      key('Focus 25', 'timer', 'focus:25'),
    ],
  };
  const app = {
    id: 'sales',
    name: longOr('Sales app', 'Quarterly sales dashboard'),
    general: false,
    keys: [key('Format', 'brush'), key('Refresh', 'refresh'), key('Perf', 'gauge'), key('Tables', 'code'), key('Snip', 'screenshot')],
  };
  const many = { ...app, id: 'many', name: 'Big set', keys: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', longOr('Hotel', 'Hotel long label')].map((l) => key(l, 'keyboard')) };
  const one = { ...app, id: 'one', name: 'One key', keys: [key('Refresh', 'refresh')] };

  let sets = [general, app];
  let autoId: string | null = 'sales';
  let front: 'app' | 'idle' = 'app';
  let exe: string | null = null;
  switch (mode) {
    case 'general':
      autoId = 'general';
      exe = 'notepad.exe';
      break;
    case 'nogeneral':
      sets = [app];
      autoId = null;
      exe = 'notepad.exe';
      break;
    case 'idle':
      autoId = null;
      front = 'idle';
      break;
    case 'many':
      sets = [many, general];
      autoId = 'many';
      break;
    case 'one':
      sets = [one, general];
      autoId = 'one';
      break;
    case 'library': {
      // As `wall2_keys::with_builtin_sets` lists them: the file's own sets, then General and one per app group.
      const lib = (group: string) => LIBRARY_DATA.find((g) => g.id === group)?.keys.filter((k) => k.runnable).slice(0, 8).map((k) => key(k.label, k.icon, k.action)) ?? [];
      const builtIn: [string, string, string][] = [
        ['teams', 'lib-teams', 'Teams'],
        ['zoom', 'lib-zoom', 'Zoom'],
        ['agents', 'lib-agents', 'OmniGent'],
        ['vscode', 'lib-vscode', 'VS Code'],
        ['browser', 'lib-browser', 'Browser'],
        ['mail', 'lib-mail', 'Mail'],
        ['recording', 'lib-recording', 'Recording'],
        ['powerbi', 'lib-powerbi', 'Power BI'],
        ['excel', 'lib-excel', 'Excel'],
      ];
      sets = [app, many, { ...general, id: 'lib-general', keys: lib('anywhere').slice(0, 5) }, ...builtIn.map(([g, id, name]) => ({ id, name, general: false, keys: lib(g) }))];
      autoId = 'lib-vscode';
      break;
    }
    case 'wrong':
      autoId = 'general';
      exe = 'notepad.exe';
      saveMode({ hold: true, setId: 'sales' });
      break;
  }
  const hold = knob('hold');
  if (hold) saveMode({ hold: true, setId: hold });

  // `?pins=long`: the five longest library labels pinned (the Always here row with long labels).
  const defaultPins =
    knob('pins') === 'long'
      ? ['lib:sonos-play', 'lib:xl-repeat', 'lib:vscode-search', 'lib:pt-ocr', 'lib:rec-windows']
      : ['lib:thirds', 'lib:focus', 'lib:record-169', 'lib:snip', 'lib:strip-dark'];
  mocks.set('wall2_keys_summary', () => {
    if (mode === 'problem') throw 'app 2, key 3: chord is not in the allowed key list';
    return { front, autoId, exe, sets, source: knob('source') === 'default' ? 'default' : 'file', defaultPins, filePins: [] };
  });
  mocks.set('wall2_keys_library', () => LIBRARY_DATA);
  // Rust runs lock and monitors-to-sleep; every other action is answered by name for the page to run.
  const answer = (action: string | null) => (action === null || action === 'lock' || action === 'displays:off' ? null : action);
  mocks.set('wall2_keys_send', (args) => {
    if (mode === 'refuse') throw 'not forward';
    const set = args?.setId === 'pinned' ? null : sets.find((s) => s.id === args?.setId);
    if (!set) throw 'no key';
    if (!set.general && autoId !== set.id) throw 'no app';
    return answer(set.keys[Number(args?.index)]?.action ?? null);
  });
  mocks.set('wall2_keys_send_library', (args) => {
    if (mode === 'refuse') throw 'not forward';
    const hit = LIBRARY_DATA.flatMap((g) => g.keys).find((k) => k.id === args?.id);
    if (!hit || !hit.runnable) throw 'no key';
    return answer(hit.action);
  });
}

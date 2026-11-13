import { saveMode } from '../../work/keysModel';
import { knob, longOr } from './long';
import { mocks } from '../tauri';

/**
 * Dev only: the Big screen and Keys rows of Work's right wing, with invented sets.
 * `?arrange=` is `ok` (default), `none` (the wall is the only monitor), `nowin` (a layout
 * finds no windows) or `off` (the commands are missing, so the row is not drawn).
 * `?keys=` is `typical` (a Power BI like app in front, a general set and its own set),
 * `general` (another app in front, so the general set shows), `nogeneral` (another app, no
 * general set: "No keys for this app"), `idle`, `many` (eight keys), `one`, `wrong` (a held
 * set whose app is not in front, so a click is refused), `refuse` (Power BI cannot be
 * brought forward), `problem` (keys.json invalid) or `off`. `?hold=<set id>` starts held.
 */
const key = (label: string, icon: string) => ({ label, icon });

export function registerDeckMocks(): void {
  const arrange = knob('arrange') ?? 'ok';
  if (arrange !== 'off') {
    mocks.set('wall2_arrange_status', () => arrange !== 'none');
    mocks.set('wall2_arrange', () => {
      if (arrange === 'nowin') throw 'no windows';
      return 3;
    });
    mocks.set('wall2_arrange_undo', () => 3);
  }

  const mode = knob('keys') ?? 'typical';
  if (mode === 'off') return;
  const general = {
    id: 'general',
    name: 'General',
    general: true,
    keys: [key('Snip', 'screenshot'), key(longOr('Clipboard', 'Clipboard history'), 'clipboard'), key(longOr('Desktop', 'Show desktop'), 'desktop')],
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
    case 'wrong':
      autoId = 'general';
      exe = 'notepad.exe';
      saveMode({ hold: true, setId: 'sales' });
      break;
  }
  const hold = knob('hold');
  if (hold) saveMode({ hold: true, setId: hold });

  mocks.set('wall2_keys_summary', () => {
    if (mode === 'problem') throw 'app 2, key 3: chord is not in the allowed key list';
    return { front, autoId, exe, sets, source: 'file' };
  });
  mocks.set('wall2_keys_send', (args) => {
    if (mode === 'refuse') throw 'not forward';
    const set = sets.find((s) => s.id === args?.setId);
    if (!set) throw 'no key';
    if (!set.general && autoId !== set.id) throw 'no app';
    return undefined;
  });
}

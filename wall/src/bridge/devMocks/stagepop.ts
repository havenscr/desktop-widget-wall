import { mocks } from '../tauri';
import { knob, longOr } from './long';
import type { SpStatus } from '../../onair/v2/stagepopModel';

/**
 * Dev only: the stage pop-out commands, for `npm run dev` and the gallery. The names are invented.
 *
 *   ?sp=open|closed|waiting|full|busy|off   (default `open`)
 *       open     connected, window open, a guest's camera showing
 *       closed   connected, window closed, Stage showing
 *       waiting  the add-on is not connected
 *       full     connected, window full screen
 *       busy     the port is taken by another program
 *       off      the link is off
 *   ?spshare=none    no screen share in the list (default: Stage, Share and three cameras)
 *   ?spcode=ready    a code made but not shown yet (default: shown once already)
 *   ?spplace=none    no Elgato monitor found and no saved place
 */
const CAMERAS = () => [longOr('Maya', 'Alexandria Montgomery-Featherstonehaugh the Third'), 'Theo', 'Priya'];

export function registerStagePopMocks(): void {
  const knobState = () => knob('sp') ?? 'open';
  const feeds = () => [
    { key: 'stage', name: 'Stage' },
    ...(knob('spshare') === 'none' ? [] : [{ key: 'share-1', name: 'Screenshare' }]),
    ...CAMERAS().map((name, i) => ({ key: `cam-${i + 1}`, name })),
  ];
  // The mock keeps what the commands changed, as the add-on would report it.
  let mode: string | null = null;
  let open: boolean | null = null;
  let full: boolean | null = null;
  const view = (): SpStatus => {
    const k = knobState();
    const up = k === 'open' || k === 'closed' || k === 'full';
    const place = knob('spplace') === 'none' ? { left: null, top: null, source: 'none' as const } : { left: 2560, top: 80, source: 'elgato' as const };
    return {
      state: k === 'waiting' ? 'waiting' : k === 'busy' ? 'port busy' : k === 'off' ? 'off' : 'connected',
      feeds: up ? feeds() : [],
      mode: up ? (mode ?? (k === 'open' || k === 'full' ? 'cam-3' : 'stage')) : null,
      window: { open: up ? (open ?? k !== 'closed') : false, fullscreen: up ? (full ?? k === 'full') : false },
      placement: place,
      token: knob('spcode') === 'ready' ? 'ready' : 'hidden',
    };
  };
  mocks.set('wall2_stagepop_status', () => view());
  mocks.set('wall2_stagepop_send', (args) => {
    const cmd = args?.cmd as { type?: string; key?: string; on?: boolean } | undefined;
    const v = view();
    if (v.state !== 'connected') throw 'not connected';
    if (cmd?.type === 'open') open = true;
    else if (cmd?.type === 'close') {
      open = false;
      full = false;
    } else if (cmd?.type === 'fullscreen') full = cmd.on === true;
    else if (cmd?.type === 'mode' && v.feeds.some((f) => f.key === cmd.key)) mode = String(cmd.key);
    else throw 'invalid';
  });
  mocks.set('wall2_stagepop_token', (args) => {
    if (args?.action === 'show' && knob('spcode') !== 'ready') throw 'hidden';
    return 'dev-pairing-code-0000-1111-2222-3333';
  });
  mocks.set('wall2_stagepop_placement_set', () => undefined);
}

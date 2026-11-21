import { IconAppWindow, IconBroadcast, IconFileText, IconPlayerStopFilled, IconScreenShare, IconUser, IconUsers, type Icon } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '../../bridge/tauri';
import { tip } from '../../ui/HoverTip';
import { useOnAirStore } from '../store';
import { statusStale } from '../ytlive';
import { useYtLive } from '../ytliveStore';
import { LibTile, MarkTile, TileRow, Head } from './Tiles';
import { agoText, needsConfirm, refusalText, STUDIO_CONFIRM_MS, STUDIO_LABEL, type StudioKey } from './studioModel';
import { useStudio } from './studioStore';
import { useDeckKeys } from './useDeckKeys';

const ICON: Record<StudioKey, Icon> = { solo: IconUser, two: IconUsers, share: IconScreenShare, golive: IconBroadcast, end: IconPlayerStopFilled };

const OFF_TIP = 'Set this key in the keys file';

/** The studio keys box: row 1 the StreamYard keys, row 2 the three keys that work anywhere. */
export function StudioKeys({ now }: { now: number }) {
  const keys = useDeckKeys();
  const mark = useOnAirStore((s) => s.mark);
  const marking = useOnAirStore((s) => s.marking);
  const status = useStudio((s) => s.status);
  const sent = useStudio((s) => s.sent);
  const send = useStudio((s) => s.send);
  const pick = useStudio((s) => s.pick);
  const yt = useYtLive((s) => s.status);
  const live = yt?.state === 'live' && !statusStale(yt, now);
  const [armed, setArmed] = useState<StudioKey | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busy = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  const picked = status.state === 'picked' || status.state === 'minimized';
  const unset = status.keys.length < 4;

  const press = async (key: StudioKey, detail: number) => {
    // A click that is part of a double click never counts, and neither does one while a send runs.
    if (detail > 1 || busy.current) return;
    if (needsConfirm(key) && armed !== key) {
      setArmed(key);
      keys.showBrief(`${STUDIO_LABEL[key]}? Click again`);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setArmed(null), STUDIO_CONFIRM_MS);
      return;
    }
    clearTimeout(timer.current);
    setArmed(null);
    busy.current = true;
    try {
      await send(key, needsConfirm(key));
    } catch (e) {
      keys.showBrief(refusalText(e));
    } finally {
      busy.current = false;
    }
  };

  const tile = (key: StudioKey) => {
    const I = ICON[key];
    const on = status.keys.includes(key);
    const isArmed = armed === key;
    const label = isArmed ? 'Click again' : STUDIO_LABEL[key];
    return (
      <button
        key={key}
        type="button"
        className={`deck-tile key-tile oa2-sk${on ? '' : ' off'}`}
        data-armed={isArmed ? 'true' : undefined}
        data-key={key}
        aria-label={isArmed ? `${STUDIO_LABEL[key]}? Click again` : STUDIO_LABEL[key]}
        aria-disabled={on ? undefined : 'true'}
        onKeyDown={(e) => e.repeat && e.preventDefault()}
        onClick={(e) => (on ? void press(key, e.detail) : keys.showBrief(OFF_TIP))}
        {...tip(on ? (needsConfirm(key) ? `${STUDIO_LABEL[key]} in StreamYard. Click twice within 3 seconds. StreamYard is then sent the key twice.` : `Send the ${STUDIO_LABEL[key]} hotkey to the StreamYard window you picked.`) : OFF_TIP)}
      >
        <I size={22} stroke={1.8} aria-hidden="true" />
        <span className="deck-lbl">{label}</span>
      </button>
    );
  };

  const right = sent ? `Sent: ${STUDIO_LABEL[sent.key]}, ${agoText(sent.at, now)}` : 'No key sent yet';
  const action = !picked || unset ? (
    <button
      type="button"
      className="oa-btn oa2-hdbtn"
      onClick={() => (picked ? void invoke('wall2_open_keys_file').catch(() => keys.showBrief('Could not open the keys file')) : void pick())}
      {...tip(picked ? 'Open your keys file to add the StreamYard hotkeys under "studio".' : 'Then click the StreamYard browser window within 10 seconds.')}
    >
      {picked ? <IconFileText size={20} aria-hidden="true" /> : <IconAppWindow size={20} aria-hidden="true" />}
      {picked ? 'Open keys file' : 'Pick window'}
    </button>
  ) : undefined;

  return (
    <div className="oa2-b oa2-studiokeys" role="group" aria-label="Studio keys">
      <Head label="Studio keys" brief={keys.brief} right={right} action={action} />
      <div className="oa2-skrow1">
        <div className="deck-tiles keys-tiles oa2-tiles" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
          {tile('solo')}
          {tile('two')}
          {tile('share')}
          {live ? tile('end') : tile('golive')}
        </div>
      </div>
      <div className="oa2-skrow2">
        <TileRow keys={keys} cols={3}>
          <MarkTile mark={mark} showMs={undefined} marking={marking} />
          <LibTile keys={keys} spec={{ id: 'snip' }} />
          <LibTile keys={keys} spec={{ id: 'strip-dark' }} />
        </TileRow>
      </div>
    </div>
  );
}

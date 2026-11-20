import { IconArrowsMaximize, IconArrowsMinimize, IconDeviceDesktopCog, IconDeviceTv, IconExternalLink, IconLayoutGrid, IconPlugConnectedX, IconScreenShare, IconUser, IconX } from '@tabler/icons-react';
import { tip } from '../../ui/HoverTip';
import { useToolsStore } from '../../tools/store';
import { isShare, spBanner, spLabel, spOrder, spViewTip, spWord, SP_NOT_CONNECTED_TIP, SP_OPEN_TIP, SP_OPEN_TIP_FREE, type SpFeed } from './stagepopModel';
import { useStagePop } from './stagepopStore';

const NOTE = 'Name tags and banners are not drawn.';

function ViewIcon({ f }: { f: SpFeed }) {
  if (f.key === 'stage') return <IconLayoutGrid size={20} aria-hidden="true" />;
  return isShare(f) ? <IconScreenShare size={20} aria-hidden="true" /> : <IconUser size={20} aria-hidden="true" />;
}

/**
 * The prompter box on the Live page: the Firefox add-on's pop-out window, driven from the wall. Heading with what the
 * add-on reports (Closed, Open, Full screen), Open or Close, Full screen and the Tools link; under it one button per
 * view the add-on lists (Stage, Share, each camera). The wall shows what the add-on reports, never what it asked for.
 */
export function StagePop() {
  const s = useStagePop((st) => st.status);
  const failed = useStagePop((st) => st.failed);
  const send = useStagePop((st) => st.send);
  const connected = s.state === 'connected';
  const { open, fullscreen } = s.window;
  const banner = spBanner(s);
  const word = spWord(s);
  const free = s.placement.source === 'none';
  return (
    <div className="oa2-b oa2-stagepop" role="group" aria-label="Prompter">
      <div className="oa2-hd">
        <IconDeviceTv size={20} aria-hidden="true" />
        <span className="k">Prompter</span>
        <span className="oa2-hd-r ellipsis" role="status">
          {word}
        </span>
        {connected && open ? (
          <button type="button" className="oa-btn sm" onClick={() => void send({ type: 'close' })} {...tip('Close the pop-out window')}>
            <IconX size={18} aria-hidden="true" />
            Close
          </button>
        ) : (
          <button type="button" className="oa-btn sm" aria-disabled={!connected} onClick={() => connected && void send({ type: 'open' })} {...tip(connected ? (free ? SP_OPEN_TIP_FREE : SP_OPEN_TIP) : SP_NOT_CONNECTED_TIP)}>
            <IconExternalLink size={18} aria-hidden="true" />
            Open
          </button>
        )}
        <button
          type="button"
          className={`oa-btn sm${fullscreen ? ' cy' : ''}`}
          aria-pressed={fullscreen}
          aria-disabled={!connected || !open}
          onClick={() => connected && open && void send({ type: 'fullscreen', on: !fullscreen })}
          {...tip(!connected || !open ? 'Open the pop-out window first' : fullscreen ? 'Leave full screen' : 'Make the pop-out window full screen')}
        >
          {fullscreen ? <IconArrowsMinimize size={18} aria-hidden="true" /> : <IconArrowsMaximize size={18} aria-hidden="true" />}
          Full screen
        </button>
        <button type="button" className="oa-btn sm oa2-sp-cog" aria-label="Pop-out placement and pairing code in Tools" onClick={() => useToolsStore.getState().openDrawer('stagepop')} {...tip('Opens Tools at Stage pop-out: where the window opens, and the pairing code')}>
          <IconDeviceDesktopCog size={20} aria-hidden="true" />
        </button>
      </div>
      {banner ? (
        <div className="oa2-sp-banner" role="status" {...tip(banner)}>
          <IconPlugConnectedX size={20} aria-hidden="true" />
          <span className="ellipsis">{banner}</span>
        </div>
      ) : (
        <div className="oa2-seg oa2-sp-seg" role="radiogroup" aria-label="Pop-out view">
          {spOrder(s.feeds).map((f) => (
            <button key={f.key} type="button" role="radio" className="oa2-segb oa2-sp-view" aria-checked={s.mode === f.key} onClick={() => s.mode !== f.key && void send({ type: 'mode', key: f.key })} {...tip(spViewTip(f))}>
              <ViewIcon f={f} />
              <span className="ellipsis">{spLabel(f)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="oa2-sp-note ellipsis" role={failed ? 'alert' : undefined} data-failed={failed ? 'true' : 'false'}>
        {failed ? 'The add-on did not take that. Try again.' : NOTE}
      </div>
    </div>
  );
}

import { IconAppWindow } from '@tabler/icons-react';
import { tip } from '../../ui/HoverTip';
import { Head } from './Tiles';
import { agoText, BROWSER_NAME, needsFind, STUDIO_LABEL, type PickStatus } from './studioModel';
import { useStudio } from './studioStore';

const WINDOW_LINE: Record<PickStatus['state'], string> = {
  none: 'Studio window: no StreamYard window found',
  several: 'Studio window: more than one StreamYard window found',
  waiting: 'Studio window: click it now',
  picked: 'Studio window in use',
  minimized: 'Studio window: minimized',
};

/** What the wall knows about StreamYard: the last key it sent and the window it picked. It never shows what is live. */
export function StudioStatus({ now }: { now: number }) {
  const status = useStudio((s) => s.status);
  const sent = useStudio((s) => s.sent);
  const pick = useStudio((s) => s.pick);
  const warn = status.state === 'minimized';
  const waiting = status.state === 'waiting';
  const inUse = status.state === 'picked' || status.state === 'minimized';
  const what = status.browser ? (status.studio === false ? `${BROWSER_NAME[status.browser]} window you picked` : `StreamYard in ${BROWSER_NAME[status.browser]}`) : '';
  const line = WINDOW_LINE[status.state] + (inUse && what ? (status.state === 'picked' ? `: ${what}` : ` (${what})`) : '');
  return (
    <div className="oa2-b oa2-studiostatus" role="group" aria-label="StreamYard studio, what the wall knows">
      <Head
        label="StreamYard studio"
        action={
          <button type="button" className={needsFind(status.state) ? 'oa-btn cy oa2-hdbtn' : 'oa-btn oa2-hdbtn'} aria-disabled={waiting} onClick={() => !waiting && void pick()} {...tip('Then click the StreamYard browser window within 10 seconds. Only a browser window is taken.')}>
            <IconAppWindow size={20} aria-hidden="true" />
            {waiting ? 'Waiting' : 'Find window'}
          </button>
        }
      />
      <div className="oa2-sub oa2-st-l" {...tip('The last studio key this wall sent.')}>
        {sent ? `Last key sent: ${STUDIO_LABEL[sent.key]}, ${agoText(sent.at, now)}` : 'No key sent yet'}
      </div>
      <div className="oa2-sub oa2-st-l" data-warn={warn ? 'true' : undefined} {...tip('The browser window the keys go to. Found by the wall, or picked by you. Kept in memory only.')}>
        {line}
      </div>
      <div className="oa2-st-fine" {...tip('StreamYard has no way to tell the wall. This shows what the wall sent.')}>
        The wall cannot see which layout is live. It shows what it sent.
      </div>
    </div>
  );
}

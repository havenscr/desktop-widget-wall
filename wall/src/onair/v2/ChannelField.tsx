import { IconBroadcast, IconCheck } from '@tabler/icons-react';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { tip } from '../../ui/HoverTip';
import { useYtLive } from '../ytliveStore';

/** The two channels the shows go out on. Public YouTube handles; the lead confirms them. */
export const AE_CHANNEL = '@AnalyticEndeavors';
export const HC_CHANNEL = '@HavensConsulting';

export const CHANNEL_CHIPS = [
  { name: 'Analytic Endeavors', handle: AE_CHANNEL },
  { name: 'Havens Consulting', handle: HC_CHANNEL },
] as const;

const FIELD_TIP =
  'The YouTube channel your StreamYard shows go out on. Tap one to read its live state and chat with your YouTube sign-in; nothing is posted.';

/** The tapped handle, kept on this PC so the right chip lights whatever the channel's YouTube title says. Not a secret. */
export const HANDLE_KEY = 'wall2-comments-channel-handle';

function readHandle(): string | null {
  try {
    return window.localStorage.getItem(HANDLE_KEY);
  } catch {
    return null;
  }
}

function writeHandle(handle: string | null): void {
  try {
    if (handle === null) window.localStorage.removeItem(HANDLE_KEY);
    else window.localStorage.setItem(HANDLE_KEY, handle);
  } catch {
    // Storage may be blocked; the title fallback still lights the chip.
  }
}

/** The index of the chip to light: the stored handle when it is one of ours, else the chip name found in the saved title. */
export function litChip(title: string | null | undefined, stored: string | null): number {
  const byHandle = CHANNEL_CHIPS.findIndex((c) => stored !== null && c.handle.toLowerCase() === stored.toLowerCase());
  if (byHandle >= 0) return byHandle;
  const t = (title ?? '').toLowerCase();
  return t === '' ? -1 : CHANNEL_CHIPS.findIndex((c) => t.includes(c.name.toLowerCase()));
}

/**
 * The channel picker, inside the comments card: one chip per channel, no text field. A tap saves that channel through YouTube's
 * check; the chip for the saved channel is lit. "Checking the channel" shows while it asks, and the fixed error line when it fails.
 */
export function ChannelField({ onClose, firstTime }: { onClose: () => void; firstTime: boolean }) {
  const checking = useYtLive((s) => s.checking);
  const error = useYtLive((s) => s.channelError);
  const saved = useYtLive((s) => s.channel);
  const setChannel = useYtLive((s) => s.setChannel);
  const clear = useYtLive((s) => s.clearChannelError);
  const lit = saved?.set === true ? litChip(saved.title, readHandle()) : -1;
  const chips = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    chips.current[lit >= 0 ? lit : 0]?.focus();
    return () => clear();
    // Focus once, when the picker opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clear]);
  const pick = async (handle: string) => {
    if (checking) return;
    if (await setChannel(handle)) {
      writeHandle(handle);
      onClose();
    }
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      // Escape closes the picker only; the page stays as it is.
      e.stopPropagation();
      if (!checking) onClose();
    }
  };
  return (
    <div className="oa2-chf" data-checking={checking ? 'true' : 'false'} onKeyDown={onKey}>
      <div className="oa2-chf-row">
        <IconBroadcast size={20} aria-hidden="true" />
        {CHANNEL_CHIPS.map((c, i) => {
          const on = i === lit;
          return (
            <button
              key={c.handle}
              ref={(el) => {
                chips.current[i] = el;
              }}
              type="button"
              className="oa-btn oa2-chip"
              data-lit={on ? 'true' : 'false'}
              aria-pressed={on}
              aria-disabled={checking}
              onClick={() => void pick(c.handle)}
              {...tip(FIELD_TIP)}
            >
              {c.name}
            </button>
          );
        })}
        <button type="button" className="oa-btn" disabled={checking} onClick={onClose} {...tip(firstTime ? 'Close the picker; no channel is named yet' : 'Close the picker without changing the channel')}>
          Cancel
        </button>
      </div>
      {checking && (
        <div className="oa2-chf-note" role="status">
          Checking the channel
        </div>
      )}
      {error && !checking && (
        <div className="oa2-chf-note bad" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

/** The line at the foot of the card when no show is live: the channel's name, Change and Forget. */
export function ChannelLine({ title, onChange }: { title: string | null; onChange: () => void }) {
  const forget = useYtLive((s) => s.forgetChannel);
  return (
    <div className="oa2-chl">
      <IconCheck size={18} aria-hidden="true" />
      <span className="oa2-chl-t ellipsis" {...tip(title ? `Reads live state and chat of ${title}` : 'The channel is named')}>
        {title ? `Channel: ${title}` : 'Channel named'}
      </span>
      <button type="button" className="oa-btn sm" onClick={onChange} {...tip('Pick a different channel')}>
        Change
      </button>
      <button type="button" className="oa-btn sm" onClick={() => void forget()} {...tip('Stops reading this channel; nothing on YouTube changes')}>
        Forget
      </button>
    </div>
  );
}

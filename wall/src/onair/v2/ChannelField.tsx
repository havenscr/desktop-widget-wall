import { IconBroadcast, IconCheck } from '@tabler/icons-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { tip } from '../../ui/HoverTip';
import { useYtLive } from '../ytliveStore';

const FIELD_TIP =
  'The YouTube channel your StreamYard shows go out on. Type its handle (it starts with @) or paste its channel link. The wall reads its live state and chat with your YouTube sign-in; nothing is posted.';

/**
 * The channel field, inside the comments card: a text field with Save and Cancel, "Checking the channel" while it asks YouTube,
 * the fixed error line when YouTube has no such channel, and the channel's name once it is named. The text typed here is kept in
 * this component only and is never written anywhere.
 */
export function ChannelField({ onClose, firstTime }: { onClose: () => void; firstTime: boolean }) {
  const checking = useYtLive((s) => s.checking);
  const error = useYtLive((s) => s.channelError);
  const setChannel = useYtLive((s) => s.setChannel);
  const clear = useYtLive((s) => s.clearChannelError);
  const [value, setValue] = useState('');
  const field = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    field.current?.focus();
    return () => clear();
  }, [clear]);
  const ready = value.trim().length > 0 && !checking;
  const save = async () => {
    if (!ready) return;
    if (await setChannel(value.trim())) onClose();
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void save();
    else if (e.key === 'Escape') {
      // Escape closes the field only; the page stays as it is.
      e.stopPropagation();
      if (!checking) onClose();
    }
  };
  return (
    <div className="oa2-chf" data-checking={checking ? 'true' : 'false'}>
      <div className="oa2-chf-row">
        <IconBroadcast size={20} aria-hidden="true" />
        <input
          ref={field}
          className="tools-input oa2-chf-in"
          type="text"
          placeholder="@handle or channel link"
          aria-label="YouTube channel"
          autoComplete="off"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          disabled={checking}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKey}
          {...tip(FIELD_TIP)}
        />
        <button type="button" className="oa-btn cy sm" aria-disabled={!ready} onClick={() => void save()} {...tip('Check the channel with YouTube and save it on this PC')}>
          Save
        </button>
        <button type="button" className="oa-btn sm" disabled={checking} onClick={onClose} {...tip(firstTime ? 'Close the field; no channel is named yet' : 'Close the field without saving')}>
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
      <button type="button" className="oa-btn sm" onClick={onChange} {...tip('Type a different handle or channel link')}>
        Change
      </button>
      <button type="button" className="oa-btn sm" onClick={() => void forget()} {...tip('Stops reading this channel; nothing on YouTube changes')}>
        Forget
      </button>
    </div>
  );
}

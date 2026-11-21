import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { briefTokenStatus, clearBriefToken, setBriefToken } from '../bridge/meetBrief';
import { tip } from '../ui/HoverTip';
import { OFF_LINE } from './briefModel';

export const KEY_TIP = 'The brief key the box printed when the brief service was installed. It stays in Windows Credential Manager and goes only to your box.';
export const KEY_INVALID = 'That key is not the right shape';
export const KEY_FAILED = 'Could not save the key';

/**
 * The island's off line with its Connect button. Connect turns into a password field with Save and Cancel; the typed key lives in
 * this field only and is dropped the moment Save succeeds or the field closes. Escape closes the field and nothing else.
 */
export function BriefConnect({ onChanged }: { onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);
  const close = () => {
    setOpen(false);
    setValue('');
    setError(null);
  };
  const ready = value.trim().length > 0 && !busy;
  const save = () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    setBriefToken(value.trim()).then(
      () => {
        setBusy(false);
        close();
        onChanged?.();
      },
      (e) => {
        setBusy(false);
        setError(e === 'invalid' ? KEY_INVALID : KEY_FAILED);
      },
    );
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') save();
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (!busy) close();
    }
  };
  if (!open) {
    return (
      <>
        <span className="meet-brief-note meet-xs meet-dimline ellipsis">{OFF_LINE} ·</span>
        <button type="button" className="meet-btn cy meet-retry" onClick={() => setOpen(true)} {...tip(KEY_TIP)}>
          Connect
        </button>
      </>
    );
  }
  return (
    <div className="meet-keyfield">
      <input
        ref={field}
        className="tools-input meet-key-in"
        type="password"
        placeholder="Brief key"
        aria-label="Brief key"
        autoComplete="off"
        spellCheck={false}
        readOnly={busy}
        aria-busy={busy}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKey}
        {...tip(KEY_TIP)}
      />
      <button type="button" className="meet-btn cy" aria-disabled={!ready} onClick={save} {...tip('Save the key on this PC')}>
        Save
      </button>
      <button type="button" className="meet-btn" disabled={busy} onClick={close} {...tip('Close the field without saving')}>
        Cancel
      </button>
      {error && (
        <span className="meet-notice meet-xs" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/** "Connected" with Forget, under the feed when no meeting is on. Draws nothing until the key is known to be set. */
export function BriefConnected({ onChanged, known = false }: { onChanged?: () => void; known?: boolean }) {
  const [set, setSet] = useState(known);
  const [fail, setFail] = useState(false);
  useEffect(() => {
    if (known) return;
    let dead = false;
    briefTokenStatus().then(
      (s) => !dead && setSet(s.set),
      () => undefined,
    );
    return () => {
      dead = true;
    };
  }, [known]);
  if (!set) return null;
  const forget = () => {
    setFail(false);
    clearBriefToken().then(
      () => {
        setSet(false);
        onChanged?.();
      },
      () => setFail(true),
    );
  };
  return (
    <>
      <span className="meet-xs meet-dimline">Connected</span>
      <button type="button" className="meet-btn" onClick={forget} {...tip('Remove the brief key from this PC')}>
        Forget
      </button>
      {fail && <span className="meet-notice meet-xs" role="alert">Could not forget the key</span>}
    </>
  );
}

/**
 * Connect (or Connected with Forget) under the empty Meet hero, so the key can be saved when no meeting is coming up. Draws nothing
 * until the key's status is read.
 */
export function BriefSetup() {
  const [set, setSet] = useState<boolean | null>(null);
  const alive = useRef(true);
  const read = useCallback(() => {
    briefTokenStatus().then(
      (s) => alive.current && setSet(s.set),
      () => alive.current && setSet(null),
    );
  }, []);
  useEffect(() => {
    alive.current = true;
    read();
    return () => {
      alive.current = false;
    };
  }, [read]);
  if (set === null) return null;
  return <div className="meet-brief-setup">{set ? <BriefConnected known onChanged={read} /> : <BriefConnect onChanged={read} />}</div>;
}

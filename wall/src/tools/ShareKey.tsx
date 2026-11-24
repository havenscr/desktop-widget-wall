import { IconShare } from '@tabler/icons-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { forgetShareKey, readShareKeyStatus, saveShareKey, type ShareKeyStatus } from '../bridge/share';
import { hover } from './hover';

/** The fixed lines for a key that could not be saved or forgotten. */
export const SHARE_KEY_ERRORS = {
  invalid: 'That key has characters go-ae.org cannot take',
  failed: 'Could not save the key',
  forget: 'Could not forget the key',
} as const;

/**
 * Share link: the upload key, typed once and kept in Windows Credential Manager on this PC. It lets this PC
 * upload a capture to go-ae.org and nothing else. The field is emptied from React state as soon as the command
 * answers, and nothing here ever shows the saved key, its length or any part of it.
 */
export function ShareKey({ ringed = false }: { ringed?: boolean }) {
  const [status, setStatus] = useState<ShareKeyStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const field = useRef<HTMLInputElement>(null);
  const refresh = () => {
    readShareKeyStatus().then(
      (s) => {
        if (mounted.current) setStatus(s);
      },
      () => {
        if (mounted.current) setStatus({ set: false, unreadable: true });
      },
    );
  };
  // Set on every mount, so the development build's second mount does not leave it false.
  useEffect(() => {
    mounted.current = true;
    refresh();
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);

  const set = status?.set === true;
  const unreadable = status?.unreadable === true;
  const ready = value.trim() !== '';
  const close = () => {
    setEditing(false);
    setValue('');
    setError(null);
  };
  const save = () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    // The field is emptied from state as soon as the command answers, whatever the answer.
    saveShareKey(value).then(
      () => {
        if (!mounted.current) return;
        setValue('');
        setBusy(false);
        close();
        refresh();
      },
      (e: unknown) => {
        if (!mounted.current) return;
        setValue('');
        setBusy(false);
        setError((e instanceof Error ? e.message : String(e)) === 'invalid' ? SHARE_KEY_ERRORS.invalid : SHARE_KEY_ERRORS.failed);
      },
    );
  };
  const forget = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    forgetShareKey().then(
      () => {
        if (!mounted.current) return;
        setBusy(false);
        close();
        refresh();
      },
      () => {
        if (!mounted.current) return;
        setBusy(false);
        setError(SHARE_KEY_ERRORS.forget);
      },
    );
  };
  const enter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') save();
  };
  // Escape in the form closes the form only; the drawer keeps its own Escape for the next press.
  const escape = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };

  return (
    <div className={ringed ? 'tools-block tools-ringed' : 'tools-block'} data-section="sharekey">
      <div className="tools-head kl-top">
        <span className="tools-k sm">
          <IconShare size={16} aria-hidden="true" /> Share link
        </span>
        <span className="tools-faint">on this PC only</span>
      </div>
      <div className="dt-row" onKeyDown={editing ? escape : undefined}>
        {!editing && (
          <>
            <span className="kl-name dt-name">Share key</span>
            <span className="tools-line kl-state dt-state" role="status" {...(set ? hover('The share key is saved on this PC. It is never shown again.') : {})}>
              {set ? 'Set' : 'Not set'}
            </span>
            <button type="button" className={set ? 'tools-btn kl-btn' : 'tools-btn kl-btn cy'} disabled={busy} onClick={() => setEditing(true)} {...hover(set ? 'Type a new share key' : 'Type the share key once. It lets this PC upload a capture to go-ae.org.')}>
              {set || unreadable ? 'Change' : 'Set up'}
            </button>
            {(set || unreadable) && (
              <button type="button" className="tools-btn kl-btn" disabled={busy} onClick={forget} {...hover('Removes the key from this PC. Share link stops working until a key is added.')}>
                Forget
              </button>
            )}
          </>
        )}
        {editing && (
          <>
            <input
              ref={field}
              className="tools-input kl-field dt-field"
              type="password"
              placeholder="Share key"
              aria-label="Share key"
              autoComplete="off"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              disabled={busy}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={enter}
              {...hover('The upload key for go-ae.org. Saved in Windows Credential Manager on this PC; never shown again.')}
            />
            <button type="button" className="tools-btn kl-btn cy" disabled={!ready || busy} onClick={save} {...hover('Saves the key on this PC')}>
              Save
            </button>
            <button type="button" className="tools-btn kl-btn" disabled={busy} onClick={close} {...hover('Closes the field without saving')}>
              Cancel
            </button>
          </>
        )}
      </div>
      {unreadable && !editing && (
        <div className="tools-note bad kl-note dt-note" role="status">
          The saved key could not be read. Type it again.
        </div>
      )}
      {error && (
        <div className="tools-note bad kl-note dt-note" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

import { IconCalendarEvent } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { briefTokenStatus, clearBriefToken, setBriefToken, type BriefTokenStatus } from '../bridge/meetBrief';
import { hover } from './hover';

/** The fixed lines for a key that could not be saved or forgotten. */
export const BRIEF_KEY_ERRORS = {
  invalid: 'That key is not the right shape',
  failed: 'Could not save the key',
  forget: 'Could not forget the key',
} as const;

/**
 * Meeting brief: the brief key, typed once and kept in Windows Credential Manager on this PC. The field is emptied from React state
 * as soon as the command answers, and nothing here ever shows the saved key, its length or any part of it.
 */
export function BriefKeyRow() {
  const [status, setStatus] = useState<BriefTokenStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const field = useRef<HTMLInputElement>(null);
  const read = useCallback(() => {
    briefTokenStatus().then(
      (s) => mounted.current && setStatus(s),
      () => mounted.current && setStatus(null),
    );
  }, []);
  // Set on every mount, so the development build's second mount does not leave it false.
  useEffect(() => {
    mounted.current = true;
    read();
    return () => {
      mounted.current = false;
    };
  }, [read]);
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
    setBriefToken(value.trim()).then(
      () => {
        if (!mounted.current) return;
        setValue('');
        setBusy(false);
        close();
        read();
      },
      (e) => {
        if (!mounted.current) return;
        setValue('');
        setBusy(false);
        setError(e === 'invalid' ? BRIEF_KEY_ERRORS.invalid : BRIEF_KEY_ERRORS.failed);
      },
    );
  };
  const forget = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    clearBriefToken().then(
      () => {
        if (!mounted.current) return;
        setBusy(false);
        close();
        read();
      },
      () => {
        if (!mounted.current) return;
        setBusy(false);
        setError(BRIEF_KEY_ERRORS.forget);
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

  const state = set ? 'Saved on this PC' : 'Not set';
  return (
    <div className="tools-block" data-section="briefkey">
      <div className="tools-head kl-top">
        <span className="tools-k sm">
          <IconCalendarEvent size={16} aria-hidden="true" /> Meeting brief
        </span>
        <span className="tools-faint">on this PC only</span>
      </div>
      <div className="dt-row" onKeyDown={editing ? escape : undefined}>
        {!editing && (
          <>
            <span className="kl-name dt-name">Brief key</span>
            <span className="tools-line kl-state dt-state" role="status" {...(set ? hover('The brief key is saved on this PC. It is never shown again.') : {})}>
              {state}
            </span>
            <button type="button" className={set ? 'tools-btn kl-btn' : 'tools-btn kl-btn cy'} disabled={busy} onClick={() => setEditing(true)} {...hover(set ? 'Type a new brief key' : 'Type the brief key once')}>
              {set || unreadable ? 'Change' : 'Set up'}
            </button>
            {(set || unreadable) && (
              <button type="button" className="tools-btn kl-btn" disabled={busy} onClick={forget} {...hover('Removes the key from this PC; the brief service keeps its own')}>
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
              placeholder="Brief key"
              aria-label="Brief key"
              autoComplete="off"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              disabled={busy}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={enter}
              {...hover('The brief key the box printed when the brief service was installed. Saved in Windows Credential Manager on this PC; never shown again.')}
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

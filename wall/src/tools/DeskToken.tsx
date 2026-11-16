import { IconHome } from '@tabler/icons-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { forgetToken, homeWordOf, saveToken } from '../studio/home';
import { useHome } from '../studio/homeStore';
import { hover } from './hover';

/** The fixed lines for a token that could not be saved or forgotten. */
export const TOKEN_ERRORS = {
  invalid: 'That token has characters the home app cannot take',
  failed: 'Could not save the token',
  forget: 'Could not forget the token',
} as const;

/**
 * Home app: the desk token, typed once and kept in Windows Credential Manager on this PC. The same token
 * the home app has in its own settings. The field is emptied from React state as soon as the command
 * answers, and nothing here ever shows the saved token, its length or any part of it.
 */
export function DeskToken({ ringed = false }: { ringed?: boolean }) {
  const token = useHome((s) => s.token);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const field = useRef<HTMLInputElement>(null);
  // Set on every mount, so the development build's second mount does not leave it false.
  useEffect(() => {
    mounted.current = true;
    void useHome.getState().refreshToken();
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);

  const set = token?.set === true;
  const unreadable = token?.unreadable === true;
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
    saveToken(value).then(
      () => {
        if (!mounted.current) return;
        setValue('');
        setBusy(false);
        close();
        void useHome.getState().tokenChanged();
      },
      (e) => {
        if (!mounted.current) return;
        setValue('');
        setBusy(false);
        setError(homeWordOf(e) === 'invalid' ? TOKEN_ERRORS.invalid : TOKEN_ERRORS.failed);
      },
    );
  };
  const forget = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    forgetToken().then(
      () => {
        if (!mounted.current) return;
        setBusy(false);
        close();
        void useHome.getState().tokenChanged();
      },
      () => {
        if (!mounted.current) return;
        setBusy(false);
        setError(TOKEN_ERRORS.forget);
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

  // One line: the name, the state, the buttons. A long sentence (unreadable, an error) goes under it.
  const state = set ? 'Set' : 'Not set';
  return (
    <div className={ringed ? 'tools-block tools-ringed' : 'tools-block'} data-section="desktoken">
      <div className="tools-head kl-top">
        <span className="tools-k sm">
          <IconHome size={16} aria-hidden="true" /> Home app
        </span>
        <span className="tools-faint">on this PC only</span>
      </div>
      <div className="dt-row" onKeyDown={editing ? escape : undefined}>
        {!editing && (
          <>
            <span className="kl-name dt-name">Desk token</span>
            <span className="tools-line kl-state dt-state" role="status" {...(set ? hover('The desk token is saved on this PC. It is never shown again.') : {})}>
              {state}
            </span>
            <button type="button" className={set ? 'tools-btn kl-btn' : 'tools-btn kl-btn cy'} disabled={busy} onClick={() => setEditing(true)} {...hover(set ? 'Type a new desk token' : "Type the home app's desk token once")}>
              {set || unreadable ? 'Change' : 'Set up'}
            </button>
            {(set || unreadable) && (
              <button type="button" className="tools-btn kl-btn" disabled={busy} onClick={forget} {...hover('Removes the token from this PC; the home app keeps its own')}>
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
              placeholder="Desk token"
              aria-label="Desk token"
              autoComplete="off"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              disabled={busy}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={enter}
              {...hover('The same desk token the home app has in its own settings. Saved in Windows Credential Manager on this PC; never shown again.')}
            />
            <button type="button" className="tools-btn kl-btn cy" disabled={!ready || busy} onClick={save} {...hover('Saves the token on this PC')}>
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
          The saved token could not be read. Type it again.
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

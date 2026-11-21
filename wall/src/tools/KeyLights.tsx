import { IconBulb } from '@tabler/icons-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { invoke } from '../bridge/tauri';
import { clockText } from '../meet/model';
import { wordOf, type Side, type Word } from '../studio/keyLights';
import { useKeyLights } from '../studio/store';
import { hover } from './hover';

/** The address field's words, one fixed line for each word the native side can answer. */
export function saveError(word: Word): string {
  switch (word) {
    case 'bad-address':
      return 'That is not an address on your own network. Use four numbers like 192.168.x.x.';
    case 'refused':
      return 'This window cannot change the key lights.';
    case 'slow-down':
    case 'busy':
      return 'Too many tries. Wait a minute, then try again.';
    default:
      return 'Could not save the address.';
  }
}

/** What a Test says. */
export function testLine(side: Side, word: Word | null): string {
  const who = `${side === 'left' ? 'Left' : 'Right'} key light`;
  if (word === null) return `${who} answered`;
  switch (word) {
    case 'no-answer':
    case 'timeout':
      return `${who}: no answer`;
    case 'other-model':
      return `${who}: different model`;
    case 'not-set-up':
      return `${who}: no address saved`;
    case 'slow-down':
    case 'busy':
      return `${who}: try again soon`;
    default:
      return `${who}: bad answer`;
  }
}

interface Result {
  word: Word | null;
  at: number;
}

const NAME: Record<Side, string> = { left: 'Left', right: 'Right' };

function Row({ side, saved, editing, setEditing, onChanged }: { side: Side; saved: boolean; editing: boolean; setEditing: (on: boolean) => void; onChanged: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorQuiet, setErrorQuiet] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const mounted = useRef(true);
  const field = useRef<HTMLInputElement>(null);
  // Set on every mount, so the development build's second mount does not leave it false.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);

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
    setErrorQuiet(false);
    invoke('wall2_keylights_set_address', { side, address: value.trim() }).then(
      () => {
        if (!mounted.current) return;
        // The value goes with the form whatever the answer; nothing reads it back.
        setBusy(false);
        setResult(null);
        close();
        onChanged();
      },
      (e) => {
        if (!mounted.current) return;
        setBusy(false);
        setValue('');
        const w = wordOf(e);
        setErrorQuiet(w === 'slow-down' || w === 'busy');
        setError(saveError(w));
      },
    );
  };
  const forget = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    invoke('wall2_keylights_forget', { side }).then(
      () => {
        if (!mounted.current) return;
        setBusy(false);
        setResult(null);
        close();
        onChanged();
      },
      () => {
        if (!mounted.current) return;
        setBusy(false);
        setError('Could not forget the address.');
      },
    );
  };
  const test = () => {
    if (busy) return;
    setBusy(true);
    setResult(null);
    invoke('wall2_keylights_test', { side }).then(
      () => mounted.current && (setBusy(false), setResult({ word: null, at: Date.now() })),
      (e) => mounted.current && (setBusy(false), setResult({ word: wordOf(e), at: Date.now() })),
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

  // The row says it in full: Saved, "Left key light answered at 9:42 AM", or what went wrong.
  const state = !saved ? 'Not set up' : result === null ? 'Saved' : result.word === null ? `${NAME[side]} key light answered at ${clockText(result.at)}` : testLine(side, result.word);
  const quiet = result !== null && (result.word === 'slow-down' || result.word === 'busy');
  const bad = saved && result !== null && result.word !== null && !quiet;
  return (
    <li className="kl-row" data-side={side} data-saved={saved ? '' : undefined} onKeyDown={editing ? escape : undefined}>
      <div className="kl-head">
        <span className="kl-name">{NAME[side]}</span>
        {!editing && (
          <div className={bad ? 'tools-line bad kl-state' : 'tools-line kl-state'} role="status" {...hover(saved && result === null ? `The ${side} key light's address is saved on this PC. It is never shown again.` : state)}>
            {state}
          </div>
        )}
        {saved && !editing && (
          <button type="button" className="tools-btn kl-btn" disabled={busy} onClick={test} {...hover('Reads the light once and says whether it answered')}>
            Test
          </button>
        )}
        {!editing && (
          <button type="button" className={saved ? 'tools-btn kl-btn' : 'tools-btn kl-btn cy'} disabled={busy} onClick={() => setEditing(true)} {...hover(saved ? 'Type a new address for this light' : "Type this light's address once")}>
            {saved ? 'Change' : 'Set up'}
          </button>
        )}
        {saved && (
          <button type="button" className="tools-btn kl-btn" disabled={busy} onClick={forget} {...hover('Removes the saved address from this PC. The light goes back to Not set up.')}>
            Forget
          </button>
        )}
      </div>
      {editing && (
        <div className="kl-form">
          <input
            ref={field}
            className="tools-input kl-field"
            type="text"
            inputMode="decimal"
            placeholder="192.168.x.x"
            aria-label={`${NAME[side]} key light address`}
            autoComplete="off"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            disabled={busy}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={enter}
            {...hover("The key light's address on your network, from the Elgato Control Center app or your router. Saved on this PC only.")}
          />
          <button type="button" className="tools-btn kl-btn cy" disabled={!ready || busy} onClick={save} {...hover('Saves the address on this PC; it is never shown again')}>
            Save
          </button>
          <button type="button" className="tools-btn kl-btn" disabled={busy} onClick={close} {...hover('Closes the field without saving')}>
            Cancel
          </button>
        </div>
      )}
      {error && (
        <div className={errorQuiet ? 'tools-note kl-note' : 'tools-note bad kl-note'} role="alert">
          {error}
        </div>
      )}
    </li>
  );
}

/** Key lights: the two lights' addresses, typed once and kept on this PC. Nothing here ever shows an address. */
export function KeyLights({ ringed = false }: { ringed?: boolean }) {
  const status = useKeyLights((s) => s.saved ?? s.status);
  useEffect(() => {
    void useKeyLights.getState().refresh();
  }, []);
  const refresh = () => void useKeyLights.getState().refresh();
  const set = status === null || status === 'failed' ? { left: false, right: false } : status;
  const unreadable = status !== null && status !== 'failed' && status.unreadable === true;
  // One address form at a time: opening the second closes the first.
  const [editing, setEditing] = useState<Side | null>(null);
  return (
    <div className={ringed ? 'tools-block tools-ringed' : 'tools-block'} data-section="keylights">
      <div className="tools-head kl-top">
        <span className="tools-k sm">
          <IconBulb size={16} aria-hidden="true" /> Key lights
        </span>
        <span className="tools-faint">on this PC only</span>
      </div>
      {unreadable && (
        <div className="tools-note bad kl-note kl-unreadable" role="alert">
          The saved addresses could not be read. Type them again.
        </div>
      )}
      <ul className="tools-list" aria-label="Key lights">
        {(['left', 'right'] as const).map((side) => (
          <Row key={side} side={side} saved={set[side]} editing={editing === side} setEditing={(on) => setEditing(on ? side : editing === side ? null : editing)} onChanged={refresh} />
        ))}
      </ul>
    </div>
  );
}

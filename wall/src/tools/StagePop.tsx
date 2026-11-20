import { IconDeviceDesktopCog } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { spWord } from '../onair/v2/stagepopModel';
import { stagepopPlacement, stagepopToken, useStagePop, useStagePopSync } from '../onair/v2/stagepopStore';
import { RESET_CONFIRM_MS } from '../onair/model';
import { hover } from './hover';

export const TOKEN_LINES = {
  failed: 'Could not make a code',
  hidden: 'The code was shown once already. Make a new code to see one again.',
  placement: 'Those numbers are not a place on screen',
} as const;

const whole = (t: string) => (/^-?\d{1,6}$/.test(t.trim()) ? Number(t.trim()) : null);

/**
 * Stage pop-out: whether the Firefox add-on is connected, its pairing code (shown once, here, then kept only in Windows
 * Credential Manager) and where the pop-out window opens. The code is held in this component's state until Hide
 * or the drawer closes; the wall keeps it nowhere else.
 */
export function StagePopTools({ ringed = false }: { ringed?: boolean }) {
  useStagePopSync();
  const status = useStagePop((s) => s.status);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [left, setLeft] = useState('');
  const [top, setTop] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  // The fields start from the place in use, once.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || status.placement.left === null || status.placement.top === null) return;
    seeded.current = true;
    setLeft(String(status.placement.left));
    setTop(String(status.placement.top));
  }, [status.placement.left, status.placement.top]);

  const run = (action: 'show' | 'new') => {
    if (busy) return;
    setBusy(true);
    setError(null);
    stagepopToken(action).then(
      (t) => {
        setCode(t);
        setBusy(false);
        void useStagePop.getState().read();
      },
      (e) => {
        setBusy(false);
        setError(String(e) === 'hidden' ? TOKEN_LINES.hidden : TOKEN_LINES.failed);
        void useStagePop.getState().read();
      },
    );
  };
  const onNew = () => {
    if (!confirm) {
      setConfirm(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setConfirm(false), RESET_CONFIRM_MS);
      return;
    }
    clearTimeout(timer.current);
    setConfirm(false);
    run('new');
  };
  const l = whole(left);
  const t = whole(top);
  const savePlace = () => {
    if (l === null || t === null) {
      setError(TOKEN_LINES.placement);
      return;
    }
    setError(null);
    stagepopPlacement(l, t).then(
      () => void useStagePop.getState().read(),
      () => setError(TOKEN_LINES.placement),
    );
  };
  const source = status.placement.source;
  const where = source === 'saved' ? 'Saved place' : source === 'elgato' ? 'Elgato monitor' : 'No Elgato monitor found';
  return (
    <div className={ringed ? 'tools-block tools-ringed' : 'tools-block'} data-section="stagepop">
      <div className="tools-head kl-top">
        <span className="tools-k sm">
          <IconDeviceDesktopCog size={16} aria-hidden="true" /> Stage pop-out
        </span>
        <span className="tools-faint">Firefox add-on, this PC only</span>
      </div>
      <div className="dt-row">
        <span className="kl-name dt-name">Add-on</span>
        <span className="tools-line kl-state dt-state" role="status">
          {spWord(status)}
        </span>
        {code === null ? (
          <button type="button" className="tools-btn kl-btn cy" disabled={busy || status.token === 'hidden'} onClick={() => run('show')} {...hover(status.token === 'hidden' ? 'The code is shown once. Make a new code to see one again' : 'Shows the pairing code once. Paste it into the add-on options')}>
            Show code
          </button>
        ) : (
          <button type="button" className="tools-btn kl-btn" onClick={() => setCode(null)} {...hover('Hides the code. It cannot be shown again')}>
            Hide
          </button>
        )}
        <button type="button" className={confirm ? 'tools-btn kl-btn cy' : 'tools-btn kl-btn'} disabled={busy} onClick={onNew} {...hover('Makes a new code and disconnects the add-on until the new code is pasted in (asks again first)')}>
          {confirm ? 'New code? Click again' : 'New code'}
        </button>
      </div>
      {code !== null && (
        <div className="dt-row">
          <input className="tools-input kl-field dt-field oa2-spt-code" readOnly aria-label="Pairing code" value={code} onClick={(e) => e.currentTarget.select()} {...hover('Paste this into the add-on options. It is not shown again')} />
        </div>
      )}
      <div className="dt-row">
        <span className="kl-name dt-name">Opens at</span>
        <input className="tools-input oa2-spt-num" inputMode="numeric" aria-label="Left in pixels" placeholder="Left" value={left} onChange={(e) => setLeft(e.target.value)} {...hover('Screen pixels from the left edge of the main display. A second monitor to the left is negative')} />
        <input className="tools-input oa2-spt-num" inputMode="numeric" aria-label="Top in pixels" placeholder="Top" value={top} onChange={(e) => setTop(e.target.value)} {...hover('Screen pixels from the top edge of the main display')} />
        <button type="button" className="tools-btn kl-btn" disabled={l === null || t === null} onClick={savePlace} {...hover('Saves where the pop-out window opens')}>
          Save
        </button>
      </div>
      <div className="tools-note kl-note dt-note">{where}</div>
      {error && (
        <div className="tools-note bad kl-note dt-note" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

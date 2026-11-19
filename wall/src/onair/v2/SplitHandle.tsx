import { IconArrowsMaximize, IconArrowsMinimize } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { tip } from '../../ui/HoverTip';
import { clampComments, dragTo, parseSplit, serializeSplit, SPLIT_STORAGE_KEY, splitOverride, stepBy, widths, DEFAULT_COMMENTS, MIN_COMMENTS, MIN_NOTES, SPLIT_PANELS, type SplitMode } from './splitModel';

function readStored(show: string | null): SplitMode | null {
  try {
    return parseSplit(window.localStorage.getItem(SPLIT_STORAGE_KEY), show);
  } catch {
    return null;
  }
}

function writeStored(show: string, mode: SplitMode): void {
  try {
    window.localStorage.setItem(SPLIT_STORAGE_KEY, serializeSplit(show, mode));
  } catch {
    // Not kept across a reload this time; the split still works.
  }
}

/**
 * The split between the comments and the notes. `show` identifies the show (null until YouTube has answered, when what the browser
 * holds is used as it is); a different show puts it back to 620 / 436.
 */
export function useSplit(show: string | null): { mode: SplitMode; set: (m: SplitMode) => void } {
  const override = useRef(splitOverride(window.location.search)).current;
  const [mode, setMode] = useState<SplitMode>(() => override ?? readStored(null) ?? DEFAULT_COMMENTS);
  const key = useRef<string | null>(null);
  useEffect(() => {
    if (override !== null || show === null) return;
    key.current = show;
    const held = readStored(show);
    setMode(held ?? DEFAULT_COMMENTS);
    if (held === null) writeStored(show, DEFAULT_COMMENTS);
  }, [show, override]);
  const set = useCallback(
    (m: SplitMode) => {
      setMode(m);
      if (override === null && key.current !== null) writeStored(key.current, m);
    },
    [override],
  );
  return { mode, set };
}

/** The expand button in a panel heading. */
export function ExpandButton({ expanded, what, onClick }: { expanded: boolean; what: string; onClick: () => void }) {
  return (
    <button type="button" className="oa-btn oa2-exp" aria-label={expanded ? `Back to side by side (${what})` : `Fill the space with the ${what}`} onClick={onClick} {...tip(expanded ? 'Back to side by side' : 'Fill the space')}>
      {expanded ? <IconArrowsMinimize size={18} aria-hidden="true" /> : <IconArrowsMaximize size={18} aria-hidden="true" />}
    </button>
  );
}

/**
 * The handle in the gap: invisible until the pointer is over it, a col-resize cursor, arrow keys move 20 px and a double click goes
 * back to 620 / 436. `left` is the handle's x inside the frame.
 */
export function SplitHandle({ comments, left, onChange }: { comments: number; left: number; onChange: (comments: number) => void }) {
  const drag = useRef<{ x: number; start: number; scale: number } | null>(null);
  const [active, setActive] = useState(false);
  return (
    <div
      className="oa2-split-h"
      role="separator"
      aria-orientation="vertical"
      aria-label="Comments and notes width"
      aria-valuemin={MIN_COMMENTS}
      aria-valuemax={SPLIT_PANELS - MIN_NOTES}
      aria-valuenow={comments}
      tabIndex={0}
      data-active={active ? 'true' : 'false'}
      style={{ left }}
      {...tip('Drag to resize. Double click to reset.')}
      onPointerDown={(e) => {
        const el = e.currentTarget;
        const scale = el.offsetWidth > 0 ? el.getBoundingClientRect().width / el.offsetWidth : 1;
        drag.current = { x: e.clientX, start: comments, scale: scale > 0 ? scale : 1 };
        setActive(true);
        try {
          el.setPointerCapture?.(e.pointerId);
        } catch {
          // Capture is a comfort only.
        }
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) onChange(dragTo(d.start, (e.clientX - d.x) / d.scale));
      }}
      onPointerUp={() => {
        drag.current = null;
        setActive(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setActive(false);
      }}
      onDoubleClick={() => onChange(DEFAULT_COMMENTS)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          onChange(stepBy(clampComments(comments), -1));
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          onChange(stepBy(clampComments(comments), 1));
        }
      }}
    >
      <i aria-hidden="true" />
    </div>
  );
}

export { widths };

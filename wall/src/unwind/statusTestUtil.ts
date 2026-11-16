/** Test helpers only: what the status marks on Unwind draw, read from the page. */
export interface DrawnLine {
  /** `put-away` (briefcase) or `focus` (focus-2). */
  mark: 'put-away' | 'focus' | null;
  dots: number;
  more: string | null;
  ring: boolean;
  /** The network alerts count in the capsule, or null. */
  net: string | null;
  /** The amber pill's words, or null. */
  pill: string | null;
}

/** The marks on the page, or null when the line draws nothing. */
export function drawnLine(): DrawnLine | null {
  const l = document.querySelector('.u-line');
  if (!l) return null;
  const mark = l.querySelector('.u-mark');
  return {
    mark: mark ? (mark.classList.contains('tabler-icon-focus-2') ? 'focus' : 'put-away') : null,
    dots: l.querySelectorAll('.u-cap .u-dot').length,
    more: l.querySelector('.u-more')?.textContent ?? null,
    ring: l.querySelector('.u-ring') !== null,
    net: l.querySelector('.u-cap-net')?.textContent ?? null,
    pill: l.querySelector('.u-need')?.textContent ?? null,
  };
}

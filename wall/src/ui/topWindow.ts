/**
 * The wall runs only as the top window. Content inside a player frame (an ad, an extension)
 * could otherwise load the wall's own page in a frame of its own, with the wall's origin and
 * command access, and lay it unseen under the owner's clicks. The CSP's
 * `frame-ancestors 'none'` refuses that; this is the second guard, for a runtime that does not
 * enforce it. `window.top` is readable across origins.
 */
export function isTopWindow(win: Pick<Window, 'top' | 'self'> = window): boolean {
  try {
    return win.top === win.self;
  } catch {
    return false;
  }
}

/** Start the wall (`boot`) only when this is the top window; returns whether it started. */
export function startIfTop(win: Pick<Window, 'top' | 'self'>, boot: () => unknown): boolean {
  if (!isTopWindow(win)) return false;
  void boot();
  return true;
}

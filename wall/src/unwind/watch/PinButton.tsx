import { IconPin } from '@tabler/icons-react';
import { tip } from '../../ui/HoverTip';
import { openLibraryMenu, type OpenLibraryMenu } from './libraryMenuModel';
import { makeLibraryPin, pinKey, pinnedAt, usePins } from './pins';

/**
 * The Pin button of an opened Spotify playlist or album or YouTube playlist: it opens the place chooser under itself. It is off, still
 * focusable and with a tip, when the item is already pinned (the tip names the place) or its address cannot be kept. `icon` is the
 * icon-only form (the YouTube tall view); `className` carries the panel's own button look.
 */
export function PinButton({ entry, name, className, icon = false, cannotLine }: { entry: OpenLibraryMenu['entry']; name: string; className: string; icon?: boolean; cannotLine: string }) {
  const places = usePins((s) => s.places);
  const pin = makeLibraryPin(entry);
  const at = pin ? pinnedAt(places, pinKey(pin)) : -1;
  const off = !pin || at >= 0;
  const tipText = !pin ? cannotLine : at >= 0 ? `Pinned in Pin ${at + 1}. Right-click it on the left to remove it.` : 'Pin to the left';
  return (
    <button
      type="button"
      className={`${className}${icon ? ' icon' : ''}`}
      aria-label={icon ? 'Pin to the left' : undefined}
      aria-haspopup="menu"
      aria-disabled={off ? 'true' : undefined}
      data-disabled={off ? '' : undefined}
      {...tip(tipText)}
      onClick={(e) => {
        if (off) return;
        openLibraryMenu({ entry, name, actions: [], at: e.currentTarget.getBoundingClientRect(), source: e.currentTarget, view: 'chooser', chooserOnly: true, byKeyboard: e.detail === 0 });
      }}
    >
      <IconPin size={icon ? 20 : 18} aria-hidden="true" />
      {icon ? null : 'Pin'}
    </button>
  );
}

import { usePlaceStore } from '../state/places';
import { useToolsStore } from '../tools/store';
import { ScreensOff } from './ScreensOff';

/**
 * The one Hide screen control for the whole wall, mounted once by the app: 36 px at stage x 2504,
 * y 664 (20 px in from the lower right corner) on every place. It sits above each place's own
 * content and below the drawers; Zen and Dream draw over the whole stage, so there it rides one
 * step above them. It is not part of any place's tree, so a click on it never reaches Dream's
 * "click anywhere to wake". While the Tools drawer is open it is inert (no pointer, no focus):
 * the drawer's rounded corner leaves a sliver where the control would otherwise still be hit.
 * The Day drawer and the Agents panel mark it inert themselves (`useBehindDrawer`).
 */
export function ScreensOffLayer() {
  const place = usePlaceStore((s) => s.active);
  const toolsOpen = useToolsStore((s) => s.open);
  // Zen covers the Tools drawer, so the drawer cannot be reached from there.
  const covered = toolsOpen && place !== 'zen';
  return (
    <div className="so-layer" data-place={place} inert={covered || undefined}>
      <ScreensOff />
    </div>
  );
}

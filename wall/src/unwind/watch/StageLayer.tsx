import { useEffect, useRef, useState } from 'react';
import { useSkyClaim } from '../../horizon/sky';
import { usePlaceStore } from '../../state/places';
import { refKey, type WatchRef } from './links';
import { LOOK_BOXES, layeredNow, lookFor, ownsTheMoonSky, type LookId } from './looks';
import { PlayerFrame } from './PlayerFrame';
import { driveInAudience, useWatchStore } from './store';
import { useStopRules } from './useStopRules';

/** Unwind's offset inside the stage (design pixels): the Watch rules in `unwind.css` place the looks at wall numbers less this. */
export const UNWIND_OFFSET = Object.freeze({ x: 124, y: 20 });

/** watch behaviour: the height of the band over the video's lower edge that wakes the faded controls. */
export const EDGE_BAND = 72;

/** True while the stage is in sight: Unwind is the place and its Watch tab is showing. */
export function useStageShown(): boolean {
  const place = usePlaceStore((s) => s.active);
  const tab = useWatchStore((s) => s.tab);
  return place === 'unwind' && tab === 'watch';
}

/**
 * sky layers: what the look on screen asks of the horizon (`horizon/sky.ts`): its picture's box,
 * so the moon keeps clear of it (another of its places, or none); no moon at all for a look that
 * owns that sky (the sun, the drive-in); and, for a picture that sits behind the land (the whole
 * sky, the sun), the element the horizon mounts its front canvas in (`layeredNow`: the sun comes
 * forward while the player waits for a click). Nothing at all while the stage is out of sight
 * (`shown` false: another tab or place), and released when nothing is on.
 */
export function useWatchSky(look: LookId, front: HTMLElement | null, needsClick: boolean, shown = true) {
  const b = LOOK_BOXES[look];
  useSkyClaim(
    'watch',
    shown
      ? {
          front: layeredNow(look, needsClick) ? front : null,
          boxes: [[b.x, b.y, b.w, b.h]],
          noMoon: ownsTheMoonSky(look),
        }
      : null,
  );
}

/**
 * The video in the scene, in its look. Nothing of the wall's is drawn on the video: the Look
 * switch and every control sit in the left block. Glows, the floor's light and the drive-in's
 * frame and posts sit around the picture, never over it.
 *
 * The player frame must never be removed or moved to another parent while the video lives (an
 * embedded player reloads when it is), so every child below keeps its slot whatever the look and
 * whether or not the stage is in sight: a slot a look does not use holds null. Out of sight the
 * stage is parked (`w-parked`: a plain 16:9 box, no look) and the layer is transparent.
 */
function VideoStage({ item, look, shown }: { item: WatchRef & { label: string }; look: LookId; shown: boolean }) {
  const audience = useWatchStore(driveInAudience);
  const needsClick = useWatchStore((s) => s.needsClick);
  const [front, setFront] = useState<HTMLDivElement | null>(null);
  useWatchSky(look, front, needsClick, shown);
  // The look's own markup, one block per look (null while parked).
  const dress: LookId | null = shown ? look : null;
  const layered = dress !== null && layeredNow(dress, needsClick);
  const b = LOOK_BOXES[look];
  return (
    <>
      <div
        className={dress ? `w-stage w-${dress}${layered ? ' w-layered' : ''}` : 'w-stage w-parked'}
        data-look={dress ?? undefined}
        data-audience={dress && audience ? `${audience.x},${audience.y},${audience.w},${audience.h}` : undefined}
        data-sky-box={dress ? `${b.x},${b.y},${b.w},${b.h}` : undefined}
      >
        {/* ---- look markup (feathered, sun, drive-in): before the picture ---- */}
        {/* The feathered glow (in front of the land, with its picture) and the sun's halo (behind it). */}
        {dress === 'feather' ? <div className="w-glow" aria-hidden="true" /> : null}
        {dress === 'sun' ? <div className="w-halo" aria-hidden="true" /> : null}
        {dress === 'drivein' ? <div className="w-spill" aria-hidden="true" /> : null}
        {/* The picture: this element and the frame in it are never replaced while the video lives. */}
        <div className="w-screen">
          <PlayerFrame key={refKey(item)} item={item} title={item.label} shown={shown} />
        </div>
        {/* ---- look markup: after the picture ---- */}
        {/* The horizon mounts its front canvas here (the ranges, the land and the grid), over the
            picture and under everything after it; only for a look that sits behind the land. */}
        {layered ? <div className="w-front" ref={setFront} aria-hidden="true" /> : null}
        {/* On the floor, in front of the land: the sun's warm streak. */}
        {dress === 'sun' ? <div className="w-streak" aria-hidden="true" /> : null}
        {dress === 'drivein' ? (
          <>
            <i className="w-post l" aria-hidden="true" />
            <i className="w-post r" aria-hidden="true" />
          </>
        ) : null}
      </div>
      {/* The floor picks up a faint wash of the sky's colour (approved page, B). One frame cannot be
          mirrored, so this is a still colour wash in the page's light colours, taking no pointer. */}
      {dress === 'sky' ? <div className="w-skyspill" aria-hidden="true" /> : null}
    </>
  );
}

/**
 * watch behaviour: the wall's own transparent band over the video's lower edge (never over the
 * player: it is a sibling of the stage, and the frame under it takes no pointer). The pointer
 * entering it wakes the faded controls. While the player waits for a click to start it takes no
 * pointer, so the click reaches the video.
 */
function EdgeBand({ look }: { look: LookId }) {
  const needsClick = useWatchStore((s) => s.needsClick);
  const b = LOOK_BOXES[look];
  const peek = (on: boolean) => useWatchStore.getState().setPeek(on);
  return (
    <div
      className={`w-edge${needsClick ? ' w-edge-off' : ''}`}
      aria-hidden="true"
      style={{ left: b.x - UNWIND_OFFSET.x, top: b.y + b.h - UNWIND_OFFSET.y - EDGE_BAND, width: b.w, height: EDGE_BAND }}
      onPointerEnter={() => peek(true)}
      onPointerLeave={() => peek(false)}
    />
  );
}

/**
 * The video's own layer, mounted once by the screens frame for every place (beside the place,
 * in the same box as Unwind), so a playing video keeps playing when the owner goes to Listen or
 * to another place, and is there, still playing, when he comes back. In sight only on Unwind's
 * Watch tab; anywhere else the layer is transparent and takes no pointer (never `display: none`,
 * which a browser may treat as a reason to pause or throttle the frame), and it claims nothing
 * from the sky. The stop rules run here, so they hold on every place.
 */
export function WatchStageLayer() {
  useStopRules();
  const playing = useWatchStore((s) => s.playing);
  const looks = useWatchStore((s) => s.looks);
  const shown = useStageShown();
  const look = playing ? lookFor(looks, playing.kind) : null;
  const layerRef = useRef<HTMLDivElement>(null);
  // Parked: focus must not stay inside the invisible player (Space or the arrow keys would still reach it).
  useEffect(() => {
    const inside = () => {
      const at = document.activeElement;
      return at instanceof HTMLElement && layerRef.current?.contains(at);
    };
    if (shown || !inside()) return;
    (document.activeElement as HTMLElement).blur();
    // A frame can keep focus after blur(): hand focus to the page itself, which is never inside the layer.
    if (inside()) {
      const body = document.body;
      const had = body.hasAttribute('tabindex');
      if (!had) body.tabIndex = -1;
      body.focus({ preventScroll: true });
      if (!had) body.removeAttribute('tabindex');
    }
  }, [shown]);
  return (
    <div className="w-layer" ref={layerRef} data-shown={shown ? 'true' : 'false'} aria-hidden={shown ? undefined : true}>
      {playing && look ? <VideoStage item={playing} look={look} shown={shown} /> : null}
      {playing && look && shown ? <EdgeBand look={look} /> : null}
    </div>
  );
}

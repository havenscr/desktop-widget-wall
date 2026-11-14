import { FRAME_CX, MARQUEE_NAME, MARQUEE_PAUSED, MARQUEE_PLAYING, MARQUEE_TEXT_Y, TOWER_SVG } from './towerFrame';

/**
 * What the drive-in is doing, as the marquee tells it. `empty` is nothing on; `waiting` is
 * something chosen that is not showing yet (loading, waiting for a click, ended); both show the
 * name alone.
 */
export type DriveInMode = 'playing' | 'paused' | 'waiting' | 'empty';

/** What the marquee needs to know about the player (all from the watch store). */
export interface DriveInState {
  /** The owner's own pause. */
  paused: boolean;
  /** The player has reported that the picture played. */
  started: boolean;
  /** A refused autoplay waits for a click on the picture. */
  needsClick: boolean;
  /** Twitch's quiet "Not started? Click the video" line is up. */
  clickHint: boolean;
  /** A single video, a stream or a playlist's last item has ended. */
  ended: boolean;
  /** Twitch's player never says it started, so for it playing means: chosen and not waiting. */
  reports: boolean;
}

/**
 * NOW SHOWING only once the player reports the picture playing; INTERMISSION only for a real
 * pause; the name alone while it loads, while a refused autoplay waits for a click, and after it
 * ended. Twitch never reports, so it counts as playing unless a click is being waited for.
 */
export function driveInMode(s: DriveInState): DriveInMode {
  if (s.needsClick || s.clickHint || s.ended) return 'waiting';
  if (s.paused) return 'paused';
  if (s.reports && !s.started) return 'waiting';
  return 'playing';
}

const WORDS_STYLE = { fontFamily: "var(--disp,'Chakra Petch','Segoe UI',system-ui,sans-serif)" } as const;

/** One line of the marquee: 16 px, weight 600, letter spacing 0.2 em, cream. */
function Words({ on, children, className }: { on: boolean; children: string; className?: string }) {
  return (
    <text
      className={`w-mq ${className ?? ''}`}
      x={FRAME_CX}
      y={MARQUEE_TEXT_Y}
      textAnchor="middle"
      fontSize={16}
      fontWeight={600}
      letterSpacing="0.2em"
      fill="#ffe9c4"
      style={{ ...WORDS_STYLE, opacity: on ? 1 : 0 }}
      data-on={on ? '1' : '0'}
    >
      {children}
    </text>
  );
}

/**
 * The drive-in's frame, the Screen tower (`towerFrame.ts`): one SVG over the whole 2560 by 720
 * scene, the first child of the stage, under the floor light and the screen, taking no pointer.
 * Every fill round the picture is a ring with the video's box cut out, so nothing of it can cover
 * the picture in any stacking order. The marquee's words tell what is on: NOW SHOWING while the
 * player reports it playing, INTERMISSION while really paused (a cross-fade of about a second, at
 * once under reduced motion, see `.w-mq`), the name alone with nothing on or nothing showing yet
 * (see `driveInMode`).
 */
export function DriveInFrame({ mode }: { mode: DriveInMode }) {
  return (
    <svg
      className="w-tower"
      viewBox="0 0 2560 720"
      width={2560}
      height={720}
      aria-hidden="true"
      focusable="false"
      data-marquee={mode}
      style={{ pointerEvents: 'none' }}
    >
      <g dangerouslySetInnerHTML={{ __html: TOWER_SVG }} />
      <Words on={mode === 'playing'}>{MARQUEE_PLAYING}</Words>
      <Words on={mode === 'paused'}>{MARQUEE_PAUSED}</Words>
      <Words on={mode === 'empty' || mode === 'waiting'} className="w-mq-name">
        {MARQUEE_NAME}
      </Words>
    </svg>
  );
}

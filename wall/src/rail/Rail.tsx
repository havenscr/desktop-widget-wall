import type { KeyboardEvent } from 'react';
import {
  IconBriefcase,
  IconHeadphones,
  IconHome,
  IconMaximize,
  IconMinimize,
  IconMoon,
  IconBroadcast,
  IconStack2,
  IconTools,
  IconUsers,
  type Icon,
} from '@tabler/icons-react';
import { isTauri } from '../bridge/tauri';
import { toggleFullscreen, useFullscreen } from '../ui/fullscreen';
import { PLACES, usePlaceStore } from '../state/places';
import { alarmChipText, useOpenAlarms } from '../home/useSecurity';
import { tip } from '../ui/HoverTip';
import { useToolsStore } from '../tools/store';
import { useWatchStore } from '../unwind/watch/store';

const PLACE_ICONS: Record<'work' | 'home' | 'unwind', Icon> = {
  work: IconBriefcase,
  home: IconHome,
  unwind: IconHeadphones,
};

function FullscreenButton() {
  const full = useFullscreen();
  const label = full ? 'Exit fullscreen' : 'Enter fullscreen';
  const Glyph = full ? IconMinimize : IconMaximize;
  return (
    <button
      type="button"
      className="rb rb-fs"
      aria-label={label}
      onClick={() => {
        toggleFullscreen().catch((e) => console.warn('[Wall2] fullscreen change failed', e));
      }}
    >
      <Glyph size={30} stroke={1.8} aria-hidden="true" />
      {full ? 'Exit' : 'Full'}
    </button>
  );
}

export function Rail() {
  const active = usePlaceStore((s) => s.active);
  const setActive = usePlaceStore((s) => s.setActive);
  const alarms = useOpenAlarms();
  const toolsOpen = useToolsStore((s) => s.open);
  const toggleTools = useToolsStore((s) => s.toggle);
  // watch behaviour: a video playing out of sight (another place, or Listen) marks Unwind's button.
  const videoTab = useWatchStore((s) => s.tab);
  const video = useWatchStore((s) => s.playing?.label ?? null);
  // The mark says what the video is doing: playing, or paused (also while a YouTube video waits for a click; Twitch has no such state here); an ended video has none.
  const videoState = useWatchStore((s) => (s.playing === null || s.report.ended ? null : s.paused || (s.needsClick && s.playing.kind !== 'twitch') ? 'paused' : 'playing'));
  // The wall's music (a YouTube library pick) is heard, never seen: its mark shows whenever he is not on Unwind, and a click goes to Listen.
  const music = useWatchStore((s) => s.source === 'music');
  const videoAway = video !== null && videoState !== null && (music ? active !== 'unwind' : !(active === 'unwind' && videoTab === 'watch'));

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const buttons = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>('button.rb:not(:disabled):not(.rb-fs):not(.rb-tools)'),
    );
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    e.preventDefault();
    const step = e.key === 'ArrowDown' ? 1 : -1;
    const next = buttons[(index + step + buttons.length) % buttons.length];
    next.focus();
    next.click();
  };

  return (
    <nav className="rail" aria-label="Places" onKeyDown={onKeyDown}>
      {PLACES.map(({ id, label }) => {
        const Glyph = PLACE_ICONS[id as keyof typeof PLACE_ICONS];
        // An open network alarm puts a small amber dot on Home's icon, on every place.
        const alarm = id === 'home' && alarms > 0;
        const away = id === 'unwind' && videoAway;
        const goWatch = () => {
          setActive('unwind');
          useWatchStore.getState().setTab(music ? 'listen' : 'watch');
        };
        return (
          <button
            key={id}
            type="button"
            className="rb"
            aria-label={label}
            aria-description={alarm ? alarmChipText(alarms) : away ? `${video} is ${videoState}` : undefined}
            aria-current={active === id ? 'page' : undefined}
            onClick={away ? goWatch : () => setActive(id)}
            {...(alarm ? tip(`${alarmChipText(alarms)} open. Home lists them.`) : away ? tip(`${video} is ${videoState}. Click to go to it.`) : {})}
          >
            <span className="rb-ico">
              <Glyph size={30} stroke={1.8} aria-hidden="true" />
              {alarm && <i className="rb-alarm" aria-hidden="true" />}
              {away && <i className={`rb-play${videoState === 'paused' ? ' rb-paused' : ''}`} aria-hidden="true" />}
            </span>
            {label}
          </button>
        );
      })}
      <div className="rsep" role="separator" />
      <button
        type="button"
        className="rb"
        aria-label="Meet"
        aria-current={active === 'meet' ? 'page' : undefined}
        onClick={() => setActive('meet')}
      >
        <IconUsers size={30} stroke={1.8} aria-hidden="true" />
        Meet
      </button>
      <button
        type="button"
        className="rb"
        aria-label="On air"
        aria-current={active === 'onair' ? 'page' : undefined}
        onClick={() => setActive('onair')}
        {...tip('Show timer, run of show, marks and the recording keys')}
      >
        <IconBroadcast size={30} stroke={1.8} aria-hidden="true" />
        On air
      </button>
      <button
        type="button"
        className="rb"
        aria-label="Shelf"
        aria-current={active === 'shelf' ? 'page' : undefined}
        onClick={() => setActive('shelf')}
        {...tip('Captures, the ShareX keys and your task lists')}
      >
        <IconStack2 size={30} stroke={1.8} aria-hidden="true" />
        Shelf
      </button>
      <div className="rail-spacer" />
      <button
        type="button"
        className="rb"
        aria-label="Zen"
        aria-current={active === 'zen' ? 'page' : undefined}
        onClick={() => setActive('zen')}
      >
        <IconMoon size={30} stroke={1.8} aria-hidden="true" />
        Zen
      </button>
      {isTauri() && <FullscreenButton />}
      <button
        type="button"
        className="rb rb-tools"
        aria-label="Tools"
        aria-pressed={toolsOpen}
        onClick={toggleTools}
        {...tip('Accounts, sources, video look and the keys file')}
      >
        <IconTools size={30} stroke={1.8} aria-hidden="true" />
        Tools
      </button>
    </nav>
  );
}

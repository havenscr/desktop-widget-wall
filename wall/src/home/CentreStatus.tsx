import { IconPlugConnectedX, IconRefresh } from '@tabler/icons-react';
import { ageWords } from './soundModel';
import { useCentreStatus, type SourceState } from './centreSources';

function line(what: string, state: SourceState, okAt: number | null, key: string, now: number): string {
  if (state === 'unconfigured') return `${what}: not set up. Add ${key} to feeds.json.`;
  const age = okAt ? `, last good read ${ageWords(okAt, now)}` : '';
  return `${what}: not reachable${age}.`;
}

/**
 * The centre's one status card when both of its sources are out (not set up or never
 * reached): each named with its state in plain words, the age of its last good read when
 * there was one, the config key to add when not set up, and "Check again" for both.
 */
export function CentreStatus({ now }: { now: number }) {
  const moods = useCentreStatus((s) => s.moods);
  const sonos = useCentreStatus((s) => s.sonos);
  return (
    <section className="centre-status" aria-label="Home centre status">
      <IconPlugConnectedX className="centre-status-icon" size={40} stroke={1.5} aria-hidden="true" />
      <div className="centre-status-text">
        <div className="t2">Moods and Sound are both unavailable</div>
        <div className="s">{line('Moods (the home app)', moods.state, moods.okAt, 'homeBaseUrl', now)}</div>
        <div className="s">{line('Sound (the Sonos service)', sonos.state, sonos.okAt, 'sonosBaseUrl', now)}</div>
      </div>
      <button
        type="button"
        className="sound-btn cy"
        title="Read the home app and the Sonos service again now"
        onClick={(e) => {
          if (e.detail > 1) return;
          moods.check?.();
          sonos.check?.();
        }}
      >
        <IconRefresh size={22} stroke={1.8} aria-hidden="true" />
        Check again
      </button>
    </section>
  );
}

import { RecordingChipBody } from '../signals/RecordingChip';
import { useSignalStore } from '../signals/store';
import { useToolsStore } from '../tools/store';
import { tip } from '../ui/HoverTip';

/** The one amber line when a calendar account needs attention: its click opens Tools at Accounts. */
export function TroubleLine({ text, plain }: { text: string; plain?: boolean }) {
  const open = useToolsStore((s) => s.openDrawer);
  return (
    <div className="meet-trouble">
      {text}
      {!plain && (
        <>
          {' '}
          <button type="button" className="meet-trouble-link" onClick={() => open('accounts')} {...tip('Open Tools at Accounts to sign in or check the calendar')}>
            Open Tools
          </button>
        </>
      )}
    </div>
  );
}

/** The recording chip, drawn by every kind of hero while a recorder runs (the floating one is hidden on Meet only then). */
export function HeroChip() {
  const recording = useSignalStore((s) => s.recording);
  return recording ? <RecordingChipBody place="header" /> : null;
}

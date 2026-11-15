import { useToolsStore } from '../tools/store';

/** The one amber line when a calendar account needs attention: its click opens Tools at Accounts. */
export function TroubleLine({ text, plain }: { text: string; plain?: boolean }) {
  const open = useToolsStore((s) => s.openDrawer);
  return (
    <div className="meet-trouble">
      {text}
      {!plain && (
        <>
          {' '}
          <button type="button" className="meet-trouble-link" onClick={() => open('accounts')}>
            Open Tools
          </button>
        </>
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '../bridge/tauri';

/**
 * What the wall may know about the light link: whether a bridge pair is saved, whether the bridge is
 * another one than the pair was made on, and fixed words. The key, the client key and the bridge
 * address never come back from Rust.
 */
export interface LightSyncStatus {
  paired: boolean;
  bridgeChanged: boolean;
  running: boolean;
  starting: boolean;
  lastError: string | null;
  stoppedHueSync: boolean;
}

export const lightSync = {
  status: () => invoke<LightSyncStatus>('wall2_lightsync_status'),
  /** Waits (up to about 30 s) for the link button; answers `paired` or rejects with one fixed word. */
  pair: () => invoke<string>('wall2_lightsync_pair'),
  forget: () => invoke<void>('wall2_lightsync_forget'),
  /** About 3 s of colour on the lights; answers `ok` or rejects with one fixed word. */
  test: () => invoke<string>('wall2_lightsync_test'),
};

/** Fixed words Rust answers to Pair, in plain words. */
export const PAIR_WORDS: Record<string, string> = {
  'link-not-pressed': 'The link button was not pressed in time',
  'bridge-unreachable': 'The Hue bridge did not answer',
  cert: 'The bridge did not match the one the home app knows',
  busy: 'Another pairing or test is running',
  failed: 'Pairing did not finish',
};

/** Fixed words Rust answers to the test, in plain words. */
export const TEST_WORDS: Record<string, string> = {
  ...PAIR_WORDS,
  ok: 'The light link works',
  dtls: 'The bridge did not take the light stream',
  'stop-failed': 'The test ran, but the bridge kept streaming',
  'panels-unavailable': 'The Plays worked, the panels did not answer',
  busy: 'Another test or pairing is running',
  'not-paired': 'Not paired yet',
  'no-area': 'The home app has no entertainment area',
};

const word = (e: unknown): string => (e instanceof Error ? e.message : typeof e === 'string' ? e : String(e));
export const pairLine = (e: unknown) => PAIR_WORDS[word(e)] ?? 'Pairing did not finish';
export const testLine = (w: string) => TEST_WORDS[w] ?? 'The test did not finish';

export const PAIR_PROMPT = 'Press the link button on the Hue bridge';
export const POLL_MS = 2000;

export type LightSyncTest = { state: 'idle' } | { state: 'running' } | { state: 'done'; word: string };

/** The row's state: the saved status, a pairing that polls, a test that spins, and Forget. */
export function useLightSync(opened: number) {
  const [status, setStatus] = useState<LightSyncStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [test, setTest] = useState<LightSyncTest>({ state: 'idle' });
  const mounted = useRef(false);
  const read = useCallback(() => {
    lightSync.status().then(
      (s) => {
        if (!mounted.current) return;
        setStatus(s);
        setFailed(false);
      },
      () => mounted.current && setFailed(true),
    );
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    read();
  }, [opened, read]);
  // While pairing, the answer of the status poll can end it before the pair call returns.
  useEffect(() => {
    if (!pairing) return;
    const id = setInterval(read, POLL_MS);
    return () => clearInterval(id);
  }, [pairing, read]);
  useEffect(() => {
    if (pairing && status?.paired && !status.bridgeChanged) setPairing(false);
  }, [pairing, status]);
  const pair = () => {
    setNotice(null);
    setTest({ state: 'idle' });
    setPairing(true);
    lightSync
      .pair()
      .then(
        () => undefined,
        (e) => mounted.current && setNotice(pairLine(e)),
      )
      .finally(() => {
        if (!mounted.current) return;
        setPairing(false);
        read();
      });
  };
  const runTest = () => {
    setNotice(null);
    setTest({ state: 'running' });
    lightSync.test().then(
      (w) => mounted.current && setTest({ state: 'done', word: w }),
      (e) => mounted.current && setTest({ state: 'done', word: word(e) }),
    );
  };
  const forget = () => {
    setNotice(null);
    setTest({ state: 'idle' });
    lightSync.forget().then(read, () => mounted.current && setNotice('Could not forget the pairing'));
  };
  return { status, failed, pairing, notice, test, read, pair, runTest, forget };
}

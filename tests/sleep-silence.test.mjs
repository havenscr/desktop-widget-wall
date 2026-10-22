import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = (path) => readFileSync(new URL(`../src/public/scripts/${path}`, import.meta.url), 'utf8');
const noop = () => {};

// --- VisibilityManager ------------------------------------------------------

function visibilityContext() {
  const docListeners = new Map();
  const tauriListeners = new Map();
  const dispatched = [];
  const context = vm.createContext({
    console: { log: noop, warn: noop, error: noop },
    document: { hidden: false, addEventListener: (name, fn) => docListeners.set(name, fn) },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    setInterval: () => 1, clearInterval: noop,
  });
  context.window = context;
  context.dispatchEvent = (event) => dispatched.push(event.detail.visible);
  context.__TAURI__ = { event: { listen: (name, fn) => { tauriListeners.set(name, fn); return Promise.resolve(noop); } } };
  vm.runInContext(source('widgets/visibility-manager.js'), context);
  return { context, docListeners, tauriListeners, dispatched, manager: context.VisibilityManager };
}

test('display-state folds into isVisible and notifies only on change', () => {
  const h = visibilityContext();
  const seen = [];
  h.manager.onVisibilityChange((visible) => seen.push(visible));
  assert.equal(h.manager.isVisible(), true);

  h.tauriListeners.get('display-state')({ payload: { visible: false, reason: 'lock' } });
  assert.equal(h.manager.isVisible(), false);
  // Same state again (display-off while already locked) must not re-notify.
  h.tauriListeners.get('display-state')({ payload: { visible: false, reason: 'display-off' } });
  assert.deepEqual(seen, [false]);

  // Focus while the session is still dark keeps the wall asleep.
  h.tauriListeners.get('tauri://focus')();
  assert.equal(h.manager.isVisible(), false);

  h.tauriListeners.get('display-state')({ payload: { visible: true } });
  assert.equal(h.manager.isVisible(), true);
  assert.deepEqual(seen, [false, true]);
  assert.deepEqual(h.dispatched, [false, true]);
});

test('focus does not mark a hidden page visible', () => {
  const h = visibilityContext();
  h.context.document.hidden = true;
  h.docListeners.get('visibilitychange')();
  assert.equal(h.manager.isVisible(), false);
  h.tauriListeners.get('tauri://focus')();
  assert.equal(h.manager.isVisible(), false);
  h.context.document.hidden = false;
  h.tauriListeners.get('tauri://focus')();
  assert.equal(h.manager.isVisible(), true);
});

test('managedInterval pauses on lock and resumes on unlock', () => {
  const h = visibilityContext();
  let runs = 0;
  const cleared = [];
  h.context.setInterval = () => 7;
  h.context.clearInterval = (id) => cleared.push(id);
  h.manager.managedInterval(() => { runs += 1; }, 1000);
  h.tauriListeners.get('display-state')({ payload: { visible: false, reason: 'lock' } });
  assert.deepEqual(cleared, [7]);
  h.tauriListeners.get('display-state')({ payload: { visible: true } });
  assert.equal(runs, 1);
});

// --- Visualizer silence and audio push ---------------------------------------

function visualizerContext() {
  let clock = 0;
  const invokes = [];
  const idle = [];
  const context = vm.createContext({
    console: { log: noop, warn: noop, error: noop }, dlog: noop,
    document: { readyState: 'loading', hidden: false, addEventListener: noop, getElementById: () => null, querySelectorAll: () => [] },
    addEventListener: noop,
    localStorage: { getItem: () => null, setItem: noop },
    setTimeout: () => 0, clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
    requestAnimationFrame: () => 1, cancelAnimationFrame: noop,
    performance: { now: () => clock },
    Promise,
  });
  context.window = context;
  context.__TAURI__ = { core: { invoke: (cmd, args) => { invokes.push([cmd, args]); return Promise.resolve(); } } };
  context.idleCalls = idle;
  const bridge = `
    visualizerTauriAvailable = true;
    audioSourceMode = 'native';
    currentDisplayMode = 'poweraudio';
    poweraudioViz = { stage: { setIdle: (v) => window.idleCalls.push(v), pause() {}, resume() {}, resize() {} }, destroy() {} };
    window.health = 0;
    maybeRecoverIfCaptureDead = () => { window.health += 1; };
    window.t = {
      handle: handleNativeLevels,
      tick: () => updateSilence(performance.now()),
      sync: syncAudioPush,
      state: () => ({ levels: nativeLevels, samples: nativeSamples.length, bands: nativeBands.length, idle: silentIdle }),
      systemDefault: () => { isSystemDefaultMode = true; nativeCaptureStartedAt = -1e12; },
      setMode: (m) => { currentDisplayMode = m; },
    };
  `;
  const script = source('widgets/visualizer.js');
  const end = script.lastIndexOf('})();');
  vm.runInContext(script.slice(0, end) + bridge + script.slice(end), context);
  const loud = { bass: 0.8, mid: 0.6, high: 0.4, waveform: new Array(128).fill(0.1), bands: new Array(32).fill(200) };
  const empty = { bass: 0, mid: 0, high: 0, waveform: [], bands: [] };
  return {
    context, invokes, idle, loud, empty, t: context.t,
    at: (ms) => { clock = ms; },
  };
}

test('silence zeroes levels after a third of a second and idles after 5s', () => {
  const h = visualizerContext();
  h.at(1000);
  h.t.handle(h.loud);
  assert.equal(h.t.state().levels.bass, 0.8);
  assert.equal(h.t.state().bands, 32);

  // First empty event: a brief gap keeps the last levels.
  h.at(1033);
  h.t.handle(h.empty);
  h.at(1200);
  h.t.tick();
  assert.equal(h.t.state().levels.bass, 0.8);

  // ~10 events' worth of silence: levels drop to zero (per frame, no event).
  h.at(1400);
  h.t.tick();
  assert.deepEqual({ ...h.t.state().levels }, { bass: 0, mid: 0, high: 0 });
  assert.equal(h.t.state().samples, 0);

  // 1 Hz heartbeats must not wake it; after 5s it idles.
  h.at(3033);
  h.t.handle(h.empty);
  assert.equal(h.t.state().idle, false);
  h.at(6100);
  h.t.handle(h.empty);
  assert.equal(h.t.state().idle, true);
  assert.deepEqual(h.idle, [true]);

  // Next real audio wakes it immediately.
  h.at(9000);
  h.t.handle(h.loud);
  assert.equal(h.t.state().idle, false);
  assert.deepEqual(h.idle, [true, false]);
  assert.equal(h.t.state().levels.bass, 0.8);
});

test('capture health checks are time-based, not per heartbeat', () => {
  const h = visualizerContext();
  h.t.systemDefault();
  for (let ms = 0; ms <= 16000; ms += 1000) {
    h.at(ms);
    h.t.handle(h.empty);
  }
  // Silence started at 0: checks at 5s, 10s and 15s.
  assert.equal(h.context.health, 3);
});

test('payloads without bands still drive the levels', () => {
  const h = visualizerContext();
  h.t.handle({ bass: 0.5, mid: 0.4, high: 0.3, waveform: [0.1, 0.2] });
  assert.equal(h.t.state().levels.high, 0.3);
  assert.equal(h.t.state().bands, 0);
});

test('audio push follows InfiniDream mode and page visibility, sending only changes', () => {
  const h = visualizerContext();
  h.t.sync();
  h.t.sync();
  h.t.setMode('infinidream');
  h.t.sync();
  h.t.setMode('circular');
  h.t.sync();
  h.context.document.hidden = true;
  h.t.sync();
  assert.deepEqual(h.invokes.map(([, args]) => args.enabled), [true, false, true, false]);
  assert.ok(h.invokes.every(([cmd]) => cmd === 'set_audio_push'));
  // Levels arriving while nothing draws are ignored.
  h.t.handle(h.loud);
  assert.equal(h.t.state().levels, null);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/public/scripts/widgets/hls-player.js', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function harness(native = true) {
  const requests = [];
  const timers = new Map();
  const intervals = new Map();
  const instances = [];
  let timerId = 0;
  class MockHls {
    static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifest' };
    static ErrorDetails = { BUFFER_STALLED_ERROR: 'stalled' };
    static ErrorTypes = { NETWORK_ERROR: 'network', MEDIA_ERROR: 'media' };
    static isSupported() { return true; }
    constructor() { this.listeners = new Map(); instances.push(this); }
    on(event, callback) {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set());
      this.listeners.get(event).add(callback);
    }
    off(event, callback) { this.listeners.get(event)?.delete(callback); }
    emit(event, data) { [...(this.listeners.get(event) || [])].forEach(fn => fn(event, data)); }
    loadSource(url) { this.url = url; }
    attachMedia(video) { this.video = video; }
    startLoad() { this.restarts = (this.restarts || 0) + 1; }
    recoverMediaError() { this.recoveries = (this.recoveries || 0) + 1; }
    destroy() { this.destroyed = true; this.listeners.clear(); }
  }
  const context = {
    AbortController, URLSearchParams,
    console: { log() {}, warn() {}, error() {} },
    document: { createElement: () => ({ canPlayType: () => native ? 'maybe' : '' }) },
    localStorage: { getItem: () => null },
    Hls: MockHls,
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, delay) { const id = ++timerId; intervals.set(id, { fn, delay }); return id; },
    clearInterval(id) { intervals.delete(id); },
    fetch(url, options) {
      return new Promise(resolve => requests.push({
        signal: options.signal,
        channel: JSON.parse(options.body).variables.login,
        resolve: () => resolve({ ok: true, status: 200, json: async () => ({
          data: { streamPlaybackAccessToken: { signature: 'test', value: 'test' } }
        }) })
      }));
    }
  };
  context.window = context;
  vm.runInNewContext(source, context);
  function video() {
    const listeners = new Map();
    return {
      src: '', paused: true, playCalls: 0, currentTime: 0,
      seekable: { length: 0 },
      play() { this.paused = false; this.playCalls++; return Promise.resolve(); },
      pause() { this.paused = true; },
      load() {},
      removeAttribute(name) { if (name === 'src') this.src = ''; },
      addEventListener(event, fn) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(fn);
      },
      removeEventListener(event, fn) { listeners.get(event)?.delete(fn); },
      listenerCount() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0); }
    };
  }
  return { player: context.HLSPlayer, requests, timers, intervals, instances, video, MockHls };
}

test('stop cancels a pending token request without reviving the video', async () => {
  const h = harness();
  const video = h.video();
  const pending = h.player.play('first', video);
  const cancelled = assert.rejects(pending, { name: 'AbortError' });
  h.player.stop();
  await cancelled;
  assert.equal(h.requests[0].signal.aborted, true);
  h.requests[0].resolve();
  await flush();
  assert.equal(video.src, '');
  assert.equal(video.playCalls, 0);
  assert.equal(h.player.isPlaying(), false);
  assert.equal(h.timers.size, 0);
});

test('a slower old channel cannot overwrite the selected channel', async () => {
  const h = harness();
  const video = h.video();
  const first = h.player.play('first', video);
  const cancelled = assert.rejects(first, { name: 'AbortError' });
  const second = h.player.play('second', video);
  h.requests[1].resolve();
  await second;
  h.requests[0].resolve();
  await cancelled;
  await flush();
  assert.match(video.src, /\/second\.m3u8/);
  assert.equal(video.playCalls, 1);
  assert.equal(h.player.getCurrentChannel(), 'second');
  assert.equal(h.timers.size, 1);
});

test('an obsolete refresh cannot reload a newer channel or rearm its timer', async () => {
  const h = harness();
  const video = h.video();
  const first = h.player.play('first', video);
  h.requests[0].resolve();
  await first;
  const refresh = [...h.timers.values()].find(timer => timer.delay === 90 * 60 * 1000);
  const refreshing = refresh.fn();
  const next = h.player.play('second', video);
  h.requests[2].resolve();
  await next;
  h.requests[1].resolve();
  await refreshing;
  assert.match(video.src, /\/second\.m3u8/);
  assert.equal(video.playCalls, 2);
  assert.equal(h.timers.size, 1);
});

test('stopping MSE startup removes listeners, instance and timers', async () => {
  const h = harness(false);
  const video = h.video();
  const pending = h.player.play('first', video);
  const cancelled = assert.rejects(pending, { name: 'AbortError' });
  h.requests[0].resolve();
  await flush();
  assert.equal(h.instances.length, 1);
  assert.equal(video.listenerCount(), 6);
  h.player.stop();
  await cancelled;
  assert.equal(h.instances[0].destroyed, true);
  assert.equal(video.listenerCount(), 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.intervals.size, 0);
});

test('successful MSE startup drops the timeout and schedules token renewal', async () => {
  const h = harness(false);
  const video = h.video();
  const pending = h.player.play('first', video);
  h.requests[0].resolve();
  await flush();
  h.instances[0].emit('manifest');
  await pending;
  assert.equal(video.playCalls, 1);
  assert.deepEqual([...h.timers.values()].map(timer => timer.delay), [90 * 60 * 1000]);
  h.player.stop();
  assert.equal(h.timers.size, 0);
});

test('fatal MSE startup failure releases the failed player', async () => {
  const h = harness(false);
  const video = h.video();
  const pending = h.player.play('first', video);
  const failed = assert.rejects(pending, /HLS startup failed/);
  h.requests[0].resolve();
  await flush();
  h.instances[0].emit('error', { fatal: true, type: 'network', details: 'manifestLoadError' });
  await failed;
  assert.equal(h.instances[0].destroyed, true);
  assert.equal(h.player.isPlaying(), false);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.timers.size, 0);
});

for (const native of [true, false]) {
  test(`cancellation at promise handoff leaves no ${native ? 'native' : 'MSE'} work`, async () => {
    for (let depth = 0; depth < 12; depth++) {
      const h = harness(native);
      const video = h.video();
      const result = h.player.play('first', video).catch(error => error);
      h.requests[0].resolve();
      for (let i = 0; i < depth; i++) await Promise.resolve();
      const playsAtStop = video.playCalls;
      const instancesAtStop = h.instances.length;
      h.player.stop();
      await flush();
      assert.equal(video.playCalls, playsAtStop, `play after stop at handoff ${depth}`);
      assert.equal(h.instances.length, instancesAtStop, `instance after stop at handoff ${depth}`);
      assert.equal(h.timers.size, 0, `timer after stop at handoff ${depth}`);
      assert.equal(h.intervals.size, 0, `interval after stop at handoff ${depth}`);
      assert.equal(video.listenerCount(), 0);
      await result;
    }
  });
}

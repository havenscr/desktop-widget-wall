import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const sources = Object.fromEntries(['smart-widget', 'twitch'].map(name => [
  name, readFileSync(new URL(`../src/public/scripts/widgets/${name}.js`, import.meta.url), 'utf8')
]));
const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.className = '';
    this.classList = {
      contains: name => this.className.split(' ').includes(name),
      add: name => this.classList.toggle(name, true),
      remove: name => this.classList.toggle(name, false),
      toggle: (name, on) => {
        const names = new Set(this.className.split(' ').filter(Boolean));
        if (on) names.add(name); else names.delete(name);
        this.className = [...names].join(' ');
      }
    };
  }
  get isConnected() { return !!this.root || !!this.parentElement?.isConnected; }
  appendChild(child) {
    child.remove();
    this.children.push(child);
    child.parentElement = this;
    return child;
  }
  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter(child => child !== this);
      this.parentElement = null;
    }
  }
  set innerHTML(value) { this.children.slice().forEach(child => child.remove()); }
  matches(selector) {
    if (selector.includes(':not')) return this.matches(selector.split(':')[0]) && this.dataset.page !== '0';
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    return this.tagName === selector;
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector); }
  setAttribute(name, value) {
    if (name.startsWith('data-')) this.dataset[name.slice(5)] = String(value);
    else this[name] = String(value);
  }
  getAttribute(name) { return name.startsWith('data-') ? this.dataset[name.slice(5)] : this[name]; }
  removeAttribute(name) { delete this[name]; }
  pause() { this.paused = true; }
  load() {}
  addEventListener() {}
}

function harness({ hls = true, youtubeLoaded = true, twitchLoaded = true } = {}) {
  const root = new Element();
  root.root = true;
  const create = (parent, id, classes = '', tag) => {
    const element = new Element(tag);
    element.id = id;
    element.className = classes;
    return parent.appendChild(element);
  };
  const widget = create(root, 'twitch-widget');
  const pages = create(widget, '', 'smart-widget-pages');
  const twitchPage = create(pages, '', 'smart-widget-page active');
  twitchPage.dataset.page = '0';
  const youtubePage = create(pages, 'smart-widget-page-1', 'smart-widget-page');
  youtubePage.dataset.page = '1';
  youtubePage.dataset.videoId = 'abcdefghijk';
  const embed = create(twitchPage, 'twitch-embed');
  const video = create(twitchPage, 'hls-video', '', 'video');
  const offline = create(twitchPage, 'twitch-offline');
  const fallback = create(twitchPage, 'twitch-fallback');
  const head = create(root, 'head');
  const timers = new Map(), intervals = new Map(), events = [], errors = [];
  let timerId = 0;
  const storage = new Map();
  const ytPlayers = [], embeds = [], plays = [];
  const stats = { polling: 0, fallback: 0, offline: 0, stops: 0 };
  const config = { twitch: { hlsEnabled: hls, channel: 'anya' } };
  const context = vm.createContext({
    document: {
      readyState: 'loading', head,
      getElementById: id => root.querySelector(`#${id}`),
      querySelector: selector => root.querySelector(selector.split(' ').at(-1)),
      createElement: tag => new Element(tag), addEventListener() {}
    },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    console: { log() {}, warn() {}, error: (...args) => errors.push(args) },
    dlog() {}, location: { origin: 'https://localhost', hostname: 'localhost' },
    addEventListener() {}, dispatchEvent: event => events.push(event),
    CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
    setInterval: callback => { intervals.set(++timerId, callback); return timerId; },
    clearInterval: id => intervals.delete(id),
    getDashboardConfig: () => config
  });
  context.window = context;
  const YT = {
    PlayerState: { PLAYING: 1, BUFFERING: 3 },
    Player: class {
      constructor(container, options) {
        this.events = options.events;
        this.iframe = create(container.parentElement, '', '', 'iframe');
        container.remove();
        this.plays = 0;
        this.destroyed = 0;
        ytPlayers.push(this);
      }
      getIframe() { return this.iframe; }
      playVideo() { this.plays += 1; }
      stopVideo() {}
      destroy() { this.destroyed += 1; this.iframe.remove(); }
      ready() { this.events.onReady({ target: this }); }
      playing() { this.events.onStateChange({ target: this, data: 1 }); }
    }
  };
  const Twitch = { Embed: class {
    static VIDEO_READY = 'ready';
    static OFFLINE = 'offline';
    constructor(id, options) {
      this.options = options;
      this.events = {};
      this.plays = 0;
      this.iframe = create(embed, '', '', 'iframe');
      this.iframe.src = 'https://player.twitch.tv';
      this.destroyed = 0;
      embeds.push(this);
    }
    addEventListener(type, callback) { this.events[type] = callback; }
    getPlayer() { return this; }
    isPaused() { return true; }
    pause() {}
    play() { this.plays += 1; }
    destroy() { this.destroyed += 1; }
    emit(type) { this.events[type]?.(); }
  } };
  if (youtubeLoaded) context.YT = YT;
  if (twitchLoaded) context.Twitch = Twitch;
  context.HLSPlayer = {
    play(channel) {
      assert.equal(embed.children.length, 0, 'embed unloaded before HLS starts');
      assert.equal(intervals.size, 0, 'embed watchdog stopped before HLS starts');
      const request = { channel, ...deferred() };
      plays.push(request);
      return request.promise;
    },
    stop() { stats.stops += 1; },
    isPlaying() { return plays.length > 0; }
  };
  vm.runInContext(sources.twitch, context);
  vm.runInContext(sources['smart-widget'], context);
  context.showHLSControls = () => {};
  context.startStreamInfoPolling = () => { stats.polling += 1; };
  context.showTwitchFallback = () => { stats.fallback += 1; };
  context.showTwitchOffline = () => { stats.offline += 1; };
  context.updateTwitchStreamInfo = () => {};
  const runTimers = delay => {
    for (const [id, timer] of [...timers]) {
      if (delay === undefined || timer.delay === delay) {
        timers.delete(id);
        timer.callback();
      }
    }
  };
  return { context, config, head, embed, video, offline, fallback, pages, youtubePage,
    twitchPage, YT, Twitch, ytPlayers, embeds, plays, stats, timers, intervals, errors, events, runTimers };
}

test('YouTube coalesces pending creation and invalidates a same-video activation before API load', async () => {
  const h = harness({ youtubeLoaded: false });
  h.context.SmartWidget.switchToPage(1);
  h.context.SmartWidget.switchToPage(1);
  assert.equal(h.youtubePage.children.length, 1);
  h.context.SmartWidget.switchToPage(0);
  h.context.SmartWidget.switchToPage(1);
  h.context.YT = h.YT;
  h.context.onYouTubeIframeAPIReady();
  await flush();
  assert.equal(h.ytPlayers.length, 1);
  assert.equal(h.youtubePage.youtubePlayer, h.ytPlayers[0]);
});

test('Twitch shares one HLS script load across suspend and resume', async () => {
  const h = harness();
  const player = h.context.HLSPlayer;
  delete h.context.HLSPlayer;
  h.context.updateTwitchWidget();
  h.context.TwitchPlayback.suspend();
  h.context.TwitchPlayback.resume();
  const scripts = h.head.children.filter(script => script.src?.includes('hls-player.js'));
  assert.equal(scripts.length, 1);
  h.context.HLSPlayer = player;
  scripts[0].onload();
  await flush();
  assert.equal(h.plays.length, 1);
  assert.equal(h.context.TwitchPlayback.getBackend(), 'hls');
});

test('Twitch can retry a failed shared HLS script load', async () => {
  const h = harness();
  delete h.context.HLSPlayer;
  h.context.updateTwitchWidget();
  h.head.children.find(script => script.src?.includes('hls-player.js')).onerror();
  await flush();
  assert.equal(h.context.TwitchPlayback.getBackend(), 'embed');
  h.context.updateTwitchWidget();
  assert.equal(h.head.children.filter(script => script.src?.includes('hls-player.js')).length, 1);
  assert.equal(h.context.TwitchPlayback.getBackend(), 'hls');
});

test('YouTube destroys before readiness and ignores stale ready, state and delayed autoplay', async () => {
  const h = harness();
  h.context.SmartWidget.switchToPage(1);
  await flush();
  const first = h.ytPlayers[0];
  first.ready();
  h.context.SmartWidget.switchToPage(0);
  assert.equal(first.destroyed, 1);
  h.context.SmartWidget.switchToPage(1);
  await flush();
  first.ready();
  first.playing();
  h.runTimers(100);
  assert.equal(first.plays, 0);
  assert.equal(h.events.length, 0);
  h.ytPlayers[1].ready();
  h.runTimers(100);
  assert.equal(h.ytPlayers[1].plays, 1);
});

test('settings rebuild destroys the player before removing its page', async () => {
  const h = harness();
  h.context.SmartWidget.switchToPage(1);
  await flush();
  const player = h.ytPlayers[0];
  const destroy = player.destroy.bind(player);
  player.destroy = () => { assert.equal(h.youtubePage.isConnected, true); destroy(); };
  h.context.buildSmartWidgetUI = () => {};
  h.context.SmartWidget.setConfig({ sources: [] });
  assert.equal(player.destroyed, 1);
  assert.equal(h.youtubePage.isConnected, false);
  player.ready();
  h.runTimers();
  assert.equal(player.plays, 0);
});

test('settings rebuild invalidates YouTube creation still waiting for the API', async () => {
  const h = harness({ youtubeLoaded: false });
  h.context.SmartWidget.switchToPage(1);
  h.context.buildSmartWidgetUI = () => {};
  h.context.SmartWidget.setConfig({ sources: [] });
  h.context.YT = h.YT;
  h.context.onYouTubeIframeAPIReady();
  await flush();
  assert.equal(h.ytPlayers.length, 0);
  assert.equal(h.youtubePage.youtubeCreation, null);
});

test('embed to HLS destroys the embed, unloads its iframe and stops watchdog and delayed play', async () => {
  const h = harness({ hls: false });
  h.context.updateTwitchWidget();
  await flush();
  const first = h.embeds[0];
  first.emit('ready');
  assert.equal(h.intervals.size, 1);
  h.config.twitch.hlsEnabled = true;
  h.context.updateTwitchWidget();
  assert.equal(first.destroyed, 1);
  assert.equal(first.iframe.src, 'about:blank');
  assert.equal(h.context.TwitchPlayback.getBackend(), 'hls');
  first.emit('ready');
  first.emit('offline');
  h.runTimers();
  assert.equal(first.plays, 0);
  assert.equal(h.stats.offline, 0);
  h.context.SmartWidget.switchToPage(0);
  assert.equal(h.plays.length, 1, 'pending HLS is not restarted on repeated activation');
});

for (const name of ['AbortError', 'Error']) {
  test(`obsolete HLS ${name} cannot replace or stop the current embed`, async () => {
    const h = harness();
    h.context.updateTwitchWidget();
    h.config.twitch.hlsEnabled = false;
    h.context.updateTwitchWidget();
    await flush();
    const stops = h.stats.stops;
    h.plays[0].reject(Object.assign(new Error('old startup'), { name }));
    await flush();
    assert.equal(h.context.TwitchPlayback.getBackend(), 'embed');
    assert.equal(h.embeds.length, 1);
    assert.equal(h.stats.stops, stops);
    assert.equal(h.errors.length, 0);
  });
}

test('HLS completion after leaving its page cannot unmute or start polling', async () => {
  const h = harness();
  h.context.updateTwitchWidget();
  h.context.SmartWidget.switchToPage(1);
  h.plays[0].resolve();
  await flush();
  assert.equal(h.video.muted, true);
  assert.equal(h.stats.polling, 0);
  assert.equal(h.context.TwitchPlayback.getBackend(), null);
});

test('HLS failure after leaving its page cannot start a fallback or show an error', async () => {
  const h = harness();
  h.context.updateTwitchWidget();
  h.context.SmartWidget.switchToPage(1);
  const stops = h.stats.stops;
  h.plays[0].reject(new Error('network failed'));
  await flush();
  assert.equal(h.embeds.length, 0);
  assert.equal(h.stats.stops, stops);
  assert.equal(h.stats.offline, 0);
  assert.equal(h.stats.fallback, 0);
  assert.equal(h.errors.length, 0);
});

test('current AbortError stays quiet and does not trigger native fallback', async () => {
  const h = harness();
  h.context.updateTwitchWidget();
  h.plays[0].reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
  await flush();
  assert.equal(h.embeds.length, 0);
  assert.equal(h.errors.length, 0);
  assert.equal(h.stats.fallback, 0);
});

test('HLS fallback is tracked as embed and stays embed across page switches', async () => {
  const h = harness();
  h.context.updateTwitchWidget();
  h.plays[0].reject(new Error('network failed'));
  await flush();
  assert.equal(h.context.TwitchPlayback.getBackend(), 'embed');
  h.context.SmartWidget.switchToPage(1);
  h.context.SmartWidget.switchToPage(0);
  await flush();
  assert.equal(h.context.TwitchPlayback.getBackend(), 'embed');
  assert.equal(h.plays.length, 1);
  assert.equal(h.embeds.length, 2);
});

test('native API completion and fallback timeout cannot update an inactive page', async () => {
  const h = harness({ hls: false, twitchLoaded: false });
  h.context.updateTwitchWidget();
  const script = h.head.children[0];
  h.context.SmartWidget.switchToPage(1);
  h.context.Twitch = h.Twitch;
  script.onload();
  await flush();
  assert.equal(h.embeds.length, 0);
  h.runTimers();
  assert.equal(h.stats.fallback, 0);
});

test('late native ready and offline events are ignored after a channel rebuild', async () => {
  const h = harness({ hls: false });
  h.context.updateTwitchWidget();
  await flush();
  const first = h.embeds[0];
  h.context.updateTwitchWidget();
  await flush();
  first.emit('ready');
  first.emit('offline');
  h.runTimers(100);
  assert.equal(h.stats.polling, 0);
  assert.equal(h.stats.offline, 0);
  assert.equal(h.intervals.size, 0);
  assert.equal(first.plays, 0);
});

test('dynamic HLS module callbacks cannot start playback or fallback while inactive', async () => {
  const h = harness();
  const player = h.context.HLSPlayer;
  delete h.context.HLSPlayer;
  h.context.updateTwitchWidget();
  const script = h.head.children[0];
  h.context.SmartWidget.switchToPage(1);
  h.context.HLSPlayer = player;
  script.onload();
  script.onerror();
  await flush();
  assert.equal(h.plays.length, 0);
  assert.equal(h.embeds.length, 0);
  assert.equal(h.context.TwitchPlayback.getBackend(), null);
});

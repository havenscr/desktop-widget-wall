import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = (path) => readFileSync(new URL(`../src/public/scripts/${path}`, import.meta.url), 'utf8');
const noop = () => {};

function browserContext() {
  const timers = new Map();
  const frames = new Map();
  const listeners = new Map();
  const saved = new Map();
  let nextId = 0;
  const context = vm.createContext({
    console: { log: noop, warn: noop, error: noop }, dlog: noop,
    document: { readyState: 'loading', hidden: false, addEventListener: noop },
    addEventListener: (name, fn) => listeners.set(name, fn),
    localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) },
    setTimeout: (fn, delay) => { const id = ++nextId; timers.set(id, { fn, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    clearInterval: noop,
    requestAnimationFrame: (fn) => { const id = ++nextId; frames.set(id, fn); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
    performance: { now: () => 0 },
  });
  context.window = context;
  const runTimers = (delay) => {
    for (const [id, timer] of [...timers]) {
      if (timer.delay === delay) { timers.delete(id); timer.fn(); }
    }
  };
  return { context, timers, frames, listeners, saved, runTimers };
}

test('shrinking and regrowing nodes removes obsolete forces and owned graphics', () => {
  class Point {
    constructor(x = 0, y = 0) { this.set(x, y); }
    set(x, y) { this.x = x; this.y = y; }
  }
  const sharedTexture = { destroyed: false };
  class Container {
    constructor() { this.children = []; this.position = new Point(); }
    addChild(child) { this.children.push(child); child.parent = this; return child; }
    addChildAt(child, index) { this.children.splice(index, 0, child); child.parent = this; }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parent = null; }
    destroy(options) {
      this.destroyed = true;
      if (options?.children) for (const child of this.children) child.destroy(options);
      if (options?.texture || options?.baseTexture) sharedTexture.destroyed = true;
      this.children = [];
    }
  }
  class Graphics extends Container {
    clear() {}
    lineStyle() {}
    moveTo() {}
    lineTo() {}
  }
  const { context } = browserContext();
  context.PIXI = { Container, Graphics, Point };
  // Expose the private class without replacing any production behavior.
  vm.runInContext(source('lib/poweraudio.js').replace('global.PowerAudio = {',
    'global.TestNodeContainer = NodeContainer; global.PowerAudio = {'), context);
  const stage = { getWidth: () => 200, getHeight: () => 100, viz: { config: { lineOpacity: 0.5 } } };
  const nodes = new context.TestNodeContainer(stage, { position: new Point(100, 50), radius: 40 });
  nodes.setNodeCount(4);
  const survivor = nodes.nodes.children[0];
  survivor.setForce('external', { x: 7, y: 9 });
  for (let cycle = 0; cycle < 8; cycle += 1) {
    nodes.nodes.children.forEach((node, index) => node.position.set(10 + index * 20, 10));
    nodes.children[0].update(0);
    const removed = nodes.nodes.children.slice(1);
    const graphics = removed.map((node) => node.graphics);
    const peerForce = survivor.forces['node_' + removed[0].id];
    nodes.setNodeCount(2);
    assert.equal(survivor.forces['node_' + removed[0].id], peerForce);
    assert.equal(Object.keys(survivor.forces).filter((key) => key.startsWith('node_')).length, 1);
    assert.equal(Object.keys(removed[0].forces).filter((key) => key.startsWith('node_')).length, 1);
    nodes.setNodeCount(1);
    assert.equal(nodes.nodes.children[0], survivor);
    assert.equal(Object.keys(survivor.forces).filter((key) => key.startsWith('node_')).length, 0);
    assert.equal(survivor.forces.external.x, 7);
    assert.ok(survivor.forces.tocenter);
    assert.ok(removed.every((node) => node.destroyed && node.parent === null));
    assert.ok(graphics.every((graphic) => graphic.destroyed));
    assert.equal(sharedTexture.destroyed, false);
    nodes.setNodeCount(4);
  }
  nodes.setNodeCount(0);
  assert.equal(nodes.nodes.children.length, 0);
  assert.equal(survivor.destroyed, true);
});

function visualizerContext() {
  const harness = browserContext();
  const { context } = harness;
  const calls = [];
  const scripts = [];
  const modes = ['poweraudio', 'milkdrop', 'circular', 'infinidream'];
  const elements = new Map(modes.flatMap((mode) => [
    [`visualizer-mode-${mode}`, { style: {} }], [`config-mode-${mode}`, { style: {} }],
  ]));
  const dots = modes.map((mode) => ({
    mode, active: false, getAttribute: () => mode,
    classList: { toggle: (name, active) => { dots.find((dot) => dot.mode === mode).active = active; } },
  }));
  Object.assign(context.document, {
    getElementById: (id) => elements.get(id), querySelectorAll: () => dots,
    createElement: () => ({}), head: { appendChild: (script) => scripts.push(script) },
  });
  context.stage = {
    pause: () => calls.push('pause'), resume: () => calls.push('resume'), resize: () => calls.push('resize'),
  };
  context.calls = calls;
  // Stub renderer construction only. Switching, library loading, timers and disposal run from source.
  const bridge = `
    poweraudioViz = { stage: window.stage, destroy() {} };
    initPowerAudioVisualizer = () => { calls.push('init:poweraudio'); return true; };
    initMilkdropVisualizer = () => { calls.push('init:milkdrop'); return true; };
    initCircularVisualizer = () => { calls.push('init:circular'); return true; };
    window.seedMilkdrop = (renderer, mesh, observer) => {
      milkdropRenderer = renderer; milkdropMesh = mesh;
      milkdropResizeObserver = observer; milkdropInitialized = true;
    };
  `;
  const script = source('widgets/visualizer.js');
  const end = script.lastIndexOf('})();');
  assert.ok(end > 0);
  vm.runInContext(script.slice(0, end) + bridge + script.slice(end), context);
  return { ...harness, calls, scripts, dots, elements, switchMode: context.setVisualizerDisplayMode };
}

test('outgoing PowerAudio stops before libraries load, and only the latest mode initializes', async () => {
  const h = visualizerContext();
  h.context.PIXI = {};
  h.context.PowerAudio = {};
  await h.switchMode('poweraudio');
  h.calls.length = 0;
  const milkdrop = h.switchMode('milkdrop');
  assert.deepEqual(h.calls, ['pause']);
  assert.equal(h.frames.size, 0);
  const circular = h.switchMode('circular');
  assert.equal(h.scripts.length, 1);
  h.context.THREE = {};
  h.scripts[0].onload();
  await Promise.all([milkdrop, circular]);
  assert.equal(h.calls.includes('init:milkdrop'), false);
  assert.equal(h.calls.filter((call) => call === 'init:circular').length, 1);
  assert.equal(h.saved.get('visualizer-display-mode'), 'circular');
  assert.deepEqual(h.dots.filter((dot) => dot.active).map((dot) => dot.mode), ['circular']);
  assert.equal(h.elements.get('visualizer-mode-poweraudio').style.display, 'none');
  assert.equal(h.elements.get('config-mode-circular').style.display, 'block');
  h.runTimers(50);
  assert.equal(h.calls.includes('resize'), false);
  assert.equal(h.frames.size, 1);
});

test('a delayed PowerAudio load cannot resume after selecting the launcher', async () => {
  const h = visualizerContext();
  const pending = h.switchMode('poweraudio');
  await h.switchMode('infinidream');
  h.context.PIXI = {};
  h.context.PowerAudio = {};
  h.scripts[0].onload();
  await pending;
  assert.equal(h.calls.includes('resume'), false);
  assert.equal(h.calls.includes('init:poweraudio'), false);
  assert.equal(h.saved.get('visualizer-display-mode'), 'infinidream');
  assert.equal(h.frames.size, 0);
});

test('switching away and back during the same load resumes PowerAudio only once', async () => {
  const h = visualizerContext();
  const first = h.switchMode('poweraudio');
  await h.switchMode('infinidream');
  const latest = h.switchMode('poweraudio');
  h.context.PIXI = {};
  h.context.PowerAudio = {};
  h.scripts[0].onload();
  await Promise.all([first, latest]);
  assert.equal(h.calls.filter((call) => call === 'init:poweraudio').length, 1);
  assert.equal(h.calls.filter((call) => call === 'resume').length, 1);
  assert.equal(h.saved.get('visualizer-display-mode'), 'poweraudio');
  assert.equal(h.frames.size, 1);
});

test('outgoing THREE resources are disposed even when the next library fails', async () => {
  const h = visualizerContext();
  const disposed = [];
  h.context.seedMilkdrop({
    dispose: () => disposed.push('renderer'), forceContextLoss: () => disposed.push('context'),
    domElement: { parentNode: { removeChild: () => disposed.push('canvas') } },
  }, {
    geometry: { dispose: () => disposed.push('geometry') }, material: { dispose: () => disposed.push('material') },
  }, { disconnect: () => disposed.push('observer') });
  const pending = h.switchMode('poweraudio');
  h.scripts[0].onerror();
  await pending;
  h.runTimers(30000);
  assert.deepEqual(disposed.sort(), ['canvas', 'context', 'geometry', 'material', 'observer', 'renderer']);
  assert.equal(h.frames.size, 0);
});

test('unload invalidates a pending mode load', async () => {
  const h = visualizerContext();
  const pending = h.switchMode('milkdrop');
  h.listeners.get('beforeunload')();
  h.context.THREE = {};
  h.scripts[0].onload();
  await pending;
  assert.equal(h.calls.includes('init:milkdrop'), false);
  assert.equal(h.frames.size, 0);
  assert.equal(h.timers.size, 0);
});

test('color mesh keeps its DPR cap and skips unchanged backing sizes and blob resets', async () => {
  const { context } = browserContext();
  let rect = { width: 420.75, height: 180.5 };
  let width = 300, height = 150, resets = 0, resize;
  const widget = { getBoundingClientRect: () => rect };
  const canvas = {
    get width() { return width; }, set width(value) { width = value; resets += 1; },
    get height() { return height; }, set height(value) { height = value; resets += 1; },
    closest: () => widget, getContext: () => ({}),
  };
  context.devicePixelRatio = 2;
  context.document.getElementById = () => canvas;
  context.ResizeObserver = class { constructor(fn) { resize = fn; } observe() {} };
  vm.runInContext(source('widgets/now-playing.js'), context);
  vm.runInContext("nowPlayingConfig.background = 'color-mesh'", context);
  await context.updateColorMesh(null, null);
  context.setupColorMeshResizeObserver();
  assert.deepEqual([width, height], [420, 180]);
  const blobs = vm.runInContext('colorMeshBlobs', context);
  const initialResets = resets;
  resize();
  resize();
  assert.equal(resets, initialResets);
  assert.equal(vm.runInContext('colorMeshBlobs', context), blobs);
  context.devicePixelRatio = 3;
  resize();
  assert.equal(resets, initialResets);
  await context.updateColorMesh(null, null);
  assert.equal(resets, initialResets);
  rect = { width: 500.75, height: 180.5 };
  resize();
  assert.deepEqual([width, height], [500, 180]);
  assert.equal(resets, initialResets + 1);
  assert.notEqual(vm.runInContext('colorMeshBlobs', context), blobs);
  const resizedBlobs = vm.runInContext('colorMeshBlobs', context);
  resize();
  assert.equal(vm.runInContext('colorMeshBlobs', context), resizedBlobs);
});

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const THREE = require('three');

const filename = path.join(__dirname, '../src/components/surprise/die-scene.tsx');
const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
let roundedBox;
before(async () => { roundedBox = await import('three/examples/jsm/geometries/RoundedBoxGeometry.js'); });

function mount(t, { reducedMotion = false, firstRenderCost = 3600, props = {} } = {}) {
  let now = 100, nextId = 1, cursor = 0, disposed = 0, rendererOptions;
  const hooks = [], effects = [], rafs = new Map(), timers = new Map();
  const frames = [], starts = [], ends = [];
  const gl = { drawingBufferWidth: 720, drawingBufferHeight: 720, endFrameEXP() {} };
  const react = {
    createElement: (_type, properties) => properties,
    useRef(value) { return hooks[cursor++] ??= { current: value }; },
    useEffect(effect, deps) {
      const index = cursor++, previous = hooks[index];
      if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) {
        effects.push(() => {
          previous?.cleanup?.();
          hooks[index] = { deps, cleanup: effect() };
        });
      }
    },
  };
  class Renderer {
    constructor(options) { rendererOptions = options; }
    setClearColor() {}
    render(scene) {
      const die = scene.children.find((child) => child.isGroup);
      assert.ok(die, 'renderer receives the real THREE die group');
      frames.push(die.quaternion.clone());
      if (frames.length === 1) now += firstRenderCost;
    }
    dispose() { disposed++; }
  }
  const modules = {
    react,
    'react/jsx-runtime': { jsx: react.createElement, jsxs: react.createElement },
    'react-native-reanimated': { useReducedMotion: () => reducedMotion },
    'expo-gl': { GLView: () => null },
    'expo-three/build/Renderer': Renderer,
    './die-renderer': Renderer,
    three: THREE,
    'three/examples/jsm/geometries/RoundedBoxGeometry.js': roundedBox,
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require(name) { assert.ok(name in modules, `unexpected import: ${name}`); return modules[name]; },
    performance: { now: () => now },
    Math: Object.assign(Object.create(Math), { random: () => 0.37 }),
    requestAnimationFrame(callback) { const id = nextId++; rafs.set(id, callback); return id; },
    cancelAnimationFrame(id) { rafs.delete(id); },
    setTimeout(callback, delay = 0) { const id = nextId++; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  }, { filename });
  let currentProps = {
    onRollStart: () => starts.push({ at: now, rendered: frames.length }),
    onRollEnd: (value) => ends.push(value),
    ...props,
  };
  function rerender(update = {}) {
    currentProps = { ...currentProps, ...update };
    cursor = 0;
    const view = exports.DieScene(currentProps);
    effects.splice(0).forEach((effect) => effect());
    return view;
  }
  function advance(ms, paint = true) {
    now += ms;
    const timestamp = now;
    if (paint) {
      for (const [id, callback] of [...rafs]) {
        if (rafs.delete(id)) callback(timestamp);
      }
    }
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now && timers.delete(id)) timer.callback();
    }
  }
  let unmounted = false;
  function unmount() {
    if (unmounted) return;
    unmounted = true;
    hooks.forEach((hook) => hook.cleanup?.());
  }
  t.after(unmount);
  const view = rerender();
  assert.equal(starts.length, 0, 'mount alone does not start the roll');
  view.onContextCreate(gl);
  return {
    frames, starts, ends, rafs, timers, view, rerender, advance, unmount,
    get options() { return rendererOptions; },
    get disposed() { return disposed; },
    firstFrame() { if (!frames.length) advance(4000); },
  };
}

function assertFinished(h) {
  h.rerender({ settling: true });
  for (let i = 0; i < 100; i++) h.advance(50);
  assert.equal(h.ends.length, 1, 'settling completes exactly once');
  assert.ok(Number.isInteger(h.ends[0]) && h.ends[0] >= 1 && h.ends[0] <= 6);
  assert.equal(h.rafs.size, 0, 'completion stops animation frames');
  assert.equal(h.timers.size, 0, 'completion clears timers');
  const count = h.frames.length;
  h.rerender({ settling: true });
  h.advance(10000);
  assert.equal(h.ends.length, 1);
  assert.equal(h.frames.length, count, 'completed scene stays stopped');
}

test('starts after the first render', (t) => {
  const h = mount(t);
  h.firstFrame();
  assert.equal(h.starts.length, 1);
  assert.ok(h.starts[0].rendered >= 1, 'start follows a rendered frame');
  assert.ok(h.starts[0].at >= 3700, 'start follows expensive first-render work');
  h.advance(4000);
  const delayedFrame = h.frames.at(-1);
  h.advance(100);
  assert.ok(delayedFrame.angleTo(h.frames.at(-1)) > 0.05, 'a late RAF must not freeze motion');
  assert.equal(h.ends.length, 0, 'a late RAF must not end matching');
  assert.equal(h.starts.length, 1);
});

test('uses the full 3x drawing buffer independently of logical size', (t) => {
  const h = mount(t);
  assert.equal(h.view.style.width, 240);
  assert.equal(h.view.style.height, 240);
  assert.equal(h.options.width, 720);
  assert.equal(h.options.height, 720);
  assert.equal(h.options.pixelRatio, 1);
  const resized = h.rerender({ size: 180 });
  assert.equal(resized.style.width, 180);
  assert.equal(resized.style.height, 180);
});

test('animation clock excludes costly initial rendering', (t) => {
  const fast = mount(t, { firstRenderCost: 0 });
  const slow = mount(t);
  fast.firstFrame();
  slow.firstFrame();
  for (let i = 0; i < 10; i++) {
    fast.advance(16);
    slow.advance(16);
    assert.ok(fast.frames.at(-1).angleTo(slow.frames.at(-1)) < 1e-6,
      'equal post-render elapsed time produces equal orientation');
  }
  assert.ok(slow.frames[0].angleTo(slow.frames.at(-1)) > 0.1, 'rotation remains visibly animated');
  assert.equal(slow.ends.length, 0);
});

test('keeps visibly spinning while matching, then settles once after a prop update', (t) => {
  const h = mount(t);
  h.firstFrame();
  for (let i = 0; i < 80; i++) h.advance(50);
  assert.equal(h.ends.length, 0, 'elapsed time alone must not complete the roll');
  assert.ok(h.rafs.size > 0);
  const previous = h.frames.at(-1);
  h.advance(100);
  assert.ok(previous.angleTo(h.frames.at(-1)) > 0.05, 'die still moves after four seconds');
  assertFinished(h);
  assert.equal(h.starts.length, 1, 'settling does not restart the scene');
});

test('reduced motion is static and waits for settling', (t) => {
  const h = mount(t, { reducedMotion: true });
  h.firstFrame();
  assert.equal(h.starts.length, 1);
  const initial = h.frames[0];
  for (let i = 0; i < 80; i++) h.advance(50);
  assert.equal(h.ends.length, 0);
  assert.equal(h.rafs.size, 0, 'static scene does not schedule animation frames');
  assert.ok(h.frames.every((frame) => frame.angleTo(initial) < 1e-6));
  assertFinished(h);
});

test('fullMotion overrides the reduced-motion preference', (t) => {
  const h = mount(t, { reducedMotion: true, props: { fullMotion: true } });
  h.firstFrame();
  for (let i = 0; i < 12; i++) h.advance(50);
  assert.ok(h.frames[0].angleTo(h.frames.at(-1)) > 0.1);
  assert.ok(h.rafs.size > 0);
  assert.equal(h.ends.length, 0);
  assertFinished(h);
});

for (const reducedMotion of [false, true]) {
  test(`cleanup cancels pending work and guards stale callbacks (reducedMotion=${reducedMotion})`, (t) => {
    const h = mount(t, { reducedMotion, firstRenderCost: 0 });
    h.advance(16);
    assert.equal(h.ends.length, 0, 'unmount test starts with an unfinished roll');
    const stale = [...h.rafs.values(), ...[...h.timers.values()].map((timer) => timer.callback)];
    if (!reducedMotion) assert.ok(stale.length > 0, 'exercise a queued animation callback');
    h.rerender({ settling: true });
    stale.push(...h.rafs.values(), ...[...h.timers.values()].map((timer) => timer.callback));
    h.unmount();
    assert.equal(h.disposed, 1);
    assert.equal(h.rafs.size, 0);
    assert.equal(h.timers.size, 0);
    const frameCount = h.frames.length, endCount = h.ends.length;
    h.advance(10000, false);
    stale.forEach((callback) => callback(20000));
    assert.equal(h.frames.length, frameCount, 'stale callbacks cannot render');
    assert.equal(h.ends.length, endCount, 'stale callbacks cannot report completion');
    assert.equal(h.rafs.size, 0);
    assert.equal(h.timers.size, 0);
  });
}

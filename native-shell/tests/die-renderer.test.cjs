const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const THREE = require('three');
const source = fs.readFileSync(path.join(__dirname, '../src/components/surprise/die-renderer.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const exportsForTest = {};
vm.runInNewContext(compiled, { exports: exportsForTest, require: () => THREE });
const { createThreeContext, DieRenderer } = exportsForTest;

test('SDK 57 WebGL2 inheritance reproduces Three rejection; adapter passes that gate', (t) => {
  const previous = global.WebGLRenderingContext;
  class WebGL1 {}
  class WebGL2 extends WebGL1 {
    getContextAttributes() { throw reachedNativeContext; }
  }
  const reachedNativeContext = new Error('reached valid native WebGL2 context');
  global.WebGLRenderingContext = WebGL1;
  t.after(() => {
    if (previous === undefined) delete global.WebGLRenderingContext;
    else global.WebGLRenderingContext = previous;
  });
  const gl = new WebGL2();
  assert.throws(() => new THREE.WebGLRenderer({ context: gl, canvas: {} }), /WebGL 1 is not supported/);
  assert.throws(() => new DieRenderer({ gl }), (error) => error === reachedNativeContext);
  assert.ok(gl instanceof WebGL1);
  assert.ok(gl instanceof WebGL2);
  assert.equal(global.WebGLRenderingContext, WebGL1);
});

test('facade forwards native receivers, constants, changing buffer sizes and writes', () => {
  class GL {
    MAX_TEXTURE_SIZE = 4096;
    drawingBufferWidth = 960;
    calls = 0;
    endFrameEXP() { assert.equal(this, gl); this.calls++; }
    getParameter(key) { assert.equal(this, gl); return this[key]; }
  }
  const gl = new GL();
  const context = createThreeContext(gl);
  assert.equal(Object.getPrototypeOf(context), null);
  assert.equal(context.MAX_TEXTURE_SIZE, 4096);
  assert.equal(context.getParameter('drawingBufferWidth'), 960);
  assert.equal(context.endFrameEXP, context.endFrameEXP);
  context.endFrameEXP();
  assert.equal(gl.calls, 1);
  gl.drawingBufferWidth = 720;
  assert.equal(context.drawingBufferWidth, 720);
  context.drawingBufferColorSpace = 'srgb';
  assert.equal(gl.drawingBufferColorSpace, 'srgb');
  assert.ok('getParameter' in context);
  gl.endFrameEXP = function () { assert.equal(this, gl); this.calls += 2; };
  context.endFrameEXP();
  assert.equal(gl.calls, 3);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

test('AppleScrollRail compiles and exports clean modular interface', () => {
  const filePath = path.join(__dirname, '../src/components/apple-scroll-rail.tsx');
  const source = readFileSync(filePath, 'utf8');

  // Verify file exports AppleScrollRail
  assert.ok(source.includes('export function AppleScrollRail'));
  assert.ok(source.includes('TRACK_WIDTH = 44'));
  assert.ok(source.includes('THUMB_WIDTH = 16'));
  assert.ok(source.includes('bleedMargin = 22'));
  assert.ok(source.includes('marginHorizontal: -bleedMargin'));
  assert.ok(source.includes('showsHorizontalScrollIndicator={false}'));

  // Verify handleScroll is a plain function, NOT Animated.event (which crashes ScrollView with "Object is not a function")
  assert.ok(!source.includes('Animated.event('));
  assert.ok(source.includes('const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {'));

  // Transpile to verify TypeScript syntax is valid CommonJS
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
    },
  }).outputText;

  assert.ok(compiled.length > 0);
  assert.ok(compiled.includes('AppleScrollRail'));
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const filename = path.join(__dirname, '../src/services/place-summary.ts');
const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const exportsObject = {};
vm.runInNewContext(compiled, { exports: exportsObject });
const { placeSummary } = exportsObject;

test('uses existing description, normalizes whitespace and keeps it concise', () => {
  assert.equal(placeSummary({ description: 'Coffee\n and pastries.' }), 'Coffee and pastries.');
  const summary = placeSummary({ description: 'An existing description. '.repeat(30) });
  assert.ok(summary.length <= 220);
  assert.ok(summary.endsWith('...'));
});

test('address-only copy falls back to category, location and listed features', () => {
  assert.equal(placeSummary({ description: '10 Main St.', address: '10 Main St', category: 'cafe', city: 'Toronto', features: ['coffee', 'coffee', 'outdoor_seating'] }),
    'Cafe in Toronto. Listed features: coffee, outdoor seating.');
});

test('sparse records stay honest without ratings or opening claims', () => {
  assert.equal(placeSummary({ category: 'art_gallery', city: 'Markham' }), 'Art gallery in Markham.');
  assert.equal(placeSummary({}), 'Place. More details are not available yet.');
  assert.equal(placeSummary({ title: 'Gallery', description: 'Gallery', category: 'gallery' }), 'Gallery. More details are not available yet.');
});

test('detail fallback uses supplied verified facts, not transient opening claims', () => {
  assert.equal(placeSummary({ category: 'restaurant', city: 'Toronto' }, [
    { label: 'Now', value: 'Open now' },
    { label: 'Cuisine', value: 'Italian' },
  ]), 'Restaurant in Toronto. Cuisine: Italian');
});

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/request.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
module.exports = function loadRequest(globals = {}) {
  const exports = {};
  vm.runInNewContext(compiled, { exports, Error, URL, AbortController, Request, Response, fetch, setTimeout, clearTimeout, ...globals });
  return exports;
};

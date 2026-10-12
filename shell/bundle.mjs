// The designer as two files for the store: NAME.html (page, styles, script and the engine's JS
// glue, all inline) and NAME.wasm.gz (the engine). The store's deploy tool writes only into
// folders that already exist, so a release cannot bring a folder of its own; two files named by
// the build's commit sit side by side in the calculators' folder instead, and a new release
// never overwrites an old one.
//
// Run: node shell/bundle.mjs SITE_DIR OUT_DIR NAME
//   SITE_DIR  a built designer: designer.html, designer.css, designer.js, pps_bridge.js,
//             designer-manifest.json and the .wasm.gz it names
//   NAME      e.g. pps-designer-<sha>
//
// The two ES modules become one: pps_bridge.js (wasm-bindgen's --target web glue) runs inside a
// function, so none of its top-level names can collide with designer.js's. Every rewrite below
// must match exactly once, or the bundle is refused: a wasm-bindgen upgrade that changes the
// glue's shape fails here, in CI, rather than in a customer's browser.

import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const [site, out, name] = process.argv.slice(2);
if (!site || !out || !name || !/^[\w.-]+$/.test(name)) {
  console.error('usage: node shell/bundle.mjs SITE_DIR OUT_DIR NAME');
  process.exit(2);
}
const read = (f) => readFileSync(path.join(site, f), 'utf8');

function fail(msg) {
  console.error('bundle: ' + msg);
  process.exit(1);
}

function replaceOnce(text, find, repl, what) {
  const n = text.split(find).length - 1;
  if (n !== 1) fail(`${what}: expected exactly one ${JSON.stringify(find)}, found ${n}`);
  return text.replace(find, () => repl);
}

// The glue's exports, as wasm-bindgen 0.2.129 writes them.
let bridge = read('pps_bridge.js');
const classes = [...bridge.matchAll(/^export class (\w+)/gm)].map((m) => m[1]);
if (!classes.includes('Designer')) fail('pps_bridge.js: no `export class Designer`');
bridge = bridge.replace(/^export class /gm, 'class ');
bridge = replaceOnce(bridge, 'export { initSync, __wbg_init as default };', '', 'pps_bridge.js');
if (/^\s*(export|import)\s/m.test(bridge)) fail('pps_bridge.js: an import or export is left over');

let js = read('designer.js');
js = replaceOnce(
  js,
  "import init, { Designer } from './pps_bridge.js';",
  `const { init, Designer } = (() => {\n${bridge}\nreturn { init: __wbg_init, Designer };\n})();`,
  'designer.js',
);
if (/^\s*import\s/m.test(js)) fail('designer.js: another import is left over');

const css = read('designer.css');

// Inline text must not be able to end its element early.
if (/<\/script|<!--|<script/i.test(js)) fail('script text contains <script, </script or <!--');
if (/<\/style/i.test(css)) fail('style text contains </style');

const man = JSON.parse(read('designer-manifest.json'));
if (typeof man.wasm !== 'string' || !man.wasm.endsWith('.gz')) fail('manifest names no .wasm.gz');
const wasmSrc = man.wasm;
man.wasm = name + '.wasm.gz';
const manJson = JSON.stringify(man).replace(/</g, '\\u003c');

let html = read('designer.html');
html = replaceOnce(html, '<link rel="stylesheet" href="designer.css">', `<style>\n${css}\n</style>`, 'designer.html');
html = replaceOnce(
  html,
  '<script type="module" src="designer.js"></script>',
  `<script type="application/json" id="designer-manifest">${manJson}</script>\n` +
    `  <script type="module">\n${js}\n</script>`,
  'designer.html',
);

mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, name + '.html'), html);
copyFileSync(path.join(site, wasmSrc), path.join(out, name + '.wasm.gz'));
console.log(`bundle: ${name}.html (${Buffer.byteLength(html)} bytes) + ${name}.wasm.gz`);

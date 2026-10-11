// P0 task 0.5: run a designer-made PDF through the PPS proofer's file checks, unmodified.
//
// The checks are the proofer's own (runFileChecks in proof-ui-draft.html, PPS repo): page
// count, ordered size, fonts embedded, colour, hidden layers, interactive content. This script
// only hands the file over the way a calculator does (a pps-proof:job message carrying the
// file) and reads the results back.
//
// Needs the PPS proofer served on 127.0.0.1:8137, from a checkout of
// pdevvle/priorityprintservice.com (branch claude/proofer-parity-staging or later):
//   PPS_DEPS_DIR=<node_modules with pdfjs-dist@3.11.174 and pdf-lib@1.17.1> node tools-proof-serve.mjs &
//
// Run: node fixtures/p0/pps-gates.mjs fixtures/p0/postcard.pdf 9 6 0.125
//      (PDF, trim width and height in inches, bleed in inches)
//
// The proofer lays out booklets only (its job model refuses fewer than 4 pages), so the job
// sent is 4 pages: the page-count check is reported but does not apply to a flat. The size,
// fonts, colour, layers and interactive checks read the file itself and do apply.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const [pdfPath, w, h, bleed] = process.argv.slice(2);
if (!pdfPath || !w || !h || bleed == null) {
  console.error('usage: node pps-gates.mjs FILE.pdf TRIM_W_IN TRIM_H_IN BLEED_IN');
  process.exit(2);
}
const PW = process.env.PPS_PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright';
const { chromium } = await import(PW + '/index.mjs');
const BASE = process.env.PPS_PROOF_BASE || 'http://127.0.0.1:8137';

const bytes = [...await readFile(pdfPath)];
const job = { calc: 'postcard', trim: { w: Number(w), h: Number(h) }, bleed: Number(bleed), safety: 0.125, pages: 4,
              insideColor: 'color', coverColor: 'color' };

const browser = await chromium.launch({ executablePath: process.env.PPS_CHROME || undefined, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e && e.message || e)));
page.on('dialog', async d => { await d.dismiss(); });
await page.route('**/*', route => {
  const u = route.request().url();
  if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
  return route.fulfill({ status: 204, body: '' });
});
await page.addInitScript(() => {
  window.__posts = [];
  window.PPS_PROOF_HOST = m => window.__posts.push(m);
  window.PPS_LIB_BASE = '/vendor/';
});
await page.goto(BASE + '/proof-ui-draft.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__posts.some(m => m.type === 'pps-proof:ready'), null, { timeout: 20000 });
await page.evaluate(({ job, bytes, name }) => {
  window.postMessage({ type: 'pps-proof:job', job,
                       files: [new File([new Uint8Array(bytes)], name, { type: 'application/pdf' })] },
                     window.location.origin);
}, { job, bytes, name: path.basename(pdfPath) });
await page.waitForFunction(() => uploads.size > 0, null, { timeout: 40000 });
const checks = await page.evaluate(() => runFileChecks());
const posts = await page.evaluate(() => window.__posts.map(m => m.type));
await browser.close();

let failed = 0;
console.log(`${path.basename(pdfPath)} as a ${w}" x ${h}" job with ${bleed}" bleed\n`);
for (const c of checks) {
  const applies = c.id !== 'pages';
  const ok = c.state === 'pass';
  if (applies && !ok) failed++;
  console.log(`${applies ? (ok ? 'PASS' : 'FAIL') : 'n/a '}  ${c.label}: ${c.state.toUpperCase()}\n      ${c.text}`);
}
if (posts.includes('pps-proof:error')) { failed++; console.log('FAIL  the proofer posted an error'); }
if (errors.length) { failed++; console.log('FAIL  page errors: ' + errors.join(' | ')); }
console.log(failed ? `\n>>> ${failed} check(s) did not pass` : '\n>>> PPS PROOFER ACCEPTS THE FILE');
process.exit(failed ? 1 : 0);

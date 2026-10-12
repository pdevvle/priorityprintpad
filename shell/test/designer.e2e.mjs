// End-to-end test of the simple-mode designer in headless Chromium.
//
// Serves a built site directory (the wasm.yml `designer-site-<sha>` artefact, or dist/designer)
// and drives the real page: add a heading and type into it, add a shape and drag it, colour it,
// add a photo and fill the side with it, colour the background, undo and redo, open IDML files
// (one that fits the order, one that doesn't, and an InDesign .indd), then print. Standalone, Print must download a
// PDF; embedded in a same-origin host page, it must speak the brief's §6 handshake (ready → job →
// price → print) and send a PDF, the design and thumbnails back.
//
// Run: node shell/test/designer.e2e.mjs SITE_DIR
//      (Playwright from PPS_PLAYWRIGHT, default /opt/node22/lib/node_modules/playwright)

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const site = process.argv[2];
if (!site) { console.error('usage: node designer.e2e.mjs SITE_DIR'); process.exit(2); }
const PW = process.env.PPS_PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright';
const { chromium } = await import(PW + '/index.mjs');
const HERE = path.dirname(new URL(import.meta.url).pathname);

// A host page standing in for a calculator: it embeds the designer, sends a 6 x 4 in job and a
// price, and records what comes back.
const HOST = `<!doctype html><meta charset="utf-8"><body>
<iframe id="f" src="designer.html?product=Postcard" style="width:1200px;height:800px;border:0"></iframe>
<script>
  window.got = [];
  addEventListener('message', ev => {
    if (ev.origin !== location.origin) return;
    const m = ev.data; window.got.push({ type: m.type, v: m.v, keys: Object.keys(m),
      pdfBytes: m.pdf ? m.pdf.byteLength : 0, pdfHead: m.pdf ? String.fromCharCode(...new Uint8Array(m.pdf.slice(0, 5))) : '',
      thumbs: m.thumbs ? m.thumbs.length : 0, design: typeof m.design === 'string' ? m.design.length : 0, manifest: m.manifest || null });
    const w = document.getElementById('f').contentWindow;
    if (m.type === 'pps-design:ready') {
      w.postMessage({ type: 'pps-design:job', v: 1, spec: { trimW: 432, trimH: 288, bleed: 9, safety: 9, pages: 2, pageMultiple: 2, folds: [], bindEdge: null, spine: 0 } }, location.origin);
      w.postMessage({ type: 'pps-design:price', v: 1, total: 89.5, qty: 500, turnaround: 'standard' }, location.origin);
      // A message with the wrong version must be ignored.
      w.postMessage({ type: 'pps-design:price', v: 99, total: 1 }, location.origin);
    }
  });
</script></body>`;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  if (rel === '__host.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(HOST); return; }
  const file = path.join(path.resolve(site), path.normalize(rel));
  if (!file.startsWith(path.resolve(site))) { res.writeHead(403); res.end(); return; }
  try { await stat(file); res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(await readFile(file)); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

// The page content streams of a PDF, inflated: dictionaries with no /Subtype (or a /Form), which
// leaves out images, fonts, ICC profiles and metadata.
function contentStreams(pdf) {
  const text = pdf.toString('latin1');
  const out = [];
  const re = /<<((?:[^<>]|<<(?:[^<>]|<<[^<>]*>>)*>>)*)>>\s*stream\r?\n/g;
  let m;
  while ((m = re.exec(text))) {
    const dict = m[1];
    if (/\/Subtype\s*\/(?!Form\b)/.test(dict) || /\/(Length1|Length2|N)\b/.test(dict) || /\/Type\s*\/Metadata/.test(dict)) continue;
    const start = m.index + m[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;
    const raw = pdf.subarray(start, end);
    let body;
    try { body = /FlateDecode/.test(dict) ? zlib.inflateSync(raw) : raw; }
    catch { continue; /* not a stream this check can read */ }
    // Page content is text operators; font programs and glyph maps are binary. Keep the former.
    let binary = 0;
    for (const c of body) if (c < 9 || (c > 13 && c < 32) || c > 126) binary++;
    if (binary > body.length * 0.02) continue;
    out.push(body.toString('latin1'));
  }
  return out;
}

let checks = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  checks++;
  if (!cond) failed++;
  console.log((cond ? 'PASS ' : 'FAIL ') + label + (detail ? '  ' + detail : ''));
};

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const errors = [];

// ── standalone ──
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e.message || e)));
  page.on('dialog', d => d.accept());
  await page.goto(BASE + 'designer.html?product=Postcard');
  await page.waitForFunction(() => !document.getElementById('app').classList.contains('loading'), null, { timeout: 120000 });
  ok('loads and shows the demo notice', await page.isVisible('#demo'));
  ok('opens a two-sided job', (await page.locator('#sides button').allTextContents()).join(',') === 'Front,Back');

  const canvas = page.locator('#canvas');
  const box = await canvas.boundingBox();
  // Points → page pixels, read from the page's own scale.
  const k = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('canvas')).width) / (648 + 18));
  const at = (x, y) => [box.x + (x + 9) * k, box.y + (y + 9) * k];

  ok('four things to add, Canva-style', (await page.locator('.railbtn').allTextContents()).map(t => t.trim()).join(',') === 'Text,Photos,Shapes,Background');
  ok('the main buttons explain themselves (tooltips)', (await page.locator('.railbtn[data-tip], #print[data-tip], #undo[data-tip]').count()) === 6);
  ok('an empty design says where to start', await page.isVisible('#emptyHint'));
  await page.click('[data-text="heading"]');
  ok('adding a heading selects it and opens the text toolbar', await page.isVisible('#ctxText'));
  ok('…and opens its words for typing, on the design', await page.isVisible('#textEditor'));
  await page.fill('#textInput', 'Grand opening Saturday');
  await page.click('#textDone');
  await page.waitForTimeout(300);
  ok('the start hint goes once something is added', !(await page.isVisible('#emptyHint')));
  const sizeBefore = Number(await page.textContent('#sizeOut'));
  await page.click('#sizeUp');
  await page.waitForTimeout(150);
  ok('the + button makes the text bigger', Number(await page.textContent('#sizeOut')) > sizeBefore);
  const story = await page.evaluate(() => [...document.querySelectorAll('#warnings div')].map(d => d.textContent));
  ok('typing updates the design without warnings', story.length === 0, JSON.stringify(story));

  await page.click('[data-cat="shapes"]');
  await page.click('[data-shape="square"]');
  ok('adding a square shows the colour button', await page.isVisible('#colourBtn'));
  await page.click('#colourBtn');
  await page.click('#swatches button[title="Red"]');
  ok('picking a colour closes the colour picker', !(await page.isVisible('#colourPop')));
  // Drag the box 100 pt right from its centre (the box sits in the middle of the card).
  const [cx, cy] = at(324, 216);
  await page.mouse.move(cx, cy); await page.mouse.down();
  await page.mouse.move(cx + 50 * k, cy, { steps: 4 }); await page.mouse.move(cx + 100 * k, cy, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  await page.click('#duplicate');
  await page.waitForTimeout(200);
  await page.click('#remove');
  await page.waitForTimeout(200);

  await page.click('[data-cat="photos"]');
  await page.setInputFiles('#photoPick', path.join(HERE, '..', '..', 'fixtures', 'p0', 'photo.jpg'));
  await page.waitForSelector('#ctxPhoto:not([hidden])', { timeout: 20000 });
  ok('adding a photo selects it and offers "Fill the side"', await page.isVisible('#fillSide'));
  ok('…and keeps it in Photos to add again', (await page.locator('#uploads button').count()) === 1);
  await page.click('#fillSide');
  await page.waitForTimeout(300);

  const undoEnabled = await page.isEnabled('#undo');
  ok('undo is available after changes', undoEnabled);
  await page.click('#undo'); await page.waitForTimeout(200);
  ok('redo is available after an undo', await page.isEnabled('#redo'));
  await page.click('#redo'); await page.waitForTimeout(200);

  await page.click('#sides button:nth-child(2)');
  await page.click('[data-cat="background"]');
  await page.click('#bgSwatches button[title="Yellow"]');
  await page.waitForTimeout(300);
  await page.click('#sides button:nth-child(1)');

  await page.click('#print');
  ok('Print opens the check list', await page.isVisible('#sheet'));
  const lines = await page.locator('#checks li').allTextContents();
  ok('the check list covers both sides', lines.some(l => l.startsWith('Front')) && lines.some(l => l.startsWith('Back')), JSON.stringify(lines));
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#sheetGo')]);
  const file = await dl.path();
  const pdf = await readFile(file);
  if (process.env.PPS_PDF) await (await import('node:fs/promises')).writeFile(process.env.PPS_PDF, pdf);
  ok('Print downloads a PDF', pdf.subarray(0, 5).toString() === '%PDF-', dl.suggestedFilename());
  ok('the PDF is PDF/X-4 with the placeholder output intent', pdf.includes('GTS_PDFX') && pdf.includes('DesignCraft Generic CMYK'));
  const strokes = contentStreams(pdf).join('\n').match(/(?:^|\s)(?:S|s|B\*?|b\*?)(?=\s|$)/g) || [];
  ok('no outlines nobody asked for (no stroke operators in the page content)', strokes.length === 0, strokes.length + ' found');
  ok('the PDF has both sides', (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length === 2);
  const mb = pdf.toString('latin1').match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  ok('pages are trim + 2 x bleed (666 x 450 pt)', mb && Math.round(+mb[1]) === 666 && Math.round(+mb[2]) === 450, mb ? mb[0] : 'no MediaBox');
  await page.screenshot({ path: process.env.PPS_SHOT || '/tmp/pps-designer.png' });
  await ctx.close();
}

// ── opening InDesign files ──
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e.message || e)));
  page.on('dialog', d => d.accept());
  await page.goto(BASE + 'designer.html');
  await page.waitForFunction(() => !document.getElementById('app').classList.contains('loading'), null, { timeout: 120000 });
  await page.click('[data-cat="photos"]');
  const toastText = async () => { await page.waitForSelector('#toast:not([hidden])', { timeout: 10000 }); const t = await page.textContent('#toast'); await page.evaluate(() => { document.getElementById('toast').hidden = true; }); return t; };

  const indd = Buffer.concat([Buffer.from([0x06, 0x06, 0xED, 0xF5, 0xD8, 0x1D, 0x46, 0xE5, 0xBD, 0x31, 0xEF, 0xE7, 0xFE, 0x74, 0xB7, 0x1D]), Buffer.alloc(4096)]);
  await page.setInputFiles('#filePick', { name: 'brochure.indd', mimeType: 'application/octet-stream', buffer: indd });
  const t1 = await toastText();
  ok('an InDesign .indd is recognised and explained (save as IDML)', /InDesign Markup \(IDML\)/.test(t1), t1.slice(0, 80));

  await page.setInputFiles('#filePick', path.join(HERE, 'fixtures', 'card-6x4.idml'));
  const t2 = await toastText();
  ok('an IDML of the wrong size is refused, with both sizes named', /6 × 4 in/.test(t2) && /9 × 6 in/.test(t2), t2.slice(0, 90));
  ok('…and the design that was open stays', await page.isVisible('#emptyHint'));

  await page.setInputFiles('#filePick', path.join(HERE, 'fixtures', 'card-9x6.idml'));
  const t3 = await toastText();
  ok('an IDML that fits the order opens', /^Opened card-9x6\.idml/.test(t3), t3.slice(0, 60));
  ok('…and its content is on the design', !(await page.isVisible('#emptyHint')));
  await ctx.close();
}

// ── embedded in a calculator (handshake, brief §6) ──
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e.message || e)));
  await page.goto(BASE + '__host.html');
  const frame = page.frameLocator('#f');
  await page.waitForFunction(() => window.got.some(m => m.type === 'pps-design:ready'), null, { timeout: 120000 });
  const ready = await page.evaluate(() => window.got.find(m => m.type === 'pps-design:ready'));
  ok('posts pps-design:ready with v: 1', ready && ready.v === 1);
  await frame.locator('#print:not([disabled])').waitFor({ timeout: 20000 });
  ok('the price chip shows what the host sent (display only)', (await frame.locator('#price').textContent()) === '$89.50 · 500 pcs');
  ok('the job sets the size (6 × 4 in)', (await frame.locator('#productSize').textContent()) === '6 × 4 in');
  ok('no demo notice when embedded', !(await frame.locator('#demo').isVisible()));
  await frame.locator('[data-text="heading"]').click();
  await frame.locator('#textDone').click();
  await frame.locator('#print').click();
  await frame.locator('#sheetGo').click();
  await page.waitForFunction(() => window.got.some(m => m.type === 'pps-design:print'), null, { timeout: 60000 });
  const p = await page.evaluate(() => window.got.find(m => m.type === 'pps-design:print'));
  ok('posts pps-design:print with a PDF', p.pdfHead === '%PDF-' && p.pdfBytes > 1000, p.pdfBytes + ' bytes');
  ok('…with the design and a thumbnail per side', p.design > 0 && p.thumbs === 2);
  ok('…and a manifest that flags the placeholder output intent', p.manifest && p.manifest.outputIntentPlaceholder === true && p.manifest.pages === 2);
  await frame.locator('#back').click();
  await page.waitForFunction(() => window.got.some(m => m.type === 'pps-design:close'), null, { timeout: 10000 });
  const c = await page.evaluate(() => window.got.find(m => m.type === 'pps-design:close'));
  ok('Back posts pps-design:close with the design', c.design > 0);
  ok('nothing else was posted', (await page.evaluate(() => window.got.map(m => m.type))).every(t => /^pps-design:(ready|print|close)$/.test(t)));
  await ctx.close();
}

ok('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
console.log(`\n${checks} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);

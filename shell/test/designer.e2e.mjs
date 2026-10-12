// End-to-end test of the simple-mode designer in headless Chromium.
//
// Serves a built site directory (the wasm.yml `designer-site-<sha>` artefact, or dist/designer)
// and drives the real page: add a heading and type into it, add a shape and drag it, colour it,
// add a photo and fill the side with it, colour the background, undo and redo, open IDML files
// (one that fits the order, one that doesn't, and an InDesign .indd), then print. Standalone, Print must download a
// PDF; embedded in a same-origin host page, it must speak the brief's §6 handshake (ready → job →
// price → print) and send a PDF, the design and thumbnails back.
//
// Then Order options (the calculator's size, orientation, sides and quantity, sliding out from the
// right: the design follows a new size and the print file is the new size) and Advanced Mode
// (tools, the Control bar's exact values, Layers, Swatches, Align, type, zoom), each checked
// in the exported PDF.
//
// Then what would spoil a print file, caught before it is made: characters the fonts can't draw,
// a phone photo stored sideways, something off the card, a hidden item, and a design reopened at
// another size.
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
    const m = ev.data;
    if (typeof m.design === 'string') window.lastDesign = m.design;
    // (No regex here: this script is inside a template literal.)
    const pdfText = m.pdf ? new TextDecoder('latin1').decode(new Uint8Array(m.pdf)) : '';
    const at = pdfText.indexOf('/MediaBox');
    const mb = at < 0 ? null : [0, pdfText.slice(pdfText.indexOf('[', at) + 1, pdfText.indexOf(']', at))];
    window.got.push({ type: m.type, v: m.v, keys: Object.keys(m), mediaBox: mb ? mb[1].trim().split(' ').filter(Boolean).map(Number) : null,
      pdfBytes: m.pdf ? m.pdf.byteLength : 0, pdfHead: m.pdf ? String.fromCharCode(...new Uint8Array(m.pdf.slice(0, 5))) : '',
      thumbs: m.thumbs ? m.thumbs.length : 0, design: typeof m.design === 'string' ? m.design.length : 0, manifest: m.manifest || null });
    const w = document.getElementById('f').contentWindow;
    const options = size => [
      { key: 'size', label: 'Size', type: 'select', value: size, choices: [{ value: '6x4', label: '6 × 4 in' }, { value: '7x5', label: '7 × 5 in', group: 'Bigger' }] },
      { key: 'qty', label: 'Quantity', type: 'number', value: 500, min: 25, max: 5000, step: 25 },
    ];
    if (m.type === 'pps-design:option') {
      window.optionsGot = (window.optionsGot || []).concat([[m.key, m.value]]);
      if (m.key === 'size' && m.value === '7x5') {
        w.postMessage({ type: 'pps-design:spec', v: 1, spec: { trimW: 504, trimH: 360, bleed: 9, safety: 9, pages: 2, pageMultiple: 2,
          folds: [{ page: 0, axis: 'v', at: 252 }, { page: 1, axis: 'v', at: 252 }], panelLabels: [['Back', 'Front'], ['Inside Front', 'Inside Back']],
          bindEdge: null, spine: 0 } }, location.origin);
        w.postMessage({ type: 'pps-design:options', v: 1, options: options('7x5') }, location.origin);
        w.postMessage({ type: 'pps-design:price', v: 1, total: 112.25, qty: 500, turnaround: 4 }, location.origin);
      }
    }
    if (m.type === 'pps-design:ready') {
      w.postMessage({ type: 'pps-design:job', v: 1, spec: { trimW: 432, trimH: 288, bleed: 9, safety: 9, pages: 2, pageMultiple: 2,
        folds: [{ page: 0, axis: 'v', at: 216 }, { page: 1, axis: 'v', at: 216 }], panelLabels: [['Back', 'Front'], ['Inside Front', 'Inside Back']],
        bindEdge: null, spine: 0 }, options: options('6x4') }, location.origin);
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

// Every Flate stream of a PDF inflated, plus the file itself: object streams hide font
// dictionaries from a plain search.
function inflatedText(pdf) {
  const text = pdf.toString('latin1');
  const parts = [text];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(text))) {
    const end = text.indexOf('endstream', m.index);
    if (end < 0) break;
    try { parts.push(zlib.inflateSync(pdf.subarray(m.index + m[0].length, end)).toString('latin1')); } catch { /* not Flate */ }
  }
  return parts.join('\n');
}

// The type sizes a PDF sets (its Tf operators), distinct and sorted.
const tfSizes = pdf => [...new Set((contentStreams(pdf).join('\n').match(/[\d.]+ Tf\b/g) || []).map(t => +parseFloat(t).toFixed(2)))].sort((a, b) => a - b);

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

// ── Order options (standalone: the page plays the calculator) ──
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e.message || e)));
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await page.goto(BASE + 'designer.html?product=Postcard');
  await page.waitForFunction(() => !document.getElementById('app').classList.contains('loading'), null, { timeout: 120000 });
  await page.click('[data-text="heading"]');
  await page.fill('#textInput', 'Spring sale');
  await page.click('#textDone');
  await page.click('[data-cat="background"]');
  await page.click('#bgSwatches button[title="Teal"]');
  await page.click('#sides button:nth-child(2)');
  await page.click('#bgSwatches button[title="Yellow"]');
  await page.click('#sides button:nth-child(1)');
  ok('Order options is a tab on the right', await page.isVisible('#orderTab'));
  await page.click('#orderTab');
  await page.waitForTimeout(300);
  ok('…that slides out size, orientation, sides, folding, perforation and quantity', (await page.locator('#orderFields label > span:first-child').allTextContents()).join(',') === 'Size,Orientation,Sides printed,Folding,Perforation,Quantity');
  await page.selectOption('#orderFields select[data-key="size"]', '6x4');
  await page.waitForTimeout(400);
  ok('a new size changes the design to it', (await page.textContent('#productSize')) === '6 × 4 in');
  ok('…and the heading is scaled to fit, inside the safe line', (await page.locator('#warnings div').count()) === 0, JSON.stringify(await page.locator('#warnings div').allTextContents()));
  await page.selectOption('#orderFields select[data-key="orientation"]', 'portrait');
  await page.waitForTimeout(400);
  ok('portrait turns the card upright', (await page.textContent('#productSize')) === '4 × 6 in');
  await page.selectOption('#orderFields select[data-key="sides"]', '1');
  await page.waitForTimeout(400);
  ok('going to one side asks first when the back has a design', dialogs.some(m => /Back has a design/.test(m)), JSON.stringify(dialogs));
  ok('…and then the back is gone', (await page.locator('#sides button').count()) === 0);
  await page.click('#orderClose');
  await page.click('#undo').catch(() => {});
  ok('undo cannot take the design back past an order change', !(await page.isEnabled('#undo')));

  // ── Advanced Mode, on the same 4 × 6 one-sided card ──
  await page.click('#modeAdv');
  await page.waitForTimeout(400);
  ok('Advanced shows tools, the Control bar and panels', await page.isVisible('#tools') && await page.isVisible('#control') && await page.isVisible('#panels'));
  ok('…and hides Simple\'s rail', !(await page.isVisible('.rail')));
  const k2 = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('canvas')).width) / (288 + 18));
  const box2 = await page.locator('#canvas').boundingBox();
  const at2 = (x, y) => [box2.x + (x + 9) * k2, box2.y + (y + 9) * k2];
  await page.click('.tool[data-tool="rect"]');
  let [a, b] = at2(36, 300), [c, d] = at2(180, 380);
  await page.mouse.move(a, b); await page.mouse.down(); await page.mouse.move(c, d, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(300);
  ok('the Rectangle tool draws a frame and selects it', await page.isVisible('#ctlObj') && (await page.locator('#layersList li[aria-selected="true"] .lname').textContent()) === 'Rectangle');
  await page.fill('#ctlW', '2'); await page.press('#ctlW', 'Enter');
  await page.fill('#ctlH', '1'); await page.press('#ctlH', 'Enter');
  await page.waitForTimeout(200);
  ok('W and H in the Control bar set the exact size', (await page.inputValue('#ctlW')) === '2' && (await page.inputValue('#ctlH')) === '1');
  await page.selectOption('#alignTo', 'trim');
  await page.click('[data-oalign="hcenter"]');
  await page.waitForTimeout(200);
  ok('Align centres it on the card (X = 1 in on a 4 in card)', (await page.inputValue('#ctlX')) === '1');
  await page.click('#fsFill');
  await page.click('#swatchList button:has-text("C=100 M=0 Y=0 K=0")');
  await page.fill('#ctlWeight', '3'); await page.press('#ctlWeight', 'Enter');
  await page.waitForTimeout(200);
  ok('a swatch fills it and the weight sets its stroke', (await page.inputValue('#ctlFill')) === 'C=100 M=0 Y=0 K=0' && (await page.inputValue('#ctlWeight')) === '3');
  await page.click('.tool[data-tool="text"]');
  [a, b] = at2(36, 120); [c, d] = at2(252, 170);
  await page.mouse.move(a, b); await page.mouse.down(); await page.mouse.move(c, d, { steps: 5 }); await page.mouse.up();
  await page.waitForSelector('#textEditor:not([hidden])');
  await page.fill('#textInput', 'Exact type');
  await page.click('#textDone');
  await page.selectOption('#ctlFont', 'Inter');
  await page.fill('#ctlSize', '30'); await page.press('#ctlSize', 'Enter');
  await page.waitForTimeout(200);
  ok('the Type tool draws a text frame; font and size come back from the engine', (await page.inputValue('#ctlFont')) === 'Inter' && (await page.inputValue('#ctlSize')) === '30');
  // A shape hidden in Layers does not print.
  await page.click('.tool[data-tool="ellipse"]');
  [a, b] = at2(150, 200); [c, d] = at2(250, 260);
  await page.mouse.move(a, b); await page.mouse.down(); await page.mouse.move(c, d, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(200);
  await page.click('#layersList li[aria-selected="true"] .lflag[aria-label^="Hide"]');
  await page.waitForTimeout(200);
  ok('the eye in Layers hides an object', (await page.locator('#layersList li.is-hidden').count()) === 1);
  const pct0 = parseInt(await page.textContent('#zoomPct'), 10);
  await page.click('#zoomIn');
  ok('zoom in makes the page bigger', parseInt(await page.textContent('#zoomPct'), 10) > pct0);
  await page.click('#zoomFit');

  await page.click('#print');
  const advLines = await page.locator('#checks li').allTextContents();
  ok('the print check says a hidden item won\'t print', advLines.some(l => /1 hidden item won't print/.test(l)), JSON.stringify(advLines));
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#sheetGo')]);
  const pdf = await readFile(await dl.path());
  if (process.env.PPS_PDF_ADV) await (await import('node:fs/promises')).writeFile(process.env.PPS_PDF_ADV, pdf);
  const txt = pdf.toString('latin1');
  const mb = txt.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  ok('the print file is the new size: 4 × 6 in plus bleed (306 x 450 pt), one page', mb && Math.round(+mb[1]) === 306 && Math.round(+mb[2]) === 450 && (txt.match(/\/Type\s*\/Page\b/g) || []).length === 1, mb ? mb[0] : 'no MediaBox');
  const streams = contentStreams(pdf).join('\n');
  ok('…with the drawn rectangle\'s 3 pt stroke in it', /(^|\s)3(\.0+)?\s+w\b/.test(streams) && /(?:^|\s)(?:S|B\*?)(?=\s|$)/.test(streams));
  ok('…and Inter embedded for the type set in the Control bar', /FontName\s*\/[A-Z]{6}\+Inter/.test(inflatedText(pdf)) || /\/BaseFont\s*\/(?:[A-Z]{6}\+)?Inter/.test(inflatedText(pdf)));
  ok('…and the hidden ellipse left out (one stroked shape only)', ((streams.match(/(?:^|\s)(?:S|B\*?)(?=\s|$)/g) || []).length) === 1, String((streams.match(/(?:^|\s)(?:S|B\*?)(?=\s|$)/g) || []).length));
  await page.screenshot({ path: process.env.PPS_SHOT_ADV || '/tmp/pps-designer-adv.png' });
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('app').classList.contains('loading'), null, { timeout: 120000 });
  ok('the chosen workspace is remembered', await page.isVisible('#tools'));
  await page.click('#modeSimple');
  ok('…and Simple brings the rail back', await page.isVisible('.rail'));
  // On a phone the workspace switch is hidden and the page stays Simple, even if Advanced was
  // chosen on a bigger screen.
  await page.click('#modeAdv');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('app').classList.contains('loading'), null, { timeout: 120000 });
  ok('on a phone the Simple/Advanced switch is hidden', !(await page.isVisible('.modeswitch')));
  ok('…and the designer stays Simple', !(await page.isVisible('#tools')) && await page.isVisible('.rail'));
  const tab = await page.locator('#orderTab').boundingBox();
  const rail = await page.locator('.rail').boundingBox();
  ok('…with the Order options tab above the rail', tab && rail && tab.y + tab.height <= rail.y, JSON.stringify({ tab, rail }));
  await ctx.close();
}

// ── folds and perforations: guides on the design, never in the print file ──
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e.message || e)));
  page.on('dialog', d => d.accept());
  await page.goto(BASE + 'designer.html?product=Brochure&w=11&h=8.5');
  await page.waitForFunction(() => !document.getElementById('app').classList.contains('loading'), null, { timeout: 120000 });
  await page.click('#orderTab');
  await page.selectOption('#orderFields select[data-key="fold"]', 'trifold');
  await page.selectOption('#orderFields select[data-key="perf"]', '1');
  await page.click('#orderClose');
  ok('a folded job is designed as Outside and Inside', (await page.locator('#sides button').allTextContents()).join(',') === 'Outside,Inside');
  ok('…with the fold and perforation in the legend', await page.isVisible('#legendFold') && await page.isVisible('#legendPerf'));
  await page.click('[data-text="heading"]');
  await page.fill('#textInput', 'A heading across the fold that is long');
  await page.click('#textDone');
  await page.waitForTimeout(300);
  const w = await page.locator('#warnings div').allTextContents();
  ok('words across a fold or a perforation are flagged', w.some(t => /fold/.test(t)) && w.some(t => /perforation/.test(t)), JSON.stringify(w));
  await page.click('#print');
  const lines = await page.locator('#checks li').allTextContents();
  ok('…and named in the print check, by side', lines.some(l => /^Outside: .*fold/.test(l)), JSON.stringify(lines));
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#sheetGo')]);
  const pdf = await readFile(await dl.path());
  const mb = pdf.toString('latin1').match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  ok('the print file is the flat sheet, 11 × 8.5 in plus bleed, two sides', mb && Math.round(+mb[1]) === 810 && Math.round(+mb[2]) === 630 && (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length === 2, mb ? mb[0] : '');
  const strokes = contentStreams(pdf).join('\n').match(/(?:^|\s)(?:S|s|B\*?|b\*?)(?=\s|$)/g) || [];
  ok('fold and perforation guides are not printed (no lines in the page content)', strokes.length === 0, strokes.length + ' found');
  await ctx.close();
}

// ── going to print: what would spoil the print file is caught before it is made ──
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e.message || e)));
  page.on('dialog', d => d.accept());
  await page.goto(BASE + 'designer.html?product=Postcard');
  await page.waitForFunction(() => !document.getElementById('app').classList.contains('loading'), null, { timeout: 120000 });
  // Characters the bundled fonts can't draw print as empty boxes.
  await page.click('[data-text="heading"]');
  await page.fill('#textInput', 'Party 🎉 日本');
  await page.click('#textDone');
  await page.waitForTimeout(300);
  const w1 = await page.locator('#warnings div').allTextContents();
  ok('an emoji or a letter the fonts lack is named before printing (it would print as a box)', w1.some(t => /empty boxes/.test(t) && t.includes('🎉') && t.includes('日')), JSON.stringify(w1));
  // A phone photo: stored sideways, with an EXIF note to turn it.
  await page.click('[data-cat="photos"]');
  await page.setInputFiles('#photoPick', path.join(HERE, 'fixtures', 'phone-exif6.jpg'));
  await page.waitForSelector('#ctxPhoto:not([hidden])', { timeout: 20000 });
  await page.click('#fillSide');
  await page.waitForTimeout(400);
  // Card points → the canvas's own pixels.
  const rgbAt = (x, y) => page.evaluate(([x, y]) => {
    const c = document.getElementById('canvas');
    const s = c.width / (648 + 18);
    return [...c.getContext('2d').getImageData(Math.round((x + 9) * s), Math.round((y + 9) * s), 1, 1).data].slice(0, 3);
  }, [x, y]);
  const tl = await rgbAt(60, 40), br = await rgbAt(590, 400);
  ok('a phone photo is placed upright, as the phone shows it (red top-left, blue bottom-right)', tl[0] > 170 && tl[1] < 90 && br[2] > 170 && br[0] < 90, JSON.stringify({ tl, br }));
  // Something pushed off the card doesn't print.
  await page.click('[data-cat="shapes"]');
  await page.click('[data-shape="square"]');
  for (let i = 0; i < 50; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(200);
  const w2 = await page.locator('#warnings div').allTextContents();
  ok('a shape moved off the card is flagged (it won\'t print)', w2.some(t => /off the edge of the card/.test(t)), JSON.stringify(w2));
  await page.click('#print');
  const stops = await page.locator('#checks li.stop').allTextContents();
  ok('the print check marks both as problems, not just warnings', stops.some(t => /empty boxes/.test(t)) && stops.some(t => /^Front: .*off the edge/.test(t)), JSON.stringify(stops));
  ok('…and the button says "Print anyway"', (await page.textContent('#sheetGo')) === 'Print anyway');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#sheetGo')]);
  const pdf = await readFile(await dl.path());
  const txt = pdf.toString('latin1');
  const imgs = [...txt.matchAll(/\/Subtype\s*\/Image/g)].map(m => txt.slice(Math.max(0, m.index - 300), m.index + 300));
  const dims = imgs.map(d => [(d.match(/\/Width\s+(\d+)/) || [])[1], (d.match(/\/Height\s+(\d+)/) || [])[1]].join('x'));
  ok('…and the photo in the PDF is upright: 300 x 200, not the stored 200 x 300', dims.includes('300x200') && !dims.includes('200x300'), JSON.stringify(dims));
  ok('…with the button back to its own words afterwards', !(await page.isVisible('#sheet')));
  await ctx.close();
}

// ── the second sweep (2026-10-12): what an adversarial tester did to the design ──
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e.message || e)));
  page.on('dialog', d => d.accept());
  const printPdf = async () => {
    await page.click('#print');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#sheetGo')]);
    return readFile(await dl.path());
  };
  const toastText = async () => { await page.waitForSelector('#toast:not([hidden])', { timeout: 10000 }); const t = await page.textContent('#toast'); await page.evaluate(() => { document.getElementById('toast').hidden = true; }); return t; };
  await page.goto(BASE + 'designer.html?product=Postcard');
  await page.waitForFunction(() => !document.getElementById('app').classList.contains('loading'), null, { timeout: 120000 });
  const canvasAt = async (x, y, wPt, hPt) => { const b = await page.locator('#canvas').boundingBox(); return [b.x + b.width * (x + 9) / (wPt + 18), b.y + b.height * (y + 9) / (hPt + 18)]; };

  // Trying Portrait and going back, three times, must give the design back as it was.
  await page.click('[data-text="heading"]');
  await page.fill('#textInput', 'Grand opening');
  await page.click('#textDone');
  await page.click('#orderTab');
  for (let i = 0; i < 3; i++) {
    await page.selectOption('#orderFields select[data-key="orientation"]', 'portrait'); await page.waitForTimeout(300);
    await page.selectOption('#orderFields select[data-key="orientation"]', 'landscape'); await page.waitForTimeout(300);
  }
  await page.click('#orderClose');
  let pdf = await printPdf();
  ok('portrait and back, three times, leaves the design as it was (heading still 54 pt)', tfSizes(pdf).includes(54), JSON.stringify(tfSizes(pdf)));

  // Words typed, then straight away another side: they are saved to the box they were typed in.
  const [hx, hy] = await canvasAt(324, 9 + 0.3 * 414, 648, 432);
  await page.mouse.click(hx, hy);
  await page.click('#editText');
  await page.fill('#textInput', 'Saved in time');
  await page.click('#sides button:nth-child(2)');
  await page.click('#sides button:nth-child(1)');
  await page.mouse.click(hx, hy);
  await page.click('#editText');
  ok('words typed just before switching sides are kept, in their own box', (await page.inputValue('#textInput')) === 'Saved in time', await page.inputValue('#textInput'));
  await page.click('#textDone');

  // Print with the editor closed must not write the last-edited words into another box.
  await page.click('[data-text="body"]');
  await page.fill('#textInput', 'Second box');
  await page.click('#textDone');
  await page.mouse.click(hx, hy);
  await page.click('#print');
  await page.click('#sheetCancel');
  await page.mouse.click(hx, hy);
  await page.click('#editText');
  ok('Print does not copy the last-edited words into the selected box', (await page.inputValue('#textInput')) === 'Saved in time', await page.inputValue('#textInput'));

  // A soft return pasted from Word or PowerPoint is a line break, not an empty box.
  await page.fill('#textInput', '');
  await page.keyboard.insertText('Spring sale\u000bSaturday only');
  await page.click('#textDone');
  await page.waitForTimeout(300);
  pdf = await printPdf();
  // Two lines of 54 pt type, and the story holds a line break (U+2028) where the \\v was.
  const lines54 = (contentStreams(pdf).join('\n').match(/\b54 Tf\b/g) || []).length;
  await page.mouse.click(hx, hy);
  await page.click('#editText');
  const stored = await page.inputValue('#textInput');
  await page.click('#textDone');
  ok('a pasted soft return (\\v) is stored and printed as a line break, not a missing-glyph box', stored === 'Spring sale\u2028Saturday only' && lines54 === 2, JSON.stringify(stored) + ' ' + lines54 + ' lines');
  ok('the text box takes at most 5,000 characters, as it shows', (await page.evaluate(() => document.getElementById('textInput').maxLength)) === 5000);

  // Words nudged half off the card are a problem, not a hint.
  await page.waitForTimeout(700);   // not a second tap (that opens the words for editing)
  await page.mouse.click(hx, hy);
  for (let i = 0; i < 40; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(200);
  await page.click('#print');
  const stops = await page.locator('#checks li.stop').allTextContents();
  ok('words run past the edge of the card are marked as a problem', stops.some(t => /run past the edge/.test(t)), JSON.stringify(stops));
  await page.click('#sheetCancel');
  await ctx.close();
}
{
  // An IDML file with a missing photo, a font this designer lacks, and three type sizes.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e.message || e)));
  page.on('dialog', d => d.accept());
  const printPdf = async () => {
    await page.click('#print');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#sheetGo')]);
    return readFile(await dl.path());
  };
  await page.goto(BASE + 'designer.html?product=Postcard');
  await page.waitForFunction(() => !document.getElementById('app').classList.contains('loading'), null, { timeout: 120000 });
  await page.setInputFiles('#filePick', path.join(HERE, 'fixtures', 'card-9x6-mixed.idml'));
  await page.waitForTimeout(800);
  await page.click('#print');
  const lines = await page.locator('#checks li').evaluateAll(ls => ls.map(l => l.className + ': ' + l.textContent));
  ok('a photo linked but not in the IDML is a problem in the print check, by name', lines.some(l => /^stop: .*isn't included \(logo\.jpg\)/.test(l)), JSON.stringify(lines));
  ok('…and a font the designer lacks is named', lines.some(l => /^warn: The font Arial/.test(l)), JSON.stringify(lines));
  await page.click('#sheetCancel');
  const b = await page.locator('#canvas').boundingBox();
  const hx = b.x + b.width * (324 + 9) / 666, hy = b.y + b.height * (190 + 9) / 450;
  await page.mouse.click(hx, hy);
  await page.click('#sizeUp');
  await page.waitForTimeout(300);
  let pdf = await printPdf();
  ok('+ scales every size in a mixed box together (24/36/18 → 26/39/19.5)', JSON.stringify(tfSizes(pdf)) === '[19.5,26,39]', JSON.stringify(tfSizes(pdf)));
  await page.click('#orderTab');
  await page.selectOption('#orderFields select[data-key="size"]', '6x4');
  await page.waitForTimeout(500);
  await page.click('#orderClose');
  pdf = await printPdf();
  ok('a size change keeps mixed sizes mixed (scaled by 2/3)', tfSizes(pdf).length === 3 && tfSizes(pdf)[2] === 26, JSON.stringify(tfSizes(pdf)));

  // A face set in Advanced survives Simple's + button; a locked item follows a size change.
  await page.click('#modeAdv');
  await page.waitForTimeout(300);
  const b2 = await page.locator('#canvas').boundingBox();
  const k2 = b2.width / (432 + 18);
  await page.mouse.click(b2.x + (216 + 9) * k2, b2.y + (126 + 9) * k2);
  await page.selectOption('#ctlFont', 'JetBrains Mono');
  await page.waitForTimeout(200);
  await page.click('#modeSimple');
  await page.waitForTimeout(300);
  await page.click('#sizeUp');
  await page.waitForTimeout(300);
  pdf = await printPdf();
  ok('Simple\'s + leaves a face set in Advanced alone (JetBrains Mono stays)', /JetBrainsMono/.test(inflatedText(pdf)), (inflatedText(pdf).match(/FontName\s*\/[A-Z]{6}\+[\w-]+/g) || []).join(','));
  await ctx.close();
}
{
  // A phone: the page doesn't scroll sideways into the closed Order options panel.
  const iphone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };
  const ctx = await browser.newContext(iphone);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e.message || e)));
  await page.goto(BASE + 'designer.html?product=Postcard');
  await page.waitForFunction(() => !document.getElementById('app').classList.contains('loading'), null, { timeout: 120000 });
  const w = await page.evaluate(() => [document.scrollingElement.scrollWidth, window.innerWidth]);
  ok('on a phone the page is no wider than the screen', w[0] <= w[1], JSON.stringify(w));
  await ctx.close();
}
{
  // A poster zoomed in: drawn (softer), never "could not be drawn".
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e.message || e)));
  const logged = []; page.on('console', m => { if (m.type() === 'error') logged.push(m.text()); });
  await page.goto(BASE + 'designer.html?product=Poster&w=24&h=36&pages=1');
  await page.waitForFunction(() => !document.getElementById('app').classList.contains('loading'), null, { timeout: 120000 });
  await page.click('#modeAdv');
  for (let i = 0; i < 4; i++) { await page.click('#zoomIn'); await page.waitForTimeout(250); }
  const toastShown = await page.isVisible('#toast');
  ok('a 24 × 36 in poster zoomed in is still drawn', !toastShown && !logged.some(t => /render|preview/i.test(t)), (await page.textContent('#toast')) + ' ' + logged.join(' | ').slice(0, 200));
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
  ok('the job\'s folds make it Outside and Inside', (await frame.locator('#sides button').allTextContents()).join(',') === 'Outside,Inside');
  ok('no demo notice when embedded', !(await frame.locator('#demo').isVisible()));
  await frame.locator('[data-text="heading"]').click();
  await frame.locator('#textDone').click();
  ok('the host\'s order options show as a tab', await frame.locator('#orderTab').isVisible());
  await frame.locator('#orderTab').click();
  ok('…which slides out the options the host sent', (await frame.locator('#orderFields label > span:first-child').allTextContents()).join(',') === 'Size,Quantity');
  await frame.locator('#orderFields select').selectOption('7x5');
  await page.waitForFunction(() => (window.optionsGot || []).some(([k, v]) => k === 'size' && v === '7x5'), null, { timeout: 10000 });
  await frame.locator('#productSize', { hasText: '7 × 5 in' }).waitFor({ timeout: 10000 });
  ok('a size change goes to the host, and the host\'s new spec resizes the design', (await frame.locator('#productSize').textContent()) === '7 × 5 in');
  ok('…and the panel shows the host\'s new price', /\$112\.25/.test(await frame.locator('#orderPrice').textContent()) && (await frame.locator('#price').textContent()) === '$112.25 · 500 pcs');
  await frame.locator('#orderClose').click();
  await frame.locator('#print').click();
  await frame.locator('#sheetGo').click();
  await page.waitForFunction(() => window.got.some(m => m.type === 'pps-design:print'), null, { timeout: 60000 });
  const p = await page.evaluate(() => window.got.find(m => m.type === 'pps-design:print'));
  ok('posts pps-design:print with a PDF', p.pdfHead === '%PDF-' && p.pdfBytes > 1000, p.pdfBytes + ' bytes');
  ok('…with the design and a thumbnail per side', p.design > 0 && p.thumbs === 2);
  ok('…and a manifest that flags the placeholder output intent', p.manifest && p.manifest.outputIntentPlaceholder === true && p.manifest.pages === 2);
  ok('…with the host\'s latest folds in the manifest', p.manifest && Array.isArray(p.manifest.folds) && p.manifest.folds.length === 2 && p.manifest.folds[0].at === 252, JSON.stringify(p.manifest && p.manifest.folds));
  ok('…at the size the host asked for last (7 × 5 in)', p.manifest && p.manifest.trimPt && p.manifest.trimPt[0] === 504 && p.manifest.trimPt[1] === 360, JSON.stringify(p.manifest && p.manifest.trimPt));
  await frame.locator('#back').click();
  await page.waitForFunction(() => window.got.some(m => m.type === 'pps-design:close'), null, { timeout: 10000 });
  const c = await page.evaluate(() => window.got.find(m => m.type === 'pps-design:close'));
  ok('Back posts pps-design:close with the design', c.design > 0);

  // The calculator reopens the design (its "Edit design"). Simple's text toolbar reads the type
  // from the design, not a guess.
  const spec75 = { trimW: 504, trimH: 360, bleed: 9, safety: 9, pages: 2, pageMultiple: 2, folds: [], bindEdge: null, spine: 0 };
  const spec64 = { ...spec75, trimW: 432, trimH: 288 };
  const reopen = spec => page.evaluate(spec => document.getElementById('f').contentWindow.postMessage({ type: 'pps-design:job', v: 1, spec, design: window.lastDesign }, location.origin), spec);
  // The heading sits centred, 30% of the way down the safe area.
  const clickHeading = async (wPt, hPt) => {
    const b = await frame.locator('#canvas').boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height * (18 + (hPt - 18) * 0.3) / (hPt + 18));
  };
  await clickHeading(504, 360);
  const sizeBefore = await frame.locator('#sizeOut').textContent();
  await reopen(spec75);
  await page.waitForTimeout(500);
  await clickHeading(504, 360);
  ok('a reopened design shows its real type size in the text toolbar', (await frame.locator('#sizeOut').textContent()) === sizeBefore && sizeBefore !== '24', sizeBefore + ' → ' + await frame.locator('#sizeOut').textContent());
  // Reopened for an order that has since changed size, it is resized to the order, never printed
  // at its own.
  await reopen(spec64);
  await frame.locator('#productSize', { hasText: '6 × 4 in' }).waitFor({ timeout: 10000 });
  await frame.locator('#print').click();
  await frame.locator('#sheetGo').click();
  await page.waitForFunction(() => window.got.filter(m => m.type === 'pps-design:print').length === 2, null, { timeout: 60000 });
  const p2 = await page.evaluate(() => window.got.filter(m => m.type === 'pps-design:print')[1]);
  // Reopened for one side: the back's design is left out, and the customer is told.
  await frame.locator('#sides button:nth-child(2)').click();
  await frame.locator('[data-text="heading"]').click();
  await frame.locator('#textDone').click();
  await frame.locator('#back').click();
  await page.waitForFunction(() => window.got.filter(m => m.type === 'pps-design:close').length === 2, null, { timeout: 10000 });
  await page.evaluate(spec => document.getElementById('f').contentWindow.postMessage({ type: 'pps-design:job', v: 1, spec: { ...spec, pages: 1, pageMultiple: 1 }, design: window.lastDesign }, location.origin), spec64);
  await frame.locator('#toast:not([hidden])').waitFor({ timeout: 10000 });
  ok('reopened for fewer sides, the customer is told the rest of the design was left out', /left out/.test(await frame.locator('#toast').textContent()), await frame.locator('#toast').textContent());
  // A saved design that can't be read is said so, not silently replaced by a blank card.
  await page.evaluate(spec => document.getElementById('f').contentWindow.postMessage({ type: 'pps-design:job', v: 1, spec, design: 'bm90IGEgZGVzaWdu' }, location.origin), spec64);
  await frame.locator('#toast', { hasText: "couldn't be reopened" }).waitFor({ timeout: 10000 });
  ok('a saved design that can\'t be reopened is said so', true);
  // A size in inches sent as points (6 × 4 "pt") is refused, not printed as a 0.08 in card.
  await page.evaluate(() => document.getElementById('f').contentWindow.postMessage({ type: 'pps-design:job', v: 1, spec: { trimW: 6, trimH: 4, bleed: 9, safety: 9, pages: 1 } }, location.origin));
  await page.waitForFunction(() => window.got.some(m => m.type === 'pps-design:error'), null, { timeout: 10000 }).catch(() => {});
  ok('a job under half an inch (inches sent as points) is refused with an error', await page.evaluate(() => window.got.some(m => m.type === 'pps-design:error')));
  ok('a design reopened at a new order size prints at that size (450 x 306 pt)', p2.mediaBox && Math.round(p2.mediaBox[2]) === 450 && Math.round(p2.mediaBox[3]) === 306 && p2.manifest.trimPt[0] === 432, JSON.stringify(p2.mediaBox));
  ok('nothing else was posted', (await page.evaluate(() => window.got.map(m => m.type))).every(t => /^pps-design:(ready|option|print|close|error)$/.test(t)));
  await ctx.close();
}

ok('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.close();
console.log(`\n${checks} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);

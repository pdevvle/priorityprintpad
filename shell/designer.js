// PPS Designer, simple mode: the editor customers see.
//
// One page, plain JS, no framework, laid out the way people know from Canva: a rail of four
// things to add (Text, Photos, Shapes, Background), a drawer for the one that's open, a toolbar
// above the design for whatever is selected, and the design itself. Everything the customer does
// is an engine command through the bridge (crates/pps-bridge), so undo, the preview and the print
// file all come from the same document. The calculator that opens this page owns the product spec,
// the price and the cart; this page only designs and hands back a print file (brief §6, CLAUDE.md).
//
// Units: the engine works in points (72 per inch) with the trim's top-left corner at 0,0.
// The canvas shows the page plus its bleed.

import init, { Designer } from './pps_bridge.js';

const PROTOCOL = 1;
const OUTPUT_INTENT = 'DesignCraft Generic CMYK (SWOP-like)';
const LOW_PPI = 150;
const INDD_UNSUPPORTED = 'indd-unsupported';

// Print colours: CMYK for the press, an sRGB stand-in for the button.
const COLOURS = [
  { name: 'Black', cmyk: [0, 0, 0, 100], css: '#231f20', swatch: '[Black]' },
  { name: 'White', cmyk: [0, 0, 0, 0], css: '#ffffff', swatch: '[Paper]' },
  { name: 'Grey', cmyk: [0, 0, 0, 50], css: '#939598' },
  { name: 'Red', cmyk: [0, 95, 85, 0], css: '#e5252f' },
  { name: 'Orange', cmyk: [0, 60, 100, 0], css: '#f7941d' },
  { name: 'Yellow', cmyk: [0, 10, 95, 0], css: '#ffe014' },
  { name: 'Green', cmyk: [75, 0, 100, 0], css: '#39b54a' },
  { name: 'Teal', cmyk: [80, 10, 45, 0], css: '#00a79d' },
  { name: 'Blue', cmyk: [100, 60, 0, 0], css: '#0067b1' },
  { name: 'Navy', cmyk: [100, 85, 20, 30], css: '#1b3664' },
  { name: 'Purple', cmyk: [65, 90, 0, 0], css: '#6e3a96' },
  { name: 'Pink', cmyk: [0, 70, 10, 0], css: '#ee6fa4' },
];
const FONTS = {
  clean: { family: 'Source Sans 3', regular: 'Regular', bold: 'Bold' },
  classic: { family: 'Source Serif 4', regular: 'Regular', bold: 'Bold' },
  modern: { family: 'Inter', regular: 'Regular', bold: 'SemiBold' },
};
const ALIGNS = ['left', 'center', 'right'];
const ALIGN_ICON = { left: 'M4 6h16M4 12h10M4 18h16', center: 'M4 6h16M7 12h10M4 18h16', right: 'M4 6h16M10 12h10M4 18h16' };

const $ = id => document.getElementById(id);
const el = {
  app: $('app'), canvas: $('canvas'), stage: $('stage'), sides: $('sides'), warnings: $('warnings'),
  undo: $('undo'), redo: $('redo'), print: $('print'), back: $('back'), price: $('price'), demo: $('demo'),
  productName: $('productName'), productSize: $('productSize'), photoPick: $('photoPick'), filePick: $('filePick'),
  drawer: $('drawer'), uploads: $('uploads'), swatches: $('swatches'), bgSwatches: $('bgSwatches'),
  ctxHint: $('ctxHint'), ctxText: $('ctxText'), ctxColour: $('ctxColour'), ctxPhoto: $('ctxPhoto'), ctxCommon: $('ctxCommon'),
  colourPop: $('colourPop'), colourDot: $('colourDot'), fontPick: $('fontPick'), boldBtn: $('boldBtn'),
  sizeOut: $('sizeOut'), alignIcon: $('alignIcon'), textEditor: $('textEditor'), textInput: $('textInput'),
  emptyHint: $('emptyHint'), sheet: $('sheet'), checks: $('checks'), loader: $('loader'), loadMsg: $('loadMsg'),
  loadBar: $('loadBar'), toast: $('toast'),
};

const S = {
  d: null,               // the bridge
  embedded: window.parent !== window,
  spec: null,            // {w, h, bleed, safety, pages} in points
  page: 0,
  items: [],             // current page's items from document.inspect, back to front
  stories: new Map(),    // story id → {overset}
  sel: null,             // selected item id
  k: 1, dpr: 1,          // CSS px per point; device pixel ratio
  pageCanvas: document.createElement('canvas'),
  canUndo: false, canRedo: false,
  style: new Map(),      // text frame id → {font, bold, size, align, colour}
  colour: new Map(),     // shape id → colour name, for the toolbar's dot
  imagePx: new Map(),    // image frame id → [width, height] in pixels, when placed here
  uploads: [],           // photos uploaded this session: {name, bytes, dims, url}
  swatchNames: new Map(),
  drag: null,
  dirty: false,
  replaceInto: null,
  cat: 'text',           // the open drawer
};

// ── the bridge ────────────────────────────────────────────────

function run(command, params = {}) {
  const out = S.d.execute(command, JSON.stringify(params));
  return out ? JSON.parse(out) : null;
}

function tryRun(command, params, failMsg) {
  try { return run(command, params); }
  catch (e) { toast(failMsg || 'Something went wrong. Please try again.'); console.error(command, e); return undefined; }
}

function changed() {
  S.dirty = true;
  S.canRedo = false;
  refresh();
}

// ── loading ───────────────────────────────────────────────────

// The engine ships gzip-compressed (pps_bridge_bg.wasm.gz, named in designer-manifest.json):
// 9 MB instead of 23, which fits the store's 12 MB pull-deploy cap and downloads quickly from a
// server that doesn't compress .wasm itself. The page unpacks it with DecompressionStream. If a
// server does decompress it on the way (Content-Encoding: gzip), the bytes already start with the
// wasm magic number and are used as they are. The one-file release (shell/bundle.mjs) carries its
// manifest inside the page, as #designer-manifest; the plain build fetches it.
async function loadEngine() {
  let file = 'pps_bridge_bg.wasm', total = 0;
  try {
    const inline = document.getElementById('designer-manifest');
    let man = null;
    if (inline) man = JSON.parse(inline.textContent);
    else {
      const m = await fetch('designer-manifest.json', { cache: 'no-store' });
      if (m.ok) man = await m.json();
    }
    if (man) {
      if (typeof man.wasm === 'string' && /^[\w.-]+$/.test(man.wasm)) file = man.wasm;
      total = man.wasmFileBytes || man.wasmBytes || 0;
    }
  } catch { /* the bar falls back to the byte count */ }
  const res = await fetch(file);
  if (!res.ok || !res.body) throw new Error('could not download the designer (' + res.status + ')');
  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    el.loadMsg.textContent = 'Getting the designer ready… ' + (got / 1048576).toFixed(1) + ' MB';
    if (total) el.loadBar.style.width = Math.min(100, (got / total) * 100).toFixed(1) + '%';
  }
  let bytes = new Uint8Array(got);
  let off = 0;
  for (const p of parts) { bytes.set(p, off); off += p.length; }
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream !== 'function') throw new Error('this browser is too old to open the designer');
    el.loadMsg.textContent = 'Unpacking…';
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  el.loadMsg.textContent = 'Almost there…';
  await init({ module_or_path: bytes });
  S.d = new Designer();
}

// ── the job (from the calculator, or a demo when opened on its own) ──

function validSpec(spec) {
  const n = v => typeof v === 'number' && Number.isFinite(v);
  if (!spec || typeof spec !== 'object') return 'no spec';
  if (!n(spec.trimW) || !n(spec.trimH) || spec.trimW <= 0 || spec.trimH <= 0 || spec.trimW > 5000 || spec.trimH > 5000) return 'trim size';
  if (spec.bleed != null && (!n(spec.bleed) || spec.bleed < 0 || spec.bleed > 72)) return 'bleed';
  if (spec.safety != null && (!n(spec.safety) || spec.safety < 0 || spec.safety > 144)) return 'safety';
  if (!Number.isInteger(spec.pages) || spec.pages < 1 || spec.pages > 64) return 'pages';
  if (spec.pageMultiple != null && (!Number.isInteger(spec.pageMultiple) || spec.pageMultiple < 1 || spec.pages % spec.pageMultiple)) return 'page multiple';
  return null;
}

function resetLocalState() {
  S.style.clear(); S.colour.clear(); S.imagePx.clear(); S.swatchNames.clear(); S.sel = null; S.page = 0;
}

function startJob(job) {
  const bad = validSpec(job && job.spec);
  if (bad) throw new Error('the job spec is not usable (' + bad + ')');
  const sp = job.spec;
  S.spec = { w: sp.trimW, h: sp.trimH, bleed: sp.bleed ?? 9, safety: sp.safety ?? 9, pages: sp.pages };
  resetLocalState();
  let opened = false;
  if (typeof job.design === 'string' && job.design) {
    try { S.d.openDesign(job.design); opened = true; }
    catch (e) { console.warn('saved design could not be reopened; starting fresh', e); }
  }
  if (!opened) {
    run('file.new', { width: S.spec.w, height: S.spec.h, pages: S.spec.pages, facingPages: false,
      bleed: S.spec.bleed, margins: S.spec.safety, title: el.productName.textContent });
  }
  const inches = v => +(v / 72).toFixed(3);
  el.productSize.textContent = inches(S.spec.w) + ' × ' + inches(S.spec.h) + ' in';
  buildSides();
  S.dirty = opened;
  el.print.disabled = false;
  layout();
}

function demoJob() {
  const q = new URLSearchParams(location.search);
  const num = (k, d) => { const v = parseFloat(q.get(k)); return Number.isFinite(v) && v > 0 ? v : d; };
  const w = num('w', 9), h = num('h', 6), pages = Math.round(num('pages', 2));
  if (q.get('product')) el.productName.textContent = q.get('product').slice(0, 60);
  return { spec: { trimW: w * 72, trimH: h * 72, bleed: 9, safety: 9, pages, pageMultiple: 1, folds: [], bindEdge: null, spine: 0 } };
}

// ── messages with the calculator (same origin only) ──────────

function post(type, payload = {}, transfer) {
  if (!S.embedded) return;
  window.parent.postMessage({ type, v: PROTOCOL, ...payload }, location.origin, transfer || []);
}

window.addEventListener('message', ev => {
  if (ev.origin !== location.origin || ev.source !== window.parent) return;
  const m = ev.data;
  if (!m || typeof m !== 'object' || m.v !== PROTOCOL || typeof m.type !== 'string') return;
  if (m.type === 'pps-design:job') {
    if (!S.d) return;
    try { startJob(m); }
    catch (e) { post('pps-design:error', { message: String(e.message || e) }); showFatal('This product can\'t be designed online yet.'); }
  } else if (m.type === 'pps-design:price') {
    // Display only. The calculator computes it; nothing here does.
    const t = m.total;
    if (typeof t === 'number' && Number.isFinite(t)) {
      el.price.textContent = '$' + t.toFixed(2) + (Number.isInteger(m.qty) ? ' · ' + m.qty.toLocaleString() + ' pcs' : '');
      el.price.hidden = false;
    } else el.price.hidden = true;
  }
});

// ── layout and drawing ───────────────────────────────────────

function sideName(i) {
  if (S.spec.pages === 1) return 'Your design';
  if (S.spec.pages === 2) return i === 0 ? 'Front' : 'Back';
  return 'Page ' + (i + 1);
}

function buildSides() {
  el.sides.textContent = '';
  if (S.spec.pages < 2) return;
  for (let i = 0; i < S.spec.pages; i++) {
    const b = document.createElement('button');
    b.type = 'button'; b.role = 'tab'; b.textContent = sideName(i);
    b.addEventListener('click', () => { S.page = i; select(null); refresh(); });
    el.sides.appendChild(b);
  }
}

function layout() {
  if (!S.spec) return;
  const W = S.spec.w + 2 * S.spec.bleed, H = S.spec.h + 2 * S.spec.bleed;
  const r = el.stage.getBoundingClientRect();
  const pad = 8;
  S.k = Math.max(0.05, Math.min((r.width - pad * 2) / W, (r.height - pad * 2) / H));
  S.dpr = Math.min(window.devicePixelRatio || 1, 3);
  const cw = Math.floor(W * S.k), ch = Math.floor(H * S.k);
  el.canvas.style.width = cw + 'px';
  el.canvas.style.height = ch + 'px';
  el.canvas.width = Math.round(cw * S.dpr);
  el.canvas.height = Math.round(ch * S.dpr);
  refresh();
}

let renderQueued = false;
function refresh() {
  if (!S.d || !S.spec) return;
  readDocument();
  if (!renderQueued) {
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; renderPage(); draw(); placeTextEditor(); });
  }
  updateChrome();
}

function readDocument() {
  const ins = run('document.inspect');
  S.canUndo = !!ins.canUndo;
  const sp = (ins.spreads || [])[S.page] || { items: [] };
  S.items = (sp.items || []).filter(it => !it.hidden);
  S.stories = new Map((ins.stories || []).map(s => [s.id, s]));
  for (const n of ins.swatches || []) if (!S.swatchNames.has(n)) S.swatchNames.set(n, n);
  if (S.sel != null && !S.items.some(it => it.id === S.sel)) S.sel = null;
}

function renderPage() {
  const scale = Math.min(6, Math.max(0.05, S.k * S.dpr));
  let p;
  try { p = S.d.renderPage(S.page, scale, true); }
  catch (e) { console.error(e); toast('The preview could not be drawn.'); return; }
  const c = S.pageCanvas;
  c.width = p.width; c.height = p.height;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(p.rgba), p.width, p.height), 0, 0);
  p.free();
}

// Page points → canvas CSS pixels.
const px = v => (v + S.spec.bleed) * S.k;
const pt = v => v / S.k - S.spec.bleed;

function itemRect(it) {
  const [x0, y0, x1, y1] = it.bounds;
  return { x: px(x0), y: px(y0), w: (x1 - x0) * S.k, h: (y1 - y0) * S.k };
}

function draw() {
  const ctx = el.canvas.getContext('2d');
  const cw = el.canvas.width / S.dpr, ch = el.canvas.height / S.dpr;
  ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(S.pageCanvas, 0, 0, cw, ch);

  const { w, h, safety } = S.spec;
  // Wash the part that gets cut off, so it reads as "not on the card".
  ctx.fillStyle = 'rgba(255,255,255,.45)';
  ctx.beginPath();
  ctx.rect(0, 0, cw, ch);
  ctx.rect(px(0), px(0), w * S.k, h * S.k);
  ctx.fill('evenodd');
  ctx.lineWidth = 1.5;
  ctx.setLineDash([2, 3]); ctx.strokeStyle = '#e04444'; ctx.strokeRect(1, 1, cw - 2, ch - 2);
  ctx.setLineDash([]); ctx.strokeStyle = '#222'; ctx.strokeRect(px(0), px(0), w * S.k, h * S.k);
  // The safe line on a white underlay, so it reads on any background colour (green on teal didn't).
  const safeRect = [px(safety), px(safety), (w - 2 * safety) * S.k, (h - 2 * safety) * S.k];
  ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeRect(...safeRect);
  ctx.lineWidth = 1.75; ctx.setLineDash([6, 4]); ctx.strokeStyle = '#13843f'; ctx.strokeRect(...safeRect);
  ctx.setLineDash([]); ctx.lineWidth = 1.5;

  for (const it of S.items) if (problemsOf(it).length) {
    const r = itemRect(it);
    ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
    ctx.strokeRect(r.x, r.y, r.w, r.h); ctx.setLineDash([]);
  }

  const sel = selected();
  if (!sel) return;
  let r = itemRect(sel);
  const d = S.drag;
  if (d && d.moved) {
    if (d.mode === 'move') {
      // A ghost of the item where it will land; the real move happens on release.
      ctx.globalAlpha = 0.85;
      ctx.drawImage(S.pageCanvas, r.x * S.dpr, r.y * S.dpr, r.w * S.dpr, r.h * S.dpr, r.x + d.dx * S.k, r.y + d.dy * S.k, r.w, r.h);
      ctx.globalAlpha = 1;
      r = { ...r, x: r.x + d.dx * S.k, y: r.y + d.dy * S.k };
      ctx.strokeStyle = '#d946ef'; ctx.lineWidth = 1;
      if (d.snapX) { ctx.beginPath(); ctx.moveTo(px(w / 2), 0); ctx.lineTo(px(w / 2), ch); ctx.stroke(); }
      if (d.snapY) { ctx.beginPath(); ctx.moveTo(0, px(h / 2)); ctx.lineTo(cw, px(h / 2)); ctx.stroke(); }
    } else {
      const b = d.to;
      r = { x: px(b[0]), y: px(b[1]), w: (b[2] - b[0]) * S.k, h: (b[3] - b[1]) * S.k };
    }
  }
  ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2;
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  if (!isBackground(sel)) {
    ctx.fillStyle = '#fff';
    for (const [hx, hy] of corners(r)) {
      ctx.beginPath(); ctx.arc(hx, hy, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }
}

function corners(r) {
  return [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]];
}

// ── what things are ──────────────────────────────────────────

const selected = () => S.items.find(it => it.id === S.sel) || null;
const isText = it => it && it.kind === '<text frame>';
const isImage = it => it && it.kind === '<image>';
const isShape = it => it && (it.kind === '<rectangle>' || it.kind === '<ellipse>' || it.kind === '<polygon>');

function isBackground(it) {
  if (!it || it.kind !== '<rectangle>') return false;
  const b = S.spec.bleed, [x0, y0, x1, y1] = it.bounds;
  const near = (a, c) => Math.abs(a - c) < 0.75;
  return near(x0, -b) && near(y0, -b) && near(x1, S.spec.w + b) && near(y1, S.spec.h + b);
}

function background() { return S.items.find(isBackground) || null; }

// Plain-language problems with one item, as the print check and the outlines see them.
function problemsOf(it) {
  const out = [];
  const { w, h, bleed, safety } = S.spec;
  const [x0, y0, x1, y1] = it.bounds;
  if (isText(it)) {
    if (x0 < safety - 0.5 || y0 < safety - 0.5 || x1 > w - safety + 0.5 || y1 > h - safety + 0.5)
      out.push('Some words are outside the green dashed line and could be cut off.');
    const st = S.stories.get(it.story);
    if (st && st.overset) out.push('Some words don\'t fit in their box. Make the box bigger or the words smaller.');
  } else if (!isBackground(it)) {
    const short = past => past < -0.5 && past > -bleed + 0.5;
    if (short(x0) || short(y0) || short(w - x1) || short(h - y1))
      out.push('A photo or shape goes past the cut line but stops before the red dotted line, which can leave a thin white edge. Stretch it to the red line, or keep it inside.');
  }
  if (isImage(it) && S.imagePx.has(it.id)) {
    const [pw, ph] = S.imagePx.get(it.id);
    const s = Math.max((x1 - x0) / pw, (y1 - y0) / ph);   // points per pixel when the photo fills its box
    const ppi = 72 / s;
    if (ppi < LOW_PPI) out.push('This photo is small for its size and may print blurry (' + Math.round(ppi) + ' pixels per inch; 150 or more looks sharp). Use a larger photo or make it smaller.');
  }
  return out;
}

// ── chrome ───────────────────────────────────────────────────

function updateChrome() {
  el.undo.disabled = !S.canUndo;
  el.redo.disabled = !S.canRedo;
  [...el.sides.children].forEach((b, i) => b.setAttribute('aria-selected', String(i === S.page)));
  const msgs = [...new Set(S.items.flatMap(problemsOf))];
  el.warnings.textContent = '';
  for (const m of msgs) { const d = document.createElement('div'); d.textContent = m; el.warnings.appendChild(d); }
  el.emptyHint.hidden = S.items.length > 0;
  updateContextBar();
}

function updateContextBar() {
  const it = selected();
  el.ctxHint.hidden = !!it;
  el.ctxText.hidden = !isText(it);
  el.ctxColour.hidden = !(isText(it) || isShape(it));
  el.ctxPhoto.hidden = !isImage(it);
  el.ctxCommon.hidden = !it || isBackground(it);
  if (!it) { closeColours(); closeTextEditor(); return; }
  if (!isText(it)) closeTextEditor();
  let colour;
  if (isText(it)) {
    const st = textStyle(it.id);
    el.fontPick.value = st.font;
    el.boldBtn.setAttribute('aria-pressed', String(st.bold));
    el.sizeOut.textContent = String(st.size);
    el.alignIcon.setAttribute('d', ALIGN_ICON[st.align] || ALIGN_ICON.center);
    colour = st.colour;
  } else {
    colour = S.colour.get(it.id);
  }
  const c = COLOURS.find(x => x.name === colour);
  el.colourDot.style.background = c ? c.css : 'conic-gradient(#e5252f, #ffe014, #39b54a, #0067b1, #6e3a96, #e5252f)';
  [...el.swatches.children].forEach(b => b.setAttribute('aria-pressed', String(b.title === colour)));
}

function buildSwatches() {
  for (const c of COLOURS) {
    const mk = () => {
      const b = document.createElement('button');
      b.type = 'button'; b.title = c.name; b.setAttribute('aria-label', c.name);
      b.style.background = c.css;
      return b;
    };
    const a = mk(); a.addEventListener('click', () => { applyColour(c); closeColours(); }); el.swatches.appendChild(a);
    const g = mk(); g.addEventListener('click', () => setBackground(c)); el.bgSwatches.appendChild(g);
  }
}

function textStyle(id) {
  if (!S.style.has(id)) S.style.set(id, { font: 'clean', bold: false, size: 24, align: 'center', colour: 'Black' });
  return S.style.get(id);
}

// ── the drawer (Text, Photos, Shapes, Background) ────────────

function openDrawer(cat, { toggle = false } = {}) {
  const small = matchMedia('(max-width: 860px)').matches;
  if (small && toggle && S.cat === cat && el.drawer.classList.contains('open')) { closeDrawer(); return; }
  S.cat = cat;
  document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== cat; });
  document.querySelectorAll('.railbtn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cat === cat)));
  el.drawer.classList.add('open');
}
function closeDrawer() {
  el.drawer.classList.remove('open');
  if (matchMedia('(max-width: 860px)').matches) document.querySelectorAll('.railbtn').forEach(b => b.setAttribute('aria-pressed', 'false'));
}
// On a phone the drawer covers the design, so it closes once something is added.
function afterAdd() { if (matchMedia('(max-width: 860px)').matches) closeDrawer(); }

document.querySelectorAll('.railbtn').forEach(b => b.addEventListener('click', () => openDrawer(b.dataset.cat, { toggle: true })));

// ── selecting, and the toolbar's actions ─────────────────────

function select(id) {
  S.sel = id;
  draw();
  updateChrome();
}

function swatchFor(c) {
  if (c.swatch) return c.swatch;
  const want = 'PPS ' + c.name;
  if (S.swatchNames.has(want)) return S.swatchNames.get(want);
  const [cc, m, y, k] = c.cmyk;
  const r = run('swatch.create', { name: want, color: { c: cc, m, y, k } });
  const name = (r && r.name) || want;
  S.swatchNames.set(want, name);
  return name;
}

const cmyk = c => ({ c: c.cmyk[0], m: c.cmyk[1], y: c.cmyk[2], k: c.cmyk[3] });

function applyColour(c) {
  const it = selected();
  if (!it) return;
  if (isText(it)) {
    try {
      run('selection.set', { ids: [it.id] });
      run('type.char', { attrs: { fill: swatchFor(c) } });
      textStyle(it.id).colour = c.name;
    } catch (e) { console.error(e); toast('That colour could not be applied.'); return; }
  } else {
    if (tryRun('object.color', { color: cmyk(c), ids: [it.id] }, 'That colour could not be applied.') === undefined) return;
    S.colour.set(it.id, c.name);
  }
  changed();
}

function applyTextStyle(patch) {
  const it = selected();
  if (!isText(it)) return;
  const st = Object.assign(textStyle(it.id), patch);
  const f = FONTS[st.font] || FONTS.clean;
  try {
    run('selection.set', { ids: [it.id] });
    run('type.char', { attrs: { fontFamily: f.family, fontStyle: st.bold ? f.bold : f.regular, size: st.size } });
    if ('align' in patch) run('type.para', { attrs: { align: st.align } });
    fitText(it.id);
  } catch (e) { console.error(e); toast('That style could not be applied.'); return; }
  changed();
}

// Text boxes fit their words, as in Canva: after the words or their size change, the box shrinks
// to its lines and then grows a line at a time until nothing is left over. (The engine stores an
// auto-size setting but does not apply it while composing, so this does.)
function fitText(id) {
  const find = () => {
    const ins = run('document.inspect');
    const it = (((ins.spreads || [])[S.page] || {}).items || []).find(x => x.id === id);
    const st = it && (ins.stories || []).find(x => x.id === it.story);
    return it && st ? { it, st } : null;
  };
  const lineH = textStyle(id).size * 1.2;
  let f = find();
  if (!f) return;
  const [x0, y0, x1, y1] = f.it.bounds;
  const need = Math.max(1, f.st.lines || 0) * lineH + lineH * 0.35;
  if (!f.st.overset && y1 - y0 - need > lineH * 0.5) {
    run('transform.resize', { from: f.it.bounds, to: [x0, y0, x1, y0 + need], content: false, ids: [id] });
    f = find();
  }
  for (let i = 0; f && f.st.overset && i < 40; i++) {
    const b = f.it.bounds;
    run('transform.resize', { from: b, to: [b[0], b[1], b[2], b[3] + lineH], content: false, ids: [id] });
    f = find();
  }
}

function nudgeSize(dir) {
  const it = selected();
  if (!isText(it)) return;
  const s = textStyle(it.id).size;
  const step = s < 20 ? 1 : s < 48 ? 2 : 4;
  applyTextStyle({ size: Math.max(6, Math.min(200, s + dir * step)) });
}

el.fontPick.addEventListener('change', () => applyTextStyle({ font: el.fontPick.value }));
el.boldBtn.addEventListener('click', () => applyTextStyle({ bold: el.boldBtn.getAttribute('aria-pressed') !== 'true' }));
$('sizeDown').addEventListener('click', () => nudgeSize(-1));
$('sizeUp').addEventListener('click', () => nudgeSize(1));
$('alignBtn').addEventListener('click', () => {
  const it = selected();
  if (!isText(it)) return;
  const cur = textStyle(it.id).align;
  applyTextStyle({ align: ALIGNS[(ALIGNS.indexOf(cur) + 1) % ALIGNS.length] });
});
$('colourBtn').addEventListener('click', e => { e.stopPropagation(); el.colourPop.hidden ? openColours() : closeColours(); });
function openColours() { el.colourPop.hidden = false; }
function closeColours() { el.colourPop.hidden = true; }
document.addEventListener('pointerdown', e => {
  if (!el.colourPop.hidden && !el.colourPop.contains(e.target) && e.target !== $('colourBtn') && !$('colourBtn').contains(e.target)) closeColours();
});

// ── editing words, in a box right on the design ──────────────

$('editText').addEventListener('click', openTextEditor);
$('textDone').addEventListener('click', () => { commitText(); closeTextEditor(); });

function openTextEditor() {
  const it = selected();
  if (!isText(it)) return;
  const s = tryRun('story.get', { story: it.story });
  el.textInput.value = s ? s.text || '' : '';
  el.textEditor.hidden = false;
  placeTextEditor();
  el.textInput.focus();
  el.textInput.select();
}
function closeTextEditor() { el.textEditor.hidden = true; }
function placeTextEditor() {
  if (el.textEditor.hidden) return;
  const it = selected();
  if (!isText(it)) { closeTextEditor(); return; }
  const r = itemRect(it);
  const c = el.canvas.getBoundingClientRect(), st = el.stage.getBoundingClientRect();
  const left = Math.max(0, Math.min(c.left - st.left + r.x, st.width - el.textEditor.offsetWidth));
  let top = c.top - st.top + r.y + r.h + 8;
  if (top + el.textEditor.offsetHeight > st.height) top = Math.max(0, c.top - st.top + r.y - el.textEditor.offsetHeight - 8);
  el.textEditor.style.left = left + 'px';
  el.textEditor.style.top = top + 'px';
}

let textTimer = 0;
function commitText() {
  clearTimeout(textTimer);
  const it = selected();
  if (!isText(it)) return;
  const text = el.textInput.value.slice(0, 2000);
  const cur = tryRun('story.get', { story: it.story });
  if (cur && cur.text === text) return;
  if (tryRun('story.setText', { story: it.story, text }) === undefined) return;
  tryRun('selection.set', { ids: [it.id] });
  try { fitText(it.id); } catch (e) { console.error(e); }
  changed();
}
el.textInput.addEventListener('input', () => { clearTimeout(textTimer); textTimer = setTimeout(commitText, 250); });
el.textInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') { commitText(); closeTextEditor(); }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { commitText(); closeTextEditor(); }
});

// ── layers, copies, delete, photos ───────────────────────────

$('remove').addEventListener('click', removeSelected);
$('toFront').addEventListener('click', () => arrange('front'));
$('toBack').addEventListener('click', () => arrange('back'));
$('duplicate').addEventListener('click', duplicate);
$('fillSide').addEventListener('click', fillSide);
$('replacePhoto').addEventListener('click', () => { S.replaceInto = S.sel; el.photoPick.click(); });

function removeSelected() {
  const it = selected();
  if (!it || isBackground(it)) return;
  if (tryRun('edit.clear', { ids: [it.id] }) === undefined) return;
  S.sel = null;
  changed();
}

function arrange(to) {
  const it = selected();
  if (!it) return;
  if (tryRun('object.arrange', { to, ids: [it.id] }) === undefined) return;
  const bg = background();
  // Nothing goes behind the background colour.
  if (to === 'back' && bg && bg.id !== it.id) tryRun('object.arrange', { to: 'back', ids: [bg.id] });
  changed();
}

function duplicate() {
  const it = selected();
  if (!it || isBackground(it)) return;
  const before = new Set(S.items.map(i => i.id));
  try {
    run('selection.set', { ids: [it.id] });
    run('edit.duplicate', {});
  } catch (e) { console.error(e); toast('That could not be copied.'); return; }
  readDocument();
  const copy = S.items.find(i => !before.has(i.id));
  if (copy) {
    // Offset the copy a little so it's visibly a second one.
    tryRun('transform.move', { dx: 12, dy: 12, ids: [copy.id] });
    if (S.style.has(it.id)) S.style.set(copy.id, { ...S.style.get(it.id) });
    if (S.colour.has(it.id)) S.colour.set(copy.id, S.colour.get(it.id));
    if (S.imagePx.has(it.id)) S.imagePx.set(copy.id, S.imagePx.get(it.id));
    S.sel = copy.id;
  }
  changed();
}

function bleedBox() {
  const b = S.spec.bleed;
  return [-b, -b, S.spec.w + b, S.spec.h + b];
}

function fillSide() {
  const it = selected();
  if (!isImage(it)) return;
  try {
    run('transform.resize', { from: it.bounds, to: bleedBox(), content: false, ids: [it.id] });
    run('object.fit', { mode: 'fillProportionally', ids: [it.id] });
    const bg = background();
    run('object.arrange', { to: 'back', ids: [it.id] });
    if (bg) run('object.arrange', { to: 'back', ids: [bg.id] });
  } catch (e) { console.error(e); toast('The photo could not be resized.'); return; }
  changed();
}

// ── adding things ────────────────────────────────────────────

function safeBox() {
  const s = S.spec.safety;
  return [s, s, S.spec.w - s, S.spec.h - s];
}

// Canva's three text sizes, scaled to the card.
const TEXT_KINDS = {
  heading: { text: 'Add a heading', size: m => m / 8, bold: true, at: 0.3 },
  subheading: { text: 'Add a subheading', size: m => m / 15, bold: true, at: 0.52 },
  body: { text: 'Add a little bit of body text', size: m => m / 26, bold: false, at: 0.72 },
};

document.querySelectorAll('[data-text]').forEach(b => b.addEventListener('click', () => addText(b.dataset.text)));
document.querySelectorAll('[data-shape]').forEach(b => b.addEventListener('click', () => addShape(b.dataset.shape)));

function addText(kind) {
  if (!S.spec) return;
  const t = TEXT_KINDS[kind] || TEXT_KINDS.body;
  const [sx0, sy0, sx1, sy1] = safeBox();
  const size = Math.max(8, Math.round(t.size(Math.min(S.spec.w, S.spec.h))));
  const fw = (sx1 - sx0) * 0.85, fh = size * 2.4;
  const cx = (sx0 + sx1) / 2;
  const cy = Math.min(sy1 - fh / 2, Math.max(sy0 + fh / 2, sy0 + (sy1 - sy0) * t.at));
  try {
    const r = run('frame.create', { spread: S.page, rect: [cx - fw / 2, cy - fh / 2, cx + fw / 2, cy + fh / 2], content: 'text', text: t.text });
    S.style.set(r.id, { font: 'clean', bold: t.bold, size, align: 'center', colour: 'Black' });
    run('selection.set', { ids: [r.id] });
    run('type.char', { attrs: { fontFamily: FONTS.clean.family, fontStyle: t.bold ? FONTS.clean.bold : FONTS.clean.regular, size, fill: '[Black]' } });
    run('type.para', { attrs: { align: 'center' } });
    fitText(r.id);
    S.sel = r.id;
    changed();
    afterAdd();
    openTextEditor();
  } catch (e) { console.error(e); toast('That could not be added. Please try again.'); }
}

function addShape(kind) {
  if (!S.spec) return;
  const [sx0, sy0, sx1, sy1] = safeBox();
  const cx = (sx0 + sx1) / 2, cy = (sy0 + sy1) / 2;
  const side = Math.min(sx1 - sx0, sy1 - sy0) * 0.4;
  let rect = [cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2];
  const params = { spread: S.page, content: 'unassigned' };
  if (kind === 'circle') params.shape = 'ellipse';
  else if (kind === 'triangle') { params.shape = 'polygon'; params.sides = 3; }
  else if (kind === 'line') { const lw = (sx1 - sx0) * 0.6, th = Math.max(1.5, side / 40); rect = [cx - lw / 2, cy - th / 2, cx + lw / 2, cy + th / 2]; }
  else params.shape = 'rectangle';
  const colour = COLOURS.find(x => x.name === (kind === 'line' ? 'Black' : 'Blue'));
  try {
    const r = run('frame.create', { ...params, rect });
    run('object.color', { color: cmyk(colour), ids: [r.id] });
    // New shapes come with a 1 pt black outline (a desktop-publishing default) that would print.
    run('object.stroke', { swatch: '[None]', ids: [r.id] });
    S.colour.set(r.id, colour.name);
    S.sel = r.id;
    changed();
    afterAdd();
  } catch (e) { console.error(e); toast('That could not be added. Please try again.'); }
}

function setBackground(c) {
  if (!S.spec) return;
  try {
    let bg = background();
    if (!bg) {
      const r = run('frame.create', { spread: S.page, rect: bleedBox(), content: 'unassigned' });
      run('object.stroke', { swatch: '[None]', ids: [r.id] });
      run('object.arrange', { to: 'back', ids: [r.id] });
      bg = { id: r.id };
    }
    run('object.color', { color: cmyk(c), ids: [bg.id] });
    S.colour.set(bg.id, c.name);
  } catch (e) { console.error(e); toast('The background could not be changed.'); return; }
  changed();
}

$('noBackground').addEventListener('click', () => {
  const bg = background();
  if (!bg) return;
  if (tryRun('edit.clear', { ids: [bg.id] }) !== undefined) { if (S.sel === bg.id) S.sel = null; changed(); }
});

// ── photos ───────────────────────────────────────────────────

$('upload').addEventListener('click', () => { S.replaceInto = null; el.photoPick.click(); });

el.photoPick.addEventListener('change', async () => {
  const file = el.photoPick.files && el.photoPick.files[0];
  el.photoPick.value = '';
  if (!file) return;
  let dims;
  try {
    const bmp = await createImageBitmap(file);
    dims = [bmp.width, bmp.height];
    bmp.close();
  } catch { toast('That file isn\'t a photo this designer can use. Try a JPEG or PNG.'); return; }
  const up = { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), dims, url: URL.createObjectURL(file) };
  S.uploads.push(up);
  addUploadThumb(up);
  placePhoto(up, S.replaceInto);
});

function addUploadThumb(up) {
  const b = document.createElement('button');
  b.type = 'button'; b.setAttribute('aria-label', 'Add ' + up.name); b.dataset.tip = 'Add this photo again';
  const img = document.createElement('img'); img.src = up.url; img.alt = '';
  b.appendChild(img);
  b.addEventListener('click', () => placePhoto(up, null));
  el.uploads.prepend(b);
}

function placePhoto(up, into) {
  try {
    let id = into;
    if (id == null || !S.items.some(it => it.id === id)) {
      const [sx0, sy0, sx1, sy1] = safeBox();
      const cx = (sx0 + sx1) / 2, cy = (sy0 + sy1) / 2;
      const k = Math.min(((sx1 - sx0) * 0.6) / up.dims[0], ((sy1 - sy0) * 0.6) / up.dims[1]);
      const fw = up.dims[0] * k, fh = up.dims[1] * k;
      id = run('frame.create', { spread: S.page, rect: [cx - fw / 2, cy - fh / 2, cx + fw / 2, cy + fh / 2], content: 'graphic' }).id;
    }
    JSON.parse(S.d.placeImage(up.bytes, up.name, id));
    run('object.fit', { mode: 'fillProportionally', ids: [id] });
    S.imagePx.set(id, up.dims);
    S.sel = id;
    S.replaceInto = null;
    changed();
    afterAdd();
  } catch (e) {
    console.error(e);
    toast('That photo could not be added. Try a smaller JPEG or PNG.');
  }
}

// ── opening an InDesign (IDML) file ──────────────────────────

$('openFile').addEventListener('click', () => el.filePick.click());
el.filePick.addEventListener('change', async () => {
  const file = el.filePick.files && el.filePick.files[0];
  el.filePick.value = '';
  if (!file) return;
  if (S.dirty && !confirm('Opening this file replaces your current design. Continue?')) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let opened;
  try {
    opened = JSON.parse(S.d.openFile(bytes, file.name));
  } catch (e) {
    const msg = String(e && e.message || e);
    if (msg.includes(INDD_UNSUPPORTED)) {
      toast('That\'s an InDesign .indd file, which only InDesign can open. In InDesign choose File › Save As › InDesign Markup (IDML), then open the .idml file here.', 12000);
    } else {
      console.error(e);
      toast('That file couldn\'t be opened. It needs to be an IDML file saved from InDesign.', 8000);
    }
    return;
  }
  // The calculator owns the size: a file built for a different size or page count is refused,
  // and the design that was open stays.
  const ins = run('document.inspect');
  const st = ins.settings || {};
  const fits = (a, b) => Math.abs(a - b) < 2;
  const sameSize = (fits(st.pageWidth, S.spec.w) && fits(st.pageHeight, S.spec.h));
  if (!sameSize || ins.pageCount !== S.spec.pages) {
    tryRun('file.close', { index: opened.index });
    const inch = v => +(v / 72).toFixed(2);
    toast('That file is ' + inch(st.pageWidth) + ' × ' + inch(st.pageHeight) + ' in with ' + ins.pageCount + ' page' + (ins.pageCount === 1 ? '' : 's') +
      ', but this order is ' + inch(S.spec.w) + ' × ' + inch(S.spec.h) + ' in with ' + S.spec.pages + '. Change the order to match, or open a file made for this size.', 12000);
    refresh();
    return;
  }
  resetLocalState();
  S.dirty = true;
  afterAdd();
  refresh();
  toast('Opened ' + file.name + '. Photos linked in the file may need uploading again.', 6000);
});

// ── tapping and dragging on the design ───────────────────────

function hit(x, y) {
  const p = [pt(x), pt(y)];
  for (let i = S.items.length - 1; i >= 0; i--) {
    const it = S.items[i];
    const [x0, y0, x1, y1] = it.bounds;
    if (p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1) return it;
  }
  return null;
}

function handleAt(x, y) {
  const it = selected();
  if (!it || isBackground(it)) return -1;
  const reach = 22;
  return corners(itemRect(it)).findIndex(([hx, hy]) => Math.hypot(hx - x, hy - y) <= reach);
}

el.canvas.addEventListener('pointerdown', e => {
  if (!S.spec) return;
  closeColours();
  const x = e.offsetX, y = e.offsetY;
  const h = handleAt(x, y);
  if (h >= 0) {
    const it = selected();
    S.drag = { mode: 'resize', corner: h, id: it.id, from: it.bounds.slice(), to: it.bounds.slice(), x, y, moved: false };
  } else {
    const it = hit(x, y);
    if (!it) { if (!el.textEditor.hidden) commitText(); select(null); return; }
    if (it.id !== S.sel) { if (!el.textEditor.hidden) commitText(); select(it.id); }
    S.drag = isBackground(it) ? null : { mode: 'move', id: it.id, from: it.bounds.slice(), x, y, dx: 0, dy: 0, moved: false };
  }
  if (S.drag) el.canvas.setPointerCapture(e.pointerId);
});

el.canvas.addEventListener('pointermove', e => {
  const d = S.drag;
  if (!d) return;
  const dxCss = e.offsetX - d.x, dyCss = e.offsetY - d.y;
  if (!d.moved && Math.hypot(dxCss, dyCss) < 4) return;
  d.moved = true;
  if (d.mode === 'move') {
    let dx = dxCss / S.k, dy = dyCss / S.k;
    // Snap the item's centre to the middle of the card.
    const [x0, y0, x1, y1] = d.from;
    const snap = 6 / S.k;
    const cx = (x0 + x1) / 2 + dx, cy = (y0 + y1) / 2 + dy;
    d.snapX = Math.abs(cx - S.spec.w / 2) < snap; if (d.snapX) dx += S.spec.w / 2 - cx;
    d.snapY = Math.abs(cy - S.spec.h / 2) < snap; if (d.snapY) dy += S.spec.h / 2 - cy;
    d.dx = dx; d.dy = dy;
  } else {
    const [x0, y0, x1, y1] = d.from;
    const nx = pt(e.offsetX), ny = pt(e.offsetY), min = 6;
    const left = d.corner === 0 || d.corner === 2, top = d.corner === 0 || d.corner === 1;
    d.to = [left ? Math.min(nx, x1 - min) : x0, top ? Math.min(ny, y1 - min) : y0,
            left ? x1 : Math.max(nx, x0 + min), top ? y1 : Math.max(ny, y0 + min)];
  }
  draw();
});

let lastTap = { id: null, t: 0 };
function endDrag() {
  const d = S.drag;
  S.drag = null;
  if (!d) return;
  if (!d.moved) {
    draw();
    // A second tap on selected text (or a double-click) opens its words for editing.
    const now = performance.now();
    if (isText(selected()) && lastTap.id === d.id && now - lastTap.t < 600) openTextEditor();
    lastTap = { id: d.id, t: now };
    return;
  }
  try {
    if (d.mode === 'move') {
      if (Math.abs(d.dx) < 0.25 && Math.abs(d.dy) < 0.25) { draw(); return; }
      run('transform.move', { dx: d.dx, dy: d.dy, ids: [d.id] });
    } else {
      run('transform.resize', { from: d.from, to: d.to, content: false, ids: [d.id] });
      const it = S.items.find(i => i.id === d.id);
      if (isImage(it)) run('object.fit', { mode: 'fillProportionally', ids: [d.id] });
    }
  } catch (e) { console.error(e); toast('That change could not be made.'); draw(); return; }
  changed();
}
el.canvas.addEventListener('pointerup', endDrag);
el.canvas.addEventListener('pointercancel', () => { S.drag = null; draw(); });
el.canvas.addEventListener('dblclick', () => { if (isText(selected())) openTextEditor(); });

// ── undo, keys, print, back ──────────────────────────────────

el.undo.addEventListener('click', undo);
el.redo.addEventListener('click', redo);
function undo() { closeTextEditor(); if (tryRun('edit.undo', {}) !== undefined) { S.dirty = true; S.canRedo = true; refresh(); } }
function redo() {
  closeTextEditor();
  try { run('edit.redo', {}); } catch { S.canRedo = false; updateChrome(); return; }
  S.dirty = true; refresh();
}

document.addEventListener('keydown', e => {
  const typing = /^(TEXTAREA|INPUT|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (typing) return;
  if (e.key === 'Escape') { closeColours(); select(null); return; }
  if (!S.sel) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); return; }
  if (e.key === 'Enter' && isText(selected())) { e.preventDefault(); openTextEditor(); return; }
  const step = e.shiftKey ? 9 : 1;
  const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  const it = selected();
  if (mv && it && !isBackground(it)) {
    e.preventDefault();
    if (tryRun('transform.move', { dx: mv[0], dy: mv[1], ids: [it.id] }) !== undefined) changed();
  }
});

el.print.addEventListener('click', () => { commitText(); closeTextEditor(); openChecks(); });
$('sheetCancel').addEventListener('click', () => { el.sheet.hidden = true; });
$('sheetGo').addEventListener('click', doPrint);

function allPages() {
  const ins = run('document.inspect');
  return (ins.spreads || []).map(sp => (sp.items || []).filter(it => !it.hidden));
}

function openChecks() {
  const pages = allPages();
  const keep = S.page;
  const lines = [];
  pages.forEach((items, i) => {
    S.page = i; S.items = items;
    const probs = [...new Set(items.flatMap(problemsOf))];
    if (!items.length) lines.push(['warn', sideName(i) + ' is blank. That\'s fine if you meant it to be.']);
    else if (probs.length) probs.forEach(p => lines.push(['warn', sideName(i) + ': ' + p]));
    else lines.push(['ok', sideName(i) + ' looks ready.']);
  });
  S.page = keep;
  readDocument();
  el.checks.textContent = '';
  for (const [cls, text] of lines) { const li = document.createElement('li'); li.className = cls; li.textContent = text; el.checks.appendChild(li); }
  el.sheet.hidden = false;
  $('sheetGo').focus();
}

function thumbs() {
  const out = [];
  for (let i = 0; i < S.spec.pages; i++) {
    const scale = Math.min(1, 300 / (S.spec.w + 2 * S.spec.bleed));
    const p = S.d.renderPage(i, scale, true);
    const c = document.createElement('canvas');
    c.width = p.width; c.height = p.height;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(p.rgba), p.width, p.height), 0, 0);
    p.free();
    out.push(c.toDataURL('image/jpeg', 0.8));
  }
  return out;
}

function doPrint() {
  const go = $('sheetGo');
  go.disabled = true; go.textContent = 'Preparing your print file…';
  setTimeout(() => {
    try {
      const pdf = S.d.exportPdf(JSON.stringify({ bleed: true, standard: 'x4' }));
      const design = S.d.saveDesign();
      const anyPhoto = allPages().flat().some(isImage);
      const manifest = {
        pages: S.spec.pages, trimPt: [S.spec.w, S.spec.h], bleedPt: S.spec.bleed,
        outputIntent: OUTPUT_INTENT, outputIntentPlaceholder: true, rgbImages: anyPhoto,
      };
      if (S.embedded) {
        const buf = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength);
        post('pps-design:print', { pdf: buf, design, thumbs: thumbs(), manifest }, [buf]);
        S.dirty = false;
      } else {
        const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
        const a = document.createElement('a');
        a.href = url; a.download = (el.productName.textContent || 'design').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-print.pdf';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        S.dirty = false;
        toast('Your print file has downloaded. In a real order it would go to the proof next.');
      }
      el.sheet.hidden = true;
    } catch (e) {
      console.error(e);
      toast('The print file could not be made. Please try again.');
    } finally {
      go.disabled = false; go.textContent = 'Looks good, continue';
    }
  }, 30);
}

el.back.addEventListener('click', () => {
  if (S.embedded) {
    let design = null;
    try { design = S.d && S.spec ? S.d.saveDesign() : null; } catch (e) { console.error(e); }
    post('pps-design:close', { design });
  } else if (!S.dirty || confirm('Leave the designer? Your design isn\'t saved.')) {
    history.length > 1 ? history.back() : (location.href = '../');
  }
});
window.addEventListener('beforeunload', e => { if (!S.embedded && S.dirty) { e.preventDefault(); e.returnValue = ''; } });

// ── small things ─────────────────────────────────────────────

let toastTimer = 0;
function toast(msg, ms = 4000) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
}

function showFatal(msg) {
  el.app.classList.add('loading');
  el.loader.querySelector('.spinner').hidden = true;
  el.loadMsg.textContent = msg;
  el.loadBar.parentElement.hidden = true;
}

new ResizeObserver(() => layout()).observe(el.stage);

// ── start ────────────────────────────────────────────────────

(async () => {
  buildSwatches();
  openDrawer('text');
  if (matchMedia('(max-width: 860px)').matches) closeDrawer();
  try {
    await loadEngine();
  } catch (e) {
    console.error(e);
    post('pps-design:error', { message: String(e.message || e) });
    showFatal('The designer couldn\'t load. Check your connection and try again.');
    return;
  }
  el.app.classList.remove('loading');
  if (S.embedded) {
    post('pps-design:ready');
  } else {
    el.demo.hidden = false;
    try { startJob(demoJob()); }
    catch (e) { console.error(e); showFatal('This size can\'t be designed online.'); }
  }
})();

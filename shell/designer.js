// PPS Designer: the editor customers see.
//
// One page, plain JS, no framework. Two workspaces over the same document:
//   Simple (the default), laid out the way people know from Canva: a rail of four things to add
//   (Text, Photos, Shapes, Background), a drawer for the one that's open, a toolbar above the
//   design for whatever is selected, and the design itself.
//   Advanced, laid out like InDesign's print workspace: tools on the left, a Control bar of exact
//   values (X, Y, W, H in inches, rotation, fill, stroke, opacity, type), and Pages, Layers,
//   Swatches and Align panels on the right, with zoom.
// Both have Order options: a tab on the right that slides out the order's size, sides and
// quantity, as the calculator offers them; a change goes back to the calculator, which re-prices
// and, for a new size or sides, sends the new spec, and the design follows. Everything the customer does
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

// The bundled typefaces (crates/fonts, OFL) and their styles, for the Control bar.
const FAMILIES = {
  'Source Sans 3': ['Regular', 'Italic', 'Semibold', 'Bold'],
  'Source Serif 4': ['Regular', 'Italic', 'Semibold', 'Bold', 'Bold Italic'],
  'Inter': ['Regular', 'Medium', 'SemiBold'],
  'JetBrains Mono': ['Regular'],
};
const MODE_KEY = 'pps-designer-mode';
const TOOL_KEYS = { v: 'select', t: 'text', m: 'rect', l: 'ellipse', '\\': 'line', f: 'image' };

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
  modeSimple: $('modeSimple'), modeAdv: $('modeAdv'), control: $('control'), ctlNone: $('ctlNone'), ctlObj: $('ctlObj'), ctlText: $('ctlText'),
  ctlX: $('ctlX'), ctlY: $('ctlY'), ctlW: $('ctlW'), ctlH: $('ctlH'), ctlRot: $('ctlRot'), ctlFill: $('ctlFill'), ctlStroke: $('ctlStroke'),
  ctlFillChip: $('ctlFillChip'), ctlStrokeChip: $('ctlStrokeChip'), ctlWeight: $('ctlWeight'), ctlOpacity: $('ctlOpacity'),
  ctlFont: $('ctlFont'), ctlStyle: $('ctlStyle'), ctlSize: $('ctlSize'), ctlLeading: $('ctlLeading'), ctlTracking: $('ctlTracking'),
  pagesList: $('pagesList'), layersList: $('layersList'), swatchList: $('swatchList'), swatchNew: $('swatchNew'), alignTo: $('alignTo'),
  fsFill: $('fsFill'), fsStroke: $('fsStroke'), zoomPct: $('zoomPct'),
  orderTab: $('orderTab'), orderPanel: $('orderPanel'), orderPrice: $('orderPrice'), orderFields: $('orderFields'),
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
  mode: 'simple',        // 'simple' | 'adv'
  tool: 'select',        // Advanced tools: select | text | rect | ellipse | line | image
  zoom: 1,               // Advanced zoom, relative to fitting the page in the window
  fsTarget: 'fill',      // Swatches panel: fill or stroke
  allItems: [],          // current page's items including hidden ones (Layers panel)
  swatches: [],          // the document's swatch names
  opacity: new Map(),    // item id → opacity %, when set here
  options: [],           // Order options from the calculator: [{key, label, type, value, choices?, min?, max?, step?, help?}]
  lastOption: null,      // {key, prev}: the change waiting on the calculator, to put back if refused
  price: null,           // the last price the calculator sent (display only)
  undoFloor: 0,          // undo history length when the order's size last changed: undo stops there
  undoDepth: 0,
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
  for (const k of ['folds', 'perfs']) {
    const list = spec[k];
    if (list == null) continue;
    if (!Array.isArray(list) || list.length > 16) return k;
    for (const g of list) {
      if (!g || (g.axis !== 'v' && g.axis !== 'h') || !n(g.at) || !Number.isInteger(g.page) || g.page < 0 || g.page >= spec.pages) return k;
      if (g.at <= 0 || g.at >= (g.axis === 'v' ? spec.trimW : spec.trimH)) return k;
    }
  }
  if (spec.panelLabels != null && (!Array.isArray(spec.panelLabels) || spec.panelLabels.length > spec.pages)) return 'panel labels';
  return null;
}

// The order's fold and perforation lines, and the names of the panels between the folds: guides
// on the design that never print (the press folds and perforates; the calculator places them).
// Lines are {page, axis: 'v' (at x) | 'h' (at y), at} in points from the trim's top-left.
function specGuides(sp) {
  const lines = k => (Array.isArray(sp[k]) ? sp[k] : []).map(g => ({ page: g.page, axis: g.axis, at: g.at }));
  const labels = Array.isArray(sp.panelLabels)
    ? sp.panelLabels.map(l => (Array.isArray(l) ? l.slice(0, 8).map(t => String(t).slice(0, 30)) : []))
    : [];
  return { folds: lines('folds'), perfs: lines('perfs'), panelLabels: labels };
}
const sameGuides = (a, b) => JSON.stringify([a.folds, a.perfs, a.panelLabels]) === JSON.stringify([b.folds, b.perfs, b.panelLabels]);
const linesOn = (k, page) => (S.spec[k] || []).filter(g => g.page === page);

function resetLocalState() {
  S.style.clear(); S.colour.clear(); S.imagePx.clear(); S.swatchNames.clear(); S.sel = null; S.page = 0;
}

function startJob(job) {
  const bad = validSpec(job && job.spec);
  if (bad) throw new Error('the job spec is not usable (' + bad + ')');
  const sp = job.spec;
  S.spec = { w: sp.trimW, h: sp.trimH, bleed: sp.bleed ?? 9, safety: sp.safety ?? 9, pages: sp.pages, ...specGuides(sp) };
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
  updateLegend();
  S.dirty = opened;
  S.undoFloor = 0;
  if (Array.isArray(job.options)) setOptions(job.options);
  el.print.disabled = false;
  layout();
}

function demoJob() {
  const q = new URLSearchParams(location.search);
  const num = (k, d) => { const v = parseFloat(q.get(k)); return Number.isFinite(v) && v > 0 ? v : d; };
  const w = num('w', 9), h = num('h', 6), pages = Math.round(num('pages', 2));
  if (q.get('product')) el.productName.textContent = q.get('product').slice(0, 60);
  const size = DEMO_SIZES.find(([l, s]) => l === Math.max(w, h) && s === Math.min(w, h));
  if (size) DEMO.size = size[0] + 'x' + size[1];
  DEMO.orientation = h > w ? 'portrait' : 'landscape';
  DEMO.sides = String(pages);
  return { spec: { trimW: w * 72, trimH: h * 72, bleed: 9, safety: 9, pages, pageMultiple: 1, folds: [], bindEdge: null, spine: 0 },
           options: size && pages <= 2 ? demoOptions() : [] };
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
    showPrice(m);
  } else if (m.type === 'pps-design:options') {
    if (Array.isArray(m.options)) setOptions(m.options);
  } else if (m.type === 'pps-design:spec') {
    if (S.d && S.spec) applySpec(m.spec);
  }
});

// Display only. The calculator computes the price; nothing here does.
function showPrice(m) {
  const t = m && m.total;
  if (typeof t === 'number' && Number.isFinite(t)) {
    S.price = { total: t, qty: Number.isInteger(m.qty) ? m.qty : null, turnaround: m.turnaround };
    el.price.textContent = '$' + t.toFixed(2) + (S.price.qty != null ? ' · ' + S.price.qty.toLocaleString() + ' pcs' : '');
    el.price.hidden = false;
  } else { S.price = null; el.price.hidden = true; }
  renderOrderPrice();
}

// ── layout and drawing ───────────────────────────────────────

function sideName(i) {
  if (S.spec.pages === 1) return 'Your design';
  // A folded piece prints outside and inside, not front and back.
  if (S.spec.pages === 2 && (S.spec.folds || []).length) return i === 0 ? 'Outside' : 'Inside';
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
  const pad = 8;
  // offsetWidth, not clientWidth: a zoomed design's scrollbars must not change the fit (and loop).
  const fit = Math.max(0.05, Math.min((el.stage.offsetWidth - pad * 2) / W, (el.stage.offsetHeight - pad * 2) / H));
  S.k = S.mode === 'adv' ? Math.max(0.05, fit * S.zoom) : fit;
  if (el.zoomPct) el.zoomPct.textContent = Math.round(S.k / (96 / 72) * 100) + '%';
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
  try { S.undoDepth = (run('document.history').undo || []).length; } catch { S.undoDepth = ins.canUndo ? S.undoFloor + 1 : S.undoFloor; }
  S.canUndo = !!ins.canUndo && S.undoDepth > S.undoFloor;
  const sp = (ins.spreads || [])[S.page] || { items: [] };
  S.allItems = sp.items || [];
  S.items = S.allItems.filter(it => !it.hidden);
  S.stories = new Map((ins.stories || []).map(s => [s.id, s]));
  S.swatches = ins.swatches || [];
  for (const n of S.swatches) if (!S.swatchNames.has(n)) S.swatchNames.set(n, n);
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
  drawGuides(ctx);

  for (const it of S.items) if (problemsOf(it).length) {
    const r = itemRect(it);
    ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
    ctx.strokeRect(r.x, r.y, r.w, r.h); ctx.setLineDash([]);
  }

  if (S.drag && S.drag.mode === 'draw' && S.drag.moved) {
    const b = drawRect(S.drag);
    ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    if (S.drag.tool === 'ellipse') {
      ctx.beginPath(); ctx.ellipse(px((b[0] + b[2]) / 2), px((b[1] + b[3]) / 2), (b[2] - b[0]) * S.k / 2, (b[3] - b[1]) * S.k / 2, 0, 0, Math.PI * 2); ctx.stroke();
    } else ctx.strokeRect(px(b[0]), px(b[1]), Math.max(1, (b[2] - b[0]) * S.k), Math.max(1, (b[3] - b[1]) * S.k));
    ctx.setLineDash([]);
  }
  const sel = selected();
  if (!sel) return;
  let r = itemRect(sel);
  const d = S.drag;
  if (d && d.moved && d.mode !== 'draw') {
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

// Folds (solid orange) and perforations (dashed purple) across the card, on a white underlay so
// they read on any colour, and the panel names between the folds.
function drawGuides(ctx) {
  const { w, h } = S.spec;
  const line = (g, colour, dash) => {
    ctx.beginPath();
    if (g.axis === 'v') { ctx.moveTo(px(g.at), px(-S.spec.bleed)); ctx.lineTo(px(g.at), px(h + S.spec.bleed)); }
    else { ctx.moveTo(px(-S.spec.bleed), px(g.at)); ctx.lineTo(px(w + S.spec.bleed), px(g.at)); }
    ctx.setLineDash([]); ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.stroke();
    ctx.setLineDash(dash); ctx.lineWidth = 1.75; ctx.strokeStyle = colour; ctx.stroke();
  };
  const folds = linesOn('folds', S.page), perfs = linesOn('perfs', S.page);
  for (const g of folds) line(g, '#ea7a0c', []);
  for (const g of perfs) line(g, '#8b3fd9', [3, 3]);
  ctx.setLineDash([]);
  // Panel names, centred near the top of each panel (or the left, for folds that run across).
  const names = (S.spec.panelLabels || [])[S.page] || [];
  if (folds.length && names.length === folds.length + 1) {
    const axis = folds[0].axis;
    const cuts = [0, ...folds.map(g => g.at).sort((a, b) => a - b), axis === 'v' ? w : h];
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    names.forEach((name, i) => {
      const mid = (cuts[i] + cuts[i + 1]) / 2;
      const [x, y] = axis === 'v' ? [px(mid), px(S.spec.safety) + 10] : [px(S.spec.safety) + 40, px(mid)];
      const tw = ctx.measureText(name).width + 10;
      ctx.fillStyle = 'rgba(234,122,12,.92)';
      ctx.fillRect(x - tw / 2, y - 8, tw, 16);
      ctx.fillStyle = '#fff';
      ctx.fillText(name, x, y);
    });
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
    // Words on a fold crack and fade where the paper bends; on a perforation they are torn in two.
    const near = g => g.axis === 'v' ? x0 < g.at + safety && x1 > g.at - safety : y0 < g.at + safety && y1 > g.at - safety;
    if (linesOn('folds', S.page).some(near)) out.push('Some words are on or too close to a fold (the orange line). Keep them inside one panel.');
    if (linesOn('perfs', S.page).some(near)) out.push('Some words are on or too close to a perforation (the purple dashed line), where the card tears.');
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

function updateLegend() {
  $('legendFold').hidden = !(S.spec.folds || []).length;
  $('legendPerf').hidden = !(S.spec.perfs || []).length;
}

function updateChrome() {
  el.undo.disabled = !S.canUndo;
  el.redo.disabled = !S.canRedo;
  [...el.sides.children].forEach((b, i) => b.setAttribute('aria-selected', String(i === S.page)));
  const msgs = [...new Set(S.items.flatMap(problemsOf))];
  el.warnings.textContent = '';
  for (const m of msgs) { const d = document.createElement('div'); d.textContent = m; el.warnings.appendChild(d); }
  el.emptyHint.hidden = S.items.length > 0 || S.mode === 'adv';
  updateContextBar();
  if (S.mode === 'adv' && S.spec) { updateControl(); updatePanels(); }
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
function fitText(id, page = S.page) {
  const find = () => {
    const ins = run('document.inspect');
    const it = (((ins.spreads || [])[page] || {}).items || []).find(x => x.id === id);
    const st = it && (ins.stories || []).find(x => x.id === it.story);
    return it && st ? { it, st } : null;
  };
  // One line, from the type as the engine has it (a frame from IDML or the Control bar may
  // differ from this page's own note of it).
  let lineH = textStyle(id).size * 1.2;
  try {
    run('selection.set', { ids: [id] });
    const ch = (run('type.selectionAttrs') || {}).chars || {};
    if (ch.leading && ch.leading.kind === 'points' && ch.leading.value > 0) lineH = ch.leading.value;
    else if (ch.size > 0) lineH = ch.size * 1.2;
  } catch { /* keep the page's note */ }
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
  // The editor sits in the stage, which scrolls when Advanced zooms in.
  const sl = el.stage.scrollLeft, stp = el.stage.scrollTop;
  const left = Math.max(sl, Math.min(c.left - st.left + sl + r.x, sl + st.width - el.textEditor.offsetWidth));
  let top = c.top - st.top + stp + r.y + r.h + 8;
  if (top + el.textEditor.offsetHeight > stp + st.height) top = Math.max(stp, c.top - st.top + stp + r.y - el.textEditor.offsetHeight - 8);
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
  S.undoFloor = 0;
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
    if (it.locked) continue;
    const [x0, y0, x1, y1] = it.bounds;
    const slop = it.bounds[3] - it.bounds[1] < 4 || it.bounds[2] - it.bounds[0] < 4 ? 4 / S.k : 0;   // lines are thin
    if (p[0] >= x0 - slop && p[0] <= x1 + slop && p[1] >= y0 - slop && p[1] <= y1 + slop) return it;
  }
  return null;
}

function handleAt(x, y) {
  const it = selected();
  if (!it || isBackground(it) || it.locked) return -1;
  const reach = 22;
  return corners(itemRect(it)).findIndex(([hx, hy]) => Math.hypot(hx - x, hy - y) <= reach);
}

el.canvas.addEventListener('pointerdown', e => {
  if (!S.spec) return;
  closeColours();
  const x = e.offsetX, y = e.offsetY;
  if (S.mode === 'adv' && S.tool !== 'select') {
    if (!el.textEditor.hidden) { commitText(); closeTextEditor(); }
    S.drag = { mode: 'draw', tool: S.tool, x, y, p0: [pt(x), pt(y)], p1: [pt(x), pt(y)], moved: false, shift: e.shiftKey };
    el.canvas.setPointerCapture(e.pointerId);
    return;
  }
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
  if (d.mode === 'draw') {
    d.p1 = [pt(e.offsetX), pt(e.offsetY)];
    d.shift = e.shiftKey;
    draw();
    return;
  }
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
  if (d.mode === 'draw') { createDrawn(d); return; }
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
function undo() {
  closeTextEditor();
  // A size or sides change came from the order (Order options): undo stops there, so the design
  // can never drift from the size the calculator is pricing.
  if (S.undoDepth <= S.undoFloor) {
    if (S.undoFloor > 0) toast('To change the size or sides, use Order options.');
    return;
  }
  if (tryRun('edit.undo', {}) !== undefined) { S.dirty = true; S.canRedo = true; refresh(); }
}
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
  if (S.mode === 'adv') {
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom(S.zoom * 1.25); return; }
    if (mod && e.key === '-') { e.preventDefault(); setZoom(S.zoom / 1.25); return; }
    if (mod && e.key === '0') { e.preventDefault(); setZoom(1); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); S.replaceInto = null; el.photoPick.click(); return; }
    const t = !mod && !e.altKey && TOOL_KEYS[e.key.toLowerCase()];
    if (t) { e.preventDefault(); setTool(t); return; }
  }
  if (e.key === 'Escape') { closeColours(); if (S.mode === 'adv' && S.tool !== 'select') setTool('select'); select(null); return; }
  if (!S.sel) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); return; }
  if (e.key === 'Enter' && isText(selected())) { e.preventDefault(); openTextEditor(); return; }
  const step = e.shiftKey ? 9 : 1;
  const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  const it = selected();
  if (mv && it && !isBackground(it) && !it.locked) {
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
        folds: S.spec.folds.length ? S.spec.folds : undefined, perfs: S.spec.perfs.length ? S.spec.perfs : undefined,
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

// ── Advanced Mode: InDesign's print workspace, over the same document ──

function setMode(mode) {
  if (mode === 'adv' && matchMedia('(max-width: 860px)').matches) mode = 'simple';
  S.mode = mode;
  el.app.classList.toggle('adv', mode === 'adv');
  el.modeSimple.setAttribute('aria-pressed', String(mode === 'simple'));
  el.modeAdv.setAttribute('aria-pressed', String(mode === 'adv'));
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* a private window keeps no setting */ }
  if (mode !== 'adv') { setTool('select'); S.zoom = 1; }
  closeColours();
  if (mode === 'adv') { S.pageThumbsKey = ''; }
  // The stage changes size with the panels: lay out once the grid has settled.
  requestAnimationFrame(() => { if (S.spec) { layout(); updateChrome(); } });
}
el.modeSimple.addEventListener('click', () => setMode('simple'));
el.modeAdv.addEventListener('click', () => setMode('adv'));

function setTool(t) {
  S.tool = t;
  document.querySelectorAll('.tool[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
  el.canvas.style.cursor = t === 'select' ? '' : t === 'text' ? 'text' : 'crosshair';
}
document.querySelectorAll('.tool[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('toolPlace').addEventListener('click', () => { S.replaceInto = null; el.photoPick.click(); });
$('toolOpen').addEventListener('click', () => el.filePick.click());

function setZoom(z) {
  S.zoom = Math.min(8, Math.max(0.25, z));
  layout();
}
$('zoomIn').addEventListener('click', () => setZoom(S.zoom * 1.25));
$('zoomOut').addEventListener('click', () => setZoom(S.zoom / 1.25));
$('zoomFit').addEventListener('click', () => setZoom(1));
el.stage.addEventListener('wheel', e => {
  if (S.mode !== 'adv' || !(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  setZoom(S.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
}, { passive: false });

// Drawing with a tool: the rectangle being dragged, in page points.
function drawRect(d) {
  let [x0, y0] = d.p0, [x1, y1] = d.p1;
  if (d.tool === 'line') {
    if (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) y1 = y0; else x1 = x0;
  } else if (d.shift) {
    const s = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    x1 = x0 + Math.sign(x1 - x0 || 1) * s; y1 = y0 + Math.sign(y1 - y0 || 1) * s;
  }
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}

function createDrawn(d) {
  let b = drawRect(d);
  if (!d.moved || (b[2] - b[0] < 3 && b[3] - b[1] < 3)) {
    // A click without a drag makes one at a standard size, as InDesign's dialog would.
    const [x, y] = d.p0;
    const [w, h] = { text: [216, 36], line: [144, 0], image: [144, 108] }[d.tool] || [72, 72];
    b = [x, y, x + w, y + h];
  }
  try {
    let id;
    if (d.tool === 'text') {
      id = run('frame.create', { spread: S.page, rect: b, content: 'text', text: '' }).id;
      S.style.set(id, { font: 'clean', bold: false, size: 12, align: 'left', colour: 'Black' });
      run('selection.set', { ids: [id] });
      run('type.char', { attrs: { fontFamily: FONTS.clean.family, fontStyle: 'Regular', size: 12, fill: '[Black]' } });
    } else if (d.tool === 'image') {
      id = run('frame.create', { spread: S.page, rect: b, content: 'graphic' }).id;
    } else {
      // InDesign's defaults for a drawn shape: no fill, a 1 pt black stroke.
      id = run('frame.create', { spread: S.page, rect: b, shape: d.tool === 'ellipse' ? 'ellipse' : 'rectangle', content: 'unassigned' }).id;
      run('object.fill', { swatch: '[None]', ids: [id] });
      run('object.stroke', { swatch: '[Black]', weight: 1, ids: [id] });
    }
    S.sel = id;
    changed();
    if (d.tool === 'text') openTextEditor();
    if (d.tool === 'image') { S.replaceInto = id; el.photoPick.click(); }
  } catch (e) { console.error(e); toast('That could not be drawn. Please try again.'); draw(); }
}

// ── the Control bar ──

const inch = v => +(v / 72).toFixed(3);
const num = input => { const v = parseFloat(input.value); return Number.isFinite(v) ? v : null; };
function setIfIdle(input, v) { if (document.activeElement !== input) input.value = v; }

// A swatch's colour for its chip: the known ones, and CMYK read from a "C=… M=… Y=… K=…" name.
function swatchCss(name) {
  if (!name || name === '[None]') return null;
  if (name === '[Paper]') return '#ffffff';
  if (name === '[Black]' || name === '[Registration]') return '#231f20';
  const known = COLOURS.find(c => 'PPS ' + c.name === name || c.swatch === name);
  if (known) return known.css;
  const m = /C=([\d.]+)\s+M=([\d.]+)\s+Y=([\d.]+)\s+K=([\d.]+)/.exec(name);
  if (m) {
    const [c, mm, y, k] = m.slice(1).map(v => Math.min(100, +v) / 100);
    const ch = v => Math.round(255 * (1 - v) * (1 - k));
    return 'rgb(' + ch(c) + ',' + ch(mm) + ',' + ch(y) + ')';
  }
  return '#b9bcc2';
}
function paintChip(chip, name) {
  const css = swatchCss(name);
  chip.classList.toggle('none', !css);
  if (chip.classList.contains('stroke')) { chip.style.borderColor = css || '#999'; chip.style.background = ''; }
  else chip.style.background = css || '';
}

function swatchSelect(sel, current) {
  const names = ['[None]', ...S.swatches.filter(n => n !== '[None]')];
  if (current && !names.includes(current)) names.push(current);
  const key = names.join('|');
  if (sel.dataset.key !== key) {
    sel.textContent = '';
    for (const n of names) { const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); }
    sel.dataset.key = key;
  }
  if (document.activeElement !== sel) sel.value = current || '[None]';
}

for (const f of Object.keys(FAMILIES)) { const o = document.createElement('option'); o.value = o.textContent = f; el.ctlFont.appendChild(o); }
function styleOptions(family, current) {
  const styles = FAMILIES[family] || [current || 'Regular'];
  el.ctlStyle.textContent = '';
  for (const st of styles) { const o = document.createElement('option'); o.value = o.textContent = st; el.ctlStyle.appendChild(o); }
  if (current && !styles.includes(current)) { const o = document.createElement('option'); o.value = o.textContent = current; el.ctlStyle.appendChild(o); }
  el.ctlStyle.value = current || styles[0];
}

// The text's own attributes, as the engine resolves them (not what this page last set).
function textAttrs(it) {
  try { run('selection.set', { ids: [it.id] }); return run('type.selectionAttrs') || {}; }
  catch (e) { console.error(e); return {}; }
}

function updateControl() {
  const it = selected();
  el.ctlObj.hidden = !it;
  el.ctlText.hidden = !isText(it);
  el.ctlNone.hidden = !!it;
  if (!it) {
    el.ctlNone.textContent = 'Page ' + inch(S.spec.w) + ' × ' + inch(S.spec.h) + ' in · bleed ' + inch(S.spec.bleed) +
      ' in · keep words ' + inch(S.spec.safety) + ' in inside the cut · ' + (S.items.length ? 'click something to change it' : 'draw with a tool on the left');
    return;
  }
  const [x0, y0, x1, y1] = it.bounds;
  setIfIdle(el.ctlX, inch(x0)); setIfIdle(el.ctlY, inch(y0));
  setIfIdle(el.ctlW, inch(x1 - x0)); setIfIdle(el.ctlH, inch(y1 - y0));
  let rot = 0;
  try { rot = (run('transform.info', { ids: [it.id] }) || {}).rotation || 0; } catch { /* a group has none of its own */ }
  setIfIdle(el.ctlRot, +rot.toFixed(2));
  const attrs = isText(it) ? textAttrs(it) : null;
  const ch = (attrs && attrs.chars) || {};
  // A text frame's Fill is its words' colour (what people mean); its Stroke is the frame's edge.
  const fill = isText(it) ? (ch.fill || '[Black]') : it.fill;
  swatchSelect(el.ctlFill, fill); paintChip(el.ctlFillChip, fill);
  el.ctlFill.closest('.ctl').dataset.tip = isText(it) ? 'Text colour' : 'Fill swatch';
  swatchSelect(el.ctlStroke, it.stroke && it.stroke.swatch); paintChip(el.ctlStrokeChip, it.stroke && it.stroke.swatch);
  setIfIdle(el.ctlWeight, it.stroke ? +(+it.stroke.weight || 0).toFixed(2) : 0);
  setIfIdle(el.ctlOpacity, S.opacity.has(it.id) ? S.opacity.get(it.id) : 100);
  for (const inp of [el.ctlX, el.ctlY, el.ctlW, el.ctlH, el.ctlRot]) inp.disabled = !!it.locked || isBackground(it);
  if (attrs) {
    if (document.activeElement !== el.ctlFont) el.ctlFont.value = ch.fontFamily in FAMILIES ? ch.fontFamily : '';
    if (document.activeElement !== el.ctlStyle) styleOptions(ch.fontFamily, ch.fontStyle);
    setIfIdle(el.ctlSize, ch.size != null ? +(+ch.size).toFixed(2) : '');
    setIfIdle(el.ctlLeading, ch.leading && ch.leading.kind === 'points' ? +(+ch.leading.value).toFixed(2) : '');
    setIfIdle(el.ctlTracking, ch.tracking != null ? Math.round(ch.tracking) : 0);
    const al = (attrs.para || {}).align;
    document.querySelectorAll('[data-palign]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.palign === al)));
  }
}

function commitGeometry() {
  const it = selected();
  if (!it || it.locked || isBackground(it)) return;
  const [x0, y0, x1, y1] = it.bounds;
  const x = num(el.ctlX), y = num(el.ctlY), w = num(el.ctlW), h = num(el.ctlH);
  if (x == null || y == null || w == null || h == null || w < 0 || h < 0) { updateControl(); return; }
  const thin = (a, b) => b - a < 1;   // a drawn line has no height (or width) of its own
  const to = [x * 72, y * 72, x * 72 + (thin(x0, x1) && w < 0.02 ? x1 - x0 : Math.max(0.5, w * 72)),
              y * 72 + (thin(y0, y1) && h < 0.02 ? y1 - y0 : Math.max(0.5, h * 72))];
  if (to.every((v, i) => Math.abs(v - it.bounds[i]) < 0.01)) return;
  try {
    run('transform.resize', { from: it.bounds, to, content: false, ids: [it.id] });
    if (isImage(it)) run('object.fit', { mode: 'fillProportionally', ids: [it.id] });
  } catch (e) { console.error(e); toast('That size could not be set.'); updateControl(); return; }
  changed();
}
for (const inp of [el.ctlX, el.ctlY, el.ctlW, el.ctlH]) inp.addEventListener('change', commitGeometry);

el.ctlRot.addEventListener('change', () => {
  const it = selected(), a = num(el.ctlRot);
  if (!it || a == null || it.locked) return;
  if (tryRun('transform.set', { rotation: ((a % 360) + 360) % 360, ids: [it.id] }, 'That angle could not be set.') !== undefined) changed();
});

el.ctlFill.addEventListener('change', () => applySwatch(el.ctlFill.value, 'fill'));
el.ctlStroke.addEventListener('change', () => applySwatch(el.ctlStroke.value, 'stroke'));

function applySwatch(name, target) {
  const it = selected();
  if (!it) { toast('Select something first, then pick a swatch.'); return; }
  try {
    if (target === 'fill' && isText(it)) {
      run('selection.set', { ids: [it.id] });
      run('type.char', { attrs: { fill: name } });
    } else if (target === 'fill') {
      run('object.fill', { swatch: name, ids: [it.id] });
    } else {
      const p = { swatch: name, ids: [it.id] };
      if (name !== '[None]' && !(it.stroke && it.stroke.weight > 0)) p.weight = 1;
      run('object.stroke', p);
    }
  } catch (e) { console.error(e); toast('That swatch could not be applied.'); return; }
  changed();
}

el.ctlWeight.addEventListener('change', () => {
  const it = selected(), w = num(el.ctlWeight);
  if (!it || w == null || w < 0) return;
  const p = { weight: Math.min(w, 1000), ids: [it.id] };
  if (w > 0 && (!it.stroke || it.stroke.swatch === '[None]')) p.swatch = '[Black]';
  if (tryRun('object.stroke', p, 'That stroke could not be set.') !== undefined) changed();
});

el.ctlOpacity.addEventListener('change', () => {
  const it = selected(), v = num(el.ctlOpacity);
  if (!it || v == null) return;
  const pc = Math.min(100, Math.max(0, v));
  if (tryRun('object.opacity', { opacity: pc / 100, ids: [it.id] }, 'That opacity could not be set.') === undefined) return;
  S.opacity.set(it.id, pc);
  changed();
});

function applyChar(attrs) {
  const it = selected();
  if (!isText(it)) return;
  try {
    run('selection.set', { ids: [it.id] });
    run('type.char', { attrs });
  } catch (e) { console.error(e); toast('That type setting could not be applied.'); return; }
  // Keep Simple mode's idea of the frame in step, for its toolbar.
  const st = textStyle(it.id);
  if (attrs.size) st.size = attrs.size;
  if (attrs.fontFamily) {
    const key = Object.keys(FONTS).find(k => FONTS[k].family === attrs.fontFamily);
    if (key) st.font = key;
  }
  // The frame follows its words, as in Simple: bigger type must not push words out of print.
  if (attrs.size || attrs.leading || attrs.fontFamily || attrs.fontStyle) {
    if (attrs.size) st.size = attrs.size;
    try { fitText(it.id); } catch (e) { console.error(e); }
  }
  changed();
}
el.ctlFont.addEventListener('change', () => {
  const fam = el.ctlFont.value, styles = FAMILIES[fam] || ['Regular'];
  const cur = el.ctlStyle.value;
  applyChar({ fontFamily: fam, fontStyle: styles.includes(cur) ? cur : styles[0] });
});
el.ctlStyle.addEventListener('change', () => applyChar({ fontStyle: el.ctlStyle.value }));
el.ctlSize.addEventListener('change', () => { const v = num(el.ctlSize); if (v != null && v >= 1 && v <= 1296) applyChar({ size: v }); });
el.ctlLeading.addEventListener('change', () => {
  const v = num(el.ctlLeading);
  applyChar({ leading: v == null || v <= 0 ? { kind: 'auto' } : { kind: 'points', value: Math.min(v, 5000) } });
});
el.ctlTracking.addEventListener('change', () => { const v = num(el.ctlTracking); if (v != null) applyChar({ tracking: Math.max(-1000, Math.min(10000, v)) }); });
document.querySelectorAll('[data-palign]').forEach(b => b.addEventListener('click', () => {
  const it = selected();
  if (!isText(it)) return;
  try { run('selection.set', { ids: [it.id] }); run('type.para', { attrs: { align: b.dataset.palign } }); }
  catch (e) { console.error(e); toast('That alignment could not be applied.'); return; }
  if (b.dataset.palign in ALIGN_ICON) textStyle(it.id).align = b.dataset.palign;
  changed();
}));
$('ctlEdit').addEventListener('click', openTextEditor);

// ── the panels: Pages, Layers, Swatches, Align ──

function updatePanels() {
  updatePagesPanel();
  updateLayersPanel();
  updateSwatchPanel();
}

let thumbTimer = 0;
function updatePagesPanel() {
  const n = S.spec.pages;
  if (el.pagesList.children.length !== n) {
    el.pagesList.textContent = '';
    for (let i = 0; i < n; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      const img = document.createElement('img'); img.alt = '';
      const cap = document.createElement('span'); cap.textContent = sideName(i);
      b.append(img, cap);
      b.addEventListener('click', () => { S.page = i; select(null); refresh(); });
      el.pagesList.appendChild(b);
    }
  }
  [...el.pagesList.children].forEach((b, i) => b.setAttribute('aria-current', String(i === S.page)));
  // Thumbnails follow the design, a moment after it stops changing.
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => {
    if (S.mode !== 'adv') return;
    [...el.pagesList.children].forEach((b, i) => {
      try {
        const scale = Math.min(1, 104 / (S.spec.w + 2 * S.spec.bleed) * 2);
        const p = S.d.renderPage(i, scale, true);
        const c = document.createElement('canvas');
        c.width = p.width; c.height = p.height;
        c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(p.rgba), p.width, p.height), 0, 0);
        p.free();
        b.querySelector('img').src = c.toDataURL('image/png');
      } catch (e) { console.error(e); }
    });
  }, 400);
}

function itemName(it) {
  if (it.name) return it.name;
  if (isBackground(it)) return 'Background';
  if (isText(it)) { const st = S.stories.get(it.story); const t = st && st.preview ? st.preview.replace(/\s+/g, ' ').trim() : ''; return t ? '“' + t.slice(0, 40) + '”' : 'Empty text frame'; }
  if (isImage(it)) return 'Photo';
  const b = it.bounds;
  if (b[3] - b[1] < 1 || b[2] - b[0] < 1) return 'Line';
  return { '<rectangle>': 'Rectangle', '<ellipse>': 'Ellipse', '<polygon>': 'Polygon', '<group>': 'Group' }[it.kind] || it.kind.replace(/[<>]/g, '');
}

function updateLayersPanel() {
  el.layersList.textContent = '';
  const items = [...S.allItems].reverse();   // top of the stack first, as InDesign lists them
  if (!items.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Nothing on this side yet.'; el.layersList.appendChild(li); }
  for (const it of items) {
    const li = document.createElement('li');
    li.setAttribute('aria-selected', String(it.id === S.sel));
    li.classList.toggle('is-hidden', !!it.hidden);
    const eye = document.createElement('button');
    eye.type = 'button'; eye.className = 'lflag'; eye.textContent = it.hidden ? '◌' : '◉';
    eye.setAttribute('aria-pressed', String(!it.hidden)); eye.setAttribute('aria-label', (it.hidden ? 'Show ' : 'Hide ') + itemName(it));
    eye.title = it.hidden ? 'Hidden: it will not print. Click to show.' : 'Shown. Click to hide (hidden things do not print).';
    eye.addEventListener('click', () => setFlag(it, { hidden: !it.hidden }));
    const lock = document.createElement('button');
    lock.type = 'button'; lock.className = 'lflag'; lock.textContent = it.locked ? '🔒' : '🔓';
    lock.setAttribute('aria-pressed', String(!!it.locked)); lock.setAttribute('aria-label', (it.locked ? 'Unlock ' : 'Lock ') + itemName(it));
    lock.title = it.locked ? 'Locked: it cannot be moved. Click to unlock.' : 'Click to lock it in place.';
    lock.addEventListener('click', () => setFlag(it, { locked: !it.locked }));
    const name = document.createElement('button');
    name.type = 'button'; name.className = 'lname'; name.textContent = itemName(it);
    name.addEventListener('click', () => { if (!it.hidden) select(it.id); });
    li.append(eye, lock, name);
    el.layersList.appendChild(li);
  }
}

function setFlag(it, flags) {
  if (tryRun('object.setFlags', { ids: [it.id], ...flags }, 'That could not be changed.') === undefined) return;
  if (flags.hidden && S.sel === it.id) S.sel = null;
  changed();
}
$('layerUp').addEventListener('click', () => { const it = selected(); if (it && tryRun('object.arrange', { to: 'forward', ids: [it.id] }) !== undefined) changed(); });
$('layerDown').addEventListener('click', () => {
  const it = selected();
  if (!it || isBackground(it)) return;
  const bg = background();
  const order = S.items.map(i => i.id);
  // Nothing goes behind the background colour.
  if (bg && order.indexOf(it.id) === order.indexOf(bg.id) + 1) return;
  if (tryRun('object.arrange', { to: 'backward', ids: [it.id] }) !== undefined) changed();
});

function updateSwatchPanel() {
  const names = ['[None]', ...S.swatches.filter(n => n !== '[None]')];
  const key = names.join('|');
  if (el.swatchList.dataset.key === key) return;
  el.swatchList.dataset.key = key;
  el.swatchList.textContent = '';
  for (const n of names) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    const chip = document.createElement('span'); chip.className = 'sw-chip';
    const css = swatchCss(n);
    if (css) chip.style.background = css; else chip.classList.add('none');
    const label = document.createElement('span'); label.textContent = n;
    b.append(chip, label);
    b.addEventListener('click', () => applySwatch(n, S.fsTarget));
    li.appendChild(b);
    el.swatchList.appendChild(li);
  }
}
function setFsTarget(t) {
  S.fsTarget = t;
  el.fsFill.setAttribute('aria-pressed', String(t === 'fill'));
  el.fsStroke.setAttribute('aria-pressed', String(t === 'stroke'));
}
el.fsFill.addEventListener('click', () => setFsTarget('fill'));
el.fsStroke.addEventListener('click', () => setFsTarget('stroke'));
el.swatchNew.addEventListener('submit', e => {
  e.preventDefault();
  const f = new FormData(el.swatchNew);
  const v = k => Math.min(100, Math.max(0, Math.round(Number(f.get(k)) || 0)));
  const c = { c: v('c'), m: v('m'), y: v('y'), k: v('k') };
  const r = tryRun('swatch.create', { name: 'C=' + c.c + ' M=' + c.m + ' Y=' + c.y + ' K=' + c.k, color: c }, 'That swatch could not be made.');
  if (r === undefined) return;
  readDocument();
  if (selected() && r && r.name) applySwatch(r.name, S.fsTarget); else changed();
});

document.querySelectorAll('[data-oalign]').forEach(b => b.addEventListener('click', () => {
  const it = selected();
  if (!it || it.locked || isBackground(it)) { if (!it) toast('Select something first, then align it.'); return; }
  const { w, h, bleed, safety } = S.spec;
  const box = { trim: [0, 0, w, h], safe: [safety, safety, w - safety, h - safety], bleed: [-bleed, -bleed, w + bleed, h + bleed] }[el.alignTo.value];
  const [x0, y0, x1, y1] = it.bounds;
  const dx = { left: box[0] - x0, right: box[2] - x1, hcenter: (box[0] + box[2]) / 2 - (x0 + x1) / 2 }[b.dataset.oalign] || 0;
  const dy = { top: box[1] - y0, bottom: box[3] - y1, vcenter: (box[1] + box[3]) / 2 - (y0 + y1) / 2 }[b.dataset.oalign] || 0;
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
  if (tryRun('transform.move', { dx, dy, ids: [it.id] }, 'That could not be aligned.') !== undefined) changed();
}));

// ── Order options: the calculator's choices that change the design ──
//
// The calculator sends what may change (size, sides, quantity…) as a list of fields and owns
// what they mean: this page draws them, sends a change back as pps-design:option, and shows the
// price the calculator answers with. A new size or sides comes back as pps-design:spec, and the
// design follows it (resizeDocument). Nothing here prices anything.

function sanitizeOptions(list) {
  const str = (v, n) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, n);
  const fin = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  return (Array.isArray(list) ? list : []).slice(0, 12).filter(o => o && typeof o === 'object' && /^[\w-]{1,32}$/.test(o.key || '')).map(o => {
    const type = o.type === 'number' ? 'number' : 'select';
    const out = { key: o.key, label: str(o.label || o.key, 40), type, help: str(o.help, 160) };
    if (type === 'select') {
      out.choices = (Array.isArray(o.choices) ? o.choices : []).slice(0, 200).map(c => ({ value: str(c && c.value, 60), label: str(c && (c.label ?? c.value), 80), group: str(c && c.group, 40) }));
      out.value = str(o.value, 60);
    } else {
      out.value = fin(o.value) ?? 0; out.min = fin(o.min); out.max = fin(o.max); out.step = fin(o.step);
    }
    return out;
  });
}

function setOptions(list) {
  S.options = sanitizeOptions(list);
  S.lastOption = null;
  el.orderTab.hidden = !S.options.length;
  if (!S.options.length) openOrder(false);
  renderOrderFields();
  renderOrderPrice();
}

function renderOrderFields() {
  el.orderFields.textContent = '';
  for (const o of S.options) {
    const wrap = document.createElement('label');
    wrap.className = 'op-field';
    const cap = document.createElement('span'); cap.textContent = o.label;
    let input;
    if (o.type === 'select') {
      input = document.createElement('select');
      let group = null;
      for (const c of o.choices) {
        let parent = input;
        if (c.group) {
          if (!group || group.label !== c.group) { group = document.createElement('optgroup'); group.label = c.group; input.appendChild(group); }
          parent = group;
        } else group = null;
        const op = document.createElement('option'); op.value = c.value; op.textContent = c.label;
        parent.appendChild(op);
      }
      input.value = o.value;
    } else {
      input = document.createElement('input');
      input.type = 'number'; input.inputMode = 'numeric';
      if (o.min != null) input.min = o.min;
      if (o.max != null) input.max = o.max;
      if (o.step != null) input.step = o.step;
      input.value = o.value;
    }
    input.dataset.key = o.key;
    input.addEventListener('change', () => {
      let v = input.value;
      if (o.type === 'number') {
        v = Number(v);
        if (!Number.isFinite(v) || (o.min != null && v < o.min) || (o.max != null && v > o.max)) { input.value = o.value; toast(o.label + ' must be ' + (o.min != null ? 'at least ' + o.min : '') + (o.max != null ? ' and at most ' + o.max : '') + '.'); return; }
      }
      if (v === o.value) return;
      S.lastOption = { key: o.key, prev: o.value };
      o.value = v;
      el.orderPrice.classList.add('busy');
      if (S.embedded) post('pps-design:option', { key: o.key, value: v });
      else demoOption(o.key, v);
    });
    wrap.append(cap, input);
    if (o.help) { const h = document.createElement('span'); h.className = 'help'; h.textContent = o.help; wrap.appendChild(h); }
    el.orderFields.appendChild(wrap);
  }
}

function renderOrderPrice() {
  el.orderPrice.classList.remove('busy');
  el.orderPrice.textContent = '';
  if (!S.price) {
    el.orderPrice.hidden = !S.embedded;
    if (S.embedded) el.orderPrice.textContent = 'Price shown on your order';
    return;
  }
  el.orderPrice.hidden = false;
  el.orderPrice.append('$' + S.price.total.toFixed(2));
  const small = document.createElement('small');
  const bits = [];
  if (S.price.qty != null) bits.push(S.price.qty.toLocaleString() + ' pieces');
  if (typeof S.price.turnaround === 'number' && Number.isFinite(S.price.turnaround)) bits.push(S.price.turnaround + ' business day' + (S.price.turnaround === 1 ? '' : 's') + ' to print');
  small.textContent = bits.join(' · ');
  el.orderPrice.appendChild(small);
}

function openOrder(open) {
  el.orderPanel.classList.toggle('open', open);
  el.orderTab.setAttribute('aria-expanded', String(open));
  if (open) { const f = el.orderFields.querySelector('select, input'); if (f) f.focus(); }
}
el.orderTab.addEventListener('click', () => openOrder(!el.orderPanel.classList.contains('open')));
$('orderClose').addEventListener('click', () => { openOrder(false); el.orderTab.focus(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && el.orderPanel.classList.contains('open')) openOrder(false); });

// The calculator refused a change, or the customer backed out of losing a side: put the field back.
function revertOption() {
  const l = S.lastOption;
  S.lastOption = null;
  if (!l) return;
  const o = S.options.find(x => x.key === l.key);
  if (o) o.value = l.prev;
  renderOrderFields();
  el.orderPrice.classList.remove('busy');
  if (S.embedded) post('pps-design:option', { key: l.key, value: l.prev });
  else demoOption(l.key, l.prev, true);
}

// A new spec from the calculator while designing: a new size, or sides added or removed.
function applySpec(spec) {
  const bad = validSpec(spec);
  if (bad) { console.warn('ignored a spec that is not usable (' + bad + ')'); revertOption(); return; }
  const next = { w: spec.trimW, h: spec.trimH, bleed: spec.bleed ?? S.spec.bleed, safety: spec.safety ?? S.spec.safety, pages: spec.pages, ...specGuides(spec) };
  const cur = S.spec;
  const same = (a, b) => Math.abs(a - b) < 0.01;
  if (same(next.w, cur.w) && same(next.h, cur.h) && same(next.bleed, cur.bleed) && same(next.safety, cur.safety) && next.pages === cur.pages) {
    // Same card: only the folds or perforations moved. The guides follow; the design stays.
    if (!sameGuides(next, cur)) { S.spec = next; buildSides(); el.pagesList.textContent = ''; refresh(); updateLegend(); }
    S.lastOption = null; el.orderPrice.classList.remove('busy');
    return;
  }
  if (next.pages < cur.pages) {
    const lost = allPages().slice(next.pages).some(items => items.length);
    if (lost && !confirm(sideName(next.pages) + ' has a design on it. Printing ' + (next.pages === 1 ? 'one side' : next.pages + ' pages') + ' removes it. Continue?')) { revertOption(); return; }
  }
  try { resizeDocument(next); }
  catch (e) { console.error(e); toast('The design could not be changed to the new size.'); revertOption(); return; }
  S.lastOption = null;
}

// Changes the document to the new trim, bleed and page count, and moves and scales what is on
// it to match: each object keeps its place relative to the card and its shape (scaled evenly, by
// the smaller of the two changes), and anything that covered the whole card (a background, a
// photo filling the side) still covers the new one to the bleed. Text keeps its look at the new
// scale. Undo stops here: the size belongs to the order.
function resizeDocument(next) {
  const old = S.spec;
  const before = (run('document.inspect').spreads || []).map(sp => (sp.items || []).map(it => ({ id: it.id, b: it.bounds, kind: it.kind })));
  run('layout.documentSetup', { width: next.w, height: next.h, pages: next.pages, bleed: next.bleed });
  if (Math.abs(next.safety - old.safety) > 0.01) run('layout.marginsAndColumns', { margins: next.safety });
  const sx = next.w / old.w, sy = next.h / old.h, k = Math.min(sx, sy);
  before.slice(0, next.pages).forEach((items, page) => items.forEach(({ id, b, kind }) => {
    const covers = b[0] <= 0.5 && b[1] <= 0.5 && b[2] >= old.w - 0.5 && b[3] >= old.h - 0.5;
    let to;
    if (covers) to = [-next.bleed, -next.bleed, next.w + next.bleed, next.h + next.bleed];
    else {
      const cx = (b[0] + b[2]) / 2 * sx, cy = (b[1] + b[3]) / 2 * sy, hw = (b[2] - b[0]) / 2 * k, hh = (b[3] - b[1]) / 2 * k;
      to = [cx - hw, cy - hh, cx + hw, cy + hh];
    }
    if (!to.every((v, i) => Math.abs(v - b[i]) < 0.01)) run('transform.resize', { from: b, to, content: false, ids: [id] });
    if (kind === '<image>') run('object.fit', { mode: 'fillProportionally', ids: [id] });
    if (kind === '<text frame>' && S.style.has(id) && Math.abs(k - 1) > 0.01) {
      const st = S.style.get(id);
      st.size = Math.max(4, Math.round(st.size * k * 2) / 2);
      run('selection.set', { ids: [id] });
      run('type.char', { attrs: { size: st.size } });
      fitText(id, page);
    }
  }));
  S.spec = next;
  updateLegend();
  el.productSize.textContent = inch(next.w) + ' × ' + inch(next.h) + ' in';
  if (S.page >= next.pages) S.page = next.pages - 1;
  S.sel = null;
  S.dirty = true;
  S.canRedo = false;
  try { S.undoFloor = (run('document.history').undo || []).length; } catch { S.undoFloor = Infinity; }
  buildSides();
  el.pagesList.textContent = '';
  layout();
}

// Standalone (the preview), the page plays the calculator's part with a few sizes, so the
// panel can be tried. No prices: those only ever come from the calculator.
const DEMO_SIZES = [[3.5, 2], [5, 3], [6, 4], [7, 5], [8.5, 5.5], [9, 6], [11, 8.5]];
const DEMO = { size: '9x6', orientation: 'landscape', sides: '2', fold: 'flat', perf: '0', qty: 250 };
// Panels across the long edge, as the postcard calculator lays them out (a trifold's inside flap
// is 1/32 in narrower so it tucks in); the names are the calculator's.
const DEMO_FOLDS = {
  flat: { widths: [0], names: [[], []] },
  bifold: { widths: [0, 0], names: [['Back', 'Front'], ['Inside Front', 'Inside Back']] },
  trifold: { widths: [-1, 0, 1], names: [['Inside Flap', 'Back', 'Front'], ['Inside Left', 'Inside Center', 'Inside Right']] },
};
function demoOptions() {
  return [
    { key: 'size', label: 'Size', type: 'select', value: DEMO.size, choices: DEMO_SIZES.map(([l, s]) => ({ value: l + 'x' + s, label: l + ' × ' + s + ' in' })) },
    { key: 'orientation', label: 'Orientation', type: 'select', value: DEMO.orientation, choices: [{ value: 'landscape', label: 'Landscape (wide)' }, { value: 'portrait', label: 'Portrait (tall)' }] },
    { key: 'sides', label: 'Sides printed', type: 'select', value: DEMO.sides, choices: [{ value: '2', label: 'Both sides' }, { value: '1', label: 'Front only' }] },
    { key: 'fold', label: 'Folding', type: 'select', value: DEMO.fold, choices: [{ value: 'flat', label: 'Flat (no folds)' }, { value: 'bifold', label: 'Bifold (2 panels)' }, { value: 'trifold', label: 'Trifold (3 panels)' }] },
    { key: 'perf', label: 'Perforation', type: 'select', value: DEMO.perf, choices: [{ value: '0', label: 'No perforation' }, { value: '1', label: '1 perforation line' }] },
    { key: 'qty', label: 'Quantity', type: 'number', value: DEMO.qty, min: 1, max: 99999, step: 1, help: 'In a real order the calculator updates the price.' },
  ];
}
function demoSpec() {
  const [l, s] = DEMO.size.split('x').map(Number);
  const portrait = DEMO.orientation === 'portrait';
  const [w, h] = portrait ? [s, l] : [l, s];
  const pages = Number(DEMO.sides);
  const fold = DEMO_FOLDS[DEMO.fold] || DEMO_FOLDS.flat;
  // Positions along the long edge, in inches: fold lines between the panels, a perforation 2 in
  // from the right-hand end (a tear-off coupon).
  const n = fold.widths.length, at = [];
  for (let i = 0, x = 0; i < n - 1; i++) { x += l / n + fold.widths[i] / 32; at.push(x); }
  const perfAt = DEMO.perf === '1' ? [l - 2] : [];
  return { trimW: w * 72, trimH: h * 72, bleed: 9, safety: 9, pages, pageMultiple: 1,
    ...guideLines(l, s, portrait, pages, at, perfAt), panelLabels: n > 1 ? fold.names.slice(0, pages) : [] };
}

// Lines across a sheet held landscape at `atLong` inches along its long edge, as the page shows
// them: turned upright for a portrait card, and mirrored on the back (turned over left to right,
// what was on the left of the front is on the right of the back). Used by the demo; the
// postcard calculator does the same in calc-postcard.html.
function guideLines(l, s, portrait, pages, foldAt, perfAt) {
  const W = (portrait ? s : l) * 72;
  const place = (a, page) => {
    let g = portrait ? { axis: 'h', at: a * 72 } : { axis: 'v', at: a * 72 };
    if (page === 1 && g.axis === 'v') g = { axis: 'v', at: W - g.at };
    return { page, ...g };
  };
  const all = list => [...Array(pages).keys()].flatMap(page => list.map(a => place(a, page)));
  return { folds: all(foldAt), perfs: all(perfAt) };
}
function demoOption(key, value, reverting) {
  if (!(key in DEMO)) return;
  DEMO[key] = value;
  if (reverting) return;
  setOptions(demoOptions());
  applySpec(demoSpec());
}

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
  let saved = 'simple';
  try { saved = localStorage.getItem(MODE_KEY) === 'adv' ? 'adv' : 'simple'; } catch { /* no storage: Simple */ }
  setMode(saved);
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

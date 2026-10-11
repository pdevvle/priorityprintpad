// P0 task 0.3 (emulated part): cold start of the web build, from navigation to the first frame.
//
// Serves a built site directory (the `designcraft-web-<sha>` artefact from wasm.yml) the way a
// production host would, brotli-compressed, and loads it in headless Chromium under throttled
// network and CPU, from an empty cache every run. "First frame" is the moment the app hides its
// loading message, which it does once eframe has started and drawn.
//
// This is an emulation: Chromium's throttling on a server CPU, with software WebGL (SwiftShader).
// It is good for comparing builds and for a first answer to the brief's stop rule. It does not
// replace the real mid-range Android phone the brief asks for, and it does not measure frame
// time while dragging, which needs a real GPU.
//
// Run: node fixtures/p0/coldstart.mjs SITE_DIR [runs]
//      (needs *.br next to each file: brotli -q 11 -k SITE_DIR/*.wasm SITE_DIR/*.js SITE_DIR/*.html)

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const [site, runsArg] = process.argv.slice(2);
if (!site) { console.error('usage: node coldstart.mjs SITE_DIR [runs]'); process.exit(2); }
const RUNS = Number(runsArg || 3);
const PW = process.env.PPS_PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright';
const { chromium } = await import(PW + '/index.mjs');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' };
const server = http.createServer(async (req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(site, path.normalize(rel));
  if (!file.startsWith(path.resolve(site))) { res.writeHead(403); res.end(); return; }
  const br = /\bbr\b/.test(req.headers['accept-encoding'] || '');
  try {
    const src = br ? file + '.br' : file;
    await stat(src);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
                         'cache-control': 'no-store', ...(br ? { 'content-encoding': 'br' } : {}) });
    res.end(await readFile(src));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL = `http://127.0.0.1:${server.address().port}/?webgl`;

// Throughput in bytes per second for CDP. The phone profiles are a mid-range Android on a
// good and on a poor mobile connection; the CPU factor is Lighthouse's mobile default.
const kbps = k => (k * 1000) / 8;
const PROFILES = [
  { name: 'Desktop, broadband (50 Mbps, 20 ms)', cpu: 1, down: kbps(50000), up: kbps(10000), rtt: 20,
    viewport: { width: 1440, height: 900 }, dpr: 1, mobile: false },
  { name: 'Mid-range Android, good 4G (9 Mbps, 85 ms, CPU ÷4)', cpu: 4, down: kbps(9000), up: kbps(1500), rtt: 85,
    viewport: { width: 412, height: 915 }, dpr: 2, mobile: true },
  { name: 'Mid-range Android, slow 4G (1.6 Mbps, 150 ms, CPU ÷4)', cpu: 4, down: kbps(1600), up: kbps(750), rtt: 150,
    viewport: { width: 412, height: 915 }, dpr: 2, mobile: true },
];

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const results = [];
for (const p of PROFILES) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const ctx = await browser.newContext({ viewport: p.viewport, deviceScaleFactor: p.dpr, isMobile: p.mobile, hasTouch: p.mobile });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: p.rtt, downloadThroughput: p.down, uploadThroughput: p.up });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message || e)));
    const t0 = Date.now();
    await page.goto(URL, { waitUntil: 'commit' });
    await page.waitForFunction(() => {
      const l = document.getElementById('designcraft_loading');
      return !l || !l.isConnected || l.style.display === 'none' || getComputedStyle(l).display === 'none';
    }, null, { timeout: 300000, polling: 50 });
    const firstFrame = Date.now() - t0;
    const wasm = await page.evaluate(() => {
      const e = performance.getEntriesByType('resource').find(r => r.name.endsWith('.wasm'));
      return e ? { done: e.responseEnd, bytes: e.encodedBodySize } : null;
    });
    runs.push({ firstFrame, wasmDownloaded: wasm && Math.round(wasm.done), wasmBytes: wasm && wasm.bytes, errors: errors.length });
    await ctx.close();
  }
  const r = { profile: p.name, runs, firstFrameMedianMs: median(runs.map(x => x.firstFrame)),
              wasmDownloadedMedianMs: median(runs.map(x => x.wasmDownloaded || 0)) };
  results.push(r);
  console.log(`${p.name}\n  first frame ${(r.firstFrameMedianMs / 1000).toFixed(1)} s (median of ${RUNS}; runs ${runs.map(x => (x.firstFrame / 1000).toFixed(1)).join(', ')} s)` +
              `\n  of which .wasm download ${(r.wasmDownloadedMedianMs / 1000).toFixed(1)} s (${(runs[0].wasmBytes / 1048576).toFixed(2)} MiB over the wire)` +
              (runs.some(x => x.errors) ? '\n  page errors in some runs' : ''));
}
await browser.close();
server.close();
console.log('\n' + JSON.stringify({ date: new Date().toISOString().slice(0, 10), results }, null, 1));

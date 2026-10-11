# P0 measurements

The brief's P0 (`docs/PPS_DESIGNER_REPO_BRIEF.md` §4 in `pdevvle/priorityprintservice.com`):
measure before building. Nothing here ships. This file mirrors the brief's §9 table until the
brief itself is updated.

## Results

| Measure | Value | Date / build |
|---|---|---|
| `.wasm` raw / gzip / brotli | 37.23 / 14.36 / 8.96 MiB | 2026-10-11, `bf4ab74` (CI `wasm`) |
| JS glue + fonts | 0.15 MiB glue (0.02 brotli). 13 fonts, 4.11 MiB of TTF, are inside the `.wasm` | same |
| Cold start, desktop Chrome | 2.9 s (emulated: 50 Mbps, 20 ms) | 2026-10-11, `coldstart.mjs` |
| Cold start, mid-range Android | 12.1 s on good 4G (9 Mbps, 85 ms, CPU ÷4); 49.4 s on slow 4G (1.6 Mbps, 150 ms, CPU ÷4). **Emulated; a real phone is still needed** | same |
| Drag frame time, desktop / Android | not measured: needs a real GPU and device | |
| Proofer preflight + size check on P0 PDF | pass (size, fonts, colour, layers, interactive); page count n/a for a flat | 2026-10-11, `pps-gates.mjs` against `claude/proofer-parity-staging` |
| RIP pass at the press | waiting on the owner (0.6) | |

Cold start is navigation to the first drawn frame, from an empty cache, median of 3 runs each,
with the site served brotli-compressed. Download is most of it: 2.4 s of 2.9 s on desktop,
9.6 s of 12.1 s on good 4G, 47.7 s of 49.4 s on slow 4G.

These numbers are for upstream's whole egui application, the stand-in the brief uses for P0.
Our shell (P1) drops the egui UI, so they are a ceiling.

## The test postcard (0.4)

`postcard.txt` is a `designcraft-cli` script; `postcard.pdf` is its output, committed as built.
9 × 6 in, two sides, 0.125 in bleed, text in three faces, a placed photo (`photo.jpg`, made by
`make-photo.py`), CMYK shapes.

Checked against the brief's §7 output contract by reading the PDF back:

- MediaBox 666 × 450 pt (trim + 2 × bleed), TrimBox 648 × 432 pt, BleedBox declared.
- Fonts embedded and subset with `ABCDEF+` tags (Source Sans 3 Bold and Regular, Source Serif 4
  Semibold; all OFL, listed in `ASSETS.md`).
- Shapes in CMYK only (`k`/`K` operators), no RGB operators, no transparency groups. CMYK
  percentages are stored as 8-bit fractions: 95% is written as 0.949.
- The photo is DeviceRGB, allowed for the digital press (§7).
- The red corner marker lands top-left: the image is not flipped or rotated.
- PDF/X-4, `designcraft-cli validate-pdf`: valid, no issues.

**Output intent: placeholder.** The PDF carries upstream's built-in "DesignCraft Generic CMYK
(SWOP-like)" profile (brief §3.3). It is not the press's profile. Don't send customer work on it.

To rebuild (from the repo root, after `cargo build --release -p designcraft-cli`):

    target/release/designcraft-cli script fixtures/p0/postcard.txt

## The PPS proofer check (0.5)

    node fixtures/p0/pps-gates.mjs fixtures/p0/postcard.pdf 9 6 0.125

The script hands the PDF to the PPS proofer (`proof-ui-draft.html`) the way a calculator does,
then prints the proofer's own file checks. It needs the proofer served on 127.0.0.1:8137 from a
PPS checkout; the script's header explains how. The proofer's own `tools-proof-size-check-test.mjs`
passed 9/9 in the same setup. As a negative control, the same PDF checked against a 6 × 4 in order
fails the size check.

## Cold start (0.3, emulated)

    node fixtures/p0/coldstart.mjs <site dir> 3

`<site dir>` is the `designcraft-web-<sha>` artefact from the `wasm` workflow, with `.br` copies of
each file next to it. Headless Chromium with throttled network and CPU and software WebGL: good
for comparing builds, not a replacement for a real phone.

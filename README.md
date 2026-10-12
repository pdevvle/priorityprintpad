# PPS Designer

A Canva-style designer for [Priority Print Service](https://priorityprintservice.com) customers.
It turns a product spec into a document, lets the customer design on it, and returns a print-ready
PDF to the calculator page that opened it. It never prices anything, never uploads anything and
never touches the cart; the calculator owns all of that.

It is a modified version of [DesignCraft](https://github.com/storytold/designcraft), the
Rust-native page-layout engine by the ArtCraft team, compiled to WebAssembly. It is not an ArtCraft
product and is not endorsed by the ArtCraft Team.

| Part | Where |
|---|---|
| Engine, render, PDF export (upstream, read-only) | `crates/`, `apps/` |
| JS bridge to the engine | `crates/pps-bridge/` (P1) |
| The editor customers see (`designer.html`) | `shell/` (P1) |
| Builds and release artefacts | `.github/workflows/` |

The plan, the handshake with the calculators and the PDF output contract are in
`docs/PPS_DESIGNER_REPO_BRIEF.md` in
[`pdevvle/priorityprintservice.com`](https://github.com/pdevvle/priorityprintservice.com). Agent
rules are in [CLAUDE.md](CLAUDE.md).

## Status

**P1: Simple and Advanced.** `shell/designer.html` is the editor customers see. Simple (the
default) is laid out like Canva, below. Advanced, one click away, is laid out like InDesign's print
workspace: a tools panel (selection, type, rectangle, ellipse, line, image frame), a Control bar of
exact values (X, Y, W, H in inches, rotation, fill, stroke and weight, opacity, font, style, size,
leading, tracking, alignment), and Pages, Layers (show/hide, lock, order), Swatches (CMYK, fill or
stroke) and Align panels, with zoom. Both have **Order options**: a tab on the right slides out the
order's size, orientation, sides and quantity as the calculator offers them; a change goes back to
the calculator, which re-prices it, and the design follows a new size (`shell/HANDSHAKE.md`).

Simple mode is laid out like Canva:
four things to add (Text: heading, subheading, body; Photos: upload, or open an InDesign IDML file;
Shapes: square, circle, triangle, line; Background colour), a toolbar above the design for whatever
is selected (edit text, style, size, bold, alignment, colour, fill the side, layers, duplicate,
delete) with plain-language tooltips, text boxes that grow to fit their words, undo, warnings for
words near the cut, white edges and blurry photos, and Print, which hands the calculator a PDF/X-4
print file through the brief's §6 handshake. InDesign `.indd` files are closed and can't be read;
they are recognised and the customer is told to save as IDML. Opened on its own it runs a demo
postcard and Print downloads the file.

Preview: <https://pdevvle.github.io/priorityprintpad/> (simple mode) and
<https://pdevvle.github.io/priorityprintpad/full/> (upstream's whole app, the P0 stand-in).
P0 measurements are in `fixtures/p0/README.md`. The postcard calculator opens the designer on staging; production waits on the owner.

## Upstream

Seeded from `storytold/designcraft` at `ca343e8` with its full history. Upstream's own docs are in
[AGENTS.md](AGENTS.md) and `docs/`; ignore their pointers to `plan/`, which is not in this repo.

## License and credits

Dual-licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option, as
upstream is. Required notices are in [NOTICE](NOTICE). Bundled fonts and other assets keep their own
open licences, listed in [ASSETS.md](ASSETS.md).

The ArtCraft name, wordmark and logos are trademarks of the ArtCraft Team. Their brand licence
requires modified versions to remove them, so this repository does not include them.

<sub>Adobe and InDesign are trademarks or registered trademarks of Adobe Inc. in the United States
and/or other countries. This project is not affiliated with, sponsored by or endorsed by Adobe
Inc.</sub>

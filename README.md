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

**P0: measuring.** `wasm.yml` builds upstream's web app (`apps/designcraft-web`) as a stand-in to
measure payload size and load time before any editor UI is written. Nothing ships yet.

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

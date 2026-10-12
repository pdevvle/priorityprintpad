# PPS Designer: instructions for agents

A Canva-style designer for Priority Print Service customers, built on the DesignCraft engine
(Rust compiled to WebAssembly) and opened inside the PPS product calculators. It turns a product
spec into a document, lets a customer design on it, and returns a print-ready PDF. It never
prices, uploads or touches the cart.

## Start every session here

1. Read `docs/PPS_DESIGNER_REPO_BRIEF.md` in
   [`pdevvle/priorityprintservice.com`](https://github.com/pdevvle/priorityprintservice.com): the
   phases (P0 measure, P1 bridge and one flat product), the handshake with the calculators (§6), the
   PDF output contract (§7) and the measurements table (§9). The design rationale is
   `docs/DESIGNCRAFT_STORE_DESIGN.md` in the same repo.
2. Upstream's engine conventions are in [AGENTS.md](AGENTS.md) and `docs/`. They apply here, except
   their pointers to `plan/`: that directory is gitignored upstream and is not in this repo. The
   brief replaces it.

## Where things live

- `crates/`, `apps/`, `xtask/`: upstream DesignCraft, read-only (see below).
- `crates/pps-*`: our Rust. The first is `crates/pps-bridge` (P1), the `wasm-bindgen` layer over
  upstream's public API.
- `shell/`: our editor UI, `designer.html` + `designer.js` + `designer.css`, plain JS (P1, simple
  mode). `shell/test/designer.e2e.mjs SITE_DIR` drives it in headless Chromium; CI runs it.
- `shell/bundle.mjs`: packs a build into the store's release, `pps-designer-<sha>.html` (everything
  inline) plus `pps-designer-<sha>.wasm.gz`. Two files, because the store's deploy tool writes only
  into folders that already exist. CI runs the e2e on the bundle too; `wasm.yml`'s `release` job
  commits it to `designer-releases`.
- `.github/workflows/wasm.yml`: the P0 wasm build and payload measurement.
- Upstream's FreeBSD and Windows ARM64 workflows are removed: they package desktop builds we don't
  ship, and FreeBSD needs a larger runner than this account has. Keep them deleted when merging
  upstream. `release.yml` (runs only on a `release` branch) and `packaging-lint.yml` stay.
- `upstream` remote: `https://github.com/storytold/designcraft`, seeded at `ca343e8`.
- `.github/workflows/upstream-sync.yml` + `.github/scripts/upstream-merge.sh`: every Monday (or Run
  workflow) upstream's main is merged into an `upstream-sync/<sha>` branch, the standing conflicts
  answered (deleted workflows and brand files stay deleted, Cargo.lock is upstream's plus ours,
  README/CLAUDE.md ours), the ArtCraft mark guarded against, the wasm build and e2e started, and a
  draft PR opened. Anything else stops with the files named. Merging the PR stays deliberate.

## Rules

**Operator.** The owner works only through Claude on the web and has no local terminal. Never
resolve anything with "run this locally". Do builds and pushes from the session or from CI.
If a push is refused, say so and ask; don't hand the owner a command.

**Upstream crates are read-only.** Our code lives in new crates (`crates/pps-*`) and
`shell/`. A fix needed in an upstream crate goes upstream as a PR, or into ours as a new
command. It is never edited in place. Merging upstream must stay a clean fast-forward of
their files. Merge deliberately, on a branch, behind the gates in the brief's §7 and the PPS
repo's e2e suite, and never on the day of a release. The one standing exception is the ArtCraft
trademark removal in `crates/ui-egui/src/about.rs` and `chrome.rs`; keep it when merging.

**Upstream's own rules still apply to their crates and to ours:** no panics in non-test code
(`unwrap`, `expect`, `panic!`, indexing on input; `unsafe_code = "forbid"`), errors as
`Result`, enforced layering (`cargo xtask layers`), and `cargo xtask ci` green before every
commit. Never break the wasm build.

**No pricing, ever.** No prices, cost constants, margins or formulas in this repo. It is
public, and pricing lives only in the PPS calculators. The price chip shows what the host
sends.

**The designer never uploads and never touches the cart or a nonce.** Everything after
`pps-design:print` belongs to the host page.

**Deploys are pinned.** A release is a commit SHA plus its CI artefacts. The PPS site pulls a
release by SHA. Rolling back means pulling an older SHA. Never hand-copy files onto a server.
A change that exists only on a server is lost at the next deploy.

**Brand and assets.** No ArtCraft marks (brand licence). No Adobe assets (upstream policy).
Every font, image or template has a row in `ASSETS.md` with its licence.

**Check every claim against the PDF.** A feature is done when the exported bytes, reloaded,
prove it. Looking right on the canvas isn't enough.

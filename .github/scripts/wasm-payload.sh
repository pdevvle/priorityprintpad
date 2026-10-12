#!/usr/bin/env bash
# P0 task 0.2: measure the web build's payload.
#
#   wasm-payload.sh <site dir> <out dir>
#
# Reports raw, gzip (-9) and brotli (-q 11) sizes of the .wasm and the JS glue, and the bundled
# fonts compiled into the .wasm (crates/fonts/src/fontdb.rs). Writes <out dir>/payload.md and
# <out dir>/payload.json, and appends the table to the job summary when run in Actions.
set -euo pipefail

SITE=${1:?site dir}
OUT=${2:?out dir}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$OUT"

wasm=$(find "$SITE" -maxdepth 1 -name '*_bg.wasm' | head -n1)
# The glue is named after the module: foo_bg.wasm → foo.js (the site may hold other scripts).
js=${wasm%_bg.wasm}.js
[ -f "$js" ] || js=""
[ -n "$wasm" ] || { echo "error: no *_bg.wasm in $SITE" >&2; exit 1; }
[ -n "$js" ] || { echo "error: no .js glue in $SITE" >&2; exit 1; }

raw() { stat -c %s "$1"; }
gz() { gzip -9 -c "$1" | wc -c; }
br() { brotli -q 11 -c "$1" | wc -c; }
mib() { awk -v b="$1" 'BEGIN { printf "%.2f MiB", b / 1048576 }'; }

w_raw=$(raw "$wasm"); w_gz=$(gz "$wasm"); w_br=$(br "$wasm")
j_raw=$(raw "$js"); j_gz=$(gz "$js"); j_br=$(br "$js")

# Fonts are not separate requests: crates/fonts embeds them with include_bytes!.
fonts=$(grep -o 'assets/fonts/[^"]*\.ttf' "$ROOT/crates/fonts/src/fontdb.rs" | sort -u)
f_count=0; f_raw=0
for f in $fonts; do
  f_count=$((f_count + 1))
  f_raw=$((f_raw + $(raw "$ROOT/$f")))
done

total_br=$((w_br + j_br))
sha=${BUILD_SHA:-${GITHUB_SHA:-$(git -C "$ROOT" rev-parse HEAD)}}
date=$(date -u +%Y-%m-%d)

cat >"$OUT/payload.md" <<EOF
### Web payload, \`${sha:0:7}\` (${date})

| File | Raw | gzip -9 | brotli -q 11 |
|---|---|---|---|
| \`$(basename "$wasm")\` | $(mib "$w_raw") | $(mib "$w_gz") | $(mib "$w_br") |
| \`$(basename "$js")\` (JS glue) | $(mib "$j_raw") | $(mib "$j_gz") | $(mib "$j_br") |
| **Total over the wire (brotli)** | | | **$(mib "$total_br")** |

Fonts: ${f_count} bundled OFL fonts, $(mib "$f_raw") of TTF, are compiled into the \`.wasm\`
(\`crates/fonts/src/fontdb.rs\`), so they are inside the sizes above, not extra requests.
Built without \`CRAFT_FONTS_DIR\`, so no Japanese fonts.
EOF

cat >"$OUT/payload.json" <<EOF
{
  "sha": "$sha",
  "date": "$date",
  "wasm": { "file": "$(basename "$wasm")", "raw": $w_raw, "gzip": $w_gz, "brotli": $w_br },
  "js": { "file": "$(basename "$js")", "raw": $j_raw, "gzip": $j_gz, "brotli": $j_br },
  "fonts_embedded": { "count": $f_count, "raw_ttf": $f_raw }
}
EOF

cat "$OUT/payload.md"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  cat "$OUT/payload.md" >>"$GITHUB_STEP_SUMMARY"
fi

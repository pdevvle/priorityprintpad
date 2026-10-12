# The designer ↔ calculator handshake (`pps-design:*`, v 1)

The brief's §6 (`docs/PPS_DESIGNER_REPO_BRIEF.md` in `pdevvle/priorityprintservice.com`) defines
the handshake. This file records it as the designer implements it, including the Order options
messages added after the brief.

Every message is a `postMessage` of `{ type, v: 1, ... }` between a calculator page and the
designer in a same-origin iframe. Each side checks `ev.origin === location.origin`, the expected
source window, and `v === 1`, and ignores anything else.

## Designer → calculator

| type | payload | when |
|---|---|---|
| `pps-design:ready` | none | The engine has loaded. |
| `pps-design:option` | `key`, `value` (string or number) | The customer changed an Order option. |
| `pps-design:print` | `pdf` (ArrayBuffer, transferred), `design` (base64), `thumbs` (data URLs, one per page), `manifest` | Print, after the checks. |
| `pps-design:close` | `design` (base64, or null) | Back. The work is kept. |
| `pps-design:error` | `message` | The designer can't continue (engine load, unusable spec). |

## Calculator → designer

| type | payload | when |
|---|---|---|
| `pps-design:job` | `spec`, `design?`, `options?` | Answer to `ready`. Starts the design, or reopens `design`. |
| `pps-design:price` | `total`, `qty?`, `turnaround?` (business days to print) | Any time. Display only. |
| `pps-design:options` | `options` | Any time. Replaces the Order options list. |
| `pps-design:spec` | `spec` | The order's size or sides changed. The open design is resized to it. |

**Spec.** It is in points, with the trim's top-left at 0,0:

```
{ trimW, trimH, bleed?, safety?, pages, pageMultiple?, folds?, perfs?, panelLabels?, bindEdge?, spine? }
```

**Folds and perforations.** `folds` and `perfs` are lists of lines, at most 16 each:

```
{ page, axis: 'v' | 'h', at }
```

- `page` is 0-based.
- `axis: 'v'` is a vertical line at x = `at`; `axis: 'h'` is a horizontal line at y = `at`.
- `at` is in points from the trim's top-left.
- Lines are given per page, as each page is seen. A back page turned over left to right has its
  vertical lines mirrored. The calculator works out the positions, including a trifold's narrower
  inside flap.

`panelLabels[page]` names the panels between that page's folds, in order (left to right, or top to
bottom).

The designer draws these as guides that never print, and flags words on or within the safety
margin of a fold or perforation. A folded two-page job is shown as Outside and Inside. The
designer includes the lines in its print `manifest`.

**Options.** At most 12. A `select` option needs `choices`; a `number` option takes `min`, `max`
and `step`:

```
[{ key, label, type: 'select' | 'number', value,
   choices?: [{ value, label, group? }], min?, max?, step?, help? }]
```

## Order options

The designer draws the options as a panel that slides out from a tab on the right. The
calculator owns them: it decides which fields to offer, what they mean, and what they cost. The
designer only shows them and reports a change.

1. **The designer reports the change.** It sends `pps-design:option`.
2. **The calculator applies it** to its own fields, the same way its form would, and replies with
   any of:
   - `pps-design:price`, the new price;
   - `pps-design:options`, the options with their new values;
   - `pps-design:spec`, if the size or the number of sides changed.
3. **The designer follows a new spec.** It resizes the document:
   - each object keeps its place relative to the card and keeps its shape, scaled evenly;
   - anything that covered the whole card, such as a background or a photo filling the side,
     still covers the new card out to the bleed;
   - text is scaled with the design.
4. **Undo stops at the resize**, so the design can never drift from the size being priced.

**Removing a side that has a design on it.** The designer asks the customer first. If they say
no, it sends the old value back as `pps-design:option`.

**Orientation.** The postcard calculator adds orientation to the list itself. The price is the
same either way, so the calculator keeps it out of its own fields and only changes the spec.

**Standalone.** Opened without a calculator (the preview), the designer plays the calculator's
part with a few demo sizes and no prices.

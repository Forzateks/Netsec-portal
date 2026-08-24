# Notion Design System — NetSec Portal adoption notes

**Shipped:** v160 (2026-08-12)
**Source spec:** `docs/design/notion-design-system.md`
**Touches:** `css/styles.css` (token layer + chrome), `index.html`,
`manifest.webmanifest`, and inline styles across `js/core/*` + `js/features/*`.

This records **how** the spec was mapped onto an existing app, and **where we
deliberately diverge**. The spec describes a marketing site; NetSec Portal is a
data-dense internal ops tool, so a few rules had to bend. Read this alongside the
spec before making styling changes.

---

## 1. Strategy — remap the token layer, don't rewrite call sites

The app already had a two-tier token system: short legacy names (`--navy`,
`--teal`, `--muted`, …) referenced **~985 times** across `js/` and `index.html`,
plus a newer `--color-*` semantic tier.

Rather than touch 985 call sites, the legacy names were **re-pointed** at Notion
values in `:root`. The whole app re-skinned at once and the names stay valid.

| Legacy token | Was | Now | Why |
|---|---|---|---|
| `--navy` | `#0A1F5C` | `--nx-ink` (`#0d0d0d`) | 177 of 192 uses are `color:` on headings — that's Notion **ink**, not a dark band |
| `--teal` | `#00A0D2` | `--nx-primary` (`#0075de`) | 93 of 108 uses are accent/link/active — this is the one structural blue |
| `--gold` | `#C8A832` | `--nx-orange` (`#dd5b00`) | warnings + Eve band |
| `--bg` | `#F0F2F7` | `--nx-canvas` (`#f6f5f4`) | the warm paper canvas |
| `--card` | `#FFFFFF` | `--nx-surface` | unchanged in value, now named |
| `--muted` | `#6b7280` | `--nx-ink-muted` (`#615d59`) | Notion's warm Stone |
| `--border` | `#e5e7eb` | `--nx-hairline` (`#e6e6e6`) | hairline |

> **Do not** re-point `--navy` at a dark band colour. It is a *text* token in this
> codebase. Dark surfaces should use `--nx-secondary` / `--color-secondary`.

## 2. Deliberate divergences from the spec

### 2.1 A semantic danger colour exists
The spec states Notion "does not expose a dedicated error/success palette".
An ops app cannot work that way — it has destructive deletes, rejected OT, expired
contracts and failed saves. So:

- `--danger: #d93025` is **kept as a real semantic token**. It has no Notion source.
- `--success` and `--color-warning` are mapped onto sticker green `#1aae39` and
  sticker orange `#dd5b00` rather than inventing new hues.

### 2.2 The sticker palette also carries data categories
The spec is emphatic that sticker colours "never structure the layout or paint a
CTA … they decorate". We honour the CTA half of that rule absolutely — **no CTA or
structural fill uses a sticker colour**. But we *do* use the sticker palette for
**OT band badges and status dots**, which the spec explicitly sanctions as
"category dots":

| Band token | Colour | Sticker source |
|---|---|---|
| `--early` | `#1aae39` | green |
| `--eve` | `#2a9d99` | teal |
| `--mid` | `#6b3fa0` | purple (see note) |
| `--wknd` | `#dd5b00` | orange |
| `--day` | `#615d59` | stone |

Values were chosen from the sticker family but shifted toward the readable end —
the raw palette (e.g. `#d6b6f6` purple, `#62aef0` sky) is tuned for illustration
fills and fails contrast as badge text.

> **v162 correction.** `--mid` originally used sticker deep-purple `#391c57`.
> At badge size that reads as black, indistinguishable from the Day badge, and in
> chart palettes it collided with ink `#0d0d0d` as a second near-black. It is now
> `--nx-purple-mid` `#6b3fa0`, a mid tone that keeps the hue legible. The same
> swap was applied to the six hardcoded `#391c57` uses in dashboard/leave/
> projects/unified-sessions (chart palettes, sick-leave text, per-person series).

### 2.3 Pale status-pill pairs survive
Status chips (`#fee2e2`/`#b91c1c` red, `#ecfdf5` green, `#fffbeb`/`#793400` amber)
keep their pale-fill + dark-text structure. These are functional, contrast-tested
badges. Their amber text was retuned to Notion's deep orange `#793400`.

### 2.4 No monospace face — numerals moved to `tabular-nums`
The spec mandates a single family. CLAUDE.md previously mandated **DM Mono** for
hours/dates/money/serials. DM Mono is gone: **104 inline `font-family:DM Mono`
declarations** across `index.html` and 10 JS files were replaced with
`font-variant-numeric:tabular-nums`, which preserves column alignment in Inter.

> When rendering numeric data, use `font-variant-numeric:tabular-nums`.
> **Never** reintroduce a monospace font-family.

SVG chart labels are the one exception — SVG `<text>` needs an explicit
`font-family="Inter,sans-serif"` attribute.

### 2.5 The dark "night" band is currently unused
The spec reserves `--nx-secondary` (`#213183`) for a single inverted hero band.
The app has no marketing hero, so the token is defined but unpainted. If a dark
band is ever wanted (a login hero, a dashboard banner), use that token — and only
in **one** place, per the spec.

### 2.6 Top-bar shimmer disabled
The old navy top bar had a drifting gloss `::after`. On a white bar it reads as a
smear. The rule is kept but neutered (`background:none; animation:none`) so it's a
one-line revert rather than a deletion.

## 3. Shape + elevation mapping

`border-radius` was remapped onto the Notion scale in **141 places**:

| Was | Now | Token |
|---|---|---|
| 6px | 5px | `--radius-sm` |
| 8px, 10px | 8px | `--radius-md` |
| 12px, 14px | 12px | `--radius-lg` |
| 16px, 20px | 16px | `--radius-xl` |
| 999px | 9999px | `--radius-full` |

Inputs dropped to `--radius-xs` (4px) per the spec — **do not** give form fields a
pill radius. Primary CTAs went full pill; utility/nav buttons sit at 8px.

Elevation is now `--shadow-1` / `--shadow-2` (the spec's many-layer, near-transparent
stacks). Most cards are **Level 0** — hairline, no shadow at all. The old "Aero
pillow" gradients, inset highlights and text-shadows on `.btn-primary`, `.card` and
the modal cap bar were removed outright.

## 4. What was NOT done

- **Typography scale is not fully applied.** The tracking tokens
  (`--track-display`, `--track-h1`, …) are defined and used on the brand wordmark,
  but the app's heading sizes (`--fs-*`) are unchanged — this is a dense ops UI, not
  a 64px-hero marketing page. Applying the spec's display sizes wholesale would
  break table-heavy screens.
- **No layout/grid changes.** The spec's centred 1080–1300px marketing container
  does not apply to a sidebar app shell.
- **Illustration/sticker artwork.** The spec's personality comes largely from
  illustrated stickers and colour-blocked tiles. None were added — the app has no
  illustration assets.

## 6. Night mode (v169)

Dark mode inverts **lightness, not hue**. A true mathematical inversion would
turn the brand blue orange, danger cyan and success pink — destroying both the
brand and the meaning of every status colour. So each token keeps its hue and
moves along the lightness axis:

| Role | Light | Dark |
|---|---|---|
| canvas | `#f6f5f4` | `#191919` |
| surface | `#ffffff` | `#232323` |
| hairline | `#e6e6e6` | `#383838` |
| ink | `#0d0d0d` | `#ededec` |
| primary | `#0075de` | `#4a9eff` |
| danger | `#d93025` | `#f28b82` |

**Never pure black.** `#000` under near-white text causes halation and smears
for astigmatic readers; the canvas sits at `#191919`, as Notion's own dark mode
does.

**Surfaces get lighter as they come forward** — canvas → card — the opposite of
light mode, because on a dark ground elevation reads as light, not as shadow.
`--shadow-1/2` are near-transparent black and effectively invisible on dark, so
separation there comes from the hairline.

`--color-on-primary` flips to a near-black (`#101418`): the dark-mode primary is
a *light* blue, so text sitting on it must be dark. Any rule that had
`color:white` on a coloured fill now uses this token — `background:var(--navy);
color:white` would otherwise be white-on-near-white in dark mode.

### Three states, not two
```css
:root { /* light */ }
:root[data-theme="dark"] { /* explicit choice */ }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { /* auto */ } }
```
`:root:not([data-theme="light"])` **must** stay inside the media query — on its
own it matches when no theme is set and would force dark on everyone.

The theme is applied by an inline script in `<head>`, before the stylesheet. Run
any later (init.js loads last) and a night-mode user gets a white flash on every
load.

### What this forced
Dark mode only works if colour is tokenised, and it was not. This release
converted **264 hardcoded colours in JS/HTML** and **523 in `css/styles.css`** —
the v160 sweep had only ever covered JS and HTML, so the stylesheet was still
carrying pre-Notion Tailwind greys (`#f8fafc` ×43, `#f1f5f9` ×40) in *light*
mode. Six status-pill families became paired tokens
(`--pill-*-bg` / `-fg` / `-bd`) so a pale-fill badge has a dark-mode counterpart.

Only one literal remains outside the token blocks: `#05102e`, the login video
scrim, which is meant to stay dark in both themes.

### Contrast is machine-checked
19 token pairs are asserted in both themes (4.5:1 for text, 3:1 for marks). That
check found two **pre-existing** light-mode failures inherited from the Notion
palette: `--nx-ink-faint` at 2.66:1 and `--nx-green` at 2.93:1, both used for
text here. They are now `#736e69` and `#118029`, and dark-mode `--nx-ink-faint`
was lifted to `#8f8983` to clear 4.5:1 rather than only the 3:1 large-text bar.

---

## 5. Provenance

This is an external design system adapted for internal use. NetSec Portal is not a
Notion product and must not present itself as one — no Notion wordmark, logo or
branding is used anywhere.

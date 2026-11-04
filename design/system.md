# Design system (short)

The site uses the house style `web-style-gradient`. `src/css/tokens.css`, `src/css/base.css` and `src/js/kit.js` are kit copies; their changes are marked in each file header. Page-specific code lives in `src/css/site.css` and `src/js/viz.js`.

## Tokens used

- Surfaces and text: `--bg --bg2 --card --line --line-strong --fg --muted`, `--code-bg/--code-fg` (the tree panel). There are two palettes, light "paper" and dark "night", designed separately (kit). The site adds no colour of its own.
- Accent roles:
  - `--accent-a` is the **Claude** family; `site.css` aliases it as `--fam-a`.
  - `--accent-b` is the **Codex** family (`--fam-b`). These two are the kit's comparison pair, and their gradient carries large text, rules and bars.
  - `--accent-c` is interaction: active step, selected risk row, focus ring, the packet.
- Composite tints are `color-mix(<accent> 6-13%, var(--card))`. They are used for lit gate items, required cells, the selected row, the current table row and pinned Viz B items. Text on them is `--fg` or `--muted`. All pairs were measured in both themes, all ≥ 4.5:1 (lowest: `accent-a` gate state on its 9% tint in light, 4.83:1). Control borders are ≥ 3:1. Gradient text is used for `h1 em` only.
- Type: system sans for EN (no webfont), mono for labels, weights 400 and 700 only. Scale `--fs-*` (13/15/17/18-21/26-36 px); the hero h1 is 38-58 px. Prose is capped at `--measure` (68ch).

## Korean type

- `ko-font.css` is linked only from `/ko/` and is the only file that names the KO family `SCDream`. It holds 400 = `SCDream4.otf` and 700 = `SCDream6.otf`, both unmodified, with `font-display: swap`. The faces use no `local()`, and there is no preload.
- Shared CSS carries the fallback stack only: `"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif`.
- First paint uses `"SCDream Fallback"`, a `local()` Noto Sans CJK KR / Noto Sans KR face with metric overrides (values measured in Chrome):
  - 400: `size-adjust` 104.35%. Hangul advance is .96 em in S-Core Dream and .92 em in Noto.
  - 700: 102.4%, the measured ratio on this page's bold text.
- First visit: after the first contentful paint, the `/ko/` head script loads both SCDream faces and then sets `html.ko-font`, switching to them in one step. Later visits set the class before first paint (`localStorage["ppk-kofont"]`).
- Result: the 1.47 MB of OTF never delays first paint, and the swap moves nothing vertically in a 412 px viewport.
- Leading is `--lh-body` 1.75 and headings 1.3 (`html[lang=ko]`), with `word-break: keep-all`. Uppercase and letter-spacing are dropped for KO labels.

## Motion rules

- Only `transform` and `opacity` animate or transition. Colour, border and shadow state changes are instant.
- Every animation's resting state is the final picture:
  - the hero board shows a full rail with every check;
  - the gate matrix shows the selected row lit;
  - the reveal shows content in place.
- `prefers-reduced-motion: reduce` (including a change at runtime) uses the kit block in `base.css`: no animation and no transition. `html.motion-off`, set by the "Pause motion" button and saved in `ppk-motion`, applies the same rules. Under either one, `document.getAnimations().length === 0`.
- Loops:
  - The hero glow drifts on a 22 s cycle.
  - The hero board runs an 8 s cycle: the packet hops tier to tier, rows light, checks appear and the rail fills.
  - The board's gradient ring rotates once every 10 s.
  - All of these pause while the tab is hidden or the hero is off screen, and stop under Pause motion or reduced motion.
- One-shots:
  - reveal-on-scroll, 600 ms;
  - Viz A packet, 900 ms;
  - Viz A gate lighting, 3 × 110 ms stagger;
  - Viz C row lighting (cells 4 × 90 ms + 300 ms, pipe 560 ms; ≤ 600 ms in total);
  - Viz B link fade-in, once.
- Autoplay happens only after Run (Viz A). Under reduced or paused motion, Run advances exactly one step.

## Viz anatomy

- **Hero board** (aria-hidden, labelled "Illustrative"): four tier rows (title + model of the family) on a rail, with the family legend.
- **Viz A** `#fig-arch` (`[data-viz-a]`):
  - Controls: a risk selector (`role=group`, buttons with `aria-pressed`), four tier nodes in an `<ol>`, and Run/Pause, Step and Reset.
  - Caption: a `role=status aria-live=polite` caption, with `aria-current="step"` on the active node.
  - Content: Tier 2 shows the lead model by risk; Tier 4 lists four gates with "runs" / "not run" in text (dashed and struck through when off).
  - Layout: vertical on screens < 1024 px, one row from 1024 px.
  - Twin: `details[data-twin-for=fig-arch]` (ordered list) plus Table 1.
- **Viz C** `#fig-gates` (`[data-viz-c]`):
  - Rows are risk levels; each row's button drives the shared risk state. Columns are the four gates, coloured by family.
  - Cells say "required" or "not run" in text. A pipe line fills across the selected row.
  - Layout: cards (2 × 2 cells) below 640 px.
  - Twin: Table 3, generated from `facts.json`.
- **Viz B** `#fig-providers` (`[data-viz-b]`):
  - Two real lists (Claude, Codex) of buttons, which make the figure its own text twin.
  - Hover or focus highlights the counterpart role; Space or Enter pins it; Escape clears.
  - On desktop an SVG band draws one curve per shared role. Rows are kept equal with CSS subgrid and `contain: size` on the band.
  - Layout: stacked below 760 px.
- **Shared risk state:** selecting a risk anywhere updates both selectors, the Tier 2 lead model, the Tier 4 gates and caption, the Viz C row and the Table 1 current row.

## Build contract (template)

`scripts/build.mjs` documents the template tags. The page structure that QA relies on:
- `main > section[id]` × 10: `hero problem how routing gates providers lifecycle helpers limits faq`.
- `figure[id]`: `fig-problem fig-arch fig-gates fig-providers fig-lifecycle`.
- Tables: `tbl-routing tbl-codex tbl-gates`.

Both pages come from the same template, so they have the same DOM.

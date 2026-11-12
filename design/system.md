# Design system (short)

The site uses the house identity **Paper & Lamp**: warm paper and off-white cards in light mode, a separately designed warm lamplight palette in dark mode, one accent per project plus one comparison colour, numbered section cards, one takeaway band per page, 44 px targets, no gradients and no shadows. `src/css/tokens.css` is the kit's token file; `src/css/base.css` and `src/css/site.css` follow the kit's `base.css`, `components.css` and `landing.css` rule shapes, adapted to this site's class names. `src/js/kit.js` is the site's own controller (theme, language links, reveal, motion), not the kit script.

## Tokens

- `src/css/tokens.css` is the kit file verbatim, with its two fenced blocks (`=== ACCENT` and `=== ACCENT-DARK`) set to the catalogue entry **`teal`** (light accent `#00766c`, dark `#60bcb0`; comparison amber `#e69f00` / `#e0a33a`). The accent is registered for this site in the kit's accent registry. The build copies the file unchanged to `dist/assets/css/tokens.css` (comments kept, so the fences survive) and every page links it before `assets/site.css`. Only this file holds colour literals (and the standalone `favicon.svg`).
- Neutral tokens: `--bg --surface --ink --muted --line --control --focus --code-bg --media-bg --ph-stripe --on-media --warn --warn-text --warn-fill --series-other --series-other-text`; accent tokens: `--accent --accent-strong --accent-tint --accent-soft --on-accent --band --on-band --compare --compare-text --compare-tint`. There is no dark palette under `prefers-color-scheme` (kit rule).
- Site tokens without colour live in a `:root` block at the top of `base.css`: type scale `--fs-*`, `--measure` (68ch), space `--sp-*`, radii `--radius-*` (aliases of the kit's `--r-s --r --card-r`), motion `--dur-* --ease*`, `--font-label` (= the body font), `--disc`.

## Role mapping

| role | token |
|---|---|
| Claude family (fills, dots, bars) | `--fam-a` = `--compare`; text and marks that must be seen `--fam-a-text` = `--compare-text`; tint `--fam-a-tint` = `--compare-tint` |
| Codex family | `--fam-b` = `--fam-b-text` = `--accent`; tint `--fam-b-tint` = `--accent-tint` |
| done / main lane / success | `--accent` |
| links, link-like and note icons | `--accent`, hover `--accent-strong` |
| selected control (pressed risk segment, selected matrix risk) | fill `--ink`, text `--surface` |
| current node (Viz A tier, selected matrix row) | 2px `--ink` border on `--surface` |
| current table row | `--accent-tint` fill, `--accent-strong` 700 text |
| packets | `--ink` |
| control borders, off / skipped / manual borders, dashed return paths, tree lines | `--control` |
| figure wells (Viz A stage, Viz C matrix) | `--bg`; the tree panel `--code-bg` |
| focus ring | 3px `--focus`, offset 3px |
| `::selection` | `--accent-soft` fill, `--ink` text |

Claude = comparison (left in Viz B), Codex = accent (right), as the kit's compare/ours convention. Every family-coloured mark has the family name in text next to it or in its row/column header. Text on a family tint is `--ink` or the family text colour (both ≥ 4.5:1 in both themes). The helper tiles' icons are all `--accent` (kit feature tiles), so no icon suggests a family it does not belong to.

## Components

- **Nav** (`.topbar`): sticky `--surface` bar, 1px `--line` rule, 60 px. Brand = two-circle mark (`--compare`, `--accent`) + name, 900 (KO 700), `--accent`. Section links 700 `--muted`, 44 px, hover `--accent-tint`; hidden below 860 px. The language link and theme button are kit controls: 44 px pills with a 2px `--control` border (the theme button 44 × 44).
- **Hero**: `--surface` with a 6px `--accent` bottom rule; columns 7fr / 5fr, stacking at ≤ 900 px. The eyebrow is a kit tag; `h1` 900 (KO 700) in `--ink`, its `em` in `--accent` (no gradient text). Stats are kit stat tiles (`--accent-tint`, number in `--accent`).
- **Takeaway band**: the hero lede (`.lede.band`), in place: `--band` fill, `--on-band` 700 text, radius 16 px. One per page.
- **Section cards**: every numbered section is `section > .wrap > .card` (2px `--line`, radius 16 px, `--surface`) on the `--bg` page. The section number in the kicker is a numbered disc (`.disc`, 46-60 px, `--accent` / `--on-accent`, Lato 900) left of the kicker + `h2` pair; the separator `.kicker-sep` stays in the DOM, visually hidden.
- **Buttons** (`.btn`): pill, 2px border, 44 px, 700. Primary = `--accent` fill with `--on-accent`, hover `--accent-strong` fill; secondary = accent outline; ghost = `--control` border with `--ink` text. Outline and ghost hover = `--accent-tint` fill with `--accent-strong` text. Every hover rule states colour and background together.
- **Inner panels** (comparison cards, flow nodes, table wrappers, helper tiles, limits, commands, cross notes): `--surface`, 2px `--line`, radius 12 px. **Callout** (`.callout`): `--accent-tint`, 2px `--accent` border. **Illustrative chip**: 2px dashed `--control` pill, `--muted` 700.
- **FAQ** and text twins: native `details` with an accent chevron; 2px `--line` rules.
- **Footer**: `--muted`, 2px top rule; the KO S-Core Dream credit line stays.
- Type: kit body `400 clamp(16px, .45vw + 13.5px, 18px)/var(--lh)`, `h2`/`h3` per kit, labels in the body font (mono only for code, paths and branch names). KO: `word-break: keep-all`, line height 1.75, no negative letter-spacing, no uppercase.

## Korean type

- `ko-font.css` is linked only from `/ko/` and is the only file that names the KO family `SCDream`. It holds 400 = `SCDream4.otf` and 700 = `SCDream6.otf`, both unmodified, with `font-display: swap`. The faces use no `local()`, and there is no preload.
- Shared CSS carries the kit's fallback stack only (`--font-ko`); `ko-font.css` puts the families first on KO pages.
- First paint uses `"SCDream Fallback"`, a `local()` Noto Sans CJK KR / Noto Sans KR face with metric overrides (values measured in Chrome):
  - 400: `size-adjust` 104.35%. Hangul advance is .96 em in S-Core Dream and .92 em in Noto.
  - 700: 102.4%, the measured ratio on this page's bold text.
- First visit: after the first contentful paint, the `/ko/` head script loads both SCDream faces and then sets `html.ko-font`, switching to them in one step. Later visits set the class before first paint (`localStorage["ppk-kofont"]`).
- Result: the 1.47 MB of OTF never delays first paint.

## Motion rules

- Only `transform` and `opacity` animate or transition. Colour and border state changes are instant.
- Every animation's resting state is the final picture:
  - the hero board shows a full rail with every check;
  - the gate matrix shows the selected row lit;
  - the reveal shows content in place.
- `prefers-reduced-motion: reduce` (including a change at runtime) uses the block in `base.css`: no animation and no transition. `html.motion-off`, set by the "Pause motion" button and saved in `ppk-motion`, applies the same rules. Under either one, `document.getAnimations().length === 0`.
- Loop: the hero board runs an 8 s cycle (the packet hops tier to tier, checks appear and the rail fills). It pauses while the tab is hidden or the hero is off screen, and stops under Pause motion or reduced motion. The old decorative motion (hero glow drift, rotating board ring, row glow) is gone.
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
  - Hover or focus highlights the counterpart role (its curve in `--ink`); Space or Enter pins it; Escape clears.
  - On desktop an SVG band draws one curve per shared role. Rows are kept equal with CSS subgrid and `contain: size` on the band.
  - Layout: stacked below 760 px.
- **Shared risk state:** selecting a risk anywhere updates both selectors, the Tier 2 lead model, the Tier 4 gates and caption, the Viz C row and the Table 1 current row.

## Build contract (template)

`scripts/build.mjs` documents the template tags. The page structure that QA relies on:
- `main > section[id]` × 10: `hero problem how routing gates providers lifecycle helpers limits faq`.
- `figure[id]`: `fig-problem fig-arch fig-gates fig-providers fig-lifecycle`.
- Tables: `tbl-routing tbl-codex tbl-gates`.

Both pages come from the same template, so they have the same DOM.

## Documented limits

1. JavaScript off: the light theme (kit limit (a)); the old `prefers-color-scheme` dark fallback is removed on purpose.
2. No EN webfont: the kit's stack starts with Lato, which renders only where it is installed; otherwise `Segoe UI` / system sans. The site's QA requires zero font requests on EN pages.
3. The kit checker run on the built site (`check_kit.py --site dist`): token contract and contrast (check 2) and no hard-coded colours (check 7) pass. Check 6 does not apply (each page needs its two absolute `hreflang` links, which the site's own no-network QA exempts), nor does check 9 (the kit's single `assets/fonts/` layout with Lato; the site keeps S-Core Dream in `fonts/ko`, linked only from KO pages).
4. Section links are hidden below 860 px, as before (no kit menu sheet).
5. Visual taste is advisory (kit limit (d)); the gates cover contrast, targets, overflow and behaviour.

## Workflow page (`/workflow/`, `/ko/workflow/`)

A second page pair for researchers, built from `src/workflow.html` and `content/workflow.{en,ko}.json` through the page table in `scripts/build.mjs`. It shares the top bar, theme and motion controls, fonts, tokens and both asset bundles with the home page. Its styles are in `src/css/workflow.css` (appended to `assets/site.css`; every selector is a `wf-*` or `loop-*` class) and Figure 1's controller is `src/js/loop.js` (appended to `assets/site.js`; it does nothing on a page without `[data-viz-loop]`). The home page links to it from the 6th top-bar item.

Page structure that QA relies on:
- `main > section[id]` × 7: `hero loop methods flows roles manual tips`.
- `figure[id]`: `fig-loop fig-pipeline fig-reviews fig-gpu fig-roles`. Each one holds a `details.twin[data-twin]` ("Show as text") with the ordered lists and, for the reviews, the GPU board and the roles, a real `<table>` (`tbl-reviews tbl-gpu tbl-roles`).
- The Illustrative chip (`.wf-ill`, `meta.illustrative`) is on `fig-loop` (stage chips), `fig-reviews` (score strip) and `fig-gpu` (lock board).

Figures:
- **Figure 1** `#fig-loop` (`[data-viz-loop]`, `data-interval` 1600 ms): seven stage cards, each with an icon, a title, one line and its Illustrative chips (styled per stage: session badges with a message link, worktree and branch in mono, GPU held/free/unmanaged, LaTeX outputs, review chips by family).
  - Layout: from 1024 px the stages run clockwise round the edge of a 3 × 3 grid (equal rows), with arrows in the gaps. The left middle cell carries the dashed return path from stage 7 to stage 1, and the centre holds a hub with the stage number and a hand. Below 1024 px the stages form one column with a gradient rail and a loop-back mark.
  - Controls: Run/Pause (one button), Step, Reset, "Show as text". The caption is `role=status aria-live=polite` ("Stage n: title — text"), and the active card has `aria-current="step"`.
  - Run autoplays one full lap and then stops. Under reduced motion or `html.motion-off`, Run advances one stage and a running autoplay stops.
  - Motion: the hand rotates to the active card (angle measured from the layout, forward round the loop, the shortest way on Reset). The active card lifts (transform), and a one-shot arrival ring fades (opacity, 700 ms).
- **Figure 2** `#fig-pipeline`, **Figure 3** `#fig-reviews`, **Figure 4** `#fig-gpu`: step chips (`.wf-steps`) with gradient arrows, in a column below 1024 px and in a row from 1024 px. The reviewer cycle adds a dashed `--accent-c` return path from Gate to Review. Each step draws its piece of the path, so no geometry is guessed.
  - The score strip shows each label on a six-level meter (`data-level` per chip, fixed in the template for the synthetic rows) with an open-majors badge.
  - The lock board places holds on a ten half-hour grid from 1024 px (`--span` per hold, fixed for the synthetic rows) and stacks them on phones.
- **Figure 5** `#fig-roles`: six role cards with a family bar and model chip (Claude `--accent-a`: orchestrator, lead, Claude dev; Codex `--accent-b`: Codex, gates; both: mock reviewers).
- Methods: ten icon tiles (icon ids from the copy: `branch worktree repo macro gpu review cross pen palette gauge`). There are four columns from 1024 px, and the last two tiles span two columns.

Motion on this page: the hero glow (as on home), Figure 1's hand, card lift and arrival ring, and the kit reveal (including a staggered step reveal in Figures 2–4). Nothing else moves, and every one of these stops under reduced motion and Pause motion.

Icons are inline SVG symbols in the template's sprite (24 × 24, stroke 2, `currentColor`). Loops pick per-position icons through alias symbols (`i-stage-n`, `i-pipe-n`, `i-rev-n`, `i-shared-n`, `i-remote-n`, `i-manual-n`), each a `<use>` of a base icon.

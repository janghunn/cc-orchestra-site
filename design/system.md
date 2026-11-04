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

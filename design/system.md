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

- **Nav**: three levels, the same shell on all ten pages (snippets `header.html`, `editions.html`, `sub.html`, `sitemap.html` in `src/partials/`; labels in `content/site.*.json`). Every link of the top bar, the sub-bar and the footer sitemap is at least 44 px high.
  - Level 1, project. The top bar (`header.topbar`): `--surface` bar, 1px `--line` rule. Brand = two-circle mark (`--compare`, `--accent`) + name, 900 (KO 700), `--accent`; it links to the project page, accessible name `site.homeLabel`. The language link and theme button are kit controls: 44 px pills with a 2px `--control` border (the theme button 44 × 44).
  - Level 2, editions (`nav.sn-eds`, `site.edsLabel`): cc-orch and cc-doc, 700 `--muted`, hover `--accent-tint`; the current edition is `--ink` with a 2px `--accent` underline (`aria-current="page"` on that edition's overview, `"true"` on its other pages). The project page marks neither. The edition nav is in the DOM twice, one copy per layout (in the top bar next to the brand from 860 px, at the top of the sub-bar below 860 px); exactly one is displayed at any width.
  - Level 3, the edition's pages: the sub-bar (`.sn-sub`, right after the top bar). Inside cc-orch it holds the tabs (`nav.sn-pages`, `site.orchPagesLabel`) Overview · For researchers · For beginners, 700 `--muted` one size smaller than the edition links, the current one marked the same way (`aria-current="page"`); the tab row may scroll sideways inside its own box; the first tab's accessible name is `site.orchOverviewLabel` ("cc-orch overview"), since the workflow page's own first section link is also "Overview". cc-doc has one page and no tabs.
  - Section links of the current page (`nav.sn-toc` with `ul.navlinks`, the copy's `meta.nav`) sit in the sub-bar after the visible prefix `site.tocLabel` ("Page sections"), 400 `--muted` and smaller than the tabs, hover `--accent-tint`: at the right of the tabs on the cc-orch pages from 1024 px, on the cc-doc page (no tabs) from 860 px. The project page has none.
  - Sticky: from 860 px the top bar and the sub-bar stick together, and `scroll-padding-top` and the sticky `.split > .section-head` use the block's height (`--sn-stick`), so a fragment target opens below it. On the project page the sub-bar holds nothing from 860 px and is not shown, so only the top bar sticks there. Below 860 px only the top bar sticks (brand, language, theme; at most 64 px); the edition links and the tabs are the first rows on the page under it and scroll away with it.
  - Footer sitemap (`nav.sn-foot`, `site.footLabel`) on every page: cc-orchestra (the project page); cc-orch with its three pages; cc-doc with its page. cc-orch and cc-doc are group headings, not links; the two "Overview" links are named `site.orchOverviewLabel` / `site.docOverviewLabel`; the current page has `aria-current="page"`. Header and footer brand links both go to the project page.
  - Class prefixes: shell rules have a `.sn-` class in their selector, project-page rules a `.pj-` class. The old entry points of the overview (`.ed-pointer` in the hero, `.ed-footnav` in the footer, `.ed-navdoc` in the top bar) and their rules are gone.
- **Hero**: `--surface` with a 6px `--accent` bottom rule; columns 7fr / 5fr, stacking at ≤ 900 px. The eyebrow is a kit tag; `h1` 900 (KO 700) in `--ink`, its `em` in `--accent` (no gradient text). Stats are kit stat tiles (`--accent-tint`, number in `--accent`).
- **Takeaway band**: the hero lede (`.lede.band`), in place: `--band` fill, `--on-band` 700 text, radius 16 px. One per page.
- **Section cards**: every numbered section is `section > .wrap > .card` (2px `--line`, radius 16 px, `--surface`) on the `--bg` page. The section number in the kicker is a numbered disc (`.disc`, 46-60 px, `--accent` / `--on-accent`, Lato 900) left of the kicker + `h2` pair; the separator `.kicker-sep` stays in the DOM, visually hidden.
- **Buttons** (`.btn`): pill, 2px border, 44 px, 700. Primary = `--accent` fill with `--on-accent`, hover `--accent-strong` fill; secondary = accent outline; ghost = `--control` border with `--ink` text. Outline and ghost hover = `--accent-tint` fill with `--accent-strong` text. Every hover rule states colour and background together.
- **Inner panels** (comparison cards, flow nodes, table wrappers, helper tiles, limits, commands, cross notes): `--surface`, 2px `--line`, radius 12 px. **Callout** (`.callout`): `--accent-tint`, 2px `--accent` border. **Illustrative chip**: 2px dashed `--control` pill, `--muted` 700.
- **FAQ** and text twins: native `details` with an accent chevron; 2px `--line` rules.
- **Footer**: `--muted`, 2px top rule; the KO S-Core Dream credit line stays.
- Type: kit body `400 clamp(16px, .45vw + 13.5px, 18px)/var(--lh)`, `h2`/`h3` per kit, labels in the body font (mono only for code, paths and branch names). KO: `word-break: keep-all`, line height 1.75, no negative letter-spacing, no uppercase.

## Korean type

- `ko-font.css` is linked from the five KO content pages (`/ko/`, `/ko/cc-orch/`, `/ko/cc-orch/workflow/`, `/ko/cc-orch/guide/`, `/ko/cc-doc/`) and from no EN page and no redirect page. It is the only stylesheet that names the KO family `SCDream`; the KO pages' inlined head script names it to load the faces, and no EN page, `site.css` or `site.js` does. It holds 400 = `SCDream4.otf` and 700 = `SCDream6.otf`, both unmodified, with `font-display: swap`. The faces use no `local()`, and there is no preload.
- Shared CSS carries the kit's fallback stack only (`--font-ko`); `ko-font.css` puts the families first on KO pages.
- First paint uses `"SCDream Fallback"`, a `local()` Noto Sans CJK KR / Noto Sans KR face with metric overrides (values measured in Chrome):
  - 400: `size-adjust` 104.35%. Hangul advance is .96 em in S-Core Dream and .92 em in Noto.
  - 700: 102.4%, the measured ratio on this page's bold text.
- First visit: the KO pages' head script (the KO-only block of `src/js/head.js`, inlined into each KO page) starts loading both SCDream faces after the load event, as soon as the first contentful paint has been recorded or when a 3 s timer started at the load event fires, whichever comes first; in a background tab that has not painted yet, the timer can start the loads before first paint. It sets `html.ko-font` once both faces have loaded, switching to them in one step; if either load fails, or the browser has no Font Loading API, it sets the class at once. Both paths also try to save the flag; later visits whose flag was saved set the class before first paint (`localStorage["ppk-kofont"]`).
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

`scripts/build.mjs` documents the template tags. The cc-orch overview's structure that QA relies on (the `OVERVIEW` constant in `scripts/qa.mjs`; overview only; the project, workflow, guide and cc-doc pages have their own contracts below):
- `main > section[id]` × 10: `hero problem how routing gates providers lifecycle helpers limits faq`.
- `figure[id]`: `fig-problem fig-arch fig-gates fig-providers fig-lifecycle`.
- Tables: `tbl-routing tbl-codex tbl-gates`.

Both overview pages (`/cc-orch/`, `/ko/cc-orch/`, the site root until the project page took it) come from the same template, so they have the same DOM. The ten-section count, these figures and the "at least one figure with controls" browser check belong to the overview (and, with its own figure list, the workflow page); they are page-specific contracts, not site-wide ones.

## Documented limits

1. JavaScript off: the light theme (kit limit (a)); the old `prefers-color-scheme` dark fallback is removed on purpose.
2. No EN webfont: the kit's stack starts with Lato, which renders only where it is installed; otherwise `Segoe UI` / system sans. The site's QA requires zero font requests on EN pages.
3. The kit checker run on the built site (`check_kit.py --site dist`): token contract and contrast (check 2) and no hard-coded colours (check 7) pass. Check 6 does not apply (each content page needs its two absolute `hreflang` links, which the site's own no-network QA exempts), nor does check 9 (the kit's single `assets/fonts/` layout with Lato; the site keeps S-Core Dream in `fonts/ko`, linked only from KO pages).
4. The sub-bar's section links (`nav.sn-toc`) are hidden below 860 px, as before (no kit menu sheet), and on the cc-orch pages also from 860 to 1023 px, where the tabs take the row; the edition links, the tabs and the footer sitemap are shown at every width. The guide, cc-doc and project pages carry their sections in the page itself.
5. Visual taste is advisory (kit limit (d)); the gates cover contrast, targets, overflow and behaviour.
6. Redirect pages: GitHub Pages cannot send HTTP redirects, so `/workflow/`, `/guide/`, `/ko/workflow/` and `/ko/guide/` are small pages (`noindex`, in their language, no hreflang pair, linked from no page, not in Lighthouse) that leave by script with the query and fragment kept, with a meta refresh and a visible link as fallbacks; without JavaScript the refresh drops the query and the fragment.
7. Old overview fragments (`/#how` and the like) are forwarded to `/cc-orch/` by an inline script on the two project pages, from a list the build derives (every `id` of the rendered overview that the project page does not use); without JavaScript they open the project page at its top. Fragments the project page owns (`#main`, `#editions`, `#compare`, `#tbl-editions`, ...) are never forwarded.

## Project page (`/`, `/ko/`)

The site root: the project as a whole, leading into the two editions. Built from `src/project.html` and `content/project.{en,ko}.json` through the page table in `scripts/build.mjs` (page key `project`). It uses the guide's shell (`<body class="gd pj">`, head, the shared nav, footer) and existing components; page-specific rules have a `.pj-` class. It is text only: no `<figure>`, no hero illustration.

Page structure that QA relies on (the `PROJECT` constant in `scripts/qa.mjs`):
- `main > section[id]` × 3 in this order: `hero editions compare`. Sections 01-02 are `section > .wrap > .card` with a disc.
- `hero`: eyebrow, `h1`, the lede as the page's one takeaway band, and two buttons of the same class, one per edition (cc-orch, cc-doc).
- `editions` (01): two edition cards of the same component and weight, side by side from 760 px and stacked below: platform tag, name (`h3`), title, text, a check list "A good fit when", and the edition's pages, each a link with one line, then one button to the edition's overview.
- `compare` (02): the comparison of the two editions, `.tscroll > table.tbl#tbl-editions` (caption, three columns, six rows, row label as row header), moved from the cc-doc page.
- No sub-bar tabs or section links (`nav.sn-pages`, `nav.sn-toc`); the edition links and the footer sitemap as on every page.
- The inline old-fragment forwarder (limit 7) runs on these two pages only.

## Workflow page (`/cc-orch/workflow/`, `/ko/cc-orch/workflow/`)

A cc-orch page pair for researchers, built from `src/workflow.html` and `content/workflow.{en,ko}.json` through the page table in `scripts/build.mjs`. It shares the shared nav, theme and motion controls, fonts, tokens and both asset bundles with the cc-orch overview, and the same identity components: the kit landing hero (the lede is the page's one takeaway band), section cards with numbered discs, inner panels, callout, Illustrative chip, text twins and footer. Its own styles are in `src/css/workflow.css` (appended to `assets/site.css`; every selector is a `wf-*` or `loop-*` class) and Figure 1's controller is `src/js/loop.js` (appended to `assets/site.js`; it does nothing on a page without `[data-viz-loop]`). The cc-orch tabs and the footer sitemap link to it on every page; its old address `/workflow/` is a redirect page (limit 6).

Page structure that QA relies on:
- `main > section[id]` × 7: `hero loop methods flows roles manual tips`. Sections 01-06 are `section > .wrap > .card`, each headed by a disc (`.kicker > .disc + .kicker-sep`) as on the cc-orch overview.
- `figure[id]`: `fig-loop fig-pipeline fig-reviews fig-gpu fig-roles`. Each one holds a `details.twin[data-twin]` ("Show as text") with the ordered lists and, for the reviews, the GPU board and the roles, a real `<table>` (`tbl-reviews tbl-gpu tbl-roles`).
- The Illustrative chip (`.wf-ill`, `meta.illustrative`) is on `fig-loop` (stage chips), `fig-reviews` (score strip) and `fig-gpu` (lock board).

Role mapping on this page (the table above applies; these are the page's own marks):

| mark | token |
|---|---|
| hero orbit | ring 2px dashed `--control`; stage tiles and core `--bg` with a 2px `--line` border, icons `--ink`; the brand mark at the core |
| hero note (`.callout.wf-hero-note`) | kit callout: `--accent-tint`, 2px `--accent` border, icon `--accent-strong` |
| figure wells (Figure 1 stage, `.wf-panel`) | `--bg`, 2px `--line`; cards, steps, score strip and lock board inside are `--surface` |
| stage and step icons | `--bg` with a 2px `--line` border, icon `--ink`; the active stage's icon is ink-filled (`--ink` / `--surface`) |
| active stage | 2px `--ink` border (plus `aria-current="step"`); hand, hub numeral and arrival ring `--ink` |
| forward arrows and rails | solid 2px `--control` |
| return paths (Figure 1 stage 7 → 1, reviewer cycle Gate → Review) | 2px dashed `--control` |
| stage chips | neutral (`--bg` or `--code-bg` for the mono worktree chips, 1px `--line`, `--ink` text); held GPU and done flag `--accent-tint` with an `--accent` border; review chips by family (`--fam-a-tint` / `--fam-b-tint`, border in the family text colour) next to stage text that names the family |
| unmanaged-GPU chip, caution note icon, manual-note icon, "still manual" items | `--warn-text` (fill `--warn-fill`); "still manual" cards have a 2px dashed `--control` border |
| GPU holds | held: `--accent-tint`, 2px `--accent` border, `--ink` text; waiting: 2px dashed `--control` on `--surface`, `--muted` |
| score meters | filled segments `--fam`, empty `--line`; the clear attempt has an `--accent` border and check |
| role cards | 5px family bar on the left (`--fam`); "both" splits it, `--fam-a` above and `--fam-b` below, and the model dot is split diagonally the same way |
| method tiles, note and link-like icons, tips checks | `--accent` (tips: `--on-accent` on an `--accent` disc) |

Figures:
- **Figure 1** `#fig-loop` (`[data-viz-loop]`, `data-interval` 1600 ms): seven stage cards, each with an icon, a title, one line and its Illustrative chips (session badges with a message link, worktree and branch in mono, GPU held/free/unmanaged, experiment outputs, LaTeX outputs, review chips by family).
  - Layout: from 1024 px the stages run clockwise round the edge of a 3 × 3 grid (equal rows), with arrows in the gaps. The left middle cell carries the dashed return path from stage 7 to stage 1, and the centre holds a hub with the stage number and a hand. Below 1024 px the stages form one column with a rail behind the icons and a dashed loop-back mark.
  - Controls: Run/Pause (one button), Step, Reset, "Show as text". The caption is `role=status aria-live=polite` ("Stage n: title — text"), and the active card has `aria-current="step"`.
  - Run autoplays one full lap and then stops. Under reduced motion or `html.motion-off`, Run advances one stage and a running autoplay stops.
  - Motion: the hand rotates to the active card (angle measured from the layout, forward round the loop, the shortest way on Reset). The active card lifts (transform), and a one-shot ink arrival ring grows and fades (transform and opacity, 700 ms).
- **Figure 2** `#fig-pipeline`, **Figure 3** `#fig-reviews`, **Figure 4** `#fig-gpu`: step chips (`.wf-steps`) with solid arrows, in a column below 1024 px and in a row from 1024 px. The reviewer cycle adds a dashed return path from Gate to Review. Each step draws its piece of the path, so no geometry is guessed.
  - The score strip shows each label on a six-level meter (`data-level` per chip, fixed in the template for the synthetic rows) with an open-majors badge.
  - The lock board places holds on a ten half-hour grid from 1024 px (`--span` per hold, fixed for the synthetic rows) and stacks them on phones. The grid is the page's only gradient: a hard-stop `repeating-linear-gradient` of 1px `--line` rules, no colour blending.
- **Figure 5** `#fig-roles`: six role cards with a family bar and model chip (Claude `--fam-a`: orchestrator, lead, Claude dev; Codex `--fam-b`: Codex, gates; both: mock reviewers).
- Methods: ten icon tiles (icon ids from the copy: `branch worktree repo macro gpu review cross pen palette gauge`), as the overview's helper tiles. There are four columns from 1024 px, and the last two tiles span two columns.

Motion on this page: Figure 1's hand, card lift and arrival ring, and the kit reveal (including a staggered step reveal in Figures 2–4). Nothing else moves (the old hero glow is gone), and every one of these stops under reduced motion and Pause motion.

Icons are inline SVG symbols in the template's sprite (24 × 24, stroke 2, `currentColor`). Loops pick per-position icons through alias symbols (`i-stage-n`, `i-pipe-n`, `i-rev-n`, `i-shared-n`, `i-remote-n`, `i-manual-n`), each a `<use>` of a base icon.

## Beginners' guide page (`/cc-orch/guide/`, `/ko/cc-orch/guide/`)

A cc-orch page pair for newcomers, built from `src/guide.html` and `content/guide.{en,ko}.json` through the page table in `scripts/build.mjs` (page key `guide`). It is text only: no `<figure>` and no interactive figure. It reuses the workflow page's head, the shared nav, footer and components (section cards with numbered discs, `.wf-tiles`, `.wf-manual`, callout, `.tscroll` + `.tbl` tables with a caption, `.cmp` card pairs, `.btn-row`); any page-specific style is one block at the end of `src/css/workflow.css`, every selector under `body.gd`.

Page structure that QA relies on (the `GUIDE` constant in `scripts/qa.mjs`):
- `<body class="gd">`; `main > section[id]` × 7 in this order: `hero why roles files compare costs choose`. Sections 01-06 (`why` … `choose`) are `section > .wrap > .card` with a disc.
- No `figure` element, so the browser check's "at least one figure with controls" minimum does not apply to the guide.
- Links: the cc-orch overview `../` (hero secondary button, closing button) and the research page `../workflow/` (closing button); the brand goes to the project page `../../`; the language toggle follows the workflow pattern (`../../ko/cc-orch/guide/`, `../../../cc-orch/guide/?lang=en`).
- Sub-bar section links: `#why #roles #files #compare #choose`. Because those links are hidden below 860 px, the hero carries an "On this page" list with the same five anchors.

Entry points: the cc-orch tab "For beginners" (`site.orchPages.2`, the label the overview's top bar used before) and the footer sitemap on every page, at every width; the project page's cc-orch card lists it too. Its old address `/guide/` is a redirect page (limit 6).

## cc-doc page (`/cc-doc/`, `/ko/cc-doc/`)

The page pair of the cc-doc edition, built from `src/doc.html` and `content/doc.{en,ko}.json` through the page table in `scripts/build.mjs` (page key `doc`). It is text only, like the guide: no `<figure>` and no interactive figure, so the browser check's "at least one figure with controls" minimum does not apply to it. It uses the guide's shell (`<body class="gd">`, head, the shared nav, footer) and the guide's components: section cards with numbered discs, `.wf-tiles`, numbered steps (`.wf-manual.gd-steps`), the callout (`.callout.gd-note`), the check list (`.wf-tips.gd-tips`), `.tscroll` + `.tbl` tables with a caption, the sub-block title and paragraph (`.gd-sub-title`, `.gd-sub-p`) and the button row (`.gd-cta`).

Page structure that QA relies on (the `DOC` constant in `scripts/qa.mjs`):
- `main > section[id]` × 6 in this order: `hero desk copies guard formats editions`. Sections 01-05 (`desk` … `editions`) are `section > .wrap > .card` with a disc; the table is `tbl-formats`. The `editions` section keeps its head and paragraph; its comparison table moved to the project page, and its button row, which links there (`../#compare`), carries `id="tbl-editions"`, so an old link to `/cc-doc/#tbl-editions` lands at the way to the comparison.
- Links: the project page `../` (brand, hero secondary button) and `../#compare`; the language toggle follows the guide pattern (`../ko/cc-doc/`, `../../cc-doc/?lang=en`). Every URL is relative (no `href="/` or `src="/`), so the page works under the Pages project path.
- Sub-bar section links: the five section anchors; the hero repeats them in an "On this page" list for widths below 860 px.

Entry points: the cc-doc edition link in the shared nav and the footer sitemap on every page, at every width, and the project page's cc-doc card and hero button.

Saved language: on every EN content page the head script (`src/js/head.js`, EN-only block) sends a visitor whose saved language is Korean to that page's KO twin, keeping the `#hash`; `?lang=en` records English and never redirects. The inlined target is the same relative URL as the page's language toggle. So a link on an EN page, followed after the visitor chose Korean (for example in another tab), opens the KO page: this is the site's language memory, and it applies to every link between pages alike. The link itself points at the same-language page (`cc-doc/` from `/` and from `/ko/`), which is what `browser-qa` asserts.

Class prefixes: classes for the cc-doc page start with `cd-`; a rule added for it has a `.cd-` class in its selector, so it cannot match the other pages.

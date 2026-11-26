# cc-orchestra-site

The public site of the cc-orchestra project and its two editions: cc-orch, a multi-agent harness that connects
Claude Code and Codex CLI, and cc-doc, the edition for document work.
Ten static pages, five pairs of English and Korean built from one template each, on three levels:

| level | pages |
|---|---|
| project | the project page (`/`, `/ko/`): both editions, which fits, side by side |
| cc-orch edition (`/cc-orch/`) | the cc-orch overview (`/cc-orch/`, `/ko/cc-orch/`), a research-workflow case study (`/cc-orch/workflow/`, `/ko/cc-orch/workflow/`) and a beginners' guide (`/cc-orch/guide/`, `/ko/cc-orch/guide/`) |
| cc-doc edition | the cc-doc page (`/cc-doc/`, `/ko/cc-doc/`) |

Four redirect pages keep the old addresses of the workflow and guide pages working (`/workflow/`, `/guide/`,
`/ko/workflow/`, `/ko/guide/`), and the project page forwards the old overview fragments (`/#how` and the
like) to `/cc-orch/`. The pages describe the architecture and the workflow only: no source code of the
harness, no install command, no third-party requests.

Layout:

| path | what |
|---|---|
| `src/` | page templates (`project.html` project page, `page.html` cc-orch overview, `workflow.html`, `guide.html`, `doc.html`), CSS, JS, static files |
| `src/partials/` | shared snippets the templates include: the top bar (`header.html`), the edition links (`editions.html`), the sub-bar (`sub.html`) and the footer sitemap (`sitemap.html`) |
| `content/project.en.json`, `content/project.ko.json` | every project-page string, and the text of the redirect pages (`moved.*`); `_claims` / `_nonclaims` map each string to a claim or mark it as UI text |
| `content/en.json`, `content/ko.json` | the same for the cc-orch overview page (template `src/page.html`) |
| `content/workflow.en.json`, `content/workflow.ko.json` | the same for the workflow page |
| `content/guide.en.json`, `content/guide.ko.json` | the same for the beginners' guide page (template `src/guide.html`) |
| `content/doc.en.json`, `content/doc.ko.json` | the same for the cc-doc page (template `src/doc.html`) |
| `content/site.en.json`, `content/site.ko.json` | the shared navigation labels (`site.*`), readable from every template; no claims |
| `content/claims.md` | one row per factual claim, with the source line it rests on |
| `facts.json` | model, effort and count values injected into the copy (`{{f:key}}`) |
| `fonts/ko/` | S-Core Dream OTF files, unmodified, with `SHA256SUMS` and the licence notes |
| `scripts/build.mjs` | zero-dependency assembly script that writes `dist/` |
| `scripts/qa.mjs` and helpers | the QA checks below |
| `safety-grep.sh`, `safety-url-allow.txt`, `tests/` | the pre-publish content-safety check and its tests |
| `.github/workflows/deploy.yml` | build, safety check and GitHub Pages deploy |

## Build

Needs Node.js 22 or later.

```sh
npm ci
npm run build
```

`npm run build` runs `node scripts/build.mjs` and writes 14 HTML files: the ten content pages
(`dist/index.html`, `dist/cc-orch/index.html`, `dist/cc-orch/workflow/index.html`,
`dist/cc-orch/guide/index.html`, `dist/cc-doc/index.html` and their twins under `dist/ko/`) and the four
redirect pages (`dist/workflow/index.html`, `dist/guide/index.html`, `dist/ko/workflow/index.html`,
`dist/ko/guide/index.html`); plus `dist/assets/css/tokens.css`, `dist/assets/`, `dist/fonts/ko/`,
`favicon.svg`, `robots.txt` and `.nojekyll`. The build itself has no
dependencies; `npm ci` only installs the QA tools. `node scripts/build.mjs --out DIR` writes elsewhere;
the output directory is replaced only after a complete build.

Templates share markup through an include tag that inserts a snippet of `src/partials/`, rendered with the
including page's copy (the tag and its rules are in the header comment of `scripts/build.mjs`). The shared
labels of `content/site.<lang>.json` are read as `site.*` on every page; a `site.*` key that no page of that
language renders fails the build, as any unused copy key does. Every link between pages is relative.

Redirect pages: GitHub Pages cannot send HTTP redirects, so each old address holds a small page in its
language (`noindex`) that leaves with `location.replace(<new address> + location.search + location.hash)`,
with a `<meta http-equiv="refresh">` and a visible link to the new address as fallbacks; without
JavaScript the refresh drops the query and the fragment. They carry no hreflang link and no `SITE_URL`, are
linked from no page, and are not in the Lighthouse run or the crawl's page count. Old overview fragments:
the build collects every `id` of the rendered cc-orch overview that the project page does not use itself and
writes that list into both project pages, whose inline script sends such a hash to `cc-orch/` (keeping the
query and the hash), on load and when the hash changes on the open page; a fragment the project page owns (`#main`, `#compare`, ...) stays on the project page.
Without JavaScript an old fragment opens the project page at its top.

`SITE_URL` (environment) is the public base URL, ending in `/`. It is used only for the two
`<link rel="alternate" hreflang>` tags per content page, which Lighthouse requires to be absolute. Without it the
build uses a reserved `.invalid` placeholder, so a local build never contains the real address. CI sets
it from the Pages configuration.

## QA

```sh
SAFETY_PRIVATE_PATTERNS=<private patterns file> npm run qa          # everything
SAFETY_PRIVATE_PATTERNS=<private patterns file> npm run qa:static   # no browser, no sockets
npm run test:safety                                                 # safety-grep tests only
bash tests/check-claims.test.sh                                     # claims-checker tests (synthetic)
bash tests/build.test.sh                                            # build-script tests (temp copies)
bash tests/publish-steps.test.sh                                    # Publishing block, throwaway repos
```

`npm run qa` prints one `QA <id> PASS|FAIL|SKIP <detail>` line per check and exits 1 on any FAIL.
A check that runs a child process passes only if the child launched, exited 0 and printed its own
success line; a child that cannot start or is killed is a FAIL.
`DIST=<dir>` checks another output directory (the `build` step writes there). `CLAIMS_SOURCE_REPO` and
`CLAIMS_WORKSPACE_ROOTS` are passed on to the `claims` check (see below).

| id | what it checks | acceptance criteria | in `qa:static` |
|---|---|---|---|
| `build` | clean rebuild; all 14 HTML files (ten content pages, four redirect pages) written by this run | 1 | yes |
| `facts` | no `{{` left in the output; every `{{f:key}}` resolves in `facts.json` | 1, 2 | yes |
| `structure` | per content page: `<html lang>`, the pair's two absolute hreflang links, language toggle link, the EN page's inlined saved-language target equal to its toggle href, no root-relative `href="/` or `src="/` (it would break under the Pages project path); the shell (the `LINKS` table in `scripts/qa.mjs`): `a.brand` to the project page named `site.homeLabel`, `nav.sn-eds` with exactly the two edition links and the current edition marked, `.sn-sub` right after the header, `nav.sn-pages` with the three cc-orch tabs and one `aria-current="page"` on the six cc-orch pages only, `nav.sn-toc` with the page's section links on all but the project pages, one `nav.sn-foot` with the five same-language pages; per pair: same section ids, figure ids and `<main>` element structure EN = KO; project: the section ids in order (the `PROJECT` constant), no `<figure>`, `table#tbl-editions`; cc-orch overview: its ten section ids in order (`OVERVIEW`); workflow: the section ids and figure ids in order (`WORKFLOW`), a link `../` (the cc-orch overview) inside `<main>`, a `[data-twin]` text twin for every figure and the Illustrative chip on every synthetic figure; guide: the section ids in order (`GUIDE`), no `<figure>`, links `../` and `../workflow/` inside `<main>`; cc-doc: the section ids in order (`DOC`), no `<figure>`, no comparison table but `id="tbl-editions"` kept, links `../` and `../#compare` inside `<main>` (the page's own links are counted there only, since the shared tabs and sitemap carry the same addresses); old fragments: each project page's forward list is exactly the ids of the built overview that the project page does not use, and no other page forwards; redirect pages (`REDIRECTS`): `lang`, `noindex`, refresh, script and fallback link to the new address, title and link text from `moved.*`, no hreflang link, no `SITE_URL`, no external asset, the new address in the build | 1 | yes |
| `safety` | `safety-grep.sh dist` and `safety-grep.sh . --source-mode`, private patterns required | 3 | yes |
| `safety-tests` | `tests/safety-grep.test.sh` | 3 | yes |
| `no-network` | every resource URL in the built HTML/CSS (content and redirect pages) resolves to the page's own origin; no `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `import(` in JS | 4 | yes |
| `fonts` | `dist/fonts/ko` hashes match `SHA256SUMS` and the official ones; no `SCDream` in the EN pages, the redirect pages, `site.css`, `site.js`; only the five KO content pages link `ko-font.css` | 5 | yes |
| `budgets` | `gzip -9` sizes: HTML 40 KB per file (content and redirect pages), CSS 25 KB, JS 30 KB, EN fonts 120 KB; KO OTF sizes reported | 6 | yes |
| `contrast` | `scripts/contrast.mjs`: theme token pairs, light and dark, 4.5:1 text, 3:1 UI | 7 | yes |
| `claims` | `scripts/check-claims.mjs`: in all six content sets (project, overview, workflow, guide, doc, site) every string is in `_claims` or `_nonclaims`; claim ids match `content/claims.md`; every source cell is citations (forms below), `framing`, a URL, or one `observation: <text>` | 2 | yes |
| `deps` | lockfile present and in step with `package.json`; exact versions; install scripts listed below | 10 | yes |
| `browser` | `scripts/browser-qa.mjs` (Playwright + system Chrome over the local server): all ten content pages, light + dark, 390 + 1280 px: no horizontal scroll, a top bar at most 64 px high at 390 px, a visible and focusable brand link to the same-language project page and edition links (`nav.sn-eds`) to both edition overviews, on the cc-orch pages the three tabs (`nav.sn-pages`), every displayed link of the top bar, sub-bar and footer sitemap at least 44 px high, visible and focusable links inside `<main>` to `../` on the workflow pages, to `../` and `../workflow/` on the guide pages and to `../` and `../#compare` on the cc-doc pages, axe-core 0 violations, reduced motion leaves `document.getAnimations()` empty, keyboard-only operation of every figure control, text twins, at least one figure with controls on the overview and workflow pages (the guide and cc-doc pages have no interactive figure, so this minimum does not apply to them), the research-loop figure's Run / Pause, global pause and reduced-motion stop with motion enabled (`loop-motion`), KO pages' font loaded (`document.fonts.check('400 16px SCDream')` and a loaded 400 face) with KO font bytes; on the cc-orch overview at 1280 px the top bar and sub-bar stick and `#gates` opens with its heading below them; the project pages' edition links land on the same-language edition overviews; the four old addresses (and `/workflow/?lang=en#tips`) end on their new ones; `/#how`, `/#how-title` and `/ko/#faq` end on the cc-orch overview with the same fragment, `/#compare` and `/#main` stay on `/`, and `/cc-doc/#tbl-editions` shows that element below the sticky block; on the open project page a hash set in the same tab (`#how`) is forwarded the same way and `#compare` stays; a link reached with Tab shows its focus ring inside every clipping ancestor and under no sticky bar that paints over it (the cc-orch tabs at 390 px, the edition links at 390 and 1280 px); with Korean saved through the language link, each EN content URL (and `/#how`) ends on its KO twin and each `?lang=en` URL stays English; no request to another origin | 4, 5, 7 | no |
| `lighthouse` | `scripts/lighthouse.mjs`: pinned Lighthouse, mobile, all ten content pages, median of 3 runs: Performance 95, Accessibility 100, Best Practices 95, SEO 95 | 8 | no |
| `links` | pinned linkinator against the local server: 0 broken internal links or fragments; all ten content pages reached from `/` (the redirect pages are linked from no page and are not counted) | 8 | no |

`browser`, `lighthouse` and `links` print `SKIP` when Chrome is missing or no loopback socket can be
opened. They use the system Chrome (set `CHROME_PATH` to override) in headless mode without GPU; no
browser is downloaded. The local server (`node scripts/serve.mjs [dir]`) binds the loopback interface on
an ephemeral port and is closed when each check ends.

Not covered by `qa`: reading each claims row against its source lines (criterion 2), the workflow file
(criterion 9, reviewed by hand) and the git hygiene items of criterion 10.

Claims source forms. A source token is `path:line[-line]@<sourceSha>` (a file of the cc-orchestra
repository at `facts.json` `sourceSha`), `path:line[-line]@<docSourceSha>` (the same at the optional second
pin `facts.json` `docSourceSha`; the cc-doc rows use it) or `ws:<alias>/<path>:line[-line]@<YYYY-MM-DD>` (a file inside a
research workspace, read on that date; the path is relative, without `..`). Tokens are separated by `; `.
Alias `site` is this repository and is always checked. The other aliases are private: their directories
come from `CLAIMS_WORKSPACE_ROOTS`, a file kept outside this repository with one `alias<TAB>dir` per line
(`#` comments; a relative dir resolves from the file's directory). With it set, an unknown alias, a
missing file or a range past the end of the file fails; without it those citations are checked for format
only and the PASS line says so. `CLAIMS_SOURCE_REPO=<cc-orchestra checkout>` does the same for the
`@<sourceSha>` and `@<docSourceSha>` citations, each against the commit it names.

## Safety grep

```sh
./safety-grep.sh <dir-or-file> [--denylist FILE] [--private FILE] [--require-private]
                 [--allow URL --allow-count N] [--redact] [--source-mode]
```

Exit 0 is clean, 1 means hits, 2 is an error (missing target, missing or unreadable denylist or private
file, bad `--allow`, grep or temp-file failure). An error never counts as clean; 1 and 2 both block a
publish.

- Every text file under the target is scanned, whatever its extension (binary files such as the OTF fonts
  are skipped); file and directory names relative to the target are scanned too (class `file-name`).
- Built-in classes are generic: home paths, harness state paths, mount paths, IPv4, IPv6 (including
  forms ending in `::`), local host names, host:port, machine contexts, e-mail addresses, secret tokens,
  source-code shapes, and `unlisted-url` (any absolute URL that does not start with a prefix in
  `safety-url-allow.txt`).
- **Private patterns** (the owner handle, machine and host names, mount names, the private repository
  URL, a third-party endpoint) are never committed. They load from `--private FILE`, else
  `$SAFETY_PRIVATE_PATTERNS`, else `$HOME/.config/cc-orchestra-site/private-patterns.tsv`. Format: one
  `class<TAB>extended-regex` per line, `#` comments; hits are reported as `private:<class>` without the
  matched text. Without the file the grep prints `NOTE: private patterns not loaded`;
  `--require-private` turns that into exit 2. `npm run qa` and CI always require it.
- `--denylist FILE` adds fixed strings (one per line, `#` comments); hits never print the matched text.
- `--source-mode` scans the repository source (tracked and untracked, not ignored files) with the
  private, denylist and secret-token classes only. The exact synthetic token strings listed in
  `tests/synthetic-tokens.txt` (used on purpose by the fixtures; each must match the secret-token class)
  are exempt there; any other token-shaped string, in `tests/fixtures/` or anywhere else, is a hit.
- `--redact` prints `file:line` only.
- `tests/fixtures/` holds synthetic samples (documentation addresses, `example` domains, fake tokens) that
  hit every built-in class; `tests/private-patterns.sample` and `tests/denylist.sample` are synthetic
  samples for the private and denylist classes.

**The one listed allowance.** CI passes `--allow <Pages base URL> --allow-count 20`. That single URL
(`https://<owner>.github.io/<repo>/`, the only accepted form) is exempt from every private class
(`private:*`) and from `unlisted-url`, and from no other built-in class and not from the denylist: its
exact occurrences are blanked and each private pattern is re-tested on the rest of the line, so any other
match on that line still hits. It must occur exactly 20 times in `dist/` (the two
hreflang links on each of the ten content pages; the redirect pages hold none); any other count fails with `HIT [allow-count]`. The repository and a local
build contain the owner handle zero times.

## Publishing (hand steps, not automated)

`main` starts as an empty initial commit. It holds neither the site nor the deploy workflow, so the
reviewed branch must be merged into `main` before the push; a push of the empty `main` publishes nothing.

1. Create an empty public repository, with no README, licence or `.gitignore`:
   `gh repo create <owner>/<repo> --public`.
2. Set the repository secret `SAFETY_PRIVATE_PATTERNS` from the private patterns file, without printing
   it: `gh secret set SAFETY_PRIVATE_PATTERNS --repo <owner>/<repo> < <private patterns file>`.
3. Set Settings > Pages > Source to "GitHub Actions" (or
   `gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow`).
4. Set `SITE_BRANCH` to the reviewed branch and `REMOTE_URL` to the new repository's URL, then run the
   block below from this repository. It is safe to re-run after any failure: the merge happens only once,
   `main` must hold the deploy workflow before anything is pushed, and an existing `origin` is kept only
   if its one fetch URL and its one push URL, after any `insteadOf` or `pushInsteadOf` rewrite, both equal
   `REMOTE_URL` (a second URL or a rewrite stops the block). The push names its destination
   (`refs/heads/main`), so no `remote.origin.push` mapping applies, and sends no tags, even with
   `push.followTags` set.

   ```sh
   # Pushes main only: no other branch, no tags.
   test -n "$SITE_BRANCH" && test -n "$REMOTE_URL" &&
     git switch main &&
     { git merge-base --is-ancestor "$SITE_BRANCH" main || git merge --no-ff --no-edit "$SITE_BRANCH"; } &&
     git cat-file -e main:.github/workflows/deploy.yml &&
     { git remote get-url origin >/dev/null 2>&1 || git remote add origin "$REMOTE_URL"; } &&
     test "$(git remote get-url --all origin)" = "$REMOTE_URL" &&
     test "$(git remote get-url --push --all origin)" = "$REMOTE_URL" &&
     git push -u --no-follow-tags origin main:refs/heads/main
   ```

5. The push to `main` starts the `deploy` workflow. The workflow builds with `SITE_URL` taken from the
   Pages configuration (and refuses the placeholder), runs the safety grep on `dist` and on the source
   with the private patterns required, and deploys only if both exit 0. Every action is pinned to a full
   commit SHA. If the run failed because a step above was missing, complete that step and run
   `gh workflow run deploy`.

## Fonts

The Korean pages use S-Core Dream (에스코어 드림), weights 400 and 700, served from `fonts/ko/` as the
unmodified OTF files of the official `S-Core_Dream_OTF.zip`. The S-Core licence allows free use,
including commercial use, and redistribution, provided the font files are not modified or sold; the
licence notes and the official statements are in `fonts/ko/LICENSE-S-Core-Dream.txt`, and `SHA256SUMS`
lists the official file hashes. The Korean footers carry the recommended credit line. The English pages
load no web font.

## Dependencies

Runtime dependencies: none. `devDependencies`, exact versions, all published at least 14 days before
they were locked (`npm install --save-exact --before=<date>`); `package-lock.json` is committed and
`npm ci` installs exactly what it lists.

| package | version | used by |
|---|---|---|
| `playwright-core` | 1.64.1 | `scripts/browser-qa.mjs`; drives the system Chrome. Chosen over `playwright` so that nothing ever offers to download a browser. |
| `@axe-core/playwright` | 4.14.0 | axe-core runs in `scripts/browser-qa.mjs` |
| `axe-core` | 4.14.0 | the accessibility rules (`@axe-core/playwright` loads it) |
| `lighthouse` | 13.5.0 | `scripts/lighthouse.mjs`; launches the system Chrome through `chrome-launcher`, downloads nothing |
| `linkinator` | 8.1.0 | the `links` check in `scripts/qa.mjs` |

Install scripts: no package in `package-lock.json` has `hasInstallScript`, so `npm ci` runs no
third-party install code. The `deps` QA check fails if one appears without a justification here.

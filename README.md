# cc-orchestra-site

The public project page for cc-orchestra, a multi-agent harness that connects Claude Code and Codex CLI.
Four static pages, two pairs of English and Korean built from one template each: the overview (`/`,
`/ko/`) and a research-workflow case study (`/workflow/`, `/ko/workflow/`). The pages describe the
architecture and the workflow only: no source code of the harness, no install command, no third-party
requests.

Layout:

| path | what |
|---|---|
| `src/` | page template, CSS, JS, static files |
| `content/en.json`, `content/ko.json` | every overview-page string; `_claims` / `_nonclaims` map each string to a claim or mark it as UI text |
| `content/workflow.en.json`, `content/workflow.ko.json` | the same for the workflow page |
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

`npm run build` runs `node scripts/build.mjs` and writes `dist/index.html`, `dist/ko/index.html`,
`dist/workflow/index.html`, `dist/ko/workflow/index.html`, `dist/assets/`, `dist/fonts/ko/`, `favicon.svg`, `robots.txt` and `.nojekyll`. The build itself has no
dependencies; `npm ci` only installs the QA tools. `node scripts/build.mjs --out DIR` writes elsewhere;
the output directory is replaced only after a complete build.

`SITE_URL` (environment) is the public base URL, ending in `/`. It is used only for the two
`<link rel="alternate" hreflang>` tags per page, which Lighthouse requires to be absolute. Without it the
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
| `build` | clean rebuild; all four pages written | 1 | yes |
| `facts` | no `{{` left in the output; every `{{f:key}}` resolves in `facts.json` | 1, 2 | yes |
| `structure` | per page: `<html lang>`, the pair's two absolute hreflang links, language toggle link; per pair: same section ids, figure ids and `<main>` element structure EN = KO; overview: 10 sections and a nav link `workflow/`; workflow: the section ids and figure ids in order (the `WORKFLOW` constant in `scripts/qa.mjs`), a home link `../`, a `[data-twin]` text twin for every figure and the Illustrative chip on every synthetic figure | 1 | yes |
| `safety` | `safety-grep.sh dist` and `safety-grep.sh . --source-mode`, private patterns required | 3 | yes |
| `safety-tests` | `tests/safety-grep.test.sh` | 3 | yes |
| `no-network` | every resource URL in the built HTML/CSS resolves to the page's own origin; no `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `import(` in JS | 4 | yes |
| `fonts` | `dist/fonts/ko` hashes match `SHA256SUMS` and the official ones; no `SCDream` in the EN pages, `site.css`, `site.js`; only the KO pages link `ko-font.css` | 5 | yes |
| `budgets` | `gzip -9` sizes: HTML 40 KB per page, CSS 25 KB, JS 30 KB, EN fonts 120 KB; KO OTF sizes reported | 6 | yes |
| `contrast` | `scripts/contrast.mjs`: theme token pairs, light and dark, 4.5:1 text, 3:1 UI | 7 | yes |
| `claims` | `scripts/check-claims.mjs`: in both content sets every string is in `_claims` or `_nonclaims`; claim ids match `content/claims.md`; every source cell is citations (forms below), `framing`, a URL, or one `observation: <text>` | 2 | yes |
| `deps` | lockfile present and in step with `package.json`; exact versions; install scripts listed below | 10 | yes |
| `browser` | `scripts/browser-qa.mjs` (Playwright + system Chrome over the local server): all four pages, light + dark, 390 + 1280 px: no horizontal scroll, a visible and focusable link to `workflow/` on the overview pages, axe-core 0 violations, reduced motion leaves `document.getAnimations()` empty, keyboard-only operation of every figure control, text twins, the research-loop figure's Run / Pause, global pause and reduced-motion stop with motion enabled (`loop-motion`), KO pages' font loaded (`document.fonts.check('400 16px SCDream')` and a loaded 400 face) with KO font bytes, no request to another origin | 4, 5, 7 | no |
| `lighthouse` | `scripts/lighthouse.mjs`: pinned Lighthouse, mobile, all four pages, median of 3 runs: Performance 95, Accessibility 100, Best Practices 95, SEO 95 | 8 | no |
| `links` | pinned linkinator against the local server: 0 broken internal links or fragments; all four pages reached from `/` | 8 | no |

`browser`, `lighthouse` and `links` print `SKIP` when Chrome is missing or no loopback socket can be
opened. They use the system Chrome (set `CHROME_PATH` to override) in headless mode without GPU; no
browser is downloaded. The local server (`node scripts/serve.mjs [dir]`) binds the loopback interface on
an ephemeral port and is closed when each check ends.

Not covered by `qa`: reading each claims row against its source lines (criterion 2), the workflow file
(criterion 9, reviewed by hand) and the git hygiene items of criterion 10.

Claims source forms. A source token is `path:line[-line]@<sourceSha>` (a file of the cc-orchestra
repository at `facts.json` `sourceSha`) or `ws:<alias>/<path>:line[-line]@<YYYY-MM-DD>` (a file inside a
research workspace, read on that date; the path is relative, without `..`). Tokens are separated by `; `.
Alias `site` is this repository and is always checked. The other aliases are private: their directories
come from `CLAIMS_WORKSPACE_ROOTS`, a file kept outside this repository with one `alias<TAB>dir` per line
(`#` comments; a relative dir resolves from the file's directory). With it set, an unknown alias, a
missing file or a range past the end of the file fails; without it those citations are checked for format
only and the PASS line says so. `CLAIMS_SOURCE_REPO=<cc-orchestra checkout>` does the same for the
`@<sourceSha>` citations.

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

**The one listed allowance.** CI passes `--allow <Pages base URL> --allow-count 8`. That single URL
(`https://<owner>.github.io/<repo>/`, the only accepted form) is exempt from every private class
(`private:*`) and from `unlisted-url`, and from no other built-in class and not from the denylist: its
exact occurrences are blanked and each private pattern is re-tested on the rest of the line, so any other
match on that line still hits. It must occur exactly 8 times in `dist/` (the two
hreflang links on each of the four pages); any other count fails with `HIT [allow-count]`. The repository and a local
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
   an existing `origin` is kept only if its fetch and push URLs equal `REMOTE_URL`, `main` must hold the
   deploy workflow before anything is pushed, and the push names its destination (`refs/heads/main`), so
   no `remote.origin.push` mapping applies.

   ```sh
   # Pushes main only: no other branch, no tags.
   test -n "$SITE_BRANCH" && test -n "$REMOTE_URL" &&
     git switch main &&
     { git merge-base --is-ancestor "$SITE_BRANCH" main || git merge --no-ff --no-edit "$SITE_BRANCH"; } &&
     git cat-file -e main:.github/workflows/deploy.yml &&
     { git remote get-url origin >/dev/null 2>&1 || git remote add origin "$REMOTE_URL"; } &&
     test "$(git remote get-url origin)" = "$REMOTE_URL" &&
     test "$(git remote get-url --push origin)" = "$REMOTE_URL" &&
     git push -u origin main:refs/heads/main
   ```

5. The push to `main` starts the `deploy` workflow. The workflow builds with `SITE_URL` taken from the
   Pages configuration (and refuses the placeholder), runs the safety grep on `dist` and on the source
   with the private patterns required, and deploys only if both exit 0. Every action is pinned to a full
   commit SHA. If the run failed because a step above was missing, complete that step and run
   `gh workflow run deploy`.

## Fonts

The Korean page uses S-Core Dream (에스코어 드림), weights 400 and 700, served from `fonts/ko/` as the
unmodified OTF files of the official `S-Core_Dream_OTF.zip`. The S-Core licence allows free use,
including commercial use, and redistribution, provided the font files are not modified or sold; the
licence notes and the official statements are in `fonts/ko/LICENSE-S-Core-Dream.txt`, and `SHA256SUMS`
lists the official file hashes. The Korean footer carries the recommended credit line. The English page
loads no web font.

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

#!/usr/bin/env bash
# Tests for the README "## Publishing" steps. Run from anywhere: bash tests/publish-steps.test.sh
# Extracts the first sh block of that section and runs it against throwaway repositories (a sandbox whose
# main is an empty commit and whose branch site holds the deploy workflow, plus local bare remotes).
# Hermetic git: no system or global config, fixed test identity, no network.
set -u
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
W="$(mktemp -d "${TMPDIR:-/tmp}/publish-steps-test.XXXXXX")" || { echo "cannot create temp dir" >&2; exit 2; }
trap 'rm -rf "$W"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   - $1"; }
bad() { fail=$((fail + 1)); echo "FAIL - $1"; [ -n "${2:-}" ] && sed 's/^/       /' "$2" | head -20; }

unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_CEILING_DIRECTORIES
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_MERGE_AUTOEDIT=no GIT_TERMINAL_PROMPT=0
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.invalid
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.invalid

# The first ```sh block between "## Publishing" and the next "## " heading; the fence's indentation is removed.
B="$W/block.sh"
awk '
  /^## / { insec = ($0 ~ /^## Publishing/); if (!insec && done == 0 && inblk) exit; next }
  !insec || done { next }
  !inblk && /^ *```sh *$/ { inblk = 1; match($0, /^ */); ind = RLENGTH; next }
  inblk && /^ *``` *$/ { done = 1; next }
  inblk { line = $0; n = 0; while (n < ind && substr(line, 1, 1) == " ") { line = substr(line, 2); n++ }; print line }
  END { exit (done ? 0 : 1) }
' "$ROOT/README.md" >"$B" 2>"$W/awk.err"
have_block=$?

# sandbox DIR: main = one empty commit; site adds the workflow and a page; site checked out.
sandbox() {
  mkdir -p "$1" && git -C "$1" init -q -b main &&
    git -C "$1" commit -q --allow-empty -m "initial" &&
    git -C "$1" switch -q -c site &&
    mkdir -p "$1/.github/workflows" &&
    printf 'name: deploy\n' >"$1/.github/workflows/deploy.yml" &&
    printf '<!doctype html><title>t</title>\n' >"$1/index.html" &&
    git -C "$1" add -A && git -C "$1" commit -q -m "site"
}
bare() { git init -q --bare -b main "$1"; }
# run_block DIR REMOTE_URL LOG: runs the README block in DIR with bash -e; returns its exit status.
run_block() { (cd "$1" && SITE_BRANCH=site REMOTE_URL="$2" bash -e "$B") >"$3" 2>&1; }
# check_remote BARE: the p1 checks; prints why it fails, returns 0 only if they all hold.
check_remote() {
  local refs
  if ! git --git-dir="$1" cat-file -e main:.github/workflows/deploy.yml 2>/dev/null; then
    echo "main lacks the site"; return 1
  fi
  refs="$(git --git-dir="$1" for-each-ref --format='%(refname)')" || { echo "cannot list refs"; return 1; }
  if [ "$refs" != "refs/heads/main" ]; then echo "refs are not exactly refs/heads/main: $refs"; return 1; fi
  return 0
}

if [ "$have_block" -ne 0 ] || [ ! -s "$B" ]; then
  bad "README ## Publishing has no sh block" "$W/awk.err"
  for c in p1 p2 p3 p4; do bad "$c: skipped, no Publishing sh block"; done
else
  ok "README ## Publishing sh block found ($(wc -l <"$B") lines)"

  # p1 happy path
  S="$W/p1/sb"; R="$W/p1/remote.git"
  sandbox "$S" >"$W/p1.setup" 2>&1 && bare "$R" >>"$W/p1.setup" 2>&1 || bad "p1: setup failed" "$W/p1.setup"
  if run_block "$S" "$R" "$W/p1.log"; then
    if why="$(check_remote "$R")"; then ok "p1: happy path pushes main with the site, only refs/heads/main"
    else bad "p1: $why" "$W/p1.log"; fi
  else bad "p1: block exit $?, want 0" "$W/p1.log"; fi

  # p2 failed push, then retry once the remote exists
  S="$W/p2/sb"; R="$W/p2/later.git"
  sandbox "$S" >"$W/p2.setup" 2>&1 || bad "p2: setup failed" "$W/p2.setup"
  if run_block "$S" "$R" "$W/p2a.log"; then bad "p2: first run exit 0 with no remote repository" "$W/p2a.log"
  else
    bare "$R" >"$W/p2.setup" 2>&1 || bad "p2: bare init failed" "$W/p2.setup"
    if run_block "$S" "$R" "$W/p2b.log"; then
      merges="$(git -C "$S" rev-list --merges main | wc -l)"
      if ! why="$(check_remote "$R")"; then bad "p2: retry: $why" "$W/p2b.log"
      elif [ "$merges" -ne 1 ]; then bad "p2: retry: $merges merge commits on main, want 1" "$W/p2b.log"
      else ok "p2: failed push, retry pushes main with the site and exactly 1 merge"; fi
    else bad "p2: retry exit $?, want 0" "$W/p2b.log"; fi
  fi

  # p3 an existing origin that differs from REMOTE_URL stops the block
  S="$W/p3/sb"; RB="$W/p3/b.git"; RC="$W/p3/c.git"
  { sandbox "$S" && bare "$RB" && bare "$RC" && git -C "$S" remote add origin "$RB"; } >"$W/p3.setup" 2>&1 ||
    bad "p3: setup failed" "$W/p3.setup"
  before="$(git --git-dir="$RB" for-each-ref --format='%(objectname) %(refname)')"
  if run_block "$S" "$RC" "$W/p3.log"; then bad "p3: block exit 0 with a different origin" "$W/p3.log"
  else
    after="$(git --git-dir="$RB" for-each-ref --format='%(objectname) %(refname)')"
    crefs="$(git --git-dir="$RC" for-each-ref --format='%(refname)')"
    if [ -n "$crefs" ]; then bad "p3: REMOTE_URL repository received refs: $crefs"
    elif [ "$before" != "$after" ]; then bad "p3: existing origin changed"
    else ok "p3: different existing origin stops the block, both remotes untouched"; fi
  fi

  # p4 no forced or bulk pushes
  if grep -nE -e '--(force|all|mirror|tags)' "$B" >"$W/p4.out"; then bad "p4: block has a forbidden push option" "$W/p4.out"
  else ok "p4: block has none of --force, --all, --mirror, --tags"; fi
fi

# p5 negative control: the old instruction pushes the empty main, and the p1 checks must say so.
S="$W/p5/sb"; R="$W/p5/remote.git"
sandbox "$S" >"$W/p5.setup" 2>&1 && bare "$R" >>"$W/p5.setup" 2>&1 || bad "p5: setup failed" "$W/p5.setup"
printf '%s\n' 'git remote add origin "$REMOTE_URL" && git push -u origin main' >"$W/old.sh"
(cd "$S" && REMOTE_URL="$R" bash -e "$W/old.sh") >"$W/p5.log" 2>&1
why="$(check_remote "$R")"
if [ "$why" = "main lacks the site" ]; then ok "p5: old instruction detected: main lacks the site"
else bad "p5: old instruction not detected (got '${why:-checks pass}')" "$W/p5.log"; fi

echo "# publish-steps tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ]

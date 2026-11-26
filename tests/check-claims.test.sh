#!/usr/bin/env bash
# Tests for scripts/check-claims.mjs. Run from anywhere: bash tests/check-claims.test.sh
# Builds a throwaway repository with synthetic content sets, claims rows and workspaces (aliases Q and Z),
# copies the checker into it and runs it there; the two-pin cases also build a throwaway source repository
# with two commits. Nothing here names a real workspace.
set -u
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
W="$(mktemp -d "${TMPDIR:-/tmp}/check-claims-test.XXXXXX")" || { echo "cannot create temp dir" >&2; exit 2; }
trap 'rm -rf "$W"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   - $1"; }
bad() { fail=$((fail + 1)); echo "FAIL - $1"; [ -n "${2:-}" ] && sed 's/^/       /' "$2" | head -20; }

R="$W/repo"
mkdir -p "$R/scripts" "$R/content" "$R/design" "$W/ws/q/docs" "$W/ws/z"
cp "$ROOT/scripts/check-claims.mjs" "$R/scripts/"
PIN1=abc1234 PIN2=def5678
facts() { printf '{ "sourceSha": "%s", "docSourceSha": "%s" }\n' "$1" "$2" >"$R/facts.json"; }
facts "$PIN1" "$PIN2"
printf 'line one\nline two\nline three\n' >"$R/design/notes.md"
printf 'a\nb\nc\nd\ne\n' >"$W/ws/q/docs/guide.md"
printf 'only\n' >"$W/ws/z/one.txt"
printf '# synthetic roots\nQ\t%s\nZ\tws/z\n' "$W/ws/q" >"$W/roots.tsv"   # Z is relative to the TSV file

home='{ "hero": { "title": "T", "lede": "L" }, "_claims": { "hero.lede": ["H01"] }, "_nonclaims": ["hero.title"] }'
flow='{ "intro": { "p": ["one", "two"] }, "label": "x", "_claims": { "intro.p": ["W01", "W02"] }, "_nonclaims": ["label"] }'
guide='{ "why": { "p": "P", "cards": ["a", "b"] }, "kicker": "k", "_claims": { "why": ["G01"] }, "_nonclaims": ["kicker"] }'
doc='{ "desk": { "title": "D", "p": "P" }, "_claims": { "desk.p": ["D01"] }, "_nonclaims": ["desk.title"] }'
write_content() {
  printf '%s\n' "$1" >"$R/content/en.json";          printf '%s\n' "$1" >"$R/content/ko.json"
  printf '%s\n' "$2" >"$R/content/workflow.en.json"; printf '%s\n' "$2" >"$R/content/workflow.ko.json"
  printf '%s\n' "$guide" >"$R/content/guide.en.json"; printf '%s\n' "$guide" >"$R/content/guide.ko.json"
  printf '%s\n' "$doc" >"$R/content/doc.en.json";     printf '%s\n' "$doc" >"$R/content/doc.ko.json"
}
claims() { # $1 = source cell of W02
  cat >"$R/content/claims.md" <<EOF
| id | EN claim | source | note |
|---|---|---|---|
| H01 | Home claim. | docs/a.md:1-2@$PIN1 | |
| G01 | Guide claim. | framing | |
| D01 | Doc claim. | docs/d.md:1@$PIN2 | |
| W01 | Workflow claim one. | ws:Q/docs/guide.md:2-4@2026-01-02; ws:site/design/notes.md:3@2026-01-02 | |
| W02 | Workflow claim two. | $1 | |
EOF
}

# run: expected-exit, name, expected-output-fragment, env assignments...
run() {
  local want="$1" name="$2" frag="$3"; shift 3
  (cd "$R" && env -u CLAIMS_SOURCE_REPO -u CLAIMS_WORKSPACE_ROOTS "$@" node scripts/check-claims.mjs) >"$W/out" 2>&1; local got=$?
  if [ "$got" -ne "$want" ]; then bad "$name: exit $got, want $want" "$W/out"
  elif ! grep -qF -- "$frag" "$W/out"; then bad "$name: missing '$frag'" "$W/out"
  else ok "$name (exit $got)"; fi
}
RT="CLAIMS_WORKSPACE_ROOTS=$W/roots.tsv"

write_content "$home" "$flow"
claims 'ws:Z/one.txt:1@2026-01-02'
run 0 "format only without CLAIMS_WORKSPACE_ROOTS" "workspace ranges not checked: CLAIMS_WORKSPACE_ROOTS unset" NOOP=1
run 0 "all four content sets counted, both pins listed" "content sets: home 2, workflow 3, guide 4, doc 2; pins: abc1234, def5678" NOOP=1
run 0 "ranges checked with roots (relative dir resolves from the TSV)" "workspace ranges checked (3 of 3, 2 alias(es) + site)" "$RT"

claims 'ws:Y/one.txt:1@2026-01-02'
run 0 "unknown alias passes the format check without roots" "check-claims: PASS" NOOP=1
run 1 "unknown alias fails with roots" 'unknown workspace alias "Y"' "$RT"
claims 'ws:Q/docs/missing.md:1@2026-01-02'
run 1 "missing file fails with roots" "file does not exist in workspace Q" "$RT"
claims 'ws:Q/docs/guide.md:4-6@2026-01-02'
run 1 "range past the end fails with roots" "past the end of the file (5 lines)" "$RT"
claims 'ws:site/design/notes.md:2-4@2026-01-02'
run 1 "site alias is checked without roots" "past the end of the file (3 lines)" NOOP=1
claims 'ws:Q/docs/../guide.md:1@2026-01-02'
run 1 "a .. segment fails" 'without ".."' NOOP=1
claims 'ws:Q/docs/guide.md:1@2026-02-30'
run 1 "an impossible date fails" "bad date" NOOP=1
claims 'ws:Q/docs/guide.md:1'
run 1 "a missing date fails" "is not path:line[-line]@abc1234, path:line[-line]@def5678, ws:" NOOP=1
claims 'docs/b.md:3@abc1234; observation: not allowed inside a list'
run 1 "observation is whole-cell only" "is not path:line" NOOP=1
claims 'observation: 2026-01-02, a synthetic first-hand note'
run 0 "whole-cell observation passes" "1 observation(s)" NOOP=1
claims 'framing'
run 0 "framing passes" "check-claims: PASS" NOOP=1

# second pin (facts.json docSourceSha) ------------------------------------------------------------
claims 'docs/b.md:3@def5678'
run 0 "a citation at the second pin is accepted" "check-claims: PASS" NOOP=1
claims 'docs/b.md:3@0123abc'
run 1 "a citation at an unlisted sha is rejected" 'source "docs/b.md:3@0123abc" is not path:line[-line]@abc1234, path:line[-line]@def5678' NOOP=1
printf '{ "sourceSha": "abc1234" }\n' >"$R/facts.json"
claims 'framing'
run 1 "without docSourceSha a second-pin citation is rejected" 'source "docs/d.md:1@def5678" is not path:line[-line]@abc1234, ws:' NOOP=1
printf '{ "sourceSha": "abc1234", "docSourceSha": "main" }\n' >"$R/facts.json"
run 1 "a docSourceSha that is not a commit id fails" "facts.json docSourceSha is not a commit id: main" NOOP=1

# line ranges per commit, against a throwaway source repository with two commits:
# commit 1: docs/a.md (2 lines), docs/f.md (2 lines); commit 2: docs/f.md grows to 5 lines, docs/d.md and docs/new.md appear
# git here never sees the caller's repository-selecting variables (GU); to prove it, the fixture is built and the
# first passing case runs with GIT_DIR exported at a decoy repository X (one commit, in this temp dir), whose HEAD
# and index must be unchanged afterwards.
GU=(-u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_COMMON_DIR -u GIT_OBJECT_DIRECTORY
    -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_PREFIX)
GX() { local d="$1"; shift; env "${GU[@]}" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 git -C "$d" -c user.name=test -c user.email= "$@"; }
S="$W/source" X="$W/decoy"
mkdir -p "$S/docs" "$X"
G() { GX "$S" "$@"; }
GX "$X" init -q && printf 'x\n' >"$X/x.txt" && GX "$X" add -A && GX "$X" commit -qm decoy
XHEAD="$(GX "$X" rev-parse HEAD)"
export GIT_DIR="$X/.git"
G init -q
gd="$(G rev-parse --absolute-git-dir)"
case "$gd" in
  "$(cd "$S" && pwd -P)"/*) ok "fixture git dir is inside the fixture" ;;
  *) unset GIT_DIR; bad "fixture git dir is $gd, not inside $S: stopping before any add or commit"; echo "# check-claims tests: $pass passed, $fail failed"; exit 1 ;;
esac
printf 'a1\na2\n' >"$S/docs/a.md"; printf 'f1\nf2\n' >"$S/docs/f.md"
G add -A && G commit -qm one
S1="$(G rev-parse --short=7 HEAD)"
printf 'f1\nf2\nf3\nf4\nf5\n' >"$S/docs/f.md"; printf 'd1\n' >"$S/docs/d.md"; printf 'n1\n' >"$S/docs/new.md"
G add -A && G commit -qm two
S2="$(G rev-parse --short=7 HEAD)"
SR="CLAIMS_SOURCE_REPO=$S"
PIN1="$S1" PIN2="$S2"
facts "$S1" "$S2"
claims "docs/f.md:1-2@$S1; docs/f.md:4-5@$S2"
run 0 "same path at both commits in one run, range valid only at the longer revision" "line ranges checked against the source repo" "$SR"
run 0 "with GIT_DIR set at a decoy, the checker reads CLAIMS_SOURCE_REPO" "line ranges checked against the source repo" "$SR" "GIT_DIR=$X/.git"
unset GIT_DIR
[ "$(GX "$X" rev-parse HEAD)" = "$XHEAD" ] && ok "decoy HEAD unchanged" || bad "decoy HEAD moved"
xs="$(GX "$X" status --porcelain)"
[ -z "$xs" ] && ok "decoy index and tree unchanged" || { printf '%s\n' "$xs" >"$W/xs"; bad "decoy status not empty" "$W/xs"; }
claims "docs/new.md:1@$S2"
run 0 "a file added at the second commit passes there" "check-claims: PASS" "$SR"
claims "docs/new.md:1@$S1"
run 1 "a file that exists only at the second commit fails at the first" "docs/new.md does not exist at $S1" "$SR"
claims "docs/f.md:2-3@$S1"
run 1 "a range past the end at the cited commit fails" "docs/f.md:2-3@$S1 is past the end of docs/f.md (2 lines)" "$SR"
claims "docs/f.md:4-5@$S2; docs/f.md:4-5@$S1"
run 1 "the shorter revision is checked after the longer one was read" "docs/f.md:4-5@$S1 is past the end of docs/f.md (2 lines)" "$SR"
PIN1=abc1234 PIN2=def5678
facts "$PIN1" "$PIN2"

printf 'Q\t/nowhere\nsite\t/nowhere\n' >"$W/bad-roots.tsv"
run 1 "alias site is reserved in the roots file" 'alias "site" is reserved' "CLAIMS_WORKSPACE_ROOTS=$W/bad-roots.tsv"
run 1 "unreadable roots file fails" "CLAIMS_WORKSPACE_ROOTS file cannot be read" "CLAIMS_WORKSPACE_ROOTS=$W/none.tsv"

claims 'framing'
write_content "$home" '{ "intro": { "p": ["one", "two"] }, "label": "x", "extra": "y", "_claims": { "intro.p": ["W01", "W02"] }, "_nonclaims": ["label"] }'
run 1 "uncovered key in the workflow set fails" "workflow: leaf key in neither _claims nor _nonclaims: extra" NOOP=1
write_content "$home" '{ "intro": { "p": ["one", "two"] }, "label": "x", "_claims": { "intro.p": ["W01"] }, "_nonclaims": ["label", "nothing"] }'
run 1 "pattern matching no key is reported per set" "workflow: pattern matches no key: nothing" NOOP=1
run 1 "an id used by no set fails" "claims.md id W02 is not used in _claims of any content set" NOOP=1
write_content "$home" "$flow"
printf '%s\n' '{ "intro": { "p": ["one"] }, "label": "x", "_claims": { "intro.p": ["W01", "W02"] }, "_nonclaims": ["label"] }' >"$R/content/workflow.ko.json"
run 1 "EN/KO shape differs in the workflow set" "key only in content/workflow.en.json: intro.p.1" NOOP=1
rm "$R/content/workflow.ko.json"
run 1 "a missing workflow file fails" "workflow: content file(s) missing: content/workflow.ko.json" NOOP=1
write_content "$home" "$flow"
rm "$R/content/guide.ko.json"
run 1 "a missing guide file fails" "guide: content file(s) missing: content/guide.ko.json" NOOP=1
write_content "$home" "$flow"
rm "$R/content/doc.ko.json"
run 1 "a missing doc file fails" "doc: content file(s) missing: content/doc.ko.json" NOOP=1

echo "# check-claims tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ]

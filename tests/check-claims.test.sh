#!/usr/bin/env bash
# Tests for scripts/check-claims.mjs. Run from anywhere: bash tests/check-claims.test.sh
# Builds a throwaway repository with synthetic content sets, claims rows and workspaces (aliases Q and Z),
# copies the checker into it and runs it there. Nothing here names a real workspace.
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
printf '{ "sourceSha": "abc1234" }\n' >"$R/facts.json"
printf 'line one\nline two\nline three\n' >"$R/design/notes.md"
printf 'a\nb\nc\nd\ne\n' >"$W/ws/q/docs/guide.md"
printf 'only\n' >"$W/ws/z/one.txt"
printf '# synthetic roots\nQ\t%s\nZ\tws/z\n' "$W/ws/q" >"$W/roots.tsv"   # Z is relative to the TSV file

home='{ "hero": { "title": "T", "lede": "L" }, "_claims": { "hero.lede": ["H01"] }, "_nonclaims": ["hero.title"] }'
flow='{ "intro": { "p": ["one", "two"] }, "label": "x", "_claims": { "intro.p": ["W01", "W02"] }, "_nonclaims": ["label"] }'
write_content() {
  printf '%s\n' "$1" >"$R/content/en.json";          printf '%s\n' "$1" >"$R/content/ko.json"
  printf '%s\n' "$2" >"$R/content/workflow.en.json"; printf '%s\n' "$2" >"$R/content/workflow.ko.json"
}
claims() { # $1 = source cell of W02
  cat >"$R/content/claims.md" <<EOF
| id | EN claim | source | note |
|---|---|---|---|
| H01 | Home claim. | docs/a.md:1-2@abc1234 | |
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
run 0 "both content sets counted" "content sets: home 2, workflow 3" NOOP=1
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
run 1 "a missing date fails" "is not path:line[-line]@abc1234, ws:" NOOP=1
claims 'docs/b.md:3@abc1234; observation: not allowed inside a list'
run 1 "observation is whole-cell only" "is not path:line" NOOP=1
claims 'observation: 2026-01-02, a synthetic first-hand note'
run 0 "whole-cell observation passes" "1 observation(s)" NOOP=1
claims 'framing'
run 0 "framing passes" "check-claims: PASS" NOOP=1

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

echo "# check-claims tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ]

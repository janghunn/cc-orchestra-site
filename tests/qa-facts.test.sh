#!/usr/bin/env bash
# Tests for the facts check of scripts/qa.mjs. Run from anywhere: bash tests/qa-facts.test.sh
# One pristine copy of src, scripts, content, fonts and facts.json is built once into a temp dist. Each case then
# copies the inputs into a fresh throwaway repository, appends one {{f:KEY}} line to the copy's src/page.html (after
# the build, so the build's own rejection does not interfere) and runs `qa.mjs --static --only facts` on it.
# Names inherited from Object.prototype (toString, constructor, __proto__, ...) must not resolve.
# QA_SCRIPT=/path/to/qa.mjs tests that file instead of scripts/qa.mjs. Nothing here touches the real dist/.
set -u
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QA="${QA_SCRIPT:-$ROOT/scripts/qa.mjs}"
[ -f "$QA" ] || { echo "no such file: $QA" >&2; exit 2; }
W="$(mktemp -d "${TMPDIR:-/tmp}/qa-facts-test.XXXXXX")" || { echo "cannot create temp dir" >&2; exit 2; }
trap 'rm -rf "$W"' EXIT
pass=0 fail=0 n=0
ok()  { pass=$((pass + 1)); echo "ok   - $1"; }
bad() { fail=$((fail + 1)); echo "FAIL - $1"; [ -n "${2:-}" ] && sed 's/^/       /' "$2" | head -20; }

# fresh: new copy of the inputs in $R, with $QA as its scripts/qa.mjs
fresh() {
  n=$((n + 1)); R="$W/repo$n"
  mkdir -p "$R" && (cd "$ROOT" && cp -R src scripts content fonts facts.json "$R/") && cp "$QA" "$R/scripts/qa.mjs" \
    || { echo "cannot copy inputs" >&2; exit 2; }
}
# inject TEXT: append TEXT as its own line to the copy's src/page.html
inject() { printf '%s\n' "$1" >>"$R/src/page.html" || { echo "cannot edit src/page.html" >&2; exit 2; }; }
# run: expected-status (PASS|FAIL), name, expected-output-fragment
run() {
  local want="$1" name="$2" frag="$3" code
  [ "$want" = PASS ] && code=0 || code=1
  (cd "$R" && DIST="$W/dist" node scripts/qa.mjs --static --only facts) >"$W/out" 2>&1; local got=$?
  if [ "$got" -ne "$code" ]; then bad "$name: exit $got, want $code" "$W/out"
  elif ! grep -qF -- "QA facts $want" "$W/out"; then bad "$name: missing 'QA facts $want'" "$W/out"
  elif ! grep -qF -- "$frag" "$W/out"; then bad "$name: missing '$frag'" "$W/out"
  else ok "$name (QA facts $want)"; fi
}

fresh
(cd "$R" && env -u SITE_URL node scripts/build.mjs --out "$W/dist") >"$W/build.out" 2>&1 \
  || { echo "cannot build the pristine copy" >&2; sed 's/^/    /' "$W/build.out" | head -20 >&2; exit 2; }

run PASS "q0 unmodified copy passes" "all resolve"

i=0
for key in toString constructor __proto__ claude.toString codex.implement.hasOwnProperty; do
  i=$((i + 1)); fresh; inject "{{f:$key}}"
  run FAIL "q$i {{f:$key}} does not resolve" "{{f:$key}} does not resolve in facts.json"
done

fresh; inject '{{f:claude.dev}}'
run PASS "q6 {{f:claude.dev}} (a real route) resolves" "all resolve"

echo "# qa-facts tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ]

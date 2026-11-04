#!/usr/bin/env bash
# Tests for scripts/build.mjs. Run from anywhere: bash tests/build.test.sh
# Each case copies src, scripts, content, fonts and facts.json into a fresh throwaway repository, applies one
# synthetic edit to the copy and builds it into a temp directory. Names inherited from Object.prototype
# (toString, constructor) must be treated as unknown, never resolved. Nothing here touches the real dist/.
set -u
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
W="$(mktemp -d "${TMPDIR:-/tmp}/build-test.XXXXXX")" || { echo "cannot create temp dir" >&2; exit 2; }
trap 'rm -rf "$W"' EXIT
pass=0 fail=0 n=0
ok()  { pass=$((pass + 1)); echo "ok   - $1"; }
bad() { fail=$((fail + 1)); echo "FAIL - $1"; [ -n "${2:-}" ] && sed 's/^/       /' "$2" | head -20; }

# fresh: new copy of the build inputs in $R
fresh() {
  n=$((n + 1)); R="$W/repo$n"
  mkdir -p "$R" && (cd "$ROOT" && cp -R src scripts content fonts facts.json "$R/") || { echo "cannot copy build inputs" >&2; exit 2; }
}
# json FILE JS: edit a JSON file of the copy; JS sees the parsed file as j
json() {
  node -e 'const fs = require("fs"); const f = process.argv[1]; const j = JSON.parse(fs.readFileSync(f, "utf8"));
    new Function("j", process.argv[2])(j); fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");' "$R/$1" "$2" \
    || { echo "cannot edit $1" >&2; exit 2; }
}
# tpl TEXT: insert TEXT on its own line after <head> in the copy's src/page.html
tpl() {
  node -e 'const fs = require("fs"); const f = process.argv[1]; const s = fs.readFileSync(f, "utf8");
    if (!s.includes("<head>\n")) process.exit(1); fs.writeFileSync(f, s.replace("<head>\n", "<head>\n" + process.argv[2] + "\n"));' \
    "$R/src/page.html" "$1" || { echo "cannot edit src/page.html" >&2; exit 2; }
}
# run: expected-exit, name, expected-output-fragment, build arguments...
run() {
  local want="$1" name="$2" frag="$3"; shift 3
  (cd "$R" && env -u SITE_URL node scripts/build.mjs "$@") >"$W/out" 2>&1; local got=$?
  if [ "$got" -ne "$want" ]; then bad "$name: exit $got, want $want" "$W/out"
  elif ! grep -qF -- "$frag" "$W/out"; then bad "$name: missing '$frag'" "$W/out"
  else ok "$name (exit $got)"; fi
}

fresh
run 0 "b0 unmodified copy builds" "build: OK" --out "$W/dist$n"

fresh; json content/en.json 'j.meta.langName = "{{f:toString}}"'
run 1 "b1 {{f:toString}} is an unknown facts path" "unknown facts path: {{f:toString}}" --out "$W/dist$n"

fresh; json content/en.json 'j.meta.langName = "{{f:codex.constructor}}"'
run 1 "b2 {{f:codex.constructor}} is an unknown facts path" "unknown facts path" --out "$W/dist$n"

fresh; tpl '{{constructor}}'
run 1 "b3 {{constructor}} is an unknown build variable" "unknown build variable {{constructor}}" --out "$W/dist$n"

fresh; tpl '{{#if toString}}x{{/if}}'
run 1 "b4 {{#if toString}} is a missing content key" "missing content key toString" --out "$W/dist$n"

fresh; json content/en.json 'j.toString = "x"'
run 1 "b5 an en-only toString key is present in en only" "toString: present in en only" --out "$W/dist$n"

fresh
run 1 "b6 constructor is an unknown argument" "unknown argument: constructor" constructor "$W/dist$n"

echo "# build tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ]

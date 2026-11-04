#!/usr/bin/env bash
# Tests for safety-grep.sh. Run from anywhere: bash tests/safety-grep.test.sh
# DIST=<dir> picks the built site for check (a) (default: dist; built into a temp dir if missing).
# SAFETY_PRIVATE_PATTERNS, when set, is used for check (a) on the built site.
# Every sample value is synthetic (see tests/private-patterns.sample, tests/denylist.sample).
set -u
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
G="$ROOT/safety-grep.sh"
PS="$ROOT/tests/private-patterns.sample"
DS="$ROOT/tests/denylist.sample"
FX="$ROOT/tests/fixtures"
W="$(mktemp -d "${TMPDIR:-/tmp}/safety-grep-test.XXXXXX")" || { echo "cannot create temp dir" >&2; exit 2; }
trap 'rm -rf "$W"' EXIT
pass=0 fail=0
ok()  { pass=$((pass + 1)); echo "ok   - $1"; }
bad() { fail=$((fail + 1)); echo "FAIL - $1"; [ -n "${2:-}" ] && sed 's/^/       /' "$2" | head -20; }

# run: expected-exit, name, args... (stdout+stderr captured in $W/out)
run() {
  local want="$1" name="$2"; shift 2
  env -u SAFETY_PRIVATE_PATTERNS HOME="$W/nohome" bash "$G" "$@" >"$W/out" 2>&1; local got=$?
  if [ "$got" -eq "$want" ]; then ok "$name (exit $got)"; else bad "$name: exit $got, want $want" "$W/out"; fi
}
has()   { grep -qF -- "$2" "$W/out" && ok "$1" || bad "$1: missing '$2'" "$W/out"; }
hasnt() { grep -qF -- "$2" "$W/out" && bad "$1: unexpected '$2'" "$W/out" || ok "$1"; }

# (a) the built site is clean ---------------------------------------------------------------------
DIST="${DIST:-$ROOT/dist}"
case "$DIST" in /*) ;; *) DIST="$ROOT/$DIST" ;; esac
if [ ! -f "$DIST/index.html" ] && [ -f "$ROOT/scripts/build.mjs" ]; then
  (cd "$ROOT" && node scripts/build.mjs --out "$W/dist") >"$W/build.log" 2>&1 && DIST="$W/dist"
fi
ALLOWARGS=()
if [ -n "${SITE_URL:-}" ] && [ "$SITE_URL" != "https://example.invalid/cc-orchestra-site/" ]; then
  ALLOWARGS=(--allow "$SITE_URL" --allow-count 8)
fi
if [ -f "$DIST/index.html" ]; then
  if [ -n "${SAFETY_PRIVATE_PATTERNS:-}" ]; then
    run 0 "(a) built site is clean, real private patterns required" "$DIST" --require-private --private "$SAFETY_PRIVATE_PATTERNS" ${ALLOWARGS[@]+"${ALLOWARGS[@]}"}
  else
    run 0 "(a) built site is clean (private patterns not given)" "$DIST" ${ALLOWARGS[@]+"${ALLOWARGS[@]}"}
  fi
else
  bad "(a) no built site found (set DIST or provide scripts/build.mjs)"
fi

# (b) fixtures hit every built-in class -----------------------------------------------------------
run 1 "(b) fixtures exit 1" "$FX"
for c in abs-home-path harness-state-path mount-path ipv4 ipv6 local-host port machine-context email \
         secret-token source-code-leak unlisted-url file-name; do
  has "(b) class $c reports a hit" "HIT [$c]"
done
hasnt "(b) no private class without a private file" "HIT [private:"
has "(b) missing private file is noted" "NOTE: private patterns not loaded"
# every fixture extension is scanned (no extension filter)
for f in leaky.html leaky.css leaky.js leaky.json debug.py deploy.sh notes.md .env; do
  has "(b) $f is scanned" "] $f:"
done

# (c) sample private classes and the denylist -----------------------------------------------------
run 1 "(c) fixtures with samples exit 1" "$FX" --private "$PS" --denylist "$DS"
for c in owner-handle machine-name mount third-party-endpoint; do
  has "(c) private:$c reports a hit" "HIT [private:$c]"
done
has "(c) denylist reports a hit" "HIT [denylist]"
hasnt "(c) private hit content is never printed" "exampleowner wrote"
hasnt "(c) denylist hit content is never printed" "Project Nightjar"
SAFETY_PRIVATE_PATTERNS="$PS" bash "$G" "$FX" >"$W/out" 2>&1
has "(c) SAFETY_PRIVATE_PATTERNS is read" "HIT [private:owner-handle]"
mkdir -p "$W/clean"; printf '<p>plain text</p>\n' >"$W/clean/index.html"
printf '# comment\n\n   \n' >"$W/blank-deny"
run 0 "(c) blank and comment denylist lines match nothing" "$W/clean" --denylist "$W/blank-deny"
run 1 "(c) --redact keeps the hit, hides the line" "$FX" --redact
hasnt "(c) --redact prints no matched line" "example-user"

# (d) errors exit 2 -------------------------------------------------------------------------------
run 2 "(d) missing target" "$W/does-not-exist"
run 2 "(d) no target" --redact
run 2 "(d) missing denylist file" "$W/clean" --denylist "$W/no-such-denylist"
run 2 "(d) --denylist without a value" "$W/clean" --denylist
mkfifo "$W/deny-fifo"
run 2 "(d) denylist is a FIFO" "$W/clean" --denylist "$W/deny-fifo"
mkdir -p "$W/deny-dir"
run 2 "(d) denylist is a directory" "$W/clean" --denylist "$W/deny-dir"
printf 'Alex Example\n' >"$W/deny-000"; chmod 000 "$W/deny-000"
if [ -r "$W/deny-000" ]; then ok "(d) unreadable denylist (skipped: running as a user that can read mode 000)"
else run 2 "(d) denylist with mode 000" "$W/clean" --denylist "$W/deny-000"; fi
if [ -e /proc/self/mem ]; then
  run 2 "(d) denylist read error (EIO on /proc/self/mem) is never CLEAN" "$W/clean" --denylist /proc/self/mem
  hasnt "(d) denylist read error does not print CLEAN" "SAFETY-GREP: CLEAN"
  run 2 "(d) private patterns read error (EIO on /proc/self/mem)" "$W/clean" --private /proc/self/mem
fi
: >"$W/deny-empty"
run 0 "(c) empty denylist matches nothing" "$W/clean" --denylist "$W/deny-empty"
run 2 "(d) missing --private file" "$W/clean" --private "$W/no-such-private"
run 2 "(d) --require-private without any private file" "$W/clean" --require-private
printf 'no-tab-here\n' >"$W/bad-private"
run 2 "(d) malformed private file" "$W/clean" --private "$W/bad-private"
printf 'cls\t(unclosed\n' >"$W/bad-re"
run 2 "(d) invalid private ERE" "$W/clean" --private "$W/bad-re"
run 2 "(d) malformed --allow (not https)" "$W/clean" --allow "http://exampleowner.github.io/demo-site/" --allow-count 0
run 2 "(d) malformed --allow (no trailing slash)" "$W/clean" --allow "https://exampleowner.github.io/demo-site" --allow-count 0
run 2 "(d) malformed --allow (other host)" "$W/clean" --allow "https://example.com/demo-site/" --allow-count 0
run 2 "(d) --allow without --allow-count" "$W/clean" --allow "https://exampleowner.github.io/demo-site/"
run 2 "(d) --allow-count not a number" "$W/clean" --allow "https://exampleowner.github.io/demo-site/" --allow-count x
run 2 "(d) unknown option" "$W/clean" --frobnicate
TMPDIR="$W/no-such-tmp" run 2 "(d) temp-file failure" "$W/clean"
run 2 "(d) --source-mode on a file" "$W/clean/index.html" --source-mode

# (e) --allow exempts only the exact URL ----------------------------------------------------------
A="https://exampleowner.github.io/demo-site/"
mkdir -p "$W/allow"
printf '<link rel="alternate" hreflang="en" href="%s">\n<link rel="alternate" hreflang="ko" href="%sko/">\n' "$A" "$A" >"$W/allow/index.html"
run 0 "(e) exact allowed URL is exempt (count 2)" "$W/allow" --private "$PS" --allow "$A" --allow-count 2
run 1 "(e) without --allow the URL hits" "$W/allow" --private "$PS"
has "(e) owner handle hits without --allow" "HIT [private:owner-handle]"
has "(e) unlisted-url hits without --allow" "HIT [unlisted-url]"
run 1 "(e) wrong --allow-count fails" "$W/allow" --private "$PS" --allow "$A" --allow-count 1
has "(e) allow-count mismatch is reported" "HIT [allow-count]"
cp -r "$W/allow" "$W/allow2"; printf '<p>Written by exampleowner.</p>\n' >>"$W/allow2/index.html"
run 1 "(e) same handle elsewhere still hits" "$W/allow2" --private "$PS" --allow "$A" --allow-count 2
has "(e) the extra handle is reported" "HIT [private:owner-handle] index.html:3"
mkdir -p "$W/allow3"; printf '<a href="https://exampleowner.github.io/other-repo/">x</a>\n' >"$W/allow3/index.html"
run 1 "(e) a different URL of the same owner hits" "$W/allow3" --private "$PS" --allow "$A" --allow-count 0
mkdir -p "$W/allow4"; printf '<p>%s from /home/example-user</p>\n' "$A" >"$W/allow4/index.html"
run 1 "(e) other classes still see the allowed line" "$W/allow4" --private "$PS" --allow "$A" --allow-count 1
has "(e) abs-home-path still hits" "HIT [abs-home-path]"

# (f) T59 regressions -----------------------------------------------------------------------------
mkdir -p "$W/py"; cp "$FX/debug.py" "$W/py/"
run 1 "(f) token in a .py file" "$W/py"
has "(f) .py token is a secret-token hit" "HIT [secret-token] debug.py:2"
mkdir -p "$W/v6"; printf '<p>Host address: fe80::</p>\n' >"$W/v6/index.html"
run 1 "(f) fe80:: in HTML" "$W/v6"
has "(f) fe80:: is an ipv6 hit" "HIT [ipv6]"
mkdir -p "$W/css"
printf 'a::before{content:""}\n.x::-webkit-scrollbar{display:none}\n:root::selection{color:red}\n' >"$W/css/site.css"
run 0 "(f) a::before / ::-webkit- in CSS are not ipv6" "$W/css"
mkdir -p "$W/name/192.0.2.9"; printf 'x\n' >"$W/name/192.0.2.9/a.txt"
run 1 "(f) directory names are scanned" "$W/name"
has "(f) directory name hit" "HIT [file-name] 192.0.2.9 (ipv4)"
run 1 "(f) absolute fixture path" "$FX"
n=$(grep -c '^HIT \[abs-home-path\]' "$W/out")
[ "$n" -eq 1 ] && ok "(f) the target's own absolute path does not self-trigger" \
  || bad "(f) abs-home-path hits on an absolute target: $n, want 1 (leaky.html:3)" "$W/out"

# --source-mode -----------------------------------------------------------------------------------
# Token-shaped test strings are assembled at run time, so this file itself stays clean in source mode.
TOK="ghp""_UNLISTEDunlisted1111111111111111111"
mkdir -p "$W/src/tests" "$W/src/docs"
cp -r "$FX" "$W/src/tests/fixtures"
printf 'Local paths like /home/example-user are only checked in the built site.\n' >"$W/src/docs/a.md"
# (the fixtures hit the synthetic private samples on purpose, so these runs load no private file)
run 0 "(source) committed fixtures (listed synthetic tokens) and path classes are not hits" "$W/src" --source-mode
run 0 "(source) the repository itself has no unlisted token" "$ROOT" --source-mode
printf 'REPLAY_TOKEN=%s\n' "$TOK" >"$W/src/tests/fixtures/replay.env"
run 1 "(source) an unlisted token inside tests/fixtures hits" "$W/src" --source-mode
has "(source) fixture token reported" "HIT [secret-token] tests/fixtures/replay.env:1"
rm "$W/src/tests/fixtures/replay.env"
printf 'x = "ghp_EXAMPLEexample0000000000000000000" + "%s"\n' "$TOK" >"$W/src/docs/mixed.py"
run 1 "(source) a listed token does not hide another token on the same line" "$W/src" --source-mode
has "(source) mixed line reported" "HIT [secret-token] docs/mixed.py:1"
rm "$W/src/docs/mixed.py"
mkdir -p "$W/src2/docs"; printf 'See exampleowner for details.\n' >"$W/src2/docs/b.md"
run 1 "(source) private literal in the source hits" "$W/src2" --source-mode --private "$PS"
has "(source) private class reported" "HIT [private:owner-handle] docs/b.md:1"
printf 'Plain text.\n' >"$W/src2/docs/b.md"
run 0 "(source) clean source with private patterns" "$W/src2" --source-mode --private "$PS"
mkdir -p "$W/g2/tests"; cp "$G" "$W/g2/"; printf 'not-a-token\n' >"$W/g2/tests/synthetic-tokens.txt"
env -u SAFETY_PRIVATE_PATTERNS HOME="$W/nohome" bash "$W/g2/safety-grep.sh" "$W/src" --source-mode >"$W/out" 2>&1; got=$?
[ $got -eq 2 ] && ok "(source) a synthetic-tokens line that is not token-shaped is an error (exit 2)" \
  || bad "(source) bad synthetic-tokens line: exit $got, want 2" "$W/out"

# (g) temp-file failures are errors, never a dropped hit or CLEAN -------------------------------
# PATH shims only. Real binaries are resolved with type -P (a shell function named grep would
# make a shim that calls "grep" recurse).
RMKTEMP="$(type -P mktemp)" RGREP="$(type -P grep)" RBASH="$(type -P bash)"
mkdir -p "$W/shim-mktemp" "$W/shim-grep" "$W/shim-wc"
printf '#!%s\nd=$(%q "$@") || exit $?\n[ -n "${SHIM_BLOCK:-}" ] && mkdir "$d/$SHIM_BLOCK"\nprintf "%%s\\n" "$d"\n' \
  "$RBASH" "$RMKTEMP" >"$W/shim-mktemp/mktemp"
printf '#!%s\ncase "${1:-}" in\n  --*) ;;\n  -*q*) [ "$(readlink /proc/self/fd/0)" != /dev/null ] && { echo "grep: simulated read error" >&2; exit 2; } ;;\nesac\nexec %q "$@"\n' \
  "$RBASH" "$RGREP" >"$W/shim-grep/grep"
printf '#!%s\necho "wc: simulated failure" >&2\nexit 1\n' "$RBASH" >"$W/shim-wc/wc"
chmod 755 "$W/shim-mktemp/mktemp" "$W/shim-grep/grep" "$W/shim-wc/wc"
# srun: shim dir, target, args... (stdout+stderr in $W/out, exit status in $got)
srun() {
  local sd="$1"; shift
  env -u SAFETY_PRIVATE_PATTERNS HOME="$W/nohome" PATH="$sd:$PATH" "$RBASH" "$G" "$@" >"$W/out" 2>&1; got=$?
}
GM="$W/gm"
mkdir -p "$GM/content" "$GM/name/192.0.2.9" "$GM/url" "$GM/count" "$GM/private" "$GM/deny" "$GM/recheck"
printf '<p>Host 192.0.2.10</p>\n' >"$GM/content/index.html"
printf 'x\n' >"$GM/name/192.0.2.9/a.txt"
printf '<a href="https://unlisted.example.org/x">x</a>\n' >"$GM/url/index.html"
printf '<link href="%s">\n' "$A" >"$GM/count/index.html"
printf '<p>Written by exampleowner.</p>\n' >"$GM/private/index.html"
printf '<p>Alex Example</p>\n' >"$GM/deny/index.html"
printf '<p>%s by exampleowner</p>\n' "$A" >"$GM/recheck/index.html"
GNAMES="out one err hits namehits urls count names list private deny.raw deny.lf deny urlallow synth"
# gtarget: name, expected HIT text, args...
gtarget() {
  local t="$1" want="$2" b nf=0; shift 2
  run 1 "(g) control $t: exit 1 without a shim" "$@"
  has "(g) control $t: $want" "$want"
  for b in $GNAMES; do
    SHIM_BLOCK="$b" srun "$W/shim-mktemp" "$@"
    if [ $got -eq 0 ] || grep -qF "SAFETY-GREP: CLEAN" "$W/out"; then
      nf=$((nf + 1)); bad "(g) $t: temp file '$b' blocked gives exit $got (CLEAN or 0)" "$W/out"
    fi
  done
  [ $nf -eq 0 ] && ok "(g) $t: non-zero, no CLEAN with each temp file blocked ($GNAMES)"
}
export SHIM_BLOCK=""
gtarget content "HIT [ipv4]" "$GM/content"
gtarget name "HIT [file-name] 192.0.2.9 (ipv4)" "$GM/name"
gtarget url "HIT [unlisted-url]" "$GM/url"
gtarget count "HIT [allow-count]" "$GM/count" --allow "$A" --allow-count 2
gtarget private "HIT [private:owner-handle]" "$GM/private" --private "$PS"
gtarget deny "HIT [denylist]" "$GM/deny" --denylist "$DS"
gtarget recheck "HIT [private:owner-handle] index.html:1" "$GM/recheck" --private "$PS" --allow "$A" --allow-count 1
unset SHIM_BLOCK
if [ -e /proc/self/fd/0 ]; then
  srun "$W/shim-grep" "$GM/recheck" --private "$PS" --allow "$A" --allow-count 1 </dev/null
  if [ $got -eq 2 ] && ! grep -qF "SAFETY-GREP: CLEAN" "$W/out"; then ok "(g) grep read error in the exemption re-check is exit 2, no CLEAN"
  else bad "(g) grep read error in the exemption re-check: exit $got, want 2 and no CLEAN" "$W/out"; fi
  has "(g) re-check error names the line" "SAFETY-GREP: ERROR exemption re-check failed for [private:owner-handle] index.html:1"
else
  ok "(g) grep read error in the exemption re-check (skipped: no /proc/self/fd)"
fi
srun "$W/shim-wc" "$GM/count" --allow "$A" --allow-count 0
if [ $got -eq 2 ] && ! grep -qF "SAFETY-GREP: CLEAN" "$W/out"; then ok "(g) failing wc (count read) is exit 2, no CLEAN"
else bad "(g) failing wc (count read): exit $got, want 2 and no CLEAN" "$W/out"; fi

# (h) --allow exempts the allowed URL from every private class ------------------------------------
printf 'owner-handle\texampleowner\nperson\texampleowner\nhandle\t\\bexampleowner\\b\n' >"$W/priv3"
run 0 "(h) allowed URL twice, three private classes, count 2" "$W/allow" --private "$W/priv3" --allow "$A" --allow-count 2
run 1 "(h) extra handle on line 3 still hits" "$W/allow2" --private "$W/priv3" --allow "$A" --allow-count 2
for c in owner-handle person handle; do
  has "(h) private:$c hits on line 3" "HIT [private:$c] index.html:3"
done
hasnt "(h) the URL lines are exempt" "index.html:1"
mkdir -p "$W/allow5"; printf '<p><a href="%s">site</a> by exampleowner</p>\n' "$A" >"$W/allow5/index.html"
run 1 "(h) URL and bare handle on one line" "$W/allow5" --private "$W/priv3" --allow "$A" --allow-count 1
for c in owner-handle person handle; do
  has "(h) private:$c hits the shared line" "HIT [private:$c] index.html:1"
done
run 1 "(h) without --allow the URL hits every private class" "$W/allow" --private "$W/priv3"
for c in owner-handle person handle; do
  has "(h) private:$c hits without --allow" "HIT [private:$c] index.html:1"
done

echo "# safety-grep tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ]

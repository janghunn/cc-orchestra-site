#!/usr/bin/env bash
# Pre-publish content-safety check for the cc-orchestra site.
#
# Usage: safety-grep.sh <dir-or-file> [--denylist FILE] [--private FILE] [--require-private]
#                       [--allow URL --allow-count N] [--redact] [--source-mode]
#
# Exit 0 = clean, 1 = hit(s), 2 = error (usage, missing or unreadable target/denylist/private file,
# bad --allow, grep failure, temp-file failure). An error is never CLEAN. Every temp-file failure
# (create, write or read) is exit 2; it never drops a hit.
#
# Scans every text file under the target (no extension filter; binary files such as .otf are
# skipped by grep -I), case-insensitively, plus every file and directory name relative to the
# target. Built-in classes are generic. Private literals are loaded from a file that is never
# committed (--private FILE, else $SAFETY_PRIVATE_PATTERNS, else
# $HOME/.config/cc-orchestra-site/private-patterns.tsv); format: one "class<TAB>ERE" per line,
# "#" comments. --denylist FILE adds fixed strings (one per line, "#" comments).
#
# --allow URL --allow-count N: one Pages base URL (https://<owner>.github.io/<repo>/), exempt from
#   every private class and the unlisted-url class only (no other built-in class, not the
#   denylist): exact occurrences of it are blanked and the class is re-tested on the line, so any
#   other match on that line still hits. The target must contain exactly N occurrences of it,
#   otherwise HIT [allow-count].
# --redact: print file:line only, never the matched line.
# --source-mode: scan the repository source (git ls-files, including untracked files that are not
#   ignored) with the private, denylist and secret-token classes only. The exact synthetic token
#   strings listed in tests/synthetic-tokens.txt (each must match secret-token) are exempt there;
#   any other token-shaped string, in tests/fixtures/ or anywhere else, is a hit.
set -u
umask 077
export LC_ALL=C

err() { echo "SAFETY-GREP: ERROR $*" >&2; exit 2; }
usage() {
  echo "usage: safety-grep.sh <dir-or-file> [--denylist FILE] [--private FILE] [--require-private]" >&2
  echo "                      [--allow URL --allow-count N] [--redact] [--source-mode]" >&2
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || err "cannot resolve script directory"
URL_ALLOW_FILE="$HERE/safety-url-allow.txt"

TARGET="" TARGET_SET=0 DENY="" DENY_SET=0 PRIV="" PRIV_SET=0 REQPRIV=0
ALLOW="" ALLOW_SET=0 ALLOWN="" ALLOWN_SET=0 REDACT=0 SOURCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --denylist)        [ $# -ge 2 ] || err "--denylist needs a FILE"; DENY="$2"; DENY_SET=1; shift 2 ;;
    --private)         [ $# -ge 2 ] || err "--private needs a FILE"; PRIV="$2"; PRIV_SET=1; shift 2 ;;
    --require-private) REQPRIV=1; shift ;;
    --allow)           [ $# -ge 2 ] || err "--allow needs a URL"; ALLOW="$2"; ALLOW_SET=1; shift 2 ;;
    --allow-count)     [ $# -ge 2 ] || err "--allow-count needs N"; ALLOWN="$2"; ALLOWN_SET=1; shift 2 ;;
    --redact)          REDACT=1; shift ;;
    --source-mode)     SOURCE=1; shift ;;
    -h|--help)         usage; exit 2 ;;
    -*)                usage; err "unknown option: $1" ;;
    *)                 [ $TARGET_SET -eq 0 ] || err "more than one target given"
                       TARGET="$1"; TARGET_SET=1; shift ;;
  esac
done
[ $TARGET_SET -eq 1 ] && [ -n "$TARGET" ] || { usage; err "no target given"; }
[ -e "$TARGET" ] || err "target not found: $TARGET"
[ -r "$TARGET" ] || err "target not readable: $TARGET"

if [ $ALLOW_SET -eq 1 ]; then
  [[ "$ALLOW" =~ ^https://[a-z0-9-]+\.github\.io/[A-Za-z0-9._-]+/$ ]] \
    || err "--allow must be one Pages base URL of the form https://<owner>.github.io/<repo>/"
  [ $ALLOWN_SET -eq 1 ] || err "--allow needs --allow-count N"
fi
if [ $ALLOWN_SET -eq 1 ]; then
  [ $ALLOW_SET -eq 1 ] || err "--allow-count needs --allow URL"
  [[ "$ALLOWN" =~ ^[0-9]+$ ]] || err "--allow-count must be a non-negative integer"
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/safety-grep.XXXXXX")" || err "cannot create a temp directory (check TMPDIR)"
trap 'rm -rf "$TMP"' EXIT
# absolute, so temp paths stay valid after the cd "$BASE" in tgrep (TMPDIR may be relative)
TMP="$(cd -- "$TMP" && pwd -P)" || err "cannot resolve the temp directory (check TMPDIR)"
# one temp file per scan stage: content hits, file-name hits, unlisted-url matches, allow-count
ERR="$TMP/err" HITF="$TMP/hits" NAMEHITF="$TMP/namehits" URLF="$TMP/urls" COUNTF="$TMP/count"
NAMES="$TMP/names" DENYF="$TMP/deny"

# copy an input file to a private temp file; any read error (EIO, EACCES, ...) is exit 2, never CLEAN.
# All parsing below reads the copy, so a failing read cannot look like end of file. The copy always
# ends with a newline (one is appended; the parsers skip blank lines), so load() can count its lines.
slurp() { # src, dest, label
  { cat -- "$1" && echo; } >"$2" 2>"$ERR" || err "cannot read $3: $(head -1 "$ERR")"
}

# load a temp file into array $1, one element per line (or per NUL-terminated record with "nul").
# The element count must equal an independent count of the file (wc), so a file that opens but
# cannot be read (a directory, EIO) fails here instead of looking empty. Returns 2 on any failure.
load() { # array name, file, [nul]
  local -n _A="$1"; local _f="$2" _want
  if [ "${3:-}" = nul ]; then
    _want=$(set -o pipefail; tr -cd '\0' <"$_f" | wc -c) || return 2
    mapfile -d '' -t _A <"$_f" || return 2
  else
    _want=$(wc -l <"$_f") || return 2
    mapfile -t _A <"$_f" || return 2
  fi
  [[ "$_want" =~ ^[[:space:]]*[0-9]+[[:space:]]*$ ]] || return 2
  [ ${#_A[@]} -eq $((_want)) ] || return 2
}

# ---- private patterns ---------------------------------------------------------------------------
PSRC=""
if [ $PRIV_SET -eq 1 ]; then
  PSRC="$PRIV"; [ -n "$PSRC" ] && [ -f "$PSRC" ] && [ -r "$PSRC" ] || err "private patterns file not found or unreadable: ${PRIV:-<empty>}"
elif [ -n "${SAFETY_PRIVATE_PATTERNS:-}" ]; then
  PSRC="$SAFETY_PRIVATE_PATTERNS"; [ -f "$PSRC" ] && [ -r "$PSRC" ] || err "SAFETY_PRIVATE_PATTERNS file not found or unreadable"
elif [ -n "${HOME:-}" ] && [ -e "$HOME/.config/cc-orchestra-site/private-patterns.tsv" ]; then
  PSRC="$HOME/.config/cc-orchestra-site/private-patterns.tsv"; [ -r "$PSRC" ] || err "default private patterns file unreadable"
fi
PCLS=() PRE=()
if [ -n "$PSRC" ]; then
  slurp "$PSRC" "$TMP/private" "private patterns file"
  load LINES "$TMP/private" || err "cannot read the private patterns copy"
  n=0
  for line in ${LINES[@]+"${LINES[@]}"}; do
    n=$((n + 1)); line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    [[ "$line" == *$'\t'* ]] || err "private patterns file line $n: expected class<TAB>ERE"
    cls="${line%%$'\t'*}"; re="${line#*$'\t'}"
    [[ "$cls" =~ ^[a-z0-9-]+$ ]] || err "private patterns file line $n: bad class name"
    [ -n "$re" ] || err "private patterns file line $n: empty pattern"
    grep -qiE -e "$re" </dev/null 2>/dev/null; [ $? -le 1 ] || err "private patterns file line $n: invalid ERE"
    PCLS+=("$cls"); PRE+=("$re")
  done
  [ ${#PCLS[@]} -gt 0 ] || { [ $REQPRIV -eq 1 ] && err "private patterns file has no patterns"; }
else
  [ $REQPRIV -eq 1 ] && err "private patterns required (--require-private) but none found"
  echo "NOTE: private patterns not loaded (pass --private FILE or set SAFETY_PRIVATE_PATTERNS)" >&2
fi

# ---- denylist -------------------------------------------------------------------------------------
if [ $DENY_SET -eq 1 ]; then
  [ -n "$DENY" ] && [ -f "$DENY" ] && [ -r "$DENY" ] || err "denylist file not found or unreadable: ${DENY:-<empty>}"
  slurp "$DENY" "$TMP/deny.raw" "denylist"
  tr -d '\r' <"$TMP/deny.raw" >"$TMP/deny.lf" 2>"$ERR" || err "cannot read denylist: $(head -1 "$ERR")"
  ( exec >"$DENYF" 2>"$ERR" || exit 2; exec grep -v -e '^[[:space:]]*$' -e '^[[:space:]]*#' -- "$TMP/deny.lf" ); g=$?
  [ $g -le 1 ] || err "cannot read denylist: $(head -1 "$ERR")"
  [ -s "$DENYF" ] || { DENY_SET=0; echo "NOTE: denylist has no entries" >&2; }
fi

# ---- URL allowlist (built-in unlisted-url class) -------------------------------------------------
URLP=()
if [ $SOURCE -eq 0 ]; then
  [ -f "$URL_ALLOW_FILE" ] && [ -r "$URL_ALLOW_FILE" ] || err "URL allowlist not found: safety-url-allow.txt next to this script"
  slurp "$URL_ALLOW_FILE" "$TMP/urlallow" "safety-url-allow.txt"
  load LINES "$TMP/urlallow" || err "cannot read the safety-url-allow.txt copy"
  for line in ${LINES[@]+"${LINES[@]}"}; do
    line="${line%$'\r'}"; line="${line#"${line%%[![:space:]]*}"}"; line="${line%"${line##*[![:space:]]}"}"
    [ -z "$line" ] || [ "${line:0:1}" = "#" ] && continue
    [[ "$line" =~ ^https?://[^/[:space:]]+(/|$) ]] || err "safety-url-allow.txt: not an absolute URL prefix: $line"
    URLP+=("$line")
  done
fi

# ---- file list (paths relative to BASE) ---------------------------------------------------------
FILES=()
if [ -d "$TARGET" ]; then
  BASE="$TARGET"
  if [ $SOURCE -eq 1 ] && git -C "$BASE" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$BASE" ls-files -z --cached --others --exclude-standard >"$TMP/list" 2>"$ERR" \
      || err "git ls-files failed: $(head -1 "$ERR")"
  else
    (cd "$BASE" && find . -mindepth 1 \( -type f -o -type l \) -print0) >"$TMP/list" 2>"$ERR" \
      || err "cannot list files: $(head -1 "$ERR")"
  fi
  load LIST "$TMP/list" nul || err "cannot read the file list"
  for f in ${LIST[@]+"${LIST[@]}"}; do
    f="${f#./}"
    [ -f "$BASE/$f" ] && FILES+=("$f")
  done
else
  [ $SOURCE -eq 0 ] || err "--source-mode needs a directory target"
  BASE="$(dirname -- "$TARGET")"; FILES=("$(basename -- "$TARGET")")
fi
# names for the file-name class: every file and every directory on the way to it
{
  for f in ${FILES[@]+"${FILES[@]}"}; do
    d="$f"; printf '%s\n' "$d"
    while [[ "$d" == */* ]]; do d="${d%/*}"; printf '%s\n' "$d"; done
  done
  [ -d "$TARGET" ] && [ $SOURCE -eq 0 ] && (cd "$BASE" && find . -mindepth 1 -type d | sed 's|^\./||')
} | sort -u >"$NAMES" || err "cannot build the name list"

# ---- classes -------------------------------------------------------------------------------------
BCLS=(abs-home-path harness-state-path mount-path ipv4 ipv6 local-host port machine-context email
      secret-token source-code-leak)
declare -A B=(
  [abs-home-path]='(/home/[a-z0-9_.-]+|/Users/[A-Za-z0-9_.-]+|/root/|C:\\Users\\)'
  [harness-state-path]='(\.claude/(orchestra|agents|projects)|orchestra-state|orchestra-vault|\.codex/|\.ssh/)'
  [mount-path]='(/mnt/|/media/|/srv/|/etc/orch)'
  [ipv4]='\b([0-9]{1,3}\.){3}[0-9]{1,3}\b'
  [ipv6]='(\[[0-9a-f.]*:[0-9a-f.:]*:[0-9a-f.:]*\]|\b([0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b|\b([0-9a-f]{1,4}:){1,7}:[0-9a-f]{1,4}(:[0-9a-f]{1,4}){0,6}\b|(^|[^a-z0-9:])::([0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4}\b|\b([0-9a-f]{1,4}:){1,7}:([^0-9a-z:_-]|$)|(^|[^0-9a-z:])::([^0-9a-z:_-]|$))'
  [local-host]='\b(localhost|127\.0\.0\.1|0\.0\.0\.0|\.local\b|\.internal\b|\.lan\b)'
  [port]='((localhost|([0-9]{1,3}\.){3}[0-9]{1,3}|\[[0-9a-f:.]+\]|[a-z][a-z0-9-]*\.(local|lan|internal)):[0-9]{2,5}\b|--port[ =][0-9]+)'
  [machine-context]='(ubuntu@|root@|\bssh [a-z])'
  [email]='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}'
  [secret-token]='(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer [A-Za-z0-9._-]{20,}|(api|secret|access)[_-]?(key|token)["'"'"']?[[:space:]]*[:=][[:space:]]*(["'"'"'][^"'"'"']{8,}|[A-Za-z0-9_./+=-]{16,}))'
  [source-code-leak]='(^|[[:space:]])(def |class [A-Z][A-Za-z]+\(|#!/usr/bin/env|set -[euo]+|import [a-z_]+$)'
)
# --source-mode: exact synthetic token strings that the committed fixtures use on purpose
SYNTH=()
SYNTH_FILE="$HERE/tests/synthetic-tokens.txt"
if [ $SOURCE -eq 1 ] && [ -e "$SYNTH_FILE" ]; then
  [ -f "$SYNTH_FILE" ] && [ -r "$SYNTH_FILE" ] || err "tests/synthetic-tokens.txt unreadable"
  slurp "$SYNTH_FILE" "$TMP/synth" "tests/synthetic-tokens.txt"
  load LINES "$TMP/synth" || err "cannot read the tests/synthetic-tokens.txt copy"
  n=0
  for line in ${LINES[@]+"${LINES[@]}"}; do
    n=$((n + 1)); line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    printf '%s\n' "$line" | grep -qiE -e "${B[secret-token]}" \
      || err "tests/synthetic-tokens.txt line $n does not match the secret-token class"
    SYNTH+=("$line")
  done
fi
URLRE='https?://[^][:space:]"<>()`{}|\\^'"'"']+'

rc=0 HITS=0
hit() { HITS=$((HITS + 1)); [ $rc -eq 0 ] && rc=1; }
gerr() { echo "SAFETY-GREP: ERROR scanning [$1]: $(head -1 "$ERR")" >&2; rc=2; }
lerr() { echo "SAFETY-GREP: ERROR cannot read the scan results of [$1]" >&2; rc=2; }

# run grep from BASE with stdout to temp file $1; a failed cd or redirect is 2 (error), never 1
tgrep() { # out file, grep args...
  local o="$1"; shift
  ( cd "$BASE" || exit 2; exec >"$o" 2>"$ERR" || exit 2; exec grep "$@" )
}

# run grep over a file list from BASE into $HITF; $1 = list name (FILES), rest = grep args
rgrep() {
  local -n L="$1"; shift
  [ ${#L[@]} -gt 0 ] || return 1
  tgrep "$HITF" -HnI -i "$@" -- "${L[@]}"
}

# print hits from $HITF. $1 label, $2 show content (1/0), $3 class regex for the exemption re-test
# (or empty), $4 exemption: "allow" (the --allow URL) or "synthetic" (tests/synthetic-tokens.txt).
# Exact occurrences of the exempt strings are blanked out of the line, then the class regex is re-run.
report() {
  local label="$1" show="$2" are="$3" ex="${4:-}" l f rest n c c2 t g R=()
  load R "$HITF" || { lerr "$label"; return; }
  for l in ${R[@]+"${R[@]}"}; do
    f="${l%%:*}"; rest="${l#*:}"; n="${rest%%:*}"; c="${rest#*:}"
    if [ -n "$are" ]; then
      c2="$c"
      [ "$ex" = allow ] && [ $ALLOW_SET -eq 1 ] && c2="${c2//"$ALLOW"/ }"
      if [ "$ex" = synthetic ]; then
        for t in ${SYNTH[@]+"${SYNTH[@]}"}; do c2="${c2//"$t"/ }"; done
      fi
      if [ "$c2" != "$c" ]; then
        printf '%s\n' "$c2" | grep -qiE -e "$are"; g=$?
        [ $g -eq 1 ] && continue
        [ $g -ge 2 ] && { echo "SAFETY-GREP: ERROR exemption re-check failed for [$label] $f:$n" >&2; rc=2; }
      fi
    fi
    hit; echo "HIT [$label] $f:$n"
    [ "$show" = 1 ] && [ $REDACT -eq 0 ] && printf '    %s\n' "${c:0:240}"
  done
}

url_allowed() { # $1 url
  local u="$1" p nx
  [ $ALLOW_SET -eq 1 ] && [ "${u:0:${#ALLOW}}" = "$ALLOW" ] && return 0
  for p in ${URLP[@]+"${URLP[@]}"}; do
    [ "${u:0:${#p}}" = "$p" ] || continue
    [ "${p: -1}" = "/" ] && return 0
    nx="${u:${#p}:1}"
    case "$nx" in ""|/|\?|\#) return 0 ;; esac
  done
  return 1
}

name_scan() { # $1 class label, $2 show (1/0), grep args...
  local label="$1" show="$2" l R=(); shift 2
  [ -s "$NAMES" ] || return 0
  tgrep "$NAMEHITF" -n -i "$@" -- "$NAMES"; local g=$?
  [ $g -ge 2 ] && { gerr "file-name/$label"; return; }
  [ $g -eq 0 ] || return 0
  load R "$NAMEHITF" || { lerr "file-name/$label"; return; }
  for l in ${R[@]+"${R[@]}"}; do
    hit
    if [ "$show" = 1 ] && [ $REDACT -eq 0 ]; then echo "HIT [file-name] ${l#*:} ($label)"
    else echo "HIT [file-name] (name withheld) ($label)"; fi
  done
}

if [ $SOURCE -eq 0 ]; then
  for k in "${BCLS[@]}"; do
    rgrep FILES -E -e "${B[$k]}"; g=$?
    [ $g -ge 2 ] && { gerr "$k"; continue; }
    [ $g -eq 0 ] && report "$k" 1 ""
    name_scan "$k" 1 -E -e "${B[$k]}"
  done
  # unlisted-url: every absolute http(s) URL must start with a listed prefix
  if [ ${#FILES[@]} -gt 0 ]; then
    tgrep "$URLF" -HnoI -i -E -e "$URLRE" -- "${FILES[@]}"; g=$?
    if [ $g -ge 2 ]; then gerr unlisted-url
    elif [ $g -eq 0 ] && ! load R "$URLF"; then lerr unlisted-url
    elif [ $g -eq 0 ]; then
      for l in ${R[@]+"${R[@]}"}; do
        f="${l%%:*}"; rest="${l#*:}"; n="${rest%%:*}"; u="${rest#*:}"
        u="${u%"${u##*[!.,;:]}"}"
        url_allowed "$u" && continue
        hit; echo "HIT [unlisted-url] $f:$n"
        [ $REDACT -eq 0 ] && printf '    %s\n' "${u:0:240}"
      done
    fi
  fi
else
  rgrep FILES -E -e "${B[secret-token]}"; g=$?
  [ $g -ge 2 ] && gerr secret-token
  [ $g -eq 0 ] && report secret-token 1 "${B[secret-token]}" synthetic
  name_scan secret-token 1 -E -e "${B[secret-token]}"
fi

for i in ${PCLS[@]+"${!PCLS[@]}"}; do
  label="private:${PCLS[$i]}"; are=""
  [ $ALLOW_SET -eq 1 ] && are="${PRE[$i]}"
  rgrep FILES -E -e "${PRE[$i]}"; g=$?
  [ $g -ge 2 ] && { gerr "$label"; continue; }
  [ $g -eq 0 ] && report "$label" 0 "$are" allow
  name_scan "$label" 0 -E -e "${PRE[$i]}"
done

if [ $DENY_SET -eq 1 ]; then
  rgrep FILES -F -f "$DENYF"; g=$?
  [ $g -ge 2 ] && gerr denylist
  [ $g -eq 0 ] && report denylist 0 ""
  name_scan denylist 0 -F -f "$DENYF"
fi

if [ $ALLOW_SET -eq 1 ]; then
  # the occurrence count is the number of loaded lines of $COUNTF; a failed load is an error, never 0
  found=0 g=1 R=()
  if [ ${#FILES[@]} -gt 0 ]; then
    tgrep "$COUNTF" -ohIF -e "$ALLOW" -- "${FILES[@]}"; g=$?
    if [ $g -ge 2 ]; then gerr allow-count
    elif load R "$COUNTF"; then found=${#R[@]}
    else lerr allow-count; g=2; fi
  fi
  if [ $g -le 1 ] && [ "$found" -ne "$ALLOWN" ]; then
    hit; echo "HIT [allow-count] the allowed URL occurs $found times, expected $ALLOWN"
  fi
fi

case $rc in
  0) echo "SAFETY-GREP: CLEAN ($TARGET)" ;;
  1) echo "SAFETY-GREP: $HITS HIT(S) ($TARGET)" ;;
  *) echo "SAFETY-GREP: ERROR, scan incomplete ($TARGET)" >&2 ;;
esac
exit $rc

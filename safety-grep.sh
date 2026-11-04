#!/usr/bin/env bash
# Pre-publish content-safety check for the cc-orchestra site.
#
# Usage: safety-grep.sh <dir-or-file> [--denylist FILE] [--private FILE] [--require-private]
#                       [--allow URL --allow-count N] [--redact] [--source-mode]
#
# Exit 0 = clean, 1 = hit(s), 2 = error (usage, missing or unreadable target/denylist/private file,
# bad --allow, grep failure, temp-file failure). An error is never CLEAN.
#
# Scans every text file under the target (no extension filter; binary files such as .otf are
# skipped by grep -I), case-insensitively, plus every file and directory name relative to the
# target. Built-in classes are generic. Private literals are loaded from a file that is never
# committed (--private FILE, else $SAFETY_PRIVATE_PATTERNS, else
# $HOME/.config/cc-orchestra-site/private-patterns.tsv); format: one "class<TAB>ERE" per line,
# "#" comments. --denylist FILE adds fixed strings (one per line, "#" comments).
#
# --allow URL --allow-count N: one Pages base URL (https://<owner>.github.io/<repo>/), exempt from
#   the private:owner-handle and unlisted-url classes only; the target must contain exactly N
#   occurrences of it, otherwise HIT [allow-count].
# --redact: print file:line only, never the matched line.
# --source-mode: scan the repository source (git ls-files, including untracked files that are not
#   ignored) with the private, denylist and secret-token classes only. tests/fixtures/ is skipped
#   by secret-token there, because its synthetic tokens exist to make the built-in scan hit.
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
OUT="$TMP/out" ERR="$TMP/err" NAMES="$TMP/names" DENYF="$TMP/deny" ONE="$TMP/one"

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
  n=0
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1)); line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    [[ "$line" == *$'\t'* ]] || err "private patterns file line $n: expected class<TAB>ERE"
    cls="${line%%$'\t'*}"; re="${line#*$'\t'}"
    [[ "$cls" =~ ^[a-z0-9-]+$ ]] || err "private patterns file line $n: bad class name"
    [ -n "$re" ] || err "private patterns file line $n: empty pattern"
    grep -qiE -e "$re" </dev/null 2>/dev/null; [ $? -le 1 ] || err "private patterns file line $n: invalid ERE"
    PCLS+=("$cls"); PRE+=("$re")
  done <"$PSRC"
  [ ${#PCLS[@]} -gt 0 ] || { [ $REQPRIV -eq 1 ] && err "private patterns file has no patterns"; }
else
  [ $REQPRIV -eq 1 ] && err "private patterns required (--require-private) but none found"
  echo "NOTE: private patterns not loaded (pass --private FILE or set SAFETY_PRIVATE_PATTERNS)" >&2
fi

# ---- denylist -------------------------------------------------------------------------------------
if [ $DENY_SET -eq 1 ]; then
  [ -n "$DENY" ] && [ -f "$DENY" ] && [ -r "$DENY" ] || err "denylist file not found or unreadable: ${DENY:-<empty>}"
  { grep -v -e '^[[:space:]]*$' -e '^[[:space:]]*#' -- "$DENY" || true; } | tr -d '\r' >"$DENYF" \
    || err "cannot read denylist"
  [ -s "$DENYF" ] || { DENY_SET=0; echo "NOTE: denylist has no entries" >&2; }
fi

# ---- URL allowlist (built-in unlisted-url class) -------------------------------------------------
URLP=()
if [ $SOURCE -eq 0 ]; then
  [ -f "$URL_ALLOW_FILE" ] && [ -r "$URL_ALLOW_FILE" ] || err "URL allowlist not found: safety-url-allow.txt next to this script"
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"; line="${line#"${line%%[![:space:]]*}"}"; line="${line%"${line##*[![:space:]]}"}"
    [ -z "$line" ] || [ "${line:0:1}" = "#" ] && continue
    [[ "$line" =~ ^https?://[^/[:space:]]+(/|$) ]] || err "safety-url-allow.txt: not an absolute URL prefix: $line"
    URLP+=("$line")
  done <"$URL_ALLOW_FILE"
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
  while IFS= read -r -d '' f; do
    f="${f#./}"
    [ -f "$BASE/$f" ] && FILES+=("$f")
  done <"$TMP/list"
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
FILES_NOFIX=()
for f in ${FILES[@]+"${FILES[@]}"}; do [[ "$f" == tests/fixtures/* ]] || FILES_NOFIX+=("$f"); done

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
URLRE='https?://[^][:space:]"<>()`{}|\\^'"'"']+'

rc=0 HITS=0
hit() { HITS=$((HITS + 1)); [ $rc -eq 0 ] && rc=1; }
gerr() { echo "SAFETY-GREP: ERROR scanning [$1]: $(head -1 "$ERR")" >&2; rc=2; }

# run grep over a file list from BASE; $1 = list name (FILES or FILES_NOFIX), rest = grep args
rgrep() {
  local -n L="$1"; shift
  [ ${#L[@]} -gt 0 ] || { : >"$OUT"; return 1; }
  (cd "$BASE" && grep -HnI -i "$@" -- "${L[@]}") >"$OUT" 2>"$ERR"
}

# print hits from $OUT. $1 label, $2 show content (1/0), $3 allow-filter regex (or empty)
report() {
  local label="$1" show="$2" are="$3" l f rest n c c2
  while IFS= read -r l; do
    f="${l%%:*}"; rest="${l#*:}"; n="${rest%%:*}"; c="${rest#*:}"
    if [ -n "$are" ] && [ $ALLOW_SET -eq 1 ]; then
      c2="${c//"$ALLOW"/ }"
      printf '%s\n' "$c2" >"$ONE"
      grep -qiE -e "$are" -- "$ONE" || continue
    fi
    hit; echo "HIT [$label] $f:$n"
    [ "$show" = 1 ] && [ $REDACT -eq 0 ] && printf '    %s\n' "${c:0:240}"
  done <"$OUT"
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
  local label="$1" show="$2" l; shift 2
  [ -s "$NAMES" ] || return 0
  grep -n -i "$@" -- "$NAMES" >"$OUT" 2>"$ERR"; local g=$?
  [ $g -ge 2 ] && { gerr "file-name/$label"; return; }
  [ $g -eq 0 ] || return 0
  while IFS= read -r l; do
    hit
    if [ "$show" = 1 ] && [ $REDACT -eq 0 ]; then echo "HIT [file-name] ${l#*:} ($label)"
    else echo "HIT [file-name] (name withheld) ($label)"; fi
  done <"$OUT"
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
    (cd "$BASE" && grep -HnoI -i -E -e "$URLRE" -- "${FILES[@]}") >"$OUT" 2>"$ERR"; g=$?
    if [ $g -ge 2 ]; then gerr unlisted-url
    elif [ $g -eq 0 ]; then
      while IFS= read -r l; do
        f="${l%%:*}"; rest="${l#*:}"; n="${rest%%:*}"; u="${rest#*:}"
        u="${u%"${u##*[!.,;:]}"}"
        url_allowed "$u" && continue
        hit; echo "HIT [unlisted-url] $f:$n"
        [ $REDACT -eq 0 ] && printf '    %s\n' "${u:0:240}"
      done <"$OUT"
    fi
  fi
else
  rgrep FILES_NOFIX -E -e "${B[secret-token]}"; g=$?
  [ $g -ge 2 ] && gerr secret-token
  [ $g -eq 0 ] && report secret-token 1 ""
  name_scan secret-token 1 -E -e "${B[secret-token]}"
fi

for i in ${PCLS[@]+"${!PCLS[@]}"}; do
  label="private:${PCLS[$i]}"; are=""
  [ "${PCLS[$i]}" = "owner-handle" ] && are="${PRE[$i]}"
  rgrep FILES -E -e "${PRE[$i]}"; g=$?
  [ $g -ge 2 ] && { gerr "$label"; continue; }
  [ $g -eq 0 ] && report "$label" 0 "$are"
  name_scan "$label" 0 -E -e "${PRE[$i]}"
done

if [ $DENY_SET -eq 1 ]; then
  rgrep FILES -F -f "$DENYF"; g=$?
  [ $g -ge 2 ] && gerr denylist
  [ $g -eq 0 ] && report denylist 0 ""
  name_scan denylist 0 -F -f "$DENYF"
fi

if [ $ALLOW_SET -eq 1 ]; then
  if [ ${#FILES[@]} -gt 0 ]; then
    (cd "$BASE" && grep -ohIF -e "$ALLOW" -- "${FILES[@]}") >"$OUT" 2>"$ERR"; g=$?
    [ $g -ge 2 ] && gerr allow-count
  fi
  found=$(wc -l <"$OUT" 2>/dev/null || echo 0); found=$((found + 0))
  [ ${#FILES[@]} -gt 0 ] || found=0
  if [ "$found" -ne "$ALLOWN" ]; then
    hit; echo "HIT [allow-count] the allowed URL occurs $found times, expected $ALLOWN"
  fi
fi

case $rc in
  0) echo "SAFETY-GREP: CLEAN ($TARGET)" ;;
  1) echo "SAFETY-GREP: $HITS HIT(S) ($TARGET)" ;;
  *) echo "SAFETY-GREP: ERROR, scan incomplete ($TARGET)" >&2 ;;
esac
exit $rc

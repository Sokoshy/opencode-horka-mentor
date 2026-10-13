#!/usr/bin/env bash
# Compare bundled references against a canonical source (PLAN section 11, optional v1.2).
# Usage: scripts/check-reference-sync.sh [canonical_dir]
#   or:  MENTOR_REFERENCE_CANONICAL=<dir> scripts/check-reference-sync.sh
# Without a canonical source: prints sizes + sha256 and exits 0 (manual check).
set -u

FILES="pedagogy.md level-up-rules.md memory-templates.md"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_DIR="$SCRIPT_DIR/../src/references"
CANONICAL="${1:-${MENTOR_REFERENCE_CANONICAL:-}}"

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

if [ -z "$CANONICAL" ] || [ ! -d "$CANONICAL" ]; then
  for f in $FILES; do
    p="$LOCAL_DIR/$f"
    if [ -f "$p" ]; then
      size=$(wc -c < "$p" | tr -d ' ')
      echo "$f size=$size sha256=$(hash_file "$p")"
    else
      echo "$f MISSING ($p)"
    fi
  done
  echo "manual check: no canonical source (pass a dir or set MENTOR_REFERENCE_CANONICAL)"
  exit 0
fi

drift=0
for f in $FILES; do
  local="$LOCAL_DIR/$f"
  canon="$CANONICAL/$f"
  if [ ! -f "$canon" ]; then
    echo "$f: no canonical counterpart, skipped"
    continue
  fi
  if cmp -s "$local" "$canon"; then
    echo "$f: in sync"
  else
    echo "$f: DRIFT (local=$(hash_file "$local") canonical=$(hash_file "$canon"))"
    drift=1
  fi
done
exit "$drift"

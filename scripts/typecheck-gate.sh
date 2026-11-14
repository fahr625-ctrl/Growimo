#!/usr/bin/env bash
# =============================================================================
# typecheck-gate.sh — fail-closed type check, part of the pre-deploy gate.
# =============================================================================
#
# Owner decision 2026-11-13 ("Weg 1"): "Die Typprüfung soll künftig vor jedem
# Deploy verpflichtend laufen." Called from build-vercel.sh as step [1/5]; a
# non-zero exit aborts the build, so nothing is deployed.
#
# WHY THIS EXISTS
# The 2026-11-13 outage was a `ReferenceError: channelErrors is not defined` in
# src/routes/app/new-project.tsx (a `const` declared inside the stream branch and
# read outside it). That is a plain type error:
#
#   src/routes/app/new-project.tsx(510,15): error TS2304: Cannot find name 'channelErrors'.
#
# `tsc --noEmit` reports it on the live commit 519f258 (verified 2026-11-13), so a
# type check in the gate would have blocked that deploy.
#
# THE BASELINE (why this is a ratchet and not a plain `tsc --noEmit`)
# The app source carries pre-existing type errors (55 on 2026-11-13, mostly
# TS6133 unused locals and TS2345 in src/ai/server.ts). The owner's order was to
# NOT suppress them but to report them, and to keep this hotfix to one fix — so
# the current error set is frozen in scripts/typecheck-baseline.txt:
#
#   * every error NOT in the baseline  -> gate RED, no deploy (new regressions)
#   * every error IN the baseline      -> printed on every build, gate green
#   * baseline entries that disappeared-> reported, gate green (shrink the file)
#
# So a new error of the same kind as this outage cannot reach production again,
# and the pre-existing ones stay visible in every build log instead of hidden.
#
# Key = <file>\t<TSxxxx>\t<message>. Line/column are deliberately not part of the
# key, so unrelated edits above a known error do not turn the gate red.
#
# Usage:  bash scripts/typecheck-gate.sh
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

BASE=scripts/typecheck-baseline.txt
RAW="$(mktemp)"
trap 'rm -f "$RAW" "$RAW.cur"' EXIT

echo "[typecheck] tsc --noEmit -p tsconfig.gate.json"
bunx tsc --noEmit -p tsconfig.gate.json >"$RAW" 2>&1
RC=$?

norm() {
  grep -aE 'error TS' "$1" \
    | sed -E 's/^([^(]+)\([0-9]+,[0-9]+\): error (TS[0-9]+): (.*)$/\1\t\2\t\3/' \
    | sort
}

if [ "$RC" -eq 0 ]; then
  echo "[typecheck] GRÜN — keine Typfehler."
  exit 0
fi

norm "$RAW" > "$RAW.cur"
TOTAL=$(wc -l < "$RAW.cur" | tr -d ' ')

# A crash (OOM, missing tsconfig, bad invocation) produces no diagnostics.
# Fail closed: an unreadable type check must never count as a green one.
if [ "$TOTAL" -eq 0 ]; then
  echo "[typecheck] ROT — tsc brach ohne Diagnose ab (exit $RC). Ausgabe:" >&2
  tail -20 "$RAW" >&2
  exit 1
fi

if [ ! -f "$BASE" ]; then
  echo "[typecheck] ROT — Baseline $BASE fehlt." >&2
  exit 1
fi
sort "$BASE" > "$RAW.base"

NEW=$(comm -13 "$RAW.base" "$RAW.cur")
GONE=$(comm -23 "$RAW.base" "$RAW.cur")
NEW_N=$(printf '%s' "$NEW" | grep -c . || true)
GONE_N=$(printf '%s' "$GONE" | grep -c . || true)
KNOWN=$((TOTAL - NEW_N))

echo "[typecheck] $TOTAL Typfehler: $KNOWN vorbestehend (Baseline), $NEW_N neu."

if [ "$KNOWN" -gt 0 ]; then
  echo "[typecheck] VORBESTEHENDE Typfehler (nicht behoben, nur gemeldet — Owner 2026-11-13):"
  comm -12 "$RAW.base" "$RAW.cur" | sed 's/\t/  /g; s/^/    /'
fi

if [ "$GONE_N" -gt 0 ]; then
  echo "[typecheck] Hinweis: $GONE_N Baseline-Einträge sind verschwunden — Baseline bitte kürzen:"
  printf '%s\n' "$GONE" | sed 's/\t/  /g; s/^/    /'
fi

if [ "$NEW_N" -gt 0 ]; then
  echo "" >&2
  echo "[typecheck] ROT — NEUE Typfehler (nicht in der Baseline):" >&2
  printf '%s\n' "$NEW" | sed 's/\t/  /g; s/^/    /' >&2
  echo "" >&2
  echo "[typecheck] Build verworfen, KEIN Deploy." >&2
  exit 1
fi

echo "[typecheck] GRÜN — keine neuen Typfehler."
exit 0

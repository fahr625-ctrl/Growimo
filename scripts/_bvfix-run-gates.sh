#!/usr/bin/env bash
# Bildvariations-Fix 2026-10-12 — Gates: neue Suite + betroffene Bestandssuiten + tsc + i18n.
set -u
cd /home/team/shared/site
OUT=/tmp/bvfix
mkdir -p "$OUT"
: > "$OUT/summary.txt"

for s in bildvariation-fix-test stabilisierung-schritt3-test bildqualitaet-schritt12-test bildqualitaet-schritt34-test image-streaming-test stabilisierung-schritt4-test stabilisierung-phase41-test stabilisierung-phase5c-test strategy-image-test strategy-image-collapsed-test strategy-tiles-test package-fakten-schutz-test fix-block5-promise-test tiktok-diagnose-v2-test; do
  bun "$s.ts" > "$OUT/$s.log" 2>&1
  EXIT=$?
  LINE=$(grep -aE "RESULT|PASS, [0-9]+ FAIL|ALLE TESTS|ERGEBNIS|Fehler" "$OUT/$s.log" | tail -1)
  echo "$s | exit=$EXIT | $LINE" >> "$OUT/summary.txt"
done
echo "SUITES_DONE" >> "$OUT/summary.txt"

bunx tsc --noEmit -p tsconfig.gate.json > "$OUT/tsc.log" 2>&1
echo "tsc exit=$? | lines=$(wc -l < "$OUT/tsc.log")" >> "$OUT/summary.txt"
tr -d '\000' < "$OUT/tsc.log" | grep -ac "error TS" >> "$OUT/summary.txt"

bun --env-file=.env run ./i18n-scan.ts > "$OUT/i18n.log" 2>&1
echo "i18n exit=$?" >> "$OUT/summary.txt"
grep -aE "KEY-PARITY|RESULT|USED-KEYS|HARDCODED|DE-VALUES" "$OUT/i18n.log" >> "$OUT/summary.txt"
echo "ALLDONE" >> "$OUT/summary.txt"

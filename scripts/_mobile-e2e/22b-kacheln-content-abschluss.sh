#!/usr/bin/env bash
# Fortsetzung Teil 1: Ergebnisansicht + Projektseite des frischen Content-Laufs belegen.
# (Der Poll-Loop des 22er-Skripts lief in einen Marker, der auf /app/new-project nie
#  feuert — die Ergebnisse rendern inline; Generierung war bei POLL10 fertig.)
set -u
S=kacheln-mobile
ROOT=/home/team/shared/site
SHOT=$ROOT/docs/mobile-e2e
OUT=/tmp/kacheln-content-abschluss.log
TESTUSER=user_3KGLrQivAW698KVoR3vkZoJYMKU
: > "$OUT"
ab() { agent-browser --session "$S" "$@"; }

{
  echo "=== TEIL 1 ABSCHLUSS $(date -u +%FT%TZ) ==="
  echo "ERGEBNISSEITE: $(ab eval "(()=>{const t=document.body.innerText;const hs=[...document.querySelectorAll('h1,h2,h3')].map(h=>h.innerText.trim().slice(0,55));const btns=[...document.querySelectorAll('button')].map(b=>b.innerText.trim().replace(/\s+/g,' ').slice(0,40)).filter(Boolean);return JSON.stringify({url:location.pathname,bodyLen:t.length,cp:(t.includes('Failed to verify')||t.includes('verifying your browser')),headings:hs,seo:/SEO Blog/.test(t),mail:/E-Mail|Newsletter/.test(t),res:/A\/B-Varianten/.test(t),btns:btns.slice(0,14)})})()")"
  ab screenshot "$SHOT/m28-kachel-content-ergebnis-frisch.png"
  ab screenshot --full "$SHOT/m28b-kachel-content-ergebnis-frisch-full.png"

  echo "--- DB-CHECK ---"
  cd "$ROOT" && bun --env-file=.env scripts/_mobile-e2e/kacheln-db-check.ts "$TESTUSER" 2 > /tmp/kacheln-content-zahler-db.json 2>&1
  cat /tmp/kacheln-content-zahler-db.json
  PID=$(python3 -c "import json;print(json.load(open('/tmp/kacheln-content-zahler-db.json'))['projects'][0]['id'])" 2>/dev/null)
  echo "PROJECT_ID=$PID"
  if [ -n "${PID:-}" ]; then
    ab open "https://www.growimo.app/app/projects/$PID"
    sleep 15
    echo "PROJEKTSEITE: $(ab eval "(()=>{const t=document.body.innerText;return JSON.stringify({url:location.pathname,bodyLen:t.length,generierte:/Generierte Inhalte \((\d+)\)/.exec(t)?.[1]||null,seo:/SEO Blog/.test(t),mail:/E-Mail/.test(t),cp:(t.includes('Failed to verify')||t.includes('verifying your browser'))})})()")"
    ab screenshot "$SHOT/m29-kachel-content-projekt-zwei-contents.png"
    ab screenshot --full "$SHOT/m29b-kachel-content-projekt-zwei-contents-full.png"
  fi
  echo "TEIL1_ABSCHLUSS_DONE"
} >> "$OUT" 2>&1
tail -3 "$OUT"

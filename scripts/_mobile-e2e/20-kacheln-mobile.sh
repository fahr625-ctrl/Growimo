#!/usr/bin/env bash
# Kachel-Vereinfachung „Neue Strategie" (Owner-Direktion 2026-10-05) — Mobile-E2E Phase 1.
# Mobile 393x852 DPR2, Testnutzer user_3KGLrQivAW698KVoR3vkZoJYMKU.
# Prüft: genau 6 Kacheln, keine Alt-Kacheln, Content-Kachel = 2 Ergebnisse,
# Live-Generierung über die Content-Kachel → Projekt + 2 contentTypes in der DB,
# usage_monthly = 2 (1 Ergebnis = 1 Einheit, kein stiller Zusatzverbrauch).
# Aufruf: bash scripts/_mobile-e2e/20-kacheln-mobile.sh
set -u
S=kacheln-mobile
ROOT=/home/team/shared/site
SHOT=$ROOT/docs/mobile-e2e
OUT=/tmp/kacheln-mobile.log
TESTUSER=user_3KGLrQivAW698KVoR3vkZoJYMKU
: > "$OUT"
ab() { agent-browser --session "$S" "$@"; }
enc() { python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$1"; }
IDEA="Handgemachte Keramiktassen mit Sprenkelglasur"

PROBE='(()=>{const t=document.body.innerText;return JSON.stringify({url:location.pathname,bodyLen:t.length,cp:t.includes("verifying your browser")||t.includes("Failed to verify")||t.includes("Security Checkpoint")})})()'
TILES='(()=>{const els=[...document.querySelectorAll("[data-strategy-tile]")];const grid=document.querySelector("[data-strategy-tiles]");const txt=document.body.innerText;const summary=[...document.querySelectorAll("span")].map(s=>s.textContent).find(x=>/von 6 ausgew(ä|a)hlt|Ergebnis/.test(x||""))||null;const cta=[...document.querySelectorAll("button")].find(b=>/Strategie erstellen/.test(b.textContent||""));const hint=[...document.querySelectorAll("p")].map(p=>p.textContent).find(x=>/Erstellt .*Ergebnis/.test(x||""))||null;return JSON.stringify({tiles:els.map(b=>b.getAttribute("data-strategy-tile")),labels:els.map(b=>b.innerText.split("\n").filter(Boolean).join(" | ")),gridMarker:grid?grid.getAttribute("data-strategy-tiles"):null,gridCount:grid?grid.getAttribute("data-strategy-tile-count"):null,summary:summary,hint:hint,ctaDisabled:cta?cta.disabled:null,legacyTile:/Trend-Analyse|Market Intelligence|KI-Analyse/.test(txt),scrollW:document.documentElement.scrollWidth,innerW:window.innerWidth,badge2:(els.find(b=>b.getAttribute("data-strategy-tile")==="content")||{innerText:""}).innerText.includes("2 Ergebnisse")})})()'

{
  echo "=== RESET USAGE $(date -u +%FT%TZ) ==="
  cd "$ROOT" && bun --env-file=.env scripts/_mobile-e2e/reset-usage.ts "$TESTUSER" 2>&1 | tail -20

  echo "=== VIEWPORT + LOGIN ==="
  ab set viewport 393 852 2
  ab set media light
  ab open "https://www.growimo.app/app/sign-in?__clerk_ticket=$(cat /tmp/kacheln-ticket.txt)"
  sleep 14
  echo "LOGIN: $(ab eval "JSON.stringify({url:location.pathname,uid:(window.Clerk&&window.Clerk.user&&window.Clerk.user.id)||null})")"
  echo "CHECKPOINT: $(ab eval "$PROBE")"

  echo "=== /app/new-project (Kachel-Auswahl) ==="
  ab open "https://www.growimo.app/app/new-project?idea=$(enc "$IDEA")"
  sleep 12
  echo "IDEA: $(ab eval "(()=>{const ta=document.querySelector('#product-idea');return JSON.stringify({idea:ta?ta.value.slice(0,40):null,url:location.pathname})})()")"
  echo "TILES_VOR_AUSWAHL: $(ab eval "$TILES")"
  ab screenshot "$SHOT/m20-kacheln-mobil-auswahl.png"

  echo "=== KLICK CONTENT-KACHEL ==="
  echo "CLICK_CONTENT: $(ab eval "(()=>{const b=document.querySelector('[data-strategy-tile=\"content\"]');if(!b)return 'NO_TILE';b.click();return 'CLICKED'})()")"
  sleep 3
  echo "TILES_NACH_AUSWAHL: $(ab eval "$TILES")"
  ab screenshot "$SHOT/m21-kachel-content-2-ergebnisse.png"

  echo "=== GENERIEREN ==="
  echo "CTA: $(ab eval "(()=>{const c=[...document.querySelectorAll('button')].find(b=>/Strategie erstellen/.test(b.textContent||''));if(!c)return 'NO_CTA';if(c.disabled)return 'DISABLED';c.click();return 'CLICKED'})()")"
  for i in $(seq 1 30); do
    sleep 8
    R=$(ab eval "(()=>{const t=document.body.innerText;const err=(t.match(/Generierung fehlgeschlagen[^\n]*/)||t.match(/Limit erreicht[^\n]*/)||[])[0];return JSON.stringify({i:$i,spin:document.querySelectorAll('.animate-spin').length,len:t.length,err:err||null})})()")
    echo "POLL$i $R"
    if echo "$R" | grep -q 'spin\\":0'; then echo "DONE_AT_$i"; break; fi
    if echo "$R" | grep -q 'err\\":\\"'; then echo "ERR_SEEN"; break; fi
  done
  sleep 5
  echo "ERGEBNIS: $(ab eval "(()=>{const t=document.body.innerText;return JSON.stringify({url:location.pathname+location.search,bodyLen:t.length,hasSeo:/SEO Blog/.test(t),hasMail:/E-Mail|Newsletter/.test(t),hasPinterest:/Pinterest/.test(t),firstLines:t.split('\n').filter(Boolean).slice(0,12)})})()")"
  ab screenshot "$SHOT/m22-kachel-content-ergebnis.png"

  echo "=== DB-CHECK (usage + Projekt) ==="
  cd "$ROOT" && bun --env-file=.env scripts/_mobile-e2e/kacheln-db-check.ts "$TESTUSER" 2 > /tmp/kacheln-mobile-db.json 2>&1
  cat /tmp/kacheln-mobile-db.json
  PID=$(python3 -c "import json;print(json.load(open('/tmp/kacheln-mobile-db.json'))['projects'][0]['id'])" 2>/dev/null)
  echo "PROJECT_ID=$PID"

  echo "=== PROJEKTSEITE (beide Content-Ergebnisse) ==="
  ab open "https://www.growimo.app/app/projects/$PID"
  sleep 14
  echo "PROJEKTSEITE: $(ab eval "(()=>{const t=document.body.innerText;return JSON.stringify({url:location.pathname,bodyLen:t.length,cp:(t.includes('verifying your browser')||t.includes('Failed to verify')),seo:/SEO Blog/.test(t),mail:/E-Mail/.test(t),etsy:/Etsy/.test(t)})})()")"
  ab screenshot "$SHOT/m23-kachel-projekt-zwei-contents.png"
  echo "KACHELN_MOBILE_DONE"
} >> "$OUT" 2>&1
tail -3 "$OUT"

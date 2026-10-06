#!/usr/bin/env bash
# Kachel-Vereinfachung (Owner-Direktion 2026-10-05) — Phase 2:
#  A) Desktop-Viewport: 6 Kacheln, 3er-Grid, Screenshot
#  B) Je Kachel ein frischer Live-Lauf (Pinterest, Etsy, Social Media,
#     Marketing-Strategie, Produktideen) → DB: genau 1 contentType, usage = 1
#  C) Bestandsprojekt mit trend_insight/marketing_analysis/market_intelligence
#     wird weiterhin normal angezeigt
# Aufruf: bash scripts/_mobile-e2e/21-kacheln-rest.sh
set -u
S=kacheln-rest
ROOT=/home/team/shared/site
SHOT=$ROOT/docs/mobile-e2e
OUT=/tmp/kacheln-rest.log
TESTUSER=user_3KGLrQivAW698KVoR3vkZoJYMKU
: > "$OUT"
: > /tmp/kacheln-rest-results.jsonl
ab() { agent-browser --session "$S" "$@"; }
enc() { python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$1"; }
IDEA="Handgemachte Keramiktassen mit Sprenkelglasur"

PROBE='(()=>{const t=document.body.innerText;return JSON.stringify({url:location.pathname,bodyLen:t.length,cp:t.includes("verifying your browser")||t.includes("Failed to verify")||t.includes("Security Checkpoint")})})()'
TILES='(()=>{const els=[...document.querySelectorAll("[data-strategy-tile]")];const grid=document.querySelector("[data-strategy-tiles]");const tops=[...new Set(els.map(b=>Math.round(b.getBoundingClientRect().top)))];const summary=[...document.querySelectorAll("span")].map(s=>s.textContent).find(x=>/von 6 ausgew(ä|a)hlt/.test(x||""))||null;const cta=[...document.querySelectorAll("button")].find(b=>/Strategie erstellen/.test(b.textContent||""));const hint=[...document.querySelectorAll("p")].map(p=>p.textContent).find(x=>/Erstellt .*Ergebnis/.test(x||""))||null;return JSON.stringify({tiles:els.map(b=>b.getAttribute("data-strategy-tile")),gridMarker:grid?grid.getAttribute("data-strategy-tiles"):null,rows:tops.length,summary:summary,hint:hint,ctaDisabled:cta?cta.disabled:null,scrollW:document.documentElement.scrollWidth,innerW:window.innerWidth,vw:window.innerWidth})})()'

run_tile() {
  local key="$1" label="$2" idea="$3"
  echo "--- LAUF $key ($label) ---"
  cd "$ROOT" && bun --env-file=.env scripts/_mobile-e2e/reset-usage.ts "$TESTUSER" 2>&1 | grep -E '"reset"|usageMonthly' | head -3
  ab open "https://www.growimo.app/app/new-project?idea=$(enc "$idea")"
  sleep 12
  echo "PROBE_$key: $(ab eval "$PROBE")"
  echo "CLICK_$key: $(ab eval "(()=>{const b=document.querySelector('[data-strategy-tile=\"$key\"]');if(!b)return 'NO_TILE';b.click();return 'CLICKED'})()")"
  sleep 3
  echo "AUSWAHL_$key: $(ab eval "$TILES")"
  ab screenshot "$SHOT/m24-kachel-$key-auswahl.png"
  echo "CTA_$key: $(ab eval "(()=>{const c=[...document.querySelectorAll('button')].find(b=>/Strategie erstellen/.test(b.textContent||''));if(!c)return 'NO_CTA';if(c.disabled)return 'DISABLED';c.click();return 'CLICKED'})()")"
  for i in $(seq 1 30); do
    sleep 8
    R=$(ab eval "(()=>{const t=document.body.innerText;const err=(t.match(/Generierung fehlgeschlagen[^\n]*/)||t.match(/Limit erreicht[^\n]*/)||[])[0];return JSON.stringify({i:$i,spin:document.querySelectorAll('.animate-spin').length,len:t.length,err:err||null})})()")
    echo "POLL_${key}_$i $R"
    if echo "$R" | grep -q 'spin\\":0'; then echo "DONE_${key}_AT_$i"; break; fi
    if echo "$R" | grep -q 'err\\":\\"'; then echo "ERR_SEEN_$key"; break; fi
  done
  sleep 4
  ab screenshot "$SHOT/m25-kachel-$key-ergebnis.png"
  cd "$ROOT" && bun --env-file=.env scripts/_mobile-e2e/kacheln-db-check.ts "$TESTUSER" 2 > "/tmp/kacheln-$key-db.json" 2>&1
  python3 - "$key" "$label" <<'PY' >> /tmp/kacheln-rest-results.jsonl
import json, sys
key, label = sys.argv[1], sys.argv[2]
d = json.load(open(f"/tmp/kacheln-{key}-db.json"))
p = (d.get("projects") or [{}])[0]
row = {"tile": key, "label": label,
       "projectId": p.get("id"), "contentTypes": p.get("contentTypes"),
       "usageTotal": d.get("usageTotal"),
       "storedRows": (d.get("contents") or [{}])[0].get("rows")}
print(json.dumps(row, ensure_ascii=False))
PY
  tail -1 /tmp/kacheln-rest-results.jsonl
}

{
  echo "=== PHASE 2 START $(date -u +%FT%TZ) ==="
  ab set media light
  ab open "https://www.growimo.app/app/sign-in?__clerk_ticket=$(cat /tmp/kacheln-ticket.txt)"
  sleep 14
  echo "LOGIN: $(ab eval "JSON.stringify({url:location.pathname,uid:(window.Clerk&&window.Clerk.user&&window.Clerk.user.id)||null})")"

  echo "=== A) DESKTOP 1440x900 ==="
  ab set viewport 1440 900 1
  sleep 2
  ab open "https://www.growimo.app/app/new-project?idea=$(enc "$IDEA")"
  sleep 12
  echo "DESKTOP_TILES: $(ab eval "$TILES")"
  ab screenshot "$SHOT/d30-kacheln-desktop.png"

  echo "=== B) RESTLICHE KACHELN (MOBILE 393x852) ==="
  ab set viewport 393 852 2
  sleep 2
  run_tile pinterest "Pinterest" "Handgemachte Keramiktassen mit Sprenkelglasur"
  sleep 15
  run_tile etsy "Etsy" "Personalisierte Keramiktasse mit Namen"
  sleep 15
  run_tile social "Social Media" "Vintage-Kerzenhalter aus Messing"
  sleep 15
  run_tile marketing "Marketing-Strategie" "Handgemachte Seifenspender aus Beton"
  sleep 15
  run_tile ideas "Produktideen" "Minimalistischer Kalender aus Holz"

  echo "=== C) BESTANDSPROJEKT MIT TREND/ANALYSE/MARKT ==="
  cd "$ROOT" && bun --env-file=.env scripts/_mobile-e2e/kacheln-legacy-project.ts > /tmp/kacheln-legacy.json 2>&1
  cat /tmp/kacheln-legacy.json
  LPID=$(python3 -c "import json;c=json.load(open('/tmp/kacheln-legacy.json'))['candidates'];print(c[0]['id'] if c else '')" 2>/dev/null)
  echo "LEGACY_PROJECT_ID=$LPID"
  if [ -n "$LPID" ]; then
    ab open "https://www.growimo.app/app/projects/$LPID"
    sleep 14
    echo "LEGACY_SEITE: $(ab eval "(()=>{const t=document.body.innerText;return JSON.stringify({url:location.pathname,bodyLen:t.length,cp:(t.includes('verifying your browser')||t.includes('Failed to verify')),marketIntel:/Market Intelligence/.test(t),analyse:/Analyse/.test(t),trend:/Trend/.test(t),firstLines:t.split('\n').filter(Boolean).slice(0,10)})})()")"
    ab screenshot "$SHOT/m26-legacy-projekt-trend-analyse-markt.png"
  fi
  echo "KACHELN_REST_DONE"
} >> "$OUT" 2>&1
tail -3 "$OUT"

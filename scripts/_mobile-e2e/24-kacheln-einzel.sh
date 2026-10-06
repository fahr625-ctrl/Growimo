#!/usr/bin/env bash
# Kachel-Vereinfachung — TEIL 2: 5 Einzelkachel-Läufe (Pinterest, Etsy, Social,
# Marketing-Strategie, Produktideen) in EINER Zähler-Kette.
# Einmal reset-usage -> 0, dann 5 Läufe: usage muss 1 -> 2 -> 3 -> 4 -> 5 laufen
# (je +1, kein stiller Zusatzverbrauch). Projekt je Lauf mit genau dem
# erwarteten contentType. Läuft in der bereits angemeldeten Session kacheln-mobile.
# Aufruf: bash scripts/_mobile-e2e/24-kacheln-einzel.sh
set -u
S=kacheln-mobile
ROOT=/home/team/shared/site
SHOT=$ROOT/docs/mobile-e2e
OUT=/tmp/kacheln-einzel.log
RESULTS=/tmp/kacheln-einzel-results.jsonl
TESTUSER=user_3KGLrQivAW698KVoR3vkZoJYMKU
: > "$OUT"
: > "$RESULTS"
ab() { agent-browser --session "$S" "$@"; }
enc() { python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$1"; }

TILES='(()=>{const els=[...document.querySelectorAll("[data-strategy-tile]")];const cta=[...document.querySelectorAll("button")].find(b=>/Strategie erstellen/.test(b.textContent||""));return JSON.stringify({tiles:els.map(b=>b.getAttribute("data-strategy-tile")),ctaDisabled:cta?cta.disabled:null,ctaText:cta?cta.textContent.trim().slice(0,60):null})})()'

run_tile() {
  local key="$1" expected="$2" idea="$3" shot="$4"
  echo "--- LAUF $key (erwartet $expected) ---"
  ab open "https://www.growimo.app/app/new-project?idea=$(enc "$idea")"
  sleep 13
  echo "TILES_VOR_$key: $(ab eval "$TILES")"
  echo "CLICK_$key: $(ab eval "(()=>{const b=document.querySelector('[data-strategy-tile=\"$key\"]');if(!b)return 'NO_TILE';b.click();return 'CLICKED'})()")"
  sleep 3
  echo "TILES_NACH_$key: $(ab eval "$TILES")"
  ab screenshot "$SHOT/m30-kachel-$key-auswahl.png"
  echo "CTA_$key: $(ab eval "(()=>{const c=[...document.querySelectorAll('button')].find(b=>/Strategie erstellen/.test(b.textContent||''));if(!c)return 'NO_CTA';if(c.disabled)return 'DISABLED';c.click();return 'CLICKED'})()")"
  local done=0
  for i in $(seq 1 40); do
    sleep 8
    R=$(ab eval "(()=>{const t=document.body.innerText;const err=(t.match(/Generierung fehlgeschlagen[^\n]*/)||t.match(/Limit erreicht[^\n]*/)||[])[0];return JSON.stringify({i:$i,url:location.pathname,spin:document.querySelectorAll('.animate-spin').length,len:t.length,res:/A\/B-Varianten/.test(t),cards:(/Generierte Inhalte \((\d+)\)/.exec(t)||[])[1]||null,err:err||null})})()")
    echo "POLL_${key}_$i $R"
    # Ergebnis-Marker: Projektseiten-Heading ODER fertige Ergebnisansicht
    # (spin:0 + Ergebnis-Karte sichtbar) — /app/new-project rendert die Ergebnisse inline.
    if echo "$R" | grep -q 'Generierte Inhalte'; then done=1; break; fi
    if echo "$R" | grep -q 'spin\\":0' && echo "$R" | grep -q 'res\\":true'; then
      if [ "$i" -ge 2 ]; then done=1; break; fi
    fi
    if echo "$R" | grep -q 'err\\":\\"'; then echo "ERR_SEEN_$key"; break; fi
  done
  sleep 4
  echo "ERGEBNIS_$key: $(ab eval "(()=>{const t=document.body.innerText;const hs=[...document.querySelectorAll('h1,h2')].map(h=>h.innerText.trim().slice(0,50));return JSON.stringify({url:location.pathname,bodyLen:t.length,headings:hs,seite:t.split('\n').filter(Boolean).slice(16,20)})})()")"
  ab screenshot "$SHOT/m31-kachel-$key-ergebnis.png"
  cd "$ROOT" && bun --env-file=.env scripts/_mobile-e2e/kacheln-db-check.ts "$TESTUSER" 1 > "/tmp/kacheln-$key-db.json" 2>&1
  python3 - "$key" "$expected" "$done" <<'PY' >> "$RESULTS"
import json, sys
key, expected, done = sys.argv[1], sys.argv[2], int(sys.argv[3])
d = json.load(open(f"/tmp/kacheln-{key}-db.json"))
p = (d.get("projects") or [{}])[0]
row = {"tile": key, "expected": expected, "generationDone": done,
       "projectId": p.get("id"), "projectContentTypes": p.get("contentTypes"),
       "usageRows": d.get("usageMonthly"), "usageTotal": d.get("usageTotal"),
       "storedRows": (d.get("contents") or [{}])[0].get("rows")}
print(json.dumps(row, ensure_ascii=False))
PY
  tail -1 "$RESULTS"
  echo "ZAHLER_STAND_${key}: usage=$(python3 -c "import json;print(json.load(open('/tmp/kacheln-$key-db.json')).get('usageTotal'))")"
}

{
  echo "=== TEIL 2 START $(date -u +%FT%TZ) ==="
  echo "PRE: $(ab eval "JSON.stringify({url:location.pathname,uid:(window.Clerk&&window.Clerk.user&&window.Clerk.user.id)||null})")"
  echo "--- RESET USAGE -> 0 (einmalig, danach Kette 1..5) ---"
  cd "$ROOT" && bun --env-file=.env scripts/_mobile-e2e/reset-usage.ts "$TESTUSER" 2>&1 | tail -8

  ab set viewport 1440 900 1
  sleep 2
  run_tile pinterest  "pinterest_pin"   "Handgemachte Keramiktassen mit Sprenkelglasur" pinterest
  sleep 10
  run_tile etsy       "etsy_listing"    "Personalisierte Keramiktasse mit Namen"        etsy
  sleep 10
  run_tile social     "social_post"     "Vintage-Kerzenhalter aus Messing"              social
  sleep 10
  run_tile marketing  "marketing_plan"  "Handgemachte Seifenspender aus Beton"          marketing
  sleep 10
  run_tile ideas      "product_idea"    "Minimalistischer Kalender aus Holz"            ideas
  echo "TEIL2_DONE"
} >> "$OUT" 2>&1
tail -3 "$OUT"

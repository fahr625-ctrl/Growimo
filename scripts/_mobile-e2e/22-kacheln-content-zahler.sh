#!/usr/bin/env bash
# Kachel-Vereinfachung — Teil 1 (Content-Kachel): FRISCHER Lauf mit Zähler-Beweis.
# Der Lauf aus der Vorsession (Projekt 1d236e9d / 3ca4738e, 07:18 + 07:23) ist in der DB
# angekommen, aber sein usage-Zähler wurde anschließend vom Rest-Skript reset-t.
# Dieses Skript fährt die Kachel einmal frisch: reset -> 0, Content-Kachel -> 2 Ergebnisse,
# DB-Check: usage = 2 (1 Ergebnis = 1 Einheit, kein stiller Zusatzverbrauch).
# Nutzt die noch angemeldete Browser-Session kacheln-mobile (Token ist single-use!).
# Aufruf: bash scripts/_mobile-e2e/22-kacheln-content-zahler.sh
set -u
S=kacheln-mobile
ROOT=/home/team/shared/site
SHOT=$ROOT/docs/mobile-e2e
OUT=/tmp/kacheln-content-zahler.log
TESTUSER=user_3KGLrQivAW698KVoR3vkZoJYMKU
: > "$OUT"
ab() { agent-browser --session "$S" "$@"; }
enc() { python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$1"; }
IDEA="Handgemachte Keramiktassen mit Sprenkelglasur"

PROBE='(()=>{const t=document.body.innerText;return JSON.stringify({url:location.pathname,bodyLen:t.length,uid:(window.Clerk&&window.Clerk.user&&window.Clerk.user.id)||null,cp:t.includes("verifying your browser")||t.includes("Failed to verify")||t.includes("Security Checkpoint")})})()'
TILES='(()=>{const els=[...document.querySelectorAll("[data-strategy-tile]")];const grid=document.querySelector("[data-strategy-tiles]");const cta=[...document.querySelectorAll("button")].find(b=>/Strategie erstellen/.test(b.textContent||""));const hint=[...document.querySelectorAll("p")].map(p=>p.textContent).find(x=>/Erstellt .*Ergebnis/.test(x||""))||null;const contentTile=els.find(b=>b.getAttribute("data-strategy-tile")==="content");return JSON.stringify({tiles:els.map(b=>b.getAttribute("data-strategy-tile")),gridMarker:grid?grid.getAttribute("data-strategy-tiles"):null,contentTileText:contentTile?contentTile.innerText.split("\n").filter(Boolean).join(" | "):null,contentBadge2:contentTile?contentTile.innerText.includes("2 Ergebnisse"):null,hint:hint,ctaDisabled:cta?cta.disabled:null})})()'

{
  echo "=== TEIL 1 ZAEHLER-BEWEIS $(date -u +%FT%TZ) ==="
  echo "--- A) pre-flight (Session noch angemeldet?) ---"
  echo "PRE: $(ab eval "$PROBE")"

  echo "--- B) RESET USAGE -> 0 ---"
  cd "$ROOT" && bun --env-file=.env scripts/_mobile-e2e/reset-usage.ts "$TESTUSER" 2>&1 | tail -12

  echo "--- C) /app/new-project (Content-Kachel) ---"
  ab open "https://www.growimo.app/app/new-project?idea=$(enc "$IDEA")"
  sleep 13
  echo "PROBE: $(ab eval "$PROBE")"
  echo "IDEA_FELD: $(ab eval "(()=>{const ta=document.querySelector('#product-idea');return JSON.stringify({idea:ta?ta.value.slice(0,45):null})})()")"
  echo "TILES_VOR: $(ab eval "$TILES")"
  echo "CLICK_CONTENT: $(ab eval "(()=>{const b=document.querySelector('[data-strategy-tile=\"content\"]');if(!b)return 'NO_TILE';b.click();return 'CLICKED'})()")"
  sleep 3
  echo "TILES_NACH: $(ab eval "$TILES")"
  ab screenshot "$SHOT/m27-kachel-content-auswahl-frisch.png"

  echo "--- D) GENERIEREN ---"
  echo "CTA: $(ab eval "(()=>{const c=[...document.querySelectorAll('button')].find(b=>/Strategie erstellen/.test(b.textContent||''));if(!c)return 'NO_CTA';if(c.disabled)return 'DISABLED';c.click();return 'CLICKED'})()")"
  for i in $(seq 1 40); do
    sleep 8
    R=$(ab eval "(()=>{const t=document.body.innerText;const err=(t.match(/Generierung fehlgeschlagen[^\n]*/)||t.match(/Limit erreicht[^\n]*/)||[])[0];return JSON.stringify({i:$i,url:location.pathname,spin:document.querySelectorAll('.animate-spin').length,len:t.length,cards:(t.match(/Generierte Inhalte \((\d+)\)/)||[])[1]||null,err:err||null})})()")
    echo "POLL$i $R"
    if echo "$R" | grep -q 'Generierte Inhalte'; then echo "ERGEBNIS_DA_AT_$i"; break; fi
    if echo "$R" | grep -q 'err\\":\\"'; then echo "ERR_SEEN"; break; fi
  done
  sleep 4
  echo "SEITE: $(ab eval "(()=>{const t=document.body.innerText;const hs=[...document.querySelectorAll('h1,h2')].map(h=>h.innerText.trim().slice(0,50));return JSON.stringify({url:location.pathname,bodyLen:t.length,headings:hs,seo:/SEO Blog/.test(t),mail:/E-Mail/.test(t),fehler:/fehlgeschlagen|Fehler|Error/.test(t)&&!/(0|keine) Fehler/i.test(t)})})()")"
  ab screenshot "$SHOT/m28-kachel-content-ergebnis-frisch.png"

  echo "--- E) DB-CHECK (erwartet usage=2, neuestes Projekt = 2 Typen) ---"
  cd "$ROOT" && bun --env-file=.env scripts/_mobile-e2e/kacheln-db-check.ts "$TESTUSER" 2 > /tmp/kacheln-content-zahler-db.json 2>&1
  cat /tmp/kacheln-content-zahler-db.json
  PID=$(python3 -c "import json;print(json.load(open('/tmp/kacheln-content-zahler-db.json'))['projects'][0]['id'])" 2>/dev/null)
  echo "PROJECT_ID=$PID"
  if [ -n "${PID:-}" ]; then
    ab open "https://www.growimo.app/app/projects/$PID"
    sleep 14
    echo "PROJEKTSEITE: $(ab eval "(()=>{const t=document.body.innerText;return JSON.stringify({url:location.pathname,bodyLen:t.length,generierte:/Generierte Inhalte \((\d+)\)/.exec(t)?.[1]||null,seo:/SEO Blog/.test(t),mail:/E-Mail/.test(t),cp:(t.includes('Failed to verify')||t.includes('verifying your browser'))})})()")"
    ab screenshot "$SHOT/m29-kachel-content-projekt-zwei-contents.png"
  fi
  echo "TEIL1_ZAEHLER_DONE"
} >> "$OUT" 2>&1
tail -3 "$OUT"

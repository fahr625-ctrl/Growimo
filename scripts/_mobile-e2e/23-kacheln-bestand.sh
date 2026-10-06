#!/usr/bin/env bash
# Kachel-Vereinfachung — TEIL 3: Bestandsprojekt-Regression + Desktop-Grid.
# Läuft in der bereits angemeldeten Mobile-Session (kacheln-mobile).
#  A) Desktop 1440x900: 6 Kacheln, 3er-Raster, kein horizontaler Scroll
#  B) Alt-Projekt mit marketing_analysis (d0ddebff) anzeigen — Karten + Bild-Studio-Kette
#  C) Alt-Projekt mit trend_insight/market_intelligence/marketing_analysis (1a56bafb)
#  D) Inhaltsbibliothek + Dashboard: Typen weiter normal gelistet
# Aufruf: bash scripts/_mobile-e2e/23-kacheln-bestand.sh
set -u
S=kacheln-mobile
ROOT=/home/team/shared/site
SHOT=$ROOT/docs/mobile-e2e
OUT=/tmp/kacheln-bestand.log
: > "$OUT"
ab() { agent-browser --session "$S" "$@"; }
enc() { python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$1"; }
IDEA="Handgemachte Keramiktassen mit Sprenkelglasur"
LEGACY_A=d0ddebff-854a-42c4-bd21-6b88bf29a8f3   # marketing_analysis + pinterest_pin
LEGACY_B=1a56bafb-5c34-4b3e-b5cf-434d35420d08   # 10 Typen inkl. trend_insight/market_intelligence

GRID='(()=>{const els=[...document.querySelectorAll("[data-strategy-tile]")];const grid=document.querySelector("[data-strategy-tiles]");const tops=[...new Set(els.map(b=>Math.round(b.getBoundingClientRect().top)))].sort((a,b)=>a-b);const perRow=tops.map(t=>els.filter(b=>Math.round(b.getBoundingClientRect().top)===t).length);return JSON.stringify({vw:window.innerWidth,vh:window.innerHeight,tileCount:els.length,tiles:els.map(b=>b.getAttribute("data-strategy-tile")),gridMarker:grid?grid.getAttribute("data-strategy-tiles"):null,rowCount:tops.length,perRow:perRow,scrollW:document.documentElement.scrollWidth,innerW:window.innerWidth,hscroll:document.documentElement.scrollWidth>window.innerWidth+1,legacy:/Trend-Analyse|Market Intelligence|KI-Analyse|Marktanalyse/.test(document.body.innerText)})})()'

PROJ='(()=>{const t=document.body.innerText;const hs=[...document.querySelectorAll("h1,h2")].map(h=>h.innerText.trim().slice(0,60));const btns=[...document.querySelectorAll("button")].map(b=>b.innerText.trim().replace(/\s+/g," ").slice(0,45)).filter(Boolean);return JSON.stringify({url:location.pathname,bodyLen:t.length,cp:(t.includes("Failed to verify")||t.includes("verifying your browser")),headings:hs,generierte:(/Generierte Inhalte \((\d+)\)/.exec(t)||[])[1]||null,analyse:/Analyse|Marketing-Analyse|KI-Analyse/i.test(t),markt:/Market Intelligence|Markt/i.test(t),trend:/Trend/i.test(t),bildstudioBtn:btns.filter(b=>/Image Studio|Bild-Studio/i.test(b)),fehlertext:(t.match(/(Fehler|error|Something went wrong|fehlgeschlagen)/i)||[])[0]||null,buttons:btns.slice(0,12)})})()'

{
  echo "=== TEIL 3 START $(date -u +%FT%TZ) ==="
  echo "PRE: $(ab eval "JSON.stringify({url:location.pathname,uid:(window.Clerk&&window.Clerk.user&&window.Clerk.user.id)||null})")"

  echo "=== A) DESKTOP 1440x900 ==="
  ab set viewport 1440 900 1
  sleep 2
  ab open "https://www.growimo.app/app/new-project?idea=$(enc "$IDEA")"
  sleep 13
  echo "GRID: $(ab eval "$GRID")"
  ab screenshot "$SHOT/d30-kacheln-desktop.png"
  ab screenshot --full "$SHOT/d30b-kacheln-desktop-full.png"

  echo "=== B) ALT-PROJEKT marketing_analysis ($LEGACY_A) ==="
  ab open "https://www.growimo.app/app/projects/$LEGACY_A"
  sleep 14
  echo "PROJ_A: $(ab eval "$PROJ")"
  ab screenshot "$SHOT/m26b-legacy-projekt-marketing-analysis.png"

  echo "=== C) ALT-PROJEKT trend/markt/analyse ($LEGACY_B) ==="
  ab open "https://www.growimo.app/app/projects/$LEGACY_B"
  sleep 14
  echo "PROJ_B: $(ab eval "$PROJ")"
  ab screenshot "$SHOT/m26c-legacy-projekt-trend-markt-10-typen.png"

  echo "=== D) INHALTSBIBLIOTHEK ==="
  ab open "https://www.growimo.app/app/content-library"
  sleep 13
  echo "LIB: $(ab eval "(()=>{const t=document.body.innerText;return JSON.stringify({url:location.pathname,bodyLen:t.length,cp:(t.includes('Failed to verify')||t.includes('verifying your browser')),zeilen:t.split('\n').filter(Boolean).length,trefferAnalyse:(t.match(/Analyse/gi)||[]).length,trefferMarkt:(t.match(/Markt|Market/gi)||[]).length,trefferTrend:(t.match(/Trend/gi)||[]).length,fehlertext:(t.match(/(Fehler|error|Something went wrong|fehlgeschlagen)/i)||[])[0]||null,firstLines:t.split('\n').filter(Boolean).slice(0,14)})})()")"
  ab screenshot "$SHOT/m26d-inhaltsbibliothek-legacy-typen.png"

  echo "=== E) DASHBOARD ==="
  ab open "https://www.growimo.app/app"
  sleep 13
  echo "DASH: $(ab eval "(()=>{const t=document.body.innerText;return JSON.stringify({url:location.pathname,bodyLen:t.length,cp:(t.includes('Failed to verify')||t.includes('verifying your browser')),projekte:(t.match(/Projekt/gi)||[]).length,usage:(t.match(/\d+ von 5 Generierungen/)||[])[0]||null,fehlertext:(t.match(/(Fehler|error|Something went wrong|fehlgeschlagen)/i)||[])[0]||null,firstLines:t.split('\n').filter(Boolean).slice(0,16)})})()")"
  ab screenshot "$SHOT/m26e-dashboard.png"
  echo "TEIL3_DONE"
} >> "$OUT" 2>&1
tail -3 "$OUT"

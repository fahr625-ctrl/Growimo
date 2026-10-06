#!/usr/bin/env bash
# Kachel-Vereinfachung Teil 2 — Beweis, dass die Kachel-Umstellung den BILD-FLOW
# auf einer Einzelkachel-Projektseite nicht gebrochen hat: Etsy-Projekt öffnen und
# den Image-Studio-Prefill-Button ("🎨 Im Image Studio erstellen") nachweisen.
# Aufruf: bash scripts/_mobile-e2e/26-etsy-bild-prefill.sh <projectId>
set -u
S=kacheln-mobile
ROOT=/home/team/shared/site
SHOT=$ROOT/docs/mobile-e2e
PID="$1"
ab() { timeout 90 agent-browser --session "$S" "$@"; }
ab open "https://www.growimo.app/app/projects/$PID"
sleep 14
echo "PAGE: $(ab eval "JSON.stringify({url:location.pathname,len:document.body.innerText.length})")"
echo "PROBE: $(ab eval "(()=>{const t=document.body.innerText;const btn=[...document.querySelectorAll('button,a')].find(b=>/Im Image Studio erstellen/.test(b.textContent||''));return JSON.stringify({heading:(document.querySelector('h1')||{}).innerText||null,generierte:(/Generierte Inhalte \((\\d+)\)/.exec(t)||[])[1]||null,etsyKarte:/Etsy/.test(t),prefillButton:!!btn,prefillLabel:btn?btn.textContent.trim():null,bildStudioSection:/KI-Bild-Studio/.test(t),fehlertext:((t.match(/Generierung fehlgeschlagen[^\\n]*/)||[])[0])||null})})()")"
ab screenshot "$SHOT/m32-etsy-projekt-bild-prefill.png"
ab eval "(()=>{const b=[...document.querySelectorAll('button,a')].find(x=>/Im Image Studio erstellen/.test(x.textContent||''));if(b)b.scrollIntoView({block:'center'});return 'SCROLLED'})()"
sleep 2
ab screenshot --full "$SHOT/m32b-etsy-projekt-bild-prefill-full.png"
echo "SAVED $SHOT/m32-etsy-projekt-bild-prefill.png"

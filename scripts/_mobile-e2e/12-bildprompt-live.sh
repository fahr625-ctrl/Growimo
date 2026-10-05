#!/usr/bin/env bash
# LIVE-Beweis Befund "Bildprompt" (Station 5) auf www.growimo.app.
# 1 Kanal (Etsy) frisch generieren → Roh-Body in der DB + echter Extraktor
# (verify-bildprompt.ts) → hasImage:true, promptLen>0; Projektseite zeigt
# "🎨 Im Image Studio erstellen"; Zähler: 1 Kanal = 1 Einheit.
# Aufruf: bash scripts/_mobile-e2e/12-bildprompt-live.sh
set -u
S=bildprompt-live
SHOT=/home/team/shared/site/docs/mobile-e2e
OUT=/tmp/bildprompt-live.log
: > "$OUT"
ab() { agent-browser --session "$S" "$@"; }
enc() { python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$1"; }
IDEA="Handgemachte Keramiktassen mit Sprenkelglasur"

{
  echo "=== LOGIN $(date -u +%FT%TZ) ==="
  ab open "https://www.growimo.app/app/sign-in?__clerk_ticket=$(cat /tmp/mobile-e2e-ticket.txt)"
  sleep 14
  echo "URL/LOGIN: $(ab eval "JSON.stringify({url:location.pathname,uid:window.Clerk&&window.Clerk.user?window.Clerk.user.id:null})")"

  echo "=== CHECKPOINT-PROBE ==="
  ab eval "(()=>{const t=document.body.innerText;return 'CP url='+location.pathname+' bodyLen='+t.length+' cp='+(t.includes('verifying your browser')||t.includes('Failed to verify')||t.includes('Security Checkpoint'))})()"

  echo "=== RUN 1-KANAL ETSY ==="
  ab open "https://www.growimo.app/app/new-project?idea=$(enc "$IDEA")"
  sleep 12
  ab eval "(()=>{const ta=document.querySelector('#product-idea');return JSON.stringify({idea:ta?ta.value:null,bodyLen:document.body.innerText.length})})()"
  echo "CLICK_TILE: $(ab eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('Etsy')&&(x.className||'').includes('rounded-xl border-2'));if(!b)return 'NO_TILE';b.click();return 'CLICKED'})()")"
  sleep 3
  ab eval "(()=>{const cnt=[...document.querySelectorAll('span')].map(s=>s.textContent).find(t=>/ausgewählt/.test(t||''));const cta=[...document.querySelectorAll('button')].find(b=>/Strategie erstellen/.test(b.textContent||''));return JSON.stringify({count:cnt,ctaDisabled:cta?cta.disabled:null})})()"
  ab screenshot "$SHOT/bildprompt-fix-auswahl.png"
  echo "CTA: $(ab eval "(()=>{const cta=[...document.querySelectorAll('button')].find(b=>/Strategie erstellen/.test(b.textContent||''));if(!cta)return 'NO_CTA';if(cta.disabled)return 'DISABLED';cta.click();return 'CLICKED'})()")"

  for i in $(seq 1 30); do
    sleep 8
    R=$(ab eval "(()=>{const t=document.body.innerText;const err=(t.match(/Generierung fehlgeschlagen[^\n]*/)||t.match(/Limit erreicht[^\n]*/)||[])[0];return JSON.stringify({i:$i,spin:document.querySelectorAll('.animate-spin').length,len:t.length,err:err||null})})()")
    echo "POLL$i $R"
    if echo "$R" | grep -q 'spin\\":0'; then echo "DONE_AT_$i"; break; fi
    if echo "$R" | grep -q 'err\\":\\"'; then echo "ERR_SEEN"; break; fi
  done
  sleep 5
  ab eval "(()=>{const t=document.body.innerText;return JSON.stringify({FINAL:true,url:location.pathname+location.search,bodyLen:t.length,hasEtsy:/Etsy/.test(t),firstLines:t.split('\n').filter(Boolean).slice(0,10)})})()"
  ab screenshot "$SHOT/bildprompt-fix-ergebnis.png"

  echo "=== DB + EXTRAKTOR ==="
  cd /home/team/shared/site
  bun --env-file=.env scripts/_mobile-e2e/verify-bildprompt.ts user_3KGLrQivAW698KVoR3vkZoJYMKU > /tmp/bildprompt-verify.json 2>&1
  cat /tmp/bildprompt-verify.json
  PID=$(python3 -c "import json;print(json.load(open('/tmp/bildprompt-verify.json'))['project']['id'])" 2>/dev/null)
  echo "PROJECT_ID=$PID"

  echo "=== PROJEKTSEITE (Button-Beleg) ==="
  ab open "https://www.growimo.app/app/projects/$PID"
  sleep 14
  ab eval "(()=>{const t=document.body.innerText;return JSON.stringify({url:location.pathname,bodyLen:t.length,cp:(t.includes('verifying your browser')||t.includes('Failed to verify')),button:/Im Image Studio erstellen/.test(t),etsy:/Etsy/.test(t)})})()"
  ab eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Im Image Studio erstellen/.test(x.textContent||''));if(b)b.scrollIntoView({block:'center'});return b?'SCROLLED':'NO_BUTTON'})()"
  sleep 2
  ab screenshot "$SHOT/bildprompt-fix-projektseite-button.png"
  echo "BILDPROMPT_LIVE_DONE"
} >> "$OUT" 2>&1
tail -5 "$OUT"

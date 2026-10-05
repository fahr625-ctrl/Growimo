#!/usr/bin/env bash
# PRE-FIX-Reproduktion (Befund A + B) auf www.growimo.app, Mobile-Viewport 393x852 DPR2.
# Aufruf: bash scripts/_mobile-e2e/10-prefix-1kanal.sh <IDEA> <SHOT_PREFIX>
# Erwartung auf dem UNGEFIXTEN Build: 1 gewaehlter Kanal (Etsy) kostet 3 usage-Einheiten
# (Etsy + marketing_analysis + market_intelligence) und die Seite ist nach dem Lauf leer.
set -u
S=growimo-mobile
SHOT=/home/team/shared/site/docs/mobile-e2e
IDEA="${1:?idea}"
PREFIX="${2:?shot prefix}"
ENC=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$IDEA")
OUT=/tmp/$PREFIX-run.log
: > "$OUT"
ab() { agent-browser --session "$S" "$@"; }

{
echo "=== viewport ==="
ab set viewport 393 852 2
ab set media light
echo "=== 1) open new-project with idea ==="
ab open "https://www.growimo.app/app/new-project?idea=${ENC}"
sleep 12
echo "=== 2) pre-state (idea + cta) ==="
ab eval "(()=>{const ta=document.querySelector('#product-idea');const cta=[...document.querySelectorAll('button')].find(b=>/Strategie erstellen/.test(b.textContent||''));return JSON.stringify({url:location.pathname+location.search,bodyLen:document.body.innerText.length,cp:document.body.innerText.includes('verifying your browser')||document.body.innerText.includes('Failed to verify'),idea:ta?ta.value:null,ctaFound:!!cta,ctaDisabled:cta?cta.disabled:null})})()"
echo "=== 3) select EXACTLY ONE tile (Etsy) ==="
ab eval "(()=>{const btns=[...document.querySelectorAll('button')];const b=btns.find(x=>(x.textContent||'').includes('Etsy')&&(x.className||'').includes('rounded-xl border-2'));if(!b)return 'NO_TILE';b.click();return 'CLICKED_ETSY'})()"
sleep 3
echo "=== 4) post-select ==="
ab eval "(()=>{const cnt=[...document.querySelectorAll('span')].map(s=>s.textContent).find(t=>/ausgewählt/.test(t||''));const cta=[...document.querySelectorAll('button')].find(b=>/Strategie erstellen/.test(b.textContent||''));const sel=[...document.querySelectorAll('button')].filter(b=>(b.className||'').includes('border-2')&&/✓/.test(b.textContent||'')).map(b=>(b.textContent||'').trim().slice(0,24));return JSON.stringify({count:cnt,selected:sel,ctaDisabled:cta?cta.disabled:null})})()"
ab screenshot "$SHOT/$PREFIX-auswahl.png"
echo "=== 5) CLICK CTA ==="
ab eval "(()=>{const cta=[...document.querySelectorAll('button')].find(b=>/Strategie erstellen/.test(b.textContent||''));if(!cta)return 'NO_CTA';if(cta.disabled)return 'DISABLED';cta.click();return 'CLICKED'})()"
echo "=== 6) poll: wait for spinner count 0 (max ~8min) ==="
for i in $(seq 1 60); do
  sleep 8
  R=$(ab eval "(()=>{const t=document.body.innerText;const err=(t.match(/Generierung fehlgeschlagen[^\n]*/)||t.match(/Monatslimit[^\n]*/)||t.match(/Keine gültige Sitzung[^\n]*/)||t.match(/Limit erreicht[^\n]*/)||[])[0];return JSON.stringify({i:$i,spin:document.querySelectorAll('.animate-spin').length,len:t.length,err:err||null})})()")
  echo "POLL $R"
  case "$R" in
    *'"err":'*) echo "ERR_SEEN"; break;;
  esac
  case "$R" in
    *'"spin":0'*) echo "SPIN_DONE_AT_$i"; break;;
  esac
done
echo "=== 7) state IMMEDIATELY after run ==="
ab eval "(()=>{const t=document.body.innerText;const gen=[...document.querySelectorAll('span')].filter(s=>s.textContent.trim()==='Generiert').length;return JSON.stringify({phase:'t0',url:location.pathname+location.search,bodyLen:t.length,scoreCards:document.querySelectorAll('[data-testid=score-card]').length,generiertSpans:gen,hasEtsy:/Etsy/.test(t),hasPinterest:/Pinterest/.test(t),firstLines:t.split('\n').filter(Boolean).slice(0,12)})})()"
ab screenshot "$SHOT/$PREFIX-t0.png"
echo "=== 8) state AFTER +15s (stay-on-page check) ==="
sleep 15
ab eval "(()=>{const t=document.body.innerText;const gen=[...document.querySelectorAll('span')].filter(s=>s.textContent.trim()==='Generiert').length;return JSON.stringify({phase:'t15',bodyLen:t.length,generiertSpans:gen,hasEtsy:/Etsy/.test(t),firstLines:t.split('\n').filter(Boolean).slice(0,12)})})()"
ab screenshot "$SHOT/$PREFIX-t15.png"
echo "=== 9) reload state (is the result persisted/visible after reload?) ==="
ab open "https://www.growimo.app/app/new-project"
sleep 12
ab eval "(()=>{const t=document.body.innerText;return JSON.stringify({phase:'reload',bodyLen:t.length,firstLines:t.split('\n').filter(Boolean).slice(0,8)})})()"
ab screenshot "$SHOT/$PREFIX-reload.png"
echo "RUN_DONE"
} > "$OUT" 2>&1
tail -3 "$OUT"

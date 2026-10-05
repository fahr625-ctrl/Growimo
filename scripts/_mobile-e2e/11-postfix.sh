#!/usr/bin/env bash
# POST-FIX-Nachweis (Befund A + B) auf dem gefixten Build, Mobile 393x852 DPR2.
# Aufruf: bash scripts/_mobile-e2e/11-postfix.sh
# Erwartung: 1 Kanal = 1 Einheit, 2 Kanaele = 2 Einheiten; Ergebnisse SICHTBAR.
set -u
S=growimo-mobile
SHOT=/home/team/shared/site/docs/mobile-e2e
OUT=/tmp/ba-postfix-run.log
: > "$OUT"
ab() { agent-browser --session "$S" "$@"; }
enc() { python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$1"; }

one_run() { # $1=idea  $2=tiles(comma)  $3=prefix
  local IDEA="$1" TILES="$2" PFX="$3"
  echo "=== RUN $PFX: tiles=$TILES idea=$IDEA ==="
  ab open "https://www.growimo.app/app/new-project?idea=$(enc "$IDEA")"
  sleep 12
  ab eval "(()=>{const ta=document.querySelector('#product-idea');return JSON.stringify({pfx:'$PFX',cp:document.body.innerText.includes('Failed to verify')||document.body.innerText.includes('verifying your browser'),idea:ta?ta.value:null,bodyLen:document.body.innerText.length})})()"
  ab eval "(()=>{const btns=[...document.querySelectorAll('button')];const hits=[];for(const l of '$TILES'.split(',')){const b=btns.find(x=>(x.textContent||'').includes(l)&&(x.className||'').includes('rounded-xl border-2'));if(b){b.click();hits.push(l)}}return JSON.stringify({pfx:'$PFX',clicked:hits})})()"
  sleep 3
  ab eval "(()=>{const cnt=[...document.querySelectorAll('span')].map(s=>s.textContent).find(t=>/ausgewählt/.test(t||''));const cta=[...document.querySelectorAll('button')].find(b=>/Strategie erstellen/.test(b.textContent||''));return JSON.stringify({pfx:'$PFX',count:cnt,ctaDisabled:cta?cta.disabled:null})})()"
  ab screenshot "$SHOT/$PFX-auswahl.png"
  echo "CLICK: $(ab eval "(()=>{const cta=[...document.querySelectorAll('button')].find(b=>/Strategie erstellen/.test(b.textContent||''));if(!cta)return 'NO_CTA';if(cta.disabled)return 'DISABLED';cta.click();return 'CLICKED'})()")"
  for i in $(seq 1 40); do
    sleep 8
    R=$(ab eval "(()=>{const t=document.body.innerText;const err=(t.match(/Generierung fehlgeschlagen[^\n]*/)||t.match(/Monatslimit[^\n]*/)||t.match(/Limit erreicht[^\n]*/)||[])[0];const gen=[...document.querySelectorAll('span')].filter(s=>s.textContent.trim()==='Generiert').length;return JSON.stringify({i:$i,spin:document.querySelectorAll('.animate-spin').length,len:t.length,gen:gen,err:err||null})})()")
    echo "POLL$i $R"
    if echo "$R" | grep -q 'spin\\":0'; then echo "DONE_AT_$i"; break; fi
    if echo "$R" | grep -q 'err\\":\\"'; then echo "ERR_SEEN"; break; fi
  done
  sleep 5
  ab eval "(()=>{const t=document.body.innerText;const gen=[...document.querySelectorAll('span')].filter(s=>s.textContent.trim()==='Generiert').length;return JSON.stringify({pfx:'$PFX',FINAL:true,url:location.pathname+location.search,bodyLen:t.length,generiertSpans:gen,hasEtsy:/Etsy/.test(t),hasMarketing:/Marketing/.test(t),firstLines:t.split('\n').filter(Boolean).slice(0,14)})})()"
  ab screenshot "$SHOT/$PFX-ergebnis.png"
  ab eval "document.body.innerText" > "/tmp/$PFX-body.txt" 2>&1
}

{
  one_run "Handgemachte Keramiktassen mit Sprenkelglasur" "Etsy" "ba-postfix-1kanal"
  echo "=== DB nach 1-Kanal-Lauf ==="
  cd /home/team/shared/site && bun --env-file=.env scripts/_autosave-e2e-count.ts user_3KGLrQivAW698KVoR3vkZoJYMKU post-fix-nach-1kanal
  one_run "Handgemachte Keramiktassen mit Sprenkelglasur" "Etsy,Marketing" "ba-postfix-2kanal"
  echo "=== DB nach 2-Kanal-Lauf ==="
  bun --env-file=.env scripts/_autosave-e2e-count.ts user_3KGLrQivAW698KVoR3vkZoJYMKU post-fix-nach-2kanal
  echo "POSTFIX_DONE"
} >> "$OUT" 2>&1
tail -3 "$OUT"

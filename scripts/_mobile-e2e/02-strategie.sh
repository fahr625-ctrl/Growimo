#!/usr/bin/env bash
# Mobile-E2E Station 2: Strategie erstellen (Kacheln "📊Marketing" + "🛍️Etsy") = 2 Generierungen.
# Selektoren korrigiert: die DOM-Labels sind "Marketing" und "Etsy" (nicht "Marketing-Plan"/"Etsy-Eintrag").
set -u
S=growimo-mobile
SHOT=/home/team/shared/site/docs/mobile-e2e
IDEA="Personalisierte Bienenwachskerzen für Kinder"
ENC=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$IDEA")
ab() { agent-browser --session "$S" "$@"; }
echo "=== dismiss onboarding + consent ==="
ab eval "(()=>{let o='none';const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Später');if(b){b.click();o='onboarding'}const c=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Ablehnen');if(c){c.click();o+='+consent'}return o})()"
sleep 2
echo "=== open new-project with idea ==="
ab open "https://www.growimo.app/app/new-project?idea=${ENC}"
sleep 10
echo "=== pre-state ==="
ab eval "(()=>{const ta=document.querySelector('#product-idea');const cta=[...document.querySelectorAll('button')].find(b=>/Strategie erstellen/.test(b.textContent||''));return JSON.stringify({idea:ta?ta.value:null,ctaFound:!!cta,ctaDisabled:cta?cta.disabled:null})})()"
echo "=== select tiles Marketing + Etsy ==="
ab eval "(()=>{const labels=['Marketing','Etsy'];const btns=[...document.querySelectorAll('button')];const hits=[];for(const l of labels){const b=btns.find(x=>(x.textContent||'').includes(l)&&(x.className||'').includes('rounded-xl border-2'));if(b){b.click();hits.push(l)}}return JSON.stringify({clicked:hits})})()"
sleep 2
echo "=== post-select ==="
ab eval "(()=>{const cnt=[...document.querySelectorAll('span')].map(s=>s.textContent).find(t=>/ausgewählt/.test(t||''));const cta=[...document.querySelectorAll('button')].find(b=>/Strategie erstellen/.test(b.textContent||''));const sel=[...document.querySelectorAll('button')].filter(b=>(b.className||'').includes('border-2')&&/✓/.test(b.textContent||'')).map(b=>(b.textContent||'').trim().slice(0,20));return JSON.stringify({count:cnt,selected:sel,ctaDisabled:cta?cta.disabled:null})})()"
ab screenshot "$SHOT/m02-strategie-auswahl.png"
echo "=== click Strategie erstellen ==="
ab eval "(()=>{const cta=[...document.querySelectorAll('button')].find(b=>/Strategie erstellen/.test(b.textContent||''));if(!cta)return 'NO_CTA';if(cta.disabled)return 'DISABLED';cta.click();return 'CLICKED'})()"
echo "=== poll ==="
for i in $(seq 1 45); do
  sleep 8
  R=$(ab eval "(()=>{const t=document.body.innerText;const err=(t.match(/Generierung fehlgeschlagen[^\n]*/)||t.match(/Monatslimit[^\n]*/)||t.match(/Keine gültige Sitzung[^\n]*/)||t.match(/Limit erreicht[^\n]*/)||[])[0];return JSON.stringify({i:$i,spin:document.querySelectorAll('.animate-spin').length,len:t.length,err:err||null,saved:/strategie|Strategie.*fertig|Ergebnis/i.test(t)})})()")
  echo "POLL $R"
  case "$R" in
    *'"err":'*) echo "ERR_SEEN"; break;;
  esac
  case "$R" in
    *'"spin":0'*) echo "SPIN_DONE_AT_$i"; break;;
  esac
done
echo "=== result state ==="
ab eval "(()=>{const t=document.body.innerText;return JSON.stringify({url:location.pathname+location.search,len:t.length,hasMarketing:/Marketing/.test(t),hasEtsy:/Etsy/.test(t),headings:[...document.querySelectorAll('p,h2,h3')].map(p=>p.textContent).filter(x=>/Plan|Etsy|Strategie|fertig/i.test(x||'')).slice(0,10)})})()"
ab screenshot "$SHOT/m02-strategie-ergebnis.png"
ab eval "document.body.innerText.slice(0,3000)" > /tmp/m02-body.txt 2>&1
echo "STATION2_DONE"

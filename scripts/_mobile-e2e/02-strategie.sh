#!/usr/bin/env bash
# Mobile-E2E Station 2: Strategie erstellen (Marketing-Plan + Etsy-Eintrag) = 2 Generierungen.
set -u
S=growimo-mobile
SHOT=/home/team/shared/site/docs/mobile-e2e
IDEA="Personalisierte Bienenwachskerzen für Kinder"
ENC=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$IDEA")
ab() { agent-browser --session "$S" "$@"; }

echo "=== dismiss onboarding ==="
ab eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Später');if(b){b.click();return 'closed'}return 'none'})()"
sleep 2

echo "=== open new-project with idea ==="
ab open "https://www.growimo.app/app/new-project?idea=${ENC}"
sleep 10

echo "=== pre-state ==="
ab eval "(()=>{const ta=document.querySelector('#product-idea');const sel=[...document.querySelectorAll('button')].filter(b=>/^✓/.test((b.textContent||'').trim().charAt(0))).length;const cta=[...document.querySelectorAll('button')].find(b=>/Strategie erstellen/.test(b.textContent||''));return JSON.stringify({idea:ta?ta.value:null,ctaFound:!!cta,ctaDisabled:cta?cta.disabled:null})})()"

echo "=== select Marketing-Plan + Etsy-Eintrag ==="
ab eval "(()=>{const labels=['Marketing-Plan','Etsy-Eintrag'];const btns=[...document.querySelectorAll('button')];const hits=[];for(const l of labels){const b=btns.find(x=>(x.textContent||'').includes(l)&&x.className.includes('rounded-xl border-2'));if(b){b.click();hits.push(l)}}return JSON.stringify({clicked:hits})})()"
sleep 2

echo "=== post-select ==="
ab eval "(()=>{const cnt=[...document.querySelectorAll('span')].map(s=>s.textContent).find(t=>/ausgewählt/.test(t||''));const cta=[...document.querySelectorAll('button')].find(b=>/Strategie erstellen/.test(b.textContent||''));return JSON.stringify({count:cnt,ctaDisabled:cta?cta.disabled:null})})()"
ab screenshot "$SHOT/m02-strategie-eingabe.png"

echo "=== click Strategie erstellen ==="
ab eval "(()=>{const cta=[...document.querySelectorAll('button')].find(b=>/Strategie erstellen/.test(b.textContent||''));if(!cta)return 'NO_CTA';if(cta.disabled)return 'DISABLED';cta.click();return 'CLICKED'})()"

echo "=== poll ==="
for i in $(seq 1 40); do
  sleep 8
  R=$(ab eval "(()=>{const t=document.body.innerText;const gen=[...document.querySelectorAll('span')].some(s=>s.textContent.trim()==='Generiert');const err=(t.match(/Generierung fehlgeschlagen[^\n]*/)||t.match(/Monatslimit[^\n]*/)||t.match(/Keine gültige Sitzung[^\n]*/)||[])[0];return JSON.stringify({i:$i,gen,spin:document.querySelectorAll('.animate-spin').length,len:t.length,err:err||null})})()")
  echo "POLL $R"
  case "$R" in
    *'"gen":true'*) echo "GEN_SEEN"; break;;
    *'"err":'*) echo "ERR_SEEN"; break;;
  esac
done

echo "=== result state ==="
ab eval "(()=>{const t=document.body.innerText;return JSON.stringify({len:t.length,headings:[...document.querySelectorAll('p')].map(p=>p.textContent).filter(x=>/Plan|Etsy/.test(x||'')).slice(0,8),links:[...document.querySelectorAll('a,button')].map(a=>(a.textContent||'').trim().slice(0,40)).filter(x=>/Projekt|Image Studio|Strategie/.test(x)).slice(0,10)})})()"
ab screenshot "$SHOT/m02-strategie-ergebnis.png"
ab eval "(()=>{const out=[];document.querySelectorAll('div').forEach(()=>{});const t=document.body.innerText;return t.slice(0,2000)})()" > /tmp/m02-body.txt 2>&1
echo "STATION2_DONE"

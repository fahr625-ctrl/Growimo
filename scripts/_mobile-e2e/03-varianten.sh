#!/usr/bin/env bash
# Mobile-E2E Station 3: A/B-Varianten des ETSY-Assets (1 Generierung).
# Erzeugt die Varianten, extrahiert Texte + Scores je Variante, Screenshots.
# Uebernimmt ABSICHTLICH noch nichts (Station 4 = eigenes Skript).
set -u
S=growimo-mobile
SHOT=/home/team/shared/site/docs/mobile-e2e
PROJ="5d42acdd-16c9-4cd1-b052-40dc8f6526b9"
ab() { agent-browser --session "$S" "$@"; }
echo "=== open project page ==="
ab open "https://www.growimo.app/app/projects/${PROJ}"
sleep 9
ab eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Ablehnen');if(b)b.click();return 'consent_ok'})()"
echo "=== find + click A/B-Varianten in the ETSY card ==="
ab eval "(()=>{const hdr=[...document.querySelectorAll('button')].find(b=>/Etsy/.test(b.textContent||'')&&(b.className||'').includes('w-full items-center gap-3'));if(!hdr)return 'NO_ETSY_HEADER';const card=hdr.closest('div.overflow-hidden')||hdr.parentElement;const btn=[...card.querySelectorAll('button')].find(b=>/A\/B-Varianten/.test(b.textContent||''));if(!btn)return 'NO_VARIANT_BTN';btn.click();return 'CLICKED_VARIANTS'})()"
echo "=== poll for panel ==="
for i in $(seq 1 20); do
  sleep 8
  R=$(ab eval "(()=>{const t=document.body.innerText;const adopt=[...document.querySelectorAll('button')].filter(b=>/Diese Variante übernehmen/.test(b.textContent||'')).length;const err=(t.match(/Varianten[^\n]{0,80}(fehl|Fehler)/i)||[])[0];return JSON.stringify({i:$i,adopt,panel:/wähle die beste/.test(t),len:t.length,err:err||null})})()")
  echo "POLL $R"
  case "$R" in *'adopt":3'*) echo "VARIANTS_READY"; break;; esac
  case "$R" in *'adopt":0'*) ;; *) echo "PARTIAL"; break;; esac
done
echo "=== extract variants ==="
ab eval "(()=>{const btns=[...document.querySelectorAll('button')].filter(b=>/Diese Variante übernehmen/.test(b.textContent||''));const out=[];for(const b of btns){let el=b;for(let k=0;k<6;k++){el=el.parentElement;if(!el)break;if((el.className||'').includes('rounded-xl border p-4'))break;}out.push({block:el?el.innerText:null,body:(()=>{const pre=el?el.querySelector('pre'):null;return pre?pre.innerText:null})()})}const panel=[...document.querySelectorAll('p')].map(p=>p.innerText).filter(x=>/beste|Vorsprung|Punkt|gleichauf|Empfehlung/i.test(x||'')).slice(0,10);return JSON.stringify({count:btns.length,panelNotes:panel,variants:out.map(v=>({head:(v.block||'').split('\n').slice(0,8).join(' | '),bodyLen:(v.body||'').length,bodyHead:(v.body||'').slice(0,260)}))})})()" > /tmp/m03-raw.json 2>&1
cat /tmp/m03-raw.json
echo "=== scores per variant (raw text blocks) ==="
ab eval "(()=>{const btns=[...document.querySelectorAll('button')].filter(b=>/Diese Variante übernehmen/.test(b.textContent||''));return JSON.stringify(btns.map(b=>{let el=b;for(let k=0;k<6;k++){el=el.parentElement;if(!el)break;if((el.className||'').includes('rounded-xl border p-4'))break;}return el?el.innerText:''}))})()" > /tmp/m03-blocks.json 2>&1
echo "=== screenshot panel ==="
ab eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Diese Variante übernehmen/.test(x.textContent||''));if(b)b.scrollIntoView({block:'start'});return 'scrolled'})()"
sleep 1
ab screenshot "$SHOT/m03-varianten-1.png"
ab eval "(()=>{const bs=[...document.querySelectorAll('button')].filter(x=>/Diese Variante übernehmen/.test(x.textContent||''));if(bs[1])bs[1].scrollIntoView({block:'start'});return 'scrolled2'})()"
sleep 1
ab screenshot "$SHOT/m03-varianten-2.png"
echo "STATION3_DONE"

#!/usr/bin/env bash
# Mobile-E2E Station 5 + 6a/6b: "🎨 Im Image Studio erstellen" aus dem ETSY-Kanal
# (Prefill-Uebernahme, 0 Generierungen) und Upload-Referenzmechanik (0 Generierungen,
# der Variations-Button wird ABSICHTLICH NICHT geklickt).
set -u
S=growimo-mobile
SHOT=/home/team/shared/site/docs/mobile-e2e
PROJ="5d42acdd-16c9-4cd1-b052-40dc8f6526b9"
ab() { agent-browser --session "$S" "$@"; }
echo "=== open project page ==="
ab open "https://www.growimo.app/app/projects/${PROJ}"
sleep 9
echo "=== dismiss consent ==="
ab eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Ablehnen');if(b){b.click();return 'declined'}return 'none'})()"
echo "=== project state (7c: Produktidee sichtbar?) ==="
ab eval "(()=>{const t=document.body.innerText;const cards=[...document.querySelectorAll('button')].filter(b=>(b.className||'').includes('w-full items-center gap-3')).map(b=>(b.textContent||'').trim().slice(0,60));return JSON.stringify({url:location.pathname,ideaVisible:t.includes('Personalisierte Bienenwachskerzen'),studioBtns:[...document.querySelectorAll('button')].filter(b=>/Im Image Studio erstellen/.test(b.textContent||'')).length,cards,hasScoreBadges:(document.body.innerHTML.match(/ScoreBadge|score-badge/g)||[]).length})})()"
echo "=== click studio button of ETSY card ==="
ab eval "(()=>{const btn=[...document.querySelectorAll('button')].find(b=>/Im Image Studio erstellen/.test(b.textContent||''));if(!btn)return 'NO_STUDIO_BTN';btn.click();return 'CLICKED_STUDIO'})()"
sleep 7
echo "=== studio state (Station 5) ==="
ab eval "(()=>{const ins=[...document.querySelectorAll('input')].filter(i=>i.type!=='file');const promptVals=ins.map(i=>i.value).filter(v=>v&&v.trim().length);const sel=document.querySelector('select');const stamp=document.querySelector('[data-testid=\"image-studio-strategy-reference\"]');const stampTxt=stamp?stamp.innerText.replace(/\n/g,' | '):null;return JSON.stringify({url:location.pathname+location.search,promptLen:promptVals[0]?promptVals[0].length:0,promptHead:promptVals[0]?promptVals[0].slice(0,180):null,projectSelect:sel?(sel.options[sel.selectedIndex]||{}).text:null,ratioChip:(document.body.innerText.match(/\b(2:3|4:3|1:1|16:9)\b/g)||[]).slice(0,4),stamp:stampTxt?stampTxt.slice(0,240):null,refHint:!!document.querySelector('[data-testid=\"image-studio-reference-hint\"]'),backToProject:!!document.querySelector('[data-testid=\"studio-back-project\"]')})})()"
ab eval "window.scrollTo(0,0);'top'"
sleep 1
ab screenshot "$SHOT/m05-studio-prefill-1.png"
echo "=== upload test image (Station 6a/6b) ==="
ab upload "input[type=file]" /tmp/mobile-e2e-testbild.png
sleep 4
ab eval "document.querySelector('[data-testid=\"upload-card\"]')?.scrollIntoView({block:'center'});'scrolled_upload'"
sleep 1
echo "=== upload state ==="
ab eval "(()=>{const card=document.querySelector('[data-testid=\"upload-card\"]');const btn=document.querySelector('[data-testid=\"upload-variation-btn\"]');const noRef=document.querySelector('[data-testid=\"upload-no-reference\"]');return JSON.stringify({uploadCards:document.querySelectorAll('[data-testid=\"upload-card\"]').length,btnText:btn?btn.innerText.trim():null,btnDisabled:btn?btn.disabled:null,noReference:noRef?noRef.innerText.trim():null,refActiveText:[...document.querySelectorAll('p')].map(p=>p.innerText).find(x=>/Produktvorlage aktiv/.test(x||''))||null,cardText:card?card.innerText.replace(/\n/g,' | ').slice(0,220):null})})()"
ab screenshot "$SHOT/m06-upload-referenz.png"
echo "=== full studio text (tail) ==="
ab eval "document.body.innerText.slice(0,4000)" > /tmp/m05-studio-body.txt 2>&1
echo "STATION56_AB_DONE"

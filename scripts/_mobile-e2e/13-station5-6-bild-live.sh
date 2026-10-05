#!/usr/bin/env bash
# LIVE-Beweis Station 5 (echte gpt-image-1-Generierung) + Station 6c
# (Variationslauf mit hochgeladenem Referenzbild / images.edit + input_fidelity)
# auf www.growimo.app, ausgehend vom frischen Etsy-Projekt 9b6c6651.
# Jeder Browser-Aufruf ist mit `timeout` ummantelt (bekannte Hänger-Falle).
# Aufruf: bash scripts/_mobile-e2e/13-station5-6-bild-live.sh
set -u
S=bildprompt-live
SHOT=/home/team/shared/site/docs/mobile-e2e
OUT=/tmp/station5-6-live.log
TESTBILD=/tmp/mobile-e2e-testbild.png
PID=9b6c6651-6fd3-4fb8-852a-73ae3ae49556
: > "$OUT"
ab() { timeout 120 agent-browser --session "$S" "$@"; }
lsm() { ab eval "document.querySelector('$1')?.scrollIntoView({block:'center'});'scrolled'"; }
GAL='(()=>{const g=[...document.querySelectorAll("img")].filter(i=>(i.src||"").startsWith("data:image"));return JSON.stringify({galleryImgs:g.length,srcLens:g.map(i=>i.src.length).slice(0,6),bodyLen:document.body.innerText.length,spin:document.querySelectorAll(".animate-spin").length,err:(document.body.innerText.match(/Bildgenerierung fehlgeschlagen[^\n]*|Limit erreicht[^\n]*|fehlgeschlagen[^\n]*/)||[])[0]||null})})()'

{
  echo "=== STATION 5+6 LIVE $(date -u +%FT%TZ) ==="
  echo "TESTBILD: $(md5sum $TESTBILD 2>/dev/null)"

  echo "--- 1) Login-Status ---"
  echo "WHOAMI: $(ab eval "JSON.stringify({uid:window.Clerk&&window.Clerk.user?window.Clerk.user.id:null,url:location.pathname})")"

  echo "--- 2) Projektseite -> 'Im Image Studio erstellen' ---"
  ab open "https://www.growimo.app/app/projects/$PID" >/dev/null
  sleep 12
  lsm '[data-testid="studio-button"], button'
  echo "STUDIOBTN: $(ab eval "(()=>{const b=[...document.querySelectorAll('button,a')].find(x=>/Im Image Studio erstellen/.test(x.textContent||''));if(!b)return 'NO_BUTTON';b.scrollIntoView({block:'center'});b.click();return 'CLICKED'})()")"
  sleep 12
  echo "STUDIO_STATE: $(ab eval "(()=>{const ins=[...document.querySelectorAll('input')].filter(i=>i.type!=='file');const pv=ins.map(i=>i.value).filter(v=>v&&v.trim().length)[0]||'';return JSON.stringify({url:location.pathname+location.search,promptLen:pv.length,promptHead:pv.slice(0,160),cp:/verifying your browser|Failed to verify/.test(document.body.innerText)})})()")"
  echo "USAGE_VORHER: $(ab eval "(()=>{const m=(document.body.innerText.match(/(\d+)\s*\/\s*5/g)||[]);return JSON.stringify({matches:m.slice(0,4)})})()")"
  ab screenshot "$SHOT/station5-studio-prefill-live.png" >/dev/null

  echo "--- 3) GENERIEREN (gpt-image-1, Text->Bild) ---"
  echo "GEN_CLICK: $(ab eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Generieren$/.test((x.textContent||'').trim()));if(!b)return 'NO_GEN_BTN';if(b.disabled)return 'DISABLED';b.click();return 'CLICKED'})()")"
  for i in $(seq 1 14); do
    sleep 10
    R=$(ab eval "$GAL")
    echo "POLL$i $R"
    echo "$R" | grep -q '"galleryImgs":[1-9]' && { echo "IMAGE_SEEN_AT_$i"; break; }
    echo "$R" | grep -q '"err":"' && { echo "ERR_SEEN"; break; }
    echo "$R" | grep -q '"spin":0' && { echo "SPIN_STOP_NO_IMAGE"; break; }
  done
  sleep 4
  echo "STATION5_FINAL: $(ab eval "$GAL")"
  ab screenshot "$SHOT/station5-bild-live.png" >/dev/null
  echo "USAGE_NACH_BILD1: $(ab eval "(()=>{const m=(document.body.innerText.match(/(\d+)\s*\/\s*5/g)||[]);return JSON.stringify({matches:m.slice(0,4)})})()")"

  echo "--- 4) STATION 6c: Referenzbild hochladen + Variation ---"
  lsm '[data-testid="upload-variation-btn"]'
  ab upload "input[type=file]" "$TESTBILD"
  sleep 6
  echo "UPLOAD_STATE: $(ab eval "(()=>{const btn=document.querySelector('[data-testid=\"upload-variation-btn\"]');const card=document.querySelector('[data-testid=\"upload-card\"]');return JSON.stringify({cards:document.querySelectorAll('[data-testid=\"upload-card\"]').length,btnText:btn?btn.innerText.trim():null,btnDisabled:btn?btn.disabled:null,noRef:!!document.querySelector('[data-testid=\"upload-no-reference\"]'),cardHead:card?card.innerText.split('\n')[0]:null})})()")"
  echo "VAR_CLICK: $(ab eval "(()=>{const b=document.querySelector('[data-testid=\"upload-variation-btn\"]');if(!b)return 'NO_BTN';if(b.disabled)return 'DISABLED';b.click();return 'CLICKED'})()")"
  for i in $(seq 1 14); do
    sleep 10
    R=$(ab eval "$GAL")
    echo "VPOLL$i $R"
    echo "$R" | grep -q '"galleryImgs":[2-9]' && { echo "VAR_IMAGE_SEEN_AT_$i"; break; }
    echo "$R" | grep -q '"err":"' && { echo "VAR_ERR_SEEN"; break; }
    echo "$R" | grep -q '"spin":0' && { echo "VAR_SPIN_STOP"; break; }
  done
  sleep 4
  echo "STATION6C_FINAL: $(ab eval "$GAL")"
  lsm '[data-testid="upload-card"]'
  ab screenshot "$SHOT/station6c-variation-live.png" >/dev/null
  echo "USAGE_NACH_BILD2: $(ab eval "(()=>{const m=(document.body.innerText.match(/(\d+)\s*\/\s*5/g)||[]);return JSON.stringify({matches:m.slice(0,4),bodyHead:document.body.innerText.slice(0,200)})})()")"
  echo "STATION56_LIVE_DONE"
} >> "$OUT" 2>&1
tail -3 "$OUT"

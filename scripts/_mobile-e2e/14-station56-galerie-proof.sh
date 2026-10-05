#!/usr/bin/env bash
# Nachlauf: wartet auf das Ende von 13-station5-6-bild-live.sh und zieht die
# Galerie-Belege (Bild-Ausschnitt + PNG-Header-Beweis) für die Evidence nach.
set -u
S=bildprompt-live
SHOT=/home/team/shared/site/docs/mobile-e2e
OUT=/tmp/station56-after.log
: > "$OUT"
ab() { timeout 150 agent-browser --session "$S" "$@"; }
for i in $(seq 1 60); do grep -q STATION56_LIVE_DONE /tmp/station5-6-live.log 2>/dev/null && break; sleep 10; done
{
  echo "=== AFTER $(date -u +%FT%TZ) ==="
  echo "SCRIPT_END: $(grep -c STATION56_LIVE_DONE /tmp/station5-6-live.log)"
  echo "GALERIE: $(ab eval "(()=>{const g=[...document.querySelectorAll('img')].filter(i=>(i.src||'').startsWith('data:image'));const sec=[...document.querySelectorAll('section')].find(s=>/Generierte Bilder/.test(s.innerText));if(sec)sec.scrollIntoView({block:'start'});return JSON.stringify({gal:g.length,lens:g.map(i=>i.src.length),headers:g.map(i=>i.src.slice(0,32)),cardTxt:g.map(i=>{const a=i.closest('article');return a?a.innerText.replace(/\n/g,' | ').slice(0,90):null})})})()")"
  sleep 2
  ab screenshot "$SHOT/station5-galerie-live.png" || true
  echo "USAGE_BANNER: $(ab eval "(()=>{const m=document.body.innerText.match(/[^\n]*verbleibend[^\n]*/);return JSON.stringify({banner:m?m[0]:null})})()")"
  echo "AFTER_DONE"
} >> "$OUT" 2>&1
tail -4 "$OUT"

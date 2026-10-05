#!/usr/bin/env bash
set -u
S=growimo-mobile
ab() { agent-browser --session "$S" "$@"; }
echo "=== consent ==="
ab eval "(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Ablehnen');if(b){b.click();return 'declined'}return 'none'})()"
sleep 1
echo "=== scroll bottom ==="
ab eval "window.scrollTo(0,document.body.scrollHeight); 'scrolled'"
sleep 1
echo "=== buttons dump ==="
ab eval "(()=>{const bs=[...document.querySelectorAll('button')].map(b=>({t:(b.textContent||'').trim().slice(0,30),c:(b.className||'').slice(0,50)}));return JSON.stringify({n:bs.length,bs:bs})})()"
echo "=== scrollY/height ==="
ab eval "JSON.stringify({y:window.scrollY,h:document.body.scrollHeight})"
echo "DEBUG_DONE"

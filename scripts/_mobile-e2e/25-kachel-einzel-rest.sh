#!/usr/bin/env bash
# Kachel-Vereinfachung — TEIL 2 Rest: EIN Kachel-Lauf (Social/Marketing/Ideen)
# in der bereits angemeldeten Session. Hängt eine Zeile an
# /tmp/kacheln-einzel-results.jsonl an (Zähler-Kette NICHT zurücksetzen).
# Aufruf: bash scripts/_mobile-e2e/25-kachel-einzel-rest.sh <key> <erwarteterType> "<Idee>"
set -u
S=kacheln-mobile
ROOT=/home/team/shared/site
SHOT=$ROOT/docs/mobile-e2e
RESULTS=/tmp/kacheln-einzel-results.jsonl
TESTUSER=user_3KGLrQivAW698KVoR3vkZoJYMKU
KEY="$1"; EXPECTED="$2"; IDEA="$3"
ab() { timeout 90 agent-browser --session "$S" "$@"; }
enc() { python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$1"; }
TILES='(()=>{const els=[...document.querySelectorAll("[data-strategy-tile]")];const cta=[...document.querySelectorAll("button")].find(b=>/Strategie erstellen/.test(b.textContent||""));return JSON.stringify({tiles:els.map(b=>b.getAttribute("data-strategy-tile")),ctaDisabled:cta?cta.disabled:null})})()'

echo "--- LAUF $KEY (erwartet $EXPECTED) $(date -u +%FT%TZ) ---"
ab open "https://www.growimo.app/app/new-project?idea=$(enc "$IDEA")"
sleep 12
echo "TILES_VOR: $(ab eval "$TILES")"
echo "CLICK: $(ab eval "(()=>{const b=document.querySelector('[data-strategy-tile=\"$KEY\"]');if(!b)return 'NO_TILE';b.click();return 'CLICKED'})()")"
sleep 2
echo "TILES_NACH: $(ab eval "$TILES")"
ab screenshot "$SHOT/m30-kachel-$KEY-auswahl.png"
echo "CTA: $(ab eval "(()=>{const c=[...document.querySelectorAll('button')].find(b=>/Strategie erstellen/.test(b.textContent||''));if(!c)return 'NO_CTA';if(c.disabled)return 'DISABLED';c.click();return 'CLICKED'})()")"

done=0
for i in $(seq 1 45); do
  sleep 5
  R=$(ab eval "(()=>{const t=document.body.innerText;return JSON.stringify({i:$i,len:t.length,fertig:/W(ö|o)rter insgesamt/.test(t),kanaele:(/(\\d+) Kanal/.exec(t)||[])[1]||null,res:/A\\/B-Varianten/.test(t),err:((t.match(/Generierung fehlgeschlagen[^\\n]*/)||t.match(/Limit erreicht[^\\n]*/)||[])[0])||null})})()")
  echo "POLL_$i $R"
  if echo "$R" | grep -q 'Wörter insgesamt\|W\u00f6rter insgesamt\|fertig\\":true'; then done=1; break; fi
  if echo "$R" | grep -q 'Generierung fehlgeschlagen\|Limit erreicht'; then break; fi
done
sleep 3
echo "ERGEBNIS: $(ab eval "(()=>{const t=document.body.innerText;const hs=[...document.querySelectorAll('h1,h2')].map(h=>h.innerText.trim().slice(0,60));return JSON.stringify({url:location.pathname,bodyLen:t.length,headings:hs,extra:[...t.matchAll(/(\\d+) von (\\d+) Generierungen verbleibend|(\\d+) Kanal|(\\d+) W(?:ö|o)rter insgesamt/g)].map(m=>m[0]).slice(0,5)})})()")"
ab screenshot "$SHOT/m31-kachel-$KEY-ergebnis.png"
cd "$ROOT" && bun --env-file=.env scripts/_mobile-e2e/kacheln-db-check.ts "$TESTUSER" 1 > "/tmp/kacheln-$KEY-db.json" 2>&1
python3 - "$KEY" "$EXPECTED" "$done" <<'PY' >> "$RESULTS"
import json, sys
key, expected, done = sys.argv[1], sys.argv[2], int(sys.argv[3])
d = json.load(open(f"/tmp/kacheln-{key}-db.json"))
p = (d.get("projects") or [{}])[0]
row = {"tile": key, "expected": expected, "generationDone": done,
       "projectId": p.get("id"), "projectContentTypes": p.get("contentTypes"),
       "usageRows": d.get("usageMonthly"), "usageTotal": d.get("usageTotal"),
       "storedRows": (d.get("contents") or [{}])[0].get("rows")}
print(json.dumps(row, ensure_ascii=False))
PY
tail -1 "$RESULTS"
echo "ZAHLER_${KEY}: usage=$(python3 -c "import json;print(json.load(open('/tmp/kacheln-$KEY-db.json')).get('usageTotal'))")"
echo "FERTIG_$KEY"

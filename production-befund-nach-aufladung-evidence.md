# Production-Befund NACH 10$-Guthabenaufladung: TikTok todayIdea schlägt weiterhin mit OpenAI 429 fehl
Datum: 2026-09-11, 19:20–19:25 UTC. Delegation: Analyse des NEUEN Production-Requests nach Guthabenaufladung.
Autor: engineer. Status: Diagnose abgeschlossen — Owner-Entscheidung erforderlich (Key/Org-Zuordnung).
## Kernaussage
**Der neue Fehler ist identisch mit dem alten: OpenAI HTTP 429 `insufficient_quota` / `credit_balance_exhausted`.**
Die 10 $-Aufladung ist für den Org, dem der Production-API-Key gehört, NICHT wirksam.
Kein 401/403 (Key gültig), kein Timeout, kein neuer Fehler, kein 200-Erfolg.
Antwortkategorie laut Auftrag: **(a) weiterhin 429-Quota** (Key passt nicht zur aufgeladenen Org ODER Guthaben noch nicht wirksam).
---
## 1. Echte Vercel-Production-Logs (Projekt "site") — NEUE Owner-Requests identifiziert
`bunx vercel logs --project site --environment production --since 4h` (19:20 UTC, Auszug wörtlich):
```
19:16:01.17  www.growimo.app  info   λ POST /_serverFn/c5a06ea39a783ee8b3870581fdd275a061a938a0f2f2e936944df44a51caba3c
[server.generateTikTok] todayIdea lang: de biz: Growimo ist ein KI-gestützter Marketing-Assistent für Selbst
19:15:51.15  www.growimo.app  info   λ POST /_serverFn/c5a06ea39a783ee8b3870581fdd275a061a938a0f2f2e936944df44a51caba3c
[server.generateTikTok] todayIdea lang: de biz: Growimo ist ein KI-gestützter Marketing-Assistent für Selbst
```
Das sind die ZWEI Requests des Owners NACH der Aufladung (vorherige Analyse endete 19:00 UTC; Owner-Test 19:15–19:16 UTC).
Beide erreichten den generateTikTok-ServerFn (mode=todayIdea, lang=de) — der Server loggt den OpenAI-Fehlertext
nicht (steht nur in der HTTP-Antwort an den Client). Davor (18:46 UTC) ein `GET /app/billing` des Owners.
Auch sichtbar (separates, NICHT TikTok-bezogenes Ereignis): 19:15:45.92 `/api/beta-access` → transiente Neon-DB-Deadlock
`NeonDbError: deadlock detected (code 40P01)`. Unabhängig vom TikTok-Fehler (der 429 kommt von OpenAI, nicht von der DB).
Mein eigener E2E-Request erscheint im 30-min-Fenster unter 19:21:48.05 (gleicher ServerFn, biz=
"Handgemachte Keramiktassen mit Duftkerzen, nachhaltiger Ton,") — Log-Korrelation bestätigt.
## 2. Lokaler OpenAI-Key-Check (kein Web-Dashboard, nur API)
### (a) GET /v1/models (kostenlos) mit lokalem `.env`-Key (sk-proj-…LogA, 164 Zeichen) — Key VALIDE
```
HTTP_STATUS: 200
MODEL_COUNT: 130 | first: text-embedding-ada-002
```
→ Kein 401: Der Key ist dem OpenAI-Konto/Org bekannt und zugelassen.
### (b) Minimaler echter Chat-Call (gpt-4o, max_tokens=1; Bruchteil eines Cents) — KEINE Credits für DIESEN Key/Org
```
KEY_PREFIX: sk-proj-...LogA | KEY_LEN: 164
HTTP_STATUS: 429
VERBATIM_RESPONSE: {
    "error": {
        "message": "You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.",
        "type": "insufficient_quota",
        "param": null,
        "code": "credit_balance_exhausted"
    }
}
```
→ Trotz 10 $-Aufladung: Die Org, zu der der lokale Key gehört, hat weiterhin NULL Credits.
## 3. Key-/Org-/Guthaben-Zuordnung
- Vercel Production: `OPENAI_API_KEY` ist als **Secret** in Production gesetzt (seit 32 Tagen, mit allen anderen
  Env-Vars). Secret-Werte sind per `vercel env pull` NICHT abrufbar (CLI schreibt `[SENSITIVE]`-Platzhalter) —
  der konkrete Production-Key-Wert ist per CLI nicht einsehbar und wird hier NICHT angefordert.
- Lokaler `.env`-Key (sk-proj-…LogA) ist valide (200 auf /v1/models) aber quota-los (429 auf chat).
- Production E2E (Punkt 4) liefert die WORTGLEICHE 429-Meldung wie der lokale Key-Check und wie der
  Vor-Befund (Commit 56c57c3, alle 4 Pfade) — d.h. Production-Key zeigt auf eine Org mit ebenfalls
  null Credits. Ob Production-Key == lokaler .env-Key ist, ist per CLI nicht 100 % verifizierbar;
  beides konsistent mit "Org ohne Credits".
- Org-Zugehörigkeit eines Keys ist über die öffentliche API nicht auflösbar (nur Dashboard).
## 4. Echter Production-E2E-Test "Was soll ich heute posten?" (todayIdea, OHNE Themen-Eingabe) gegen www.growimo.app
Auth: frisch geminteter Clerk-Session-JWT (scripts/mint-session-file.ts, SID sess_3JCA0BkbEFPMYRYmsoUAY4Is4p3,
User user_3IYfD4pQhQ1HKjH6pb7tlLkQnAo); seroval-Body (toJSONAsync) + x-tsr-serverFn:true + Origin + Browser-UA;
Payload mode=todayIdea, biz="Handgemachte Keramiktassen mit Duftkerzen, nachhaltiger Ton, 29 EUR",
goal=Verkäufe, audience="Frauen 25–45, Interior-Liebhaberinnen", lang=de, history=[].
`JWT=$(cat /home/team/shared/e2e/session-jwt.txt) bun run scripts/_e2e-prod.ts tiktok` → Ausgabe WÖRTLICH:
```
[tiktok todayIdea] HTTP 200 in 2776ms
  response head: {"t":10,"i":0,"p":{"k":["result","error","context"],"v":[{"t":2,"s":1},{"t":25,"i":1,"s":{"message":{"t":1,"s":"429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/."}},"c":"$TSR/Error"},{"t":10,"i":2,"p":{"k":[],"v":[]},"o":0}]},"o":0}
  response length: 318 | framed? false
```
HTTP-Transport: 200 (Routing/Auth/ServerFn intakt). Inhalt: `$TSR/Error` mit exaktem OpenAI-Text
`429 You have no credits remaining. …` — die deutsche UI-Meldung "Es gab ein Problem bei der Erstellung."
ist die Übersetzung dieses ServerFn-Errors im Client.
## 5. Antworten auf die 4 Owner-Fragen
1. **Exakter HTTP-/OpenAI-Fehler:** HTTP 429; `type: "insufficient_quota"`, `code: "credit_balance_exhausted"`;
   Message: "You have no credits remaining. Add credits to continue using the API at
   https://platform.openai.com/settings/organization/billing/." — wortgleich vor und nach der Aufladung, lokal wie Production.
2. **Key-Zuordnung:** Key ist valide (kein 401). Production nutzt Secret OPENAI_API_KEY (32d). Die Org des Keys
   hat KEINE Credits. Per API nicht feststellbar, ob das die Org ist, auf die der Owner die 10 $ geladen hat —
   Dashboard-Check Owner-seitig erforderlich (Billing-Seite: zu welcher Org gehört der Key sk-proj-…LogA bzw.
   der Production-Secret; auf welcher Org ist das Guthaben sichtbar).
3. **Guthaben-Verfügbarkeit:** Für den Key/Org NICHT wirksam (429 persistiert nach Aufladung, getestet 19:20 UTC).
   Mögliche Ursachen: (i) 10 $ auf anderer Org geladen als die des Keys; (ii) Key gehört zu einem Project/
   Org-Kontext ohne zugreifbares Guthaben; (iii) Guthaben noch nicht propagiert (weniger wahrscheinlich, da >25 min).
4. **Folgefehler sichtbar:** NEIN — kein neuer Fehler nach Quota-Fix. Kein Timeout, kein Validierungsfehler,
   kein anderer 4xx/5xx. Einzige Zusatzbeobachtung: transiente Neon-Deadlock (40P01) auf `/api/beta-access`
   um 19:15:45 (unabhängig vom TikTok-Pfad, kein Code-Fix nötig).
## Empfehlung (Owner-Entscheidung)
- In platform.openai.com prüfen: Welcher Org/Project gehört der in Production (und lokal .env) verwendete Key?
  Billing-Seite zeigt das Guthaben je Org. 10 $ müssen auf DIESELBE Org geladen sein, der der Key zugeordnet ist.
- Wenn der Key zu einer "Project"-Org gehört: dort Billing/Guthaben prüfen; ggf. neuen Key in der aufgeladenen Org
  erzeugen und als Vercel-Secret OPENAI_API_KEY ersetzen (dann re-deploy).
- Kein Code/Transport-Problem: Der TikTok-Pfad selbst ist intakt (ServerFn erreicht, OpenAI-Call erfolgt).
---
API-Calls diese Session (sparsam): 1× GET /v1/models (kostenlos), 1× chat max_tokens=1 (Bruchteil Cent),
1× Production-E2E todayIdea (1 realer gpt-4o-Call). Keine Codeänderung, kein Deploy, kein Commit.
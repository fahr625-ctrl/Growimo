# Production-Befund: OpenAI 429 (Kontingent) — kein Code-/Transport-Bug

Datum: 2026-09-11, 18:57–19:00 UTC. Delegation 38edbb97-Folgeauftrag (Regressions-Abschluss).
Autor: engineer. Status: Owner-Entscheidung erforderlich (Kontingent ist ein Provider-/Billing-Problem).

## Kernaussage

**Code/Transport OK — Problem = OpenAI-Kontingent/429.** TikTik (todayIdea + concept),
Strategie-Stream (SSE) und Bild-Studio (gpt-image-1) funktionieren in PRODUCTION jeweils bis
zum echten OpenAI-HTTP-Call; OpenAI antwortet auf ALLEN Pfaden wörtlich:

> `429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.`

---

## 1. Echte Vercel-Production-Logs (Projekt "site", Deployment dpl_2rN4mqT66AQPQT8AxFDUVJCDKh7i = site-kjqd01yrk-growimo.vercel.app)

`bunx vercel logs --project site --environment production --since 6h` (18:57–18:59 UTC, Auszug wörtlich):

```
18:59:29.12  www.growimo.app  info   λ POST /api/generate/stream
[generate] Request: {"contentType":"pinterest_pin","productIdea":"Handgemachte Keramiktasse mit Duftkerze, 29 EUR"}
[generate] Configured providers: 1
[generate] Using provider: openai
[openai] Calling GPT-4o, model: gpt-4o contentType: pinterest_pin
[openai] System prompt (first 100 chars): Du bist kein generischer KI-Assistent. Du bist ein Pinterest-Veteran ...
[openai] User prompt: Produktidee: Handgemachte Keramiktasse mit Duftkerze, 29 EUR  Antworte vollständig auf Deutsch.
[generate] Request: {"contentType":"etsy_listing", ...}
[generate] Configured providers: 1
[generate] Using provider: openai
[openai] Calling GPT-4o, model: gpt-4o contentType: etsy_listing
[generate] Request: {"contentType":"seo_blog", ...}
[generate] Configured providers: 1
[generate] Using provider: openai
[openai] Calling GPT-4o, model: gpt-4o contentType: seo_blog
18:59:16.07  www.growimo.app  info   λ POST /_serverFn/bbc1580306152defaeee8bb8710d483f458ce816801e953366365f7d61ee1468   (Image-Studio)
18:59:14.04  www.growimo.app  info   λ POST /_serverFn/c5a06ea39a783ee8b3870581fdd275a061a938a0f2f2e936944df44a51caba3c
[server.generateTikTok] concept lang: de biz: Handgemachte Keramiktassen
18:58:50.92  www.growimo.app  info   λ POST /_serverFn/c5a06ea39a783ee8b3870581fdd275a061a938a0f2f2e936944df44a51caba3c
[db] Schema initialized successfully.
[server.generateTikTok] todayIdea lang: de biz: Handgemachte Keramiktassen mit Duftkerzen, nachhaltiger Ton,
18:57:51.72  www.growimo.app  info   λ GET /
18:57:46.60  www.growimo.app  info   λ GET /robots.txt
```

Hinweis CLI-Workaround: `vercel logs --project growimo --environment production` schlägt fehl
("Project not found: growimo") — der Projektname ist **"site"**. `vercel logs dpl_… --follow`
liefert bei diesem Setup keine Lambda-Stdout-Zeilen in Echtzeit (Log-Delivery-Latenz); der
Beweis kommt aus `--project site --environment production --since <h>` (retrospektiv erreichbar).
Die Fehlerzeilen selbst (429-Text) stehen nicht im Server-Log, sondern in der HTTP-Antwort
an den Client — deshalb zusätzlich die E2E-Requests unten.

---

## 2. Echte E2E-Tests gegen https://www.growimo.app (Owner-Vorgabe, KEIN Mock)

Auth: geminteter Clerk-Session-JWT (scripts/mint-session-file.ts, User user_3IYfD4pQhQ1HKjH6pb7tlLkQnAo,
Session sess_3JC7IQfd8CaoaOl98PZyQsFsTRE), Cookie `__session=<jwt>`, Header `x-tsr-serverFn: true`
+ Origin + Browser-UA, Body = seroval `toJSON({ data: {...} })` wie der echte TanStack-Client.

### (a) TikTok todayIdea — HTTP 200, VERBATIM 429
POST /_serverFn/c5a06ea… (generateTikTokServer), mode=todayIdea, biz=„Handgemachte Keramiktassen
mit Duftkerzen, nachhaltiger Ton, 29 EUR", lang=de → **HTTP 200 in 4458ms**, Body (seroval, gekürzt):
```json
{"t":10,"i":0,"p":{"k":["result","error","context"],"v":[
  {"t":2,"s":1},
  {"t":25,"i":1,"s":{"message":{"t":1,"s":"429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/."}},"c":"$TSR/Error"},
  {"t":10,"i":2,"p":{"k":[],"v":[]},"o":0}]},"o":0}
```

### (b) TikTok concept (topic=„Keramikbecher im Winter") — HTTP 200, VERBATIM 429
POST /_serverFn/c5a06ea…, mode=concept, biz=„Handgemachte Keramiktassen", topic=„Keramikbecher
im Winter", lang=de → **HTTP 200 in 2110ms**, Message identisch: `429 You have no credits remaining. …`

### (c) Strategie-Stream (SSE) /api/generate/stream — SSE-Kanal funktioniert, JEDER Kanal 429
POST /api/generate/stream (3 Kanäle: pinterest_pin, etsy_listing, seo_blog) → **HTTP 200 in 268ms**;
SSE-Events (wörtlich, gekürzt):
```
data: {"type":"started","runId":"run_mtxblorp_drhk7lte","totalSteps":3}
data: {"type":"step","stepId":"channel:pinterest_pin","title":"Pinterest-Pins","status":"running","order":0}
data: {"type":"step","stepId":"channel:etsy_listing","title":"Etsy-Eintrag","status":"running","order":1}
data: {"type":"step","stepId":"channel:seo_blog","title":"SEO-Blogbeitrag","status":"running","order":2}
data: {"type":"step","stepId":"channel:etsy_listing","title":"Etsy-Eintrag","status":"error","durationMs":1915,"order":1}
data: {"type":"error","stepId":"channel:etsy_listing","message":"429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/."}
data: {"type":"step","stepId":"channel:seo_blog",...,"status":"error",...}
data: {"type":"error","stepId":"channel:seo_blog","message":"429 You have no credits remaining. …"}
data: {"type":"step","stepId":"channel:pinterest_pin",...,"status":"error",...}
data: {"type":"error","stepId":"channel:pinterest_pin","message":"429 You have no credits remaining. …"}
data: {"type":"done","runId":"run_mtxblorp_drhk7lte"}
```

### (d) Bild-Studio (gpt-image-1) — HTTP 200, VERBATIM 429
POST /_serverFn/bbc1580306152defaeee8bb8710d483f458ce816801e953366365f7d61ee1468
(Image-Studio-ServerFn), prompt=„Keramiktasse mit Duftkerze, Pastell, Produktfoto", aspectRatio=2:3
→ **HTTP 200 in 3490ms**, Message identisch: `429 You have no credits remaining. …`

**Interpretation:** Transport (Routing, seroval-Payload, Validator, Auth, SSE-Framing) ist in
Production nachweislich intakt. Die identische OpenAI-Kontingent-Antwort auf TikTok UND Strategie
beweist den gemeinsamen Flaschenhals: **OpenAI-API-Key ohne Restcredits**. Das ist ein
Provider-/Billing-Problem zur Owner-Entscheidung, KEIN Code-Bug.

---

## 3. Lokale Bestätigung mit echtem Key (dist-Round-Trip, gleicher Build wie Production)

`bun --env-file=.env run transport-regression-test.ts` (echter OpenAI-Key, gleicher gebauter
SSR-Server dist/server/server.js aus Commit 96a6e4e) → HTTP 200, wörtlich:
`429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.`
Identischer Text wie Production ⇒ lokaler .env-Key und Production nutzen dieselbe Kontingent-Quelle
(oder beide sind auf demselben OpenAI-Konto erschöpft).

---

## 4. Team-Log-Hinweis (Aufgabe 5): Test-Aktivität vs. Kontingent

Die vielen echten API-Calls der letzten Tage (transport-regression-tests MIT --env-file=.env,
Evidenz-Generierung, Diagnose-Calls) laufen gegen denselben OpenAI-Key/Org wie Production
(belegt durch identische 429-Billing-Antwort). Sobald Credits vorhanden sind, verbrauchen
unsere Tests Kontingent mit. KEINE Änderung nötig, nur zur Kenntnis fürs Team-Log.
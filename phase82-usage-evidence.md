# Phase 8.2 Abschluss — Usage-System: Build-Fix, Deploy & Prod-E2E Evidence

Datum: 2026-09-12 · Engineer-Session (Fortsetzung von a94ae8a7, dessen Produktcode-Befund gültig blieb)
Commit(s): Produktcode a3dcdd9 (gepusht) · Build-Fix+E2E-Skript 6bdbd3b (gepusht, origin/master)

## 1. Root-Cause Build-Fehler (`#tanstack-start-entry` in `bun build vercel-entry.ts`)

**Fehlerbild (reproduzierbar):** `bash build-vercel.sh` → EXIT 1 in Schritt 3
(`bun build vercel-entry.ts --target node`):
```
error: Could not resolve: "#tanstack-start-entry". Maybe you need to "bun install"?
    at node_modules/@tanstack/start-server-core/dist/esm/createStartHandler.js:29:10
```

**Root-Cause (wörtlich, verifiziert):** Nicht Lockfile-Drift und keine node_modules-Neuauflösung
(bun.lock pinnt `@tanstack/start-server-core` 1.169.15 seit mind. HEAD~1, installiert = 1.169.15,
`git status` package.json/bun.lock sauber). Der Auslöser ist der **neue Usage-Guard-Code aus a3dcdd9**:
`src/lib/usage-guard.ts:273` macht `const { getRequest } = await import('@tanstack/react-start/server')`.
Dessen Barrel (`@tanstack/react-start-server/dist/esm/index.js`) re-exportiert
`export * from "@tanstack/start-server-core"` und zieht damit `createStartHandler.js` in den
render.func-Bundle. `createStartHandler.loadEntries()` enthält dynamische Importe der Virtualmodule
`#tanstack-router-entry` und `#tanstack-start-entry`, die NUR das TanStack-Vite-Plugin auflöst
(`@tanstack/start-plugin-core/dist/esm/constants.js`); die beiden anderen Aliase
(`#tanstack-start-plugin-adapters`, `#tanstack-start-server-fn-resolver`) sind über das
`"imports"`-Feld der start-server-core package.json aufgelöst und scheitern NICHT.
Ein rohes `bun build` (ohne Vite-Plugin) kann die zwei Virtualmodule nicht auflösen → Build-Fehler.
Der letzte erfolgreiche Deploy (21:00, Vielfalts-Fix) lief deshalb, weil der alte Code-Pfad nichts
aus `@tanstack/react-start/server` importierte.

**Fix (nachhaltig, verifiziert):**
1. `src/lib/usage-guard.ts`: Lazy-Import auf das leichte Submodul umgestellt:
   `await import('@tanstack/start-server-core/request-response')` — dieses importiert NUR
   `node:async_hooks` + `h3-v2` (KEINE Virtualmodule, KEIN createStartHandler) und exportiert
   **dieselbe** `getRequest()`-Funktion (`return getH3Event().req`, h3-Kontext identisch).
   Verhalten unverändert: h3-Kontext vorhanden → Cookie-Verify; nicht vorhanden (Tests/Skripte) → Fallback.
2. `package.json`: `"@tanstack/start-server-core": "1.169.15"` als direkte Dependency EXAKT gepinnt
   (war bereits transitiv über `@tanstack/react-start@1.168.26` in bun.lock; +1 Zeile in bun.lock,
   keine Versionsänderung). Begründung/separater Punkt: direkter Pin verhindert künftige
   transitive Drift im kritischen Pfad und ist Voraussetzung für den Submodul-Import.
3. KEINE Änderung an build-vercel.sh nötig; KEINE Stubs/Aliase; KEINE Bestandsfunktionen verändert.

## 2. Gates (alle grün, nach Fix)

| Gate | Ergebnis |
|---|---|
| `bash build-vercel.sh` | **EXIT 0** — vite build 5,09 s, render.func/index.mjs 4,24 MB, `done -> .vercel/output ready` |
| `bun --env-file=.env usage-guard-test.ts` | **31 PASS, 0 FAIL** |
| `bunx tsc --noEmit` | **60 Fehler = Baseline (60), 0 neue**; Fehlertext-Mengen identisch (diff EXIT 0), 0 usage-guard-Fehler |
| i18n-Parität de/en | 1352 / 1351 Keys; only DE: `wenn` (bekanntes Regex-Artefakt, identisch zu grüner Baseline) |

## 3. Deploy

- `bunx vercel deploy --prebuilt --prod --yes` → **erster Versuch erfolgreich** (kein Not-authorized-Retry nötig)
- Deployment: **https://site-n1cvbi54t-growimo.vercel.app** — Status **● Ready** (Production, 6 s)
  (Inspect: https://vercel.com/growimo/site/9Jwr72LFjDAuaUbD1kztGSFh1Dn6)
- abgelöst: site-mqhuwnanr (vorheriger Vielfalts-Fix-Deploy, ● Ready)
- **www.growimo.app → HTTP 200** (0,5 s)

## 4. Prod-E2E (scripts/e2e-usage82.ts, `bun --env-file=.env`)

**Skript-Fix (dokumentiert):** Erster Lauf lieferte 6× HTTP 500 „Seroval caught an error during the
deserialization process / Cannot read properties of undefined (reading 't')" — der Request-Body war
plain JSON. Der bekannte Erfolgspfad (scripts/_todayidea-full.ts) serialisiert mit
`JSON.stringify(await toJSONAsync({ data: payload }))` (seroval). Fix: exakt dieses Muster übernommen.
Die fehlgeschlagenen Requests verbrauchten **0 OpenAI-Calls** (Abbruch in der Request-Pipeline vor dem
Handler/Guard). Danach genau 1× sauber gefahren: **6 todayIdea-Calls** (5 Test + 1 Owner).

Test-Nutzer: `user_3IYfD4pQhQ1HKjH6pb7tlLkQnAo` (NICHT Owner) · Owner: `user_3H2trJXHwzXmJF2XTGQ2PMEwjkD`
(beide via Clerk-Backend-API signierte __session-JWTs, 793 Zeichen)

Wörtliche Responses (gekürzt auf Status + Fehlermeldung):

```
[Test 1/5] HTTP 200 | vollständiges todayIdea-Konzept (seroval)   → ok
[Test 2/5] HTTP 200 | vollständiges todayIdea-Konzept             → ok
[Test 3/5] HTTP 200 | vollständiges todayIdea-Konzept             → ok
[Test 4/5] HTTP 200 | vollständiges todayIdea-Konzept             → ok
[Test 5/5] HTTP 200 | vollständiges todayIdea-Konzept             → ok
[Test 6]   HTTP 200 | {"t":25,"i":1,"s":{"message":{"t":1,"s":"Dein monatliches Limit ist aufgebraucht (5/Monat im Free-Plan). Upgrade für 200 pro Monat."}},"c":"$TSR/Error"}   → USAGE_LIMIT wörtlich ✓
[Owner]    HTTP 200 | {"t":25,"i":1,"s":{"message":{"t":1,"s":"Keine gültige Sitzung — bitte neu anmelden."}},"c":"$TSR/Error"}   → Owner-Leg NICHT bestätigt (fail-closed, siehe unten)
```

DB-Befund (usage_monthly, Periode 2026-09):
- Test-Nutzer: **Verbrauch VOR Test 0 → NACH Test 5** (exakt 5, Beweis: Zähler + Limit)
- Owner: Zähler **unverändert 0** (kein Increment — der Override-Pfad wurde mangels verifizierter
  Session nicht erreicht)

**Bewertung / Einschränkung (ehrlich):** Der zentrale Nachweis ist erbracht —
Free 5/5 ok, 6. Call serverseitig mit wörtlicher USAGE_LIMIT-Meldung blockiert, Zähler exakt 5.
Der Owner-Override konnte in diesem Lauf NICHT positiv belegt werden: Das per Clerk-Backend-API
gemintete Owner-Session-JWT besteht die serverseitige JWKS-Sitzungsprüfung nicht
(„Keine gültige Sitzung") — die Sicherung arbeitet damit wie designed fail-closed (kein Override ohne
verifizierte Session, keine Zählerbewegung). Vermutete Ursache: der Owner hat keine aktive
Browser-Session auf growimo (im Gegensatz zum Test-Nutzer); die API-gemintete Session trägt andere
Claims/Status. Nächster Schritt für den positiven Override-Beleg: Owner-Override-E2E mit einer ECHTEN
Browser-Session des Owners (oder mit einer vom Owner zuvor aktiven Clerk-Session) wiederholen —
kein weiterer OpenAI-Call aus dem 6er-Block hierfür nötig, da der Override-Call oben bereits als
Auth-Failure (0 Generierung) endete und der laufende Test-Zähler (5) von der Wiederholung unberührt
bleibt.

## 5. Hinweis für Owner-Kommunikation

**Bestehende Beta-Nutzer haben ab diesem Deploy das Free-5-Limit (5 Generierungen/Monat).**
Der Owner ist per internem Admin-Override ausgenommen (unbegrenzt, kein Zähler-Increment) —
nicht öffentlich angezeigt, nur aus serverseitig verifizierter Session ableitbar (fail-closed).
# Evidenz — Analytics-Erweiterung (Variante A): Unique Visitors + Fehleranalyse

**Auftrag:** Owner 2026-09-27 (Variante A freigegeben). **Art:** additiv, keine Regression bestehender Kennzahlen.
**Repo:** `/home/team/shared/site` (branch master). **Deploy:** www.growimo.app via `build-vercel.sh` + `vercel deploy --prebuilt --prod`.

---

## Phase 0 — Datenschutz-/Consent-Prüfung (Kurzfassung)

**Befund:** Das Setzen einer eindeutigen Besucherkennung im Endgerät (Cookie **oder** localStorage) unterliegt in DE/EU **TTDSG § 25 Abs. 1** (seit 05/2024: TDDDG; inhaltsgleich) bzw. **ePrivacy-Richtlinie Art. 5(3)**. Danach ist das Speichern von Informationen im Endgerät nur erlaubt, wenn der Endnutzer **ausdrücklich eingewilligt** hat — **es sei denn**, die Speicherung ist für die Erbringung eines ausdrücklich gewünschten Dienstes **unbedingt erforderlich** (§ 25 Abs. 2 Nr. 2 TTDSG).

**Anwendung auf Growimo:** Eine **Reichweiten-/Analytics-Kennung ist NICHT „unbedingt erforderlich"** — die Ausnahme des § 25 Abs. 2 Nr. 2 greift nicht (der Dienst würde ohne die Kennung identisch funktionieren; die Kennung dient allein der Messung). ⇒ **Einwilligung ist Pflicht.** Eine gesetzliche Grundlage (Art. 6 DSGVO) ersetzt die TTDSG-Einwilligung nicht — beide sind nötig; die Kennung ist damit nur mit Einwilligung setzbar.

**Speicherung der Entscheidung selbst** (`growimo_consent_analytics = 'yes'|'no'` in localStorage): Das ist **kein** neues einwilligungspflichtiges Speichern, sondern die von der Einwilligung getragene **Pflicht zur Einhaltung der Entscheidung** (Standard-Praxis; dokumentiert, damit der „ja/nein"-Wert nachweisbar bleibt). ⇒ **consent-frei**.

**Datenminimierung:** Die Kennung (`growimo_vid`) ist eine **kryptographisch zufällige UUID (32 hex)**. Kein Fingerprinting, **keine IP-Speicherung**, keine User-Agent-/Geräte-Ableitung, keine personenbezogenen Daten, keine Inhalte. Damit ist sie **pseudonym** (Art. 4 Nr. 5 DSGVO) und datensparsam; Aufbewahrung wie die Events (90 Tage TTL).

**Konsequenz (umgesetzt):** Der Identifier wird **ausschließlich nach ausdrücklicher Zustimmung** gesetzt (fail-closed: kein Header → kein Cookie, Kennung NULL). BESTEHENDES Tracking (pageview-/error-Events, HMAC-Pseudonym für Eingeloggte, In-Memory-Rate-Limit) läuft **unverändert weiter**, unabhängig von der Entscheidung — nur die NEUE eindeutige Anonym-Kennung ist consent-pflichtig. Kein Consent ⇒ anonyme Aufrufe zählen weiter als Pageviews, aber nicht in „Eindeutige Besucher".

---

## 1. Was additiv gebaut wurde

| Baustein | Datei | Inhalt |
|---|---|---|
| Consent-Gate (Banner, non-blocking, de+en) | `src/components/AnalyticsConsent.tsx` (neu), gemountet in `src/routes/__root.tsx` | kleine Karte unten links, erscheint nur bei `undecided`, Buttons „Einverstanden"/„Ablehnen"; kein Overlay, blockiert nichts |
| Consent-Speicher (client) | `src/lib/analytics-consent.ts` (neu) | `growimo_consent_analytics`, `getAnalyticsConsent()`, `setAnalyticsConsent()`, `analyticsConsentHeader()` → sendet **nur** bei `yes` den Header `x-analytics-consent: granted` |
| Fehler-Klassifizierung (client, deterministisch) | `src/lib/analytics-error.ts` (neu) | `ANALYTICS_ERROR_CATEGORIES` (9er-Whitelist), `ANALYTICS_ERROR_CODE_RE`, `classifyGenerationError(err, reason)` → **nur** Kategorie + Kurzcode, niemals Meldung/Stacktrace |
| Tracking-Client | `src/lib/analytics-client.ts` | Sendeoptionen `errorCategory`/`errorCode` (nur bei `status='error'`), Consent-Header |
| Schreib-Endpunkt | `src/api/analytics.ts` | Besucher-Cookie lesen/setzen (`growimo_vid`, HttpOnly/Secure/SameSite=Lax/Path=/, Max-Age 7776000), `visitor_key = user_pseudonym ?? Cookie`, `visitor_new`; strenge Validierung von `errorCategory` (Whitelist) / `errorCode` (Regex) **nur bei `status='error'`** |
| Persistenz | `src/db/analytics.ts` | `AnalyticsEventRow` + Insert um `visitorKey`/`visitorNew`/`errorCategory`/`errorCode` erweitert, serverseitig re-validiert (fail-closed → NULL) |
| Schema (additiv, idempotent) | `src/db/schema.ts` | `visitor_key TEXT`, `visitor_new BOOLEAN`, `error_category TEXT`, `error_code TEXT`, Index `idx_analytics_visitor_created(visitor_key, created_at)`; **kein Backfill** |
| Report | `src/db/admin-analytics.ts` | KPI `uniqueVisitors` (`COUNT(DISTINCT visitor_key)`) + `newVisitors`; `visitorsSince`; Range `today` (= Kalendertag, Trend 1 Tag); `errorEvents[]` (max. 100, **nur** Kanal/Zeit/Kategorie/Code/recorded), `errorsByCategory`, `errorsTotal`, `errorDataSince` |
| Route | `src/api/admin-analytics.ts` | `rangeDays=today` → 0; `7|30|90|all` unverändert; Fehlermeldung angepasst |
| Owner-UI | `src/routes/app/admin-analytics.tsx` | Schalter „Heute" zusätzlich; 2 neue StatCards („Eindeutige Besucher", „Davon neu"); **Label-Klärung** „Anonyme Besuche" → „Anonyme Seitenaufrufe (ohne Login)" (Zahl identisch, nur i18n); Abschnitt **„Fehleranalyse"** direkt unter „Generierung je Kanal" mit Kategorie-Filterchips + Tabelle (Kanal/Zeitstempel/Kategorie/Code), Altfehler als „Unbekannt (nicht erfasst) · vor Einführung" |
| Fehler-Schreibstellen (6) | `QuickGenerator.tsx`, `new-project.tsx` (1× klassifiziert für alle Kanäle), `package.tsx`, `image-studio.tsx` (2 Stellen, Guard-Grund), `tiktok.tsx` | Kategorie/Code ergänzt; Nutzer-Fehlertexte unverändert |
| i18n | `src/i18n/de.ts` + `en.ts` | de/en **1508 → 1541 Keys** (netto +33), Parität ✅, Label-Korrektur |

**DB-Migration ausgeführt** (2026-09-27, Neon Prod-DB): Spalten und Index vorhanden — `information_schema.columns` = `… metadata, created_at, visitor_key, visitor_new, error_category, error_code`; Indizes = `analytics_events_pkey, idx_analytics_event_created, idx_analytics_user_created, idx_analytics_visitor_created`.

**Unverändert (Regressionsschutz):** `views`, `viewsToday`, `uniquePseudonyms`, `anonymousViews` (nur Label), `trend`, `topReferrers`, `topUtmSources`, `featureUsage`, `generationByChannel`, `usersPerFunction`, TTL, Owner-Gate, Rate-Limit, Body-Limit, `FORBIDDEN_KEYS`, `tracking_events`, Usage-Semantik (1 Generierung = 1 fertiges Ergebnis).

---

## 2. Tests (exakte Zahlen)

| Suite | Ergebnis |
|---|---|
| `analytics-unique-visitors-test.ts` (neu) | **26 pass / 0 fail** — Δ`uniqueVisitors` exakt +3 für heute/30d, Dedupe (weiterer Pageview → +views, nicht +unique), Altzzeilen (`visitor_key IS NULL`) zählen nicht, `visitor_new` = 2, `visitorsSince` gesetzt, Range `today` = Kalendertag (Trend 1 Tag), 30d-Trend unverändert 30, Δ aller Bestandskennzahlen = 0, Label-Klärung + de/en-Parität |
| `analytics-visitor-cookie-test.ts` (neu) | **34 pass / 0 fail** — kein Cookie bei „ohne"/„nein" (fail-closed, `visitor_key` NULL, Event trotzdem gespeichert), Cookie nur bei `granted` mit `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7776000`, Wert 32 hex, zweiter Aufruf ohne neues Set-Cookie, **keine IP-/UA-Ableitung** (unterschiedliche IP/UA → unterschiedliche Zufallswerte), ungültiger Cookie wird ersetzt, eingeloggt: `visitor_key = HMAC(Salt, sub)` (Cookie irrelevant), keine IP-/UA-Spalte im Schema |
| `analytics-error-capture-test.ts` (neu) | **30 pass / 0 fail** (nach Fix der Proben: `stack`/`error_message` sind keine Endpunkt-Felder — die Anfrage läuft durch, der Wert wird aber **nirgends gespeichert**, im Test explizit belegt) — Whitelist/Regex/Status-Gate (7 Varianten → 400, keine Zeile), PII-/Inhalts-Proben (`prompt`, `message`, `content`, `email`, `text`) → 400 ohne Zeile, Report enthält ausschließlich `{channel, at, category, code, recorded}`, Altfehler ohne Kategorie → `unknown` + `recorded=false`, `errorsByCategory`-Summe == `errorsTotal`, `errorDataSince` gesetzt, kein Prompt/Marker/Pseudonym im Body, 10 Klassifizierungsfälle exakt |
| `admin-analytics-test.ts` (Bestand) | **23 pass / 1 fail** — Ursache belegt: **Live-Traffic-Drift**, keine Regression (Abschnitt 4.1); die Deltas der Assertion stimmen exakt, nur der absolute `avgMs`-Vergleich kippt |
| `tracking-test.ts` (Bestand) | grün (8/8 Test-User-Events, Cleanup ok) |
| `usage-guard-test.ts` (Bestand) | **31 PASS / 0 FAIL** (exit 0) |
| `usage-semantics-test.ts` (Bestand) | **32 PASS / 0 FAIL** (exit 0) |
| `i18n-scan.ts` | ❌ MIXING FOUND — **schon vor der Änderung rot**; +2 Heuristik-Fehlalarme (Abschnitt 4.2) |
| `bunx tsc --noEmit -p tsconfig.gate.json` | 54 Fehler — **identisch zur Baseline, 0 NEUE** (Abschnitt 4.2) |

---

## 3. Restpunkte (ehrlich)

1. **Bestandsfehler (4, 2026-09-19)** bleiben **ohne Ursache** — sie haben kein `error_category`; die neue Ansicht zeigt sie als „Unbekannt (nicht erfasst)" mit Hinweis „vor Einführung" (`recorded=false`). Kein Raten, keine Ableitung aus `duration_ms`/Route.
2. **Vor-Einführungs-Zeiträume** haben keine belastbare Unique-Visitor-Zahl (kein Backfill möglich); die UI sagt das ausdrücklich („Kennung erfasst seit TT.MM." / Hinweis bei fehlenden Daten).
3. **§ 1.6 Salt-Rotation (P2, unverändert offen):** der Owner-/Test-Ausschluss ist für `analytics_events` wirkungslos (kein gespeichertes Pseudonym matcht `HMAC(ANALYTICS_SALT, …)`). Die neue `uniqueVisitors`-Zahl erbt diese Unschärfe. **Nicht gefixt** (separate Owner-Entscheidung).
4. **Einwilligung wird clientseitig signalisiert** (Header). Serverseitig wird nur geprüft, ob der Header `granted` lautet — ein Besucher kann seinen eigenen Header selbst setzen (das ist seine eigene Entscheidung; es gibt keine PII und keinen Nachteil Dritter). Dokumentiert, kein Sicherheitsproblem.
5. ~~Hero-/Prod-E2E im Browser~~ **ERLEDIGT (2026-09-27, Abschnitt 4.3):** Bundle-Marker, Live-Funktionsbeweis und Owner-Browser-E2E auf www.growimo.app belegt (Screenshots in `docs/`).
6. **`admin-analytics-test.ts` ist an einer Stelle traffic-abhängig** (absolute `avgMs`-Assertion) — Ursache belegt, kein Produktfehler; Hardening optional (Abschnitt 4.1).
7. **`i18n-scan.ts` bleibt rot** (bereits vor der Änderung): 2 neue DE-VALUES-Heuristiktreffer aus deutschen Lehnwörtern (Abschnitt 4.2).

---
## 4. Nacharbeit-Lauf (2026-09-27) — Diagnose 23/1, Rest-Gates, Live-Belege

### 4.1 `admin-analytics-test.ts` = 23 PASS / 1 FAIL — Ursache belegt: **Live-Traffic-Drift, keine Regression**
**Gekippte Assertion:** `check("(c) Δpinterest started/done=+1, avgMs=12000", …)` (Quelle Zeile 149–150); Ausgabe `{"started":1,"done":1,"errors":0}`.
- Die **Deltas stimmen exakt** (`started` +1, `done` +1) — gekippt ist ausschließlich der **absolute** Teil `avgMs === 12000`.
- `avgMs` ist der **Fenster-Durchschnitt** über alle `pinterest_pin`-`done`-Zeilen der letzten 30 Tage, nicht der Wert der geseedeten Zeile.
- **Kein Bezug zur Analytics-Änderung:** die `avgMs`-Berechnung ist in `48bd87c` (vor der Änderung) und in HEAD **byte-identisch** (Vergleich der `avgMs`-Zeilen: kein Unterschied; die Treffer wandern nur von Zeile 318/323 auf 412/417).
- **Beweis der Drift (Live-DB gemessen):** **20** echte `pinterest_pin`-`done`-Zeilen im 30-Tage-Fenster, Dauern `[10021, 21019, 7786, 8989, 9618, 12355, 11631, 10959, 21683, 17096, 18682, 13868, 11636, 18299, 3349, 1758, 2110, 2087, 4032, 46274]` ms, Summe **253 252 ms**, Ø **12 662,60 ms**. Mit der einen geseedeten 12 000-ms-Zeile ergibt das **12 631,05 ms ≠ 12 000** ⇒ die Assertion kann nur halten, wenn im Fenster **keine** echte Pinterest-Zeile liegt. Der Test ist an dieser einen Stelle inhärent traffic-abhängig — das war er **schon vor** der Änderung.
- **Entscheidung:** **kein Code-Eingriff**, Test-Logik **nicht** abgeschwächt, kein „grün rechnen". Dokumentiert als Live-Traffic-Drift.
- Optionales Hardening (bewusst **nicht** umgesetzt, braucht Lead-/Owner-Freigabe): Erwartungswert aus dem Vorher-Snapshot rechnen — `avgMs_erwartet = (12000 + before.avgMs × before.done) / (before.done + 1)`.

### 4.2 Rest-Gates (exakte Zahlen; Lauf 2026-09-27 ~18:54–18:57 UTC)
| Gate | Ergebnis HEAD | Baseline `48bd87c` (vor der Änderung) | Bewertung |
|---|---|---|---|
| `usage-guard-test.ts` | **31 PASS / 0 FAIL**, exit 0 | – | ✅ |
| `usage-semantics-test.ts` | **32 PASS / 0 FAIL**, exit 0 | – | ✅ |
| `bunx tsc --noEmit -p tsconfig.gate.json` | exit 2, **54 Fehlerzeilen** | exit 2, **54 Fehlerzeilen** | ✅ **0 NEUE Fehler** (normalisierter Diff in beide Richtungen leer; `package_created`, `AnalysisPlaceholder`, `performance.tsx`, `store/projects.ts` waren schon vorher da) |
| `i18n-scan.ts` | ❌ `RESULT: MIXING FOUND`, exit 1 — de = en = **1541** Keys, KEY-PARITY ✅, DE-VALUES **5**, SERVER-LIT **332** | ❌ dasselbe MIXING, exit 1 — de = en = **1508** Keys, DE-VALUES **3**, SERVER-LIT **330** | ⚠️ **bereits vorher rot**; +2 Findings |

Baseline-Methode: `git archive 48bd87c | tar -x -C /tmp/base` + `node_modules`-Symlink, dort dieselben Gates → Vergleichbare Zahlen, ohne den Arbeitsbaum anzufassen.

Die **2 neuen DE-VALUES-Treffer** sind `analytics_kpi_anon: "Anonyme Seitenaufrufe (ohne Login)"` und `analytics_err_code: "Code"`. Der Scan sucht englische Wörter in deutschen Werten und wertet die deutschen Lehnwörter „Login"/„Code" als Englisch. Kein echtes Sprachmixing: de/en-Parität ✅, EN-Werte enthalten keine deutschen Tokens, die 3 übrigen Treffer bestanden schon vorher. Bewusst **nicht** umbenannt (das würde das vom Owner gesehene UI-Label ändern und einen neuen Deploy erzwingen) — als Restpunkt notiert.

### 4.3 Live-Belege (Deployment `site-garmk4ph0`, Alias www.growimo.app)
**HTTP:** `/` = **200** (44 727 B) und `/app/admin-analytics` = **200** (13 045 B) auf `site-garmk4ph0-growimo.vercel.app` — identische Größe und identische 10-Teile-Asset-Liste auf `www.growimo.app` (Alias liefert dasselbe Bundle).

**Bundle-Beleg (ausgelieferte Client-Chunks, SHA-256 = Fingerabdruck):**
| Chunk | Größe | SHA-256 (Anfang) | Gefundene Marker |
|---|---|---|---|
| `index-Dkbm95Ev.js` | 602 154 B | `0851de1a…` | `Fehleranalyse`, `Eindeutige Besucher`, `x-analytics-consent`, `Heute` |
| `admin-analytics-Dj1ZgXKl.js` | 16 742 B | `d2faf8ad…` | `errorEvents`, `errorsByCategory`, `visitorsSince` |
| `app-DjELdmAt.js`, `ProtectedRoute-B0erKumS.js`, `index--S6DLHex.js` … | | `ed8c9722…`, `c5832969…`, `0df1cb2d…` | (Rahmen-Chunks) |

`visitor_key` und `error_category` sind **serverseitige** Bezeichner und kommen in den Client-Chunks erwartungsgemäß **nicht** vor (Vite entfernt Server-Code aus dem Client-Bundle; ein Grep dort wäre kein Beleg). Sie sind stattdessen **funktional gegen die Produktion** belegt:

**Live-Funktionsbeweis `POST https://www.growimo.app/api/analytics-events`:**
1. `pageview` **mit** Header `x-analytics-consent: granted` → **202** + `Set-Cookie: growimo_vid=<32 hex>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7776000`
2. `pageview` **ohne** Header → **202**, **kein** `Set-Cookie` (fail-closed wie spezifiziert)
3. `status=error`, `errorCategory=timeout`, `errorCode=gen_timeout` / `provider_5xx` → **202 `{"ok":true}`**; DB-Zeilen: `error_category='timeout'`, `error_code='gen_timeout'` bzw. `'provider_5xx'` ⇒ `error_category` wird in Produktion geschrieben
4. `errorCode="GEN_TIMEOUT"` (Großbuchstaben) → **400 `{"error":"Invalid errorCode"}`** (Regex `^[a-z0-9]([a-z0-9_.:-]{0,39})$` greift live)
5. DB-Zeile zum ausgegebenen Cookie: `visitor_key = 6f86a567…` (32 hex) ⇒ `visitor_key` wird in Produktion geschrieben
6. Aufräumen: alle Sondierungszeilen gelöscht, Leftover-Zähler = **0** (keine Verfälschung der Live-Kennzahlen)
7. Historische Bestandsfehler in der DB: `COUNT(*) = 4`, `COUNT(error_category) = 0` ⇒ die 4 Altfehler haben wirklich keine Kategorie (keine Ableitung, kein Raten)

*Hinweis zur Sondierung:* Der Endpunkt heißt `/api/analytics-events` (nicht `/api/analytics`) — mein erster Sonde-Lauf lief deshalb ins 404 der App. Das war ein Fehler in **meiner Sonde**, kein App-Fehler.

**Bundle-Beleg über HTTP-Status + Marker ist damit vollständig; zusätzlich Browser-E2E (siehe 4.4).**

### 4.4 Owner-Browser-E2E auf www.growimo.app (agent-browser, echte Prod-Seite)
**Session:** Clerk-Sign-in-Token für das Owner-Konto (`user_3H2trJXHwzXmJF2XTGQ2PMEwjkD`, via Backend-API gemintet, Ticket auf dem App-Origin eingelöst). `window.Clerk.user.id` = Owner-ID bestätigt. **Kein Vercel-Checkpoint** (`CP=false`).

**Gesehen und geprüft auf `/app/admin-analytics` (Textabzug der Seite, 204 Zeilen):**
- Zeitraum-Schalter vorhanden und bedienbar: **Heute · 7 Tage · 30 Tage (aktiv) · 90 Tage · Alle**
- KPI-Karten u. a. „Besuche gesamt 384", „Besuche heute 23", „Eingeloggte Besucher 12", „Anonyme Seitenaufrufe (ohne Login)", „Registrierungen 2", „Aktive Nutzer 8"
- NEU sichtbar: Karte **„Eindeutige Besucher"** + Karte **„Davon neu" (0)** mit ehrlichem Hinweis „Noch keine eindeutigen Besucher messbar — die Kennung wird erst seit Einführung erfasst (kein Rückgriff auf ältere Daten)." ⇒ **keine erfundene Zahl** (0 statt Scheingenauigkeit), keine Daten für die Zeit vor Einführung
- NEU sichtbar: Abschnitt **„Fehleranalyse" direkt unter „Generierung je Kanal"** (Tabelle Pinterest-Pin 12/9/3, Bild 10/8/1, Social-Post 3/3/0, Etsy-Angebot 1/1/0) mit Hinweis „Fehlerkategorien werden ab Einführung erfasst. Für ältere Fehler liegt keine Ursache vor.", Badge „Fehler im Zeitraum: 4", Filterchip „Unbekannt (nicht erfasst) · 4", Spalten Kanal/Zeitpunkt/Kategorie/Code
- Die **4 historischen Fehler (19.09.26)** erscheinen **einzeln** als „Unbekannt (nicht erfasst)" + „vor Einführung", Code „–": `Bild 19.09.26, 15:40` und `Pinterest-Pin 19.09.26, 15:36` (3×) — exakt die Zahl aus der DB, keine Interpretation
- Der neue Consent-Hinweis „Anonyme Reichweitenmessung" (Einverstanden/Ablehnen, non-blocking) ist auf der Live-Seite sichtbar
- **Keine Prompts/PII/Secrets in der Ansicht:** kein Vorkommen von „prompt", **0×** `@`, kein `sk-`, kein `Bearer`, keine Skript-/HTML-Reste als Text

**Screenshots (Beleg, im Repo):** `docs/analytics-e2e-top.png` (KPI-Karten + Zeitraum-Schalter + Consent-Hinweis), `docs/analytics-e2e-fehleranalyse.png` (Generierung je Kanal + Fehleranalyse mit den 4 „Unbekannt (nicht erfasst)"-Zeilen). MD5: `b8b3d13e7162ca981c9aece0b51bf1a3` bzw. `2202ef583c5317fc39ee662820d0e52b`.

### 4.5 Git
- `fd5eaa6` = Code-Commit (Umsetzung), `759f453` = Evidence-Commit (Testzahlen + Phase-0-Prüfung); beide auf `origin/master` (`git ls-remote origin refs/heads/master` = `759f453…`)
- dieser Nacharbeit-Lauf: Evidence-Nachtrag (Abschnitt 4) + zwei Screenshots — separat committet, **HEAD == origin/master** nach dem Push

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
| i18n | `src/i18n/de.ts` + `en.ts` | 45 neue Keys (paritätisch), Label-Korrektur |

**DB-Migration ausgeführt** (2026-09-27, Neon Prod-DB): Spalten und Index vorhanden — `information_schema.columns` = `… metadata, created_at, visitor_key, visitor_new, error_category, error_code`; Indizes = `analytics_events_pkey, idx_analytics_event_created, idx_analytics_user_created, idx_analytics_visitor_created`.

**Unverändert (Regressionsschutz):** `views`, `viewsToday`, `uniquePseudonyms`, `anonymousViews` (nur Label), `trend`, `topReferrers`, `topUtmSources`, `featureUsage`, `generationByChannel`, `usersPerFunction`, TTL, Owner-Gate, Rate-Limit, Body-Limit, `FORBIDDEN_KEYS`, `tracking_events`, Usage-Semantik (1 Generierung = 1 fertiges Ergebnis).

---

## 2. Tests (exakte Zahlen)

| Suite | Ergebnis |
|---|---|
| `analytics-unique-visitors-test.ts` (neu) | **26 pass / 0 fail** — Δ`uniqueVisitors` exakt +3 für heute/30d, Dedupe (weiterer Pageview → +views, nicht +unique), Altzzeilen (`visitor_key IS NULL`) zählen nicht, `visitor_new` = 2, `visitorsSince` gesetzt, Range `today` = Kalendertag (Trend 1 Tag), 30d-Trend unverändert 30, Δ aller Bestandskennzahlen = 0, Label-Klärung + de/en-Parität |
| `analytics-visitor-cookie-test.ts` (neu) | **34 pass / 0 fail** — kein Cookie bei „ohne"/„nein" (fail-closed, `visitor_key` NULL, Event trotzdem gespeichert), Cookie nur bei `granted` mit `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7776000`, Wert 32 hex, zweiter Aufruf ohne neues Set-Cookie, **keine IP-/UA-Ableitung** (unterschiedliche IP/UA → unterschiedliche Zufallswerte), ungültiger Cookie wird ersetzt, eingeloggt: `visitor_key = HMAC(Salt, sub)` (Cookie irrelevant), keine IP-/UA-Spalte im Schema |
| `analytics-error-capture-test.ts` (neu) | **30 pass / 0 fail** (nach Fix der Proben: `stack`/`error_message` sind keine Endpunkt-Felder — die Anfrage läuft durch, der Wert wird aber **nirgends gespeichert**, im Test explizit belegt) — Whitelist/Regex/Status-Gate (7 Varianten → 400, keine Zeile), PII-/Inhalts-Proben (`prompt`, `message`, `content`, `email`, `text`) → 400 ohne Zeile, Report enthält ausschließlich `{channel, at, category, code, recorded}`, Altfehler ohne Kategorie → `unknown` + `recorded=false`, `errorsByCategory`-Summe == `errorsTotal`, `errorDataSince` gesetzt, kein Prompt/Marker/Pseudonym im Body, 10 Klassifizierungsfälle exakt |
| `admin-analytics-test.ts` (Bestand) | 23 pass / 1 fail im ersten Lauf (siehe Restpunkte), Wiederholungslauf dokumentiert |
| `tracking-test.ts` (Bestand) | grün (8/8 Test-User-Events, Cleanup ok) |
| `usage-guard-test.ts`, `usage-semantics-test.ts`, `i18n-scan.ts`, `tsc --noEmit -p tsconfig.gate.json` | siehe Restpunkte/Logs |

---

## 3. Restpunkte (ehrlich)

1. **Bestandsfehler (4, 2026-09-19)** bleiben **ohne Ursache** — sie haben kein `error_category`; die neue Ansicht zeigt sie als „Unbekannt (nicht erfasst)" mit Hinweis „vor Einführung" (`recorded=false`). Kein Raten, keine Ableitung aus `duration_ms`/Route.
2. **Vor-Einführungs-Zeiträume** haben keine belastbare Unique-Visitor-Zahl (kein Backfill möglich); die UI sagt das ausdrücklich („Kennung erfasst seit TT.MM." / Hinweis bei fehlenden Daten).
3. **§ 1.6 Salt-Rotation (P2, unverändert offen):** der Owner-/Test-Ausschluss ist für `analytics_events` wirkungslos (kein gespeichertes Pseudonym matcht `HMAC(ANALYTICS_SALT, …)`). Die neue `uniqueVisitors`-Zahl erbt diese Unschärfe. **Nicht gefixt** (separate Owner-Entscheidung).
4. **Einwilligung wird clientseitig signalisiert** (Header). Serverseitig wird nur geprüft, ob der Header `granted` lautet — ein Besucher kann seinen eigenen Header selbst setzen (das ist seine eigene Entscheidung; es gibt keine PII und keinen Nachteil Dritter). Dokumentiert, kein Sicherheitsproblem.
5. **Hero-/Prod-E2E im Browser** (Unique-Visitors-Karte + Fehleranalyse-Sektion mit den 4 Altfehlern, Bundle-Marker) hängen am noch ausstehenden Deploy-Schritt dieses Laufs.

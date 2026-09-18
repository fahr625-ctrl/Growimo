# Stabilisierung Phase 3 — Bild-Studio & Workflow: Evidence

Owner-Vorgabe: dauerhaftes „Lädt…" beheben (Punkt 6) + TikTok-Werkstatt ↔ Bild-Studio ohne
Datenverlust (Punkt 7). Ursachen-Cluster C5, C6, C7 aus `/home/team/shared/stabilisierung-fixplan.md`.

## 1. Ursachen (belegt im Fix-Plan, Teil B)

- **C6 — Async-Pfade ohne Timeout/Fehlerpfad → hängende „Lädt…"-Gate-Zustände:**
  1. Beta-Gate `src/routes/app.tsx:43-65` (alt): `checkedEmailRef.current = email` wurde **vor** dem
     Fetch gesetzt (Alt-Zeile 47). Brach der Effekt-Lauf im Cleanup ab (Zeile 64), blieb `beta` auf
     `'checking'`, der zweite Lauf kehrte aber bei der Ref-Prüfung (Alt-Zeile 46) zurück → **Deadlock**
     im Vollbild-Spinner mit `common_loading` („Lädt..."), ohne Retry.
     Zweiter Pfad: `!email` bei `isSignedIn === true` → Effekt kehrt bei Alt-Zeile 44 zurück, `beta`
     bleibt für immer `'checking'`.
  2. `src/components/ProtectedRoute.tsx:44-63` (alt): `!isLoaded` → Vollbild-Spinner ohne Timeout,
     ohne Ausweg. Umschließt **jede** `/app`-Seite, also auch Bild-Studio und TikTok.
  3. `src/routes/app/image-studio.tsx:138-146` (alt): `setLoading(false)` nur im `finally`, kein
     `AbortSignal`, kein Client-Timeout, kein Abbruch-Button → settelt der ServerFn nie (hängender
     Request / abgerissene Mobilfunk-Verbindung / Cold-Start), bleibt die Skeleton-Karte mit
     „Generiere Bild… · Ns" **unbegrenzt** stehen.
- **C5 — Ergebnis lebt nur im React-State + Deep-Link ist Vollseiten-Sprung:**
  `src/routes/app/tiktok.tsx:471` (`useState<TikTokResult | null>`), gesetzt in `:633`; der
  Studio-Sprung war ein **Anchor** (`<a href={studioDeepLink(...)}>`, `:405-411`) → kompletter
  Dokumentwechsel (Beta-Gate + ProtectedRoute laufen neu, React-State weg).
- **C7 — Einmal-Prefill ohne Fallback:** `src/lib/strategy-image.ts` `consumeStrategyPrefill()`
  löschte den sessionStorage-Eintrag beim ersten Lesen; `image-studio.tsx:116-124` kehrte bei
  `fromStrategy=1` **vor** den `?prompt=`/`?idea=`-Zweigen zurück (`return;` `:122`) → nach
  Zurück/Reload/Forward leeres Promptfeld ohne Hinweis (`?prompt=` der TikTok-Bildidee wurde
  ignoriert).
- Zusatz: `getProjectsByUser(...)` im Studio wird jetzt mit `.catch` abgefangen (Analyse-Notiz;
  der Aufruf hatte in der Arbeitskopie bereits ein `.catch` — im Test abgesichert).
- Speicherlast: jedes 2:3-PNG liegt als ~2,0 MB Base64-Daten-URL im React-State und im DOM
  (`image-studio.tsx:144/169/217`) → unbegrenzt viele Karten erzeugen auf Android Speicherdruck.

## 2. Änderungen

Neu:
- `src/lib/image-safeguards.ts` — `guardImageRun` (Client-Timeout **120 s** + `AbortSignal` +
  „Abbrechen"), `ImageClientAbortError` (`reason: 'user' | 'timeout'`), `imageErrorTextKey()` für die
  ehrliche Fehlermeldung, `capGallery()` + `IMAGE_GALLERY_MAX = 8`.
  Bewusste Härtung gegenüber dem TikTok-Muster (`lib/tiktok-safeguards.ts`): die Guard **raced** den
  Lauf gegen das Abort-Signal — sie settelt auch dann, wenn der Aufrufer das Signal ignoriert oder
  ein Promise nie settelt (kein Zombie-Ladezustand möglich). Spätere Rejections des verlorenen Rennens
  werden verschluckt (keine unbehandelte Rejection).
- `src/lib/last-result.ts` — TikTok-Ergebnis-Persistenz in `sessionStorage`
  (`growimo_tiktok_last_result`, versioniert, TTL 12 h, modus-geprüft, defekte/alte Einträge → null).

Geändert:
- `src/routes/app/image-studio.tsx` — Hauptkarte **und** Karten-Aktionen (Variation/Neu generieren)
  laufen über `guardImageRun` (`generateImageServer({ data, signal })`); `loading` endet garantiert im
  `finally`; Fehlerbanner zeigt Timeout-/Abbruch-Text (mit dem bestehenden „Erneut versuchen") bzw.
  weiterhin die Servermeldung (Limit/Drossel/Sitzung); während des Ladens erscheint ein
  **„Abbrechen"**-Button; Prefill über die reine, getestete Funktion
  `resolveStudioPrefill(window.location.search, readStrategyPrefill())` (kein Early-Return mehr);
  Rückweg „← Zurück zur TikTok-Idee" bei Einstieg über `?prompt=`; Galerie über `capGallery` auf die
  **letzten 8** Bilder begrenzt + Hinweis-Banner ab dem 9. Bild (Speicherlast).
- `src/lib/strategy-image.ts` — `consumeStrategyPrefill` ist **nicht mehr zerstörend** (kein
  `removeItem` mehr), `savedAt` + TTL (24 h, Alt-Einträge ohne Feld bleiben gültig), Alias
  `readStrategyPrefill`, explizites `clearStrategyPrefill()`.
- `src/lib/studio-deeplink.ts` — neu `studioSearch()` (Search-Objekt für die SPA-Navigation) und
  `resolveStudioPrefill()` (reine Prefill-Auflösung mit Fallback-Kette
  `Strategie-Payload → ?prompt= → ?idea=`).
- `src/routes/app/tiktok.tsx` — Studio-Sprung ist jetzt ein **Router-`Link`** mit
  `search={studioSearch(img.studioPrompt)}` (SPA-Navigation, kein Dokumentwechsel → das Ergebnis
  bleibt im React-State); Ergebnis wird nach jedem Lauf via `saveTikTokResult(res.mode, res)` in den
  `sessionStorage` gespiegelt und beim Mount (`readTikTokResult()`) wiederhergestellt;
  „Neue Session" räumt die Persistenz (`clearTikTokResult()`).
- `src/routes/app.tsx` — Beta-Gate: `settle()` setzt den Endzustand nur aus `'checking'` heraus,
  verspätete Antworten überschreiben nichts; Ref-Deadlock entfernt; kein `checkedEmailRef` mehr;
  **Schonfrist 5 s** (`BETA_EMAIL_GRACE_MS`) wenn `isSignedIn` aber `email` noch leer ist →
  Fehlerzustand mit Retry; **Fetch-Timeout 10 s** (`BETA_ACCESS_TIMEOUT_MS`) → Fehlerzustand mit
  Retry (bestehender `retryAccessCheck`-Screen).
- `src/components/ProtectedRoute.tsx` — `!isLoaded` bekommt **Timeout 12 s**
  (`AUTH_LOAD_TIMEOUT_MS`): danach zusätzlich Hinweis-Karte (`data-testid="auth-load-timeout"`) mit
  „Seite neu laden" (`window.location.reload()`) statt Endlos-„Lädt...".
- `src/i18n/de.ts` + `src/i18n/en.ts` — additiv: `common_reload`, `gate_slow_title`, `gate_slow_text`,
  `image_studio_error_timeout` (%s), `image_studio_error_aborted`, `image_studio_abort`,
  `image_studio_back_to_tiktok`, `image_studio_gallery_cap_hint` (%s).

## 3. Verhalten Timeout / Retry / Fehlerbanner (Werte)

| Pfad | Wert | Verhalten |
|---|---|---|
| Bildgenerierung (Client-Guard) | **120 s** | Timeout → `AbortSignal` bricht den Request ab, Promise settelt mit `ImageClientAbortError('timeout')`, Banner „Zeitüberschreitung … %s Sekunden" + „Erneut versuchen" |
| „Abbrechen"-Button | sofort | `abort('user')` → Banner „Generierung abgebrochen. Du kannst sie erneut starten." + „Erneut versuchen" |
| Beta-Access-Fetch | **10 s** | → Gate-Zustand `'error'` (Screen „Zugriff konnte nicht geprüft werden" + „Erneut versuchen") |
| Beta-Gate ohne E-Mail | **5 s** Schonfrist | → `'error'` + Retry (kein Dauer-„checking") |
| Clerk-Bootstrap (`ProtectedRoute`) | **12 s** | Hinweis „Das dauert länger als erwartet" + „Seite neu laden" |
| Galerie | **8** Karten | älteste fallen heraus, ab dem 9. Bild Hinweis-Banner (Speicherlast Android) |

Retry-Verhalten: Retry ist immer ein **manueller** Klick (kein Auto-Retry) — bewusst, damit der Nutzer
die Kontrolle behält und die Zähl-Semantik transparent bleibt.

## 4. Persistenz-Mechanik (C5/C7)

- `sessionStorage['growimo_tiktok_last_result']` = `{ version: 1, mode, result, savedAt }`.
  Pro Tab/Session, TTL 12 h, Validierung: Version, bekannter Modus, Objekt mit `mode`,
  `savedAt` endlich → sonst `null` (kein Crash, leerer Startzustand).
  **Keine** DB-Persistenz, kein `ContentType`-Eingriff, keine Schema-Migration (bewusst KISS).
- Ergebnis-Lebensdauer im Flow: TikTok generieren → Klick auf „🎨 Bild-Studio" (SPA-Link, Ergebnis
  bleibt im State) → Bild erzeugen → „← Zurück zur TikTok-Idee" (SPA-Link; Ergebnis kommt zusätzlich
  aus dem sessionStorage) → nächste Bildidee anklicken (Studio wird mit neuem `?prompt=` neu
  gemountet) → nächstes Bild. Keine erneute TikTok-Generierung nötig; Reload/Zurück zeigen das
  Ergebnis ebenfalls.
- Strategie-Prefill: `sessionStorage['growimo_strategy_prefill']` bleibt nach dem Lesen erhalten
  (`savedAt` + 24 h TTL) → Zurück/Reload auf `/app/image-studio?fromStrategy=1` füllt weiter vor.

## 5. Zähl-Semantik (8.2, unverändert)

`1 Bild = 1 Generierung`, gezählt wird ausschließlich **erfolgreich** im
`withGenerationGuard` (`src/lib/usage-guard.ts`). Ein Timeout/Abbruch **vor** dem fertigen Bild
verbraucht keine Generierung. **Aber:** ein Retry nach Timeout startet einen **neuen** Generierungs-
versuch und zählt bei Erfolg als **eine weitere** Generierung — konsistent zum Owner-Preismodell
„1 fertiges Ergebnis = 1 Generierung". Retries nach einem bereits erfolgreichen Bild zählen ebenfalls
einzeln (Variation/Neu generieren = je 1). Keine Änderung an der Usage-/Billing-Kette in Phase 3.

## 6. Gates

- `stabilisierung-phase3-test.ts` (neu, Repo-Wurzel): **85 PASS, 0 FAIL, EXIT 0** — Guard-Timeout/
  Abbruch/Erfolg/Serverfehler, Fehlertext-Mapping, `capGallery`, `resolveStudioPrefill` (inkl.
  Fallback-Regression C7), nicht-zerstörender Strategie-Prefill + TTL, Ergebnis-Persistenz
  (Roundtrip/TTL/Version/Defekt/Modus), Quelltext-Checks der Fixes, i18n-Parität + neue Keys.
- `bunx tsc --noEmit`: Gesamtzahl **176** (gemeldete Baseline 162). In den von Phase 3 geänderten
  Dateien: **0 Fehler**; die einzige Meldung in einer berührten Datei ist der vorbestehende
  `TS6133 'body' is declared but never read` in `src/lib/strategy-image.ts` (unveränderter Code) —
  die 3 Typfehler, die meine ersten Fassungen einbrachten (`imageErrorTextKey` 'aborted'-Vergleich,
  `runGuardRef`-Generik), wurden vor dem Commit behoben. Restliche Abweichung zur Baseline liegt in
  unveränderten Fremddateien (u. a. `performance.tsx`, `ScoreCard.tsx`, `serve.ts`, Test-Dateien am
  Repo-Root) — nicht durch Phase 3 verursacht.
- Bestehende Suiten (Reprint): siehe Abschnitt 6a unten (Shell-Log `stabilisierung-phase3-suiten.txt`).
- `bash build-vercel.sh`: Ergebnis siehe Abschnitt 7 (Deployment).

## 6a. Suite-Läufe

Siehe `stabilisierung-phase3-suiten.txt` (Rohprotokoll der Läufe aller geforderten Suiten mit
EXIT-Code). Phase-3-relevant: `stabilisierung-phase3-test` EXIT 0 (85 PASS).

## 7. Deployment + Live-Check

**Deployment (Phase 3):** Build_EXIT=0 · Vercel-URL: https://site-3d8s594bh-growimo.vercel.app · Live-Check: www.growimo.app -> 200, /app/image-studio -> 200, /app/tiktok -> 200.

**Bundle-Beleg (Timeout-/Retry-/Abbruch-Strings im Prod-Bundle):** siehe Abschnitt 6a-Protokoll (Probe-Bundle-Check unten).

PROBE_BUNDLE

## 8. Offener Punkt (Owner-Entscheidung, NICHT in Phase 3 umgesetzt)

**DB-Persistenz / Historie der TikTok-Ergebnisse:** Phase 3 nutzt bewusst nur `sessionStorage`
(KISS, flüchtig pro Tab, keine erneute Generierung im beschriebenen Flow). Eine echte Historie
(„Ergebnisse wieder öffnen", auch nach Tabs-Wechsel/Gerätewechsel) braucht einen persistenten
Container: neue Tabelle bzw. `projects`/`generated_content`-Eintrag mit erweitertem `ContentType`
(aktuell kein TikTok-Wert in `src/ai/types.ts`) und einer Owner-Entscheidung über Aufbewahrung und
Kosten. Das ist eine Owner-Entscheidung, keine reine Engineering-Frage — hier nur als offener
Punkt notiert.

## 9. Randbedingungen geprüft

- Phase 1 (Markenprofil EIN/AUS, Nutzereingabe-Priorität) und Phase 2 (TikTok-Qualität) unverändert:
  Phase 3 fasst keine Prompt-/Prioritätslogik an; `tiktok.tsx` bekam nur Link + Persistenz, `ai/tiktok.ts`
  ist unberührt.
- Keine neue Abhängigkeit; i18n additiv in beiden Sprachen (Parität im Test geprüft).
- Usage-/Billing-Kette (8.2/8.3d/8.4) unverändert — nur lesend berührt.

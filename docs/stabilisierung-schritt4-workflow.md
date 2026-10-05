# Stabilisierung Schritt 4 (Punkt 6) — durchgängiger Workflow („Weiter mit …“ + Rückwege)
Datum: 2026-10-05 · Repo: `/home/team/shared/site` (master) · Basis: `3033178` · Stand: `f493ed3`
Commits: `0a45efd` (Kontext + NextActions + i18n + Tests) · `bfd63d8` (Inhaltsbibliothek + Projekt→TikTok) · `f493ed3` (Studio-Rückweg + TikTok-Vorauswahl)

## 1. Ursache (Analyse, bestätigt)
Der Kontext reiste in fünf feature-eigenen sessionStorage-Keys mit je eigenem Format; es gab keinen gemeinsamen Träger.
Fehlende „Weiter mit…“-Aktionen laut Analyse: (2) Studio → zurück ins Paket/Projekt (kein Rückweg) · (3) Inhaltsbibliothek (nur Auflisten/Kopieren) · (4) Projekt → TikTok (Baustein `tiktok-project-context.ts` existierte, aber kein Einstieg) · (6) kein zentrales Kontext-Objekt. (1) Paket-Kanal→Studio war seit Schritt 3 vorhanden.

## 2. Was umgesetzt ist (additiv, kein Umbau)
**NEU `src/lib/app-context.ts`** — versioniertes (`APP_CONTEXT_VERSION=1`), TTL-24 h, fail-closed Kontext-Objekt (`rememberContext`/`readContext`/`clearContext` + reine `sanitizeAppContext`/`mergeAppContext`/`serializeAppContext`/`parseAppContext`). Felder: `projectId`, `productIdea` (max. 280 Zeichen), `source` (nur bekannte Modulnamen), `brandEnabled` (`false` überlebt). Merge-Semantik: ein Schritt ergänzt, `undefined` löscht nichts.
*Mehrwert-Begründung (statt „optional“ weggelassen):* Punkt 2 (Projekt → TikTok) braucht einen Träger, der das Projekt an eine **bestehende** Route übergibt, ohne deren `validateSearch`/URL-Vertrag anzufassen — genau dafür ist der Baustein da. Die bestehenden Keys (`growimo_strategy_prefill`, `growimo_tiktok_last_result`, `growimo_beta_access_v1`, Galerie, `LAST_SAVED_PACKAGE_STORAGE_KEY`) sind **unverändert** und werden nicht ersetzt.

**NEU `src/components/NextActions.tsx`** — eine wiederverwendbare Aktionszeile mit „🎨 Bild erstellen“ (extrahierbarer Prompt nötig; Router-`navigate`, kein `window.location`), „🎵 TikTok-Konzept aus diesem Projekt“ und „📂 Im Projekt öffnen“. `enrichImagePayload()` füllt fehlende Felder (Projekt, Produktidee, Markenprofil) aus dem Projektbezug nach. Bewusst NICHT doppelt gebaut: „✓ Zum Projekt“/„Projekt ansehen“ (new-project/package), „🎨 Bild jetzt erstellen“ im Paket-Flow (`package-create-image`, Schritt 3), A/B-Varianten (`VariantPicker`), „⚡ Verbessern“ (`ScoreCard`) — die sitzen dort bereits.

| Stelle | Aktion (neu) | Datei |
|---|---|---|
| Inhaltsbibliothek, je Inhalt | „🎨 Bild erstellen“ + „📂 Im Projekt öffnen“ (`data-testid="library-next-actions"`) | `content-library.tsx` |
| Projekt-Detail (Kopf) | „🎵 TikTok-Konzept aus diesem Projekt“ (`data-testid="project-next-actions"`) | `projects/$projectId.tsx` |
| Bild-Studio (Kopf) | „← Zurück zum Paket“ / „← Zum Projekt“ (`studio-back-package` / `studio-back-project`), nur bei bekannter Herkunft | `image-studio.tsx` |
| TikTok-Werkstatt | übernimmt das Projekt aus dem Kontext (einmalig vorausgewählt) | `tiktok.tsx` |

**Kontext-Transport:** `strategy-image.ts` trägt jetzt optional `source` (Herkunft) im Prefill — Paket (`'package'`), Projekt (`'project'`), Strategie (`'strategy'`), Bibliothek (`'library'`); Lesen fail-closed (unbekannter Wert ⇒ `undefined`). Projekt-Prefill enthält erstmals Projekt-ID + Produktidee + Markenprofil (vorher nur Basisfelder, das war Lücke 3 aus Schritt 3).
**i18n de+en:** `next_actions_title`, `next_actions_context_hint`, `next_actions_tiktok`, `next_actions_open_project`, `image_studio_back_to_package`, `image_studio_back_to_project` — Parität ✅.

## 3. Gates (gemessen)
- **Neue Unit-Tests** `stabilisierung-schritt4-test.ts`: **50 PASS / 0 FAIL** (Version, TTL 24 h/25 h, defektes JSON, falsche Version, fehlendes `savedAt`, Merge, `brandEnabled:false`, unbekannte Quelle, Idee-Kappung, Prefill-Herkunft, `enrichImagePayload`, i18n-Parität).
- **Bestandssuiten grün:** `package-autosave-test` **41/0** · `package-fakten-schutz-test` **118/0** · `stabilisierung-schritt3-test` **46 PASS, 0 FAIL — RESULT: ALL PASS** · `varianten-scoring-konsistenz-test` **88 Checks / 0 failed**.
- **tsc (`tsconfig.gate.json`), HEAD vs. Baseline `3033178` (identischer Lauf, Skill `gate-baseline-vergleich`):** BASE 55 Fehler, HEAD 53. **0 neue Fehler** — der einzige „neue“ Eintrag ist die um 6 Zeilen verschobene, wortgleiche Bestandsfehlermeldung `src/lib/strategy-image.ts TS6133 'body' unused` (145 → 151). Die zwei „verschwundenen“ Fehler sind `serve.ts`/`vercel-entry.ts` TS2307 (`./dist/server/server.js`), die nach dem lokalen Build vorhanden sind.
- **i18n-Scan:** `✅ KEY-PARITY: de.ts and en.ts have identical key sets`. Die gemeldeten ❌ (`USED-KEYS: tiktok_result_`, `DE-VALUES: 5`) sind **unverändert vorbestehend** (auch in der Schritt-3-Evidence so benannt) — keine neuen Fundstellen.
- **Build:** `bash build-vercel.sh` → `BUILD_EXIT=0`, `.vercel/output` bereit (Server-Bundle 4.610.083 Bytes).

## 4. Deploy-Beleg
- Deploy: **`dpl_CdPp7VEvurRDryytbNTzTu3x3pec`** · URL `https://site-q8be2l828-growimo.vercel.app` · `target production` · `status Ready` · `▲ Aliased https://www.growimo.app` · `DEPLOY_EXIT=0` (erster Versuch, kein Retry nötig; created 2026-10-05 05:04 UTC).
- **URL-Status:** `/` , `/app/content-library`, `/app/image-studio`, `/app/tiktok`, `/app/package`, `/app/projects/<uuid>` → jeweils **HTTP 200** auf `www.growimo.app`.
- **Live-Chunks ↔ lokaler Prebuilt: 29/29 byte-identisch** (`cmp`, alle aus `www.growimo.app` geladenen Chunks gegen `.vercel/output/static/assets/`) ⇒ die Auslieferung ist genau dieser Build.
- **Bundle-Marker (neue, eindeutige Strings — Client-Chunks von `www.growimo.app`):**
  | Marker | Fundstelle |
  |---|---|
  | `growimo_app_context` (neuer Storage-Key) | `app-context-aOy5Xac5.js` |
  | `library-next-actions` | `content-library-BgB40AfI.js` |
  | `project-next-actions` (Offset 9847) + `source:"project"` (10740) | `_projectId-BTU33hH8.js` |
  | `studio-back-package`, `studio-back-project` | `image-studio-BMgoCwLM.js` |
  | `TikTok-Konzept aus diesem Projekt`, `Zurück zum Paket`, `Back to the package`, `TikTok concept from this project` | `index-C3U_AdQd.js` |
  | zusätzlich `NextActions-BLsYNqvl.js` + `app-context-aOy5Xac5.js` als eigene Chunks in der SSR-HTML referenziert | `*.html` von `www.growimo.app` |
- **Server-Bundle** `.vercel/output/functions/render.func/index.mjs` (4.610.083 B, SHA-256 `896b14b5816d4c33988cf8ce4c5838a1038cfab2ec88ffa42837bded8ba3daaa`) trägt: `growimo_app_context` @3550483 · `library-next-actions` @4023431 · `project-next-actions` @4192330 · `studio-back-package` @3972498 · `TikTok-Konzept aus diesem Projekt` @2295668 · `Zurück zum Paket` @2295809.
- **Abgrenzung:** Die i18n-Werte und die `data-testid`s existierten vor diesem Commit nicht (`git show 3033178:src/i18n/de.ts` enthält keinen der sechs Keys). Die dynamisch gebauten Test-IDs `next-actions-image`/`next-actions-tiktok` sind Template-Strings und stehen deshalb **nicht** als Literal im Bundle — belegt sind stattdessen die beiden übergeordneten Test-IDs.

## 5. Ehrliche Restlücken
1. **Klick-Verifikation im Browser fehlt in dieser Session** — Belege sind Bundle-Marker, Unit-Tests und Gates, kein interaktiver Durchlauf. Der verpflichtende Mobile-E2E (letzter Paket-Schritt) muss die Aktionen real durchklicken (Bibliothek → Bild-Studio → „← Zum Projekt“, Projekt → TikTok-Vorauswahl).
2. **„← Zurück zum Paket“ stellt kein Paket-Ergebnis wieder her.** `/app/package` kennt nur den Entwurf (`growimo_package_draft`, localStorage) — der Nutzer landet auf der Formularseite mit vorausgefüllter Produktidee, die 5 Kanäle sind weg. Ehrlich: der Rückweg führt zum Modul, nicht zum Ergebnis. Ein Paket-Ergebnis-Restore wäre ein eigener Schritt.
3. **TikTok-Vorauswahl greift nur für Projekte, die ladbar sind.** Ist das Kontext-Projekt nicht unter den „letzten 5“, wird es einmalig nachgeladen; schlägt das fehl, verhält sich der Flow wie bisher (kein Fehler, nur keine Vorauswahl), und der Kontext bleibt bis TTL 24 h gesetzt (bewusst nicht konsumiert/geleert).
4. **`marketing_plan` liefert weiterhin keinen Bildprompt** → in der Bibliothek erscheint dort kein „🎨 Bild erstellen“ (nur wo ein Prompt-Abschnitt existiert). Unverändert aus Schritt 3.
5. **Varianten/Verbessern wurden NICHT in `NextActions` dupliziert** (bewusst): in Projekt-Detail/Paket sind `VariantPicker`/`ScoreCard` inline vorhanden; in der Inhaltsbibliothek erreicht man „Verbessern“ weiterhin nur über das Score-Badge (ein Klick mehr). Wenn der Owner dort einen sichtbaren Button will, ist das ein eigener kleiner Schritt.
6. **Keine Live-KI-Läufe in dieser Session** (OpenAI-Guthaben unverändert 429) — betrifft Schritt 4 nicht, da alle neuen Aktionen vor der Generierung greifen und 0 Generierungen verbrauchen (reine Navigation/Storage).

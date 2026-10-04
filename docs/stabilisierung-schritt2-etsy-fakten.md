# Stabilisierungspaket Schritt 2, Punkt 4 — KEINE erfundenen Etsy-Produktinformationen

Owner-Vorgabe (wörtlich, 2026-10-02): „Solche Angaben dürfen nicht erfunden werden. Produktfakten
müssen aus Nutzereingaben, gespeicherten Projekt-/Produktdaten oder eindeutig vorhandenen Quellen
stammen. Fehlen notwendige Informationen, soll Growimo entweder gezielt nachfragen oder die Aussage
weglassen. Bitte diese Regel nicht nur über einen Prompt lösen, sondern soweit möglich auch durch
Daten-/Validierungslogik absichern."

Gemeldete Erfindungen ohne Nutzereingabe: **„300 ml"**, **„spülmaschinenfest"**, **„einseitiges Motiv"**,
**„Versand in 3–5 Tagen"**, **„persönliche Verpackung"**.

## Ursache (Analyse)

1. Der Post-Check `src/ai/fact-guard.ts` hatte 5 Muster-Kategorien (Anekdoten, Lieferzeit/Versand/
   Rückgabe, Preis/Zertifikate, Trend, Fremd-Slugs) — aber **keine Kategorie für Produktmaße,
   Mengen, Motiv-/Druckseiten und Lieferumfang/Verpackung**. „300 ml", „einseitig", „persönliche
   Verpackung" wurden also gar nicht geprüft.
2. Das Grounding lief als **Keyword-Treffer über den Gesamtblob** (`pattern.grounding.test(blob)`):
   „USP=Schnelle Lieferung" im F6-Brief traf `/liefer|versand|…/` und **entwaffnete die ganze
   Kategorie** — auch die erfundene Zusage „Versand in 3–5 Tagen". Dasselbe galt für eine
   Preisspanne („Preis=20–60 €") gegenüber einem konkreten Preis im Output.
3. `enforceFacts` war **nur im Paket-Batch gesetzt**; der von der UI genutzte progressive Pfad
   `generatePackageChannelServer` → `generatePackageChannelWithContext`, die Einzelkanal-/Stream-
   und Verbessern-Pfade liefen **ohne Post-Check**. Zusätzlich landeten die maschinen-generierten
   Kontexte F9 (Performance) und F10 (Lernprofil) im Grounding und konnten Fakten „belegen".
4. Der Etsy-System-Prompt **forderte** Erfindungen ein („Alle Produktdetails präzise und vollständig:
   Maße, Materialien, …, Gewicht, Varianten", FAQ-Pflicht zu Pflege/Größe/Lieferung).

## Änderungen (Datei:Zeile)

| Datei | Änderung |
| --- | --- |
| `src/ai/fact-guard.ts` | **Kategorie (f)** `produktmass-einheit` (Zahlen+Einheiten ml/cl/l/g/kg/cm/mm/m/Zoll/Stück/Packung/%), `motivseite` (ein-/beidseitig, „printed on one side"), `verpackungs-zusage` („persönliche Verpackung", Geschenkverpackung, gift wrap), `lieferumfang` |
| `src/ai/fact-guard.ts` (`MEASURE_RE`/`DURATION_VALUE_RE`/`PRICE_VALUE_RE`) | Wert-Extraktion: jede Behauptung wird auf ihren **konkreten Wert** reduziert und zahl-normalisiert (`300 ml` → `300\|ml`) gegen die Nutzerdaten geprüft |
| `src/ai/fact-guard.ts` (`PATTERN_VERIFICATION`) | **Grounding-Verengung**: `valueRe` statt Keyword-Grounding für Lieferzeit/„in X Tagen"/Versand/Preis/Bearbeitungszeit; `claimLiteral` (wörtlicher/stammweiser Beleg) für Zertifikate, Garantie, Materialversprechen, Motivseite, Verpackung |
| `src/ai/fact-guard.ts` (`isGrounded`) | alle vorhandenen Mechanismen müssen bestehen; `grounding` für die alten Kategorien bleibt nur, wo kein Wertbegriff existiert (Anekdote/Trend/Slug) |
| `src/ai/fact-guard.ts` (`quantityViolations`) | **Mengen-Prüfung** analog Slug-literal: ungedeckte Zahl+Einheit wird als Wert zurückgegeben |
| `src/ai/fact-guard.ts` (`buildFactGrounding`/`stripGeneratedBlocks`) | Grounding = Nutzerangaben + `declaredFacts`; Strategie-Kern, F9 (📈) und F10 (🧠) werden herausgeschnitten; neues `factGroundingStrict` nutzt **ausschließlich** Nutzerangaben |
| `src/ai/fact-guard.ts` (`FACT_PROTECTION_CONSTRAINT`, `FACT_GUARD_ERROR`, `factGuardCorrection`) | Prompt-Regel um Produktmaße/Mengen/Motivseiten/Verpackung erweitert, Negativ-Beispiele neutralisiert („keine Maß- oder Lieferzeitangaben ohne Nutzerbeleg") |
| `src/ai/types.ts` | `declaredFacts?: DeclaredFacts` (size/material/price/shipping/special/extra) + `factGroundingStrict?: boolean` |
| `src/ai/generate.ts` | Check nutzt `request.declaredFacts` in Erstprüfung, Retry und Satz-Eliminierung (1 Korrektur → Eliminierung → Hard-Error unverändert) |
| `src/ai/server.ts` | `sanitizeDeclaredFacts()`; `generateContentServer` setzt `enforceFacts` **serverseitig** für die 5 Kanäle; `improveContentServer` setzt `enforceFacts` + `factGroundingStrict` (alter Content ist kein Beleg); `generatePackageChannelServer` nimmt Nutzer-Grounding an |
| `src/ai/stream.ts` | Stream-Runner setzt `enforceFacts` für die 5 Kanäle (Strategie-/Projekt-Flow) |
| `src/ai/package/package.ts` | `PreparedPackage.grounding` (nur Nutzerangaben), `generatePackageChannelWithContext(..., grounding)` mit `factGroundingStrict` |
| `src/ai/package/generate.ts` | Batch-Kanal ebenfalls `factGroundingStrict` |
| `src/api/generate-stream.ts` | reicht `declaredFacts` defensiv validiert durch |
| `src/routes/app/new-project.tsx` | Produktdetails zusätzlich als `declaredFacts` (Größe/Material/Preis/Versand/Besonderheiten) |
| `src/routes/app/package.tsx` | sendet `grounding: prep.grounding` an den Kanal-ServerFn |
| `src/ai/providers/openai.ts` | Prompt-Umkehr: Produktdetails „AUSSCHLIESSLICH aus den Nutzerangaben … sonst ‚Auf Anfrage' oder weglassen"; Materialien „sonst ‚Nicht zutreffend'"; FAQ nur mit belegten Antworten; CTA ohne Verpackungs-/Personalisierungszusage |

## Gates (nachvollziehbar)

- **`bun package-fakten-schutz-test.ts` → 118 PASS, 0 FAIL** (Baseline vor Schritt 2: 66 PASS, 0 FAIL;
  die 66 Alt-Checks sind unverändert grün). Neu u. a.:
  - G1/G1b/G1c: die 5 gemeldeten Erfindungen werden **de und en** erkannt (einzeln + als Etsy-FAQ-Block).
  - G2/G2b/G2c: Gegenproben — nennt der Nutzer die Angaben wörtlich, sind es **0 Verstöße**.
  - G3: „USP=Schnelle Lieferung" entwaffnet „Versand in 3–5 Tagen" **nicht**; Preisspanne 20–60 €
    belegt keinen konkreten Preis (29 €), der genannte Preis schon.
  - G4: 300 ml gegen Nutzerangabe 500 ml = Verstoß; 500 ml/500 ml = konform; `quantityViolations`
    liefert den ungedeckten Wert; „10 Stück" ohne Beleg = Verstoß.
  - G5: `declaredFacts` belegen Maße/Material/Versand, aber keine anderen Werte (400 ml bleibt Verstoß).
  - G6: Strategie-Kern, F9-Performance und F10-Lernprofil sind **nicht** im Grounding.
  - G7: Statik-Belege, dass Einzelkanal (ServerFn), Stream, Verbessern, Paket (Batch + progressiv),
    UI (Projekt-/Paket-Flow) und SSE-Route den Check setzen bzw. Nutzerangaben durchreichen.
  - G8: Prompt-Umkehr + globale Regel ohne konkrete Negativ-Beispiele.
  - G10: erfundenes „300 ml" löst genau **einen** Korrekturversuch aus (Kette unverändert hart).
- **i18n**: keine neuen UI-Strings (nur Server-/Prompt-Texte) → Parität de/en bleibt grün
  (F1/F2 der Suite: gleiche Schlüsselanzahl, keine fehlenden Schlüssel).
- Baseline-Vergleich `bunx tsc --noEmit` (Arbeitsbaum HEAD vs. Worktree `be91507`) wurde angestoßen;
  Ergebnis siehe Restlücken (Terminal-Budget der Session).

## Deploy

**NICHT ausgeführt** — die Session endete vor dem Vercel-Build (Restlücken unten). Der Stand ist
committet und gepusht:
`f08e082` (Schritt 2 Teil 1: Kategorie f, Grounding-Verengung, Mengen-Prüfung, declaredFacts)
→ `6c0adbd` (Teil 2: enforceFacts in allen Kanal-Pfaden, strict Grounding, Prompt-Umkehr, UI-Wiring)
→ `b340b36` (Test-Suite 118/0).

## Ehrliche Restlücken

1. **Deploy + Server-Bundle-Marker fehlen** (Session-Budget). Nächster Schritt:
   `bash build-vercel.sh && bunx vercel deploy --prebuilt --prod --yes`, danach
   `www.growimo.app` 200 prüfen und einen eindeutigen neuen String (z. B.
   `keine Verpackungs-/Personalisierungszusage` oder `invented product measurement/quantity`)
   im Server-Bundle greppen (Skill `prod-bundle-marker-proof`).
2. **Kein Live-E2E-Lauf** (OpenAI-Kontingent/Zeit): Der Beleg ist deterministisch (118/0) plus
   Statik-Belege der Verdrahtung. Ein Live-Lauf über Skill `growimo-package-autosave-e2e` sollte die
   Etsy-Karte auf „300 ml"/„einseitig"/„persönliche Verpackung" grep-prüfen (Skill
   `growimo-fakten-grep-live-run-audit`).
3. **Scope-Entscheidung (bewusst):** `enforceFacts` gilt serverseitig für die **5 publizierbaren
   Kanäle**. Nicht-Kanal-Typen (`marketing_analysis`, `market_intelligence`, Strategie-Hilfstexte)
   bleiben wie bisher, weil deren Texte legitime Zahlen/Beispiele enthalten und ein harter
   Post-Check dort bestehende Ausgaben verschlechtern würde. Wenn der Owner auch dort Fakten-Schutz
   will, ist das ein separater Schritt (Analyse-Prompt zieht generierte Inhalte in die Produktidee —
   die müssten dann als „kein Beleg" markiert werden).
4. **Verpackungs-Zusage mit bloßem Themenwort:** `lieferumfang` nutzt weiter ein Themen-Grounding
   („Lieferumfang/Verpackung" genannt = belegt). Die spezifische Zusage „persönliche Verpackung"
   verlangt dagegen den wörtlichen/stammweisen Beleg (`verpackungs-zusage.claimLiteral`).
   Denkbare Nachschärfung: gemeinsame `neverClaim`-Liste des Markenprofils als harte Sperrliste.
5. **Stammform-Heuristik** (`claimStem`) ist bewusst tolerant (Flexion „persönliche/persönlicher").
   Sie ist konservativ (nur Suffixe, nie Wortanfänge), kann aber bei sehr kurzen englischen Wörtern
   („free") großzügig sein — beobachtet, nicht als Fehler relevant.
6. **Baseline-`tsc`-Zahlen** müssen aus `bunx tsc --noEmit` (HEAD) vs. Worktree `be91507` noch in
   diese Datei nachgetragen werden (peinlich ehrlich: Der Lauf lief, als die Session endete).

## Nachtrag Gates (Session-Ende)

- **`bunx tsc --noEmit` (HEAD mit Schritt 2): 194 `error TS`.** Kein Fehler in
  `src/ai/fact-guard.ts`, `src/ai/generate.ts`, `src/ai/stream.ts`, `src/ai/types.ts`,
  `src/ai/package/*`, `src/api/generate-stream.ts`.
  In `src/ai/server.ts` stehen 7 Fehler desselben Typs
  (`TS2345 … is not assignable to parameter of type 'ServerFn<…>'`, TanStack-ServerFn-Generik):
  Zeilen 105, 141, 220, 282, 351, 823, 922 — davon **4 in unveränderten Funktionen**
  (improveByScore 220, improveToScore 282, autoImproveSection 351, fetchPackageKernel 823).
  Es ist also der vorbestehende Befund der ServerFn-Generik (Baseline-Vorgabe der Lead), nicht
  ein neuer Fehlerpfad; die Baseline-Zählung im Worktree `be91507` konnte nicht mehr abgeschlossen
  werden (Session-Ende) — **nachzutragen**.
  Weitere Befunde in berührten UI-Dateien sind ebenfalls vorbestehend und unabhängig:
  `new-project.tsx(13,29) TS6133 'AnalysisPlaceholder' unused`, `package.tsx(402) 'package_created'`.
- Übrige Suiten (Lauf zum Session-Ende): `f5` grün, `f8` grün, `f9` grün; `f6` und `f7` exit=1 mit
  **API-/JSON-Fehler** (`generateVariants returned null`) — Umgebungsbefund (kein nutzbarer
  OpenAI-Key in der Shell), nicht durch diesen Schritt verursacht; `f10`/`f2-1`/`brand-profile`/
  `guard-metric`/`improve-deadzone`/`package-autosave`/`stabilisierung-phase3|4|41|43` waren beim
  Session-Ende noch nicht durchgelaufen (`/tmp/gates.txt`).

---

## Deploy + Live-Verifikation (2026-10-04, Nachzug zum Session-Ende 387ad0f)

**Beleg-Stand:** `b4d1733` (HEAD = origin/master).

### 1. Deploy

- Build: `bash build-vercel.sh` → `BUILD_OK`
  - Server-Funktion `.vercel/output/functions/render.func/index.mjs`: **4.581.792 Bytes**,
    SHA-256 `83c6724f04f16b08a71e06d3d4fc218dd9b9f039ac392368f5fc4ae3300d3e15`
- Deploy: `bunx vercel deploy --prebuilt --prod --yes` — **Erfolg im 1. Versuch**
  (kein „Not authorized"; die Retry-Schleife lief nicht an).
- Deployment: **`dpl_E75Q2g4Gen6aZBEYQyyxaVcXRtk8`** · Projekt `site` · target `production` ·
  status `● Ready` · URL `https://site-2sc6h4bqd-growimo.vercel.app` ·
  Alias `https://www.growimo.app` · created 2026-10-04 18:37:24 UTC.
- URL-Status (`curl -o /dev/null -w '%{http_code} %{size_download}'`):

| URL | HTTP | Bytes |
| --- | --- | --- |
| `https://www.growimo.app/` | 200 | 44.727 |
| `https://www.growimo.app/app/package` | 200 | 14.188 |
| `https://site-2sc6h4bqd-growimo.vercel.app/` | 200 | 44.727 |

### 2. Bundle-Beleg (b4d1733 ist wirklich live)

**Server-Bundle** (lokal, aus genau dem Lauf, dessen `.vercel/output` hochgeladen wurde;
HTTP-Abruf ist nicht möglich — deshalb Datei + Hash + Byte-Offsets, Skill `prod-bundle-marker-proof`):

| Marker (neu in Schritt 2) | Fundstelle(n) im Server-Bundle (Byte-Offset) |
| --- | --- |
| `AUSSCHLIESSLICH aus den Nutzerangaben` | 2.070.223 · 4.399.441 |
| `invented product measurement/quantity (number + unit)` | 2.058.669 · 4.376.157 |
| `erfundener Lieferumfang/Verpackungsangabe` | 2.059.063 · 4.376.551 |
| `300 ml` (Negativ-Beispiel im Prompt-Text) | 2.070.595 · 4.399.813 |

**Abgrenzung zum Baseline-Commit** (die Strings sind neu, nicht im Vorgängerstand):

```
git show be91507:src/ai/providers/openai.ts | grep -c "AUSSCHLIESSLICH aus den Nutzerangaben"  → 0
git show be91507:src/ai/fact-guard.ts       | grep -c "invented product measurement"          → 0
```

**Byte-Identität Live ↔ lokaler Build-Output** (Beweis, dass der hochgeladene Build der ist, dessen
Server-Funktion die Marker trägt): 20 JS-Chunks aus `/` und `/app/package` von `www.growimo.app`
geladen und gegen `.vercel/output/static/assets/` ge-SHA-256-t:

```
assets=20  identical=20  mismatched_or_missing=0
index-CekKyrpN.js   e7b6848068343f717e24213c1b7bcc30afdf38e6f5612c20d6bb8563e721cc6e  (live = lokal)
package-Dr6JDncm.js b0ae6acb04ff1e58b208b86cb0df07a3d85adbc0139c9a79a42980bd966dec59  (live = lokal)
index-DvA7B1j-.js   21dfe653be9e7385aafd59a380c515efe0018bf6bb8818d86e1ba1e79b8d6a6a  (live = lokal)
```

⇒ Client-Chunks live byte-identisch zum lokalen Prebuilt; dieses Prebuilt entstand in **einem**
`build-vercel.sh`-Lauf mit der Server-Funktion, die die vier Marker enthält.

### 3. Gates (nachgemessen 2026-10-04)

- **`bun package-fakten-schutz-test.ts` → 118 PASS, 0 FAIL, exit 0** (Abschlusslauf, identisch zur
  Erstmessung in `b340b36`).
- **`bun i18n-scan.ts` (HEAD):** `de = 1555 / en = 1555` Schlüssel, **✅ KEY-PARITY identische
  Schlüsselmengen**; ✅ keine hartkodierten EN-UI-Strings; ✅ keine deutschen Token in EN-Werten.
  Unverändert bestehende Befunde (Vergleich mit demselben Scan auf `be91507`, `/tmp/basewt`):
  ❌ `USED-KEYS FAIL — tiktok_result_`, ❌ 5 DE-Werte mit englischem Wort
  (`brand_website: „Website"`, `usage_limit_exhausted: „Free-Plan"`, `analytics_err_code: „Code"`,
  `analytics_kpi_anon: „ohne Login"`, `tiktok_result_scroll_stop: „Scroll-Stop-Moment"`).
  Server-LIT: 356 (Baseline) → 359 (HEAD); die Differenz sind ausschließlich die **neuen
  Server-/Prompt-Texte** aus `ai/providers/openai.ts` und `ai/fact-guard.ts` (nie gerendert,
  dev-facing). Schritt 2 hat **keine** neuen UI-Strings und **keinen** neuen i18n-Befund erzeugt.
- **`bunx tsc --noEmit`:** HEAD (b4d1733) **194 `error TS` in 46 Dateien**;
  Baseline `be91507` (Git-Worktree `/tmp/basewt`, `node_modules` per Symlink) **176 `error TS` in 39
  Dateien**. Aufschlüsselung der Differenz von +18:
  - **22 Fehler stammen aus 8 untracked Ad-hoc-Skripten**, die nur im Arbeitsbaum liegen und im
    Baseline-Checkout nicht existieren: `scripts/mint-session-file.ts` (6),
    `scripts/mint-ticket-file.ts` (6), `scripts/e2e-cleanup.ts` (3),
    `scripts/_repro-detail.tmp.tsx` (2), `scripts/_wh-e2e/idem-probe.ts` (2),
    `scripts/_mini-studio.tmp.tsx` (1), `scripts/_wh-e2e/audit.ts` (1), `scripts/e2e-setup.ts` (1).
    Sie sind **nicht getrackt** (nicht Teil von b4d1733) und nicht im Deploy.
  - **Keine NEUE getrackte Fehlerdatei.** Alle getrackten Deltas sind **Verbesserungen**:
    `serve.ts` 9 → 8, `stripe83-local-server.ts` 5 → 4, `transport-regression-test.ts` 6 → 5,
    `vercel-entry.ts` 1 → 0. `src/ai/server.ts` unverändert **7 → 7** (ServerFn-Generik, vorbestehend).
  - **Alle 13 von Schritt 2 berührten Dateien sind fehlerfrei bzw. unverändert:**
    `fact-guard.ts`, `generate.ts`, `stream.ts`, `types.ts`, `package/package.ts`,
    `package/generate.ts`, `providers/openai.ts`, `api/generate-stream.ts`,
    `routes/app/new-project.tsx`, `routes/app/package.tsx` — **0 Fehler** in beiden Ständen
    (nur `server.ts` mit den vorbestehenden 7).
- **`f5-test.ts` → exit 0** („ALL F5 CHECKS PASSED"). **`f8-test.ts` → exit 0**
  („✅ F8 alle Prüfungen bestanden", inkl. `publish_plan`-Persistenz). **`f9-test.ts` → siehe
  Suite-Log unten.**
- **`f6-test.ts` / `f7-test.ts`: NICHT gefahren** — sie brauchen einen echten OpenAI-Key in der
  Shell; in dieser Umgebung ist `OPENAI_API_KEY` ein maskierter Platzhalter (Vorgänger-Session:
  `generateVariants returned null`). Das ist ein Umgebungs-/Kontingentbefund, kein Schritt-2-Befund.

### 4. Live-E2E auf www.growimo.app (2026-10-04, 5 Kanäle, synthetischer Nutzer)

**Warum möglich:** Der Server-Pfad in Production nutzt den OpenAI-Key aus den Vercel-Env-Variablen
(nicht die Shell). Der Lauf war daher trotz des maskierten Shell-Keys durchführbar.

- Synthetischer Clerk-Nutzer `user_3KF2gCuO5FL7ZGgpckXwGNJiG6A` (Beta freigeschaltet über die
  öffentliche `POST /api/beta-signup`), Login per Sign-in-Token am App-Origin (`cp:false`,
  `signedIn:true`).
- Eingabe (bewusst **ohne** Maße/Material-Angaben, damit Erfindungen überhaupt möglich wären):
  „Handbemalte Keramiktasse mit Wunschname als personalisiertes Geschenk" über
  `/app/package?idea=…`, Klick auf „Paket generieren".
- Laufzeit: Klick 18:39:19 UTC → „✅ Automatisch gespeichert" (`package-autosave-hint`)
  um **18:40:05 UTC**, also ~46 s für alle 5 Kanäle inkl. Auto-Save.

**DB-Zähler (`scripts/_autosave-e2e-count.ts`, echte Neon-Datenbank):**

| Label | projectRows | contentRows | usage_monthly |
| --- | --- | --- | --- |
| baseline (vor dem Lauf) | 0 | 0 | `[]` |
| after_run | **1** (`176085bf-4a8d-4b1c-a7d1-79006a3ed6b9`) | **5** | **`[{period:"2026-10", count:5}]`** |

**Fakten-Grep in den 5 generierten Kanälen** (`scripts/_etsy-fakten-grep.ts`, read-only über die
generierten Inhalte der DB):

```
rows: 5   totalHits: 0
pinterest_pin    „Der Trick für ein Lächeln am Morgen: Deine personalisierte Tasse"   0 Treffer
etsy_listing     „Personalisierte Tasse | Geschenk mit Namen | Handbemalte Keramik …" 0 Treffer
seo_blog         „(H1)"                                                               0 Treffer
social_post      „… Unvergessliche Momente aus Keramik"                               0 Treffer
email_newsletter „Betreffzeile 1 (Neugier):"                                          0 Treffer
```

Geprüfte Muster: `\d+ (ml|cl|l|g|kg|cm|mm|Zoll|Stück|Packung)`, `ein-/beidseitig|one-sided`,
`persönliche Verpackung|Geschenkverpackung|gift wrap`, `spülmaschinenfest|dishwasher-safe`,
`3–5 Werktage/Tage/days`. **Keines der fünf vom Owner gemeldeten Muster tritt in irgendeinem Kanal
auf.**

**Positiv-Beleg im Etsy-Listing (die neue Prompt-Regel greift sichtbar):**

- Produktdetails: „Details zur Größe und weiteren Varianten **auf Anfrage**." (keine erfundenen Maße)
- Pflege-FAQ: „Die **Pflegehinweise und Reinigungsempfehlungen findest du direkt im Shop**. Bei
  handbemalten Produkten empfehlen wir generell eine sanfte Handwäsche…" → die Frage nennt zwar die
  „Spülmaschine", es wird aber **keine** Eignung behauptet (kein „spülmaschinenfest").
- Verpackung: „Die **Verpackungsoptionen werden bei der Bestellung angezeigt**." (keine erfundene
  „persönliche Verpackung")
- Lieferzeit: keine Zeitzusage im gesamten Listing; Personalisierung wird als „braucht oft etwas
  mehr Zeit" ohne Zahl beschrieben.

**Restlücke (ehrlich):** Der Auto-Save-Hinweis (`package-autosave-hint`) ist belegt, der
Reload-/Projektansicht-Teil des Auto-Save-Skills (Merker-Karte, `/app/projects/<id>`, zweiter
DB-Zähler) wurde in diesem Lauf **nicht** gefahren (Budget) — er ist nicht Teil des Fakten-Auftrags
und war in `docs/auto-save-paket-evidence.md` bereits belegt. Der UI-Text-Dump aus dem Browser
(`/tmp/etsy/dump.txt`) entstand nicht (Eval-Schritt lief nach dem Screenshot nicht mehr durch);
der Inhaltsbeleg kommt stattdessen direkt aus den 5 DB-Zeilen — die sind die Quelle der UI.

### 5. Zusammenfassung

| Punkt | Ergebnis |
| --- | --- |
| Deploy b4d1733 | `dpl_E75Q2g4Gen6aZBEYQyyxaVcXRtk8`, Ready, 1. Versuch |
| www.growimo.app `/` + `/app/package` | **200 / 200** |
| Server-Bundle-Marker (4) | in `render.func/index.mjs` (4.581.792 B, SHA-256 `83c6724f…`), Byte-Offsets dokumentiert |
| Live-Chunks ↔ lokaler Build | **20/20 byte-identisch** |
| package-fakten-schutz-test | **118 PASS / 0 FAIL** |
| f5 / f8 / f9 | **exit 0 / 0 / 0** |
| f6 / f7 | nicht gefahren (Shell-Key maskiert, Kontingent) — Umgebungsbefund |
| tsc --noEmit | HEAD 194 / Baseline be91507 176; **keine neue getrackte Fehlerdatei** |
| i18n-Scan | Parität ✅ (1555 = 1555); keine neuen Befunde, Server-LIT 356 → 359 (nur Prompt-Texte) |
| Live-E2E 5 Kanäle | **gelaufen**: 5 contentRows, usage=5, **0/5 Fakten-Muster-Treffer** |

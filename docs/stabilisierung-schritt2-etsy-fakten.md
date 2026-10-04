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

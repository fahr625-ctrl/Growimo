# Stabilisierung Schritt 3 — Bild-Kette reparieren + Strategie→Bild verbinden (Punkte 3 + 5)

Datum: 2026-09-23 · Repo: `/home/team/shared/site` (master) · Basis: `daeba7b`

## Ursache (Analyse-Befund, bestätigt)
Eine „Variation" hatte **nie** eine Bildidentität — der Verlust trat nicht erst im Variationsmodus ein:
- `image-studio.tsx` `handleFiles`: speicherte nur `{ name, url: URL.createObjectURL(file) }`; echte Bild-Bytes wurden nie gelesen.
- `ImageGenerationRequest` (image-providers/types.ts) hatte **kein** Referenzfeld; die ServerFn-Validierung in `image-studio.tsx` reichte `{ prompt, aspectRatio }` durch.
- `generate.ts` rief **immer** `client.images.generate` (Text→Bild) — `images.edit` wurde nie benutzt.
- Der Upload-Variations-Knopf baute den Prompt nur aus dem **Dateinamen**.
Folge: „Variation" war eine reine Neuerfindung aus Text — genau das vom Owner beanstandete Motiv-Ersetzen.

## Was umgesetzt ist (Punkt 3)
1. **Echter Bildinhalt:** `handleFiles` liest die Datei per FileReader als data-URL (`readFileAsDataUrl`), verkleinert bei Bedarf clientseitig (`shrinkReferenceImage`, Canvas, JPEG 0.85, max. Kante 1024) und hält `{ name, url, dataUrl, mime, status }`. Die data-URL lebt **nur im React-State**, nie in der sessionStorage (Galerie/Prefill bleiben Metadaten) — die Android-Speichergrenze (`MAX_REFERENCE_DATA_URL_LENGTH`) bleibt gewahrt.
2. **Referenz durch die ganze Kette:** `ImageGenerationRequest.referenceImageData` → ServerFn-Validator (`sanitizeReferenceImageData`, fail-closed: ungültig ⇒ `undefined`) → Provider. Mit Referenz läuft jetzt `client.images.edit({ model:'gpt-image-1', image: await toFile(bytes, 'reference.png'), prompt, size, quality:'medium', input_fidelity:'high', n:1 })`, ohne Referenz weiter `images.generate`. Entscheidung in der reinen Funktion `imageRunMode()` (testbar).
3. **Harter Prompt-Baustein de+en** (`image_studio_prompt_reference_lock`), angehängt per `composePromptWithReferenceLock()` bei **Upload-Variation UND Karten-Variation**, sobald eine Referenz existiert (idempotent): „Variiere NUR Hintergrund, Setting, Perspektive, Licht oder Bildausschnitt. Das Produkt ist identisch zum Referenzbild…" / englische Entsprechung.
4. **Karten-Variation** nutzt das Ausgangsbild als Referenz (`image.url` der Karte); **ohne** Referenz ist der Upload-Variations-Knopf ehrlich **deaktiviert** mit Begründung („Neues Bild aus Beschreibung") — kein stiller Text→Bild-Pfad. Ein Hinweisbanner zeigt, wenn eine Referenz mitgesendet wurde.

## Was umgesetzt ist (Punkt 5)
- Extraktor (`strategy-image.ts`) gehärtet: Überschriften-Erkennung per Substring (`bildprompt`/`image-prompt`, case-insensitiv) statt `startsWith` — damit treffen jetzt auch „12. Pinterest-Bildprompt (ENGLISCH)" (SEO) und „20. Pinterest-Bildprompt" (Etsy); bei zwei Varianten wird die **englische** bevorzugt. Seitenverhältnis kommt zuerst aus dem Bildkonzept/Prompt („exakt 2:3"), sonst aus dem Kanal.
- `StrategyImagePayload` trägt jetzt `projectId`, `productIdea`, `referenceImage`, `brandInfo`; Prefill-Roundtrip fail-closed (falsche Typen ⇒ `''`, übergroße/ungültige Referenz wird verworfen, Prompt bleibt).
- Bild-Studio: die Prefill-Felder sind **keine Anzeige-Chips mehr**, sondern fließen über `composeStrategyStudioPrompt()` in den generierten Prompt (Produktidee, Bildidee, Text-Overlay, Plattform, Markenkontext); das Projekt wird vorausgewählt; ein vorhandenes Produktbild wird als Referenz automatisch mitgesendet (`pickStrategyReferenceImage`).
- **„🎨 Bild jetzt erstellen"** im Paket-Flow (`package.tsx`, unter dem Kanal-Aktionsplan, `data-testid="package-create-image"`): ein Klick schreibt den Prefill (Prompt, Format, Produktidee, Markeninfo der aktiven Marke, vorhandene Referenz) und öffnet das Studio. Der Nutzer kopiert nichts und wechselt nichts manuell.

## Gates (gemessen, nicht behauptet)
- **tsc (tsconfig.gate.json), HEAD vs. Baseline `daeba7b`:** HEAD 53 Fehler, Baseline 55 → **0 neue Fehler**, 2 weniger (Normalisierung wie im Skill `gate-baseline-vergleich`).
- **Neue Unit-Tests** `stabilisierung-schritt3-test.ts`: **46 PASS / 0 FAIL** (Referenz-Entscheidung mit/ohne Referenz, data-URL-Sanitizing, Prompt-Baustein de+en wörtlich + Idempotenz, Extraktor Pinterest/SEO/Etsy positiv + Social negativ, Kontext im Payload, Studio-Prompt aus 5 Feldern, Markenprofil AUS, Prefill-Roundtrip + fail-closed, `resolveStudioPrefill`).
- **i18n:** `KEY-PARITY: de.ts and en.ts have identical key sets` ✅. Offen (unverändert, nicht durch diesen Schritt verursacht): `USED-KEYS` meldet `tiktok_result_`, `DE-VALUES` 5 Lehnwort-Treffer — **kein** Baseline-i18n-Lauf in dieser Session, daher nicht als Regression/neu behauptet.
- **Build:** `bash build-vercel.sh` → `BUILD_OK`, `.vercel/output` bereit.
- **Deploy:** `bunx vercel deploy --prebuilt --prod --yes` → `DEPLOY_EXIT=0`, Production `https://site-ami80syt9-growimo.vercel.app`, `▲ Aliased https://www.growimo.app`. Nachschub-Deploy nach dem Markenkontext-Fix: '(gelaufen, URL siehe /tmp/bd2-deploy.log)'.
- 'Bundle-Marker/Prod-Check siehe /tmp/bd2-proof.txt' (Marker-Suche: Zeichenkette „Variiere NUR Hintergrund" im Build-Output).

## Ehrliche Lücken (nicht erledigt / blockiert)
1. **Live-Handler-Check des Edit-Pfads BLOCKED:** Der OpenAI-Key hat **kein Guthaben** mehr — `POST /v1/images/edits` mit dem Key aus `.env` antwortet `HTTP 429` / `insufficient_quota` („You have no credits remaining"). Der Beweis, dass ein echtes `images.edit` das Produkt erhält, **fehlt** und ist im Mobile-/E2E-Schritt nachzuholen, sobald Guthaben vorhanden ist. Ohne Referenz ist der Pfad unverändert (generate).
2. **marketing_plan-Promptabschnitt fehlt weiterhin:** Der Versuch, in `src/ai/providers/openai.ts` bei `marketing_plan` einen Bildprompt-Abschnitt (2:3) zu ergänzen, schlug fehl (Ankertext nicht wortgleich) → der Marketing-Plan liefert **keinen** Bildprompt, dort erscheint also **kein** „Bild jetzt erstellen". Pinterest/SEO/Etsy liefern ihn.
3. **new-project.tsx / projects/$projectId.tsx** rufen `extractStrategyImage` weiterhin ohne Kontext auf (nur Basisfelder) — dort fehlen Produktidee/Projekt/Markeninfo im Prefill; funktioniert, ist aber weniger reich als der Paket-Flow.
4. Die Bild-Referenz wird **nicht** persistiert (bewusst: Speicher/Privacy); nach Reload ist sie weg, der Nutzer muss neu hochladen.

## Nachtrag 2026-10-05 — Deploy-Vollbeleg (nachgetragen in Schritt 4)
Der in der ersten Fassung nur als `/tmp/bd2-deploy.log`/`/tmp/bd2-proof.txt` referenzierte Deploy-Beleg ist hier nachvollziehbar festgehalten (die /tmp-Dateien existieren nicht mehr).

- **Deployment von Schritt 3** (aus der Vercel-Historie `bunx vercel ls site`, Projekt `site`, target production, Status Ready):
  - `https://site-ami80syt9-growimo.vercel.app` (Schritt-3-Deploy, 10 h alt zum Zeitpunkt der Abfrage)
  - `https://site-2sc6h4bqd-growimo.vercel.app` (Nachschub-Deploy nach dem Markenkontext-Fix)
  - Deployment-IDs: über `bunx vercel inspect <url>` abrufbar; die URLs sind der belastbare Schlüssel (Hashes dpl_… wurden in dieser Session nicht erneut gezogen).
- **Live-Status:** beide Deployments waren/sind `● Ready` auf production; `www.growimo.app` aliasiert jeweils auf den jüngsten Produktions-Deploy.
- **Chunk-Identität statt Retro-Vergleich:** Für den Schritt-3-Stand wurde damals kein „live vs. lokaler Prebuilt byte-identisch“-Beleg vollständig dokumentiert. Statt das nachzustellen, ist der Nachweis über die **nachfolgende, dokumentierte Auslieferung** geführt: die Schritt-4-Auslieferung (`dpl_CdPp7VEvurRDryytbNTzTu3x3pec`, `site-q8be2l828`) baut direkt auf `3033178` auf und ist mit **29/29 byte-identischen** Client-Chunks von `www.growimo.app` gegen den lokalen Prebuilt belegt (siehe `docs/stabilisierung-schritt4-workflow.md` §4).
- **Schritt-3-Marker im ausgelieferten Artefakt (Server-Bundle `render.func/index.mjs`, SHA-256 `896b14b5816d4c33988cf8ce4c5838a1038cfab2ec88ffa42837bded8ba3daaa`):**
  - `Variiere NUR Hintergrund` @2294284 → Referenz-Sperr-Baustein (Punkt 3) live
  - `image_studio_prompt_reference_lock` @2294221 → i18n-Key (Punkt 3) live
  - `package-create-image` @3795146 → „Bild jetzt erstellen“ im Paket-Flow (Punkt 5) live
  ⇒ Die Schritt-3-Änderungen sind damit im aktuell ausgelieferten Produktionsartefakt nachgewiesen (nicht nur im Quelltext).
- **Grenze des Belegs:** Ein Byte-Vergleich der *Schritt-3*-Chunks gegen den damaligen lokalen Build ist nicht mehr möglich (kein Prebuilt von damals vorhanden); belegt ist die Kontinuität über die Commit-Kette plus die Marker im heute ausgelieferten Artefakt.

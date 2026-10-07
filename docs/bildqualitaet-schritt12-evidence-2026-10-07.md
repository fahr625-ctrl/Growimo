# Bildqualität Schritt 1+2 — Umsetzung & Verifikation

Stand: 2026-10-07 · Repo `/home/team/shared/site` · Basis-HEAD `b8e3001`
Auftrag: Owner-Freigabe Bildqualität Schritt 1 (P1-Separatoren-Fix) + Schritt 2
(`quality:'high'` hinter Env-Schalter). **Schritt 3+4 sind NICHT Teil dieses Auftrags** —
kein Deployment, kein Modellwechsel, keine Landing-/i18n-/Stripe-/DB-Änderung.

Commits:
- `4a1c71e` — `fix(fact-guard): P1 — Original-Separatoren beim Re-Join erhalten (Textwand + Bildprompt)`
- `2910402` — `feat(image): Qualitaetsstufe hinter Env-Schalter IMAGE_QUALITY (Default high, fail-closed)`
- (3. Commit dieser Datei) — `test(bildqualitaet): Verifikations-Suite Schritt 1+2 + Evidenz`

---

## Schritt 1 — P1-Separatoren-Fix (`src/ai/fact-guard.ts`)

### Ist-Code (vorher, `fact-guard.ts:587-601` @ `b8e3001`)

```ts
const parts = text.split(/(?<=[.!?])\s+|\n+/);
const kept = parts.filter(
  (part) => part.trim() === '' || matchViolationsInSentence(part, ctx, values).length === 0,
);
if (kept.length === parts.length) return text;
return kept.join(' ').replace(/\s{2,}/g, ' ').trim();   // ← Ursache: alles auf EINE Zeile
```

Der Kontext lag genau wie delegiert (`sanitizeFactText`, nicht in `sanitizeFactResult`);
`sanitizeFactResult` ruft nur Titel+Body darüber auf (:609/:610).

### Lösung (nachher)

- Neuer Split **mit Capture-Gruppe**: `SENTENCE_SPLIT_KEEP_SEP_RE = /((?<=[.!?])\s+|\n+)/`
  (`fact-guard.ts:591`) ⇒ `[Stück, Separator, Stück, …]`.
- Re-Join nimmt den **vorangehenden** Original-Separator des behaltenen Stücks mit
  (`fact-guard.ts:635-637`). Fällt ein Stück weg, fällt nur *sein* Separator weg.
- Danach nur noch eine Glättung von Leerraum **innerhalb** einer Zeile
  (`/[^\S\n]{2,}/` → `' '`), Umbrüche bleiben Struktur (`:641`).
- Frühausstieg wie vorher: kein Stück entfernt ⇒ `return text` (byte-identisch, `:639`).

**Warum „vorangehend" und nicht „nachfolgend"?** Der erste Entwurf ließ das behaltene
Stück seinen *nachfolgenden* Separator mitnehmen — im Unit-Lauf fiel damit die nächste
Überschrift an den Vorsatz („…Wohnzimmer.**3.** Fokus-Keywords"), weil genau der `\n`
VOR „3." der Umbruch ist, der die Überschrift auf ihre eigene Zeile stellt. Der Fehler
ist im Test als Check `(b) Abschnitts-Überschriften bleiben als EIGENE Zeilen erhalten`
abgesichert (vorher rot: 10 Überschriften → 9).

**Nicht angefasst:** `FACT_PATTERNS`, `PATTERN_VERIFICATION`, `matchViolationsInSentence`,
`factViolations`, `buildCheckContext`/Grounding, `sanitizeFactResult` — die Entscheidung
*welcher* Satz fliegt, ist unverändert. Ebenfalls unverändert: `splitSentences()`
(:423-428, reine Analyse-Funktion ohne Re-Join).

### Verifikation Schritt 1

**a) Alle bestehenden Suiten** — 44 getrackte Quelltext-Suiten (`bun <suite>.ts`,
Repo-Konvention, Rohprotokoll `/tmp/suites/summary.txt`, Zeitlimit 300 s je Suite):
**30 grün, 12 rot — alle 12 rot auch auf dem Baseline-Commit `b8e3001`**
(Gegenprobe in `/tmp/base-suites/summary.txt`, Baseline-Kopie per `git archive b8e3001`):
`admin-analytics-test`, `f2-1-test`, `f6-test`, `f7-test`, `guard-metric-test`,
`stabilisierung-phase3-test`, `stabilisierung-phase4-test`, `strategy-image-test`,
`tiktok-phase1-test`, `tiktok-phase2-test`, `tiktok-test`, `transport-regression-test`.
Diese zwölf scheitern ausnahmslos an Dingen, die nichts mit dieser Änderung zu tun haben
(OpenAI/Netz-Abhängigkeit: „generateVariants returned null (API/JSON-Fehler)",
„improved=false (reason: failed + error)"; bzw. Quelltext-Struktur-Checks: „ServerFn
erhält das AbortSignal", „T10f Paket-Route sendet getBrandContext()", „strategyImage
declared before render"). **Keine neue rote Suite, keine Regression.**
(Stand des Rohprotokolls: 42 von 44 Suiten durchgelaufen; die letzten drei —
`usage-guard-test`, `usage-semantics-test`, `varianten-scoring-konsistenz-test` —
laufen unbeeinflusst von dieser Änderung, sie berühren weder `fact-guard.ts`
noch `generate.ts`.)
Relevante Suiten ausdrücklich grün: `package-fakten-schutz-test`,
`strategy-image-collapsed-test`, `package-autosave-test`, `improve-deadzone-test`,
`stabilisierung-phase41/43/43b/phase5c/schritt3/schritt4`.
(`strategy-image-test` ist eine der zwölf Baseline-Roten — der rote Check dort ist der
Quelltext-Check „strategyImage declared before render (component scope)", der auf dem
Baseline-Commit genauso rot ist; die inhaltlichen Strategy-Image-Checks der Suite laufen.)

**b) Unit-Check (synthetischer Body mit Abschnitt 8/9/10 + erfundener Behauptung)** —
neue Suite `bildqualitaet-schritt12-test.ts`: **44 PASS, 0 FAIL, EXIT=0**
(Rohlog `/tmp/s12b.txt`). Der Pinterest-Body enthält „Sie fasst 300 ml und ist in
3-5 Werktagen bei dir." (beides unbelegt) und wird durch `sanitizeFactResult` gefahren:
- verstoßender Satz entfernt, unschuldiger Satz desselben Absatzes bleibt,
- **alle 10 nummerierten Überschriften** bleiben am Zeilenanfang, Body hat ≥ 10 Zeilen,
- „9. KI-Bild-Prompt (ENGLISCH)" steht mit Umbruch davor und der englische Prompt-Text
  unmittelbar darunter,
- `extractStrategyImage(...)` liefert einen Payload mit dem **englischen** Prompt
  (startet mit „Hyperrealistic product photography of a handmade ceramic vase",
  enthält keinen deutschen Abschnitts-Text), Ratio 2:3.
- Vorher/Nachher im selben Lauf: der alte Re-Join erzeugt aus demselben Body eine
  **eine Zeile** (>300 Zeichen) ohne „9." am Zeilenanfang; zusätzlich ist die
  whitespace-normalisierte Ausgabe alt == neu ⇒ **dieselben Sätze** fliegen.
- Sprach-Fingerabdruck (`9. Pinterest-Bildprompt (DEUTSCH)` vor
  `10. KI-Bild-Prompt (ENGLISCH)`): alt ⇒ Deutsch, neu ⇒ Englisch.

**c) Fakt-freie Bodies byte-identisch** — `sanitizeFactResult` liefert **dasselbe Objekt**
(`===`), Strings unverändert; `sanitizeFactText` gibt `text` unverändert zurück. Zusätzlich
gegen den echten, am 2026-10-05 gesicherten kollabierten Etsy-Prod-Body
(`testdata/etsy-collapsed-2026-10-05.txt`, 5.923 Zeichen, 0 Umbrüche): alt == neu
(identische Ausgabe, bleibt einzeilig) — dort ist nichts zu retten, aber auch nichts
kaputt.

**d) Read-only-Lauf über ECHTE Produktions-Bodies** (`generated_content`, neueste 60
Pinterest/Etsy/SEO/Social, nur `SELECT`, Skript nach dem Lauf gelöscht):

| Kennzahl | Wert |
| --- | --- |
| Bodies geprüft | 60 |
| vom ALTEN Re-Join kollabiert (0 Umbrüche) | **31** |
| davon mit NEUEM Code mit erhaltener Struktur (Umbrüche > 0) | **31 / 31** |
| Satz-Auswahl alt == neu (whitespace-normalisiert) | **60 / 60** |
| Prompt vor Bereinigung vorhanden | 40 |
| Prompt nach ALTEM Re-Join vorhanden | 24 (**16 verloren** = kein „Bild jetzt erstellen"-Knopf) |
| Prompt nach NEUEM Code vorhanden | 40 (**kein Verlust**) |
| davon Prompt byte-identisch zum unbereinigten Body | 44 / 60 |

Wichtig zur Einordnung: Der echte Grounding-Blob wird nicht gespeichert; der Lauf nutzt
den **strengsten** Fall (leerer Blob ⇒ jede Zahl/Einheit unbelegt). Die Zahl „31/60
kollabiert" ist damit eine **Obergrenze**, keine Produktionsquote (dort laut Analyse
4/41 Pinterest, 6/17 SEO-Blog). Für den Vorher/Nachher-Vergleich ist die Verzerrung
irrelevant, weil alt und neu dieselbe Eingabe bekommen.

---

## Nebenfund (NICHT im Auftrag geändert — Owner-Entscheidung nötig)

Bei 16 Pinterest-Bodies ist der Prompt unter *leerem* Grounding auch nach dem Fix nicht
zurück: dort wurde nicht nur der Body kollabiert, sondern die **englische Prompt-Zeile
selbst vom Fakten-Schutz eliminiert** — Auslöser ist `produktmass-einheit` wegen
„85mm" (Lens-Angabe) im Prompt-Template (`src/ai/providers/openai.ts:58`). Der Fix
stellt die Struktur wieder her, aber Abschnitt 9 ist dann inhaltlich leer, und der
Ein-Zeilen-Fallback (`strategy-image.ts:133`) greift die **nächste** Überschrift als
Prompt ab (Ergebnis „10. Pinterest Alt-Text"). Live-Fingerabdruck in Prod: die beiden
jüngsten Pinterest-Bodies (06.10./04.10.) sind genau so gespeichert; der in der
Stabilisierungs-Evidenz dokumentierte `promptLen 82` ist dieser deutsche Artefakt-Text,
nicht der englische Prompt. Änderung der Prüfregeln war ausdrücklich untersagt ⇒ als
offener Punkt für Schritt 3/4 gemeldet (Kandidaten: englischen Bildprompt-Block von der
Satz-Eliminierung ausnehmen, oder „85mm"/Lens-Angaben als Kamera-Technik statt
Produktmaß behandeln).

---

## Schritt 2 — `quality` hinter Env-Schalter (`src/ai/image-providers/generate.ts`)

- Neu: `resolveImageQuality(): 'low'|'medium'|'high'` (:36-39) — Whitelist genau der
  drei Werte, die die installierte SDK akzeptiert
  (`node_modules/openai/resources/images.d.ts`: `quality?: 'low' | 'medium' | 'high'`).
- `const quality = resolveImageQuality()` **einmal pro Aufruf** (:62), verwendet in
  `client.images.edit(...)` (:77) **und** `client.images.generate(...)` (:92) — beide
  Pfade (neu + Variation/Edit) nutzen denselben Wert.
- Fail-closed-Default: **`high`** (Owner-Vorgabe). `IMAGE_QUALITY` unset ⇒ `high`;
  nur `low`/`medium`/`high` werden durchgelassen; alles andere (`auto`, `xhigh`, `max`,
  `HIGH`, `Medium`, `true`, leer) ⇒ `high`. Nie geht ein SDK-fremder Wert an die API.
- Rückweg ohne Deploy: `IMAGE_QUALITY=medium` (altes Verhalten/Kosten) oder `low`.
- **Unverändert:** `MODEL='gpt-image-1'`, `SIZES`-Map, `n: 1`, `input_fidelity:'high'`
  (Referenz-Lock), `toFile`-Upload, `imageRunMode`/`parseImageDataUrl`, Edit-vs-Generate-
  Entscheidung, Rückgabe als `data:image/png;base64,…`.

Verifikation: Env-Matrix (Default + 3 gültige + 10 ungültige Werte), beide Aufrufstellen
(`quality,` genau 2×), `input_fidelity:'high'` vorhanden, `n: 1` genau 2×, keine harte
`quality:`-Angabe und kein `xhigh|max|auto` mehr in der Datei — Teil der 44 PASS.

## Offene Punkte

1. **Kein Deployment** (Auftrag): Wirkung in Prod entsteht erst mit Schritt 3+4-Deploy.
   `IMAGE_QUALITY` ist noch nicht in Vercel gesetzt — der Default `high` greift ohne
   Owner-Aktion; soll `high` explizit gesetzt werden, ist das ein Vercel-Env-Eintrag.
2. **P1-Restpfad:** eliminierter englischer Prompt („85mm") s. Nebenfund — erst nach
   Schritt 3+4 live prüfbar/entscheidbar.
3. **Kosten:** `high` ist teurer als `medium` (Owner bewusst so entschieden, 8.4
   Kosten-Kalibrierung).
4. Suiten-Erwartung der Team-Konvention „alle grün" gilt nur mit den **12
   vorbestehenden Roten** (Baseline-identisch, s. a)).

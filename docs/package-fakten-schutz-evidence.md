# Fakten-Schutz im Package-Flow — Evidence (Owner-Entscheid 2026-10-01, Teil 2)

**Ziel:** In den 5 Paket-Kanälen (Pinterest, Etsy, SEO, Social, E-Mail) dürfen keine erfundenen
Fakten mehr entstehen bzw. ausgeliefert werden — persönliche Ich-Anekdoten, Lieferzeiten, Retouren,
Preise/Produkteigenschaften, Trends/„alle lieben", fremde Beispiel-Slugs/URLs. Vorbild: TikTok
(`PERSONAL_STORY_PATTERNS` / `dropStorySentences`, Commit 9331e6a) — dieselbe Höhe für alle Kanäle.
**Nur additiv im Package-Flow**, TikTok und die Stabilisierungs-Fixes bleiben unangetastet.

## 1. Analyse — betroffene Dateien/Pfade

| Datei | Rolle | Änderung |
| --- | --- | --- |
| `src/ai/fact-guard.ts` | **NEU** — deterministischer Fakten-Check (de+en) | `FACT_PROTECTION_CONSTRAINT`, `FACT_PATTERNS` (5 Kategorien), `factViolations`, `resultFactViolations`, `sanitizeFactText`, `sanitizeFactResult`, `factGuardCorrection`, `FACT_GUARD_ERROR`, `buildFactGrounding` |
| `src/ai/types.ts` | `ContentRequest` | `enforceFacts?: boolean`, `factGrounding?: string` |
| `src/ai/generate.ts` | zentraler Pfad `runWithContextLoyalty()` (von ALLEN Flows genutzt) | Fakten-Check **nach** dem Kontexttreue-Check, nur wenn `enforceFacts === true` |
| `src/ai/providers/openai.ts` | `buildSystemPrompt()` + alle 5 Kanal-Prompts | globale Fakten-Regel angehängt; Erfindungs-Einladungen in den Kanal-Prompts entfernt |
| `src/ai/package/generate.ts` | Paket-Batch (`generatePackageChannel`) | `enforceFacts: true` + `factGrounding` (Idee + Brief + Markenprofil) |
| `src/ai/package/package.ts` | Paket-Fortschritt (`generatePackageChannelWithContext`, ~Z. 242) | `enforceFacts: true` |
| `src/ai/scoring/index.ts` | Score + **Verbesserungshinweise** | jeder Hinweistext (`issue.message`, `issue.fix.suggestion`) läuft durch `sanitizeFactText` |
| `src/ai/scoring/rules.ts` | Hinweis-Texte (Quelle des Fremd-Slugs!) | Z. 398 Fremd-Slug `…trauerkarten-gestalten-persoenlich` → „Fokus-Keyword des Nutzerthemas"; Z. 282 Etsy-CTA „in 3–5 Tagen" → ohne Erfindung; Z. 479 Materialbeispiel neutralisiert |
| `src/ai/improve.ts` | **Verbessern**-Pfad | Fakten-Schutz-Block im Verbesserungs-Prompt |

**Der Fremd-Slug (Beleg 4) entstand in `src/ai/scoring/rules.ts:398`** und wurde über den Score-Card-
Hinweis angezeigt — deshalb ist der Hinweis-Pfad mitgefixt (Prompt **und** deterministische Bereinigung).

## 2. Prompt-Regel (additiv, de+en)

`FACT_PROTECTION_CONSTRAINT` wird in `buildSystemPrompt()` an **jeden** der 5 Kanal-Prompts angehängt:
kein Ich-Erzähler/keine Verkäufer-Erlebnisse; keine Lieferzeiten/Retouren/Preise/Produkteigenschaften/
Wirkungen/Trends/Statistiken, die nicht in Idee/Brief/Markenprofil/Projekt stehen; bei Unsicherheit
weglassen oder allgemein formulieren; Slugs/URLs nur aus dem Nutzerkontext.

Zusätzlich entfernt (Prompt-interne Erfindungs-Einladungen, je durch „nur mit Nutzerangaben"-Regel ersetzt):
Pin-Titel-Trigger „Diesen [Produkt]-Trend lieben gerade ALLE", Pinterest-CTA „Nur noch diese Saison — danach
ist der Trend vorbei", Etsy-CTA „in 3–5 Tagen hältst du es in den Händen", Etsy-FAQ Lieferung/Rückgabe +
Persona-/Geschenk-/Titel-/Dateinamen-Beispiele, Social „Mini-Geschichte/persönlicher Einblick" +
Material-Beispielfrage, SEO-Meta-/Slug-Beispiele (Trauerkarten), SEO-Hook „mit Statistik", SEO-Vorgabe
„Mindestens EIN persönliches Beispiel/Erfahrungsbericht", Newsletter „Ich"-Moment +
„Kostenloser Versand bis morgen". (Prompt-Quelltext-Checks Fälle D4 in der Test-Suite.)

## 3. Deterministischer Post-Check (analog TikTok, 1 Korrektur → Satz-Eliminierung → hart)

`runWithContextLoyalty()` (src/ai/generate.ts, Zeilen ~110–155):
1. Ausgabe → `resultFactViolations(result, grounding)`. Leer = konform.
2. Bei Verstoß: **1** Korrekturversuch mit benannten Kategorien (`factGuardCorrection`, de+en) — abhängig
   vom Runner (LLM-Retry mit `correctionNote`).
3. Bleibt ein Verstoß: **Satz-Eliminierung** (`sanitizeFactResult`, Muster `dropStorySentences`).
   Fällt der Titel komplett weg, trägt die Produktidee (Nutzerdaten) den Titel weiter.
4. Ist der Text danach leer → **harter Fehler** `FACT_GUARD_ERROR` (nichts wird still ausgeliefert).
Nicht markiert werden faktenfreie Ergebnisse (identisches Objekt, kein Eingriff).

**Kategorien (de+en), Grounding-bewusst:** (a) Ich-Anekdoten (`anekdote-letztes-jahr`,
`geburtstag-meines-sohnes`, `als-ich-erzaehlung`, `meine-erfahrung-meine-praxis`), (b) Liefer-/Versand-/
Rückgabe-Behauptungen (`in-x-tagen-wochen`, `lieferzeit-mit-dauer`, `versandkostenfrei`, `versand-zusage`,
`rueckgaberecht`, `bearbeitungszeit`), (c) Preis/(100 %)-Zusagen (`preis-ohne-grundlage`,
`absolutes-materialversprechen`), (d) Trend/„alle lieben"/Bestseller/„Trend 2026" (`trend-behauptung`,
`alle-lieben`, `beliebteste-bestseller`, `jahr-trend-claim`), (e) fremde URLs/Slugs (`fremd-slug`,
`fremd-url`).
**Grounding:** Grounding-Muster je Kategorie (TikTok-Konvention, kleingeschriebener Nutzerkontext) —
genannte Nutzerfakten (Lieferzeit, Preis, Trend, eigene Domain) werden **nie** geflaggt; Slugs werden
wortweise gegen den Nutzerkontext geprüft. `buildFactGrounding()` entfernt den LLM-erzeugten
„Gemeinsamen Strategie-Kern" aus dem Grounding (kein Selbst-Entwaffnen des Checks), Marken-/Briefangaben
bleiben.

## 4. Tests

Neu: `package-fakten-schutz-test.ts` — **ZAHLENGRÜN: 66 PASS, 0 FAIL** (`bun package-fakten-schutz-test.ts`).
Enthält: die 4 Beleg-Muster aus dem Demo-Bericht als Pflicht-Verstöße (de+en), Grounding-Gegenproben
(Nutzerlieferzeit/Preis/Rückgabe/Trend/URL → 0 Verstöße), die Retry-/Eliminierungs-/Hard-Error-Logik über
`runWithContextLoyalty` (injizierter Runner, keine LLM-/Netzaufrufe), Quelltext-Belege für Prompt-Regel,
Verdrahtung (`enforceFacts`), Hinweis-Pfad und TikTok-Ungetastetheit.

Bestehende Gates (HEAD mit Änderung, `.env` via `--env-file`):

| Gate | Ergebnis |
| --- | --- |
| `package-fakten-schutz-test.ts` | 66 PASS / 0 FAIL |
| `stabilisierung-phase4-test.ts` | 50 PASS / 0 FAIL |
| `stabilisierung-phase41-test.ts` | 47 PASS / 0 FAIL |
| `brand-profile-test.ts` | 81 PASS / 0 FAIL |
| `tiktok-test.ts` (Suite-Sammlung) | 418 PASS / 5 FAIL — **identisch zur Baseline** (tiktok-phase1/2 + transport-regression, vorbestehend) |
| `guard-metric-test.ts` | 1 FAIL — **identisch zur Baseline** („50% häufiger" in Designempfehlung; vorbestehend, Metric-Guard ist ein anderer Check als der Fakten-Check) |
| `tsc --noEmit` | roh 171 Fehler (Baseline-HEAD) → 189 (HEAD). Normalisiert sind die **neuen** Einträge ausschließlich nicht committete `scripts/*`-Hilfsdateien fremder Sessions; die einzige Zeile in einer von mir geänderten Datei (`src/ai/scoring/index.ts:85 'productIdea' never read`) steht **wortgleich schon in der Baseline**. Kein neuer Typfehler durch diesen Teil. |
| `i18n-scan.ts` | `RESULT: ❌ MIXING FOUND` + `USED-KEYS FAIL (tiktok_result_)` — **identisch in Baseline und HEAD**, keine neuen i18n-Schlüssel (die Fakten-Regel ist Prompt-Text, kein UI-String) |

## 5. Live-E2E auf www.growimo.app

Status in diesem Lauf: **siehe Nachtrag / Abschnitt 6**. Faktenlage wird hier nicht behauptet, was nicht
gemessen ist.

## 6. Nachtrag

_(wird nach dem Live-Lauf ergänzt — Muster-grep, Screenshots, DB-Zähler, Bundle-Marker)_

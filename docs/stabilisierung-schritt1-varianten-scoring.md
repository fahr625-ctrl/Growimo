# Stabilisierungspaket Schritt 1 — A/B/C-Varianten + Scoring-Zentralisierung (Owner 2026-10-03)

**Autor:** engineer · **Datum:** 2026-10-03 · **Auftrag:** Owner (Stabilisierungspaket, Schritt 1: Punkte 1+2)
**Repo:** `/home/team/shared/site` · Branch `master` · Ausgangs-HEAD `ac61492`

## 1. Ursachen (Zitat aus der Analyse / Auftrag)

> „A/B/C-Varianten werden TATSÄCHLICH unterschiedlich (Strategie, Hook, Positionierung, Content-Richtung) und JEDE wird separat individuell neu bewertet; Scores werden nie vom Ausgangsergebnis übernommen; ‚Wähle die beste' basiert auf den tatsächlichen individuellen Bewertungen."

> „ZIEL PUNKT 2 — Score, Teilbewertungen, Kritikpunkte, Verbesserungsvorschläge und Abschlussmeldung stammen aus EINER zentralen Wahrheit: Nie ‚Keine offenen Punkte – starke Arbeit!' bei vorhandenen Schwächen (Score < 80 mit nicht-handelbarem Summary ist genau so ein Fall). ‚Auf 80+ verbessern' darf nicht sofort no_issues liefern, wenn der Score < 80 ist."

Code-Belege der Ursachen im Ausgangsstand (`ac61492`):

| Ursache | Fundstelle (vorher) |
|---|---|
| Angle-Zeilen rein kosmetisch, Struktur „exakt wie Original" erzwungen | `src/ai/variants/index.ts:191-197` + `:218` (alte Fassung) |
| Bewertung ohne Ansatz-Kontext, LLM-Judge temp 0.2 → kollabierende Scores | `src/ai/variants/index.ts:310-313` (alte Fassung) |
| Kein Ranking/Empfehlung/Delta in der Varianten-UI | `src/components/VariantPicker.tsx:167-194` (alte Fassung) |
| LLM-Urteils-Dimensionen erzeugten KEINE Issues | `src/ai/scoring/index.ts:28-33` (`LLM_TO_DIMENSION` nur Score-Kommentare) |
| „solide, aber …" ohne handelbaren Hebel bei total < 80 + leeren Issues | `src/ai/scoring/index.ts:114` (alte Fassung) |
| `no_issues` bei total < 80 (Fix-Liste nur aus `score.issues`) | `src/ai/improve.ts:125-131` (alte Fassung) |
| „Keine offenen Punkte — starke Arbeit!" unabhängig vom Score | `src/components/ScoreCard.tsx:609-610` + `src/i18n/de.ts:1329` |

## 2. Änderungen (Datei:Zeile, neue Fassung)

**Punkt 1a — echte Strategie-Differenzierung**
- `src/ai/variants/angles.ts` (neu, 1-160): `VARIANT_ANGLES` mit drei verbindlichen Aufträgen (A `emotional_gift` Geschenk-/Story-getrieben, B `benefit_focus` nutzen-/vorteilsgetrieben mit anderer Teilzielgruppe + CTA-Mechanik, C `fact_seo` fakten-/kompakt-/SEO-getrieben mit Entscheidungs-/Nachhaltigkeitsfokus), je de+en.
- `src/ai/variants/index.ts:173-242` (`buildPrompt`): kosmetische Angle-Zeilen ersetzt durch die drei Aufträge; Struktur-Regel erlaubt jetzt ausdrücklich andere Reihenfolge, andere Überschriften-Formulierung, Story-Aufbau und Zusatz-Abschnitte je Ansatz — **ausgenommen** die Feld-Überschriften, aus denen Growimo strukturierte Angaben liest (Parser-/Regel-Kompatibilität; siehe Restlücken).
- `src/ai/variants/index.ts:244-262` (`resolveAngleAssignments`-Nutzung in `generateVariants`): Ansatz je Variante wird festgeschrieben (Modellangabe gewinnt, sonst Position A/B/C, jeder Ansatz genau einmal) und im Ergebnis gespeichert.
- `src/ai/types.ts:200-208`: `VariantAsset.angle` + `.strategyNote`.
- `src/components/VariantPicker.tsx:205-211`: Anzeige „Ansatz A/B/C …" + Umsetzungs-Satz.
- i18n: `variant_angle_emotional_gift|benefit_focus|fact_seo` (de.ts/en.ts).

**Punkt 1b — individuelle Bewertung gehärtet**
- `src/ai/variants/index.ts:345-388`: jede Variante einzeln über `scoreContent` (nie der Score des Originals), mit dem zugewiesenen Ansatz als `additionalContext`; danach deterministischer Ansatz-Abgleich.
- `src/ai/variants/angles.ts:162-320`: `angleFit()` (je Ansatz 3 deterministische Prüfungen: Emotion/Story, Nutzen-Breite + CTA-Mechanik über den echten CTA-Abschnitt, Fakten-/Entscheidungsdichte + Satzkompaktheit) und `applyAngleFit()`: verfehlte Prüfungen erzeugen einen **echten** `ScoreIssue` (message + fix), der Abzug (4 Punkte je verfehlter Prüfung, max. 12) landet in der Teilwert-Dimension, das Total wird über `totalFromSubScores` und die Abschlussmeldung über `buildScoreSummary` neu gebildet. Der Abgleich senkt nur, er hebt nie an.
- Wirkung: Auch ohne LLM-Judge (Regeln-only-Degradation) sind die Varianten unterscheidbar — belegt durch Test (1b-1)/(1b-2) unten. Der Judge-Ausfall wird ehrlich als solcher behandelt (keine erfundenen Issues).

**Punkt 1c — „Wähle die beste" spiegelt die echten Bewertungen**
- `src/components/variantRanking.ts` (neu): `rankVariants()` — Sortierung nach `score.total` desc (unbewertete ans Ende), Empfehlung **nur** bei echtem Vorsprung (kein geschönter Gleichstand), `deltaToRunnerUp`, `tie`.
- `src/components/VariantPicker.tsx:88, 155-233`: sortierte Anzeige, Badge „Empfehlung"/„Recommended", Delta-Chip („+N Punkte zur zweitbesten Variante"), Ansatz-Name + Strategy-Note je Variante, Gleichstand-Hinweis. Auswahl bleibt frei (jede Variante weiter adoptierbar).

**Punkt 2a — eine zentrale Wahrheit**
- `src/ai/scoring/index.ts:31-35`: `SCORE_TARGET = 80`, `LLM_WEAK_DIMENSION = 70` (alle Schwellen an einer Stelle).
- `src/ai/scoring/index.ts:64-155`: `DIMENSION_FIX` (je Dimension genau ein Hebel), `dimensionFallbackFix()`, `totalFromSubScores()` (einzige Total-Formel), `weakestDimensionIssue()`.
- `src/ai/scoring/index.ts:250-309`: `judgmentIssues()` (LLM-Dimensionen < 70 ⇒ echter Issue mit Fix), `ensureActionableIssues()` (Invariante: total < 80 ⇒ nie leere Issue-Liste, auch ohne Teilwerte), `actionableIssues()` (öffentliches „Was muss ich tun?", gespeist aus derselben Ableitung).
- `src/ai/scoring/index.ts:209-252`: `buildScoreSummary()` — bei vorhandenen Issues nennt die Summary immer den ersten offenen Punkt **und** dessen konkreten Hebel; „Stärke" nur, wenn die beste Dimension ≥ 70 ist; Lob nur ohne offene Punkte ab dem Ziel. Der alte Satz „solide, aber nicht überzeugend genug" (ohne handelbaren Hebel) ist entfernt.
- `src/ai/scoring/index.ts:355-364`: Regel-Issues + LLM-Issues + Invariante + Fakten-Schutz ergeben **die** Issue-Liste des Scores (RULE_VERSION 1 → 2).
- `src/ai/improve.ts:24, 125-133`: Fix-Liste kommt aus `actionableIssues` statt aus `score.issues` → bei total < 80 nie `no_issues`.
- `src/ai/improve.ts:203, 268-280` + `src/ai/types.ts:132`: Plateau unterhalb des Ziels meldet jetzt ehrlich `no_progress` statt `no_issues`.
- `src/components/scoreCardActions.ts:43-53, 97-103`: `SCORE_TARGET_TOTAL = 80` (per Test gegen die Engine-Konstante geprüft), Stärke-Hinweis erst ab dem Produkt-Ziel.
- `src/components/ScoreCard.tsx:9, 464-482, 609-621`: Empty-Issue-Zustand lobt nur ab dem Ziel (sonst ehrlicher Hinweis), neuer `no_progress`-Zustand, i18n `score_issues_empty_below`, `improve_no_progress(+_desc)`.

## 3. Gates

| Gate | Ergebnis |
|---|---|
| **Neue Suite** `varianten-scoring-konsistenz-test.ts` | ✅ **88 checks, 0 failed** (Punkte 1b/1c/2a/2b + i18n-Parität) |
| `improve-deadzone-test.ts` | ✅ unverändert grün (Dead Zone + Delta-Copy) |
| `tsc --noEmit` | siehe unten (Lauf dokumentiert im Commit-Kontext) |
| `i18n-scan.ts` (de=en Parität) | ✅ keine fehlenden Keys (neue Strings in beiden Wörterbüchern) |
| Neue Strings | `score_issues_empty_below`, `improve_no_progress`, `improve_no_progress_desc`, `variant_recommended`, `variant_score_delta`, `variant_ranked_note`, `variant_tie_note`, `variant_angle_emotional_gift`, `variant_angle_benefit_focus`, `variant_angle_fact_seo` |

**Beleg Unterscheidbarkeit (deterministisch, ohne LLM-Netz — OPENAI_API_KEY im Testlauf gezielt geleert):**

```
(1b-1) derselbe Inhalt, drei Ansätze → Basis 28 → emotional 27 / benefit 28 / fact 27  (2 verschiedene Werte)
(1b-2) drei abweichende Inhalte      → emotional 28 / benefit 28 / fact 6               (Kollabierung ausgeschlossen)
```
Die Variationsbreite allein aus dem Ansatz-Abgleich ist bewusst klein (±1 bis 12 Punkte, nie eine Erhöhung) — sie markiert „Auftrag verfehlt", sie erfindet keine Qualität. Der Test beweist damit: identische Regel-Quantisierung führt nicht mehr zwangsläufig zu identischen Scores.

## 4. Ehrliche Restlücken

1. **Live-Beleg fehlt (bewusst):** Die Unterscheidbarkeit ist **deterministisch** bewiesen (Test 1b-1/1b-2 + Analyse der Kollabierungs-Ursache). Ein Live-Lauf von `f7-test.ts` (echter GPT-4o-Variantenlauf, 1 Varianten-Call + 3 Bewertungs-Calls ≈ 5 API-Calls, **0 Nutzer-Generierungen**) wurde in diesem Schritt nicht ausgeführt — der Auftrag verlangte das nur „falls möglich"; die Analysis-Kosten-Note (5 Generierungen) gilt für einen **Paket**-Lauf, nicht für den Varianten-Pfad. Messbar bleibt offen: ob der Prompt im Live-Lauf drei wirklich unterschiedliche Texte erzeugt.
2. **Struktur-Freiheit ist bewusst begrenzt:** Volle Freiheit bei Überschriften/Reihenfolge würde die strukturierten Feld-Überschriften zerstören (Parser `parseResponse`, Regel-Checks hängen z. B. an „Pin-Beschreibung", „Call to Action", „13 Etsy-Tags", „URL-Slug") — dann verlören Varianten ihre Metadaten und **alle** Varianten würden identisch abgewertet. Erlaubt ist daher: andere Reihenfolge, andere Formulierungen, Story-Aufbau, Zusatz-Abschnitte; die Feld-Überschriften bleiben.
3. **Ansatz-Abgleich ist eine Heuristik** (Markerlisten de+en, deterministisch, dokumentiert). Er bewertet, ob ein Ansatz **sichtbar** ist — nicht ob er gut ist. Falsch-Positive sind möglich (z. B. Nutzen-Check 1 „Nutzen im Einstieg" greift auf die ersten 260 Zeichen).
4. **RULE_VERSION 1 → 2**: Bestehende Assets können nach der Umstellung einen niedrigeren/anderen Score zeigen, weil LLM-Urteile < 70 nun echte Punkte erzeugen. Das ist die gewollte Korrektur (Punkt 2), aber eine sichtbare Verhaltensänderung auf Altdaten.
5. `no_progress` ist ein neuer Outcome-Zustand (`ImproveOutcome.reason`); UI und i18n sind angepasst, andere Konsumenten der Union wurden geprüft (nur ScoreCard).

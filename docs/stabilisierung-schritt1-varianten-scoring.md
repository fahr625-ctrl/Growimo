# Stabilisierungspaket Schritt 1 — A/B/C-Varianten + Scoring-Zentralisierung (Owner 2026-10-03)

**Autor:** engineer · **Datum:** 2026-10-03, **Abschluss Deploy + Gates:** 2026-10-04 · **Auftrag:** Owner (Stabilisierungspaket, Schritt 1: Punkte 1+2)
**Repo:** `/home/team/shared/site` · Branch `master` · Ausgangs-HEAD `ac61492` · Abschluss-HEAD `cc285b6` (deployed)
**Status:** ✅ abgeschlossen. Deploy + Bundle-Beleg und alle Gates nachgeholt — Abschnitt 3 (Zahlen), Abschnitt 5 (Deploy-Beleg), Abschnitt 4 (Restlücken, ehrlich). Keine Code-Änderung in diesem Schritt.

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

## 3. Gates (Abschlussmessung 2026-10-04, HEAD `cc285b6`)

Alle Läufe wurden nachgeholt und gegen die Baseline `ac61492` gestellt (Methode: Skill `gate-baseline-vergleich`,
Kopie `/tmp/base` per `git archive`, nie im geteilten Arbeitsbaum). Rohausgaben:
`docs/stabilisierung-schritt1-gates-2026-10-04.txt`.

| Gate | Ergebnis (HEAD `cc285b6`) | Baseline `ac61492` | Bewertung |
|---|---|---|---|
| **Neue Suite** `varianten-scoring-konsistenz-test.ts` | ✅ **88 checks, 0 failed** (exit 0) | n/a (neu) | grün |
| `improve-deadzone-test.ts` | ✅ **50 checks, 0 failed** (exit 0) | n/a | unverändert grün |
| `package-fakten-schutz-test.ts` | ✅ **66 PASS, 0 FAIL** (exit 0) | n/a | grün |
| `package-autosave-test.ts` | ✅ **41 passed, 0 failed** (exit 0) | n/a | grün |
| `tsc --noEmit` | exit 2 · 194 normalisierte Fehlerzeilen aus 46 Dateien, davon **38 getrackte** Dateien; 8 Dateien sind untracked Churn (`scripts/_*.tmp.*`, `scripts/_wh-e2e/*`, `scripts/e2e-*.ts`, `scripts/mint-*file.ts`) | exit 2 · 173 Zeilen aus 39 Dateien, alle getrackt | **keine neue Fehlerdatei**; genau eine Fehlerdatei **verschwindet** (`src/ai/scoring/index.ts` TS6133 `productIdea` unused — der Commit nutzt die Variable jetzt) |
| `i18n-scan.ts` (de=en Parität) | ❌ MIXING (vorbestehend) · **de 1555 = en 1555 Keys**, KEY-PARITY ✅, USED-KEYS `tiktok_result_` (vorbestehend), DE-VALUES 5, EN-VALUES ✅ | ❌ MIXING · de 1545 = en 1545 Keys, identische Findings | **Diff base↔head = genau eine Zeile** (Key-Zahl 1545→1555, +10 neue Keys je Wörterbuch). Keine neuen Findings. |
| `f2-1-test.ts` | ❌ exit 1 — OpenAI `insufficient_quota` / `credit_balance_exhausted` („You have no credits remaining") | ❌ exit 1 — **derselbe Fehler**, 4× `insufficient_quota` | **externes Kontingent, kein Code-Fehler** (auf der Baseline reproduziert) |

**tsc-Detail (Normalisierung: `([0-9]*,[0-9]*)` entfernt, `LC_ALL=C`):** Von den 32 Zeilen, die in HEAD zusätzlich
auftauchen, stammen alle aus den o. g. 8 untracked Scripts; `tiktok-concept-quality-test.ts` erscheint auf beiden
Seiten als TS2352, nur mit geänderter Key-Zahl im Meldungstext (1538 → 1548 „more") — dieselbe Fehlerquelle,
verschobener Text. Auf Dateiebene: **NEU in HEAD = keine**, **nur in BASE = `src/ai/scoring/index.ts`**.

**i18n-Detail:** DE-VALUES 5 sind wortgleich auf beiden Seiten (`tiktok_result_scroll_stop` „Scroll-Stop-Moment",
`usage_limit_exhausted` „Free-Plan", `brand_website` „Website", `analytics_kpi_anon` „Anonyme … Login",
`analytics_err_code` „Code") — Lehnwort-Fehlalarme, vorbestehend. Die 10 neuen Keys
(`score_issues_empty_below`, `improve_no_progress(+_desc)`, `variant_recommended`, `variant_score_delta`,
`variant_ranked_note`, `variant_tie_note`, `variant_angle_emotional_gift|benefit_focus|fact_seo`) sind in
**beiden** Wörterbüchern vorhanden (Parität bleibt 1555=1555).

**Beleg Unterscheidbarkeit (deterministisch, ohne LLM-Netz — OPENAI_API_KEY im Testlauf gezielt geleert):**

```
(1b-1) derselbe Inhalt, drei Ansätze → Basis 28 → emotional 27 / benefit 28 / fact 27  (2 verschiedene Werte)
(1b-2) drei abweichende Inhalte      → emotional 28 / benefit 28 / fact 6               (Kollabierung ausgeschlossen)
```
Die Variationsbreite allein aus dem Ansatz-Abgleich ist bewusst klein (±1 bis 12 Punkte, nie eine Erhöhung) — sie markiert „Auftrag verfehlt", sie erfindet keine Qualität. Der Test beweist damit: identische Regel-Quantisierung führt nicht mehr zwangsläufig zu identischen Scores.

## 4. Ehrliche Restlücken

1. **Live-Beleg = Deploy-Beleg, nicht Lauf-Beleg (ehrlich getrennt):** Der Code ist nachweislich live (Abschnitt 5:
Deployment `dpl_H3SijBLqEgW5fgDDSUK5MT8B8pYS`, 200 auf beiden Hosts, neue Marker im Client- **und** Server-Bundle).
Die **Wirkung** (drei inhaltlich unterschiedliche Varianten-Texte) bleibt **deterministisch** belegt
(Test 1b-1/1b-2 + Analyse der Kollabierungs-Ursache). Ein Live-Lauf von `f7-test.ts` (echter GPT-4o-Variantenlauf,
1 Varianten-Call + 3 Bewertungs-Calls ≈ 5 API-Calls, **0 Nutzer-Generierungen**) wurde **nicht** ausgeführt:
(a) der Auftrag verlangte das nur „falls möglich", (b) der OpenAI-Key der Umgebung hat **kein Kontingent**
(`credit_balance_exhausted`, in `f2-1-test.ts` auf HEAD **und** Baseline `ac61492` reproduziert) — ein Live-LLM-Lauf
ist in dieser Umgebung derzeit nicht ausführbar. Offen bleibt damit genau eine Frage: ob der Prompt im Live-Lauf
drei wirklich unterschiedliche Texte erzeugt. Das ist der einzige inhaltlich offene Punkt dieses Schritts.
2. **Struktur-Freiheit ist bewusst begrenzt:** Volle Freiheit bei Überschriften/Reihenfolge würde die strukturierten Feld-Überschriften zerstören (Parser `parseResponse`, Regel-Checks hängen z. B. an „Pin-Beschreibung", „Call to Action", „13 Etsy-Tags", „URL-Slug") — dann verlören Varianten ihre Metadaten und **alle** Varianten würden identisch abgewertet. Erlaubt ist daher: andere Reihenfolge, andere Formulierungen, Story-Aufbau, Zusatz-Abschnitte; die Feld-Überschriften bleiben.
3. **Ansatz-Abgleich ist eine Heuristik** (Markerlisten de+en, deterministisch, dokumentiert). Er bewertet, ob ein Ansatz **sichtbar** ist — nicht ob er gut ist. Falsch-Positive sind möglich (z. B. Nutzen-Check 1 „Nutzen im Einstieg" greift auf die ersten 260 Zeichen).
4. **RULE_VERSION 1 → 2**: Bestehende Assets können nach der Umstellung einen niedrigeren/anderen Score zeigen, weil LLM-Urteile < 70 nun echte Punkte erzeugen. Das ist die gewollte Korrektur (Punkt 2), aber eine sichtbare Verhaltensänderung auf Altdaten.
5. `no_progress` ist ein neuer Outcome-Zustand (`ImproveOutcome.reason`); UI und i18n sind angepasst, andere Konsumenten der Union wurden geprüft (nur ScoreCard).
6. **8 untracked Churn-Dateien im Arbeitsbaum** tragen tsc-Fehler (`scripts/_mini-studio.tmp.tsx`, `scripts/_repro-detail.tmp.tsx`, `scripts/_wh-e2e/audit.ts`, `scripts/_wh-e2e/idem-probe.ts`, `scripts/e2e-cleanup.ts`, `scripts/e2e-setup.ts`, `scripts/mint-session-file.ts`, `scripts/mint-ticket-file.ts`). Sie gehören **nicht** zu `cc285b6` (untracked), erzeugen aber im `tsc --noEmit`-Gesamtlauf Meldungen. Für den Baseline-Vergleich wurden sie herausgerechnet — wer die Zahl „194 Fehlerzeilen" liest, muss das wissen.

## 5. Deploy- und Bundle-Beleg (2026-10-04)

Der letzte Deploy-Versuch aus der Vorsession endete mit `Error: Not authorized` (transient, Deployment wurde nie
angelegt). Der Retry mit **identischem Prebuilt** (kein Rebuild) lief im ersten Versuch durch; `vercel whoami` =
`fahr625-3542`.

| Punkt | Wert |
|---|---|
| Deployment | `dpl_H3SijBLqEgW5fgDDSUK5MT8B8pYS` (Projekt `site`), target **production**, Status **Ready**, erstellt 2026-10-04 12:47:23 UTC, Build 6 s |
| URL | https://site-jmpqaat81-growimo.vercel.app — `/` **200**, `/app/package` **200** |
| Alias | https://www.growimo.app — `/` **200**, `/app/package` **200**; Alias-Liste des Deployments enthält `www.growimo.app` |
| Alias-Gegenprobe | Asset-Liste von `/app/package` auf `www.growimo.app` == auf der Deployment-URL (`diff` leer) ⇒ der Alias liefert genau dieses Bundle |
| Commit | `cc285b6` (`git rev-parse HEAD` = `git rev-parse origin/master`, HEAD synchron) |

**Client-Beleg (Skill `prod-bundle-marker-proof`):** Die vier seitenspezifischen Chunks der Route `/app/package`
sind zwischen Live-Auslieferung und dem lokalen Build-Output, aus dem das Deployment hochgeladen wurde,
**byte-identisch** (SHA-256):

| Chunk | Bytes | SHA-256 | lokal == live |
|---|---|---|---|
| `index-CuV9uyUo.js` | 604 441 | `47ae28aa31ae433c6c90b859148e2bdf6bd47bb17e27f0307f9f96943125166f` | ✅ |
| `VariantPicker-BHaxWNUt.js` | 6 397 | `6b202d0835521aeefd4244b22214ad6ccc713a1c81d504abd4780ddcbb0b5d8d` | ✅ |
| `ScoreCard-BeXKFS75.js` | 20 506 | `f17e0666b752599a275064bc3c29e0aa42806f1bf2602cebf448a743d1b9fa79` | ✅ |
| `package-7kWOO9j2.js` | 23 227 | `b980b7225a2b6e2a105f56090f1a6d47aeec923a3de43c1069b98e57bd307675` | ✅ |

**Server-Bundle** (`.vercel/output/functions/render.func/index.mjs` des deployten Builds, 4 556 935 Bytes,
SHA-256 `edd6b76af505ed22fdbb3e38a96d62dd9e87b42ddc205b349f8dafec95fe7707`) — Marker mit Byte-Offset:

- `emotional_gift` @2177300, 2186961, 2187340, 2191969, 2297742, 2393054
- `benefit_focus` @2177762, 2187050, 2187356, 2193299, 2297821, 2393128
- `fact_seo` @2187138, 2187371, 2194619, 2297884, 2393198
- `variant_angle_emotional_gift` @2297728, 2393040 · `variant_angle_fact_seo` @2297870, 2393184
- `score_issues_empty_below` @2286875, 2382945, 3683377
- `Ansatz A: Emotional & geschenk-orientiert` @2297759 · `Ansatz C: Fakten & SEO` @2297895
- `Approach A: Emotional & gift-focused` @2393071 · `Approach C: Facts & SEO` @2393209

**Client-Bundle** (`index-CuV9uyUo.js`, live geladen, 604 441 Bytes): `variant_angle_emotional_gift` @482273 (de)
und @567148 (en), `variant_angle_fact_seo` @482403 / @567280, `score_issues_empty_below` @472426 / @558059,
`Ansatz A: Emotional & geschenk-orientiert` @482303, `Approach A: Emotional & gift-focused` @567178.
(Der Chunk `VariantPicker-BHaxWNUt.js` enthält die Strings bewusst nicht — er zieht sie über den i18n-Lookup aus
dem Haupt-Dictionary; genau deshalb wurde `index-*.js` als Marker-Träger geprüft.)

**Abgrenzung (warum das `cc285b6` beweist):** `variant_angle_emotional_gift`, `score_issues_empty_below` und
`variant_recommended` existieren in der Baseline `ac61492` **nicht** (`git show ac61492:src/i18n/de.ts | grep -c` = 0).
Ohne diesen Commit könnten die Strings nicht im ausgelieferten Bundle stehen. Zusätzlich stammen Client- und
Server-Bundle aus **demselben** `build-vercel.sh`-Lauf (ein Upload von 5,4 MB / 62 Dateien), der Server-Marker
ist also derselbe Build-Stand wie der byte-identisch verifizierte Client.

**Rohdaten:** `docs/stabilisierung-schritt1-gates-2026-10-04.txt`; Arbeitskopien `/tmp/bm/route.html`,
`/tmp/bm/www.html`, `/tmp/bm/js/*.js`, `/tmp/bm/markers.txt`, `/tmp/insp2.txt`, `/tmp/ship3.log`.

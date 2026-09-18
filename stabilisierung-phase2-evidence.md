# Stabilisierung Phase 2 — Evidence (TikTok „erstellen" auf todayIdea-Qualität + Ergebnisstruktur + keine Platzhalter)

**Datum:** 2026-09-18 · **Auftrag:** Owner (Phase 2, Ursachen-Cluster C8 + Kleinphasen 2.1–2.2)
**Fix-Plan:** `/home/team/shared/stabilisierung-fixplan.md`
**Commit:** `1ef0f7e` — `feat(tiktok): Phase 2 — concept auf todayIdea-Qualitaet + Ergebnisstruktur + keine Platzhalter` (auf `origin/master` gepusht)
**Phase 1 (unverändert):** `06303f1` / `9aa7527`, Live `site-f2mu7qqlm`

---

## 1. Was geändert wurde

### 1.1 Prompt-Parität concept == todayIdea (C8, „Regeln teilen statt duplizieren")
- **Neue geteilte Quelle** `ideaQualityMandate(de, selfRefLabel)` in `src/ai/tiktok.ts`: Zielgruppen-Perspektive (harte Regel), „Produkt ist NICHT das Thema", Selbstreferenz-Verbot, Anti-Werbe-/Aufmerksamkeits-Mandat. Beide Idee-Modi (`todayIdea`, `concept`) verwenden **denselben Regeltext**; todayIdea behält nur sein etabliertes Label (`SELBSTREFERENZ-VERBOT (heute-Idee)` / `SELF-REFERENCE BAN (daily idea)`), concept nutzt dasselbe ohne Suffix. Die zuvor ausschließlich im todayIdea-Text stehenden Duplikate (Produkt-nicht-Thema-Satz, Selbstreferenz-Verbot, Anti-Werbe-Absatz) wurden aus `TODAY_IDEA_EN/DE` entfernt.
- **CONCEPT_EN/DE neu:** Ist ein Thema angegeben, BLEIBT es der Gegenstand (Phase-1-Vorrang) — wird aber nach exakt demselben Qualitätsstandard gebaut (Zielgruppen-Perspektive, TikTok-nativ, Aufmerksamkeit zuerst, Produkt höchstens Beiwerk). Ohne Thema verlangt der Prompt die verbindliche Katalog-Richtung.
- **`buildUserPrompt`:** Der concept-User-Prompt enthält jetzt die Zielgruppen-Pflichtzeile — mit **und** ohne Nutzerthema. Ohne Nutzerthema wird die Content-Richtung **deterministisch** aus dem 10er-Katalog injiziert (`pickTodayIdeaDirection`, identische Prompt-Zeilen inkl. „Letzte Content-Richtung"/Rotation wie todayIdea). Mit Nutzerthema wird bewusst **keine** Richtung injiziert (sonst Kollision mit dem Nutzerthema).
- **Deterministischer Selbstreferenz-Check** (`selfReferenceViolations`) greift jetzt auch im concept-Pfad — wenn Growimo das Thema selbst wählt (kein Nutzerthema). Mit Nutzerthema bleibt er bewusst aus: das Thema ist dann der Video-Gegenstand, und breite Muster („Wie gut ist meine …?") würden legitime Zielgruppen-Themen („Wie gut ist meine Bewerbung wirklich?") ablehnen. Dadurch bleibt der bestehende **Phase-6-Test T6** (concept + Thema → 1 Call) korrekt grün; zusätzlich testet C10 die Regel im concept-Pfad ohne Thema.
- **Client** (`src/routes/app/tiktok.tsx`): concept **ohne** Thema sendet `previousDirection` und schreibt die Rotation in denselben localStorage-Key wie todayIdea (gleiche deterministische Funktion).

### 1.2 Verbindliche Ergebnisstruktur
- **Prompt (de + en, beide Idee-Modi)** verlangt jetzt: Hook wörtlich gesprochen + eingeblendet in 1–2 s, neues Pflichtfeld **`scrollStop`** (exakter Scroll-Stop-Auslöser + Begründung), neues Pflichtfeld **`tension`** (Spannungsbogen inkl. Sekunde des Payoffs), **Szenenplan lückenlos MIT Sekunden**, **Sprechtext wenn sinnvoll**, Texteinblendungen 2–5, Caption, **maximal 5 Hashtags** (vorher 6–10 im Prompt!), CTA **nur wenn sinnvoll** (leerer String ausdrücklich erlaubt), Bild-/Videoideen unverändert. JSON-Schema + Beispiele beider Sprachen erweitert.
- **Parser:** `scrollStop`/`tension` optional geparst (alte Ergebnisse bleiben gültig, UI rendert keinen leeren Block); Hashtags hart auf **`MAX_TIKTOK_HASHTAGS = 5`** gekappt → die 5er-Grenze gilt deterministisch für **jede** Ausgabe, unabhängig vom Modell.
- **`conceptCompleteness`** erweitert: Hook vorhanden, **Szenenplan beginnt bei 0 s** (neue reine Funktion `timedSceneStartsAtZero`), mindestens ein Hashtag. Die Obergrenze 5 erzwingt der Parser (kein Retry dafür → kein Latenz-/Kostenrisiko).
- **UI (`tiktok.tsx`) + i18n (de/en):** neue Abschnitte `tiktok_result_scroll_stop` („Scroll-Stop-Moment (erste Sekunde)" / „Scroll-stop moment (first second)") und `tiktok_result_tension` („Spannungsbogen" / „Tension arc"), beide nur bei vorhandenem Wert; CTA-Block nur bei nicht-leerem CTA; Hashtag-Label nennt „(max. 5)". Keine hardcodierten UI-Texte.

### 1.3 Keine Platzhalter
- **Prompt (harte Regel, de + en):** verbietet generische Platzhalter (Owner-Beispiel `[Trendigen Sound hier einfügen]`, `Sound: <pick one>`, `TODO` …). Für Sound/Musik/Effekt gilt: **entweder** EINE konkrete, begründete Empfehlung **oder** den Punkt komplett weglassen.
- **Deterministisch:** `PLACEHOLDER_PATTERNS` (11 Muster: Klammer-/Spitzklammer-Anweisung, `[ … ]`, „hier einfügen", „dein Sound hier", „beliebiger/irgendein/any Sound", „Sound: beliebig/frei", TODO/TBD/XXX, „Platzhalter") + `placeholderViolations(ideaPlaceholderBlob(r))` als **Soft-Reject + Retry**; auf dem letzten Versuch entfernt **`placeholderFreeResult(result)`** die Platzhalter hart (idempotent; gibt bei Nichts-zu-tun dasselbe Objekt zurück) → **kein Platzhalter erreicht das UI**. Muster bewusst eng: eine konkrete Empfehlung wie „Sound: leiser Klavier-Loop, ca. 70 BPM" ist **kein** Treffer (Test C8f).

### 1.4 Randbedingungen (eingehalten)
- **Phase-1-Verhalten unverändert:** Nutzereingabe-Vorrang, Markenprofil EIN/AUS (`getBrandContext()`), `additionalContext`-Modell, Draft-vs-`?idea=`-Priorität — nicht angefasst. Diagnose-Pfad unverändert.
- **Usage (8.2) unverändert:** kein neuer Zähler, keine Änderung an der Guard-Kette; 1 fertiges Konzept = 1 Generierung (interne Retries wie bisher kostenlos).

---

## 2. Tests / Gates (alle EXIT 0)

| Gate | Ergebnis |
|---|---|
| **neu: `tiktok-concept-quality-test.ts`** | **126 PASS, 0 FAIL, EXIT 0** |
| `tiktok-phase1-test.ts` | 75 PASS, 0 FAIL |
| `tiktok-phase2-test.ts` | 90 PASS, 0 FAIL |
| `tiktok-phase3-test.ts` | 91 PASS, 0 FAIL |
| `tiktok-phase4-test.ts` | 75 passed, 0 failed |
| `tiktok-phase6-directions-test.ts` | 47 passed, 0 failed |
| `tiktok-diagnose-v2-test.ts` | 56 PASS, 0 FAIL |
| `brand-profile-test.ts` | 81 PASS, 0 FAIL |
| `usage-guard-test.ts` (echte Neon-Test-DB) | 31 PASS, 0 FAIL |
| `usage-semantics-test.ts` | 32 PASS, 0 FAIL |
| `stripe-webhook-test.ts` | 55 PASS, 0 FAIL (cleanup ok) |
| `improve-deadzone-test.ts` | 50 checks, 0 failed |
| **`bunx tsc --noEmit`** | **162 Fehler = Baseline, 0 NEU**; **0 Fehler** in `src/ai/tiktok.ts` und `src/routes/app/tiktok.tsx` |
| **`bash build-vercel.sh`** | **BUILD_EXIT=0** |
| i18n | Parität additiv: +2 Keys je Sprache (`tiktok_result_scroll_stop`, `tiktok_result_tension`) + Label „Hashtags (max. 5)" |
| ⚠️ pre-existing (unverändert) | `tiktok-test.ts` (Aggregator) EXIT=1 wegen `transport-regression-test.ts` FAIL 2 — identisch zur Baseline vor Phase 2, nicht durch Phase 2 verursacht |

**Neue Testabdeckung (Auszug):** Prompt-Parität de/en (Mandat, Selbstreferenz-Verbot/Beispiele, Anti-Werbe-Mandat, Platzhalter-Verbot, Scroll-Stop/Spannungsbogen/Szenenplan mit Sekunden/Sprechtext/Texteinblendungen/Caption im Schema und in den Regeln), Rotation + Katalog-Richtung nur ohne Nutzerthema (kein „Content-Richtung"-Leck im EN-Prompt), Struktur **aller** Owner-Felder in einem Engine-Lauf, Hashtag-Deckel 8 → 5 (erste fünf bleiben), Platzhalter-Erkennung + kein False Positive bei konkretem Inhalt, Platzhalter → Retry (2 Calls) und Endreinigung bei 4 Fehlversuchen, Selbstreferenz concept ohne Thema (Retry) vs. mit Nutzerthema (1 Call), Vollständigkeits-Checks inkl. 0 s-Start, `placeholderFreeResult` idempotent, i18n-Keys + UI-Verdrahtung (`tiktok_result_scroll_stop`/`_tension`, leerer CTA).

Reproduktion:
```
cd /home/team/shared/site
bun tiktok-concept-quality-test.ts                 # 126 PASS
bun --env-file=.env tiktok-phase1-test.ts          # 75 PASS   (ebenso phase2/3/4/6, diagnose-v2)
bun --env-file=.env brand-profile-test.ts          # 81 PASS
bun --env-file=.env usage-guard-test.ts            # 31 PASS   (usage-semantics 32, stripe-webhook 55)
bun --env-file=.env improve-deadzone-test.ts       # 50 checks, 0 failed
bash build-vercel.sh                               # BUILD_EXIT=0
```

---

## 3. Beispiel-Nachweis („personalisierte Tasse" / „minimalistischer Schmuck") — ehrlicher Status

**Echte LLM-Läufe waren in dieser Session NICHT möglich:** der lokale `OPENAI_API_KEY` aus `.env` antwortet mit
`HTTP 429 insufficient_quota — "You have no credits remaining"`. Der Produktions-Key liegt separat in Vercel und ist von hier nicht lesbar.
Vorbereitetes Harness (sofort lauffähig, sobald der Key Guthaben hat): `/tmp/p2-examples.ts` — 3 echte `generateTikTok`-Läufe
(mode=concept, de): A „personalisierte Tasse", B „minimalistischer Schmuck", C ohne Thema (Katalog-Rotation) mit Ausgabe von
Hook/Scroll-Stop/Spannungsbogen/Szenenplan mit Sekunden/Texteinblendungen/Sprechtext/Caption/Hashtags/CTA/Bildideen +
deterministischer Platzhalter-Prüfung.

**Was stattdessen deterministisch belegt ist** (Mock-Suite, ohne erfundene Inhalte): Der geforderte Ergebnisaufbau wird von der
Engine korrekt geparst, durch die Vollständigkeitsprüfung abgesichert und im UI gerendert — inkl. ≤5 Hashtags (harter Parser-Deckel)
und Platzhalterfreiheit (Erkennung + Retry + Endreinigung). Die qualitativen Owner-Beispiele „Tasse"/„Schmuck" (Test C) gehören laut
Plan zur **Phase 5 (Abnahme A–F)** und brauchen ein OpenAI-Guthaben — **Empfehlung an den Lead/Owner: Guthaben prüfen**.

---

## 4. Deployment (Stand: Session-Ende)

- **Commit + Push:** `1ef0f7e` auf `origin/master` (Code: `src/ai/tiktok.ts`, `src/routes/app/tiktok.tsx`, `src/i18n/de.ts`, `src/i18n/en.ts`, neu `tiktok-concept-quality-test.ts`).
- **Build:** `bash build-vercel.sh` → **BUILD_EXIT=0**.
- **Deploy:** Der Deploy-Befehl (`bunx vercel deploy --prebuilt --prod --yes --token <CLI-Token aus ~/.local/share/com.vercel.cli/auth.json>`, Projekt `site`) wurde gestartet, **die neue Deployment-URL und der curl-Status konnten innerhalb des Session-Budgets nicht mehr bestätigt werden** (Terminal-Sessions blockierten bei langen Kommandos). **Live-Check (neue URL + www) ist NICHT belegt — bitte nachziehen:**
```
cd /home/team/shared/site
bunx vercel deploy --prebuilt --prod --yes --token "$(python3 -c "import json;print(json.load(open('$HOME/.local/share/com.vercel.cli/auth.json'))['token'])")"
# danach: curl -o /dev/null -w '%{http_code}' -L <neue-url>/  sowie https://www.growimo.app/ und /app
```
- **Nicht Teil von Phase 2 / bewusst offen:** Phase 3 (Bild-Studio-Timeouts) und Phase 5 (Abnahme A–F) — nichts darüber hinaus geändert.

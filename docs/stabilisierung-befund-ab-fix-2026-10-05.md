# Befund A + Befund B — Fix, Deploy, Live-Belege (2026-10-05)

Repo: /home/team/shared/site (master) · Ziel: www.growimo.app (Production) · Mobile-Viewport 393×852 DPR 2
Ausgangsstand: `828a945` (origin/master == HEAD) · Fixes: `399f8f2` (Befund A), `0264fb0` (Befund B)

Getesteter synthetischer Nutzer (Wegwerf, NICHT das Owner-Konto):
`user_3KGLrQivAW698KVoR3vkZoJYMKU` (e2e-autosave-ttmbu@ctomail.io), intern `354ebec1-ef4b-4ebd-84b1-69e0a5ac0632`.

---

## 1. Ursachen

### Befund A — stiller Quota-Doppelverbrauch (monetarisierungsrelevant)
`src/routes/app/new-project.tsx`, Erfolgspfad **nach** `saveProject` (Zeilen ~475–514 vor dem Fix):
Nach dem Kanal-Stream wurden zusätzlich `marketing_analysis` und `market_intelligence` über
`generateContentServer` erzeugt. Jeder dieser Aufrufe läuft durch `withGenerationGuard`
(`src/lib/usage-guard.ts:200`) und **reserviert/verbraucht genau 1 Quota-Einheit**.
Gespeichert wurde davon nichts: `saveProject` lief bereits mit `contentTypes: selectedTypes` und
`generated.map(...)` = nur die gewählten Kanäle (nachgeprüft in `src/store/projects.ts:161`).
Die beiden Zusatz-Assets landeten ausschließlich per `setResults` im UI-State und waren nach einem
Reload weg — bezahlt, aber nicht ausgeliefert.

Damit galt: **1 Kanal = 3 Einheiten, 2 Kanäle = 4** statt 1 bzw. 2. Verstößt gegen das verbindliche
Preismodell „Strategie-Paket = 1 pro Kanal" und „1 Generierung = 1 fertiges Ergebnis".

Wichtig: der Stream-Pfad selbst ist korrekt — `src/ai/stream.ts:127-129` ruft **je Kanal genau einmal**
`withGenerationGuard` auf (`Phase 8.2 — Usage-Guard je Kanal`).

### Befund B — leere Seite nach der Generierung
`src/routes/app/new-project.tsx`, `Step2Results` (Zeile 1068 vor dem Fix):

```
{!isLoading && results.length > 0 && streamOrder.length === 0 && (   // ← Ergebnisliste
```

Der Fortschritts-Panel (`StreamProgressPanel`) rendert nur **solange** `isLoading` true ist, füllt aber
`streamOrder` (pro `step`-Event, Zeile 394) und **leert es nach dem Lauf nicht** (`setStreamOrder([])`
gibt es nur in `handleGeneration`-Reset Zeile 344 und `handleReset` Zeile 622).
Nach Abschluss des Streams war also: `isLoading=false`, `results` gefüllt, `streamOrder.length > 0`
→ **weder** Fortschritts-Panel **noch** Ergebnisliste wurden gerendert. Der Stream-Pfad ist der
Default (`growimo_stream_generate` = '1', Zeile 47-55) → betraf **Mobile UND Desktop**, nicht nur mobil.

---

## 2. Fixes

- `399f8f2` — der komplette Auto-Generierungs-Block entfernt (inkl. Market-Intelligence-Teil). Ein
  Strategie-Lauf verbraucht jetzt exakt so viele Einheiten wie gewählte Kanäle.
- `0264fb0` — Zusatzbedingung `streamOrder.length === 0` aus der Ergebnis-Renderbedingung entfernt
  (der Fortschritts-Panel ist ohnehin über `isLoading` abgedeckt; die Bedingung war ein Überrest).

Beide Änderungen sind Kommentar + Bedingung/Block — keine andere Datei angefasst. Ansonsten unverändert:
Dashboard (`src/routes/app/index.tsx` lädt Analyse-Projekte aus der DB), `ProjectIntelligence.tsx`,
`content-library`, `calendar`, `$projectId.tsx`, OpenAI-Prompts (`marketing_analysis`/`market_intelligence`
bleiben vollständig), `AnalysisDashboard`-Renderzweig in `new-project.tsx` (wird von dort jetzt nur nicht
mehr erreicht, bleibt aber für andere Zustände bestehen).

---

## 3. Live-Reproduktion auf dem UNGEFIXTEN Build (vor dem Deploy)

Ablauf: `scripts/_mobile-e2e/10-prefix-1kanal.sh` — Mobile 393×852, **genau eine** Kachel gewählt
(Etsy), Idee „Handgemachte Keramiktassen mit Sprenkelglasur". Zähler vorher per
`scripts/_mobile-e2e/reset-usage.ts` auf 0 gesetzt (`before: [{period:"2026-10",count:5}] → after: []`).

Belege (Roh-Log `/tmp/ba-prefix-run.log`):

| Beobachtung | Wert |
|---|---|
| Auswahl | `{"count":"1 ausgewählt","selected":["✓🛍️Etsy…"],"ctaDisabled":false}` |
| während des Streams | `POLL {"i":6,"spin":1,"len":13430}` (Fortschritts-Panel + Etsy-Karte) |
| direkt nach dem Lauf | `POLL {"i":7,"spin":0,"len":245}` → **Seite leer** |
| Seite danach (Volltext) | `bodyLen: 245`, `generiertSpans: 0`, Text = nur Navigation + „E2E Autosave / Abmelden / 5 von 5 Generierungen verbleibend / 💬 Feedback" |
| Screenshot | `docs/mobile-e2e/ba-prefix-t0.png` (Auswahl: `ba-prefix-auswahl.png`) |

**Befund A belegt** (DB, `scripts/_autosave-e2e-count.ts`, Roh-JSON `/tmp/babfix/count-prefix-after.json`):

```json
{ "projectRows": 2, "contentRows": 3,
  "perProject": [ {"id":"e71d5beb-…","contents":1} ],
  "usage": [ {"period":"2026-10","count":3} ] }
```

→ **1 gewählter Kanal, aber 3 verbrauchte Einheiten**; im Projekt liegt **1** Inhalt (Etsy).
Die zwei zusätzlich bezahlten Assets (Analyse + Markt) existieren in der DB nicht.

**Befund B belegt**: nach Abschluss derselben Generierung ist `/app/new-project` inhaltsleer
(245 Zeichen), obwohl Projekt + Inhalt korrekt in der DB liegen — exakt der Befund aus
`docs/mobile-e2e/m02-strategie-leer.png`.

---

## 4. Gates (HEAD `0264fb0` vs Baseline `828a945`)

| Gate | Ergebnis | Beleg |
|---|---|---|
| `bunx tsc --noEmit -p tsconfig.gate.json` | **53 normalisierte Fehlerzeilen in HEAD = 53 in BASE, Diff in beide Richtungen leer → 0 neue Fehler.** In `new-project.tsx` genau 1 Fehler, wortgleich auch in der Baseline (`TS6133 AnalysisPlaceholder declared but never read` — vorbestehend) | `/tmp/babfix/tscdiff.txt` |
| `bun i18n-scan.ts` | Beide Läufe identisch im Kopf: 1578/1578 Keys, `KEY-PARITY ✅`, `USED-KEYS tiktok_result_` (vorbestehend), `DE-VALUES 5`, `EN-VALUES ✅`, `SERVER-LIT 359 = 359`, `RESULT: MIXING FOUND` (**vorbestehend, unverändert**) | `/tmp/babfix/base-i18n.log` vs `/tmp/babfix/head-i18n.log` |
| Suite `improve-deadzone-test` | 50 Checks PASS, exit 0 | `/tmp/babfix/suites.log` |
| Suite `varianten-scoring-konsistenz-test` | 88 Checks PASS, exit 0 | ″ |
| Suite `package-fakten-schutz-test` | 66 PASS / 0 FAIL, exit 0 | ″ |
| Suite `package-autosave-test` | 41 passed / 0 failed, exit 0 | ″ |
| Suite `usage-guard-test` (Free/Pro/Owner-Override, echte DB) | exit 0 | ″ |
| Suite `stabilisierung-phase41/-phase43/-schritt3/-schritt4` | exit 0 | ″ |
| Suite `usage-semantics-test` | 31 PASS / 1 FAIL — **derselbe eine FAIL auch in der Baseline** (`Bild (image-studio.tsx): withGenerationGuard (1 Bild = 1)`, ein Source-Grep-Check) → **keine Regression** | `/tmp/babfix/base-suites.log` |
| Suite `strategy-image-test` | 1 FAILURES — **derselbe FAIL auch in der Baseline** (`strategyImage declared before render`; prüft `src/routes/app/projects/$projectId.tsx`, von mir nicht angefasst) → **keine Regression** | ″ |
| Suite `transport-regression-test` | exit 1 **auch in der Baseline** (benötigt `dist/server/server.js` / eine Session) → **keine Regression durch diesen Fix**; T4b/i18n-Subchecks betreffen nicht `new-project` | ″ |

`bunx tsc` normalisiert (Skill `gate-baseline-vergleich`): Zeilen-/Spaltennummern entfernt,
`dist/server/server.js`-Artefakt gefiltert. Baseline-Kopie per `git archive 828a945` in `/tmp/base`.

---

## 5. Regressions-Check der anderen Nutzer von marketing_analysis / market_intelligence

- Erzeugung bleibt unverändert in `src/ai/providers/openai.ts` (Prompts `:416` / `:526`, Sonderfälle
  `:694` / `:745`, Token-Limits `:858-859`) und `src/ai/content-types.ts:69/:76`.
- Anzeige/Lesen unverändert: `src/routes/app/index.tsx` (Dashboard, lädt Analyse-Projekte aus der DB,
  `:402/:417`), `src/components/ProjectIntelligence.tsx:119-135`, `src/routes/app/content-library.tsx:29-30`,
  `src/routes/app/calendar.tsx:44-45`, `src/routes/app/projects/$projectId.tsx:32-33`.
- **Keiner dieser Orte hing an der new-project-Auto-Generierung**: die dort erzeugten Assets wurden nie
  gespeichert (Abschnitt 1), waren also für DB-lesende Oberflächen unsichtbar. `AnalysisPlaceholder`
  in `new-project.tsx` war bereits vorher ungenutzt (Baseline-tsc-Fehler).
- Nachweis: die vier Suites `package-fakten-schutz`, `package-autosave`, `stabilisierung-phase43`,
  `varianten-scoring-konsistenz` laufen unverändert grün (Abschnitt 4); die Live-Läufe in Abschnitt 3
  (ungefixt) und 6 (gefixt) erzeugen Projekte mit exakt 1 Inhalt pro gewähltem Kanal.

---

## 6. Deploy + Prod-Bundle-Beleg (beide Fixes)

**Deployment:** `bash build-vercel.sh && bunx vercel deploy --prebuilt --prod --yes` aus `0264fb0`
(Build rc=0) → **https://site-doqf7u5f2-growimo.vercel.app** (Projekt `site`, Alias `www.growimo.app`;
Datenpunkt: Vercel-Deploy-Doku im Log `/tmp/babfix/deploy.log`). Der Rollout stellt exakt den Prebuilt
aus: Route-HTML `https://<deploy>/app/new-project` liefert `http=200` und referenziert
`/assets/new-project-BZHinmKs.js` — derselbe Dateiname wie im lokalen Prebuilt
`.vercel/output/static/assets/new-project-BZHinmKs.js`
(SHA-256 `0339186ba4e3575773e5171d27f68e9b78f891ebd6c8347fc321046ab70bb014`).

| Marker | Chunk VOR dem Fix (Prebuilt des Vorgänger-Builds, `new-project-DSJqxvfa.js`, SHA-256 `f083c95f…`) | Chunk NACH dem Fix (`new-project-BZHinmKs.js`) |
|---|---|---|
| **Befund A**: Literal `GENERIERTE INHALTE ZUR ANALYSE` (nur im entfernten Block) | vorhanden, Byte-Offset **60446** (`grep -aob -F`) | **0 Treffer** — String existiert nicht mehr |
| **Befund B**: Bedingung der Ergebnisliste | `!s&&l.length>0&&c.length===0&&e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-blue-100 bg-blue-50/50 …","children":[p.results_consistency_prefix …` | `!s&&l.length>0&&e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"mb-6 flex flex-wrap …","children":[p.results_consistency_prefix …` |

Beide Marker sind **in beide Richtungen** belegt (alt: vorhanden, neu: weg) und die Fenster wurden aus
den minifizierten Chunks selbst extrahiert (`/tmp/babfix/winB.txt`, `/tmp/babfix/old-markerA.txt`).

## 6b. Live-Nachweis nach dem Deploy — NICHT abgeschlossen (ehrlich)

Der geplante Post-Fix-Live-Lauf (`scripts/_mobile-e2e/11-postfix.sh`: 1-Kanal- und 2-Kanal-Strategie auf
dem gefixten Build mit DB-Zähler vorher/nachher) ist **nicht durchgelaufen**: das öffnende
`agent-browser --session growimo-mobile open …` des ersten Durchgangs kehrte nicht zurück (hängende
Session/Serialisierung), der Lauf wurde im Budget abgebrochen (Log `/tmp/ba-postfix-run.log` enthält nur
die RUN-Kopfzeile). **Damit ist die DoD-Nummer 6 (Live-Zähler-Beweis 1 bzw. 2 Einheiten auf dem
gefixten Build) OFFEN.** Nicht behauptet wird, dass der gefixte Lauf live 1 bzw. 2 Einheiten kostet.

Was stattdessen für Befund A belegt ist (stärker als eine Zählung, aber kein Ersatz dafür):
1. Der einzige Aufrufer der Zusatz-Generierungen ist nachweislich aus dem ausgelieferten Bundle entfernt
   (Abschnitt 6, Marker-Zeile A) — der KI-Aufruf kann also nicht mehr stattfinden.
2. Der Stream-Pfad selbst verbraucht belegbar 1 Einheit pro Kanal: `src/ai/stream.ts:127-129`
   (`withGenerationGuard` je Kanal, Code-Beleg) und Suite `usage-semantics-test` PASS-Zeile
   „Strategie-Stream (stream.ts): je Kanal 1× withGenerationGuard (1/Kanal)".
3. Der ungefixte Zustand wurde live gemessen (Abschnitt 3: 1 Kanal = 3 Einheiten) — die Differenz ist
   damit eine gemessene Vorher-Zahl mit belegter Ursache, aber die Nachher-Zahl fehlt.

Hinweis zum Testnutzer: `usage_monthly` von `user_3KGLrQivAW698KVoR3vkZoJYMKU` (synthetischer
Wegwerf-Nutzer, NICHT das Owner-Konto) wurde vor dem Post-Fix-Lauf erneut per
`scripts/_mobile-e2e/reset-usage.ts` auf 0 gesetzt; der Zähler steht danach auf dem Stand des
abgebrochenen Versuchs.

**Wiederaufnahme (wenige Minuten):**
```bash
cd /home/team/shared/site
bun --env-file=.env scripts/_mobile-e2e/reset-usage.ts user_3KGLrQivAW698KVoR3vkZoJYMKU
agent-browser --session growimo-mobile open "https://www.growimo.app/app/new-project"   # Session frisch aufwecken
bash scripts/_mobile-e2e/11-postfix.sh    # 1-Kanal dann 2-Kanal, druckt die DB-Zähler selbst mit
```
Erwartung: Zähler 0 → **1** nach dem 1-Kanal-Lauf, → **3** nach dem 2-Kanal-Lauf, und
`bodyLen`/`generiertSpans` > 0 mit Screenshot (Ergebnisse sichtbar).

## 7. Ehrliche Abgrenzung

- Die Bild-Generierung (gpt-image-1) wurde in diesem Lauf **nicht** getestet; über das Live-OpenAI-Bildguthaben
  ist hier nichts ausgesagt.
- `transport-regression-test` und die zwei vorbestehenden Suite-FAILs sind in dieser Umgebung nicht heilbar
  und deshalb nur als „bereits in der Baseline rot" abgegrenzt, nicht als „geprüft grün".

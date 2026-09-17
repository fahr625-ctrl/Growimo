# Phase 8.4d — Zwei UX-Fixes aus dem F2-E2E-Befund (Dead Zone + Delta-Copy)

**Autor:** engineer · **Datum:** 2026-09-17 · **Basis:** F2-E2E-Klick-Through-Session (`e2e-f2-verbessern-clickthrough-evidence.md`, Commit-Basis `6c6bd9e`)
**Scope:** ausschließlich die zwei im Auftrag genannten UX-Befunde. Keine Änderung an Scoring, Improve-Engine, Usage-Zählung, DB, Stripe oder Auth.
**Beta/Produktlogik:** unverändert (Free 5 / Pro 200; Verbessern = 0 Generierungen).

---

## 1. Befund 1 — „Dead Zone" beim Verbessern (70–89 ohne offene Punkte / ≥90)

### Vorher (gemessen in der E2E-Session)
| Score | offene Punkte | `⚡ Verbessern` | `✨ Auf 80+ verbessern` | Ergebnis |
|---|---|---|---|---|
| 84/100 | 2 | ✅ sichtbar | ✗ (≥80) | ok |
| 88/100 | **0** | ✗ (`score < 90` UND `issues > 0`) | ✗ (`score < 80`) | **nichts — Karte ohne nächsten Schritt** |

DOM-Messung der E2E-Session: `{"btns":["88/100Warum dieser Score?"],"hasVerbessern":false,"hasAuf":false}`.

### Gewählte Lösung (begründet)
**Ehrliche UI-Aussage statt Schein-Button.** Die Engine kann in diesem Fall nichts tun: `improveByScore` filtert die Fixes (`fix.action !== 'keep'`), und bei 0 Fixes kehrt sie **vor** jedem LLM-Aufruf mit `reason: 'no_issues'` zurück (im Test belegt, Abschnitt 4). Ein „Verbessern"-Button dort wäre eine falsche Zusage: er würde klicken lassen und danach „Keine offenen Punkte" zeigen — ohne jede Änderung. Deshalb:

1. **`score >= 80` mit 0 offenen Punkten** → Hinweis **„Bereits stark — %d/100, keine offenen Punkte"** + Erklärtext (Inhalt ist so verwendbar; für einen anderen Zuschnitt mit konkreteren Vorgaben neu generieren).
2. **`score >= 90` mit offenen Punkten** (gleiche Klasse von Dead Zone, bisher ebenfalls ohne jede Aktion am Header, da `canImprove` `score < 90` verlangt und die Engine ab 90 bewusst nicht mehr überarbeitet) → Hinweis **„Bereits im Top-Bereich — %d/100"** + Erklärung, dass ab 90/100 keine automatische Überarbeitung mehr erfolgt, damit starke Abschnitte nicht verschlechtert werden; die gelisteten Punkte sind optional.

Beide Hinweise erscheinen nur, wenn **kein anderer Zustand** spricht (kein Lauf aktiv, kein Delta-Banner, kein Fehlerbanner) → keine Doppelmeldung. Karten ohne Asset (reine Anzeige) zeigen keinen Hinweis.

**Nicht** geändert: `canImprove` (issues > 0 UND score < 90), `canImproveToTarget` (score < 80), `ALREADY_STRONG_TOTAL = 90`, `IMPROVE_TARGET_DEFAULT = 80`, Improve-Engine, Usage-Zählung (Improve = 0 Generierungen).

### Umsetzung
- **Neu:** `src/components/scoreCardActions.ts` — reine, React-freie Entscheidungslogik (`resolveScoreCardActions`, `improveDeltaTitleKey`, `ALREADY_STRONG_TOTAL`), damit die Regeln ohne Renderer testbar sind.
- **`src/components/ScoreCard.tsx`** — nutzt die Funktion für `canImprove` / `canImproveToTarget` (identische Ausdrücke) und rendert die zwei Hinweis-Streifen direkt unter der Score-Zusammenfassung (sichtbar auch im eingeklappten Zustand).
- **i18n** (`src/i18n/de.ts` + `en.ts`, je 6 neue Keys, Parität 1472 = 1472):
  - `score_strong_no_actions` / `score_strong_no_actions_desc`
  - `score_top_range_no_actions` / `score_top_range_no_actions_desc`

## 2. Befund 2 — Copy-Inkonsistenz im Verbessern-Ergebnis

### Vorher
Der Delta-Banner titelte **immer** `improve_delta_title` = „QUALITÄT GESTEIGERT" — auch beim gemessenen Fall **`84 → 84 ±0`** („Stark und unverändert übernommen: Titel, Länge, Bild").

### Nachher
`improveDeltaTitleKey(delta)` wählt den Titel nach dem echten Delta:
| Delta | Titel (de) | Titel (en) |
|---|---|---|
| `> 0` | `improve_delta_title` = „Qualität gesteigert" | „Quality improved" |
| `= 0` | **`improve_delta_title_flat` = „Details geprüft — Score unverändert"** | **„Details reviewed — score unchanged"** |
| `< 0` | **`improve_delta_title_down` = „Überarbeitet — Score gesunken"** | **„Reworked — score decreased"** |

Der Score-Chip (`84 → 84 ±0`) und die übrigen Zeilen des Banners bleiben unverändert; nur die Erfolgsbehauptung verschwindet, wo keine ist.

## 3. Tests & Gates

| Gate | Befehl | Ergebnis |
|---|---|---|
| TypeScript | `bunx tsc --noEmit` | **vorher 163 Fehler / EXIT 2 → nachher 163 Fehler / EXIT 2 → 0 NEUE Fehler** |
| Neue Regressions-Suite | `bun --env-file=.env run improve-deadzone-test.ts` | **EXIT 0 — 50 Checks, 0 FAIL** (Dead Zone 80–89/≥90, Button-Regeln unverändert, Delta-Titel, i18n de/en, Engine-Kosten) |
| i18n-Scan | `bun --env-file=.env run i18n-scan.ts` | KEY-PARITY **1472 = 1472 ✅**, USED-KEYS ✅, HARDCODED ✅. EXIT 1 durch **2 vorbestehende** DE-VALUES-Funde (`usage_limit_exhausted`, `brand_website`, unverändert in `HEAD`) — i18n-Diff ist rein additiv (12 Zeilen hinzu, 0 gelöscht) |
| usage-guard-test | `bun --env-file=.env run usage-guard-test.ts` | **EXIT 0 — 31 PASS, 0 FAIL** |
| usage-semantics-test | `bun --env-file=.env run usage-semantics-test.ts` | **EXIT 0 — 32 PASS, 0 FAIL** |
| stripe-webhook-test | `bun --env-file=.env run stripe-webhook-test.ts` | **EXIT 0 — 55 PASS, 0 FAIL** |
| tiktok-diagnose-v2-test | `bun --env-file=.env run tiktok-diagnose-v2-test.ts` | **EXIT 0 — 56 PASS, 0 FAIL** |
| Build | `bash build-vercel.sh` | **BUILD_EXIT=0** („.vercel/output ready for: vercel deploy --prebuilt") |

### Was die neue Suite absichert
- **Dead Zone geschlossen:** 88/100 + 0 Punkte → kein Button (unverändert), aber Hinweis `showStrongNoActionHint = true`.
- **Keine Regression an den Buttons:** 84/100 + 2 Punkte → beide Wege wie vorher; 72/100 + 0 Punkte → „Auf 80+"; 79/100 + 1 Punkt → beide.
- **Grenzen:** 80 (inkl.) und 89 → Hinweis aktiv, 79 → inaktiv; 90 + 1 Punkt → Top-Bereich-Hinweis; 96 + 0 Punkte → „Bereits stark".
- **Keine Doppelmeldung:** während eines Laufs / nach Lauf (`hasOutcome`) / nach Fehler → Hinweis aus; Retry-Bedingung unverändert.
- **Copy:** ±0 nutzt ausdrücklich **nicht** `improve_delta_title`; −3 bekommt den eigenen Titel.
- **i18n:** alle 6 neuen Keys in de **und** en, `%d`-Platzhalter vorhanden, de ≠ en.
- **Kosten:** `improveByScore(88/100, 0 offene Punkte)` → `reason: 'no_issues'`, kein LLM-Lauf, Delta 0, Inhalt unberührt (belegt, dass Verbessern = 0 Generierungen bleibt).

## 4. Deploy & Live-Check

**Commit:** `42ff03d` — `fix(improve): Dead Zone 80-89 ohne offene Punkte + Delta-Copy nur bei echter Steigerung` (HEAD == origin/master, gepusht).

**Deployment:** `bunx vercel deploy --prebuilt --prod --yes` (Projekt `site`)
- Neue Deployment-URL: **https://site-hu5glif8a-growimo.vercel.app** (DEPLOY_EXIT=0, „Ready in 10s")
- Alias: **https://www.growimo.app** („▲ Aliased https://www.growimo.app")
- Inspect: https://vercel.com/growimo/site/5upWuohKW9G6TxiuaL6rWY9GnKtn

**Live-Check (curl, HTTP-Codes):**
```
https://site-hu5glif8a-growimo.vercel.app/ -> 200
https://www.growimo.app/ -> 200
https://www.growimo.app/app -> 200
https://growimo.app/ -> 200
```

**Bundle-Beleg (Fix ist im ausgelieferten Prod-Bundle):**
```
asset:
```

## 5. Grenzen / Nicht angefasst
- Keine Änderung an Improve-Engine (`src/ai/improve.ts`), Scoring, Usage-Guard, DB, Stripe, Auth, Preisen.
- Kein „unbegrenzt"-Verhalten, keine neuen LLM-Aufrufe: beide Fixes sind rein clientseitige Logik/Text (Kostenschutz unverändert).
- Synthetische Test-/E2E-Nutzer unberührt; keine Secrets im Dokument.

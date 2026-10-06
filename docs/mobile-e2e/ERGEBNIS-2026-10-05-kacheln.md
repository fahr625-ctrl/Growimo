# Kachel-Vereinfachung „Neue Strategie" — Evidence (2026-10-06)

Owner-Direktion vom 2026-10-05: sichtbare Auswahl im Strategie-Flow auf **genau 6 Kacheln** reduzieren
(Pinterest, Etsy, Social Media, Marketing-Strategie, Content, Produktideen); SEO-Blog + E-Mail-Newsletter
unter „Content" zusammenfassen; Trends/Analyse/Markt **nicht löschen**, sondern intern weiter nutzen.

- Commit: **`a37c255`** (origin/master == HEAD, Push verifiziert)
- Deploy: `site-mrc81itcl-growimo.vercel.app` → Alias **www.growimo.app** (Prebuilt-Deploy, 2. Versuch nach
  transientem „Not authorized", `DEPLOY2_EXIT=0`)
- Testnutzer: `user_3KGLrQivAW698KVoR3vkZoJYMKU` (Free, 5/Monat), Mobile **393×852 DPR 2**

## 1. Umsetzung

| Was | Datei | Kern |
|---|---|---|
| Kachel-Definition + reine Mapping-Funktionen | `src/ai/strategy-tiles.ts` (neu) | `STRATEGY_TILE_CONFIG` (6 Kacheln ↦ echte `ContentType`s), `toggleStrategyTile`, `normalizeStrategySelection`, `selectedStrategyTileCount`, `strategyResultCount`, Marker `growimo-strategy-tiles-v1` |
| Render-Schleife | `src/routes/app/new-project.tsx` | `STRATEGY_TILE_CONFIG.map(...)` statt `CONTENT_TYPE_REGISTRY.map(...)`; Klick = `toggleTile(tile)`; Grid `grid-cols-2 sm:grid-cols-3`; `data-strategy-tile`/`data-strategy-tiles` |
| Zähler + Kosten | ebd. | „X von 6 ausgewählt · Y Ergebnisse" + CTA-Zeile „Erstellt Y Ergebnisse in diesem Lauf"; Content-Kachel Badge „2 Ergebnisse" |
| Kanonisierung | ebd. | Draft-Restore + `growimo_default_types` werden auf wählbare Typen gefiltert (alte Entwürfe mit `trend_insight` u. a. können Zähler/Kosten nicht mehr unsichtbar verfälschen) |
| i18n | `src/i18n/de.ts`, `src/i18n/en.ts` | 17 neue Keys, KEY-PARITY grün |
| Prompt-Härtung (interne Markt-/Trend-Nutzung) | `src/ai/providers/openai.ts` | Abschnitt 2 (USP) des `marketing_plan`-Prompts um 2–3 Sätze Markt- und Trend-Einordnung ergänzt — **keine** neue Sektion, **kein** zusätzlicher KI-Call, **keine** zusätzliche Usage-Einheit |
| Regressionstest | `strategy-tiles-test.ts` (neu) | 72 Checks, 0 FAIL |

`CONTENT_TYPE_REGISTRY`, Prompts für `trend_insight`/`marketing_analysis`/`market_intelligence`,
DB-Constraint, Dashboard-/`ProjectIntelligence`-/Content-Library-/Calendar-Lesepfade: **unverändert**
(`git diff --name-only a37c255~1..a37c255` enthält nur die 6 Dateien oben).

### Interne Nutzung von Trends/Analyse/Markt — Ist-Stand (ehrlich)
- `trend_insight`/`marketing_analysis`/`market_intelligence` bleiben vollständig im Code und in der DB;
  sie sind nur nicht mehr wählbar (kein Kachel-Eintrag mehr).
- **Trends**: der `product_idea`-Prompt fordert bereits einen „echten, beobachtbaren Trend" ein → die
  Trend-Perspektive steckt in der Produktideen-Kachel (unverändert, keine Ergänzung nötig).
- **Markt/Analyse**: `marketing_analysis` analysiert vorhandenen Content und wird nie im Strategie-Lauf
  miterzeugt (Befund-A-Fix vom 2026-10-05: genau das wäre stiller Zusatzverbrauch). Der Markt-Blick ist
  jetzt additiv im `marketing_plan`-Prompt verankert; eine 1:1-Reproduktion der `market_intelligence`-Sektionen
  (Nachfrage/Wettbewerb/SWOT) im Marketing-Plan findet **nicht** statt — bewusst, weil das (a) die
  Token-Grenze des Plans (2000) sprengen würde und (b) nur als eigener, separat bezahlter Lauf sinnvoll ist.
  Der `market_intelligence`-Prompt selbst bleibt unverändert nutzbar (Analyse-Pfade bestehen).

## 2. Gate-Suite (gegen Baseline `cf72d9e`, Kopie in `/tmp/base`, nichts im Arbeitsbaum angefasst)

| Gate | Baseline | HEAD | Bewertung |
|---|---|---|---|
| `bunx tsc --noEmit -p tsconfig.gate.json` | 53 Fehlerzeilen | 53 Fehlerzeilen | **kein neuer, keiner verschwunden** (`comm -13`/`-23` leer) |
| `i18n-scan.ts` KEY-PARITY | ✅ (1578/1578) | ✅ (1595/1595) | Parität gehalten |
| `i18n-scan.ts` UI HARDCODED | ✅ | ✅ | keine neuen Literale |
| `i18n-scan.ts` DE-VALUES / EN-VALUES | ❌ 5 / ✅ | ❌ 5 (dieselben 5) / ✅ | unverändert |
| Suiten | siehe unten | siehe unten | keine Regression |
| `strategy-tiles-test.ts` | — | **72 PASS / 0 FAIL** | neu |

Suiten (HEAD, aus der Repo-Wurzel): `stabilisierung-phase41-test` 47/0 · `stabilisierung-phase43-test` 111/0 ·
`stabilisierung-schritt3-test` ALL PASS · `stabilisierung-schritt4-test` ALL PASS ·
`varianten-scoring-konsistenz-test` 88/0 · `improve-deadzone-test` 50/0 ·
`strategy-image-collapsed-test` ALL PASS · `package-fakten-schutz-test` 118/0.
**Vorbestehend rot (identisch in der Baseline `/tmp/base` nachgestellt):** `stabilisierung-phase3-test`
(„3.1 ServerFn erhält das AbortSignal"), `stabilisierung-phase4-test` („T10f Paket-Route sendet
getBrandContext() mit"), `strategy-image-test` (1 FAIL), `usage-semantics-test`
(„Bild (image-studio.tsx): withGenerationGuard") — die geprüfte Datei `image-studio.tsx` ist von diesem
Commit nicht angefasst (`git diff --name-only cf72d9e -- src/routes/app/image-studio.tsx src/components` = 0).

## 3. Prod-Bundle-Beleg (Skill `prod-bundle-marker-proof`)

Abruf über `https://www.growimo.app/app/new-project` (HTTP 200), Chunks gezogen und gehasht:

| Chunk | Größe | SHA-256 | Marker (Byte-Offset) |
|---|---|---|---|
| `new-project-BDcYfilJ.js` | 86 111 B | `135e45cdc39c67db6fd73a740f79468ca47c9b1dad52a9e4fb17f6344081cc84` | `growimo-strategy-tiles-v1` 54796 · `data-strategy-tile` 69442 · `strategy_tile_pinterest` 54853 · `strategy_tile_content_desc` 55400 · `strategy_tiles_selected` 68805 · `strategy_cta_results_plural` 71214 |
| `index-BkZZsp1v.js` | 610 383 B | `8a3c2bb5d5473b8861b6c68901521860a6d6b7886a495f259c2f346c7ccafb20` | `strategy_tile_pinterest` 418768 · `strategy_tile_content` 419221 · `Erstellt %d Ergebnisse in diesem Lauf` 419677 |
| `.vercel/output/functions/render.func/index.mjs` (Server) | 4 616 529 B | `155dad310fb53f7a887ac32d3a6fea56a097b14c68e0be66ca41b9fe68a6f0e7` | `Markt- und Trend-Einordnung` 2093174 + 4456248 |

Gegenprobe Baseline `cf72d9e`: `strategy_tile_pinterest` 0 Treffer, `STRATEGY_TILE_CONFIG` 0 Treffer,
`Markt- und Trend-Einordnung` 0 Treffer ⇒ die Strings können nur aus `a37c255` stammen.

## 4. Live-Belege Mobile 393×852 (Session `kacheln-mobile`, kein Vercel-Checkpoint: `cp:false`)

Lauf `scripts/_mobile-e2e/20-kacheln-mobile.sh`, Log `/tmp/kacheln-mobile.log`.

| Prüfung | Messwert | Status |
|---|---|---|
| Login Testnutzer | `url:/app`, `uid/user_3KGLrQivAW698KVoR3vkZoJYMKU` | PASS |
| Genau 6 Kacheln | `tiles:[pinterest,etsy,social,marketing,content,ideas]` | PASS |
| Kachelnamen (Owner-Wortlaut) | `📌 Pinterest` · `🛍️ Etsy` · `📱 Social Media` · `📊 Marketing-Strategie` · `📝 Content` · `💡 Produktideen` | PASS |
| Keine Alt-Kacheln | `legacyTile:false` (kein „Trend-Analyse"/„Market Intelligence"/„KI-Analyse"-Tile) | PASS |
| Marker sichtbar | `gridMarker:growimo-strategy-tiles-v1`, `gridCount:6` | PASS |
| Kein horizontales Scrollen | `scrollW:378 ≤ innerW:393` | PASS |
| Content-Kachel ehrlich bepreist | Kacheltext endet mit `2 Ergebnisse` (`badge2:true`) | PASS |
| Klick „Content" | `TILES_NACH_AUSWAHL` zeigt `✓ … Content … 2 Ergebnisse`, `ctaDisabled:false`, CTA-Hinweis **„Erstellt 2 Ergebnisse in diesem Lauf"** | PASS |
| Generierung gestartet | `CTA: CLICKED` (Ergebnis/DB-Zahlen: siehe unten) | läuft/offen |

Screenshots: `m20-kacheln-mobil-auswahl.png` (Auswahl), `m21-kachel-content-2-ergebnisse.png`
(ausgewählte Content-Kachel + CTA-Hinweis).

## 5. Ehrliche Abgrenzung (was fehlt)

1. **DB-Gegenprobe für den Content-Lauf** (Projekt mit `[seo_blog,email_newsletter]`, `usage_monthly.count = 2`)
   und die Screenshots Ergebnis-/Projektseite: der Lauf war bei Budgetende noch in der Generierung; Log-Tail
   im Nachtrag unten.
2. **Desktop-Viewport** (`d30-kacheln-desktop.png`) und die übrigen 5 Einzelkachel-Läufe
   (Pinterest/Etsy/Social/Marketing/Produktideen) wurden **nicht** gefahren. Vorbereitet als
   `scripts/_mobile-e2e/21-kacheln-rest.sh` (Desktop 1440×900 + 5 Läufe mit DB-Delta je Kachel +
   Bestandsprojekt-Check über `kacheln-legacy-project.ts`); Aufruf:
   `bash scripts/_mobile-e2e/21-kacheln-rest.sh` (Ticket: `bun --env-file=.env /tmp/mint-kacheln.ts`-Muster).
   Die Kachel→Typ-Zuordnung dieser 5 Kacheln ist durch `strategy-tiles-test.ts` abgedeckt, aber **nicht live**
   geklickt/generiert.
3. **Bestandsprojekt mit `trend_insight`/`marketing_analysis`/`market_intelligence`** wurde nicht live geöffnet
   (Skript liegt bereit). Code-seitig unverändert — kein Lesepfad angefasst.
4. Der Zähler „X von 6 ausgewählt" konnte im DOM nicht als eigenes Element ausgelesen werden (der
   `span`-Scan traf zuerst den Produktdetails-Hinweis); belegt sind CTA-Hinweis und Kachel-Badge.
   Ein zusätzlicher `data-testid` für die Zählerzeile wäre der nächste kleine Schritt.

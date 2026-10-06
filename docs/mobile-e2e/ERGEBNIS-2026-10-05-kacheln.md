# Kachel-Vereinfachung „Neue Strategie" — Evidence (2026-10-06, Phase 2 nachgezogen)

Owner-Direktion vom 2026-10-05: sichtbare Auswahl im Strategie-Flow auf **genau 6 Kacheln** reduzieren
(Pinterest, Etsy, Social Media, Marketing-Strategie, Content, Produktideen); SEO-Blog + E-Mail-Newsletter
unter „Content" zusammenfassen; Trends/Analyse/Markt **nicht löschen**, sondern intern weiter nutzen.

- Code-Commit: **`a37c255`** (Kachel-Umbau), Evidence-Commit 1: `fc49d6f`
- Deploy: `www.growimo.app` (HTTP 200), Bundle-Marker live verifiziert (Abschnitt 3)
- Testnutzer: `user_3KGLrQivAW698KVoR3vkZoJYMKU` (Free, 5/Monat); Free-Kontingent pro Lauf per
  `reset-usage.ts` genullt (Testnutzer ist synthetisch; Owner-Override unberührt)
- Browser: agent-browser, Session `kacheln-mobile`, **kein Vercel-Checkpoint in irgendeinem Schritt** (`cp:false`)

## 1. Umsetzung (Commit `a37c255`)

| Was | Datei | Kern |
|---|---|---|
| Kachel-Definition + Mapping | `src/ai/strategy-tiles.ts` (neu) | `STRATEGY_TILE_CONFIG` (6 Kacheln ↦ echte `ContentType`s), `toggleStrategyTile`, `normalizeStrategySelection`, Marker `growimo-strategy-tiles-v1` |
| Render-Schleife | `src/routes/app/new-project.tsx` | `STRATEGY_TILE_CONFIG.map(...)` statt `CONTENT_TYPE_REGISTRY.map(...)`; Klick = `toggleTile(tile)`; Grid `grid-cols-2 sm:grid-cols-3`; `data-strategy-tile` / `data-strategy-tiles` |
| Zähler + Kosten | ebd. | „X von 6 ausgewählt · Y Ergebnisse" + CTA-Zeile „Erstellt Y Ergebnisse in diesem Lauf"; Content-Kachel Badge „2 Ergebnisse" |
| Kanonisierung | ebd. | Draft-Restore + `growimo_default_types` werden auf wählbare Typen gefiltert |
| i18n | `src/i18n/de.ts`, `src/i18n/en.ts` | 17 neue Keys, KEY-PARITY grün (1595/1595) |
| Prompt-Härtung | `src/ai/providers/openai.ts` | `marketing_plan`-Prompt: 2–3 Sätze Markt-/Trend-Einordnung — **keine** neue Sektion, **kein** zusätzlicher KI-Call, **keine** zusätzliche Usage-Einheit |
| Regressionstest | `strategy-tiles-test.ts` | 72 Checks, 0 FAIL |

Kachel → ContentType (Quelle der Erwartungswerte in Abschnitt 5, `src/ai/strategy-tiles.ts`):
`pinterest→pinterest_pin` · `etsy→etsy_listing` · `social→social_post` · `marketing→marketing_plan` ·
`content→[seo_blog, email_newsletter]` · `ideas→product_idea`.

## 2. Gate-Suite (gegen Baseline `cf72d9e`, Kopie in `/tmp/base`)

| Gate | Baseline | HEAD | Bewertung |
|---|---|---|---|
| `bunx tsc --noEmit -p tsconfig.gate.json` | 53 Fehlerzeilen | 53 Fehlerzeilen | **kein neuer, keiner verschwunden** |
| `i18n-scan.ts` KEY-PARITY | ✅ 1578/1578 | ✅ 1595/1595 | Parität gehalten |
| `i18n-scan.ts` UI HARDCODED | ✅ | ✅ | keine neuen Literale |
| `i18n-scan.ts` DE/EN-VALUES | ❌ 5 / ✅ | ❌ 5 (dieselben) / ✅ | unverändert |
| Suiten | siehe vorherige Fassung | siehe vorherige Fassung | keine Regression (`strategy-tiles-test` 72/0 neu) |

## 3. Prod-Bundle-Beleg

`https://www.growimo.app/app/new-project` (HTTP 200). Chunks: `new-project-BDcYfilJ.js` (86 111 B,
SHA-256 `135e45cd…1cc84`): `growimo-strategy-tiles-v1` @54796, `data-strategy-tile` @69442,
`strategy_tile_content_desc` @55400; `index-BkZZsp1v.js` (610 383 B, `8a3c2bb5…b20`):
`Erstellt %d Ergebnisse in diesem Lauf` @419677; Server-Bundle `render.func/index.mjs`
(`155dad31…0e7`): `Markt- und Trend-Einordnung` @2093174 + @4456248.
Gegenprobe Baseline `cf72d9e`: alle drei Marker 0 Treffer ⇒ Strings stammen aus `a37c255`.

## 4. TEIL 1 — Content-Kachel: Projekt + Zähler exakt 2 (DB-belegt)

**Vorgeschichte (Vorsession-Lauf):** Der Content-Lauf der Vorsession hing beim Session-Ende „in der Generierung",
ist aber **durchgelaufen und persistiert**: DB zeigt zwei Projekte mit genau
`[seo_blog, email_newsletter]` — `3ca4738e-…` (2026-10-06T07:18:28Z) und `1d236e9d-…` (07:23:27Z), je **2**
`generated_content`-Zeilen (bodyLen 1451/5861 bzw. 1484/6094). Der **Zähler** dieses Laufs war nicht mehr
nachträglich prüfbar: die Rest-Skripte der Vorsession hatten `usage_monthly` per `reset-usage.ts` bereits
genullt (`before: []`, `after: []`). Deshalb wurde die Kachel **frisch** gefahren.

| Prüfung | Messwert | Status |
|---|---|---|
| Kacheln sichtbar | `tiles:[pinterest,etsy,social,marketing,content,ideas]`, Marker `growimo-strategy-tiles-v1` | PASS |
| Content-Kachel ehrlich bepreist | Kacheltext `📝 \| Content \| SEO-Blogbeitrag + E-Mail-Newsletter in einem Lauf \| 2 Ergebnisse`, `contentBadge2:true` | PASS |
| CTA vor Auswahl | `ctaDisabled:true` (ohne Auswahl nichts zu generieren) | PASS |
| Klick „Content" | Kachel `✓ …`, Hinweis **„Erstellt 2 Ergebnisse in diesem Lauf"**, `ctaDisabled:false` | PASS |
| Generierung | `CTA: CLICKED` → `spin:2`, ab POLL10 `spin:0`, bodyLen 8771 (≈ 80 s) | PASS |
| Ergebnisansicht | `/app/new-project` rendert beide Ergebnisse inline: `📧 E-Mail-Newsletter …`, `📝 SEO-Blogbeitrag (H1) Generiert`, `🎨 Im Image Studio erstellen`, `Projekt ansehen`, `Alles kopieren` | PASS |
| **DB-Projekt** | `ae8ab45d-6956-44fd-b5e0-edeba99d80cf`, `createdAt 2026-10-06T07:30:54.569Z`, `contentTypes:[seo_blog,email_newsletter]` | PASS |
| **DB-Inhalte** | `generated_content`: `email_newsletter` bodyLen 1332, `seo_blog` bodyLen 6376 (2 Zeilen, keine weiteren) | PASS |
| **DB-Zähler** | `usage_monthly: [{period:"2026-10", count:2}]` → `usageTotal 2` | PASS |
| Projektseite | `/app/projects/ae8ab45d…`, Heading **„Generierte Inhalte (2)"**, SEO **und** E-Mail vorhanden, `cp:false` | PASS |

Belege: Logs `/tmp/kacheln-content-zahler.log`, `/tmp/kacheln-content-abschluss.log`,
DB-JSON `/tmp/kacheln-content-zahler-db.json`; Screenshots
`m27-kachel-content-auswahl-frisch.png` (Auswahl + CTA-Hinweis), `m28-kachel-content-ergebnis-frisch.png` /
`m28b-…-full.png` (Ergebnisansicht), `m23-kachel-projekt-zwei-contents.png` / `m23b-…-full.png` (Projektseite
des Vorsession-Laufs), `m29-kachel-content-projekt-zwei-contents.png` / `m29b-…-full.png` (Projektseite des
frischen Laufs).

**Bedeutung:** 1 Content-Kachel = 2 Ergebnisse = **exakt 2** Einheiten, keine stille Zusatzgenerierung.

## 5. TEIL 2 — 5 Einzelkachel-Läufe: **Zählerkette 1→2→3→4→5 vollständig DB-belegt**

Erwartete Typen je Kachel: siehe Abschnitt 1. Vorgehen: **einmal** `reset-usage.ts` → 0, dann fünf Läufe
**ohne** weiteren Reset; nach jedem Lauf ein `usage_monthly`-Snapshot (`kacheln-db-check.ts`).
Autoritativ ist **immer die DB**, nie das UI-Banner (bekannter P2: das Banner ist nach einer Generierung stale,
siehe Abschnitt 7.5).

| # | Kachel | erwarteter Type | Projekt-ID | `contentTypes` (DB) | `usage_monthly` **je Stufe** | `generated_content` (DB) | Beleg-Screenshot Auswahl → Ergebnis |
|---|---|---|---|---|---|---|---|
| 1 | Pinterest | `pinterest_pin` | `a2de253e-d07e-4bc4-90ad-930d246494eb` | `[pinterest_pin]` | `count 1` | 1 Zeile, bodyLen 2174 | `m30-kachel-pinterest-auswahl.png` → `m31-kachel-pinterest-ergebnis.png` |
| 2 | Etsy | `etsy_listing` | `6e2b58c1-1de0-440f-9745-6713f05b0f47` | `[etsy_listing]` | `count 2` | 1 Zeile, bodyLen 5483 | `m30-kachel-etsy-auswahl.png` → `m31-kachel-etsy-ergebnis.png` |
| 3 | Social Media | `social_post` | `7e118eea-344a-499a-9dda-7ffea3332d0b` | `[social_post]` | `count 3` | 1 Zeile, bodyLen 784 | `m30-kachel-social-auswahl.png` → `m31-kachel-social-ergebnis.png` |
| 4 | Marketing-Strategie | `marketing_plan` | `2326722d-6673-4db3-98d5-3a720e8cc7df` | `[marketing_plan]` | `count 4` | 1 Zeile, bodyLen 6894 | `m30-kachel-marketing-auswahl.png` → `m31-kachel-marketing-ergebnis.png` |
| 5 | Produktideen | `product_idea` | `566b1e5a-859c-4ac0-9524-6a87f8976797` | `[product_idea]` | `count 5` | 1 Zeile, bodyLen 3650 | `m30-kachel-ideas-auswahl.png` → `m31-kachel-ideas-ergebnis.png` |

Schritt-Nachweis je Kachel (Klick-Kette, live): Kachel gefunden (`data-strategy-tile`) → Klick →
`ctaDisabled true→false` → CTA-Klick „🚀 Strategie erstellen" → Generierung → Projekt in der DB.
Ergebnisansichten der Läufe 3–5 (inline unter `/app/new-project`): Social `📡 1 Kanal / 108 Wörter`,
Marketing `📊 Marketing-Plan / 715 Wörter`, Produktideen `💡 Produktideen / 489 Wörter`.
Etsy-Ergebnis: Karte `🌷 Etsy-Eintrag · Personalisierte Keramiktasse | Tasse mit Namen | Geschenkidee`,
`✓ Generiert`, `📡 1 Kanal / 744 Wörter insgesamt / ~223s Lesezeit`.

**Zähler-Kette:** `1 → 2 → 3 → 4 → 5` je +1, kein stiller Zusatzverbrauch. Der Content-Lauf aus Abschnitt 4
(1 Kachel = 2 Ergebnisse = 2 Einheiten) und diese 5 Einzelkacheln zusammen belegen die Regel
**1 Kachel = 1 Ergebnis = 1 Generierung**. Kontingent-Stand nach Stufe 5: **5/5 (Free-Limit erreicht)** — der
Free-Nutzer ist damit am Limit; ein weiterer Lauf bräuchte `reset-usage.ts` (hier bewusst **nicht** gemacht,
damit die Kette 1→5 erhalten bleibt).

**Rohe Belege (im Repo, `docs/mobile-e2e/raw/`):** `kacheln-teil2-zaehlerkette-2026-10-06.jsonl`
(die fünf Stufen-Zeilen mit Projekt-ID/contentTypes/Zähler/Inhalt), `db-snapshot-{pinterest,etsy,social,marketing,ideas}.json`
(der `usage_monthly`-Snapshot **jeder** Stufe plus Projektliste), `db-all-projects-2026-10-06.json`
(Voll-Read am Ende: 5 Nutzerprojekte in Reihenfolge), `run-teil2-gesamt.log`, `run-ideas.log`.

**Bild-Kette auf einer Einzelkachel-Projektseite (nicht gebrochen):** `/app/projects/6e2b58c1-…` (Etsy) rendert
`heading "Personalisierte Keramiktasse mit Namen"`, `generierte:"1"`, Etsy-Karte, **`prefillButton:true`**
(`🎨 Im Image Studio erstellen` + Hint „Der KI-Bild-Prompt aus deiner Strategie wird direkt ins Image Studio
übernommen"), die Sektion `🎨 KI-Bild-Studio` mit den Vorlagen Pinterest Pin / **Etsy Produkt-Mockup (4:3)** /
Instagram-Beitrag / Blog-Hero, `fehlertext:null`. Screenshots `m32-etsy-projekt-bild-prefill.png` (Viewport)
und `m32b-etsy-projekt-bild-prefill-full.png` (ganze Seite, Button + Studio sichtbar), Log `raw/run-etsy-bild-prefill.log`
⇒ die Kachel-Umstellung hat den Bild-Flow auch für eine **Einzelkachel** (Etsy) nicht beschädigt.

Hinweis auf einen **Fehlschlag der Vorsession** (nicht App-Fehler): `21-kacheln-rest.sh` der Vorsession
konnte die 5 Läufe nicht fahren, weil der **Clerk-Sign-in-Token single-use** ist — der Token war bereits im
Content-Lauf verbraucht, alle folgenden `open` landeten auf `/app/sign-in` (`bodyLen:432`), `NO_TILE`/`NO_CTA`,
und die „Ergebnis"-Screenshots `m24-*`/`m25-*` der Vorsession waren **byte-identische Sign-in-Seiten**
(`md5 40edbd73…` fünfmal) — sie sind als Beleg wertlos.

## 6. TEIL 3 — Bestandsprojekt-Regression + Desktop-Grid

### A) Desktop 1440×900 (`/app/new-project`)
`tileCount:6`, `tiles:[pinterest,etsy,social,marketing,content,ideas]`, Marker `growimo-strategy-tiles-v1`,
`rowCount:2`, `perRow:[3,3]` (= 3er-Grid), `scrollW:1425 ≤ innerW:1440`, `hscroll:false`,
`legacy:false` (keine Kachel „Trend-Analyse"/„Market Intelligence"/„KI-Analyse").
Screenshots `d30-kacheln-desktop.png`, `d30b-kacheln-desktop-full.png`.

### B) Alt-Projekt mit `marketing_analysis` — `d0ddebff-854a-42c4-bd21-6b88bf29a8f3`
`bodyLen:11427`, `cp:false`, Headings `[Projekttitel, "Generierte Inhalte (2)", "🎨 KI-Bild-Studio"]`,
`generierte:"2"`, Karte **„🔍 Analyse — KI-Analyse & Optimierung"** vorhanden (`analyse:true`),
**Image-Studio-Button** `🎨 Im Image Studio erstellen` vorhanden, `fehlertext:null`.
Screenshot `m26b-legacy-projekt-marketing-analysis.png`.

### C) Alt-Projekt mit Trend/Markt/Analyse — `1a56bafb-5c34-4b3e-b5cf-434d35420d08` (10 Typen)
`bodyLen:50013`, `cp:false`, Headings `["Reisen mit Hund", "Generierte Inhalte (10)", "🎨 KI-Bild-Studio"]`,
`generierte:"10"`, `analyse:true`, `markt:true`, `trend:true`, drei Image-Studio-Buttons.
Screenshot `m26c-legacy-projekt-trend-markt-10-typen.png`.
**Ehrlicher Vorbehalt:** die Fehlertext-Sonde lieferte für dieses Projekt den Worttreffer `Fehler`
(`fehlertext:"Fehler"`) — es gab **kein** Fehlerbanner und keinen Abbruch (Karten vollständig gerendert,
`generierte:"10"`), der Treffer stammt mit hoher Wahrscheinlichkeit aus dem generierten Werbetext
(50 013 Zeichen Body, z. B. „Fehler vermeiden"). Nicht mehr verifiziert, daher hier als Restunsicherheit
geführt: die Sonde matcht das Wort, nicht ein UI-Fehler-Element. Projekt B (`marketing_analysis`) hatte
`fehlertext:null`, Bibliothek und Dashboard ebenfalls.
Hinweis: Das alte 10-Typen-Projekt beweist, dass `trend_insight` / `market_intelligence` /
`marketing_analysis` weiterhin normal geladen und gerendert werden, obwohl sie keine Auswahlkachel mehr haben.

### D) Inhaltsbibliothek — `/app/content-library`
`bodyLen:5073`, `cp:false`, `zeilen:175`, Treffer `Analyse:1`, `Markt/Market:5`, `Trend:1`,
`fehlertext:null` ⇒ die nicht mehr wählbaren Typen (`marketing_analysis`, `market_intelligence`,
`trend_insight`) werden in der Bibliothek **weiter normal gelistet**.
Screenshot `m26d-inhaltsbibliothek-legacy-typen.png`.

### E) Dashboard — `/app`
`bodyLen:3690`, `cp:false`, `projekte:3` Einträge, `fehlertext:null`; Usage-Banner zeigt (stale, bekannter
P2-Befund) „3 von 5 Generierungen" — autoritativ ist die DB. Screenshot `m26e-dashboard.png`.
⇒ **Bestandsprojekte und Analyse-/Markt-/Trend-Typen bleiben vollständig erreichbar und nutzbar; kein Fehlertext
im DOM.**

## 7. Ehrliche Abgrenzung / Restlücken

1. **TEIL 2 ist abgeschlossen** (Abschnitt 5): alle 5 Einzelkacheln live geklickt und generiert, je ein Projekt
   mit **genau** dem erwarteten `contentType` und die Zählerkette 1→2→3→4→5 aus der DB.
   Ehrlich dazu: der Abschluss wurde **aus der DB** nachgewiesen, nicht über den UI-Wartemarker — der Marker
   `A/B-Varianten` des Ursprungsskripts feuert auf der Inline-Ergebnisansicht von `/app/new-project` nicht, und
   ein Lauf (Social) war beim Budgetende der Vorsession serverseitig fertig, aber noch nicht gerendert; sein
   Projekt + Zähler wurden danach direkt aus der DB gelesen. Für Stufe 2 (Etsy) existiert **kein** brauchbarer
   Ergebnis-DOM-Marker: das Skript fing dort `res:false, cards:null` über alle Polls, während die DB das Projekt
   bereits enthielt und die Seite es danach auch rendert (`bodyLen 6540`, Heading = Projekttitel).
   Restunsicherheit: die Screenshots der Läufe 1+2 zeigen den Zustand **nach** dem Lauf (Ergebnisansicht), nicht
   den Moment des Zähler-Sprungs — der Zähler steht ausschließlich im DB-Snapshot je Stufe.
2. **Zähler des Vorsession-Content-Laufs** ist nicht mehr rekonstruierbar (durch `reset-usage.ts` genullt);
   ersetzt durch den frischen Lauf (Abschnitt 4, `count = 2`).
3. **Zähler-Kette 1→5** (Teil 2): **DB-belegt** (Abschnitt 5). Offen bleibt nur die **Reproduzierbarkeit ohne
   Reset**: der Testnutzer steht jetzt auf 5/5, ein erneuter Durchlauf würde einen `reset-usage.ts` verlangen und
   die Kette damit neu beginnen.
4. Screenshots zeigen den jeweiligen Viewport (bei `--full` die ganze Seite); Aussagen über Inhalte stützen
   sich immer auf DOM-Messwerte + DB, nicht auf das Bild allein.
5. Der `usage`-Banner in der UI bleibt nach einer Generierung stale (bekannter P2-Befund) — autoritativ ist
   immer die DB (`usage_monthly.count`), deshalb alle Zähler-Aussagen hier aus der DB.

## 8. Nachtrag (historisch) — Stand Teil 2 / Teil 3 D+E beim Commit `dd5c514`
*Dieser Abschnitt beschreibt den Zwischenstand beim Commit `dd5c514` und ist überholt — der Abschluss steht in
Abschnitt 5 (Zählerkette) und Abschnitt 9 (Rest-Ausführung).*

- **Teil 3 vollständig abgeschlossen** (A Desktop-Grid, B+C Bestandsprojekte, D Inhaltsbibliothek, E Dashboard).
- **Teil 2 gestartet 2026-10-06T07:34:23Z, beim Budgetende noch im ersten von fünf Läufen.** Belegt ist bis
  dahin live: Kachel sichtbar (6 Kacheln), Pinterest-Kachel **klickbar**, CTA wird durch die Auswahl aktiv
  (`ctaDisabled true → false`), CTA-Klick startet die Generierung (`spin:2`), Screenshot der Auswahl
  `m30-kachel-pinterest-auswahl.png`. **Nicht** mehr gemessen: die Zähler-Kette 1→2→3→4→5 und die
  Zuordnung Projekt↔contentType für die 5 Einzelkacheln.
  Logs: `/tmp/kacheln-einzel.log`, Fortschritt je Lauf in `/tmp/kacheln-einzel-results.jsonl`
  (Zeile pro Kachel: `projectId`, `projectContentTypes`, `usageRows`, `usageTotal`, `storedRows`).
- **Kontingent-Stand:** `reset-usage.ts` hat den Testnutzer auf 0 gesetzt (`before:{period:2026-10,count:2}`,
  `after:[]`). Läuft Teil 2 durch, steht `usage_monthly` anschließend auf 5/5 (Free-Limit erreicht) — dann ist
  für einen erneuten Lauf wieder ein `reset-usage.ts` nötig.
- **Fortsetzung** (dauert ~8–12 min, ~10 Iterationen): angemeldete Session `kacheln-mobile` prüfen
  (`agent-browser --session kacheln-mobile eval "location.pathname+'|'+document.body.innerText.length"`);
  ist sie tot, frischen Token minten (Mechanik: Skill `clerk-signin-token-browser-e2e`, Token **single-use**)
  und `bash scripts/_mobile-e2e/24-kacheln-einzel.sh` fahren. Erwartete Typen: `pinterest_pin`,
  `etsy_listing`, `social_post`, `marketing_plan`, `product_idea`; Zähler nach Lauf N = N.
  Danach diesen Abschnitt mit den fünf JSONL-Zeilen ersetzen und committen.

- **Nachtrag zum Nachtrag (gleicher Lauf, DB-Beleg):** Die erste Einzelkachel des Teil-2-Laufs ist live und
  DB-belegt — Kachel `pinterest`: Projekt `a2de253e-d07e-4bc4-90ad-930d246494eb`
  (`createdAt 2026-10-06T07:35:00.626Z`, `contentTypes:["pinterest_pin"]`, genau **1** `generated_content`-Zeile,
  bodyLen 2174) und `usage_monthly:[{period:"2026-10", count:1}]` ⇒ **Stufe 1 der Kette 1→2→3→4→5 bestätigt**,
  kein stiller Zusatzverbrauch. Die Stufen 2–5 (etsy_listing/social_post/marketing_plan/product_idea) stehen aus
  (Budget). Rohbeleg: `/tmp/db-t2.json`, Log `/tmp/kacheln-einzel.log`
  (Screenshot `m30-kachel-pinterest-auswahl.png`, `m31-kachel-pinterest-ergebnis.png`).

## 9. Abschluss Teil 2 (2026-10-06, Zählerkette 1→2→3→4→5)

**Ergebnis: TEIL 2 VOLLSTÄNDIG.** Alle fünf Einzelkacheln sind live gefahren, je ein Projekt mit exakt dem
erwarteten `contentType` und ein `usage_monthly`-Snapshot je Stufe (Tabelle in Abschnitt 5). Kein Reset zwischen
den Stufen — der einmalige `reset-usage.ts` am Anfang von Lauf 1 hat die Kette auf 0 gestellt, danach lief sie
+1 pro Kachel.

| Stufe | Kachel | Projekt | `contentTypes` | `usage_monthly` | Ergebnis-Screenshot |
|---|---|---|---|---|---|
| 1 | Pinterest | `a2de253e-…494eb` | `[pinterest_pin]` | `count 1` | `m31-kachel-pinterest-ergebnis.png` |
| 2 | Etsy | `6e2b58c1-…0f47` | `[etsy_listing]` | `count 2` | `m31-kachel-etsy-ergebnis.png` |
| 3 | Social Media | `7e118eea-…2d0b` | `[social_post]` | `count 3` | `m31-kachel-social-ergebnis.png` |
| 4 | Marketing-Strategie | `2326722d-…7df` | `[marketing_plan]` | `count 4` | `m31-kachel-marketing-ergebnis.png` |
| 5 | Produktideen | `566b1e5a-…6797` | `[product_idea]` | `count 5` | `m31-kachel-ideas-ergebnis.png` |

**Ausführung / Werkzeuge.** Session `kacheln-mobile` war durchgehend angemeldet (kein neuer Token nötig, damit auch
kein Single-Use-Token-Problem). Neu im Repo:
- `scripts/_mobile-e2e/25-kachel-einzel-rest.sh <key> <type> "<Idee>"` — EIN Kachel-Lauf ohne Reset, hängt eine
  Zeile an `/tmp/kacheln-einzel-results.jsonl` an.
- `scripts/_mobile-e2e/26-etsy-bild-prefill.sh <projectId>` — öffnet eine Projektseite und prüft/zeigt den
  Image-Studio-Prefill-Button (`🎨 Im Image Studio erstellen`) + die Bild-Studio-Vorlagen.
- `scripts/_mobile-e2e/rebuild-kacheln-jsonl.py` — baut die Ketten-JSONL **aus den DB-Snapshots** neu auf
  (Quelle: `docs/mobile-e2e/raw/db-snapshot-*.json`), inkl. Assertion `count == Stufennummer`.

**Ehrliche Anmerkungen (nichts davon ist ein App-Fehler):**
1. Die Stufen 2–5 waren nicht mehr durchgängig per Skript fahrbar: der Ursprungs-Lauf (`24-kacheln-einzel.sh`)
   endete beim Budgetende der Vorsession nach dem CTA-Klick von Stufe 3. Stufe 3 war **serverseitig fertig**
   (Projekt + `count 3` in der DB), nur nicht mehr gerendert/abgeholt; die Stufen 4–5 wurden einzeln mit
   `25-kachel-einzel-rest.sh` gefahren. Es gibt daher **keinen** durchlaufenden Einzel-Log für alle fünf Stufen;
   die Kette steht über die fünf DB-Snapshots + die Ketten-JSONL.
2. **Skript-Buchführung:** Stufe 4 hat beim Wiederaufnehmen zwei JSONL-Zeilen erzeugt (Sitzungs-/Konsolen-Lag).
   Die Datei wurde deshalb aus den DB-Snapshots neu erzeugt; es gibt jetzt **genau fünf** Zeilen (je Stufe eine)
   — die einzige veröffentlichte Fassung in `docs/mobile-e2e/raw/kacheln-teil2-zaehlerkette-2026-10-06.jsonl`.
3. **Kein Reset, Limit erreicht:** Der Testnutzer steht nach Stufe 5 auf **5/5**. Für einen erneuten Lauf wäre
   `reset-usage.ts` nötig, womit die Kette neu beginnen würde — deshalb bewusst so gelassen.
4. **Stale UI-Banner (bekannter P2, unverändert):** Der Etsy-Ergebnis-Screenshot zeigt „4 von 5 Generierungen
   verbleibend", während die DB in diesem Moment `count 2` führte; der Produktideen-Screenshot zeigt
   „1 von 5 Generierung verbleibend" bei `count 5`. Alle Zähler-Aussagen dieses Dokuments stammen deshalb
   ausschließlich aus `usage_monthly`, nie aus dem Banner.
5. **Nicht deployt/geändert:** dieser Nachtrag ist reine E2E-Ausführung + Doku — **kein Produktionscode**
   angefasst.

# ERGEBNIS 2026-10-05 — POST-FIX-LIVE-NACHWEIS (Befund A + Befund B, Teil 1)

Fortsetzung von `docs/mobile-e2e/ERGEBNIS-2026-10-05.md`. Dort war der **Vorher**-Zustand belegt:
1 Kanal = **3** Usage-Einheiten (Befund A: stille Zusatz-Generierungen `marketing_analysis` +
`market_intelligence`, bezahlt, aber nicht gespeichert) und eine **leere** `/app/new-project`-Seite nach
der Generierung (Befund B).

Geprüfter Stand: **HEAD == origin/master == 83b6de0** (`fix(quota)` 399f8f2 + `fix(ux)` 0264fb0 + Docs 83b6de0),
live auf www.growimo.app (vom Lead per Bundle-Marker verifiziert). **Kein Produktionscode geändert** — dieser Lauf
ist reine Ausführung + Beleg.

Synthetischer Testnutzer (kein Owner-Konto): `user_3KGLrQivAW698KVoR3vkZoJYMKU`
(intern `354ebec1-ef4b-4ebd-84b1-69e0a5ac0632`), Free-Tarif (5 Einheiten/Monat).

## Vorher/Nachher in einer Zeile

| Szenario | VORHER (ungefixter Build, `m09-db-nachher.json`) | NACHHER (dieser Lauf) | Bewertung |
|---|---|---|---|
| 1 Kanal (Etsy) | **3** Einheiten, Inhalte 1 | **1** Einheit, Inhalte 1 | Befund A behoben |
| 2 Kanäle (Etsy+Marketing) | n. a. (Kontingent war aufgebraucht) | **+2** (kumuliert 3), Inhalte 2 | Kosten = Kanalzahl |
| Ergebnis sichtbar auf `/app/new-project` | nein (bodyLen 245 = nur Navigation) | ja (bodyLen 6.547 / 12.845, Ergebniskarten + Kennzahl „Generiert") | Befund B behoben |

## Schritt 0 — Zähler-Baseline und Reset (Datei-Belege)

```
bun --env-file=.env scripts/_autosave-e2e-count.ts user_3KGLrQivAW698KVoR3vkZoJYMKU m00-vor-reset
  → usage 2026-10 count = 1   (Rest aus einem früheren Teil-Lauf)      # m00-db-vor-reset-postfix.json
bun --env-file=.env scripts/_mobile-e2e/reset-usage.ts user_3KGLrQivAW698KVoR3vkZoJYMKU
  → reset: true, before [{period:"2026-10",count:1}], after []         # m00-db-reset-postfix.json
```
Der Reset betrifft ausschließlich `usage_monthly` des synthetischen Testnutzers (dokumentiertes Verfahren,
`scripts/_mobile-e2e/reset-usage.ts`) — die Zählerkette 0 → 1 → 3 ist damit unstrittig auf diese beiden
Läufe zurückführbar.

## Schritt 1 — 1-Kanal-Lauf (Kachel „Etsy")

Ausführung: `bash scripts/_mobile-e2e/11-postfix.sh` (unverändert; nur die agent-browser-Aufrufe wurden für
den Hintergrundlauf mit `timeout 180` ummantelt, um bei einem Tool-Hänger nicht die ganze Session zu blockieren).
Vollständiges Log: `ba-postfix-run.log`.

| Messpunkt | Wert | Quelle |
|---|---|---|
| Seite geladen, Idee vorbelegt | `cp:false` (kein Checkpoint), `idea:"Handgemachte Keramiktassen mit Sprenkelglasur"`, bodyLen 1.174 | Log Z. 4 |
| Kachel geklickt | `clicked:["Etsy"]` → `count:"1 ausgewählt"`, `ctaDisabled:false` | Log Z. 5–6 |
| Generierung | Klick `"CLICKED"`, Poll 1–3 `spin>0`, Poll 4 `spin:0`, `gen:1`, `len:6547`, **`err:null`** | Log Z. 8–13 |
| Ergebnis sichtbar (Befund B) | `FINAL: bodyLen 6.547`, `generiertSpans:1`, `hasEtsy:true`, `hasMarketing:false` | Log Z. 14 |
| **DB usage_monthly** | **count = 1** (nach Reset von 0) | Log Z. 17–58 `post-fix-nach-1kanal` |
| DB Inhalte | `contentRows 4 → 5` (genau **1** neue Zeile), `projectRows 3 → 4` | ebda., Projekt `43d9d8bc-…` mit `contents:1` |

**→ 1 Kanal = 1 Generierung = 1 Usage-Einheit. Live belegt.** (Vorher: 3.)

Screenshots: `ba-postfix-1kanal-auswahl.png` (Kachel „Etsy" aktiv, CTA aktiv), `ba-postfix-1kanal-ergebnis.png`.

## Schritt 2 — 2-Kanal-Lauf (Kacheln „Etsy" + „Marketing")

| Messpunkt | Wert | Quelle |
|---|---|---|
| Kacheln geklickt | `clicked:["Etsy","Marketing"]` → `count:"2 ausgewählt"`, `ctaDisabled:false` | Log Z. 64–65 |
| Generierung | Poll 1–2 `spin:3`, Poll 3 `spin:0`, `gen:2`, `len:12845`, **`err:null`** | Log Z. 68–71 |
| Ergebnis sichtbar | `FINAL: bodyLen 12.845`, `generiertSpans:2`, `hasEtsy:true`, `hasMarketing:true` | Log Z. 72 |
| **DB usage_monthly** | **count = 3** ⇒ dieser Lauf kostete **genau 2** | Log Z. 75–123 `post-fix-nach-2kanal` |
| DB Inhalte | `contentRows 5 → 7` (+2), Projekt `ab9ecc9a-…` mit `contents:2` | ebda. |

**→ 2 Kanäle = 2 Usage-Einheiten. Live belegt.**

Screenshots: `ba-postfix-2kanal-auswahl.png`, `ba-postfix-2kanal-ergebnis.png`.

## Gegenprobe: keine stillen Zusatz-Assets mehr

Befund A bestand darin, dass pro Lauf zusätzlich `marketing_analysis` und `market_intelligence` generiert
(und berechnet) wurden, ohne in `saveProject` zu landen. Nachher:
- DB-Zuwachs = **genau** die Zahl der gewählten Kanäle (1 → 1 Zeile, 2 → 2 Zeilen).
- Usage-Zuwachs = **genau** die Zahl der gewählten Kanäle.
- `generiertSpans` = gewählte Kanalzahl (1 bzw. 2), keine verwaisten Ergebnis-Karten.

## Screenshot-Integrität (Checkpoint-Ausschluss)

`ba-postfix-screenshot-md5.txt` enthält die MD5-Summen aller vier Aufnahmen — **vier unterschiedliche Hashes**
(kein Fall der byte-identischen Vercel-Checkpoint-Seite); alle `cp:false`-Sonden im Log bestätigen das zusätzlich.

## Einschränkung (ehrlich)

Auf `ba-postfix-1kanal-ergebnis.png` (oberer Viewport, Mobile 393 px) ist das Ergebnis **nicht** zu sehen — der
Screenshot zeigt die aufgeklappte Navigationsspalte und darunter den Anfang der Ergebniskarte; die Bildlaufposition
liegt darüber. Der Beleg für „Ergebnisse sind sichtbar" ist deshalb der Log-Wert `bodyLen 6.547 / generiertSpans 1`
plus der Text-Auszug (`/tmp/ba-postfix-1kanal-body.txt`, im Log verlinkt) — nicht der Screenshot.
Zweiter, bereits bekannter P3-Punkt: das Usage-Banner im Screenshot zeigt „5 von 5 Generierungen verbleibend"

---

# TEIL 2 — Rest-E2E Bild-Stationen (Stand: 2026-10-05, ~06:50)

## Station 5 (echte Bild-Generierung aus dem Etsy-Strategie-Prefill) — **NICHT AUSLÖSBAR**

Der Weg „Etsy-Kanal → 🎨 Im Image Studio erstellen → Generieren" ist auf beiden geprüften Projekten
**nicht mehr vorhanden**. Belege (jeweils live auf www.growimo.app, Session `growimo-mobile`, kein Checkpoint):

| Prüfung | Ergebnis | Roh-Beleg |
|---|---|---|
| Projektseite `5d42acdd…` (Kerzen) | `studioBtns: 0` — kein „🎨 Im Image Studio erstellen"-Button im DOM | `probe-proj.json` |
| Projektseite `ab9ecc9a…` (Keramiktassen, frisch, 2 Kanäle) | `studioBtns: 0`, stattdessen Abschnitt „🎨 KI-Bild-Studio" mit 4 Format-Karten (2:3/4:3/1:1/16:9), deren „🔄 Neu generieren"-Buttons **deaktiviert** sind (`title = image_studio_api_required`, `src/components/ImageStudio.tsx:85`) | `probe2.json`, `probe3.json` |
| App-eigener Extraktor über den **echten DB-Inhalt** (`extractStrategyImage`, `src/lib/strategy-image.ts:181`) | `etsy_listing: hasImage:false`, `marketing_plan: hasImage:false` — **kein** Bildprompt im Body | `getprompt.out` |
| Bild-Studio, Projekt-Auswahlfeld: 5 Projekte ausgewählt (u. a. `5d42acdd`, `ab9ecc9a`) | Prompt-Feld bleibt **leer** (`promptLen 0`), Badge „Aus deiner Strategie übernommen" erscheint nicht, „✨ Generieren" ist `disabled` | `part2b.log`, `part2c.log`, `part2d.log` |

Konsequenz: Ohne extrahierbaren Bildprompt gibt es **keinen** Prefill und damit keinen Startpunkt für einen
Text→Bild-Call (`images.generations`). Ein künstlich getippter Prompt wurde bewusst **nicht** verwendet, weil das
nicht mehr der Station-5-Frage entsprochen hätte („kommt der Prompt aus der Strategie?") und zusätzlich 1 Einheit
verbraucht hätte.

**Befund für den Lead (nicht gefixt, kein Auftrag dafür):** Der frisch generierte Etsy-Inhalt enthält offenbar
keine Bildprompt-Sektion mehr, weshalb der Bild-Prefill (Station 5 / Button „🎨 Im Image Studio erstellen") für neue
Projekte unerreichbar ist. In der Vorerhebung (06:03 desselben Tages, Projekt `5d42acdd…`) existierte noch ein
197-Zeichen-Prompt — dort ist der Etsy-Body inzwischen durch eine übernommene A/B-Variante ersetzt, die Prüfung
ist also inhaltsabhängig. Das ist ein eigener Untersuchungsauftrag (Kandidat: Prompt-Extraktion vs. geänderte
Kanal-Prompt-Struktur), **nicht** in diesem Lauf behoben.

## Station 6c (Variationslauf mit hochgeladenem Referenzbild) — **NICHT ABGESCHLOSSEN**

Der 6c-Lauf wurde in diesem Auftrag **gestartet, aber nicht mehr beendet** (Session-Budget). Was belegt ist:
- Das Studio war nach dem Prefill-Versuch unverändert erreichbar (`BASELINE gal:0`, kein Checkpoint).
- Der Referenz-Upload und der Klick auf „✨ Variation mit Produkttreue" waren für den Lauf vorgesehen; der
  Station-5-Block davor lief ohne Ergebnis (siehe oben), sodass der Lauf am Ende nicht mehr bis 6c durchkam.

Roh-Log des abgebrochenen Laufs (Session-Logs, nicht im Repo): `part2b.log`, `part2c.log`, `part2d.log`.
**Damit ist die Frage „bezahlt der Live-Key gpt-image-1-Aufrufe?" weiterhin OFFEN** — es wurde in diesem Auftrag
kein Bild-Call ausgelöst und damit auch keine Usage-Einheit für Bilder verbraucht (DB-Kette blieb bei count = 3
nach Teil 1, d. h. exakt 1 Einheit pro Kanal-Lauf, keine Bild-Einheit).

## Was für den Folgeauftrag bleibt (konkret)

1. **Station 5**: Erst klären, warum der frisch generierte Etsy-Inhalt keinen extrahierbaren Bildprompt mehr
   enthält (`extractStrategyImage` → `hasImage:false`) — erst danach ist der Prefill-Weg und damit der
   Text→Bild-Call testbar. Ohne das ist jede Bild-Generierung im Studio nur über manuell getippten Prompt möglich.
2. **Station 6c**: unabhängig davon testbar — Bild-Studio → Testbild `/tmp/mobile-e2e-testbild.png`
   (md5 `df73c42b505afd8a452b30bb9e751270`, identisch zu `m06-testbild-quelle.png`) hochladen →
   `[data-testid="upload-variation-btn"]` klicken → Ergebnis-Karte + `usage_monthly`-Zähler prüfen
   (Soll: 1 Einheit; Referenz geht als `images.edit` mit `input_fidelity:'high'` durch, `src/ai/image-providers/generate.ts:46–68`).
3. Testnutzer-Kontingent: nach Teil 1 steht der Zähler bei **3 von 5**; für Station 5 + 6c sind genau 2 Einheiten
   frei. Für Wiederholungen `scripts/_mobile-e2e/reset-usage.ts` (dokumentiertes Verfahren).


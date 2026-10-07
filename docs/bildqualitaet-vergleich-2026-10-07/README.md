# Bildqualität Schritt 5 — Deployment + echte Vergleichsbilder (2026-10-07)

Auftrag: Owner-Freigabe 2026-10-07. Neue Bild-Engine (gpt-image-2, quality high, exakte Formate,
Text-im-Bild-Regeln) live ausrollen und echte Vergleichsbilder erzeugen. **Kein Public Launch.**

## 1. Deployment (5a) — LIVE

| Punkt | Wert |
|---|---|
| Commit (Quelle) | `083500c` (Schritt 1–4, bereits gepusht) |
| Build | `bash build-vercel.sh` → `BUILD_EXIT=0`, `.vercel/output` 2026-10-07 18:24Z |
| Deploy | `bunx vercel deploy --prebuilt --prod --yes` (1. Versuch `Error: Not authorized` = bekannte transiente Falle, Retry im Skript sofort erfolgreich) |
| Deployment-URL | `https://site-6yr1mjebg-growimo.vercel.app` |
| Alias | `https://www.growimo.app` („Aliased" im Deploy-Log, `www` HTTP 200) |
| Smoke | `/` → 200, `/app/image-studio` → 200 |

### Bundle-Beleg
Das Bild-Modell und die Size-Matrix laufen **serverseitig** (ServerFn) und sind daher nur im
Server-Bundle prüfbar; der Beweis „das ist genau dieser Build" läuft über byte-idente Client-Chunks.

Server-Bundle (lokal, entsteht im selben `build-vercel.sh`-Lauf wie die ausgelieferten Chunks):
`.vercel/output/functions/render.func/index.mjs`, 4 645 230 B,
SHA-256 `ac83006e00e5374a5331acbd01fcf57d6bbf667f36e116db302118cfc8d896d8`

| Marker | Byte-Offset im Server-Bundle |
|---|---|
| `gpt-image-2` | 2049396, 2070940, 2081252, 2089259, 3165096 |
| `720x1280` (NEU, 9:16) | 3165326 |
| `1152x864` (NEU, 4:3) | 3165278 |
| `IMAGE_QUALITY` (Env-Schalter, Default high) | 3163583 |

Gegenprobe Alias = Build (Client-Chunks, live vs. `.vercel/output/static/assets/`, identische SHA-256):

| Chunk | live = lokal |
|---|---|
| `image-studio-Bf4Zbyis.js` | `c2a5224e3ca78961…` |
| `index-CKyw7ZEa.js` | `a0490c443da6ddbb…` |
| `strategy-image-vYbGeNoE.js` | `2bd5de398d953ddf…` |

Zusätzlich im Client-Bundle live: die neuen i18n-Regeln (`image_studio_prompt_rule_typography` in
`image-studio-*.js` und `index-*.js`) — ohne die Commits 358d70c/6ab8017 wären sie nicht enthalten.

## 2. Erster LIVE-Bildbeweis + Nachher-Bilder (5a/5c)

Echter Pfad in der live deployten App (Owner-Account `fahr625@gmail.com`, Owner-Override = kein
Kontingent-Block), **komplette neue Prompt-Kette**:

1. `/app/new-project?idea=Handgemachte Duftkerze aus Sojawachs im Glas` → Kachel **Pinterest** →
   „Strategie erstellen" (echter Strategie-Lauf, Projekt `39593b92-48c3-4627-a643-97eeb5f4000d`).
2. Projektseite → Button **„🎨 Im Image Studio erstellen"** (Strategie-Prefill, `fromStrategy=1`).
   Der Studio-Prompt ist der von der App selbst komponierte
   (`composeStrategyStudioPrompt` + `composeTextOverlayInstructions`): EN-Bevorzugter Bildprompt +
   Produktidee/Bildidee/Plattform + neue Text-im-Bild-Regeln
   (Overlay als gequoteter String, Typografie-Regel mit „ä ö ü ß / eine Schriftfamilie / Safe-Bereich",
   Negativ-Baustein). Rohbeleg: `evidence/strategie-prefill-prompt.png`,
   `evidence/studio-prompt-vor-generierung.png`.
3. Nutzer-Edit im Promptfeld: der von der Strategie gelieferte Overlay-Text „Entspannung pur" (ohne
   Umlaute) wurde an allen 4 Stellen auf **„Schöne Grüße"** (2 Umlaute) ersetzt — nur der Overlay-Text,
   die App-Regeln bleiben unverändert (belegt: Promptlänge 1531 → 1519, `occ=4`).
4. „✨ Generieren" → echter gpt-image-2-Call (quality high), Ergebnis nach ~80 s.
5. PNG aus der Galerie (data-URL) gezogen.

| Kanal | Format | vorher-Datei | nachher-Datei | Prompt-Kürzel | Modell/Quality | Anmerkungen |
|---|---|---|---|---|---|---|
| Pinterest-Pin | 2:3 → **1024×1536** | `vorher/vorher-pinterest-2x3.png` | `nachher/nachher-pinterest-2x3-gpt-image-2-high.png` | `PIN-SOJAWACHS-DE-OVERLAY` (Strategie-Prefill, Overlay „Schöne Grüße") | vorher `gpt-image-1`/medium (1024×1536, Maße damals korrekt) — nachher **`gpt-image-2`/high** | **Deutscher Text sauber**: „Schöne Grüße" korrekt gesetzt, ö/ü als echte Umlaute, eine Schriftfamilie, sicher im Safe-Bereich, kein Blindtext, keine erfundenen Zusatztexte. Szene = echter Produktkontext (Sojawachs-Kerze im Glas), keine generische Stock-Optik. |
| Etsy-Produktbild | 4:3 → **1152×864** | `vorher/vorher-etsy-3x2-altformat.png` (**kein echtes 4:3 im Altbestand** — das Altbild zeigt das alte 3:2-Mapping) | `nachher/nachher-etsy-4x3-gpt-image-2-high.png` | `ETSY-STRATEGIE-PREFILL` (959 Zeichen, aus dem Strategie-Prefill des Etsy-Projekts `1ac11316-0505-483c-a66d-6c84efdc0aae`, enthält die Regel „Kein Text im Bild") | vorher `gpt-image-1`/medium (1536×1024 = 3:2) — nachher **`gpt-image-2`/high, 1152×864** | Erzeugt 2026-10-07 über den echten Live-Pfad (Projektseite → „🎨 Im Image Studio erstellen" → Format 4:3 → „✨ Generieren"). Altes Setup kannte kein 4:3: `4:3` UND `16:9` wurden beide auf `1536×1024` (3:2) gemappt. **Kein Text/Umlaut im Bild** (Fotostil-Regel greift). |
| Social/TikTok | 9:16 → **720×1280** | **kein echtes Vorher-Bild vorhanden** — 9:16 existierte im alten Setup gar nicht (es gab nur das alte Social-Format 1:1, `vorher/vorher-social-1x1.png`, das hier nur als Referenz für das alte Social-Format liegt, nicht als 9:16-Vergleich) | `nachher/nachher-social-9x16-gpt-image-2-high.png` | `TIKTOK-DEEPLINK` (Hochkant-Szene Sojawachs-Kerze + Text-Overlay „Schöne Grüße", Typografie-/Negativ-Regeln automatisch angehängt) | vorher: nicht existent — nachher **`gpt-image-2`/high, 720×1280** | Erzeugt 2026-10-07 über den TikTok-/Reels-Deep-Link (`/app/image-studio?prompt=…&ratio=9:16`) der live deployten App. |
| Blog-Hero | 16:9 → 1280×720 | (abhängig von Etsy-Zeile) | nicht erzeugt | — | — | optional laut Auftrag |

Zusätzlicher Altbestand im Ordner: `vorher/vorher-hochkant-2x3-motiv2.png` (zweites 2:3-Altbild).

### Verifikation der Dateien (PNG-Header, Größe)

| Datei | Maße | Bytes |
|---|---|---|
| `nachher/nachher-pinterest-2x3-gpt-image-2-high.png` | 1024 × 1536 (Soll 2:3 ✓) | 2 010 342 |
| `vorher/vorher-pinterest-2x3.png` | 1024 × 1536 | 2 409 515 |
| `vorher/vorher-hochkant-2x3-motiv2.png` | 1024 × 1536 | 2 280 180 |
| `vorher/vorher-etsy-3x2-altformat.png` | 1536 × 1024 (= altes 3:2-Mapping) | 1 959 594 |
| `vorher/vorher-social-1x1.png` | 1024 × 1024 | 1 286 018 |

## 3. Herkunft der Vorher-Bilder (5b) — ehrlich dokumentiert

**Kein einziges Bild liegt in der Produktions-DB.** Read-only-Prüfung (Konvention
`growimo-fakten-grep-live-run-audit`): `information_schema` hat in keiner Tabelle eine Bild-/Binary-Spalte;
Initiativ-Prüfungen `generated_content` → `metadata::text ilike '%data:image%'` = **0**,
`body ilike '%data:image%'` = **0**, `metadata ? 'image'|'images'|'imagePrompt'` = **0**.
Tabellenbestand: users, projects, generated_content (title/body/metadata), beta_signups, subscriptions,
publish_plan, performance_entries, user_preferences, usage_monthly, generation_throttle, tracking_events,
analytics_events. Die Bild-Galerie lebt clientseitig in der sessionStorage; es gibt keinen Bild-Store.
Kein Schreibzugriff erfolgt (nur SELECT).

**Nächstbestes echtes Material** (Auftrag: „es zählt die Echtheit, nicht die Vollständigkeit"):
`/home/team/shared/site/.run/generated/*.png` — 8 PNG-Dateien vom 2026-08-09, echte Ausgaben der
lokalen Pipeline **unter dem alten Setup** (gpt-image-1, quality medium, alte Prompt-/Size-Kette).
Charakteristisch: 1536×1024 doppelt für Etsy *und* Blog (= das belegte alte Mapping-Problem), 1024×1536
für Pin, 1024×1024 für Social. Die verwendeten Motive sind generisch (EN-Text-Pin „Happy Birthday",
Berg-/Hundeszene, Roter-Kreis-Testmotiv) — sie belegen Format/Modell/Stil der alten Engine, nicht die
Kanal-Themen. Die mobilen Live-Screenshots der alten Läufe
(`docs/mobile-e2e/m05d-bild-generiert.png` u. a.) enthalten **keine** fertigen Bilder (leere Galerie)
und taugen daher nicht als Vorher-Belege.

## 4. Ehrliche Beobachtung (Ingenieur-Sicht)

- **Umlaut-Regel greift real**: `Schöne Grüße` ist im Bild fehlerfrei gesetzt (ö, ü korrekt), eine
  Schriftfamilie, ausreichend Rand, keine Blindtext-Artefakte, kein Logo/Wasserzeichen. Das war die
  konkrete Schwachstelle der alten Kette (das Altbild zeigt englischen Text „Happy Birthday").
- **Prompt-Kette ist nachweislich die neue**: der Studio-Prompt enthielt den EN-Bevorzugten
  Strategie-Bildprompt („Hyperrealistic product photography… 2:3 vertical, Pinterest editorial
  aesthetic") plus die drei neuen Regelblöcke — nicht ein handgeschriebener Sonderweg.
- **Format stimmt kantengenau**: 1024×1536 = exakt 2:3 (vorher 1536×1024 für 4:3/16:9 = falsches 3:2).
- **Qualitätsstufe**: `quality=high` ist live (Env-Schalter `IMAGE_QUALITY` im Server-Bundle,
  Default fail-closed high). Der Live-Key des Owners unterstützt gpt-image-2 (echter Call, ~80 s,
  2,0 MB PNG, kein Fallback/Platzhalter).
- **Kosten**: die Generierung lief auf dem Owner-Override-Account; kein Kontingent verbraucht.

## 5. Offene Punkte / was noch fehlt

1. **Etsy 4:3 (1152×864) und Social/TikTok 9:16 (720×1280): ERLEDIGT (2026-10-07, Fortsetzungslauf).**
   Beide Nachher-Bilder sind jetzt in `nachher/` in **Originalauflösung** (aus dem `img.src`-data-URL
   gezogen, kein Screenshot-Beschnitt) — Maße siehe Abschnitt 7. Offen bleibt nur ein **echtes
   Vorher-Bild für 9:16**: das alte Setup kannte das Format nicht, deshalb ist die 9:16-Zeile bewusst
   ohne Vorher-Bild markiert (statt eines unpassenden 1:1-Altbilds als „Vergleich").
   Ursache des vorherigen PARTIAL-Stands war ein Werkzeug-Blocker: Werkzeug-Blocker, kein App-Befund — (a) die Clerk-Session der Browser-Session
   läuft zwischen zwei separaten CLI-Aufrufen ab (Route springt auf `/app/sign-in`), daher musste der
   komplette Klickpfad in **einem** Skript laufen; (b) der lokale Sammel-Server war aus dem Browser
   nicht erreichbar (`TypeError: Failed to fetch` auf `http://127.0.0.1:8899`), deshalb wurde das Bild
   per 300-kB-Chunks aus dem DOM geholt; (c) für den Rest des Budgets war der Etsy+9:16-Lauf
   (`/tmp/p5/run7.sh`, fertig geschrieben) nicht mehr startbar.
   **Fortsetzung**: `bash /tmp/p5/run7.sh` (frischer Clerk-Ticket in `/tmp/p5-ticket4.txt` nötig;
   Etsy-Prefill über Projekt `1ac11316-0505-483c-a66d-6c84efdc0aae`, dann
   `/app/image-studio?prompt=…&ratio=9:16`), Bilder per Chunk-Extraktor (`/tmp/p5/extract.sh` +
   `/tmp/p5/assemble.py`) sichern.
2. **Blog-Hero 16:9** (optional) und ein echtes Etsy-4:3-Vorher-Bild fehlen aus demselben Grund.
3. Der Text ist im vorliegenden Pin als *eine* Zeile gesetzt (Regel erfüllt); ein A/B-Test „Overlay
   oben vs. unten" wäre der nächste Qualitätsschritt.
4. Kosten-Kalibrierung (Phase 8.4) sollte die neuen `quality=high`-Bildkosten je Generierung neu messen
   (high statt medium ist teurer).

## 6. Belege im Ordner

- `nachher/nachher-pinterest-2x3-gpt-image-2-high.png` — echter gpt-image-2/high-Pin (1024×1536)
- `vorher/vorher-*.png` — vier echte Alt-Ergebnisse der alten Engine
- `evidence/strategie-prefill-prompt.png` — Studio nach dem „Bild jetzt erstellen"-Klick (2:3-Stempelkarte)
- `evidence/studio-prompt-vor-generierung.png` — Promptfeld vor dem Generieren
- `evidence/studio-pin-nachher.png` — Galerie nach der Generierung (Karte + Format-Badge)

## 7. Nachtrag (2026-10-07, Fortsetzungslauf): Verifikation der zwei neuen Nachher-Bilder

Alle Werte **maschinell aus den Dateien im Repo** gemessen (PNG-Header, Bytes, SHA-256);
die Bilder wurden in **Originalauflösung** aus dem `img.src`-data-URL der Galerie gezogen
(300-kB-Chunks aus dem DOM), nicht als Screenshot-Beschnitt.

| Datei | Kanal | Soll | Ist-Maße | Bytes | SHA-256 | Status |
|---|---|---|---|---|---|---|
| `nachher/nachher-etsy-4x3-gpt-image-2-high.png` | Etsy-Produktbild | 4:3 → 1152x864 | **1152×864** | 1507873 | `b6578f0364cb3f1937f484aaffbb9f87682c810749dad3787d0228f21c4c6a61` | OK (exakt) |
| `nachher/nachher-social-9x16-gpt-image-2-high.png` | Social/TikTok | 9:16 → 720x1280 | **720×1280** | 1150762 | `e69b7bed3d8a420bcd1c26da8aa6f0dcde8b54cd78592c0cc7ca8565580803f1` | OK (exakt) |

Herkunft der Bilder (ehrlich):

- **Pfad:** live deployte App `www.growimo.app` (HEAD `16058b0`, Server-Bundle mit `gpt-image-2`,
  `1152x864`, `720x1280`, `IMAGE_QUALITY`), Owner-Account mit Owner-Override (kein Kontingentverbrauch,
  keine Usage-DB-Schreibungen), zwei echte `gpt-image-2`/`quality=high`-Calls.
- **Etsy 4:3:** Strategie-Prefill des Etsy-Projekts `1ac11316-0505-483c-a66d-6c84efdc0aae` über
  „🎨 Im Image Studio erstellen" (Prompt 959 Zeichen, inkl. Regel „Kein Text im Bild"), Format 4:3.
  Das Bild kam aus dem Lauf mit **1152×864** zurück (im DOM gemessen: `naturalWidth×naturalHeight`).
- **Social/TikTok 9:16:** Deep-Link `/app/image-studio?prompt=…&ratio=9:16` (TikTok-Einstieg,
  Typografie-/Negativ-Regeln automatisch angehängt), Overlay-Text „Schöne Grüße", Ergebnis 9:16.
- **Vorher-Bilder:** unverändert die vier echten Alt-Ergebnisse unter `vorher/`. Für 9:16 existiert
  **kein** Vorher-Bild (das Format gab es im alten Setup nicht); `vorher/vorher-social-1x1.png` ist
  ausdrücklich **kein** 9:16-Vergleich, sondern nur das alte Social-Format 1:1. Für 4:3 existiert
  ebenfalls kein echtes Vorher-Bild — `vorher/vorher-etsy-3x2-altformat.png` zeigt das alte 3:2-Mapping.

_Stand: 2026-10-07 18:56 UTC (maschinell erzeugter Abschnitt)._


# Stabilisierungspaket — FINALE E2E-Evidence (2026-10-05)

Ziel: **www.growimo.app** (Production, Deploy `site-bn19bg5sa`), Mobile-Viewport **393×852, DPR 2**.
Testnutzer: `user_3KGLrQivAW698KVoR3vkZoJYMKU` (intern `354ebec1-ef4b-4ebd-84b1-69e0a5ac0632`),
Free-Kontingent 5/Monat, **kein** Owner-Override.
Frisches Projekt dieses Abschlusslaufs: `9b6c6651-6fd3-4fb8-852a-73ae3ae49556`
(„Handgemachte Keramiktassen mit Sprenkelglasur", 1 Kanal `etsy_listing`, angelegt 2026-10-05T07:20:41Z).

Dieses Dokument schließt das Stabilisierungspaket ab: alle Stationen der Owner-Liste (1–6), die beiden
Live-Befunde A/B und der Bildprompt-Befund (Station 5) mit Status, Beleg und Commit — plus ehrliche
Abgrenzung jeder Restlücke.

## 1. Gesamttabelle

| # | Station / Befund | Status | Beleg (Datei / Messwert) | Commit |
|---|---|---|---|---|
| 1 | Mobile-Login + Dashboard (kein Turnstile, kein Vercel-Checkpoint) | **PASS** | `m01-dashboard.png`, `m01-login-log.txt`, `{vw:393,vh:852,dpr:2}`, `cp:false` | `cd73a0e` |
| 2 | Strategie generieren (Kacheln wählen → „Strategie erstellen") | **PASS** | `m02-strategie-auswahl.png`, `m02-log.txt`, `x zuletzt/` | `828a945` |
| 2b | Frischer **1-Kanal**-Lauf (Post-Fix): 1 Kachel = **1 Einheit** | **PASS** | `ba-postfix-*.png`, `m00-db-reset-postfix.json`, count 1 | `9351cc2` |
| 3 | A/B-Varianten (3 Varianten, Einzel-Scores, kein geschöntes Ranking) | **PASS** | `m03-varianten-1/2.png`, `m03-varianten-rohdaten.json` (33/33/32) | `828a945` |
| 4 | Variante übernehmen → Etsy-Inhalt ersetzt, persistiert | **PASS** | `m04-nach-uebernahme-dom.json`, `m07-fakten-und-persistenz.json` | `828a945` |
| 5 | Bild aus Strategie: Prefill **und** echte Generierung | **PASS** | `station5-studio-prefill-live.png`, `station5-bild-live.png`, `station5-galerie-live.png`, `station5-6-live.log` | `cc9d207` + dieser Commit |
| 5b | Bildprompt-Befund (Extraktor fand Prompt in kollabiertem Body nicht) | **GEFIXT + LIVE BELEGT** | `bildprompt-fix-*.png`, `verify-bildprompt.ts` → `hasImage:true`, `promptLen:82` | Fix `f098606`, Beleg `7325877`, `cc9d207` |
| 6a/6b | Referenzbild-Upload: Karte + aktiver „Variation mit Produkttreue"-Button + Banner | **PASS** | `m06-upload-referenz.png`, `m06d-upload-referenz-postfix.png` | `828a945`, `cc9d207` |
| 6c | Variationslauf **mit** Referenzbild (`images.edit`, `input_fidelity:'high'`) | **PASS** | `station6c-variation-live.png`, `station5-6-live.log` (Galerie 1 → 2 Bilder) | dieser Commit |
| A | Befund Doppel-Verbrauch (2 Kacheln → 4 Einheiten, 2 Assets nicht gespeichert) | **GEFIXT + LIVE BELEGT** | Live: 1 Kanal = 1, 2 Kanäle = 2 Einheiten (`9351cc2`) | Fix `399f8f2` |
| B | Befund leere Seite `/app/new-project` nach Stream-Lauf | **GEFIXT + LIVE BELEGT** | Ergebnisse sichtbar (`bodyLen 6.547`, `generiertSpans 1`) | Fix `0264fb0` |
| — | Gate-Basis (tsc / i18n / Suiten) für diesen Stand | **grün, unverändert** | `gate-suites.log`, `gate-i18n.log` (nur Doku/Skript-Änderungen, kein Produktionscode in diesem Abschluss) | — |
| — | Deploy-Beleg „Fix ist wirklich live" | **PASS** | Prod-Bundle-Marker in den Minified-Chunks der ausgelieferten Deployments | `7325877` |

## 2. Station 2b / Bildprompt-Befund — Live-Klick-Beweis (Teil 2 des Auftrags)

Lauf `scripts/_mobile-e2e/12-bildprompt-live.sh` (Log mit maskiertem Ticket: `bildprompt-fix-live.log`),
Session `bildprompt-live`, Testnutzer eingeloggt (`uid` bestätigt), **kein** Checkpoint (`cp=false`):

| Prüfung | Messwert |
|---|---|
| Idee im Formular | `idea: "Handgemachte Keramiktassen mit Sprenkelglasur"` |
| Kanal-Auswahl | `CLICK_TILE: CLICKED`, `count: "1 ausgewählt"` (nur Etsy), `ctaDisabled: false` |
| Generierung | `POLL4 spin:0 len:7279` → fertig in ~40 s |
| **DB-Roh-Body** (kollabiert!) | `body_len: 6107`, `newlines: 0`, `raw_has_bildprompt: true` |
| **Echter Extraktor** (`extractStrategyImage`) auf genau diesem Body | `hasImage: true`, `promptLen: 82`, `ratio: 4:3` |
| Prompt-Inhalt | `A cozy kitchen scene with handmade speckled ceramic mugs on a rustic wooden table.` |
| Projektseite | `url /app/projects/9b6c6651…`, `button: true` („🎨 Im Image Studio erstellen"), `cp: false` |
| **Zähler** | `usage_monthly` 2026-10: **count = 1** → 1 Kanal = **1 Einheit** (kein Reset nötig, Start 0/5) |

Belege: `bildprompt-fix-auswahl.png`, `bildprompt-fix-ergebnis.png`, `bildprompt-fix-projektseite-button.png`,
`bildprompt-fix-live.log` (Ticket maskiert), Roh-JSON `bildprompt-fix-verify.json`.
Damit ist der Fix `f098606` (Prompt auch aus kollabierten Ein-Zeilen-Bodies lesen) **live im Klickpfad**
belegt — vorher war genau dieser Fall `hasImage:false`.

## 3. Station 5 — echte Bild-Generierung (gpt-image-1) — **FUNKTIONIERT LIVE**

Lauf `scripts/_mobile-e2e/13-station5-6-bild-live.sh`, Log `station5-6-live.log`, 2026-10-05T07:30:29Z.

| Schritt | Messwert |
|---|---|
| Projektseite → „🎨 Im Image Studio erstellen" | `STUDIOBTN: CLICKED` |
| Studio-Zustand | `url /app/image-studio?fromStrategy=1`, **`promptLen: 155`** |
| Prompt (aus der Strategie, nicht getippt) | `A cozy kitchen scene with handmade speckled ceramic mugs on a rustic wooden table.` + `Produktidee: Handgemachte Keramiktassen mit Sprenkelglasur` + `Plattform: Etsy` |
| Format | `4:3` (Etsy), Strategie-Stempel „✓ Aus deiner Strategie übernommen" |
| Klick „✨ Generieren" | `GEN_CLICK: CLICKED`, danach `spin:1` |
| Ergebnis nach ~30 s | `POLL3 {"galleryImgs":1,"srcLens":[3049526],"spin":0,"err":null}` |
| **Bildnachweis** | `img.src` = `data:image/png;base64,…` mit **3.049.526 Zeichen** (~2,2 MB echtes PNG), **kein** Fallback-Platzhalter, **kein** Fehlertext |
| **Zähler** | `usage_monthly` 2026-10: **count = 2** (1 Kanal + 1 Bild) → 1 Bild = **1 Einheit** |

**Antwort auf die offene Produktionsfrage: Der Live-OpenAI-Key bezahlt/erlaubt `gpt-image-1` — der
Text→Bild-Call (`/v1/images/generations`, Modell `gpt-image-1`) läuft in Production durch.**
Kein 429, keine Quota-Meldung, kein Modellfehler. Screenshot: `station5-bild-live.png`
(Seitenkopf mit Stempel „Aus deiner Strategie übernommen", Banner „4 von 5 Generierungen verbleibend"),

**Galerie-Beleg (`station5-galerie-live.png`, Nachlauf `14-station56-galerie-proof.sh`):** zeigt beide Bilder
nebeneinander — rechts die **4:3**-Kachel (Etsy-Ratio) aus Station 5: eine Küchenszene mit gesprenkelten
Keramiktassen und Dampf, die exakt dem Strategie-Prompt entspricht; links die **1:1**-Kachel aus Station 6c.
Zusätzlich im DOM geprüft:
`{"gal":2,"lens":[1839898,3049526],"headers":["data:image/png;base64,iVBORw0KGg","data:image/png;base64,iVBORw0KGg"],
"cardTxt":["1:1 | ⬇ Herunterladen | 📋 Prompt kopieren | 🔄 Neu generieren | ✨ Variation","4:3 | …"]}` —
**echter PNG-Header (`iVBORw0KGg`)** in beiden Fällen, keine SVG-/Fallback-Grafik, Format-Chip passend zum Aufruf.

## 4. Station 6c — Variationslauf mit Referenzbild — **FUNKTIONIERT LIVE**

| Schritt | Messwert |
|---|---|
| Referenz-Upload | `/tmp/mobile-e2e-testbild.png`, **md5 `df73c42b505afd8a452b30bb9e751270`** (identisch zu `m06-testbild-quelle.png`) → `✓ Done` |
| Upload-Karte | `cards: 1`, Dateiname `mobile-e2e-testbild.png`, `noRef: false` |
| Button | `btnText: "✨ Variation mit Produkttreue"`, `btnDisabled: false` |
| Klick | `VAR_CLICK: CLICKED` |
| Ergebnis nach ~20 s | `VPOLL2 {"galleryImgs":2,"srcLens":[1839898,3049526],"spin":0,"err":null}` — **zweites, vom ersten verschiedenes Bild** (1.839.898 Zeichen data-URL) |
| Pfad | Referenz geht als `images.edit` mit `input_fidelity: 'high'` durch (`src/ai/image-providers/generate.ts:50–60`) |
| Zähler | `usage_monthly` 2026-10: **count = 3** (1 Kanal + 2 Bilder) → auch die Variation = **1 Einheit** |

Produkttreue visuell bestätigt: im Ergebnis bleibt das Referenzmotiv (Zielscheiben-Muster auf Holzwürfel)
erkennbar, nur Hintergrund/Licht/Perspektive ändern sich — Belegbild `m06d-variation-ergebnis.png` aus dem
Vorgängerlauf (gleicher Pfad, gleiches Testbild). Screenshot dieses Laufs: `station6c-variation-live.png`.

## 5. Zählerkette des Abschlusslaufs (DB `usage_monthly`, 2026-10)

| Zeitpunkt | count | Rechnung |
|---|---|---|
| Start | 0 | Kontingent frei |
| nach Station 2b (1 Kanal Etsy) | **1** | 1 Kachel = 1 Einheit (Befund-A-Fix wirkt: keine stillen Zusatz-Assets) |
| nach Station 5 (1 Text→Bild) | **2** | 1 Bild = 1 Einheit |
| nach Station 6c (1 `images.edit`) | **3** | 1 Variation = 1 Einheit |

Belegt mit `bun --env-file=.env run` gegen die echte `DATABASE_URL` (`{"usage":[{"period":"2026-10","count":3}]}`),
`generation_throttle` ohne Zeile (Rate-Limit hat nicht gegriffen).
**Nebenbefund (bekanntes P3, hier erneut live reproduziert):** Das Usage-Banner im UI zeigte nach beiden
Bild-Calls weiterhin „4 von 5 Generierungen verbleibend" (Stand nach dem Kanal-Lauf) — es aktualisiert sich
nach einer Bild-Generierung nicht. Die DB ist korrekt (3), nur die Anzeige ist stale.

## 6. Ehrliche Abgrenzung (was NICHT behauptet wird)

1. **`station5-bild-live.png`** zeigt den Studio-Kopf (Stempel + Zähler-Banner), nicht die Galerie-Kachel —
   der harte Bildnachweis ist der Log-Wert `srcLen 3.049.526` (`data:image/png;base64`) plus der
   Galerie-Ausschnitt `station5-galerie-live.png`; zusätzlich als Zeuge für den Pfad
   `m06d-variation-ergebnis.png` (echtes Ergebnisfoto aus dem Vorgängerlauf).
2. **Kein DB-Datensatz für Studio-Bilder:** die Galerie ist (bewusst) Client-/`sessionStorage`-Zustand
   (max. 3, Phase-5d-Fix). Der Bild-Beweis ist daher Browser + `usage_monthly`, nicht eine Bild-Tabelle.
3. **Wiederherstellungs-/Reload-Pfad der Galerie** wurde in diesem Abschluss nicht erneut durchgeklickt
   (belegt in der Stabilisierung Phase 4.3 / Commit `85baff6`).
4. Der **Sign-in-Token** wird in dieser Evidence nie im Klartext abgelegt: `12-bildprompt-live.sh` schreibt
   ihn in sein Lauf-Log (nur auf der Maschine), die committete Kopie `bildprompt-fix-live.log` ist maskiert.
5. **Owner-Override** war nicht betroffen (Testnutzer ist Free); die Zähler sind echte Free-Verbräuche.
6. Offene P2/P3-UX-Funde aus dem Gesamtlauf (nicht Teil dieses Auftrags, unverändert): Usage-Banner ist
   nach einer Generierung stale, TikTok-Thema-Feld beim ersten Lauf unerreichbar, Mobile-Layout ohne
   Burgermenü, templatige Copy-Muster über Läufe, Markenprofil erfindet Produkt-Identität ohne Details.

## 7. Ausführbare Belegkette (Reproduktion)

```bash
cd /home/team/shared/site
bash scripts/_mobile-e2e/01-login.sh                       # Session + Ticket (Station 1)
bun --env-file=.env scripts/_mobile-e2e/verify-bildprompt.ts user_3KGLrQivAW698KVoR3vkZoJYMKU
bash scripts/_mobile-e2e/12-bildprompt-live.sh            # Station 2b (1 Kanal) + Projektseiten-Button
bash scripts/_mobile-e2e/13-station5-6-bild-live.sh       # Station 5 (Text→Bild) + 6c (images.edit)
bun --env-file=.env scripts/_mobile-e2e/reset-usage.ts user_3KGLrQivAW698KVoR3vkZoJYMKU  # Kontingent frei
```
Jeder Browser-Aufruf der Skripte ist mit `timeout` ummantelt (Falle: `agent-browser` kann in dieser
Umgebung minutenlang pro `eval` hängen). Log-Ziele: `/tmp/station5-6-live.log`, `/tmp/bildprompt-live.log`.

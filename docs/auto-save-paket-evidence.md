# Evidence: Auto-Save nach vollständigem Paket-Lauf (Owner-Entscheid 2026-10-01)

Autor: Engineer-Session (delegiert vom Lead) · Datum: 2026-10-03 · Deployment: `site-67h2xl7cj-growimo.vercel.app` (Alias www.growimo.app)

## 1. Ausgangslage (Persistenzlücke)

Ein fertig generiertes 5-Kanal-Paket lebte ausschließlich im React-State. Ohne Klick auf
„Als Projekt speichern" blieben `projects = 0` und `generated_content = 0` — ein Reload/Verlassen verlor
das komplette (im Free-Plan: das gesamte Monats-)Kontingent.

## 2. Änderungen + Commit

Commit **f60c550** (master, gepusht: `b03c1b1..f60c550`), genau die fünf Auto-Save-Dateien:

```
 package-autosave-test.ts    | 244 ++++++++++++++++++++++
 src/i18n/de.ts              |   4 +
 src/i18n/en.ts              |   4 +
 src/lib/package-autosave.ts |  92 ++++++++
 src/routes/app/package.tsx  | 221 ++++++++++++++++-------
 5 files changed, 520 insertions(+), 45 deletions(-)
```

- `src/lib/package-autosave.ts` (neu, pur, ohne React/DOM/DB): `shouldAutoSavePackage()`,
  `parseLastSavedPackage()` (fail-closed), `LAST_SAVED_PACKAGE_STORAGE_KEY`, `MIN_SUCCESSFUL_CHANNELS_TO_AUTOSAVE = 1`.
- `src/routes/app/package.tsx`: EIN Speicherpfad `persistPackage(channels, auto)`; manueller Button und
  Auto-Save nutzen ihn; Auto-Save-Aufruf steht NACH `await Promise.all(...)` (alle 5 Kanal-Requests settled)
  und NACH `recordGeneration(uid)`; Refs `runSeqRef`/`autoSavedRunRef`/`savedProjectRef`/`saveInFlightRef`
  sichern Einmaligkeit und Idempotenz; dezenter UI-Hinweis (`package_autosaving` / `package_autosaved`),
  Button wird zu „Gespeichert" (`package_saved_done`) und deaktiviert; Merker-Karte `package_last_saved_title`
  erscheint nach Reload aus localStorage (Anzeige-Merker; Persistenz liegt in der DB).
- `src/i18n/de.ts` / `en.ts`: 4 neue Keys (Parität gewahrt).

Kriterienprüfung: (a) genau einmal, erst nach vollständigem Lauf ✅ (Trigger hinter `Promise.all`, `runFinished: true`);
(b) idempotent — bereits gespeichert (manuell ODER Auto) ⇒ kein zweiter Save, kein Überschreiben ✅;
(c) identischer Pfad `store.saveProject → qSaveProject`, KEIN usage-guard/increment (0 Generierungen) ✅;
(d) dezente i18n-Hinweise de+en ✅.

## 3. Gates (2026-10-03)

| Gate | Ergebnis |
|---|---|
| `bun package-autosave-test.ts` | **41 passed, 0 failed — Exit 0** |
| `bunx tsc --noEmit -p tsconfig.gate.json` | 44 Fehlerzeilen — **identisch zur Baseline b03c1b1** (diff leer, keine neuen/verschwundenen) |
| `bun i18n-scan.ts` | de = **1545** / en = **1545** Keys, **KEY-PARITY ✅** (Baseline: 1541/1541 → +4 = die neuen Keys); Findings unverändert (USED-KEYS `tiktok_result_`, DE-VALUES 5, SERVER-LIT 332) — Baseline identisch ⇒ **keine neue Mixing-Regression** |
| Relevante Suiten | package-autosave, f5, f8, f9, f10, strategy-image, brand-profile, improve-deadzone, tiktok-concept-quality, stabilisierung-phase43 → **alle grün** |
| f2-1, f6, f7 | **rot wegen externem OpenAI-Kontingent**: `429 You have no credits remaining` (kein Bezug zu dieser Änderung; diese Pfade berühren `package-autosave.ts` nicht) |

## 4. Deploy-Beleg (www.growimo.app = 200)

`bash build-vercel.sh` + `bunx vercel deploy --prebuilt --prod --yes` → Deployment
`https://site-67h2xl7cj-growimo.vercel.app`, „✓ Ready in 10s", `▲ Aliased https://www.growimo.app`.
Der erste Deploy-Versuch brach mit „Error: Not authorized" ab; der **Retry mit identischem Prebuilt-Output war erfolgreich** (Auth war gültig: `vercel whoami` = fahr625-3542).

HTTP: `/` → 200, `/app/package` → 200.

### Bundle-Marker (ausgelieferte Chunks von site-67h2xl7cj)

| Chunk | SHA-256 | Bytes |
|---|---|---|
| `assets/package-DuVTQHLh.js` | `41eb2cb3461046c18c67744903ea1d3478ed334d833bbe186c68101c82022c35` | 23 227 |
| `assets/index-ZEKWG6Sl.js` | `508586145b2de53da0d30c76da3b5c3a7e33e94dfde11fd8852c32cd4f7d2f39` | 602 549 |

Marker (Byte-Offset, `grep -aob -F`):

```
package-autosave-hint      package-DuVTQHLh.js:14469
package-last-saved         package-DuVTQHLh.js:10237
growimo_package_last_saved package-DuVTQHLh.js:2909
package_autosaved          index-ZEKWG6Sl.js:479403 / :563568 / package-DuVTQHLh.js:14652
package_autosaving         index-ZEKWG6Sl.js:479451 / :563612 / package-DuVTQHLh.js:14406
package_saved_done         index-ZEKWG6Sl.js:479366 / :563537 / package-DuVTQHLh.js:14174
package_last_saved_title   index-ZEKWG6Sl.js:479508 / :563661 / package-DuVTQHLh.js:10513
"Automatisch gespeichert"        index-ZEKWG6Sl.js:479426
"Wird automatisch gespeichert"   index-ZEKWG6Sl.js:479475
```

`shouldAutoSavePackage` selbst wird minifiziert (Bezeichner weg) — erwartet; die Marker
(data-testid, Storage-Key, i18n-Keys und -Werte) sind alle im ausgelieferten Bundle.

## 5. Live-E2E gegen www.growimo.app — ABGESCHLOSSEN (2026-10-03, Nachsession)

Synthetischer Nutzer (kein Demo-Konto, kein Limit-Umgehen, keine echten E-Mails):
`user_3KC3rE9VU1DSNmqDawicCwt15CT` / `e2e-autosave-norau@ctomail.io`, internalUserId
`88501a29-5622-403b-9dd7-340a495cbdc4`. Beta-Freischaltung über die öffentliche Produktions-API
`POST /api/beta-signup` → HTTP 200 (aus der Vorsession; Nutzer war unverbraucht).
Login am App-Origin per Clerk sign-in token (in dieser Session neu gemintet, 3600 s):

```json
{"step":"login","url":"/app","uid":"user_3KC3rE9VU1DSNmqDawicCwt15CT","bodyLen":1347,"cp":false}
```

### Baseline VOR dem Lauf — `scripts/_autosave-e2e-count.ts <clerkId> baseline`

```json
{"label":"baseline","clerkId":"user_3KC3rE9VU1DSNmqDawicCwt15CT","internalUserId":"88501a29-5622-403b-9dd7-340a495cbdc4","projectRows":0,"projects":[],"projectTitles":[],"contentRows":0,"perProject":[],"usage":[]}
```

`userFound` implizit true (internalUserId vorhanden), **projects 0, contentRows 0, usage [] = 0/5 verbraucht**.

### Ablauf (agent-browser, Session `as3`; Marker-Polling statt fester Sleeps)

1. Navigation `/app/package?idea=Personalisierte%20Bienenwachskerzen%20f%C3%BCr%20Kinder`
   (frische Nutzeridee schlägt den Entwurf — `src/lib/idea-priority.ts`). Formularzustand vor dem Klick:

   ```json
   {"step":"form","url":"/app/package","ideaVal":"Personalisierte Bienenwachskerzen für Kinder","btnFound":true,"btnDisabled":false,"cp":false,"bodyLen":836}
   ```

2. Klick auf „✨ Paket generieren" (JS-Klick auf den echten Button):
   `"CLICKED_OK idea=Personalisierte Bienenwachsker"` — **kein** Klick auf „Als Projekt speichern".
3. Poll alle 15 s auf `[data-testid="package-autosave-hint"]`; Lauf-Ende ~46 s nach dem Klick:

   ```json
   poll2 {"t":"17:29:52","hint":false,"saving":true, ...}
   poll3 {"t":"17:30:07","hint":true,"hintText":"✅ Automatisch gespeichert","saving":false,"improveBtns":0,"hasFertig":true,"bodyLen":4479,"cp":false}
   ```

### (a) DB nach dem Lauf: projects > 0 UND generated_content > 0 ✅

`scripts/_autosave-e2e-count.ts <clerkId> after_run`:

```json
{"label":"after_run","projectRows":1,"projects":["a013ef8a-a3b6-437a-8b42-07ed1668a63a"],"projectTitles":["Personalisierte Bienenwachskerzen für Kinder"],"contentRows":5,"perProject":[{"id":"a013ef8a-a3b6-437a-8b42-07ed1668a63a","contents":5}],"usage":[{"period":"2026-10","count":5}]}
```

**1 Projektzeile, 5 Content-Zeilen** (ein Eintrag je Kanal) — ohne jeden Klick auf „Als Projekt speichern".

### (b) UI-Hinweis „✅ Automatisch gespeichert" (vor jedem Reload) ✅

DOM-Assertion unmittelbar nach dem Lauf (gleiche Seite, noch kein Reload):

```json
{"step":"after_run","hintVisible":true,"hintText":"✅ Automatisch gespeichert","btnText":"✓ Gespeichert","btnDisabled":true,"savedWord":true,"usageTexts":["5 von 5 Generierungen verbleibend"],"storageKey":"a013ef8a-a3b6-437a-8b42-07ed1668a63a","storageTitle":"Personalisierte Bienenwachskerzen für Kinder","storageAuto":true}
```

Screenshot (ganzseitig, zeigt Badge „✅ Automatisch gespeichert", Button „✓ Gespeichert", Button „Zum Projekt"
und alle 5 Kanal-Karten):
**`docs/autosave-hinweis.png`**

### (c) Reload → Paket bleibt erhalten ✅

`https://www.growimo.app/app/package` neu geladen (ohne `?idea=`), Merker-Karte + localStorage:

```json
{"step":"reload","url":"/app/package","cardVisible":true,"cardText":"✅ Letztes Paket automatisch gespeichertPersonalisierte Bienenwachskerzen für Kinder✓ Zum Projekt","storageKey":"a013ef8a-a3b6-437a-8b42-07ed1668a63a","storageTitle":"Personalisierte Bienenwachskerzen für Kinder","storageAuto":true,"savedAt":"2026-10-03T17:29:53.185Z","hasGenerateForm":true,"cp":false}
```

Screenshots:
- **`docs/autosave-nach-reload.png`** (ganzseitig: Merker-Karte „Letztes Paket automatisch gespeichert")
- **`docs/autosave-usage.png`** (Sichtfenster: Limit-Banner „Monatslimit erreicht (5/5)" + Merker-Karte)

Zusatzbeleg aus der **DB-Quelle** (nicht nur localStorage): die Projektansicht
`/app/projects/a013ef8a-a3b6-437a-8b42-07ed1668a63a` rendert das gespeicherte Paket vollständig:

```json
{"step":"project_view","url":"/app/projects/a013ef8a-a3b6-437a-8b42-07ed1668a63a","title":["Personalisierte Bienenwachskerzen für Kinder","Generierte Inhalte (5)","📅 Was zuerst publizieren?","🎨 KI-Bild-Studio"],"bodyLen":22211,"channelTerms":5,"hasKerzen":true,"cp":false}
```

**`docs/autosave-projekt.png`** (Projektansicht: Titel, Kanäle Pinterest/Etsy/SEO Blog/Social/E-Mail, „Generierte Inhalte (5)")

### (d) Usage genau 5 (nicht 6) ✅

- **DB (`usage_monthly`, Periode 2026-10): `count = 5`** — exakt 5, nicht 6 (der Auto-Save selbst verbraucht 0;
  die 5 stammen aus den 5 Kanal-Generierungen).
- **UI nach dem Reload:** Banner `"Monatslimit erreicht (5/5) / Dein Free-Kontingent ist aufgebraucht. Mit Pro
  erhältst du 200 Generierungen pro Monat."` ⇒ korrekter Limit-Zustand, **0 von 5 verbleibend**.

**Ehrliche Anmerkung (P2, unverändert):** unmittelbar nach dem Lauf, ohne Reload/Route-Wechsel, zeigte der
Banner noch den alten Stand „5 von 5 Generierungen verbleibend". Das ist der bereits notierte Befund
„Usage-Banner stale nach Generierung" (`UsageStatus` lädt bei Mount/Routenwechsel/Fenster-Fokus, nicht bei
Generierungsende). Der **DB-Wert ist korrekt**; nach dem Reload stimmt auch die Anzeige. Kein Beleg dafür,
dass der Auto-Save den Zähler erhöht hätte — er tut es nicht.

### (e) Idempotenz: keine zweite Project-Zeile ✅

`scripts/_autosave-e2e-count.ts <clerkId> after_reload` (nach dem Reload aus (c)):

```json
{"label":"after_reload","projectRows":1,"projects":["a013ef8a-a3b6-437a-8b42-07ed1668a63a"],"projectTitles":["Personalisierte Bienenwachskerzen für Kinder"],"contentRows":5,"perProject":[{"id":"a013ef8a-a3b6-437a-8b42-07ed1668a63a","contents":5}],"usage":[{"period":"2026-10","count":5}]}
```

**Weiterhin genau 1 Projektzeile, identische row_id `a013ef8a-a3b6-437a-8b42-07ed1668a63a`, weiterhin 5
Content-Zeilen, usage unverändert 5** ⇒ der Reload löst keinen zweiten Save, kein Überschreiben und keine
zweite Generierung aus.

### Bundle-Gegenprobe der live stehenden Version (Chunks von www.growimo.app, 2026-10-03)

| Chunk | SHA-256 (erste 16) | Bytes | Marker |
|---|---|---|---|
| `assets/package-DuVTQHLh.js` | `41eb2cb3461046c1` | 23 227 | `growimo_package_last_saved` @2909, `package-last-saved` @10237, `package_last_saved_title` @10513, `package-autosave-hint` @14469, `package_autosaved` @14652 |
| `assets/index-ZEKWG6Sl.js` | `508586145b2de53d` | 602 549 | `package_autosaved` @479403, `"Automatisch gespeichert"` @479426, `package_last_saved_title` @479508 |

Beide Hashes und alle Offsets sind **identisch zu §4** ⇒ die live ausgelieferte Version ist byte-identisch mit
der dort belegten, d. h. der Auto-Save-Code ist live. Kein neues Deployment nötig (und keines erfolgt).

## 6. Werkzeuge / Reproduktion

- `scripts/_autosave-e2e-setup.ts` (synthetischer Clerk-Nutzer + `/api/beta-signup` + Ticket)
- `scripts/_autosave-e2e-count.ts <clerkId> [label]` (read-only Zähler: projects / generated_content / usage_monthly)
- Login-Token: `POST https://api.clerk.com/v1/sign_in_tokens {user_id, expires_in_seconds:3600}`
- Browser-Ablauf der Nachsession (`/tmp/as3/`, Helfer, **nicht** Teil des Commits):
  `run.sh` (Login-Page → `/app/package?idea=` → Klick → Marker-Poll → Assertions → Screenshots),
  `chain.sh` (wartet auf `E2E_RUN_SCRIPT_DONE`, dann DB-Zähler, Reload-Teil, zweiter DB-Zähler),
  `reload.sh` (Reload ohne `?idea=`), `project.sh` (Projektansicht + Bundle-Marker-Gegenprobe)
  sowie `js/{form,click,poll,after,reload,project}.js`.
- Screenshots: `docs/autosave-hinweis.png`, `docs/autosave-nach-reload.png`, `docs/autosave-usage.png`,
  `docs/autosave-projekt.png`.

### Nachtrag: früherer, abgebrochener Browser-Lauf (Vorsession, überholt)

```json
{"label":"after_run","clerkId":"user_3KC3rE9VU1DSNmqDawicCwt15CT","internalUserId":"88501a29-5622-403b-9dd7-340a495cbdc4","projectRows":0,"contentRows":0,"usage":[]}
```

Damals kam der Lauf nicht über die Navigations-/Poll-Phase hinaus (CLI-Hänger), daher planmäßig kein
Auto-Save und kein Verbrauch. **Dieser Stand ist durch den oben dokumentierten vollständigen Live-Lauf
überholt**; (a)–(e) sind erbracht.

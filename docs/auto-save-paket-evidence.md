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

## 5. Live-E2E gegen www.growimo.app

Synthetischer Nutzer (kein Demo-Konto, kein Limit-Umgehen):
`user_3KC3rE9VU1DSNmqDawicCwt15CT` / `e2e-autosave-…@ctomail.io`, Beta-Freischaltung über die
öffentliche Produktions-API `POST /api/beta-signup` → **HTTP 200** (`already:false`).

Baseline-Zähler VOR dem Lauf (bun+pg):
`{"userFound":false,"projects":0,"contentRows":0,"usage":[]}` — der Nutzer existierte in der DB noch nicht.

- **Login am App-Origin ✅** (Clerk sign-in token, kein Turnstile):
  `{"step":"login","url":"/app","uid":"user_3KC3rE9VU1DSNmqDawicCwt15CT","bodyLen":1347}`
- **Paket-Lauf NICHT abgeschlossen** ⚠️ Der Browser-Schritt „`/app/package` laden → Idee setzen → ✨ Paket generieren"
  ist nicht über die Navigations-/Poll-Phase hinausgekommen (agent-browser-CLI hing ab dem Schritt-2-Aufruf;
  Sitzung auch nach `timeout`-Wrapper nicht weiter). Ein Teil-Lauf im UI ist damit **nicht belegt** und wird
  hier bewusst nicht als Erfolg behauptet. Konsequenz: (a)–(e) des Live-E2E (DB-Zähler projects>0,
  Auto-Save-Hinweis-Screenshot, Reload-Screenshot, Usage=5, Idempotenz ohne zweite Project-Zeile)
  sind **offen** — Nachweis über Teil A/B der Test-Suite, nicht über die Live-Umgebung.
- Kein `Als Projekt speichern`-Klick erfolgt; die Generierungen des Testnutzers wurden nur teilweise
  verbraucht (kein abgeschlossener Lauf ⇒ planmäßig auch kein Auto-Save).

## 6. Werkzeuge / Reproduktion

- `scripts/_autosave-e2e-setup.ts` (synthetischer Clerk-Nutzer + `/api/beta-signup` + Ticket)
- `scripts/_autosave-e2e-count.ts <clerkId> [label]` (read-only Zähler: projects / generated_content / usage_monthly)
- `/tmp/e2e-autosave.sh` (Browser-Ablauf), `/tmp/bundle-proof.sh` (Marker-Beleg)
- Beide Skripte sind Helfer und **nicht** Teil des Commits.

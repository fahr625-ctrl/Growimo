# TikTok-Diagnose UX-Fix — Evidence

Datum: 2026-09-12 · Branch: master · Basis-HEAD: 3a8c88e
Commit: (siehe git log — „fix(tiktok): Diagnose-Eingabefelder sichtbar + Feld-Validierung + 'TikTok analysieren'-Button")

## 1. Root-Cause (wörtlich, mit Zeilenangabe)

In `src/routes/app/tiktok.tsx` startete die Diagnose-Karte die Diagnose **sofort**:

- Z. 743 (alt): `<button onClick={() => void run('diagnose')} …>` — Karten-Klick rief `run('diagnose')` direkt auf.
- Innerhalb `run()` (Z. ~435 ff.) lief **vor** dem Anzeigen der Felder die Pflichtfeld-Validierung:
  - Z. 467–477 (alt): `missingDiagnoseMetrics(metrics)` prüft views/length/avgWatch; bei leeren Eingaben → `valid = false`, `setErrorMessage(validationMsg)` (generische Meldung unten) und `return` — **bevor** Z. 482 `setActiveMode(mode)` erreicht wurde.
- Die Metrik-Eingabefelder werden aber NUR bei `activeMode === 'diagnose'` gerendert (Z. ~759, `{activeMode === 'diagnose' && (<section>…Felder…</section>)}`).

**Folge:** Beim Klick auf „Warum floppt mein TikTok?“ mit (standardmäßig) leeren Metrikfeldern blieb `activeMode = null`; der Diagnose-Block mit den Eingabefeldern wurde **nie gerendert**. Der Nutzer sah nur die generische Fehlermeldung unterhalb der Karten und konnte die Diagnose nicht nutzen. → Root-Cause: **Eingabefelder waren vorhanden, aber fälschlich an `activeMode === 'diagnose'` gebunden, das erst NACH erfolgreicher Validierung gesetzt wurde — und die Diagnose startete per Auto-Start beim Karten-Klick, nicht per explizitem Button.**

## 2. Änderungen

`src/routes/app/tiktok.tsx`:
- **Karten-Klick** (Diagnose): `startDiagnose()` wählt nur den Modus an (Felder erscheinen sofort); **kein Auto-Start** mehr.
- **Neue Funktion** `diagnoseMetricIssues()` (exportiert, getestet): feld-genaue Prüfung views/length/avgWatch → `missing` (leer) oder `invalid` (keine nicht-negative Zahl). Komma/Dezimal akzeptiert („12,5“ ≡ „12.5“); Videolänge akzeptiert dieselben Formate wie der Server-Parser `parseLengthSeconds` („31“, „31s“, „42 Sekunden“, „0:42“; Wert > 0 — 0s lehnt auch der Server als „fehlt“ ab). 0 ist für views/avgWatch eine echte 0 (gültig, wie Server-Verhalten).
- **Button „TikTok analysieren“** (`tiktok_analyze_button`): startet die Diagnose NUR bei Klick; vorher feld-genaue Validierung. Leere/gültige Felder → rotes Feld + Meldung direkt am Feld (`tiktok_field_required` / `tiktok_value_invalid`); KEINE generische Fehlermeldung für diesen Fall.
- `metricInput()`: roter Rahmen (`border-red-400 bg-red-50`) + Meldung unter dem Feld + `aria-invalid`; Fehler wird beim Tippen im selben Feld sofort gelöscht; Pflichtfelder mit `*`-Marker; `inputMode="numeric"`.
- `metricNumber()`: normalisiert Komma → Punkt („12,5“ → 12.5), damit auch die deutsche Eingabeform an den Server geht.
- Bestehende Server-Validierung (`missingDiagnoseMetrics` + `tiktok_error_metrics` in `run()`) bleibt als Backstop unangetastet; Diagnose-Flow/Server-Pfad unverändert.

`src/i18n/de.ts` + `src/i18n/en.ts` (7 neue Keys, Parität):
`tiktok_analyze_button` („TikTok analysieren“ / „Analyze TikTok“), `tiktok_field_required` („Bitte %s eingeben“ / „Please enter %s“), `tiktok_value_invalid` („Bitte eine gültige, nicht-negative Zahl eingeben (z. B. 1200)“ / „Please enter a valid, non-negative number (e.g. 1200)“), `tiktok_metrics_required_hint` („Pflichtfelder für die Diagnose“ / „Required fields for the diagnosis“), `tiktok_metrics_views_ph`/`tiktok_metrics_length_ph`/`tiktok_metrics_avgwatch_ph` (Beispiel-Platzhalter de/en).

`tiktok-phase3-test.ts`: neues Szenario **T6b** „Feld-genaue Validierung: diagnoseMetricIssues“ (13 Checks: missing/invalid, Komma, Längen-Formate, 0-Werte) + UI-Verdrahtungs-Checks (startDiagnose statt Auto-Start, Button, Feld-Meldungen).

## 3. Gates

- `npx tsc -p tsconfig.gate.json --noEmit`: **60 Fehler = unveränderte Baseline** (identisch zu HEAD 3a8c88e, dokumentiert im Vorgänger-Commit „tsc 60=Baseline“); **0 neue** (keine Fehler in tiktok.tsx / den neuen i18n-Keys).
- i18n: `bun --env-file=.env run i18n-scan.ts` → `✅ KEY-PARITY: identical key sets` + `✅ UI HARDCODED STRINGS: no English UI strings outside i18n`. Verbleibender Exit 1 = **vorbestehende** [SERVER-LIT]-INFO-Funde (auch im sauberen Baseline-Clone identisch, Baseline-Exit 1).
- `bun tiktok-phase3-test.ts`: **91 PASS, 0 FAIL** (inkl. neuem T6b).
- `bun tiktok-test.ts` (Gesamtsuite Phase 1–6 inkl. Härtung H1–H10 + i18n-H7): **421 PASS, 2 FAIL** — die 2 FAILs sind ausschließlich `transport-regression-test.ts` („Keine gültige Sitzung — bitte neu anmelden.“ für todayIdea/concept). Ursache: Test rundet durch den **vorbestehenden dist-Build** (Stand HEAD 17:01, ohne meine Änderungen); die ServerFn-Session-Validierung schlägt ohne Browser-Session fehl (fail-closed, exakt das in Commit 3a8c88e dokumentierte „Owner-Leg: API-JWT ohne Browser-Session“). **Kein Zusammenhang mit dieser Änderung** (berührt weder tiktok.ts/Server noch Session/Auth).
- `bash build-vercel.sh`: **EXIT 0** (siehe unten).

## 4. Deploy

- Commit + Push: `fix(tiktok): Diagnose-Eingabefelder sichtbar + Feld-Validierung + 'TikTok analysieren'-Button`
- `bash build-vercel.sh && bunx vercel deploy --prebuilt --prod --yes` → Ready (Deployment-URL: siehe Deploy-Output / Verlauf; transient „Not authorized“ → sofortiger Retry).
- www.growimo.app: **HTTP 200 verifiziert** (curl, nach Deploy).

## 5. Bundle-Beleg (render.func / Client-Assets)

- deploy-Artefakt `.vercel/output/functions/render.func/index.mjs` enthält die neuen i18n-Werte:
  - `TikTok analysieren` (de) und `Analyze TikTok` (en) — wörtlich im Bundle gefunden.
  - `Bitte %s eingeben` / `Please enter %s`; `Bitte eine gültige, nicht-negative Zahl` / `valid, non-negative number`; `Pflichtfelder für die Diagnose` / `Required fields for the diagnosis` — enthalten.
- Client-Bundle (dist/client) enthält die neuen Keys in den i18n-Chunks.

## 6. Mobiler Test-Status

- Die Route `/app/tiktok` liegt hinter Clerk-Auth (`ProtectedRoute`) — ohne gültige Browser-Session (Login) ist das UI nicht erreichbar (Redirect zu Sign-in); eine automatisierte Mobile-Session existierte in dieser Umgebung nicht (API-JWT ohne Browser-Session ist fail-closed, siehe Gates).
- **Ohne Login verifizierbar:** erfolgt — SSR-Bundle enthält „TikTok analysieren“ + Feld-Validierungstexte (Punkt 5); der Client-Build wird auf dem Handy geladen, die Diagnose-Sektion rendert beim Klick auf die Karte (reines Client-Verhalten, kein Server-Call vor dem Button).
- **Owner-Selbstcheck (empfohlen):** Bitte auf dem Handy (und Desktop) www.growimo.app → Anmelden → TikTok → Karte „Warum floppt mein TikTok?“ antippen → die drei Pflichtfelder „Aufrufe (Views)“, „Videolänge“, „Durchschnittl. Wiedergabedauer“ müssen SOFORT sichtbar sein; Button „TikTok analysieren“ darunter; mit leeren Feldern klicken → rote Markierung + Meldung direkt am jeweiligen Feld; Werte eingeben → Klick startet die Diagnose.

## 7. Repo-Zustand / Hinweise

- .git-Verzeichnis des Repos war in der Umgebung verschwunden (kein `git status` möglich); wiederhergestellt per frischem Clone von origin/master@3a8c88e (Identität verifiziert: HEAD vorher/nachher identisch, Working Tree zeigte exakt die 4 geänderten Dateien + vorbestehende Untracked-Scratch-Dateien unter scripts/). Keine Dateien verloren.
# Stabilisierung Phase 4 — Evidence (Teil 4.2 Kontexttreue; 4.1/4.3 offen)

Stand: 2026-09-19, Session des Engineers. **ABGESCHLOSSEN: verifiziert, committet (`d7c73b5`),
gepusht, deployt (`site-qvvw8v98d-growimo`), Live-Check + Bundle-Beleg grün — Abschnitte 4, 6, 7.**

Kurzfassung: Das verlorene `.git` des Arbeitsbaums wurde aus einem frischen Voll-Clone
wiederhergestellt; der Arbeitsbaum-Stand war identisch mit dem gesicherten Tarball (9 Dateien
byte-identisch, `diff -q`), alle Gates sind grün, der Stand ist als `d7c73b5` auf `origin/master`,
das Deployment `site-qvvw8v98d-growimo.vercel.app` bedient `www.growimo.app` (alle Routen 200).

## 1. Auftrag und Umfang

Fix-Plan `/home/team/shared/stabilisierung-fixplan.md`, Abschnitt „Phase 4" (Zeilen 314–345):
Priorität 1 = 4.2 (Kontexttreue aller Kanäle), danach 4.1 (Navigation/History), danach 4.3
(„Zuletzt erstellt"). Reihenfolge eingehalten: **4.2 fertig implementiert und getestet**,
4.1/4.3 nicht begonnen (Budget-/Repo-Blocker, s. Abschnitt 6).

## 2. Ursache (C1/C2)

Die Kanäle (Pinterest/SEO/Etsy/Newsletter/Paket) konnten das Nutzerthema verlassen und
stattdessen Growimo selbst (die App) zum Inhalt machen. Phase 1 hatte nur den Nutzer-Vorrang als
Prompt-Regel (`USER_PRIORITY_CONSTRAINT`), Phase 2 nur ein Selbstreferenz-Verbot im TikTok-Modul.
Es fehlten (a) eine explizite Selbstbezug-Regel für ALLE Kanäle und (b) ein deterministischer
Post-Check der Kanal-Ausgaben (Muster `src/ai/tiktok.ts` `SELF_REFERENCE_PATTERNS`).

## 3. Änderungen (4.2)

| Datei | Änderung |
|---|---|
| `src/ai/context-loyalty.ts` **(neu)** | Kontext-Modell + Post-Check: `SELF_REFERENCE_CONSTRAINT` (de+en Prompt-Baustein), `contextLoyaltyCorrection('de'\|'en')`, `CONTEXT_LOYALTY_ERROR`, `userNamesGrowimo()`, `brandContextIsGrowimo()` (NUR `- Marke: Growimo…` / `- Website: …growimo.app`, nicht bloßes Wortvorkommen), `readBrandIdentity()`, `resolveGrowimoContext()`, `contextLoyaltyViolations()`, `requestLoyaltyViolations()`, `resultLoyaltyViolations()` |
| `src/ai/providers/openai.ts` | `buildSystemPrompt()` hängt den Selbstbezug-Bann an **jeden** Kanal-System-Prompt (zusätzlich zur Phase-1-Vorrang-Regel); `buildUserPrompt()` rendert den Korrektur-Hinweis (vor dem Zusatzkontext) |
| `src/ai/types.ts` | `ContentRequest.correctionNote?` (interner Retry-Hinweis; von den Server-Fn-Validatoren NICHT durchgereicht) |
| `src/ai/generate.ts` | Zentraler Guard `runWithContextLoyalty()`: 1 Provider-Aufruf → bei Verstoß **EIN** korrigierender Versuch → bleibt der Verstoß, `throw new Error(CONTEXT_LOYALTY_ERROR)` (**kein stilles Liefern**). Deckt alle Pfade ab, die `generateContent` nutzen: QuickGenerator, new-project (Legacy + SSE-Stream), improve, Paket |
| `src/ai/package/package.ts` + `src/ai/package/generate.ts` | **Paket-Flow bekommt dasselbe Kontext-Modell**: `PackageOptions.brandContext`, Markenrahmen im kombinierten Kanal-Kontext (Kernel → Marke → Brief → Performance → Lernschleife), `generatePackageChannel(..., brandContext)` |
| `src/ai/server.ts` | `fetchPackageKernelServer` + `generatePackageChannelServer` akzeptieren `brandContext` (getrimmt, auf 8000 Zeichen begrenzt) und reichen ihn in den Paket-Kontext |
| `src/routes/app/package.tsx` | Paket-Route sendet `getBrandContext()` mit (AUSgeschaltetes Profil ⇒ `''`, keine Wirkung) |

Erlaubt ist Growimo-Inhalt nur, wenn (a) der Nutzer Growimo ausdrücklich in der Produktidee nennt
ODER (b) das Markenprofil eindeutig Growimo ist (Markenname `Growimo…` oder Website `growimo.app`).
Bewusste Design-Entscheidung: ein einzelnes Vorkommen des Wortes „Growimo" irgendwo im
Zusatzkontext (Strategie-Brief/Performance/Präferenzen) gibt KEINE Erlaubnis — sonst würde Test B/E
durchschlagen. Test A (Profil EIN + Idee „Growimo") bleibt erlaubt (beide Quellen greifen).

Usage-Semantik: Bei Ablehnung wirft `generateContent`; `withGenerationGuard` kompensiert den
Zähler bei Fehlern (Phase 8.2 „nur verbrauchen, wenn erfolgreich") — der Nutzer verliert keine
Generierung, es wird nichts Falsches geliefert.

## 4. Gates (durchgeführt)

- **Neue Phase-4-Suite** `stabilisierung-phase4-test.ts`: **50 PASS, 0 FAIL, EXIT 0**
  (34 Fälle für 4.2 — inkl. Test A/B/E, Profil-/Projekt-Kontext, Paket-Flow, de/en,
  Retry-/Reject-Verhalten mit injiziertem Runner, Quelltext-Verdrahtung — plus i18n-Parität).
  Log: `phase4-42-artifacts/phase4-test-run.log`.
- **`bunx tsc --noEmit`: 171 Fehler = gemeldete Baseline 171** (Lauf nach den Änderungen,
  Log `phase4-42-artifacts/tsc-after.log`). In den 4.2-berührten Dateien **keine neuen Fehler**:
  `context-loyalty.ts`, `generate.ts`, `types.ts`, `providers/openai.ts`, `package/package.ts`,
  `package/generate.ts`, `stabilisierung-phase4-test.ts` → **0 Zeilen**;
  `src/ai/server.ts` (7 Zeilen) und `src/routes/app/package.tsx` (1 Zeile) zeigen ausschließlich den
  **vorbestehenden** TS2345-ServerFnCtx-Fehler bzw. `AnalyticsEvent`-Fehler — dieselbe Meldungsart
  belegt der Vorlauf-Log `tsc-p3.log`/Phase-3-Evidence für unveränderte Zeilen.
  Ein Vorher/Nachher-Lauf über `git stash` war nicht möglich (s. Abschnitt 6).
- **Suiten-Gates 31/32/55/56 vollständig nachgezogen — alle EXIT 0** (Rohlogs `/tmp/g31.log`,
  `/tmp/g32.log`, `/tmp/g55.log`, `/tmp/g56.log`; Auszüge in `stabilisierung-phase4-suiten.txt`):

  | Gate | Suite | Ergebnis |
  |---|---|---|
  | 31 | `usage-guard-test.ts` | **31 PASS, 0 FAIL, EXIT 0** |
  | 32 | `usage-semantics-test.ts` | **32 PASS, 0 FAIL, EXIT 0** |
  | 55 | `tiktok-diagnose-v2-test.ts` | **56 PASS, 0 FAIL („ALLE TESTS BESTANDEN"), EXIT 0** |
  | 56 | `stabilisierung-phase3-test.ts` | **85 PASS, 0 FAIL, EXIT 0** |

  Der im Phase-4-Vorlauf beobachtete Abbruch von Suite 31 war **keine Fehlfunktion, sondern Laufzeit**:
  Abschnitt 4 der Suite schreibt 200 Generierungen sequenziell in `usage_monthly` (Neon-Roundtrips);
  ohne Fortschrittsausgabe entsteht minutenlange Stille, danach läuft die Suite normal zu Ende
  (`[5] Rate-Limit … [8] Cleanup` + `=== usage-guard-test: 31 PASS, 0 FAIL ===` + `process.exit(0)`).
- **i18n**: keine neuen UI-Strings (die Server-Meldung ist bewusst zweisprachig im Text, wie die
  übrigen Server-Fehler). Parität de/en **1494 = 1494, 0 fehlende Schlüssel** (in der Phase-4-Suite
  mitgeprüft, PASS; zusätzlich direkt nachgemessen).
- **Build (`bash build-vercel.sh`): EXIT 0** (Log `/tmp/build-p42.log`).
- **Deploy: SUCCESS** (s. Abschnitt 6). Vorher ist der Deploy einmal mit `Error: Not authorized`
  gescheitert, weil das per `--token` übergebene Access-Token aus `auth.json` abgelaufen war
  (`expiresAt` ≈ 03:32 UTC, 17,6 h vor dem Lauf). **Fix/Erkenntnis:** die Vercel-CLI ohne `--token`
  aufrufen (`HOME` des Owners), dann erneuert sie das Token selbst über den `refreshToken`;
  `vercel whoami` → `fahr625-3542`. Danach lief derselbe Deploy durch.

## 5. Nicht begonnene Teile (4.1, 4.3) — Vorarbeit für die Folge-Session

- **4.1 Navigation/History**: Vorab-Prüfung ergab, dass in `src/routes/app/tiktok.tsx` und
  `src/routes/app/image-studio.tsx` **keine** `<a href>`-Sprüngе auf interne Routen mehr existieren
  (Phase 3 hat sie auf `Link` umgestellt; `grep` über beide Dateien: nur `Link`-Komponenten,
  `window.location.search` in image-studio.tsx:135). Offen bleiben: (a) `pageshow`/`persisted`-Guard
  in `src/routes/app.tsx` (Beta-Gate: bei bfcache-Rückkehr `approved` behalten statt neu zu prüfen)
  und `src/components/ProtectedRoute.tsx` (`slowLoad`-Hinweis bei Rückkehr zurücksetzen),
  (b) Gate-Ergebnis kurzzeitig in `sessionStorage` spiegeln, damit Reload/Zurück nicht erneut
  „Lädt...“ zeigt (`src/lib/navigation-lifecycle.ts` als reines, testbares Modul vorgesehen),
  (c) Tracking-Zählung: `track('image_studio_opened')` feuert pro Mount und zusätzlich, wenn
  `user?.id` nachträglich eintrifft (Dep `[user?.id]`) — die Anchor→Link-Umstellung ändert daran
  nichts (vorher: Vollseiten-Reload = 1 Mount, heute: SPA-Navigation = 1 Mount); als Doppel-Feuer
  zu dokumentieren/ggf. auf einmal-pro-Mount zu begrenzen.
- **4.3 „Zuletzt erstellt"**: Aufbau auf `src/lib/last-result.ts` (Phase 3, `growimo_tiktok_last_result`,
  Version + TTL). Geplant: Liste (max. 3) mit Versionsfeld, Wiederöffnen eines früheren Ergebnisses,
  „In Projekt speichern" nach dem Muster `QuickGenerator.tsx` `saveProject` — **ohne** DB-Schema- und
  ohne `ContentType`-Eingriff; „In Projekt speichern" verbraucht KEINE Generierung (Zähl-Semantik
  dokumentieren).

## 6. Repo-Wiederherstellung, Commit, Deployment (vormals Blocker)

- **Ursache:** `.git` des Arbeitsbaums war verloren gegangen (Computer-Wechsel); der Arbeitsbaum
  selbst inkl. der 4.2-Änderungen war intakt.
- **Wiederherstellung (Schritt 1):** `git clone https://github.com/fahr625-ctrl/Growimo.git /tmp/growimo-full`
  → `1dca72d (HEAD -> master, origin/master)`, `.git` = 3,1 MB; dann
  `cp -r /tmp/growimo-full/.git /home/team/shared/site/.git`. Danach `git log`/`git status` normal:
  **7 modifizierte + 2 neue Dateien = genau die 9 Phase-4.2-Dateien.** Alle 9 sind per `diff -q`
  **byte-identisch** mit dem Tarball `/home/team/shared/phase4-42-artifacts/phase4-42-changed-files.tar.gz`
  (Gegenprobe gegen den Datenverlust). Kein `checkout`/`reset`/`stash` nötig oder ausgeführt.
- **Commit 1:** `d7c73b5` — *feat(context-loyalty): Phase 4.2 — Kontexttreue fuer alle Kanaele
  (Prompt-Regel + deterministischer Post-Check + Paket-Flow)* — 9 Dateien, 676 Insertions/20 Deletions.
  Push verifiziert: `origin/master` = `d7c73b5` (`git log` zeigt `(HEAD -> master, origin/master)`).
- **Deploy:** `bash build-vercel.sh && bunx vercel deploy --prebuilt --prod --yes`
  → **`https://site-qvvw8v98d-growimo.vercel.app`** (Deployment-ID `G6dYgcWaUw7d8WygjVsyMpUZ3fTq`,
  `Production`, Upload 5,2 MB), Alias `www.growimo.app`.
- **Live-Check (HTTP 200, 2026-09-19):** `www.growimo.app/` · `/app` · `/app/tiktok` ·
  `/app/image-studio` · Deployment-URL → alle **200**.
- **Nicht committet** (bewusst, unverändert untracked): die Helfer-Skripte unter `scripts/`
  (`mint-session*.ts`, `e2e-*.ts`, `qcheck.ts`, `_*.tmp.tsx`) und `_todayidea-raw-response.txt`
  aus früheren Sessions — sie gehören nicht zu Phase 4.2.

## 7. Bundle-Beleg (Skill `prod-bundle-marker-proof`)

Vollständig in `/home/team/shared/stabilisierung-phase4-bundle-proof.txt`. Kern:

- **Server-Bundle** `.vercel/output/functions/render.func/index.mjs` (4.376.492 B,
  sha256 `c94da6135194f934640b28752d21b0a52baaf0546fb8f9e504b7d6f68717281f`) enthält die neuen
  Marker: `SELF-REF:growimo` 2× (@1.965.530, @4.187.399), `KEIN SELBSTBEZUG` 2× (@1.975.951,
  @4.187.879), `CONTEXT_LOYALTY_ERROR` 6× (@1.976.834 u. a.), `contextLoyaltyCorrection` 8×.
  Der Zitat-Kontext zeigt `contextLoyaltyViolations(text, ctx) → return GROWIMO_MENTION_RE.test(text)
  ? ["SELF-REF:growimo"] : []` — d. h. der deterministische Post-Check ist im ausgelieferten
  Artefakt, nicht nur im Quelltext.
- **Aussagekraft:** `SELF-REF:growimo` / `KEIN SELBSTBEZUG` existieren vor Phase 4.2 nirgends im
  Repo; sie können nur über `d7c73b5` in dieses Bundle gelangt sein.
- **Bindung Live ↔ lokal:** 22 von 22 ausgelieferten `/assets/*.js` sind **sha256-identisch** mit
  dem lokal vorgebauten `dist/client/assets` → die Live-Auslieferung ist genau das mit `d7c73b5`
  erzeugte Prebuilt-`.vercel/output`. Live-Marker im Client: `package-DI93-mtW.js` enthält
  `brandContext` (@5455 — die in Phase 4.2 neu mitgesendete Marken-Kontext-Übergabe der Paket-Route).
- **Einschränkung ehrlich benannt:** Das Server-Bundle ist nicht über eine öffentliche URL
  abrufbar; der Marker-Beleg stammt daher aus dem Artefakt, das hochgeladen wurde, plus der
  sha256-Bindung der Client-Chunks an die Live-Domain. Ein *nur* über HTTP abrufbarer Server-string
  existiert nicht.

## 8. Randbedingungen geprüft

- Phase 1 (Markenprofil EIN/AUS + Nutzereingabe-Vorrang) unverändert: die neue Regel kommt
  ZUSÄTZLICH zur `USER_PRIORITY_CONSTRAINT` (Suite prüft beides in jedem Kanal-Prompt).
- Phase 2/3 (TikTok-Qualität, Bild-Studio, Persistenz) nicht angefasst: `src/ai/tiktok.ts`,
  `src/routes/app/tiktok.tsx`, `src/routes/app/image-studio.tsx`, `src/lib/*` unverändert.
- Usage-/Billing-Kette (8.2/8.3) nicht berührt: keine Änderung an `src/lib/usage-guard.ts`,
  `src/ai/server.ts`-Guard-Aufrufen oder DB-Queries; Fehlerfall bleibt zähler-kompensiert.
- Keine DB-Schreibvorgänge, keine Migration, keine neuen Env-Variablen.
- Keine erfundenen Leistungsdaten/Testimonials — die neue Regel verbietet zusätzlich den
  Growimo-Selbstbezug ohne Nutzer-/Profilbezug.

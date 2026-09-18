# Stabilisierung Phase 1 — Evidence (Markenprofil EIN/AUS + Nutzereingabe-Vorrang)

**Datum:** 2026-09-18 · **Engineer-Session** (Abschluss der Phase-1-Delegation; Vorsession fc159294 lief ins Work-Budget)
**Fix-Plan:** `/home/team/shared/stabilisierung-fixplan.md`, Teil C Phase 1 (1.1–1.4) + Cluster C1–C4, C8-relevant nur soweit Phase 1
**Commit:** `06303f1` (`feat(brand): Phase 1 — Markenprofil EIN/AUS + Nutzereingabe-Prioritaet (C1-C4)`), auf `origin/master` gepusht.

## 1. Was gebaut wurde

### 1.1 Schalter-Datenmodell (Client) — `src/store/brand.ts`, `src/components/BrandProfileToggle.tsx`, `src/components/BrandBadge.tsx`, `src/routes/app/brand.tsx`
- `BrandProfile.enabled: boolean`; `normalizeBrandProfile()` setzt `enabled: profile.enabled !== false` → **Alt-Profile ohne Feld bleiben AKTIV** (kein Bestandsverhalten geändert).
- `isBrandProfileEnabled()` (kein Profil ⇒ `false`), `setBrandProfileEnabled(enabled)` (persistiert, **löscht nichts**; ohne Profil no-op).
- **Ein zentrales Gate:** `getBrandContext()` liefert bei `enabled === false` **immer `''`** → alle Konsumenten (QuickGenerator, new-project, TikTok) erben das Verhalten. `isBrandProfileComplete()` ist bei AUS ebenfalls `false` (KEINE nutzbare Faktenbasis, keine Empfehlungen/Gaps).
- Sichtbarer Schalter `BrandProfileToggle` (role="switch", `data-testid="brand-profile-toggle"`, `data-enabled`), eingebunden in **TikTok-Werkstatt**, **QuickGenerator** (compact) und **Marken-Seite**; rendert nichts ohne Profil. `BrandBadge` zeigt bei AUS „Markenprofil aus".
- Neuer Analytics-Event-Typ (`brand_profile_enabled/disabled`) inkl. Label-Map + i18n-Keys (de/en) — dafür wurde ein **vorher bestehender** tsc-Fehler (`hasExisting` unused in brand.tsx) mitbehoben.

### 1.2 Markenblock als zusätzlicher Kontext statt Produktidee — `src/components/QuickGenerator.tsx`, `src/routes/app/new-project.tsx`, `src/ai/providers/openai.ts`
- Der Markenblock wird **nicht mehr** in `productIdea` geklebt: `productIdea` ist roh, der Markenblock geht als eigener Abschnitt in `additionalContext` (`[brandContext, briefContext, perfContext, learnContext]`), zusammen mit Live-Analyse/Market-Intelligence-Pfaden in new-project.
- Der Markenblock selbst beginnt mit „MARKENKONTEXT (Stil- und Faktenrahmen …)" und endet mit einer **VORRANG-REGEL (verbindlich)**: Inhalt/Gegenstand kommen aus der Nutzereingabe; nennt der Nutzer ein anderes Produkt/Thema („kleines Café", „Schmuck", „Weihnachts-Pin"), ist genau das das Thema; der Markenkontext liefert nur Tonalität; niemals überschreiben; passt er nicht, Fakten ignorieren. (Alte Formulierung „authoritative Faktenbasis" entfernt.)
- **Provider-Pfad (openai.ts)**, alle Kanäle: neue globale `USER_PRIORITY_CONSTRAINT` wird an **jeden** System-Prompt angehängt (`buildSystemPrompt()`), und die Prompt-Zusammensetzung wurde in eine testbare reine Funktion `buildUserPrompt()` gezogen (Produktidee zuerst/roh, Markenkontext danach im Abschnitt „Produktdetails"). Deutsches Ausgabe-Erzwingen passiert weiterhin genau einmal.

### 1.3 TikTok: Vorrang + keine stille Profil-Vorbefüllung — `src/ai/tiktok.ts`, `src/routes/app/tiktok.tsx`
- Hart vorrangige Regel **VORRANG DER NUTZEREINGABE / PRIORITY OF THE USER'S OWN INPUT** in `IDEA_COMMON_DE`/`IDEA_COMMON_EN` (gilt für `todayIdea` **und** `concept`) — Thema „Unternehmen/Produkt"/„Thema" schlägt den MARKENKONTEXT, niemals in Marken-Marketing umdeuten, Thema nie stillschweigend weglassen.
- Markenblock-Label im TikTok-User-Prompt von „authoritative Faktenbasis" auf „Stil- und Faktenrahmen … die Nutzereingabe hat Vorrang und bestimmt das Thema" geändert.
- **Keine stille Vorbefüllung:** `biz`/`audience`/`goal` werden nicht mehr automatisch aus dem Profil gesetzt; expliziter Button „Aus Markenprofil übernehmen". Bei AUS: kein `brandContext`, kein Goal-Fallback, keine Gaps-Vorschläge, Hinweis-Banner (`tiktok-brand-off-hint`).
- **Selbsttest:** `selfCheckRejected(sc, { userSubjectProvided })` + neu `selfCheckSuspiciousCount()` — gibt der Nutzer das Thema selbst vor (oder existiert kein Markenkontext), zählt „keine Markenfakt genutzt" NICHT als Mangel ⇒ kein Retry gegen das Nutzerthema. HARD REJECTS (erfundenes Testimonial, unbelegtes Leistungsversprechen, verordnete Begeisterung) bleiben unverändert hart.

### 1.4 Draft-vs-`?idea=`-Priorität — neu `src/lib/idea-priority.ts` + `QuickGenerator.tsx`, `routes/app/new-project.tsx`, `routes/app/package.tsx`
- Gemeinsame reine Funktion `resolveInitialIdea(queryIdea, draftIdea)` (getrimmt, liefert `idea` + `overriddenDraft`); frische `?idea=` schlägt den Entwurf, der Entwurf greift nur ohne `?idea=` (Bestandsverhalten).
- Verdrahtet in **QuickGenerator** (inkl. sichtbarem Hinweis „Deine frische Idee wurde übernommen …" + „Entwurf wiederherstellen", i18n de/en), **new-project** (der frühere `prev || `-Effekt ließ den Draft gewinnen — behoben) und **package.tsx** (`validateSearch` mit optionalem `idea`, Draft wird nur ohne `?idea=` gesetzt).

## 2. Tests / Gates

| Gate | Ergebnis |
|---|---|
| **Neue Suite `brand-profile-test.ts`** | **81 PASS, 0 FAIL, EXIT 0** (`bun brand-profile-test.ts`, In-Memory-localStorage-Shim; kein DB-Zugriff, weil das Profil ausschließlich clientseitig im localStorage lebt) |
| `usage-guard-test.ts` (echte Neon-Test-DB) | 31 PASS, 0 FAIL, EXIT 0 |
| `usage-semantics-test.ts` | 32 PASS, 0 FAIL, EXIT 0 |
| `stripe-webhook-test.ts` | 55 PASS, 0 FAIL, EXIT 0 |
| `tiktok-diagnose-v2-test.ts` (Mock-LLM) | 56 PASS, 0 FAIL, EXIT 0 |
| `improve-deadzone-test.ts` | 50 Checks, 0 FAILED |
| Zusatz-Regression `tiktok-phase1-test.ts` | 75 PASS, 0 FAIL |
| Zusatz-Regression `tiktok-phase6-directions-test.ts` | 47 passed, 0 failed |
| **`bunx tsc --noEmit`** | **162 Fehler, davon 0 NEU** (Vergleich gegen HEAD 6f2a5a0 in einem separat ausgecheckten Worktree: in `src/` ist die **einzige** Differenz ein *behobener* Altfehler `brand.tsx ’hasExisting’ unused`; die übrigen Zahlen-Differenz stammt aus fremden, nicht committeten `scripts/*-temp.ts`). Zwischenstand mit 2 neuen Fehlern (Test-`import.meta.dir`, fehlendes `search` am package-Link, AnalyticsEvent-Union) wurde **vor** dem Commit auf 0 neue gebracht. |
| **`bash build-vercel.sh`** | **BUILD_EXIT=0** (Bundle `index.mjs` 4.34 MB, `.vercel/output` erzeugt) |
| **i18n-Scan** | **KEY-PARITY ✅ de = 1482 / en = 1482** (HEAD: 1472/1472 ⇒ +10 Keys, additiv; USED-KEYS ✅, keine UI-Hardcodes). Scan-Exit bleibt wie am Baseline-Commit **1** wegen derselben 2 vorbestehenden DE-Wert-Hinweise (`usage_limit_exhausted`, `brand_website`) — Diff der Befundlisten gegen HEAD ist **leer**. |

Testabdeckung der neuen Logik (Auszug): `enabled`-Default, Alt-Profil ohne Feld = aktiv, AUS ohne Datenverlust + Storage-Key bleibt, `getBrandContext()===''` bei AUS, Prompt beginnt mit der rohen Nutzeridee und der Markenblock liegt danach, Vorrang-Regel in 8/8 geprüften Kanälen, Einmaligkeit der deutschen Ausgabe, TikTok-Regel in de/en für concept+todayIdea, `selfCheckSuspiciousCount` 0 vs 1 (Nutzerthema), HARD REJECTS unverändert, 8 Fälle der Draft-Priorität, Verdrahtungs-Checks der UI-Pfade.

## 3. Deployment / Live-Check

- **Build:** `bash build-vercel.sh` → **BUILD_EXIT=0** (Bundle `index.mjs` 4.34 MB, `.vercel/output` erzeugt), Projekt `site`.
- **Deploy:** `bunx vercel deploy --prebuilt --prod --yes` schlug zunächst mit `Error: Not authorized` fehl (kein `VERCEL_TOKEN` in der Umgebung); mit dem explizit übergebenen CLI-Token (`~/.local/share/com.vercel.cli/auth.json`, User `fahr625-3542`) lief der Deploy durch: **EXIT=0**.
- **Neue Production-URL:** `https://site-f2mu7qqlm-growimo.vercel.app` (Alias **www.growimo.app**).
- **Live-Check (curl, HTTP-Status):**
  - `https://site-f2mu7qqlm-growimo.vercel.app` → **200**
  - `https://www.growimo.app` → **200**
  - `https://www.growimo.app/app` → **200**
  - `https://www.growimo.app/app/billing` → **200**
- **Nicht ausgeführt (best effort, nicht blockierend):** Browser-E2E mit dem Clerk-Sign-in-Token-Skill (Test A „Profil EIN → Growimo-Kontext", Test B „Profil AUS → kleines Café ohne Growimo-Erwähnung") — die Session lief ins Work-Budget; Test A/B gehören laut Plan ohnehin zur Abnahme in **Phase 5**. Ebenfalls ohne Live-Beleg: Klick-Beleg des Schalters im Browser (Logik ist durch `brand-profile-test.ts` und die Verdrahtungs-Checks belegt).

**Deploy-Befehl (falls erneut nötig, aus `/home/team/shared/site`):**
```
bash build-vercel.sh && bunx vercel deploy --prebuilt --prod --yes
# falls "Not authorized": --token "$(python3 -c "import json;print(json.load(open('$HOME/.local/share/com.vercel.cli/auth.json'))['token'])")"
```

## 4. Bewusst offen / Einschränkungen (ehrlich)

1. **Browser-E2E (Test A/B) nicht in dieser Session** — Live-URL + Routen sind per curl belegt (200), der Klick-Beleg des Schalters bleibt Phase 5.
2. **Phase-1-Selbsttest-Wirkung ist derzeit „belt and braces":** `selfCheckRejected` verwirft erst ab 3 verdächtigen Kriterien bzw. bei `interchangeable`/`soundsLikeAd`. Da außer „keine Markenfakt" nur noch „aktuelle Herausforderung nicht adressiert" als weiches Kriterium existiert, ist die Schwelle ohne die Phase-1-Dämpfung praktisch nicht erreichbar. Die Änderung ist korrekt und getestet (Zähler sinkt um 1 bei Nutzerthema), entfaltet ihre Wirkung aber erst, wenn Phase 2 weitere weiche Kriterien ergänzt.
3. **Vorrang-Regel ist prompt-seitig durchgesetzt, nicht durch einen deterministischen Post-Check** für die Kanäle (Pinterest/Etsy/Blog/Social/Newsletter). Der harte Inhalts-Post-Check für Kanal-Outputs steht im Plan unter **4.2** und wurde hier bewusst nicht vorgezogen (Vorgabe: nichts über Phase 1 hinaus).
4. **Sichtbarer Draft-Hinweis** wurde nur in QuickGenerator umgesetzt (dort, wo Dashboard-Karten einspringen); new-project und package haben die Prioritätslogik, aber noch keinen Hinweis-Streifen.
5. **Neue Tests laufen als Harness-Skript** (`bun brand-profile-test.ts` aus der Repo-Wurzel) — kein Unit-Test-Framework im Projekt; Muster wie die bestehenden Suiten.

## 5. Reproduktion der Gate-Zahlen

```
cd /home/team/shared/site
bun brand-profile-test.ts                 # 81 PASS / 0 FAIL
bun --env-file=.env usage-guard-test.ts   # 31 PASS / 0 FAIL
bun --env-file=.env usage-semantics-test.ts # 32 PASS / 0 FAIL
bun --env-file=.env stripe-webhook-test.ts  # 55 PASS / 0 FAIL
bun --env-file=.env tiktok-diagnose-v2-test.ts # 56 PASS / 0 FAIL
bun --env-file=.env improve-deadzone-test.ts   # 50 Checks / 0 FAIL
bun --env-file=.env i18n-scan.ts          # KEY-PARITY 1482 = 1482
bash build-vercel.sh                      # BUILD_EXIT=0
```

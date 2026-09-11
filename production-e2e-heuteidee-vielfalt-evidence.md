# Production-E2E-Befund — todayIdea Content-Vielfalt (Phase 6)

Datum (UTC): 2026-09-11, ~21:20
Commit (Produkt + Tests): `f99b65f` — feat(tiktok): todayIdea Vielfalt — Richtungs-Katalog, Zielgruppen-Perspektive, Selbstreferenz-Ban, Diversitäts-Mechanik
Basis-Commit: `47356e3` (vorheriger Stand auf origin/master)
Deployment: `site-mqhuwnanr-growimo.vercel.app` (bunx vercel deploy --prebuilt --prod --yes → „✓ Ready in 9s", DEPLOY_EXIT=0) — Alias **www.growimo.app** zeigt auf dieses Deployment (HTTP 200 geprüft).

## 1. Ursache (kurz)

Ideas fielen auf Produkt-Selbstthematisierung zurück, weil: (a) das Markenprofil im Testfall kein verwertbares „aktuelle Herausforderung"-Material enthielt, wodurch die alte Winkel-Prioritätsliste über die Stufen „echte Demonstration" → „Produktvorstellung" landete; (b) es keinerlei Diversitäts-Mechanik gab — das LLM wählte den Winkel bei jeder Generierung selbst und wiederholte daher bevorzugt den eingeschliffenen Produkt-Demo-Pfad; (c) die SelfChecks (Q3/Q4) Produkt-Selbstthematisierung nicht als „ad-like/interchangeable" zuverlässig abfingen, weil im Prompt keine explizite Selbstreferenz-Regel stand. Der Fix: Richtung wird jetzt deterministisch per Katalog gewählt und verbindlich in den Prompt injiziert; Prioritätsliste dreht sich auf Zielgruppen-Perspektive (Produkt = letzte Priorität); ein explizites Selbstreferenz-Verbot (Prompt + Code-Ebene) verwirft selbstreferenzielle Meta-Ideen und regeneriert.

## 2. Gates (alle grün, wörtlich)

1. **tsc**: `npx tsc -p tsconfig.gate.json --noEmit` → 60 Fehler im Arbeitsbaum vs. 62 auf HEAD-Baseline; einzige Differenz sind 2 Artefakt-Fehler der Baseline-Worktree (fehlendes dist/server/server.js) — **0 neue Fehler**; keine Fehler in den geänderten Dateien (src/ai/tiktok.ts, src/ai/server.ts @nur Bestandszeilen, src/routes/app/tiktok.tsx, src/lib/tiktok-directions.ts).
2. **i18n de=en-Parität**: `de keys: 1427 en keys: 1427` — `MISSING IN EN: []` — `MISSING IN DE: []` (5 identische Array-Werte beidseitig = strukturell symmetrisch).
3. **Komplette Suite**: `bun tiktok-test.ts` → `SUITE_EXIT=0` — `Summe PASS: 407 FAIL: 0` — „ALLE TEST-SÄTZE GRÜN" (Phase 1: 75, Phase 2: 90, Phase 3: 75, Phase 4: 75, Phase 6 neu: 47, Transport: 16; Phase 6-Ergebnis „PHASE 6 GRÜN").
4. **Build**: `bash build-vercel.sh` → `BUILD_EXIT=0` — „✓ built in 5.59s … done -> .vercel/output ready for: bunx vercel deploy --prebuilt".

Test-Anpassung (begründet): `tiktok-phase3-test.ts` T7-Fixture von Produkt-Selbsttest-Formulierung („Ich teste meine eigene Marketing-App.") auf Zielgruppen-Perspektive umgestellt — die alte Fixture-Formulierung gilt unter der neuen Owner-Regel als austauschbare Selbstreferenz und widersprach dem Charakter eines „gültigen Outputs". `tiktok-test.ts`: Phase-6-Suite in den Gesamtlauf aufgenommen (nur +1 Zeile).

## 3. E2E vs. Production — 3× todayIdea OHNE Themen-Eingabe (echt, geminteter Clerk-Token)

Skript: `scripts/_e2e-vielfalt.ts` — exakt 3 POSTs an `https://www.growimo.app/_serverFn/<generateTikTokServer-FnId>` mit client-identischer Richtungs-Rotation (previousDirection = pickTodayIdeaDirection(prev); Call 1 ohne). Roh-Antworten: `/home/team/shared/e2e/vielfalt-call{1,2,3}.json`.

| Call | HTTP | Dauer | previousDirection (gesendet) | Richtung (Engine/Katalog, aus Format ersichtlich) | Titel/Idee | Format |
|---|---|---|---|---|---|---|
| 1 | **200** | 8,7 s | (keine) | **Problem/Lösung** (Katalog-Start) | „Gemütlichkeit mit Keramiktassen schaffen" | „Problem/Lösung – Zeigt, wie Interior-Liebhaberinnen mit einem einfachen Trick ihr Zuhause gemütlicher machen können." |
| 2 | **200** | 7,9 s | Problem/Lösung | **Konkreter Tipp** | „3 Tipps für ein gemütliches Wohnzimmer" | „Tutorial/How-to – Schritt für Schritt (passt zur Zielgruppe: Interior-Liebhaberinnen, die schnelle Tipps für ein gemütliches Zuhause suchen)" |
| 3 | **200** | 37,3 s | Konkreter Tipp | **Häufiger Fehler** | „Dekorations-Fehler mit Duftkerzen vermeiden" | „Häufiger Fehler – zeigt ein Problem und die Lösung (passt zum Ziel: Verkäufe)" |

Hooks wörtlich:
- Call 1: „Wusstest du, dass deine Tassen auch Duftkerzen sein können?"
- Call 2: „Mit diesen 3 einfachen Tipps wird dein Wohnzimmer zur Wohlfühloase!"
- Call 3: „Machst du diesen Fehler mit deinen Duftkerzen?"

Prüfpunkte:
- (a) **3× vollständiges Konzept**: JA — alle 3 Antworten HTTP 200 mit Titel, Hook, Format, Länge, Szenen, Caption, CTA, Image-Ideen (1520 Zeichen).
- (b) **unterschiedliche Richtungen/Themen**: JA — 3 verschiedene Richtungen (Problem/Lösung → Konkreter Tipp → Häufiger Fehler) und 3 verschiedene Titel (keine direkte Wiederholung).
- (c) **KEINE Growimo-Selbstthematisierung**: JA — Selbstreferenz-Scan über alle String-Felder jeder Antwort: `SELBSTREF-HITS: KEINE` in allen 3 Calls (kein „Kann Growimo…", kein „teste/Test unser Produkt", kein „Wie gut ist meine Idee…"); alle Ideen sind zielgruppenbezogen (Interior-Liebhaberinnen), das Produkt nur als Beiwerk.

Fazit-Skript: `E2E_EXIT=0` — „3x HTTP 200 + vollständiges Konzept: JA | unterschiedliche Titel/Themen (3/3): JA | Selbstreferenz-frei: JA".

## 4. Änderungsübersicht (Commit f99b65f)

- **src/lib/tiktok-directions.ts** (neu): 10er-Richtungs-Katalog (de kanonisch + en), `pickTodayIdeaDirection` (deterministische Rotation — keine direkte Wiederholung), dependency-frei für Server + Client.
- **src/ai/tiktok.ts**: Katalog + „verbindliche Richtung aus dem Nutzer-Prompt" in TODAY_IDEA_DE/EN; Winkel-Prioritätsliste umgebaut (Zielgruppen-Perspektive zuerst, Produkt als letzte Priorität); `SELF_REFERENCE_PATTERNS` + `selfReferenceViolations` auf Code-Ebene (nur todayIdea) → Soft-Reject + Retry; Retry-Hint in DE/EN auf Zielgruppen-Perspektive umformuliert; zwei zu breite DE-Regeln entfernt (False-Positives).
- **src/ai/server.ts**: optionales `previousDirection` im TikTok-ServerFn durchgereicht.
- **src/routes/app/tiktok.tsx**: localStorage `growimo_tiktok_last_direction` → nächste Generierung rotiert deterministisch zur Katalog-nächsten Richtung (Client und Engine nutzen dieselbe Funktion).
- **tiktok-phase6-directions-test.ts** (neu, 47 Checks): Rotation, Prompt-Injektion, SelfRef-Reject/Retry, concept-Ausnahme, EN-Variante, Katalog + Owner-Beispiele.
- **tiktok-phase3-test.ts / tiktok-test.ts**: Fixture-Angleichung + Einbindung Phase 6 (siehe Gate 3).

## 5. Deploy-Status

- Deployment-URL: https://site-mqhuwnanr-growimo.vercel.app — „✓ Ready in 9s" (DEPLOY_EXIT=0).
- Alias www.growimo.app: HTTP 200 (curl geprüft nach Deploy).
- Produkt-Commit + Tests auf origin/master gepusht (47356e3..f99b65f).
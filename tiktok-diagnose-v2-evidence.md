# TikTok Diagnose v2 — Evidence

**Commit:** `91606fd` (feat(tiktok): Diagnose v2 — Video-Thema/Hook-Eingabe, konkrete themenbezogene Empfehlungen, probabilistische Kausal-Sprache, umsetzbare Neu-Version)
**Deployment:** `site-kpdd1fp9p-growimo.vercel.app` (Production, Ready) → www.growimo.app HTTP 200
**Testdatei:** `tiktok-diagnose-v2-test.ts` (355 Zeilen, 11 Phasen)

## Ergebnis Testsuite (finaler Lauf, Log: /tmp/dv2b.log)
```
===== ERGEBNIS =====
PASS: 56  FAIL: 0
ALLE TESTS BESTANDEN
```

## Phasenüberblick
- **P1 Parser:** rebuilt-Felder + videoTopic-Echo (DE) — volle Diagnose, hook nennt Thema „Torte", timedScenes mit Sekunden-Zeitmarken („0-2s"), voiceover, cta, seconds. 11 PASS.
- **P2 Alt-Format:** altes Diagnose-Ergebnis ohne rebuilt → `rebuilt === undefined`, alle Panels (biggestProblem, newHook, optimized, nextTest, lengthRecommendation) bleiben gültig. 7 PASS.
- **P3 Kausal-Sprache DE:** probabilistische Formulierung (wahrscheinlich/könnte/möglicherweise) vorhanden, KEINE bewiesene Kausal-Behauptung („der Grund ist"/„liegt daran"/„beweist"), biggestProblem nutzt „wahrscheinlich". 4 PASS.
- **P4 Kausal-Sprache EN:** likely/may/could/suggests, keine „the reason is"/„proves that". 4 PASS.
- **P5 Themenbezogenheit:** topicTokens aus „Torte backen", `topicGroundedInRebuilt → true` — Torte wörtlich in newHook/optimized/rebuilt, Timed-Szenen, Hook/Voice-over/CTA. 4 PASS.
- **P9 UI-Verdrahtung:** diagnoseVideoContext — getrimmtes videoTopic/videoHook übernommen, leere Felder → undefined. 5 PASS.
- **P10 Prompt-Härtung:** probabilistische Kausal-Sprache + Themen-Regel (kein Erfinden ohne Thema) in de/en-System-Prompt, verbotene Kausal-Formulierungen genannt. 5 PASS.
- **P11 i18n-Parität:** alle 7 neuen Keys in de.ts UND en.ts, Längen-Key mit %s-Platzhalter. 3 PASS.

## Bundle-Beleg (Production)
`.vercel/output/functions/render.func/index.mjs`: 40 Treffer für „rebuilt"/„Worum geht es" — Diagnose-v2-Strings im deployten Bundle enthalten.

## Deploy-Prüfung
- `bunx vercel ls --environment production` → neuestes Deployment `site-kpdd1fp9p` Ready (2 min vor Prüfung)
- `curl -s -o /dev/null -w "%{http_code}" https://www.growimo.app/` → 200
# Stabilisierung Phase 4.3 — „Zuletzt erstellt" (Ergebnisse behalten, Wiederöffnen)

Stand: 2026-09-19 · Engineer · Feature-Commit `7dc4d94` · Deploy `site-4bpgu03iq-growimo.vercel.app` (Alias www.growimo.app)

## 1. Auftrag / Umfang (Fix-Plan §4.3, Zeilen 330–335)
Aufbau auf der Phase-3-Persistenz (`growimo_tiktok_last_result`, Version 1, TTL 12 h):
versionierte Liste (max. 3) der zuletzt erzeugten TikTok-Ergebnisse, Wiederöffnen ohne
Neu-Generierung, „In Projekt speichern" über den vorhandenen `saveProject`-Weg.
Kein DB-Schema-Eingriff, kein `ContentType`-Eingriff, keine Änderung an Prompt-/Generierungslogik.

## 2. Entscheidungen (dokumentiert im Code)
| Frage | Entscheidung |
|---|---|
| Speicherformat | `sessionStorage`-Key **`growimo_tiktok_recent_results`** = JSON-Array; **jeder Eintrag** trägt `version` (= 1). Keine DB (KISS, wie Phase 3), kein Schema-Risiko für die 8.2-Usage-Kette. |
| Einträge OHNE Version | **IGNORIERT** (fail-closed, keine Interpretation unbekannter Daten) — beim Lesen verworfen. Ebenso fremde Version, unbekannter Modus, defektes JSON, abgelaufene TTL (12 h). |
| Phase-3-Einzelergebnis | **EINMALIG MIGRIERT**: ist die Liste leer und existiert ein gültiges Einzel-Ergebnis, wird es als Listeneintrag übernommen (Liste wird geschrieben). Der Phase-3-Schlüssel bleibt unangetastet (Bild-Studio-Prefill unverändert). Migration ist idempotent. |
| Kappung/Dedup | neues Ergebnis an **Position 0**, Liste auf **3** gekappt; Eintrags-ID = Modus + deterministischer Hash der Beschriftung → gleiches Ergebnis dedupliziert (kein Doppel), der neue Eintrag gewinnt. |
| Beschriftung | deterministisch aus dem Ergebnis selbst (Idee → Hook-Fallback; Diagnose → größtes Problem; dataGap → Hinweistext), auf 80 Zeichen gekürzt. Kein LLM, keine Erfindung. |
| ContentType | `social_post` — TikTok IST ein Social-Kanal; `ContentType` wird in Phase 4 bewusst NICHT erweitert. Herkunft steht im Asset-`metadata` (`source: 'tiktok'`, `tiktokMode`, `tiktokEntryId`, `tiktokCreatedAt`). |
| „Neue Idee" (reset) | leert nur die aktuelle Ansicht + Phase-3-Schlüssel; die Liste bleibt erhalten (Anforderung „Ergebnisse behalten"). |

## 3. Zähl-Semantik (Phase 8.2)
**Wiederöffnen = 0 Generierungen. „In Projekt speichern" = 0 Generierungen.**
Beide Aktionen rufen keinen KI-Pfad auf: kein `generateTikTokServer` → kein `withGenerationGuard`,
kein Konditional-Increment in `usage_monthly`. Öffnen liest ausschließlich `sessionStorage`,
Speichern schreibt ausschließlich nach Postgres (`qSaveProject`). Verbrauch entsteht nur durch eine
echte Generierung (1 fertiges Ergebnis = 1 Generierung); Tests belegen das per Quelltext-Check auf
den kommentarfreien Handler-Rümpfen und die einzige Aufrufstelle von `generateTikTokServer`.

## 4. Änderungen
| Datei | Änderung |
|---|---|
| `src/lib/tiktok-recent.ts` **(neu)** | Liste: `createRecentEntry`, `addRecentEntry` (Position 0, Dedup, Kappung), `serializeRecentList`/`parseRecentList` (Version/TTL/Dedup-Prüfung), `readRecentList` (inkl. Migration), `pushRecentResult`, `clearRecentList`; Text-Serialisierung `formatTikTokResultText`; Projekt-Argumente `buildTikTokSaveArgs` (+ `recentProjectTitle`) |
| `src/routes/app/tiktok.tsx` | UI-Sektion „Zuletzt erstellt" (`data-testid=tiktok-recent|tiktok-recent-item|tiktok-recent-open|tiktok-recent-save`), Liste beim Mount, Aufnahme nach jeder Generierung, `openRecent` (0 Verbrauch), `saveRecentToProject` (vorhandener `saveProject`-Weg), Link auf das gespeicherte Projekt |
| `src/i18n/de.ts` + `src/i18n/en.ts` | 11 neue Keys `tiktok_recent_*` (Parität erhalten) |
| `stabilisierung-phase43-test.ts` **(neu)** | Testsuite, 111 Checks |

## 5. Gates (Rohlogs in `/tmp`)
| Gate | Ergebnis | Log |
|---|---|---|
| Neue Suite Phase 4.3 | **111 PASS, 0 FAIL, EXIT 0** | `/tmp/p43.log` |
| 4.1 Regression | **47 PASS, 0 FAIL, EXIT 0** | `/tmp/stabilisierung-phase41-test.log` |
| 4.2 Regression | **50 PASS, 0 FAIL, EXIT 0** | `/tmp/stabilisierung-phase4-test.log` |
| 31 usage-guard | **31 PASS, 0 FAIL, EXIT 0** | `/tmp/g31.log` |
| 32 usage-semantics | **32 PASS, 0 FAIL, EXIT 0** | `/tmp/g32.log` |
| 55 tiktok-diagnose-v2 | **56 PASS, 0 FAIL, „ALLE TESTS BESTANDEN", EXIT 0** | `/tmp/g55.log` |
| 56 stabilisierung-phase3 | **85 PASS, 0 FAIL, EXIT 0** | `/tmp/g56.log` |
| `tsc --noEmit` | **171 Fehler = Baseline 171**, Differenz **0**; in den 4.3-Dateien 0 Fehler | `/tmp/tsc43.log` |
| i18n de/en | Parität (gleiche Schlüsselzahl, keine fehlenden Keys), in der Suite mitgeprüft | `/tmp/p43.log` |
| `bash build-vercel.sh` | **BUILD_EXIT=0** | `/tmp/build43.log` |

Neue Suite (111 Checks) deckt u. a. ab: Position 0, Kappung auf 3, Kappung entfernt den ÄLTESTEN
Eintrag, Dedup, Versionsfeld, Eintrag ohne/fremde Version ignoriert, gemischte Liste, defektes JSON,
TTL, Push/Read im sessionStorage, Wiederöffnen liefert das **byte-identische** Ergebnis (Idee + Diagnose),
Wiederöffnen erzeugt keinen neuen Eintrag, Migration des Phase-3-Ergebnisses (idempotent, Alt-Schlüssel
unangetastet), `clearRecentList` nur für die Liste, Beschriftungs-/Text-Serialisierung de+en,
`buildTikTokSaveArgs`-Argumente (`social_post`, 1 Asset, Metadata tiktok*) inkl. Aufrufkette
`saveProject(uid, project, contents)` mit Spy, Zähl-Semantik (kein KI-/Usage-Pfad im Modul-Code,
keine Generierung in den Handlern, genau EINE `generateTikTokServer`-Aufrufstelle),
kein DB-Schema-/ContentType-Eingriff, i18n-Parität.

## 6. Deploy + Live-Check
- Deploy: `HOME=/home/agent-lead bunx vercel@latest deploy --prebuilt --prod --yes` (OHNE `--token`)
  → **`https://site-4bpgu03iq-growimo.vercel.app`**, `DEPLOY_EXIT=0`, `▲ Aliased https://www.growimo.app`,
  „Using prebuilt build artifacts from .vercel/output" (Log `/tmp/deploy43.log`).
- Live-Check: `/` **200** · `/app` **200** · `/app/tiktok` **200** · `/app/billing` **200** (`/tmp/live43.log`).

## 7. Bundle-Beleg (Marker: neuer sessionStorage-Key + UI-String)
- Prebuilt-Deployment-Output (= hochgeladenes Artefakt): Marker `growimo_tiktok_recent_results`
  in **`.vercel/output/static/assets/tiktok-DV5NbBBd.js`** (`grep -rl`, `/tmp/live43.log`).
- Live-Abruf der Assets der Route https://www.growimo.app/app/tiktok: Marker-Treffer im
  TikTok-Route-Chunk bestätigt (`/tmp/live43.log` Abschnitt „== live asset").

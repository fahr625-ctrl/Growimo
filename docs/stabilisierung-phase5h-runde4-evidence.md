# 5h/5i — Runde 4: Persönliche-Geschichten-Schutz (Owner-Auftrag 2026-09-26)

Owner-Ziel: „Keine erfundenen persönlichen Geschichten, Produkteigenschaften oder Erfahrungen als Tatsache."
Wörtliches Owner-Beispiel: „Das Silberarmband wird ohne Nutzereingabe als Geschenk, Glücksbringer und
Begleiter durch schwierige Zeiten dargestellt. Diese persönliche Geschichte wurde nicht vorgegeben."

Commit: `9331e6a` (master). Vorgänger: `3566d9c` (Runde 3 — Architektur unverändert, nur ADDITIV ergänzt).

## 1. Was additiv ergänzt wurde (nur `src/ai/tiktok.ts` + `stabilisierung-phase5c-test.ts`)

Neu, ohne eine Zeile der Runde-3-Logik (`CONTEXT_TERM_GROUPS`, `CONTEXT_RECOMMENDATION_PATTERNS`,
`OPEN_CATEGORY_PATTERNS`, `CONCRETE_FORMAT_PATTERNS`, `categoryFormatViolations`, `inventedContextViolations`,
`inventedContextFreeResult`) umzubauen:

- **`PERSONAL_STORY_PATTERNS`** (36 Muster, de+en, mit Grounding-Regex je Muster) in 6 Kategorien:
  (1) Geschenk-/Schenk-Kontext („als Geschenk", „ein Geschenk von", „geschenkt von|bekommen", „von meiner
  Oma/Mutter/…", „a gift from my grandmother", „gifted to me"); (2) Herkunft/Erbstück („Erbstück",
  „Familienstück", „geerbt", „inherited", „passed down", „seit Generationen", „in meiner Familie");
  (3) symbolische/persönliche Bedeutung als Fakt („Glücksbringer/lucky charm/talisman", „Begleiter durch
  schwierige Zeiten" **inkl. Verbform** „begleitet mich durch schwierige Zeiten", „steht für unsere
  Freundschaft", „symbolisiert …", „trägt eine besondere Bedeutung", „erinnert mich an / reminds me of",
  „erinnerst du dich / remember when"); (4) Erfahrungs-/Besitz-Behauptungen („ich trage/trug/besitze …",
  „mein Armband/Kette/…"); (5) zeitliche Beständigkeit („seit Jahren/Jahrzehnten", „seit 1999/2019",
  „seit meiner Kindheit", „jahrelang", „for years", „year after year"); (6) Provenienz-/Qualitäts-Behauptungen
  („echtes/reines Silber|Gold|Leder" mit Flexion, „925er/sterling/18k", „handgefertigt/hergestellt/made in
  <Land>" mit Ortsliste, „aus <Land>", „höchste Qualität").
- **`personalStoryViolations(blob, groundingBlob)`** — satzweise Erkennung, Rückgabe `STORY:<name>`.
  Grounding: jeder Begriff, der in den Nutzerangaben steht (topic/biz/audience/goal/brandContext/project),
  wird NIE geflaggt (z. B. Eingabe „Glücksbringer für schwangere Freundin" ⇒ erlaubt).
- **Erlaubter Fall**: `CONCEPT_MARKER_PATTERNS` („Story-Idee:", „Story idea:", „Konzept:", „Concept:",
  „Idee:") **direkt vor** der Behauptung (≤120 Zeichen) **und** `STAGING_INSTRUCTION_PATTERNS`
  („Inszeniere … als", „Zeige … als", „stage … as", „… als … inszenieren") ⇒ KEIN Verstoß.
  Indikativ-Tatsachen („ist/war/begleitet/erinnert mich an") bleiben Verstöße — auch mit Marker.
- **`personalStoryFreeResult(r, groundingBlob)`** + `dropStorySentences` — letzter Versuch entfernt nur die
  betroffenen SÄTZE (idempotent, identisches Objekt bei sauberem Ergebnis).
- **Engine-Einhängung** (Retry-/Korrektur-Kette unverändert): `stories` fließt in `lastViolations` →
  Soft-Reject + Retry; Endreinigung jetzt
  `personalStoryFreeResult(inventedContextFreeResult(genericFreeResult(placeholderFreeResult(result))))`.
  Hard-Abort unverändert nur für Rule A/B + harte selfCheck-Flags (erfundene Geschichten = SOFT, nie Hard-Abort).
- **`buildRetryHint`**: neuer `storyPart` (de+en) benennt die Regel + die konkreten `STORY:`-Verstöße;
  Ablehnungs-Basissatz um „erfundene persönliche Geschichte/Produkteigenschaft/Herkunft/Wirkung/Erfahrung
  als Tatsache" erweitert.
- **Prompt-Regel** (Punkt 7 in `ideaSharpeningMandate`, gilt für BEIDE Idee-Modi todayIdea + concept, de+en):
  persönliche Geschichten nur als ausdrücklich gekennzeichnete „Story-Idee:"-Inszenierung, nie als
  geschehene Tatsache; Material-/Formatwahl der Bildidee bleibt erlaubt („Silberring" ja, „echtes Silber" nein).

## 2. Gates (ZAHLENGRÜN, alle auf dem neuen Stand gemessen)

| Suite | Ergebnis |
|---|---|
| `stabilisierung-phase5c-test.ts` | **428 passed, 0 failed** (vorher 366 → +62 neue Checks J9–J15) |
| `tiktok-phase3-test.ts` | 91 / 0 |
| `tiktok-phase4-test.ts` | 75 / 0 |
| `tiktok-concept-quality-test.ts` | 126 / 0 |
| `tiktok-diagnose-v2-test.ts` | 56 / 0 |
| `stabilisierung-phase41-test.ts` | 47 / 0 |
| `stabilisierung-phase43-test.ts` | 111 / 0 |
| `stabilisierung-phase43b-test.ts` | 89 / 0 |
| `tiktok-phase1-test.ts` | 74 / 1 — **unverändert** derselbe vorbestehende Einzeltreffer („Retry auf concept (2 Calls, war 4)") wie in Runde 3 |
| `tiktok-phase2-test.ts` | 89 / 1 — **unverändert** derselbe vorbestehende Einzeltreffer („image-studio.tsx wendet studioSearchPrefill an") wie in Runde 3 |
| `bunx tsc --noEmit -p tsconfig.gate.json` | **54 Fehler = Baseline, 0 neue**; 0 Fehler in `src/ai/tiktok.ts`, 0 in der Testdatei |

Neue Checks J9–J15: J9 Muster-Erkennung de/en (18), J10 Grounding (7), J11 **False-Positive-Schutz gegen die
echten Runde-3-Produktions-Outputs** L1 Goldkette / L2 Silberring / L3 Silberanhänger / KONTROLLE-Tasse +
Runde-1-Blobs + Fixture (8), J12 erlaubter „Story-Idee:"-Fall + satzweise Entfernung (11), J13/J14 Engine-Retry
de/en, J15 dauerhaft erfunden → 4 Versuche, ausgelieferte Idee OHNE die Behauptung (kein Hard-Fail).

## 3. ECHTE Generierung (Produktion, www.growimo.app, echter Prod-Key)

Payload exakt der Owner-Fall: `mode=concept`, `topic="minimalistischer Schmuck"`, `goal="Reichweite"`,
`brandContext=""` (**Markenprofil AUS**), `biz="Handgemachter minimalistischer Schmuck"`, `lang=de`.
ServerFn-POST auf `/_serverFn/c5a06ea3…caba3c` (Clerk-Session des synthetischen E2E-Nutzers).

Ergebnis: **HTTP 200 in 26,5 s** (echte OpenAI-Generierung, keine Retries im Log-Stil der Engine).

- `STORY_VIOLATIONS: KEINE` — **keine** erfundene persönliche Geschichte/Produkteigenschaft/Erfahrung als Tatsache
- `INVENTED_VIOLATIONS: KEINE`, `FORMAT_VIOLATIONS: KEINE`, Konzept-Marker: keine (es wurde also gar keine Story nötig)
- Wörtlich: IDEE „Ein Video, das zeigt, wie minimalistische Ohrstecker zu jedem Outfit passen können." ·
  HOOK „Diese Ohrstecker passen zu jedem Look!" · TITEL „Vielfalt: Minimalistische Ohrstecker in jedem Look" ·
  SCROLLSTOP „Mechanik: Neugierlücke — Die Zuschauer sehen einen minimalistischen Ohrstecker und fragen sich,
  wie er in verschiedenen Outfits wirkt." · WARUM „Diese Idee zeigt die Vielseitigkeit minimalistischen
  Schmucks und spricht eine breite Zielgruppe an, die Inspiration für ihren eigenen Stil sucht."
  (kein Geschenk, kein Glücksbringer, kein Begleiter, keine Ich-Erzählung, keine Herkunfts-/Materialbehauptung)
- **Zähler:** `usage_monthly` für den Testnutzer vor dem Lauf zurückgesetzt (Test-Fixture, DELETE) →
  `USAGE_AFTER = 1` ⇒ **genau +1 für eine Generierung, Retries = 0** (Usage-Semantik bestätigt).

⚠️ **Diese Generierung lief gegen den aktuell LIVE stehenden Build (Runde-3-Code).** Sie belegt, dass der
live ausgelieferte Output für den Owner-Fall heute sauber ist, **aber nicht**, dass der neue Runde-4-Zwang
live wirkt — der Deploy scheiterte (s. 4).

## 4. Bundle-Beleg & Deploy

Frisch gebauter Produktions-Bundle (aus `bash build-vercel.sh`, bereit für den Deploy):
`.vercel/output/functions/render.func/index.mjs`, sha256 `e113fc66ff00475ad3652debb95a8e7426275f011bdc79cf037a2884caa02c01`
Marker vorhanden: `ERFUNDENE PERSÖNLICHE GESCHICHTE` (1×), `INVENTED PERSONAL STORY` (1×),
`begleiter-schwierige-zeiten`, `geschenk-von-person`, `echtes-material`, `herkunft-ort` (je 1×), `Story-Idee:` (2×).
(`STORY:gluecksbringer` als zusammenhängender String: 0 Treffer — der Minifier trennt den Präfix `STORY:` von
den Musternamen; die Musternamen selbst sind enthalten.)

**Deploy NICHT erfolgt — Blocker:** Der Vercel-Deploy scheiterte mit `Error: Not authorized`; es existiert in
dieser Umgebung kein Vercel-Credential (`VERCEL_TOKEN` leer, `~/.vercel/auth.json` nicht vorhanden,
`api.vercel.com/v2/user` → HTTP 403 „missing authentication token", `get_git_credentials` → „GitHub access is
not configured for this team"). Der Build selbst ist grün; ein `` bunx vercel deploy --prebuilt --prod --yes ``
mit gültigem Token bzw. ein `publish_site` schiebt Runde 4 live.
Test-Konten-Zähler wurden für den E2E-Lauf zurückgesetzt (synthetischer Nutzer `user_3IYfD4pQhQ1HKjH6pb7tlLkQnAo`).

## 5. Darstellung/Report

Volltext-Ausschnitte des Produktions-Laufs: `/home/team/shared/tiktok-testC-outputs.md`, Abschnitt „Runde 4".

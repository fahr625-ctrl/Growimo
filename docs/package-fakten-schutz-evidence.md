# Fakten-Schutz im Package-Flow — Evidence (Owner-Entscheid 2026-10-01, Teil 2)

**Ziel:** In den 5 Paket-Kanälen (Pinterest, Etsy, SEO, Social, E-Mail) dürfen keine erfundenen
Fakten mehr entstehen bzw. ausgeliefert werden — persönliche Ich-Anekdoten, Lieferzeiten, Retouren,
Preise/Produkteigenschaften, Trends/„alle lieben", fremde Beispiel-Slugs/URLs. Vorbild: TikTok
(`PERSONAL_STORY_PATTERNS` / `dropStorySentences`, Commit 9331e6a) — dieselbe Höhe für alle Kanäle.
**Nur additiv im Package-Flow**, TikTok und die Stabilisierungs-Fixes bleiben unangetastet.

## 1. Analyse — betroffene Dateien/Pfade

| Datei | Rolle | Änderung |
| --- | --- | --- |
| `src/ai/fact-guard.ts` | **NEU** — deterministischer Fakten-Check (de+en) | `FACT_PROTECTION_CONSTRAINT`, `FACT_PATTERNS` (5 Kategorien), `factViolations`, `resultFactViolations`, `sanitizeFactText`, `sanitizeFactResult`, `factGuardCorrection`, `FACT_GUARD_ERROR`, `buildFactGrounding` |
| `src/ai/types.ts` | `ContentRequest` | `enforceFacts?: boolean`, `factGrounding?: string` |
| `src/ai/generate.ts` | zentraler Pfad `runWithContextLoyalty()` (von ALLEN Flows genutzt) | Fakten-Check **nach** dem Kontexttreue-Check, nur wenn `enforceFacts === true` |
| `src/ai/providers/openai.ts` | `buildSystemPrompt()` + alle 5 Kanal-Prompts | globale Fakten-Regel angehängt; Erfindungs-Einladungen in den Kanal-Prompts entfernt |
| `src/ai/package/generate.ts` | Paket-Batch (`generatePackageChannel`) | `enforceFacts: true` + `factGrounding` (Idee + Brief + Markenprofil) |
| `src/ai/package/package.ts` | Paket-Fortschritt (`generatePackageChannelWithContext`, ~Z. 242) | `enforceFacts: true` |
| `src/ai/scoring/index.ts` | Score + **Verbesserungshinweise** | jeder Hinweistext (`issue.message`, `issue.fix.suggestion`) läuft durch `sanitizeFactText` |
| `src/ai/scoring/rules.ts` | Hinweis-Texte (Quelle des Fremd-Slugs!) | Z. 398 Fremd-Slug `…trauerkarten-gestalten-persoenlich` → „Fokus-Keyword des Nutzerthemas"; Z. 282 Etsy-CTA „in 3–5 Tagen" → ohne Erfindung; Z. 479 Materialbeispiel neutralisiert |
| `src/ai/improve.ts` | **Verbessern**-Pfad | Fakten-Schutz-Block im Verbesserungs-Prompt |

**Der Fremd-Slug (Beleg 4) entstand in `src/ai/scoring/rules.ts:398`** und wurde über den Score-Card-
Hinweis angezeigt — deshalb ist der Hinweis-Pfad mitgefixt (Prompt **und** deterministische Bereinigung).

## 2. Prompt-Regel (additiv, de+en)

`FACT_PROTECTION_CONSTRAINT` wird in `buildSystemPrompt()` an **jeden** der 5 Kanal-Prompts angehängt:
kein Ich-Erzähler/keine Verkäufer-Erlebnisse; keine Lieferzeiten/Retouren/Preise/Produkteigenschaften/
Wirkungen/Trends/Statistiken, die nicht in Idee/Brief/Markenprofil/Projekt stehen; bei Unsicherheit
weglassen oder allgemein formulieren; Slugs/URLs nur aus dem Nutzerkontext.

Zusätzlich entfernt (Prompt-interne Erfindungs-Einladungen, je durch „nur mit Nutzerangaben"-Regel ersetzt):
Pin-Titel-Trigger „Diesen [Produkt]-Trend lieben gerade ALLE", Pinterest-CTA „Nur noch diese Saison — danach
ist der Trend vorbei", Etsy-CTA „in 3–5 Tagen hältst du es in den Händen", Etsy-FAQ Lieferung/Rückgabe +
Persona-/Geschenk-/Titel-/Dateinamen-Beispiele, Social „Mini-Geschichte/persönlicher Einblick" +
Material-Beispielfrage, SEO-Meta-/Slug-Beispiele (Trauerkarten), SEO-Hook „mit Statistik", SEO-Vorgabe
„Mindestens EIN persönliches Beispiel/Erfahrungsbericht", Newsletter „Ich"-Moment +
„Kostenloser Versand bis morgen". (Prompt-Quelltext-Checks Fälle D4 in der Test-Suite.)

## 3. Deterministischer Post-Check (analog TikTok, 1 Korrektur → Satz-Eliminierung → hart)

`runWithContextLoyalty()` (src/ai/generate.ts, Zeilen ~110–155):
1. Ausgabe → `resultFactViolations(result, grounding)`. Leer = konform.
2. Bei Verstoß: **1** Korrekturversuch mit benannten Kategorien (`factGuardCorrection`, de+en) — abhängig
   vom Runner (LLM-Retry mit `correctionNote`).
3. Bleibt ein Verstoß: **Satz-Eliminierung** (`sanitizeFactResult`, Muster `dropStorySentences`).
   Fällt der Titel komplett weg, trägt die Produktidee (Nutzerdaten) den Titel weiter.
4. Ist der Text danach leer → **harter Fehler** `FACT_GUARD_ERROR` (nichts wird still ausgeliefert).
Nicht markiert werden faktenfreie Ergebnisse (identisches Objekt, kein Eingriff).

**Kategorien (de+en), Grounding-bewusst:** (a) Ich-Anekdoten (`anekdote-letztes-jahr`,
`geburtstag-meines-sohnes`, `als-ich-erzaehlung`, `meine-erfahrung-meine-praxis`), (b) Liefer-/Versand-/
Rückgabe-Behauptungen (`in-x-tagen-wochen`, `lieferzeit-mit-dauer`, `versandkostenfrei`, `versand-zusage`,
`rueckgaberecht`, `bearbeitungszeit`), (c) Preis/(100 %)-Zusagen (`preis-ohne-grundlage`,
`absolutes-materialversprechen`), (d) Trend/„alle lieben"/Bestseller/„Trend 2026" (`trend-behauptung`,
`alle-lieben`, `beliebteste-bestseller`, `jahr-trend-claim`), (e) fremde URLs/Slugs (`fremd-slug`,
`fremd-url`).
**Grounding:** Grounding-Muster je Kategorie (TikTok-Konvention, kleingeschriebener Nutzerkontext) —
genannte Nutzerfakten (Lieferzeit, Preis, Trend, eigene Domain) werden **nie** geflaggt; Slugs werden
wortweise gegen den Nutzerkontext geprüft. `buildFactGrounding()` entfernt den LLM-erzeugten
„Gemeinsamen Strategie-Kern" aus dem Grounding (kein Selbst-Entwaffnen des Checks), Marken-/Briefangaben
bleiben.

## 4. Tests

Neu: `package-fakten-schutz-test.ts` — **ZAHLENGRÜN: 66 PASS, 0 FAIL** (`bun package-fakten-schutz-test.ts`).
Enthält: die 4 Beleg-Muster aus dem Demo-Bericht als Pflicht-Verstöße (de+en), Grounding-Gegenproben
(Nutzerlieferzeit/Preis/Rückgabe/Trend/URL → 0 Verstöße), die Retry-/Eliminierungs-/Hard-Error-Logik über
`runWithContextLoyalty` (injizierter Runner, keine LLM-/Netzaufrufe), Quelltext-Belege für Prompt-Regel,
Verdrahtung (`enforceFacts`), Hinweis-Pfad und TikTok-Ungetastetheit.

Bestehende Gates (HEAD mit Änderung, `.env` via `--env-file`):

| Gate | Ergebnis |
| --- | --- |
| `package-fakten-schutz-test.ts` | 66 PASS / 0 FAIL |
| `stabilisierung-phase4-test.ts` | 50 PASS / 0 FAIL |
| `stabilisierung-phase41-test.ts` | 47 PASS / 0 FAIL |
| `brand-profile-test.ts` | 81 PASS / 0 FAIL |
| `tiktok-test.ts` (Suite-Sammlung) | 418 PASS / 5 FAIL — **identisch zur Baseline** (tiktok-phase1/2 + transport-regression, vorbestehend) |
| `guard-metric-test.ts` | 1 FAIL — **identisch zur Baseline** („50% häufiger" in Designempfehlung; vorbestehend, Metric-Guard ist ein anderer Check als der Fakten-Check) |
| `tsc --noEmit` | roh 171 Fehler (Baseline-HEAD) → 189 (HEAD). Normalisiert sind die **neuen** Einträge ausschließlich nicht committete `scripts/*`-Hilfsdateien fremder Sessions; die einzige Zeile in einer von mir geänderten Datei (`src/ai/scoring/index.ts:85 'productIdea' never read`) steht **wortgleich schon in der Baseline**. Kein neuer Typfehler durch diesen Teil. |
| `i18n-scan.ts` | `RESULT: ❌ MIXING FOUND` + `USED-KEYS FAIL (tiktok_result_)` — **identisch in Baseline und HEAD**, keine neuen i18n-Schlüssel (die Fakten-Regel ist Prompt-Text, kein UI-String) |

## 5. Live-E2E auf www.growimo.app — ausgewertet (2026-10-03, nachgelagert)

Der Lauf selbst fand am **2026-10-03 18:02:37–18:04:08** statt (Beleg: `/tmp/fs/run.log`, `/tmp/fs/tailrun.txt`).
Ausgewertet wurde er **nachgelagert 18:04–18:12** aus **denselben** Artefakten: Lauf-Log, read-only DB-Dump,
Live-DOM der noch offenen Browser-Session und dem Production-Server-Bundle. **Es wurde bewusst kein zweiter
Generierungs-Lauf gestartet** — der synthetische Nutzer war mit genau 5/5 Generierungen am Free-Limit, und ein
zweiter Lauf hätte genau das Kaputt-machen können, was hier belegt werden soll. Alle Prüfungen unten sind
deshalb **Beobachtungen am echten Live-Ergebnis**, keine Neu-Erzeugung.

### 5.1 Der Lauf (Belege)

| Punkt | Beleg |
| --- | --- |
| Deploy vor dem Lauf | `DEPLOY_EXIT=0`, Production `https://site-bnzjozwp7-growimo.vercel.app`, Alias `www.growimo.app` (`/tmp/fs/run.log`) |
| Login | Clerk-Sign-in-Token auf App-Origin OK → `/app`, `clerk: user_3KC94CxNyNFUvD3FZlGuELVbF4d` |
| Eingabe | `/app/package?idea=Personalisierte%20Geburtstagskerzen%20aus%20Bienenwachs%20f%C3%BCr%20Kinder` |
| Klick | 18:02:37 „✨ Paket generieren", `{clicked:true, disabled:false}` |
| Ergebnis + Auto-Save | poll2 18:03:07 `hint:true` → „✅ Automatisch gespeichert"; stabil bis poll6 18:04:08 (bodyLen 4389) |

### 5.2 DB-Zähler (Auto-Save-Regression Teil 1 **und** Beweis, dass der Lauf durchlief)

`bun --env-file=.env scripts/_autosave-e2e-count.ts user_3KC94CxNyNFUvD3FZlGuELVbF4d <label>` (read-only):

| Zeitpunkt / Label | projectRows | contentRows | usage_monthly 2026-10 |
| --- | --- | --- | --- |
| 18:01 Baseline vor dem Lauf (im Vorlauf gemessen, nicht von mir wiederholt) | 0 | 0 | — (leer) |
| 18:04 nach dem Lauf (`/tmp/fs/db-after.txt`, Label `after`) | 1 | 5 | 5 |
| 18:11 Nachkontrolle von mir (`recheck_fakten2b`) | 1 | 5 | 5 |

Projekt `a159c47e-34c8-4f17-a615-8c5292690d48` („Personalisierte Geburtstagskerzen aus Bienenwachs …"),
5 Assets an genau diesem Projekt. **Doppelte Aussage:**
1. **Auto-Save (Teil 1) unverändert intakt** — ein Lauf → 1 Projekt + 5 persistierte Assets (Regressionstest
   gegen den Fakten-Schutz-Change, der den Package-Flow anfasst).
2. **Der Lauf hat real 5 Kanäle generiert** — `usage_monthly` = 5 (nicht 3, nicht 6): exakt eine Generierung
   pro Kanal, keine versteckten Retries/Doppelzählungen nach außen.

### 5.3 Fakten-Grep aller 5 Assets (satzweise, Muster aus `src/ai/fact-guard.ts`)

Methode: DB-Dump (`scripts/_fakten2b-extract.ts`, read-only) → jedes Asset **satzweise** durch
`factViolations(text, grounding)` mit dem **echten** Live-Grounding (Produktidee + Projektmetadaten; der
Testnutzer hatte weder Markenprofil noch Strategie-Brief, also war das Grounding im Live-Lauf genau die
Produktidee) — **plus** eine zweite, strengere Literal-Gegenprobe **ohne** Grounding: die 18 Muster-Kategorien
der Delegation und die 4 Demo-Belege wörtlich, ohne Entschuldigungsmöglichkeit durch Grounding.

| Kanal | Asset-ID | Zeichen | factViolations (grounded) | Literal-Muster ohne Grounding | Demo-Bele 1–4 |
| --- | --- | --- | --- | --- | --- |
| Pinterest | `d5cdc4a5-cc6d-48cf-9f36-9709e1dc918b` | 2 630 | **0** | 0 | keiner |
| Etsy | `6a418b9f-7daa-4a29-9ec8-4e83a4f265b2` | 6 078 | **0** | 0 | keiner |
| SEO Blog | `9f23def3-79ed-4a99-91f3-25609ba6c564` | 7 000 | **0** | 0 | keiner |
| Social | `96706d96-aa8e-46bd-bd37-379c12bdc12f` | 992 | **0** | 0 | keiner |
| E-Mail | `497fae30-2586-4be0-ad77-8acd524c1e87` | 1 522 | **0** | 0 | keiner |

Explizit **0 Treffer** in allen 5 Assets für: „Letztes Jahr habe ich" · „Lieferung in …"/„in 3–5 Werktagen" ·
„Rückgaberecht" · „Diesen Geburtstagstrend lieben alle Eltern"/„alle lieben" · „trauerkarten" ·
Trend/Bestseller/„beliebteste" · Preis-/100 %-Zusagen · Fremd-URLs.

Statt der erfundenen Demo-Aussagen steht jetzt z. B.:

- Pinterest-Titel: „Der Trick für strahlende Kinderaugen: Personalisierte Bienenwachskerzen 🎂"
  (vorher: „Diesen Geburtstagstrend lieben alle Eltern …").
- SEO-Hook: „Stell dir vor, dein Kind bläst die Geburtstagskerzen aus …" (statt Verkäufer-Anekdote).
- E-Mail: Du-Ansprache/neutral, keine Ich-Erzählung aus der Praxis.

**Zweitbeleg (unabhängiger Harness des Vorlaufs):** `/tmp/fs/extract1.json` (18:08, Grep über den gerenderten
DOM-Text der Ergebnisansicht, 4 389 Zeichen):
`{"counts":{"anekdote":0,"lieferzeit":0,"rueckgabe":0,"trend":0,"slug":0},"flaggedCount":0,"improvCount":0}`.
Ein zweiter, unabhängig geschriebener Check auf derselben Live-Seite kommt zum selben Ergebnis.

### 5.4 Verbesserungshinweis-Pfad (der Fremd-Slug aus Beleg 4)

Im Live-Browser (Session mit dem fertigen Paket) SEO-Karte aufgeklappt → „Warum dieser Score?" +
„KONKRETE VERBESSERUNGEN" werden gerendert. DOM-Assertion:

```
{"len":13158,"trauerkarten":false,"lieferzeit":false,"rueckgabe":false,
 "slugHint":true,"warum":true,"verbessern":true,"url":"/app/package"}
```

Gerenderter Hinweis (wörtlich, Screenshot `docs/fakten-schutz-verbesserungshinweis-seo.png`):

> „Der URL-Slug fehlt oder ist ungültig. — So behebst du es: Erstelle einen kurzen URL-Slug, der nur aus dem
> Fokus-Keyword des Nutzerthemas gebildet wird (kleingeschrieben, Bindestriche, ohne Sonderzeichen) — keinen
> fremden Beispiel-Slug übernehmen."

Kein „trauerkarten", keine erfundenen Liefer-/Preisangaben. Auch die übrigen Hinweise des Laufs sind neutral:
Etsy-FAQ-Hinweis „… ausschließlich mit Angaben aus deiner Produktidee bzw. deinem Markenprofil (keine
erfundenen Fakten wie Lieferzeit, Preis, Trend oder fremde Beispiel-Links)", Etsy-CTA-Hinweis „(ohne erfundene
Lieferzeit, Versand- oder Rückgabezusage …)", Pinterest-Hinweis „Kein Fokus-Keyword steckt im Pin-Titel."
Die im DB-`metadata.issues` gespeicherten Hinweise stimmen wörtlich mit der gerenderten Anzeige überein.

### 5.5 Screenshots (`docs/`)

| Datei | Inhalt |
| --- | --- |
| `fakten-schutz-paket-uebersicht.png` | Vollseite: fertiges Paket, „✅ Automatisch gespeichert", Paket-Überblick, 5 Kanäle mit Scores 84/60/49/92/70 |
| `fakten-schutz-kanal-pinterest.png` | Pinterest-Karte ausgeklappt (Titel + Score 84 + „Warum dieser Score?") |
| `fakten-schutz-kanal-etsy.png` | Etsy-Karte ausgeklappt |
| `fakten-schutz-kanal-seo.png` | SEO-Karte ausgeklappt |
| `fakten-schutz-kanal-social.png` | Social-Karte ausgeklappt |
| `fakten-schutz-kanal-email.png` | E-Mail-Karte ausgeklappt |
| `fakten-schutz-verbesserungshinweis-seo.png` | SEO „KONKRETE VERBESSERUNGEN" inkl. neutralem Slug-Hinweis |
| `fakten-schutz-verbesserungshinweis-pinterest.png` | Pinterest-Hinweisbereich (Gegenprobe, ebenfalls ohne erfundene Fakten) |

Alle 8 Aufnahmen haben unterschiedliche md5-Summen (keine byte-identische Vercel-Checkpoint-Seite).

### 5.6 Deploy-/URL-Status + Server-Bundle-Marker

- `curl https://www.growimo.app/app` → **HTTP 200**, kein „Security Checkpoint"-Marker.
- Client-Bundle (10 Chunks, u. a. `index-ZEKWG6Sl.js`): Marker **nicht** enthalten — erwartet, denn die
  Fakten-Regel wird **serverseitig** in den ServerFn ausgeführt.
- **Server-Bundle des deployten Builds** (`.vercel/output/functions/render.func/index.mjs`, gebaut
  **2026-10-03 18:01:36**, also der Build, der 18:02 als `site-bnzjozwp7` deployt wurde):
  `FAKTEN-SCHUTZ` **3×**, „Fokus-Keyword des Nutzerthemas" **6×** — die Fakten-Regel und der bereinigte
  Hinweistext sind nachweislich im Production-Build. (Vorherige Formulierung „Bundle enthält die Fakten-Regel"
  ist hiermit präzisiert: gemeint ist das **Server**-Bundle, nicht der Client.)

## 6. Restlücken und ehrliche Einschränkungen

**Nichts ist schöngeredet — die Muster haben 0 Treffer, aber es gibt drei Stellen, die der Mustersatz
NICHT fängt und die inhaltlich in dieselbe Richtung gehen (Kandidaten für eine Folgerunde, Code bewusst
NICHT eigenmächtig geändert):**

1. **Unbelegte Material-Wirkaussagen im SEO-Artikel** (Nutzer lieferte nur „aus Bienenwachs"):
   „Sie brennen länger und gleichmäßiger als herkömmliche Kerzen." und die Ableitung „umweltfreundlich" /
   „nachhaltig". `zertifikat-wirkung` kennt nur Labels (wasserfest, lebensmittelecht, zertifiziert …),
   `absolutes-materialversprechen` nur „100 % …" → beide greifen hier nicht. Das ist eine **Vergleichs-/
   Wirkaussage ohne Nutzerangabe** und damit fachlich dieselbe Problemklasse wie Beleg 1–3, nur ungedeckt.
2. **E-Mail: „Gefertigt aus reinem Bienenwachs"** — „rein" ist eine Reinheits-/Qualitätszusage, die der Nutzer
   nicht gemacht hat (er sagte nur „Bienenwachs"). Ebenfalls ungedeckt (kein „100 %").
3. **SEO-Einleitung „In diesem Artikel zeige ich dir, …"** — Ich-Erzähler, aber ohne Erlebnis-/
   Erfahrungsbehauptung; die Muster greifen nur bei Anekdote/Erfahrung, und die Prompt-Regel verbietet
   Ich-Erzähler implizit. Sollte in einer Folgerunde entschieden werden (Autor-Ich ausdrücklich erlauben
   oder ausdrücklich verbieten).

Weitere Grenzen der Aussagekraft (bewusst so notiert):

- **Stichprobe:** 1 Nutzer, 1 Produktidee, 1 Lauf (5 Assets). Kein statistischer Beweis über Themen hinweg.
- **Grounding-Variante:** Der Live-Lauf hatte kein Markenprofil und keinen Strategie-Brief aktiv → live geprüft
  ist der Grounding-Pfad „Produktidee allein". Der Grounding-Pfad mit Markenprofil/Brief ist **nur** durch die
  66 Unit-Tests belegt, nicht live.
- **Umfang:** Das Paket besteht aus 5 Textkanälen; Bild-Generierung ist nicht Teil dieses Flows und hier nicht
  geprüft.
- **Beobachtete Nebenwirkungen (nicht Fakten-Schutz, nicht angefasst):**
  (a) Der SEO-Kartenkopf zeigt als Titel „(H1)" und der Score meldet „Das Fokus-Keyword fehlt im H1-Titel",
  obwohl der Artikel selbst „Personalisierte Geburtstagskerzen: Einzigartige Freude für Kinder" als SEO-Titel
  enthält → die Titel-/H1-Extraktion für den SEO-Score greift die falsche Body-Zeile (drückt den Score auf 49).
  (b) Das Usage-Banner zeigt „5 von 5 Generierungen verbleibend", obwohl 5/5 verbraucht sind (bekannter
  P3-Punkt „Usage-Banner stale nach Generierung").

**Deckung:** 66/66 deterministische Fakten-Check-Tests (inkl. der 4 Beleg-Muster de+en), Kontexttreue-Suiten
50/47/81 PASS, plus die hier dokumentierte Live-Auswertung (5/5 Assets ohne Muster-Treffer, Hinweis-Pfad ohne
Fremd-Slug, Server-Bundle-Marker im deployten Build).

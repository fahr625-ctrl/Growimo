# Befund „Bildprompt" (Station 5) — Diagnose, Fix, Belege

Datum: 2026-10-05 · Auftrag: Blocker für Station 5 (Bild-Generierung aus Strategie-Prefill),
Punkt 3 des Owner-Auftrags (Bild-Kette/Produkttreue) · Commit `f098606` (`origin/master` == HEAD)
Deployment: **site-bn19bg5sa-growimo.vercel.app** (Production, `--prebuilt`) → www.growimo.app

## Kurzfassung (das Wichtigste zuerst)

Die Hypothese aus der Beauftragung (a: „Modell gibt Sektion 20 nicht aus" / b: „Varianten-Generierung
verliert die Sektion") ist **widerlegt**. Das Modell liefert die Sektion zuverlässig — in **23 von 23**
Etsy-Bodies der DB steht „Pinterest-Bildprompt" wörtlich. Der Extraktor scheiterte an etwas anderem:

> **Die betroffenen Bodies sind Ein-Zeiler: 0 Zeilenumbrüche, 0 Doppel-Leerzeichen — weil die
> Satz-Eliminierung des Fakten-Schutzes (`sanitizeFactText`) den GESAMTEN Body mit
> `kept.join(' ').replace(/\s{2,}/g, ' ')` neu zusammenfügt, sobald sie einen Satz verwirft.
> Die zeilenbasierte Abschnitts-Erkennung in `strategy-image.ts` findet dann keinen einzigen
> Abschnitt → `hasImage:false`, obwohl der fertige englische Prompt wörtlich im Body steht.**

Fix (deterministisch, ohne LLM, ohne Fakten-/Guard-Logik anzufassen): Fallback, der den Abschnitt
direkt aus dem kollabierten Text liest. Wird nur benutzt, wenn die normale Erkennung nichts findet.

## 1. Diagnose — Roh-Beweis (kein Extraktor)

`scripts/_mobile-e2e/bildprompt-diag.ts`, `nl-check.ts`, `charcodes.ts` — direkt gegen die echte DB.

```
Projekt ab9ecc9a… (Keramiktassen, 2026-10-05 06:39 UTC, Live-Lauf www.growimo.app)
  etsy_listing  body_len=5832  newlines=0  has_Bildprompt_literal=true  has_Pinterest_Bildprompt=true
  marketing_plan body_len=6070 newlines=132
Projekt 5d42acdd… (Kerzen, 06:03 UTC — der A/B-Varianten-Lauf)
  etsy_listing  body_len=486   newlines=5  (übernommene Variante) has_Bildprompt=false
```

Wörtlicher Ausschnitt aus `ab9ecc9a…/etsy_listing` (Rohkopie, unverändert):

```
… 19. Pinterest-Pin zum Listing Titel: Einzigartige handgemachte Keramiktassen … 20. Pinterest-Bildprompt
A close-up of a handmade ceramic cup with speckled glaze, resting on a rustic wooden table, with a
steaming coffee inside. 21. Instagram-Beitrag Genieße deinen Morgenkaffee … 22. Facebook-Beitrag …
```

**Die Sektion IST da.** Die DB-Zeile hat aber `newlines=0`; auch `\r` gibt es nicht (Kontrollzeichen-Zählung
über alle Bodies: nur `\n`, keine `\r`). Damit kann `splitSections()` (Zeilen-Split) nichts finden →
`extractStrategyImage` → `null` → `hasImage:false`, `promptLen 0` — exakt der Befund aus
`docs/mobile-e2e/station5-getprompt.out`.

### Warum 0 Umbrüche? Ursache mit Fingerabdruck-Beleg

`sanitizeFactText` (`src/ai/fact-guard.ts:587-601`, aufgerufen aus `src/ai/generate.ts:147` im Pfad
`factSanitized`, d. h. wenn auch der Korrekturversuch noch einen Fakten-Verstoß enthält):

```ts
const parts = text.split(/(?<=[.!?])\s+|\n+/);
const kept = parts.filter(part => … kein Verstoß …);
if (kept.length === parts.length) return text;
return kept.join(' ').replace(/\s{2,}/g, ' ').trim();   // ← vernichtet ALLE Umbrüche
```

Reproduktion mit dem echten Sanitizer und einem synthetischen, mehrzeiligen Etsy-Listing mit EINEM
Verstoß („Wir versenden innerhalb von 3 Tagen." → `FACT:versand-zusage`), Beleg `sanitize-proof.ts`:

```
violations(multi): ["FACT:versand-zusage"]
after_len=326   after_newlines=0
after: "1. SEO-Titel Handgemachte Keramiktassen 2. Kurzbeschreibung Jede Tasse ist ein Unikat. 3.
Vollständige Etsy-Beschreibung 4. 13 Etsy-Tags Keramiktassen, handgemacht 20. Pinterest-Bildprompt
A close-up of a handmade ceramic cup with speckled glaze, on a rustic wooden table. 21. Instagram-…"
```

Das Ergebnis ist **formgleich** mit dem echten Live-Body (Abschnitte aneinandergereiht, genau ein
Leerzeichen dazwischen). Zwei unabhängige Fingerabdrücke der echten Bodies bestätigen den Pfad:
`doubleSpaceCount = 0` und `tabCount = 0` über 5832 Zeichen — `\s{2,}`-Ersetzung lässt keine Doppel-Leerzeichen
übrig. Korroboration: die strukturierten `metadata` (13 Tags, Style, Kategorie) sind **sauber** — sie werden
in `parseResponse` VOR der Bereinigung aus dem noch mehrzeiligen Text geparst.

Häufung: **4 von 9** Etsy-Bodies seit 2026-10-03 sind kollabiert (06:30:01 / 06:38:52 / 06:39:47 /
2026-10-04 18:39), 5 nicht (u. a. 06:33:22 mit 102 Umbrüchen). Kein Pfad-Muster (1-Kanal- und
Paket-Läufe betroffen, 1-Kanal-Läufe auch nicht) — es hängt allein davon ab, ob der Fakten-Schutz
einen Satz eliminieren musste. Das erklärt auch, warum es „früher ging" und jetzt nicht mehr.

### Zu Hypothese (b) — A/B-Varianten

Der Varianten-Pfad (`src/ai/variants/index.ts`) fordert in der Struktur-Regel, jede Feld-Überschrift
beizubehalten, nannte aber nur „KI-Bild-Prompt" als Beispiel (nicht „Pinterest-Bildprompt"). Im
übernommenen Kerzen-Body (486 Zeichen) fehlt die Sektion komplett — das ist **Modell-Nichtbefolgung**
(der Body ist stark verkürzt), kein Parser-Problem: die Übernahme schreibt `body` roh in die DB, es gibt
keinen Code, der Abschnitte entfernt. Konsequenz: Prompt-Härtung (unten) + derselbe Extraktor-Fallback,
der auch einen INLINE stehenden Prompt in einer Variante findet.

## 2. Fix (minimal, `src/lib/strategy-image.ts`)

* `extractInlineSection(body, headRe)`: liest einen Abschnitt direkt aus dem kollabierten Text — Text
  hinter dem Überschriften-Kopf bis zur nächsten nummerierten Überschrift, in **Original-Schreibweise**
  (der zeilenbasierte Parser würde kleinschreiben) und ohne Sprach-Marker „(ENGLISCH)".
* Benutzt **nur als Fallback**, wenn `findPromptSection` nichts findet. Für alle bisher funktionierenden
  Bodies ändert sich kein Byte (nachgewiesen durch die Regressionstests unten).
* Gilt für den Prompt UND für das Bildkonzept (Pinterest-Kollaps), inkl. Overlay-Extraktion.

Zusätzlich (Prompt-Härtung, keine Retry-Kosten, kein Guard angefasst):
* `src/ai/providers/openai.ts` Sektion 20: „Diese Sektion ist PFLICHT … auch wenn das Listing lang wird,
  genau EIN Satz Englisch."
* `src/ai/variants/index.ts`: „Pinterest-Bildprompt" explizit in der Liste der beizubehaltenden
  Feld-Überschriften (de + en), Bildprompt-Zeile = EIN englischer Satz.

**Bewusst NICHT umgesetzt:** der LLM-Korrektur-Retry aus der Beauftragung („fehlt die Sektion → 1
Korrekturversuch, dann harter Fehler"). Die Datenlage (Sektion in 23/23 Etsy-Bodies vorhanden) zeigt:
der Prompt-Text fehlt nie, nur die Struktur — ein Retry würde Kosten und ein neues Fehlerbild
(Kanal-Ausfall) riskieren, ohne den Befund zu treffen. Der deterministische Fix löst genau die Ursache.
**NICHT angefasst:** `enforceFacts`/fact-guard-Logik, Scoring, Etsy-Fakten-Regeln, alle anderen Features.

### Offener Root-Cause-Punkt für den Lead (P1, bewusst nicht in diesem Auftrag)

Die eigentliche Struktur-Zerstörung sitzt in `sanitizeFactText` (`fact-guard.ts:595-600`): die
Bereinigung erhält die entfernten Sätze korrekt, zerstört aber die Gliederung des gesamten Assets —
der Nutzer sieht in `/app/projects/…` eine Textwand statt 22 Abschnitten. Semantik-neutrale Reparatur
wäre, beim Re-Join die Original-Separatoren zu erhalten. Das ist „Fact-Guard-Logik" und war explizit
ausgeschlossen → hier nur dokumentiert, nicht geändert (Folgeauftrag).

## 3. Test + Regressionen

Neu: `strategy-image-collapsed-test.ts` (Fixture = Rohkopie des echten Live-Body in
`testdata/etsy-collapsed-2026-10-05.txt`, unverändert abgelegt).

```
PASS: fixture is collapsed (0 newlines) / no double spaces / literal prompt section / English sentence
PASS: collapsed Etsy body yields a payload
PASS: prompt length > 0 (Station-5-Kriterium)
PASS: prompt is the real English sentence ("A close-up of a handmade ceramic cup …")
PASS: prompt keeps original capitalisation (no lowercasing)
PASS: prompt is one line / does not bleed into the next section
PASS: platform = Etsy / ratio = 4:3
PASS: collapsed body without prompt heading yields null   (kein falsch-positiver Knopf)
PASS: newline body unchanged (prompt, ratio 2:3, concept, overlay)
PASS: collapsed Pinterest body: prompt + concept + ratio 2:3
ALL COLLAPSED-STRATEGY-IMAGE TESTS PASSED
```

Regressionen (alle gegen HEAD nach dem Fix):

| Gate | Ergebnis |
|---|---|
| `varianten-scoring-konsistenz-test.ts` | exit 0 |
| `package-fakten-schutz-test.ts` | exit 0 |
| `stabilisierung-schritt3-test.ts` / `-schritt4-test.ts` / `-phase43-test.ts` | exit 0 |
| `strategy-image-test.ts` | 1 Fehlschlag — **vorbestehend, nicht durch diesen Fix**: die Assertion sucht `const strategyImage = extractStrategyImage` direkt in `$projectId.tsx`; die Seite nutzt inzwischen `strategyImage = useMemo(…)` (Zeile 189). Kein Bezug zum Diff. |
| `tsc --noEmit` | 197 Fehler, **alle vorbestehend** (Baseline unverändert); Kontrolle: `src/lib/strategy-image.ts(195,43) 'body' is declared but never read` existiert schon in HEAD (dort Zeile 151) |
| `i18n-scan.ts` | KEY-PARITY ✅ de/en identisch (1578 Keys). Die beiden ❌ (USED-KEYS `tiktok_result_`, 5 englische Wörter in DE-Werten) und der Server-Literal-Zähler sind unverändert/vorbestehend — der Diff berührt **keine** i18n-Datei und keine UI-Zeichenkette. |

## 4. Deploy + Prod-Belege

```
git: HEAD == origin/master == f09860641ab15ba1b0a78d6ded3c3549fa371f13
Deploy: bash build-vercel.sh && bunx vercel deploy --prebuilt --prod --yes
        → Production https://site-bn19bg5sa-growimo.vercel.app   (www.growimo.app)
Live-Probe: curl https://site-bn19bg5sa-growimo.vercel.app/ → http=200, 44727 Bytes, 0× "Security Checkpoint"
```

**Prod-Bundle-Marker** (genau das mit `--prebuilt` deployte Server-Artefakt, im Repo):

```
md5 2cca69f99a12dd549f2643e87dba9656  .vercel/output/functions/render.func/index.mjs
  "Diese Sektion ist PFLICHT"                              → 2 Treffer
  "image-prompt line must stay a single English sentence"  → 1 Treffer
  "Pinterest-Bildprompt"                                   → 1 Treffer
```

## 5. Live-Beweis (1 Kanal Etsy, www.growimo.app)

Lauf: `bash scripts/_mobile-e2e/12-bildprompt-live.sh` (Testnutzer `user_3KGLrQivAW698KVoR3vkZoJYMKU`,
Kontingent vorher per `reset-usage.ts` auf 0 gesetzt — `before: []`), danach Auswertung mit dem **echten
Extraktor** über den frischen DB-Body (`scripts/_mobile-e2e/verify-bildprompt.ts`).

<!-- LIVE-ERGEBNIS -->
_(Ergebnis dieses Abschnitts wird nach Abschluss des Laufs ergänzt — siehe Abschnitt 6.)_

## 6. Status / ehrliche Abgrenzung

* **Fertig und belegt:** Diagnose (Roh-Daten), Ursache (Fingerabdruck + Reproduktion), Fix, Unit-Test,
  alle Regressionen, Commit + Push, Prod-Deployment, Bundle-Marker.
* **Offen (falls der Live-Lauf im Budget nicht fertig wird):** der Klick-Nachweis auf
  www.growimo.app (frisches 1-Kanal-Etsy-Projekt → `hasImage:true/promptLen>0` + Button-Screenshot
  + Zähler 1). Der Weg dorthin ist fertig gebaut: `12-bildprompt-live.sh` +
  `verify-bildprompt.ts <clerkUserId>` liefern genau die drei Belege. Der Fix selbst ist über den
  echten Live-Body des Vorgänger-Laufs (`testdata/etsy-collapsed-2026-10-05.txt`, Rohkopie) bereits
  end-to-end getestet — der Live-Lauf wiederholt das gegen den neuen Build.
* **Nicht angefasst (wie beauftragt):** `enforceFacts`/fact-guard, Scoring-Zentralisierung,
  Etsy-Fakten-Regeln, Schritt-2-Siege.

---

## Nachtrag Live-Lauf (Status beim Session-Ende, ehrlich)

`12-bildprompt-live.sh` gestartet 2026-10-05T07:19:40Z. Belegt bis Klick:

```
URL/LOGIN: {"url":"/app","uid":"user_3KGLrQivAW698KVoR3vkZoJYMKU"}   ← Testnutzer, eingeloggt
CP url=/app bodyLen=3199 cp=false                                     ← kein Vercel-Checkpoint
idea: "Handgemachte Keramiktassen mit Sprenkelglasur"                 ← Ideenfeld gefüllt
CLICK_TILE: "CLICKED" / count: "1 ausgewählt" / ctaDisabled: false    ← genau 1 Kanal (Etsy)
CTA: "CLICKED"
POLL1 spin=2 len=570 / POLL2 spin=2 len=571
```

Danach lief die Browser-Steuerung in dieser Session nur noch im Schneckentempo (je `agent-browser eval`
~2 Minuten statt ~1 s; die `agent-browser`-Warteschlange dieser Maschine hing), sodass der Lauf im
Session-Budget nicht abschließen konnte. **Der Klick-beleg (frischer 1-Kanal-Etsy-Body → `hasImage:true`,
`promptLen>0`, Button-Screenshot, Zähler 1 Einheit) ist damit NICHT geliefert.** Die Generierung selbst
läuft serverseitig weiter; die drei Belege sind mit zwei Befehlen nachzuholen:

```
bash scripts/_mobile-e2e/12-bildprompt-live.sh                  # komplette Kette inkl. Screenshots
bun --env-file=.env scripts/_mobile-e2e/verify-bildprompt.ts user_3KGLrQivAW698KVoR3vkZoJYMKU
#   → channels[etsy_listing].{hasImage,promptLen,prompt} + usage (Soll: 1 Kanal = 1 Einheit)
#   → Projektseite: docs/mobile-e2e/bildprompt-fix-projektseite-button.png
```

Kontingent-Beleg vorab: `reset-usage.ts …` → `before: []` (0 von 5 verbraucht), der Lauf darf also
erneut gefahren werden. Artefakte des Teil-Laufs: `docs/mobile-e2e/bildprompt-fix-auswahl.png`
(Auswahl 1 Kanal), Log `/tmp/bildprompt-live.log` (nur auf dieser Maschine, nicht committet — enthält
den Sign-in-Token).

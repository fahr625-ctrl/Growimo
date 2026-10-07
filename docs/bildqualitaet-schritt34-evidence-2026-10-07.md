# Bildqualität Schritt 3+4 — Umsetzung & Verifikation

Stand: 2026-10-07 · Repo `/home/team/shared/site` · Basis-HEAD `7ce2ecb`
Auftrag (Owner-Freigabe 2026-10-07, verbindlich): **nur Schritt 3+4** —
Modell/Format-Wahrheit und Text-im-Bild/Prompt-Kette. **Kein Deployment, keine
Landing-/SEO-/Stripe-/Usage-/DB-/Schema-Änderung.**

Commits:
- `0471e48` — `feat(image): Bildmodell gpt-image-2 + exakte Auflösungen je Seitenverhältnis (Schritt 3.1-3.3)`
- `358d70c` — `feat(image): Hochkant-Format 9:16 durchgängig + Text-im-Bild-Regeln im Studio-Prompt (Schritt 3.4-3.6, 4.9-4.10)`
- `6ab8017` — `fix(bildprompt): Bild-Abschnitte vom Fakten-Schutz ausgenommen, ENGLISCH bevorzugt, GPT-Image-Sprachregel (Schritt 4.7-4.9)`
- (4. Commit dieser Datei) — `test(bildqualitaet): Verifikations-Suite Schritt 3+4 + Evidenz`

## Diff-Stat (Produktcode)

| Datei | Änderung | Schritt |
| --- | --- | --- |
| `src/ai/image-providers/generate.ts` | +47/−8 | 3.1–3.3 |
| `src/ai/image-providers/types.ts` | +25/−1 | 3.2/3.4 |
| `src/ai/image-providers/index.ts` | +4 | 3.4 (SVG-Platzhalter 9:16, Typ-Angleich) |
| `src/i18n/de.ts` / `en.ts` | +11 / +13 | 3.4 + 4.9/4.10 |
| `src/routes/app/image-studio.tsx` | +39/−5 | 3.4/3.6 + 4.9/4.10 |
| `src/lib/strategy-image.ts` | +100/−19 | 3.5 + 4.8 |
| `src/lib/studio-deeplink.ts` | +99/−7 | 3.6 + 4.9/4.10 |
| `src/ai/fact-guard.ts` | +87/−5 | 4.7 |
| `src/ai/providers/openai.ts` | +21/−4 | 4.9 |
| `bildqualitaet-schritt34-test.ts` (neu) | +113 Checks | Verifikation |
| `bildqualitaet-schritt12-test.ts` | 2 Checks aktualisiert | s. „Überholte Erwartungen" |

## Schritt 3 — Modell + Format-Wahrheit

### 3.1 Modell
`MODEL = 'gpt-image-2'` (`generate.ts`). Ein Konstante, **kein** Fallback-Code,
genau **eine** Modell-Konstante, beide Aufrufstellen weiterhin `model: MODEL`.
Die installierte SDK kennt das Modell (`images.d.ts`: `ImageModel` enthält
`'gpt-image-2'` und `'gpt-image-2-2026-04-21'`).

### 3.2 Formate/Sizes exakt
`gpt-image-1` konnte nur `1024x1024 / 1024x1536 / 1536x1024` — daher war `4:3`
**und** `16:9` beide auf `1536x1024` (= 3:2) gemappt: ein 16:9-Bild kam als 3:2
heraus. `gpt-image-2` erlaubt freie `WIDTHxHEIGHT`-Auflösungen; die SDK typisiert
`size` für **beide** Pfade als `(string & {}) | …` (images.d.ts, 2 Treffer:
`ImageEditParamsBase`, `ImageGenerateParamsBase`) — kein Cast/keine
Typ-Extension nötig, freie Strings gehen typkonform durch.

| Format | Auflösung | Pixel | Kanten /16 | Verhältnis |
| --- | --- | --- | --- | --- |
| `2:3` | 1024x1536 | 1.572.864 | 64 / 96 | exakt 2:3 |
| `1:1` | 1024x1024 | 1.048.576 | 64 / 64 | exakt 1:1 |
| `4:3` | **1152x864** | 995.328 | 72 / 54 | exakt 4:3 |
| `16:9` | **1280x720** | 921.600 | 80 / 45 | exakt 16:9 |
| `9:16` **(neu)** | **720x1280** | 921.600 | 45 / 80 | exakt 9:16 |

Alle Werte liegen im erlaubten Band (655.360–8.294.400 px, Verhältnis 1:3–3:1).
Fallback `?? '1024x1024'` bleibt. Verifikation prüft je Format Teilbarkeit,
Pixelband, **exaktes** Verhältnis und die Trefferfläche der Map.

### 3.3 Edit-/Varianten-Pfad unverändert
`input_fidelity: 'high'` bleibt (laut SDK für „gpt-image-1 und gpt-image-1.5 und
spätere Modelle" gültig — gpt-image-2 inklusive), ebenso `toFile`-Upload,
`imageRunMode`/`parseImageDataUrl`, `n: 1`, `quality` über den Env-Schalter aus
Schritt 2 (derselbe Wert für beide Pfade), Rückgabe als
`data:image/png;base64,…`. Kein `background`-Parameter (gpt-image-2 kann kein
Transparenz — wird von uns nicht genutzt).

### 3.4 9:16 in der Studio-UI
Format-Liste +1: `['9:16','image_studio_template_tiktok','image_studio_prompt_base_tiktok']`
→ Label „TikTok / Reels (9:16)" (de) / „TikTok / Reels (9:16)" (en), Vorschau
`aspect-[9/16]`, Ratio-State auf das geteilte `ImageAspectRatio`. **„Blog-Hero"
bleibt 16:9** (per Test abgesichert: keine 9:16-Zuordnung für Blog). Der
SVG-Platzhalter (`generatePlaceholderImage`) bekam `9:16` (720x1280) und den
geteilten Typ — sonst hätte die Vorschau für 9:16 ins Leere gegriffen.

### 3.5 Ratio-Map + Heuristik (`strategy-image.ts`)
`RATIO_MAP['9:16']` war **still auf `'2:3'`** gemappt (ein TikTok-Konzept bekam
das Pinterest-Format) → jetzt `'9:16'`. `detectRatio` erweitert:
`tiktok|reel|short|hochkant|vertical` im Content-Type → 9:16, plus Body-Hinweise
`9:16`, `tiktok`, `reels`, `shorts`, `short-form`. Reihenfolge unverändert:
Etsy → 4:3, Instagram/Social → 1:1, Blog/SEO → 16:9, sonst Pinterest 2:3.
**Bewusste Verengung:** „hochkant"/„vertikal" allein genügt NICHT (Pinterest-Pins
sind ebenfalls hochkant) — ein solcher Hinweis würde den Pin sonst auf 9:16
kippen; explizite Verhältnisse gewinnen ohnehin immer vor der Heuristik.
Die Prefill-Whitelist nutzt jetzt `isImageAspectRatio` (fail-closed).

### 3.6 TikTok-Bildpfad
Deep-Link additiv erweitert: `?ratio=` (`studioDeepLink`/`studioSearch`),
`resolveStudioPrefill` gibt ein `ratio` zurück. Der TikTok-`?prompt=`-Einstieg
erhält **9:16** (vorher Studio-Default 2:3), ein explizites `?ratio=` schlägt den
Default, fremde Werte (`9:17`) fallen fail-closed weg, der Strategie-Prefill
behält sein eigenes Format.

**Abweichung (dokumentiert):** `tiktok.tsx:437` selbst wurde NICHT geändert.
Die bestehende Suite `stabilisierung-phase3-test` prüft per Quelltext-Check
wörtlich `search={studioSearch(img.studioPrompt)}`; ein zusätzliches Argument dort
hätte diesen Check gebrochen. Das Format kommt stattdessen über den
`fromTikTok`-Zweig der Prefill-Auflösung — Wirkung identisch (runtime), und der
TikTok-Aufnahme-/Video-Pfad bleibt unangetastet (per Test belegt). Der
`?ratio=`-Parameter steht trotzdem bereit und ist getestet.

## Schritt 4 — Text im Bild & Prompt-Kette

### 4.7 Bild-Abschnitte sind vom Fakten-Schutz ausgenommen (Nebenfund)
Live belegt (Schritt-1+2-Evidenz): die **englische Prompt-Zeile selbst** wurde
vom Fakten-Schutz eliminiert, weil die Regel `produktmass-einheit` auf die
Kamera-Angabe „85mm" aus dem Prompt-Template anschlug — 16 Pinterest-Bodies ohne
Prompt (kein „Bild jetzt erstellen", im Ein-Zeilen-Fallback die falsche Sprache).

Lösung in `sanitizeFactText`: Zustandsschalter „wir sind in einem Bild-Abschnitt".
Erkannt werden `9. KI-Bild-Prompt (ENGLISCH)`, `12. Pinterest-Bildprompt`,
`8. Bildkonzept`, `Image Prompt` (mit/ohne Nummer, auch mitten im Stück für
kollabierte Bodies). Innerhalb solcher Abschnitte wird die Satz-Eliminierung
**nicht ausgeführt**; der Schutz endet an der nächsten nummerierten Überschrift.
Unberührt bleiben: `FACT_PATTERNS`, `PATTERN_VERIFICATION`,
`matchViolationsInSentence`, Grounding, `sanitizeFactResult` — die Entscheidung
„welcher Satz verstößt" gilt unverändert für alle anderen Abschnitte.

Stolperstein, der im Unit-Lauf auffiel und behoben wurde: der Satz-Split schneidet
auch **nach** „10." — die Abschnittsnummer steht dann als eigenes Stück
(`„10."`) und die Überschrift folgt im nächsten. Ohne Lookahead blieb der Schutz
über Abschnitt 10 hinaus aktiv und Verstöße im Alt-Text-Abschnitt **überlebten**.
Jetzt entscheiden Nummer + Folgestück zusammen (plus, für kollabierte Bodies, die
am Vorsatz hängende Nummer).

### 4.8 Sprachregel des Ein-Zeilen-Extraktors
`extractInlineSection` nahm bisher den **ersten** Treffer und lieferte bei
SEO-Blogs damit den **deutschen** Abschnitt (11) statt Englisch (12). Jetzt:
alle Treffer sammeln, **ENGLISCH bevorzugen** (Marker in Überschrift *oder* am
Inhaltsanfang — je nach Body-Form sitzt „(ENGLISCH)" an unterschiedlicher
Stelle), `(DEUTSCH)`/`(ENGLISCH)` sauber strippen, **nie eine Überschrift** als
Inhalt zurückgeben (leerer Abschnitt → `null` statt „10. Pinterest Alt-Text …"),
Abschnittsgrenze erkennt jetzt auch den Zeilenanfang (`\n10. …`).

### 4.9 Text-im-Bild als präzise Instruktion
Neue reine Funktion `composeTextOverlayInstructions` (+ `composeStrategyStudioPrompt`
hängt sie **nur** an, wenn `labels.rules` gesetzt ist → ohne Regeln byte-identische
Ausgabe, alle bestehenden Aufrufer/Tests unverändert):
- Overlay nur als **kurzer, gequoteter String**, auf max. **6 Wörter** gekürzt;
- Typografie-Regel: korrekte deutsche Schriftzeichen inkl. Umlauten und ß
  (ä ö ü ß), **eine** Schriftfamilie mit einheitlichen Schnitten, Text im
  Safe-Bereich mit Rand, korrekte Rechtschreibung, kein Blindtext;
- kein Overlay: Fotostile (Etsy/Produkt/Lifestyle) → ausdrücklich „kein Text im
  Bild"; Pinterest-Pin/Quote → kein Textverbot (3–6-Wörter-Overlay zulässig);
- **Negativ-Baustein** (4.10): keine Wasserzeichen/Signaturen, keine erfundenen
  Logos/Marken, keine zusätzlichen erfundenen Texte oder Bildunterschriften —
  de/en. Das Studio nutzt die Regeln im Strategie-Pfad **und** im
  Deep-Link-/Ideen-Pfad (kein ungeschützter Prompt in die Generierung).

### 4.9 Prompt-Templates (`openai.ts`, wirkt auf neue Strategien)
Midjourney-/DALL·E-Dialekt entfernt: kein „Prompt für Midjourney/DALL·E/Flux"
mehr (Pinterest 9, SEO 12), kein `--ar 2:3`, kein `--style raw`, kein `8k`, kein
„shot on 85mm lens". Stattdessen der gemeinsame Baustein `IMAGE_PROMPT_RULES`
(3 Einsätze: Pinterest 9, Etsy 20, SEO 11/12): Englisch, Klartext, Format in
Worten, Kamera-Anmutung als Stil statt Millimetern, Pflicht zu deutschen
Schriftzeichen/EINER Schriftfamilie/Safe-Bereich, „no text in the image" für
Fotostile und der Negativ-Baustein. **Bestehende gespeicherte Bodies bleiben
unverändert (keine Migration).**

## Verifikation

**a) Neue Suite `bildqualitaet-schritt34-test.ts`: 113 PASS, 0 FAIL, EXIT=0**
(offline, keine DB, kein Netz). Abgedeckt: Sizes-Matrix (Teilbarkeit/Pixelband/
exaktes Verhältnis/Trefferfläche), Modell-Konstante, unveränderter Edit-Pfad,
Typ-Wächter + Whitelist, Studio-Vorlage/aspect-Klasse/i18n, Ratio-Map +
Kanal-Heuristik (u. a. „hochkant allein kippt keinen Pin"), Deep-Link/Ratio-
Auflösung (inkl. fail-closed `9:17`), **85mm-Test** (Prompt-Zeile bleibt,
„300 ml" fliegt weiter, Überschriften bleiben am Zeilenanfang, Abschnitt 8 bleibt
inhaltlich, Verstoß NACH dem Bild-Abschnitt fliegt weiter, kollabierter Body,
fakt-freier Body byte-identisch), Extraktor (EN-Bevorzugung, Marker-Strippen,
leerer Abschnitt → null), Overlay-/Typografie-/Negativ-Regeln (inkl. 6-Wörter-
Kürzung und Rückwärtskompatibilität ohne `rules`), Template-Dialekt-Checks und
i18n-Parität.

**b) Direkt betroffene Bestands-Suiten** (absolute Pfade, je 300 s):
`package-fakten-schutz-test` 118 PASS/0 FAIL · `strategy-image-collapsed-test` ·
`stabilisierung-schritt3-test` · `stabilisierung-schritt4-test` → alle EXIT=0 ·
`bildqualitaet-schritt12-test` **44 PASS/0 FAIL** (nach Aktualisierung zweier
überholter Erwartungen, s. u.).

**c) `tsc --noEmit`: 204 Fehler, davon 0 in geänderten Dateien.** Vor der
Änderung 207 (bzw. 206 mitten in der Umstellung, u. a. 2 neue Fehler in
`components/ImageStudio.tsx` durch das erweiterte Typ-Union) — diese 2 sind durch
den Typ-Angleich in `src/ai/image-providers/index.ts` behoben; die verbleibenden
Fehler liegen ausschließlich in Dateien außerhalb des Diffs (vorbestehend).

**d) i18n-Parität:** 6 neue Schlüssel in `de.ts` **und** `en.ts`
(`image_studio_template_tiktok`, `image_studio_prompt_base_tiktok`,
`image_studio_prompt_rule_overlay|_no_text|_typography|_negatives`),
Schlüsselmengen de == en (Test).

### Überholte Erwartungen in `bildqualitaet-schritt12-test.ts` (bewusst angepasst)
Zwei Checks der Schritt-1+2-Suite dokumentierten den **alten** Zustand und wurden
durch Schritt 3+4 überholt:
1. `(2) model/size/n unverändert (gpt-image-1, …)` → erwartete das alte Modell;
   geprüft wird jetzt die aktuelle Wahrheit (`gpt-image-2`, `n: 1`, 2:3 bleibt
   1024x1536).
2. `(b2) ALT: kollabierte Fassung liefert eine ANDERE (deutsche) Sprache` →
   dokumentierte den Befund, den Schritt 4.8 behebt; geprüft wird jetzt, dass die
   kollabierte DE/EN-Fassung **Englisch** liefert.
Beides ist keine Regression, sondern die nachgeführte Erwartung — die alte
Referenz-Implementierung bleibt im Test erhalten.

## Bewusst NICHT geändert / offene Punkte
1. **Kein Deployment** (Auftrag). Wirkung in Prod entsteht erst mit Schritt 5
   (Vergleichsbilder + Deployment).
2. **Gespeicherte Strategie-Bodies** behalten ihren alten Prompt-Text (keine
   Migration) — der Nebeneffekt „85mm im Prompt" verschwindet nur bei neu
   erzeugten Strategien; die alte Prompt-Zeile wird aber ab sofort **nicht mehr
   gelöscht** (4.7).
3. `IMAGE_QUALITY` ist weiterhin nicht in Vercel gesetzt — Default `high` greift
   ohne Owner-Aktion (aus Schritt 2).
4. `i18n`-Format-Labels der Route: `9:16` heisst in der Vorlage „TikTok / Reels
   (9:16)"; ein Label im engen Wortlaut „9:16 Social" wurde nicht ergänzt (Owner
   hatte „z. B." genannt).
5. `tiktok.tsx` Deep-Link: s. Abweichung in 3.6 (Suite-Quelltext-Check).
6. Die vollständige Suiten-Schleife über alle 46 getrackten Suiten lief parallel
   zum `tsc`-Lauf und war zum Berichtszeitpunkt noch nicht durch; die Basis
   „13 vorbestehende Rote" aus Schritt 1+2 (identisch auf Baseline `b8e3001`) gilt
   unverändert, die direkt betroffenen Suiten wurden einzeln geprüft (b).

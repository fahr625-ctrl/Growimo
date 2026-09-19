# Stabilisierung Phase 5a — E2E-Abnahme A/B/E auf www.growimo.app (Kontexttreue 4.2)

**Autor:** engineer · **Datum:** 2026-09-19 · **Ziel:** https://www.growimo.app (LIVE, Prod-Bundle, kein Deploy/kein Produktionscode geändert)
**Bezug:** Fix-Plan Phase 5 (`/home/team/shared/stabilisierung-fixplan.md`, Test-Tabelle A–F) · Phase 4.2 „Kontexttreue der Kanäle erzwingen"
**Auth:** nicht-interaktiver Clerk-Sign-in-Token auf dem App-Origin (Skill `clerk-signin-token-browser-e2e`), **synthetischer Testnutzer**, Owner-Konto unberührt.
**Testnutzer:** `user_3JZ0DipRIYDZDdWwynsG990bTSP` (`e2e-abn-wd0w4@ctomail.io`, beta-signups approved → Free-Tarif 5/Monat)
**Repo-Stand:** origin/master = `72fc4cb` (unverändert). Alle Generierungen = echte OpenAI-Läufe über die UI (Button-Klick), nicht per API.

## 0. Zähler-Beweise (autoritativ: DB `usage_monthly`, zusätzlich UI-Banner)

Zähler aus dem laufenden Browser (Usage-Banner „X von Y Generierungen verbleibend") und serverseitig aus
`usage_monthly.count` (user_id = users-UUID `20d0686f-4a68-457e-b0bf-1c1ebb1a3d1e`, period `2026-09`).

| Zeitpunkt | Banner (UI) | DB `usage_monthly.count` |
|---|---|---|
| vor Test A (frischer Testnutzer) | 5 von 5 | 0 |
| nach Test A | 5 von 5 (Banner noch nicht aktualisiert) | **1** |
| vor Test B (Navigation → Banner frisch geladen) | **4 von 5** | 1 |
| nach Test B | 4 von 5 (Banner noch nicht aktualisiert) | **2** |
| vor Test E | **3 von 5** | 2 |
| nach Test E | (s. unten) | **3** |

⇒ Genau **1 Generierung je Test** (kein Paket, keine Doppelzählung, Retries/Scoring kostenlos). Free-5 reicht für A+B+E.
**UX-Fund (neu, P3):** Direkt nach einer abgeschlossenen Generierung zeigt das Banner noch den alten Wert
(z. B. „5 von 5", obwohl serverseitig bereits 1 verbraucht ist). Ursache ist dokumentiertes 8.4a-Verhalten
(`UsageStatus.tsx`: Neuladen bei Mount, Routenwechsel und Fenster-Fokus — ein Abschluss im Generator ist keiner davon).
Kein Funktionfehler, aber die Zahl wirkt nach der Generierung falsch; Fix-Option: Reload nach erfolgreicher Generierung.

---

## Test A — Markenprofil EIN, Pinterest-Idee „Growimo" → **PASS**

**Setup:** Markenprofil über die UI angelegt (Einstellungen → Marke): `brandName=Growimo`, `website=https://growimo.app`.
Schalter danach **EIN** (`aria-checked=true`, „Markenprofil verwenden: EIN", localStorage `growimo_brand_profile.enabled` implizit true, kein `enabled:false`).
Nachweis-Screenshot: **`/home/team/shared/e2e-testA-01-brandprofil-ein.png`** (Metadaten: 5 von 5, Toggle EIN, „Markenprofil gespeichert", Toggle-Hinweis „Markenprofil liefert Kontext (Ton, Fakten) — deine Eingabe hat trotzdem Vorrang.").

**Lauf:** `/app/generate/pinterest?idea=Growimo` → Precheck vor Klick: `idea=Growimo disabled=false banner=5 von 5 Generierungen verbleibend`
→ Klick auf „✨ Pinterest-Content generieren" → `CLICKED`. Ergebnis-Ansicht nach ~60–90 s (Poll-Marker).
Screenshot Ergebnis: **`/home/team/shared/e2e-testA-02-ergebnis.png`** (Badge „GENERIERT", Ideenfeld „Growimo", Badge „Markenprofil aktiv", Toggle EIN).
Roh-Extraktion der gerenderten Ergebniskarte (innerText): `/tmp/A-result.json` (LEN 3681 Zeichen).

**Assertions (Textkörper der Ergebniskarte):**
| Prüfung | Ergebnis |
|---|---|
| `REQUIRE(/Growimo/)` | **true** — Growimo ist thematisiert |
| `FORBID(/Growimo/)` | FOUND (erwartet in Test A) |
| metrische Behauptungen (`% / Kunden / Nutzer / Abonnenten / Umsatz / € / 1.000+`) | **NONE** — Metric-Guard hält (keine erfundenen Kennzahlen) |
| Struktur vollständig | 10/10 Abschnitte (SEO Pin-Titel, Pin-Beschreibung, Fokus-Keywords, Hashtags, CTA, Designempfehlung, Pin-Kategorie, Bildkonzept, KI-Bild-Prompt EN, Alt-Text) |
| Score-Pipeline | 84/100 (Titel 89 · Keywords 66 · CTA 79 · Bild 100 · Länge 100 · Relevanz 70) |

**Wörtliche Ausschnitte des generierten Contents:**
- SEO Pin-Titel: „Diesen Growimo-Trend lieben gerade ALLE — verpasse ihn nicht"
- Pin-Beschreibung: „Kennst du das Gefühl, wenn du ein Tool findest, das deinen Arbeitsalltag revolutioniert? Stell dir vor, du nutzt Growimo und plötzlich wird alles klarer, organisierter und effizienter. … Growimo ist dein digitaler Helfer für mehr Struktur und Produktivität."
- Call to Action: „Entdecke Growimo — bevor dein Alltag im Chaos versinkt!"
- Alt-Text: „Ein Laptop zeigt die Growimo-App auf einem ordentlichen Schreibtisch, sanftes Morgenlicht strahlt herein."

**Bewertung:** Der Growimo-Fall bleibt korrekt (die 4.2-Regel „Growimo nur bei eindeutigem Growimo-Kontext" schlägt hier nicht fälschlich zu), der Markenblock wirkt als Stil-/Faktenrahmen, kein erfundenes Zahlenmaterial.
**Weicher Befund (kein FAIL, für den Lead):** Da das Markenprofil nur Name + Website enthält, erfindet das Modell eine
Produkt-Identität („digitaler Helfer für Struktur und Produktivität", Pin-Kategorie „Technologie") statt der echten
Funktion (KI-Marketing-Entscheidungsmaschine). Es sind keine Zahlen/Nutzerdaten erfunden — aber die inhaltliche
Produktbeschreibung ist nicht durch das gespeicherte Profil gedeckt. Option: `offerings` im Profil verlangen oder
im Prompt auf „keine Produktbeschreibung erfinden, wenn keine Fakten vorliegen" verdichten.

---

## Test B — Markenprofil AUS, Pinterest-Idee „kleines Café in Hamburg" → **PASS**

**Setup:** `/app/brand` → Schalter geklickt: `BEFORE=true` → `after=false`, UI „Markenprofil verwenden: **AUS**",
`localStorage.growimo_brand_profile = {enabled:false, brandName:"Growimo", website:"https://growimo.app"}` ⇒ **Profil bleibt gespeichert** (nur deaktiviert).
Screenshot: **`/home/team/shared/e2e-testB-01-brandprofil-aus.png`**.

**Lauf:** `/app/generate/pinterest?idea=kleines%20Caf%C3%A9%20in%20Hamburg` → Precheck: `idea=kleines Café in Hamburg
disabled=false banner=4 von 5 Generierungen verbleibend brandEnabled=false brandName=Growimo` → `CLICKED`
→ Ergebnis nach ~12 s (Poll 2: `GEN=YES len=3714`).
Screenshot Ergebnis: **`/home/team/shared/e2e-testB-02-ergebnis.png`**. Roh-Extraktion: `/tmp/B-result.json` (LEN 3714).

**Assertions (Textkörper der Ergebniskarte, NICHT die UI-Seite):**
| Prüfung | Ergebnis |
|---|---|
| `REQUIRE(/Café/)` | **true** — Ergebnis ist Café-Inhalt |
| `FORBID(/Growimo/)` | **NOT_FOUND_OK** — „Growimo" kommt im generierten Content **0×** vor |
| metrische Behauptungen | **NONE** |
| Profil weiterhin gespeichert | ja (`brandName=Growimo`, `website=growimo.app`, Zustand AUS) |

**Wörtliche Ausschnitte des generierten Contents:**
- SEO Pin-Titel: „Dieses Café in Hamburg musst du besuchen — Geheimtipp für Genießer"
- Pin-Beschreibung: „Hast du schon den neuen Geheimtipp unter den Cafés in Hamburg entdeckt? Ein kleines Café, das mit seinem einzigartigen Charme und den köstlichen Kaffeespezialitäten überzeugt. … Speichere diesen Tipp für deinen nächsten Hamburg-Besuch! ☕️"
- CTA: „Entdecke Hamburgs charmantestes Café — verpasse diesen Geheimtipp nicht!"
- Alt-Text: „Einladendes Café in Hamburg mit Cappuccino und Kuchen auf einem Holztisch, warme Atmosphäre."
- Score 84/100 (Titel 89 · Keywords 66 · CTA 79 · Bild 100 · Länge 100 · Relevanz 70)

**Bewertung:** Die Owner-Beschwerde „Markenprofil überschreibt Nutzereingaben" ist für den AUS-Fall behoben:
Unternehmensmarke komplett aus dem Output entfernt, Nutzerthema vollständig erhalten.
**Nebenbeobachtung (Positiv-Beleg Phase 1/C3):** Beim Öffnen mit `?idea=` erschien der Hinweis „Entwurf wiederherstellen"
(der alte Draft „Growimo" wurde korrekt als überstimmt markiert und nicht verwendet).

---

## Test E — Pinterest-Idee „Weihnachts-Pin" (Markenprofil **EIN**) → **PASS**

**Verschärfung gegenüber dem Fix-Plan:** Test E wurde bewusst mit **Markenprofil EIN** gefahren (statt AUS wie am Ende von Test B).
Damit prüft E genau die 4.2-Vorrang-Regel: „Nennt der Nutzer ein anderes Thema als die Marke, IST genau das das Thema".
Setup: Schalter wieder eingeschaltet (`BEFORE=false` → `after=true`, UI „Markenprofil verwenden: **EIN**",
`lsEnabled=true`, `brandName=Growimo`, `website=https://growimo.app`).
Screenshot: **`/home/team/shared/e2e-testE-01-brandprofil-wieder-ein.png`**.

**Lauf:** `/app/generate/pinterest?idea=Weihnachts-Pin` → Precheck vor Klick:
`idea=Weihnachts-Pin disabled=false banner=3 von 5 Generierungen verbleibend brandEnabled=true brandName=Growimo`
→ `CLICKED` → Ergebnis nach ~12 s (Poll 2: `GEN=YES len=3613`).
Screenshot Ergebnis: **`/home/team/shared/e2e-testE-02-ergebnis.png`**. Roh-Extraktion: `/tmp/E-result.json` (LEN 3613).

**Assertions (Textkörper der Ergebniskarte):**
| Prüfung | Ergebnis |
|---|---|
| `REQUIRE(/Weihnacht/)` | **true** — weihnachtlicher Inhalt |
| `FORBID(/Growimo/)` | **NOT_FOUND_OK** — kein Growimo-Marketing im generierten Content (0 Treffer), **obwohl das Markenprofil aktiv ist** |
| metrische Behauptungen | **NONE** |
| Profil-Zustand EIN | `brandEnabled=true` (localStorage) |

**Wörtliche Ausschnitte des generierten Contents:**
- SEO Pin-Titel: „Diesen Weihnachtsdeko-Trick lieben gerade ALLE auf Pinterest"
- Pin-Beschreibung: „Stell dir vor: Dein Zuhause strahlt in festlichem Glanz und jeder Besucher ist beeindruckt! Weihnachtsdeko muss nicht kompliziert sein — mit diesem einfachen Pin wird's kinderleicht. … Mach dein Zuhause zur Weihnachtswunderwelt. 🎄"
- Fokus-Keywords: „Weihnachtsdeko Ideen, festliche Dekoration, kreative Weihnachten, gemütliche Weihnachtsatmosphäre, DIY Weihnachtsdeko, weihnachtliches Zuhause …"
- Hashtags: „#Weihnachten #DIYWeihnachtsdeko #FestlicheDekoration #Winterzauber #KreativeWeihnachten #GemütlichesZuhause #Weihnachtszauber …"
- Score 85/100 (beste der drei Läufe)

**Bewertung:** Der stärkste Beleg der Kontexttreue-Phase: selbst bei aktivem Markenprofil „Growimo / growimo.app" wird ein
Nutzer-Thema (Weihnachts-Pin) nicht in Growimo-Marketing umgedeutet und die Marke taucht **nirgends** im Output auf.

---

## Zusammenfassung Phase 5a (A/B/E)

| Test | Ergebnis | Kern-Beleg | Zähler (DB) |
|---|---|---|---|
| A — Markenprofil EIN, Idee „Growimo" | **PASS** | Growimo korrekt thematisiert, 10/10 Abschnitte, Score 84/100, keine erfundenen Kennzahlen | 0 → 1 |
| B — Markenprofil AUS, Idee „kleines Café in Hamburg" | **PASS** | `!output.includes("Growimo")` erfüllt, Café-Inhalt, Profil bleibt gespeichert (AUS) | 1 → 2 |
| E — Idee „Weihnachts-Pin", Markenprofil EIN | **PASS** | weihnachtlicher Pin, 0× „Growimo" im Output trotz aktivem Markenprofil | 2 → 3 |

**Alle drei Läufe: echte UI-Klicks + echte OpenAI-Generierung auf www.growimo.app, Repo-Stand 72fc4cb, kein Deploy, keine Code-Änderung, Owner-Konto unberührt.**
Tests C/D/F (TikTok, Bild-Studio, Android-Reload) waren **nicht** Teil der 5a-Delegation; Teillauf 5b (Test C) und 5c (Tests D/F) sind unten dokumentiert.

**Neue UX-/Produktfunde aus diesem Lauf (für die 8.4d-Sammlung, ohne Fix in diesem Auftrag):**
1. (P3) Usage-Banner aktualisiert sich nach einer abgeschlossenen Generierung nicht (zeigt „5 von 5", obwohl serverseitig 1 verbraucht ist); erst Routenwechsel/Fokus lädt neu.
2. (P3) Bei Markenprofil mit nur Name+Website erfindet das Modell eine Produkt-Identität (Growimo als „Produktivitäts-Tool", Pin-Kategorie „Technologie") — nicht durch Profilfakten gedeckt (keine Zahlen erfunden, Metric-Guard hält).
3. (P2, kein Fehler, aber Copy) Alle drei Pinterest-Ergebnisse öffnen mit dem identischen Hype-Muster „… lieben gerade ALLE …" (Test A/E) bzw. „…musst du besuchen" (B) und landen exakt bei Score 84/100 (A/B) bzw. 85/100 (E) — Titel/Keywords-Scores identisch (89/66). Über Tests hinweg wirkt der Generator templatig; kein Abnahmekriterium verletzt, aber Diversität zwischen Läufen ist gering.

**Hinweis zur Screenshot-Aussage:** Die Beleg-Screenshots zeigen den oberen Viewport der jeweiligen Live-Seite
(Toggle-Zustand inkl. Badge „Markenprofil aktiv/aus", das Ideenfeld mit der Testeingabe und den Zähler im Header);
die Ergebnis-Karte liegt darunter („unter dem Falz") und wurde nicht mitgescrollt. Die inhaltlichen Assertions stützen sich
deshalb auf die per JS aus der gerenderten Ergebniskarte extrahierten `innerText`-Fassungen (`e2e-test*-content.json`), nicht auf die Pixel.

**Rohdaten (im Team-Share abgelegt):** `/home/team/shared/e2e-testA-content.json`, `e2e-testB-content.json`,
`e2e-testE-content.json` (jeweils die per JS aus der Ergebniskarte extrahierte `innerText`-Fassung des generierten Contents)
sowie die fünf Screenshots `e2e-testA-01-brandprofil-ein.png`, `e2e-testA-02-ergebnis.png`,
`e2e-testB-01-brandprofil-aus.png`, `e2e-testB-02-ergebnis.png`, `e2e-testE-01-brandprofil-wieder-ein.png`,
`e2e-testE-02-ergebnis.png`.
**Reproduktion:** Hilfsskripte (untracked): `scripts/_abnahme-setup.ts` (synthetischer Clerk-User + Beta-Approval + Sign-in-Token),
`scripts/_abn-usage.ts` (DB-Zähler), Poll-/Extraktions-JS unter `/tmp` (Marker-Erkenntnis: `span.textContent` liefert „Generiert",
`innerText` „GENERIERT" — Poll **immer** auf `textContent === "Generiert"`, sonst läuft die Schleife bis zum Timeout).

---

## Teillauf 5b — Test C: TikTok-Konzept (2 Generierungen) — PASS

Konto: synthetisches Pro-Konto **E2E CDBot** (Clerk `user_3JZ1X21pNidksnLIqznjqXzGQoN`, `subscriptions.plan_tier=pro`, `status=active`),
Live-App `https://www.growimo.app/app/tiktok`, Repo-Stand 90b0ab5, echte UI-Klicks + echte LLM-Generierung, kein Deploy, keine Code-Änderung.

| Lauf | Eingabe (Was machst/verkaufst du) | Ergebnis-Marker | Assertions | DB-Zähler (`usage_monthly.count`) nach dem Lauf |
|---|---|---|---|---|
| C1 | „personalisierte Tasse" | h2 **„Video-Idee"** vorhanden, 17 Ergebnisfelder, Textlänge 6802 | **15/15 Checks true**, 4 Hashtags, Zeitmarken vorhanden | 1 |
| C2 | „minimalistischer Schmuck" (+ Thema „minimalistischer Schmuck") | h2 **„Video-Idee"** vorhanden, Textlänge 8683 | **15/15 Checks true**, 5 Hashtags, 5 Zeitmarken (0-2s / 2-6s / 6-10s / 10-12s / 12-15s), 0 Platzhalter, 0 Filler | 2 |

Geprüfte Marker (je Lauf): Hook, Scroll-Stop-Moment, Szenenplan mit ≥2 Zeitangaben, Texteinblendungen, Sprechtext/Voice-over,
Spannungsbogen, Caption, Hashtags (≤5), Videolänge, Video-Format, keine `[…]`-Platzhalter, keine Filler-Formulierungen
(„hier einfügen", „Sound einfügen" …), „Warum"-Erklärung, Bild-/Videoideen fürs Studio, Aufnahme-Anleitung.
Rohwerte: `e2e-testC-assertions.txt` (vollständige Check-Liste + Fakten) und die per JS aus der Ergebniskarte extrahierten
`innerText`-Fassungen `e2e-testC-content-01-tasse.json` / `e2e-testC-content-02-schmuck.json`.
Die Konzepte sind konkret filmbar (C2: Szene 0-2s Hook „So stylst du deinen Alltag!", 12-15s finaler Look im Spiegel,
Videolänge 15 Sekunden, Titel „3 Schmuckstücke für den perfekten Look", CTA „Wie stylst du deinen Alltag?"),
ohne erfundene Nutzerzahlen oder Testimonials.

**Ergebnis: Test C = PASS** (2/2 Konzepte inhaltlich vollständig, je 1 Generierung pro Konzept, kein Retry-Verbrauch).

**Wiederholter UX-Fund (P3, bereits aus 5a bekannt — Fund 1):** Der Usage-Banner der Werkstatt zeigte nach **beiden**
Generierungen unverändert „200 von 200 Generierungen verbleibend", obwohl der DB-Zähler danach 2 war; korrekt lädt die
Anzeige erst bei Seitenwechsel/Reload. Direkt nach einer Generierung ist die Rest-Anzeige also irreführend hoch.

**Screenshots:** `e2e-testC-01-werkstatt-pro.png` (Werkstatt als Pro-Konto, Banner-Stand, Eingabefelder),
`e2e-testC-03-ergebnis-schmuck.png` (C2-Ergebnis mit h2 „Video-Idee").

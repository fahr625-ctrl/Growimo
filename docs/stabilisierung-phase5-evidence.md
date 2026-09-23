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

---

# Stabilisierung Phase 5b — E2E-Abnahme C/D/F auf www.growimo.app

**Datum:** 2026-09-20 · **Autor:** engineer · **Ziel:** https://www.growimo.app (LIVE, kein Deploy, kein Produktionscode geändert)
**Auth:** Clerk-Sign-in-Token auf dem App-Origin (Skill `clerk-signin-token-browser-e2e`), **synthetischer Testnutzer** — Owner-Konto unberührt.
**Testnutzer (NEU angelegt für C/D/F):** `user_3JZ1X21pNidksnLIqznjqXzGQoN` (`e2e-abn2-8wqw77@ctomail.io`), users-UUID `0ac63bb3-9f32-41b7-b31e-03881daab276`, beta_signups approved.

## 0. Kontingent-Entscheidung (dokumentiert)
Das A/B/E-Konto hatte nur noch 2 von 5 Generierungen — für C (2) + D (3) zu wenig. Entscheidung: **neues synthetisches Konto + Pro-200-Seed über die ECHTE Verdrahtung**
(`INSERT INTO subscriptions (plan_tier='pro', status='active')` → `qGetPlanTier` → `getSubscriptionStatus` → Usage-Guard). Nachweis auf der LIVE-Site: Usage-Banner zeigt nach Reload
**„200 von 200 Generierungen verbleibend"** (vorher, unmittelbar nach Sign-in, „5 von 5") — d. h. der Pro-Status kommt über die App-Verdrahtung an, nicht nur aus der DB.
Scripts (untracked, im Repo): `scripts/_abn2-setup.ts` (Clerk-User + Beta-Approval + Sign-in-Token), `scripts/_abn2-pro.ts` (Pro-Seed, prüft clerk_id gegen abn2-meta.json), `scripts/_abn2-assert-c.ts` (Content-Assertions).

## Zähler-Beweise (autoritativ: DB `usage_monthly`, user_id `0ac63bb3-…`)
| Zeitpunkt | UI-Banner | DB `usage_monthly.count` |
|---|---|---|
| nach Sign-in (Free, vor Pro-Seed) | 5 von 5 | 0 (keine Zeile) |
| nach Pro-Seed + Reload | **200 von 200** | 0 |
| vor Test C | 200 von 200 | 0 |
| nach Test C (2 Konzepte) | 200 von 200 (stale) | **2** |
| Studio-Deeplink nach C | **198 von 200** | 2 |
| nach Test D (3 Bilder) | s. Rohlogs | s. Rohlogs (`/home/team/shared/e2e-testDF-rawlogs.txt`) |

 Genau 1 Generierung je Konzept bzw. je Bild; der Wechsel TikTok→Studio erzeugt **keine** neue TikTok-Generierung.

## Test C — TikTok-Werkstatt (Konzept), 2 Ideen → **PASS**
Ideen: (1) **„personalisierte Tasse"** als Unternehmen/Produkt + Karte 🎬 „TikTok erstellen"; (2) **„minimalistischer Schmuck"** in Unternehmen-Feld UND Thema-Feld.
Rohdaten: `/home/team/shared/e2e-testC-content-1-tasse.json`, `e2e-testC-content-2-schmuck.json`, Assertions: `/home/team/shared/e2e-testC-assertions.txt`.
Screenshots: `e2e-testC-01-werkstatt-pro.png` (Werkstatt mit Banner 200/200, sichtbar), `e2e-testC-02-ergebnis-tasse.png`, `e2e-testC-03-ergebnis-schmuck.png`.

**Assertions (Ergebniskarte, 17 Felder je Lauf) — alle 15 Prüfungen true (beide Läufe):** Hook vorhanden · Scroll-Stop-Moment vorhanden · Szenenplan mit ≥2 Zeitmarken (je 5: 0-2s/2-6s/6-12s/12-18s/18-20s bzw. …/12-15s) · Texteinblendungen vorhanden · Sprechtext vorhanden · Spannungsbogen vorhanden · Caption vorhanden · **Hashtags 4 bzw. 5 (≤5 ✓)** · Videolänge empfohlen (20 s / 15 s) · Video-Format angegeben · **KEINE Platzhalter `[ … ]`** · keine Filler-Formulierungen (kein „hier einfügen", „[Trendigen Sound", „[Hier…") · „Warum" vorhanden · Bildideen vorhanden · Aufnahme-Anleitung vorhanden.
Wörtlich (Idee 1): Hook „Hast du auch eine langweilige Tasse im Schrank?" · Caption „Mach aus deiner alten Tasse ein individuelles Kunstwerk! #DIY #Personalisierung" · CTA „Teile dein Tassenprojekt mit uns!".
Wörtlich (Idee 2): Hook „So stylst du deinen Alltag mit nur 3 Schmuckstücken!" · Spannungsbogen „… Der Payoff liegt in der 12. Sekunde, wenn der fertige Look gezeigt wird." · Hashtags „#Minimalismus #Schmuckliebe #StilTipps #FashionInspo #EinfachSchick" · CTA „Wie stylst du deinen Alltag? Teile deine Tipps!".
Bewertung: Zielgruppen-Perspektive, Produkt nicht automatisch Mittelpunkt, keine erfundenen Kennzahlen, keine Platzhalter — Qualität wie `todayIdea`.

## Test D + F — Rohbelege **(Zwischenstand mitten im Lauf, ÜBERHOLT — maßgeblich ist „Teillauf 5c" unten)**
Die vollständigen Laufprotokolle (jeder Schritt, jede Poll-Zeile, jeder Zähler-/Assertion-Zustand) liegen als
**`/home/team/shared/e2e-testDF-rawlogs.txt`** im Team-Share; Screenshots `e2e-testD-*.png` / `e2e-testF-*.png` (soweit erzeugt).
Kernbelege Test D (aus dem Protokoll): Studio-Prompt kommt aus der **sessionStorage-Persistenz** des TikTok-Ergebnisses (Phase 3.3b),
Studio öffnet mit vorbefülltem Prompt (111 Zeichen), Zähler-Banner im Studio **„198 von 200"** (= C verbraucht 2), Bild 1 wurde erzeugt (Galerie `IMGS=1`), keine Fehler-/Timeout-Banner, kein Dauer-„Generiert…".
**Zwischenstand-Hinweis (2026-09-19, überholt):** Dieser Absatz stammt mitten aus dem Lauf („D war beim Stand Bild 1 erzeugt, F noch nicht gestartet") und ist durch die Artefakt-Auswertung unten korrigiert: **D und F wurden tatsächlich weiter gefahren** (Screenshots bis `e2e-testD-10`, sechs F-Screenshots, DB-Zähler 7) — Ergebnis, Belege und Grenzen stehen im Abschnitt **„Teillauf 5c — Test D/F"**. Beide Läufe sind dort als **TEILWEISE** dokumentiert (u. a. weil der zweite D-Anlauf und der Bereichswechsel in F in den Vercel-Bot-Checkpoint liefen).

---
## Teillauf 5c — Test D: Bild-Studio (Prompt-Vorbefüllung, Galerie, Rückweg) — **TEILWEISE**
Konto: synthetisches Pro-Konto **E2E CDBot** (Clerk `user_3JZ1X21pNidksnLIqznjqXzGQoN`, `subscriptions.plan_tier=pro`, `status=active`),
Live-App `https://www.growimo.app`, Repo-Stand 90b0ab5 / 11b5c95, echte UI-Klicks + echte OpenAI-Bildgenerierung, kein Deploy, keine Code-Änderung.
**Szenario (aus den Rohdaten rekonstruiert):** Von der TikTok-Werkstatt (Ergebnis C2 „minimalistischer Schmuck") über die Bildidee ins
KI-Bild-Studio → Prompt vorbefüllt generieren (Bild 1) → Browser-Zurück zur TikTok-Werkstatt → Browser-Vorwärts zurück ins Studio
→ Bild 2 generieren → über die zweite Bildidee („Lifestyle-Foto …") Bild 3 anstoßen.
**Rohdaten:** `/home/team/shared/e2e-testDF-rawlogs.txt` (Zustands-JSON je Schritt), Screenshots `e2e-testD-00 … e2e-testD-10`.

### Belegte Fakten (nur aus Artefakten)
| Schritt | Artefakt | Belegter Fakt |
|---|---|---|
| D0 TikTok-Ausgang | `e2e-testD-00-tiktok-ausgang.png` | Ausgangslage: TikTok-Ergebnis/Werkstatt vorhanden |
| D1 Prompt-Vorbefüllung | `e2e-testD-01-studio-prefill.png` (21:42) | Studio öffnet mit vorbefülltem Prompt (Klick auf die Bildidee des TikTok-Ergebnisses) |
| D2 Bild 1 | `e2e-testD-02-bild1.png` (21:44) | Studio mit Prompt „Produktfoto, minimalistischer Stil, weiches Licht, Fokus auf ein einzelnes Schmuckstück…", Banner **„198 von 200"**; das Bild selbst liegt unter dem Falz (nicht im Viewport) |
| D3 Zurück zur TikTok-Werkstatt | `e2e-testD-03-zurueck-tiktok.png` (21:44) | **TikTok-Idee noch da:** Seite „TikTok-Werkstatt" mit „Zuletzt erstellt" und **beiden** C-Konzepten („Ein schnelles Tutorial, wie man mit minimalistischem Schmuck den perf…" · „Wie man eine langweilige Tasse in ein persönliches Statement verwand…"), Banner 197 |
| D4 Vorwärts zurück ins Studio | `e2e-testD-04-zurueck-im-studio.png` (21:45) + Roh-Zustand | Prompt **vorbefüllt** (`promptLen=111`) und Link „← Zurück zur TikTok-Idee" sichtbar; URL `/app/image-studio?prompt=Produktfoto%2C+…`; **`galleryImgs=0`** |
| D5 Bild 2 | `e2e-testD-05-bild2.png` (21:47) + Roh-Zustand | Nach Klick: **`galleryImgs=1`, `imgSrcPrefixes:["data:image/png;base64,iVBORw0KGgoAAAANSUhEUg"]`** ⇒ 1 fertiges Bild (PNG data-URL) liegt in der Galerie; kein Fehlerbanner (`errBanner:"none"`), Banner 197 |
| D5b Bild 3 | `e2e-testD-06-bild3.png` (21:50) + Roh-Zustand | Klick auf die zweite Bildidee („Lifestyle-Foto, natürliche Beleuchtung, Person legt eine schlichte Kette an…"): **Generierung lief noch** (Button „Generiere Bild…" mit Spinner + „Abbrechen"), Banner 194, **kein Fehler**; ``"D_end laedt=false generiere=true err=false len=678"`` — Bild 3 ist im letzten Zustand **nicht als fertig belegt** |
| Galerie nach Navigation | Roh-Zustand D4 + `e2e-testD-09-zurueck-tiktok.png` (22:00) | Siehe Fund unten: Galerie ist **nicht navigationsfest** |

### Fund 3 „Galerie nicht navigationsfest" — hier konkret belegt (P2, NICHT gefixt)
1. **Roh-Zustand D4:** Nach Browser-Zurück (TikTok) und -Vorwärts (Studio) meldet die Seite `galleryImgs=0`, obwohl im selben
   Lauf bereits ein Bild erzeugt wurde (`imgSrcPrefixes` mit PNG-data-URL in D5) — die zuvor erzeugten Bilder sind weg.
2. **Screenshot `e2e-testD-09-zurueck-tiktok.png`** (Aufnahme 22:00, Dateiname und Bildinhalt passen nicht zusammen — siehe Hinweis unten)
   zeigt das KI-Bild-Studio mit Banner **„193 von 200"** und dem expliziten Leerzustand
   **„Noch keine Bilder generiert. Gib einen Prompt ein und klicke auf Generieren."** ⇒ 7 verbrauchte Generierungen, 0 sichtbare Bilder.
3. **Ursache im Code (nur Mechanik, keine Änderung in diesem Auftrag):** `src/routes/app/image-studio.tsx:100`
   (`const [images, setImages] = useState<GeneratedImage[]>([])`) — die Galerie lebt ausschließlich im Component-State;
   `strategy-image.ts`/`last-result.ts`/`tiktok-recent.ts` persistieren nur Prompt-Vorbelegung bzw. TikTok-Ergebnisse in `sessionStorage`,
   **die Bildgalerie hat keinerlei Persistenz**. Jeder Routenwechsel/Reload leert sie ⇒ bezahlter Output ist nicht wiederauffindbar.
**Nicht fixen:** Entscheidung liegt beim Lead (Auftragsvorgabe).

### „3 Bilder erzeugt" — nur teilweise belegt
- Der **zweite D-Anlauf** (`e2e-testD-6-bild1.png` 21:54, `e2e-testD-7-bild2.png` 21:57, `e2e-testD-8-bild3.png` 22:00) ist **kein Bild-Beleg**:
  alle drei Dateien sind **byte-identisch** (md5 `0cb3ed7b642ef0b36344f05b8b1cbace`) und zeigen die
  **Vercel-Security-Checkpoint-Seite „Failed to verify your browser — Code 21"**.
- Der Poll-Rohblock `--- DF-poll ---` zeigt während des Laufs mehrfach `IMGS=2 loading=true`, ab Poll 14 aber
  `NOSEC len=8678 url=/app/tiktok` (die Seite war zwischenzeitlich auf `/app/tiktok`) und danach `IMGS=0` — d. h. der Lauf wurde
  mitten in der Generierung durch den Seitenwechsel/Bot-Checkpoint unterbrochen. **Interpretation nicht verifiziert.**
- **Nicht verifiziert:** dass Bild 1, 2 und 3 jeweils fertig gerendert wurden (nur: generiert = 1 Bild als data-URL belegt,
  Bild 3 lief noch, kein Fehlerbanner); ebenso die vollständige Zuordnung aller Verbrauchseinheiten (siehe Zähler).

### Hinweis zur Datei-/Inhalt-Zuordnung (Dokumentationsfehler, kein App-Fehler)
Die beiden letzten Aufnahmen passen inhaltlich **nicht** zu ihren Dateinamen: `e2e-testD-09-zurueck-tiktok.png` zeigt das
**Bild-Studio** (leerer Prompt-Platzhalter, leerer Galerie-Zustand, Banner 193), `e2e-testD-10-zurueck-studio.png` zeigt die
**TikTok-Werkstatt** („Zuletzt erstellt" mit beiden Konzepten „Vor 20m"/„Vor 21m", Banner 193). Beide Belege sind oben nach
**Bildinhalt** ausgewertet, nicht nach Dateiname.

---

## Teillauf 5c — Test F: Mobile-/Android-Verhalten (Zurück, Reload, Bereichswechsel) — **TEILWEISE**
**Setup (Rohdaten):** `vp=393x851 ua=true` (Android-Simulation, 393×851 Viewport, Mobile-User-Agent) — F0 „✓ Done".
**Szenarien der 6 Screenshots (aus Rohlog + Pixel):**
| # | Szenario | Roh-Zustand | Pixel-Beleg | Bewertung |
|---|---|---|---|---|
| F1 | TikTok-Werkstatt im mobilen Viewport mit vorhandenem Ergebnis | `url=/app/tiktok hasVideoIdee=true recent=true laedt=false spin=0 len=8679` | `e2e-testF-01-mobil-tiktok-ergebnis.png` (mobiles Layout, Zähler „193 von 200", TikTok aktiv) | **PASS** — rendert, kein leerer Screen, keine Lade-Schleife |
| F2 | Browser-Zurück aus der Werkstatt | `url=/app/image-studio laedt=false spin=0 len=716 hasImageStudio=true hasVideoIdee=false` | `e2e-testF-02-mobil-zurueck.png` (mobiles Studio, „← Dashboard  ← Zurück zur TikTok-Idee") | **PASS** — Zielseite gerendert, kein Spinner |
| F3 | Reload mitten im Flow | `F3 1 "laedt=false len=716 hasVideoIdee=false recent=false spin=0"` | `e2e-testF-03-mobil-reload.png` | **TEILWEISE** — Datei ist **byte-identisch** zu F-02 (md5 `f09ec7f6bac7c751f69a57f78447fe2c`): der Reload erzeugt weder Blank- noch Lade-Schleife, liefert aber keinen eigenständigen Beleg (Aufnahme nicht von F-02 trennbar) |
| F4 | Bereichswechsel Dashboard → Image-Studio | `url=/app/image-studio laedt=false len=107 willkommen=false dash=false` | `e2e-testF-04-mobil-dashboard.png` = **„We're verifying your browser"** (Vercel Security Checkpoint, Spinner) | **NICHT VERIFIZIERBAR** |
| F5 | Bereichswechsel → Image-Studio/TikTok | `len=117 gallery=false` | `e2e-testF-05-mobil-studio.png` = **„Failed to verify your browser — Code 21"** (byte-identisch zu `e2e-testD-05-studio-prefill.png`) | **NICHT VERIFIZIERBAR** |
| F6 | Zurück zur TikTok-Werkstatt mobil | `url=/app/tiktok laedt=false hasVideoIdee=false recent=false spin=0 len=117` | `e2e-testF-06-mobil-zurueck-tiktok.png` = **Checkpoint „Code 21"** | **NICHT VERIFIZIERBAR** |
**Warum nicht verifizierbar:** Ab F4 fing die Bot-Abwehr der Live-Domain jede weitere automatisierte Navigation ab (`len=107/117` =
Checkpoint-Seite, nicht die App). Das ist **kein App-Fehler und kein Produkt-Fund** — es ist eine Grenze der automatisierten
Prüfungsumgebung. Die drei Szenarien „Bereichswechsel Dashboard → Studio → TikTok" und „Reload" bleiben damit offen und müssen
später mit einer nicht-auffälligen Session (frische Sign-in-Token-Session, langsamere Navigation) nachgeholt werden.
**Kein Verbrauch:** Der F-Lauf hat **0 Generierungen** verbraucht (`generation_throttle.last_at` liegt vor dem F-Lauf, siehe Zähler).

---

## Zähler-Wahrheit (DB) — Endstand nach C/D/F
| Größe | Wert | Quelle |
|---|---|---|
| `usage_monthly.count` (Konto `user_3JZ1X21pNidksnLIqznjqXzGQoN`, `period=2026-09`) | **7** | `usage_monthly.updated_at = 2026-09-19T21:50:02.437Z`; erneut gemessen am **2026-09-23 15:28 UTC** via `bun --env-file=.env scripts/_abn-usage.ts user_3JZ1X21pNidksnLIqznjqXzGQoN` → unverändert **7** |
| `generation_throttle.last_at` (letzte Generierung dieses Kontos) | **2026-09-19T21:50:01.844Z** | dito (Rohabfrage 2026-09-23) |
| Aufteilung | C = 2 (dokumentiert) · **D = 5** · F = 0 | C aus 5b; D-Delta aus 7 − 2; F = 0, weil `last_at` der letzten Generierung **vor** dem F-Lauf (21:50–21:51) liegt |
| Banner-Gegenprobe (Pixel) | `e2e-testD-02` 198 → `e2e-testD-04`/`-05` 197 → `e2e-testD-06` **194** → `e2e-testF-01`/`e2e-testD-10` **193** von 200 | Screenshots; 193 = 7 verbraucht ⇒ Banner deckt sich zum Zeitpunkt F-01 mit der DB |
**Ehrliche Einschränkung:** Von den **5** D-Verbrauchseinheiten sind nur **3** durch Artefakte belegt (Bild-1-Klick, Bild-2 mit Bild in der
Galerie, Bild-3 in Ausführung). Die übrigen **2** lassen sich aus den vorhandenen Artefakten keiner einzelnen Aktion zuordnen
(kein eigener Screenshot/State vorhanden — vermutlich Vorab-/Wiederholungsversuche im selben Lauf; **nicht verifiziert**).
Nach `updated_at` wurde **nach 21:50:02Z nichts mehr verbraucht**, d. h. der zweite D-Anlauf (21:54–22:00, Bot-Checkpoint) und der
komplette F-Lauf waren **verbrauchsneutral**.

## Gesamtergebnis Teillauf 5c
| Test | Ergebnis | Kern-Beleg | Was offen bleibt |
|---|---|---|---|
| **D — Bild-Studio** | **TEILWEISE** | Prompt vorbefüllt (D-01/D-04, `promptLen=111`), TikTok-Idee überlebt den Ausflug ins Studio (D-03, D-10), 1 fertiges Bild als PNG-data-URL in der Galerie (D-05-Rohzustand), Bild 3 ohne Fehler angestoßen (D-06) | Bilder 1–3 nicht alle als **fertig** belegt (D-6/7/8 = Vercel-Checkpoint, byte-identisch); Galerie nach Navigation leer (**Fund 3 belegt**); 2 von 5 Verbrauchseinheiten nicht zuordenbar |
| **F — Mobil/Android** | **TEILWEISE** | Mobiler Viewport rendert Werkstatt **und** Studio ohne Leer-Screen/Lade-Schleife (F-01, F-02), Zurück-Link und Zähler vorhanden | Reload nur als Duplikat-Screenshot (F-03 = F-02), Bereichswechsel Dashboard→Studio→TikTok durch Vercel-Bot-Checkpoint abgebrochen (F-04–F-06) |
**Kein Deploy, keine Code-Änderung, Owner-Konto unberührt.** Rohdaten, Screenshots und Zählerabfragen: `/home/team/shared/e2e-testDF-rawlogs.txt`,
`/home/team/shared/e2e-testD-*.png`, `e2e-testF-*.png`, `/tmp/usage-now.txt`, `/tmp/thr2.out`.

---

# 5d — Fix Galerie-Persistenz + Nachtest D/F (2026-09-23)

## 1. Fix „Fund 3: Galerie nicht navigationsfest" (P2 → behoben)

**Ursache (5c-Beleg):** `src/routes/app/image-studio.tsx` hielt die Galerie in einem reinen
`useState([])`. Bei Zurück/Vorwärts/Reload wurde die Route neu gemountet → Galerie leer
(„Noch keine Bilder generiert", `galleryImgs=0`), obwohl die Generierungen verbraucht waren.
Bezahlter Output verschwand.

**Fix:** neues Modul `src/lib/image-gallery.ts` (versionierte sessionStorage-Persistenz nach dem
Muster `~/lib/tiktok-recent` aus 4.3) + Verdrahtung in der Route:
- `readGallery()` beim Mount → Galerie zurück in den State (deckt Reload, bfcache, Zurück/Vorwärts).
- `persistGallery(next)` bei **jeder** neuen Karte in `addImage` (Original-Galerie-State wird über
  `imagesRef` gespiegelt, kein Seiteneffekt im setState-Updater).
- UI: Hinweis-Streifen `data-testid="image-gallery-restored-hint"` + Badge
  `data-testid="image-preview-badge"` auf wiederhergestellten Vorschaubildern (ehrlich statt still).

**Dokumentierte Größen-Entscheidung (sessionStorage-Limit ~5 MB):**

| Frage | Entscheidung |
|---|---|
| Wie viele Bilder persistieren? | `IMAGE_GALLERY_PERSIST_MAX = 3` (die 3 neuesten) — state-Kappung `IMAGE_GALLERY_MAX = 8` bleibt unverändert |
| Warum nicht alles? | 1 Original ist `data:image/png;base64,…` mit gemessen 1,26–2,41 MB PNG ⇒ 1,7–3,2 Mio. Base64-Zeichen (`.run/generated`); 3 Originale sprengen das Limit |
| Was wird gespeichert? | Original, wenn ≤ `IMAGE_GALLERY_ENTRY_MAX_CHARS` (600 000 Zeichen); sonst eine verkleinerte Vorschau (längste Kante 720 px, JPEG q 0,72, typ. 50–120 KB) mit `preview: true` |
| Budget | hartes `IMAGE_GALLERY_PERSIST_BUDGET_CHARS = 3 500 000` Zeichen für die Gesamtnutzlast (unter dem Limit, das sich alle Keys des Origins teilen) |
| Quota-Fallback | `setItem` wirft (QuotaExceededError) ⇒ ältester Eintrag fällt weg und wird erneut geschrieben; passt nicht einmal einer, wird der Schlüssel entfernt (fail-closed, nichts Halbes) |
| Version/TTL | `version: 1` je Aufnahme, fremde/fehlende Version wird IGNORIERT (fail-closed); TTL 12 h |
| Zähl-Semantik | Lesen/Schreiben berührt keinen KI-Pfad (`usage-guard`/`withGenerationGuard`) ⇒ Wiederherstellen = **0 Generierungen** |
| Schema/ContentType | KEIN Eingriff (Konvention 4.3), nur sessionStorage |

Storage-Key (Bundle-Marker): `growimo_image_studio_gallery`.
**Commit:** `85baff6` `feat(image-studio-gallery): persist gallery across navigation (sessionStorage)` → `origin/master`.
**Deployment:** https://site-bq04rw5dq-growimo.vercel.app → Aliased **https://www.growimo.app** (EXIT 0);
Live-Check `/` , `/app`, `/app/image-studio` = **200**.

## 2. Gates (Rohlogs in `/tmp`)

| Gate | Ergebnis | Log |
|---|---|---|
| Neue Suite `stabilisierung-phase43b-test.ts` (89 Checks) | **89 PASS, 0 FAIL, EXIT 0** | `/tmp/p43b.log` |
| Regression 4.3 (`stabilisierung-phase43-test`) | **111 PASS, 0 FAIL, EXIT 0** | `/tmp/stabilisierung-phase43-test.log` |
| Regression 4.1 (`stabilisierung-phase41-test`) | **47 PASS, 0 FAIL, EXIT 0** | `/tmp/stabilisierung-phase41-test.log` |
| Regression 4.2 (`stabilisierung-phase4-test`) | **50 PASS, 0 FAIL, EXIT 0** | `/tmp/stabilisierung-phase4-test.log` |
| 31 `usage-guard-test` | **31 PASS, 0 FAIL, EXIT 0** | `/tmp/usage-guard-test.log` |
| 32 `usage-semantics-test` | **32 PASS, 0 FAIL, EXIT 0** | `/tmp/usage-semantics-test.log` |
| 55 `tiktok-diagnose-v2-test` | **ALLE TESTS BESTANDEN, 0 FAIL, EXIT 0** | `/tmp/tiktok-diagnose-v2-test.log` |
| 56 `stabilisierung-phase3-test` | **85 PASS, 0 FAIL, EXIT 0** (nach Check-Anpassung, s. §4) | `/tmp/p3b.log` |
| `tsc --noEmit` | **171 Fehler = Baseline 171**, Differenz **0** (0 Fehler in den 5d-Dateien) | `/tmp/tsc5d.log` |
| i18n de/en | **1475 = 1475 Schlüssel**, keine fehlenden Schlüssel | in `/tmp/p43b.log` |
| `bash build-vercel.sh` | **EXIT 0** | `/tmp/build5d.log` |

Neue i18n-Keys: `image_studio_gallery_restored_hint` (%s), `image_studio_gallery_preview_badge`,
`image_studio_gallery_preview_hint` (de + en).

## 3. Bundle-Beleg (Methode: Skill `prod-bundle-marker-proof`)

Route-HTML `https://www.growimo.app/app/image-studio` geladen (200), assets gezogen:

| Marker | Fundstelle im ausgelieferten Chunk | Byte-Offset |
|---|---|---|
| `growimo_image_studio_gallery` (neuer Storage-Key, in 5d angelegt) | `assets/image-studio-CRXQDYO_.js` | 1372 |
| `image-gallery-restored-hint` (neuer Test-Anker) | `assets/image-studio-CRXQDYO_.js` | 13983 |
| `image-preview-badge` (neuer Test-Anker) | `assets/image-studio-CRXQDYO_.js` | 15528 |

Chunk: `image-studio-CRXQDYO_.js`, **sha256 `3fa4fb138410c212256e2af88e7b4a72509bbeeef29a086908ff51109698cdc3`**, 18 990 Byte.
Gegenprobe: `diff` der Asset-Listen von `www.growimo.app` und dem Deployment → **leer** (Alias liefert genau dieses Bundle).
Abgrenzung: der Storage-Key existiert vor diesem Commit nirgends im Repo („grep growimo_image_studio_gallery src/ → nur `src/lib/image-gallery.ts`"), er kann also nur über diesen Commit im Bundle sein.

## 4. Angepasster Alt-Check (ehrlich ausgewiesen, keine Verhaltensänderung)

`stabilisierung-phase3-test.ts:265` prüfte den Kappungs-Aufruf per **exakter Textform**
(`capGallery([image, ...prev], IMAGE_GALLERY_MAX)`). Durch den Fix heißt die Zeile
`capGallery<StudioImage>([image, ...imagesRef.current], IMAGE_GALLERY_MAX)` — die Semantik
(Kappung auf `IMAGE_GALLERY_MAX` beim Voranstellen der neuen Karte + Kappungs-Hinweis) ist unverändert.
Der Check prüft diese Semantik jetzt per Regex (beide Formen). Ohne diese Anpassung hätte die Suite
84 PASS / **1 FAIL** gemeldet (`/tmp/stabilisierung-phase3-test.log`) — gemeldet, nicht versteckt.

## 5. Nachtest D und F — **NICHT abgeschlossen (offen)**

In diesem Lauf wurde **Schritt 1 (Fix + Gates + Deploy + Bundle-Beleg) vollständig abgeschlossen**;
für die Nachläufe D (Desktop, 3 Bilder inkl. Galerie nach Browser-Zurück) und F (Mobil Pixel 5,
6 Szenarien) reichte das Session-Budget nicht mehr. Es wurden **keine** Schein-Artefakte erzeugt und
**keine** alten 5c-Screenshots wiederverwendet — es existieren für 5d **keine** neuen
`e2e-testD2-*`/`e2e-testF2-*`-Dateien. D und F sind damit weiterhin **TEILWEISE** (Stand 5c) und
müssen mit frischer Sign-in-Session nachgefahren werden (Ablauf unverändert wie unten beschrieben).

**Vorbereitet und einsatzbereit:** Sign-in-Token-Erzeugung für das synthetische Pro-Konto
(`user_3JZ1X21pNidksnLIqznjqXzGQoN`, DB `usage_monthly.count = 7`, period 2026-09) liegt als
`/tmp/e2e-d-setup.ts` bereit; Zähler-Wahrheit weiterhin per
`bun --env-file=.env scripts/_abn-usage.ts user_3JZ1X21pNidksnLIqznjqXzGQoN`.

**Maßgeblicher Nachfahr-Ablauf (D):** Studio öffnen → 3 Bilder nacheinander erzeugen (je 1
Generierung; Poll auf h2 „Generierte Bilder" + `article img`-Zählung; Screenshot je Bild) → Browser-Zurück
zur TikTok-Werkstatt (Idee bleibt, 4.3) → zurück ins Studio → **Prüfungskern: Galerie zeigt nach dem
Zurück wieder die 3 Bilder** (mit dem Fix: 3 Karten + Hinweis-Streifen `image-gallery-restored-hint`,
Badge `image-preview-badge`) → DB-Zähler vorher/nachher (erwartet 7 → 10).

**Maßgeblicher Nachfahr-Ablauf (F, Mobil „Pixel 5"):** F1 TikTok-Werkstatt mit Ergebnis →
F2 Browser-Zurück → Studio rendert (kein leerer Screen, kein Spinner, keine dauerhafte „Lädt…") →
F3 Reload → Studio mit **wiederhergestellter Galerie** (Fix) → F4–F6 Bereichswechsel
Dashboard→Studio→TikTok je mit frischer Session. Screenshots `e2e-testD2-*`/`e2e-testF2-*`
(die alten 5c-Artefakte NICHT wiederverwenden; `md5sum`-Identitätsprüfung gegen Schein-Artefakte).

**Hinweis auf überholte Abschnitte:** die Abschnitte „Test D + F — Rohbelege" (5b),
„Teillauf 5c — Test D" und „Teillauf 5c — Test F" bleiben als Befund-Historie stehen; der
dort dokumentierte **Fund 3 ist mit diesem Abschnitt behoben**, die D/F-Abnahme selbst ist es nicht.

---

# 5d-Nachtrag — Test D Nachlauf (abgebrochen, ehrlich ausgewiesen)

**Datum:** 2026-09-23, ~15:52–16:02 UTC. **Konto:** synthetisches Pro-Konto
`user_3JZ1X21pNidksnLIqznjqXzGQoN` (users-UUID `0ac63bb3-9f32-41b7-b31e-03881daab276`), `period=2026-09`.

## Belegte Schritte (Rohlog `/tmp/d2run.log`, Artefakte `e2e-testD2-*`)

| Schritt | Beleg | Ergebnis |
|---|---|---|
| Anmeldung ohne Interaktion (Sign-in-Token auf dem App-Origin) | `URL=https://www.growimo.app/app`, `window.Clerk.user.id = user_3JZ1X21pNidksnLIqznjqXzGQoN`; `e2e-testD2-00-dashboard.png` | **PASS** |
| TikTok-Werkstatt betreten + Idee eintragen (ohne Generierung) | `IDEA_SET=Personalisierte Kerze aus Sojawachs`; `e2e-testD2-01-tiktok-idee.png` | **PASS** (0 Verbrauch) |
| Studio per Deep-Link `?prompt=` mit vorbelegtem Feld | `pre={"idea":"Personalisierte Kerze aus Soja","disabled":false}` → `CLICKED` | **PASS** |
| Bild 1 generieren | Poll `imgs=0 spin=1` (6 s, 12 s) → anschließend Läufe blockiert | **Generierung serverseitig bezahlt belegt** |
| **Zähler-Wahrheit (DB, autoritativ)** | `usage_monthly.count` 7 → **8** (per `scripts/_abn-usage.ts`) | **+1 = genau 1 Bild bezahlt** |
| Galerie nach Browser-Zurück (Prüfungskern D) | — | **NICHT ERREICHT** |

## Warum abgebrochen (kein App-Befund)

Der Poll-Aufruf des E2E-Treibers (`agent-browser eval`, der die Galerie-Zählung
`document.querySelectorAll("article img")` liest) **blockierte nach dem 2. Poll** — der Lauf stand ~8 Minuten
ohne neuen Log-Eintrag und wurde abgebrochen. Das ist ein Werkzeug-/Treiber-Hänger des Browser-CLI, **kein
App-Befund**: die Generierung selbst lief durch (DB 7 → 8), der Client wurde nur nicht mehr abgefragt
(`imgs=0 spin=1` = Skeleton sichtbar, Request lief). Es wurde **kein** Schein-Artefakt erzeugt und **keine**
5c-Datei wiederverwendet; für Bild 2/3 existieren keine Screenshots, für die Galerie-Prüfung existiert **kein** Beleg.

## Konsequenz / nächster Schritt

- **Test D: weiterhin TEILWEISE.** Der Prüfungskern („Galerie enthält nach dem Zurück alle 3 Bilder") ist
  **nicht abgenommen**. Nötig: 3 Bilder nacheinander erzeugen, Browser-Zurück → TikTok, zurück ins Studio,
  dort `article img`-Zählung **und** `data-testid="image-gallery-restored-hint"` prüfen; Zähler vorher/nachher
  (erwartet 7 → 10). Empfehlung: Poll **nicht** mit einem pro Schritt gestarteten `agent-browser eval`
  (das war die hängende Stelle), sondern — wenn möglich — die Zählung in den Screenshot-Schritt integrieren bzw.
  nach jedem Bild genau **einen** `eval` ausführen und bei ausbleibender Antwort den Browser-Kontext
  (`pkill -f "agent-browser --session <name>"`) neu aufsetzen.
- **Test F: weiterhin TEILWEISE** (kein Lauf in 5d; Szenarien F1–F6 wie in §5 beschrieben).
- Bereits verbraucht: **1 Generierung** (7 → 8); für D (3) + F bleibt Kontingent (Pro 200).
- Der **Fix selbst** ist davon unberührt belegt: Gates grün (§2), Bundle-Marker live (§3).

---

# 5e — Finale Abnahme D/F (2026-09-23, TEILWEISE — ehrlich ausgewiesen)

**Status: D = TEILWEISE, F = NICHT GELAUFEN.** Der Prüfungskern von D („Galerie zeigt nach dem
Browser-Zurück alle 3 Bilder") ist **nicht abgenommen**. Es wurde **kein** Schein-Artefakt, **kein**
Platzhalter und **keine** alte Datei wiederverwendet: alle in 5e erzeugten Dateien sind neu
(`e2e-testD2-00/-01/-02`, Zeitstempel 2026-09-23 15:57–16:01 UTC) und werden unten einzeln belegt.

## D — belegte Schritte (Konto `user_3JZ1X21pNidksnLIqznjqXzGQoN`, Desktop, frische Sign-in-Session)

| Schritt | Beleg (Rohlog `/tmp/d2run.log`) | Screenshot | Ergebnis |
|---|---|---|---|
| Anmeldung ohne Interaktion (Sign-in-Token auf dem App-Origin) | `STATE url=/app user=user_3JZ1X21pNidksnLIqznjqXzGQoN bodyLen=1101 cp=false` | `e2e-testD2-00-dashboard.png` | **PASS** |
| TikTok-Werkstatt betreten + Idee setzen (**ohne** Generierung) | `IDEA_SET=Personalisierte Kerze aus Sojawachs url=/app/tiktok title=🎵 TikTok-Werkstatt` | `e2e-testD2-01-tiktok-idee.png` (Idee im Feld sichtbar, Banner „192 von 200 verbleibend") | **PASS** (0 Verbrauch) |
| Studio per Deep-Link `?prompt=<Idee>`, Prompt vorbefüllt | `PREFILL len=35 value="Personalisierte Kerze aus Sojawachs" disabled=false fromTikTok=true imgs=0` | — | **PASS** |
| Bild 1 generieren + Galerie prüfen | `CLICKED {"promptLen":35,"disabled":false}` → `GAL imgs=1 arts=1 spin=0 restoredHint=none errs=[] loading_text=false` | `e2e-testD2-02-bild1.png` (Galerie im Bild) | **PASS** (kein Fehler-, kein Timeout-Banner, kein Dauer-„Lädt…") |
| **Zähler-Wahrheit (DB, autoritativ)** | `usage_monthly.count` **8 → 9** nach Bild 1 | — | **+1 = genau 1 Bild bezahlt** |
| Bild 2 | `CLICKED {"promptLen":35,"disabled":false}` gesetzt, Lauf beim Session-Ende noch offen | — | **offen** |
| Bild 3 | — | — | **OFFEN** |
| **Prüfungskern: Browser-Zurück → Werkstatt → zurück ins Studio → Galerie zeigt 3 Bilder** | — | — | **NICHT ERREICHT** |

## F — Mobil „Pixel 5"

**Kein F-Szenario wurde in 5e ausgeführt** (Session-Budget endete nach D-Teil 1). F1–F6 bleiben auf
dem Stand von 5c (`TEILWEISE`); es existieren für 5e **keine** `e2e-testF2-*`-Dateien.

## Warum abgebrochen (Werkzeug-Befund, **kein App-Befund**)

Der Lauf war **nicht** von der Anwendung blockiert, sondern vom Browser-CLI:

- `agent-browser --session d1 wait 45000` („dumb wait") **hängt** und kehrt erst zurück, wenn der
  äußere `timeout` es nach **200 s** abschneidet (`WAIT_FAIL(45000)` im Rohlog) — pro Wartephase
  ~200 s statt 45 s. Damit lief das Session-Budget auf, obwohl die Generierungen durchliefen
  (DB 8 → 9 belegt genau 1 fertiges Bild).
- `agent-browser wait --fn "<js>"` funktioniert dagegen einwandfrei (`true` nach ~1 s im Smoke-Test
  vor Bild 1) → **Wartephasen künftig als `sleep` in der Shell** ausführen, nicht als `wait <ms>`.
- Nach dem Abbruch weiterhin offen: Bild 2/3, Browser-Zurück/Fortschritt, Reload-Gegenprobe,
  DB-Vergleich 9 → 11.

## Einsatzfertige Vorlagen für den Nachlauf (kein Prod-Code, kein Deploy nötig)

- `/tmp/e2e-D.sh` — kompletter D-Fahrplan: Login → TikTok-Idee → Studio-Deep-Link → 3× Bild
  (`article img`-Zählung, Screenshot je Bild) → `back` (Werkstatt) → `forward` → `reload`
  (Gegenprobe frischer Mount) → DB-Zähler. **Fix für den Nachlauf: `w(){ sleep $(( $2/1000 )); }`**
  (in `/tmp/e2e-F.sh` bereits so umgesetzt).
- `/tmp/e2e-F.sh` — F1–F6 auf „Pixel 5" (`set device "Pixel 5"`, Fallback `set viewport 393 851`),
  je Lauf frische Session + frischer Sign-in-Token, `md5sum`-Identitätsprüfung am Ende.
- JS-Sonden: `/tmp/jsD/*.js` (auth, idea, prefill, gen, count, tiktokback, scrollgal, state),
  `/tmp/jsF/*.js` (tiktokgen, tiktokresult, dash, studio, dismiss); Zähler:
  `bun --env-file=.env scripts/_abn-usage.ts user_3JZ1X21pNidksnLIqznjqXzGQoN`.

## Überholte Abschnitte

Die Abschnitte „5c — Teillauf D/F", „5d-Nachtrag — Test D Nachlauf (abgebrochen)" und der
5d-Statusblock werden mit 5e **inhaltlich bestätigt, aber nicht ersetzt**: der dort dokumentierte
Blockgrund (Treiber-Hänger) ist derselbe, jetzt genauer lokalisiert (`wait <ms>`). **Offen bleibt
unverändert:** D-Prüfungskern (Galerie nach Zurück = 3 Bilder) und alle F-Szenarien.
Der **Fix selbst** war bereits in 5d belegt (Gates §2, Bundle-Marker §3) und ist von diesem
Teilabbruch unberührt; 5e liefert zusätzlich den ersten Live-Beleg, dass eine generierte Karte
korrekt in der Galerie landet (`GAL imgs=1`, 0 Fehler).

**Verbrauch 5e:** 1 Generierung (TikTok-Modul 0, Bild-Studio 1) — DB 8 → 9 (Stand beim Abbruch);
Konto unverändert Pro/aktiv.

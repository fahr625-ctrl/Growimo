# Mobile-End-to-End-Test (Stabilisierungspaket, letzter Schritt) — ZWISCHENSTAND

**Status: NICHT abgeschlossen.** Der Pflicht-Ablauf wurde begonnen (Station 1 erledigt, Station 2
vorbereitet), aber aus Budgetgründen vor dem ersten Generierungs-Klick gestoppt. Es wurden
**0 Generierungen** verbraucht — der Nutzer ist also für einen vollständigen Neu-Lauf **voll nutzbar**
(Free = 5). Dieser Zwischenstand ist bewusst so abgelegt, dass ein Folge-Lauf ohne Neu-Anlegen des
Nutzers fortsetzen kann.

Datum: 2026-10-05 · Repo: `/home/team/shared/site` (master) · Ziel: www.growimo.app (live)

## Wegwerf-Nutzer / Werkzeuge (bereits vorhanden, wiederverwendbar)

| Ding | Wert / Pfad |
|---|---|
| Clerk-Testnutzer | `user_3KGLrQivAW698KVoR3vkZoJYMKU` (e2e-autosave-ttmbu@ctomail.io) |
| Beta-Freischaltung | erledigt, `POST /api/beta-signup` → 200, `already:false` |
| Sign-in-Ticket | `/tmp/autosave-ticket.txt` (TTL 3600 s ab Erstellung) |
| Interne User-UUID | `354ebec1-ef4b-4ebd-84b1-69e0a5ac0632` |
| DB-Baseline | `{projectRows:0, contentRows:0, usage:[]}` |
| DB nach Login | `{projectRows:0, contentRows:0, usage:[]}` → **0 von 5 Generierungen verbraucht** |
| Zähler-Skript | `bun --env-file=.env scripts/_autosave-e2e-count.ts user_3KGLrQivAW698KVoR3vkZoJYMKU <label>` |
| Skripte dieses Laufs | `scripts/_mobile-e2e/01-login.sh` (funktioniert), `02-strategie.sh` (Selektor-Fehler, s. u.), `02b-debug.sh` |
| Screenshots | `docs/mobile-e2e/m01-dashboard.png`, `docs/mobile-e2e/m02-strategie-eingabe.png` |

Browser-Session: `agent-browser --session growimo-mobile` (angemeldet, live).
Mobile-Viewport **verifiziert**: `{vw:393, vh:852, dpr:2}` (`agent-browser set viewport 393 852 2`),
`cp:false` (kein Vercel-Checkpoint), `window.Clerk.user.id` = Testnutzer.

## Was VERIFIZIERT ist (mit Beleg)

1. **Mobile-Login ohne Turnstile** auf www.growimo.app im 393×852-Viewport, DPR 2 —
   `docs/mobile-e2e/m01-dashboard.png` (Dashboard mobil, Onboarding-Dialog 1/5 „Willkommen bei
   Growimo!" mit „Später"-Schaltfläche). Probe-Eval: `{url:"/app", uid:"user_3KGL…", bodyLen:1347, cp:false}`.
2. **Baseline-Zähler**: 0/0, keine `usage_monthly`-Zeile (Tabelle wird erst mit erster Generierung angelegt).
3. **Strategie-Eingabeseite erreichbar** mit Idee per Query-Parameter:
   `/app/new-project?idea=Personalisierte%20Bienenwachskerzen%20f%C3%BCr%20Kinder` →
   `#product-idea` enthält die Idee (React-State korrekt), CTA „🚀 Strategie erstellen" ist gefunden,
   aber **disabled**, weil noch kein Inhaltstyp gewählt ist (erwartetes Verhalten, `canGen = idea && types>0`).

## Fund (wichtig für den Folge-Lauf): Label-Namen der Inhaltstyp-Kacheln

Mein Selektor in `02-strategie.sh` suchte `'Marketing-Plan'` / `'Etsy-Eintrag'` — **diese Strings stehen
nicht im DOM**. Der DOM-Button-Dump (`02b-debug.sh`, Scroll ans Seitenende) zeigt die tatsächlich
gerenderten Kacheln:

```
📌Pinterest   📝SEO Blog   🛍️Etsy   📱Social   📧E-Mail   📊Marketing
💡Produkt     📈Trends      🔍Analyse  📊Markt
```

Also: **„📊Marketing"** (= marketing_plan) und **„🛍️Etsy"** (= etsy_listing).
Kachel-Selektor für den Folge-Lauf: Buttons mit `className` beginnend
`relative flex flex-col items-center gap-1.5 rounde…` und Text, der den Label-Teil enthält;
danach `{"ausgewählt"}`-Badge prüfen (`strategy_selected_count`) und CTA `disabled === false`.

## Weiterer Fund (UX, bereits im Business-Plan als P3 notiert)

Auf 393 px ist **die Navigationsspalte volle Breite** (kein Burgermenü): Navigationsliste
(Dashboard … Einstellungen) + Sprachumschalter + Consent-Banner stehen **über** dem Seiteninhalt,
der Formularinhalt beginnt erst bei `scrollY ≈ 1500` (`scrollHeight 2416`).
Konsequenz für E2E: vor jedem Klick `window.scrollTo(0, document.body.scrollHeight)` bzw. direkt per
JS `element.click()` (funktioniert auch off-screen), und das Cookie-/Analytics-Banner
(„Einverstanden"/„Ablehnen") vor Screenshots wegklicken.

## Geplanter Ablauf des Folge-Laufs (Budget 5 Generierungen, exakt aufgehend)

| Station | Aktion | Kosten |
|---|---|---|
| 2 Strategie | `/app/new-project?idea=…` → Kacheln „📊Marketing" + „🛍️Etsy" wählen → „🚀 Strategie erstellen" | 2 |
| 3 A/B-Varianten | Projektseite `/app/projects/<id>` → Etsy-Karte aufklappen → „A/B-Varianten" → 3 Varianten, Einzel-Scores, „Empfehlung"/Delta-Chip prüfen, Texte + Scores in Datei sichern | 1 |
| 4 Übernehmen | „Diese Variante übernehmen" → DB-Beleg: `generated_content` der Etsy-Zeile = übernommene Variante (≠ Original) | 0 |
| 5 Bild aus Strategie | Karte „🎨 Im Image Studio erstellen" (Projektseite, `image_studio_create_from_strategy`) → Studio: Prompt gefüllt, Format gesetzt, Projekt vorausgewählt → **Screenshot VOR dem Generieren** | 0 |
| 6 Upload + Variation | Testbild hochladen → „Variation mit Produkttreue" (`image_studio_upload_variation_btn`), Banner „Produktvorlage aktiv", Ergebnis ohne Fallback | 1 |
| Σ | | **4** (1 Reserve für einen Retry) |

Wichtige Belegquellen (bereits recherchiert):
- `NextActions` (`src/components/NextActions.tsx`) — „🎨 Bild jetzt erstellen" (`image_studio_create_image_now`),
  Kontext via `lib/app-context.ts` + `saveStrategyPrefill`.
- Projektseite: Button-Text **„🎨 Im Image Studio erstellen"** (`image_studio_create_from_strategy`),
  nur wenn `extractStrategyImage()` einen Bildprompt findet → Pinterest/SEO/**Etsy** liefern ihn,
  `marketing_plan` **nicht** (dokumentierte Lücke aus Schritt 3) → deshalb Etsy-Kanal für Station 5 nutzen.
- Varianten = **1** Generierung pro Aufruf (`generateVariantsServer` → `withGenerationGuard`).
- Faktenschutz-Grep-Vorlage: `scripts/_etsy-fakten-grep.ts`.
- Offen zu prüfen: OpenAI-Bildguthaben. Der **lokale** `OPENAI_API_KEY` aus `.env` ist erschöpft
  (HTTP 429 `insufficient_quota`, `credit_balance_exhausted`, `/tmp/oai-check.log`) — die **Production**
  arbeitet mit einem anderen Key (letzte Live-KI-Läufe 2026-10-04 18:39 mit 5 Kanälen in der DB).
  Ob Bild-Aufrufe (`gpt-image-1`) in Production bezahlt sind, ist **nicht** verifiziert.

## Ausdrücklich NICHT behauptet

- Stationen 2–6 sind **nicht** durchgeklickt; es gibt **keine** Belege für Varianten-Differenzierung,
  Scores, Etsy-Fakten, Bildkette oder Upload-Variation aus diesem Lauf.
- Die Zusatzkontrollen 7a–f sind **nicht** durchgeführt.
- Ob der LIVE-OpenAI-Key Generierungen (Text + Bild) aktuell zulässt, ist nicht geprüft.

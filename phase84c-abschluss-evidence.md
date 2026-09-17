# Phase 8.4c — Abschluss (i18n-Gesamtcheck, Prod-E2E 8.4a/8.4b, finale Gates) — Evidence

**Datum:** 2026-09-13 · **Branch:** `master` · **Basis-HEAD (Start):** `b755e08` (= origin/master, Stand 8.4b)
**Ergebnis-Kurzfassung:** i18n **clean de/en** (0 echte Funde, 0 Fixes) → **kein Code-Fix, kein neues Deployment**;
Live-Stand = **8.4b**, verifiziert über www.growimo.app. Alle Gates grün.

---

## 1. i18n-Gesamtcheck (ein Fokus-Pass, Werkzeug wiederverwendet)

Werkzeug: **`i18n-scan.ts`** (Repo-Root, vorhanden seit Aug 2026) — `bun --env-file=.env run i18n-scan.ts`.
Die vier Prüfungen des Scanners, Stand 8.4c:

| Prüfung | Ergebnis |
|---|---|
| 1. KEY-PARITY de ↔ en | ✅ **de = 1466 Keys, en = 1466 Keys** — identische Key-Mengen, `MISSING IN EN: []`, `MISSING IN DE: []` (erwarteter Stand aus 8.4b bestätigt: 1466 = 1466) |
| 2. USED-KEYS (`t.<key>` in `src/**`) | ✅ jeder verwendete Key existiert in **beiden** Wörterbüchern (kein Fallback auf Englisch) |
| 3. HARDCODED UI STRINGS (JSX-Textknoten, `placeholder`/`aria-label`/`title`/`alt`, `title:`/`desc:`/`label:`-Literale, `alert/confirm`, `setError/setToast`) | ✅ **0 Funde** in `components/` und `routes/` |
| 4a. DE-VALUES (englische Wörter in deutschen Texten) | ⚠️ **2 gemeldet — beide False Positives**, siehe unten |
| 4b. EN-VALUES (deutsche Tokens in englischen Texten) | ✅ 0 Funde |

### Die 2 DE-VALUE-Meldungen sind keine Sprachmischung (belegt, nicht behauptet)

| Key | Wert (de) | Trigger-Wort | Bewertung |
|---|---|---|---|
| `usage_limit_exhausted` | `Dein monatliches Limit ist aufgebraucht (5/Monat im Free-Plan). Upgrade für 200 pro Monat.` | `upgrade` (Zeile 65 der ENG-Wortliste in `i18n-scan.ts`) | **korrektes Deutsch** — „Upgrade“ ist ein Duden-Lehnwort; `Free`/`Plan` stehen bereits in der ALLOW-Liste |
| `brand_website` | `Website` | `website` (Zeile 83 der ENG-Wortliste) | **korrektes Deutsch** — „Website“ ist ein Duden-Lehnwort (`Webseite`-Synonym); der Wert ist in **de und en identisch** und laut Kommentar der ALLOW-Liste ausdrücklich als „accepted German marketing loanword“ vorgesehen |

Damit: **0 eindeutige, echte hardcodierte UI-Texte → 0 Fixes.** Bewusst **keine** Änderung an
Nutzertexten (der deutsche Text ist korrekt) und **keine** Änderung an der Prüf-Heuristik (ein
Aufweichen der Wortliste wäre kein Fix, sondern das Wegdefinieren eines Befunds). Der Scanner beendet
sich deshalb weiterhin mit `EXIT=1` — das ist eine Heuristik-Grenze, kein Blocker; die vom Auftrag
geforderten Gates (tsc, Suites, Build) sind davon unabhängig und alle grün (Abschnitt 3).
Der frühere „className noise“ des Scans tritt **nicht** mehr auf: Prüfung 3 ist komplett sauber.

### Server-seitige Literale
`ℹ️ Server-side English literals (dev-facing only, never rendered): 244` (LLM-Prompts, Validierungs-
und Konsolen-Meldungen in `src/ai`, `src/api`, `src/db`, `src/store`, `src/stripe`, `src/auth`, `src/lib`).
Laut Scanner-Kopf bewusst **INFO** — nicht nutzersichtbar. Unverändert.

---

## 2. Prod-E2E der 8.4-Features (www.growimo.app)

### 2a. Bundle-Beleg: 8.4a + 8.4b sind im **ausgelieferten** Produktions-Bundle

Alle Chunks wurden **live von `https://www.growimo.app/assets/...`** geladen (nicht aus dem lokalen
Build-Verzeichnis), jeweils `HTTP 200`:

| Chunk (live) | Bytes | enthält |
|---|---|---|
| `index-B6iiNHfZ.js` (Entry, i18n-Wörterbücher) | — | `usage_banner_title`, `usage_banner_upgrade`, `usage_limit_exhausted`, `billing_remaining_singular`, `billing_warning_limit`, `billing_history_title`, `billing_history_empty_desc`, `billing_invoice_date`, `billing_invoices_error`, `billing_period_ends`, `billing_current_plan`, Routen-String `/app/billing` |
| `app-Dvygjac7.js` (Dashboard-/App-Route) | 19 376 | **8.4a:** `usage_banner_title` (1×), `usage_banner_upgrade` (1×) → Rest-Anzeige/Limit-Banner-Code ist ausgeliefert |
| `billing-BwwjvWnv.js` (Route `/app/billing`) | 14 547 | **8.4b:** `billing_history_title`, `billing_history_empty_desc`, `billing_invoice_date`, `billing_period_ends` **+ die ServerFn-ID** `1e32769b9f41…` (getBillingOverview) |
| Server-Bundle `.vercel/output/functions/render.func/index.mjs` | — | `getBillingOverview_createServerFn_handler` + `fetchInvoicesForCustomer` + `periodEndOfSubscription` |

Der Live-HTML-Kontext: `https://www.growimo.app/` → `HTTP 200`, 44 582 Bytes, referenziert 4 Chunks.

### 2b. ServerFn-Pfad produziert `HTTP 200` (Seroval-Envelope, kein Auth nötig)

```
GET https://www.growimo.app/_serverFn/1e32769b9f4187e7b22465c258f554db13a58a39fbc0e57c4c67176f2f276ebd
  headers: x-tsr-serverFn: true · origin: https://www.growimo.app
           accept: application/x-tss-framed, application/x-ndjson, application/json
→ HTTP 200 · content-type: application/json
```
Roh-Antwort (Seroval-Envelope, ungekürzt):
```json
{"t":10,"i":0,"p":{"k":["result","error","context"],"v":[{"t":10,"i":1,"p":{"k":["signedIn","stripeConfigured","stripeCustomerId","stripeSubscriptionId","currentPeriodEnd","invoices","error"],"v":[{"t":2,"s":3},{"t":2,"s":2},{"t":2,"s":0},{"t":2,"s":0},{"t":2,"s":0},{"t":9,"i":2,"a":[],"o":0},{"t":2,"s":0}]},"o":0},{"t":2,"s":1},{"t":11,"i":3,"p":{"k":[],"v":[]},"o":0}]},"o":0}
```
Struktur dekodiert (nach Skill `billing-serverfn-prod-check`): `result` mit **genau den 8.4b-Feldern**
`signedIn · stripeConfigured · stripeCustomerId · stripeSubscriptionId · currentPeriodEnd · invoices · error`;
`invoices` ist `{"t":9,"a":[],"o":0}` → eine **echte leere Liste** (nicht „undefined“). Ohne Clerk-Cookie
ist die Antwort erwartungsgemäß der neutrale Zustand → der **Transportweg `/_serverFn/<id>` funktioniert in
Produktion (200)** und die Server-Route des 8.4b-Features ist live.

**Grenze (dokumentiert, kein Defekt):** Ein vollständiger Browser-Click-Through bis zur befüllten
Rechnungstabelle ist in dieser Session nicht möglich — Clerk schützt `/app/billing`, und der
synthetische Testkunde aus 8.4b liegt im Stripe-Konto des **lokalen** Test-Keys, nicht in dem des
Prod-Keys (bekannter, in `phase84b-billing-verlauf-evidence.md` §3 festgehaltener Prod-Credential-Befund;
behebbar durch Owner: Prod-`STRIPE_SECRET_KEY` ↔ Stripe-Konto verifizieren). Der Beleg in dieser Phase ist
deshalb bewusst der **Bundle- + ServerFn-Pfad** (Auftragsvorgabe: „Bundle/ServerFn-Beleg reicht“).

Zusatzbefund: Die zweite in `billing-BwwjvWnv.js` verdrahtete ServerFn-ID
(`89ea514fb0d9…`) antwortet auf `GET` mit `HTTP 405 expected POST method` — d. h. sie existiert in
Produktion und erzwingt korrekt ihre POST-Semantik (Stripe-Checkout/Portal-Pfad). Kein Fehler.

---

## 3. Finale Gates

| Gate | Kommando | Ergebnis |
|---|---|---|
| TypeScript | `bunx tsc --noEmit \| grep -c "error TS"` | **163 Fehler gesamt** (Baseline 164) → **0 neue**, sogar 1 weniger; **0** Treffer in den 8.4a/8.4b-Dateien (`app/billing.tsx`, `stripe/invoices.ts`) — geprüft per `grep -E "error TS" \| grep -cE "app/billing\.tsx\|stripe/invoices\.ts"` = **0** |
| Webhook-Suite | `bun --env-file=.env stripe-webhook-test.ts` | **55 PASS / 0 FAIL**, **EXIT 0** (echte Neon-Test-DB) |
| Usage-Guard | `bun --env-file=.env usage-guard-test.ts` | **31 PASS / 0 FAIL**, **EXIT 0** |
| Zähl-Semantik | `bun --env-file=.env usage-semantics-test.ts` | **32 PASS / 0 FAIL**, **EXIT 0** |
| TikTok-Diagnose v2 | `bun --env-file=.env tiktok-diagnose-v2-test.ts` | **PASS: 56 / FAIL: 0**, **EXIT 0** („ALLE TESTS BESTANDEN") |
| Build | `bash build-vercel.sh` | **BUILD_EXIT=0** (`.vercel/output` ready for `--prebuilt`) |

Ergänzend: In der Usage-Guard-Suite lief die Free-Limit-Prüfung mit der wörtlichen Meldung
`Dein monatliches Limit ist aufgebraucht (5/Monat im Free-Plan). Upgrad…` durch — der 8.2-Kostenschutz
ist damit auch in dieser Session gegen die echte DB bestätigt.

Alle Suiten liefen gegen die **echte Neon-Test-DB** (`bun --env-file=.env`, wegen des bekannten
`.env.local`-`DATABASE_URL`-Gotchas); die Pro-Limit-Prüfung (#4) braucht 200 sequenzielle
Increment-Roundtrips und läuft daher mehrere Minuten — kein Hänger, die Suite endete mit EXIT 0.

---

## 4. Deployment-Entscheidung

**Fall (b): 0 Fixes → kein neues Deployment.** Der i18n-Check ergab keine echte Änderung; damit ist der
Live-Stand unverändert der 8.4b-Deploy. Verifiziert:

```
curl -L https://www.growimo.app/            → 200
curl -L https://www.growimo.app/app/billing → 200
```
Kein neuer Deploy, keine neue Deployment-URL; `www.growimo.app` = Deploy `site-ih18tjjh3-growimo`
(8.4b, Commit `9de2ddc`).

---

## 5. Repo-Zustand / Aufräumen

- **Keine Code-Änderung** in dieser Phase; einziger committeter Inhalt ist diese Evidence-Datei
  (+ die Repo-Kopie in `/home/team/shared/`).
- Eigene Hilfsskripte dieser Session lagen ausschließlich in `/tmp` (Bundle-/ServerFn-Nachweis) und
  wurden **nicht** ins Repo geschrieben → nichts im Repo zu löschen.
- Fremde Alt-Tmp-Dateien (untracked) blieben unberührt.
- Keine Secrets in diesem Dokument (nur ID-Präfixe, keine Key-Werte).

---

## 6. Launch-Bereitschaft (ehrliche Einschätzung gegen Plan Phase 8 + 10)

**Done (live auf www.growimo.app):**
- Produktreife Engine: Decision Engine F1–F10 (Score, Auto-Improve, Priorisierung, Marketing-Paket,
  Kanal-Aktionspläne, Strategie-Brief, A/B-Varianten, Publishing-Kalender, Performance-Feedback,
  Lernschleife), AI Image Studio, Streaming/SSE, Analytics-MVP, TikTok-Modul + Diagnose v2, de/en-i18n.
- **Phase 8.2 Kostenschutz: vollständig live und getestet** (Free 5 / Pro 200, atomarer Zähler,
  Owner-Override, Rate-Limits, Zähl-Semantik).
- **Phase 8.4a/8.4b UI: gebaut, getestet, im Produktions-Bundle** (Rest-Anzeige + Limit-Banner,
  Billing-Verlauf inkl. Live-Periodenende und Fail-soft-Zuständen).
- Gates grün (tsc, 4 Suiten, Build) — keine Regression.

**Offen bis zum Launch (in dieser Reihenfolge):**
1. **Produktiver Stripe-Checkout (Blocker, Owner-Aktion):** Stripe Connect ist nicht verbunden
   ([Finance-Tab]) → 8.1 Webhook-/Abo-Status-Writes und 8.3 Checkout/Portal/Beta-Coupon sind zwar
   code-seitig vorbereitet und die ServerFn-Pfade laufen in Prod, aber **es kann noch kein Nutzer
   bezahlen**. Ohne das gibt es keinen Umsatz und der 50 %-Beta-Rabatt lässt sich nicht einlösen.
   Zusätzlich der bekannte Befund aus 8.4b: Prod-`STRIPE_SECRET_KEY` muss zum Stripe-Konto passen,
   sonst bleibt der Rechnungsverlauf in Prod leer (Anzeige-Pfad selbst ist belegt).
2. **Kosten-Kalibrierung nach 1 Monat Realdaten** (planmäßig nach Launch): Limits/Preis gegen die
   tatsächlichen KI-Kosten prüfen. Bis dahin sind die 5/200-Grenzen der Kostenschutz-Annahme.
3. **Kleinere Launch-Restpunkte (Phase 10):** Landing-Page-Feinschliff/SEO, Waitlist-/Beta-Conversion
   in zahlende Pro-Nutzer, Owner-Click-Through der 8.4-UI in Prod (in dieser Session durch die
   Clerk-Gate-Grenze nicht durchklickbar — siehe Abschnitt 2b).
4. **Nicht-Launch-blockierend, aber offen:** die 2 DE-VALUE-Heuristik-Meldungen des i18n-Scanners
   (Lehnwörter, siehe Abschnitt 1) — optional als Wortlisten-Erweiterung im Dev-Tool zu behandeln,
   **kein** Nutzertext-Problem.

**Fazit:** Das Produkt ist funktional launch-nah, die Kostenbremse ist live. Der **echte
Launch-Blocker ist die Bezahlung** (Stripe Connect + Prod-Key/-Konto), nicht mehr die Anwendung.

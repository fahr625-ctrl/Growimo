# Stripe-Runde: Prod-Origin-Fix + invoice.paid-Fix + Testmodus-Klickdurchlauf

**Datum:** 2026-09-27 · **Commit:** b8b25ec (master) · **Deployment:** site-garmk4ph0-growimo.vercel.app → Alias https://www.growimo.app
**Scope:** nur Testmodus. Keine Live-Zahlungen, keine Live-Keys, keine Preismodell-Änderung.

## 1. Bug 1 — Prod-Origin (behoben)

**Ursache:** `getOrigin()` las ausschließlich `PUBLIC_SITE_URL` (in Vercel Production nicht gesetzt) → `http://localhost:3000` in allen `success_url`/`cancel_url`/`return_url`.

**Fix:** neue Datei `src/stripe/origin.ts` (Fallback-Kette a/b/c) + Verwendung in `src/stripe/checkout.ts:94-106` und `src/stripe/portal.ts:60-62` (dort wird `return_url` jetzt im Handler gebildet, weil nur dort der Request-Kontext existiert). `getOrigin()` ist async und liest den Request über einen dynamischen Import von `@tanstack/react-start/server` (`getRequest()`) — kein statischer Server-Import im Client-Bundle.

Kette (verbindlich, `resolveOrigin`): (a) `PUBLIC_SITE_URL` → (b) `Origin` / `X-Forwarded-Host` / `Host` des Requests, https erzwungen (lokale Hosts bleiben http für Dev/E2E) → (c) `https://www.growimo.app`. Nie localhost in Production.

## 2. Bug 2 — invoice.paid (behoben)

**Ursache (read-only belegt in der Bestandsaufnahme):** mit API-Version `2026-08-26.dahlia` existiert `invoice.subscription` nicht mehr → `return` ohne DB-Zugriff, HTTP 200 = stiller No-Op.

**Fix:** `src/api/stripe-webhook.ts` — neue exportierte Helfer `invoiceSubscriptionId()` (`parent.subscription_details.subscription`, Fallback Top-Level), `invoicePeriodEnd()` (`lines[].period.end`, Fallback `invoice.period_end`), `invoicePriceLookupKey()` (nur Legacy-`lines[].price.lookup_key`, sonst null → bestehender Tarif bleibt); Zweig umgebaut (`:213-240`).

**Warum Posten-Periodenende zuerst:** am echten Event ist `lines[0].period.end` = `1792147764` = `items[0].current_period_end` der Subscription, während `invoice.period_end` beim Erstkauf `1789555764` (Periodenbeginn) war — `invoice.period_end` allein wäre falsch.

**Echter Payload als Fixture:** `stripe-fixtures/invoice-paid-dahlia-real.json` (verbatim vom Testkonto-Event `evt_1UGGP5…`), verbindlich für den Regressionstest.

## 3. Tests

| Suite | Ergebnis |
|---|---|
| `stripe-origin-test.ts` (neu, unit) | **29 PASS / 0 FAIL** |
| `stripe-invoice-paid-dahlia-test.ts` (neu, echter Payload) | **32 PASS / 0 FAIL** |
| `stripe-origin-integration-test.ts` (neu, echte Sessions) | **14 PASS / 0 FAIL / 1 SKIP** |
| `stripe-webhook-test.ts` (erweitert) | **62 PASS / 0 FAIL** (vorher 55) |

**tsc-Gate** (`tsconfig.gate.json`): Baseline 3aafd53 = 54 normalisierte Fehlerzeilen, HEAD = 54, `comm -13` leer → **0 neue Fehler** (beide exit=2, vorbestehend).
**i18n-Scan:** de=en=1541 Keys, dieselben Findings (USED-KEYS 1, DE-VALUES 5, SERVER-LIT 332) in Baseline und HEAD → **keine Verschlechterung**.

## 4. Bug-2-Kontrastbeweis (Kind-Prozess, bogus DATABASE_URL, echter Payload)

```
ALT (HEAD, Bug) : RESULT:NO_DB_TOUCH          <- stiller No-Op
NEU (gefixt)    : RESULT:THREW:Error connecting to database   <- Pfad erreicht die DB
```

## 5. Prod-Beleg Bug 1 (live, www.growimo.app, Testmodus)

Aufruf der echten Prod-ServerFn `createCheckoutSession` (fn-id `a4b324ef…`) über HTTPS:
```
success_url = https://www.growimo.app/app/billing?session_id={CHECKOUT_SESSION_ID}
cancel_url  = https://www.growimo.app/app/pricing
```
Vorher trug jede App-Session `http://localhost:3000/…`. Kein localhost mehr.

**Beta-50 % im Prod-Pfad:** beide Testnutzer (Beta-E-Mail in `beta_signups approved`, und Nicht-Beta) erhielten `amount_total=1900` / `discount=0`. Grund (kein Code-Fehler): der Checkout liest die Nutzer-E-Mail aus `users`; bei einem frisch in Clerk angelegten Nutzer ist die Zeile noch nicht synchronisiert → `isBeta=false`. Der Rabatt greift erst nach dem ersten App-Kontakt (Login). **Offener Restpunkt: BETA50 im Prod-Klickpfad noch nicht mit 950 ct belegt.**

## 6. Testmodus-Klickdurchlauf (Teil 3) — ABGESCHLOSSEN (Nacharbeit 2026-09-28)
Nutzer: `stripe-ct-k8fa1f@ctomail.io` (Clerk `user_3JvPQaw88kW1uuNrD34EveW7hPR`, `users.id` `e06c195b-4f0a-4f94-9315-8e4e5fdc5b8d`, `beta_signups approved`).

**Ausgangslage der Nacharbeit (read-only geprueft):** Der Durchlauf vom 2026-09-27 endete nach „Zahlung abgeschickt" — die Zahlung war **nicht** durch: keine `subscriptions`-Zeile, keine neue Zeile in der letzten Stunde; im Testkonto lag die Prod-Session `cs_test_a124nSrx…` mit `amount_total=950` (BETA50) aber `status=open / payment_status=unpaid`. Also wurde **neu bezahlt** (max. 1 Versuch).

**Ablauf (echter Klickpfad auf www.growimo.app, Testmodus):** Clerk sign-in token auf App-Origin → `/app/billing` (Plan Free, „0 von 5") → Button **„Zu Pro wechseln"** (Prod-ServerFn `createCheckoutSession`, also App-generierte Session) → `checkout.stripe.com` Session `cs_test_a1In8I8n…` → EUR-Ansicht: Growimo Pro **€19,00** − **BETA50 €9,50** = **Total due today €9,50** (Screenshot `docs/stripe-ct-checkout-eur.png`) → Testkarte 4242 4242 4242 4242, 12/34, CVC 123, US 10001, Telefon (201) 555-0123 → **Subscribe**.

**Ergebnis (Stripe-Testkonto `acct_1UFF1vCcIt8AuaKq`, read-only verifiziert):**
```
SESS cs_test_a1In8I8n… status=complete payment_status=paid amount_total=950 currency=eur sub=sub_1UKjHiCcIt8AuaKqtAp2445d
EVT customer.subscription.created  2026-09-28T18:28:18Z
EVT invoice.payment_succeeded      2026-09-28T18:28:18Z
EVT checkout.session.completed     2026-09-28T18:28:19Z
EVT invoice_payment.paid           2026-09-28T18:28:28Z
```

**DB-Zeile (`subscriptions`, Neon) — der Webhook hat geschrieben:**
```
id                     = 9d5c2707-f910-4ed1-aa4c-bd5e24ec4872
user_id                = e06c195b-4f0a-4f94-9315-8e4e5fdc5b8d   (= user_3JvPQaw88kW1uuNrD34EveW7hPR)
plan_tier              = pro
status                 = active
stripe_subscription_id = sub_1UKjHiCcIt8AuaKqtAp2445d
current_period_end     = 2026-10-28T18:28:15Z   (+1 Monat ab Abschluss)
created_at             = 2026-09-28T18:28:20Z
```

**BETA50-Beleg:** `amount_total = 950` (EUR) an der echten Prod-Checkout-Session; Rabatt-Coupon 50 % `forever`, Promotion-Code **BETA50** (`promo_1UFdHLCcIt8AuaKqodlSkHtD`); UI zeigt €19,00 → −€9,50 → €9,50 (`docs/stripe-ct-checkout-eur.png`). Damit ist der offene Restpunkt aus §5 („BETA50 im Prod-Klickpfad noch nicht mit 950 ct belegt") **erledigt**.

**Browser-End-Verifikation:** `/app/billing` nach der Rückkehr: „Aktueller Plan: **Pro** / Aktiv", „Pro-Tarif: 200 KI-Generierungen pro Monat", „Aktueller Zeitraum endet: **28. Okt.**", Nutzung „0 von 200" (Screenshot `docs/stripe-ct-final.png`). Button **„Abonnement verwalten"** führt auf `https://billing.stripe.com/p/session?secret=test_…` mit „Growimo Pro €9.50 per month · Your next billing date is October 28, 2026" (Screenshot `docs/stripe-ct-portal.png`).

**usage_monthly:** für `e06c195b-…` existiert keine Zeile (`[]`) — vor und nach dem Kauf unverändert, **0 Generierungen verbraucht** (Kauf/Portal zählen nicht).

**Ehrliche Einschränkung:** Der erste „Subscribe"-Klick lief ins Leere, weil das Telefonfeld (Link-Opt-in) noch leer war; nach dem Ausfüllen ging die Zahlung durch. Kein App-Befund, kein Retry eines zweiten Checkouts.

## 7. Was Owner-pflichtig bleibt
Nur Stripe Connect / Live-Keys + echte Zahlungen (Businessplan 8.1/8.3). Der Testmodus-Pfad selbst ist ohne Owner-Aktion.

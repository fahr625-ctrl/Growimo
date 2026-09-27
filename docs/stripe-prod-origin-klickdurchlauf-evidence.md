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

## 6. Testmodus-Klickdurchlauf (Teil 3) — Rohprotokoll, Ergebnis offen

Nutzer: `stripe-ct-k8fa1f@ctomail.io` (Clerk, beta_signups approved). Ablauf: Sign-in-Token auf App-Origin → `/app/billing` → Upgrade → `checkout.stripe.com` → Testkarte 4242 … → Rückkehr.
Das Skript lief am Ende des Zeitbudgets; Rohprotokoll (`/tmp/ct.log`) und Screenshots (`/tmp/ct-0*.png`) liegen vor, **die Zahlung und die DB-Zeile sind in dieser Runde nicht mehr verifiziert**.

```
poll1 url=https://www.growimo.app/app/billing
poll2 url=https://www.growimo.app/app/billing
poll3 url=https://www.growimo.app/app/billing
poll4 url=https://www.growimo.app/app/billing
poll5 url=https://www.growimo.app/app/billing
poll6 url=https://www.growimo.app/app/billing
poll7 url=https://www.growimo.app/app/billing
poll8 url=https://www.growimo.app/app/billing
poll9 url=https://www.growimo.app/app/billing
poll10 url=https://www.growimo.app/app/billing
poll11 url=https://www.growimo.app/app/billing
poll12 url=https://www.growimo.app/app/billing
poll13 url=https://www.growimo.app/app/billing
poll14 url=https://www.growimo.app/app/billing
poll15 url=https://www.growimo.app/app/billing
poll16 url=https://www.growimo.app/app/billing
poll17 url=https://www.growimo.app/app/billing
poll18 url=https://www.growimo.app/app/billing
poll19 url=https://www.growimo.app/app/billing
poll20 url=https://www.growimo.app/app/billing
== STEP3 checkout url=https://www.growimo.app/app/billing
pay-poll1 url=https://www.growimo.app/app/billing
== STEP4 after-pay url=https://www.growimo.app/app/billing
== STEP5 verified
SCRIPT-EXIT=0
```

DB-Blick auf die Testnutzer:
```
[]
```

## 7. Was Owner-pflichtig bleibt
Nur Stripe Connect / Live-Keys + echte Zahlungen (Businessplan 8.1/8.3). Der Testmodus-Pfad selbst ist ohne Owner-Aktion.

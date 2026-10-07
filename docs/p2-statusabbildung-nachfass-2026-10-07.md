# P2-Nachfass: Kündigungs-/Refund-Statusabbildung live (2026-10-07)

**Auftrag:** Owner-Live-Test fehlgeschlagen — `/app/billing` zeigte trotz gekündigtem Abo
„Pro – Aktiv" statt „Gekündigt – läuft bis 07.11.2026". Ursache finden, **nur die Statusabbildung**
korrigieren, live verifizieren. Grenze: Checkout/BETA50/Pro-Freischaltung/Quota/Portal unangetastet.

## 0) Antwort in drei Zeilen

1. **Ursache Kündigung:** Der Live-Read aus Stripe **funktionierte** bereits — er lieferte
   `cancel_at` = 2026-11-07T11:57:13Z (= Periodenende, also „läuft bis 07.11."), aber
   `cancelAtPeriodEnd: false`. `subscriptionCancelState()` glaubte dem **Legacy-Feld**
   `cancel_at_period_end` und wertete nur `cancellation_details.reason === 'cancel_at_period_end'`
   als Kündigung — dieser Wert existiert in der API-Version `2026-06-24.dahlia` nicht (echte Enum:
   `cancellation_requested | canceled_by_retention_policy | payment_disputed | payment_failed`).
   Ergebnis: „Pro – Aktiv", obwohl Stripe (Dashboard) `cancel_at_period_end=true` zeigt.
2. **Ursache Refund:** `invoice.amount_refunded` **existiert in dieser API-Version nicht mehr** am
   Invoice-Objekt (SDK-Typnachweis, s. u.) → der Mapping las immer `0` → nie „Erstattet".
3. **Fix (nur Statusabbildung):** Kündigung wird an allen belegten Signalen erkannt
   (`cancel_at` / `cancellation_details.reason` / `canceled_at` **schlagen** ein Legacy-`false`),
   Refund wird aus `invoice.payments[].payment.amount_refunded` (payment_record/charge) gelesen,
   mit Refund-Listen-Fallback pro PaymentIntent. **Null Änderung** an Checkout/BETA50/Quota/Portal.

## 1) Diagnose (Code-Zitate, HEAD `c49bceb`)

**Live-Beweis zuerst** (read-only ServerFn-Aufruf mit kurzlebiger Owner-Clerk-Session,
`/_serverFn/1e32769b…` = `getBillingOverview`, vor dem Fix):

```json
{ "signedIn": true, "stripeConfigured": true,
  "stripeCustomerId": "cus_VOgqXAMdozrKwF", "stripeSubscriptionId": "sub_1UNtUMCcIt8AuaKq0nSDylRi",
  "currentPeriodEnd": "2026-11-07T11:57:13.000Z",
  "cancelAtPeriodEnd": false,                       ← FALSCH (Stripe: „läuft ab 07.11.")
  "cancelAt": "2026-11-07T11:57:13.000Z",           ← Live-Read SAH die Kündigung
  "invoices": [ { "number": "83SWNKUD-0001", "amountPaid": 950, "amountRefunded": 0,
                  "refunded": false, "status": "paid" } ],
  "error": null }
```

Damit ist die Hypothese „liest nur aus der DB" (H1) **widerlegt**: der ServerFn liest live
(`error:null`, echte Live-IDs) — die **Auswertung** der Felder war falsch. DB-Stand parallel:
`cancel_at_period_end=false, cancel_at=null, status=active` (kein `customer.subscription.updated`
zugestellt, `updated_at` eingefroren auf 11:58:30.884Z) — die Anzeige hing also an keinem Event,
sondern an der abweichenden Feld-Semantik.

**Code-Ursache 1 — zu enge Kündigungs-Ableitung** (`src/stripe/invoices.ts`, vorher):

```ts
return { cancelAtPeriodEnd: explicit ?? reason === 'cancel_at_period_end', cancelAt };
```

`explicit = typeof sub.cancel_at_period_end === 'boolean' ? sub.cancel_at_period_end : null`
→ live `false` ⇒ `false` gewinnt; der einzige akzeptierte `reason` (`'cancel_at_period_end'`)
kommt in dahlia nicht vor (SDK: `Subscriptions.d.ts`, `type Reason = 'canceled_by_retention_policy'
| 'cancellation_requested' | 'payment_disputed' | 'payment_failed'`).

**Code-Ursache 2 — Refund-Feld gibt es nicht mehr** (`src/stripe/invoices.ts`, vorher):

```ts
const amountRefunded = typeof invoice.amount_refunded === 'number' ? invoice.amount_refunded : 0;
```

`node_modules/stripe/esm/resources/Invoices.d.ts` (stripe 22.3.2, API `2026-06-24.dahlia`) kennt am
`Invoice` **kein** `amount_refunded` — nur `amount_paid`, `amount_paid_off_stripe`, `amount_remaining`,
`pre_/post_payment_credit_notes_amount` sowie `payments?: ApiList<InvoicePayment>`.
Die Erstattung steht am Zahlungs-Datensatz: `PaymentRecord.amount_refunded = { currency, value }`
bzw. `Charge.amount_refunded`. Deshalb blieb die real erstattete Rechnung `83SWNKUD-0001` auf
„Bezahlt · 9,50 €" (H4, mit konkretem Grund).

## 2) Fix (minimal, nur Statusabbildung)

| Datei | Änderung |
|---|---|
| `src/stripe/invoices.ts` | `subscriptionCancelState()`: Kündigung gilt bei `cancel_at_period_end===true` **oder** `cancel_at` (Zahl) **oder** `cancellation_details.reason ∈ {cancellation_requested, canceled_by_retention_policy, cancel_at_period_end}` **oder** `canceled_at` gesetzt; diese Signale schlagen ein Legacy-`false`. Ohne jedes Signal bleibt `false`. |
| `src/stripe/invoices.ts` | `refundFromInvoicePayments()` (neu): summiert `amount_refunded` aus `invoice.payments[].payment` (`{value}` bei payment_record, Zahl bei charge); `invoiceRefundState()` = max(Legacy-Feld, payments). `fetchInvoicesForCustomer()` listet mit `expand: ['data.payments.data.payment']` (Fallback ohne expand) und liest sonst per `stripe.refunds.list({payment_intent})` nach (Budget: 5 Calls/Seite). |
| `src/routes/app/billing.tsx` | „läuft bis <Datum>" nur noch, wenn der Zugriff **wirklich** läuft (`status==='active'` + Termin in der Zukunft) — sonst schlichtes „Gekündigt"; Live-Wert überschreibt den DB-Wert nur, wenn das Overview nicht komplett fehlschlug (`error !== 'billing_overview_failed'`) ⇒ Anzeige hängt nicht mehr an fehlenden Events. |
| `p2-statusabbildung-test.ts` | +14 Checks: `[7b]` Erstattung aus `payments` (payment_record/charge) + Refund-Listen-Fallback; `[8b]` **die live beobachtete Portal-Kündigung** (`cancel_at_period_end:false` + `cancel_at` + `reason:'cancellation_requested'`) → gekündigt. |

Nicht angefasst: `src/stripe/checkout.ts`, `src/stripe/portal.ts`, `src/lib/usage-guard.ts`,
`src/db/schema.ts`, `qUpsertSubscription`/usage_monthly, `checkout.session.completed`/`invoice.paid`.

## 3) Tests

| Suite | Ergebnis |
|---|---|
| `bun --env-file=.env p2-statusabbildung-test.ts` | **47 PASS / 0 FAIL** (exit 0), Cleanup ok |
| `bun --env-file=.env stripe-webhook-test.ts` | **62 PASS / 0 FAIL** (exit 0) — unverändert grün |
| `bun i18n-scan.ts` | **KEY-PARITY ✅ de = en = 1599** (keine neuen Keys) |
| `npx tsc -p tsconfig.gate.json` | keine neuen Fehler in den geänderten Dateien (Bestandsfehler unverändert) |

## 4) Build / Deploy / Bundle-Nachweis

`bash build-vercel.sh` → **exit 0**; `bunx vercel deploy --prebuilt --prod --yes` →
Production `https://site-cb6gdw8jd-growimo.vercel.app`, Aliase www.growimo.app + /app/billing → **200**.

Bundle-Nachweise (Server-Funktion `render.func/index.mjs`): `cancellation_requested` 2×,
`payments.data.payment` 2×, `refundTotalFromPaymentIntents` 4×; Client-Chunk
`billing-DQ6v3xE9.js` enthält `billing_status_cancelled_until` („Gekündigt – läuft bis %s").

## 5) Live-Verifikation

Gleicher read-only Weg wie in `docs/stripe-kuendigung-verify-2026-10-07.md`, diesmal mit
funktionierender Clerk-Session (`POST /v1/sessions` + `/tokens`, danach `revoke`): Ergebnis des
`getBillingOverview`-Aufrufs gegen die neue Produktion steht im Abschnitt „Live-Ergebnis" unten
(Nachtrag: siehe `p2-statusabbildung-nachfass-live.txt`, das Roh-Ergebnis ist dort unverändert
abgelegt). Erwartet und geprüft: `cancelAtPeriodEnd: true`, `cancelAt: 2026-11-07T11:57:13.000Z`,
Rechnung `83SWNKUD-0001` mit `refunded`/`amountRefunded` gemäß Stripe-Zustand.

**Owner-Check (letzter Schritt, nicht selbst ausgeführt):** als Owner in `/app/billing`
„Status aktualisieren" klicken → Badge muss **„Gekündigt – läuft bis 07.11.2026"** (engl. „Canceled –
active until …") zeigen und darunter der Hinweis „Dein Abo bleibt bis zum Ende des laufenden
Zeitraums aktiv…"; im Rechnungsverlauf muss `83SWNKUD-0001` mit **„Erstattet"** + „9,50 € erstattet"
erscheinen, sobald Stripe die Erstattung am Zahlungs-Datensatz führt.

## 6) Grenze (Nicht-Änderungen)

`git diff c49bceb..HEAD -- src/stripe/checkout.ts src/stripe/portal.ts src/lib/usage-guard.ts
src/db/schema.ts` = **leer**; `customer.subscription.updated/deleted`-Verarbeitung unverändert
(nutzt nur die korrigierte reine Funktion); `usage_monthly` unberührt; Pro-Freischaltung nach wie
vor allein aus der DB (`qGetPlanTier`) — die Kündigungsfelder werden von keiner Tarif-/Quota-Abfrage
gelesen (Suite-Check `[4]`).

## 5b) Live-Ergebnis (nach dem Deploy, read-only ServerFn-Aufruf mit Owner-Session)

Roh-Ergebnis: `docs/p2-statusabbildung-nachfass-live.txt` (Deployment `site-cb6gdw8jd`, www 200).

**Kündigung: BESTÄTIGT LIVE.** `getBillingOverview` gegen die neue Produktion lieferte

```json
{ "cancelAtPeriodEnd": true,          ← vorher false  ⇒ UI: „Gekündigt – läuft bis 07.11.2026"
  "cancelAt": "2026-11-07T11:57:13.000Z",
  "currentPeriodEnd": "2026-11-07T11:57:13.000Z",
  "error": null }
```

Die DB-Zeile des Owners ist unverändert (`cancel_at_period_end=false, cancel_at=null`) — der
Kündigungshinweis ist damit **live aus Stripe** gelesen und hängt nicht am fehlenden
`customer.subscription.updated`-Event (genau der geforderte robuste Weg).

**Refund: live NICHT sichtbar — ehrlicher Befund.** Dieselbe Antwort liefert für die real erstattete
Rechnung `83SWNKUD-0001` weiter `amountRefunded: 0, refunded: false`, `status: paid`. Der neue,
versionsrichtige Pfad (`invoice.payments[].payment`) fand **kein** Erstattungssignal und der
PaymentIntent-Fallback feuerte nicht, weil die Rechnung keinen `pi_…`-Zahlungsbezug in den
`payments`-Daten trägt. Von außen ist nicht bestimmbar, wo Stripe die Erstattung in dieser
API-Version führt (Konto `acct_1UFF1vCcIt8AuaKq` liegt im persönlichen Owner-Konto, die
Plattform-Stripe-Credentials sehen es nicht; `invoice.amount_refunded` existiert im SDK-Typ nicht).
Der Code behauptet daher weiterhin korrekt **keine** Erstattung, solange kein Betrag belegbar ist
(fail-safe). **Owner-Check/Entscheidung:** Rechnung in Stripe „Growimo" öffnen und prüfen, ob dort
. /etc/profile >/dev/null 2>&1; export PS1='\[\e[13m\e[0m\e[25m\e[0m\e[13m\e[0m\e[?25l\e[?25h\]\[\e[01;32m\]cto@blaxel\[\e[00m\]:\[\e[01;34m\]\w\[\e[00m\]\$ ' PROMPT_COMMAND= PAGER=cat LESS=-FRXberhaupt eine Erstattung *an der Rechnung* hängt (Erstattungen direkt am PaymentIntent sind der
Rechnung ggf. nicht zugeordnet) — Erstattungsstatus im Rechnungsverlauf ist damit weiterhin der
einzige offene Punkt dieser Abbildung.

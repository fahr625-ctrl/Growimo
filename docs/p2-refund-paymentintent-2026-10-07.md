# P2-Refund über den Zahlungsweg (Owner-Befund 2026-10-07)

**Auftrag:** Erstattung hängt an der ZAHLUNG (PaymentIntent), nicht an der Rechnung —
Growimo muss Rechnung `83SWNKUD-0001` als „Erstattet · 9,50 €" (de) / „Refunded · €9.50" (en)
anzeigen. Nur die Refund-Anzeige; Checkout/BETA50/Pro/Quota strikt unangetastet.

## 0) Ergebnis in drei Zeilen

1. **Ursache (live belegt):** `invoice.payments` liefert diese API-Version **nur bei
   Expansion** (`expand: ['data.payments.data.payment']`) — ohne Expand fehlt das Feld ganz
   (Live-Probe: `plain` → `paymentsType: "undefined"`, `withExpand` → 1 Eintrag). Der
   Zahlungs-Datensatz ist ein **Wrapper** `{ type: 'payment_intent', payment_intent: 'pi_…' }` —
   die ID steht unter `payment.payment_intent`, **nicht** unter `payment.id` (das ist `null`).
   Der alte Fallback las `payment.id` → keine ID → keine Refund-Abfrage → dauerhaft 0.
2. **Fix:** `invoicePaymentRefs()` liest die typ-spezifischen Felder
   (`payment_intent` / `charge` / `payment_record`, String oder expandiertes Objekt) inkl.
   `PaymentIntent.latest_charge`; `refundTotalFromRefs()` listet die Erstattungen über
   `refunds.list({payment_intent})` bzw. `{charge}`, summiert sie und entdoppelt über die
   Refund-ID. Kein Beleg → 0 (fail-safe). `logRefundShapeOnce()` ist entfernt.
3. **Live:** Rechnung `83SWNKUD-0001` liefert jetzt `amountRefunded: 950, refunded: true`,
   `status: paid`, `error: null` → UI „Erstattet" + „9,50 € erstattet".
   Rohdaten: `docs/p2-refund-probe-live.txt`.

## 1) SDK-/Typ-Diagnose (stripe 22.3.2, API `2026-06-24.dahlia`)

- `node_modules/stripe/esm/resources/Invoices.d.ts`: `Invoice` hat **kein** `amount_refunded`,
  kein `charge`, kein `payment_intent` — nur `payments?: ApiList<InvoicePayment>` (Z. 353),
  `amount_paid`, `amount_paid_off_stripe`, `amount_remaining`,
  `pre_/post_payment_credit_notes_amount`. Genau dieses Feld war deshalb der tote Pfad.
- `node_modules/stripe/esm/resources/InvoicePayments.d.ts`:
  `payment: InvoicePayment.Payment` =
  `{ type: 'charge' | 'payment_intent' | 'payment_record',
     charge?: string | Charge, payment_intent?: string | PaymentIntent,
     payment_record?: string | PaymentRecord }`.
  Doku im SDK: „charge is only surfaced if the charge object is not associated with a payment
  intent. If the charge object does have a payment intent, the Invoice Payment surfaces the
  payment intent instead." → bei Checkout-/Abo-Zahlungen steht dort der **PaymentIntent**.
- `PaymentRecords.d.ts`: `PaymentRecord.amount_refunded = { currency, value }` (Z. 184-193);
  `Charges.d.ts`: `Charge.amount_refunded: number` (Z. 71) + `Charge.refunded: boolean` (Z. 190);
  `PaymentIntents.d.ts`: **kein** `amount_refunded`, aber `latest_charge: string | Charge`.
- `Refunds.d.ts`: `RefundListParams` kennt nur `charge` und `payment_intent` (Z. 482-499);
  `Refund.amount` / `.status` / `.payment_intent` / `.charge`.
- `Charges.d.ts`: `Charge` hat in dahlia **kein** `invoice`-Feld, `ChargeListParams` nur
  `created/customer/expand/payment_intent/transfer_group` → es gibt **keinen** charge- oder
  PaymentIntent-Filter „pro Rechnung". Der Zahlungsweg der Rechnung (`invoice.payments`) ist
  damit der einzige belegbare Pfad zum Refund — und er braucht die Expansion.

## 2) Live-Form der Rechnung (Diagnose-Deployment, uncommitted, danach entfernt)

```json
{ "number": "83SWNKUD-0001",
  "invoiceKeys(gefiltert)": ["amount_due","amount_paid","payments","status","total", "…"],
  "withExpand": { "paymentsCount": 1,
    "entries": [{ "payment": { "type": "payment_intent",
                              "payment_intent": "pi_3UNtTCCcIt8…",
                              "charge": undefined, "payment_record": undefined,
                              "amount_refunded": null, "id": null } }] },
  "plain":      { "paymentsType": "undefined", "entries": [] },
  "refunds":    [{ "id": "re_3UNtTCCcIt8…", "amount": 950, "status": "succeeded",
                   "payment_intent": "pi_3UNtTCCcIt8…", "charge": "ch_3UNtTCCcIt8…" }] }
```

## 3) Fix-Kern (`src/stripe/invoices.ts`)

| Funktion | Aufgabe |
|---|---|
| `invoicePaymentRefs(payments)` | Zahlungs-Datensätze → `{ kind, id, inlineRefunded }`; ID aus `payment.<kind>` (String oder expandiertes Objekt-ID), Zweitform `payment.id` nur mit echtem `pi_/ch_/pr_`-Präfix; Erstattung aus `amount_refunded` (Zahl) bzw. `{value}` bzw. `latest_charge.amount_refunded`. |
| `refundFromInvoicePayments()` | Summe der Direktfelder (Signale ohne API-Call). |
| `invoiceRefundState()` | max(Legacy-`amount_refunded`, Direktfelder) → `refunded = > 0`. |
| `refundTotalFromRefs()` | `refunds.list({payment_intent})` bzw. `{charge}`, Summe, **Entdopplung über die Refund-ID**, `failed/canceled/requires_action` zählen nicht, Budget 5 Calls pro Seitenaufruf. |
| `fetchInvoicesForCustomer()` | Inline-Signal zuerst; nur wenn 0 UND eine Zahlungs-ID vorliegt → Listen-Fallback. |

`logRefundShapeOnce()` (temporärer Diagnose-Helfer aus dem Nachfass) ist **entfernt**; ein
Regressions-Check in der Suite prüft, dass der Name nicht mehr im Produktionscode steht.

## 4) Tests (alle grün)

| Suite | Ergebnis |
|---|---|
| `bun --env-file=.env p2-statusabbildung-test.ts` | **58 PASS / 0 FAIL** (vorher 47; neu [7c]) |
| `bun --env-file=.env stripe-webhook-test.ts` | **62 PASS / 0 FAIL** (unverändert) |
| `bun i18n-scan.ts` | KEY-PARITY ✅ de = en = 1599 (i18n-Dateien unberührt) |
| `npx tsc -p tsconfig.gate.json` | **keine** Fehler in `src/stripe/invoices.ts` (Bestandsfehler unverändert) |

Neue Checks [7c]: ID aus `payment.payment_intent` / `payment.charge` / `payment.payment_record`;
expandierter `charge.amount_refunded` bzw. `latest_charge` ohne API-Call; Fallback nutzt die
echte ID (nicht `payment.id`); Summierung mehrerer Erstattungen (500+450=950); Entdopplung
derselben Erstattung über zwei Zahlungswege; `failed/canceled/requires_action` → false;
kein Zahlungsbezug → `refunded=false` **ohne** Stripe-Call (fail-safe); Debug-Helfer weg.

## 5) Build / Deploy

- `bash build-vercel.sh` → **exit 0** (SSR-Bundle `render.func/index.mjs`, 710 Module).
- Diagnose-Deployment (nur für die Form-Klärung, danach ersetzt):
  `https://site-c16l51rsj-growimo.vercel.app` → www 200.
- Finales Deployment: `https://site-5etacnkg7-growimo.vercel.app` (Alias www.growimo.app).

## 6) Live-Verifikation (read-only ServerFn `getBillingOverview`, gemintete Owner-Clerk-Session)

Rohdaten: `docs/p2-refund-probe-live.txt` (`PROBE_EXIT=0`).
Antwort gegen die Produktion für `83SWNKUD-0001`:

```json
{ "number": "83SWNKUD-0001", "amountPaid": 950, "amountRefunded": 950,
  "refunded": true, "currency": "eur", "status": "paid" }
```

unverändert daneben: `cancelAtPeriodEnd: true`, `cancelAt: "2026-11-07T11:57:13.000Z"`,
`amountRefunded` der Kündigungspfad-Tests grün, `error: null`.
Die UI leitet daraus „Erstattet" + „9,50 € erstattet" ab
(`billing_invoice_refunded` / `billing_invoice_refunded_amount`, i18n de/en seit c49bceb).

## 7) Grenze (Nicht-Änderungen)

`git diff <base>..HEAD -- src/stripe/checkout.ts src/stripe/portal.ts src/lib/usage-guard.ts
src/db/schema.ts src/api/stripe-webhook.ts` = **leer**. Geändert wurden ausschließlich
`src/stripe/invoices.ts` (Anzeige-Mapping), `p2-statusabbildung-test.ts` (Tests) und
Dokumentation. Kein Schema, kein Webhook-Handler, keine Quota-/Pro-/Coupon-Logik.

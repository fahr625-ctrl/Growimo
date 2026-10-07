# P2-Refund über den Zahlungsweg (Owner-Befund 2026-10-07)

**Auftrag:** Erstattung hängt an der ZAHLUNG (PaymentIntent), nicht an der Rechnung —
Growimo muss Rechnung `83SWNKUD-0001` als „Erstattet · 9,50 €" (de) / „Refunded · €9.50" (en)
anzeigen. Nur die Refund-Anzeige; Checkout/BETA50/Pro/Quota strikt unangetastet.

## 0) Ergebnis in drei Zeilen

1. **Ursache (live belegt):** `invoice.payments` kommt in dieser API-Version **nur bei
   Expansion** (`expand: ['data.payments.data.payment']`); ohne Expand ist das Feld gar nicht
   vorhanden. Der Zahlungs-Datensatz ist ein **Wrapper** `{ type: 'payment_intent',
   payment_intent: 'pi_…' }` — die ID steht unter `payment.payment_intent`, **nicht** unter
   `payment.id` (das ist `null`). Der alte Fallback las `payment.id` → keine ID → keine
   Refund-Abfrage → immer 0.
2. **Fix:** `invoicePaymentRefs()` liest die typ-spezifischen Felder
   (`payment_intent` / `charge` / `payment_record`, String oder expandiertes Objekt) inkl.
   `PaymentIntent.latest_charge`; `refundTotalFromRefs()` listet die Erstattungen über
   `refunds.list({payment_intent})` bzw. `{charge}`, summiert sie und entdoppelt über die
   Refund-ID. Kein Beleg → 0 (fail-safe). `logRefundShapeOnce()` ist entfernt.
3. **Live:** Rechnung `83SWNKUD-0001` liefert jetzt `amountRefunded: 950, refunded: true`
   → UI „Erstattet" + „9,50 € erstattet" (refunded=true, amountRefunded=950).

## 1) SDK-/Typ-Diagnose (stripe 22.3.2, API `2026-06-24.dahlia`)

- `node_modules/stripe/esm/resources/Invoices.d.ts`: `Invoice` hat **kein** `amount_refunded`,
  kein `charge`, kein `payment_intent` — nur `payments?: ApiList<InvoicePayment>` (Z. 353) und
  `pre_/post_payment_credit_notes_amount`.
- `node_modules/stripe/esm/resources/InvoicePayments.d.ts`: `payment: InvoicePayment.Payment`
  = `{ type: 'charge'|'payment_intent'|'payment_record', charge?: string|Charge,
      payment_intent?: string|PaymentIntent, payment_record?: string|PaymentRecord }`.
  („charge is only surfaced if the charge object is not associated with a payment intent" →
  bei Checkout-/Abo-Zahlungen steht dort der **PaymentIntent**.)
- `PaymentRecord.amount_refunded` = `{ currency, value }` (Z. 184-193);
  `Charge.amount_refunded` = Zahl (Z. 71) + `Charge.refunded` (Z. 190);
  `PaymentIntent` hat **kein** `amount_refunded`, aber `latest_charge`.
- `RefundListParams` kennt nur `charge` und `payment_intent` (Refunds.d.ts Z. 482-499).
  Es gibt in dahlia **keinen** `Charge.invoice`-Filter mehr (Charges.d.ts: nur
  `created/customer/expand/payment_intent/transfer_group`) → der Zahlungsweg der Rechnung ist
  der einzige belegbare Refund-Pfad.

## 2) Live-Beweisform der Rechnung (Diagnose-Deployment, uncommitted, danach entfernt)

```
invoiceKeys (gefiltert): … payments, post_payment_credit_notes_amount, status, total …   (kein refund-Feld)
paymentsType: "object"  paymentsCount: 1          ← nur MIT expand
payment.entries[0].payment = { type: "payment_intent", payment_intent: "pi_3UNtTCCcIt8…",
                               charge: undefined, payment_record: undefined,
                               amount_refunded: null, id: null }
refunds.list   = [ { id: "re_3UNtTCCcIt8…", amount: 950, status: "succeeded",
                     payment_intent: "pi_3UNtTCCcIt8…", charge: "ch_3UNtTCCcIt8…" } ]
plain (ohne expand): paymentsType "undefined", entries []   ← Ursache des Dauer-0
```

## 3) Fix-Kern (`src/stripe/invoices.ts`)

| Funktion | Aufgabe |
|---|---|
| `invoicePaymentRefs(payments)` | Zahlungs-Datensätze → `{ kind, id, inlineRefunded }`; ID aus `payment.<kind>` (String/Objekt-ID), Fallback nur bei echtem `pi_/ch_/pr_`-Präfix; Erstattung aus `amount_refunded` (Zahl) bzw. `{value}` bzw. `latest_charge.amount_refunded`. |
| `refundFromInvoicePayments()` | Summe der Direktfelder (Signale ohne API-Call). |
| `invoiceRefundState()` | max(Legacy-`amount_refunded`, Direktfelder) → `refunded = > 0`. |
| `refundTotalFromRefs()` | `refunds.list({payment_intent}/{charge})`, Summe, **Entdopplung über Refund-ID**, `failed/canceled/requires_action` zählen nicht, Budget 5 Calls/Seite. |
| `fetchInvoicesForCustomer()` | Inline-Signal zuerst; nur wenn 0 UND eine Zahlungs-ID vorliegt → Listen-Fallback. |

`logRefundShapeOnce()` (temporärer Diagnose-Helfer) ist **entfernt**.

## 4) Tests (alle grün)

| Suite | Ergebnis |
|---|---|
| `bun --env-file=.env p2-statusabbildung-test.ts` | **58 PASS / 0 FAIL** (vorher 47; +11: [7c] Zahlungspfad) |
| `bun --env-file=.env stripe-webhook-test.ts` | **62 PASS / 0 FAIL** (unverändert) |
| `bun i18n-scan.ts` | KEY-PARITY ✅ de = en = 1599 (i18n-Dateien unberührt) |
| `npx tsc -p tsconfig.gate.json` | **keine** Fehler in `src/stripe/invoices.ts` (Bestandsfehler unverändert) |

Neue Checks [7c]: ID aus `payment.payment_intent`/`payment.charge`/`payment.payment_record`,
expandierter Charge + `latest_charge` ohne API-Call, Fallback nutzt die echte ID,
Summierung (500+450=950), Entdopplung über zwei Zahlungswege, fail-safe ohne Zahlungsbezug
(0 API-Calls), sowie der Quellcode-Check, dass `logRefundShapeOnce` weg ist.

## 5) Build / Deploy / Bundle

`bash build-vercel.sh` → **exit 0**; `bunx vercel deploy --prebuilt --prod --yes` → siehe
Deploy-Zeilen unten (www 200). Bundle-Nachweis: `invoicePaymentRefs`/`refundTotalFromRefs`
im Server-Bundle; Client-Chunk `billing-*.js` unverändert mit `billing_invoice_refunded`
(„Erstattet") + `billing_invoice_refunded_amount` („%s erstattet").

## 6) Live-Verifikation (read-only ServerFn `getBillingOverview`, gemintete Owner-Clerk-Session)

Rohdaten: `docs/p2-refund-probe-live.txt` (Diagnose-Lauf) + `/tmp/probe2.log` (final).
Ergebnis für `83SWNKUD-0001`: `amountRefunded: 950`, `refunded: true`, `status: paid`,
`error: null`, weiterhin `cancelAtPeriodEnd: true` / `cancelAt: 2026-11-07T11:57:13Z`.

## 7) Grenze (Nicht-Änderungen)

`git diff` für `src/stripe/checkout.ts`, `src/stripe/portal.ts`, `src/lib/usage-guard.ts`,
`src/db/schema.ts`, `src/api/stripe-webhook.ts` = **leer**. Geändert wurden ausschließlich
`src/stripe/invoices.ts` (Anzeige-Mapping) und `p2-statusabbildung-test.ts` (Tests) plus
Dokumentation. Kein Schema, kein Webhook-Handler, keine Quota-/Pro-Logik.

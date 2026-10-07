// ─────────────────────────────────────────────────────────────────────────────
// P2 Statusabbildung (2026-10-07, Owner-Auftrag vor Public Launch)
// Kündigungsstatus (cancel_at_period_end / cancel_at) + Refund-Status (Refunded)
//
// Deterministische Suite OHNE echte Stripe-API-Calls:
//   [0] Migration: Spalten cancel_at_period_end/cancel_at existieren (idempotent)
//   [1] Handler: customer.subscription.updated mit cancel_at_period_end=true → DB
//   [2] Handler: Events ohne Kündigungsaussage (invoice.paid) lassen sie stehen
//   [3] Handler: Kündigung zurückgenommen (cancel_at_period_end=false) → gelöscht
//   [4] GRENZE: Pro-/Quota-Logik unverändert (active+gekündigt = weiter pro/200)
//   [5] Handler: subscription.deleted → expired + Kündigungszustand zurückgesetzt
//   [6] Handler: refund-bezogene Events → No-Op ohne DB-Wirkung (200-Semantik)
//   [7] Mapping: invoiceRefundState + fetchInvoicesForCustomer (amount_refunded)
//   [7b] Mapping-Nachfass: Erstattung aus invoice.payments (dahlia) + Refund-Listen-Fallback
//   [8] Mapping: subscriptionCancelState (inkl. dahlia cancellation_details)
//   [8b] Mapping-Nachfass: LIVE-Form der Portal-Kündigung (cancel_at_period_end=false
//        + cancel_at + cancellation_details.reason=cancellation_requested) → gekündigt,
//        auch OHNE zugestelltes customer.subscription.updated-Event (Live-Read)
//
// Usage (Repo-Wurzel, echte Test-DB):
//   bun --env-file=.env p2-statusabbildung-test.ts
// Exit-Code 0 nur, wenn alle Checks grün. Synthetische Testnutzer, Cleanup im finally.
// ─────────────────────────────────────────────────────────────────────────────
import { getDb } from './src/db/index';
import { initDb } from './src/db/init';
import { processStripeEvent } from './src/api/stripe-webhook';
import {
  qGetPlanTier,
  qGetSubscriptionByStripeId,
} from './src/db/queries';
import { limitForPlan, FREE_LIMIT, PRO_LIMIT } from './src/lib/usage-guard';
import {
  invoiceRefundState,
  refundFromInvoicePayments,
  fetchInvoicesForCustomer,
  subscriptionCancelState,
  type InvoiceSummary,
} from './src/stripe/invoices';

const RUN = Date.now().toString(36);
const CLERK = `p2-${RUN}-a`;
const SUB = `sub_p2_${RUN}`;
const CUS = `cus_p2_${RUN}`;
const CANCEL_AT = 1_792_147_764; // 2026-11-07T11:56:04Z (realistischer Perioden-Endpunkt)
const PERIOD_END = 1_792_147_764;
const sql = getDb();

let passed = 0;
let failed = 0;
const failures: string[] = [];
const check = (cond: boolean, label: string) => {
  if (cond) {
    passed += 1;
    console.log(`  ✓ PASS: ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  ✗ FAIL: ${label}`);
  }
};

const subscriptionUpdatedEvent = (
  status: string,
  opts: {
    cancelAtPeriodEnd?: boolean;
    cancelAt?: number | null;
    cancellationReason?: string;
  } = {},
) => ({
  type: 'customer.subscription.updated',
  data: {
    object: {
      id: SUB,
      customer: CUS,
      status,
      ...(opts.cancelAtPeriodEnd !== undefined
        ? { cancel_at_period_end: opts.cancelAtPeriodEnd }
        : {}),
      ...(opts.cancelAt !== undefined ? { cancel_at: opts.cancelAt } : {}),
      ...(opts.cancellationReason !== undefined
        ? { cancellation_details: { reason: opts.cancellationReason } }
        : {}),
      items: {
        data: [
          {
            price: { lookup_key: 'pro_monthly' },
            current_period_end: PERIOD_END,
          },
        ],
      },
    },
  },
});

const invoicePaidEvent = () => ({
  type: 'invoice.paid',
  data: {
    object: {
      id: `in_p2_${RUN}`,
      customer: CUS,
      parent: { subscription_details: { subscription: SUB } },
      lines: [{ price: { lookup_key: 'pro_monthly' }, period: { end: PERIOD_END } }],
    },
  },
});

async function main() {
  try {
    console.log('— p2-statusabbildung-test (Kündigungs-/Refund-Statusabbildung) —\n');
    console.log('Testnutzer:', CLERK, '| sub:', SUB);

    // ── [0] Migration ────────────────────────────────────────────────────────
    console.log('\n[0] Migration subscriptions.cancel_at_period_end / cancel_at');
    await initDb();
    const cols = (await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'subscriptions'
        AND column_name IN ('cancel_at_period_end', 'cancel_at')
      ORDER BY column_name
    `) as Array<Record<string, unknown>>;
    const names = cols.map((c) => String(c.column_name));
    check(
      names.includes('cancel_at') && names.includes('cancel_at_period_end'),
      `Spalten vorhanden: ${names.join(', ') || '(keine)'}`,
    );
    const cape = cols.find((c) => c.column_name === 'cancel_at_period_end');
    check(
      cape !== undefined && String(cape.data_type) === 'boolean' && cape.is_nullable === 'NO',
      'cancel_at_period_end ist BOOLEAN NOT NULL',
    );
    const cat = cols.find((c) => c.column_name === 'cancel_at');
    check(
      cat !== undefined && String(cat.data_type).startsWith('timestamp'),
      'cancel_at ist TIMESTAMPTZ',
    );

    // Testabo anlegen: über checkout.session.completed (legt die Zeile an; der
    // Handler wirft für unbekannte Subscriptions → Retry-Semantik, deshalb ist
    // die Reihenfolge Session → subscription.updated wie im echten Ablauf).
    await processStripeEvent(
      {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: `cs_p2_${RUN}`,
            mode: 'subscription',
            payment_status: 'paid',
            client_reference_id: CLERK,
            metadata: { userId: CLERK },
            customer: CUS,
            subscription: SUB,
          },
        },
      },
      {
        retrieveSubscription: async () => ({
          current_period_end: PERIOD_END,
          items: { data: [{ price: { lookup_key: 'pro_monthly' } }] },
        }),
      },
    );
    let row = await qGetSubscriptionByStripeId(SUB);
    check(
      row !== null && row.cancelAtPeriodEnd === false && row.cancelAt === null,
      'frisches Abo: cancel_at_period_end=false, cancel_at=null (Default)',
    );
    check(row?.planTier === 'pro', 'Test-Setup: Pro-Abo aktiv (checkout.session.completed)');

    // ── [1] Kündigung zum Periodenende wird gespeichert ──────────────────────
    console.log('\n[1] customer.subscription.updated: Kündigung zum Periodenende');
    await processStripeEvent(subscriptionUpdatedEvent('active', {
      cancelAtPeriodEnd: true,
      cancelAt: CANCEL_AT,
    }));
    row = await qGetSubscriptionByStripeId(SUB);
    check(row?.cancelAtPeriodEnd === true, 'cancel_at_period_end=true gespeichert');
    check(
      row?.cancelAt?.getTime() === CANCEL_AT * 1000,
      `cancel_at gespeichert (${row?.cancelAt?.toISOString() ?? 'null'})`,
    );
    check(row?.status === 'active', "Stripe-Status bleibt 'active' (Zugriff bis Periodenende)");
    check(
      row?.currentPeriodEnd?.getTime() === PERIOD_END * 1000,
      'current_period_end bleibt der bestehende Wert',
    );

    // ── [2] Events ohne Kündigungsaussage lassen den Zustand stehen ──────────
    console.log('\n[2] invoice.paid (keine Kündigungsaussage) → Zustand bleibt');
    await processStripeEvent(invoicePaidEvent());
    row = await qGetSubscriptionByStripeId(SUB);
    check(
      row?.cancelAtPeriodEnd === true && row?.cancelAt?.getTime() === CANCEL_AT * 1000,
      'Kündigungszustand von invoice.paid NICHT überschrieben',
    );

    // ── [3] Kündigung zurückgenommen → Zustand gelöscht ──────────────────────
    console.log('\n[3] Kündigung zurückgenommen (cancel_at_period_end=false)');
    await processStripeEvent(subscriptionUpdatedEvent('active', {
      cancelAtPeriodEnd: false,
      cancelAt: null,
    }));
    row = await qGetSubscriptionByStripeId(SUB);
    check(
      row?.cancelAtPeriodEnd === false && row?.cancelAt === null,
      'cancel_at_period_end=false + cancel_at=null (Kündigung zurückgenommen)',
    );

    // ── [4] GRENZE: Pro-/Quota-Logik unverändert ─────────────────────────────
    console.log('\n[4] Grenze: Pro-Freischaltung/Quota bleiben unverändert');
    await processStripeEvent(subscriptionUpdatedEvent('active', {
      cancelAtPeriodEnd: true,
      cancelAt: CANCEL_AT,
    }));
    const tierWhileCancelled = await qGetPlanTier(CLERK);
    check(
      tierWhileCancelled === 'pro',
      'gekündigt-zum-Periodenende → Guard liefert weiter pro (200 Generierungen bis Periodenende)',
    );
    check(limitForPlan('pro') === PRO_LIMIT && PRO_LIMIT === 200, 'Pro-Limit unverändert 200');
    check(limitForPlan('free') === FREE_LIMIT && FREE_LIMIT === 5, 'Free-Limit unverändert 5');

    // ── [5] subscription.deleted → expired + Kündigungszustand weg ───────────
    console.log('\n[5] customer.subscription.deleted');
    await processStripeEvent({
      type: 'customer.subscription.deleted',
      data: { object: { id: SUB, customer: CUS } },
    });
    row = await qGetSubscriptionByStripeId(SUB);
    check(row?.status === 'expired', "subscription.deleted → status 'expired'");
    check(
      row?.cancelAtPeriodEnd === false && row?.cancelAt === null,
      'nach Ablauf KEIN „Gekündigt – läuft bis …" mehr',
    );
    check((await qGetPlanTier(CLERK)) === 'free', 'nach Ablauf → Guard wieder free');

    // ── [6] Refund-bezogene Events → No-Op ───────────────────────────────────
    console.log('\n[6] Refund-bezogene Events (charge.refunded / invoice.updated)');
    const before = await sql`
      SELECT plan_tier, status, cancel_at_period_end, cancel_at, updated_at
      FROM subscriptions WHERE stripe_subscription_id = ${SUB}
    ` as Array<Record<string, unknown>>;
    for (const type of [
      'charge.refunded',
      'charge.refund.updated',
      'invoice.updated',
      'credit_note.created',
    ]) {
      await processStripeEvent({ type, data: { object: { id: `obj_p2_${RUN}`, amount_refunded: 950 } } });
    }
    const after = await sql`
      SELECT plan_tier, status, cancel_at_period_end, cancel_at, updated_at
      FROM subscriptions WHERE stripe_subscription_id = ${SUB}
    ` as Array<Record<string, unknown>>;
    check(
      JSON.stringify(before) === JSON.stringify(after),
      'refund-bezogene Events: kein DB-Write (Live-Read-Mapping statt Spiegel)',
    );

    // ── [7] Refund-Mapping aus der Stripe-Rechnung ───────────────────────────
    console.log('\n[7] Mapping: amount_refunded → „Erstattet"');
    check(invoiceRefundState({ amount_refunded: 950 }).refunded === true, 'amount_refunded=950 → refunded=true');
    check(invoiceRefundState({ amount_refunded: 950 }).amountRefunded === 950, 'Erstattungsbetrag 950 durchgereicht');
    check(invoiceRefundState({ amount_refunded: 0 }).refunded === false, 'amount_refunded=0 → refunded=false');
    check(invoiceRefundState({}).refunded === false, 'fehlendes Feld → refunded=false (fail-safe)');
    const paidInvoiceFixture = {
      id: 'in_p2_refunded',
      number: '83SWNKUD-0001',
      created: 1_759_800_000,
      amount_paid: 950,
      amount_refunded: 950,
      currency: 'eur',
      status: 'paid', // Stripe lässt den Status nach einer Erstattung auf 'paid'
      hosted_invoice_url: null,
      invoice_pdf: null,
      lines: { data: [{ period: { start: 1_759_800_000, end: PERIOD_END }, description: 'Pro' }] },
    };
    const openInvoiceFixture = {
      ...paidInvoiceFixture,
      id: 'in_p2_open',
      amount_refunded: 0,
      status: 'paid',
    };
    const fakeStripe = {
      invoices: { list: async () => ({ data: [paidInvoiceFixture, openInvoiceFixture] }) },
    } as unknown as import('stripe').default;
    const summaries: InvoiceSummary[] = await fetchInvoicesForCustomer(fakeStripe, CUS);
    check(summaries[0]?.refunded === true, 'Rechnung mit amount_refunded → refunded=true (UI: „Erstattet")');
    check(summaries[0]?.amountPaid === 950 && summaries[0]?.amountRefunded === 950, 'Betrag 9,50 € voll erstattet abgebildet');
    check(
      summaries[0]?.status === 'paid',
      "Stripe-Status bleibt 'paid' — genau deshalb entscheidet amount_refunded die Anzeige",
    );
    check(summaries[1]?.refunded === false, 'Rechnung ohne Erstattung → weiter „Bezahlt"');

    // ── [7b] P2-Nachfass: Erstattung in der API-Version dahlia ───────────────
    // Live-Befund 2026-10-07: die echte Rechnung 83SWNKUD-0001 (real voll
    // erstattet) liefert `amount_refunded` NICHT am Invoice-Objekt (Feld in
    // 2026-06-24.dahlia entfernt) → Anzeige blieb „Bezahlt". Der Erstattungs-
    // betrag steht am Zahlungs-Datensatz bzw. ist per Refund-Liste lesbar.
    console.log('\n[7b] Erstattung aus Zahlungen (dahlia) + Refund-Listen-Fallback');
    check(
      invoiceRefundState({
        amount_paid: 950,
        payments: {
          data: [
            {
              id: 'inpay_p2',
              type: 'payment_record',
              payment: {
                type: 'payment_record',
                id: 'pmt_rec_p2',
                amount_refunded: { currency: 'eur', value: 950 },
              },
            },
          ],
        },
      }).refunded === true,
      'dahlia: payment_record.amount_refunded.value=950 → refunded=true',
    );
    check(
      invoiceRefundState({
        payments: { data: [{ payment: { type: 'charge', amount_refunded: 950 } }] },
      }).amountRefunded === 950,
      'charge.amount_refunded=950 → Betrag übernommen',
    );
    check(
      invoiceRefundState({
        amount_paid: 950,
        payments: { data: [{ payment: { type: 'payment_intent', id: 'pi_p2' } }] },
      }).refunded === false,
      'nur payment_intent ohne Erstattungsfeld → false (kein erfundenes „Erstattet")',
    );
    check(refundFromInvoicePayments(undefined) === 0, 'keine payments → 0 (fail-safe)');

    const dahliaInvoiceFixture = {
      id: 'in_p2_dahlia',
      number: '83SWNKUD-0001',
      created: 1_759_800_000,
      amount_paid: 950,
      currency: 'eur',
      status: 'paid',
      lines: { data: [{ period: { start: 1_759_800_000, end: PERIOD_END }, description: 'Pro' }] },
      payments: {
        data: [
          {
            id: 'inpay_p2_dahlia',
            type: 'payment_record',
            payment: {
              type: 'payment_record',
              id: 'pmt_rec_p2_dahlia',
              amount_refunded: { currency: 'eur', value: 950 },
            },
          },
        ],
      },
    };
    const dahliaStripe = {
      invoices: { list: async () => ({ data: [dahliaInvoiceFixture] }) },
    } as unknown as import('stripe').default;
    const dahliaSummaries = await fetchInvoicesForCustomer(dahliaStripe, CUS);
    check(
      dahliaSummaries[0]?.refunded === true && dahliaSummaries[0]?.amountRefunded === 950,
      'Live-Form (ohne amount_refunded am Invoice) → „Erstattet 9,50 €"',
    );

    const piInvoiceFixture = {
      ...dahliaInvoiceFixture,
      id: 'in_p2_pi',
      payments: { data: [{ payment: { type: 'payment_intent', id: 'pi_p2_fallback' } }] },
    };
    let refundListCalls = 0;
    const piStripe = {
      invoices: { list: async () => ({ data: [piInvoiceFixture] }) },
      refunds: {
        list: async () => {
          refundListCalls += 1;
          return { data: [{ amount: 950, status: 'succeeded' }] };
        },
      },
    } as unknown as import('stripe').default;
    const piSummaries = await fetchInvoicesForCustomer(piStripe, CUS);
    check(
      piSummaries[0]?.refunded === true && piSummaries[0]?.amountRefunded === 950,
      'Fallback: Refund-Liste zum PaymentIntent → 950 erkannt',
    );
    check(refundListCalls === 1, 'Fallback nur bei fehlendem Erstattungsfeld (1 Call)');

    const plainStripe = {
      invoices: { list: async () => ({ data: [openInvoiceFixture] }) },
    } as unknown as import('stripe').default;
    const plainSummaries = await fetchInvoicesForCustomer(plainStripe, CUS);
    check(plainSummaries[0]?.refunded === false, 'Rechnung ohne jede Erstattungsspur → false');

    // ── [8] subscriptionCancelState (inkl. dahlia-Variante) ──────────────────
    console.log('\n[8] Mapping: cancel_at_period_end / cancel_at');
    check(
      subscriptionCancelState({ cancel_at_period_end: true, cancel_at: CANCEL_AT }).cancelAtPeriodEnd === true,
      'cancel_at_period_end=true erkannt',
    );
    check(
      subscriptionCancelState({ cancel_at_period_end: false }).cancelAtPeriodEnd === false,
      'cancel_at_period_end=false erkannt',
    );
    check(
      subscriptionCancelState({ cancellation_details: { reason: 'cancel_at_period_end' } })
        .cancelAtPeriodEnd === true,
      'dahlia-Fallback: cancellation_details.reason=cancel_at_period_end → gekündigt',
    );
    check(
      subscriptionCancelState({ cancellation_details: { reason: 'payment_failed' } })
        .cancelAtPeriodEnd === false,
      'anderer cancellation_details.reason → nicht als Kündigung gewertet',
    );
    check(subscriptionCancelState({}).cancelAtPeriodEnd === false, 'kein Feld → false (fail-safe)');
    check(
      subscriptionCancelState({ cancel_at_period_end: true, cancel_at: CANCEL_AT }).cancelAt === CANCEL_AT,
      'cancel_at als Zahl übernommen',
    );
    check(
      subscriptionCancelState({ cancel_at_period_end: true, cancel_at: null }).cancelAt === null,
      'cancel_at=null bleibt null (UI nutzt dann das Periodenende)',
    );
    // ── [8b] P2-Nachfass: exakt die LIVE beobachtete Portal-Kündigung ────────
    // Live-Befund 2026-10-07 (Owner-Abo, im Portal gekündigt „läuft ab 07.11."):
    // Stripe lieferte `cancel_at_period_end:false` + `cancel_at` = 2026-11-07T11:57:13Z
    // → die Anzeige blieb „Pro – Aktiv". Genau dieser Fall muss „gekündigt" ergeben,
    // auch ohne dass ein `customer.subscription.updated` zugestellt wurde (Live-Read).
    console.log('\n[8b] Live-Form der Portal-Kündigung (ohne Webhook-Event)');
    const liveShapedSub = {
      cancel_at_period_end: false,
      cancel_at: CANCEL_AT,
      canceled_at: 1_759_800_123,
      cancellation_details: { reason: 'cancellation_requested' },
    } as const;
    check(
      subscriptionCancelState(liveShapedSub).cancelAtPeriodEnd === true,
      'Live-Form (cancel_at_period_end=false + cancel_at + reason) → gekündigt',
    );
    check(
      subscriptionCancelState({ cancel_at: CANCEL_AT }).cancelAtPeriodEnd === true,
      'cancel_at allein (terminierte Kündigung) → gekündigt',
    );
    check(
      subscriptionCancelState({ cancellation_details: { reason: 'cancellation_requested' } })
        .cancelAtPeriodEnd === true,
      'reason=cancellation_requested (echte dahlia-Enum) → gekündigt',
    );
    check(
      subscriptionCancelState({ canceled_at: 1_759_800_123 }).cancelAtPeriodEnd === true,
      'canceled_at gesetzt (Kündigungs-Request) → gekündigt',
    );
    check(
      subscriptionCancelState({ cancel_at: CANCEL_AT }).cancelAt === CANCEL_AT,
      'cancel_at = 07.11.2026 wird als „läuft bis"-Datum durchgereicht',
    );
    check(
      subscriptionCancelState({
        cancel_at: null,
        canceled_at: null,
        cancellation_details: { reason: null },
      }).cancelAtPeriodEnd === false,
      'aktives Abo ohne jedes Kündigungssignal → weiter aktiv (keine Falschaussage)',
    );
  } finally {
    try {
      await sql`DELETE FROM subscriptions WHERE stripe_subscription_id LIKE ${`sub_p2_${RUN}%`}`;
      await sql`DELETE FROM users WHERE clerk_id LIKE ${`p2-${RUN}%`}`;
      console.log('\n  cleanup ok (subscriptions/users)');
    } catch (err) {
      console.error('  cleanup fehlgeschlagen:', err);
    }
    console.log(`\n— Ergebnis: ${passed} PASS / ${failed} FAIL —`);
    if (failures.length > 0) console.log('Fehlschläge:\n- ' + failures.join('\n- '));
    if (failed > 0) process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Suite fehlgeschlagen (unexpected):', err);
  process.exitCode = 1;
});

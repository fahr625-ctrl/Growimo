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
//   [8] Mapping: subscriptionCancelState (inkl. dahlia cancellation_details)
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

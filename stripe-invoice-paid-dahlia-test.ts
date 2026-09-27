// ─────────────────────────────────────────────────────────────────────────────
// Bug 2 — `invoice.paid` mit dem ECHTEN Stripe-Payload (API-Version dahlia)
// ─────────────────────────────────────────────────────────────────────────────
// Usage (Repo-Wurzel, echte Test-DB):   bun --env-file=.env stripe-invoice-paid-dahlia-test.ts
//
// Warum diese Suite existiert (Bestandsaufnahme 2026-09-27, §5.3): die alten
// Repo-Fixtures bauen `invoice.subscription` + `lines[].price.lookup_key` — eine
// Form, die Stripe mit API-Version 2026-08-26.dahlia NICHT mehr sendet. Der
// Handler war dadurch ein stiller No-Op (kein DB-Zugriff, HTTP 200) und der
// grüne Fixture-Test hat das nicht gesehen. Diese Suite spielt das ECHTE, vom
// Testkonto live abgerufene Event-Objekt durch `processStripeEvent`:
//
//   stripe-fixtures/invoice-paid-dahlia-real.json   (verbatim, Testmodus)
//
// Belege:
//   [1] Struktur des Fixtures = neue Form (kein `subscription`, `parent.…`)
//   [2] Helper-Extraktion am echten Objekt
//   [3] Kind-Prozess mit absichtlich ungültiger DATABASE_URL: der echte Payload
//       MUSS werfen ⇒ der Pfad erreicht die DB (vorher: stiller No-Op)
//   [4] DB-Roundtrip: current_period_end wird auf das Posten-Periodenende
//       verlängert (Testzeile, Cleanup im finally)
//   [5] Rückwärtskompatibilität: alte Form bleibt grün
//   [6] Live (wenn STRIPE_SECRET_KEY gesetzt): neuestes echtes invoice.paid per
//       API holen und VERBATIM replayen
// ─────────────────────────────────────────────────────────────────────────────
import { getDb } from './src/db/index';
import {
  invoicePeriodEnd,
  invoicePriceLookupKey,
  invoiceSubscriptionId,
  processStripeEvent,
} from './src/api/stripe-webhook';
import { qGetSubscriptionByStripeId, qUpsertSubscription } from './src/db/queries';

const FIXTURE_PATH = `${import.meta.dir}/stripe-fixtures/invoice-paid-dahlia-real.json`;
const RUN = Date.now().toString(36);
const TEST_USER = `invpaid-${RUN}`;
const SYNTH_SUB = `sub_invpaid_${RUN}`;
const SYNTH_CUS = `cus_invpaid_${RUN}`;
const BOGUS_DB = 'postgresql://bogus:bogus@127.0.0.1:1/nodb';

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

type AnyEvent = { type: string; data: { object: Record<string, unknown> } };

/** Fixture verbatim laden (abgelegtes, echtes Event-Objekt). */
async function loadRealFixture(): Promise<AnyEvent & { id?: string }> {
  const raw = await Bun.file(FIXTURE_PATH).json();
  return raw as AnyEvent & { id?: string };
}

/** Kopie des echten Events mit EINER dokumentierten Mutation: der Subscription-ID. */
function withSubscriptionId(event: AnyEvent, subscriptionId: string): AnyEvent {
  const clone: AnyEvent = JSON.parse(JSON.stringify(event));
  const invoice = clone.data.object as Record<string, any>;
  if (invoice?.parent?.subscription_details) {
    invoice.parent.subscription_details.subscription = subscriptionId;
  } else {
    invoice.subscription = subscriptionId;
  }
  return clone;
}

function linePeriodEnd(event: AnyEvent): number {
  const invoice = event.data.object as Record<string, any>;
  return Number(invoice.lines.data[0].period.end);
}

/**
 * Kind-Prozess mit ungültiger DATABASE_URL: erreicht der Handler die DB, wirft
 * er. Löst er fehlerfrei auf, hat er die DB nie berührt (= stiller No-Op).
 */
async function probeDbReach(event: AnyEvent): Promise<{ reachedDb: boolean; detail: string }> {
  const script = `
    const { processStripeEvent } = await import(${JSON.stringify(`${import.meta.dir}/src/api/stripe-webhook.ts`)});
    const event = JSON.parse(process.env.PROBE_EVENT);
    try {
      await processStripeEvent(event);
      console.log('RESULT:NO_DB_TOUCH');
    } catch (err) {
      console.log('RESULT:THREW:' + String(err && err.message || err).slice(0, 80));
    }
  `;
  const proc = Bun.spawn([process.execPath, '-e', script], {
    cwd: import.meta.dir,
    env: { ...process.env, DATABASE_URL: BOGUS_DB, PROBE_EVENT: JSON.stringify(event) },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  await proc.exited;
  const line = out.split('\n').find((l) => l.startsWith('RESULT:')) ?? '';
  if (line.startsWith('RESULT:THREW')) return { reachedDb: true, detail: line.slice('RESULT:THREW:'.length) };
  if (line.startsWith('RESULT:NO_DB_TOUCH')) return { reachedDb: false, detail: 'kein DB-Zugriff (stiller No-Op)' };
  return { reachedDb: false, detail: `unklar (stdout=${out.slice(0, 120)} stderr=${err.slice(0, 160)})` };
}

async function main() {
  let seededSynthetic = false;
  console.log(`— stripe-invoice-paid-dahlia-test —\nRUN ${RUN} | Fixture: ${FIXTURE_PATH}`);

  try {
    const real = await loadRealFixture();
    const inv = real.data.object as Record<string, any>;
    const realSub = inv?.parent?.subscription_details?.subscription;
    const realLineEnd = linePeriodEnd(real);

    // ── [1] Fixture-Struktur = NEUE API-Form ────────────────────────────────
    console.log('\n[1] Fixture = echte dahlia-Form (keine Repo-Fixture)');
    check(real.type === 'invoice.paid', `Fixture ist ein invoice.paid-Event (${real.id ?? 'ohne id'})`);
    check(!('subscription' in inv), 'Top-Level-Feld `subscription` existiert NICHT (alter Handler las genau das)');
    check(typeof realSub === 'string' && realSub.startsWith('sub_'), `Verknüpfung unter parent.subscription_details.subscription (${String(realSub).slice(0, 12)}…)`);
    check(inv.lines?.data?.[0]?.price === undefined, 'Rechnungsposten OHNE `price.lookup_key` (alte Form entfallen)');
    check(typeof inv.lines?.data?.[0]?.pricing?.price_details?.price === 'string', 'Preis über lines[].pricing.price_details.price (nur ID)');
    check(typeof realLineEnd === 'number' && realLineEnd > 0, `Posten-Periodenende vorhanden (${realLineEnd})`);
    check(typeof inv.period_end === 'number', `invoice.period_end vorhanden (${inv.period_end})`);
    check(inv.period_end !== realLineEnd, `invoice.period_end ≠ Posten-Periodenende (Erstkauf: ${inv.period_end} vs. echte Periode ${realLineEnd}) → Posten-Pfad ist der richtige`);

    // ── [2] Helper am echten Objekt ─────────────────────────────────────────
    console.log('\n[2] Extraktion am echten Event-Objekt');
    check(invoiceSubscriptionId(inv) === realSub, 'invoiceSubscriptionId liest parent.subscription_details.subscription');
    check(invoicePeriodEnd(inv) === realLineEnd, 'invoicePeriodEnd liest lines[].period.end');
    check(invoicePriceLookupKey(inv) === null, 'invoicePriceLookupKey → null (dahlia: kein lookup_key) ⇒ bestehender DB-Tarif bleibt');
    check(invoiceSubscriptionId({ subscription: 'sub_legacy' }) === 'sub_legacy', 'alter Top-Level-Pfad weiter lesbar (Rückwärtskompatibilität)');
    check(invoicePeriodEnd({ period_end: 12345 }) === 12345, 'invoice.period_end als Fallback');
    check(invoicePriceLookupKey({ lines: { data: [{ price: { lookup_key: 'pro_monthly' } }] } }) === 'pro_monthly', 'alter lookup_key-Pfad weiter lesbar');
    check(invoiceSubscriptionId({ parent: { subscription_details: { subscription: { id: 'sub_obj' } } } }) === 'sub_obj', 'Objekt-Form der Subscription-Referenz wird aufgelöst');
    check(invoiceSubscriptionId({}) === null, 'Rechnung ohne Subscription → null (No-Op, fail-closed)');

    // ── [3] DB-Erreichbarkeit mit ungültiger DATABASE_URL ───────────────────
    console.log('\n[3] Beweis „Pfad erreicht die DB" (Kind-Prozess, bogus DATABASE_URL)');
    const realProbe = await probeDbReach(real);
    check(realProbe.reachedDb, `ECHTER invoice.paid-Payload erreicht die DB (bogus-DB → ${realProbe.detail})`);
    const legacyProbe = await probeDbReach({
      type: 'invoice.paid',
      data: { object: { subscription: 'sub_legacy_probe', customer: 'cus_x', period_end: 123 } },
    });
    check(legacyProbe.reachedDb, `alte Payload-Form erreicht die DB ebenfalls (${legacyProbe.detail})`);

    // ── [4] DB-Roundtrip mit dem echten Payload (nur Subscription-ID ersetzt) ─
    console.log('\n[4] DB-Roundtrip: current_period_end wird verlängert');
    const oldPeriod = realLineEnd - 30 * 86400;
    await qUpsertSubscription({
      clerkUserId: TEST_USER,
      stripeCustomerId: SYNTH_CUS,
      stripeSubscriptionId: SYNTH_SUB,
      planTier: 'pro',
      status: 'active',
      currentPeriodEnd: oldPeriod,
    });
    seededSynthetic = true;
    const beforeRow = await qGetSubscriptionByStripeId(SYNTH_SUB);
    check(beforeRow?.currentPeriodEnd?.getTime() === oldPeriod * 1000, `Ausgangswert gesetzt (${oldPeriod})`);

    await processStripeEvent(withSubscriptionId(real, SYNTH_SUB));
    const afterRow = await qGetSubscriptionByStripeId(SYNTH_SUB);
    check(afterRow !== null, 'Zeile existiert nach invoice.paid');
    check(afterRow?.status === 'active', 'status = active');
    check(afterRow?.planTier === 'pro', 'plan_tier bleibt pro (kein lookup_key im dahlia-Payload)');
    check(
      afterRow?.currentPeriodEnd?.getTime() === realLineEnd * 1000,
      `current_period_end = Posten-Periodenende des echten Events (${realLineEnd}; davor ${oldPeriod}) — VERLÄNGERT`,
    );
    check(afterRow?.stripeCustomerId === String(inv.customer), 'stripe_customer_id aus dem echten Event übernommen');

    // Unbekannte Subscription → wirft (Retry-Semantik bleibt)
    let threw = false;
    try {
      await processStripeEvent(withSubscriptionId(real, `sub_ghost_${RUN}`));
    } catch {
      threw = true;
    }
    check(threw, 'invoice.paid für unbekannte Subscription → wirft (500 → Stripe-Retry)');

    // ── [5] Rückwärtskompatibilität: alte Form ──────────────────────────────
    console.log('\n[5] Alte Payload-Form bleibt grün (Rückwärtskompatibilität)');
    const legacyPeriod = realLineEnd + 86400;
    await processStripeEvent({
      type: 'invoice.paid',
      data: {
        object: {
          id: `in_legacy_${RUN}`,
          subscription: SYNTH_SUB,
          customer: SYNTH_CUS,
          period_end: legacyPeriod,
          lines: { data: [{ price: { lookup_key: 'pro_yearly' } }] },
        },
      },
    });
    const legacyRow = await qGetSubscriptionByStripeId(SYNTH_SUB);
    check(legacyRow?.currentPeriodEnd?.getTime() === legacyPeriod * 1000, 'alte Form: current_period_end aus invoice.period_end');
    check(legacyRow?.planTier === 'pro', 'alte Form: plan_tier aus lines[].price.lookup_key (pro_yearly → pro)');

    // ── [6] Live-Payload frisch von der API, verbatim ───────────────────────
    console.log('\n[6] Live: neuestes echtes invoice.paid aus dem Testkonto, verbatim');
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) {
      console.log('  – SKIP: STRIPE_SECRET_KEY nicht gesetzt');
    } else {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(secret);
      const events = await stripe.events.list({ limit: 100 });
      const latest = events.data.find(
        (e) => e.type === 'invoice.paid' && (e.data.object as any)?.parent?.subscription_details?.subscription,
      );
      if (!latest) {
        console.log('  – SKIP: kein invoice.paid-Event im Testkonto gefunden');
      } else {
        const liveEvent = { id: latest.id, type: latest.type, data: { object: latest.data.object as unknown as Record<string, unknown> } };
        const liveInv = liveEvent.data.object as Record<string, any>;
        const liveSub = String(liveInv.parent.subscription_details.subscription);
        const liveLineEnd = Number(liveInv.lines.data[0].period.end);
        check(new Date(latest.created * 1000).getTime() > 0, `Live-Event ${latest.id} abgerufen (${new Date(latest.created * 1000).toISOString()})`);
        check(invoiceSubscriptionId(liveInv) === liveSub, 'Live-Payload: Subscription-ID extrahierbar');
        check(invoicePeriodEnd(liveInv) === liveLineEnd, `Live-Payload: Periodenende extrahierbar (${liveLineEnd})`);
        const liveProbe = await probeDbReach(liveEvent);
        check(liveProbe.reachedDb, `Live-Payload erreicht die DB (${liveProbe.detail})`);

        const preExisting = await qGetSubscriptionByStripeId(liveSub);
        if (preExisting) {
          check(true, `Verbatim-Replay übersprungen: für ${liveSub.slice(0, 12)}… existiert bereits eine Zeile (kein Schreibzugriff auf Bestandsdaten)`);
        } else {
          await qUpsertSubscription({
            clerkUserId: TEST_USER,
            stripeCustomerId: String(liveInv.customer),
            stripeSubscriptionId: liveSub,
            planTier: 'pro',
            status: 'active',
            currentPeriodEnd: liveLineEnd - 30 * 86400,
          });
          await processStripeEvent(liveEvent);
          const liveRow = await qGetSubscriptionByStripeId(liveSub);
          check(liveRow?.currentPeriodEnd?.getTime() === liveLineEnd * 1000, `Verbatim-Replay schreibt current_period_end = ${liveLineEnd} in die DB`);
          await sql`DELETE FROM subscriptions WHERE stripe_subscription_id = ${liveSub}`;
          const gone = await qGetSubscriptionByStripeId(liveSub);
          check(gone === null, 'Live-Testzeile wieder entfernt (keine Spuren)');
        }
      }
    }

    console.log(`\n=== stripe-invoice-paid-dahlia-test: ${passed} PASS, ${failed} FAIL ===`);
    if (failed > 0) {
      console.log('Fehlgeschlagen:');
      for (const f of failures) console.log('  - ' + f);
      process.exitCode = 1;
    }
  } finally {
    try {
      if (seededSynthetic) {
        await sql`DELETE FROM subscriptions WHERE stripe_subscription_id = ${SYNTH_SUB} OR stripe_subscription_id = ${`sub_ghost_${RUN}`}`;
      }
      await sql`DELETE FROM subscriptions WHERE stripe_customer_id = ${SYNTH_CUS}`;
      await sql`DELETE FROM users WHERE clerk_id = ${TEST_USER}`;
      console.log('  cleanup ok (subscriptions/users)');
    } catch (err) {
      console.error('  cleanup fehlgeschlagen:', err);
    }
  }
}

main().catch((err) => {
  console.error('Suite fehlgeschlagen (unexpected):', err);
  process.exitCode = 1;
});

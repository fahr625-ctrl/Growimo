// READ-ONLY (Teil A, Owner-Auftrag 2026-11-05). NUR SELECT. Keine Schreibzugriffe.
// Ziel: Herkunft der 6 subscriptions-Zeilen in der PROD-DB belegen.
import { getDb } from '../src/db/index';

const sql = getDb();

const out: Record<string, unknown> = {};

out.subscriptions = await sql`
  SELECT id, user_id, stripe_customer_id, stripe_subscription_id, plan_tier, status,
         current_period_end, created_at
  FROM subscriptions ORDER BY created_at ASC
`;

out.users = await sql`
  SELECT u.id, u.clerk_id, u.created_at, u.email
  FROM users u
  WHERE u.id IN (SELECT user_id FROM subscriptions)
  ORDER BY u.created_at ASC
`;

out.beta = await sql`
  SELECT id, email, approved, created_at FROM beta_signups ORDER BY created_at ASC
`;

out.usageMonthly = await sql`
  SELECT user_id, period, used, limit_value FROM usage_monthly
  WHERE user_id IN (SELECT user_id FROM subscriptions) ORDER BY period
`.catch((e: unknown) => ({ error: String(e) }));

out.analytics = await sql`
  SELECT user_id, event_type, count(*)::int AS n, min(created_at) AS first_seen, max(created_at) AS last_seen
  FROM analytics_events
  WHERE user_id IN (SELECT user_id::text FROM subscriptions)
  GROUP BY user_id, event_type ORDER BY n DESC LIMIT 50
`.catch((e: unknown) => ({ error: String(e) }));

out.constraint = await sql`
  SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
  WHERE conrelid = 'subscriptions'::regclass AND contype = 'c'
`;

out.counts = await sql`
  SELECT
    (SELECT count(*)::int FROM subscriptions) AS subscriptions,
    (SELECT count(*)::int FROM subscriptions WHERE status = 'active') AS active,
    (SELECT count(*)::int FROM beta_signups) AS beta_signups,
    (SELECT count(*)::int FROM beta_signups WHERE approved) AS beta_approved,
    (SELECT count(*)::int FROM users) AS users,
    (SELECT count(*)::int FROM usage_monthly) AS usage_monthly,
    (SELECT count(*)::int FROM projects) AS projects
`;

out.newObjects = await sql`
  SELECT
    (SELECT count(*)::int FROM information_schema.tables
      WHERE table_name IN ('beta_entitlements','video_credits_monthly')) AS new_tables,
    (SELECT count(*)::int FROM information_schema.columns
      WHERE table_name = 'subscriptions'
        AND column_name IN ('billing_period','discount_coupon_id','tier_changed_at')) AS new_columns
`;

out.tables = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' ORDER BY table_name
`;

await Bun.write('/tmp/tarife-a-aboherkunft.json', JSON.stringify(out, null, 2));
console.log('geschrieben: /tmp/tarife-a-aboherkunft.json');
process.exit(0);

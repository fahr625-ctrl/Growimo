// Read-only snapshot for the Etsy "erst speichern, dann buchen" test.
// Usage: bun --env-file=.env run scripts/_etsy-persist-snapshot.ts <label>
import { neon } from '@neondatabase/serverless';
import { writeFileSync } from 'node:fs';

const TEST_USER = 'user_3KbZIeGa0b1MWX0NvZrUCXRcgA8';
const label = process.argv[2] ?? 'snapshot';
const sql = neon(process.env.DATABASE_URL as string);

const users = await sql`
  SELECT id, clerk_id, email, created_at FROM users WHERE clerk_id = ${TEST_USER}
`;
const usage = await sql`
  SELECT um.period, um.count, um.updated_at
  FROM usage_monthly um JOIN users u ON u.id = um.user_id
  WHERE u.clerk_id = ${TEST_USER}
`;
const events = await sql`
  SELECT COUNT(*)::int AS n FROM usage_events WHERE user_id = ${TEST_USER}
`;
const projects = await sql`
  SELECT COUNT(*)::int AS n FROM projects p
  JOIN users u ON u.id = p.user_id WHERE u.clerk_id = ${TEST_USER}
`;
const contents = await sql`
  SELECT COUNT(*)::int AS n FROM generated_content gc
  JOIN users u ON u.id = gc.user_id WHERE u.clerk_id = ${TEST_USER}
`;
const etsyContents = await sql`
  SELECT gc.id, gc.project_id, gc.created_at, left(gc.title, 60) AS title
  FROM generated_content gc JOIN users u ON u.id = gc.user_id
  WHERE u.clerk_id = ${TEST_USER} AND gc.content_type = 'etsy_listing'
  ORDER BY gc.created_at DESC LIMIT 5
`;

const snap = {
  label,
  at: new Date().toISOString(),
  user: users[0] ?? null,
  usage,
  usage_events_rows: events[0]?.n ?? null,
  projects: projects[0]?.n ?? null,
  contents: contents[0]?.n ?? null,
  etsy_contents: etsyContents,
};
const out = `/home/team/shared/etsy-e2e-2026-11-14/db-${label}.json`;
writeFileSync(out, JSON.stringify(snap, null, 2));
console.log(JSON.stringify(snap, null, 2));
console.log('written:', out);

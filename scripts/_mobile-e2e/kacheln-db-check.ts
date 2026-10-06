/**
 * Kachel-E2E: DB-Zustand des Testnutzers roh auslesen.
 * Run: bun --env-file=.env scripts/_mobile-e2e/kacheln-db-check.ts <clerkUserId> [limitProjects]
 *
 * Zeigt usage_monthly (Zähler = bezahlte Einheiten) und die neuesten Projekte
 * mit ihren contentTypes + den tatsächlich gespeicherten generated_content-Zeilen.
 * Damit ist pro Live-Lauf belegbar: Projekt gespeichert, contentTypes exakt wie
 * erwartet, Zähler = Anzahl Ergebnisse (kein stiller Zusatzverbrauch).
 */
import { getDb } from '../../src/db/index';

const sql = getDb();
const clerkId = process.argv[2];
const limit = Number(process.argv[3] ?? '2');
if (!clerkId) {
  console.log('usage: bun --env-file=.env scripts/_mobile-e2e/kacheln-db-check.ts <clerkUserId> [limitProjects]');
  process.exit(1);
}

const users: any = await sql`SELECT id FROM users WHERE clerk_id = ${clerkId} LIMIT 1`;
if (!users.length) {
  console.log(JSON.stringify({ clerkId, userFound: false }, null, 2));
  process.exit(0);
}
const uid = users[0].id;

const usage: any = await sql`
  SELECT period, count FROM usage_monthly WHERE user_id = ${uid} ORDER BY period
`;
const projects: any = await sql`
  SELECT id, title, content_types, created_at
  FROM projects WHERE user_id = ${uid}
  ORDER BY created_at DESC LIMIT ${limit}
`;

// content_types kann text[] oder jsonb sein — roh mitnehmen und zusätzlich parsen.
const parsed = projects.map((p: any) => {
  let types: unknown = p.content_types;
  if (typeof types === 'string') {
    try {
      types = JSON.parse(types);
    } catch {
      types = String(types).replace(/[{}"]/g, '').split(',').filter(Boolean);
    }
  }
  return {
    id: p.id,
    title: p.title,
    createdAt: p.created_at,
    contentTypes: types,
  };
});

const contents: any = [];
for (const p of parsed.slice(0, limit)) {
  const rows: any = await sql`
    SELECT content_type, length(body) AS body_len
    FROM generated_content WHERE project_id = ${p.id}
    ORDER BY content_type
  `;
  contents.push({
    projectId: p.id,
    rows: rows.map((r: any) => ({ contentType: r.content_type, bodyLen: Number(r.body_len) })),
  });
}

console.log(
  JSON.stringify(
    {
      clerkId,
      internalUserId: uid,
      usageMonthly: usage,
      usageTotal: usage.reduce((s: number, r: any) => s + Number(r.count), 0),
      projects: parsed,
      contents,
    },
    null,
    2,
  ),
);

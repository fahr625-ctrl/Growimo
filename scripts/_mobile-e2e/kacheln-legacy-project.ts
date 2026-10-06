/**
 * Kachel-E2E: ältestes/neuestes Projekt finden, das einen der NICHT mehr
 * wählbaren Typen (trend_insight / marketing_analysis / market_intelligence)
 * enthält — Beleg, dass bestehende Projekte weiterhin normal anzeigbar sind.
 * Run: bun --env-file=.env scripts/_mobile-e2e/kacheln-legacy-project.ts
 */
import { getDb } from '../../src/db/index';

const sql = getDb();
const rows: any = await sql`
  SELECT p.id, p.title, p.user_id, p.created_at, p.content_types
  FROM projects p
  JOIN generated_content g ON g.project_id = p.id
  WHERE g.content_type IN ('trend_insight','marketing_analysis','market_intelligence')
  ORDER BY p.created_at DESC
  LIMIT 5
`;
const seen = new Set<string>();
const out: any[] = [];
for (const r of rows) {
  if (seen.has(r.id)) continue;
  seen.add(r.id);
  const types: any = await sql`
    SELECT content_type FROM generated_content WHERE project_id = ${r.id} ORDER BY content_type
  `;
  out.push({
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
    storedContentTypes: types.map((t: any) => t.content_type),
  });
}
console.log(JSON.stringify({ candidates: out }, null, 2));

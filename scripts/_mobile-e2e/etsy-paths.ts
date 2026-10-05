import { getDb } from "../../src/db/index";
const sql = getDb();
const rows: any = await sql`
  SELECT gc.id, gc.created_at, gc.project_id, p.title,
         p.content_types::text AS cts,
         (length(gc.body) - length(replace(gc.body, chr(10), ''))) AS newlines,
         gc.metadata::text AS meta
  FROM generated_content gc JOIN projects p ON p.id = gc.project_id
  WHERE gc.content_type='etsy_listing' AND gc.created_at > '2026-10-03'
  ORDER BY gc.created_at DESC`;
console.log(JSON.stringify(rows.map((r: any) => ({ ...r, meta: (r.meta || '').slice(0, 300) })), null, 2));

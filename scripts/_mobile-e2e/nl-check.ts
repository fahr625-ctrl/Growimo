import { getDb } from "/home/team/shared/site/src/db/index";
const sql = getDb();
const rows: any = await sql`
  SELECT id, project_id, content_type, created_at, body FROM generated_content
  WHERE project_id IN (SELECT id FROM projects WHERE id::text LIKE 'ab9ecc9a%' OR id::text LIKE '5d42acdd%')
  ORDER BY created_at`;
console.log(JSON.stringify(rows.map((r: any) => ({
  id: r.id, ct: r.content_type, created: r.created_at,
  len: r.body.length, newlines: (r.body.match(/\n/g) || []).length,
  first200: r.body.slice(0, 200),
})), null, 2));

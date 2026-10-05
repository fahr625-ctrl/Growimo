import { getDb } from "../../src/db/index";
const sql = getDb();
const rows: any = await sql`
  SELECT content_type,
         count(*)::int AS n,
         sum(CASE WHEN body LIKE '%' || chr(10) || '%' THEN 1 ELSE 0 END)::int AS with_newline,
         max(created_at) AS newest
  FROM generated_content GROUP BY content_type ORDER BY content_type`;
console.log(JSON.stringify(rows, null, 2));
const etsy: any = await sql`
  SELECT id, created_at, length(body) AS len,
         (length(body) - length(replace(body, chr(10), ''))) AS newlines,
         body LIKE '%Bildprompt%' AS has_bildprompt
  FROM generated_content WHERE content_type='etsy_listing' ORDER BY created_at DESC LIMIT 20`;
console.log(JSON.stringify(etsy, null, 2));

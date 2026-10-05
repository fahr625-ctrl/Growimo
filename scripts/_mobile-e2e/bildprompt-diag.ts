/* Diagnose: enthält der frische Etsy-Body die Sektion "Pinterest-Bildprompt"?
 * Roh-Grep im JSON-Body (kein Extraktor).
 * Run: bun --env-file=.env scripts/_mobile-e2e/bildprompt-diag.ts
 */
import { getDb } from "../../src/db/index";

const sql = getDb();
const projs: any = await sql`
  SELECT id, title, content_types, created_at FROM projects
  WHERE id::text LIKE 'ab9ecc9a%' OR id::text LIKE '5d42acdd%' ORDER BY created_at`;

const out: any = { projects: projs };
for (const p of projs) {
  const rows: any = await sql`
    SELECT id, content_type, created_at, length(body) AS body_len, body
    FROM generated_content WHERE project_id = ${p.id} ORDER BY created_at`;
  out[p.id] = rows.map((r: any) => {
    const body = String(r.body ?? "");
    const hits = body
      .split("\n")
      .filter((l: string) => /bild\s*-?\s*prompt|image\s*-?\s*prompt|Bildkonzept/i.test(l));
    return {
      id: r.id,
      content_type: r.content_type,
      created_at: r.created_at,
      body_len: body.length,
      has_Bildprompt_literal: body.includes("Bildprompt"),
      has_Pinterest_Bildprompt: body.includes("Pinterest-Bildprompt"),
      heading_hits: hits.slice(0, 12),
      last_300_chars: body.slice(-300),
      numbered_headings: (body.match(/^\s*\d+\.\s+.*$/gm) || [])
        .map((s: string) => s.trim())
        .slice(0, 30),
    };
  });
}
console.log(JSON.stringify(out, null, 2));

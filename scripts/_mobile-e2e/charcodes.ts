import { getDb } from "../../src/db/index";
const sql = getDb();
const rows: any = await sql`
  SELECT id, created_at, body FROM generated_content
  WHERE content_type='etsy_listing' AND created_at > '2026-10-03' ORDER BY created_at DESC`;
for (const r of rows) {
  const counts: Record<string, number> = {};
  for (const ch of String(r.body)) {
    const c = ch.codePointAt(0)!;
    if (c < 32) counts['c' + c] = (counts['c' + c] ?? 0) + 1;
  }
  console.log(JSON.stringify({ id: r.id.slice(0, 8), created: r.created_at, ctrl: counts, hasCR: String(r.body).includes('\r'), hasBildprompt: String(r.body).includes('Bildprompt') }));
}
console.log("--- sample of a 0-newline body, 300-600 chars ---");
const z: any = await sql`SELECT body FROM generated_content WHERE id='0b7c5a86-e1f3-408b-9d5d-8b75c356c8c8'`;
console.log(JSON.stringify(z[0].body.slice(280, 700)));

import { getDb } from "../../src/db/index";
const sql = getDb();
const r: any = await sql`SELECT body FROM generated_content WHERE id='0b7c5a86-e1f3-408b-9d5d-8b75c356c8c8'`;
const body = String(r[0].body);
await Bun.write('testdata/etsy-collapsed-2026-10-05.txt', body);
console.log(JSON.stringify({ len: body.length, newlines: (body.match(/\n/g)||[]).length, hasPrompt: body.includes('Pinterest-Bildprompt') }));

import { getDb } from "../../src/db/index";
import { sanitizeFactText, buildFactGrounding, resultFactViolations } from "../../src/ai/fact-guard";
const sql = getDb();
const z: any = await sql`SELECT body FROM generated_content WHERE id='0b7c5a86-e1f3-408b-9d5d-8b75c356c8c8'`;
const collapsed = String(z[0].body);
// Fingerabdruck des Sanitizers: kept.join(' ').replace(/\s{2,}/g,' ')
console.log(JSON.stringify({
  doubleSpaceCount: (collapsed.match(/  /g) || []).length,
  tabCount: (collapsed.match(/\t/g) || []).length,
  newlineCount: (collapsed.match(/\n/g) || []).length,
  startsWithNumberedHeading: /^\s*1\.\s/.test(collapsed),
}));
// Repro: ein mehrzeiliges Etsy-Listing mit EINEM Faktenverstoß durch den Sanitizer
const grounding = buildFactGrounding({ productIdea: 'Handgemachte Keramiktassen mit Sprenkelglasur' });
const multi = [
  '1. SEO-Titel', 'Handgemachte Keramiktassen', '2. Kurzbeschreibung',
  'Jede Tasse ist ein Unikat.', '3. Vollständige Etsy-Beschreibung',
  'Wir versenden innerhalb von 3 Tagen.', '4. 13 Etsy-Tags', 'Keramiktassen, handgemacht',
  '20. Pinterest-Bildprompt', 'A close-up of a handmade ceramic cup with speckled glaze, on a rustic wooden table.',
  '21. Instagram-Beitrag', 'Genieße deinen Kaffee. #Keramik',
].join('\n');
console.log('violations(multi):', JSON.stringify(resultFactViolations({ title: 't', body: multi }, grounding)));
const cleaned = sanitizeFactText(multi, grounding);
console.log(JSON.stringify({
  after_len: cleaned.length,
  after_newlines: (cleaned.match(/\n/g) || []).length,
  after: cleaned.slice(0, 400),
}));

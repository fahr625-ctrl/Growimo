/* Fakten-Schutz Live-Auswertung (Teil 2b) — read-only.
 * Run: bun --env-file=.env scripts/_fakten2b-extract.ts <clerkUserId>
 * Dumpt die 5 Paket-Assets aus generated_content, prüft jedes satzweise gegen
 * die FACT_PATTERNS (fact-guard.ts) und zusätzlich literal gegen die 4 Demo-Belege.
 * Schreibt: /tmp/fs/assets/<channel>.txt, /tmp/fs/assets.json, /tmp/fs/grep-report.txt
 */
import { getDb } from "../src/db/index";
import { factViolations, FACT_PATTERNS, buildFactGrounding } from "../src/ai/fact-guard";

const sql = getDb();
const clerkId = process.argv[2];
if (!clerkId) { console.log("usage: bun scripts/_fakten2b-extract.ts <clerkUserId>"); process.exit(1); }

const u: any = await sql`SELECT id, clerk_id FROM users WHERE clerk_id = ${clerkId} LIMIT 1`;
if (!u.length) { console.log("user not found"); process.exit(1); }
const uid = u[0].id;

const projects: any = await sql`SELECT id, title, product_idea, metadata FROM projects WHERE user_id = ${uid} ORDER BY created_at`;
const rows: any = await sql`
  SELECT id, project_id, content_type, title, body, metadata, created_at
  FROM generated_content WHERE user_id = ${uid} ORDER BY created_at`;

/* Die 4 Demo-Belege (Owner-Befund) + die von der Delegation benannten Muster. */
const DEMO = [
  ["Letztes Jahr habe ich", /letztes\s+jahr\s+habe\s+ich/i],
  ["Lieferung in", /lieferung\s+in|in\s+\d+\s*[–-]\s*\d+\s*(?:werk)?tagen|in\s+wenigen\s+tagen/i],
  ["Rückgaberecht", /r(?:ü|ue)ckgabe/i],
  ["Diesen Geburtstagstrend lieben alle Eltern", /geburtstagstrend|alle\s+eltern|alle\s+lieben/i],
  ["trauerkarten (Fremd-Slug)", /trauerkarten/i],
];
const EXTRA = [
  ["anekdote-letztes-jahr", /\b(?:letztes|voriges)\s+jahr\s+(?:habe|hatte|war|wollte|musste|durfte)\s+ich\b/i],
  ["geburtstag-meines-sohnes", /geburtstag\s+meines\s+sohnes|mein(?:es)?\s+sohn/i],
  ["als-ich-erzaehlung", /\bals\s+ich\s+[^.!?\n]{0,60}?\b(?:sah|merkte|bemerkte|dachte|f(?:ü|ue)hlte|gestaltete|schenkte|packte|machte)\b/i],
  ["meine-erfahrung-meine-praxis", /meine\s+erfahrung|aus\s+meiner\s+praxis|meine\s+praxis/i],
  ["in-x-tagen-wochen", /in\s+\d+\s*[–-]?\s*\d*\s*(?:werk)?tagen|in\s+\d+\s*[–-]?\s*\d*\s*wochen/i],
  ["lieferzeit-mit-dauer", /lieferzeit|lieferung\s+(?:dauert|innerhalb)|versand\s+dauert/i],
  ["versandkostenfrei", /versandkostenfrei|kostenloser\s+versand|gratis\s+versand/i],
  ["versand-zusage", /versand\s+(?:garantiert|innerhalb)|\bwir\s+versenden\b/i],
  ["rueckgaberecht", /r(?:ü|ue)ckgabe|umtausch|retoure/i],
  ["bearbeitungszeit", /bearbeitungszeit|bearbeitung\s+dauert/i],
  ["preis-ohne-grundlage", /(?:nur|schon|ab)\s+\d+(?:[.,]\d+)?\s*(?:€|eur|euro)|\d+(?:[.,]\d+)?\s*(?:€|eur|euro)\b/i],
  ["absolutes-materialversprechen", /100\s*%\s*\w+|garantiert|wasserfest|lebensmittelecht/i],
  ["trend-behauptung", /\btrend/i],
  ["alle-lieben", /alle\s+lieben|lieben\s+(?:gerade\s+)?alle|jeder\s+liebt/i],
  ["beliebteste-bestseller", /beliebteste|bestseller|am\s+beliebtesten/i],
  ["jahr-trend-claim", /\btrend\s*20\d\d\b|20\d\d\s*(?:der|ist\s+das)\s+trend/i],
  ["fremd-slug", /\/(?:trauerkarten|beispiel|muster|demo)[a-z0-9-]*/i],
  ["fremd-url", /https?:\/\/(?!(?:www\.)?growimo\.app)[^\s)"']+/i],
];

const out: any = { clerkId, internalUserId: uid, generatedAt: new Date().toISOString(), projects: projects.length, projectTitles: projects.map((p: any) => p.title), assets: [] };
const lines: string[] = [];
lines.push(`# Fakten-Grep der 5 Paket-Assets (Live-DB, read-only)`);
lines.push(`Nutzer: ${clerkId} / ${uid} — Projekt(e): ${projects.length} — Assets: ${rows.length}`);
lines.push("");

for (const p of projects) {
  lines.push(`## Projekt ${p.id} — "${p.title}"`);
  lines.push(`Produktidee: ${p.product_idea}`);
  lines.push(`Grounding (Idee + Projekt-Metadaten): ${JSON.stringify(String(buildFactGrounding({ productIdea: p.product_idea ?? "", additionalContext: JSON.stringify(p.metadata ?? {}) })).length)} Zeichen`);
  lines.push("");
}

await Bun.write("/tmp/fs/assets-raw.json", JSON.stringify(rows.map((r: any) => ({ id: r.id, type: r.content_type, title: r.title, body: r.body, metadata: r.metadata, created_at: r.created_at })), null, 2));

for (const r of rows) {
  const idea = projects.find((p: any) => p.id === r.project_id)?.product_idea ?? "";
  const grounding = buildFactGrounding({ productIdea: idea, additionalContext: JSON.stringify(projects.find((p: any) => p.id === r.project_id)?.metadata ?? {}) });
  const blob = `${r.title ?? ""}\n${r.body ?? ""}`;
  const v = factViolations(blob, grounding);
  // Strenger Zusatzlauf OHNE Grounding (reine Literal-Suche) — nur zur Transparenz.
  const vStrict = factViolations(blob, "");

  const hits: Array<{ name: string; kind: string; quote: string }> = [];
  for (const [name, re] of [...DEMO, ...EXTRA] as Array<[string, RegExp]>) {
    const m = blob.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"));
    if (m) {
      for (const raw of m) {
        const idx = blob.indexOf(raw);
        const sent = blob.slice(Math.max(0, blob.lastIndexOf(".", idx - 1) + 1), blob.indexOf(".", idx + raw.length) + 1 || blob.length).trim().replace(/\s+/g, " ").slice(0, 260);
        hits.push({ name, kind: "literal", quote: sent || raw });
      }
    }
  }

  const sentenceViolations: Array<{ pattern: string; sentence: string }> = [];
  for (const sent of blob.split(/(?<=[.!?])\s+|\n+/)) {
    if (!sent.trim()) continue;
    const sv = factViolations(sent, grounding);
    for (const s of sv) sentenceViolations.push({ pattern: s, sentence: sent.trim().replace(/\s+/g, " ").slice(0, 300) });
  }

  const meta: any = typeof r.metadata === "string" ? JSON.parse(r.metadata || "{}") : (r.metadata ?? {});

  out.assets.push({
    id: r.id, content_type: r.content_type, title: r.title, bodyLen: (r.body ?? "").length,
    createdAt: r.created_at,
    factViolations_grounded: v, factViolations_ungrounded: vStrict,
    literalHits: hits.map((h) => h.name), metadataKeys: Object.keys(meta),
  });

  lines.push(`── ${r.content_type.toUpperCase()} (${r.id}) — ${r.bodyLen ?? (r.body ?? "").length} Zeichen body`);
  lines.push(`TITEL: ${r.title}`);
  lines.push(`factViolations (grounded, ECHTER Check): ${v.length === 0 ? "0 — KEIN Verstoß" : JSON.stringify(v)}`);
  lines.push(`factViolations (ohne Grounding, Literal-Gegenprobe): ${vStrict.length === 0 ? "0" : JSON.stringify(vStrict)}`);
  lines.push(`Literal-Muster (18 Kategorien + 4 Demo-Belege): ${hits.length === 0 ? "KEIN Treffer" : JSON.stringify(hits.map((h) => h.name))}`);
  if (hits.length) for (const h of hits) lines.push(`   TREFFER [${h.name}] „${h.quote}"`);
  if (sentenceViolations.length) for (const s of sentenceViolations) lines.push(`   SATZ-VERSTOSS ${s.pattern} :: „${s.sentence}"`);
  const hints = meta.issues ?? meta.improvements ?? meta.score?.issues ?? null;
  if (hints) lines.push(`HINWEISE (metadata): ${JSON.stringify(hints).slice(0, 2000)}`);
  lines.push("");
  await Bun.write(`/tmp/fs/assets/${r.content_type}.txt`, `TITLE: ${r.title}\n\n${r.body}`);
  await Bun.write(`/tmp/fs/assets/${r.content_type}.meta.json`, JSON.stringify(meta, null, 2));
}

await Bun.write("/tmp/fs/assets.json", JSON.stringify(out, null, 2));
await Bun.write("/tmp/fs/grep-report.txt", lines.join("\n"));
console.log(lines.join("\n"));
console.log("\nSUMMARY:", JSON.stringify(out.assets.map((a: any) => ({ type: a.content_type, grounded: a.factViolations_grounded.length, ungrounded: a.factViolations_ungrounded.length, literalHits: a.literalHits })), null, 2));

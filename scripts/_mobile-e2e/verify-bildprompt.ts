/* Befund Bildprompt (Station 5) — Verifikation direkt an der DB.
 *
 * Liest den NEUESTEN Lauf eines Testnutzers und lässt den ECHTEN Extraktor
 * (`extractStrategyImage`, src/lib/strategy-image.ts) über die Roh-Bodies laufen.
 * Zusätzlich Roh-Grep (kein Extraktor) + Newline-Zähler der Bodies.
 *
 * Aufruf: bun --env-file=.env scripts/_mobile-e2e/verify-bildprompt.ts <clerkUserId> [projectId]
 */
import { getDb } from "../../src/db/index";
import { extractStrategyImage } from "../../src/lib/strategy-image";

const sql = getDb();
const clerkId = process.argv[2] ?? "user_3KGLrQivAW698KVoR3vkZoJYMKU";
const projectArg = process.argv[3];

const u: any = await sql`SELECT id, email FROM users WHERE clerk_id = ${clerkId} LIMIT 1`;
if (!u.length) {
  console.log(JSON.stringify({ clerkId, userFound: false }));
  process.exit(1);
}
const uid = u[0].id;

const usage: any = await sql`
  SELECT period, count FROM usage_monthly WHERE user_id = ${uid} ORDER BY period`;

const proj: any = projectArg
  ? await sql`SELECT id, title, product_idea, content_types, created_at FROM projects
              WHERE id = ${projectArg}::uuid LIMIT 1`
  : await sql`SELECT id, title, product_idea, content_types, created_at FROM projects
              WHERE user_id = ${uid} ORDER BY created_at DESC LIMIT 1`;
if (!proj.length) {
  console.log(JSON.stringify({ clerkId, internalUserId: uid, usage, project: null }));
  process.exit(1);
}
const p = proj[0];
const rows: any = await sql`
  SELECT id, content_type, title, metadata, body FROM generated_content
  WHERE project_id = ${p.id} ORDER BY created_at`;

const channels = rows.map((r: any) => {
  const body = String(r.body ?? "");
  const extracted = extractStrategyImage(body, r.content_type, {
    projectId: p.id,
    productIdea: p.product_idea ?? "",
    source: "project",
  });
  return {
    content_type: r.content_type,
    body_len: body.length,
    newlines: (body.match(/\n/g) || []).length,
    raw_has_pinterest_bildprompt: body.includes("Pinterest-Bildprompt"),
    raw_has_bildprompt: body.includes("Bildprompt"),
    hasImage: extracted !== null,
    promptLen: extracted ? extracted.prompt.length : 0,
    prompt: extracted ? extracted.prompt : null,
    ratio: extracted ? extracted.ratio : null,
    score: r.metadata?.score?.total ?? null,
  };
});

console.log(
  JSON.stringify(
    {
      clerkId,
      internalUserId: uid,
      usage,
      project: {
        id: p.id,
        title: p.title,
        product_idea: p.product_idea,
        content_types: p.content_types,
        created_at: p.created_at,
        url: `/app/projects/${p.id}`,
      },
      channels,
      verdict: {
        anyHasImage: channels.some((c) => c.hasImage),
        etsyHasImage: channels.find((c) => c.content_type === "etsy_listing")?.hasImage ?? null,
      },
    },
    null,
    2,
  ),
);

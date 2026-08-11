// ── F5 Server-side verification: build action plans for REAL assets from the DB
// and assert that every step references the asset's actual title/keywords/CTA.
import { qGetProjectContent } from './src/db/queries';
import { buildActionPlan } from './src/ai/action-plans';
import type { ActionPlan } from './src/ai/action-plans';

const PROJECT_ID = process.argv[2] ?? 'cb50fc2e-6a8c-4f4d-99e2-a3d3a42ad3a6'; // Sternenhimmel-Poster

function fail(msg: string): never {
  throw new Error('CONCRETENESS-FAIL: ' + msg);
}

function assertConcrete(plan: ActionPlan, title: string, keywords: string[], cta: string | null) {
  const all = plan.plan.map((s) => `${s.action} ${s.detail} ${s.doneCriteria}`).join(' | ');
  // 1) the asset title (or a distinctive prefix of it) appears in at least one step
  const titleFrag = title.replace(/^[\s"„“»«''"]+|[\s"„“»«''"]+$/g, '');
  if (titleFrag.length >= 12) {
    const frag = titleFrag.slice(0, 24);
    if (!all.includes(frag.slice(0, 12))) fail(`${plan.channel}: title fragment not referenced`);
  }
  // 2) at least 2 keywords are referenced verbatim
  const kwHits = keywords.filter((k) => k.length >= 3 && all.includes(k)).length;
  if (kwHits < 2) fail(`${plan.channel}: only ${kwHits}/≥2 keywords referenced (${keywords.slice(0, 3).join('; ')})`);
  // 3) the CTA (when present) is referenced
  if (cta && cta.length >= 8) {
    const frag = cta.slice(0, 16);
    if (!all.includes(frag)) fail(`${plan.channel}: CTA "${frag}…" not referenced`);
  }
  // 4) every step has all fields and a non-empty done criterion
  for (const s of plan.plan) {
    if (!s.action || !s.detail || !s.doneCriteria || s.step < 1) fail(`${plan.channel}: step ${s.step} incomplete`);
  }
  // 5) 5–8 steps per channel
  if (plan.plan.length < 5 || plan.plan.length > 8) fail(`${plan.channel}: ${plan.plan.length} steps (want 5–8)`);
}

async function main() {
  const content = await qGetProjectContent(PROJECT_ID);
  const wanted = ['pinterest_pin', 'etsy_listing', 'seo_blog'] as const;
  const planByChannel: Record<string, ActionPlan | null> = {};

  for (const ct of wanted) {
    const asset = content.find((c) => c.contentType === ct);
    if (!asset) { console.log(`\n[${ct}] NO ASSET IN PROJECT — skipped`); continue; }
    const plan = buildActionPlan({
      channel: asset.contentType,
      title: asset.title,
      body: asset.body,
      metadata: asset.metadata ?? {},
    });
    planByChannel[ct] = plan;
    if (!plan) throw new Error(`buildActionPlan returned null for ${ct}`);

    // Derive the keywords/CTA the test should require (mirror of extract.ts, inline)
    const meta = asset.metadata ?? {};
    const kwRaw: string[] =
      (typeof meta.focusKeyword === 'string' && meta.focusKeyword.trim() ? [String(meta.focusKeyword)] : [])
      .concat(
        Array.isArray(meta.keywords) ? meta.keywords.map(String) : [],
        Array.isArray(meta.focusKeywords) ? meta.focusKeywords.map(String) : [],
        Array.isArray(meta.tags) ? meta.tags.map(String) : [],
        Array.isArray(meta.lsiKeywords) ? meta.lsiKeywords.map(String) : [],
      );
    // LSI keywords from the body (SEO), mirroring extractSeo
    const lsiBodyMatch = asset.body.match(/Zusätzliche Keywords[^\n]*\n([\s\S]*?)(?=\n\d+\.|\n\d+\)|$)/i);
    if (lsiBodyMatch) {
      kwRaw.push(...lsiBodyMatch[1].split(/[,\n]/).map((x) => x.trim()));
    }
    const kwList = [...new Set(kwRaw.map((k) => k.replace(/^[\s"„“»«'']+|[\s"„“»«'']+$/g, '').trim()).filter((k) => k && k !== '(LSI)'))];
    const cta = null; // CTA lives in the body; the assertion above checks presence via body-scrape below

    // CTA from body (best-effort)
    const ctaMatch = asset.body.match(/Call[-\s]?to[- ]?Action[^\n]*\n([^\n]+)/i);
    const ctaBody = ctaMatch ? ctaMatch[1].trim() : null;

    assertConcrete(plan, asset.title, kwList, ctaBody);
    console.log(`\n✅ ${ct} — CONCRETE (${plan.plan.length} steps, ${kwList.length} keywords checked)`);
  }

  // Pretty-print for the report
  console.log('\n========== PLAN OUTPUT (for report) ==========');
  for (const ct of wanted) {
    const plan = planByChannel[ct];
    if (!plan) continue;
    console.log(`\n### ${ct} (assetRef: ${plan.assetRef})`);
    for (const s of plan.plan) {
      console.log(`${s.step}. ${s.action} | ${s.detail} | DONE: ${s.doneCriteria}`);
    }
  }

  // Unsupported channel must return null gracefully
  const nullPlan = buildActionPlan({ channel: 'email_newsletter', title: 'x', body: 'y', metadata: {} });
  if (nullPlan !== null) throw new Error('unsupported channel should yield null');
  console.log('\n✅ unsupported channel (email_newsletter) -> null (never throws)');
  console.log('\nALL F5 CHECKS PASSED');
}

main().then(() => process.exit(0)).catch((e) => { console.error('F5-TEST FAILED:', e); process.exit(1); });

import { generateContent } from './src/ai/generate.ts';
import { improveByScore } from './src/ai/improve.ts';
import type { ContentScore } from './src/ai/types.ts';

function withForcedIssues(score: ContentScore): ContentScore {
  return {
    ...score,
    total: 64,
    issues: [
      { severity: 'critical' as const, category: 'cta' as const, message: 'Der Call-to-Action fehlt oder ist leer.',
        fix: { field: 'cta', action: 'add', suggestion: 'Schreibe einen CTA mit maximal 100 Zeichen, der FOMO oder Neugier erzeugt (z. B. „Hol dir die Anleitung — bevor sie im Feed verschwindet").' } },
      { severity: 'warning' as const, category: 'length' as const, message: 'Die Pin-Beschreibung ist zu kurz.',
        fix: { field: 'description', action: 'expand', suggestion: 'Erweitere die Pin-Beschreibung auf 250–400 Zeichen. Baue 2–3 Keywords natürlich in den Fließtext ein.' } },
    ],
    summary: 'Test: zwei erzwungene Schwächen.',
  };
}

async function main() {
  const request = {
    contentType: 'pinterest_pin' as const,
    productIdea: 'Handgefertigte Keramikvase in Salbeigrün für ein gemütliches Boho-Wohnzimmer, ca. 25 cm hoch, Geschenk zur Einweihung',
  };
  const t0 = Date.now();
  const result = await generateContent(request);
  console.log(`\n[gen] ${((Date.now()-t0)/1000).toFixed(1)}s | score: ${result.score?.total} | issues: ${result.score?.issues.length}`);

  const fakeScore = withForcedIssues(result.score!);
  const t1 = Date.now();
  const outcome = await improveByScore(request, result, fakeScore);
  console.log(`[improve] ${((Date.now()-t1)/1000).toFixed(1)}s | improved: ${outcome.improved} | reason: ${outcome.reason}`);
  console.log('[improve] delta:', outcome.delta, `(${outcome.oldScore?.total} -> ${outcome.newScore?.total})`);
  console.log('[improve] appliedFixes:', outcome.appliedFixes.length, '| unchanged:', outcome.unchangedSections.join(', '));
  if (outcome.improvedContent) {
    console.log('[improve] new issues:', outcome.improvedContent.score?.issues.length);
    const oldSub = Object.fromEntries((outcome.oldScore?.subScores ?? []).map(s => [s.key, s.score]));
    for (const s of outcome.newScore?.subScores ?? []) {
      if (oldSub[s.key] !== undefined && oldSub[s.key] !== s.score) console.log(`  sub ${s.key}: ${oldSub[s.key]} -> ${s.score}`);
    }
    // structure check: headings must be preserved
    const headings = (outcome.improvedContent.body.match(/^\s*\d{1,2}\s*[.)]\s+.+$/gm) ?? []).length;
    console.log('[improve] numbered headings in improved body:', headings);
  }
}
main().catch((e) => { console.error('FAILED', e); process.exit(1); });

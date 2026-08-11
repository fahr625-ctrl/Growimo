import { writeFileSync } from 'node:fs';
import { generateContent } from './src/ai/generate.ts';
import { improveByScore } from './src/ai/improve.ts';
import type { ContentScore } from './src/ai/types.ts';

function withForcedIssues(score: ContentScore): ContentScore {
  return {
    ...score, total: 64,
    issues: [
      { severity: 'critical' as const, category: 'cta' as const, message: 'Der Call-to-Action fehlt oder ist leer.',
        fix: { field: 'cta', action: 'add', suggestion: 'Schreibe einen CTA mit maximal 100 Zeichen, der FOMO oder Neugier erzeugt (z. B. „Hol dir die Anleitung — bevor sie im Feed verschwindet").' } },
      { severity: 'warning' as const, category: 'length' as const, message: 'Die Pin-Beschreibung ist zu kurz.',
        fix: { field: 'description', action: 'expand', suggestion: 'Erweitere die Pin-Beschreibung auf 250–400 Zeichen. Baue 2–3 Keywords natürlich in den Fließtext ein.' } },
    ],
    summary: 'Test',
  };
}

async function main() {
  const request = { contentType: 'pinterest_pin' as const, productIdea: 'Handgefertigte Keramikvase in Salbeigrün für ein gemütliches Boho-Wohnzimmer, ca. 25 cm hoch, Geschenk zur Einweihung' };
  const result = await generateContent(request);
  const fakeScore = withForcedIssues(result.score!);
  const outcome = await improveByScore(request, result, fakeScore);
  writeFileSync('/tmp/e2e-original-body.txt', result.body);
  writeFileSync('/tmp/e2e-improved-body.txt', outcome.improvedContent?.body ?? 'NONE');
  console.log('written');
}
main().catch((e) => { console.error('FAILED', e); process.exit(1); });

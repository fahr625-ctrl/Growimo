import { writeFileSync } from 'node:fs';
import { generateContent } from './src/ai/generate.ts';
import { improveByScore } from './src/ai/improve.ts';
import { scoreContent } from './src/ai/scoring/index.ts';

// Build a REALISTICALLY weak asset: truncate description, empty CTA, few hashtags.
function weaken(body: string): string {
  const lines = body.split('\n');
  const out: string[] = [];
  let skip = 0;
  for (const line of lines) {
    const m = line.match(/^\s*(\d{1,2})\s*[.)]\s+(.+?)\s*$/);
    if (m) {
      const n = Number(m[1]);
      skip = (n === 2 || n === 4 || n === 5) ? 99 : 0;
      if (n === 2) { out.push(line, 'Wunderschöne Keramikvase für dein Zuhause. Einfach schön.'); skip = 99; continue; }
      if (n === 4) { out.push(line, '#Wohnen #Deko'); skip = 99; continue; }
      if (n === 5) { out.push(line, ''); skip = 99; continue; }
    }
    if (skip > 0) { skip--; continue; }
    out.push(line);
  }
  return out.join('\n');
}

async function main() {
  const request = { contentType: 'pinterest_pin' as const, productIdea: 'Handgefertigte Keramikvase in Salbeigrün für ein gemütliches Boho-Wohnzimmer, ca. 25 cm hoch, Geschenk zur Einweihung' };
  const full = await generateContent(request);
  const weak: typeof full = { ...full, body: weaken(full.body) };
  const weakScore = await scoreContent(request, weak);
  console.log('[weak] score:', weakScore.total, '| issues:');
  for (const i of weakScore.issues) console.log('  -', i.severity, i.category, '|', i.fix.action, '|', i.message.slice(0, 70));

  const outcome = await improveByScore(request, weak, weakScore);
  console.log('\n[improve] improved:', outcome.improved, '| reason:', outcome.reason, '| delta:', outcome.delta);
  if (outcome.improved && outcome.improvedContent) {
    console.log('[improve] new score:', outcome.newScore?.total, '| new issues:', outcome.improvedContent.score?.issues.length);
    const oldSub = Object.fromEntries((outcome.oldScore?.subScores ?? []).map(s => [s.key, s.score]));
    for (const s of outcome.newScore?.subScores ?? []) {
      if (oldSub[s.key] !== undefined && oldSub[s.key] !== s.score) console.log(`  sub ${s.key}: ${oldSub[s.key]} -> ${s.score}`);
    }
    const headings = (outcome.improvedContent.body.match(/^\s*\d{1,2}\s*[.)]\s+.+$/gm) ?? []).length;
    console.log('[improve] numbered headings:', headings);
    // word-for-word check of unchanged sections 3,6,7,8,9,10 (should be identical to weak body)
    const sec = (b: string, n: number) => { const m = b.match(new RegExp(`^\\s*${n}\\s*[.)]\\s+.+\\n([\\s\\S]*?)(?=\\n\\s*\\d{1,2}\\s*[.)]|$)`, 'm')); return (m?.[1] ?? '').trim(); };
    for (const n of [3, 6, 7, 8, 9, 10]) {
      const a = sec(weak.body, n), b = sec(outcome.improvedContent.body, n);
      console.log(`  section ${n} unchanged:`, a === b ? 'YES' : 'NO');
    }
  }
  writeFileSync('/tmp/e2e-weak-body.txt', weak.body);
  writeFileSync('/tmp/e2e-improved4-body.txt', outcome.improvedContent?.body ?? 'NONE');
}
main().catch((e) => { console.error('FAILED', e); process.exit(1); });

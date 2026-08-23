// F4-Paket-Verbesserungen — realer Testdurchlauf (Verifikation der 5 Punkte)
// Run: bun --env-file=.env run scripts/test-package-f4.ts
import { determineKernel, fallbackKernel } from '../src/ai/package/kernel';
import { generatePackageChannel } from '../src/ai/package/generate';
import { improveToScore } from '../src/ai/improve';
import { rankAssets, channelGoal } from '../src/ai/prioritize/rules';
import { buildBriefContext, findOption } from '../src/ai/strategy-brief/questions';
import type { ContentType } from '../src/ai/types';

const emotionalIdea =
  'Eine Kaffeetasse für zwei, die einen Platz für die zweite Tasse freihält und innen ein kleines Herz verbirgt — für alle, die jemanden vermissen und die gemeinsamen Kaffeemomente noch spüren wollen.';

const brief: Record<string, string> = {
  audience: 'gift_shoppers',
  price: 'mid',
  season: 'christmas',
  usp: 'personalized',
  platform: 'all',
  voice: 'friendly',
};

function briefLiteral(key: string) {
  const value = brief[key];
  const opt = findOption(key as never, value);
  return opt ? opt.label.de : value;
}

async function main() {
  console.log('──────────────── 5. Emotionaler mainHook (kernel) ────────────────');
  const kernel = await determineKernel(emotionalIdea, brief);
  console.log('mainHook:', kernel.mainHook);
  console.log('voice   :', kernel.voice);
  console.log('audience:', kernel.audienceNote);
  console.log('cta     :', kernel.cta);
  console.log('keywords:', kernel.keywords.join(', '));
  const fallback = fallbackKernel(emotionalIdea);
  console.log('fallback mainHook:', fallback.mainHook);

  console.log('\n──────────── 1. Paket-Überblick-Datenquelle (kernel + brief) ────────────');
  // Was die Überblick-Karte anzeigen würde (Brief bevorzugt, sonst kernel):
  console.log('Produkt(idee)        :', emotionalIdea.slice(0, 40) + '…');
  console.log('Zielgruppe (brief)   :', briefLiteral('audience'), '|| (kernel)', kernel.audienceNote);
  console.log('USP        (brief)   :', briefLiteral('usp'));
  console.log('Preis      (brief)   :', briefLiteral('price'));
  console.log('Anlass     (brief)   :', briefLiteral('season'));
  console.log('Ton        (brief)   :', briefLiteral('voice'), '|| (kernel)', kernel.voice);
  console.log('Zielbotschaft (kernel):', kernel.mainHook);
  console.log('briefContext:', buildBriefContext(brief, 'de'));

  console.log('\n──────────── 2+3. Priorisierung: beide Scores + Reichweite/Verkauf ────────────');
  // Simuliere vorhandene Kanäle mit Scores (wie im Paket).
  const assets: Array<{ channel: ContentType; qualityScore: number | null }> = [
    { channel: 'email_newsletter', qualityScore: 90 }, // Qualität hoch, aber Prio später (Owner-Beispiel)
    { channel: 'pinterest_pin', qualityScore: 78 },
    { channel: 'etsy_listing', qualityScore: 74 },
    { channel: 'seo_blog', qualityScore: 81 },
    { channel: 'social_post', qualityScore: 72 },
  ];
  const ranked = rankAssets(assets, 'de');
  console.log('Rangliste (deterministisch — unverändert):');
  ranked!.forEach((it) => {
    console.log(
      `  #${it.rank} ${it.channel.padEnd(16)} Qualität=${it.qualityScore}/100  Priorität=${it.priorityScore}/100  goal=${channelGoal(it.channel)}`,
    );
  });
  console.log('„… zuerst"-Empfehlungen:');
  (['reach', 'sales', 'retention'] as const).forEach((goal) => {
    const best = ranked!.find((it) => channelGoal(it.channel) === goal);
    if (best)
      console.log(
        `  ${goal.padEnd(9)} → ${best.channel} (#${best.rank})`,
      );
  });

  console.log('\n──────────── 4. „Auf 80+ verbessern" (realer Kanal, falls <80) ────────────');
  const ct: ContentType = 'social_post';
  const content = await generatePackageChannel(kernel, ct, emotionalIdea, buildBriefContext(brief, 'de'));
  const before = content.score?.total ?? null;
  console.log(`Generierter ${ct}: score=${before}/100, title=${content.title.slice(0, 50)}`);
  if (content.score != null && before != null && before < 80) {
    const outcome = await improveToScore(
      { contentType: ct, productIdea: emotionalIdea },
      content,
      content.score,
      80,
    );
    console.log(
      `  improveToScore: ${outcome.oldScore?.total} → ${outcome.newScore?.total} (delta ${outcome.delta}, fixes ${outcome.appliedFixes.length})`,
    );
    console.log(`  target erreicht (≥80): ${(outcome.newScore?.total ?? 0) >= 80}`);
  } else {
    console.log(`  Score schon ≥80 (${before}) — kein improve nötig; teste mit anderem Kanal falls gewünscht.`);
    // Erzwinge einen Test, indem wir mit dem vorhandenen Score trotzdem improve (bestmöglich) aufrufen,
    // nur um die Engine-Pfad-Ausführung zu verifizieren.
    if (content.score) {
      const outcome = await improveToScore(
        { contentType: ct, productIdea: emotionalIdea },
        content,
        content.score,
        95,
      );
      console.log(`  (Pfad-Check, Ziel 95): ${outcome.oldScore?.total} → ${outcome.newScore?.total}`);
    }
  }
  console.log('\nFERTIG.');
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);

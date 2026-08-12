// ── F7 Server-side verification: A/B-Varianten mit Score-Vergleich ────────────
// Run: bun --env-file=.env run f7-test.ts [projectId]
//
// REAL GPT-4o calls on REAL assets from the DB (default: Projekt
// "Personalisierte Sternenhimmel-Poster", cb50fc2e-6a8c-4f4d-99e2-a3d3a42ad3a6):
//   (a) Pinterest-Pin-Asset → generateVariants() →
//       assert: GENAU 3 Varianten, jede hat score.total 0–100, Titel ≠
//       Original-Titel, Body nicht leer, Varianten untereinander verschieden.
//   (b) Etsy-Listing-Asset → derselbe Durchlauf (zweiter Datensatz).
// Writes f7-test-evidence.txt and exits 0 when every check passed.
import { writeFileSync } from 'node:fs';
import { qGetProject, qGetProjectContent } from './src/db/queries';
import { generateVariants } from './src/ai/variants';
import type { ContentResult, ContentType } from './src/ai/types';

const PROJECT_ID = process.argv[2] ?? 'cb50fc2e-6a8c-4f4d-99e2-a3d3a42ad3a6';
const EVIDENCE = 'f7-test-evidence.txt';
const evidence: string[] = [];

function fail(msg: string): never {
  evidence.push(`\n❌ FAIL: ${msg}`);
  writeFileSync(EVIDENCE, evidence.join('\n'));
  throw new Error('F7-FAIL: ' + msg);
}
function note(msg: string): void {
  evidence.push(msg);
  console.log('  ' + msg);
}

async function runChannel(
  kind: ContentType,
  asset: ContentResult,
  productIdea: string,
  strategyContext?: string,
): Promise<void> {
  note(`\n── ${kind}: A/B-Varianten ──`);
  const originalTitle = asset.title;
  const originalBodyLen = asset.body.length;

  const result = await generateVariants(
    { contentType: kind, productIdea, strategyContext },
    asset,
    'de',
  );

  // 1) non-blocking contract: never throws, may return null
  if (result == null) fail(`${kind}: generateVariants returned null (API/JSON-Fehler)`);
  if (result.lang !== 'de') fail(`${kind}: lang muss 'de' sein (Prompt-Sprache)`);

  // 2) exactly 3 variants
  if (result.variants.length !== 3) {
    fail(`${kind}: erwartet GENAU 3 Varianten, erhalten: ${result.variants.length}`);
  }
  note(`3 Varianten erhalten (lang=${result.lang}).`);

  for (let i = 0; i < result.variants.length; i++) {
    const v = result.variants[i];
    const label = `Variante ${String.fromCharCode(65 + i)}`;

    // 3) title present + different from original
    if (!v.title || !v.title.trim()) fail(`${kind} ${label}: Titel leer`);
    if (v.title.trim() === originalTitle.trim()) {
      fail(`${kind} ${label}: Titel identisch mit Original („${originalTitle.slice(0, 60)}")`);
    }

    // 4) body non-empty and substantial
    if (!v.body || v.body.trim().length < 50) {
      fail(`${kind} ${label}: Body leer oder zu kurz (${v.body?.trim().length ?? 0} Zeichen)`);
    }
    if (v.body === asset.body) fail(`${kind} ${label}: Body identisch mit Original`);

    // 5) score present + in 0..100 (F1 pipeline reuse)
    if (v.score == null || typeof v.score.total !== 'number') {
      fail(`${kind} ${label}: score fehlt`);
    }
    if (v.score!.total < 0 || v.score!.total > 100) {
      fail(`${kind} ${label}: score.total außerhalb 0–100 (${v.score!.total})`);
    }
    note(
      `${label}: Score ${v.score!.total}/100 | Titel „${v.title.slice(0, 70)}${v.title.length > 70 ? '…' : ''}“ | Body ${v.body.length} Zeichen`,
    );
  }

  // 6) variants pairwise distinct (title OR body must differ)
  for (let a = 0; a < result.variants.length; a++) {
    for (let b = a + 1; b < result.variants.length; b++) {
      const va = result.variants[a];
      const vb = result.variants[b];
      if (va.title.trim() === vb.title.trim() && va.body === vb.body) {
        fail(`${kind}: Varianten ${a + 1} und ${b + 1} sind identisch`);
      }
    }
  }
  note('Varianten untereinander verschieden (Titel und/oder Body).');
  note(`Original: „${originalTitle.slice(0, 70)}“ (${originalBodyLen} Zeichen) — nicht verändert (read-only Call).`);
  note(`✅ ${kind} — A/B-Varianten erfolgreich`);
}

async function main(): Promise<void> {
  const project = await qGetProject(PROJECT_ID);
  if (!project) throw new Error(`Projekt ${PROJECT_ID} nicht gefunden`);
  const contents = await qGetProjectContent(PROJECT_ID);
  const productIdea = project.productIdea ?? '';
  const brief = (project.metadata as Record<string, unknown> | undefined)?.brief;
  const strategyContext =
    brief && typeof brief === 'object' && Object.keys(brief as object).length > 0
      ? Object.entries(brief as Record<string, string>)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')
      : undefined;

  evidence.push(`F7 TEST-EVIDENCE — ${new Date().toISOString()}`);
  evidence.push(`Projekt: ${project.title} (${PROJECT_ID})`);
  evidence.push(`Produktidee: ${productIdea.slice(0, 160)}`);
  evidence.push(`Strategie-Brief im Projekt: ${strategyContext ? 'ja' : 'nein'}`);

  const pin = contents.find((c) => c.contentType === 'pinterest_pin');
  const etsy = contents.find((c) => c.contentType === 'etsy_listing');
  if (!pin) throw new Error('kein pinterest_pin-Asset im Projekt');
  if (!etsy) throw new Error('kein etsy_listing-Asset im Projekt');

  await runChannel('pinterest_pin', pin, productIdea, strategyContext);
  await runChannel('etsy_listing', etsy, productIdea, strategyContext);

  evidence.push('\n\nALLE F7-CHECKS BESTANDEN ✅');
  writeFileSync(EVIDENCE, evidence.join('\n'));
  console.log('\n✅ F7 alle Prüfungen bestanden — Evidence: ' + EVIDENCE);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('F7-TEST FAILED:', err instanceof Error ? err.message : err);
    writeFileSync(EVIDENCE, evidence.join('\n'));
    process.exit(1);
  });
